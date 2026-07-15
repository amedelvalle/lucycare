/**
 * SMOKE F7 / s7_59 — alternativas terapéuticas corregibles post-firma.
 *
 * Valida que `alternatives` sigue la MISMA regla vinculante de s7_58:
 *    clave ausente            → conserva el valor anterior
 *    clave presente (null/'') → limpia (NULL)
 *    clave presente con valor → actualiza
 * en `replace`, y que un medicamento agregado en la corrección (`add`) ya puede
 * llevar alternativas (antes la columna ni figuraba en el INSERT).
 *
 * Incluye NO REGRESIÓN de F6 (duración/nulls) y de gates/versionado/trazabilidad.
 *
 * Fixtures PROPIAS creadas desde cero y marcadas `F7_FIXTURE` (paciente, cita,
 * consulta firmada, recetas). NUNCA usa Pepe Toro ni Katherine: la corrección
 * crea adendas irreversibles. Todo se borra en el finally, con verificación de
 * 0 residuales.
 *
 * Requiere sesión de MÉDICO real (la RPC usa auth.uid()/get_user_doctor_id()):
 * cuenta demo Camilo vía Test Phone OTP.
 *
 * Uso: node scripts/_smoke-s7_59.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { supabaseAnon as camilo, SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const DOC = '783a902a-55fd-407c-9e0a-69568135c7f5';    // Camilo (médico demo)
const CLINIC = '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0';
const PHONE = '50378627694';
const OTP = '123456';
const TAG = `F7_FIXTURE_${Date.now()}`;

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };
const eq = (cond, okMsg, koMsg) => (cond ? ok(okMsg) : ko(koMsg));

const ids = { patient: null, appt: null, consult: null, other: null, rx: {} };

/** Receta vigente de un medicamento (la más nueva si hay varias). */
const currentRx = async (medId) => {
  const { data } = await admin.from('prescriptions')
    .select('id, dosage, frequency, duration_value, duration_unit, instructions, alternatives, version, is_current, replaces_id')
    .eq('consultation_id', ids.consult).eq('medication_id', medId).eq('is_current', true)
    .order('version', { ascending: false }).limit(1).maybeSingle();
  return data;
};

