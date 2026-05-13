import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const { count: doctorsCount } = await admin.from('doctors').select('id', { count: 'exact', head: true });
const { count: diagnosesCount } = await admin.from('diagnoses').select('id', { count: 'exact', head: true });
const { count: medicationsCount } = await admin.from('medications').select('id', { count: 'exact', head: true });

console.log('═══ Catálogos en DB ═══');
console.log(`  Doctores totales:   ${doctorsCount}`);
console.log(`  Diagnósticos:       ${diagnosesCount}`);
console.log(`  Medicamentos:       ${medicationsCount}`);
console.log(`  Esperado por doc:   127 diag + 736 med`);
console.log(`  Esperado total:     ${(doctorsCount ?? 0) * 127} diag + ${(doctorsCount ?? 0) * 736} med`);

if ((diagnosesCount ?? 0) === 0) {
  console.log('\n❌ Seed s5_03 NO se corrió. Hay que ejecutarlo en Supabase.');
}
if ((medicationsCount ?? 0) === 0) {
  console.log('❌ Seed s5_04 NO se corrió. Hay que ejecutarlo en Supabase.');
}

// Por doctor
const { data: byDoctor } = await admin
  .from('doctors')
  .select('id, profiles!inner(full_name), diagnoses(count), medications(count)');

console.log('\n═══ Por doctor ═══');
for (const d of (byDoctor ?? [])) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dAny = d;
  const name = dAny.profiles?.full_name ?? '—';
  const dCount = dAny.diagnoses?.[0]?.count ?? 0;
  const mCount = dAny.medications?.[0]?.count ?? 0;
  console.log(`  ${dAny.id.slice(0, 8)}  ${name}: ${dCount} diag · ${mCount} med`);
}

// Sample search test (simulando el query del frontend)
console.log('\n═══ Test search "metform" ═══');
const { data: searchResult } = await admin
  .from('medications')
  .select('id, commercial_name, active_ingredient, doctor_id')
  .ilike('commercial_name', '%metform%')
  .limit(5);
console.log(`  Resultados: ${searchResult?.length ?? 0}`);
searchResult?.forEach((r) => console.log(`    ${r.commercial_name} (${r.active_ingredient}) — doctor ${r.doctor_id.slice(0, 8)}`));

// Test enum
console.log('\n═══ Test enum medication_presentation ═══');
const { error: enumErr } = await admin.from('medications').select('id').eq('presentation', 'sobre').limit(1);
if (enumErr) {
  console.log(`  ❌ Error: ${enumErr.message}`);
  console.log('     → migración s5_02 (extender enum) probablemente no corrió');
} else {
  console.log('  ✅ Valor "sobre" reconocido por el enum');
}
