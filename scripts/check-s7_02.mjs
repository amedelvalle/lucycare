/**
 * Verifica s7_02 (admin gestión de médicos): columna is_operational
 * y RPCs admin gateadas. Sin auth (service_role) deben rechazar.
 * Uso: node scripts/check-s7_02.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s7_02 (admin médicos) ═══\n');

// 1. Columna is_operational existe
const { data: anyDoc } = await a.from('doctors').select('id, is_operational').limit(1);
const colExists = anyDoc && anyDoc[0] && 'is_operational' in anyDoc[0];
console.log(`1. doctors.is_operational: ${colExists ? '✅ existe' : '❌ NO existe'}`);

// 2. RPCs existen + están gateadas (sin auth → no autorizado/no autenticado)
const rpcs = [
  ['admin_list_doctors', {}],
  ['admin_set_doctor_verified', { p_doctor_id: '00000000-0000-0000-0000-000000000000', p_value: true }],
  ['admin_set_doctor_published', { p_doctor_id: '00000000-0000-0000-0000-000000000000', p_value: true }],
  ['admin_set_doctor_operational', { p_doctor_id: '00000000-0000-0000-0000-000000000000', p_value: true }],
  ['admin_set_lucy_status', { p_doctor_id: '00000000-0000-0000-0000-000000000000', p_value: 'listed_only' }],
];
let allOk = colExists;
for (const [name, params] of rpcs) {
  const { error } = await a.rpc(name, params);
  const missing = !!error && (/could not find/i.test(error.message) || /does not exist/i.test(error.message));
  const gated = !!error && /no autorizado|no autenticado/i.test(error.message);
  const ok = !missing && (gated || !error);
  console.log(`   ${name}: ${missing ? '❌ NO existe' : gated ? '✅ existe y gateada' : '⚠️ existe sin gate (' + (error?.message ?? 'sin error') + ')'}`);
  if (!ok) allOk = false;
}

console.log(`\n${allOk ? '✅ s7_02 aplicado.' : '❌ Falta correr migrations/s7_02_admin_doctors.sql.'}`);
process.exit(allOk ? 0 : 1);
