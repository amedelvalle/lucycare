#!/usr/bin/env node
/**
 * check-directory-booking-ready.mjs — BOOKING-READY-REGRESSION
 *
 * Prueba CONDUCTUAL de `fetchDoctorBookingReady`: transpila el servicio REAL con
 * esbuild y lo EJECUTA contra un `fetch` instrumentado. No lee texto del código:
 * mide si la petición sale y qué devuelve el helper.
 *
 * Existe por un defecto concreto que llegó a producción tras s7_85. El helper
 * extraía el método a una variable —`const rpc = supabase.rpc`— y lo llamaba
 * suelto, así que `this` quedaba en `undefined` y reventaba ANTES de emitir la
 * petición. Ningún perfil público ofrecía reserva. `tsc` y `build` pasaban: el
 * fallo es de runtime, y no había una sola prueba que ejercitara este helper.
 *
 * Lo que se afirma acá, en este orden:
 *   1. con la implementación vigente la petición RPC SALE de verdad;
 *   2. el patrón desligado REPRODUCE el fallo (control A/B invertido);
 *   3. `false` → reserva cerrada;
 *   4. `true`  → reserva abierta;
 *   5. un error del proveedor → fail closed (lanza, no devuelve `true`).
 *
 *   node scripts/check-directory-booking-ready.mjs
 *
 * No toca la red real ni la base de datos: el `fetch` global está sustituido.
 */
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const esbuildBin = path.join(
  path.dirname(require.resolve('esbuild/package.json')), 'bin', 'esbuild',
);

let pass = 0, fail = 0;
const check = (label, actual, esperado) => {
  const ok = actual === esperado;
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else {
    fail++;
    console.log(`  FAIL ${label}\n         esperaba: ${JSON.stringify(esperado)}\n         obtuvo  : ${JSON.stringify(actual)}`);
  }
};

console.log('\ncheck-directory-booking-ready — la RPC de reservabilidad sale de verdad\n');

const FIXTURE_URL = 'https://fixture.supabase.co';
const DOCTOR_ID = '11111111-2222-3333-4444-555555555555';

// ═══════════════════════════════════════════════════════════
// `fetch` instrumentado — SE INSTALA ANTES DE IMPORTAR NADA
// ═══════════════════════════════════════════════════════════
// postgrest-js resuelve el `fetch` al CONSTRUIR el cliente, y el cliente se
// construye al importar `src/lib/supabase.ts`. Si el stub se instalara después
// del import, mediría el fetch equivocado.
const llamadas = [];
let siguiente = { status: 200, body: 'true' };

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  llamadas.push({ url, method: init.method ?? 'GET', body: init.body ?? null });
  return new Response(siguiente.body, {
    status: siguiente.status,
    headers: { 'Content-Type': 'application/json' },
  });
};

/** Reinicia el instrumento entre escenarios. */
function preparar(status, body) {
  llamadas.length = 0;
  siguiente = { status, body };
}

