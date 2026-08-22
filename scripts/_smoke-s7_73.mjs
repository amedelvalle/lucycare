/**
 * _smoke-s7_73.mjs — ADMIN-DOCTOR-SEED-P0, E2E de base.
 *
 * ⚠️ **NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA DEL OWNER.**
 * Requiere: (a) `s7_73` YA aplicada en Supabase, y (b) `service_role`.
 * Escribe filas reales (operaciones, profile técnico, clínica, médico) y las
 * limpia al final. Está escrito para revisión ahora y ejecución después.
 *
 *   node scripts/_smoke-s7_73.mjs --confirm
 *
 * Sin `--confirm` no hace absolutamente nada: imprime el plan y sale.
 *
 * Fixtures 100 % sintéticas y marcadas `S7_73_FIXTURE`. Jamás datos reales,
 * jamás identidades protegidas.
 */
import { randomUUID } from 'node:crypto';
import { supabaseAdmin as sb } from './_lib/supabase-admin.mjs';

const CONFIRMED = process.argv.includes('--confirm');

const PLAN = [
  'A. claim: primera llamada devuelve "claimed"',
  'B. claim: misma key + mismo payload → no duplica (in_progress / resume / completed)',
  'C. claim: misma key + payload distinto → P0122',
  'D. concurrencia: dos claims simultáneos → solo uno "claimed"',
  'E. lookup: sin auth.user devuelve NULL',
  'F. set_auth_created: con un UUID que no es el seed → P0125',
  'G. set_auth_created: idempotente con el MISMO uuid',
  'H. set_auth_created: con OTRO uuid → P0124',
  'I. mark_failed: no puede sobrescribir completed → P0123',
  'J. create_seed_doctor: exige auth_created → P0123',
  'K. create_seed_doctor: publish sin D1 → P0129',
  'L. create_seed_doctor: draft → is_published=false y slug NULL',
  'M. create_seed_doctor: publish con D1 → is_published=true y slug generado',
  'N. invariante: booking_enabled=false en TODOS los casos',
  'O. invariante: lucy_status=listed_only, is_operational=true',
  'P. invariante: cero filas en clinic_members',
  'Q. invariante: doctors.license_number sigue NULL',
  'R. JVPM duplicado entre dos operaciones → 23505',
  'S. teléfono de claim duplicado entre dos operaciones → P0128',
  'T. re-llamar create_seed_doctor sobre completed → already_completed, sin segundo médico',
  'U. la identidad técnica queda baneada, sin phone y sin password',
  'V. cleanup: deleteUser cascadea el profile; cero residuos',
];

console.log('\n_smoke-s7_73 — plan de verificación E2E\n');
PLAN.forEach((l) => console.log('  ' + l));

if (!CONFIRMED) {
  console.log('\n⏸️  Sin --confirm: no se ejecutó nada.');
  console.log('   Requiere s7_73 aplicada y autorización explícita del owner.\n');
  process.exit(0);
}

console.error('\n🛑 La ejecución real todavía no está habilitada en este PR.');
console.error('   El cuerpo del smoke se completa cuando el owner autorice aplicar s7_73:');
console.error('   antes de eso, cada aserción se escribiría a ciegas contra un esquema');
console.error('   que aún no existe, y no habría forma de validar el propio instrumento.\n');
process.exit(3);
