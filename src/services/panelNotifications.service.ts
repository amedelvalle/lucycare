/**
 * Notificaciones del panel del médico — derivadas del feed de citas.
 *
 * NO usa la tabla `notifications` (que es para SMS/email salientes a pacientes).
 * Aquí computamos eventos relevantes para el doctor desde appointments:
 *  - new_booking: cita creada con source='lucy_directorio' (paciente reservó)
 *  - cancellation: cita cancelada en las últimas 24h
 *
 * El estado de leído/no leído se maneja con un timestamp en localStorage
 * (ver usePanelNotifications.ts) — no requiere cambios de schema.
 */

import { supabase } from '@/lib/supabase';

export type PanelNotificationType = 'new_booking' | 'cancellation';

export interface PanelNotification {
  id: string;
  type: PanelNotificationType;
  appointmentId: string;
  patientId: string;
  patientName: string;
  appointmentStartTime: string;
  /** Cuándo ocurrió el evento (created_at o cancelled_at) — usado para read/unread */
  eventAt: string;
}

const HOURS_24_MS = 24 * 60 * 60 * 1000;

interface RawAppointment {
  id: string;
  start_time: string;
  created_at: string;
  cancelled_at: string | null;
  source: string;
  patient: { id: string; full_name: string } | null;
}

export async function getRecentPanelNotifications(
  doctorId: string
): Promise<PanelNotification[]> {
  const since = new Date(Date.now() - HOURS_24_MS).toISOString();

  // 1. Reservas desde el directorio público (últimas 24h)
  const { data: bookings, error: bErr } = await supabase
    .from('appointments')
    .select('id, start_time, created_at, cancelled_at, source, patient:patients(id, full_name)')
    .eq('doctor_id', doctorId)
    .eq('source', 'lucy_directorio')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20);
  if (bErr) throw bErr;

  // 2. Cancelaciones recientes
  const { data: cancels, error: cErr } = await supabase
    .from('appointments')
    .select('id, start_time, created_at, cancelled_at, source, patient:patients(id, full_name)')
    .eq('doctor_id', doctorId)
    .gte('cancelled_at', since)
    .order('cancelled_at', { ascending: false })
    .limit(20);
  if (cErr) throw cErr;

  const items: PanelNotification[] = [];

  for (const apt of (bookings ?? []) as unknown as RawAppointment[]) {
    if (!apt.patient) continue;
    items.push({
      id: `booking-${apt.id}`,
      type: 'new_booking',
      appointmentId: apt.id,
      patientId: apt.patient.id,
      patientName: apt.patient.full_name,
      appointmentStartTime: apt.start_time,
      eventAt: apt.created_at,
    });
  }

  for (const apt of (cancels ?? []) as unknown as RawAppointment[]) {
    if (!apt.patient || !apt.cancelled_at) continue;
    items.push({
      id: `cancel-${apt.id}`,
      type: 'cancellation',
      appointmentId: apt.id,
      patientId: apt.patient.id,
      patientName: apt.patient.full_name,
      appointmentStartTime: apt.start_time,
      eventAt: apt.cancelled_at,
    });
  }

  // Ordenar por evento más reciente primero
  items.sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime());

  // Top 25
  return items.slice(0, 25);
}
