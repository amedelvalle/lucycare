/**
 * SMOKE s7_40 — RPC F5 tolerante a teléfono crudo (find_patient_match_candidates).
 *
 * Corre con la SESIÓN de Camilo (miembro de su clínica) para que el gate
 * is_clinic_member(p_clinic_id) pase. Crea fixtures aisladas con teléfono
 * GUARDADO en forma canónica `503XXXXXXXX` (igual que createBasicPatient):
 *   • intra: paciente en la clínica de Camilo, phone 50370009001.
 *   • cross: paciente en OTRA clínica, phone 50370009002.
 * Limpia todo en finally.
 *
 * Objetivo: probar que la RPC matchea sin importar el formato del INPUT —
 * incluido el teléfono crudo de 8 dígitos `70009001` que ANTES (s7_35) no
 * matcheaba contra el almacenado `50370009001`.
 *
 * Cubre:
 *  1. Intra por teléfono en 5 formatos del MISMO número → todos → intra match:
 *       70009001 · 50370009001 · +50370009001 · +503 7000-9001 · (503) 7000 9001
 *  2. Cross weak por teléfono CRUDO (8 dígitos) → cross.match='weak', intra vacío.
 *  3. Privacidad: cross_clinic solo expone {match} (sin PII).
 *  4. Autorización: sesión del paciente (no miembro) → P0001.
 *  5. No-regresión s7_35: intra por documento ('document'/'both') y 'none'.
 *
 * Uso (SOLO después de aplicar la migración s7_40):
 *   node scripts/_smoke-s7_40.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const CAMILO_PHONE = '50378627694';
const CAMILO_CLINIC = '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0';
const PATIENT_PHONE = '50375000001';
const OTP = '123456';

// Fixtures (teléfonos/DUI improbables, solo para el smoke). Guardados canónicos.
const INTRA_PHONE = '50370009001';
const INTRA_LOCAL = '70009001'; // mismo número, forma local de 8 dígitos
const INTRA_DUI = '90400001-9'; // normaliza a 904000019 (9 dígitos)
const CROSS_PHONE = '50370009002';
const CROSS_LOCAL = '70009002';
const CROSS_DUI = '90400002-7';

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

console.log('═══ SMOKE s7_40 (RPC F5 tolerante a teléfono crudo) ═══\n');

try {
  await login(camilo, CAMILO_PHONE);
  await login(patient, PATIENT_PHONE);

  const { data: oc, error: ocErr } = await admin
    .from('clinics').select('id').neq('id', CAMILO_CLINIC).limit(1).single();
  if (ocErr || !oc) throw new Error('No hay otra clínica para el fixture cross: ' + (ocErr?.message || 'vacío'));
  otherClinic = oc.id;

  // Fixture intra (clínica de Camilo) — phone canónico.
  const { data: pIntra, error: e1 } = await admin.from('patients').insert({
    clinic_id: CAMILO_CLINIC, profile_id: null, full_name: 'S740 Intra Test',
    document_type: 'dui', document_number: INTRA_DUI, date_of_birth: '1990-01-01',
    gender: 'otro', patient_type: 'privado', phone: INTRA_PHONE, is_active: true,
  }).select('id').single();
  if (e1) throw new Error('insert intra falló: ' + e1.message);
  intraId = pIntra.id;

  // Fixture cross (otra clínica) — phone canónico.
  const { data: pCross, error: e2 } = await admin.from('patients').insert({
    clinic_id: otherClinic, profile_id: null, full_name: 'S740 Cross Test',
    document_type: 'dui', document_number: CROSS_DUI, date_of_birth: '1990-01-01',
    gender: 'otro', patient_type: 'privado', phone: CROSS_PHONE, is_active: true,
  }).select('id').single();
  if (e2) throw new Error('insert cross falló: ' + e2.message);
  crossId = pCross.id;
  ok('Fixtures: intra (Camilo, 50370009001) + cross (otra clínica, 50370009002)');

  // 1. Intra por teléfono en 5 formatos del MISMO número → todos deben matchear.
  const variants = [
    ['70009001', 'crudo 8 dígitos'],
    ['50370009001', 'canónico 503…'],
    ['+50370009001', 'con +'],
    ['+503 7000-9001', '+503 con espacio y guion'],
    ['(503) 7000 9001', 'paréntesis y espacios'],
  ];
  for (const [input, label] of variants) {
    const { data, error } = await call(camilo, { p_clinic_id: CAMILO_CLINIC, p_phone: input });
    const hit = (data?.intra_clinic ?? []).find((r) => r.id === intraId);
    if (error) ko(`1 [${label}] "${input}" error: ${error.message}`);
    else if (hit) ok(`1 [${label}] "${input}" → intra match`);
    else ko(`1 [${label}] "${input}" NO matcheó (esperado intra): ${JSON.stringify(data)}`);
  }

  // 2. Cross weak por teléfono CRUDO (8 dígitos) → weak + intra vacío.
  {
    const { data, error } = await call(camilo, { p_clinic_id: CAMILO_CLINIC, p_phone: CROSS_LOCAL });
    if (error) ko('2 cross-weak crudo error: ' + error.message);
    else if (data?.cross_clinic?.match === 'weak' && (data?.intra_clinic ?? []).length === 0)
      ok(`2 Cross weak por teléfono crudo "${CROSS_LOCAL}" → weak + intra vacío`);
    else ko('2 Cross weak por teléfono crudo falló: ' + JSON.stringify(data));
  }

  // 3. Privacidad: cross_clinic solo {match}.
  {
    const { data } = await call(camilo, { p_clinic_id: CAMILO_CLINIC, p_phone: CROSS_LOCAL });
    const keys = Object.keys(data?.cross_clinic ?? {});
    if (keys.length === 1 && keys[0] === 'match') ok('3 Privacidad: cross_clinic solo expone {match} (sin PII)');
    else ko('3 Privacidad: cross_clinic expone claves extra: ' + JSON.stringify(keys));
  }

  // 4. Autorización: paciente (no miembro) → P0001.
  {
    const { error } = await call(patient, { p_clinic_id: CAMILO_CLINIC, p_phone: INTRA_LOCAL });
    if (error && (error.code === 'P0001' || /No autorizado/i.test(error.message)))
      ok('4 No-miembro rechazado (P0001)');
    else ko('4 No-miembro NO fue rechazado: ' + JSON.stringify(error));
  }

  // 5a. No-regresión s7_35: intra por documento → 'document' o 'both'.
  {
    const { data, error } = await call(camilo, { p_clinic_id: CAMILO_CLINIC, p_document_type: 'dui', p_document_number: '904000019' });
    const hit = (data?.intra_clinic ?? []).find((r) => r.id === intraId);
    if (error) ko('5a intra-doc error: ' + error.message);
    else if (hit && (hit.match === 'document' || hit.match === 'both')) ok(`5a No-regresión: intra por documento → match='${hit.match}'`);
    else ko('5a Intra por documento falló: ' + JSON.stringify(data));
  }

  // 5b. No-regresión s7_35: sin coincidencia → none + intra vacío.
  {
    const { data, error } = await call(camilo, { p_clinic_id: CAMILO_CLINIC, p_phone: '50370000000', p_document_type: 'dui', p_document_number: '99999999-9' });
    if (error) ko('5b none error: ' + error.message);
    else if (data?.cross_clinic?.match === 'none' && (data?.intra_clinic ?? []).length === 0)
      ok('5b No-regresión: sin coincidencia → none + intra vacío');
    else ko('5b None falló: ' + JSON.stringify(data));
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
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_40 OK' : '❌ SMOKE s7_40 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
