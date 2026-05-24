/**
 * Verifica el estado de todas las migraciones SQL aplicadas en S5.
 */

import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

const { data: doctors } = await admin.from('doctors').select('id').limit(1);
const doctorId = doctors[0].id;

console.log('═══ Estado de migraciones S5 ═══\n');

// s5_01: tablas family_history (ya verificadas)
const { error: fhErr } = await admin.from('family_history_catalog').select('id').limit(1);
console.log(`s5_01 family_history tables: ${fhErr ? '❌ ' + fhErr.message : '✅ OK'}`);

// s5_02: enum medication_presentation tiene 'sobre' y 'gel'
const { error: sobreErr } = await admin
  .from('medications')
  .insert({
    doctor_id: '00000000-0000-0000-0000-000000000000',
    commercial_name: '__TEST__',
    presentation: 'sobre',
  });
const sobreOk = !sobreErr || !sobreErr.message?.includes('invalid input value for enum');
console.log(`s5_02 enum sobre/gel:        ${sobreOk ? '✅ OK' : '❌ pendiente — falta correr s5_02'}`);

// s5_06: enum diagnosis_status nuevos
const { error: diagErr } = await admin
  .from('consultation_diagnoses')
  .insert({
    consultation_id: '00000000-0000-0000-0000-000000000000',
    diagnosis_id: '00000000-0000-0000-0000-000000000000',
    diagnosis_status: 'controlado',
  });
const diagOk = !diagErr || !diagErr.message?.includes('invalid input value for enum');
console.log(`s5_06 diagnosis_status:      ${diagOk ? '✅ OK' : '❌ pendiente'}`);

// s5_05: índices — bench rápido
console.log('\n═══ Performance (esperado: < 80ms con índices) ═══');
async function bench(label, fn) {
  const t = performance.now();
  await fn();
  const ms = (performance.now() - t).toFixed(0);
  const flag = +ms < 100 ? '✅' : +ms < 300 ? '🟡' : '❌';
  console.log(`  ${flag}  ${ms.padStart(5)}ms  ${label}`);
}

// Calentar primero (quitar cold start)
await admin.from('diagnoses').select('id').eq('doctor_id', doctorId).limit(1);

await bench('Diagnoses page 1 (count + 50 items)', async () => {
  await admin.from('diagnoses').select('*', { count: 'exact' }).eq('doctor_id', doctorId)
    .eq('is_active', true).order('usage_count', { ascending: false }).order('name').range(0, 49);
});
await bench('Medications page 1 (count + 50 items)', async () => {
  await admin.from('medications').select('*', { count: 'exact' }).eq('doctor_id', doctorId)
    .eq('is_active', true).order('usage_count', { ascending: false }).order('commercial_name').range(0, 49);
});
await bench('Medications ILIKE "metf"', async () => {
  await admin.from('medications').select('*', { count: 'exact' }).eq('doctor_id', doctorId)
    .eq('is_active', true).or('commercial_name.ilike.%metf%,active_ingredient.ilike.%metf%')
    .order('usage_count', { ascending: false }).range(0, 49);
});
await bench('Diagnoses ILIKE "hipert"', async () => {
  await admin.from('diagnoses').select('*', { count: 'exact' }).eq('doctor_id', doctorId)
    .eq('is_active', true).ilike('name', '%hipert%')
    .order('usage_count', { ascending: false }).range(0, 49);
});

// Si hay tests sucios (los inserts arriba), limpiar
await admin.from('medications').delete().eq('commercial_name', '__TEST__');
