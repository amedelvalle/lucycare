/**
 * Verifica s7_07: la tabla clinics ahora tiene la columna updated_at.
 * Con la columna presente, el trigger trg_clinics_updated_at funciona
 * y cualquier UPDATE sobre clinics deja de fallar.
 * Uso: node scripts/check-s7_07.mjs
 */

import { supabaseAdmin as a } from './_lib/supabase-admin.mjs';
console.log('═══ Verificando s7_07 (clinics.updated_at) ═══\n');

const { error } = await a.from('clinics').select('updated_at').limit(1);
const hasColumn = !error;
const stillMissing = !!error && /updated_at/.test(error.message) && /does not exist/.test(error.message);

if (hasColumn) {
  console.log('  clinics.updated_at: ✅ existe');
} else if (stillMissing) {
  console.log('  clinics.updated_at: ❌ sigue faltando');
} else {
  console.log(`  clinics.updated_at: ⚠️ ${error.message}`);
}

console.log(`\n${hasColumn
  ? '✅ s7_07 aplicado. El trigger trg_clinics_updated_at ya puede setear updated_at.'
  : '❌ Falta correr migrations/s7_07_clinics_updated_at_column.sql en el SQL editor de Supabase.'}`);
process.exit(hasColumn ? 0 : 1);
