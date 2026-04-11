/**
 * Servicio de disponibilidad — CRUD de availability_rules y overrides.
 */

import { supabase } from '../lib/supabase'

export interface AvailabilityRule {
  id: string
  doctorId: string
  clinicId: string
  dayOfWeek: number
  startTime: string
  endTime: string
  slotDurationMin: number
  isActive: boolean
}

export interface AvailabilityOverride {
  id: string
  doctorId: string
  dateStart: string
  dateEnd: string
  timeStart: string | null
  timeEnd: string | null
  isBlocked: boolean
  description: string | null
}

/**
 * Obtiene las reglas de disponibilidad del doctor autenticado.
 */
export async function getMyAvailabilityRules(): Promise<AvailabilityRule[]> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return []

  // Obtener doctor_id del usuario
  const { data: doctor } = await supabase
    .from('doctors')
    .select('id, clinic_id')
    .eq('profile_id', session.user.id)
    .single()

  if (!doctor) return []

  const { data: rules } = await supabase
    .from('availability_rules')
    .select('*')
    .eq('doctor_id', doctor.id)
    .order('day_of_week')
    .order('start_time')

  return (rules || []).map(r => ({
    id: r.id,
    doctorId: r.doctor_id,
    clinicId: r.clinic_id,
    dayOfWeek: r.day_of_week,
    startTime: r.start_time,
    endTime: r.end_time,
    slotDurationMin: r.slot_duration_min,
    isActive: r.is_active,
  }))
}

/**
 * Guarda las reglas de disponibilidad completas (reemplaza todas).
 */
export async function saveAvailabilityRules(
  rules: { dayOfWeek: number; startTime: string; endTime: string; slotDuration: number }[]
): Promise<{ success: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return { success: false, error: 'No autenticado' }

  const { data: doctor } = await supabase
    .from('doctors')
    .select('id, clinic_id')
    .eq('profile_id', session.user.id)
    .single()

  if (!doctor) return { success: false, error: 'Perfil de médico no encontrado' }

  // Borrar reglas existentes
  const { error: deleteError } = await supabase
    .from('availability_rules')
    .delete()
    .eq('doctor_id', doctor.id)

  if (deleteError) {
    console.error('Error borrando reglas:', deleteError)
    return { success: false, error: 'Error al actualizar disponibilidad' }
  }

  // Insertar nuevas reglas
  if (rules.length > 0) {
    const inserts = rules.map(r => ({
      doctor_id: doctor.id,
      clinic_id: doctor.clinic_id,
      day_of_week: r.dayOfWeek,
      start_time: r.startTime,
      end_time: r.endTime,
      slot_duration_min: r.slotDuration,
      is_active: true,
    }))

    const { error: insertError } = await supabase
      .from('availability_rules')
      .insert(inserts)

    if (insertError) {
      console.error('Error insertando reglas:', insertError)
      return { success: false, error: 'Error al guardar disponibilidad' }
    }
  }

  return { success: true }
}

/**
 * Obtiene los bloqueos futuros del doctor.
 */
export async function getMyOverrides(): Promise<AvailabilityOverride[]> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return []

  const { data: doctor } = await supabase
    .from('doctors')
    .select('id')
    .eq('profile_id', session.user.id)
    .single()

  if (!doctor) return []

  const today = new Date().toISOString().split('T')[0]

  const { data: overrides } = await supabase
    .from('availability_overrides')
    .select('*')
    .eq('doctor_id', doctor.id)
    .gte('date_end', today)
    .order('date_start')

  return (overrides || []).map(o => ({
    id: o.id,
    doctorId: o.doctor_id,
    dateStart: o.date_start,
    dateEnd: o.date_end,
    timeStart: o.time_start,
    timeEnd: o.time_end,
    isBlocked: o.is_blocked,
    description: o.description,
  }))
}

/**
 * Crea un bloqueo (vacaciones, día libre, etc.)
 */
export async function createOverride(data: {
  dateStart: string
  dateEnd: string
  timeStart?: string
  timeEnd?: string
  description?: string
  blockTypeId?: string
}): Promise<{ success: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return { success: false, error: 'No autenticado' }

  const { data: doctor } = await supabase
    .from('doctors')
    .select('id, clinic_id')
    .eq('profile_id', session.user.id)
    .single()

  if (!doctor) return { success: false, error: 'Perfil no encontrado' }

  const { error } = await supabase
    .from('availability_overrides')
    .insert({
      doctor_id: doctor.id,
      clinic_id: doctor.clinic_id,
      date_start: data.dateStart,
      date_end: data.dateEnd,
      time_start: data.timeStart || null,
      time_end: data.timeEnd || null,
      is_blocked: true,
      description: data.description || null,
      block_type_id: data.blockTypeId || null,
      created_by: session.user.id,
    })

  if (error) {
    console.error('Error creando bloqueo:', error)
    return { success: false, error: 'Error al crear bloqueo' }
  }

  return { success: true }
}

/**
 * Elimina un bloqueo.
 */
export async function deleteOverride(overrideId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('availability_overrides')
    .delete()
    .eq('id', overrideId)

  if (error) return { success: false, error: 'Error al eliminar' }
  return { success: true }
}
