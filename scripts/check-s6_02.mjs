/**
 * Verifica s6_02: integridad consulta firmada ↔ estado de cita.
 * Test NO destructivo: intenta cancelar una cita que tiene consulta
 * firmada; el trigger debe rechazar el UPDATE (no persiste nada).
 * Uso: node scripts/check-s6_02.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s6_02 (firma ↔ estado de cita) ═══\n');

// Buscar una cita con consulta firmada
const { data: signed } = await a
  .from('consultations')
  .select('appointment_id')
  .eq('status', 'signed')
  .not('appointment_id', 'is', null)
  .limit(1);

if (!signed || signed.length === 0) {
  console.log('⚠️  No hay consultas firmadas con cita asociada para probar el bloqueo.');
  console.log('   Verificá manualmente en preview: firmar una consulta y luego');
  console.log('   intentar cancelar la cita → debe rechazarse.');
  process.exit(0);
}

const apptId = signed[0].appointment_id;

const { data: cancelStatus } = await a
  .from('appointment_statuses')
  .select('id')
  .eq('name', 'cancelada')
  .single();

// Intento de cancelar — el trigger debe lanzar excepción (no persiste)
const { error: blockErr } = await a
  .from('appointments')
  .update({ status_id: cancelStatus.id })
  .eq('id', apptId);

const blocked = !!blockErr && /consulta firmada/i.test(blockErr.message);
console.log(`1. Bloqueo de cancelar cita firmada: ${blocked ? '✅ OK (rechazado)' : '❌ NO bloqueó'}`);
if (blockErr) console.log(`   ↳ mensaje: ${blockErr.message}`);
if (!blockErr) console.log('   ↳ ⚠️ el UPDATE NO fue rechazado — revisar trigger guard_appointment_status_change');

// Confirmar que la cita NO quedó cancelada (el trigger revierte la transacción)
const { data: after } = await a
  .from('appointments')
  .select('status:appointment_statuses(name)')
  .eq('id', apptId)
  .single();
const stillNotCancelled = after?.status?.name !== 'cancelada';
console.log(`2. Cita NO quedó cancelada:           ${stillNotCancelled ? '✅ OK' : '❌ se canceló igual'}`);

const allOk = blocked && stillNotCancelled;
console.log(`\n${allOk ? '✅ s6_02 aplicado y funcionando.' : '❌ Falta correr migrations/s6_02_signed_consultation_appointment_lock.sql o el trigger no funciona.'}`);
process.exit(allOk ? 0 : 1);
