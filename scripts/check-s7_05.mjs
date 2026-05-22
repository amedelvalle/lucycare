/**
 * Verifica s7_05: RPCs de edición admin (B2-A).
 * Uso: node scripts/check-s7_05.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

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
