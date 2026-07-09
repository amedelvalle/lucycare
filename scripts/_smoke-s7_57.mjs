/**
 * SMOKE s7_57 — Niveles de acceso administrativo LucyAdmin (capability).
 *
 * Sesiones: admin de plataforma (50378056365) para "admin conserva acceso" +
 * fixtures; paciente test (50375000001) como ACTOR mutable — se le otorga /
 * cambia / desactiva su fila en lucyadmin_access a lo largo de los sub-tests
 * (directory_editor → operations_admin → inactivo → sin fila). service_role
 * para sembrar/limpiar. NO se usa Twilio (test-phones con OTP fijo).
 *
 * AISLAMIENTO: MÉDICO FIXTURE throwaway (auth user + clínica con depto/muni +
 * doctor + 1 servicio) como DESTINO de las ediciones. NO Camilo, NO Katherine,
 * NO datos reales. Cleanup total en finally (0 residuales, incl. audit por
 * record_id y la fila lucyadmin_access del actor).
 *
 * Valida (alcance PR-A):
 *  1. admin conserva acceso a las RPCs de directorio.
 *  2. directory_editor activo edita solo datos públicos autorizados.
 *  3. directory_editor publica/despublica (admin_set_doctor_published, solo is_published).
 *  4. directory_editor NO puede tocar nada sensible (auth.users/verify/lucy_status/
 *     operational/delete/avatar/list completo/analytics/farma/waitlist/admins/pacientes).
 *  5. directory_get_doctor_detail / directory_list_doctors NO exponen email/phone de login.
 *  6. operations_admin hereda directory, pero NO obtiene poder operativo real
 *     (admin_set_doctor_operational sigue rechazado — ninguna RPC ops abierta aún).
 *  7. usuario normal (sin fila) no puede.
 *  8. editor inactivo no puede.
 *  9. audit con actor correcto (edited_via='directory_editor' vs 'admin').
 * 10. my_lucyadmin_access() con la forma correcta por nivel.
 *
 * Uso (SOLO tras aplicar s7_57): node scripts/_smoke-s7_57.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const ADMIN_PHONE = '50378056365';
const EDITOR_PHONE = '50375000001';   // paciente test → actor mutable
const OTP = '123456';

const FAKE_PHONE = '50370005757';
const PROTECTED = new Set(['50378627694', '50378056365', '50375000001', '50375000099', '50372608827']);
if (PROTECTED.has(FAKE_PHONE)) throw new Error('FAKE_PHONE colisiona con un teléfono protegido');

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
const blocked = (e) => e && (e.code === 'P0001' || /No autorizado/i.test(e.message));

const okCall = async (label, p) => { const { error } = await p; if (!error) ok(label); else ko(`${label}: RECHAZADO inesperado — ${error.code || ''} ${error.message.slice(0, 60)}`); };
const denyCall = async (label, p) => { const { error } = await p; if (blocked(error)) ok(label); else ko(`${label}: NO fue rechazado (${error ? error.code : 'sin error'})`); };

// Helpers para setear el nivel del actor (service_role, salta RLS).
const grant = async (uid, level) => {
  await admin.from('lucyadmin_access').upsert({ profile_id: uid, access_level: level, is_active: true, revoked_at: null }, { onConflict: 'profile_id' });
};
const deactivate = async (uid) => { await admin.from('lucyadmin_access').update({ is_active: false, revoked_at: new Date().toISOString() }).eq('profile_id', uid); };
const removeRow = async (uid) => { await admin.from('lucyadmin_access').delete().eq('profile_id', uid); };

const adminCli = mk();
const editorCli = mk();

const created = { authUser: null, clinic: null, doctor: null, service: null, profile: null };
let SPEC = null, OTHER_SPEC = null, DEPT = null, MUNI = null;
let editorUid = null;

console.log('═══ SMOKE s7_57 (niveles de acceso LucyAdmin) ═══\n');

try {
  const adminUid = await login(adminCli, ADMIN_PHONE);
  editorUid = await login(editorCli, EDITOR_PHONE);
  {
    const { data: prof } = await admin.from('profiles').select('role').eq('id', adminUid).single();
    if (prof?.role !== 'admin') throw new Error(`La cuenta ${ADMIN_PHONE} no es admin (role=${prof?.role})`);
    const { data: ep } = await admin.from('profiles').select('role').eq('id', editorUid).single();
    if (ep?.role === 'admin') throw new Error('El actor editor NO debe ser admin');
  }
  // Estado limpio del actor (por si un run previo dejó fila).
  await removeRow(editorUid);

  // Catálogos para el fixture.
  {
    const { data: specs } = await admin.from('specialties').select('id').limit(2);
    if (!specs || specs.length < 2) throw new Error('faltan 2 especialidades');
    SPEC = specs[0].id; OTHER_SPEC = specs[1].id;
    const { data: dept } = await admin.from('departments').select('id').limit(1).single();
    DEPT = dept.id;
    const { data: muni } = await admin.from('municipalities').select('id').eq('department_id', DEPT).limit(1).single();
    if (!muni?.id) throw new Error('sin municipio para el fixture');
    MUNI = muni.id;
  }

  // Médico fixture (destino de ediciones), con depto/muni (para permitir publicar).
  {
    const { data: cu, error: cuErr } = await admin.auth.admin.createUser({ phone: FAKE_PHONE, phone_confirm: true });
    if (cuErr) throw new Error('createUser: ' + cuErr.message);
    created.authUser = cu.user.id; created.profile = cu.user.id;
    await admin.from('profiles').update({ full_name: 'S757 Doctor Fixture', role: 'patient' }).eq('id', created.profile);

    const { data: clinic, error: ce } = await admin.from('clinics').insert({ name: 'S757 Clínica Fixture', owner_id: created.profile, department_id: DEPT, municipality_id: MUNI, phone: '50370000757', address_line: 'Calle Fixture 757' }).select('id').single();
    if (ce) throw new Error('clinic: ' + ce.message);
    created.clinic = clinic.id;

    const { data: doctor, error: de } = await admin.from('doctors').insert({ clinic_id: created.clinic, profile_id: created.profile, specialty_id: SPEC }).select('id').single();
    if (de) throw new Error('doctor: ' + de.message);
    created.doctor = doctor.id;

    const { data: svc, error: se } = await admin.from('services').insert({ doctor_id: created.doctor, name: 'S757 Servicio', duration_minutes: 30, price: 0, is_first_visit: false, is_active: true, sort_order: 0 }).select('id').single();
    if (se) throw new Error('service: ' + se.message);
    created.service = svc.id;
  }
  ok('Fixtures sembradas (médico fixture + clínica c/depto-muni + 1 servicio)');

  const D = created.doctor;

  // ═══ 1. Admin conserva acceso ═══
  await okCall('1 admin: directory_update_doctor_name', adminCli.rpc('directory_update_doctor_name', { p_doctor_id: D, p_full_name: 'S757 Doctor Admin' }));
  await okCall('1 admin: admin_update_doctor_info', adminCli.rpc('admin_update_doctor_info', { p_doctor_id: D, p_specialty_id: OTHER_SPEC, p_bio: 'bio admin' }));
  await okCall('1 admin: admin_update_doctor_clinic', adminCli.rpc('admin_update_doctor_clinic', { p_doctor_id: D, p_name: 'S757 Clínica Admin', p_address: 'Dir Admin', p_phone: '50370000701', p_department_id: DEPT, p_municipality_id: MUNI }));
  await okCall('1 admin: admin_set_doctor_published', adminCli.rpc('admin_set_doctor_published', { p_doctor_id: D, p_value: true }));

  // ═══ 7. Usuario normal (sin fila) no puede ═══
  await denyCall('7 normal: directory_update_doctor_name', editorCli.rpc('directory_update_doctor_name', { p_doctor_id: D, p_full_name: 'hack' }));
  await denyCall('7 normal: directory_list_doctors', editorCli.rpc('directory_list_doctors', {}));
  await denyCall('7 normal: admin_set_doctor_published', editorCli.rpc('admin_set_doctor_published', { p_doctor_id: D, p_value: false }));
  {
    const { data } = await editorCli.rpc('my_lucyadmin_access');
    if (data && data.can_access_lucyadmin === false && data.level === null) ok('7 normal: my_lucyadmin_access sin acceso');
    else ko('7 normal: my_lucyadmin_access inesperado ' + JSON.stringify(data));
  }

  // ═══ 2/3. directory_editor activo ═══
  await grant(editorUid, 'directory_editor');
  await okCall('2 editor: directory_list_doctors', editorCli.rpc('directory_list_doctors', { p_limit: 5 }));
  await okCall('2 editor: directory_update_doctor_name', editorCli.rpc('directory_update_doctor_name', { p_doctor_id: D, p_full_name: 'S757 Doctor Editor' }));
  await okCall('2 editor: admin_update_doctor_info', editorCli.rpc('admin_update_doctor_info', { p_doctor_id: D, p_specialty_id: SPEC, p_bio: 'bio editor' }));
  await okCall('2 editor: admin_update_doctor_clinic', editorCli.rpc('admin_update_doctor_clinic', { p_doctor_id: D, p_name: 'S757 Clínica Editor', p_address: 'Dir Editor', p_phone: '50370000702', p_department_id: DEPT, p_municipality_id: MUNI }));
  await okCall('2 editor: admin_list_doctor_services', editorCli.rpc('admin_list_doctor_services', { p_doctor_id: D }));
  await okCall('2 editor: admin_create_service', editorCli.rpc('admin_create_service', { p_doctor_id: D, p_name: 'S757 Svc Editor', p_duration_minutes: 20, p_price: 0, p_is_first_visit: false }));
  await okCall('2 editor: admin_update_service', editorCli.rpc('admin_update_service', { p_service_id: created.service, p_name: 'S757 Svc Upd', p_duration_minutes: 25, p_price: 0, p_is_first_visit: false }));
  await okCall('2 editor: admin_set_service_active', editorCli.rpc('admin_set_service_active', { p_service_id: created.service, p_is_active: false }));
  // 3. publicar/despublicar (solo is_published)
  await okCall('3 editor: admin_set_doctor_published (despublicar)', editorCli.rpc('admin_set_doctor_published', { p_doctor_id: D, p_value: false }));
  await okCall('3 editor: admin_set_doctor_published (publicar)', editorCli.rpc('admin_set_doctor_published', { p_doctor_id: D, p_value: true }));

  // ═══ 5. Sin fuga de credenciales de login ═══
  {
    const { data: det } = await editorCli.rpc('directory_get_doctor_detail', { p_doctor_id: D });
    const row = Array.isArray(det) ? det[0] : det;
    if (row && !('email' in row) && !('phone' in row)) ok('5 detalle sin email/phone de login');
    else ko('5 detalle EXPUSO credenciales: ' + JSON.stringify(row ? Object.keys(row) : row));
    const { data: list } = await editorCli.rpc('directory_list_doctors', { p_limit: 3 });
    const lrow = (list ?? [])[0];
    if (!lrow || (!('phone' in lrow) && !('email' in lrow))) ok('5 listado sin email/phone de login');
    else ko('5 listado EXPUSO credenciales: ' + JSON.stringify(Object.keys(lrow)));
  }

  // ═══ 4. directory_editor NO puede tocar nada sensible ═══
  await denyCall('4 editor: admin_update_doctor_profile (auth.users)', editorCli.rpc('admin_update_doctor_profile', { p_doctor_id: D, p_full_name: 'x', p_email: null, p_phone: '50370000799' }));
  await denyCall('4 editor: admin_set_doctor_verified', editorCli.rpc('admin_set_doctor_verified', { p_doctor_id: D, p_value: true }));
  await denyCall('4 editor: admin_set_lucy_status', editorCli.rpc('admin_set_lucy_status', { p_doctor_id: D, p_value: 'verified' }));
  await denyCall('4 editor: admin_set_doctor_operational', editorCli.rpc('admin_set_doctor_operational', { p_doctor_id: D, p_value: false }));
  await denyCall('4 editor: admin_delete_service (hard-delete)', editorCli.rpc('admin_delete_service', { p_service_id: created.service }));
  await denyCall('4 editor: admin_update_doctor_avatar', editorCli.rpc('admin_update_doctor_avatar', { p_doctor_id: D, p_avatar_url: null }));
  await denyCall('4 editor: admin_list_doctors (con phone)', editorCli.rpc('admin_list_doctors', { p_limit: 5 }));
  await denyCall('4 editor: admin_conversion_summary', editorCli.rpc('admin_conversion_summary', {}));
  await denyCall('4 editor: admin_pharma_summary', editorCli.rpc('admin_pharma_summary', {}));
  await denyCall('4 editor: admin_list_waitlist', editorCli.rpc('admin_list_waitlist', {}));
  await denyCall('4 editor: admin_list_platform_admins', editorCli.rpc('admin_list_platform_admins', {}));
  await denyCall('4 editor: admin_list_patient_merge_candidates', editorCli.rpc('admin_list_patient_merge_candidates', {}));

  // ═══ 9. Audit con actor correcto ═══
  {
    const { data: aEditor } = await admin.from('audit_log')
      .select('id,user_id,new_data').eq('record_id', created.profile)
      .order('created_at', { ascending: false }).limit(20);
    const hit = (aEditor ?? []).find((r) => r.new_data?.edited_via === 'directory_editor' && r.user_id === editorUid);
    if (hit) ok("9 audit editor: edited_via='directory_editor' + user_id correcto");
    else ko('9 audit editor: no se encontró la entrada del editor');

    const { data: aAdmin } = await admin.from('audit_log')
      .select('new_data').eq('record_id', D)
      .order('created_at', { ascending: false }).limit(20);
    const hitA = (aAdmin ?? []).find((r) => r.new_data?.edited_via === 'admin');
    if (hitA) ok("9 audit admin: edited_via='admin'");
    else ko('9 audit admin: no se encontró entrada de admin');
  }

  // ═══ 10. my_lucyadmin_access por nivel ═══
  {
    const { data: mAdmin } = await adminCli.rpc('my_lucyadmin_access');
    if (mAdmin?.level === 'owner_admin' && mAdmin.can_manage_users === true && mAdmin.can_manage_directory === true) ok('10 my_lucyadmin_access admin = owner_admin (todo)');
    else ko('10 my_lucyadmin_access admin inesperado: ' + JSON.stringify(mAdmin));

    const { data: mEd } = await editorCli.rpc('my_lucyadmin_access');
    if (mEd?.level === 'directory_editor' && mEd.can_manage_directory === true && mEd.can_manage_operations === false && mEd.can_manage_users === false) ok('10 my_lucyadmin_access editor = directory_editor (solo directorio)');
    else ko('10 my_lucyadmin_access editor inesperado: ' + JSON.stringify(mEd));
  }

  // ═══ 6. operations_admin hereda directory, sin poder operativo real ═══
  await grant(editorUid, 'operations_admin');
  {
    const { data: mOps } = await editorCli.rpc('my_lucyadmin_access');
    if (mOps?.level === 'operations_admin' && mOps.can_manage_directory === true && mOps.can_manage_operations === true && mOps.can_manage_users === false) ok('6 my_lucyadmin_access operations = hereda directorio + ops');
    else ko('6 my_lucyadmin_access operations inesperado: ' + JSON.stringify(mOps));
  }
  await okCall('6 operations: hereda directory (directory_update_doctor_name)', editorCli.rpc('directory_update_doctor_name', { p_doctor_id: D, p_full_name: 'S757 Doctor Ops' }));
  await denyCall('6 operations: SIN poder operativo real (admin_set_doctor_operational)', editorCli.rpc('admin_set_doctor_operational', { p_doctor_id: D, p_value: false }));

  // ═══ 8. Editor inactivo no puede ═══
  await deactivate(editorUid);
  await denyCall('8 inactivo: directory_update_doctor_name', editorCli.rpc('directory_update_doctor_name', { p_doctor_id: D, p_full_name: 'x' }));
  await denyCall('8 inactivo: directory_list_doctors', editorCli.rpc('directory_list_doctors', {}));
  {
    const { data } = await editorCli.rpc('my_lucyadmin_access');
    if (data?.can_access_lucyadmin === false) ok('8 inactivo: my_lucyadmin_access sin acceso');
    else ko('8 inactivo: my_lucyadmin_access inesperado ' + JSON.stringify(data));
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    if (editorUid) await removeRow(editorUid);
    // audit generado por las ediciones (por record_id del fixture).
    for (const rid of [created.doctor, created.profile, created.clinic, created.service].filter(Boolean)) {
      await admin.from('audit_log').delete().eq('record_id', rid);
    }
    if (created.service) await admin.from('services').delete().eq('doctor_id', created.doctor);
    if (created.doctor) await admin.from('doctors').delete().eq('id', created.doctor);
    if (created.clinic) await admin.from('clinics').delete().eq('id', created.clinic);
    if (created.authUser) await admin.auth.admin.deleteUser(created.authUser).catch(() => {});
    await adminCli.auth.signOut().catch(() => {});
    await editorCli.auth.signOut().catch(() => {});

    let residual = 0;
    if (editorUid) { const { data } = await admin.from('lucyadmin_access').select('profile_id').eq('profile_id', editorUid).maybeSingle(); if (data) residual++; }
    if (created.doctor) { const { data } = await admin.from('doctors').select('id').eq('id', created.doctor).maybeSingle(); if (data) residual++; }
    if (created.clinic) { const { data } = await admin.from('clinics').select('id').eq('id', created.clinic).maybeSingle(); if (data) residual++; }
    if (residual === 0) ok('cleanup 0 residuales');
    else ko('cleanup dejó ' + residual + ' residuales');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_57 OK' : '❌ SMOKE s7_57 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
