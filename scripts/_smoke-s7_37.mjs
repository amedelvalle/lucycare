/**
 * SMOKE s7_37 — snapshot histórico de catálogo (receta/diagnóstico).
 *
 * Fixtures aisladas en la clínica de Camilo (paciente + medicamento + dx +
 * consulta draft, todo throwaway). Limpia todo en finally. La parte de
 * amend_consultation usa la SESIÓN de Camilo (OTP) porque exige médico dueño.
 *
 * Cubre:
 *  1. Insertar receta → snapshot se llena desde el catálogo (trigger).
 *  2. Insertar diagnóstico → snapshot se llena.
 *  3. Editar el catálogo (nombre/principio) → el snapshot NO cambia (congelado);
 *     el JOIN vivo sí cambia.
 *  4. Firmar + amend_consultation 'add' receta → la nueva receta también trae
 *     snapshot (refleja el catálogo al momento del amend).
 *
 * Uso: node scripts/_smoke-s7_37.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const CAMILO_PHONE = '50378627694';
const CAMILO_DOCTOR = '783a902a-55fd-407c-9e0a-69568135c7f5';
const CAMILO_CLINIC = '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0';
const OTP = '123456';

const camilo = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

let patientId = null, medId = null, dxId = null, consultId = null, rxId = null, cdId = null;

async function cleanup() {
  try {
    if (consultId) {
      await admin.from('prescriptions').delete().eq('consultation_id', consultId);
      await admin.from('consultation_diagnoses').delete().eq('consultation_id', consultId);
      await admin.from('consultations').delete().eq('id', consultId);
    }
    if (medId) await admin.from('medications').delete().eq('id', medId);
    if (dxId) await admin.from('diagnoses').delete().eq('id', dxId);
    if (patientId) await admin.from('patients').delete().eq('id', patientId);
  } catch { /* best-effort */ }
}

console.log('═══ SMOKE s7_37 (snapshot histórico de catálogo) ═══\n');

