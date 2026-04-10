/**
 * Servicio de Booking — crear citas desde el directorio público.
 * 
 * Flujo:
 * 1. Paciente selecciona servicio + fecha + hora
 * 2. Se verifica que el slot sigue disponible (prevención doble booking)
 * 3. Se crea/busca paciente en la clínica del doctor
 * 4. Se crea la cita con status 'scheduled' y source 'lucy_directorio'
 * 
 * El paciente debe estar autenticado (OTP verificado).
 */

import { supabase } from '../lib/supabase'

interface BookingData {
  doctorId: string
  clinicId: string
  serviceId: string
  startTime: string  // ISO string
  endTime: string    // ISO string
  patientName: string
  patientPhone: string
  notes?: string
}

interface BookingResult {
  success: boolean
  appointmentId?: string
  error?: string
}

/**
 * Crea una cita desde el directorio público.
 */
export async function createBooking(data: BookingData): Promise<BookingResult> {
  // Verificar sesión
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    return { success: false, error: 'Debes iniciar sesión para reservar' }
  }

  const userId = session.user.id

  try {
    // ─── 1. Verificar que el slot sigue libre (prevención doble booking) ───
    const { data: conflicting } = await supabase
      .from('appointments')
      .select('id, status_id')
      .eq('doctor_id', data.doctorId)
      .lt('start_time', data.endTime)
      .gt('end_time', data.startTime)

    // Obtener IDs de estados cancelados para excluirlos
    const { data: cancelledStatuses } = await supabase
      .from('appointment_statuses')
      .select('id')
      .in('name', ['Cancelada'])

    const cancelledIds = (cancelledStatuses || []).map(s => s.id)
    const activeConflicts = (conflicting || []).filter(
      c => !cancelledIds.includes(c.status_id)
    )

    if (activeConflicts.length > 0) {
      return { success: false, error: 'Este horario ya no está disponible. Selecciona otro.' }
    }

    // ─── 2. Obtener/crear paciente ───
    const patientId = await getOrCreatePatient(
      userId,
      data.clinicId,
      data.doctorId,
      data.patientName,
      data.patientPhone
    )

    if (!patientId) {
      return { success: false, error: 'Error al registrar datos del paciente' }
    }

    // ─── 3. Obtener status 'scheduled' ───
    const { data: scheduledStatus } = await supabase
      .from('appointment_statuses')
      .select('id')
      .eq('name', 'Programada')
      .single()

    if (!scheduledStatus) {
      return { success: false, error: 'Error de configuración: status no encontrado' }
    }

    // ─── 4. Crear la cita ───
    const { data: appointment, error: apptError } = await supabase
      .from('appointments')
      .insert({
        clinic_id: data.clinicId,
        doctor_id: data.doctorId,
        patient_id: patientId,
        service_id: data.serviceId,
        status_id: scheduledStatus.id,
        start_time: data.startTime,
        end_time: data.endTime,
        source: 'lucy_directorio',
        notes: data.notes || null,
        payment_status: 'pending',
      })
      .select('id')
      .single()

    if (apptError || !appointment) {
      console.error('Error creando cita:', apptError)
      return { success: false, error: 'Error al crear la cita. Intenta de nuevo.' }
    }

    return { success: true, appointmentId: appointment.id }

  } catch (err) {
    console.error('Error en booking:', err)
    return { success: false, error: 'Error inesperado. Intenta de nuevo.' }
  }
}

/**
 * Obtiene un paciente existente o crea uno nuevo en la clínica.
 * Busca por profile_id + clinic_id para evitar duplicados.
 */
async function getOrCreatePatient(
  profileId: string,
  clinicId: string,
  doctorId: string,
  fullName: string,
  phone: string
): Promise<string | null> {
  // Buscar paciente existente por profile_id y clinic_id
  const { data: existing } = await supabase
    .from('patients')
    .select('id')
    .eq('profile_id', profileId)
    .eq('clinic_id', clinicId)
    .single()

  if (existing) {
    return existing.id
  }

  // Crear paciente nuevo
  const { data: newPatient, error } = await supabase
    .from('patients')
    .insert({
      profile_id: profileId,
      clinic_id: clinicId,
      doctor_id: doctorId,
      full_name: fullName,
      phone: phone,
      document_type: 'DUI',
      document_number: 'PENDIENTE',
      date_of_birth: '2000-01-01',
      gender: 'otro',
    })
    .select('id')
    .single()

  if (error) {
    console.error('Error creando paciente:', error)
    return null
  }

  return newPatient?.id || null
}

/**
 * Cancela una cita (paciente puede cancelar hasta 4h antes).
 */
export async function cancelBooking(
  appointmentId: string
): Promise<{ success: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    return { success: false, error: 'No autenticado' }
  }

  // Obtener la cita
  const { data: appointment } = await supabase
    .from('appointments')
    .select('id, start_time, patient_id')
    .eq('id', appointmentId)
    .single()

  if (!appointment) {
    return { success: false, error: 'Cita no encontrada' }
  }

  // Verificar que faltan más de 4 horas
  const startTime = new Date(appointment.start_time)
  const now = new Date()
  const hoursUntil = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60)

  if (hoursUntil < 4) {
    return { success: false, error: 'No se puede cancelar con menos de 4 horas de anticipación' }
  }

  // Obtener status 'Cancelada'
  const { data: cancelledStatus } = await supabase
    .from('appointment_statuses')
    .select('id')
    .eq('name', 'Cancelada')
    .single()

  if (!cancelledStatus) {
    return { success: false, error: 'Error de configuración' }
  }

  // Actualizar status
  const { error } = await supabase
    .from('appointments')
    .update({
      status_id: cancelledStatus.id,
    })
    .eq('id', appointmentId)

  if (error) {
    return { success: false, error: 'Error al cancelar' }
  }

  return { success: true }
}
