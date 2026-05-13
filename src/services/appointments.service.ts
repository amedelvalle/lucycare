// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/services/appointments.service.ts
// ACCIÓN: NUEVO — crear archivo en carpeta services
// ═══════════════════════════════════════════════════════════

import { supabase } from '@/lib/supabase';
import { logAuditEntry } from '@/services/auditLog.service';

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

// ─── Transiciones válidas por nombre de estado ────────────────────────
const VALID_TRANSITIONS: Record<string, string[]> = {
  programada:  ['confirmada', 'cancelada'],
  confirmada:  ['en_sala', 'cancelada'],
  en_sala:     ['atendida', 'no_asistio', 'cancelada'],
};

/**
 * Valida si una transición de estado es permitida.
 * Aplica reglas de tiempo solo en casos extremos.
 */
export function canTransitionTo(
  currentStatusName: string,
  targetStatusName: string,
  appointmentStartTime: string
): { allowed: boolean; reason?: string } {
  const validNext = VALID_TRANSITIONS[currentStatusName] ?? [];
  if (!validNext.includes(targetStatusName)) {
    return { allowed: false, reason: 'Transición no permitida desde el estado actual.' };
  }

  const now = new Date();
  const startTime = new Date(appointmentStartTime);

  if (targetStatusName === 'atendida') {
    const hoursUntil = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursUntil > 24) {
      return {
        allowed: false,
        reason: 'No se puede marcar como atendida con más de 24 horas de anticipación.',
      };
    }
  }

  if (targetStatusName === 'no_asistio' && now < startTime) {
    return {
      allowed: false,
      reason: 'No se puede marcar como no asistió antes de la hora de la cita.',
    };
  }

  return { allowed: true };
}

// ─── Catálogo de razones de cancelación ──────────────────────────────

export type CancelReasonCategory = 'paciente' | 'medico' | 'sistema';

export interface CancelReason {
  id: string;
  name: string;
  category: CancelReasonCategory;
  is_active: boolean;
}

/**
 * Obtiene las razones de cancelación activas, ordenadas por categoría y nombre.
 * Usado por el modal de cancelación.
 */
export async function getCancelReasons(): Promise<CancelReason[]> {
  const { data, error } = await supabase
    .from('cancel_reasons')
    .select('id, name, category, is_active')
    .eq('is_active', true)
    .order('category')
    .order('name');

  if (error) throw error;
  return (data ?? []) as CancelReason[];
}

/**
 * Cambia el estado de una cita. Si la nueva razón de cancelación se pasa,
 * también guarda `cancel_reason_id` y opcionalmente `internal_notes`.
 *
 * Schema correcto (verificado contra DB):
 *   - cancel_reason_id (FK a cancel_reasons)
 *   - internal_notes (texto libre, para detalle adicional del doctor)
 */
export async function updateAppointmentStatus(
  appointmentId: string,
  statusId: string,
  options?: {
    cancelReasonId?: string;
    internalNotes?: string;
    oldStatusName?: string;
    newStatusName?: string;
  }
): Promise<void> {
  const updatePayload: Record<string, unknown> = {
    status_id: statusId,
    updated_at: new Date().toISOString(),
  };

  if (options?.cancelReasonId) {
    updatePayload.cancel_reason_id = options.cancelReasonId;
  }
  if (options?.internalNotes !== undefined) {
    updatePayload.internal_notes = options.internalNotes?.trim() || null;
  }

  const { error } = await supabase
    .from('appointments')
    .update(updatePayload)
    .eq('id', appointmentId);

  if (error) throw error;

  await logAuditEntry({
    action: 'update',
    tableName: 'appointments',
    recordId: appointmentId,
    oldData: options?.oldStatusName ? { status: options.oldStatusName } : undefined,
    newData: {
      status: options?.newStatusName,
      ...(options?.cancelReasonId
        ? { cancel_reason_id: options.cancelReasonId }
        : {}),
      ...(options?.internalNotes
        ? { internal_notes: options.internalNotes }
        : {}),
    },
  });
}
