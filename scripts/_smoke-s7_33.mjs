/**
 * SMOKE s7_33 (Paciente Global F3.1) — sync espejo + guard de identidad.
 *
 * IMPORTANTE: los updates de `profiles` se hacen con la SESIÓN del paciente
 * (auth.uid() seteado) — como en producción —, porque el trigger de audit de
 * s7_32 exige user_id. Con service_role (auth.uid()=NULL) el audit falla.
 *
 * Cubre:
 *  1. Médico (Camilo OTP) NO edita identidad de paciente vinculado → P0030.
 *  2. Médico SÍ edita campos locales (alergias).
 *  3. Paciente actualiza su perfil → patients vinculadas reflejan (sync ongoing).
 *  4. claim copia identidad global (global gana; local-only se conserva).
 *  5. Paciente NO vinculado → identidad editable por el médico.
 *
 * Usa el test phone de paciente 50375000001 (captura/restaura su perfil).
 * Fixtures de patients aisladas + cleanup en finally.
 *
 * Uso: node scripts/_smoke-s7_33.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const CAMILO_PHONE = '50378627694';
const CAMILO_CLINIC = '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0';
const PATIENT_PHONE = '50375000001';
const OTP = '123456';

const camilo = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const patient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

let ppId = null, ppOrig = null, plId = null, wId = null, uId = null;

async function login(client, phone) {
  await client.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await client.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error(`OTP ${phone} falló: ${error?.message || 'sin sesión'}`);
  return data.user.id;
}

console.log('═══ SMOKE s7_33 (sync espejo + guard) ═══\n');

try {
  await login(camilo, CAMILO_PHONE);
  ppId = await login(patient, PATIENT_PHONE);

  // Capturar identidad original del perfil del paciente (para restaurar)
  const { data: orig } = await admin.from('profiles')
    .select('full_name, email, document_type, document_number, date_of_birth, gender').eq('id', ppId).single();
  ppOrig = orig;

  // Estado base conocido vía SESIÓN del paciente. "global gana" se prueba con
  // EMAIL (sin UNIQUE en patients); DOB null para probar "local-only se
  // conserva". Documentos en null para no chocar con UNIQUE(clinic,type,number).
  const GLOBAL_EMAIL = 'globalwins@test.lucy';
  {
    const { error } = await patient.from('profiles').update({
      full_name: 'Sync Base', email: GLOBAL_EMAIL, document_type: 'dui',
      document_number: null, date_of_birth: null, gender: 'masculino',
    }).eq('id', ppId);
    if (error) throw new Error('set base perfil (sesión paciente) falló: ' + error.message);
  }

  // Paciente vinculado PL en clínica Camilo (profile_id = ppId), document null
  const { data: pl, error: plErr } = await admin.from('patients').insert({
    clinic_id: CAMILO_CLINIC, profile_id: ppId, full_name: 'Sync Base',
    document_type: 'dui', document_number: null, date_of_birth: '2000-01-01',
    gender: 'masculino', patient_type: 'privado', phone: PATIENT_PHONE, is_active: true,
  }).select('id').single();
  if (plErr) throw new Error('insert PL falló: ' + plErr.message);
  plId = pl.id;
  ok('Fixtures: perfil base (sesión paciente) + paciente vinculado (PL) en clínica Camilo');

  // 1. Médico NO edita identidad de PL (vinculado)
  {
    const { error } = await camilo.from('patients').update({ full_name: 'Hackeado' }).eq('id', plId);
    const { data: a } = await admin.from('patients').select('full_name').eq('id', plId).single();
    if (error && a.full_name === 'Sync Base') ok(`Médico NO editó identidad de vinculado → ${(error.code || '') + ' ' + error.message.slice(0, 55)}`);
    else if (!error) ko('⚠ Médico EDITÓ identidad de vinculado (guard no bloqueó)');
    else ko('Sin error esperado: ' + error.message);
  }

  // 2. Médico SÍ edita campos locales
  {
    const { error } = await camilo.from('patients').update({ allergies: 'Polen' }).eq('id', plId);
    const { data: a } = await admin.from('patients').select('allergies').eq('id', plId).single();
    if (!error && a.allergies === 'Polen') ok('Médico SÍ edita campos locales (alergias)');
    else ko('Edición local falló: ' + (error?.message || a?.allergies));
  }

  // 3. Sync ongoing: paciente actualiza su perfil → PL refleja
  {
    const { error } = await patient.from('profiles').update({ full_name: 'Sync Editado' }).eq('id', ppId);
    if (error) ko('update perfil (paciente) falló: ' + error.message);
    else {
      const { data: a } = await admin.from('patients').select('full_name').eq('id', plId).single();
      if (a.full_name === 'Sync Editado') ok('Sync ongoing: cambio en profiles se reflejó en patients vinculada');
      else ko('Sync NO reflejó (full_name=' + a.full_name + ')');
    }
  }

  // 4. Claim copia identidad global (global gana; local-only se conserva)
  {
    const { data: w, error: wErr } = await admin.from('patients').insert({
      clinic_id: CAMILO_CLINIC, profile_id: null, full_name: 'Walkin Test',
      document_type: 'dui', document_number: null, date_of_birth: '2000-01-01',
      gender: 'otro', patient_type: 'privado', phone: PATIENT_PHONE, is_active: true,
    }).select('id').single();
    if (wErr) throw new Error('insert W falló: ' + wErr.message);
    wId = w.id;
    const { error: claimErr } = await patient.rpc('claim_patient_records');
    if (claimErr) ko('claim falló: ' + claimErr.message);
    else {
      const { data: w2 } = await admin.from('patients').select('profile_id, email, date_of_birth').eq('id', wId).single();
      const linked = w2.profile_id === ppId;
      const globalWon = w2.email === GLOBAL_EMAIL;            // perfil tenía email → gana
      const localKept = w2.date_of_birth === '2000-01-01';   // perfil DOB null → se conserva local
      if (linked && globalWon && localKept) ok('Claim: vinculó + copió identidad global (email gana) y conservó local-only (DOB)');
      else ko(`Claim inconsistente: linked=${linked} globalWon=${globalWon} localKept=${localKept} (${JSON.stringify(w2)})`);
    }
  }

  // 5. Paciente NO vinculado → identidad editable por el médico
  {
    const { data: u, error: uErr } = await admin.from('patients').insert({
      clinic_id: CAMILO_CLINIC, profile_id: null, full_name: 'NoVinculado',
      document_type: 'dui', date_of_birth: '1990-01-01', gender: 'femenino',
      patient_type: 'privado', phone: '50370000777', is_active: true,
    }).select('id').single();
    if (uErr) throw new Error('insert U falló: ' + uErr.message);
    uId = u.id;
    const { error } = await camilo.from('patients').update({ full_name: 'Editado OK' }).eq('id', uId);
    const { data: a } = await admin.from('patients').select('full_name').eq('id', uId).single();
    if (!error && a.full_name === 'Editado OK') ok('Paciente NO vinculado → identidad editable por el médico (sin guard)');
    else ko('No vinculado debería ser editable: ' + (error?.message || a?.full_name));
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    if (wId) await admin.from('patients').delete().eq('id', wId);
    if (uId) await admin.from('patients').delete().eq('id', uId);
    if (plId) await admin.from('patients').delete().eq('id', plId);
    // Restaurar identidad del perfil vía SESIÓN del paciente (auth.uid para audit)
    if (ppId && ppOrig) await patient.from('profiles').update(ppOrig).eq('id', ppId);
    await camilo.auth.signOut().catch(() => {});
    await patient.auth.signOut().catch(() => {});
    console.log('  ✅ cleanup OK (perfil del paciente restaurado)');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_33 OK' : '❌ SMOKE s7_33 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
