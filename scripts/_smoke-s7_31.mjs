/**
 * SMOKE B1.5-a / s7_31 — sesión de médico real (OTP) sobre fixtures aisladas.
 *
 * Crea una consulta throwaway de Camilo (cuenta demo), con diagnóstico +
 * antecedente + vitales, y valida:
 *  1. Vitales en BORRADOR: UPDATE directo como médico → permitido.
 *  2. Vitales tras FIRMAR: UPDATE directo como médico → BLOQUEADO (RLS s7_31).
 *  3. amend_consultation corrige diagnóstico / antecedente / vitales.
 *  4. Motivo obligatorio (reason vacío → P0012).
 *  5. affects_prescriptions=false (no se tocó receta) → no "RECETA CORREGIDA".
 *  6. consultation_amendments con snapshot before/after.
 *
 * TODO lo creado se borra en el finally (cleanup completo). Solo datos demo.
 *
 * Uso: node scripts/_smoke-s7_31.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { supabaseAnon as camilo } from './_lib/supabase-anon.mjs';

const DOC = '783a902a-55fd-407c-9e0a-69568135c7f5';
const CLINIC = '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0';
const PATIENT = 'f2e83137-633b-4fbc-8a03-255e17718cd9'; // Pepe Toro
const DX = '2cafcdf4-329c-44a7-a81b-5f0cde08095d';      // Hipertiroidismo
const FH = '7fb61b18-6b65-4772-b9a2-54ad9fb3a80b';      // Enfermedad renal
const PHONE = '50378627694';
const OTP = '123456';

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

const ids = { appt: null, consult: null, cd: null, cfh: null, vitals: null };

try {
  // ─── Setup (service_role) ───
  const { data: st } = await admin.from('appointment_statuses').select('id').limit(1).single();
  const now = new Date();
  const start = new Date(now.getTime() + 24 * 3600_000).toISOString();      // +1 día (trigger bloquea pasado)
  const end = new Date(now.getTime() + 25 * 3600_000).toISOString();

  const { data: appt, error: aErr } = await admin.from('appointments').insert({
    clinic_id: CLINIC, doctor_id: DOC, patient_id: PATIENT,
    start_time: start, end_time: end, status_id: st.id, source: 'manual',
  }).select('id').single();
  if (aErr) throw new Error('crear appointment: ' + aErr.message);
  ids.appt = appt.id;

  const { data: c, error: cErr } = await admin.from('consultations').insert({
    appointment_id: ids.appt, clinic_id: CLINIC, doctor_id: DOC, patient_id: PATIENT,
    status: 'draft', started_at: start,
    chief_complaint: 'smoke', plan: 'orig plan',
  }).select('id').single();
  if (cErr) throw new Error('crear consulta: ' + cErr.message);
  ids.consult = c.id;

  const { data: cd } = await admin.from('consultation_diagnoses').insert({
    consultation_id: ids.consult, diagnosis_id: DX,
    diagnosis_type: 'presuntivo', diagnosis_status: 'activo', notes: 'dx orig',
  }).select('id').single();
  ids.cd = cd.id;

  const { data: cfh } = await admin.from('consultation_family_history').insert({
    consultation_id: ids.consult, family_history_id: FH, notes: 'fh orig',
  }).select('id').single();
  ids.cfh = cfh.id;

  const { data: v } = await admin.from('vitals').insert({
    appointment_id: ids.appt, patient_id: PATIENT,
    heart_rate: 70, systolic_bp: 120, diastolic_bp: 80, weight_kg: 70, height_cm: 170, bmi: 24.2,
    recorded_at: start,
  }).select('id').single();
  ids.vitals = v.id;

  console.log('Fixtures creadas. consult=', ids.consult, '\n');

  // ─── Sesión de Camilo (OTP) ───
  await camilo.auth.signInWithOtp({ phone: PHONE }).catch(() => {});
  const { data: sess, error: otpErr } = await camilo.auth.verifyOtp({ phone: PHONE, token: OTP, type: 'sms' });
  if (otpErr || !sess?.session) throw new Error('OTP login Camilo falló: ' + (otpErr?.message || 'sin sesión'));
  ok('Sesión de médico (Camilo) iniciada vía OTP');

  // ─── 1. Vitales en BORRADOR: UPDATE directo permitido ───
  await camilo.from('vitals').update({ heart_rate: 75 }).eq('appointment_id', ids.appt);
  let { data: vAfterDraft } = await admin.from('vitals').select('heart_rate').eq('id', ids.vitals).single();
  if (vAfterDraft.heart_rate === 75) ok('Borrador: UPDATE directo de vitales permitido (hr 70→75)');
  else ko('Borrador: UPDATE de vitales NO se aplicó (hr=' + vAfterDraft.heart_rate + ')');

  // ─── Firmar (admin = estado firmado) ───
  await admin.from('consultations').update({ status: 'signed', signed_at: new Date().toISOString() }).eq('id', ids.consult);

  // ─── 2. Vitales FIRMADOS: UPDATE directo BLOQUEADO ───
  await camilo.from('vitals').update({ heart_rate: 999 }).eq('appointment_id', ids.appt);
  let { data: vAfterSigned } = await admin.from('vitals').select('heart_rate').eq('id', ids.vitals).single();
  if (vAfterSigned.heart_rate === 75) ok('Firmada: UPDATE directo de vitales BLOQUEADO por RLS (sigue 75, no 999)');
  else ko('Firmada: UPDATE directo de vitales NO bloqueado (hr=' + vAfterSigned.heart_rate + ')');

  // ─── 3. Motivo obligatorio ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: '   ',
      p_diagnosis_ops: [{ op: 'replace', id: ids.cd, diagnosis_status: 'controlado' }],
    });
    if (error && error.code === 'P0012') ok('Motivo obligatorio: reason vacío → P0012');
    else ko('Motivo obligatorio NO enforced (error=' + JSON.stringify(error) + ')');
  }

  // ─── 4. amend de diagnóstico + antecedente + vitales ───
  {
    const { data, error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult,
      p_reason: 'smoke B1.5-a: corrección de diag/antecedente/vitales',
      p_diagnosis_ops: [{ op: 'replace', id: ids.cd, diagnosis_status: 'controlado', notes: 'dx corregido' }],
      p_family_history_ops: [{ op: 'replace', id: ids.cfh, notes: 'fh corregido' }],
      p_vitals_changes: { heart_rate: 88, bmi: 24.2 },
    });
    if (error) { ko('amend_consultation falló: ' + JSON.stringify(error)); }
    else {
      ok('amend_consultation aplicado (version=' + data.version + ')');
      if (data.affects_prescriptions === false) ok('affects_prescriptions=false (no se tocó receta → no "RECETA CORREGIDA")');
      else ko('affects_prescriptions debería ser false, fue ' + data.affects_prescriptions);
    }
  }

  // ─── 5. Verificaciones de estado (admin) ───
  {
    const { data: cdRow } = await admin.from('consultation_diagnoses').select('diagnosis_status, notes').eq('id', ids.cd).single();
    if (cdRow.diagnosis_status === 'controlado' && cdRow.notes === 'dx corregido') ok('Diagnóstico corregido (activo→controlado, notas)');
    else ko('Diagnóstico NO corregido: ' + JSON.stringify(cdRow));

    const { data: cfhRow } = await admin.from('consultation_family_history').select('notes').eq('id', ids.cfh).single();
    if (cfhRow.notes === 'fh corregido') ok('Antecedente corregido (notas)');
    else ko('Antecedente NO corregido: ' + JSON.stringify(cfhRow));

    const { data: vRow } = await admin.from('vitals').select('heart_rate').eq('id', ids.vitals).single();
    if (vRow.heart_rate === 88) ok('Vitales corregidos vía amend (hr 75→88)');
    else ko('Vitales NO corregidos: hr=' + vRow.heart_rate);

    const { data: amd } = await admin.from('consultation_amendments')
      .select('version, reason, affects_prescriptions, snapshot_before, snapshot_after')
      .eq('consultation_id', ids.consult).order('version', { ascending: false }).limit(1).single();
    if (amd && amd.affects_prescriptions === false) ok('Adenda registrada con affects_prescriptions=false');
    else ko('Adenda mal/ausente: ' + JSON.stringify(amd?.affects_prescriptions));
    const before = amd?.snapshot_before, after = amd?.snapshot_after;
    const beforeHr = before?.vitals?.[0]?.heart_rate, afterHr = after?.vitals?.[0]?.heart_rate;
    if (before && after && beforeHr === 75 && afterHr === 88) ok('Snapshot before/after captura el cambio de vitales (75→88)');
    else ko('Snapshot before/after inesperado (before hr=' + beforeHr + ', after hr=' + afterHr + ')');
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  // ─── Cleanup (service_role), orden FK-safe ───
  console.log('\n— cleanup —');
  if (ids.consult) await admin.from('consultation_amendments').delete().eq('consultation_id', ids.consult);
  if (ids.cd) await admin.from('consultation_diagnoses').delete().eq('id', ids.cd);
  if (ids.cfh) await admin.from('consultation_family_history').delete().eq('id', ids.cfh);
  if (ids.vitals) await admin.from('vitals').delete().eq('id', ids.vitals);
  if (ids.consult) await admin.from('consultations').delete().eq('id', ids.consult);
  if (ids.appt) await admin.from('appointments').delete().eq('id', ids.appt);
  await camilo.auth.signOut().catch(() => {});
  const { data: leftover } = await admin.from('consultations').select('id').eq('id', ids.consult ?? '00000000-0000-0000-0000-000000000000');
  console.log(leftover && leftover.length ? '  ⚠️ quedó la consulta sin borrar' : '  ✅ cleanup OK (fixtures borradas)');
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_31 OK' : '❌ SMOKE s7_31 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
