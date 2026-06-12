/**
 * Verifica s7_45: F4-1 — claim tolerante fila por fila.
 *
 * Sanity liviano (sin sesión de usuario):
 *  1. Columnas pasivas `patients.merged_into_patient_id` + `merged_at` existen.
 *  2. CHECK anti self-reference funciona (merged_into <> id) y la FK rechaza
 *     ids inexistentes — con fixture propia + cleanup.
 *  3. `claim_patient_records` existe y exige sesión (28000; firma intacta).
 *  4. anon NO puede ejecutar la RPC (REVOKE).
 *
 * Verificación funcional real (tolerancia por fila / skips / audit / merged):
 *   node scripts/_smoke-s7_45.mjs  (sesión QA + fixtures + cleanup)
 *
 * Uso: node scripts/check-s7_45.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_45 (claim tolerante fila por fila) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

const NOT_FOUND = (e) =>
  /could not find function|does not exist|PGRST202/i.test(e?.message || '') || e?.code === '42883';
const NO_AUTH = (e) =>
  /iniciar sesión|no autenticado/i.test(e?.message || '') || e?.code === '28000';

// 1. Columnas pasivas
{
  const { error } = await admin.from('patients').select('merged_into_patient_id, merged_at').limit(1);
  if (error) fail('Columnas merged_into_patient_id/merged_at NO existen: ' + error.message);
  else pass('Columnas patients.merged_into_patient_id + merged_at existen');
}

// 2. CHECK anti self-reference + FK (fixture temporal, cleanup garantizado)
{
  let fixtureId = null;
  try {
    const { data: clinic } = await admin.from('clinics').select('id').limit(1).single();
    const { data: fx, error: fxErr } = await admin.from('patients').insert({
      clinic_id: clinic.id, profile_id: null, full_name: 'S745 check fixture',
      document_type: 'dui', document_number: null, date_of_birth: '1990-01-01',
      gender: 'otro', patient_type: 'privado', phone: null, is_active: false,
    }).select('id').single();
    if (fxErr) throw new Error('fixture: ' + fxErr.message);
    fixtureId = fx.id;

    const { error: selfErr } = await admin.from('patients')
      .update({ merged_into_patient_id: fixtureId }).eq('id', fixtureId);
    if (selfErr && (selfErr.code === '23514' || /patients_merged_into_not_self/i.test(selfErr.message)))
      pass('CHECK anti self-reference activo (23514)');
    else if (selfErr) fail('self-reference rechazada con error inesperado: ' + selfErr.code + ' ' + selfErr.message);
    else fail('self-reference ACEPTADA (el CHECK no existe)');

    const BOGUS = '00000000-0000-0000-0000-000000000000';
    const { error: fkErr } = await admin.from('patients')
      .update({ merged_into_patient_id: BOGUS }).eq('id', fixtureId);
    if (fkErr && fkErr.code === '23503') pass('FK merged_into → patients(id) activa (23503)');
    else if (fkErr) fail('FK rechazó con error inesperado: ' + fkErr.code + ' ' + fkErr.message);
    else fail('FK ACEPTÓ un id inexistente');
  } catch (e) {
    fail('No se pudo verificar CHECK/FK: ' + e.message);
  } finally {
    if (fixtureId) await admin.from('patients').delete().eq('id', fixtureId);
  }
}

// 3. claim_patient_records existe, firma intacta, exige sesión
{
  const { error } = await admin.rpc('claim_patient_records');
  if (!error) fail('claim_patient_records respondió OK sin sesión (esperábamos 28000).');
  else if (NO_AUTH(error)) pass('claim_patient_records existe y exige sesión (28000)');
  else if (NOT_FOUND(error)) fail('claim_patient_records NO existe → ¿migración s7_45 aplicada? ' + error.message);
  else fail('claim_patient_records error inesperado: ' + (error.code || '') + ' ' + error.message);
}

// 4. anon sin EXECUTE
{
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await anon.rpc('claim_patient_records');
  if (error) pass('anon NO puede ejecutar claim_patient_records (' + (error.code || 'error') + ')');
  else fail('anon PUDO ejecutar claim_patient_records');
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_45.mjs');
console.log('     (sin colisión vincula todo · colisión NO aborta el claim · skip auditado ·');
console.log('      ficha intacta sin media-copia · merged/rechazadas excluidas · idempotente).\n');

console.log(`${allOk ? '✅ s7_45 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_45 con fallas'}`);
process.exit(allOk ? 0 : 1);
