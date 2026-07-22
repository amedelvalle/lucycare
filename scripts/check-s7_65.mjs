/**
 * check-s7_65.mjs — AUTH-P1B1A: paridad frontend ↔ SQL + estructura.
 *
 *   node scripts/check-s7_65.mjs
 *
 * ── SIN service_role ──
 * 1. PARIDAD REAL frontend ↔ SQL, automatizada: la MISMA fuente única de
 *    casos (scripts/_lib/auth-phone-cases.mjs) se evalúa contra
 *      · el módulo REAL src/lib/authPhone.ts (transpilado con el esbuild
 *        que ya trae Vite), y
 *      · la función REAL public.auth_phone_e164 vía RPC con la anon key
 *        (invocable a propósito: participa en índices funcionales y CHECKs
 *        de tablas operativas).
 *    Se exige `frontend === sql === expected` para cada caso.
 * 2. LÍMITE DE LONGITUD: entradas excesivamente largas → NULL en ambos.
 * 3. DENEGACIONES: el hook NO es invocable por anon ni authenticated, y las
 *    tablas nuevas no tienen acceso para esos roles.
 * 4. SINCRONÍA del bloque §G de docs/OWNER_S7_65_VERIFY.md con la fuente
 *    única (el owner ejecuta ahí la misma matriz dentro del SQL Editor).
 *
 * Requiere s7_65 APLICADA.
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseAnon } from './_lib/supabase-anon.mjs';
import { AUTH_PHONE_CASES } from './_lib/auth-phone-cases.mjs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DOCTOR_PHONE = '+50378627694'; // Camilo — solo para obtener una sesión authenticated (no se crea ni escribe nada)
const OTP = '123456';
const DOC_PATH = 'docs/OWNER_S7_65_VERIFY.md';

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const no = (m) => { console.log(`  ❌ ${m}`); fail++; };

// ─── Módulo frontend REAL ───────────────────────────────────
const require = createRequire(import.meta.url);
const esbuildBin = path.join(path.dirname(require.resolve('esbuild/package.json')), 'bin', 'esbuild');
const outFile = path.join(os.tmpdir(), `authPhone-s765-${Date.now()}.mjs`);
execFileSync(process.execPath, [
  esbuildBin, 'src/lib/authPhone.ts', '--format=esm', `--outfile=${outFile}`,
], { stdio: 'pipe' });
const { toAuthPhone } = await import(pathToFileURL(outFile).href);

/** Parsea las filas `(n, 'entrada', 'esperado')` del PRIMER bloque VALUES de §G. */
function parseDocCases(md) {
  const g = md.slice(md.indexOf('## G. Paridad'));
  const body = g.slice(g.indexOf('VALUES'), g.indexOf('), evaluado AS ('));
  const rows = [];
  const re = /\(\s*(\d+)\s*,\s*(NULL|'(?:[^']|'')*')\s*,\s*(NULL|'(?:[^']|'')*')\s*\)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const lit = (v) => (v === 'NULL' ? null : v.slice(1, -1).replace(/''/g, "'"));
    rows.push({ n: Number(m[1]), input: lit(m[2]), expected: lit(m[3]) });
  }
  return rows;
}

