/**
 * Verifica s6_10: no se puede reprogramar (UPDATE start_time) una cita
 * con consulta firmada o en estado final. Test NO destructivo: intenta
 * mover una cita con consulta firmada; el trigger debe rechazarlo.
 * Uso: node scripts/check-s6_10.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s6_10 (no reprogramar cita bloqueada) ═══\n');

const { data: signed } = await a
  .from('consultations')
  .select('appointment_id')
  .eq('status', 'signed')
  .not('appointment_id', 'is', null)
  .limit(1);

if (!signed || signed.length === 0) {
  console.log('⚠️  No hay consultas firmadas con cita para probar. Verificar manual en preview.');
  process.exit(0);
}

const apptId = signed[0].appointment_id;
const { data: appt } = await a
  .from('appointments')
  .select('start_time')
  .eq('id', apptId)
  .single();

const moved = new Date(new Date(appt.start_time).getTime() + 60 * 60 * 1000).toISOString();
const { error } = await a
  .from('appointments')
  .update({ start_time: moved })
  .eq('id', apptId);

const blocked = !!error && /no puede modificarse/i.test(error.message);
console.log(`1. Reprogramar cita firmada: ${blocked ? '✅ BLOQUEADO' : '❌ NO bloqueó'}`);
if (error) console.log(`   ↳ ${error.message}`);

console.log(
  `\n${blocked ? '✅ s6_10 aplicado.' : '❌ Falta correr migrations/s6_10_block_reschedule_locked_appointments.sql.'}`
);
process.exit(blocked ? 0 : 1);
