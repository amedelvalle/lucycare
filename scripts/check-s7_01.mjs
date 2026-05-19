/**
 * Verifica s7_01 (cimientos admin): is_admin(), vista
 * admin_platform_stats, RPC get_platform_stats() gateada.
 * Uso: node scripts/check-s7_01.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s7_01 (cimientos Admin) ═══\n');

// 1. RPC get_platform_stats existe y está gateada (sin auth → rechaza)
const { error: rpcErr } = await a.rpc('get_platform_stats');
const rpcMissing =
  !!rpcErr &&
  (/could not find/i.test(rpcErr.message) || /does not exist/i.test(rpcErr.message));
const rpcGated =
  !!rpcErr && /no autenticado|no autorizado/i.test(rpcErr.message);
console.log(`1. RPC get_platform_stats: ${rpcMissing ? '❌ NO existe' : '✅ existe'}`);
console.log(`2. Gate (sin auth rechaza): ${rpcGated ? '✅ OK' : (rpcMissing ? '—' : '❌ no gateó')}`);
if (rpcErr) console.log(`   ↳ ${rpcErr.message}`);

// 3. Vista admin_platform_stats (service_role la lee directo)
const { data: stats, error: viewErr } = await a
  .from('admin_platform_stats')
  .select('*')
  .single();
const viewOk = !viewErr && !!stats;
console.log(`3. Vista admin_platform_stats: ${viewOk ? '✅ OK' : '❌ ' + (viewErr?.message ?? 'sin datos')}`);
if (viewOk) {
  console.log(
    `   médicos=${stats.doctors_total} publicados=${stats.doctors_published} ` +
    `pacientes=${stats.patients_total} citas=${stats.appointments_total} ` +
    `firmadas=${stats.consultations_signed} reseñas=${stats.reviews_total} ` +
    `score=${stats.reviews_avg_score}`
  );
}

const ok = !rpcMissing && rpcGated && viewOk;
console.log(`\n${ok ? '✅ s7_01 aplicado.' : '❌ Falta correr migrations/s7_01_admin_foundation.sql.'}`);
process.exit(ok ? 0 : 1);
