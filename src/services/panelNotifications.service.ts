/**
 * Notificaciones del panel del médico — derivadas del feed de citas.
 *
 * NO usa la tabla `notifications` (que es para SMS/email salientes a pacientes).
 * Aquí computamos eventos relevantes para el doctor desde appointments:
 *  - new_booking: cita creada con source='lucy_directorio' (paciente reservó),
 *    fechada por `created_at`.
 *  - cancellation: cita en estado 'cancelada' (status_id → appointment_statuses)
 *    actualizada en las últimas 24h. `appointments` no tiene timestamp de
 *    cancelación, así que se usa `updated_at` como aproximación operativa.
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
  /** Cuándo ocurrió el evento (created_at de la reserva o updated_at de la cancelación) — usado para read/unread */
  eventAt: string;
}

const HOURS_24_MS = 24 * 60 * 60 * 1000;

interface RawAppointment {
  id: string;
  start_time: string;
  created_at: string;
  updated_at: string;
  status_id: string;
  source: string;
  patient: { id: string; full_name: string } | null;
}

/** Nombre del estado que representa una cita cancelada (ver `appointment_statuses`). */
const CANCELLED_STATUS_NAME = 'cancelada';

export async function getRecentPanelNotifications(
  doctorId: string
): Promise<PanelNotification[]> {
  const since = new Date(Date.now() - HOURS_24_MS).toISOString();
  const SELECT =
    'id, start_time, created_at, updated_at, status_id, source, patient:patients(id, full_name)';

  // 1. Reservas desde el directorio público (últimas 24h)
  const { data: bookings, error: bErr } = await supabase
    .from('appointments')
    .select(SELECT)
    .eq('doctor_id', doctorId)
    .eq('source', 'lucy_directorio')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20);
  if (bErr) throw bErr;

  // 2. Cancelaciones recientes. `appointments` NO tiene una columna de
  // timestamp de cancelación: el estado vive en `status_id`
  // (→ appointment_statuses.name = 'cancelada') y el único timestamp
  // disponible es `updated_at`. Resolvemos el id del estado y filtramos por él,
  // usando `updated_at` como timestamp operativo del evento — aproximado: una
  // edición posterior puede moverlo, suficiente para un feed de 24h.
  const { data: cancelledStatuses, error: sErr } = await supabase
    .from('appointment_statuses')
    .select('id')
    .eq('name', CANCELLED_STATUS_NAME);
  if (sErr) throw sErr;
  const cancelledIds = (cancelledStatuses ?? []).map((s) => s.id);

  let cancels: unknown[] = [];
  if (cancelledIds.length > 0) {
    const { data, error: cErr } = await supabase
      .from('appointments')
      .select(SELECT)
      .eq('doctor_id', doctorId)
      .in('status_id', cancelledIds)
      .gte('updated_at', since)
      .order('updated_at', { ascending: false })
      .limit(20);
    if (cErr) throw cErr;
    cancels = data ?? [];
  }

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

  for (const apt of cancels as unknown as RawAppointment[]) {
    if (!apt.patient) continue;
    items.push({
      id: `cancel-${apt.id}`,
      type: 'cancellation',
      appointmentId: apt.id,
      patientId: apt.patient.id,
      patientName: apt.patient.full_name,
      appointmentStartTime: apt.start_time,
      eventAt: apt.updated_at,
    });
  }

  // Ordenar por evento más reciente primero
  items.sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime());

  // Top 25
  return items.slice(0, 25);
}
