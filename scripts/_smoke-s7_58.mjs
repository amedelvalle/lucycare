/**
 * SMOKE F6 / s7_58 — corrección post-firma de receta que SÍ limpia campos.
 *
 * Valida la nueva semántica del bloque de receta de `amend_consultation`:
 *    clave ausente            → conserva el valor anterior
 *    clave presente (null/'') → limpia (NULL)
 *    clave presente con valor → actualiza
 * + regla clínica: duration_unit='permanente' ⇒ duration_value SIEMPRE NULL.
 *
 * Fixtures PROPIAS creadas desde cero y marcadas `F6_FIXTURE` (paciente, cita,
 * consulta, recetas). NUNCA usa Pepe Toro, Katherine ni pacientes reales: la
 * corrección crea adendas, así que no se atan a datos existentes.
 * Todo se borra en el finally, con verificación de 0 residuales.
 *
 * Requiere sesión de MÉDICO real (la RPC usa auth.uid()/get_user_doctor_id()):
 * se usa la cuenta demo Camilo vía Test Phone OTP, igual que _smoke-s7_31.
 *
 * Uso: node scripts/_smoke-s7_58.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { supabaseAnon as camilo, SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const DOC = '783a902a-55fd-407c-9e0a-69568135c7f5';    // Camilo (médico demo)
const CLINIC = '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0';
const PHONE = '50378627694';
const OTP = '123456';
const TAG = `F6_FIXTURE_${Date.now()}`;

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };
const eq = (cond, okMsg, koMsg) => (cond ? ok(okMsg) : ko(koMsg));

const ids = { patient: null, appt: null, consult: null, rx: {}, other: null };

/** Receta vigente (is_current) de un medicamento dado. */
const currentRx = async (medId) => {
  const { data } = await admin.from('prescriptions')
    .select('id, dosage, frequency, duration_value, duration_unit, instructions, alternatives, version, is_current, replaces_id')
    .eq('consultation_id', ids.consult).eq('medication_id', medId).eq('is_current', true).maybeSingle();
  return data;
};

