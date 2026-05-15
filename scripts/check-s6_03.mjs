/**
 * Verifica s6_03: no se pueden crear/reprogramar citas en el pasado.
 * Test NO destructivo: intenta insertar una cita con start_time de ayer
 * usando service_role; el trigger debe rechazarla (no persiste nada).
 * Uso: node scripts/check-s6_03.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s6_03 (citas en el pasado) ═══\n');

// Tomar refs reales mínimas para armar el insert
const { data: appt } = await a
  .from('appointments')
  .select('clinic_id, doctor_id, patient_id, status_id')
  .limit(1)
  .single();

if (!appt) {
  console.log('⚠️  No hay citas para tomar refs. Verificar manualmente.');
  process.exit(0);
}

const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const yesterdayEnd = new Date(Date.now() - 24 * 3600 * 1000 + 30 * 60 * 1000).toISOString();

const { data: ins, error } = await a
  .from('appointments')
  .insert({
    clinic_id: appt.clinic_id,
    doctor_id: appt.doctor_id,
    patient_id: appt.patient_id,
    status_id: appt.status_id,
    start_time: yesterday,
    end_time: yesterdayEnd,
    source: 'manual',
    payment_status: 'pending',
  })
  .select('id');

const blocked = !!error && /fecha u hora pasada/i.test(error.message);
console.log(`1. Insert de cita en el pasado: ${blocked ? '✅ BLOQUEADO' : '❌ NO bloqueó'}`);
if (error) console.log(`   ↳ ${error.message}`);

// Limpieza defensiva: si por algún motivo se insertó, borrarla
if (ins && ins.length > 0) {
  await a.from('appointments').delete().eq('id', ins[0].id);
  console.log('   ⚠️ se insertó (no debería) — fila eliminada para no dejar basura');
}

console.log(`\n${blocked ? '✅ s6_03 aplicado y funcionando.' : '❌ Falta correr migrations/s6_03_block_past_appointments.sql.'}`);
process.exit(blocked ? 0 : 1);
