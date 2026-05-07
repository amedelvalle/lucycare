import { supabase } from '@/lib/supabase';
import { logAuditEntry } from '@/services/auditLog.service';

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
 */
export async function getDoctorInfo(doctorId: string): Promise<DoctorInfo> {
  const [doctorResult, servicesResult] = await Promise.all([
    supabase.from('doctors').select('clinic_id').eq('id', doctorId).single(),
    supabase
      .from('services')
      .select('id, name, duration_minutes, price')
      .eq('doctor_id', doctorId)
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
 */
export async function createWalkInPatient(
  clinicId: string,
  fullName: string,
  phone?: string
): Promise<string> {
  const { data, error } = await supabase
    .from('patients')
    .insert({
      clinic_id: clinicId,
      profile_id: null,
      full_name: fullName.trim(),
      phone: phone?.trim() || null,
      document_type: 'dui',
      document_number: 'PENDIENTE',
      date_of_birth: '2000-01-01',
      gender: 'otro',
      patient_type: 'privado',
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * Crea una cita walk-in (source = 'manual').
 * Valida conflicto de horario antes de insertar.
 */
export async function createWalkInAppointment(
  data: CreateWalkInData
): Promise<string> {
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

  if (error) throw error;

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
