/**
 * Servicio de Reclamo de Perfil del Médico (Fase 2 — reclamo seguro).
 *
 * Toda la lógica vive en la RPC `claim_doctor_profile` (s7_13).
 * El cliente hace POST directo al endpoint REST de Supabase con el
 * access_token de la sesión actual. Evitamos `supabase.rpc()` porque
 * en algunos browsers se cuelga esperando un lock interno de auth y
 * la request HTTP nunca sale (verificado con DevTools → Network vacío).
 *
 * - timeout cliente (8s) con AbortController. Si vence o falla la red,
 *   antes de devolver error consultamos el estado del doctor: si quedó
 *   `claimed` y profile_id coincide con la sesión, devolvemos success
 *   (la respuesta se perdió en transit, no hay que pedir reintento).
 * - mapeo de SQLSTATE P0001..P0007 a `errorCode` tipado.
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
  | 'NOT_AUTHENTICATED'      // sin sesión o sin phone verificado
  | 'DOCTOR_NOT_FOUND'       // P0002
  | 'ALREADY_CLAIMED'        // P0003
  | 'DOCTOR_NO_PHONE'        // P0004
  | 'PHONE_MISMATCH'         // P0005
  | 'DOCTOR_NO_LICENSE'      // P0006
  | 'LICENSE_MISMATCH'       // P0007
  | 'TIMEOUT'                // la request tardó > N segundos
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

const CLAIM_TIMEOUT_MS = 8_000;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/**
 * Lee el estado actual del doctor. Si quedó claimed y la sesión
 * coincide con profile_id, asumimos que el claim ya se hizo
 * (respuesta perdida en transit).
 */
async function checkAlreadyClaimedByMe(
  doctorId: string,
  sessionUserId: string | null,
): Promise<boolean> {
  if (!sessionUserId) return false;
  try {
    const { data } = await supabase
      .from('doctors')
      .select('profile_id, lucy_status')
      .eq('id', doctorId)
      .maybeSingle();
    if (!data) return false;
    return data.lucy_status !== 'listed_only' && data.profile_id === sessionUserId;
  } catch {
    return false;
  }
}

export async function claimDoctorProfile(
  input: ClaimDoctorProfileInput,
): Promise<ClaimResult> {
  // ─── 1. Obtener access token de la sesión actual ───
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  const sessionUserId = session?.user?.id ?? null;

  if (!accessToken) {
    return {
      success: false,
      errorCode: 'NOT_AUTHENTICATED',
      errorMessage: 'Sesión no encontrada',
    };
  }

  // ─── 2. POST directo al endpoint REST (sin pasar por supabase.rpc) ───
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLAIM_TIMEOUT_MS);

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_doctor_profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      body: JSON.stringify({
        p_doctor_id: input.doctorId,
        p_license_typed: input.licenseNumber,
        p_tos_version: input.tosVersion ?? 'v1.0',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const text = await resp.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!resp.ok) {
      // Errores RPC vienen como { code, message, details, hint }
      const errBody = (body || {}) as { code?: string; message?: string };
      // Fallback recovery: tal vez la RPC corrió OK antes del error y se confundió
      if (await checkAlreadyClaimedByMe(input.doctorId, sessionUserId)) {
        return { success: true };
      }
      const code = errBody.code ? SQLSTATE_TO_CODE[errBody.code] : undefined;
      return {
        success: false,
        errorCode: code ?? 'UNKNOWN',
        errorMessage: errBody.message ?? `HTTP ${resp.status}`,
      };
    }

    const ok = !!(body && typeof body === 'object' && (body as { success?: boolean }).success);
    if (!ok) {
      // No esperábamos esto. Verificar DB por las dudas.
      if (await checkAlreadyClaimedByMe(input.doctorId, sessionUserId)) {
        return { success: true };
      }
      return {
        success: false,
        errorCode: 'UNKNOWN',
        errorMessage: 'Respuesta inesperada del servidor',
      };
    }

    return { success: true };
  } catch (err) {
    clearTimeout(timeoutId);
    // Timeout (AbortError) o error de red. Recovery: ¿quedó claimed igual?
    if (await checkAlreadyClaimedByMe(input.doctorId, sessionUserId)) {
      return { success: true };
    }
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    if (isAbort) {
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
      errorMessage: err instanceof Error ? err.message : 'Error de red',
    };
  }
}
