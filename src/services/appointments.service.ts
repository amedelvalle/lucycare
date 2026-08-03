// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/services/appointments.service.ts
// ACCIÓN: NUEVO — crear archivo en carpeta services
// ═══════════════════════════════════════════════════════════

import { supabase } from '@/lib/supabase';
import { logAuditEntry } from '@/services/auditLog.service';
import {
  isWithinDoctorAvailability,
  OUTSIDE_AVAILABILITY_MESSAGE,
  SLOT_TAKEN_MESSAGE,
  isSlotOverlapError,
} from '@/services/availability.service';

// ─── Integridad de agenda: no crear/reprogramar en el pasado ─────────

/** Mensaje único compartido por UI, servicios y trigger de DB. */
export const PAST_APPOINTMENT_MESSAGE =
  'No se puede crear una cita en una fecha u hora pasada.';

export const SUSPENDED_DOCTOR_MESSAGE =
  'Este médico no está disponible en este momento. Intenta más tarde.';

/** true si el médico tiene is_operational=true (apto para agenda/atender). */
export async function isDoctorOperational(doctorId: string): Promise<boolean> {
  const { data } = await supabase
    .from('doctors')
    .select('is_operational')
    .eq('id', doctorId)
    .maybeSingle();
  // Si la columna no existe (DB sin s7_02 todavía), no bloquear.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = (data as any)?.is_operational;
  return v === undefined || v === null || v === true;
}

/**
 * true si `startTimeIso` ya pasó (con 2 min de gracia, igual que el
 * trigger de DB, para no romper walk-ins "para ahora").
 * La comparación es de instantes absolutos → la zona horaria
 * America/El_Salvador queda contemplada sin lógica extra.
 */
