/**
 * Servicio de Reclamo de Perfil del Médico (Fase 2 — reclamo seguro).
 *
 * Toda la lógica vive en la RPC `claim_doctor_profile` (s7_13).
 * Este wrapper solo:
 *   - reenvía los inputs,
 *   - mapea SQLSTATE custom (P0001..P0007) a `errorCode` tipado
 *     para que el modal muestre mensajes específicos por escenario.
 *
 * IMPORTANTE: la RPC valida server-side el teléfono verificado de la
 * sesión y la licencia. El cliente NO decide nada de seguridad.
 *
 * Lo que el reclamo NO hace (regla de producto vigente):
 *   - No marca `is_verified`
 *   - No cambia `is_published`
 *   - No habilita `booking_enabled`
 *   - No activa `is_operational`
 *   - No crea `services` ni `availability_rules`
 *
 * Esos ejes los administra LucyAdmin desde el panel /admin.
 */

import { supabase } from '../lib/supabase';

export type ClaimErrorCode =
  | 'NOT_AUTHENTICATED'      // P0001 / 28000  → no hay sesión con phone verificado
  | 'DOCTOR_NOT_FOUND'       // P0002          → doctor_id inválido
  | 'ALREADY_CLAIMED'        // P0003          → lucy_status != listed_only
  | 'DOCTOR_NO_PHONE'        // P0004          → profile del doctor sin phone
  | 'PHONE_MISMATCH'         // P0005          → phone sesión != phone doctor
  | 'DOCTOR_NO_LICENSE'      // P0006          → doctor sin license_number
  | 'LICENSE_MISMATCH'       // P0007          → license tipeada != registrada
  | 'UNKNOWN';

export interface ClaimResult {
  success: boolean;
  errorCode?: ClaimErrorCode;
  errorMessage?: string;
}

interface ClaimDoctorProfileInput {
  doctorId: string;
  licenseNumber: string;
  tosVersion?: string;
}

const SQLSTATE_TO_CODE: Record<string, ClaimErrorCode> = {
  '28000': 'NOT_AUTHENTICATED',
  P0001: 'NOT_AUTHENTICATED',
  P0002: 'DOCTOR_NOT_FOUND',
  P0003: 'ALREADY_CLAIMED',
  P0004: 'DOCTOR_NO_PHONE',
  P0005: 'PHONE_MISMATCH',
  P0006: 'DOCTOR_NO_LICENSE',
  P0007: 'LICENSE_MISMATCH',
};

export async function claimDoctorProfile(
  input: ClaimDoctorProfileInput,
): Promise<ClaimResult> {
  const { data, error } = await supabase.rpc('claim_doctor_profile', {
    p_doctor_id: input.doctorId,
    p_license_typed: input.licenseNumber,
    p_tos_version: input.tosVersion ?? 'v1.0',
  });

  if (error) {
    const code = (error.code ? SQLSTATE_TO_CODE[error.code] : undefined) ?? 'UNKNOWN';
    return {
      success: false,
      errorCode: code,
      errorMessage: error.message,
    };
  }

  // La RPC devuelve jsonb { success, doctor_id, lucy_status }
  const ok = !!(data && (data as { success?: boolean }).success);
  if (!ok) {
    return { success: false, errorCode: 'UNKNOWN', errorMessage: 'Respuesta inesperada del servidor' };
  }
  return { success: true };
}