try {
  // ─── Setup: paciente + cita + consulta FIRMADA + recetas con alternativas ───
  const { data: st } = await admin.from('appointment_statuses').select('id').limit(1).single();
  const { data: meds } = await admin.from('medications')
    .select('id').is('doctor_id', null).eq('is_active', true).limit(7);
  if (!meds || meds.length < 7) throw new Error('faltan medicamentos globales para el fixture');
  const M = meds.map((m) => m.id);

  const start = new Date(Date.now() + 24 * 3600_000).toISOString();
  const end = new Date(Date.now() + 25 * 3600_000).toISOString();

  const { data: pat, error: pErr } = await admin.from('patients').insert({
    clinic_id: CLINIC, full_name: `${TAG} paciente`, date_of_birth: '1990-01-01',
    gender: 'masculino', notes: TAG,
  }).select('id').single();
  if (pErr) throw new Error('crear paciente fixture: ' + pErr.message);
  ids.patient = pat.id;

  const { data: appt, error: aErr } = await admin.from('appointments').insert({
    clinic_id: CLINIC, doctor_id: DOC, patient_id: ids.patient,
    start_time: start, end_time: end, status_id: st.id, source: 'manual',
  }).select('id').single();
  if (aErr) throw new Error('crear cita fixture: ' + aErr.message);
  ids.appt = appt.id;

  const { data: c, error: cErr } = await admin.from('consultations').insert({
    appointment_id: ids.appt, clinic_id: CLINIC, doctor_id: DOC, patient_id: ids.patient,
    status: 'draft', started_at: start, chief_complaint: TAG,
  }).select('id').single();
  if (cErr) throw new Error('crear consulta fixture: ' + cErr.message);
  ids.consult = c.id;

  const base = (medId) => ({
    consultation_id: ids.consult, medication_id: medId,
    dosage: '1 tableta', frequency: 'cada 8 horas',
    duration_value: 30, duration_unit: 'dias',
    instructions: 'con comida', alternatives: 'alternativa original',
    version: 1, is_current: true,
  });
  const { data: rxRows, error: rErr } = await admin.from('prescriptions')
    .insert([base(M[0]), base(M[1]), base(M[2]), base(M[3]), base(M[4])])
    .select('id, medication_id');
  if (rErr) throw new Error('crear recetas fixture: ' + rErr.message);
  for (const r of rxRows) ids.rx[r.medication_id] = r.id;

  await admin.from('consultations')
    .update({ status: 'signed', signed_at: new Date().toISOString() }).eq('id', ids.consult);

  console.log(`Fixtures ${TAG} creadas. consulta=${ids.consult}\n`);

  // ─── Sesión de médico (Camilo) ───
  await camilo.auth.signInWithOtp({ phone: PHONE }).catch(() => {});
  const { data: sess, error: otpErr } = await camilo.auth.verifyOtp({ phone: PHONE, token: OTP, type: 'sms' });
  if (otpErr || !sess?.session) throw new Error('OTP Camilo falló: ' + (otpErr?.message || 'sin sesión'));
  ok('Sesión de médico (Camilo) iniciada vía OTP');

  // ─── Gates SIN REGRESIÓN ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: '   ',
      p_prescription_ops: [{ op: 'replace', prescription_id: ids.rx[M[0]], alternatives: 'x' }],
    });
    eq(error?.code === 'P0012', 'Gate: motivo obligatorio (P0012)', 'Gate motivo NO enforced: ' + JSON.stringify(error));
  }
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'campo prohibido',
      p_consultation_changes: { patient_id: '00000000-0000-0000-0000-000000000000' },
    });
    eq(error?.code === 'P0013', 'Gate: campos prohibidos rechazados (P0013)', 'Gate P0013 NO enforced: ' + JSON.stringify(error));
  }
  {
    const { data: c2 } = await admin.from('consultations').insert({
      appointment_id: null, clinic_id: CLINIC, doctor_id: DOC, patient_id: ids.patient,
      status: 'draft', started_at: start, chief_complaint: TAG,
    }).select('id').single();
    ids.other = c2.id;
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.other, p_reason: 'consulta no firmada',
    });
    eq(error?.code === 'P0011', 'Gate: consulta no firmada (P0011)', 'Gate P0011 NO enforced: ' + JSON.stringify(error));
  }
  {
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await anon.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'no soy el médico',
    });
    eq(!!error, 'Gate: caller sin médico rechazado', 'Gate no-owner NO enforced');
  }

  // ─── CASO 1 (F7): MODIFICAR alternativas existentes ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'F7: corregir las alternativas del medicamento',
      p_prescription_ops: [{
        op: 'replace', prescription_id: ids.rx[M[0]],
        alternatives: 'alternativa CORREGIDA',
      }],
    });
    if (error) ko('Caso 1 amend falló: ' + JSON.stringify(error));
    else {
      const v2 = await currentRx(M[0]);
      eq(v2.alternatives === 'alternativa CORREGIDA',
         'Caso 1: alternatives MODIFICADA (v1 "alternativa original" → v2 "alternativa CORREGIDA")',
         'Caso 1: alternatives no cambió → ' + JSON.stringify(v2.alternatives));
      eq(v2.version === 2 && v2.is_current === true && v2.replaces_id === ids.rx[M[0]],
         'Caso 1: versionado correcto (v2, is_current, replaces_id)',
         'Caso 1: versionado mal → ' + JSON.stringify({ v: v2.version, cur: v2.is_current, rep: v2.replaces_id }));
      const { data: v1 } = await admin.from('prescriptions').select('is_current, alternatives').eq('id', ids.rx[M[0]]).single();
      eq(v1.is_current === false && v1.alternatives === 'alternativa original',
         'Caso 1: v1 histórica conserva sus alternativas originales',
         'Caso 1: v1 alterada → ' + JSON.stringify(v1));
      // No regresión F6: campos ausentes conservan valor anterior
      eq(v2.dosage === '1 tableta' && v2.duration_value === 30 && v2.instructions === 'con comida',
         'Caso 1: claves ausentes (dosis/duración/indicaciones) conservan valor anterior',
         'Caso 1: se perdieron campos no enviados → ' + JSON.stringify(v2));
    }
  }

  // ─── CASO 2 (F7): BORRAR alternativas existentes ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'F7: borrar las alternativas del medicamento',
      p_prescription_ops: [{ op: 'replace', prescription_id: ids.rx[M[1]], alternatives: null }],
    });
    if (error) ko('Caso 2 amend falló: ' + JSON.stringify(error));
    else {
      const v2 = await currentRx(M[1]);
      eq(v2.alternatives === null, 'Caso 2: alternatives BORRADA → NULL (ya no restaura la vieja)',
         'Caso 2: alternatives sigue → ' + JSON.stringify(v2.alternatives));
    }
  }

  // ─── CASO 2b (F7): cadena vacía / espacios también limpian ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'F7: cadena vacia equivale a limpiar alternativas',
      p_prescription_ops: [{ op: 'replace', prescription_id: ids.rx[M[2]], alternatives: '   ' }],
    });
    if (error) ko('Caso 2b amend falló: ' + JSON.stringify(error));
    else {
      const v2 = await currentRx(M[2]);
      eq(v2.alternatives === null, "Caso 2b: '   ' se guarda como NULL (no como cadena vacía)",
         'Caso 2b: quedó → ' + JSON.stringify(v2.alternatives));
    }
  }

  // ─── CASO 3 (F7): clave AUSENTE conserva las alternativas ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'F7: corregir solo la dosis, sin tocar alternativas',
      p_prescription_ops: [{ op: 'replace', prescription_id: ids.rx[M[3]], dosage: '2 tabletas' }],
    });
    if (error) ko('Caso 3 amend falló: ' + JSON.stringify(error));
    else {
      const v2 = await currentRx(M[3]);
      eq(v2.alternatives === 'alternativa original',
         'Caso 3: clave `alternatives` AUSENTE → conserva el valor anterior',
         'Caso 3: se perdieron las alternativas no enviadas → ' + JSON.stringify(v2.alternatives));
      eq(v2.dosage === '2 tabletas', 'Caso 3: la dosis sí se actualizó', 'Caso 3: dosage → ' + JSON.stringify(v2.dosage));
    }
  }

  // ─── CASO 4 (F7): ADD con alternativas ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'F7: agregar medicamento CON alternativas',
      p_prescription_ops: [{
        op: 'add', medication_id: M[5],
        dosage: '1 cápsula', frequency: 'cada 12 horas',
        duration_unit: 'dias', duration_value: 7,
        instructions: 'en ayunas', alternatives: 'sustituto A o B',
      }],
    });
    if (error) ko('Caso 4 amend (add) falló: ' + JSON.stringify(error));
    else {
      const added = await currentRx(M[5]);
      eq(added && added.alternatives === 'sustituto A o B',
         'Caso 4 (add): medicamento agregado en la corrección YA puede llevar alternativas',
         'Caso 4 (add): alternatives → ' + JSON.stringify(added?.alternatives));
      eq(added && added.duration_value === 7 && added.dosage === '1 cápsula',
         'Caso 4 (add): el resto de campos se insertó bien',
         'Caso 4 (add): quedó → ' + JSON.stringify(added));
    }
  }

  // ─── CASO 5 (F7): ADD sin alternativas → NULL ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'F7: agregar medicamento SIN alternativas',
      p_prescription_ops: [{
        op: 'add', medication_id: M[6],
        dosage: '1 tableta', duration_unit: 'dias', duration_value: 5,
        alternatives: null,
      }],
    });
    if (error) ko('Caso 5 amend (add) falló: ' + JSON.stringify(error));
    else {
      const added = await currentRx(M[6]);
      eq(added && added.alternatives === null, 'Caso 5 (add): sin alternativas → NULL',
         'Caso 5 (add): alternatives → ' + JSON.stringify(added?.alternatives));
    }
  }

  // ─── NO REGRESIÓN F6: duración/nulls siguen funcionando ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'F6 no regresion: borrar duracion, dosis, frecuencia, indicaciones',
      p_prescription_ops: [{
        op: 'replace', prescription_id: ids.rx[M[4]],
        duration_unit: 'dias', duration_value: null,
        dosage: null, frequency: null, instructions: null,
      }],
    });
    if (error) ko('F6 no regresión: amend falló → ' + JSON.stringify(error));
    else {
      const v2 = await currentRx(M[4]);
      eq(v2.duration_value === null, 'F6 sin regresión: borrar duración → duration_value NULL',
         'F6 REGRESIÓN: duration_value → ' + JSON.stringify(v2.duration_value));
      eq(v2.dosage === null && v2.frequency === null && v2.instructions === null,
         'F6 sin regresión: dosis/frecuencia/indicaciones borradas → NULL',
         'F6 REGRESIÓN: quedó → ' + JSON.stringify({ d: v2.dosage, f: v2.frequency, i: v2.instructions }));
      eq(v2.alternatives === 'alternativa original',
         'F6 sin regresión: `alternatives` ausente conserva su valor',
         'F6/F7: alternatives se perdió → ' + JSON.stringify(v2.alternatives));
    }
  }
  {
    // 'permanente' sigue forzando duration_value NULL (aunque el cliente mande número).
    // OJO: M[3] ya fue corregido en el Caso 3 → hay que apuntar a la receta VIGENTE
    // (la v2), no al id de la v1, que ya no es is_current (daría P0014).
    const cur = await currentRx(M[3]);
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'F6 no regresion: permanente fuerza duracion NULL',
      p_prescription_ops: [{
        op: 'replace', prescription_id: cur.id,
        duration_unit: 'permanente', duration_value: 99,
      }],
    });
    if (error) ko('F6 no regresión (permanente): amend falló → ' + JSON.stringify(error));
    else {
      const v2 = await currentRx(M[3]);
      eq(v2.duration_unit === 'permanente' && v2.duration_value === null,
         'F6 sin regresión: permanente ⇒ duration_value NULL (aunque el cliente mande 99)',
         'F6 REGRESIÓN: quedó → ' + JSON.stringify({ u: v2.duration_unit, v: v2.duration_value }));
    }
  }

  // ─── TRAZABILIDAD intacta ───
  {
    const { data: amds } = await admin.from('consultation_amendments')
      .select('version, corrected_by, affects_prescriptions, snapshot_before, snapshot_after')
      .eq('consultation_id', ids.consult).order('version', { ascending: true });
    eq(amds.length >= 8, `Trazabilidad: ${amds.length} adendas registradas`, 'Trazabilidad: faltan adendas (' + amds.length + ')');
    eq(amds.every((a) => a.affects_prescriptions === true), 'Trazabilidad: affects_prescriptions=true en todas',
       'Trazabilidad: alguna adenda sin affects_prescriptions');
    eq(amds.every((a) => a.snapshot_before && a.snapshot_after), 'Trazabilidad: snapshots before/after presentes',
       'Trazabilidad: falta snapshot en alguna adenda');
    eq(amds.every((a) => a.corrected_by), 'Trazabilidad: corrected_by registrado', 'Trazabilidad: corrected_by nulo');
    const versions = amds.map((a) => a.version);
    eq(new Set(versions).size === versions.length, 'Trazabilidad: versiones únicas y correlativas (' + versions.join(',') + ')',
       'Trazabilidad: versiones mal → ' + versions.join(','));

    const { data: audit } = await admin.from('audit_log')
      .select('new_data').eq('table_name', 'consultations').eq('record_id', ids.consult);
    const amendAudit = (audit ?? []).filter((a) => a.new_data?.edited_via === 'consultation_amendment');
    eq(amendAudit.length >= 8, `Trazabilidad: audit_log registra las correcciones (${amendAudit.length})`,
       'Trazabilidad: audit_log incompleto (' + amendAudit.length + ')');
  }

  // ─── La consulta sigue FIRMADA ───
  {
    const { data: c2 } = await admin.from('consultations').select('status, signed_at').eq('id', ids.consult).single();
    eq(c2.status === 'signed' && c2.signed_at, 'La consulta sigue firmada tras las correcciones',
       'La consulta cambió de estado: ' + JSON.stringify(c2));
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  // ─── Cleanup (service_role), orden FK-safe ───
  console.log('\n— cleanup —');
  if (ids.consult) {
    await admin.from('consultation_amendments').delete().eq('consultation_id', ids.consult);
    await admin.from('prescriptions').delete().eq('consultation_id', ids.consult);
    await admin.from('audit_log').delete().eq('table_name', 'consultations').eq('record_id', ids.consult);
    await admin.from('consultations').delete().eq('id', ids.consult);
  }
  if (ids.other) await admin.from('consultations').delete().eq('id', ids.other);
  if (ids.appt) await admin.from('appointments').delete().eq('id', ids.appt);
  if (ids.patient) await admin.from('patients').delete().eq('id', ids.patient);
  await camilo.auth.signOut().catch(() => {});

  const { data: lc } = await admin.from('consultations').select('id').eq('chief_complaint', TAG);
  const { data: lp } = await admin.from('patients').select('id').eq('notes', TAG);
  const { data: lrx } = ids.consult
    ? await admin.from('prescriptions').select('id').eq('consultation_id', ids.consult)
    : { data: [] };
  const left = { consultas: lc?.length ?? 0, pacientes: lp?.length ?? 0, recetas: lrx?.length ?? 0 };
  const zero = left.consultas === 0 && left.pacientes === 0 && left.recetas === 0;
  console.log(zero ? '  ✅ cleanup OK — 0 residuales' : '  ⚠️ RESIDUALES: ' + JSON.stringify(left));

  console.log(`\n${fail === 0 ? '✅ SMOKE s7_59 OK' : '❌ SMOKE s7_59 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
