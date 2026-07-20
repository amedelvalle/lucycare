/**
 * check-auth-p1a-phone.mjs — prueba del normalizador REAL de AUTH-P1A.
 *
 *   node scripts/check-auth-p1a-phone.mjs
 *
 * Importa las funciones REALES de `src/lib/authPhone.ts` (transpiladas con
 * el esbuild que ya trae Vite — NO se duplica la implementación en este
 * check) y ejecuta la tabla entrada → salida.
 *
 * Sin red, sin Supabase, sin service_role, sin datos: es un check puro del
 * módulo de normalización.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ─── Transpilar el módulo REAL a un .mjs temporal ───────────
const require = createRequire(import.meta.url);
const esbuildBin = path.join(
  path.dirname(require.resolve('esbuild/package.json')),
  'bin',
  'esbuild',
);
const outFile = path.join(os.tmpdir(), `authPhone-check-${Date.now()}.mjs`);
execFileSync(process.execPath, [
  esbuildBin,
  'src/lib/authPhone.ts',
  '--format=esm',
  `--outfile=${outFile}`,
], { stdio: 'pipe' });

const {
  toAuthPhone,
  toAppPhone,
  AUTH_COUNTRIES,
  assertNoDuplicateCodes,
  findCountryForDigits,
} = await import(pathToFileURL(outFile).href);

let pass = 0;
let fail = 0;
const check = (desc, got, expected) => {
  const ok = got === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${desc} → ${JSON.stringify(got)}${ok ? '' : ` (esperado ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
};

console.log('\ncheck-auth-p1a-phone — normalizador real (src/lib/authPhone.ts)\n');
console.log(`  países habilitados: ${AUTH_COUNTRIES.map((c) => '+' + c.code).join(' ')}\n`);

// ─── toAuthPhone: SV local, 503 y +503 (consistencia) ───────
check('SV +503 E.164', toAuthPhone('+50378627694'), '+50378627694');
check('SV 503 sin +', toAuthPhone('50378627694'), '+50378627694');
check('SV local celular 7…', toAuthPhone('78627694'), '+50378627694');
check('SV local celular 6…', toAuthPhone('61234567'), '+50361234567');
check('SV local fijo 2…', toAuthPhone('22601234'), '+50322601234');
// Consistencia local ↔ prefijado: la MISMA regla nacional en ambas formas.
check('nacional inválido local (12345678)', toAuthPhone('12345678'), null);
check('nacional inválido con 503 (50312345678)', toAuthPhone('50312345678'), null);
check('nacional inválido con +503 (+50312345678)', toAuthPhone('+50312345678'), null);
check('nacional 9… local', toAuthPhone('91234567'), null);
check('nacional 9… con +503', toAuthPhone('+50391234567'), null);

// ─── GT / HN / MX / US, con y sin + ─────────────────────────
check('GT +502', toAuthPhone('+50255551234'), '+50255551234');
check('GT 502', toAuthPhone('50255551234'), '+50255551234');
check('GT nacional inválido (+50295551234)', toAuthPhone('+50295551234'), null);
check('HN +504', toAuthPhone('+50499887766'), '+50499887766');
check('HN 504', toAuthPhone('50499887766'), '+50499887766');
check('MX +52 (10 nac.)', toAuthPhone('+525512345678'), '+525512345678');
check('MX 52', toAuthPhone('525512345678'), '+525512345678');
check('MX nacional inválido (+521512345678)', toAuthPhone('+521512345678'), null);
check('US +1 (10 nac.)', toAuthPhone('+14155550100'), '+14155550100');
check('US 1', toAuthPhone('14155550100'), '+14155550100');
check('US área inválida (+11234567890)', toAuthPhone('+11234567890'), null);

// ─── Limpieza de separadores ────────────────────────────────
check('espacios y guion', toAuthPhone('+503 7862-7694'), '+50378627694');
check('paréntesis', toAuthPhone('(503) 7862 7694'), '+50378627694');
check('guion local', toAuthPhone('2260-1234'), '+50322601234');

// ─── Longitud incorrecta ────────────────────────────────────
check('+503 con 7 nac.', toAuthPhone('+5037862769'), null);
check('+503 con 9 nac.', toAuthPhone('+503786276941'), null);
check('503… longitud errada sin +', toAuthPhone('5037862769412'), null);
check('MX con 9 nac.', toAuthPhone('+52551234567'), null);

// ─── Prefijo incorrecto / caracteres inválidos / vacíos ─────
check('+ código no habilitado', toAuthPhone('+9791234567'), null);
check('letras', toAuthPhone('78627694x'), null);
check('vacío', toAuthPhone(''), null);
check('solo espacios', toAuthPhone('   '), null);
check('null', toAuthPhone(null), null);

// ─── toAppPhone: únicamente sobre E.164 válido ──────────────
check('appPhone desde GoTrue SV (sin +)', toAppPhone('50378627694'), '50378627694');
check('appPhone desde E.164 SV', toAppPhone('+50378627694'), '50378627694');
check('appPhone desde GoTrue MX', toAppPhone('525512345678'), '525512345678');
check('appPhone rechaza no canonicalizable', toAppPhone('12345678'), null);
check('appPhone rechaza basura', toAppPhone('garbage'), null);
check('appPhone null', toAppPhone(null), null);
check('appPhone vacío', toAppPhone(''), null);

// ─── C2: matching de país (config como única fuente de verdad) ──
{
  // Unicidad de códigos: la config real es única; una lista con duplicado
  // debe rechazarse (fail-fast).
  const codes = AUTH_COUNTRIES.map((c) => c.code);
  check('unicidad de códigos en la config real', new Set(codes).size === codes.length, true);
  let threw = false;
  try {
    assertNoDuplicateCodes([...AUTH_COUNTRIES, AUTH_COUNTRIES[0]]);
  } catch {
    threw = true;
  }
  check('lista con código duplicado → rechazada', threw, true);

  // Selección por prefijo más largo, independiente del orden de declaración:
  // la MISMA entrada resuelve al MISMO país con la lista declarada, invertida
  // y con los códigos cortos primero.
  const reversed = [...AUTH_COUNTRIES].reverse();
  const shortestFirst = [...AUTH_COUNTRIES].sort((a, b) => a.code.length - b.code.length);
  for (const [digits, expectedCode] of [
    ['50378627694', '503'], // 11 dígitos: debe elegir 503 (largo), jamás 5/50
    ['50255551234', '502'],
    ['50499887766', '504'],
    ['525512345678', '52'],
    ['14155550100', '1'],
    ['5031234567', null],   // longitud que no calza con ningún código → null
  ]) {
    const a = findCountryForDigits(digits)?.code ?? null;
    const b = findCountryForDigits(digits, reversed)?.code ?? null;
    const c = findCountryForDigits(digits, shortestFirst)?.code ?? null;
    check(`match '${digits}' (orden declarado)`, a, expectedCode);
    check(`match '${digits}' (orden invertido)`, b, expectedCode);
    check(`match '${digits}' (cortos primero)`, c, expectedCode);
  }
}

// ─── C1: probeSessionState — los CUATRO estados etiquetados ──
// Se transpila y prueba el módulo REAL (src/lib/sessionState.ts) con probes
// controlados que provocan cada resultado.
{
  const ssFile = path.join(os.tmpdir(), `sessionState-check-${Date.now()}.mjs`);
  execFileSync(process.execPath, [
    esbuildBin, 'src/lib/sessionState.ts', '--format=esm', `--outfile=${ssFile}`,
  ], { stdio: 'pipe' });
  const { probeSessionState } = await import(pathToFileURL(ssFile).href);

  check("estado 'none' (completada, sin sesión)",
    await probeSessionState(async () => ({ data: { session: null } }), 500), 'none');
  check("estado 'present' (completada, con sesión)",
    await probeSessionState(async () => ({ data: { session: { user: { id: 'x' } } } }), 500), 'present');
  check("estado 'error' (probe lanza)",
    await probeSessionState(async () => { throw new Error('boom'); }, 500), 'error');
  check("estado 'error' (campo error sin lanzar)",
    await probeSessionState(async () => ({ data: { session: null }, error: new Error('e') }), 500), 'error');
  check("estado 'timeout' (probe nunca resuelve)",
    await probeSessionState(() => new Promise(() => {}), 100), 'timeout');

  try { fs.unlinkSync(ssFile); } catch { /* tmp */ }
}

