// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/services/appointments.service.ts
// ACCIÓN: NUEVO — crear archivo en carpeta services
// ═══════════════════════════════════════════════════════════

import { supabase } from '@/lib/supabase';

// ─── Tipos ───────────────────────────────────────────────────────────

export interface AppointmentStatus {
  id: string;
  name: string;
  display_name: string;
  color: string;
  is_final: boolean;
}

export interface AppointmentListItem {
  id: string;
  start_time: string;
  end_time: string;
  source: string;
  notes: string | null;
  price: number | null;
  payment_status: string;
  created_at: string;
  status: AppointmentStatus;
  patient: {
    id: string;
    full_name: string;
    phone: string | null;
    photo_url: string | null;
  };
  service: {
    id: string;
    name: string;
    duration_minutes: number;
  } | null;
}

export interface AppointmentStats {
  total: number;
  byStatus: Record<string, number>;
}

// ─── Funciones ───────────────────────────────────────────────────────

/**
 * Obtener citas de un doctor para una fecha específica.
 * Trae paciente, servicio y estado con color.
 */
export async function getAppointmentsByDate(
  doctorId: string,
  date: string // 'YYYY-MM-DD'
): Promise<AppointmentListItem[]> {
  const dayStart = `${date}T00:00:00`;
  const dayEnd = `${date}T23:59:59`;

  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id,
      start_time,
      end_time,
      source,
      notes,
      price,
      payment_status,
      created_at,
      status:appointment_statuses(id, name, display_name, color, is_final),
      patient:patients(id, full_name, phone, photo_url),
      service:services(id, name, duration_minutes)
    `)
    .eq('doctor_id', doctorId)
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd)
    .order('start_time', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as AppointmentListItem[];
}

/**
 * Obtener citas de un doctor para un rango de fechas.
 */
export async function getAppointmentsByRange(
  doctorId: string,
  dateFrom: string,
  dateTo: string
): Promise<AppointmentListItem[]> {
  const rangeStart = `${dateFrom}T00:00:00`;
  const rangeEnd = `${dateTo}T23:59:59`;

  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id,
      start_time,
      end_time,
      source,
      notes,
      price,
      payment_status,
      created_at,
      status:appointment_statuses(id, name, display_name, color, is_final),
      patient:patients(id, full_name, phone, photo_url),
      service:services(id, name, duration_minutes)
    `)
    .eq('doctor_id', doctorId)
    .gte('start_time', rangeStart)
    .lte('start_time', rangeEnd)
    .order('start_time', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as AppointmentListItem[];
}

/**
 * Obtener todos los estados de cita (catálogo)
 */
export async function getAppointmentStatuses(): Promise<AppointmentStatus[]> {
  const { data, error } = await supabase
    .from('appointment_statuses')
    .select('id, name, display_name, color, is_final')
    .order('funnel_order', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Cambiar el estado de una cita.
 * Validación de transiciones se hará en Sprint 3.
 * Por ahora solo actualiza el status_id.
 */
export async function updateAppointmentStatus(
  appointmentId: string,
  statusId: string
): Promise<void> {
  const { error } = await supabase
    .from('appointments')
    .update({
      status_id: statusId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', appointmentId);

  if (error) throw error;
}
