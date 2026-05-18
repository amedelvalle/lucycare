/**
 * Verifica s6_09: vista admin_review_traceability existe y cruza datos.
 * service_role la lee (admin); confirma que trae review ↔ paciente ↔
 * cita ↔ médico. Uso: node scripts/check-s6_09.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const a = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s6_09 (admin_review_traceability) ═══\n');

const { data, error } = await a
  .from('admin_review_traceability')
  .select('review_id, rating, doctor_name, patient_name, appointment_id, token_used_at')
  .limit(5);

if (error) {
  console.log('1. Vista admin_review_traceability: ❌', error.message);
  console.log('\n❌ Falta correr migrations/s6_09_admin_review_traceability.sql.');
  process.exit(1);
}

console.log('1. Vista admin_review_traceability: ✅ existe y consultable (service_role)');
console.log(`2. Filas de muestra: ${data.length}`);
for (const r of data) {
  console.log(
    `   review ${String(r.review_id).slice(0, 8)} · rating=${r.rating} · dr=${r.doctor_name ?? '—'} · paciente=${r.patient_name ?? '—'} · token_used=${r.token_used_at ? 'sí' : 'no'}`
  );
}
console.log('\n✅ s6_09 aplicado. Trazabilidad admin disponible vía SQL/Supabase.');
process.exit(0);
