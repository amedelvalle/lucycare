/**
 * Verifica s7_09: guard de servicios inactivos en citas.
 *
 * Nota: PostgREST no permite introspeccionar triggers, así que el
 * comportamiento del trigger trg_block_inactive_service se confirma con
 * el smoke-test manual (intentar crear una cita con un servicio
 * inactivo → debe fallar). Este script valida que las columnas de las
 * que depende el trigger existan.
 * Uso: node scripts/check-s7_09.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s7_09 (guard servicios inactivos en citas) ═══\n');

const { error: e1 } = await a.from('appointments').select('id, service_id').limit(1);
const { error: e2 } = await a.from('services').select('id, is_active').limit(1);

const apptOk = !e1;
const svcOk = !e2;
console.log(`  appointments.service_id: ${apptOk ? '✅' : '❌ ' + e1.message}`);
console.log(`  services.is_active:      ${svcOk ? '✅' : '❌ ' + e2.message}`);

const ok = apptOk && svcOk;
console.log(
  `\n${ok
    ? '✅ Columnas OK.\n   Confirmá el trigger con el smoke-test:\n   - crear una cita con un servicio inactivo → debe fallar;\n   - editar una cita histórica sin cambiar el servicio → debe permitirse.'
    : '❌ Revisar / correr migrations/s7_09_block_inactive_service_appointment.sql.'}`
);
process.exit(ok ? 0 : 1);