try {
  // ─── Setup: paciente + cita + consulta + 5 recetas (una por caso) ───
  const { data: st } = await admin.from('appointment_statuses').select('id').limit(1).single();
  const { data: meds } = await admin.from('medications')
    .select('id').is('doctor_id', null).eq('is_active', true).limit(6);
  if (!meds || meds.length < 6) throw new Error('faltan medicamentos globales para el fixture');
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

  // 6 recetas v1, todas con valores COMPLETOS (para poder probar el borrado)
  const base = (medId) => ({
    consultation_id: ids.consult, medication_id: medId,
    dosage: '1 tableta', frequency: 'cada 8 horas',
    duration_value: 30, duration_unit: 'dias',
    instructions: 'con comida', alternatives: 'alternativa original',
    version: 1, is_current: true,
  });
  const { data: rxRows, error: rErr } = await admin.from('prescriptions')
    .insert([base(M[0]), base(M[1]), base(M[2]), base(M[3]), base(M[4]), base(M[5])])
    .select('id, medication_id');
  if (rErr) throw new Error('crear recetas fixture: ' + rErr.message);
  for (const r of rxRows) ids.rx[r.medication_id] = r.id;

  // FIRMAR (es post-firma lo que probamos)
  await admin.from('consultations')
    .update({ status: 'signed', signed_at: new Date().toISOString() }).eq('id', ids.consult);

  console.log(`Fixtures ${TAG} creadas. consulta=${ids.consult}\n`);

  // ─── Sesión de médico (Camilo) ───
  await camilo.auth.signInWithOtp({ phone: PHONE }).catch(() => {});
  const { data: sess, error: otpErr } = await camilo.auth.verifyOtp({ phone: PHONE, token: OTP, type: 'sms' });
  if (otpErr || !sess?.session) throw new Error('OTP Camilo falló: ' + (otpErr?.message || 'sin sesión'));
  ok('Sesión de médico (Camilo) iniciada vía OTP');

  // ─── Gates SIN REGRESIÓN (antes de tocar nada) ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: '   ',
      p_prescription_ops: [{ op: 'replace', prescription_id: ids.rx[M[0]], dosage: 'x' }],
    });
    eq(error?.code === 'P0012', 'Gate: motivo obligatorio sigue obligatorio (P0012)',
       'Gate motivo NO enforced: ' + JSON.stringify(error));
  }
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'campo prohibido',
      p_consultation_changes: { patient_id: '00000000-0000-0000-0000-000000000000' },
    });
    eq(error?.code === 'P0013', 'Gate: campos prohibidos siguen rechazados (P0013)',
       'Gate campos prohibidos NO enforced: ' + JSON.stringify(error));
  }
  {
    // Consulta en BORRADOR (otra fixture) → P0011
    const { data: c2 } = await admin.from('consultations').insert({
      appointment_id: null, clinic_id: CLINIC, doctor_id: DOC, patient_id: ids.patient,
      status: 'draft', started_at: start, chief_complaint: TAG,
    }).select('id').single();
    ids.other = c2.id;
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.other, p_reason: 'consulta no firmada',
    });
    eq(error?.code === 'P0011', 'Gate: consulta no firmada no se puede corregir (P0011)',
       'Gate consulta no firmada NO enforced: ' + JSON.stringify(error));
  }
  {
    // Caller sin médico (anon, sin sesión) → rechazado (42501)
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await anon.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'no soy el médico',
    });
    eq(!!error, 'Gate: caller sin médico no puede corregir (rechazado)',
       'Gate no-owner NO enforced (sin error)');
  }

  // ─── CASO 1: borrar duration_value (v1 tenía 30 días) ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'F6: borrar la duración del medicamento',
      p_prescription_ops: [{
        op: 'replace', prescription_id: ids.rx[M[0]],
        dosage: '1 tableta', frequency: 'cada 8 horas', instructions: 'con comida',
        duration_unit: 'dias', duration_value: null,   // ← intención: BORRAR
      }],
    });
    if (error) ko('Caso 1 amend falló: ' + JSON.stringify(error));
    else {
      const v2 = await currentRx(M[0]);
      eq(v2.duration_value === null, 'Caso 1: duration_value quedó NULL (ya no restaura el 30 viejo)',
         'Caso 1: duration_value NO se limpió → ' + JSON.stringify(v2.duration_value));
      eq(v2.duration_unit === 'dias', 'Caso 1: duration_unit conservado (dias)',
         'Caso 1: duration_unit inesperado → ' + v2.duration_unit);
      eq(v2.version === 2 && v2.is_current === true && v2.replaces_id === ids.rx[M[0]],
         'Caso 1: versionado correcto (v2, is_current, replaces_id)',
         'Caso 1: versionado mal → ' + JSON.stringify({ v: v2.version, cur: v2.is_current, rep: v2.replaces_id }));
      const { data: v1 } = await admin.from('prescriptions').select('is_current').eq('id', ids.rx[M[0]]).single();
      eq(v1.is_current === false, 'Caso 1: v1 quedó is_current=false (histórica preservada)',
         'Caso 1: v1 sigue is_current=true');
    }
  }

  // ─── CASO 2: cambiar a 'permanente' → sin duración fantasma ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'F6: pasar el medicamento a permanente',
      p_prescription_ops: [{
        op: 'replace', prescription_id: ids.rx[M[1]],
        duration_unit: 'permanente', duration_value: null,
      }],
    });
    if (error) ko('Caso 2 amend falló: ' + JSON.stringify(error));
    else {
      const v2 = await currentRx(M[1]);
      eq(v2.duration_unit === 'permanente', 'Caso 2: duration_unit = permanente', 'Caso 2: unit → ' + v2.duration_unit);
      eq(v2.duration_value === null, 'Caso 2: duration_value NULL (no queda duración fantasma)',
         'Caso 2: quedó duración fantasma → ' + v2.duration_value);
    }
  }

  // ─── CASO 2b: 'permanente' con duración numérica → el server la ignora ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'F6: permanente pero el cliente manda duracion',
      p_prescription_ops: [{
        op: 'replace', prescription_id: ids.rx[M[5]],
        duration_unit: 'permanente', duration_value: 99,  // cliente inconsistente
      }],
    });
    if (error) ko('Caso 2b amend falló: ' + JSON.stringify(error));
    else {
      const v2 = await currentRx(M[5]);
      eq(v2.duration_unit === 'permanente' && v2.duration_value === null,
         'Caso 2b: regla server-side — permanente ⇒ duration_value NULL aunque el cliente mande 99',
         'Caso 2b: quedó ' + JSON.stringify({ u: v2.duration_unit, v: v2.duration_value }));
    }
  }

  // ─── CASO 3/4/5: borrar dosage / frequency / instructions → NULL (no '') ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'F6: borrar dosis, frecuencia e indicaciones',
      p_prescription_ops: [{
        op: 'replace', prescription_id: ids.rx[M[2]],
        dosage: null, frequency: null, instructions: null,
      }],
    });
    if (error) ko('Caso 3/4/5 amend falló: ' + JSON.stringify(error));
    else {
      const v2 = await currentRx(M[2]);
      eq(v2.dosage === null, 'Caso 3: dosage quedó NULL (no cadena vacía)', 'Caso 3: dosage → ' + JSON.stringify(v2.dosage));
      eq(v2.frequency === null, 'Caso 4: frequency quedó NULL (no cadena vacía)', 'Caso 4: frequency → ' + JSON.stringify(v2.frequency));
      eq(v2.instructions === null, 'Caso 5: instructions quedó NULL (no cadena vacía)', 'Caso 5: instructions → ' + JSON.stringify(v2.instructions));
      eq(v2.duration_value === 30 && v2.duration_unit === 'dias',
         'Caso 6: claves AUSENTES (duración) conservan el valor anterior (30 días)',
         'Caso 6: se perdió la duración no enviada → ' + JSON.stringify({ v: v2.duration_value, u: v2.duration_unit }));
      eq(v2.alternatives === 'alternativa original',
         'F7 fuera de alcance: alternatives se conserva intacta en el replace',
         'alternatives se alteró → ' + JSON.stringify(v2.alternatives));
    }
  }

  // ─── CASO 6b: cadena vacía '' también limpia (equivale a null) ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'F6: cadena vacia equivale a limpiar',
      p_prescription_ops: [{ op: 'replace', prescription_id: ids.rx[M[3]], dosage: '', instructions: '   ' }],
    });
    if (error) ko('Caso 6b amend falló: ' + JSON.stringify(error));
    else {
      const v2 = await currentRx(M[3]);
      eq(v2.dosage === null && v2.instructions === null,
         "Caso 6b: '' y '   ' se guardan como NULL (no como cadena vacía)",
         'Caso 6b: quedó ' + JSON.stringify({ d: v2.dosage, i: v2.instructions }));
      eq(v2.frequency === 'cada 8 horas', 'Caso 6b: frequency ausente → conserva valor anterior',
         'Caso 6b: frequency se perdió → ' + JSON.stringify(v2.frequency));
    }
  }

  // ─── CASO 7: 'add' en corrección — permanente sin número, vacíos como NULL ───
  {
    const { error } = await camilo.rpc('amend_consultation', {
      p_consultation_id: ids.consult, p_reason: 'F6: agregar medicamento en la correccion',
      p_prescription_ops: [{
        op: 'add', medication_id: M[4] === ids.rx[M[4]] ? M[4] : M[4],
        dosage: null, frequency: 'cada 12 horas', instructions: null,
        duration_unit: 'permanente', duration_value: 7,
      }],
    });
    // M[4] ya tiene una receta v1 vigente; el add crea otra fila vigente del mismo
    // medicamento, así que verificamos por la más nueva.
    if (error) ko('Caso 7 amend (add) falló: ' + JSON.stringify(error));
    else {
      const { data: added } = await admin.from('prescriptions')
        .select('dosage, frequency, instructions, duration_unit, duration_value, version, is_current')
        .eq('consultation_id', ids.consult).eq('medication_id', M[4])
        .eq('duration_unit', 'permanente').maybeSingle();
      eq(added && added.duration_value === null,
         'Caso 7 (add): permanente ⇒ duration_value NULL (el 7 enviado se ignora)',
         'Caso 7 (add): duration_value → ' + JSON.stringify(added?.duration_value));
      eq(added && added.dosage === null && added.instructions === null && added.frequency === 'cada 12 horas',
         'Caso 7 (add): vacíos como NULL, valor presente conservado',
         'Caso 7 (add): quedó ' + JSON.stringify(added));
    }
  }

  // ─── TRAZABILIDAD intacta ───
  {
    const { data: amds } = await admin.from('consultation_amendments')
      .select('version, reason, corrected_by, affects_prescriptions, snapshot_before, snapshot_after')
      .eq('consultation_id', ids.consult).order('version', { ascending: true });
    eq(amds.length >= 6, `Trazabilidad: ${amds.length} adendas registradas (una por corrección)`,
       'Trazabilidad: faltan adendas (' + amds.length + ')');
    eq(amds.every((a) => a.affects_prescriptions === true),
       'Trazabilidad: affects_prescriptions=true en todas (tocaron receta)',
       'Trazabilidad: alguna adenda sin affects_prescriptions');
    eq(amds.every((a) => a.snapshot_before && a.snapshot_after),
       'Trazabilidad: snapshot_before y snapshot_after presentes en todas',
       'Trazabilidad: falta snapshot en alguna adenda');
    eq(amds.every((a) => a.corrected_by), 'Trazabilidad: corrected_by registrado',
       'Trazabilidad: corrected_by nulo');
    const versions = amds.map((a) => a.version);
    eq(JSON.stringify(versions) === JSON.stringify([...versions].sort((a, b) => a - b)) && new Set(versions).size === versions.length,
       'Trazabilidad: versiones correlativas y únicas (' + versions.join(',') + ')',
       'Trazabilidad: versiones mal → ' + versions.join(','));

    const { data: audit } = await admin.from('audit_log')
      .select('id, new_data').eq('table_name', 'consultations').eq('record_id', ids.consult);
    const amendAudit = (audit ?? []).filter((a) => a.new_data?.edited_via === 'consultation_amendment');
    eq(amendAudit.length >= 6, `Trazabilidad: audit_log registra las correcciones (${amendAudit.length})`,
       'Trazabilidad: audit_log incompleto (' + amendAudit.length + ')');
  }

  // ─── La consulta sigue FIRMADA (no se des-firmó) ───
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

  // Verificación de 0 residuales
  const left = {};
  const { data: lc } = await admin.from('consultations').select('id').eq('chief_complaint', TAG);
  const { data: lp } = await admin.from('patients').select('id').eq('notes', TAG);
  const { data: lrx } = ids.consult
    ? await admin.from('prescriptions').select('id').eq('consultation_id', ids.consult)
    : { data: [] };
  left.consultas = lc?.length ?? 0;
  left.pacientes = lp?.length ?? 0;
  left.recetas = lrx?.length ?? 0;
  const zero = left.consultas === 0 && left.pacientes === 0 && left.recetas === 0;
  console.log(zero ? '  ✅ cleanup OK — 0 residuales' : '  ⚠️ RESIDUALES: ' + JSON.stringify(left));

  console.log(`\n${fail === 0 ? '✅ SMOKE s7_58 OK' : '❌ SMOKE s7_58 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
