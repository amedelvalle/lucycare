/**
 * Servicio de Claim Profile — vincula un doctor existente a la cuenta del médico.
 * 
 * Flujo:
 * 1. Médico se autentica con OTP (usa auth.service.ts)
 * 2. Se valida licencia y se actualiza doctor.profile_id al usuario autenticado
 * 3. Se actualiza profile con rol 'doctor'
 * 4. Se crean/actualizan servicios y disponibilidad
 * 5. Se cambia lucy_status a 'claimed' o 'booking_enabled'
 */

import { supabase } from '../lib/supabase'

interface ClaimProfileData {
  doctorId: string
  licenseNumber: string
  services: { name: string; durationMinutes: number; price: number; enabled: boolean }[]
  availability: {
    dayOfWeek: number
    startTime: string
    endTime: string
    slotDuration: number
  }[]
  enableBooking: boolean
}

interface ClaimResult {
  success: boolean
  error?: string
}

/**
 * Reclama un perfil de doctor existente para el usuario autenticado.
 */
export async function claimDoctorProfile(data: ClaimProfileData): Promise<ClaimResult> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    return { success: false, error: 'Debes iniciar sesión primero' }
  }

  const userId = session.user.id

  try {
    // ─── 1. Verificar que el doctor existe y no está reclamado ───
    const { data: doctor, error: fetchError } = await supabase
      .from('doctors')
      .select('id, profile_id, clinic_id, lucy_status')
      .eq('id', data.doctorId)
      .single()

    if (fetchError || !doctor) {
      return { success: false, error: 'Perfil de médico no encontrado' }
    }

    // Verificar si ya fue reclamado por otro usuario
    // Los doctores seed tienen profile_id apuntando a usuarios seed
    // Permitimos reclamar si lucy_status es 'listed_only'
    if (doctor.lucy_status !== 'listed_only') {
      return { success: false, error: 'Este perfil ya ha sido reclamado' }
    }

    // ─── 2. Actualizar profile del usuario a rol doctor ───
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ role: 'doctor' })
      .eq('id', userId)

    if (profileError) {
      console.error('Error actualizando profile:', profileError)
      return { success: false, error: 'Error al actualizar perfil' }
    }

    // ─── 3. Actualizar doctor: vincular al usuario y cambiar status ───
    const { error: doctorError } = await supabase
      .from('doctors')
      .update({
        profile_id: userId,
        license_number: data.licenseNumber,
        lucy_status: data.enableBooking ? 'booking_enabled' : 'claimed',
        booking_enabled: data.enableBooking,
        tos_accepted_at: new Date().toISOString(),
        tos_version: 'v1.0',
      })
      .eq('id', data.doctorId)

    if (doctorError) {
      console.error('Error actualizando doctor:', doctorError)
      return { success: false, error: 'Error al reclamar perfil' }
    }

    // ─── 4. Crear clinic_member si no existe ───
    if (doctor.clinic_id) {
      const { error: memberError } = await supabase
        .from('clinic_members')
        .upsert({
          clinic_id: doctor.clinic_id,
          profile_id: userId,
          role: 'owner',
        }, { onConflict: 'clinic_id,profile_id' })

      if (memberError) {
        console.error('Error creando clinic_member:', memberError)
        // No crítico
      }
    }

    // ─── 5. Crear/actualizar servicios ───
    const enabledServices = data.services.filter(s => s.enabled)
    if (enabledServices.length > 0) {
      const servicesData = enabledServices.map((s, index) => ({
        doctor_id: data.doctorId,
        name: s.name,
        price: s.price,
        duration_minutes: s.durationMinutes,
        sort_order: index,
        is_active: true,
      }))

      // Insertar servicios nuevos (los existentes del seed se mantienen)
      const { error: servicesError } = await supabase
        .from('services')
        .insert(servicesData)

      if (servicesError) {
        console.error('Error creando servicios:', servicesError)
        // No crítico
      }
    }

    // ─── 6. Crear reglas de disponibilidad ───
    if (data.availability.length > 0) {
      const availData = data.availability.map(a => ({
        doctor_id: data.doctorId,
        clinic_id: doctor.clinic_id,
        day_of_week: a.dayOfWeek,
        start_time: a.startTime,
        end_time: a.endTime,
        slot_duration_min: a.slotDuration,
        is_active: true,
      }))

      const { error: availError } = await supabase
        .from('availability_rules')
        .insert(availData)

      if (availError) {
        console.error('Error creando disponibilidad:', availError)
        // No crítico
      }
    }

    return { success: true }

  } catch (err) {
    console.error('Error general en claim:', err)
    return { success: false, error: 'Error inesperado' }
  }
}
