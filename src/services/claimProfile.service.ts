/**
 * Servicio de Reclamo de Perfil del Médico (Fase 2 — reclamo seguro).
 *
 * Toda la lógica vive en la RPC `claim_doctor_profile` (s7_13).
 *
 * Diseño defensivo:
 *   - NO usamos `supabase.rpc(...)` ni `supabase.from(...).select(...)`.
 *     En algunos browsers (con navigator.locks tomado por otra cosa)
 *     esos wrappers se cuelgan ANTES de hacer la request HTTP y la
 *     llamada al backend nunca sale (verificado en DevTools → Network).
 *   - Hacemos `fetch()` directos al endpoint REST de Supabase, pasando
 *     el access_token que el caller ya tiene en mano (obtenido del
 *     modal apenas verifyOtp completa, o vía getSession con su propio
 *     timeout al abrir el modal). Así nunca dependemos de un lock
 *     interno de supabase-js durante el submit.
 *   - AbortController con timeout 8 s. Si vence o falla la red,
 *     consultamos el estado del doctor (otro fetch directo): si quedó
 *     claimed y profile_id coincide con la sesión, devolvemos success
 *     (la RPC corrió OK, la respuesta se perdió en transit).
 *   - Mapeo de SQLSTATE P0001..P0007 a `errorCode` tipado.
 *
 * Reglas que NO se tocan al reclamar:
 *   - No marca `is_verified`
 *   - No cambia `is_published`
 *   - No habilita `booking_enabled`
 *   - No activa `is_operational`
 *   - No crea `services` ni `availability_rules`
 */

export type ClaimErrorCode =
  | 'NOT_AUTHENTICATED'      // sin sesión / sin access_token
  | 'DOCTOR_NOT_FOUND'       // P0002
  | 'ALREADY_CLAIMED'        // P0003
  | 'DOCTOR_NO_PHONE'        // P0004
  | 'PHONE_MISMATCH'         // P0005
  | 'DOCTOR_NO_LICENSE'      // P0006
  | 'LICENSE_MISMATCH'       // P0007
  | 'TIMEOUT'                // > N segundos sin respuesta
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
  /** access_token de la sesión actual, obtenido por el caller. */
  accessToken: string;
  /** user.id de la sesión actual. Para verificar recovery post-error. */
  sessionUserId: string;
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
const CHECK_TIMEOUT_MS = 4_000;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

function authHeaders(accessToken: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
}

/**
 * Consulta el estado del doctor vía fetch directo. Devuelve true si
 * el doctor ya quedó claimed y vinculado al usuario de la sesión
 * (caso de respuesta perdida en transit).
 */
async function checkAlreadyClaimedByMe(
  doctorId: string,
  accessToken: string,
  sessionUserId: string,
): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const url = `${SUPABASE_URL}/rest/v1/doctors?id=eq.${encodeURIComponent(doctorId)}&select=profile_id,lucy_status`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: authHeaders(accessToken),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return false;
    const rows = (await resp.json()) as Array<{ profile_id: string | null; lucy_status: string | null }>;
    const row = rows?.[0];
    if (!row) return false;
    return row.lucy_status !== 'listed_only' && row.profile_id === sessionUserId;
  } catch {
    clearTimeout(t);
    return false;
  }
}

export async function claimDoctorProfile(input: ClaimDoctorProfileInput): Promise<ClaimResult> {
  if (!input.accessToken || !input.sessionUserId) {
    return {
      success: false,
      errorCode: 'NOT_AUTHENTICATED',
      errorMessage: 'Sesión no disponible',
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLAIM_TIMEOUT_MS);

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_doctor_profile`, {
      method: 'POST',
      headers: authHeaders(input.accessToken),
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
      const errBody = (body || {}) as { code?: string; message?: string };
      if (await checkAlreadyClaimedByMe(input.doctorId, input.accessToken, input.sessionUserId)) {
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
      if (await checkAlreadyClaimedByMe(input.doctorId, input.accessToken, input.sessionUserId)) {
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
    if (await checkAlreadyClaimedByMe(input.doctorId, input.accessToken, input.sessionUserId)) {
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
