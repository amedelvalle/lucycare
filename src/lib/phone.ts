/**
 * Normalización de teléfonos salvadoreños a forma canónica.
 *
 * Formato canónico: `503XXXXXXXX` (11 dígitos, sin '+', sin separadores).
 * Es el mismo formato que ya usa la columna `profiles.phone` que mete
 * Twilio OTP (ej: '50378627694'), y se complementa con un '+' al
 * momento de enviar SMS desde el backend.
 *
 * Acepta variantes comunes que el usuario tipea:
 *   - "77003001"             → "50377003001"
 *   - "50377003001"          → "50377003001"
 *   - "+50377003001"         → "50377003001"
 *   - "+503 7700-3001"       → "50377003001"
 *   - "(503) 7700 3001"      → "50377003001"
 *
 * Para inputs que NO son un teléfono SV reconocible (otros países, etc.)
 * devuelve los dígitos tal como vinieron (best-effort, no rompe).
 * Para input vacío/null → null.
 */
export function normalizePhoneSV(input: string | null | undefined): string | null {
  if (input == null) return null;
  const digits = input.replace(/[^0-9]/g, '');
  if (!digits) return null;
  if (/^503\d{8}$/.test(digits)) return digits;
  if (/^\d{8}$/.test(digits)) return '503' + digits;
  return digits;
}

/**
 * Entrada de teléfono salvadoreño en formato LOCAL de 8 dígitos.
 *
 * Estos tres helpers son solo la capa de INTERFAZ: la normalización canónica
 * sigue siendo `normalizePhoneSV`, que es la única que decide el formato que
 * viaja al backend. No hay una segunda normalización en paralelo.
 *
 * Motivo: los campos de teléfono del alta de perfiles sembrados aceptaban
 * texto libre, así que llegaba a viajar una cadena que no era un número. El
 * backend la rechaza (`P0133`), pero recién después de crear la identidad
 * técnica: conviene atajarlo en el formulario.
 */

/** Deja solo dígitos y corta en 8, el largo de un número salvadoreño local. */
export function sanitizeSvLocal(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '').slice(0, 8);
}

/** Máscara visual `0000-0000` sobre los dígitos locales. */
export function formatSvLocal(raw: string | null | undefined): string {
  const d = sanitizeSvLocal(raw);
  return d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
}

/** Válido = exactamente 8 dígitos. Vacío NO es válido: usar antes el opcional. */
export function isValidSvLocal(raw: string | null | undefined): boolean {
  return /^\d{8}$/.test(sanitizeSvLocal(raw));
}
