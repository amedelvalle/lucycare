/**
 * Verifica s6_04: no se pueden crear citas fuera de la disponibilidad
 * del médico. Test NO destructivo: intenta insertar (service_role) una
 * cita mañana a las 23:30 (hora ES) — fuera de cualquier horario normal.
 * El trigger debe rechazarla. Uso: node scripts/check-s6_04.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s6_04 (fuera de disponibilidad) ═══\n');

const { data: appt } = await a
  .from('appointments')
  .select('clinic_id, doctor_id, patient_id, status_id')
  .limit(1)
  .single();

if (!appt) {
  console.log('⚠️  No hay citas para tomar refs. Verificar manualmente.');
  process.exit(0);
}

// Mañana 23:30–00:00 en hora El Salvador (UTC-6) → 05:30Z..06:00Z del día +2
const t = new Date(Date.now() + 24 * 3600 * 1000);
const y = t.getUTCFullYear(), m = String(t.getUTCMonth() + 1).padStart(2, '0'), d = String(t.getUTCDate()).padStart(2, '0');
const start = `${y}-${m}-${d}T23:30:00-06:00`;
const end = `${y}-${m}-${d}T23:59:00-06:00`;

const { data: ins, error } = await a
  .from('appointments')
  .insert({
    clinic_id: appt.clinic_id,
    doctor_id: appt.doctor_id,
    patient_id: appt.patient_id,
    status_id: appt.status_id,
    start_time: start,
    end_time: end,
    source: 'manual',
    payment_status: 'pending',
  })
  .select('id');

const blocked = !!error && /disponibilidad en ese horario/i.test(error.message);
console.log(`1. Insert fuera de disponibilidad: ${blocked ? '✅ BLOQUEADO' : '❌ NO bloqueó'}`);
if (error) console.log(`   ↳ ${error.message}`);

if (ins && ins.length > 0) {
  await a.from('appointments').delete().eq('id', ins[0].id);
  console.log('   ⚠️ se insertó (no debería) — fila eliminada');
}

console.log(`\n${blocked ? '✅ s6_04 aplicado y funcionando.' : '❌ Falta correr migrations/s6_04_block_outside_availability.sql.'}`);
process.exit(blocked ? 0 : 1);
