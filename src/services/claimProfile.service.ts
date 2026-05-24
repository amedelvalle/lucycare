/**
 * Servicio de Reclamo de Perfil del Médico (Fase 2 — reclamo seguro).
 *
 * Toda la lógica vive en la RPC `claim_doctor_profile` (s7_13).
 * Este wrapper:
 *   - reenvía los inputs,
 *   - aplica un timeout cliente (la RPC server-side tarda ~200ms;
 *     si el browser no recibe respuesta en 15s pasa algo raro en
 *     la red y no queremos colgar el modal),
 *   - tras timeout o error de red consulta el estado real del
 *     doctor: si quedó `claimed`, asume que el claim se hizo igual
 *     (la respuesta se perdió en transit) y devuelve success,
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
  | 'TIMEOUT'                // cliente colgado, no llegó respuesta en N segundos
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

const CLAIM_TIMEOUT_MS = 15_000;

class ClaimTimeoutError extends Error {
  constructor() {
    super('claim_doctor_profile timeout');
    this.name = 'ClaimTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ClaimTimeoutError()), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Lee el estado actual del doctor. Si quedó `claimed` y la sesión
 * actual coincide con su profile_id, consideramos el claim ya hecho
 * (probable respuesta perdida en transit).
 */
async function checkAlreadyClaimedByMe(doctorId: string): Promise<boolean> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) return false;

    const { data, error } = await supabase
      .from('doctors')
      .select('profile_id, lucy_status')
      .eq('id', doctorId)
      .maybeSingle();

    if (error || !data) return false;
    return data.lucy_status !== 'listed_only' && data.profile_id === session.user.id;
  } catch {
    return false;
  }
}

export async function claimDoctorProfile(
  input: ClaimDoctorProfileInput,
): Promise<ClaimResult> {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('claim_doctor_profile', {
        p_doctor_id: input.doctorId,
        p_license_typed: input.licenseNumber,
        p_tos_version: input.tosVersion ?? 'v1.0',
      }),
      CLAIM_TIMEOUT_MS,
    );

    if (error) {
      // Antes de devolver error, chequeamos si el claim se hizo igual
      // (caso raro de respuesta de éxito perdida en transit y supabase-js
      // interpretándola como error).
      if (await checkAlreadyClaimedByMe(input.doctorId)) {
        return { success: true };
      }
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
  } catch (err) {
    // Timeout o excepción de red. Antes de fallar, vemos si la DB
    // ya quedó claimed: si sí, la RPC corrió OK y la respuesta se perdió.
    if (await checkAlreadyClaimedByMe(input.doctorId)) {
      return { success: true };
    }
    if (err instanceof ClaimTimeoutError) {
      return {
        success: false,
        errorCode: 'TIMEOUT',
        errorMessage:
          'No pudimos confirmar el reclamo. Refrescá la página: si tu perfil ya aparece reclamado, todo está bien.',
      };
    }
    return {
      success: false,
      errorCode: 'UNKNOWN',
      errorMessage: err instanceof Error ? err.message : 'Error inesperado',
    };
  }
}