export function isPastStart(startTimeIso: string): boolean {
  const start = new Date(startTimeIso).getTime();
  if (Number.isNaN(start)) return false; // fecha inválida: que falle otra validación
  return start < Date.now() - 2 * 60 * 1000;
}

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
  doctor_id: string;
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
  /**
   * Evento de cancelación por el PACIENTE (s7_70). Su sola existencia
   * significa "Cancelada por el paciente en LucyCare". Ausente (null) para
   * cancelaciones del médico o citas no canceladas. Lectura protegida por la
   * policy de la tabla, que espeja la visibilidad de la cita.
   */
  patient_cancellation?: {
    cancelled_at: string;
    reason: string | null;
    note: string | null;
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
      doctor_id,
      start_time,
      end_time,
      source,
      notes,
      price,
      payment_status,
      created_at,
      status:appointment_statuses(id, name, display_name, color, is_final),
      patient:patients(id, full_name, phone, photo_url),
      service:services(id, name, duration_minutes),
      patient_cancellation:appointment_patient_cancellations(cancelled_at, reason, note)
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
      doctor_id,
      start_time,
      end_time,
      source,
      notes,
      price,
      payment_status,
      created_at,
      status:appointment_statuses(id, name, display_name, color, is_final),
      patient:patients(id, full_name, phone, photo_url),
      service:services(id, name, duration_minutes),
      patient_cancellation:appointment_patient_cancellations(cancelled_at, reason, note)
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
  // ─── Guarda de integridad (defensa de servicio; el trigger en DB es el backstop) ───
  // 1. Estado actual + hora de la cita, 2. nombre del estado destino,
  // 3. ¿hay consulta firmada? Bloquea cancelar/cambiar una cita firmada
  //    y valida que la transición esté permitida.
  const { data: aptRow } = await supabase
    .from('appointments')
    .select('start_time, status:appointment_statuses(name)')
    .eq('id', appointmentId)
    .single();

  const { data: targetStatus } = await supabase
    .from('appointment_statuses')
    .select('name')
    .eq('id', statusId)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentName: string | undefined = (aptRow as any)?.status?.name;
  const targetName: string | undefined = targetStatus?.name;

  if (currentName && targetName && currentName !== targetName) {
    const { data: signedCons } = await supabase
      .from('consultations')
      .select('id')
      .eq('appointment_id', appointmentId)
      .eq('status', 'signed')
      .limit(1);

    if (signedCons && signedCons.length > 0 && targetName !== 'atendida') {
      throw new Error(
        targetName === 'cancelada'
          ? 'No se puede cancelar una cita con consulta firmada.'
          : 'No se puede cambiar el estado de una cita con consulta firmada.'
      );
    }

    const check = canTransitionTo(
      currentName,
      targetName,
      (aptRow as { start_time: string }).start_time
    );
    if (!check.allowed) {
      throw new Error(check.reason ?? 'Transición de estado no permitida.');
    }
  }

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

// ─── Edición de cita ─────────────────────────────────────────────────

export const APPOINTMENT_LOCKED_MESSAGE =
  'Esta cita ya no puede modificarse por su estado actual.';

const LOCKED_STATES = ['atendida', 'cancelada', 'no_asistio'];

export interface UpdateAppointmentInput {
  startTime?: string; // ISO
  endTime?: string; // ISO (requerido si cambia startTime)
  serviceId?: string | null;
  notes?: string | null; // internal_notes
  price?: number | null;
  patientId?: string;
}

/**
 * Edita una cita existente con todas las guardas de integridad.
 * Defensa final en DB (triggers s6_03/s6_04/s6_10); esto da mensajes
 * claros y bloquea antes de pegarle a la base.
 *
 * Reglas:
 * - atendida/cancelada/no_asistio o consulta firmada → no editable.
 * - en_sala → solo ajustes menores (notas/precio), no reprogramación.
 * - programada/confirmada → edición completa.
 * - No pasado, dentro de disponibilidad, sin choque de horario.
 * - Cambio de paciente solo si no hay consulta (iniciada ni firmada).
 */
export async function updateAppointment(
  appointmentId: string,
  input: UpdateAppointmentInput
): Promise<void> {
  const { data: appt, error: fetchErr } = await supabase
    .from('appointments')
    .select(
      'id, doctor_id, start_time, end_time, patient_id, status:appointment_statuses(name)'
    )
    .eq('id', appointmentId)
    .single();
  if (fetchErr) throw fetchErr;
  if (!appt) throw new Error('Cita no encontrada.');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statusName: string | undefined = (appt as any).status?.name;

  // ¿Consulta iniciada o firmada?
  const { data: cons } = await supabase
    .from('consultations')
    .select('id, status')
    .eq('appointment_id', appointmentId);
  const hasConsultation = (cons ?? []).length > 0;
  const hasSigned = (cons ?? []).some((c) => c.status === 'signed');

  if (statusName && LOCKED_STATES.includes(statusName)) {
    throw new Error(APPOINTMENT_LOCKED_MESSAGE);
  }
  if (hasSigned) {
    throw new Error(APPOINTMENT_LOCKED_MESSAGE);
  }

  const wantsStartChange =
    input.startTime !== undefined &&
    input.startTime !== (appt as { start_time: string }).start_time;
  const wantsServiceChange = input.serviceId !== undefined;
  const wantsPatientChange =
    input.patientId !== undefined &&
    input.patientId !== (appt as { patient_id: string }).patient_id;

  // En sala: solo ajustes administrativos menores (notas/precio)
  if (statusName === 'en_sala' && (wantsStartChange || wantsServiceChange || wantsPatientChange)) {
    throw new Error(
      'La cita está en sala: solo se permiten ajustes menores (notas, precio), no reprogramación.'
    );
  }

  // Cambio de paciente solo si no hay consulta
  if (wantsPatientChange && hasConsultation) {
    throw new Error(
      'No se puede cambiar el paciente: la cita ya tiene una consulta.'
    );
  }

  // Validaciones de horario si se mueve la cita
  if (wantsStartChange) {
    const newStart = input.startTime as string;
    const newEnd =
      input.endTime ?? (appt as { end_time: string }).end_time;

    if (isPastStart(newStart)) {
      throw new Error(PAST_APPOINTMENT_MESSAGE);
    }
    const ok = await isWithinDoctorAvailability(
      (appt as { doctor_id: string }).doctor_id,
      newStart,
      newEnd
    );
    if (!ok) {
      throw new Error(OUTSIDE_AVAILABILITY_MESSAGE);
    }

    // Choque con otra cita activa del mismo médico (excluye esta)
    const { data: cancelledStatuses } = await supabase
      .from('appointment_statuses')
      .select('id')
      .in('name', ['cancelada', 'no_asistio']);
    const excluded = (cancelledStatuses ?? []).map((s) => s.id);

    const { data: overlapping } = await supabase
      .from('appointments')
      .select('id, status_id')
      .eq('doctor_id', (appt as { doctor_id: string }).doctor_id)
      .neq('id', appointmentId)
      .lt('start_time', newEnd)
      .gt('end_time', newStart);

    const conflict = (overlapping ?? []).some(
      (a) => !excluded.includes(a.status_id)
    );
    if (conflict) {
      throw new Error('Ya existe una cita activa en ese horario. Elegí otra hora.');
    }
  }

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.startTime !== undefined) payload.start_time = input.startTime;
  if (input.endTime !== undefined) payload.end_time = input.endTime;
  if (input.serviceId !== undefined) payload.service_id = input.serviceId || null;
  if (input.notes !== undefined) payload.notes = input.notes?.trim() || null;
  if (input.price !== undefined) payload.price = input.price;
  if (input.patientId !== undefined) payload.patient_id = input.patientId;

  const { error } = await supabase
    .from('appointments')
    .update(payload)
    .eq('id', appointmentId);
  if (error) {
    // Doble reserva bloqueada por la DB (trigger s7_55 / P0090) → mensaje amable.
    if (isSlotOverlapError(error)) throw new Error(SLOT_TAKEN_MESSAGE);
    throw new Error(error.message);
  }

  await logAuditEntry({
    action: 'update',
    tableName: 'appointments',
    recordId: appointmentId,
    newData: payload,
  });
}

/** ¿La cita admite edición desde la UI según su estado? */
export function isAppointmentEditable(statusName: string | undefined): {
  editable: boolean;
  minorOnly: boolean;
} {
  if (!statusName) return { editable: false, minorOnly: false };
  if (statusName === 'en_sala') return { editable: true, minorOnly: true };
  if (statusName === 'programada' || statusName === 'confirmada')
    return { editable: true, minorOnly: false };
  return { editable: false, minorOnly: false };
}
