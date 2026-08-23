/**
 * _qa-s7_73-cleanup-user.mjs — verificación y borrado del auth.user técnico
 * de la QA de ADMIN-DOCTOR-SEED-P0.
 *
 * ⚠️ NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA DEL OWNER.
 *
 *   A) dry-run — ANTES del cleanup SQL, no borra nada:
 *      node scripts/_qa-s7_73-cleanup-user.mjs \
 *        --project-ref <ref> --operation-id <uuid> --seed-user-id <uuid>
 *
 *   C) borrado — DESPUÉS del COMMIT del cleanup SQL:
 *      ... --confirm
 *
 * ── CÓMO LOCALIZA AL USUARIO ──
 * `getUserById`. **NUNCA `listUsers`** —que además no enumera todo el padrón,
 * deuda conocida— y **NUNCA por SQL sobre `auth.users`**.
 *
 * ── CREDENCIAL ──
 * Exige `SUPABASE_SECRET_KEY` con la secret key MODERNA (`sb_secret_…`).
 *
 * **NO lee `SUPABASE_SERVICE_ROLE_KEY`**: ese nombre arrastra la semántica de
 * las legacy API keys, que en este proyecto están DESHABILITADAS y deben seguir
 * así. No hay fallback a esa variable, ni siquiera si existe.
 *
 * La secret **jamás se imprime**: de ella solo se reporta el prefijo de familia
 * (`sb_secret_`) y nada más.
 *
 * ── FAIL-CLOSED ──
 * Antes de borrar exige SIETE coincidencias. Si cualquiera falla, se detiene y
 * no borra nada. `audit_log` no se toca: es inmutable desde `s7_71b` y es la
 * evidencia de la QA.
 */
import { createClient } from '@supabase/supabase-js';
import { loadLocalEnv } from './_lib/env.mjs';

loadLocalEnv();

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : null;
};
const CONFIRMED = process.argv.includes('--confirm');
const PROJECT_REF = arg('--project-ref');
const OPERATION_ID = arg('--operation-id');
const SEED_USER_ID = arg('--seed-user-id');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let fallos = 0;
const check = (desc, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${desc}${ok || !extra ? '' : ` — ${extra}`}`);
  if (!ok) fallos++;
};
const abortar = (msg) => {
  console.error(`\n⛔ STOP: ${msg}\n   No se borró nada.\n`);
  process.exit(1);
};

console.log(`\n_qa-s7_73-cleanup-user — ${CONFIRMED ? 'BORRADO' : 'dry-run (no borra)'}\n`);

if (!PROJECT_REF) abortar('falta --project-ref <ref>');
if (!OPERATION_ID || !UUID.test(OPERATION_ID)) abortar('falta --operation-id <uuid> válido');
if (!SEED_USER_ID || !UUID.test(SEED_USER_ID)) abortar('falta --seed-user-id <uuid> válido');

// ── Credencial: solo la moderna, y bajo su propio nombre ──
const url = process.env.SUPABASE_URL;
if (!url) abortar('falta SUPABASE_URL');

const key = process.env.SUPABASE_SECRET_KEY;
if (!key) {
  abortar(
    'falta SUPABASE_SECRET_KEY.\n' +
    '   Este script NO acepta SUPABASE_SERVICE_ROLE_KEY: ese nombre arrastra la\n' +
    '   semántica de las legacy API keys, deshabilitadas en este proyecto.\n' +
    '   Agregá SUPABASE_SECRET_KEY=<la secret key moderna sb_secret_…> a .env.local.',
  );
}
if (key.startsWith('eyJ')) abortar('SUPABASE_SECRET_KEY trae una legacy API key (JWT). Rechazado.');
if (!key.startsWith('sb_secret_')) abortar('SUPABASE_SECRET_KEY no tiene el prefijo `sb_secret_`.');

console.log('  Entorno:\n');
// El ref sale de la URL; se exige que el operador lo declare y que coincida.
const refDeLaUrl = (url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] ?? null;
check('0. proyecto Supabase correcto', refDeLaUrl === PROJECT_REF, `url=${refDeLaUrl} · arg=${PROJECT_REF}`);
check('   credencial = secret key moderna', true, '');
console.log('      familia: sb_secret_ (el valor NO se imprime)');
if (fallos > 0) abortar('el proyecto no coincide con --project-ref');

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// ── Localización: por id, jamás listUsers ──
const { data, error } = await sb.auth.admin.getUserById(SEED_USER_ID);
if (error) abortar(`getUserById falló: ${error.message}`);
const user = data?.user;
if (!user) {
  if (CONFIRMED) {
    console.log('\n  ℹ️  El usuario ya no existe: nada que borrar.\n');
    process.exit(0);
  }
  abortar('el usuario no existe. Si esperabas encontrarlo, revisá el seed_user_id.');
}

// ── SIETE guardas. Todas deben coincidir. ──
const emailEsperado = `seed-${OPERATION_ID}@doctor-seed.invalid`;
const meta = user.app_metadata ?? {};
const baneadoHasta = user.banned_until ? new Date(user.banned_until) : null;

console.log('\n  Guardas de identidad:\n');
check('1. el id coincide con --seed-user-id', user.id === SEED_USER_ID, user.id);
check('2. email determinístico', user.email === emailEsperado, user.email ?? '(sin email)');
check('3. app_metadata.lucy_seed_doctor = true', meta.lucy_seed_doctor === true, JSON.stringify(meta.lucy_seed_doctor));
check('4. app_metadata.seed_operation_id coincide', meta.seed_operation_id === OPERATION_ID, String(meta.seed_operation_id));
check('5. usuario baneado', !!baneadoHasta && baneadoHasta > new Date(), user.banned_until ?? '(sin ban)');
check('6. phone NULL', !user.phone, user.phone ? '(tiene teléfono)' : '');

if (fallos > 0) {
  abortar(`${fallos} guarda(s) no coinciden. Este usuario NO es la fixture de la QA.`);
}

console.log('\n  ✅ Todas las guardas coinciden: es la identidad técnica de la QA.\n');

if (!CONFIRMED) {
  console.log('  ⏸️  dry-run: no se borró nada.');
  console.log('     Continuar con el cleanup SQL (paso B) y recién después --confirm.\n');
  process.exit(0);
}

const { error: delErr } = await sb.auth.admin.deleteUser(SEED_USER_ID);
if (delErr) abortar(`deleteUser falló: ${delErr.message}`);

// ── Verificación posterior ──
const { data: post } = await sb.auth.admin.getUserById(SEED_USER_ID);
const borrado = !post?.user;
console.log(`  ${borrado ? '✅' : '❌'} getUserById confirma que la identidad ya no existe`);
console.log('  ℹ️  el profile cascadeó por la FK profiles.id → auth.users(id).');
console.log('  ℹ️  audit_log se conserva: inmutable y evidencia de la QA.\n');

process.exit(borrado ? 0 : 1);
