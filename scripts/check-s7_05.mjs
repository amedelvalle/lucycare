/**
 * Verifica s7_05: RPCs de edición admin (B2-A).
 * Uso: node scripts/check-s7_05.mjs
 */

import { supabaseAdmin as a } from './_lib/supabase-admin.mjs';
console.log('═══ Verificando s7_05 (edición admin médico) ═══\n');

const rpcs = [
  ['admin_get_doctor_detail', { p_doctor_id: '00000000-0000-0000-0000-000000000000' }],
  ['admin_update_doctor_profile', { p_doctor_id: '00000000-0000-0000-0000-000000000000', p_full_name: 'x', p_email: null, p_phone: null }],
  ['admin_update_doctor_clinic', { p_doctor_id: '00000000-0000-0000-0000-000000000000', p_name: 'x', p_address: null, p_phone: null }],
  ['admin_update_doctor_info', { p_doctor_id: '00000000-0000-0000-0000-000000000000', p_specialty_id: null, p_bio: null }],
];

let allOk = true;
for (const [name, params] of rpcs) {
  const { error } = await a.rpc(name, params);
  const missing = !!error && (/could not find/i.test(error.message) || /does not exist/i.test(error.message));
  const gated = !!error && /no autorizado/i.test(error.message);
  console.log(`  ${name}: ${missing ? '❌ NO existe' : gated ? '✅ existe y gateada' : '⚠️ existe sin gate (' + (error?.message ?? 'sin error') + ')'}`);
  if (missing || !gated) allOk = false;
}

console.log(`\n${allOk ? '✅ s7_05 aplicado.' : '❌ Falta correr migrations/s7_05_admin_edit_doctor.sql.'}`);
process.exit(allOk ? 0 : 1);
