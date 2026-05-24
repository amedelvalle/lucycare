/**
 * Verifica s6_09: vista admin_review_traceability existe y cruza datos.
 * service_role la lee (admin); confirma que trae review ↔ paciente ↔
 * cita ↔ médico. Uso: node scripts/check-s6_09.mjs
 */

import { supabaseAdmin as a } from './_lib/supabase-admin.mjs';
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
