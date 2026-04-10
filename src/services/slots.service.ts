/**
 * Servicio de Slots — calcula disponibilidad real de un doctor para una fecha.
 * 
 * Algoritmo:
 * 1. Obtener availability_rules para el day_of_week de la fecha
 * 2. Generar todos los slots posibles (cada slot_duration_min minutos)
 * 3. Restar availability_overrides que bloqueen esa fecha
 * 4. Restar appointments existentes que ocupen esos slots
 * 5. Filtrar slots que ya pasaron (si la fecha es hoy)
 * 
 * Supuesto: El cálculo se hace client-side. Se puede migrar a Edge Function
 * si se necesita más seguridad o rendimiento.
 * 
 * Timezone: America/El_Salvador (UTC-6)
 */

import { supabase } from '../lib/supabase'

export interface TimeSlot {
  startTime: string    // ISO string: 2026-04-10T09:00:00-06:00
  endTime: string      // ISO string: 2026-04-10T09:30:00-06:00
  displayTime: string  // "9:00 AM"
  available: boolean
}

export interface DayAvailability {
  date: string         // YYYY-MM-DD
  dayOfWeek: number    // 0-6
  slots: TimeSlot[]
  isBlocked: boolean   // true si todo el día está bloqueado
  blockReason?: string
}

/**
 * Obtiene los slots disponibles de un doctor para una fecha específica.
 */
export async function getAvailableSlots(
  doctorId: string,
  date: string // YYYY-MM-DD
): Promise<DayAvailability> {
  const dateObj = new Date(date + 'T00:00:00')
  const dayOfWeek = dateObj.getDay() // 0=domingo, 1=lunes...

  // ─── 1. Obtener reglas de disponibilidad para este día ───
  const { data: rules } = await supabase
    .from('availability_rules')
    .select('*')
    .eq('doctor_id', doctorId)
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true)

  if (!rules || rules.length === 0) {
    return {
      date,
      dayOfWeek,
      slots: [],
      isBlocked: false,
    }
  }

  // ─── 2. Verificar bloqueos (overrides) para esta fecha ───
  const { data: overrides } = await supabase
    .from('availability_overrides')
    .select('*')
    .eq('doctor_id', doctorId)
    .lte('date_start', date)
    .gte('date_end', date)

  // Verificar si todo el día está bloqueado
  const fullDayBlock = (overrides || []).find(
    o => o.is_blocked && !o.time_start && !o.time_end
  )

  if (fullDayBlock) {
    return {
      date,
      dayOfWeek,
      slots: [],
      isBlocked: true,
      blockReason: fullDayBlock.description || 'Día bloqueado',
    }
  }

  // ─── 3. Obtener citas existentes para este día ───
  const dayStart = `${date}T00:00:00`
  const dayEnd = `${date}T23:59:59`

  const { data: appointments } = await supabase
    .from('appointments')
    .select('start_time, end_time, status_id')
    .eq('doctor_id', doctorId)
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd)

  // Filtrar solo citas activas (no canceladas)
  // Necesitamos los IDs de estados cancelados para excluirlos
  const { data: cancelledStatuses } = await supabase
    .from('appointment_statuses')
    .select('id')
    .eq('is_final', true)
    .in('name', ['cancelada'])

  const cancelledIds = (cancelledStatuses || []).map(s => s.id)
  const activeAppointments = (appointments || []).filter(
    a => !cancelledIds.includes(a.status_id)
  )

  // ─── 4. Generar slots y marcar disponibilidad ───
  const allSlots: TimeSlot[] = []
  const now = new Date()

  for (const rule of rules) {
    const slotDuration = rule.slot_duration_min || 30
    const slots = generateSlots(
      date,
      rule.start_time,
      rule.end_time,
      slotDuration
    )

    for (const slot of slots) {
      // Verificar si el slot está bloqueado por un override parcial
      const isBlockedByOverride = (overrides || []).some(o => {
        if (!o.is_blocked) return false
        if (!o.time_start || !o.time_end) return false
        return isTimeOverlap(
          slot.startTime,
          slot.endTime,
          `${date}T${o.time_start}`,
          `${date}T${o.time_end}`
        )
      })

      // Verificar si el slot ya está ocupado por una cita
      const isOccupied = activeAppointments.some(a =>
        isTimeOverlap(slot.startTime, slot.endTime, a.start_time, a.end_time)
      )

      // Verificar si el slot ya pasó (si es hoy)
      const slotStart = new Date(slot.startTime)
      const isPast = slotStart <= now

      allSlots.push({
        ...slot,
        available: !isBlockedByOverride && !isOccupied && !isPast,
      })
    }
  }

  return {
    date,
    dayOfWeek,
    slots: allSlots,
    isBlocked: false,
  }
}

