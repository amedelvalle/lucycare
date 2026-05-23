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
