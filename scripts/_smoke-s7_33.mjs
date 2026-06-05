/**
 * SMOKE s7_33 (Paciente Global F3.1) — sync espejo + guard de identidad.
 *
 * Cubre:
 *  1. Médico (Camilo OTP) NO puede editar identidad de paciente vinculado → P0030.
 *  2. Médico SÍ puede editar campos locales (alergias).
 *  3. Update de profiles → se refleja en patients vinculadas (sync ongoing).
 *  4. claim_patient_records copia identidad global (global gana; local-only se
 *     conserva).
 *  5. Paciente NO vinculado → identidad editable como hoy.
 *
 * Fixtures aisladas + cleanup en finally. Usa un usuario throwaway (creado/
 * borrado) para guard+sync, y el test phone de paciente 50375000001 para claim
 * (captura y restaura su identidad de perfil).
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
const TU_PHONE = '5039' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');

// Clientes auth independientes (no compartir sesión entre médico y paciente)
const camilo = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const patient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

let tuId = null, plId = null, uId = null, wId = null, ppId = null, ppOrig = null;

async function login(client, phone) {
  await client.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await client.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error(`OTP ${phone} falló: ${error?.message || 'sin sesión'}`);
  return data.user.id;
}

console.log('═══ SMOKE s7_33 (sync espejo + guard) ═══\n');

try {
  // ── Fixtures: usuario throwaway + paciente vinculado (PL) en clínica Camilo ──
  const { data: created, error: cuErr } = await admin.auth.admin.createUser({ phone: TU_PHONE, phone_confirm: true });
  if (cuErr || !created?.user) throw new Error('createUser throwaway falló: ' + cuErr?.message);
  tuId = created.user.id;
  await admin.from('profiles').update({ full_name: 'Espejo Uno', role: 'patient' }).eq('id', tuId);

  const { data: pl, error: plErr } = await admin.from('patients').insert({
    clinic_id: CAMILO_CLINIC, profile_id: tuId, full_name: 'Espejo Uno',
    document_type: 'dui', document_number: '11111111-1', date_of_birth: '1985-01-01',
    gender: 'masculino', patient_type: 'privado', phone: TU_PHONE, is_active: true,
  }).select('id').single();
  if (plErr) throw new Error('insert PL falló: ' + plErr.message);
  plId = pl.id;
  ok('Fixtures: throwaway profile + paciente vinculado (PL) en clínica Camilo');

  // Sesión médico
  await login(camilo, CAMILO_PHONE);

  // 1. Médico NO puede editar identidad de PL (vinculado)
  {
    const { error } = await camilo.from('patients').update({ full_name: 'Hackeado' }).eq('id', plId);
    const { data: after } = await admin.from('patients').select('full_name').eq('id', plId).single();
    if (error && after.full_name === 'Espejo Uno') ok(`Médico NO pudo editar identidad de paciente vinculado → ${(error.code || '') + ' ' + error.message.slice(0, 60)}`);
    else if (!error) ko('⚠ Médico EDITÓ identidad de paciente vinculado (guard no bloqueó)');
    else ko('Identidad no cambió pero sin error esperado: ' + error.message);
  }

  // 2. Médico SÍ puede editar campos locales
  {
    const { error } = await camilo.from('patients').update({ allergies: 'Polen' }).eq('id', plId);
    const { data: after } = await admin.from('patients').select('allergies').eq('id', plId).single();
    if (!error && after.allergies === 'Polen') ok('Médico SÍ puede editar campos locales (alergias)');
    else ko('Edición de campo local falló: ' + (error?.message || after?.allergies));
  }

  // 3. Sync ongoing: update profiles → patients vinculadas reflejan
  {
    await admin.from('profiles').update({ full_name: 'Espejo Editado' }).eq('id', tuId);
    const { data: after } = await admin.from('patients').select('full_name').eq('id', plId).single();
    if (after.full_name === 'Espejo Editado') ok('Sync ongoing: cambio en profiles se reflejó en patients vinculada');
    else ko('Sync ongoing NO reflejó el cambio (full_name=' + after.full_name + ')');
  }

  // 4. Claim copia identidad global (global gana; local-only se conserva)
  {
    ppId = await login(patient, PATIENT_PHONE);
    const { data: orig } = await admin.from('profiles').select('full_name, document_type, document_number, date_of_birth, gender').eq('id', ppId).single();
    ppOrig = orig;
    // Damos al perfil un document_number para que el claim lo copie (global gana)
    await admin.from('profiles').update({ document_type: 'dui', document_number: '99999999-9' }).eq('id', ppId);
    // Walk-in nuevo (profile_id null) con phone del paciente y DOB local propio
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
      const { data: w2 } = await admin.from('patients').select('profile_id, document_number, date_of_birth').eq('id', wId).single();
      const linked = w2.profile_id === ppId;
      const globalWon = w2.document_number === '99999999-9';      // global tenía valor → gana
      const localKept = w2.date_of_birth === '2000-01-01';        // global null en DOB → se conserva local
      if (linked && globalWon && localKept) ok('Claim: vinculó + copió identidad global (gana) y conservó local-only (DOB)');
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
    const { data: after } = await admin.from('patients').select('full_name').eq('id', uId).single();
    if (!error && after.full_name === 'Editado OK') ok('Paciente NO vinculado → identidad editable por el médico (sin guard)');
    else ko('No vinculado debería ser editable: ' + (error?.message || after?.full_name));
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    if (wId) await admin.from('patients').delete().eq('id', wId);
    if (uId) await admin.from('patients').delete().eq('id', uId);
    if (plId) await admin.from('patients').delete().eq('id', plId);
    if (ppId && ppOrig) await admin.from('profiles').update(ppOrig).eq('id', ppId); // restaura identidad (re-sincroniza precargados)
    if (tuId) await admin.auth.admin.deleteUser(tuId).catch(() => {});
    await camilo.auth.signOut().catch(() => {});
    await patient.auth.signOut().catch(() => {});
    console.log('  ✅ cleanup OK');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_33 OK' : '❌ SMOKE s7_33 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
