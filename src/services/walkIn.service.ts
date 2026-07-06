import { supabase } from '@/lib/supabase';
import { logAuditEntry } from '@/services/auditLog.service';
import {
  isPastStart,
  PAST_APPOINTMENT_MESSAGE,
  isDoctorOperational,
  SUSPENDED_DOCTOR_MESSAGE,
} from '@/services/appointments.service';
import { isWithinDoctorAvailability, OUTSIDE_AVAILABILITY_MESSAGE, SLOT_TAKEN_MESSAGE, isSlotOverlapError } from '@/services/availability.service';
import { createBasicPatient } from '@/services/patients.service';

// ─── Tipos ────────────────────────────────────────────────────────────

export interface PatientSearchResult {
  id: string;
  full_name: string;
  phone: string | null;
}

export interface DoctorServiceOption {
  id: string;
  name: string;
  duration_minutes: number;
  price: number | null;
}

export interface DoctorInfo {
  clinicId: string;
  services: DoctorServiceOption[];
}

export interface CreateWalkInData {
  doctorId: string;
  clinicId: string;
  patientId: string;
  startTime: string;
  endTime: string;
  serviceId?: string;
  notes?: string;
  price?: number | null;
}

// ─── Funciones ────────────────────────────────────────────────────────

/**
 * Obtiene clinic_id y servicios del médico en una sola llamada.
 * Solo devuelve servicios ACTIVOS (is_active = true): esta función
 * alimenta los selectores de servicio de walk-in, follow-up y editar
 * cita — flujos de asignación, donde un servicio desactivado no debe
 * ofrecerse. Una cita histórica con un servicio ya inactivo se maneja
 * aparte en EditAppointmentModal.
 */
export async function getDoctorInfo(doctorId: string): Promise<DoctorInfo> {
  const [doctorResult, servicesResult] = await Promise.all([
    supabase.from('doctors').select('clinic_id').eq('id', doctorId).single(),
    supabase
      .from('services')
      .select('id, name, duration_minutes, price')
      .eq('doctor_id', doctorId)
      .eq('is_active', true)
      .order('name'),
  ]);

  if (doctorResult.error) throw doctorResult.error;

  return {
    clinicId: doctorResult.data.clinic_id,
    services: servicesResult.data ?? [],
  };
}

/**
 * Busca pacientes de la clínica por nombre (mínimo 2 caracteres).
 */
export async function searchPatients(
  clinicId: string,
  query: string
): Promise<PatientSearchResult[]> {
  const { data, error } = await supabase
    .from('patients')
    .select('id, full_name, phone')
    .eq('clinic_id', clinicId)
    .ilike('full_name', `%${query}%`)
    .order('full_name')
    .limit(8);

  if (error) throw error;
  return data ?? [];
}

/**
 * Crea un paciente walk-in con datos mínimos (sin cuenta de usuario).
 * Wrapper sobre createBasicPatient → aplica dedup por teléfono
 * (DuplicatePhoneError si ya existe uno activo con ese teléfono).
 * Teléfono ahora es OBLIGATORIO para soportar la dedup.
 */
export async function createWalkInPatient(
  clinicId: string,
  fullName: string,
  phone: string
): Promise<string> {
  const patient = await createBasicPatient({ clinicId, fullName, phone });
  return patient.id;
}

/**
 * Próxima cita futura del paciente con este médico (no cancelada / no-show).
 * Usado para mostrar "ya tiene cita agendada" en el FollowUpScheduler.
 */
export interface NextAppointmentInfo {
  id: string;
  start_time: string;
  end_time: string;
  service_name: string | null;
  status_name: string;
}

export async function getNextAppointmentForPatient(
  patientId: string,
  doctorId: string,
  afterDatetime: string
): Promise<NextAppointmentInfo | null> {
  const { data, error } = await supabase
    .from('appointments')
    .select(
      'id, start_time, end_time, service:services(name), status:appointment_statuses(name, is_final)'
    )
    .eq('patient_id', patientId)
    .eq('doctor_id', doctorId)
    .gt('start_time', afterDatetime)
    .order('start_time', { ascending: true })
    .limit(10);

  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const valid = (data as any[])?.find(
    (a) => a.status?.name !== 'cancelada' && a.status?.name !== 'no_asistio'
  );
  if (!valid) return null;
  return {
    id: valid.id,
    start_time: valid.start_time,
    end_time: valid.end_time,
    service_name: valid.service?.name ?? null,
    status_name: valid.status?.name ?? '',
  };
}

