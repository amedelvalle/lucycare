/**
 * Verifica s7_47: F4-3-search — RPC de descubrimiento de candidatos a merge.
 *
 * Sanity liviano (sin sesión de usuario):
 *  1. `admin_list_patient_merge_candidates` existe y exige admin
 *     (service_role → auth.uid() NULL → is_admin() false → P0001).
 *  2. anon NO puede ejecutarla (REVOKE).
 *
 * Verificación funcional real (grupos / filtros / warnings): sesión admin →
 *   node scripts/_smoke-s7_47.mjs
 *
 * Uso: node scripts/check-s7_47.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_47 (candidatos a merge) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

const NOT_FOUND = (e) =>
  /could not find function|does not exist|PGRST202/i.test(e?.message || '') || e?.code === '42883';
const IS_ADMIN_GATE = (e) =>
  e?.code === 'P0001' || /administrador de plataforma/i.test(e?.message || '');

// 1. Existe + exige admin (service_role tiene auth.uid() NULL → P0001)
{
  const { error } = await admin.rpc('admin_list_patient_merge_candidates');
  if (!error) fail('admin_list_patient_merge_candidates respondió OK sin admin (esperábamos P0001).');
  else if (IS_ADMIN_GATE(error)) pass('admin_list_patient_merge_candidates existe y exige admin (P0001)');
  else if (NOT_FOUND(error)) fail('admin_list_patient_merge_candidates NO existe → ¿s7_47 aplicada? ' + error.message);
  else fail('error inesperado: ' + (error.code || '') + ' ' + error.message);
}

// 2. anon sin EXECUTE
{
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await anon.rpc('admin_list_patient_merge_candidates');
  if (error) pass('anon NO puede ejecutar admin_list_patient_merge_candidates (' + (error.code || 'error') + ')');
  else fail('anon PUDO ejecutar admin_list_patient_merge_candidates');
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_47.mjs');
console.log('     (grupo E3 listado · conteos · profiles distintos / clínica distinta / merged / walk-in no listados ·');
console.log('      warning W_UNCONFIRMED_LINK · read-only sin cambiar datos).\n');

console.log(`${allOk ? '✅ s7_47 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_47 con fallas'}`);
process.exit(allOk ? 0 : 1);
