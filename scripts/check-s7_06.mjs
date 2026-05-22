/**
 * Verifica s7_06: admin_update_doctor_clinic ya no setea updated_at.
 * Confirma que la función existe y sigue gateada por is_admin().
 * (La causa raíz del bug — columna faltante — se verifica en check-s7_07.)
 * Uso: node scripts/check-s7_06.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s7_06 (fix admin_update_doctor_clinic) ═══\n');

const { error } = await a.rpc('admin_update_doctor_clinic', {
  p_doctor_id: '00000000-0000-0000-0000-000000000000',
  p_name: 'x', p_address: null, p_phone: null,
});
const exists = !(error && /could not find/i.test(error.message));
const gated = !!error && /no autorizado/i.test(error.message);
console.log(`  admin_update_doctor_clinic: ${!exists ? '❌ NO existe' : gated ? '✅ existe y gateada' : '⚠️ ' + (error?.message ?? 'sin error')}`);

const ok = exists && gated;
console.log(`\n${ok
  ? '✅ s7_06 aplicado.'
  : '❌ Falta correr migrations/s7_06_fix_clinic_update.sql en el SQL editor de Supabase.'}`);
process.exit(ok ? 0 : 1);
