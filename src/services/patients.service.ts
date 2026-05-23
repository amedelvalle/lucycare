import { supabase } from '@/lib/supabase';
import { normalizePhoneSV } from '@/lib/phone';
import type { Database } from '@/types/database.types';

type DocumentType = Database['public']['Enums']['document_type'];
type GenderType = Database['public']['Enums']['gender_type'];
type BloodType = Database['public']['Enums']['blood_type'];
type PatientType = Database['public']['Enums']['patient_type'];

// ─── Tipos ────────────────────────────────────────────────────────────

export interface PatientListItem {
  id: string;
  full_name: string;
  phone: string | null;
  photo_url: string | null;
  created_at: string;
  is_active: boolean;
  total_appointments: number;
  last_appointment_at: string | null;
}

export interface PatientDetail {
  id: string;
  clinic_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
  document_type: DocumentType;
  document_number: string | null;
  date_of_birth: string;
  gender: GenderType;
  patient_type: PatientType;
  blood_type: BloodType | null;
  allergies: string | null;
  notes: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PatientAppointment {
  id: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  source: string;
  status: {
    id: string;
    name: string;
    display_name: string;
    color: string;
    is_final: boolean;
  } | null;
  service: {
    id: string;
    name: string;
  } | null;
}

/**
 * Error lanzado por createBasicPatient cuando ya existe un paciente
 * activo con el mismo teléfono en la clínica. Es un duplicado de
 * negocio, no un error de Postgres — la UI lo muestra con el nombre
 * del paciente existente y permite reusarlo en vez de crear otro.
 *
 * `multiple=true` indica que existen DOS o más pacientes activos con
 * ese teléfono normalizado (duplicado preexistente que no se fusionó
 * automáticamente). La UI usa este flag para mostrar un aviso de
 * ambigüedad y NO sugerir reusar uno arbitrario.
 */
export class DuplicatePhoneError extends Error {
  existing: { id: string; full_name: string };
  multiple: boolean;
  constructor(existing: { id: string; full_name: string }, multiple = false) {
    super(
      multiple
        ? 'Hay más de un paciente con este teléfono en la clínica. Resolvé los duplicados antes de crear uno nuevo.'
        : `Ya existe un paciente con este teléfono: ${existing.full_name}.`
    );
    this.name = 'DuplicatePhoneError';
    this.existing = existing;
    this.multiple = multiple;
  }
}

export interface CreateBasicPatientInput {
  clinicId: string;
  fullName: string;
  phone: string; // requerido — es la llave de dedup
  documentType?: DocumentType;
  documentNumber?: string | null;
  dateOfBirth?: string; // YYYY-MM-DD
  gender?: GenderType;
  patientType?: PatientType;
}

export interface PatientUpdateInput {
  full_name?: string;
  phone?: string | null;
  email?: string | null;
  document_type?: DocumentType;
  document_number?: string | null;
  date_of_birth?: string;
  gender?: GenderType;
  patient_type?: PatientType;
  blood_type?: BloodType | null;
  allergies?: string | null;
  notes?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_relation?: string | null;
}

// ─── Funciones ────────────────────────────────────────────────────────

/**
 * Obtiene la lista de pacientes de una clínica con conteo y fecha de última cita.
 * Si se proporciona search (mín. 2 chars), filtra por nombre o teléfono.
 * Por default muestra solo activos. Pasá includeInactive=true para verlos todos.
 */
export async function getPatientsList(
  clinicId: string,
  search?: string,
  includeInactive = false
): Promise<PatientListItem[]> {
  let query = supabase
    .from('patients')
    .select(`
      id,
      full_name,
      phone,
      photo_url,
      created_at,
      is_active,
      appointments(start_time)
    `)
    .eq('clinic_id', clinicId);

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const trimmed = search?.trim() ?? '';
  if (trimmed.length >= 2) {
    // Escape de % y _ para evitar wildcards inyectados
    const escaped = trimmed.replace(/[%_]/g, '\\$&');
    query = query.or(`full_name.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
  }

  query = query.order('full_name').limit(150);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((p: {
    id: string;
    full_name: string;
    phone: string | null;
    photo_url: string | null;
    created_at: string;
    is_active: boolean;
    appointments: Array<{ start_time: string }> | null;
  }) => {
    const apts = p.appointments ?? [];
    const sortedDesc = [...apts].sort(
      (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
    );
    return {
      id: p.id,
      full_name: p.full_name,
      phone: p.phone,
      photo_url: p.photo_url,
      created_at: p.created_at,
      is_active: p.is_active,
      total_appointments: apts.length,
      last_appointment_at: sortedDesc[0]?.start_time ?? null,
    };
  });
}

/**
 * Cambia el estado activo/inactivo del paciente (soft-delete).
 * No usar hard-delete: hay FK desde consultations, prescriptions, vitals, appointments.
 */
export async function setPatientActive(
  patientId: string,
  isActive: boolean
): Promise<void> {
  const { error } = await supabase
    .from('patients')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', patientId);
  if (error) throw error;
}

/**
 * Obtiene el detalle completo de un paciente.
 */
export async function getPatientById(patientId: string): Promise<PatientDetail | null> {
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .eq('id', patientId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // No rows
    throw error;
  }
  return data as PatientDetail;
}

/**
 * Obtiene todas las citas de un paciente (ordenadas más reciente primero).
 */
export async function getPatientAppointments(
  patientId: string
): Promise<PatientAppointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select(`
      id,
      start_time,
      end_time,
      notes,
      source,
      status:appointment_statuses(id, name, display_name, color, is_final),
      service:services(id, name)
    `)
    .eq('patient_id', patientId)
    .order('start_time', { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as PatientAppointment[];
}

/**
 * Crea un paciente nuevo con campos mínimos. Fuente única para todos los
 * flujos del panel (walk-in desde Nueva cita, y "Nuevo paciente" desde
 * /panel/pacientes). Aplica dedup por teléfono antes del INSERT.
 *
 * - Nombre y teléfono son obligatorios.
 * - Si ya existe un paciente ACTIVO con ese teléfono en la clínica →
 *   lanza DuplicatePhoneError (no crea duplicado). La UI usa el
 *   existing para reusar / navegar.
 * - document_number queda NULL si no se provee (PR #27).
 * - Defaults seguros para campos NOT NULL aún sin completar
 *   (date_of_birth, gender, patient_type) — se ajustan luego desde
 *   EditPatientModal.
 */
export async function createBasicPatient(
  input: CreateBasicPatientInput
): Promise<{ id: string; full_name: string }> {
  const fullName = input.fullName.trim();
  // Normalizamos a forma canónica '503XXXXXXXX' para que la dedup
  // detecte '77003001' === '+50377003001' === '+503 7700-3001'.
  const phone = normalizePhoneSV(input.phone);
  if (!fullName) throw new Error('El nombre del paciente es obligatorio.');
  if (!phone) throw new Error('El teléfono del paciente es obligatorio.');

  // Dedup por teléfono — solo entre activos. Pedimos hasta 2 para
  // detectar duplicados preexistentes (mismo teléfono en >1 paciente
  // activo): en ese caso señalamos ambigüedad para revisión manual.
  const { data: matches, error: lookupErr } = await supabase
    .from('patients')
    .select('id, full_name')
    .eq('clinic_id', input.clinicId)
    .eq('phone', phone)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(2);
  if (lookupErr) throw lookupErr;
  if (matches && matches.length > 0) {
    throw new DuplicatePhoneError(
      { id: matches[0].id, full_name: matches[0].full_name },
      matches.length > 1
    );
  }

  const documentNumber = input.documentNumber?.trim() || null;

  const { data, error } = await supabase
    .from('patients')
    .insert({
      clinic_id: input.clinicId,
      profile_id: null,
      full_name: fullName,
      phone,
      document_type: input.documentType ?? 'dui',
      document_number: documentNumber,
      date_of_birth: input.dateOfBirth || '2000-01-01',
      gender: input.gender ?? 'otro',
      patient_type: input.patientType ?? 'privado',
    })
    .select('id, full_name')
    .single();

  if (error) throw error;
  return data;
}

/**
 * Actualiza datos editables de un paciente.
 */
export async function updatePatient(
  patientId: string,
  updates: PatientUpdateInput
): Promise<void> {
  const payload: Record<string, unknown> = {
    ...updates,
    updated_at: new Date().toISOString(),
  };
  // Si se actualiza el teléfono, normalizamos antes de guardar para
  // mantener consistencia con el formato canónico (PR robustez pacientes).
  if (updates.phone !== undefined) {
    payload.phone = normalizePhoneSV(updates.phone);
  }
  const { error } = await supabase
    .from('patients')
    .update(payload)
    .eq('id', patientId);

  if (error) throw error;
}