// ─── Contextos de OTP: shouldCreateUser aprobado (estructural) ──
// Bundle del SERVICIO REAL (auth.service.ts) con env dummy (el cliente se
// instancia pero no se usa: solo se lee el mapa exportado).
{
  if (!globalThis.localStorage) {
    const mem = new Map();
    globalThis.localStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
      clear: () => mem.clear(),
      key: (i) => [...mem.keys()][i] ?? null,
      get length() { return mem.size; },
    };
  }
  const svcFile = path.join(os.tmpdir(), `auth-service-check-${Date.now()}.mjs`);
  execFileSync(process.execPath, [
    esbuildBin, 'src/services/auth.service.ts', '--bundle', '--platform=node',
    '--format=esm', '--external:@supabase/supabase-js',
    `--define:import.meta.env.VITE_SUPABASE_URL=${JSON.stringify('http://localhost:54321')}`,
    `--define:import.meta.env.VITE_SUPABASE_ANON_KEY=${JSON.stringify('dummy-key-check')}`,
    `--outfile=${svcFile}`,
  ], { stdio: 'pipe' });
  const { OTP_SHOULD_CREATE_USER } = await import(pathToFileURL(svcFile).href);

  const APPROVED = { login: true, booking: true, claim: true, activation: true, recovery: false };
  for (const [ctx, expected] of Object.entries(APPROVED)) {
    check(`contexto '${ctx}' → shouldCreateUser=${expected} (mapa aprobado)`, OTP_SHOULD_CREATE_USER[ctx], expected);
  }
  check('sin contextos extra no aprobados',
    Object.keys(OTP_SHOULD_CREATE_USER).sort().join(','), Object.keys(APPROVED).sort().join(','));

  try { fs.unlinkSync(svcFile); } catch { /* tmp */ }
}

// ─── Cleanup del artefacto temporal ─────────────────────────
try { fs.unlinkSync(outFile); } catch { /* tmp */ }

console.log(`\n${fail === 0 ? '✅' : '❌'} check-auth-p1a-phone: pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
