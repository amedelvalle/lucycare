/**
 * SMOKE s7_49 — F4-3b V1: bandeja de vínculos rechazados.
 *
 * Sesión del admin de plataforma (50378056365 / OTP 123456) para las RPCs
 * gated por is_admin(); service_role para fixtures/cleanup. TODO aislado en un
 * mundo throwaway (profile/clínica/ficha + 1 fila patient_link_rejections),
 * marcado `F49_FIXTURE`; cleanup en finally + 0 residuales. Nunca toca
 * pacientes reales, ni Camilo, ni Katherine (50372608827).
 *
 * Cubre:
 *  S1. list pending_review devuelve la fila con metadatos (sin contenido clínico).
 *  S2. resolver con motivo < 10 → P0081.
 *  S3. resolver OK: status=resolved, resolved_by/at, resolution_note; audit
 *      `admin_resolve_link_rejection`; la FICHA NO se toca (bookkeeping).
 *  S4. reabrir OK: status=pending_review, resolved_* y note limpiados; audit
 *      `admin_reopen_link_rejection` con old_data conservando el note previo.
 *  S5. resolver rechazo inexistente → P0080.
 *
 * Uso (SOLO tras aplicar s7_49): node scripts/_smoke-s7_49.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const ADMIN_PHONE = '50378056365';
const OTP = '123456';
const MARK = 'F49_FIXTURE';
const CLINIC_NAME = `${MARK} Clínica de prueba`;
const FAKE_PHONE = '50390000749';
const BOGUS_REJ = '00000000-0000-0000-0000-0000f4900080';

const mk = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const login = async (cli, phone) => {
  await cli.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await cli.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error('OTP ' + phone + ': ' + (error?.message || 'sin sesión'));
  return data.user.id;
};

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

const adminCli = mk();
const created = { rejections: [], patients: [], clinicId: null, authUser: null };

console.log('═══ SMOKE s7_49 (bandeja de vínculos rechazados) ═══\n');

let adminUid, PROFILE, CLINIC, PATIENT, REJ;

try {
  adminUid = await login(adminCli, ADMIN_PHONE);
  {
    const { data: prof } = await admin.from('profiles').select('role').eq('id', adminUid).single();
    if (prof?.role !== 'admin') throw new Error('La cuenta ' + ADMIN_PHONE + ' no es admin (role=' + prof?.role + ')');
  }

  // ── Mundo throwaway: profile (rechazó) + clínica + ficha desvinculada + rechazo ──
  {
    const { data: cu, error } = await admin.auth.admin.createUser({ phone: FAKE_PHONE, phone_confirm: true });
    if (error) throw new Error('createUser: ' + error.message);
    PROFILE = cu.user.id; created.authUser = PROFILE;
    const { data: clinic, error: ce } = await admin.from('clinics').insert({ name: CLINIC_NAME, owner_id: PROFILE }).select('id').single();
    if (ce) throw new Error('clinic: ' + ce.message);
    CLINIC = clinic.id; created.clinicId = CLINIC;
    // Ficha desvinculada (como queda tras un reject real): profile_id NULL.
    const { data: pat, error: pe } = await admin.from('patients').insert({
      clinic_id: CLINIC, profile_id: null, full_name: `${MARK} Ficha rechazada`,
      document_type: 'dui', patient_type: 'privado', phone: FAKE_PHONE, is_active: true, notes: MARK,
    }).select('id, profile_id, is_active').single();
    if (pe) throw new Error('patient: ' + pe.message);
    PATIENT = pat.id; created.patients.push(PATIENT);
    const { data: rej, error: re } = await admin.from('patient_link_rejections').insert({
      patient_id: PATIENT, profile_id: PROFILE, phone_normalized: FAKE_PHONE, status: 'pending_review',
    }).select('id').single();
    if (re) throw new Error('rejection: ' + re.message);
    REJ = rej.id; created.rejections.push(REJ);
  }

  // ════ S1. list pending_review ════
  {
    const { data, error } = await adminCli.rpc('admin_list_patient_link_rejections', { p_status: 'pending_review' });
    if (error) ko('S1 list error: ' + error.message);
    else {
      const rows = Array.isArray(data) ? data : [];
      const row = rows.find((x) => x.id === REJ);
      if (row && row.status === 'pending_review'
          && row.patient?.full_name === `${MARK} Ficha rechazada`
          && row.patient?.clinic_name === CLINIC_NAME
          && row.phone_normalized === FAKE_PHONE
          && row.patient?.profile_id === null)
        ok('S1 list devuelve la fila pending con metadatos (ficha/clínica/teléfono, sin contenido clínico)');
      else ko('S1 list inesperado: ' + JSON.stringify(row ?? rows.length));
    }
  }

  // ════ S2. resolver con motivo < 10 → P0081 ════
  {
    const { error } = await adminCli.rpc('admin_resolve_link_rejection', { p_rejection_id: REJ, p_resolution_note: 'corto', p_reopen: false });
    if (error?.code === 'P0081') ok('S2 motivo < 10 → P0081');
    else ko('S2 esperado P0081: ' + JSON.stringify({ code: error?.code, msg: error?.message }));
  }

  // ════ S3. resolver OK + audit + ficha intacta ════
  {
    const { data, error } = await adminCli.rpc('admin_resolve_link_rejection', {
      p_rejection_id: REJ, p_resolution_note: 'Revisado: rechazo correcto, ficha queda desvinculada', p_reopen: false,
    });
    if (error) ko('S3 resolve error: ' + error.message);
    else {
      if (data?.status === 'resolved') ok('S3 resolve devuelve status=resolved');
      else ko('S3 resolve status inesperado: ' + JSON.stringify(data));

      const { data: row } = await admin.from('patient_link_rejections')
        .select('status, resolved_by, resolved_at, resolution_note').eq('id', REJ).single();
      if (row && row.status === 'resolved' && row.resolved_by === adminUid && row.resolved_at && (row.resolution_note || '').length >= 10)
        ok('S3 fila resuelta (status/resolved_by/resolved_at/resolution_note)');
      else ko('S3 fila no resuelta: ' + JSON.stringify(row));

      // La FICHA no se toca (no re-vincula, no fusiona).
      const { data: pat } = await admin.from('patients').select('profile_id, is_active, merged_into_patient_id').eq('id', PATIENT).single();
      if (pat && pat.profile_id === null && pat.is_active === true && pat.merged_into_patient_id === null)
        ok('S3 la ficha NO se tocó (sigue desvinculada/activa, sin merge)');
      else ko('S3 la ficha cambió: ' + JSON.stringify(pat));

      const { data: aud } = await admin.from('audit_log').select('new_data')
        .eq('table_name', 'patient_link_rejections').eq('record_id', REJ)
        .order('created_at', { ascending: false }).limit(5);
      if ((aud ?? []).some((a) => a.new_data?.edited_via === 'admin_resolve_link_rejection'))
        ok('S3 audit edited_via=admin_resolve_link_rejection');
      else ko('S3 audit resolve ausente: ' + JSON.stringify((aud ?? []).map((a) => a.new_data?.edited_via)));
    }
  }

  // ════ S4. reabrir OK + audit conserva el note previo ════
  {
    const { data, error } = await adminCli.rpc('admin_resolve_link_rejection', { p_rejection_id: REJ, p_resolution_note: '', p_reopen: true });
    if (error) ko('S4 reopen error: ' + error.message);
    else {
      if (data?.status === 'pending_review') ok('S4 reopen devuelve status=pending_review');
      else ko('S4 reopen status inesperado: ' + JSON.stringify(data));

      const { data: row } = await admin.from('patient_link_rejections')
        .select('status, resolved_by, resolved_at, resolution_note').eq('id', REJ).single();
      if (row && row.status === 'pending_review' && row.resolved_by === null && row.resolved_at === null && row.resolution_note === null)
        ok('S4 fila reabierta (pending_review, resolved_*/note limpiados)');
      else ko('S4 fila no reabierta: ' + JSON.stringify(row));

      const { data: aud } = await admin.from('audit_log').select('old_data, new_data')
        .eq('table_name', 'patient_link_rejections').eq('record_id', REJ)
        .order('created_at', { ascending: false }).limit(3);
      const reopenRow = (aud ?? []).find((a) => a.new_data?.edited_via === 'admin_reopen_link_rejection');
      if (reopenRow && (reopenRow.old_data?.resolution_note || '').length >= 10)
        ok('S4 audit reopen conserva el resolution_note previo en old_data');
      else ko('S4 audit reopen sin estado previo: ' + JSON.stringify(reopenRow));
    }
  }

  // ════ S5. resolver rechazo inexistente → P0080 ════
  {
    const { error } = await adminCli.rpc('admin_resolve_link_rejection', { p_rejection_id: BOGUS_REJ, p_resolution_note: 'motivo suficientemente largo', p_reopen: false });
    if (error?.code === 'P0080') ok('S5 rechazo inexistente → P0080');
    else ko('S5 esperado P0080: ' + JSON.stringify({ code: error?.code, msg: error?.message }));
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    for (const id of created.rejections) await admin.from('patient_link_rejections').delete().eq('id', id);
    for (const id of created.patients) await admin.from('patients').delete().eq('id', id);
    if (created.clinicId) await admin.from('clinics').delete().eq('id', created.clinicId);
    if (created.authUser) await admin.auth.admin.deleteUser(created.authUser).catch(() => {});
    await adminCli.auth.signOut().catch(() => {});

    const r = {};
    r.rejections = (await admin.from('patient_link_rejections').select('id').eq('phone_normalized', FAKE_PHONE)).data?.length ?? 0;
    r.patients = (await admin.from('patients').select('id').eq('notes', MARK)).data?.length ?? 0;
    r.clinics = (await admin.from('clinics').select('id').eq('name', CLINIC_NAME)).data?.length ?? 0;
    r.profiles = (await admin.from('profiles').select('id').eq('phone', FAKE_PHONE)).data?.length ?? 0;
    const total = r.rejections + r.patients + r.clinics + r.profiles;
    console.log('  residuales:', JSON.stringify(r), '→ TOTAL', total);
    if (total === 0) ok('cleanup OK — 0 residuales'); else ko('cleanup con ' + total + ' residuales');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
    fail++;
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_49 OK' : '❌ SMOKE s7_49 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
