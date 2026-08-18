/**
 * PASSWORD-ERROR-COPY-P0 — traducción al español de los errores de contraseña
 * que devuelve GoTrue (Supabase Auth).
 *
 * Motivo: `setPasswordFromRecovery` devolvía `error.message` CRUDO, así que el
 * usuario final veía inglés en `/reset-password`. Caso observado:
 * `New password should be different from the old password.`
 *
 * Este módulo es la FUENTE ÚNICA del copy de error de contraseña: lo consumen
 * tanto el camino de recuperación (`updateUser`) como el de creación
 * (`PUT /auth/v1/user` por fetch directo), para que no existan dos verdades.
 *
 * Reglas de copy: español, TUTEO (nunca voseo), sin jerga técnica y sin
 * exponer nunca el mensaje crudo del proveedor.
 *
 * Alcance deliberado: SOLO contraseña. No traduce OTP, sesión, login ni rate
 * limits de envío — esas superficies ya tienen su propio copy y quedan fuera
 * de este frente.
 */
import { MIN_PASSWORD_LENGTH } from './password'

/** Copy aprobado por el owner para `same_password`. */
export const SAME_PASSWORD_MESSAGE =
  'La nueva contraseña debe ser diferente de la contraseña anterior.'

/** Contraseña rechazada por política (corta o débil). */
export const WEAK_PASSWORD_MESSAGE =
  `La contraseña no cumple los requisitos mínimos. Prueba una distinta de al menos ${MIN_PASSWORD_LENGTH} caracteres.`

/** La sesión que autoriza el cambio ya no sirve. */
export const SESSION_EXPIRED_MESSAGE =
  'Tu sesión expiró. Refresca la página y vuelve a entrar para crear la contraseña.'

/** Demasiados intentos seguidos contra Auth. */
export const RATE_LIMIT_MESSAGE =
  'Demasiados intentos. Espera un momento antes de intentar de nuevo.'

/** Fallback: nunca se muestra el mensaje crudo del proveedor. */
export const GENERIC_PASSWORD_MESSAGE =
  'No pudimos guardar tu contraseña. Prueba de nuevo en un momento.'

/**
 * Señales disponibles según el camino que reportó el error:
 * - `code`   — `error_code` / `code` de GoTrue (`same_password`, `weak_password`…)
 * - `status` — HTTP (401/403 sesión, 422 política, 429 rate limit)
 * - `message`— mensaje del proveedor: se usa SOLO para clasificar, JAMÁS se muestra
 */
export interface PasswordErrorSignals {
  code?: string | null
  status?: number | null
  message?: string | null
}

/**
 * Traduce un error de cambio/creación de contraseña a copy en español.
 *
 * La clasificación mira primero el código (estable), después el HTTP status y
 * solo al final el texto — GoTrue no siempre envía `error_code` en todas las
 * versiones, pero el texto de `same_password` es reconocible.
 */
export function passwordErrorMessage(signals: PasswordErrorSignals): string {
  const code = (signals.code ?? '').toLowerCase()
  const message = (signals.message ?? '').toLowerCase()
  const status = signals.status ?? null

  if (code === 'same_password' || /different from the old password/.test(message)) {
    return SAME_PASSWORD_MESSAGE
  }

  if (code === 'weak_password' || /password.*(should be at least|is too weak|too short)/.test(message)) {
    return WEAK_PASSWORD_MESSAGE
  }

  if (status === 401 || status === 403 || code === 'session_not_found' || code === 'no_authorization') {
    return SESSION_EXPIRED_MESSAGE
  }

  if (status === 429 || code === 'over_request_rate_limit' || /rate limit/.test(message)) {
    return RATE_LIMIT_MESSAGE
  }

  // 422 sin código reconocido = rechazo de política de contraseña.
  if (status === 422 || /password/.test(message)) {
    return WEAK_PASSWORD_MESSAGE
  }

  return GENERIC_PASSWORD_MESSAGE
}
