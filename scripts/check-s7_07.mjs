/**
 * Verifica s7_07: la tabla clinics ahora tiene la columna updated_at.
 * Con la columna presente, el trigger trg_clinics_updated_at funciona
 * y cualquier UPDATE sobre clinics deja de fallar.
 * Uso: node scripts/check-s7_07.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

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