/**
 * Devuelve los horarios ocupados (no cancelados) del doctor en una fecha,
 * para que el FollowUpScheduler pueda marcar slots como bloqueados.
 */
export async function getDayBusySlots(
  doctorId: string,
  dateStr: string // 'YYYY-MM-DD'
): Promise<Array<{ start: string; end: string }>> {
  const { data, error } = await supabase
    .from('appointments')
    .select('start_time, end_time, status:appointment_statuses(name)')
    .eq('doctor_id', doctorId)
    .gte('start_time', `${dateStr}T00:00:00`)
    .lt('start_time', `${dateStr}T23:59:59`);
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data as any[]) ?? [])
    .filter((a) => a.status?.name !== 'cancelada' && a.status?.name !== 'no_asistio')
    .map((a) => ({ start: a.start_time, end: a.end_time }));
}

/**
 * Crea una cita walk-in (source = 'manual').
 * Valida conflicto de horario antes de insertar.
 */
export async function createWalkInAppointment(
  data: CreateWalkInData
): Promise<string> {
  // 0. No permitir crear/reprogramar en el pasado (UI + servicio + trigger DB)
  if (isPastStart(data.startTime)) {
    throw new Error(PAST_APPOINTMENT_MESSAGE);
  }

  // 0.a Médico suspendido (eje OPERATIVIDAD) no acepta nuevas citas
  if (!(await isDoctorOperational(data.doctorId))) {
    throw new Error(SUSPENDED_DOCTOR_MESSAGE);
  }

  // 0.b No permitir fuera de la disponibilidad del médico
  if (!(await isWithinDoctorAvailability(data.doctorId, data.startTime, data.endTime))) {
    throw new Error(OUTSIDE_AVAILABILITY_MESSAGE);
  }

  // 1. Verificar conflicto de horario (excluyendo canceladas / no-shows)
  const [conflictingResult, cancelledResult] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, status_id')
      .eq('doctor_id', data.doctorId)
      .lt('start_time', data.endTime)
      .gt('end_time', data.startTime),
    supabase
      .from('appointment_statuses')
      .select('id')
      .in('name', ['cancelada', 'no_asistio']),
  ]);

  const excludedIds = (cancelledResult.data ?? []).map((s) => s.id);
  const activeConflicts = (conflictingResult.data ?? []).filter(
    (c) => !excludedIds.includes(c.status_id)
  );

  if (activeConflicts.length > 0) {
    throw new Error('Ya existe una cita activa en ese horario. Elige otra hora.');
  }

  // 2. Obtener status 'programada'
  const { data: scheduledStatus, error: statusError } = await supabase
    .from('appointment_statuses')
    .select('id')
    .eq('name', 'programada')
    .single();

  if (statusError) throw statusError;

  // 3. Insertar cita
  const { data: { user } } = await supabase.auth.getUser();

  const { data: appointment, error } = await supabase
    .from('appointments')
    .insert({
      clinic_id: data.clinicId,
      doctor_id: data.doctorId,
      patient_id: data.patientId,
      service_id: data.serviceId || null,
      status_id: scheduledStatus.id,
      start_time: data.startTime,
      end_time: data.endTime,
      source: 'manual',
      notes: data.notes?.trim() || null,
      price: data.price ?? null,
      payment_status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    // Doble reserva bloqueada por la DB (trigger s7_55 / P0090) → mensaje amable.
    if (isSlotOverlapError(error)) throw new Error(SLOT_TAKEN_MESSAGE);
    throw error;
  }

  // 4. Audit log (no bloquea si falla)
  await logAuditEntry({
    action: 'insert',
    tableName: 'appointments',
    recordId: appointment.id,
    newData: {
      source: 'manual',
      doctor_id: data.doctorId,
      patient_id: data.patientId,
      start_time: data.startTime,
      end_time: data.endTime,
      created_by: user?.id ?? null,
    },
  });

  return appointment.id;
}
