/**
 * Mide latencia de los queries clave para identificar bottlenecks.
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: doctors } = await admin.from('doctors').select('id').limit(1);
const doctorId = doctors[0].id;
console.log(`Usando doctor ${doctorId.slice(0, 8)}...`);

async function bench(label, fn) {
  const t = performance.now();
  await fn();
  const ms = (performance.now() - t).toFixed(0);
  console.log(`  ${ms.padStart(5)}ms  ${label}`);
}

console.log('\n═══ Catálogos paginados (count exact + range) ═══');
await bench('Diagnoses page 1, 50 items, sin filtro', async () => {
  await admin.from('diagnoses').select('*', { count: 'exact' }).eq('doctor_id', doctorId)
    .eq('is_active', true).order('usage_count', { ascending: false }).order('name').range(0, 49);
});
await bench('Medications page 1, 50 items, sin filtro', async () => {
  await admin.from('medications').select('*', { count: 'exact' }).eq('doctor_id', doctorId)
    .eq('is_active', true).order('usage_count', { ascending: false }).order('commercial_name').range(0, 49);
});
await bench('Medications page 5 (offset 200)', async () => {
  await admin.from('medications').select('*', { count: 'exact' }).eq('doctor_id', doctorId)
    .eq('is_active', true).order('usage_count', { ascending: false }).order('commercial_name').range(200, 249);
});

console.log('\n═══ Búsquedas con ILIKE ═══');
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

console.log('\n═══ Autocomplete (consulta) ═══');
await bench('searchMedications, query vacío (top 20)', async () => {
  await admin.from('medications')
    .select('id, doctor_id, commercial_name, active_ingredient, concentration, presentation, is_active, usage_count')
    .eq('doctor_id', doctorId).eq('is_active', true)
    .order('usage_count', { ascending: false }).order('commercial_name').limit(20);
});
await bench('searchMedications, "metf" (top 20)', async () => {
  await admin.from('medications')
    .select('id, doctor_id, commercial_name, active_ingredient, concentration, presentation, is_active, usage_count')
    .eq('doctor_id', doctorId).eq('is_active', true)
    .or('commercial_name.ilike.%metf%,active_ingredient.ilike.%metf%')
    .order('usage_count', { ascending: false }).limit(20);
});

console.log('\n═══ Consulta open (varias queries en paralelo) ═══');
const t0 = performance.now();
await Promise.all([
  admin.from('consultations').select('*').limit(1),
  admin.from('vitals').select('*').limit(1),
  admin.from('consultation_diagnoses').select('*').limit(1),
  admin.from('prescriptions').select('*').limit(1),
  admin.from('consultation_family_history').select('*').limit(1),
  // Autocomplete prefetch (3 queries)
  admin.from('diagnoses').select('id, doctor_id, name, description, is_active, usage_count').eq('doctor_id', doctorId).eq('is_active', true).order('usage_count', { ascending: false }).limit(20),
  admin.from('medications').select('id, doctor_id, commercial_name, active_ingredient, concentration, presentation, is_active, usage_count').eq('doctor_id', doctorId).eq('is_active', true).order('usage_count', { ascending: false }).limit(20),
  admin.from('family_history_catalog').select('id, doctor_id, name, description, is_active, usage_count').eq('doctor_id', doctorId).eq('is_active', true).order('usage_count', { ascending: false }).limit(20),
]);
console.log(`  ${(performance.now() - t0).toFixed(0).padStart(5)}ms  TOTAL paralelo (8 queries de consulta open)`);