/**
 * Obtiene los próximos N días con disponibilidad para un doctor.
 * Útil para mostrar un calendario con días habilitados/deshabilitados.
 */
export async function getAvailableDays(
  doctorId: string,
  daysAhead: number = 30
): Promise<{ date: string; hasSlots: boolean }[]> {
  // Obtener las reglas para saber qué días de la semana trabaja
  const { data: rules } = await supabase
    .from('availability_rules')
    .select('day_of_week')
    .eq('doctor_id', doctorId)
    .eq('is_active', true)

  const workingDays = new Set((rules || []).map(r => r.day_of_week))

  // Obtener bloqueos futuros
  const today = new Date().toISOString().split('T')[0]
  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + daysAhead)
  const futureStr = futureDate.toISOString().split('T')[0]

  const { data: overrides } = await supabase
    .from('availability_overrides')
    .select('date_start, date_end, is_blocked, time_start, time_end')
    .eq('doctor_id', doctorId)
    .eq('is_blocked', true)
    .gte('date_end', today)
    .lte('date_start', futureStr)

  const result: { date: string; hasSlots: boolean }[] = []
  const currentDate = new Date()

  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(currentDate)
    d.setDate(d.getDate() + i)
    const dateStr = d.toISOString().split('T')[0]
    const dayOfWeek = d.getDay()

    // ¿Trabaja este día de la semana?
    if (!workingDays.has(dayOfWeek)) {
      result.push({ date: dateStr, hasSlots: false })
      continue
    }

    // ¿Está bloqueado todo el día?
    const isFullBlocked = (overrides || []).some(o =>
      o.is_blocked &&
      !o.time_start &&
      !o.time_end &&
      dateStr >= o.date_start &&
      dateStr <= o.date_end
    )

    result.push({ date: dateStr, hasSlots: !isFullBlocked })
  }

  return result
}

// ─── UTILIDADES ───

function generateSlots(
  date: string,
  startTime: string,  // HH:MM:SS
  endTime: string,    // HH:MM:SS
  durationMin: number
): Pick<TimeSlot, 'startTime' | 'endTime' | 'displayTime'>[] {
  const slots: Pick<TimeSlot, 'startTime' | 'endTime' | 'displayTime'>[] = []

  const [startH, startM] = startTime.split(':').map(Number)
  const [endH, endM] = endTime.split(':').map(Number)

  let currentMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  while (currentMinutes + durationMin <= endMinutes) {
    const slotStartH = Math.floor(currentMinutes / 60)
    const slotStartM = currentMinutes % 60
    const slotEndMinutes = currentMinutes + durationMin
    const slotEndH = Math.floor(slotEndMinutes / 60)
    const slotEndM = slotEndMinutes % 60

    const startISO = `${date}T${pad(slotStartH)}:${pad(slotStartM)}:00`
    const endISO = `${date}T${pad(slotEndH)}:${pad(slotEndM)}:00`

    slots.push({
      startTime: startISO,
      endTime: endISO,
      displayTime: formatTime12h(slotStartH, slotStartM),
    })

    currentMinutes += durationMin
  }

  return slots
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function formatTime12h(hours: number, minutes: number): string {
  const period = hours >= 12 ? 'PM' : 'AM'
  const h12 = hours % 12 || 12
  return `${h12}:${pad(minutes)} ${period}`
}

function isTimeOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  const s1 = new Date(start1).getTime()
  const e1 = new Date(end1).getTime()
  const s2 = new Date(start2).getTime()
  const e2 = new Date(end2).getTime()
  return s1 < e2 && s2 < e1
}
