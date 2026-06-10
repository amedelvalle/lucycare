/**
 * Servicio del Dashboard — S3-07
 * Queries para la página de inicio del panel médico.
 *
 * ACCIÓN: CREAR este archivo nuevo
 * RUTA:   src/services/dashboard.service.ts
 */

import { supabase } from '../lib/supabase'

// ── Tipos ──

export interface DashboardStats {
  citasHoy: number
  citasSemana: number
  pacientesNuevos: number
  tasaAsistencia: number
}

export interface AppointmentSummary {
  id: string
  start_time: string
  end_time: string
  source: string
  status: {
    id: string
    name: string
    display_name: string
    color: string
  }
  patient: {
    id: string
    full_name: string
    phone: string | null
    photo_url: string | null
  }
  service: {
    id: string
    name: string
    duration_minutes: number
  } | null
}

// ── Helpers de fecha ──

function startOfDay(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString()
}

function endOfDay(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).toISOString()
}

function startOfWeek(date: Date): string {
  const d = new Date(date)
  const day = d.getDay() // 0=dom
  const diff = day === 0 ? -6 : 1 - day // retroceder al lunes
  d.setDate(d.getDate() + diff)
  return startOfDay(d)
}

function endOfWeek(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 0 : 7 - day // avanzar al domingo
  d.setDate(d.getDate() + diff)
  return endOfDay(d)
}

// ── Queries ──

/**
 * Obtener doctor_id y clinic_id del usuario autenticado.
 *
 * @deprecated Sin callers desde Identidad múltiple Fase 1: asumía que el
 * logueado SIEMPRE tiene fila en `doctors` (falso para asistentes → reventaba
 * el home del panel). Usar `useClinicContext` (resuelve doctor propio o doctor
 * activo del asistente). No importar desde código nuevo.
 */
export async function getDoctorByProfile(profileId: string) {
  const { data, error } = await supabase
    .from('doctors')
    .select('id, clinic_id, profile_id')
    .eq('profile_id', profileId)
    .single()

  if (error) throw new Error('No se encontró perfil de doctor: ' + error.message)
  return data
}

/**
 * Citas de hoy, ordenadas por hora.
 */
export async function getTodayAppointments(doctorId: string): Promise<AppointmentSummary[]> {
  const now = new Date()

  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id,
      start_time,
      end_time,
      source,
      status:appointment_statuses!inner ( id, name, display_name, color ),
      patient:patients!inner ( id, full_name, phone, photo_url ),
      service:services ( id, name, duration_minutes )
    `)
    .eq('doctor_id', doctorId)
    .gte('start_time', startOfDay(now))
    .lte('start_time', endOfDay(now))
    .order('start_time', { ascending: true })

  if (error) {
    console.error('Error cargando citas de hoy:', error)
    throw error
  }

  return (data || []) as unknown as AppointmentSummary[]
}

/**
 * Citas de las próximas 48 horas (excluyendo hoy).
 */
export async function getUpcomingAppointments(doctorId: string): Promise<AppointmentSummary[]> {
  const now = new Date()

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const dayAfter = new Date(now)
  dayAfter.setDate(dayAfter.getDate() + 2)

  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id,
      start_time,
      end_time,
      source,
      status:appointment_statuses!inner ( id, name, display_name, color ),
      patient:patients!inner ( id, full_name, phone, photo_url ),
      service:services ( id, name, duration_minutes )
    `)
    .eq('doctor_id', doctorId)
    .gte('start_time', startOfDay(tomorrow))
    .lte('start_time', endOfDay(dayAfter))
    .order('start_time', { ascending: true })

  if (error) {
    console.error('Error cargando citas próximas:', error)
    throw error
  }

  return (data || []) as unknown as AppointmentSummary[]
}

/**
 * Métricas resumen del dashboard.
 */
export async function getWeeklyStats(doctorId: string, clinicId: string): Promise<DashboardStats> {
  const now = new Date()
  const dayStart = startOfDay(now)
  const dayEnd = endOfDay(now)
  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)

  // ─── Citas de hoy (filtramos canceladas en cliente) ───
  const { data: todayAll } = await supabase
    .from('appointments')
    .select('id, status:appointment_statuses!inner ( name )')
    .eq('doctor_id', doctorId)
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd)

  const citasHoy = (todayAll || []).filter(
    (a: any) => a.status?.name !== 'cancelada'
  ).length

  // ─── Citas de la semana ───
  const { count: citasSemana } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('doctor_id', doctorId)
    .gte('start_time', weekStart)
    .lte('start_time', weekEnd)

  // ─── Pacientes nuevos esta semana ───
  const { count: pacientesNuevos } = await supabase
    .from('patients')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .gte('created_at', weekStart)
    .lte('created_at', weekEnd)

  // ─── Tasa de asistencia (últimas 4 semanas) ───
  const fourWeeksAgo = new Date(now)
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28)

  const { data: finished } = await supabase
    .from('appointments')
    .select('id, status:appointment_statuses!inner ( name )')
    .eq('doctor_id', doctorId)
    .gte('start_time', fourWeeksAgo.toISOString())
    .lte('start_time', now.toISOString())

  let tasaAsistencia = 100
  if (finished && finished.length > 0) {
    const finalized = finished.filter(
      (a: any) => a.status?.name === 'atendida' || a.status?.name === 'no_asistio'
    )
    const atendidas = finalized.filter((a: any) => a.status?.name === 'atendida').length
    tasaAsistencia = finalized.length > 0
      ? Math.round((atendidas / finalized.length) * 100)
      : 100
  }

  return {
    citasHoy,
    citasSemana: citasSemana || 0,
    pacientesNuevos: pacientesNuevos || 0,
    tasaAsistencia,
  }
}
