/**
 * SMOKE s7_43 — B2: confirmación post-claim de fichas vinculadas.
 *
 * Corre con la SESIÓN del paciente test (50375000001) para las RPCs
 * self-gated, la de Camilo (50378627694) para el gate de fichas ajenas y el
 * re-link por otro profile, y service_role para fixtures/cleanup. Crea TODO
 * aislado y limpia en finally (sin datos basura).
 *
 * Cubre:
 *  1. claim vincula fichas sin dueño por teléfono → link_confirmed_at NULL.
 *  2. La cita de una ficha NO confirmada NO aparece en la query de
 *     "Mis atenciones" (filtro confirmed-only); tras confirmar, SÍ aparece.
 *  3. confirm_patient_link → sella link_confirmed_at + audit 'link_confirmed';
 *     re-confirmar es idempotente (already_confirmed).
 *  4. reject_patient_link → profile_id NULL + rejection pending_review + audit.
 *  5. re-claim NO re-vincula la ficha rechazada (no-relink) y sigue idempotente.
 *  6. Otro profile legítimo SÍ puede vincular la ficha rechazada (par distinto).
 *  7. Gate: otra sesión no puede confirmar/rechazar fichas ajenas (P0040).
 *
 * Uso (SOLO después de aplicar s7_43): node scripts/_smoke-s7_43.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const PATIENT_PHONE = '50375000001';
const CAMILO_PHONE = '50378627694';
const CAMILO_CLINIC = '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0';
const CAMILO_DOCTOR = '783a902a-55fd-407c-9e0a-69568135c7f5';
const OTP = '123456';

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

let fichaA = null, fichaB = null, apptId = null, otherClinic = null;
const patient = mk();
const camilo = mk();

console.log('═══ SMOKE s7_43 (confirmación post-claim) ═══\n');

try {
  const patientUid = await login(patient, PATIENT_PHONE);
  const camiloUid = await login(camilo, CAMILO_PHONE);

  const { data: oc } = await admin.from('clinics').select('id').neq('id', CAMILO_CLINIC).limit(1).single();
  otherClinic = oc.id;

  // Fixtures: 2 fichas SIN dueño con el teléfono del paciente test.
  const mkFicha = async (clinicId, name) => {
    const { data, error } = await admin.from('patients').insert({
      clinic_id: clinicId, profile_id: null, full_name: name,
      document_type: 'dui', document_number: null, date_of_birth: '1990-01-01',
      gender: 'otro', patient_type: 'privado', phone: PATIENT_PHONE, is_active: true,
    }).select('id').single();
    if (error) throw new Error('fixture ' + name + ': ' + error.message);
    return data.id;
  };
  fichaA = await mkFicha(CAMILO_CLINIC, 'S743 Ficha A');
  fichaB = await mkFicha(otherClinic, 'S743 Ficha B');

  // Una cita en ficha A (para el assert del filtro confirmed-only).
  const { data: st } = await admin.from('appointment_statuses').select('id').limit(1).single();
  const now = new Date();
  const { data: appt, error: apErr } = await admin.from('appointments').insert({
    clinic_id: CAMILO_CLINIC, doctor_id: CAMILO_DOCTOR, patient_id: fichaA,
    status_id: st.id, start_time: now.toISOString(),
    end_time: new Date(now.getTime() + 30 * 60000).toISOString(), source: 'manual',
  }).select('id').single();
  if (apErr) throw new Error('fixture cita: ' + apErr.message);
  apptId = appt.id;
  ok('Fixtures: ficha A (Camilo, con 1 cita) + ficha B (otra clínica), sin dueño');

  // 1. claim → vincula con link_confirmed_at NULL
  {
    const { data, error } = await patient.rpc('claim_patient_records');
    if (error) ko('1 claim error: ' + error.message);
    else {
      const { data: rows } = await admin.from('patients')
        .select('id, profile_id, link_confirmed_at').in('id', [fichaA, fichaB]);
      const allLinked = (rows ?? []).every((r) => r.profile_id === patientUid && r.link_confirmed_at === null);
      if (allLinked) ok(`1 claim vinculó A y B (linked_count=${data?.linked_count}) con link_confirmed_at NULL`);
      else ko('1 estado post-claim inesperado: ' + JSON.stringify(rows));
    }
  }

  // 2a. Filtro confirmed-only: la cita de A NO debe aparecer aún.
  const myAppointments = async () => {
    const { data, error } = await patient.from('appointments')
      .select('id, patient:patient_id!inner ( profile_id, link_confirmed_at )')
      .eq('patient.profile_id', patientUid)
      .not('patient.link_confirmed_at', 'is', null);
    if (error) throw new Error('query mis-atenciones: ' + error.message);
    return (data ?? []).map((r) => r.id);
  };
  {
    const ids = await myAppointments();
    if (!ids.includes(apptId)) ok('2a Cita de ficha NO confirmada: fuera de "Mis atenciones"');
    else ko('2a La cita apareció sin confirmar');
  }

  // 3. confirm A → sella + audit; idempotente.
  {
    const { data, error } = await patient.rpc('confirm_patient_link', { p_patient_id: fichaA });
    if (error) ko('3 confirm error: ' + error.message);
    else {
      const { data: row } = await admin.from('patients').select('link_confirmed_at').eq('id', fichaA).single();
      if (row?.link_confirmed_at) ok('3 confirm selló link_confirmed_at');
      else ko('3 link_confirmed_at sigue NULL');

      const { data: aud } = await admin.from('audit_log').select('new_data')
        .eq('table_name', 'patients').eq('record_id', fichaA)
        .order('created_at', { ascending: false }).limit(1);
      if (aud?.[0]?.new_data?.edited_via === 'link_confirmed') ok('3 audit edited_via=link_confirmed');
      else ko('3 audit inesperado: ' + JSON.stringify(aud?.[0]?.new_data));

      const { data: again } = await patient.rpc('confirm_patient_link', { p_patient_id: fichaA });
      if (again?.already_confirmed === true) ok('3 re-confirm idempotente (already_confirmed)');
      else ko('3 re-confirm inesperado: ' + JSON.stringify(again));
    }
  }

  // 2b. Tras confirmar, la cita SÍ aparece.
  {
    const ids = await myAppointments();
    if (ids.includes(apptId)) ok('2b Tras confirmar: la cita aparece en "Mis atenciones"');
    else ko('2b La cita no apareció tras confirmar');
  }

  // 4. reject B → desvincula + rejection pending_review + audit.
  {
    const { error } = await patient.rpc('reject_patient_link', { p_patient_id: fichaB });
    if (error) ko('4 reject error: ' + error.message);
    else {
      const { data: row } = await admin.from('patients').select('profile_id, link_confirmed_at').eq('id', fichaB).single();
      if (row?.profile_id === null && row?.link_confirmed_at === null) ok('4 reject desvinculó la ficha');
      else ko('4 ficha B no quedó desvinculada: ' + JSON.stringify(row));

      const { data: rej } = await admin.from('patient_link_rejections')
        .select('status, profile_id, phone_normalized').eq('patient_id', fichaB).single();
      if (rej?.status === 'pending_review' && rej?.profile_id === patientUid) ok('4 rechazo registrado pending_review');
      else ko('4 rechazo inesperado: ' + JSON.stringify(rej));

      const { data: aud } = await admin.from('audit_log').select('new_data')
        .eq('table_name', 'patients').eq('record_id', fichaB)
        .order('created_at', { ascending: false }).limit(1);
      if (aud?.[0]?.new_data?.edited_via === 'link_rejected') ok('4 audit edited_via=link_rejected');
      else ko('4 audit inesperado: ' + JSON.stringify(aud?.[0]?.new_data));
    }
  }

  // 5. re-claim → NO re-vincula B; A intacta; idempotente.
  {
    const { data, error } = await patient.rpc('claim_patient_records');
    if (error) ko('5 re-claim error: ' + error.message);
    else {
      const { data: rowB } = await admin.from('patients').select('profile_id').eq('id', fichaB).single();
      const { data: rowA } = await admin.from('patients').select('profile_id, link_confirmed_at').eq('id', fichaA).single();
      if (rowB?.profile_id === null) ok('5 re-claim NO re-vinculó la ficha rechazada');
      else ko('5 ¡la ficha rechazada se re-vinculó!: ' + JSON.stringify(rowB));
      if (rowA?.profile_id === patientUid && rowA?.link_confirmed_at) ok('5 ficha confirmada intacta (idempotente)');
      else ko('5 ficha A cambió: ' + JSON.stringify(rowA));
    }
  }

  // 6. Otro profile legítimo SÍ puede vincular la ficha rechazada.
  {
    // Cambiar el teléfono de B al de Camilo (ficha sin dueño → guard permite).
    await admin.from('patients').update({ phone: CAMILO_PHONE }).eq('id', fichaB);
    const { error } = await camilo.rpc('claim_patient_records');
    const { data: rowB } = await admin.from('patients').select('profile_id, link_confirmed_at').eq('id', fichaB).single();
    if (!error && rowB?.profile_id === camiloUid && rowB?.link_confirmed_at === null)
      ok('6 Otro profile vinculó la ficha rechazada (rechazo es por par, no por ficha)');
    else ko('6 re-link por otro profile falló: ' + JSON.stringify({ error: error?.message, rowB }));
  }

  // 7. Gate: el paciente NO puede confirmar/rechazar la ficha de Camilo (ajena).
  {
    const { error: e1 } = await patient.rpc('confirm_patient_link', { p_patient_id: fichaB });
    const { error: e2 } = await patient.rpc('reject_patient_link', { p_patient_id: fichaB });
    if (e1?.code === 'P0040' && e2?.code === 'P0040') ok('7 Gate fichas ajenas: confirm y reject → P0040');
    else ko('7 gate inesperado: ' + JSON.stringify({ e1: e1?.code, e2: e2?.code }));
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    if (apptId) await admin.from('appointments').delete().eq('id', apptId);
    for (const id of [fichaA, fichaB].filter(Boolean)) {
      await admin.from('patient_link_rejections').delete().eq('patient_id', id);
      await admin.from('patients').delete().eq('id', id);
    }
    await patient.auth.signOut().catch(() => {});
    await camilo.auth.signOut().catch(() => {});
    console.log('  ✅ cleanup OK');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_43 OK' : '❌ SMOKE s7_43 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
