/**
 * SMOKE s7_35 (Paciente Global F5 backend) — find_patient_match_candidates.
 *
 * Corre con la SESIÓN de Camilo (miembro de su clínica) para que el gate
 * is_clinic_member(p_clinic_id) pase. Crea fixtures aisladas: un paciente en
 * la clínica de Camilo (intra) y otro en OTRA clínica cualquiera (cross), con
 * teléfono + DUI conocidos. Limpia todo en finally.
 *
 * Cubre:
 *  1. Intra por teléfono → intra_clinic con detalle (id/nombre/teléfono).
 *  2. Intra por documento → match 'document' (o 'both').
 *  3. Cross por documento (solo en otra clínica) → cross.match='strong', intra vacío.
 *  4. Cross por teléfono (solo en otra clínica) → cross.match='weak'.
 *  5. Sin coincidencia → cross.match='none', intra vacío.
 *  6. Autorización: sesión del paciente (no miembro) → P0001.
 *  7. Privacidad: el objeto cross_clinic solo tiene la clave 'match' (sin PII).
 *
 * Uso: node scripts/_smoke-s7_35.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const CAMILO_PHONE = '50378627694';
const CAMILO_CLINIC = '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0';
const PATIENT_PHONE = '50375000001';
const OTP = '123456';

// Fixtures (teléfonos/DUI improbables, solo para el smoke)
const INTRA_PHONE = '50370009001';
const INTRA_DUI = '90000001-9'; // normaliza a 900000019 (9 dígitos)
const CROSS_PHONE = '50370009002';
const CROSS_DUI = '90000002-7'; // normaliza a 900000027

const camilo = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const patient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

let intraId = null, crossId = null, otherClinic = null;

async function login(client, phone) {
  await client.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await client.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error(`OTP ${phone} falló: ${error?.message || 'sin sesión'}`);
  return data.user.id;
}

const call = (client, args) => client.rpc('find_patient_match_candidates', args);

console.log('═══ SMOKE s7_35 (find_patient_match_candidates) ═══\n');

try {
  await login(camilo, CAMILO_PHONE);
  await login(patient, PATIENT_PHONE);

  // Una clínica distinta a la de Camilo para la ficha cross.
  const { data: oc, error: ocErr } = await admin
    .from('clinics').select('id').neq('id', CAMILO_CLINIC).limit(1).single();
  if (ocErr || !oc) throw new Error('No hay otra clínica para el fixture cross: ' + (ocErr?.message || 'vacío'));
  otherClinic = oc.id;

  // Fixture intra (clínica de Camilo)
  const { data: pIntra, error: e1 } = await admin.from('patients').insert({
    clinic_id: CAMILO_CLINIC, profile_id: null, full_name: 'F5 Intra Test',
    document_type: 'dui', document_number: INTRA_DUI, date_of_birth: '1990-01-01',
    gender: 'otro', patient_type: 'privado', phone: INTRA_PHONE, is_active: true,
  }).select('id').single();
  if (e1) throw new Error('insert intra falló: ' + e1.message);
  intraId = pIntra.id;

  // Fixture cross (otra clínica)
  const { data: pCross, error: e2 } = await admin.from('patients').insert({
    clinic_id: otherClinic, profile_id: null, full_name: 'F5 Cross Test',
    document_type: 'dui', document_number: CROSS_DUI, date_of_birth: '1990-01-01',
    gender: 'otro', patient_type: 'privado', phone: CROSS_PHONE, is_active: true,
  }).select('id').single();
  if (e2) throw new Error('insert cross falló: ' + e2.message);
  crossId = pCross.id;
  ok('Fixtures: paciente intra (clínica Camilo) + paciente cross (otra clínica)');

  // 1. Intra por teléfono
  {
    const { data, error } = await call(camilo, { p_clinic_id: CAMILO_CLINIC, p_phone: INTRA_PHONE });
    const intra = data?.intra_clinic ?? [];
    const hit = intra.find((r) => r.id === intraId);
    if (error) ko('1 intra-teléfono error: ' + error.message);
    else if (hit && hit.full_name === 'F5 Intra Test' && hit.phone) ok('1 Intra por teléfono → detalle (id/nombre/teléfono)');
    else ko('1 Intra por teléfono no devolvió detalle: ' + JSON.stringify(data));
  }

  // 2. Intra por documento
  {
    const { data, error } = await call(camilo, { p_clinic_id: CAMILO_CLINIC, p_document_type: 'dui', p_document_number: '900000019' });
    const hit = (data?.intra_clinic ?? []).find((r) => r.id === intraId);
    if (error) ko('2 intra-doc error: ' + error.message);
    else if (hit && (hit.match === 'document' || hit.match === 'both')) ok(`2 Intra por documento → match='${hit.match}'`);
    else ko('2 Intra por documento falló: ' + JSON.stringify(data));
  }

  // 3. Cross por documento → strong, intra vacío
  {
    const { data, error } = await call(camilo, { p_clinic_id: CAMILO_CLINIC, p_document_type: 'dui', p_document_number: CROSS_DUI });
    if (error) ko('3 cross-doc error: ' + error.message);
    else if (data?.cross_clinic?.match === 'strong' && (data?.intra_clinic ?? []).length === 0)
      ok('3 Cross por documento → strong + intra vacío');
    else ko('3 Cross por documento falló: ' + JSON.stringify(data));
  }

  // 4. Cross por teléfono (sin doc) → weak
  {
    const { data, error } = await call(camilo, { p_clinic_id: CAMILO_CLINIC, p_phone: CROSS_PHONE });
    if (error) ko('4 cross-tel error: ' + error.message);
    else if (data?.cross_clinic?.match === 'weak' && (data?.intra_clinic ?? []).length === 0)
      ok('4 Cross por teléfono → weak + intra vacío');
    else ko('4 Cross por teléfono falló: ' + JSON.stringify(data));
  }

  // 5. Sin coincidencia
  {
    const { data, error } = await call(camilo, { p_clinic_id: CAMILO_CLINIC, p_phone: '50370000000', p_document_type: 'dui', p_document_number: '99999999-9' });
    if (error) ko('5 none error: ' + error.message);
    else if (data?.cross_clinic?.match === 'none' && (data?.intra_clinic ?? []).length === 0)
      ok('5 Sin coincidencia → none + intra vacío');
    else ko('5 None falló: ' + JSON.stringify(data));
  }

  // 6. Autorización: paciente (no miembro) → P0001
  {
    const { error } = await call(patient, { p_clinic_id: CAMILO_CLINIC, p_phone: INTRA_PHONE });
    if (error && (error.code === 'P0001' || /No autorizado/i.test(error.message)))
      ok('6 No-miembro rechazado (P0001)');
    else ko('6 No-miembro NO fue rechazado: ' + JSON.stringify(error));
  }

  // 7. Privacidad: cross_clinic solo {match}
  {
    const { data } = await call(camilo, { p_clinic_id: CAMILO_CLINIC, p_document_type: 'dui', p_document_number: CROSS_DUI });
    const keys = Object.keys(data?.cross_clinic ?? {});
    if (keys.length === 1 && keys[0] === 'match') ok('7 Privacidad: cross_clinic solo expone {match} (sin PII)');
    else ko('7 Privacidad: cross_clinic expone claves extra: ' + JSON.stringify(keys));
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    if (intraId) await admin.from('patients').delete().eq('id', intraId);
    if (crossId) await admin.from('patients').delete().eq('id', crossId);
    await camilo.auth.signOut().catch(() => {});
    await patient.auth.signOut().catch(() => {});
    console.log('  ✅ cleanup OK');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_35 OK' : '❌ SMOKE s7_35 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