// ═══════════════════════════════════════════════════════════
// Transpilación del servicio REAL
// ═══════════════════════════════════════════════════════════
// `--packages=external` deja las dependencias fuera: empaquetar el cliente de
// Supabase rompe con `Dynamic require of "stream"`, porque es CJS.
const cacheDir = path.join('node_modules', '.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const out = path.join(cacheDir, `bookready-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);

execFileSync(process.execPath, [
  esbuildBin, 'src/services/directory.service.ts',
  '--bundle', '--format=esm', '--platform=node', '--packages=external',
  '--alias:@/lib=./src/lib',
  `--define:import.meta.env.VITE_SUPABASE_URL="${FIXTURE_URL}"`,
  '--define:import.meta.env.VITE_SUPABASE_ANON_KEY="fixture-anon-key"',
  '--define:import.meta.env.VITE_CAPTCHA_ENABLED=""',
  '--define:import.meta.env.VITE_TURNSTILE_SITE_KEY=""',
  `--outfile=${out}`,
], { stdio: ['ignore', 'ignore', 'inherit'] });

const svc = await import(pathToFileURL(path.resolve(out)).href);
check('el servicio exporta fetchDoctorBookingReady',
  typeof svc.fetchDoctorBookingReady, 'function');

// ═══════════════════════════════════════════════════════════
// 1 · LA PETICIÓN SALE DE VERDAD  ← la regresión que motiva el check
// ═══════════════════════════════════════════════════════════
console.log('\n1 · la petición RPC se emite');
{
  preparar(200, 'true');
  // El defecto original LANZA acá. Se captura a propósito para que el check
  // reporte un FAIL legible en vez de morir con un stack: quien lo corra debe
  // leer «la llamada no lanza», no descifrar una traza.
  let error1 = null;
  try { await svc.fetchDoctorBookingReady(DOCTOR_ID); }
  catch (e) { error1 = e; }

  check('la llamada no lanza', error1 === null ? null : String(error1?.message), null);
  check('se emitió exactamente 1 petición', llamadas.length, 1);
  // Sin petición, los tres checks siguientes deben FALLAR con un valor legible,
  // no reventar por desreferenciar `undefined`.
  const c = llamadas[0] ?? { url: '(ninguna)', method: '(ninguna)', body: '{}' };
  check('va al endpoint RPC correcto',
    c.url, `${FIXTURE_URL}/rest/v1/rpc/doctor_booking_ready`);
  check('es POST', c.method, 'POST');
  check('lleva el doctor en el cuerpo',
    JSON.parse(c.body ?? '{}').p_doctor_id, DOCTOR_ID);
}

// ═══════════════════════════════════════════════════════════
// 2 · CONTROL A/B — el patrón desligado REPRODUCE el fallo
// ═══════════════════════════════════════════════════════════
// Sin este bloque el check no probaría nada: hay que demostrar que sabe
// distinguir la implementación correcta de la que rompió producción.
console.log('\n2 · A/B: ligado vs desligado (expectativa invertida)');
{
  const { createClient } = await import('@supabase/supabase-js');
  const cli = createClient(FIXTURE_URL, 'fixture-anon-key');
  const args = { p_doctor_id: DOCTOR_ID };

  // B · desligado: es el defecto. Debe lanzar y NO emitir nada.
  preparar(200, 'true');
  let lanzoDesligado = false;
  try {
    const suelto = cli.rpc;
    await suelto('doctor_booking_ready', args);
  } catch { lanzoDesligado = true; }
  check('desligado LANZA', lanzoDesligado, true);
  check('desligado no emite NINGUNA petición', llamadas.length, 0);

  // A · ligado: no lanza y sí emite. Es el control de sanidad — si esto
  // fallara, el bloque anterior no estaría midiendo el binding.
  preparar(200, 'true');
  let lanzoLigado = false;
  try {
    await cli.rpc.bind(cli)('doctor_booking_ready', args);
  } catch { lanzoLigado = true; }
  check('ligado NO lanza', lanzoLigado, false);
  check('ligado sí emite la petición', llamadas.length, 1);
}

// ═══════════════════════════════════════════════════════════
// 3 · `false` → reserva CERRADA
// ═══════════════════════════════════════════════════════════
console.log('\n3 · false cierra la reserva');
{
  preparar(200, 'false');
  check('devuelve false', await svc.fetchDoctorBookingReady(DOCTOR_ID), false);
  check('y la petición salió igual', llamadas.length, 1);
}

// ═══════════════════════════════════════════════════════════
// 4 · `true` → reserva ABIERTA
// ═══════════════════════════════════════════════════════════
console.log('\n4 · true abre la reserva');
{
  preparar(200, 'true');
  check('devuelve true', await svc.fetchDoctorBookingReady(DOCTOR_ID), true);
}

// ═══════════════════════════════════════════════════════════
// 5 · FAIL CLOSED ante cualquier otra cosa
// ═══════════════════════════════════════════════════════════
// La comparación es `data === true`. Todo lo demás debe cerrar la reserva, y un
// error del proveedor debe LANZAR para que React Query lo marque como fallo —
// jamás devolver `true` por omisión.
console.log('\n5 · fail closed');
{
  preparar(403, JSON.stringify({
    code: '42501', message: 'permission denied for function doctor_booking_ready',
    details: null, hint: null,
  }));
  let lanzo = false;
  try { await svc.fetchDoctorBookingReady(DOCTOR_ID); } catch { lanzo = true; }
  check('un error del proveedor LANZA', lanzo, true);

  preparar(200, 'null');
  check('null NO abre la reserva', await svc.fetchDoctorBookingReady(DOCTOR_ID), false);

  preparar(200, '"true"');
  check('la CADENA "true" no abre la reserva',
    await svc.fetchDoctorBookingReady(DOCTOR_ID), false);

  preparar(200, '1');
  check('el número 1 no abre la reserva',
    await svc.fetchDoctorBookingReady(DOCTOR_ID), false);
}

// ═══════════════════════════════════════════════════════════
// GUARDA ESTÁTICA — el patrón desligado no puede volver
// ═══════════════════════════════════════════════════════════
// Se mide SOLO sobre código ejecutable: el comentario que explica el defecto
// nombra el patrón a propósito, y no debe contar como violación. Se filtran
// líneas de comentario completas, NO con un regex global de `//`, que se comería
// las barras de los literales de URL.
console.log('\nguarda estática (solo código ejecutable)');
{
  const src = fs.readFileSync(
    path.join('src', 'services', 'directory.service.ts'), 'utf8',
  ).split('\r\n').join('\n');

  const ejecutable = src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');

  check('el helper liga el método con .bind(supabase)',
    /supabase\.rpc\.bind\(supabase\)/.test(ejecutable), true);
  check('no queda ningún `supabase.rpc` extraído sin ligar',
    /=\s*supabase\.rpc\s+as/.test(ejecutable), false);

  // CONTROL DE SANIDAD: la guarda debe cazar el patrón si reapareciera. Si esto
  // fallara, el filtro de comentarios estaría vaciando el texto medido.
  const mutado = ejecutable.replace('supabase.rpc.bind(supabase)', 'supabase.rpc');
  check('control: la guarda caza el patrón desligado si vuelve',
    /=\s*supabase\.rpc\s+as/.test(mutado), true);
}

fs.rmSync(out, { force: true });

console.log(`\n${pass} ok · ${fail} FAIL   (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
