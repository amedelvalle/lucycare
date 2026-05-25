/**
 * Setup de datos de prueba para Paciente Global Fase 1.
 *
 * Crea 2-3 patients en distintas clínicas con phone normalizado
 * 50375000001 y profile_id IS NULL, para validar que la RPC
 * claim_patient_records las vincule cuando el paciente logueado
 * tiene Test Phone +50375000001 / 123456.
 *
 * Las filas se identifican por:
 *   - full_name con prefijo "[Test Fase 1]" → fácil de limpiar.
 *   - phone: 50375000001 (canónico).
 *   - profile_id: NULL.
 *   - notes: "test_patient_phase1" → marcador estable para cleanup.
 *
 * Uso:
 *   node scripts/setup-test-patient.mjs            # dry-run (info)
 *   node scripts/setup-test-patient.mjs --apply    # crear filas
 *   node scripts/setup-test-patient.mjs --reset    # desvincula
 *                                                  # las filas para
 *                                                  # repetir el smoke
 *   node scripts/setup-test-patient.mjs --clean    # eliminar test
 *                                                  # patients +
 *                                                  # appointments
 */
import { supabaseAdmin as svc } from './_lib/supabase-admin.mjs';

const TEST_PHONE_NORM = '50375000001';
const TEST_NAME_PREFIX = '[Test Fase 1]';
const TEST_MARKER = 'test_patient_phase1';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const RESET = args.has('--reset');
const CLEAN = args.has('--clean');

console.log('═══ Setup Test Patient para Paciente Global Fase 1 ═══\n');

if (CLEAN) {
  console.log('Modo --clean: eliminando datos de prueba…');
  // Borrar appointments asociadas (CASCADE no aplica desde nuestro side)
  const { data: testPatients } = await svc
    .from('patients')
    .select('id')
    .eq('notes', TEST_MARKER);
  const ids = (testPatients ?? []).map((p) => p.id);
  if (ids.length === 0) {
    console.log('  No hay test patients para borrar.');
    process.exit(0);
  }

  await svc.from('appointments').delete().in('patient_id', ids);
  const { error } = await svc.from('patients').delete().in('id', ids);
  if (error) { console.error('Error:', error.message); process.exit(1); }
  console.log(`  ✅ Eliminados ${ids.length} test patients y sus appointments.`);
  process.exit(0);
}

if (RESET) {
  console.log('Modo --reset: desvinculando profile_id para repetir smoke…');
  const { error, count } = await svc
    .from('patients')
    .update({ profile_id: null }, { count: 'exact' })
    .eq('notes', TEST_MARKER)
    .not('profile_id', 'is', null);
  if (error) { console.error('Error:', error.message); process.exit(1); }
  console.log(`  ✅ Desvinculadas ${count} filas.`);
  process.exit(0);
}

// Modo default / --apply: crear filas si no existen
const { data: existing } = await svc
  .from('patients')
  .select('id, clinic_id, full_name, profile_id')
  .eq('phone', TEST_PHONE_NORM);

console.log(`Estado actual: ${existing?.length ?? 0} patients con phone ${TEST_PHONE_NORM}`);
for (const p of existing ?? []) {
  console.log(`  - ${p.full_name} (clinic ${String(p.clinic_id).slice(0, 8)}…)  profile_id=${p.profile_id ?? 'NULL'}`);
}

if ((existing?.length ?? 0) > 0) {
  console.log('\nYa hay datos. Para resetear vinculación corré con --reset.');
  console.log('Para borrar todo corré con --clean.');
  process.exit(0);
}

// Buscar 3 clínicas con doctores publicados para asociar las patients
const { data: clinics } = await svc
  .from('clinics')
  .select('id, name, doctors!inner(id, is_published)')
  .eq('doctors.is_published', true)
  .limit(3);

if (!clinics || clinics.length < 2) {
  console.error('No hay suficientes clínicas con doctores publicados para crear el setup.');
  process.exit(1);
}

console.log(`\nUsando ${clinics.length} clínicas para crear test patients:`);
const rowsToInsert = clinics.map((c, i) => ({
  clinic_id: c.id,
  full_name: `${TEST_NAME_PREFIX} Test ${i + 1}`,
  phone: TEST_PHONE_NORM,
  document_type: 'dui',
  document_number: null,
  date_of_birth: '1990-01-01',
  gender: 'otro',
  patient_type: 'privado',
  notes: TEST_MARKER,
  profile_id: null,
}));

for (const r of rowsToInsert) {
  console.log(`  - ${r.full_name} en ${clinics.find((c) => c.id === r.clinic_id)?.name}`);
}

if (!APPLY) {
  console.log('\n(dry-run: pasá --apply para crear las filas)');
  process.exit(0);
}

const { data: inserted, error } = await svc
  .from('patients')
  .insert(rowsToInsert)
  .select('id, clinic_id, full_name');
if (error) { console.error('Insert error:', error.message); process.exit(1); }

console.log(`\n✅ Creados ${inserted?.length ?? 0} test patients.\n`);

// Crear 1 appointment dummy para 2 de ellos así "Mis atenciones" tiene contenido
const { data: statuses } = await svc.from('appointment_statuses').select('id, name').limit(1);
const { data: services } = await svc.from('services').select('id, doctor_id').eq('is_active', true).limit(10);

if (statuses && statuses.length > 0 && services && services.length > 0) {
  const apptsToInsert = [];
  const insertedRows = inserted || [];
  for (let i = 0; i < Math.min(2, insertedRows.length); i++) {
    const patient = insertedRows[i];
    const svcForClinic = services.find(() => true);
    if (!svcForClinic) continue;
    // Fechas futuras (3-10 días adelante) — el trigger block_past_appointment
    // rechaza fechas pasadas aunque sean datos de prueba.
    const daysAhead = (i + 1) * 3;
    const startTime = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    startTime.setHours(10 + i, 0, 0, 0);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
    apptsToInsert.push({
      clinic_id: patient.clinic_id,
      doctor_id: svcForClinic.doctor_id,
      patient_id: patient.id,
      service_id: svcForClinic.id,
      status_id: statuses[0].id,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      source: 'manual',
    });
  }
  if (apptsToInsert.length > 0) {
    const { data: apps, error: errApp } = await svc.from('appointments').insert(apptsToInsert).select('id');
    if (errApp) console.warn('  ⚠ No se crearon appointments dummy:', errApp.message);
    else console.log(`✅ Creados ${apps?.length ?? 0} appointments dummy para esos test patients.`);
  }
}

console.log('\nListo. Ahora:');
console.log('  1. Asegurate que +50375000001 esté en Supabase Auth → Phone → Test phone numbers con OTP 123456.');
console.log('  2. node scripts/check-s7_20.mjs');
console.log('  3. Smoke en preview: login con +50375000001 / 123456 → /paciente/mis-atenciones.');
