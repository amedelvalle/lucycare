/**
 * Verifica s7_43: B2 — confirmación post-claim de fichas vinculadas.
 *
 * Sanity liviano (sin sesión de usuario):
 *  1. Columna `patients.link_confirmed_at` existe.
 *  2. Tabla `patient_link_rejections` existe y NO es legible por anon (RLS
 *     admin-only; anon debe recibir error o 0 filas).
 *  3. RPCs `confirm_patient_link` / `reject_patient_link` existen y rechazan
 *     sin sesión (service_role → auth.uid() NULL → '28000' / no autenticado).
 *  4. `claim_patient_records` sigue existiendo (no-regresión de firma).
 *
 * Verificación funcional real (confirm/reject/no-relink/no-regresión):
 *   node scripts/_smoke-s7_43.mjs  (sesión del paciente test, fixtures + cleanup)
 *
 * Uso: node scripts/check-s7_43.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_43 (confirmación post-claim) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

const NOT_FOUND = (e) =>
  /could not find function|does not exist|PGRST202/i.test(e?.message || '') || e?.code === '42883';
const NO_AUTH = (e) =>
  /iniciar sesión|no autenticado/i.test(e?.message || '') || e?.code === '28000';

// 1. Columna
{
  const { error } = await admin.from('patients').select('link_confirmed_at').limit(1);
  if (error) fail('Columna patients.link_confirmed_at NO existe: ' + error.message);
  else pass('Columna patients.link_confirmed_at existe');
}

// 2. Tabla + RLS anon
{
  const { error } = await admin.from('patient_link_rejections').select('id').limit(1);
  if (error) fail('Tabla patient_link_rejections NO existe: ' + error.message);
  else pass('Tabla patient_link_rejections existe');

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: anonData, error: anonErr } = await anon.from('patient_link_rejections').select('id').limit(1);
  if (anonErr || (anonData ?? []).length === 0) pass('anon no lee patient_link_rejections (RLS)');
  else fail('anon PUDO leer patient_link_rejections: ' + JSON.stringify(anonData));
}

// 3. RPCs nuevas
const BOGUS = '00000000-0000-0000-0000-000000000000';
for (const fn of ['confirm_patient_link', 'reject_patient_link']) {
  const { error } = await admin.rpc(fn, { p_patient_id: BOGUS });
  if (!error) fail(`${fn} respondió OK sin sesión (esperábamos 28000).`);
  else if (NO_AUTH(error)) pass(`${fn} existe y exige sesión (${error.code || ''})`);
  else if (NOT_FOUND(error)) fail(`${fn} NO existe → ¿migración s7_43 aplicada? ${error.message}`);
  else fail(`${fn} error inesperado: ${error.code || ''} ${error.message}`);
}

// 4. claim_patient_records sigue existiendo
{
  const { error } = await admin.rpc('claim_patient_records');
  if (!error) fail('claim_patient_records respondió OK sin sesión (esperábamos 28000).');
  else if (NO_AUTH(error)) pass('claim_patient_records existe y exige sesión (no-regresión)');
  else if (NOT_FOUND(error)) fail('claim_patient_records NO existe (¡regresión!): ' + error.message);
  else fail('claim_patient_records error inesperado: ' + (error.code || '') + ' ' + error.message);
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_43.mjs');
console.log('     (claim vincula sin confirmar · confirm sella+audita · reject desvincula+pending_review ·');
console.log('      re-claim NO re-vincula lo rechazado · otro profile SÍ puede · gate fichas ajenas).\n');

console.log(`${allOk ? '✅ s7_43 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_43 con fallas'}`);
process.exit(allOk ? 0 : 1);
