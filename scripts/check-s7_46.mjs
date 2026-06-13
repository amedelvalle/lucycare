/**
 * Verifica s7_46: F4-2 — backend del merge admin de fichas.
 *
 * Sanity liviano (sin sesión de usuario):
 *  1. Tabla `patient_merge_log` existe y NO es legible por anon (RLS admin-only).
 *  2. RPCs `admin_merge_patients_preflight` / `admin_merge_patients` existen y
 *     exigen admin (service_role → auth.uid() NULL → is_admin() false → P0001).
 *  3. anon NO puede ejecutar las RPCs (REVOKE).
 *  4. Los dos guards contienen el bypass `app.merging_patients` (se verifica
 *     indirectamente: las RPCs existen; la prueba real es el smoke con sesión
 *     admin que mueve una consulta firmada y neutraliza una fuente vinculada).
 *  5. Columnas pasivas de s7_45 presentes (`merged_into_patient_id`/`merged_at`).
 *
 * Verificación funcional real: node scripts/_smoke-s7_46.mjs (sesión admin).
 *
 * Uso: node scripts/check-s7_46.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_46 (merge admin de fichas) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

const NOT_FOUND = (e) =>
  /could not find function|does not exist|PGRST202/i.test(e?.message || '') || e?.code === '42883';
const IS_ADMIN_GATE = (e) =>
  e?.code === 'P0001' || /administrador de plataforma/i.test(e?.message || '');

const BOGUS_A = '00000000-0000-0000-0000-00000000000a';
const BOGUS_B = '00000000-0000-0000-0000-00000000000b';

// 1. Tabla + RLS anon
{
  const { error } = await admin.from('patient_merge_log').select('id').limit(1);
  if (error) fail('Tabla patient_merge_log NO existe: ' + error.message);
  else pass('Tabla patient_merge_log existe');

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: anonData, error: anonErr } = await anon.from('patient_merge_log').select('id').limit(1);
  if (anonErr || (anonData ?? []).length === 0) pass('anon no lee patient_merge_log (RLS)');
  else fail('anon PUDO leer patient_merge_log: ' + JSON.stringify(anonData));

  // Columnas pasivas s7_45 (base del merge)
  const { error: colErr } = await admin.from('patients').select('merged_into_patient_id, merged_at').limit(1);
  if (colErr) fail('Columnas merged_* (s7_45) ausentes: ' + colErr.message);
  else pass('Columnas patients.merged_into_patient_id + merged_at presentes (s7_45)');
}

// 2 + 3. RPCs existen y exigen admin (service_role tiene auth.uid() NULL → P0001)
{
  const { error: e1 } = await admin.rpc('admin_merge_patients_preflight', {
    p_source_id: BOGUS_A, p_target_id: BOGUS_B,
  });
  if (!e1) fail('admin_merge_patients_preflight respondió OK sin admin (esperábamos P0001).');
  else if (IS_ADMIN_GATE(e1)) pass('admin_merge_patients_preflight existe y exige admin (P0001)');
  else if (NOT_FOUND(e1)) fail('admin_merge_patients_preflight NO existe → ¿s7_46 aplicada? ' + e1.message);
  else fail('preflight error inesperado: ' + (e1.code || '') + ' ' + e1.message);

  const { error: e2 } = await admin.rpc('admin_merge_patients', {
    p_source_id: BOGUS_A, p_target_id: BOGUS_B, p_reason: 'motivo de prueba suficientemente largo',
  });
  if (!e2) fail('admin_merge_patients respondió OK sin admin (esperábamos P0001).');
  else if (IS_ADMIN_GATE(e2)) pass('admin_merge_patients existe y exige admin (P0001)');
  else if (NOT_FOUND(e2)) fail('admin_merge_patients NO existe → ¿s7_46 aplicada? ' + e2.message);
  else fail('merge error inesperado: ' + (e2.code || '') + ' ' + e2.message);

  // anon sin EXECUTE
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: e3 } = await anon.rpc('admin_merge_patients', {
    p_source_id: BOGUS_A, p_target_id: BOGUS_B, p_reason: 'xxxxxxxxxxxx',
  });
  if (e3) pass('anon NO puede ejecutar admin_merge_patients (' + (e3.code || 'error') + ')');
  else fail('anon PUDO ejecutar admin_merge_patients');
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_46.mjs');
console.log('     (dry-run · merge · bloqueos P0060/P0065/P0067/P0063 · borrador target warning ·');
console.log('      consulta firmada movida · P0030 bypass · neutralización · claim ignora · no hard-delete).\n');

console.log(`${allOk ? '✅ s7_46 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_46 con fallas'}`);
process.exit(allOk ? 0 : 1);
