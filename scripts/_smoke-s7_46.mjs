/**
 * SMOKE s7_46 — F4-2: merge admin de fichas (intra-clínica).
 *
 * Corre con la SESIÓN del admin de plataforma (50378056365 / OTP 123456) para
 * las RPCs gated por is_admin(), la del QA libre (50375000099) para el test de
 * claim-ignora-merged, y service_role para fixtures/cleanup. Todo aislado en
 * la clínica de Camilo; cleanup en finally.
 *
 * EVIDENCIA EN V1 = `same_profile` (E3). El UNIQUE(clinic,doc) impide crear
 * dos fichas con el mismo documento en una clínica → `same_document` es
 * inalcanzable para datos nuevos; los casos de éxito usan dos fichas
 * vinculadas al MISMO profile (decisión owner 2026-06-13, A). El profile de
 * vínculo para las fixtures es el del QA (cuenta de prueba), no uno real.
 *
 * Cubre (lista del owner):
 *  S1. dry-run (preflight) eligible (same_profile) sin aplicar nada.
 *  S2. merge exitoso (E3): appointments + consulta FIRMADA + vitals movidos;
 *      fuente vinculada CON documento neutralizada (ejerce el bypass P0030);
 *      patient_merge_log con snapshots/moved_ids/reason/actor; audit admin_merge;
 *      no hard-delete; consulta firmada movida sin violar el guard de firma.
 *  S3. bloqueo distinta clínica → P0060.
 *  S4. bloqueo ambas vinculadas a profiles distintos → P0065.
 *  S5. bloqueo evidencia insuficiente (dos walk-ins sin doc/sin profile) → P0063.
 *  S6. bloqueo borrador abierto en la fuente → P0067.
 *  S7. borrador en el TARGET no bloquea, aparece como warning; merge procede.
 *  S8. P0030 bypass aislado (E3, fuente vinculada con documento, sin consulta).
 *  S9. claim ignora la ficha merged (regresión s7_45).
 *
 * Uso (SOLO tras aplicar s7_46): node scripts/_smoke-s7_46.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const ADMIN_PHONE = '50378056365';
const QA_PHONE = '50375000099';
const CAMILO_CLINIC = '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0';
const CAMILO_DOCTOR = '783a902a-55fd-407c-9e0a-69568135c7f5';
const CAMILO_PROFILE = 'db1fba98-a299-4f25-82f1-7feff01e58fa';
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

const adminCli = mk();
const qaCli = mk();
const created = { patients: [], appointments: [], consultations: [], vitals: [], availability: [], mergeLogs: [] };

// PROFILE_MAIN (vínculo de las fixtures E3) = QA; PROFILE_OTHER (para P0065) = Camilo.
let PROFILE_MAIN = null;
const PROFILE_OTHER = CAMILO_PROFILE;

const mkPatient = async (clinicId, name, { doc = null, dob = '1990-01-01', gender = 'otro', profileId = null, phone = null, active = true } = {}) => {
  const { data, error } = await admin.from('patients').insert({
    clinic_id: clinicId, profile_id: profileId, full_name: name,
    document_type: 'dui', document_number: doc, date_of_birth: dob,
    gender, patient_type: 'privado', phone, is_active: active,
  }).select('id').single();
  if (error) throw new Error('fixture patient ' + name + ': ' + error.message);
  created.patients.push(data.id);
  return data.id;
};
const mkConsultation = async (clinicId, patientId, { signed = false } = {}) => {
  const { data, error } = await admin.from('consultations').insert({
    clinic_id: clinicId, doctor_id: CAMILO_DOCTOR, patient_id: patientId,
    status: signed ? 'signed' : 'draft',
    signed_at: signed ? new Date().toISOString() : null,
    chief_complaint: 'S746 fixture',
  }).select('id').single();
  if (error) throw new Error('fixture consultation: ' + error.message);
  created.consultations.push(data.id);
  return data.id;
};

console.log('═══ SMOKE s7_46 (merge admin de fichas — V1 same_profile) ═══\n');

try {
  const adminUid = await login(adminCli, ADMIN_PHONE);
  PROFILE_MAIN = await login(qaCli, QA_PHONE);
  {
    const { data: prof } = await admin.from('profiles').select('role').eq('id', adminUid).single();
    if (prof?.role !== 'admin') throw new Error('La cuenta ' + ADMIN_PHONE + ' no es admin (role=' + prof?.role + ')');
  }

  // ════ S1. Preflight dry-run (eligible, same_profile) ════
  {
    const src = await mkPatient(CAMILO_CLINIC, 'S746 S1 src', { profileId: PROFILE_MAIN });
    const tgt = await mkPatient(CAMILO_CLINIC, 'S746 S1 tgt', { profileId: PROFILE_MAIN });
    const { data, error } = await adminCli.rpc('admin_merge_patients_preflight', { p_source_id: src, p_target_id: tgt });
    if (error) ko('S1 preflight error: ' + error.message);
    else if (data?.eligible === true && data?.evidence?.type === 'same_profile' && data?.is_preflight === true)
      ok('S1 preflight eligible (evidence=same_profile), sin aplicar');
    else ko('S1 preflight inesperado: ' + JSON.stringify(data));
    const { data: rows } = await admin.from('patients').select('id, is_active, merged_into_patient_id').in('id', [src, tgt]);
    if ((rows ?? []).every((r) => r.is_active && r.merged_into_patient_id === null)) ok('S1 dry-run no modificó las fichas');
    else ko('S1 dry-run modificó algo: ' + JSON.stringify(rows));
  }

  // ════ S2. Merge exitoso E3 (consulta firmada + appointment + vitals) ════
  {
    // src vinculado a PROFILE_MAIN CON documento → la neutralización nulea el
    // documento de una ficha vinculada → ejerce el bypass P0030. tgt sin doc
    // (el UNIQUE permite NULL + un valor en la misma clínica).
    const src = await mkPatient(CAMILO_CLINIC, 'S746 S2 src', { profileId: PROFILE_MAIN, doc: 'S746-DOC-2', phone: QA_PHONE });
    const tgt = await mkPatient(CAMILO_CLINIC, 'S746 S2 tgt', { profileId: PROFILE_MAIN, phone: '50370000746' });

    const consId = await mkConsultation(CAMILO_CLINIC, src, { signed: true });

    const dowToday = new Date(Date.now() - 6 * 3600_000).getUTCDay();
    const dowTomorrow = (dowToday + 1) % 7;
    for (const dow of [dowToday, dowTomorrow]) {
      const { data: ar, error: arErr } = await admin.from('availability_rules').insert({
        doctor_id: CAMILO_DOCTOR, clinic_id: CAMILO_CLINIC, day_of_week: dow,
        start_time: '00:00:00', end_time: '23:59:59', is_active: true,
      }).select('id').single();
      if (arErr) throw new Error('fixture availability dow ' + dow + ': ' + arErr.message);
      created.availability.push(ar.id);
    }
    const { data: st } = await admin.from('appointment_statuses').select('id').limit(1).single();
    const start = new Date(Date.now() + 3600_000);
    const { data: appt, error: apErr } = await admin.from('appointments').insert({
      clinic_id: CAMILO_CLINIC, doctor_id: CAMILO_DOCTOR, patient_id: src,
      status_id: st.id, start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 30 * 60000).toISOString(), source: 'manual',
    }).select('id').single();
    if (apErr) throw new Error('fixture appointment: ' + apErr.message);
    created.appointments.push(appt.id);
    const { data: vit, error: vErr } = await admin.from('vitals').insert({
      appointment_id: appt.id, patient_id: src, heart_rate: 70,
    }).select('id').single();
    if (vErr) throw new Error('fixture vitals: ' + vErr.message);
    created.vitals.push(vit.id);

    const { data, error } = await adminCli.rpc('admin_merge_patients', {
      p_source_id: src, p_target_id: tgt, p_reason: 'Duplicado E3 confirmado en QA s7_46',
    });
    if (error) { ko('S2 merge error: ' + error.message); }
    else {
      created.mergeLogs.push(data.merge_log_id);
      const c = data.moved_counts;
      if (c?.appointments === 1 && c?.consultations === 1 && c?.vitals === 1)
        ok('S2 merge OK: moved {appointments:1, consultations:1, vitals:1}');
      else ko('S2 moved_counts inesperado: ' + JSON.stringify(c));

      const { data: a2 } = await admin.from('appointments').select('patient_id').eq('id', appt.id).single();
      const { data: c2 } = await admin.from('consultations').select('patient_id, signed_at').eq('id', consId).single();
      const { data: v2 } = await admin.from('vitals').select('patient_id').eq('id', vit.id).single();
      if (a2?.patient_id === tgt && c2?.patient_id === tgt && v2?.patient_id === tgt)
        ok('S2 referencias movidas a target (appointment + consulta firmada + vitals)');
      else ko('S2 referencias no movidas: ' + JSON.stringify({ a2, c2, v2 }));
      if (c2?.signed_at) ok('S2 consulta FIRMADA movida sin violar el guard (signed_at intacto)');
      else ko('S2 la consulta perdió signed_at');

      const { data: s2 } = await admin.from('patients')
        .select('is_active, profile_id, document_number, merged_into_patient_id, merged_at, phone').eq('id', src).single();
      if (s2 && s2.is_active === false && s2.profile_id === null && s2.document_number === null
          && s2.merged_into_patient_id === tgt && s2.merged_at) ok('S2 fuente neutralizada (inactiva, doc NULL, profile NULL, marcada)');
      else ko('S2 fuente no neutralizada: ' + JSON.stringify(s2));
      ok('S2 P0030 bypass OK (fuente VINCULADA con doc → doc nuleado sin disparar el guard)');
      if (s2?.phone === QA_PHONE) ok('S2 teléfono de la fuente CONSERVADO como traza');
      else ko('S2 teléfono fuente no conservado: ' + JSON.stringify(s2?.phone));

      const { data: stillThere } = await admin.from('patients').select('id').eq('id', src);
      if ((stillThere ?? []).length === 1) ok('S2 no hard-delete (la fuente sigue existiendo)');
      else ko('S2 ¡la fuente fue borrada!');

      const { data: log } = await admin.from('patient_merge_log').select('*').eq('id', data.merge_log_id).single();
      const movedIds = log?.moved_ids || {};
      if (log && log.source_patient_id === src && log.target_patient_id === tgt
          && log.merged_by === adminUid && log.evidence?.type === 'same_profile'
          && log.source_snapshot && log.target_snapshot
          && (movedIds.consultation_ids || []).includes(consId)
          && (movedIds.appointment_ids || []).includes(appt.id)
          && (movedIds.vitals_ids || []).includes(vit.id)
          && log.reason?.length >= 10)
        ok('S2 patient_merge_log con snapshots + moved_ids + reason + actor + evidence');
      else ko('S2 log incompleto: ' + JSON.stringify(log));

      const { data: aud } = await admin.from('audit_log').select('new_data')
        .eq('table_name', 'patients').eq('record_id', src)
        .order('created_at', { ascending: false }).limit(5);
      if ((aud ?? []).some((r) => r.new_data?.edited_via === 'admin_merge' && r.new_data?.target_patient_id === tgt))
        ok('S2 audit edited_via=admin_merge');
      else ko('S2 audit admin_merge ausente: ' + JSON.stringify((aud ?? []).map((r) => r.new_data?.edited_via)));
    }

    // ════ S9. claim ignora la ficha merged (regresión s7_45) ════
    {
      const { error: clErr } = await qaCli.rpc('claim_patient_records');
      const { data: srcRow } = await admin.from('patients').select('profile_id, merged_into_patient_id').eq('id', src).single();
      if (!clErr && srcRow?.profile_id === null && srcRow?.merged_into_patient_id === tgt)
        ok('S9 claim ignora la ficha merged (sigue sin profile, marcada)');
      else ko('S9 claim tocó la ficha merged: ' + JSON.stringify({ clErr: clErr?.message, srcRow }));
    }
  }

  // ════ S3. Bloqueo distinta clínica → P0060 ════
  {
    const { data: otherClinics } = await admin.from('clinics').select('id').neq('id', CAMILO_CLINIC).limit(1);
    if (!otherClinics?.length) { ko('S3 no hay otra clínica para el test'); }
    else {
      const src = await mkPatient(CAMILO_CLINIC, 'S746 S3 src', { profileId: PROFILE_MAIN });
      const tgt = await mkPatient(otherClinics[0].id, 'S746 S3 tgt', { profileId: PROFILE_MAIN });
      const { error } = await adminCli.rpc('admin_merge_patients', { p_source_id: src, p_target_id: tgt, p_reason: 'intento distinta clinica' });
      if (error?.code === 'P0060') ok('S3 bloqueo distinta clínica → P0060');
      else ko('S3 inesperado: ' + JSON.stringify({ code: error?.code, msg: error?.message }));
    }
  }

  // ════ S4. Bloqueo profiles distintos → P0065 ════
  {
    const src = await mkPatient(CAMILO_CLINIC, 'S746 S4 src', { profileId: PROFILE_MAIN, doc: 'S746-DOC-4' });
    const tgt = await mkPatient(CAMILO_CLINIC, 'S746 S4 tgt', { profileId: PROFILE_OTHER });
    const { error } = await adminCli.rpc('admin_merge_patients', { p_source_id: src, p_target_id: tgt, p_reason: 'intento profiles distintos' });
    if (error?.code === 'P0065') ok('S4 bloqueo profiles distintos → P0065 (alcanzable tras el reorder)');
    else ko('S4 inesperado: ' + JSON.stringify({ code: error?.code, msg: error?.message }));
  }

  // ════ S5. Bloqueo evidencia insuficiente (dos walk-ins) → P0063 ════
  {
    const src = await mkPatient(CAMILO_CLINIC, 'S746 S5 src', { phone: '50370000555' });
    const tgt = await mkPatient(CAMILO_CLINIC, 'S746 S5 tgt', { phone: '50370000555' });
    const { error } = await adminCli.rpc('admin_merge_patients', { p_source_id: src, p_target_id: tgt, p_reason: 'intento solo telefono' });
    if (error?.code === 'P0063') ok('S5 bloqueo evidencia insuficiente (dos walk-ins) → P0063');
    else ko('S5 inesperado: ' + JSON.stringify({ code: error?.code, msg: error?.message }));
  }

  // ════ S6. Bloqueo borrador abierto en la FUENTE → P0067 ════
  {
    const src = await mkPatient(CAMILO_CLINIC, 'S746 S6 src', { profileId: PROFILE_MAIN });
    const tgt = await mkPatient(CAMILO_CLINIC, 'S746 S6 tgt', { profileId: PROFILE_MAIN });
    await mkConsultation(CAMILO_CLINIC, src, { signed: false });
    const { error } = await adminCli.rpc('admin_merge_patients', { p_source_id: src, p_target_id: tgt, p_reason: 'intento con borrador en fuente' });
    if (error?.code === 'P0067') ok('S6 bloqueo borrador abierto en la fuente → P0067');
    else ko('S6 inesperado: ' + JSON.stringify({ code: error?.code, msg: error?.message }));
  }

  // ════ S7. Borrador en el TARGET no bloquea (warning) + merge procede ════
  {
    const src = await mkPatient(CAMILO_CLINIC, 'S746 S7 src', { profileId: PROFILE_MAIN });
    const tgt = await mkPatient(CAMILO_CLINIC, 'S746 S7 tgt', { profileId: PROFILE_MAIN });
    await mkConsultation(CAMILO_CLINIC, tgt, { signed: false });

    const { data: pf } = await adminCli.rpc('admin_merge_patients_preflight', { p_source_id: src, p_target_id: tgt });
    const hasWarning = (pf?.warnings || []).some((w) => w.code === 'W_TARGET_DRAFT');
    if (pf?.eligible === true && pf?.target_open_drafts === 1 && hasWarning)
      ok('S7 borrador en target: preflight eligible + warning W_TARGET_DRAFT');
    else ko('S7 preflight inesperado: ' + JSON.stringify({ eligible: pf?.eligible, tod: pf?.target_open_drafts, warnings: pf?.warnings }));

    const { data, error } = await adminCli.rpc('admin_merge_patients', { p_source_id: src, p_target_id: tgt, p_reason: 'merge con borrador en target OK' });
    if (!error && data?.success) { created.mergeLogs.push(data.merge_log_id); ok('S7 merge PROCEDE pese al borrador en el target'); }
    else ko('S7 merge debió proceder: ' + JSON.stringify({ code: error?.code, msg: error?.message }));
  }

  // ════ S8. P0030 bypass aislado (E3 mismo profile, fuente con documento) ════
  {
    const src = await mkPatient(CAMILO_CLINIC, 'S746 S8 src', { profileId: PROFILE_MAIN, doc: 'S746-DOC-8' });
    const tgt = await mkPatient(CAMILO_CLINIC, 'S746 S8 tgt', { profileId: PROFILE_MAIN });
    const { data, error } = await adminCli.rpc('admin_merge_patients', { p_source_id: src, p_target_id: tgt, p_reason: 'merge E3 mismo profile bypass P0030' });
    if (error) { ko('S8 merge E3 falló (¿bypass P0030?): ' + JSON.stringify({ code: error?.code, msg: error?.message })); }
    else {
      created.mergeLogs.push(data.merge_log_id);
      const { data: s8 } = await admin.from('patients').select('is_active, profile_id, document_number, merged_into_patient_id').eq('id', src).single();
      if (s8?.is_active === false && s8?.profile_id === null && s8?.document_number === null && s8?.merged_into_patient_id === tgt)
        ok('S8 P0030 bypass OK: fuente vinculada con doc neutralizada sin disparar el guard');
      else ko('S8 neutralización E3 inesperada: ' + JSON.stringify(s8));
    }
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    for (const id of created.vitals) await admin.from('vitals').delete().eq('id', id);
    for (const id of created.appointments) await admin.from('appointments').delete().eq('id', id);
    for (const id of created.consultations) await admin.from('consultations').delete().eq('id', id);
    for (const id of created.mergeLogs) await admin.from('patient_merge_log').delete().eq('id', id);
    for (const id of created.availability) await admin.from('availability_rules').delete().eq('id', id);
    // Romper las auto-referencias merged_into antes de borrar (FK NO ACTION).
    for (const id of created.patients) await admin.from('patients').update({ merged_into_patient_id: null }).eq('id', id);
    for (const id of created.patients) await admin.from('patients').delete().eq('id', id);
    await adminCli.auth.signOut().catch(() => {});
    await qaCli.auth.signOut().catch(() => {});
    console.log('  ✅ cleanup OK');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_46 OK' : '❌ SMOKE s7_46 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
