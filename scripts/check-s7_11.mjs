/**
 * Verifica s7_11: backfill de patients.phone al formato canónico
 * '503XXXXXXXX' + reporta grupos de pacientes con el MISMO teléfono
 * normalizado en la misma clínica (duplicados latentes a revisión).
 *
 * No fusiona pacientes — solo reporta. La decisión (soft-delete,
 * merge manual, reasignar citas) la toma el operador caso por caso.
 *
 * Uso: node scripts/check-s7_11.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s7_11 (normalización phone + reporte de duplicados) ═══\n');

const { data: patients, error } = await a
  .from('patients')
  .select('id, clinic_id, full_name, phone, is_active')
  .not('phone', 'is', null);

if (error) {
  console.log('❌ Error consultando pacientes:', error.message);
  process.exit(1);
}

// Backfill check: contar cuántos pacientes tienen el formato canónico.
const canonical = patients.filter((p) => /^503\d{8}$/.test(p.phone));
const nonSv = patients.filter((p) => !/^503\d{8}$/.test(p.phone));
console.log(`  Pacientes con phone canónico (503+8 dígitos): ${canonical.length}/${patients.length}`);
if (nonSv.length > 0) {
  console.log(`  Pacientes con phone NO canónico (extranjero / formato raro): ${nonSv.length}`);
  for (const p of nonSv.slice(0, 5)) {
    console.log(`     ej: "${p.phone}"  (${p.full_name})`);
  }
  if (nonSv.length > 5) console.log(`     ... y ${nonSv.length - 5} más`);
}

// Agrupar por (clinic_id, phone) y reportar duplicados.
const groups = new Map();
for (const p of patients) {
  const key = `${p.clinic_id}|${p.phone}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(p);
}
const dups = [...groups.values()].filter((g) => g.length > 1);

if (dups.length === 0) {
  console.log('\n✅ s7_11 aplicado. Sin pacientes duplicados por teléfono normalizado.');
  process.exit(0);
}

console.log(
  `\n⚠️  ${dups.length} grupo(s) de pacientes con el mismo teléfono normalizado en la misma clínica.\n` +
    `   No se mergean automáticamente — revisión manual:\n`
);
for (const g of dups) {
  console.log(`   clinic=${g[0].clinic_id.slice(0, 8)}…  phone=${g[0].phone}`);
  for (const p of g) {
    const flag = p.is_active ? 'ACTIVO  ' : 'INACTIVO';
    console.log(`     - [${flag}] ${p.id}  ${p.full_name}`);
  }
}
console.log('');
// Reporte informativo — no falla
process.exit(0);
