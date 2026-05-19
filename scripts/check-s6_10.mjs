/**
 * Verifica s6_10: no se puede reprogramar una cita con consulta
 * firmada / en estado final. Mueve la cita a un slot FUTURO y dentro
 * de disponibilidad (para que s6_03/s6_04 no enmascaren a s6_10).
 * Test no destructivo: el trigger debe rechazar el UPDATE.
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
  .limit(5);

if (!signed || signed.length === 0) {
  console.log('⚠️  No hay consultas firmadas con cita. Verificar manual en preview.');
  process.exit(0);
}

const apptId = signed[0].appointment_id;
const { data: appt } = await a
  .from('appointments')
  .select('doctor_id, start_time, end_time')
  .eq('id', apptId)
  .single();

const durMs =
  new Date(appt.end_time).getTime() - new Date(appt.start_time).getTime();

// Buscar un slot libre futuro dentro de disponibilidad (próx. 21 días)
async function findFutureSlot(doctorId) {
  for (let d = 1; d <= 21; d++) {
    const day = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
    const dow = new Date(day + 'T00:00:00').getDay();
    const { data: rules } = await a
      .from('availability_rules')
      .select('start_time')
      .eq('doctor_id', doctorId)
      .eq('day_of_week', dow)
      .eq('is_active', true)
      .limit(1);
    if (rules && rules.length) {
      return `${day}T${rules[0].start_time}`;
    }
  }
  return null;
}

const newStart = await findFutureSlot(appt.doctor_id);
if (!newStart) {
  console.log('⚠️  El médico no tiene reglas de disponibilidad próximas; no se pudo aislar s6_10.');
  console.log('   Verificar manual en preview (editar una cita atendida/firmada → bloqueada).');
  process.exit(0);
}
const newStartIso = new Date(newStart).toISOString();
const newEndIso = new Date(new Date(newStart).getTime() + durMs).toISOString();

const { error } = await a
  .from('appointments')
  .update({ start_time: newStartIso, end_time: newEndIso })
  .eq('id', apptId);

const blocked = !!error && /no puede modificarse/i.test(error.message);
const maskedByOther =
  !!error && /(pasada|disponibilidad)/i.test(error.message);

if (blocked) {
  console.log('1. Reprogramar cita firmada: ✅ BLOQUEADO por s6_10');
} else if (maskedByOther) {
  console.log(`1. Inconcluso: otro trigger saltó primero → ${error.message}`);
  console.log('   (s6_03/s6_04 enmascaran; verificar manual en preview)');
} else if (error) {
  console.log(`1. ❌ Error inesperado: ${error.message}`);
} else {
  console.log('1. ❌ NO bloqueó (la cita firmada se reprogramó — revisar s6_10)');
}

process.exit(blocked ? 0 : 1);
