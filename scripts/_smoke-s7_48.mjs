/**
 * SMOKE s7_48 — F4: Unmerge formal de fichas (reversa del merge admin).
 *
 * Corre con la SESIÓN del admin de plataforma (50378056365 / OTP 123456) para
 * las RPCs gated por is_admin(), y service_role para fixtures/cleanup. TODO
 * aislado en un mundo throwaway (profile/clínica/doctor con teléfono sintético),
 * marcado `F48_FIXTURE`; cleanup en finally + verificación de 0 residuales.
 * NUNCA toca pacientes reales, ni Camilo, ni Katherine (50372608827).
 *
 * Cubre:
 *  S1. Happy path: merge real (consulta FIRMADA [+ cita + vitales best-effort]) →
 *      preflight elegible con warning de historia nueva en target → unmerge:
 *      filas devueltas a la fuente, fuente restaurada (activa + profile +
 *      documento, sin marca de merge), consulta firmada devuelta intacta,
 *      historia nueva del target conservada, log con unmerge_* (append-only),
 *      audit edited_via='admin_unmerge'.
 *  S2. Idempotencia: re-unmerge del mismo log → P0071.
 *  S3. Destino fusionado hacia un tercero (cadena A→B→C) → P0073.
 *  S4. Conflicto de documento al restaurar la fuente → P0074.
 *  S5. moved_ids con drift (fila movida borrada del target) → P0075.
 *  S6. profile del snapshot inexistente → P0077.
 *  S7. motivo < 10 → P0076.
 *
 * Uso (SOLO tras aplicar s7_48): node scripts/_smoke-s7_48.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const ADMIN_PHONE = '50378056365';
const OTP = '123456';
const MARK = 'F48_FIXTURE';
const CLINIC_NAME = `${MARK} Clínica de prueba`;
const FAKE_PHONE = '50390000748';                                  // sintético, no real
const BOGUS_PROFILE = '00000000-0000-0000-0000-0000f48f0077';      // profile inexistente (P0077)
const BOGUS_LOG = '00000000-0000-0000-0000-0000f48f0076';          // log inexistente (P0076 test)

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
const created = { patients: [], consultations: [], appointments: [], vitals: [], availability: [], mergeLogs: [], authUser: null, clinicId: null, doctorId: null };

// ── Helpers de fixtures (service_role) ──
const mkPatient = async (clinicId, profileId, name, { doc = null, active = true } = {}) => {
  const { data, error } = await admin.from('patients').insert({
    clinic_id: clinicId, profile_id: profileId, full_name: name,
    document_type: 'dui', document_number: doc, date_of_birth: '1990-05-05',
    gender: 'otro', patient_type: 'privado', phone: FAKE_PHONE, is_active: active, notes: MARK,
  }).select('id').single();
  if (error) throw new Error('fixture patient ' + name + ': ' + error.message);
  created.patients.push(data.id);
  return data.id;
};
const mkSignedConsultation = async (clinicId, doctorId, patientId) => {
  const { data, error } = await admin.from('consultations').insert({
    clinic_id: clinicId, doctor_id: doctorId, patient_id: patientId,
    status: 'signed', signed_at: new Date().toISOString(), chief_complaint: MARK,
  }).select('id').single();
  if (error) throw new Error('fixture consultation: ' + error.message);
  created.consultations.push(data.id);
  return data.id;
};
const ensureAvailability = async (doctorId, clinicId) => {
  for (let dow = 0; dow < 7; dow++) {
    const { data, error } = await admin.from('availability_rules').insert({
      doctor_id: doctorId, clinic_id: clinicId, day_of_week: dow,
      start_time: '00:00:00', end_time: '23:59:59', is_active: true,
    }).select('id').single();
    if (!error && data) created.availability.push(data.id);
  }
};
const mkAppointmentVitals = async (clinicId, doctorId, patientId) => {
  try {
    const { data: st } = await admin.from('appointment_statuses').select('id').limit(1).single();
    const start = new Date(Date.now() + 3600_000);
    const { data: appt, error: ae } = await admin.from('appointments').insert({
      clinic_id: clinicId, doctor_id: doctorId, patient_id: patientId, status_id: st.id,
      start_time: start.toISOString(), end_time: new Date(start.getTime() + 30 * 60000).toISOString(), source: 'manual',
    }).select('id').single();
    if (ae) { console.log('  ⚠ cita best-effort no creada (se sigue con consulta sola):', ae.message); return null; }
    created.appointments.push(appt.id);
    const { data: vit, error: ve } = await admin.from('vitals').insert({
      appointment_id: appt.id, patient_id: patientId, heart_rate: 70,
    }).select('id').single();
    if (ve) { console.log('  ⚠ vitales best-effort no creados:', ve.message); return { apptId: appt.id, vitId: null }; }
    created.vitals.push(vit.id);
    return { apptId: appt.id, vitId: vit.id };
  } catch (e) { console.log('  ⚠ cita/vitales best-effort falló:', e.message); return null; }
};

console.log('═══ SMOKE s7_48 (unmerge formal de fichas) ═══\n');

let adminUid;
let PROFILE, CLINIC, DOCTOR;

try {
  adminUid = await login(adminCli, ADMIN_PHONE);
  {
    const { data: prof } = await admin.from('profiles').select('role').eq('id', adminUid).single();
    if (prof?.role !== 'admin') throw new Error('La cuenta ' + ADMIN_PHONE + ' no es admin (role=' + prof?.role + ')');
  }

  // Mundo throwaway aislado.
  {
    const { data: cu, error } = await admin.auth.admin.createUser({ phone: FAKE_PHONE, phone_confirm: true });
    if (error) throw new Error('createUser: ' + error.message);
    PROFILE = cu.user.id; created.authUser = PROFILE;
    const { data: clinic, error: ce } = await admin.from('clinics').insert({ name: CLINIC_NAME, owner_id: PROFILE }).select('id').single();
    if (ce) throw new Error('clinic: ' + ce.message);
    CLINIC = clinic.id; created.clinicId = CLINIC;
    const { data: doctor, error: de } = await admin.from('doctors').insert({ clinic_id: CLINIC, profile_id: PROFILE }).select('id').single();
    if (de) throw new Error('doctor: ' + de.message);
    DOCTOR = doctor.id; created.doctorId = DOCTOR;
  }

  // ════ S1. Happy path (merge → preflight → unmerge) ════
  {
    const src = await mkPatient(CLINIC, PROFILE, 'F48 S1 src', { doc: 'F48-DOC-1' });
    const tgt = await mkPatient(CLINIC, PROFILE, 'F48 S1 tgt', {});
    const consId = await mkSignedConsultation(CLINIC, DOCTOR, src);
    await ensureAvailability(DOCTOR, CLINIC);
    const av = await mkAppointmentVitals(CLINIC, DOCTOR, src);
    const expAppt = av?.apptId ? 1 : 0;
    const expVit = av?.vitId ? 1 : 0;
    const expCons = 1;

    const { data: mg, error: me } = await adminCli.rpc('admin_merge_patients', {
      p_source_id: src, p_target_id: tgt, p_reason: 'F48 S1 merge happy path para smoke',
    });
    if (me) { ko('S1 merge falló (¿s7_46?): ' + me.message); }
    else {
      created.mergeLogs.push(mg.merge_log_id);
      const newCons = await mkSignedConsultation(CLINIC, DOCTOR, tgt);  // historia nueva en el target

      const { data: pf, error: pe } = await adminCli.rpc('admin_unmerge_patients_preflight', { p_merge_log_id: mg.merge_log_id });
      if (pe) ko('S1 preflight error: ' + pe.message);
      else {
        const warnCodes = (pf.warnings || []).map((w) => w.code);
        if (pf.eligible === true) ok('S1 preflight elegible'); else ko('S1 preflight no elegible: ' + JSON.stringify(pf.block_code));
        if (pf.target_new_history >= 1 && warnCodes.includes('W_TARGET_NEW_HISTORY'))
          ok('S1 warning historia nueva en target (' + pf.target_new_history + ')');
        else ko('S1 sin warning historia nueva: ' + JSON.stringify({ tnh: pf.target_new_history, warnCodes }));
      }

      const { data: un, error: ue } = await adminCli.rpc('admin_unmerge_patients', {
        p_merge_log_id: mg.merge_log_id, p_reason: 'F48 S1 unmerge happy path para smoke',
      });
      if (ue) ko('S1 unmerge error: ' + ue.message);
      else {
        const mb = un.moved_back;
        if (mb.consultations === expCons && mb.appointments === expAppt && mb.vitals === expVit)
          ok(`S1 moved_back {a:${expAppt}, c:${expCons}, v:${expVit}}`);
        else ko('S1 moved_back inesperado: ' + JSON.stringify(mb) + ` (esperado a${expAppt} c${expCons} v${expVit})`);

        const { data: srow } = await admin.from('patients')
          .select('is_active, profile_id, document_number, merged_into_patient_id, merged_at').eq('id', src).single();
        if (srow && srow.is_active === true && srow.profile_id === PROFILE && srow.document_number === 'F48-DOC-1'
            && srow.merged_into_patient_id === null && srow.merged_at === null)
          ok('S1 fuente restaurada (activa + profile + documento, sin marca de merge)');
        else ko('S1 fuente no restaurada: ' + JSON.stringify(srow));

        const { data: c2 } = await admin.from('consultations').select('patient_id, signed_at').eq('id', consId).single();
        if (c2 && c2.patient_id === src && c2.signed_at) ok('S1 consulta FIRMADA devuelta a la fuente (signed_at intacto)');
        else ko('S1 consulta firmada no devuelta: ' + JSON.stringify(c2));

        const { data: nc } = await admin.from('consultations').select('patient_id').eq('id', newCons).single();
        if (nc && nc.patient_id === tgt) ok('S1 historia nueva del target se conserva en el target');
        else ko('S1 historia nueva del target se movió: ' + JSON.stringify(nc));

        if (av?.apptId) {
          const { data: a2 } = await admin.from('appointments').select('patient_id').eq('id', av.apptId).single();
          if (a2?.patient_id === src) ok('S1 cita devuelta a la fuente'); else ko('S1 cita no devuelta: ' + JSON.stringify(a2));
        }
        if (av?.vitId) {
          const { data: v2 } = await admin.from('vitals').select('patient_id').eq('id', av.vitId).single();
          if (v2?.patient_id === src) ok('S1 vitales devueltos a la fuente'); else ko('S1 vitales no devueltos: ' + JSON.stringify(v2));
        }

        const { data: lg } = await admin.from('patient_merge_log')
          .select('unmerged_at, unmerged_by, unmerge_reason').eq('id', mg.merge_log_id).single();
        if (lg && lg.unmerged_at && lg.unmerged_by === adminUid && (lg.unmerge_reason || '').length >= 10)
          ok('S1 log marcado unmerged_at/by/reason (append-only)');
        else ko('S1 log no marcado: ' + JSON.stringify(lg));

        const { data: aud } = await admin.from('audit_log').select('new_data')
          .eq('table_name', 'patients').eq('record_id', src).order('created_at', { ascending: false }).limit(5);
        if ((aud ?? []).some((r) => r.new_data?.edited_via === 'admin_unmerge' && r.new_data?.merge_log_id === mg.merge_log_id))
          ok('S1 audit edited_via=admin_unmerge');
        else ko('S1 audit admin_unmerge ausente: ' + JSON.stringify((aud ?? []).map((r) => r.new_data?.edited_via)));

        // ════ S2. Idempotencia → P0071 ════
        const { error: u2 } = await adminCli.rpc('admin_unmerge_patients', {
          p_merge_log_id: mg.merge_log_id, p_reason: 'F48 S2 reintento idempotencia P0071',
        });
        if (u2?.code === 'P0071') ok('S2 re-unmerge bloqueado → P0071');
        else ko('S2 esperado P0071: ' + JSON.stringify({ code: u2?.code, msg: u2?.message }));
      }
    }
  }

  // ════ S3. Destino fusionado a un tercero (cadena) → P0073 ════
  {
    const a = await mkPatient(CLINIC, PROFILE, 'F48 S3 a', {});
    const b = await mkPatient(CLINIC, PROFILE, 'F48 S3 b', {});
    const c = await mkPatient(CLINIC, PROFILE, 'F48 S3 c', {});
    const { data: mgAB, error: eAB } = await adminCli.rpc('admin_merge_patients', { p_source_id: a, p_target_id: b, p_reason: 'F48 S3 merge a hacia b' });
    if (eAB) ko('S3 merge a→b: ' + eAB.message);
    else {
      created.mergeLogs.push(mgAB.merge_log_id);
      const { data: mgBC, error: eBC } = await adminCli.rpc('admin_merge_patients', { p_source_id: b, p_target_id: c, p_reason: 'F48 S3 merge b hacia c' });
      if (eBC) ko('S3 merge b→c: ' + eBC.message);
      else {
        created.mergeLogs.push(mgBC.merge_log_id);
        const { error: u } = await adminCli.rpc('admin_unmerge_patients', { p_merge_log_id: mgAB.merge_log_id, p_reason: 'F48 S3 intento revertir con destino en cadena' });
        if (u?.code === 'P0073') ok('S3 destino fusionado a un tercero → P0073');
        else ko('S3 esperado P0073: ' + JSON.stringify({ code: u?.code, msg: u?.message }));
      }
    }
  }

  // ════ S4. Conflicto de documento al restaurar → P0074 ════
  {
    const a = await mkPatient(CLINIC, PROFILE, 'F48 S4 a', { doc: 'F48-DOC-4' });
    const b = await mkPatient(CLINIC, PROFILE, 'F48 S4 b', {});
    const { data: mg, error: e } = await adminCli.rpc('admin_merge_patients', { p_source_id: a, p_target_id: b, p_reason: 'F48 S4 merge con documento' });
    if (e) ko('S4 merge: ' + e.message);
    else {
      created.mergeLogs.push(mg.merge_log_id);
      await mkPatient(CLINIC, PROFILE, 'F48 S4 c', { doc: 'F48-DOC-4' });  // toma el documento liberado
      const { error: u } = await adminCli.rpc('admin_unmerge_patients', { p_merge_log_id: mg.merge_log_id, p_reason: 'F48 S4 intento con conflicto de documento' });
      if (u?.code === 'P0074') ok('S4 conflicto de documento al restaurar → P0074');
      else ko('S4 esperado P0074: ' + JSON.stringify({ code: u?.code, msg: u?.message }));
    }
  }

  // ════ S5. moved_ids con drift (fila ausente) → P0075 ════
  {
    const a = await mkPatient(CLINIC, PROFILE, 'F48 S5 a', {});
    const b = await mkPatient(CLINIC, PROFILE, 'F48 S5 b', {});
    const consA = await mkSignedConsultation(CLINIC, DOCTOR, a);
    const { data: mg, error: e } = await adminCli.rpc('admin_merge_patients', { p_source_id: a, p_target_id: b, p_reason: 'F48 S5 merge para drift' });
    if (e) ko('S5 merge: ' + e.message);
    else {
      created.mergeLogs.push(mg.merge_log_id);
      await admin.from('consultations').delete().eq('id', consA);  // borra la fila movida del target
      const { error: u } = await adminCli.rpc('admin_unmerge_patients', { p_merge_log_id: mg.merge_log_id, p_reason: 'F48 S5 intento con fila movida ausente' });
      if (u?.code === 'P0075') ok('S5 moved_ids con drift (fila ausente) → P0075');
      else ko('S5 esperado P0075: ' + JSON.stringify({ code: u?.code, msg: u?.message }));
    }
  }

  // ════ S6. profile del snapshot inexistente → P0077 (log fabricado) ════
  {
    const tgtP = await mkPatient(CLINIC, PROFILE, 'F48 S6 tgt', {});
    const srcP = await mkPatient(CLINIC, null, 'F48 S6 src', { active: false });
    await admin.from('patients').update({ merged_into_patient_id: tgtP, merged_at: new Date().toISOString() }).eq('id', srcP);
    const { data: lg, error: le } = await admin.from('patient_merge_log').insert({
      source_patient_id: srcP, target_patient_id: tgtP, clinic_id: CLINIC, merged_by: adminUid,
      reason: 'F48 S6 craft P0077 profile inexistente', evidence: { type: 'same_profile' },
      source_snapshot: { profile_id: BOGUS_PROFILE, document_type: 'dui', document_number: null, is_active: false },
      target_snapshot: {}, moved_counts: { appointments: 0, consultations: 0, vitals: 0 },
      moved_ids: { appointment_ids: [], consultation_ids: [], vitals_ids: [] },
    }).select('id').single();
    if (le) ko('S6 craft log: ' + le.message);
    else {
      created.mergeLogs.push(lg.id);
      const { error: u } = await adminCli.rpc('admin_unmerge_patients', { p_merge_log_id: lg.id, p_reason: 'F48 S6 intento con profile del snapshot inexistente' });
      if (u?.code === 'P0077') ok('S6 profile del snapshot inexistente → P0077');
      else ko('S6 esperado P0077: ' + JSON.stringify({ code: u?.code, msg: u?.message }));

      // ════ S7. motivo < 10 → P0076 (se evalúa antes de mirar el log) ════
      const { error: u7 } = await adminCli.rpc('admin_unmerge_patients', { p_merge_log_id: BOGUS_LOG, p_reason: 'corto' });
      if (u7?.code === 'P0076') ok('S7 motivo < 10 → P0076');
      else ko('S7 esperado P0076: ' + JSON.stringify({ code: u7?.code, msg: u7?.message }));
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
    for (const id of created.patients) await admin.from('patients').update({ merged_into_patient_id: null }).eq('id', id);
    for (const id of created.patients) await admin.from('patients').delete().eq('id', id);
    if (created.doctorId) await admin.from('doctors').delete().eq('id', created.doctorId);
    for (const id of created.availability) await admin.from('availability_rules').delete().eq('id', id);
    if (created.clinicId) await admin.from('clinics').delete().eq('id', created.clinicId);
    if (created.authUser) await admin.auth.admin.deleteUser(created.authUser).catch(() => {});
    await adminCli.auth.signOut().catch(() => {});

    const r = {};
    r.patients = (await admin.from('patients').select('id').eq('notes', MARK)).data?.length ?? 0;
    r.clinics = (await admin.from('clinics').select('id').eq('name', CLINIC_NAME)).data?.length ?? 0;
    r.profiles = (await admin.from('profiles').select('id').eq('phone', FAKE_PHONE)).data?.length ?? 0;
    r.logs = (await admin.from('patient_merge_log').select('id').ilike('reason', 'F48%')).data?.length ?? 0;
    const total = r.patients + r.clinics + r.profiles + r.logs;
    console.log('  residuales:', JSON.stringify(r), '→ TOTAL', total);
    if (total === 0) ok('cleanup OK — 0 residuales'); else ko('cleanup con ' + total + ' residuales');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
    fail++;
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_48 OK' : '❌ SMOKE s7_48 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
