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
import { normalizePhoneSV } from '../lib/phone'
import {
  isPastStart,
  PAST_APPOINTMENT_MESSAGE,
  isDoctorOperational,
  SUSPENDED_DOCTOR_MESSAGE,
} from './appointments.service'
import { isWithinDoctorAvailability, OUTSIDE_AVAILABILITY_MESSAGE, SLOT_TAKEN_MESSAGE, isSlotOverlapError } from './availability.service'

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

  // No permitir reservar en el pasado (UI + este servicio + trigger DB)
  if (isPastStart(data.startTime)) {
    return { success: false, error: PAST_APPOINTMENT_MESSAGE }
  }

  // Médico suspendido (eje OPERATIVIDAD) no acepta reservas
  if (!(await isDoctorOperational(data.doctorId))) {
    return { success: false, error: SUSPENDED_DOCTOR_MESSAGE }
  }

  // No permitir fuera de la disponibilidad del médico
  if (!(await isWithinDoctorAvailability(data.doctorId, data.startTime, data.endTime))) {
    return { success: false, error: OUTSIDE_AVAILABILITY_MESSAGE }
  }

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
      .in('name', ['cancelada'])

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
      .eq('name', 'programada')
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
      // Doble reserva bloqueada por la DB (trigger s7_55 / P0090) → mensaje amable.
      if (isSlotOverlapError(apptError)) {
        return { success: false, error: SLOT_TAKEN_MESSAGE }
      }
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
      full_name: fullName,
      phone: normalizePhoneSV(phone),
      document_type: 'dui',
      document_number: null, // sin documento al reservar; se completa luego
      date_of_birth: '2000-01-01',
      gender: 'otro',
      patient_type: 'privado',
      // B2 (s7_43): la ficha la crea el PROPIO paciente al reservar → nace
      // confirmada (no tiene sentido preguntarle "¿es tuya?").
      link_confirmed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    console.error('Error creando paciente:', error)
    return null
  }

  return newPatient?.id || null
}

// cancelBooking se ELIMINÓ en CANCELACIÓN-PACIENTE-P0 (PR-B). No tenía ni un
// solo caller, y desde s7_70 el UPDATE directo del paciente sobre
// appointments está cerrado: la única vía de cancelación del paciente es la
// RPC cancel_my_appointment (ver patientHistory.service.ts).

// ═══════════════════════════════════════════════════════════════════
// AUTH-P1B1B — camino de reserva por INTENT (s7_66). Wrappers tipados.
//
// Superficie tipada de las RPCs register_booking_intent /
// create_booking_with_intent, para consumirla desde la UI en PR B2. NO
// reemplazan todavia el flujo de produccion: createBooking / getOrCreatePatient
// (arriba) siguen siendo la ruta activa. Estos wrappers NO insertan
// directamente en patients ni appointments (toda la escritura la hace la RPC
// SECURITY DEFINER en el servidor), NO mantienen estado global y NO persisten
// el intent. Conservan el SQLSTATE de PostgREST y NO exponen el mensaje interno
// de PostgreSQL. Los textos visibles se definen en PR B2.
// ═══════════════════════════════════════════════════════════════════

/** Categorias estables de error del camino de reserva por intent. */
export type BookingIntentErrorCategory =
  | 'invalid_phone'
  | 'unavailable'
  | 'too_many_requests'
  | 'intent_missing_or_expired'
  | 'already_consumed'
  | 'phone_mismatch'
  | 'availability_changed'
  | 'doctor_or_service_unavailable'
  | 'invalid_name'
  | 'invalid_notes'
  | 'unknown'

/** Mapa SQLSTATE -> categoria. Codigos de s7_66 (docs/OWNER_S7_66_APPLY.md). */
const BOOKING_INTENT_ERROR_CATEGORIES: Readonly<Record<string, BookingIntentErrorCategory>> = {
  P0095: 'invalid_phone',
  P009F: 'unavailable',
  P009B: 'unavailable',
  P0090: 'unavailable',
  P009G: 'too_many_requests',
  P0092: 'intent_missing_or_expired',
  P0094: 'intent_missing_or_expired',
  P0093: 'already_consumed',
  P0096: 'phone_mismatch',
  P0097: 'availability_changed',
  P0098: 'availability_changed',
  P0099: 'availability_changed',
  P009A: 'availability_changed',
  P009C: 'doctor_or_service_unavailable',
  P009D: 'doctor_or_service_unavailable',
  P009E: 'doctor_or_service_unavailable',
  P009H: 'invalid_name',
  P009I: 'invalid_name',
  P009J: 'invalid_notes',
}