async function main() {
  console.log('\ncheck-s7_65 — paridad frontend ↔ SQL + estructura (AUTH-P1B1A)\n');

  // ─── 1. PARIDAD REAL: frontend === sql === esperado ──────
  for (const c of AUTH_PHONE_CASES) {
    const fe = toAuthPhone(c.input);
    const { data, error } = await supabaseAnon.rpc('auth_phone_e164', { p_input: c.input });
    if (error) {
      no(`paridad ${JSON.stringify(c.input)}: RPC falló (${error.code}) — ¿s7_65 sin aplicar / sin EXECUTE para anon?`);
      continue;
    }
    const sql = data ?? null;
    if (fe === sql && sql === c.expected)
      ok(`paridad ${JSON.stringify(c.input)} → ${JSON.stringify(sql)} — ${c.desc}`);
    else
      no(`DIVERGENCIA ${JSON.stringify(c.input)}: frontend=${JSON.stringify(fe)} sql=${JSON.stringify(sql)} esperado=${JSON.stringify(c.expected)}`);
  }

  // ─── 2. Límite temprano de longitud ──────────────────────
  {
    const long = '+503' + '7'.repeat(200);
    const fe = toAuthPhone(long);
    const { data, error } = await supabaseAnon.rpc('auth_phone_e164', { p_input: long });
    if (error) no(`límite de longitud: RPC falló (${error.code})`);
    else if (fe === null && (data ?? null) === null) ok('entrada excesivamente larga → NULL en frontend y SQL');
    else no(`límite de longitud: frontend=${JSON.stringify(fe)} sql=${JSON.stringify(data)}`);
  }

  // ─── 3. Denegaciones ─────────────────────────────────────
  {
    const { error } = await supabaseAnon.rpc('hook_before_user_created', { event: {} });
    if (error && error.code !== 'PGRST202') ok(`hook denegado a anon (${error.code})`);
    else if (error?.code === 'PGRST202') ok('hook no expuesto a anon (PGRST202)');
    else no('anon EJECUTÓ el hook — CRÍTICO');
  }
  for (const t of ['auth_creation_grants', 'booking_intents']) {
    const { error } = await supabaseAnon.from(t).select('id').limit(1);
    if (error) ok(`${t} sin acceso para anon (${error.code})`);
    else no(`anon accedió a ${t} — CRÍTICO`);
  }
  {
    const cli = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await cli.auth.signInWithOtp({ phone: DOCTOR_PHONE }).catch(() => {});
    const { error: authErr } = await cli.auth.verifyOtp({ phone: DOCTOR_PHONE, token: OTP, type: 'sms' });
    if (authErr) {
      no(`no se pudo obtener sesión authenticated: ${authErr.message}`);
    } else {
      const { data: fnData, error: fnErr } = await cli.rpc('auth_phone_e164', { p_input: '78627694' });
      if (!fnErr && fnData === '+50378627694')
        ok('authenticated SÍ ejecuta auth_phone_e164 (necesaria para índices/CHECKs)');
      else no(`authenticated no pudo ejecutar auth_phone_e164 (${fnErr?.code ?? fnData}) — rompería INSERT/UPDATE de tablas indexadas`);

      const { error: hookErr } = await cli.rpc('hook_before_user_created', { event: {} });
      if (hookErr) ok(`hook denegado a authenticated (${hookErr.code})`);
      else no('authenticated EJECUTÓ el hook — CRÍTICO');

      for (const t of ['auth_creation_grants', 'booking_intents']) {
        const { data, error } = await cli.from(t).select('id').limit(1);
        if (error) ok(`${t} sin acceso para authenticated (${error.code})`);
        else if ((data?.length ?? 0) === 0) no(`${t}: authenticated no fue denegado (0 filas por RLS, pero el GRANT existe)`);
        else no(`authenticated LEYÓ filas de ${t} — CRÍTICO`);
      }
      await cli.auth.signOut().catch(() => {});
    }
  }

  // ─── 3b. Grants de service_role / ausencia de niveles admin ──
  // Verificación ESTÁTICA de la migración (el check no usa service_role, y
  // PostgREST no expone has_*_privilege de otro rol de forma genérica). La
  // verificación RUNTIME de privilegios efectivos de service_role vive en
  // §B del bloque del owner. Acá se confirma que la fuente declara los
  // grants correctos y NINGÚN grant a directory_editor/operations_admin.
  {
    const MIG = 'migrations/s7_65_auth_eligibility_hook.sql';
    let sql = null;
    try { sql = fs.readFileSync(MIG, 'utf8'); } catch { no(`no se pudo leer ${MIG}`); }
    if (sql) {
      // SQL sin comentarios (línea `-- …` y bloque `/* … */`): las búsquedas
      // de GRANT deben mirar SENTENCIAS reales, no documentación/asserts de
      // ausencia. Los grants que sí verificamos no contienen comentarios
      // inline, así que quitarlos no los afecta.
      const sqlCode = sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ')   // bloques /* ... */
        .replace(/--[^\n]*/g, ' ');           // líneas -- ...
      const has = (re) => re.test(sql);
      if (has(/GRANT EXECUTE ON FUNCTION public\.auth_phone_e164\(text\) TO service_role/))
        ok('migración: EXECUTE de auth_phone_e164 a service_role declarado');
      else no('migración: falta GRANT EXECUTE auth_phone_e164 → service_role');

      for (const t of ['auth_creation_grants', 'booking_intents']) {
        const re = new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON public\\.${t} TO service_role`);
        if (has(re)) ok(`migración: SELECT/INSERT/UPDATE/DELETE de ${t} a service_role declarado`);
        else no(`migración: falta GRANT completo de ${t} → service_role`);
      }

      // Ningún GRANT REAL a los niveles admin acotados (s7_57) — se busca
      // sobre el SQL SIN comentarios y solo en sentencias `GRANT … TO … rol`
      // (una mención en un comentario o un REVOKE no debe disparar el fallo).
      for (const rol of ['directory_editor', 'operations_admin']) {
        const grantTo = new RegExp(`GRANT[^;]*\\bTO\\b[^;]*\\b${rol}\\b`, 'i');
        if (!grantTo.test(sqlCode)) ok(`migración: sin GRANT real a ${rol}`);
        else no(`migración: hay un GRANT a ${rol} — CRÍTICO (no debe recibir acceso)`);
      }

      // anon/authenticated: solo REVOKE sobre las tablas (ningún GRANT de
      // tabla). Se confirma que no hay una línea GRANT ... TO anon/authenticated
      // sobre las dos tablas nuevas.
      const badGrant = /GRANT[^;]+ON public\.(auth_creation_grants|booking_intents)[^;]+TO (anon|authenticated)/;
      if (!badGrant.test(sqlCode)) ok('migración: sin GRANT de tabla a anon/authenticated sobre las tablas nuevas');
      else no('migración: hay un GRANT de tabla a anon/authenticated — CRÍTICO');
    }
  }

  // ─── 4. Sincronía §G del documento del owner ─────────────
  {
    let md = null;
    try { md = fs.readFileSync(DOC_PATH, 'utf8'); } catch { no(`no se pudo leer ${DOC_PATH}`); }
    if (md) {
      const docCases = parseDocCases(md);
      if (docCases.length === AUTH_PHONE_CASES.length)
        ok(`§G tiene los ${docCases.length} casos de la fuente única`);
      else
        no(`§G tiene ${docCases.length} casos y la fuente única ${AUTH_PHONE_CASES.length} — DESINCRONIZADO`);

      const mismatches = AUTH_PHONE_CASES.filter((c, i) => {
        const d = docCases[i];
        return !d || d.input !== c.input || d.expected !== c.expected;
      }).length;
      if (mismatches === 0) ok('§G coincide caso a caso con la fuente única (entrada + esperado)');
      else no(`§G difiere en ${mismatches} caso(s) — regenerar el bloque desde la fuente única`);
    }
  }

  try { fs.unlinkSync(outFile); } catch { /* tmp */ }
  console.log(`\n${fail === 0 ? '✅' : '❌'} check-s7_65: pass=${pass} fail=${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error inesperado:', e.message); process.exit(1); });