try {
  // ── Fixtures ──
  const { data: pat, error: pErr } = await admin.from('patients').insert({
    clinic_id: CAMILO_CLINIC, profile_id: null, full_name: 'S37 Paciente',
    document_type: 'dui', date_of_birth: '1990-01-01', gender: 'otro',
    patient_type: 'privado', phone: '50370003737', is_active: true,
  }).select('id').single();
  if (pErr) throw new Error('insert patient: ' + pErr.message);
  patientId = pat.id;

  const { data: med, error: mErr } = await admin.from('medications').insert({
    doctor_id: CAMILO_DOCTOR, commercial_name: 'SmokeMed Original',
    active_ingredient: 'IngActivo Orig', concentration: '500mg', presentation: 'tableta',
    is_active: true, usage_count: 0,
  }).select('id').single();
  if (mErr) throw new Error('insert medication: ' + mErr.message);
  medId = med.id;

  const { data: dx, error: dErr } = await admin.from('diagnoses').insert({
    doctor_id: CAMILO_DOCTOR, name: 'SmokeDx Original', description: 'orig', is_active: true, usage_count: 0,
  }).select('id').single();
  if (dErr) throw new Error('insert diagnosis: ' + dErr.message);
  dxId = dx.id;

  const { data: con, error: cErr } = await admin.from('consultations').insert({
    appointment_id: null, clinic_id: CAMILO_CLINIC, doctor_id: CAMILO_DOCTOR,
    patient_id: patientId, status: 'draft', started_at: new Date().toISOString(),
  }).select('id').single();
  if (cErr) throw new Error('insert consultation: ' + cErr.message);
  consultId = con.id;
  ok('Fixtures: paciente + medicamento + diagnóstico + consulta draft');

  // 1. Insertar receta → snapshot llenado por trigger
  {
    const { data, error } = await admin.from('prescriptions').insert({
      consultation_id: consultId, medication_id: medId, dosage: '1', frequency: 'c/8h',
    }).select('id, medication_name_snapshot, active_ingredient_snapshot, concentration_snapshot, presentation_snapshot').single();
    if (error) ko('1 insert receta: ' + error.message);
    else {
      rxId = data.id;
      const okSnap = data.medication_name_snapshot === 'SmokeMed Original'
        && data.active_ingredient_snapshot === 'IngActivo Orig'
        && data.concentration_snapshot === '500mg'
        && data.presentation_snapshot === 'tableta';
      if (okSnap) ok('1 receta: snapshot llenado desde el catálogo (trigger)');
      else ko('1 snapshot incorrecto: ' + JSON.stringify(data));
    }
  }

  // 2. Insertar diagnóstico → snapshot llenado
  {
    const { data, error } = await admin.from('consultation_diagnoses').insert({
      consultation_id: consultId, diagnosis_id: dxId, diagnosis_type: 'presuntivo', diagnosis_status: 'activo',
    }).select('id, diagnosis_name_snapshot').single();
    if (error) ko('2 insert diagnóstico: ' + error.message);
    else {
      cdId = data.id;
      if (data.diagnosis_name_snapshot === 'SmokeDx Original') ok('2 diagnóstico: snapshot llenado desde el catálogo');
      else ko('2 snapshot dx incorrecto: ' + JSON.stringify(data));
    }
  }

  // 3. Editar el catálogo → snapshot NO cambia; JOIN vivo sí
  {
    await admin.from('medications').update({ commercial_name: 'SmokeMed EDITED', active_ingredient: 'IngActivo EDIT' }).eq('id', medId);
    await admin.from('diagnoses').update({ name: 'SmokeDx EDITED' }).eq('id', dxId);

    const { data: rx } = await admin.from('prescriptions')
      .select('medication_name_snapshot, medication:medications(commercial_name)').eq('id', rxId).single();
    const { data: cd } = await admin.from('consultation_diagnoses')
      .select('diagnosis_name_snapshot, diagnosis:diagnoses(name)').eq('id', cdId).single();

    const rxFrozen = rx.medication_name_snapshot === 'SmokeMed Original' && rx.medication?.commercial_name === 'SmokeMed EDITED';
    const cdFrozen = cd.diagnosis_name_snapshot === 'SmokeDx Original' && cd.diagnosis?.name === 'SmokeDx EDITED';
    if (rxFrozen && cdFrozen) ok('3 editar catálogo: snapshot congelado, JOIN vivo cambió');
    else ko(`3 snapshot debería estar congelado: rx=${JSON.stringify(rx)} cd=${JSON.stringify(cd)}`);
  }

  // 4. Firmar + amend 'add' receta → la nueva receta también trae snapshot
  {
    const { error: loginErr } = await camilo.auth.signInWithOtp({ phone: CAMILO_PHONE }).then(
      () => camilo.auth.verifyOtp({ phone: CAMILO_PHONE, token: OTP, type: 'sms' })
    ).then((r) => ({ error: r.error })).catch((e) => ({ error: e }));
    if (loginErr) throw new Error('login Camilo: ' + (loginErr.message || loginErr));

    const { error: signErr } = await camilo.rpc('sign_consultation', { p_consultation_id: consultId });
    if (signErr) { ko('4 sign_consultation: ' + signErr.message); }
    else {
      const { data: before } = await admin.from('prescriptions').select('id').eq('consultation_id', consultId);
      const beforeIds = new Set((before ?? []).map((r) => r.id));

      const { error: amendErr } = await camilo.rpc('amend_consultation', {
        p_consultation_id: consultId,
        p_reason: 'smoke s7_37',
        p_prescription_ops: [{ op: 'add', medication_id: medId, dosage: '2', frequency: 'c/12h' }],
      });
      if (amendErr) ko('4 amend_consultation: ' + amendErr.message);
      else {
        const { data: after } = await admin.from('prescriptions')
          .select('id, medication_name_snapshot').eq('consultation_id', consultId);
        const added = (after ?? []).find((r) => !beforeIds.has(r.id));
        if (added && added.medication_name_snapshot === 'SmokeMed EDITED')
          ok('4 amend: nueva receta con snapshot (= catálogo al momento del amend)');
        else ko('4 amend no generó snapshot esperado: ' + JSON.stringify(added));
      }
    }
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  await cleanup();
  await camilo.auth.signOut().catch(() => {});
  console.log('  ✅ cleanup OK');
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_37 OK' : '❌ SMOKE s7_37 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
