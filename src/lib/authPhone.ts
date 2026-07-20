/**
 * authPhone — normalización de teléfonos para AUTENTICACIÓN (AUTH-P1A).
 *
 * Módulo PURO y reutilizable (sin dependencias de Supabase ni de React):
 * lo importan `auth.service.ts` y el check local `check-auth-p1a-phone.mjs`
 * (que prueba ESTAS funciones reales, no una réplica).
 *
 * Dos representaciones, deliberadamente separadas:
 *   - `toAuthPhone`  → E.164 con '+'  — lo que se envía a Supabase Auth
 *                      (`signInWithOtp` / `signInWithPassword`).
 *   - `toAppPhone`   → dígitos E.164 sin '+' — representación interna para
 *                      side-effects y perfiles, derivada SIEMPRE del teléfono
 *                      del usuario autenticado (`data.user.phone`), nunca del
 *                      texto tipeado. Valida/canonicaliza con el MISMO
 *                      normalizador antes de retirar el '+'.
 *
 * NO se usa `normalizePhoneSV` acá: ese helper es SV-céntrico (datos internos
 * salvadoreños) y no sirve como normalizador universal de login.
 *
 * ─── PENDIENTE VINCULANTE DE AUTH-P1C (países y UI) ───
 *   • El selector actual del LoginModal muestra SV, GT, HN, MX y US — y su
 *     array `countries` DUPLICA esta lista hoy. En P1C la UI debe consumir
 *     la configuración de ESTE módulo (fuente única); la lista regional
 *     definitiva se decidirá en P1C y no debe quedar duplicada en varios
 *     archivos.
 *   • El input actual limita TODOS los países a 8 dígitos (`formatSvPhone`):
 *     MX y US están inoperantes en la UI actual.
 *   • NO publicar el login nuevo hasta corregir máscara y longitud por país.
 */

export interface AuthCountry {
  /** Código de país SIN '+' (p. ej. '503'). */
  code: string
  /** Longitud del número nacional (sin código de país). */
  nationalLength: number
  /**
   * Estructura nacional BÁSICA (primer dígito plausible + longitud).
   * No valida operadores ni existencia real del número.
   */
  nationalPattern: RegExp
}

/**
 * Países OFICIALMENTE habilitados para autenticación (ÚNICA fuente de
 * verdad de la configuración). La MISMA regla nacional se aplica venga el
 * número como local, `CC…` o `+CC…` (consistencia: '12345678' y
 * '50312345678' se rechazan por igual — el nacional no es SV plausible).
 *
 * El ORDEN de declaración NO importa: el matching ordena automáticamente
 * por longitud de código (más largo primero) y la unicidad de códigos se
 * valida al cargar el módulo (`assertNoDuplicateCodes`).
 */
export const AUTH_COUNTRIES: readonly AuthCountry[] = [
  { code: '503', nationalLength: 8, nationalPattern: /^[267]\d{7}$/ }, // El Salvador: fijo 2, celular 6/7
  { code: '502', nationalLength: 8, nationalPattern: /^[2-7]\d{7}$/ }, // Guatemala: fijo 2/6/7, celular 3-5
  { code: '504', nationalLength: 8, nationalPattern: /^[2-9]\d{7}$/ }, // Honduras: fijo 2, celular 3/7/8/9
  { code: '52', nationalLength: 10, nationalPattern: /^[2-9]\d{9}$/ }, // México: área nunca 0/1
  { code: '1', nationalLength: 10, nationalPattern: /^[2-9]\d{9}$/ }, // US/NANP: área nunca 0/1
] as const

/**
 * Rechaza configuraciones con códigos duplicados (fail-fast al cargar el
 * módulo). Exportada para que el check la pruebe con listas inválidas.
 */
export function assertNoDuplicateCodes(countries: readonly AuthCountry[]): void {
  const codes = countries.map((c) => c.code)
  if (new Set(codes).size !== codes.length) {
    throw new Error('AUTH_COUNTRIES: códigos de país duplicados en la configuración')
  }
}
assertNoDuplicateCodes(AUTH_COUNTRIES)

/**
 * Detecta el país de una cadena de dígitos E.164 (sin '+'): evalúa los
 * códigos ordenados AUTOMÁTICAMENTE de mayor a menor longitud y escoge el
 * código válido MÁS LARGO cuya longitud total calce. No depende del orden
 * de declaración. Exportada para que el check pruebe la selección con
 * listas reordenadas.
 */
export function findCountryForDigits(
  digits: string,
  countries: readonly AuthCountry[] = AUTH_COUNTRIES,
): AuthCountry | null {
  const byLongestCode = [...countries].sort((a, b) => b.code.length - a.code.length)
  for (const country of byLongestCode) {
    if (
      digits.startsWith(country.code) &&
      digits.length === country.code.length + country.nationalLength
    ) {
      return country
    }
  }
  return null
}

/** País por defecto para números LOCALES (sin código): El Salvador. */
const LOCAL_DEFAULT: AuthCountry = AUTH_COUNTRIES.find((c) => c.code === '503')!

/**
 * Normaliza cualquier entrada admitida al E.164 de Supabase Auth.
 *
 * Reglas (vinculantes, AUTH-P1A):
 *   1. devuelve E.164 con '+' (p. ej. '+50378627694');
 *   2. elimina espacios, guiones, paréntesis y puntos;
 *   3. PRESERVA un prefijo internacional habilitado que ya venga (+503/+502/
 *      +504/+52/+1), validando longitud Y patrón nacional;
 *   4. agrega '+' cuando recibe un código habilitado sin el signo;
 *   5. asume +503 ÚNICAMENTE ante un número local salvadoreño exacto
 *      (misma regla nacional que se aplica tras retirar '503');
 *   6. RECHAZA (null) toda entrada ambigua o inválida, sin reinterpretarla
 *      como salvadoreña.
 */
export function toAuthPhone(input: string | null | undefined): string | null {
  if (input == null) return null
  const cleaned = input.trim().replace(/[\s\-().]/g, '')
  if (!cleaned) return null
  const hasPlus = cleaned.startsWith('+')
  const digits = hasPlus ? cleaned.slice(1) : cleaned
  if (!/^\d+$/.test(digits)) return null

  // Reglas 3 y 4: prefijo habilitado (con o sin '+') → misma validación
  // nacional que un número local de ese país. El matching escoge el código
  // válido más largo, independiente del orden de declaración.
  const country = findCountryForDigits(digits)
  if (country) {
    const national = digits.slice(country.code.length)
    return country.nationalPattern.test(national) ? `+${digits}` : null
  }

  // Un '+' explícito con código no habilitado o longitud errada → inválido.
  if (hasPlus) return null

  // Regla 5: local salvadoreño exacto, sin código de país.
  if (
    digits.length === LOCAL_DEFAULT.nationalLength &&
    LOCAL_DEFAULT.nationalPattern.test(digits)
  ) {
    return `+${LOCAL_DEFAULT.code}${digits}`
  }

  // Regla 6: ambiguo o inválido.
  return null
}

/**
 * Representación interna del teléfono AUTENTICADO: valida/canonicaliza con
 * `toAuthPhone` y recién después retira el '+'. Si el teléfono devuelto por
 * Supabase no puede canonicalizarse → null (el caller NO ejecuta
 * side-effects y cierra la sesión de forma segura).
 */
export function toAppPhone(authUserPhone: string | null | undefined): string | null {
  const e164 = toAuthPhone(authUserPhone)
  return e164 ? e164.slice(1) : null
}
