/**
 * Servicio de Lista de espera (waitlist).
 *
 * Reglas vigentes:
 *  - Sin SMS/WhatsApp automático. La notificación es manual desde admin.
 *  - El envío público va por RPC `submit_waitlist_entry` (anon callable,
 *    SECURITY DEFINER server-side). Frontend no hace insert directo.
 *  - Dedup idempotente por (doctor_id, phone_normalizado).
 *  - Mensaje genérico al frontend tanto si fue alta nueva como si ya
 *    estaba en la lista (no enumeramos quién está registrado).
 */

import { supabase } from '../lib/supabase';

export type WaitlistErrorCode =
  | 'INVALID_NAME'        // P0101
  | 'INVALID_PHONE'       // P0102
  | 'MESSAGE_TOO_LONG'    // P0103
  | 'DOCTOR_NOT_AVAILABLE' // P0104
  | 'UNKNOWN';

const SQLSTATE_TO_CODE: Record<string, WaitlistErrorCode> = {
  P0101: 'INVALID_NAME',
  P0102: 'INVALID_PHONE',
  P0103: 'MESSAGE_TOO_LONG',
  P0104: 'DOCTOR_NOT_AVAILABLE',
};

export interface SubmitWaitlistInput {
  doctorId: string;
  patientName: string;
  patientPhone: string;     // formato libre, el RPC normaliza
  patientMessage?: string;
}

export interface SubmitWaitlistResult {
  success: boolean;
  alreadyInList?: boolean;  // true si ya existía la entrada
  errorCode?: WaitlistErrorCode;
  errorMessage?: string;
}

export async function submitWaitlistEntry(
  input: SubmitWaitlistInput,
): Promise<SubmitWaitlistResult> {
  const { data, error } = await supabase.rpc('submit_waitlist_entry', {
    p_doctor_id: input.doctorId,
    p_patient_name: input.patientName,
    p_patient_phone: input.patientPhone,
    p_patient_message: input.patientMessage ?? null,
  });

  if (error) {
    const code = error.code ? SQLSTATE_TO_CODE[error.code] : undefined;
    return {
      success: false,
      errorCode: code ?? 'UNKNOWN',
      errorMessage: error.message,
    };
  }

  const body = data as { success?: boolean; already_in_list?: boolean } | null;
  if (!body?.success) {
    return { success: false, errorCode: 'UNKNOWN', errorMessage: 'Respuesta inesperada' };
  }

  return {
    success: true,
    alreadyInList: !!body.already_in_list,
  };
}

// ═════════════ Admin-only ═════════════

export interface AdminWaitlistEntry {
  id: string;
  patientName: string;
  patientPhone: string;
  patientMessage: string | null;
  status: 'pending' | 'contacted' | 'cancelled';
  contactedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export async function adminListWaitlistForDoctor(
  doctorId: string,
  options: { status?: 'pending' | 'contacted' | 'cancelled'; limit?: number; offset?: number } = {},
): Promise<AdminWaitlistEntry[]> {
  const { data, error } = await supabase.rpc('admin_list_waitlist_for_doctor', {
    p_doctor_id: doctorId,
    p_status: options.status ?? null,
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
  });
  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    patientName: (row.patient_name as string) ?? '',
    patientPhone: (row.patient_phone as string) ?? '',
    patientMessage: (row.patient_message as string | null) ?? null,
    status: (row.status as AdminWaitlistEntry['status']) ?? 'pending',
    contactedAt: (row.contacted_at as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

export async function adminCountWaitlistForDoctor(
  doctorId: string,
  status?: 'pending' | 'contacted' | 'cancelled',
): Promise<number> {
  const { data, error } = await supabase.rpc('admin_count_waitlist_for_doctor', {
    p_doctor_id: doctorId,
    p_status: status ?? null,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Devuelve un Map<doctor_id, pending_count> solo con los médicos
 * que tienen al menos 1 entrada en estado pending. Usado por la
 * lista general /admin/medicos para mostrar un badge en cada row.
 * Una sola query bulk; no N+1.
 */
export async function adminWaitlistPendingCountByDoctor(): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('admin_waitlist_pending_count_by_doctor');
  if (error) throw new Error(error.message);
  const map = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ doctor_id: string; pending_count: number }>) {
    if (row.doctor_id) map.set(row.doctor_id, Number(row.pending_count));
  }
  return map;
}

export async function adminUpdateWaitlistEntry(
  entryId: string,
  status: 'pending' | 'contacted' | 'cancelled',
  notes?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('admin_update_waitlist_entry', {
    p_entry_id: entryId,
    p_status: status,
    p_notes: notes ?? null,
  });
  if (error) throw new Error(error.message);
}
