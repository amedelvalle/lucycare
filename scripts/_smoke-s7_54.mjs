/**
 * SMOKE s7_54 — Analytics Farma (admin_pharma_summary +
 * admin_pharma_medication_ranking + admin_pharma_doctor_ranking).
 *
 * Sesión admin (50378056365) para el gate is_admin(); paciente (50375000001)
 * para el test de autorización; service_role para fixtures/cleanup.
 *
 * AISLAMIENTO: médico fixture propio (auth user throwaway + clínica + doctor) —
 * NO usa Camilo/Katherine ni datos reales. Ventana futura (2099) para conteos
 * deterministas. Reusa un medicamento GLOBAL existente (fuente global, sin
 * ensuciar el catálogo) + crea uno PERSONAL. Cleanup total (0 residuales).
 *
 * Fixtures (solo is_current + signed cuentan):
 *   CONS1 signed: MED_G ×1 (permanente) + MED_P is_current=false (EXCLUIDA)
 *   CONS2 signed: MED_G ×1
 *   CONS3 signed: MED_G ×1 (con markers instructions/dosage/frequency/alternatives) + MED_P ×1
 *   CONS4 signed: MED_P ×1
 *   CONS5 DRAFT : MED_G ×1 (EXCLUIDA)
 *   → MED_G=3, MED_P=2, total=5, consultas con meds=4, permanente=1, global=3, personal=2.
 *
 * Cubre: conteos generales · ranking medicamentos + umbral (min_count) · ranking
 * médico · global vs personal · duration_unit='permanente' · exclusión de
 * borradores · exclusión de is_current=false · fecha vía signed_at · filtros
 * doctor/especialidad · 0 PII (patient/instructions/dosage/frequency/alternatives/
 * consultation_id) · no-admin bloqueado · cleanup 0 residuales.
 *
 * Uso (SOLO tras aplicar s7_54): node scripts/_smoke-s7_54.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const ADMIN_PHONE = '50378056365';
const PATIENT_PHONE = '50375000001';
const OTP = '123456';
const CAMILO_DOCTOR = '783a902a-55fd-407c-9e0a-69568135c7f5'; // solo como "otro doctor" en filtro (0 en 2099)

const FAKE_PHONE = '50370005454';
const PROTECTED = new Set(['50378627694', '50378056365', '50375000001', '50375000099', '50372608827']);
if (PROTECTED.has(FAKE_PHONE)) throw new Error('FAKE_PHONE colisiona con un teléfono protegido');

const FROM = '2099-01-01', TO = '2099-12-31', SIGNED_AT = '2099-06-15T12:00:00.000Z';
const PATIENT_NAME = 'S754 Paciente Fixture ZZQ';
const M_INSTR = 'S754-INSTR-SECRET', M_DOSE = 'S754-DOSE-X', M_FREQ = 'S754-FREQ-Y', M_ALT = 'S754-ALT-Z';

const mk = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const login = async (cli, phone) => {
  await cli.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await cli.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error('OTP ' + phone + ': ' + (error?.message || 'sin sesión'));
  return data.user.id;
};

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };
const eq = (label, got, exp) => { if (got === exp) ok(`${label} = ${got}`); else ko(`${label}: got ${JSON.stringify(got)}, exp ${JSON.stringify(exp)}`); };

const adminCli = mk();
const patientCli = mk();
const created = { prescriptions: [], consultations: [], medications: [], patient: null, doctor: null, clinic: null, authUser: null };
let PROFILE = null, CLINIC = null, DOCTOR = null, PATIENT = null, SPEC = null, OTHER_SPEC = null, MED_G = null, MED_P = null;

const mkConsultation = async (status) => {
  const { data, error } = await admin.from('consultations').insert({
    clinic_id: CLINIC, doctor_id: DOCTOR, patient_id: PATIENT,
    status, signed_at: status === 'signed' ? SIGNED_AT : null, chief_complaint: 'S754 fixture',
  }).select('id').single();
  if (error) throw new Error('consultation ' + status + ': ' + error.message);
  created.consultations.push(data.id);
  return data.id;
};
const mkRx = async (consId, medId, { current = true, permanent = false, markers = false } = {}) => {
  const row = {
    consultation_id: consId, medication_id: medId, is_current: current,
    duration_unit: permanent ? 'permanente' : null,
  };
  if (markers) { row.instructions = M_INSTR; row.dosage = M_DOSE; row.frequency = M_FREQ; row.alternatives = M_ALT; }
  const { data, error } = await admin.from('prescriptions').insert(row).select('id').single();
  if (error) throw new Error('prescription: ' + error.message);
  created.prescriptions.push(data.id);
  return data.id;
};

console.log('═══ SMOKE s7_54 (Analytics Farma) ═══\n');

try {
  const adminUid = await login(adminCli, ADMIN_PHONE);
  await login(patientCli, PATIENT_PHONE);
  {
    const { data: prof } = await admin.from('profiles').select('role').eq('id', adminUid).single();
    if (prof?.role !== 'admin') throw new Error(`La cuenta ${ADMIN_PHONE} no es admin (role=${prof?.role})`);
  }

  // Especialidades (uuid) para el filtro.
  {
    const { data: specs } = await admin.from('specialties').select('id').limit(2);
    if (!specs || specs.length < 2) throw new Error('faltan 2 especialidades');
    SPEC = specs[0].id; OTHER_SPEC = specs[1].id;
  }
  // Medicamento GLOBAL existente (fuente global, sin ensuciar catálogo).
  {
    const { data: g } = await admin.from('medications').select('id').is('doctor_id', null).eq('is_active', true).limit(1).single();
    if (!g?.id) throw new Error('no hay medicamento global activo para el fixture');
    MED_G = g.id;
  }

  // Médico fixture aislado + paciente fixture.
  {
    const { data: cu, error: cuErr } = await admin.auth.admin.createUser({ phone: FAKE_PHONE, phone_confirm: true });
    if (cuErr) throw new Error('createUser: ' + cuErr.message);
    PROFILE = cu.user.id; created.authUser = PROFILE;
    await admin.from('profiles').update({ full_name: 'S754 Doctor Fixture', role: 'patient' }).eq('id', PROFILE);
    const { data: clinic, error: ce } = await admin.from('clinics').insert({ name: 'S754 Clínica Fixture', owner_id: PROFILE }).select('id').single();
    if (ce) throw new Error('clinic: ' + ce.message);
    CLINIC = clinic.id; created.clinic = CLINIC;
    const { data: doctor, error: de } = await admin.from('doctors').insert({ clinic_id: CLINIC, profile_id: PROFILE, specialty_id: SPEC }).select('id').single();
    if (de) throw new Error('doctor: ' + de.message);
    DOCTOR = doctor.id; created.doctor = DOCTOR;
    const { data: pat, error: pe } = await admin.from('patients').insert({
      clinic_id: CLINIC, profile_id: null, full_name: PATIENT_NAME,
      document_type: 'dui', date_of_birth: '1990-01-01', gender: 'otro', patient_type: 'privado', is_active: true,
    }).select('id').single();
    if (pe) throw new Error('patient: ' + pe.message);
    PATIENT = pat.id; created.patient = PATIENT;
    // Medicamento PERSONAL del médico fixture.
    const { data: mp, error: mpe } = await admin.from('medications').insert({
      doctor_id: DOCTOR, commercial_name: 'S754 MedPersonal ZZQ', active_ingredient: 'S754-IA-P',
      concentration: '10mg', presentation: 'capsula', is_active: true,
    }).select('id').single();
    if (mpe) throw new Error('med personal: ' + mpe.message);
    MED_P = mp.id; created.medications.push(MED_P);
  }

  // Consultas + recetas.
  {
    const c1 = await mkConsultation('signed');
    await mkRx(c1, MED_G, { permanent: true });
    await mkRx(c1, MED_P, { current: false });            // EXCLUIDA (is_current=false)
    const c2 = await mkConsultation('signed');
    await mkRx(c2, MED_G, {});
    const c3 = await mkConsultation('signed');
    await mkRx(c3, MED_G, { markers: true });             // markers de texto libre a EXCLUIR del payload
    await mkRx(c3, MED_P, {});
    const c4 = await mkConsultation('signed');
    await mkRx(c4, MED_P, {});
    const c5 = await mkConsultation('draft');
    await mkRx(c5, MED_G, {});                            // EXCLUIDA (borrador)
    ok('Fixtures sembradas (2 meds, 5 consultas, 7 recetas — 5 cuentan)');
  }

  const S = (args) => adminCli.rpc('admin_pharma_summary', { p_date_from: FROM, p_date_to: TO, ...args });

  // ═══ SUMMARY ═══
  {
    const { data, error } = await S({});
    if (error) throw new Error('summary: ' + error.message);
    eq('1 total_prescriptions', data.total_prescriptions, 5);
    eq('1 unique_medications', data.unique_medications, 2);
    eq('1 prescribing_doctors', data.prescribing_doctors, 1);
    eq('1 signed_consultations_with_meds', data.signed_consultations_with_meds, 4);
    eq('1 by_source.global', data.by_source.global, 3);
    eq('1 by_source.personal', data.by_source.personal, 2);
    eq('1 permanent', data.permanent, 1);
  }

  // Exclusión por fecha (ventana 2098 → 0).
  {
    const { data } = await adminCli.rpc('admin_pharma_summary', { p_date_from: '2098-01-01', p_date_to: '2098-12-31' });
    eq('2 fecha fuera de ventana → 0', data.total_prescriptions, 0);
  }
  // Filtro por especialidad.
  {
    const { data: same } = await S({ p_specialty_id: SPEC });
    const { data: other } = await S({ p_specialty_id: OTHER_SPEC });
    if (same.total_prescriptions === 5 && other.total_prescriptions === 0) ok('3 filtro especialidad (misma→5, otra→0)');
    else ko(`3 filtro especialidad: same=${same.total_prescriptions}, other=${other.total_prescriptions}`);
  }
  // Filtro por médico.
  {
    const { data: mine } = await S({ p_doctor_id: DOCTOR });
    const { data: other } = await S({ p_doctor_id: CAMILO_DOCTOR });
    if (mine.total_prescriptions === 5 && other.total_prescriptions === 0) ok('4 filtro médico (fixture→5, otro→0)');
    else ko(`4 filtro médico: mine=${mine.total_prescriptions}, other=${other.total_prescriptions}`);
  }

  // ═══ MEDICATION RANKING ═══
  {
    // Umbral: min_count=3 → solo MED_G (3); MED_P (2) oculto.
    const { data: r3, error: e3 } = await adminCli.rpc('admin_pharma_medication_ranking', { p_date_from: FROM, p_date_to: TO, p_limit: 50, p_min_count: 3 });
    if (e3) throw new Error('med ranking m3: ' + e3.message);
    const gRow = (r3 ?? []).find((x) => x.medication_id === MED_G);
    const pHidden = !(r3 ?? []).some((x) => x.medication_id === MED_P);
    if (gRow && pHidden) ok('5 umbral min_count=3 → MED_G visible, MED_P oculto');
    else ko('5 umbral falló: ' + JSON.stringify((r3 ?? []).map((x) => [x.medication_id, x.times_prescribed])));
    if (gRow) {
      eq('5 MED_G times_prescribed', Number(gRow.times_prescribed), 3);
      eq('5 MED_G consultations_count', Number(gRow.consultations_count), 3);
      eq('5 MED_G distinct_doctors', Number(gRow.distinct_doctors), 1);
      eq('5 MED_G is_global', gRow.is_global, true);
    }
    // min_count=1 → aparecen ambos; MED_P personal.
    const { data: r1 } = await adminCli.rpc('admin_pharma_medication_ranking', { p_date_from: FROM, p_date_to: TO, p_limit: 50, p_min_count: 1 });
    const pRow = (r1 ?? []).find((x) => x.medication_id === MED_P);
    if (pRow && Number(pRow.times_prescribed) === 2 && pRow.is_global === false) ok('6 min_count=1 → MED_P visible (2, personal)');
    else ko('6 MED_P inesperado: ' + JSON.stringify(pRow));
  }

  // ═══ DOCTOR RANKING ═══
  {
    const { data, error } = await adminCli.rpc('admin_pharma_doctor_ranking', { p_date_from: FROM, p_date_to: TO, p_limit: 50, p_min_count: 1 });
    if (error) throw new Error('doctor ranking: ' + error.message);
    const row = (data ?? []).find((x) => x.doctor_id === DOCTOR);
    if (!row) ko('7 doctor ranking: médico fixture ausente');
    else {
      eq('7 total_prescriptions', Number(row.total_prescriptions), 5);
      eq('7 unique_medications', Number(row.unique_medications), 2);
      eq('7 global_count', Number(row.global_count), 3);
      eq('7 personal_count', Number(row.personal_count), 2);
      eq('7 permanent_count', Number(row.permanent_count), 1);
    }
    // Umbral alto → médico excluido.
    const { data: hi } = await adminCli.rpc('admin_pharma_doctor_ranking', { p_date_from: FROM, p_date_to: TO, p_min_count: 100 });
    if (!(hi ?? []).some((x) => x.doctor_id === DOCTOR)) ok('8 umbral médico alto (min_count=100) → excluido');
    else ko('8 umbral médico alto no excluyó');
  }

  // ═══ 0 PII ═══
  {
    const { data: sum } = await S({});
    const { data: mr } = await adminCli.rpc('admin_pharma_medication_ranking', { p_date_from: FROM, p_date_to: TO, p_limit: 50, p_min_count: 1 });
    const { data: dr } = await adminCli.rpc('admin_pharma_doctor_ranking', { p_date_from: FROM, p_date_to: TO, p_limit: 50, p_min_count: 1 });
    const blob = JSON.stringify({ sum, mr, dr });
    const leaks = [PATIENT_NAME, M_INSTR, M_DOSE, M_FREQ, M_ALT].filter((x) => blob.includes(x));
    if (leaks.length === 0) ok('9 sin PII/texto clínico en payloads (paciente/instructions/dosage/frequency/alternatives)');
    else ko('9 FILTRÓ: ' + JSON.stringify(leaks));

    const medKeys = new Set(['medication_id', 'medication_name', 'active_ingredient', 'concentration', 'presentation', 'is_global', 'times_prescribed', 'consultations_count', 'distinct_doctors']);
    const docKeys = new Set(['doctor_id', 'doctor_name', 'specialty_name', 'total_prescriptions', 'unique_medications', 'global_count', 'personal_count', 'permanent_count']);
    const extra = new Set();
    for (const r of mr ?? []) for (const k of Object.keys(r)) if (!medKeys.has(k)) extra.add('med.' + k);
    for (const r of dr ?? []) for (const k of Object.keys(r)) if (!docKeys.has(k)) extra.add('doc.' + k);
    if (extra.size === 0) ok('10 rankings solo con claves permitidas (sin consultation_id/patient_id/texto libre)');
    else ko('10 claves inesperadas: ' + JSON.stringify([...extra]));
  }

  // ═══ Autorización ═══
  {
    const blocked = (e) => e && (e.code === 'P0001' || /No autorizado/i.test(e.message));
    const { error: e1 } = await patientCli.rpc('admin_pharma_summary', { p_date_from: FROM, p_date_to: TO });
    const { error: e2 } = await patientCli.rpc('admin_pharma_medication_ranking', { p_limit: 5 });
    const { error: e3 } = await patientCli.rpc('admin_pharma_doctor_ranking', { p_limit: 5 });
    if (blocked(e1) && blocked(e2) && blocked(e3)) ok('11 no-admin rechazado en las 3 RPCs');
    else ko('11 no-admin NO rechazado: ' + JSON.stringify({ e1, e2, e3 }));
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    for (const id of created.prescriptions) await admin.from('prescriptions').delete().eq('id', id);
    for (const id of created.consultations) await admin.from('consultations').delete().eq('id', id);
    for (const id of created.medications) await admin.from('medications').delete().eq('id', id);
    if (created.patient) await admin.from('patients').delete().eq('id', created.patient);
    if (created.doctor) await admin.from('doctors').delete().eq('id', created.doctor);
    if (created.clinic) await admin.from('clinics').delete().eq('id', created.clinic);
    if (created.authUser) await admin.auth.admin.deleteUser(created.authUser).catch(() => {});
    await adminCli.auth.signOut().catch(() => {});
    await patientCli.auth.signOut().catch(() => {});
    let residual = 0;
    for (const id of created.prescriptions) { const { data } = await admin.from('prescriptions').select('id').eq('id', id).maybeSingle(); if (data) residual++; }
    for (const id of created.consultations) { const { data } = await admin.from('consultations').select('id').eq('id', id).maybeSingle(); if (data) residual++; }
    if (created.doctor) { const { data } = await admin.from('doctors').select('id').eq('id', created.doctor).maybeSingle(); if (data) residual++; }
    if (MED_P) { const { data } = await admin.from('medications').select('id').eq('id', MED_P).maybeSingle(); if (data) residual++; }
    if (residual === 0) ok('cleanup 0 residuales');
    else ko('cleanup dejó ' + residual + ' residuales');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_54 OK' : '❌ SMOKE s7_54 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
