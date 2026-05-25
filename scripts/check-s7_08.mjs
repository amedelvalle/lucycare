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

import { supabaseAdmin as a } from './_lib/supabase-admin.mjs';
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
