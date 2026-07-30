/**
 * Consentimiento de OTP (AUTH-P1D2) — fuente ÚNICA de versión, texto y hash.
 *
 * REGLA VINCULANTE: el hash registrado como evidencia corresponde EXACTAMENTE
 * al texto que el usuario VE en el flujo. No hay texto legal oculto ni
 * contenido de la Política de Privacidad dentro del hash: la Política puede
 * ampliar información, pero eso NO forma parte de este aviso ni de su hash.
 *
 * El texto canónico es UNA sola cadena con las dos oraciones separadas por un
 * espacio; en la interfaz se renderiza en dos líneas (la segunda, discreta, con
 * "Política de Privacidad" enlazada). Ambas superficies son el MISMO texto:
 *   canónico === `${PRIMARY} ${SECONDARY}`
 *
 * La acción de solicitar el código (botón de enviar) constituye el
 * consentimiento: sin casilla, sin modal.
 */
export const OTP_CONSENT_VERSION = 'otp-consent-v1';

// ─── Copy VISIBLE (dos líneas) ───
/** Línea principal: explica qué va a pasar. */
export const OTP_CONSENT_NOTICE_PRIMARY =
  'Te enviaremos un código por SMS para verificar tu número.';
/** Línea secundaria discreta; "Política de Privacidad" va enlazada. */
export const OTP_CONSENT_NOTICE_SECONDARY =
  'Al continuar, aceptas nuestra Política de Privacidad.';
export const OTP_CONSENT_NOTICE_SECONDARY_PREFIX = 'Al continuar, aceptas nuestra ';
export const OTP_CONSENT_NOTICE_LINK_LABEL = 'Política de Privacidad';

/**
 * Texto CANÓNICO de `otp-consent-v1` = exactamente lo que se muestra, unido con
 * un espacio. Es el que respalda `consent_text_hash` en otp_consent_events.
 */
export const OTP_CONSENT_TEXT =
  `${OTP_CONSENT_NOTICE_PRIMARY} ${OTP_CONSENT_NOTICE_SECONDARY}`;

/** SHA-256 del texto canónico UTF-8 exacto (congelado por el owner). */
export const OTP_CONSENT_TEXT_SHA256 =
  '86f0dfdf430fd3e100fc7651039b20bf1d127c571e87e07faef22503886c8692';

/** Ruta canónica de privacidad ya existente en el repo. */
export const OTP_PRIVACY_PATH = '/privacidad';
