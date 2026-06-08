/**
 * Verifica s7_42: afiliación — médico desde paciente existente.
 *
 * Sanity liviano (sin sesión de usuario): ambas RPCs exigen is_admin().
 * Con service_role auth.uid() es NULL → no es admin → deben rechazar (42501).
 * Eso prueba que existen (migración aplicada) y que el gate funciona. Si no
 * existieran, el error sería "could not find function" (PGRST202 / 42883).
 *
 * Verificación funcional real (new / reuse_patient / block_doctor + asserts de
 * seguridad): node scripts/_smoke-s7_42.mjs (sesión admin, fixtures + cleanup).
 *
 * Uso: node scripts/check-s7_42.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_42 (afiliación: médico desde paciente existente) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

const NOT_FOUND = (e) =>
  /could not find function|does not exist|PGRST202/i.test(e?.message || '') || e?.code === '42883';
const DENIED = (e) => /No autorizado/i.test(e?.message || '') || e?.code === '42501';

const BOGUS = '00000000-0000-0000-0000-000000000000';

for (const [fn, args] of [
  ['admin_affiliation_preflight', { p_request_id: BOGUS }],
  ['admin_approve_and_create_doctor', { p_request_id: BOGUS, p_overrides: {} }],
]) {
  const { error } = await admin.rpc(fn, args);
  if (!error) fail(`${fn} respondió OK con service_role (esperábamos rechazo is_admin / 42501).`);
  else if (DENIED(error)) pass(`${fn} existe y rechaza a no-admin (${error.code || ''})`);
  else if (NOT_FOUND(error)) fail(`${fn} NO existe → ¿migración s7_42 aplicada? ${error.message}`);
  else fail(`${fn} error inesperado: ${error.code || ''} ${error.message}`);
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_42.mjs');
console.log('     (new crea cuenta · reuse_patient vincula sin nuevo auth.user · block_doctor P0010 ·');
console.log('      asserts: role sigue patient, doctor listed_only/flags false, audit reused=true).\n');

console.log(`${allOk ? '✅ s7_42 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_42 con fallas'}`);
process.exit(allOk ? 0 : 1);
