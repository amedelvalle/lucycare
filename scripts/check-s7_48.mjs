/**
 * Verifica s7_48: F4 — Unmerge formal de fichas (reversa del merge admin).
 *
 * Sanity liviano (sin sesión de usuario):
 *  1. RPCs `admin_unmerge_patients_preflight` / `admin_unmerge_patients` existen
 *     y exigen admin (service_role → auth.uid() NULL → is_admin() false → P0001).
 *  2. anon NO puede ejecutar las RPCs (REVOKE).
 *  3. Columnas de reversa `unmerged_at`/`unmerged_by`/`unmerge_reason` presentes
 *     en `patient_merge_log` (base s7_46; el unmerge solo las rellena).
 *
 * El bypass `app.unmerging_patients` en los dos guards y toda la lógica de
 * bloqueos/reversa se valida en el smoke con sesión admin:
 *   node scripts/_smoke-s7_48.mjs
 *
 * Uso: node scripts/check-s7_48.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_48 (unmerge formal de fichas) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

const NOT_FOUND = (e) =>
  e?.code === 'PGRST202' || e?.code === '42883' ||
  /could not find (the )?function|does not exist/i.test(e?.message || '');
const IS_ADMIN_GATE = (e) =>
  e?.code === 'P0001' || /administrador de plataforma/i.test(e?.message || '');

const BOGUS = '00000000-0000-0000-0000-0000f48f0048';

// 1. RPCs existen y exigen admin
{
  const { error: e1 } = await admin.rpc('admin_unmerge_patients_preflight', { p_merge_log_id: BOGUS });
  if (!e1) fail('admin_unmerge_patients_preflight respondió OK sin admin (esperábamos P0001).');
  else if (IS_ADMIN_GATE(e1)) pass('admin_unmerge_patients_preflight existe y exige admin (P0001)');
  else if (NOT_FOUND(e1)) fail('admin_unmerge_patients_preflight NO existe → ¿s7_48 aplicada? ' + e1.message);
  else fail('preflight error inesperado: ' + (e1.code || '') + ' ' + e1.message);

  const { error: e2 } = await admin.rpc('admin_unmerge_patients', {
    p_merge_log_id: BOGUS, p_reason: 'motivo de prueba suficientemente largo',
  });
  if (!e2) fail('admin_unmerge_patients respondió OK sin admin (esperábamos P0001).');
  else if (IS_ADMIN_GATE(e2)) pass('admin_unmerge_patients existe y exige admin (P0001)');
  else if (NOT_FOUND(e2)) fail('admin_unmerge_patients NO existe → ¿s7_48 aplicada? ' + e2.message);
  else fail('unmerge error inesperado: ' + (e2.code || '') + ' ' + e2.message);
}

// 2. anon sin EXECUTE
{
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: e3 } = await anon.rpc('admin_unmerge_patients', {
    p_merge_log_id: BOGUS, p_reason: 'xxxxxxxxxxxx',
  });
  if (e3) pass('anon NO puede ejecutar admin_unmerge_patients (' + (e3.code || 'error') + ')');
  else fail('anon PUDO ejecutar admin_unmerge_patients');

  const { error: e4 } = await anon.rpc('admin_unmerge_patients_preflight', { p_merge_log_id: BOGUS });
  if (e4) pass('anon NO puede ejecutar admin_unmerge_patients_preflight (' + (e4.code || 'error') + ')');
  else fail('anon PUDO ejecutar admin_unmerge_patients_preflight');
}

// 3. Columnas de reversa presentes (base s7_46)
{
  const { error } = await admin.from('patient_merge_log').select('unmerged_at, unmerged_by, unmerge_reason').limit(1);
  if (error) fail('Columnas unmerge_* ausentes en patient_merge_log: ' + error.message);
  else pass('Columnas patient_merge_log.unmerged_at/unmerged_by/unmerge_reason presentes (s7_46)');
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_48.mjs');
console.log('     (happy path · P0071 · P0073 · P0074 · P0075 · P0077 · warning historia nueva ·');
console.log('      consulta firmada devuelta · audit admin_unmerge · 0 residuales).\n');

console.log(`${allOk ? '✅ s7_48 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_48 con fallas'}`);
process.exit(allOk ? 0 : 1);