/**
 * Clasifica un SQLSTATE de PostgREST en una categoria estable. Cualquier codigo
 * no mapeado (incluido 28000 = sin sesion) cae en 'unknown'.
 */
export function bookingIntentErrorCategory(
  code: string | null | undefined,
): BookingIntentErrorCategory {
  if (code && Object.prototype.hasOwnProperty.call(BOOKING_INTENT_ERROR_CATEGORIES, code)) {
    return BOOKING_INTENT_ERROR_CATEGORIES[code]
  }
  return 'unknown'
}

/** Error de la capa de servicio: SQLSTATE crudo + su categoria. NO incluye el
 *  mensaje interno de PostgreSQL (se omite a proposito). */
export interface BookingIntentError {
  code: string | null
  category: BookingIntentErrorCategory
}

export interface RegisterBookingIntentInput {
  doctorId: string
  serviceId: string
  /**
   * Instante LOCAL sin offset, en el formato de los slots pero recortado al
   * reloj de pared: `YYYY-MM-DDTHH:mm:ss` (sin `Z` ni `-06:00`). El caller
   * (PR B2) es responsable de recortar el offset del `startTime` del slot.
   */
  startLocal: string
  phone: string
}
export interface RegisterBookingIntentData {
  intentId: string
  reused: boolean
}
export type RegisterBookingIntentResult =
  | { ok: true; data: RegisterBookingIntentData }
  | { ok: false; error: BookingIntentError }

export interface CreateBookingWithIntentInput {
  intentId: string
  patientName: string
  notes?: string
}
export interface CreateBookingWithIntentData {
  appointmentId: string
}
export type CreateBookingWithIntentResult =
  | { ok: true; data: CreateBookingWithIntentData }
  | { ok: false; error: BookingIntentError }

/**
 * Registra una intencion de reserva (pre-OTP; anon o authenticated). Llama
 * public.register_booking_intent y devuelve intentId + reused. Idempotente por
 * 5-tupla del lado del servidor. Conserva el SQLSTATE; no expone el mensaje
 * interno; no modifica estado.
 */
export async function registerBookingIntent(
  input: RegisterBookingIntentInput,
): Promise<RegisterBookingIntentResult> {
  const { data, error } = await supabase.rpc('register_booking_intent', {
    p_doctor_id: input.doctorId,
    p_service_id: input.serviceId,
    p_start_local: input.startLocal,
    p_phone: input.phone,
  })
  if (error) {
    return { ok: false, error: { code: error.code ?? null, category: bookingIntentErrorCategory(error.code) } }
  }
  const payload = (data ?? null) as { intent_id?: string; reused?: boolean } | null
  if (!payload?.intent_id) {
    return { ok: false, error: { code: null, category: 'unknown' } }
  }
  return { ok: true, data: { intentId: payload.intent_id, reused: payload.reused === true } }
}

/**
 * Crea la cita a partir de un intent ya emitido (post-OTP; authenticated). Llama
 * public.create_booking_with_intent. Solo recibe intentId / patientName / notes:
 * doctor, clinica, servicio, horario, patientId y telefono los resuelve la RPC
 * server-side (el telefono sale del JWT). Devuelve appointmentId. NO inserta
 * directamente en patients ni appointments. Conserva el SQLSTATE.
 */
export async function createBookingWithIntent(
  input: CreateBookingWithIntentInput,
): Promise<CreateBookingWithIntentResult> {
  const { data, error } = await supabase.rpc('create_booking_with_intent', {
    p_intent_id: input.intentId,
    p_patient_name: input.patientName,
    p_notes: input.notes,
  })
  if (error) {
    return { ok: false, error: { code: error.code ?? null, category: bookingIntentErrorCategory(error.code) } }
  }
  const payload = (data ?? null) as { success?: boolean; appointment_id?: string } | null
  if (!payload?.appointment_id) {
    return { ok: false, error: { code: null, category: 'unknown' } }
  }
  return { ok: true, data: { appointmentId: payload.appointment_id } }
}
