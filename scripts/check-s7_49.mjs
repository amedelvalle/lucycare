/**
 * Verifica s7_49: F4-3b V1 — backend de la bandeja de vínculos rechazados.
 *
 * Sanity liviano (sin sesión de usuario):
 *  1. RPCs `admin_list_patient_link_rejections` / `admin_resolve_link_rejection`
 *     existen y exigen admin (service_role → auth.uid() NULL → is_admin() false → P0001).
 *  2. anon NO puede ejecutar las RPCs (REVOKE).
 *  3. Columna `patient_link_rejections.resolution_note` presente.
 *
 * Verificación funcional real: node scripts/_smoke-s7_49.mjs (sesión admin).
 *
 * Uso: node scripts/check-s7_49.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_49 (bandeja de vínculos rechazados) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

const NOT_FOUND = (e) =>
  e?.code === 'PGRST202' || e?.code === '42883' ||
  /could not find (the )?function|does not exist/i.test(e?.message || '');
const IS_ADMIN_GATE = (e) =>
  e?.code === 'P0001' || /administrador de plataforma/i.test(e?.message || '');

const BOGUS = '00000000-0000-0000-0000-0000f4900049';

// 1. RPCs existen y exigen admin
{
  const { error: e1 } = await admin.rpc('admin_list_patient_link_rejections', { p_status: null });
  if (!e1) fail('admin_list_patient_link_rejections respondió OK sin admin (esperábamos P0001).');
  else if (IS_ADMIN_GATE(e1)) pass('admin_list_patient_link_rejections existe y exige admin (P0001)');
  else if (NOT_FOUND(e1)) fail('admin_list_patient_link_rejections NO existe → ¿s7_49 aplicada? ' + e1.message);
  else fail('list error inesperado: ' + (e1.code || '') + ' ' + e1.message);

  const { error: e2 } = await admin.rpc('admin_resolve_link_rejection', {
    p_rejection_id: BOGUS, p_resolution_note: 'motivo de prueba suficientemente largo', p_reopen: false,
  });
  if (!e2) fail('admin_resolve_link_rejection respondió OK sin admin (esperábamos P0001).');
  else if (IS_ADMIN_GATE(e2)) pass('admin_resolve_link_rejection existe y exige admin (P0001)');
  else if (NOT_FOUND(e2)) fail('admin_resolve_link_rejection NO existe → ¿s7_49 aplicada? ' + e2.message);
  else fail('resolve error inesperado: ' + (e2.code || '') + ' ' + e2.message);
}

// 2. anon sin EXECUTE
{
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: e3 } = await anon.rpc('admin_list_patient_link_rejections', { p_status: null });
  if (e3) pass('anon NO puede ejecutar admin_list_patient_link_rejections (' + (e3.code || 'error') + ')');
  else fail('anon PUDO ejecutar admin_list_patient_link_rejections');

  const { error: e4 } = await anon.rpc('admin_resolve_link_rejection', {
    p_rejection_id: BOGUS, p_resolution_note: 'xxxxxxxxxxxx', p_reopen: false,
  });
  if (e4) pass('anon NO puede ejecutar admin_resolve_link_rejection (' + (e4.code || 'error') + ')');
  else fail('anon PUDO ejecutar admin_resolve_link_rejection');
}

// 3. Columna resolution_note presente
{
  const { error } = await admin.from('patient_link_rejections').select('resolution_note').limit(1);
  if (error) fail('Columna patient_link_rejections.resolution_note ausente: ' + error.message);
  else pass('Columna patient_link_rejections.resolution_note presente (s7_49)');
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_49.mjs');
console.log('     (list pending · resolver motivo<10 → P0081 · resolver OK + audit ·');
console.log('      reabrir OK + audit · rechazo inexistente → P0080 · ficha intacta · 0 residuales).\n');

console.log(`${allOk ? '✅ s7_49 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_49 con fallas'}`);
process.exit(allOk ? 0 : 1);
