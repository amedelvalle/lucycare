/**
 * Smoke test S4 Semana 1 — verifica antes de probar la UI:
 *   1. Migración weight_lb → weight_kg corrió
 *   2. Tablas consultations + vitals existen y aceptan inserts del shape esperado
 *   3. RLS policies básicas existen para consultations + vitals (vía intento con anon)
 *   4. Catálogos por médico (diagnoses, medications) existen
 *
 * Uso:
 *   node scripts/s4-week1-smoke-test.mjs
 *
 * Requiere: las VITE_* en .env (URL + anon) + el service role key abajo.
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDIwMTQsImV4cCI6MjA5MDg3ODAxNH0.hESVl_M0WfUJfgUXaTZ80tIe3JR7IijLZJxjbxnNqUQ';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const PASS = '✅';
const FAIL = '❌';
const WARN = '⚠️ ';

const results = [];
function log(level, msg) {
  results.push({ level, msg });
  console.log(`${level} ${msg}`);
}

// ─── Test 1: migración weight_lb → weight_kg ──────────────────────────
async function testMigration() {
  console.log('\n── Test 1: migración weight_kg ──');
  // Selecciona weight_kg específicamente. Si la columna no existe, error.
  const { error } = await admin.from('vitals').select('id, weight_kg').limit(1);
  if (error) {
    if (error.message.includes('weight_kg') || error.message.includes('column')) {
      log(FAIL, 'Migración NO corrió. Columna vitals.weight_kg no existe — corre migrations/s4_01_vitals_weight_kg.sql en Supabase Dashboard.');
      return false;
    }
    log(FAIL, `Error inesperado en vitals: ${error.message}`);
    return false;
  }
  log(PASS, 'Migración OK — vitals.weight_kg existe');
  return true;
}

// ─── Test 2: schema de consultations acepta el insert del frontend ────
async function testConsultationsSchema() {
  console.log('\n── Test 2: schema de consultations ──');
  // Buscar una cita real para no fabricar IDs
  const { data: apt, error: aptErr } = await admin
    .from('appointments')
    .select('id, clinic_id, doctor_id, patient_id')
    .limit(1)
    .maybeSingle();
  if (aptErr || !apt) {
    log(WARN, 'No hay citas para probar inserts reales. Skip insert test.');
    return true;
  }

  // Probar insert con el shape exacto del servicio
  const insertPayload = {
    appointment_id: apt.id,
    clinic_id: apt.clinic_id,
    doctor_id: apt.doctor_id,
    patient_id: apt.patient_id,
    status: 'draft',
    started_at: new Date().toISOString(),
    chief_complaint: '__SMOKE_TEST__',
  };
  const { data: created, error: insErr } = await admin
    .from('consultations')
    .insert(insertPayload)
    .select('id')
    .maybeSingle();

  if (insErr) {
    // Si ya existe una para esta cita por unicidad (no la hay declarada, pero por si acaso)
    if (insErr.code === '23505') {
      log(WARN, 'Ya existe consulta para esta cita — se reutiliza. OK.');
      return true;
    }
    log(FAIL, `Insert a consultations falló: ${insErr.message}`);
    return false;
  }

  log(PASS, `Insert de consultations OK (id ${created.id.slice(0, 8)}...)`);

  // Probar insert a vitals con el shape del servicio
  const vitalsPayload = {
    appointment_id: apt.id,
    patient_id: apt.patient_id,
    systolic_bp: 120,
    diastolic_bp: 80,
    heart_rate: 72,
    weight_kg: 70.5,
    height_cm: 170,
    bmi: 24.4,
  };
  // Espejo del servicio real: read first, insert si no existe
  const { data: existingVit } = await admin
    .from('vitals')
    .select('id')
    .eq('appointment_id', apt.id)
    .maybeSingle();

  let vitErr = null;
  let vitId = existingVit?.id;
  if (existingVit) {
    const { error } = await admin.from('vitals').update(vitalsPayload).eq('id', existingVit.id);
    vitErr = error;
  } else {
    const { data, error } = await admin.from('vitals').insert(vitalsPayload).select('id').single();
    vitErr = error;
    vitId = data?.id;
  }
  if (vitErr) {
    log(FAIL, `Insert a vitals falló: ${vitErr.message}`);
  } else {
    log(PASS, 'Insert/update a vitals OK con weight_kg + bmi');
    // Cleanup vitals (solo si lo creamos en este test)
    if (!existingVit && vitId) await admin.from('vitals').delete().eq('id', vitId);
  }

  // Cleanup consulta
  await admin.from('consultations').delete().eq('id', created.id);
  return !vitErr;
}

// ─── Test 3: RLS — anon NO debe poder leer consultations ──────────────
async function testRlsBlocksAnon() {
  console.log('\n── Test 3: RLS bloquea anon ──');
  const { data, error } = await anon.from('consultations').select('id').limit(1);
  if (error) {
    log(PASS, `RLS bloquea anon (error: ${error.message.slice(0, 80)})`);
    return true;
  }
  if (!data || data.length === 0) {
    log(PASS, 'anon devuelve 0 filas — RLS aplica filtro vacío');
    return true;
  }
  log(FAIL, `anon devuelve ${data.length} filas — RLS NO está restringiendo. URGENTE configurar policies.`);
  return false;
}

// ─── Test 4: catálogos por médico existen ─────────────────────────────
async function testCatalogs() {
  console.log('\n── Test 4: catálogos diagnoses + medications ──');
  const checks = [
    { table: 'diagnoses', cols: 'id, name, doctor_id, usage_count' },
    { table: 'medications', cols: 'id, commercial_name, doctor_id, presentation' },
    { table: 'consultation_diagnoses', cols: 'id, consultation_id, diagnosis_id, diagnosis_type' },
    { table: 'prescriptions', cols: 'id, consultation_id, medication_id, duration_unit' },
  ];
  let allOk = true;
  for (const { table, cols } of checks) {
    const { error } = await admin.from(table).select(cols).limit(1);
    if (error) {
      log(FAIL, `Tabla ${table}: ${error.message}`);
      allOk = false;
    } else {
      log(PASS, `Tabla ${table} accesible`);
    }
  }
  return allOk;
}

// ─── Run ──────────────────────────────────────────────────────────────
(async () => {
  console.log('═════════════════════════════════════════════');
  console.log('  S4 Semana 1 — Smoke Test');
  console.log('═════════════════════════════════════════════');

  const migrationOk = await testMigration();
  const schemaOk = migrationOk ? await testConsultationsSchema() : false;
  const rlsOk = await testRlsBlocksAnon();
  const catalogsOk = await testCatalogs();

  console.log('\n═════════════════════════════════════════════');
  console.log('  Resumen');
  console.log('═════════════════════════════════════════════');
  console.log(`Migración weight_kg:  ${migrationOk ? PASS : FAIL}`);
  console.log(`Schema consultations: ${schemaOk ? PASS : FAIL}`);
  console.log(`RLS bloquea anon:     ${rlsOk ? PASS : FAIL}`);
  console.log(`Catálogos clínicos:   ${catalogsOk ? PASS : FAIL}`);

  const fails = results.filter((r) => r.level === FAIL).length;
  if (fails > 0) {
    console.log(`\n${fails} prueba(s) fallaron. Resolver antes de probar la UI.`);
    process.exit(1);
  }
  console.log('\nTodo OK a nivel de schema. Puedes proceder a probar la UI en /panel/citas → cita → Abrir consulta clínica');
})();
