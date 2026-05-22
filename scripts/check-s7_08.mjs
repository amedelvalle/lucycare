/**
 * Verifica s7_08: tabla services con el shape que necesita "Mis servicios".
 *
 * Nota: PostgREST no permite introspeccionar pg_policies, así que la
 * existencia de la policy `services_delete` se confirma con el smoke-test
 * manual (el médico borra un servicio sin citas desde /panel/servicios).
 * Este script valida que la tabla services tenga todas las columnas que
 * la pantalla consume.
 * Uso: node scripts/check-s7_08.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s7_08 (services: delete policy + shape) ═══\n');

const { error } = await a
  .from('services')
  .select('id, doctor_id, name, duration_minutes, price, is_first_visit, is_active, sort_order')
  .limit(1);

const shapeOk = !error;
console.log(`  Tabla services con columnas esperadas: ${shapeOk ? '✅' : '❌ ' + error.message}`);

console.log(
  `\n${shapeOk
    ? '✅ Tabla services OK.\n   Confirmá la policy services_delete con el smoke-test en /panel/servicios:\n   - eliminar un servicio SIN citas → se borra;\n   - eliminar un servicio CON citas → bloqueado, ofrece desactivar.'
    : '❌ Revisar la tabla services / correr migrations/s7_08_services_delete_policy.sql.'}`
);
process.exit(shapeOk ? 0 : 1);
