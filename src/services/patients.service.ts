import { supabase } from '@/lib/supabase';
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
  document_number: string;
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

export interface PatientUpdateInput {
  full_name?: string;
  phone?: string | null;
  email?: string | null;
  document_type?: DocumentType;
  document_number?: string;
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
 */
export async function getPatientsList(
  clinicId: string,
  search?: string
): Promise<PatientListItem[]> {
  let query = supabase
    .from('patients')
    .select(`
      id,
      full_name,
      phone,
      photo_url,
      created_at,
      appointments(start_time)
    `)
    .eq('clinic_id', clinicId);

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
      total_appointments: apts.length,
      last_appointment_at: sortedDesc[0]?.start_time ?? null,
    };
  });
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
 * Actualiza datos editables de un paciente.
 */
export async function updatePatient(
  patientId: string,
  updates: PatientUpdateInput
): Promise<void> {
  const payload = {
    ...updates,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('patients')
    .update(payload)
    .eq('id', patientId);

  if (error) throw error;
}
