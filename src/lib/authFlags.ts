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

// ─── Cambio de teléfono (AUTH-P1D2) ───
/**
 * El cambio de teléfono se suspende ÚNICAMENTE cuando el CAPTCHA está activo.
 *
 * Motivo: `supabase.auth.updateUser({ phone })` —la llamada que envía el OTP al
 * número nuevo— NO admite `captchaToken` en supabase-js, así que con CAPTCHA
 * activo quedaría como una superficie de envío de SMS sin protección. Con
 * CAPTCHA desactivado no hay tal desprotección relativa y el flujo sigue
 * disponible EXACTAMENTE como hoy.
 *
 * Se deriva de la MISMA bandera (`VITE_CAPTCHA_ENABLED`): una sola fuente de
 * verdad, sin variables nuevas ni configuraciones contradictorias, y la
 * suspensión se activa automáticamente al activar el CAPTCHA.
 */
export const PHONE_CHANGE_SUSPENDED: boolean = CAPTCHA_ENABLED;
export const PHONE_CHANGE_SUSPENDED_MESSAGE =
  'El cambio de teléfono está temporalmente no disponible.';
