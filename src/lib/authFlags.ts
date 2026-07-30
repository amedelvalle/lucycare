/**
 * Banderas de despliegue de Auth (AUTH-P1D2).
 *
 * - CAPTCHA (Cloudflare Turnstile) queda INACTIVO hasta su activación
 *   coordinada: por defecto `VITE_CAPTCHA_ENABLED` !== 'true'. Con el flag
 *   activo pero SIN Site Key, el flujo debe FALLAR CERRADO (no enviar).
 * - El cambio de teléfono queda SUSPENDIDO temporalmente.
 *
 * La Site Key de Turnstile es PÚBLICA (va al bundle). La Secret Key NUNCA
 * toca el repo/frontend (se valida server-side en Supabase al activar).
 */

/** ¿CAPTCHA habilitado por despliegue? (por defecto: NO). */
export const CAPTCHA_ENABLED = import.meta.env.VITE_CAPTCHA_ENABLED === 'true';

/** Site Key pública de Turnstile (placeholder en .env.example; vacía = sin key). */
export const TURNSTILE_SITE_KEY =
  ((import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '').trim();

/**
 * FAIL-CLOSED: CAPTCHA habilitado pero falta la Site Key → el flujo NO debe
 * enviar (no se puede obtener un token válido).
 */
export function captchaMisconfigured(): boolean {
  return CAPTCHA_ENABLED && TURNSTILE_SITE_KEY.length === 0;
}

/** ¿Se exige un captchaToken válido antes de enviar? */
export function captchaRequired(): boolean {
  return CAPTCHA_ENABLED;
}

// ─── Cambio de teléfono: suspendido temporalmente (AUTH-P1D2) ───
export const PHONE_CHANGE_SUSPENDED = true;
export const PHONE_CHANGE_SUSPENDED_MESSAGE =
  'El cambio de teléfono está temporalmente no disponible.';
