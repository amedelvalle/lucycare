/**
 * SMOKE s7_53 — Dashboard interno de conversiones (admin_conversion_summary +
 * admin_doctor_conversion_ranking).
 *
 * Corre con la SESIÓN del admin de plataforma (50378056365 / OTP 123456) para
 * el gate is_admin(), la del paciente test (50375000001) para el test de
 * autorización, y service_role para fixtures/cleanup.
 *
 * AISLAMIENTO: crea un MÉDICO FIXTURE propio (auth user throwaway + clínica +
 * doctor) — NO usa Camilo, Katherine ni datos reales. Todas las filas de
 * conversión se siembran en una VENTANA FUTURA (año 2099) para que los
 * agregados por rango sean deterministas (solo las fixtures caen en la ventana).
 * Cleanup total en finally (0 residuales).
 *
 * Cubre:
 *  1. summary: reservas total + by_source (directorio/manual/seguimiento).
 *  2. summary: reservas by_status (completadas/canceladas/no_show/pendientes).
 *  3. summary: waitlist total + by_status.
 *  4. summary: afiliaciones total + by_status.
 *  5. summary: reclamos desde audit_log (edited_via='claim_self_service').
 *  6. summary: reviews total + visibles + avg_rating.
 *  7. summary: supply snapshot presente/consistente.
 *  8. summary: filtro por especialidad (misma → 6; otra → 0).
 *  8b. summary: filtro por departamento y municipio (IDs TEXT; coincide → 6; otro → 0).
 *  9. summary: 0 PII en el payload.
 * 10. ranking: fila del médico fixture con conteos correctos.
 * 11. ranking: 0 PII (solo claves permitidas).
 * 12. autorización: paciente (no admin) → P0001 en ambas RPCs.
 *
 * Uso (SOLO tras aplicar s7_53): node scripts/_smoke-s7_53.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const ADMIN_PHONE = '50378056365';
const PATIENT_PHONE = '50375000001';
const OTP = '123456';

// Teléfono throwaway para el médico fixture. Guardas contra colisión con
// teléfonos protegidos (Camilo/admin/paciente-test/QA/Katherine).
const FAKE_PHONE = '50370005353';
const PROTECTED = new Set(['50378627694', '50378056365', '50375000001', '50375000099', '50372608827']);
if (PROTECTED.has(FAKE_PHONE)) throw new Error('FAKE_PHONE colisiona con un teléfono protegido');

// Ventana futura para conteos deterministas.
const FROM = '2099-01-01';
const TO = '2099-12-31';
const C = '2099-06-15T12:00:00.000Z';           // created_at de las fixtures
const START = '2099-06-15T15:00:00.000Z';
const END = '2099-06-15T15:30:00.000Z';

// Marcadores de PII improbables (para el test de 0 PII).
const PATIENT_NAME = 'S753 Paciente Fixture ZZQ';
const WL_PHONE = '50370005301';
const AFF_PHONE = '50370005302';
const AFF_EMAIL = 's753-lead-zzq@example.invalid';

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

const created = { appointments: [], waitlist: [], affiliations: [], reviews: [], auditIds: [], patient: null, doctor: null, clinic: null, authUser: null };
let PROFILE = null, CLINIC = null, DOCTOR = null, PATIENT = null, SPEC = null, OTHER_SPEC = null;
let DEPT = null, MUNI = null, OTHER_DEPT = null, OTHER_MUNI = null;

console.log('═══ SMOKE s7_53 (dashboard de conversiones) ═══\n');

try {
  const adminUid = await login(adminCli, ADMIN_PHONE);
  await login(patientCli, PATIENT_PHONE);
  {
    const { data: prof } = await admin.from('profiles').select('role').eq('id', adminUid).single();
    if (prof?.role !== 'admin') throw new Error(`La cuenta ${ADMIN_PHONE} no es admin (role=${prof?.role})`);
  }

  // Dos especialidades distintas (uuid) para el test de filtro.
  {
    const { data: specs, error } = await admin.from('specialties').select('id').limit(2);
    if (error || !specs || specs.length < 2) throw new Error('no hay 2 especialidades para el fixture');
    SPEC = specs[0].id; OTHER_SPEC = specs[1].id;
  }

  // Geo: departamento/municipio (IDs TEXT) coincidentes + otros no coincidentes.
  {
    const { data: depts, error: dErr } = await admin.from('departments').select('id').limit(2);
    if (dErr || !depts || depts.length < 2) throw new Error('no hay 2 departamentos para el fixture geo');
    DEPT = depts[0].id; OTHER_DEPT = depts[1].id;
    const { data: m1 } = await admin.from('municipalities').select('id').eq('department_id', DEPT).limit(1).single();
    const { data: m2 } = await admin.from('municipalities').select('id').eq('department_id', OTHER_DEPT).limit(1).single();
    if (!m1?.id || !m2?.id) throw new Error('no hay municipios para el fixture geo');
    MUNI = m1.id; OTHER_MUNI = m2.id;
  }

  // Médico fixture aislado (auth user throwaway → clínica → doctor).
  {
    const { data: cu, error: cuErr } = await admin.auth.admin.createUser({ phone: FAKE_PHONE, phone_confirm: true });
    if (cuErr) throw new Error('createUser: ' + cuErr.message);
    PROFILE = cu.user.id; created.authUser = PROFILE;
    await admin.from('profiles').update({ full_name: 'S753 Doctor Fixture', role: 'patient' }).eq('id', PROFILE);

    const { data: clinic, error: ce } = await admin.from('clinics').insert({ name: 'S753 Clínica Fixture', owner_id: PROFILE, department_id: DEPT, municipality_id: MUNI }).select('id').single();
    if (ce) throw new Error('clinic: ' + ce.message);
    CLINIC = clinic.id; created.clinic = CLINIC;

    const { data: doctor, error: de } = await admin.from('doctors').insert({ clinic_id: CLINIC, profile_id: PROFILE, specialty_id: SPEC }).select('id').single();
    if (de) throw new Error('doctor: ' + de.message);
    DOCTOR = doctor.id; created.doctor = DOCTOR;

    const { data: pat, error: pe } = await admin.from('patients').insert({
      clinic_id: CLINIC, profile_id: null, full_name: PATIENT_NAME,
      document_type: 'dui', date_of_birth: '1990-01-01', gender: 'otro',
      patient_type: 'privado', is_active: true,
    }).select('id').single();
    if (pe) throw new Error('patient: ' + pe.message);
    PATIENT = pat.id; created.patient = PATIENT;
  }

  // status_id por nombre.
  const statusIds = {};
  {
    const { data: sts } = await admin.from('appointment_statuses').select('id,name');
    for (const s of sts) statusIds[s.name] = s.id;
    for (const n of ['atendida', 'cancelada', 'no_asistio', 'programada']) {
      if (!statusIds[n]) throw new Error('falta appointment_status: ' + n);
    }
  }

  // 6 citas: dir+atendida×2, dir+cancelada, seg+atendida, manual+no_asistio, manual+programada.
  const apptSpec = [
    ['lucy_directorio', 'atendida'],
    ['lucy_directorio', 'atendida'],
    ['lucy_directorio', 'cancelada'],
    ['lucy_seguimiento', 'atendida'],
    ['manual', 'no_asistio'],
    ['manual', 'programada'],
  ];
  for (const [source, status] of apptSpec) {
    const { data, error } = await admin.from('appointments').insert({
      clinic_id: CLINIC, doctor_id: DOCTOR, patient_id: PATIENT,
      status_id: statusIds[status], source,
      start_time: START, end_time: END, created_at: C,
    }).select('id').single();
    if (error) throw new Error(`appointment ${source}/${status}: ${error.message}`);
    created.appointments.push(data.id);
  }

  // Waitlist ×2 (pending, contacted).
  for (const [status, ph] of [['pending', WL_PHONE], ['contacted', '50370005303']]) {
    const { data, error } = await admin.from('waitlist_entries').insert({
      doctor_id: DOCTOR, patient_name: PATIENT_NAME, patient_phone: ph,
      patient_phone_normalized: ph, patient_message: 'S753 fixture', status,
      source: 'public_directory', created_at: C,
    }).select('id').single();
    if (error) throw new Error(`waitlist ${status}: ${error.message}`);
    created.waitlist.push(data.id);
  }

  // Afiliaciones ×2 (pending, approved).
  for (const [status, ph, email] of [['pending', AFF_PHONE, AFF_EMAIL], ['approved', '50370005304', null]]) {
    const { data, error } = await admin.from('doctor_affiliation_requests').insert({
      full_name: 'S753 Lead Fixture', phone: ph, phone_normalized: ph, email,
      specialty_id: SPEC, status, consent_accepted_at: C, consent_version: 'smoke-s753', created_at: C,
    }).select('id').single();
    if (error) throw new Error(`affiliation ${status}: ${error.message}`);
    created.affiliations.push(data.id);
  }

  // Reviews ×2 (rating 4 y 5, visibles) → avg 4.5.
  for (const rating of [4, 5]) {
    const { data, error } = await admin.from('reviews').insert({
      doctor_id: DOCTOR, patient_profile_id: PROFILE, rating, is_visible: true, created_at: C,
    }).select('id').single();
    if (error) throw new Error(`review ${rating}: ${error.message}`);
    created.reviews.push(data.id);
  }

  // Claim fixture en audit_log (edited_via='claim_self_service'), ventana futura.
  {
    const { data, error } = await admin.from('audit_log').insert({
      user_id: PROFILE, action: 'update', table_name: 'doctors', record_id: DOCTOR,
      new_data: { edited_via: 'claim_self_service' }, created_at: C,
    }).select('id').single();
    if (error) throw new Error('audit claim fixture: ' + error.message);
    created.auditIds.push(data.id);
  }

  ok('Fixtures sembradas (médico fixture + 6 citas + 2 waitlist + 2 afiliaciones + 2 reviews + 1 claim)');

  // ═══ SUMMARY (ventana 2099) ═══
  const { data: S, error: sErr } = await adminCli.rpc('admin_conversion_summary', { p_date_from: FROM, p_date_to: TO });
  if (sErr) throw new Error('summary error: ' + sErr.message);

  // 1. reservas + by_source
  eq('1 bookings.total', S.bookings.total, 6);
  eq('1 by_source.lucy_directorio', S.bookings.by_source.lucy_directorio, 3);
  eq('1 by_source.manual', S.bookings.by_source.manual, 2);
  eq('1 by_source.lucy_seguimiento', S.bookings.by_source.lucy_seguimiento, 1);

  // 2. by_status
  eq('2 completadas', S.bookings.by_status.completadas, 3);
  eq('2 canceladas', S.bookings.by_status.canceladas, 1);
  eq('2 no_show', S.bookings.by_status.no_show, 1);
  eq('2 pendientes', S.bookings.by_status.pendientes, 1);

  // 3. waitlist
  eq('3 waitlist.total', S.waitlist.total, 2);
  eq('3 waitlist.pending', S.waitlist.by_status.pending, 1);
  eq('3 waitlist.contacted', S.waitlist.by_status.contacted, 1);

  // 4. afiliaciones
  eq('4 affiliations.total', S.affiliations.total, 2);
  eq('4 affiliations.pending', S.affiliations.by_status.pending, 1);
  eq('4 affiliations.approved', S.affiliations.by_status.approved, 1);

  // 5. claims desde audit_log
  eq('5 claims.total', S.claims.total, 1);

  // 6. reviews
  eq('6 reviews.total', S.reviews.total, 2);
  eq('6 reviews.visibles', S.reviews.visibles, 2);
  eq('6 reviews.avg_rating', Number(S.reviews.avg_rating), 4.5);

  // 7. supply snapshot consistente (no date-ranged)
  if (typeof S.supply?.total_doctors === 'number' && S.supply.total_doctors >= 1
      && S.supply.by_lucy_status?.listed_only >= 1) ok('7 supply snapshot presente y consistente');
  else ko('7 supply snapshot inesperado: ' + JSON.stringify(S.supply));

  // 8. filtro por especialidad
  {
    const { data: sSame } = await adminCli.rpc('admin_conversion_summary', { p_date_from: FROM, p_date_to: TO, p_specialty_id: SPEC });
    const { data: sOther } = await adminCli.rpc('admin_conversion_summary', { p_date_from: FROM, p_date_to: TO, p_specialty_id: OTHER_SPEC });
    if (sSame?.bookings?.total === 6 && sOther?.bookings?.total === 0) ok('8 filtro especialidad (misma→6, otra→0)');
    else ko(`8 filtro especialidad falló: misma=${sSame?.bookings?.total}, otra=${sOther?.bookings?.total}`);
  }

  // 8b. filtro por departamento y municipio (IDs TEXT)
  {
    const totalFor = async (args) => {
      const { data, error } = await adminCli.rpc('admin_conversion_summary', { p_date_from: FROM, p_date_to: TO, ...args });
      if (error) throw new Error('geo summary error: ' + error.message);
      return data?.bookings?.total;
    };
    const deptMatch = await totalFor({ p_department_id: DEPT });
    const deptMiss = await totalFor({ p_department_id: OTHER_DEPT });
    const muniMatch = await totalFor({ p_municipality_id: MUNI });
    const muniMiss = await totalFor({ p_municipality_id: OTHER_MUNI });
    if (deptMatch === 6 && deptMiss === 0) ok('8b filtro departamento (coincide→6, otro→0)');
    else ko(`8b filtro departamento falló: match=${deptMatch}, miss=${deptMiss}`);
    if (muniMatch === 6 && muniMiss === 0) ok('8b filtro municipio (coincide→6, otro→0)');
    else ko(`8b filtro municipio falló: match=${muniMatch}, miss=${muniMiss}`);
  }

  // 9. 0 PII en el payload del summary
  {
    const blob = JSON.stringify(S);
    const leaks = [PATIENT_NAME, WL_PHONE, AFF_PHONE, AFF_EMAIL].filter((x) => blob.includes(x));
    if (leaks.length === 0) ok('9 summary sin PII (ni nombre/teléfono/email de fixtures)');
    else ko('9 summary FILTRÓ PII: ' + JSON.stringify(leaks));
  }

  // ═══ RANKING (ventana 2099) ═══
  const { data: R, error: rErr } = await adminCli.rpc('admin_doctor_conversion_ranking', { p_date_from: FROM, p_date_to: TO, p_limit: 100 });
  if (rErr) throw new Error('ranking error: ' + rErr.message);

  // 10. fila del médico fixture
  {
    const row = (R ?? []).find((r) => r.doctor_id === DOCTOR);
    if (!row) ko('10 ranking: médico fixture ausente');
    else {
      eq('10 ranking bookings_total', Number(row.bookings_total), 6);
      eq('10 ranking bookings_directorio', Number(row.bookings_directorio), 3);
      eq('10 ranking waitlist_total', Number(row.waitlist_total), 2);
      eq('10 ranking reviews_total', Number(row.reviews_total), 2);
      eq('10 ranking avg_rating', Number(row.avg_rating), 4.5);
    }
  }

  // 11. 0 PII en ranking (solo claves permitidas)
  {
    const allowed = new Set(['doctor_id', 'doctor_slug', 'doctor_name', 'specialty_name', 'bookings_total', 'bookings_directorio', 'waitlist_total', 'reviews_total', 'avg_rating']);
    const extra = new Set();
    for (const r of R ?? []) for (const k of Object.keys(r)) if (!allowed.has(k)) extra.add(k);
    if (extra.size === 0) ok('11 ranking solo claves permitidas (0 PII)');
    else ko('11 ranking claves inesperadas: ' + JSON.stringify([...extra]));
  }

  // 12. autorización: paciente (no admin) → P0001.
  {
    const { error: e1 } = await patientCli.rpc('admin_conversion_summary', { p_date_from: FROM, p_date_to: TO });
    const { error: e2 } = await patientCli.rpc('admin_doctor_conversion_ranking', { p_limit: 5 });
    const blocked = (e) => e && (e.code === 'P0001' || /No autorizado/i.test(e.message));
    if (blocked(e1) && blocked(e2)) ok('12 no-admin rechazado en ambas RPCs');
    else ko('12 no-admin NO rechazado: ' + JSON.stringify({ e1, e2 }));
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    for (const id of created.auditIds) await admin.from('audit_log').delete().eq('id', id);
    for (const id of created.reviews) await admin.from('reviews').delete().eq('id', id);
    for (const id of created.waitlist) await admin.from('waitlist_entries').delete().eq('id', id);
    for (const id of created.affiliations) await admin.from('doctor_affiliation_requests').delete().eq('id', id);
    for (const id of created.appointments) await admin.from('appointments').delete().eq('id', id);
    if (created.patient) await admin.from('patients').delete().eq('id', created.patient);
    if (created.doctor) await admin.from('doctors').delete().eq('id', created.doctor);
    if (created.clinic) await admin.from('clinics').delete().eq('id', created.clinic);
    if (created.authUser) await admin.auth.admin.deleteUser(created.authUser).catch(() => {});
    await adminCli.auth.signOut().catch(() => {});
    await patientCli.auth.signOut().catch(() => {});

    // Verificación de 0 residuales.
    let residual = 0;
    for (const id of created.appointments) { const { data } = await admin.from('appointments').select('id').eq('id', id).maybeSingle(); if (data) residual++; }
    if (created.doctor) { const { data } = await admin.from('doctors').select('id').eq('id', created.doctor).maybeSingle(); if (data) residual++; }
    for (const id of created.auditIds) { const { data } = await admin.from('audit_log').select('id').eq('id', id).maybeSingle(); if (data) residual++; }
    if (residual === 0) ok('cleanup 0 residuales');
    else ko('cleanup dejó ' + residual + ' residuales');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_53 OK' : '❌ SMOKE s7_53 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
