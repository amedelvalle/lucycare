/**
 * SMOKE s7_42 — Afiliación: crear médico cuando el teléfono ya pertenece a un
 * paciente existente.
 *
 * Corre con la SESIÓN del ADMIN de plataforma (test phone 50378056365) para las
 * RPCs (gate is_admin). Usa service_role para fixtures/cleanup. Crea TODO
 * aislado y lo limpia en finally (cleanup obligatorio — sin datos basura, y
 * SIN tocar cuentas reales como Camilo).
 *
 * Cubre:
 *  1. NEW   → lead con teléfono nuevo → crea, reused_existing_user=false.
 *  2. REUSE → lead con teléfono de un paciente existente (throwaway):
 *       2a. sin confirm → P0013 (requiere confirmación).
 *       2b. preflight → 'reuse_patient' + existing_user_id correcto.
 *       2c. con confirm → crea, reused=true; ASSERTS de seguridad:
 *           - profile_id == el del paciente existente (NO nuevo auth.user);
 *           - profiles.role sigue 'patient';
 *           - doctor: lucy_status='listed_only', is_published/is_operational/
 *             booking_enabled=false, is_verified=false;
 *           - audit_log con reused_existing_user=true.
 *  3. BLOCK → lead con teléfono de Camilo (ya médico) → preflight 'block_doctor'
 *     (+ existing_doctor_id) y create → P0010.
 *
 * Uso (SOLO después de aplicar s7_42): node scripts/_smoke-s7_42.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const ADMIN_PHONE = '50378056365';
const OTP = '123456';
const CAMILO_PHONE_NORM = '50378627694';
const CAMILO_DOCTOR = '783a902a-55fd-407c-9e0a-69568135c7f5';

// Fixtures (teléfonos improbables; se limpian).
const P_NEW = '50370007802';
const P_REUSE = '50370007801';

const adminCli = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

// Tracking para cleanup
const leadIds = [];
const doctorIds = [];
const clinicIds = [];
const authUserIds = []; // auth.users a borrar (throwaway reuse + el creado por NEW)

async function login(client, phone) {
  await client.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await client.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error(`OTP ${phone} falló: ${error?.message || 'sin sesión'}`);
  return data.user.id;
}

async function makeLead(phoneNorm) {
  const { data, error } = await admin.from('doctor_affiliation_requests').insert({
    full_name: 'S742 Lead ' + phoneNorm.slice(-4),
    phone: phoneNorm,
    phone_normalized: phoneNorm,
    email: null,
    status: 'approved',
    consent_accepted_at: new Date().toISOString(),
    consent_version: 'smoke',
  }).select('id').single();
  if (error) throw new Error('insert lead falló: ' + error.message);
  leadIds.push(data.id);
  return data.id;
}

const preflight = (reqId) => adminCli.rpc('admin_affiliation_preflight', { p_request_id: reqId });
const create = (reqId, overrides = {}) =>
  adminCli.rpc('admin_approve_and_create_doctor', { p_request_id: reqId, p_overrides: overrides });

console.log('═══ SMOKE s7_42 (afiliación: médico desde paciente existente) ═══\n');

try {
  await login(adminCli, ADMIN_PHONE);

  // ─── 1. NEW ───
  {
    const reqId = await makeLead(P_NEW);
    const { data: pf } = await preflight(reqId);
    if (pf?.classification === 'new') ok('1a preflight → new');
    else ko('1a preflight esperado new: ' + JSON.stringify(pf));

    const { data, error } = await create(reqId, {});
    if (error) ko('1b create new error: ' + (error.code || '') + ' ' + error.message);
    else if (data?.success && data.reused_existing_user === false) {
      doctorIds.push(data.doctor_id); clinicIds.push(data.clinic_id); authUserIds.push(data.profile_id);
      ok('1b NEW → crea doctor (reused=false)');
    } else ko('1b create new resultado inesperado: ' + JSON.stringify(data));
  }

  // ─── 2. REUSE ───
  // Paciente throwaway: createUser (trigger handle_new_user crea profile patient).
  let reuseUserId = null;
  {
    const { data: cu, error: cuErr } = await admin.auth.admin.createUser({
      phone: '+' + P_REUSE, phone_confirm: true,
    });
    if (cuErr || !cu?.user) throw new Error('createUser reuse falló: ' + (cuErr?.message || 'sin user'));
    reuseUserId = cu.user.id;
    authUserIds.push(reuseUserId);

    // Verificar que el profile existe y es patient.
    const { data: prof } = await admin.from('profiles').select('role').eq('id', reuseUserId).maybeSingle();
    if (!prof) ko('2.pre: el throwaway no tiene profile (trigger handle_new_user) — reuse no aplicaría');
    else if (prof.role === 'patient') ok('2.pre throwaway patient con profile listo');
    else ko('2.pre throwaway role inesperado: ' + prof.role);

    const reqId = await makeLead(P_REUSE);

    // 2b preflight → reuse_patient + existing_user_id correcto
    const { data: pf } = await preflight(reqId);
    if (pf?.classification === 'reuse_patient' && pf?.existing_user_id === reuseUserId)
      ok('2b preflight → reuse_patient + existing_user_id correcto');
    else ko('2b preflight reuse esperado: ' + JSON.stringify(pf));

    // 2a sin confirm → P0013
    {
      const { error } = await create(reqId, {});
      if (error && error.code === 'P0013') ok('2a sin confirm → P0013 (requiere confirmación)');
      else ko('2a esperado P0013: ' + JSON.stringify(error));
    }

    // 2c con confirm → crea reused=true + asserts
    {
      const { data, error } = await create(reqId, { confirm_reuse: 'true' });
      if (error) { ko('2c create reuse error: ' + (error.code || '') + ' ' + error.message); }
      else if (data?.success && data.reused_existing_user === true) {
        doctorIds.push(data.doctor_id); clinicIds.push(data.clinic_id);
        // profile_id == paciente existente (NO nuevo auth.user)
        if (data.profile_id === reuseUserId) ok('2c reuse → profile_id == paciente existente (sin nuevo auth.user)');
        else ko('2c reuse profile_id NO coincide con el paciente: ' + data.profile_id);

        // role sigue patient
        const { data: prof2 } = await admin.from('profiles').select('role').eq('id', reuseUserId).single();
        if (prof2?.role === 'patient') ok('2c reuse → profiles.role sigue patient'); else ko('2c role cambió: ' + JSON.stringify(prof2));

        // doctor flags
        const { data: doc } = await admin.from('doctors')
          .select('lucy_status, is_published, is_operational, booking_enabled, is_verified')
          .eq('id', data.doctor_id).single();
        if (doc && doc.lucy_status === 'listed_only' && !doc.is_published && !doc.is_operational && !doc.booking_enabled && !doc.is_verified)
          ok('2c reuse → doctor listed_only + flags false (+ is_verified false)');
        else ko('2c doctor flags inesperados: ' + JSON.stringify(doc));

        // audit reused_existing_user=true
        const { data: aud } = await admin.from('audit_log')
          .select('new_data').eq('table_name', 'doctors').eq('record_id', data.doctor_id)
          .order('created_at', { ascending: false }).limit(1);
        const reused = aud?.[0]?.new_data?.reused_existing_user;
        if (reused === true) ok('2c reuse → audit_log reused_existing_user=true'); else ko('2c audit reused inesperado: ' + JSON.stringify(aud?.[0]?.new_data));
      } else ko('2c create reuse resultado inesperado: ' + JSON.stringify(data));
    }
  }

  // ─── 3. BLOCK (médico existente: Camilo) ───
  {
    const reqId = await makeLead(CAMILO_PHONE_NORM);
    const { data: pf } = await preflight(reqId);
    if (pf?.classification === 'block_doctor' && pf?.existing_doctor_id === CAMILO_DOCTOR)
      ok('3a preflight → block_doctor + existing_doctor_id == Camilo');
    else ko('3a preflight block esperado: ' + JSON.stringify(pf));

    const { error } = await create(reqId, {});
    if (error && error.code === 'P0010') ok('3b create → P0010 (médico ya existe)');
    else ko('3b esperado P0010: ' + JSON.stringify(error));
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    for (const id of doctorIds) await admin.from('doctors').delete().eq('id', id);
    for (const id of clinicIds) {
      await admin.from('clinic_members').delete().eq('clinic_id', id);
      await admin.from('clinics').delete().eq('id', id);
    }
    for (const id of leadIds) await admin.from('doctor_affiliation_requests').delete().eq('id', id);
    for (const id of authUserIds) {
      await admin.from('profiles').delete().eq('id', id).then(() => {}, () => {});
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    console.log('  ✅ cleanup OK');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
  }
  await adminCli.auth.signOut().catch(() => {});
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_42 OK' : '❌ SMOKE s7_42 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
