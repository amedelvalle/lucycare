/**
 * SMOKE s7_63 — PR A / F1-c: el approve escribe la credencial JVPM
 *               directamente (convivencia con el trigger, sin duplicados,
 *               sin cambio observable).
 *
 * Corre con la SESIÓN del ADMIN de plataforma (test phone 50378056365) para
 * las RPCs (gate is_admin). Usa service_role SOLO para fixtures/cleanup
 * (⚠ requiere autorización del owner para ejecutarse). Fixtures propias,
 * marcadas F63_FIXTURE, teléfonos/licencias imposibles; cleanup con
 * verificación de 0 residuales OPERATIVOS por ID exacto + complementaria por
 * clave natural (teléfono/licencia). audit_log NO se toca (append-only).
 * JAMÁS Katherine; Camilo NO se usa en este smoke.
 *
 * Cubre (requisitos del owner para PR A):
 *   T1  rama new → médico creado correctamente (flags, lead vinculado,
 *       columna license_number todavía escrita — PR A no la retira).
 *   T2  EXACTAMENTE UNA credencial JVPM (pending, valor del lead) →
 *       convivencia trigger + escritura directa SIN duplicados.
 *   T3  duplicado antifraude: segundo lead con la MISMA licencia → P0091.
 *   T4  idempotencia del trigger intacta: re-escribir la MISMA licencia no
 *       genera churn ni audit; CAMBIARLA actualiza la credencial a pending.
 *   T5  gate sin regresión: lead no-approved → P0002.
 *   T6  rama reuse_patient: sin confirm → P0013; con confirm → médico sobre
 *       el profile existente + UNA credencial JVPM correcta.
 *
 * El A/B "sin trigger" (autosuficiencia real de la escritura directa) NO se
 * puede hacer desde supabase-js (exige DISABLE TRIGGER): vive en el bloque
 * A/B del owner en el SQL Editor (Corrida A RPC vieja = 0 credenciales /
 * Corrida B s7_63 = 1) — ejecutado y verificado el 2026-07-18.
 *
 * Uso (SOLO después de aplicar s7_63): node scripts/_smoke-s7_63.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const ADMIN_PHONE = '50378056365';
const OTP = '123456';

// Fixtures F63 (teléfonos improbables, licencias imposibles; se limpian).
const P_NEW   = '50370006301';
const P_REUSE = '50370006302';
const P_DUP   = '50370006303';
const P_PEND  = '50370006304';
const L_A = 'F63TESTA01';   // licencia del médico new (y del duplicado T3)
const L_B = 'F63TESTB02';   // licencia del reuse
const L_C = 'F63TESTC03';   // licencia del lead pending (nunca se crea)
const L_D = 'F63TESTD04';   // licencia nueva del cambio en T4b
const FIXTURE_PHONES = [P_NEW, P_REUSE, P_DUP, P_PEND];
const FIXTURE_LICENSES = [L_A, L_B, L_C, L_D];

const adminCli = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

// Tracking para cleanup (por ID exacto).
const leadIds = [];
const doctorIds = [];
const clinicIds = [];
const authUserIds = [];

async function login(client, phone) {
  await client.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await client.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error(`OTP ${phone} falló: ${error?.message || 'sin sesión'}`);
  return data.user.id;
}

async function makeLead(phoneNorm, license, status = 'approved') {
  const { data, error } = await admin.from('doctor_affiliation_requests').insert({
    full_name: 'F63_FIXTURE Lead ' + phoneNorm.slice(-4),
    phone: phoneNorm,
    phone_normalized: phoneNorm,
    email: null,
    license_number: license,
    status,
    consent_accepted_at: new Date().toISOString(),
    consent_version: 'f63-smoke',
  }).select('id').single();
  if (error) throw new Error('insert lead falló: ' + error.message);
  leadIds.push(data.id);
  return data.id;
}

const create = (reqId, overrides = {}) =>
  adminCli.rpc('admin_approve_and_create_doctor', { p_request_id: reqId, p_overrides: overrides });

const credsOf = (doctorId) =>
  admin.from('doctor_credentials')
    .select('id, type, value, status, updated_at')
    .eq('doctor_id', doctorId);

console.log('═══ SMOKE s7_63 (approve escribe la credencial — PR A / F1-c) ═══\n');

try {
  await login(adminCli, ADMIN_PHONE);

  let newDoctorId = null;
  let credId = null;

  // ─── T1. rama new: médico creado correctamente ───
  {
    const reqId = await makeLead(P_NEW, L_A);
    const { data, error } = await create(reqId, {});
    if (error) {
      ko('T1 create new error: ' + (error.code || '') + ' ' + error.message);
    } else if (data?.success && data.reused_existing_user === false) {
      newDoctorId = data.doctor_id;
      doctorIds.push(data.doctor_id); clinicIds.push(data.clinic_id); authUserIds.push(data.profile_id);
      ok('T1a NEW → crea doctor (reused=false)');

      const { data: doc } = await admin.from('doctors')
        .select('lucy_status, is_published, is_operational, booking_enabled, is_verified, license_number')
        .eq('id', data.doctor_id).single();
      if (doc && doc.lucy_status === 'listed_only' && !doc.is_published && !doc.is_operational
          && !doc.booking_enabled && !doc.is_verified)
        ok('T1b doctor listed_only + flags conservadores (sin cambio observable)');
      else ko('T1b doctor flags inesperados: ' + JSON.stringify(doc));

      // PR A NO retira la columna: se sigue escribiendo (la retira PR B).
      if (doc?.license_number === L_A) ok('T1c doctors.license_number todavía se escribe (= ' + L_A + ')');
      else ko('T1c columna license_number inesperada: ' + JSON.stringify(doc?.license_number));

      const { data: lead } = await admin.from('doctor_affiliation_requests')
        .select('doctor_id, clinic_id').eq('id', reqId).single();
      if (lead?.doctor_id === data.doctor_id && lead?.clinic_id === data.clinic_id)
        ok('T1d lead vinculado (doctor_id + clinic_id)');
      else ko('T1d lead sin vincular: ' + JSON.stringify(lead));
    } else {
      ko('T1 resultado inesperado: ' + JSON.stringify(data));
    }
  }

  // ─── T2. EXACTAMENTE una credencial JVPM, sin duplicados ───
  if (newDoctorId) {
    const { data: creds, error } = await credsOf(newDoctorId);
    if (error) ko('T2 no se pudieron leer credenciales: ' + error.message);
    else if (creds.length === 1 && creds[0].type === 'JVPM'
             && creds[0].status === 'pending' && creds[0].value === L_A) {
      credId = creds[0].id;
      ok('T2 EXACTAMENTE 1 credencial JVPM pending con el valor del lead (trigger + directa conviven sin duplicar)');
    } else {
      ko(`T2 credenciales inesperadas (count=${creds.length}): ` +
         JSON.stringify(creds.map(c => ({ type: c.type, status: c.status, value: c.value }))));
    }
  }

  // ─── T3. duplicado antifraude → P0091 ───
  {
    const reqId = await makeLead(P_DUP, L_A);
    const { error } = await create(reqId, {});
    if (error?.code === 'P0091') ok('T3 segundo lead con la MISMA licencia → P0091 (antifraude intacto)');
    else ko('T3 esperado P0091: ' + JSON.stringify({ code: error?.code, msg: error?.message }));
  }

  // ─── T4. idempotencia del trigger intacta ───
  if (newDoctorId && credId) {
    const before = await credsOf(newDoctorId);
    const updatedAtBefore = before.data?.[0]?.updated_at;
    const { count: auditBefore } = await admin.from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('table_name', 'doctor_credentials').eq('record_id', credId);

    // T4a: re-escribir la MISMA licencia → sin churn ni audit.
    const { error: upErr } = await admin.from('doctors')
      .update({ license_number: L_A }).eq('id', newDoctorId);
    if (upErr) ko('T4a UPDATE misma licencia falló: ' + upErr.message);
    else {
      const after = await credsOf(newDoctorId);
      const { count: auditAfter } = await admin.from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('table_name', 'doctor_credentials').eq('record_id', credId);
      if (after.data?.[0]?.updated_at === updatedAtBefore && auditAfter === auditBefore)
        ok('T4a misma licencia → sin churn (updated_at) ni fila de audit (F3 de s7_61 preservado)');
      else ko(`T4a churn inesperado: updated_at ${updatedAtBefore} → ${after.data?.[0]?.updated_at}, audit ${auditBefore} → ${auditAfter}`);
    }

    // T4b: CAMBIAR la licencia → credencial actualizada + reset a pending.
    const { error: upErr2 } = await admin.from('doctors')
      .update({ license_number: L_D }).eq('id', newDoctorId);
    if (upErr2) ko('T4b UPDATE licencia nueva falló: ' + upErr2.message);
    else {
      const { data: after2 } = await credsOf(newDoctorId);
      if (after2?.length === 1 && after2[0].value === L_D && after2[0].status === 'pending')
        ok('T4b cambio de licencia → credencial actualizada a pending (F11 de s7_61 preservado), sigue siendo UNA');
      else ko('T4b credencial inesperada tras cambio: ' + JSON.stringify(after2));
    }
  }

  // ─── T5. gate P0002 sin regresión ───
  {
    const reqId = await makeLead(P_PEND, L_C, 'pending');
    const { error } = await create(reqId, {});
    if (error?.code === 'P0002') ok('T5 lead no-approved → P0002 (gate intacto)');
    else ko('T5 esperado P0002: ' + JSON.stringify({ code: error?.code, msg: error?.message }));
  }

  // ─── T6. rama reuse_patient ───
  {
    const { data: cu, error: cuErr } = await admin.auth.admin.createUser({
      phone: '+' + P_REUSE, phone_confirm: true,
    });
    if (cuErr || !cu?.user) throw new Error('createUser reuse falló: ' + (cuErr?.message || 'sin user'));
    const reuseUserId = cu.user.id;
    authUserIds.push(reuseUserId); // registrado ANTES de usarlo (regla de cleanup)

    const { data: prof } = await admin.from('profiles').select('role').eq('id', reuseUserId).maybeSingle();
    if (prof?.role === 'patient') ok('T6a throwaway patient con profile listo');
    else ko('T6a throwaway sin profile patient: ' + JSON.stringify(prof));

    const reqId = await makeLead(P_REUSE, L_B);

    const { error: e13 } = await create(reqId, {});
    if (e13?.code === 'P0013') ok('T6b reuse sin confirm → P0013 (gate intacto)');
    else ko('T6b esperado P0013: ' + JSON.stringify({ code: e13?.code, msg: e13?.message }));

    const { data, error } = await create(reqId, { confirm_reuse: 'true' });
    if (error) ko('T6c create reuse error: ' + (error.code || '') + ' ' + error.message);
    else if (data?.success && data.reused_existing_user === true && data.profile_id === reuseUserId) {
      doctorIds.push(data.doctor_id); clinicIds.push(data.clinic_id);
      ok('T6c REUSE → doctor sobre el profile existente (sin nuevo auth.user)');

      const { data: creds } = await credsOf(data.doctor_id);
      if (creds?.length === 1 && creds[0].type === 'JVPM'
          && creds[0].status === 'pending' && creds[0].value === L_B)
        ok('T6d reuse → EXACTAMENTE 1 credencial JVPM pending con el valor del lead');
      else ko(`T6d credenciales reuse inesperadas: ` + JSON.stringify(creds));
    } else {
      ko('T6c resultado reuse inesperado: ' + JSON.stringify(data));
    }
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup (errores NO silenciados) —');
  const cleanupErrors = [];
  const del = async (label, q) => {
    const { error } = await q;
    if (error) cleanupErrors.push(`${label}: ${error.message}`);
  };

  // Orden: doctors (cascade → doctor_credentials) → members → clinics →
  // leads → profiles → auth.users.
  for (const id of doctorIds) await del(`doctors ${id}`, admin.from('doctors').delete().eq('id', id));
  for (const id of clinicIds) {
    await del(`clinic_members ${id}`, admin.from('clinic_members').delete().eq('clinic_id', id));
    await del(`clinics ${id}`, admin.from('clinics').delete().eq('id', id));
  }
  for (const id of leadIds) await del(`leads ${id}`, admin.from('doctor_affiliation_requests').delete().eq('id', id));
  for (const id of authUserIds) {
    await del(`profiles ${id}`, admin.from('profiles').delete().eq('id', id));
    const { error } = await admin.auth.admin.deleteUser(id);
    // Distinguir "no existe" (ya limpio) de un fallo real.
    if (error && !/not.*found/i.test(error.message)) cleanupErrors.push(`auth.user ${id}: ${error.message}`);
  }

  if (cleanupErrors.length) { for (const m of cleanupErrors) ko('cleanup: ' + m); }
  else ok('cleanup ejecutado sin errores');

  // ── Verificación de 0 residuales OPERATIVOS ──
  // (a) por ID exacto:
  const residual = async (label, q) => {
    const { data, error } = await q;
    if (error) ko(`residual ${label}: no se pudo verificar (${error.message})`);
    else if ((data?.length ?? 0) === 0) ok(`0 residuales en ${label} (por ID)`);
    else ko(`RESIDUALES en ${label}: ` + JSON.stringify(data));
  };
  if (doctorIds.length) {
    await residual('doctors', admin.from('doctors').select('id').in('id', doctorIds));
    await residual('doctor_credentials', admin.from('doctor_credentials').select('id').in('doctor_id', doctorIds));
  }
  if (clinicIds.length) await residual('clinics', admin.from('clinics').select('id').in('id', clinicIds));
  if (leadIds.length) await residual('leads', admin.from('doctor_affiliation_requests').select('id').in('id', leadIds));
  if (authUserIds.length) await residual('profiles', admin.from('profiles').select('id').in('id', authUserIds));

  // (b) complementaria por clave natural (caza recursos fuera del registro):
  await residual('leads por teléfono', admin.from('doctor_affiliation_requests').select('id').in('phone_normalized', FIXTURE_PHONES));
  await residual('profiles por teléfono', admin.from('profiles').select('id').in('phone', FIXTURE_PHONES));
  await residual('credenciales por valor', admin.from('doctor_credentials').select('id').in('value', FIXTURE_LICENSES));
  await residual('doctors por licencia', admin.from('doctors').select('id').in('license_number', FIXTURE_LICENSES));

  await adminCli.auth.signOut().catch(() => {});
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_63 OK' : '❌ SMOKE s7_63 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
