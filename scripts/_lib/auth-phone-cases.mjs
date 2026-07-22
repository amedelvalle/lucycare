/**
 * FUENTE ÚNICA de casos del normalizador de teléfonos de autenticación.
 *
 * Consumida por:
 *   - scripts/check-auth-p1a-phone.mjs  (AUTH-P1A: frontend toAuthPhone)
 *   - scripts/check-s7_65.mjs           (AUTH-P1B1A: paridad frontend ↔ SQL)
 *   - docs/OWNER_S7_65_VERIFY.md §G     (bloque SQL generado desde esta lista)
 *
 * `expected` es el comportamiento PINEADO (contrato del normalizador). Toda
 * implementación —frontend o SQL— debe coincidir con él Y entre sí. NO
 * duplicar esta lista en ningún otro archivo: si un caso nuevo hace falta,
 * se agrega ACÁ y los tres consumidores lo toman automáticamente.
 */
export const AUTH_PHONE_CASES = [
  // ── El Salvador: E.164, con código sin '+', y locales ──
  { input: '+50378627694', expected: '+50378627694', desc: 'SV E.164 completo → se preserva' },
  { input: '50378627694', expected: '+50378627694', desc: 'SV con código sin + → se agrega +' },
  { input: '78627694', expected: '+50378627694', desc: 'SV local celular 7… → asume +503' },
  { input: '61234567', expected: '+50361234567', desc: 'SV local celular 6… → asume +503' },
  { input: '22601234', expected: '+50322601234', desc: 'SV local fijo 2… → asume +503' },

  // ── Consistencia local ↔ prefijado (misma regla nacional) ──
  { input: '12345678', expected: null, desc: '8 díg. que no son local SV (1…) → rechaza' },
  { input: '50312345678', expected: null, desc: 'nacional inválido con 503 → rechaza' },
  { input: '+50312345678', expected: null, desc: 'nacional inválido con +503 → rechaza' },
  { input: '91234567', expected: null, desc: '8 díg. 9… → rechaza (no SV plausible)' },
  { input: '+50391234567', expected: null, desc: 'nacional 9… con +503 → rechaza' },

  // ── Guatemala ──
  { input: '+50255551234', expected: '+50255551234', desc: 'GT E.164 → conserva Guatemala' },
  { input: '50255551234', expected: '+50255551234', desc: 'GT sin + → conserva Guatemala' },
  { input: '+50295551234', expected: null, desc: 'GT nacional inválido (9…) → rechaza' },

  // ── Honduras ──
  { input: '+50499887766', expected: '+50499887766', desc: 'HN E.164 → conserva Honduras' },
  { input: '50499887766', expected: '+50499887766', desc: 'HN sin + → conserva Honduras' },

  // ── México ──
  { input: '+525512345678', expected: '+525512345678', desc: 'MX E.164 (10 nac.) → conserva México' },
  { input: '525512345678', expected: '+525512345678', desc: 'MX sin + → conserva México' },
  { input: '+521512345678', expected: null, desc: 'MX área inválida (1…) → rechaza' },
  { input: '+52551234567', expected: null, desc: 'MX con 9 nac. → rechaza (longitud)' },

  // ── Estados Unidos / NANP ──
  { input: '+14155550100', expected: '+14155550100', desc: 'US E.164 (10 nac.) → conserva US' },
  { input: '14155550100', expected: '+14155550100', desc: 'US sin + → conserva US' },
  { input: '+11234567890', expected: null, desc: 'US área inválida (1…) → rechaza' },

  // ── Limpieza de separadores ──
  { input: '+503 7862-7694', expected: '+50378627694', desc: 'espacios y guion → limpia' },
  { input: '(503) 7862 7694', expected: '+50378627694', desc: 'paréntesis → limpia' },
  { input: '2260-1234', expected: '+50322601234', desc: 'guion en local → limpia' },

  // ── Longitud incorrecta ──
  { input: '+5037862769', expected: null, desc: '+503 con 7 nac. → rechaza' },
  { input: '+503786276941', expected: null, desc: '+503 con 9 nac. → rechaza' },
  { input: '5037862769412', expected: null, desc: '503… longitud errada sin + → rechaza' },

  // ── Prefijo no habilitado / caracteres inválidos / vacíos ──
  { input: '+9791234567', expected: null, desc: '+ código NO habilitado → rechaza sin reinterpretar' },
  { input: '78627694x', expected: null, desc: 'letras → rechaza' },
  { input: '', expected: null, desc: 'vacío → null' },
  { input: '   ', expected: null, desc: 'solo espacios → null' },
  { input: null, expected: null, desc: 'null → null' },

  // ── Corte temprano de longitud (idéntico en frontend y SQL: 32) ──
  { input: '+503 7 8 6 2 - 7 6 9 4                    ', expected: null, desc: '> 32 caracteres → null antes de limpiar/regex' },
  { input: '+5037862769470000000000000000000000', expected: null, desc: '> 32 caracteres numéricos → null' },
];

/** Casos de `toAppPhone` (frontend): derivación desde E.164 validado. */
export const APP_PHONE_CASES = [
  { input: '50378627694', expected: '50378627694', desc: 'GoTrue SV (sin +)' },
  { input: '+50378627694', expected: '50378627694', desc: 'E.164 SV' },
  { input: '525512345678', expected: '525512345678', desc: 'GoTrue MX' },
  { input: '12345678', expected: null, desc: 'no canonicalizable → null' },
  { input: 'garbage', expected: null, desc: 'basura → null' },
  { input: null, expected: null, desc: 'null → null' },
  { input: '', expected: null, desc: 'vacío → null' },
];
