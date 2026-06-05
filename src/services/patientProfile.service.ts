/**
 * Servicio del perfil global del paciente — Paciente Global F2.2.
 *
 * Lee/edita la identidad global en `profiles` (DUI/DOB/género/depto/muni, s7_32).
 * El paciente solo toca su propia fila (RLS self + grant column-restricted).
 * Las sugerencias de prefill salen de sus fichas locales `patients`
 * (profile_id = auth.uid(), SELECT-self de Fase 1) — NO se copian solas.
 */

import { supabase } from '@/lib/supabase';
import { validateDocument, type DocumentType } from '@/lib/document';

export type Gender = 'masculino' | 'femenino' | 'otro';

export interface PatientProfile {
  id: string;
  full_name: string;
  phone: string | null;           // read-only en la UI
  document_type: DocumentType | null;
  document_number: string | null;
  date_of_birth: string | null;   // ISO date
  gender: Gender | null;
  department_id: string | null;
  municipality_id: string | null;
}

export interface PatientProfileUpdate {
  full_name?: string;
  document_type?: DocumentType | null;
  document_number?: string | null;
  date_of_birth?: string | null;
  gender?: Gender | null;
  department_id?: string | null;
  municipality_id?: string | null;
}

/** Una sugerencia de dato traída de una ficha local. */
export interface LocalSuggestion {
  clinicName: string;
  full_name: string | null;
  document_type: DocumentType | null;
  document_number: string | null;
  date_of_birth: string | null;
  gender: Gender | null;
}

async function uid(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) throw new Error('Sesión no encontrada');
  return data.user.id;
}

export async function getMyProfile(): Promise<PatientProfile> {
  const id = await uid();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, document_type, document_number, date_of_birth, gender, department_id, municipality_id')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as unknown as PatientProfile;
}

/**
 * Sugerencias de prefill desde las fichas locales del paciente. Solo trae los
 * campos que existen en `patients` (full_name, documento, DOB, género). Depto/
 * muni NO viven en `patients` → no se sugieren.
 */
export async function getLocalSuggestions(): Promise<LocalSuggestion[]> {
  const id = await uid();
  const { data, error } = await supabase
    .from('patients')
    .select('full_name, document_type, document_number, date_of_birth, gender, clinic:clinic_id(name)')
    .eq('profile_id', id);
  if (error) {
    console.warn('[getLocalSuggestions] error (silenciado):', error.message);
    return [];
  }
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
    const clinic = (r.clinic ?? {}) as { name?: string };
    return {
      clinicName: clinic.name?.trim() || 'Una clínica',
      full_name: (r.full_name as string) ?? null,
      document_type: (r.document_type as DocumentType) ?? null,
      document_number: (r.document_number as string) ?? null,
      date_of_birth: (r.date_of_birth as string) ?? null,
      gender: (r.gender as Gender) ?? null,
    };
  });
}

export class DuplicateDocumentError extends Error {
  constructor() {
    super('Ese documento ya está registrado en LucyCare. Si creés que es un error o tenés perfiles duplicados, escribinos y lo resolvemos.');
    this.name = 'DuplicateDocumentError';
  }
}

/**
 * Actualiza el perfil global. Normaliza el documento con validateDocument
 * (forma canónica) antes de guardar. Mapea errores conocidos.
 */
export async function updateMyProfile(updates: PatientProfileUpdate): Promise<void> {
  const id = await uid();
  const payload: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };

  // Normalizar documento a forma canónica (DUI → 00000000-0)
  if ('document_number' in updates || 'document_type' in updates) {
    const type = updates.document_type ?? null;
    const v = validateDocument(type ?? undefined, updates.document_number ?? null);
    if (!v.valid) throw new Error(v.error ?? 'Documento inválido');
    payload.document_number = v.canonical;        // null si vacío
    payload.document_type = v.canonical ? type : null; // sin número → sin tipo (regla CHECK)
  }

  const { error } = await supabase.from('profiles').update(payload).eq('id', id);
  if (error) {
    if (/duplicate key|unique|23505/i.test(error.message)) throw new DuplicateDocumentError();
    throw error;
  }
}
