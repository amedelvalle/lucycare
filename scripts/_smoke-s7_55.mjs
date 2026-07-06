/**
 * SMOKE s7_55 — bloqueo atómico de doble reserva (trigger anti-solapamiento).
 *
 * FIXTURES AISLADAS (service_role) — NO usa Camilo/Katherine ni datos reales, NO
 * toca el duplicado real de producción. Dos médicos fixture propios (auth user
 * throwaway + clínica + doctor) con availability_rules (06:00–20:00 local, para
 * no repetir el problema de s7_54 y para probar el respeto a s6_04). Ventana
 * futura (2099) en hora local El Salvador (-06:00). Cleanup total (0 residuales).
 *
 * Casos (lista del owner):
 *   1. cita A válida entra
 *   2. cita B exactamente en el mismo horario falla (P0090)
 *   3. cita parcialmente solapada falla
 *   4. cita adyacente (una termina donde empieza otra) entra
 *   5. otro médico en el mismo horario entra
 *   6. cita ENTRANTE con estado final no se valida → entra
 *   7. cita final EXISTENTE (cancelada) en el mismo horario no bloquea una nueva activa
 *   8. update/reschedule hacia horario ocupado falla
 *   9. update/reschedule hacia horario libre entra
 *  10. disponibilidad del médico sigue respetándose (s6_04 intacto)
 *  11. cleanup 0 residuales
 *
 * Uso (SOLO tras aplicar s7_55): node scripts/_smoke-s7_55.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

const FAKE_1 = '50370005551', FAKE_2 = '50370005552';
const PROTECTED = new Set(['50378627694', '50378056365', '50375000001', '50375000099', '50372608827']);
for (const p of [FAKE_1, FAKE_2]) if (PROTECTED.has(p)) throw new Error('FAKE phone colisiona con protegido: ' + p);

// Hora local El Salvador (-06:00), ventana futura 2099-06-15.
const t = (h, m = 0) => `2099-06-15T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-06:00`;

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

const created = { appointments: [], availability: [], doctors: [], patient: null, clinic: null, authUsers: [] };
let CLINIC = null, DOCTOR = null, DOCTOR2 = null, PATIENT = null, SPEC = null;
const ST = {}; // status name → id

const isP0090 = (e) => e && (e.code === 'P0090' || /ya está ocupado/i.test(e.message || ''));
const isAvail = (e) => e && /disponibilidad en ese horario/i.test(e.message || '');

async function mkDoctor(phone) {
  const { data: cu, error } = await admin.auth.admin.createUser({ phone, phone_confirm: true });
  if (error) throw new Error('createUser ' + phone + ': ' + error.message);
  const profile = cu.user.id; created.authUsers.push(profile);
  await admin.from('profiles').update({ full_name: 'S755 Doctor', role: 'patient' }).eq('id', profile);
  if (!CLINIC) {
    const { data: clinic, error: ce } = await admin.from('clinics').insert({ name: 'S755 Clínica Fixture', owner_id: profile }).select('id').single();
    if (ce) throw new Error('clinic: ' + ce.message);
    CLINIC = clinic.id; created.clinic = CLINIC;
  }
  const { data: doc, error: de } = await admin.from('doctors').insert({ clinic_id: CLINIC, profile_id: profile, specialty_id: SPEC }).select('id').single();
  if (de) throw new Error('doctor: ' + de.message);
  created.doctors.push(doc.id);
  // Disponibilidad 06:00–20:00 los 7 días (permite las citas de prueba y deja fuera 22:00).
  for (let dow = 0; dow < 7; dow++) {
    const { data: ar, error: ae } = await admin.from('availability_rules').insert({
      doctor_id: doc.id, clinic_id: CLINIC, day_of_week: dow, start_time: '06:00:00', end_time: '20:00:00', is_active: true,
    }).select('id').single();
    if (ae) throw new Error('availability dow ' + dow + ': ' + ae.message);
    created.availability.push(ar.id);
  }
  return doc.id;
}

// Inserta una cita; devuelve { id, error }. NO agrega a created si falló.
async function mkAppt(doctorId, start, end, statusName) {
  const { data, error } = await admin.from('appointments').insert({
    clinic_id: CLINIC, doctor_id: doctorId, patient_id: PATIENT,
    status_id: ST[statusName], start_time: start, end_time: end, source: 'manual', payment_status: 'pending',
  }).select('id').single();
  if (data?.id) created.appointments.push(data.id);
  return { id: data?.id ?? null, error };
}

console.log('═══ SMOKE s7_55 (anti-solapamiento de citas) ═══\n');

try {
  {
    const { data: specs } = await admin.from('specialties').select('id').limit(1).single();
    if (!specs?.id) throw new Error('no hay especialidad');
    SPEC = specs.id;
    const { data: sts } = await admin.from('appointment_statuses').select('id,name');
    for (const s of sts) ST[s.name] = s.id;
    for (const n of ['programada', 'atendida', 'cancelada']) if (!ST[n]) throw new Error('falta status ' + n);
  }

  DOCTOR = await mkDoctor(FAKE_1);
  DOCTOR2 = await mkDoctor(FAKE_2);
  {
    const { data: pat, error } = await admin.from('patients').insert({
      clinic_id: CLINIC, profile_id: null, full_name: 'S755 Paciente Fixture',
      document_type: 'dui', date_of_birth: '1990-01-01', gender: 'otro', patient_type: 'privado', is_active: true,
    }).select('id').single();
    if (error) throw new Error('patient: ' + error.message);
    PATIENT = pat.id; created.patient = PATIENT;
  }
  ok('Fixtures: 2 médicos + clínica + paciente + disponibilidad 06:00–20:00');

  // 1. Cita A válida (10:00–10:30, programada) entra.
  const A = await mkAppt(DOCTOR, t(10, 0), t(10, 30), 'programada');
  if (!A.error && A.id) ok('1 cita A válida entra'); else ko('1 A no entró: ' + JSON.stringify(A.error));

  // 2. Exactamente mismo horario → P0090.
  { const r = await mkAppt(DOCTOR, t(10, 0), t(10, 30), 'programada'); if (isP0090(r.error)) ok('2 mismo horario → bloqueado (P0090)'); else ko('2 no bloqueó: ' + JSON.stringify(r.error)); }

  // 3. Parcialmente solapada (10:15–10:45) → P0090.
  { const r = await mkAppt(DOCTOR, t(10, 15), t(10, 45), 'programada'); if (isP0090(r.error)) ok('3 solape parcial → bloqueado'); else ko('3 no bloqueó: ' + JSON.stringify(r.error)); }

  // 4. Adyacente (10:30–11:00) entra.
  { const r = await mkAppt(DOCTOR, t(10, 30), t(11, 0), 'programada'); if (!r.error && r.id) ok('4 adyacente (10:30–11:00) entra'); else ko('4 adyacente no entró: ' + JSON.stringify(r.error)); }

  // 5. Otro médico mismo horario (10:00–10:30) entra.
  { const r = await mkAppt(DOCTOR2, t(10, 0), t(10, 30), 'programada'); if (!r.error && r.id) ok('5 otro médico mismo horario entra'); else ko('5 otro médico no entró: ' + JSON.stringify(r.error)); }

  // 6. Cita ENTRANTE final (atendida) en el mismo horario que A → entra (no se valida).
  { const r = await mkAppt(DOCTOR, t(10, 0), t(10, 30), 'atendida'); if (!r.error && r.id) ok('6 entrante final (atendida) no se valida → entra'); else ko('6 entrante final no entró: ' + JSON.stringify(r.error)); }

  // 7. Cita final EXISTENTE (cancelada 11:00–11:30) no bloquea una nueva activa en ese horario.
  {
    const c = await mkAppt(DOCTOR, t(11, 0), t(11, 30), 'cancelada');
    if (c.error) ko('7 no se pudo sembrar cancelada: ' + JSON.stringify(c.error));
    else {
      const r = await mkAppt(DOCTOR, t(11, 0), t(11, 30), 'programada');
      if (!r.error && r.id) ok('7 cancelada existente no bloquea nueva activa'); else ko('7 bloqueó contra una cancelada: ' + JSON.stringify(r.error));
    }
  }

  // 8/9. Reschedule: cita X a 15:00 (libre) entra; mover a 10:00 (ocupado) falla; mover a 13:00 (libre) entra.
  {
    const X = await mkAppt(DOCTOR, t(15, 0), t(15, 30), 'programada');
    if (X.error || !X.id) ko('8-pre X no entró: ' + JSON.stringify(X.error));
    else {
      const { error: e8 } = await admin.from('appointments').update({ start_time: t(10, 0), end_time: t(10, 30) }).eq('id', X.id);
      if (isP0090(e8)) ok('8 reschedule hacia horario ocupado → bloqueado'); else ko('8 reschedule ocupado no bloqueó: ' + JSON.stringify(e8));
      const { error: e9 } = await admin.from('appointments').update({ start_time: t(13, 0), end_time: t(13, 30) }).eq('id', X.id);
      if (!e9) ok('9 reschedule hacia horario libre entra'); else ko('9 reschedule libre falló: ' + JSON.stringify(e9));
    }
  }

  // 10. Disponibilidad respetada (s6_04): 22:00 está fuera de 06:00–20:00 → bloqueado por disponibilidad.
  { const r = await mkAppt(DOCTOR, t(22, 0), t(22, 30), 'programada'); if (isAvail(r.error)) ok('10 fuera de disponibilidad → bloqueado (s6_04 intacto)'); else ko('10 disponibilidad no respetada: ' + JSON.stringify(r.error)); }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    for (const id of created.appointments) await admin.from('appointments').delete().eq('id', id);
    for (const id of created.availability) await admin.from('availability_rules').delete().eq('id', id);
    if (created.patient) await admin.from('patients').delete().eq('id', created.patient);
    for (const id of created.doctors) await admin.from('doctors').delete().eq('id', id);
    if (created.clinic) await admin.from('clinics').delete().eq('id', created.clinic);
    for (const id of created.authUsers) await admin.auth.admin.deleteUser(id).catch(() => {});
    let residual = 0;
    for (const id of created.appointments) { const { data } = await admin.from('appointments').select('id').eq('id', id).maybeSingle(); if (data) residual++; }
    for (const id of created.doctors) { const { data } = await admin.from('doctors').select('id').eq('id', id).maybeSingle(); if (data) residual++; }
    if (created.clinic) { const { data } = await admin.from('clinics').select('id').eq('id', created.clinic).maybeSingle(); if (data) residual++; }
    if (residual === 0) ok('11 cleanup 0 residuales');
    else ko('11 cleanup dejó ' + residual + ' residuales');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_55 OK' : '❌ SMOKE s7_55 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
