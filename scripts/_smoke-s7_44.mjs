/**
 * SMOKE s7_44 — Administración de LucyAdmins (Fase 1).
 *
 * Sesiones: admin real (50378056365) para invitar/revocar; el test phone
 * LIBRE 50375000099 como invitado (sin auth.user — quedó limpio tras el QA
 * de Fase 1 de identidad); paciente (50375000001) y Camilo (50378627694)
 * solo como teléfonos para probar bloqueos. Cleanup obligatorio.
 *
 * ⚠ Los tests de guard de último admin (P0052) intentan revocar al admin
 * REAL cuando es el único activo. Si el guard estuviera roto, el admin real
 * quedaría demoteado — recuperación: bootstrap SQL de s7_01
 * (UPDATE profiles SET role='admin' WHERE phone='50378056365').
 *
 * Cubre:
 *  0. Guard P0052: con 1 solo admin activo, revocarlo → rechazado.
 *  1. Bloqueos de invitación: teléfono de paciente → P0050; de médico →
 *     P0050; de admin → P0051; teléfono inválido → P0055.
 *  2. Invitar 99 → pending (TTL ~14d). Duplicado vigente → P0053.
 *  3. TTL: pending vencida NO activa (login 99 → activated=false) y el
 *     usuario sigue sin privilegios (admin_list → rechazado).
 *  4. Re-invitar la vencida → MISMA fila refrescada (reinvited=true).
 *  5. Activación: accept con invitación vigente → role='admin', registro
 *     'active' (activated_at/profile), audit 'platform_admin_activate'.
 *  6. El nuevo admin opera (admin_list_platform_admins OK).
 *  7. Revocación: role→'patient', registro 'revoked' (revoked_by/at), audit;
 *     el revocado queda bloqueado DE INMEDIATO (admin_list → rechazado).
 *  8. Re-invitar tras revocación (historial permite; cuenta dedicada).
 *  9. Guard P0052 de nuevo (volvió a haber 1 solo admin activo).
 *
 * Uso (SOLO después de aplicar s7_44): node scripts/_smoke-s7_44.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const ADMIN_PHONE = '50378056365';
const PATIENT_PHONE = '50375000001';
const CAMILO_PHONE = '50378627694';
const INVITEE_PHONE = '50375000099';
const OTP = '123456';

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
const invitee = mk();
let adminUid = null, inviteeUid = null, invId = null;

console.log('═══ SMOKE s7_44 (administración de LucyAdmins) ═══\n');

try {
  adminUid = await login(adminCli, ADMIN_PHONE);

  // 0. Guard último admin (estado inicial esperado: 1 admin activo).
  {
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
    if (count === 1) {
      const { error } = await adminCli.rpc('admin_revoke_platform_admin', { p_profile_id: adminUid });
      if (error?.code === 'P0052') ok('0 Guard último admin: revocar al único → P0052');
      else ko('0 Guard FALLÓ (revisar role del admin real): ' + JSON.stringify(error));
    } else {
      ok(`0 (skip guard inicial: hay ${count} admins activos, no 1)`);
    }
  }

  // 1. Bloqueos de invitación.
  {
    const inv = (phone, name = 'Bloqueo QA') =>
      adminCli.rpc('admin_invite_platform_admin', { p_phone: phone, p_display_name: name });
    const { error: e1 } = await inv(PATIENT_PHONE);
    if (e1?.code === 'P0050') ok('1a Teléfono de paciente → P0050 (cuenta dedicada)');
    else ko('1a esperado P0050: ' + JSON.stringify(e1));
    const { error: e2 } = await inv(CAMILO_PHONE);
    if (e2?.code === 'P0050') ok('1b Teléfono de médico → P0050');
    else ko('1b esperado P0050: ' + JSON.stringify(e2));
    const { error: e3 } = await inv(ADMIN_PHONE);
    if (e3?.code === 'P0051') ok('1c Teléfono de admin → P0051');
    else ko('1c esperado P0051: ' + JSON.stringify(e3));
    const { error: e4 } = await inv('123');
    if (e4?.code === 'P0055') ok('1d Teléfono inválido → P0055');
    else ko('1d esperado P0055: ' + JSON.stringify(e4));
    const { error: e5 } = await inv('77kk88zz');
    if (e5?.code === 'P0055') ok('1e Teléfono con letras → P0055 (backend no confía en la UI)');
    else ko('1e esperado P0055: ' + JSON.stringify(e5));
    const { error: e6 } = await inv('777777777777777777777');
    if (e6?.code === 'P0055') ok('1f Longitud absurda → P0055');
    else ko('1f esperado P0055: ' + JSON.stringify(e6));
  }

  // 2. Invitar 99 → pending; duplicado vigente → P0053.
  {
    const { data, error } = await adminCli.rpc('admin_invite_platform_admin', {
      p_phone: INVITEE_PHONE, p_display_name: 'Admin QA s7_44',
    });
    if (error) throw new Error('invitar 99: ' + error.message);
    invId = data.invitation_id;
    const { data: row } = await admin.from('platform_admin_invitations')
      .select('status, expires_at, invited_by').eq('id', invId).single();
    const days = (new Date(row.expires_at) - Date.now()) / 86_400_000;
    if (row.status === 'pending' && days > 13 && days <= 14 && row.invited_by === adminUid)
      ok('2a Invitación pending (TTL ~14d, invited_by correcto)');
    else ko('2a fila inesperada: ' + JSON.stringify(row));

    const { error: dup } = await adminCli.rpc('admin_invite_platform_admin', {
      p_phone: INVITEE_PHONE, p_display_name: 'Dup',
    });
    if (dup?.code === 'P0053') ok('2b Duplicado vigente → P0053');
    else ko('2b esperado P0053: ' + JSON.stringify(dup));
  }

  // 3. TTL: vencer la pending → login del invitado NO activa, sin privilegios.
  {
    await admin.from('platform_admin_invitations')
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', invId);
    inviteeUid = await login(invitee, INVITEE_PHONE); // crea auth.user + profile patient
    const { data: acc } = await invitee.rpc('accept_platform_admin_invitation');
    const { data: prof } = await admin.from('profiles').select('role').eq('id', inviteeUid).single();
    if (acc?.activated === false && prof?.role === 'patient')
      ok('3a Invitación VENCIDA no activa (role sigue patient)');
    else ko('3a vencida activó?: ' + JSON.stringify({ acc, prof }));

    const { error: noPriv } = await invitee.rpc('admin_list_platform_admins');
    if (noPriv && /No autorizado/i.test(noPriv.message)) ok('3b Pending/vencida sin privilegios (admin_list rechazado)');
    else ko('3b ¡tuvo privilegios sin activar!: ' + JSON.stringify(noPriv));
  }

  // 4. Re-invitar la vencida → misma fila refrescada.
  {
    const { data, error } = await adminCli.rpc('admin_invite_platform_admin', {
      p_phone: INVITEE_PHONE, p_display_name: 'Admin QA s7_44',
    });
    if (error) ko('4 re-invitar error: ' + error.message);
    else if (data.invitation_id === invId && data.reinvited === true)
      ok('4 Re-invitar vencida → misma fila refrescada (reinvited=true)');
    else ko('4 inesperado: ' + JSON.stringify(data));
  }

  // 5. Activación con invitación vigente.
  {
    const { data: acc, error } = await invitee.rpc('accept_platform_admin_invitation');
    if (error) ko('5 accept error: ' + error.message);
    else {
      const { data: prof } = await admin.from('profiles').select('role, full_name').eq('id', inviteeUid).single();
      const { data: row } = await admin.from('platform_admin_invitations')
        .select('status, activated_at, activated_profile_id').eq('id', invId).single();
      if (acc?.activated === true && prof?.role === 'admin') ok('5a Activación al OTP login → role=admin');
      else ko('5a no activó: ' + JSON.stringify({ acc, prof }));
      if (prof?.full_name === 'Admin QA s7_44')
        ok('5a2 full_name llenado desde la invitación (no queda "Sin nombre")');
      else ko('5a2 full_name inesperado: ' + JSON.stringify(prof?.full_name));
      if (row?.status === 'active' && row?.activated_at && row?.activated_profile_id === inviteeUid)
        ok('5b Registro → active (activated_at/profile)');
      else ko('5b registro inesperado: ' + JSON.stringify(row));

      const { data: aud } = await admin.from('audit_log').select('new_data')
        .eq('table_name', 'profiles').eq('record_id', inviteeUid)
        .order('created_at', { ascending: false }).limit(5);
      if ((aud ?? []).some((r) => r.new_data?.edited_via === 'platform_admin_activate'))
        ok('5c audit platform_admin_activate');
      else ko('5c audit ausente: ' + JSON.stringify((aud ?? []).map((r) => r.new_data?.edited_via)));
    }
  }

  // 6. El nuevo admin opera.
  {
    const { data, error } = await invitee.rpc('admin_list_platform_admins');
    if (!error && (data?.admins ?? []).some((a) => a.profile_id === inviteeUid))
      ok('6 Nuevo admin opera (admin_list OK y se ve a sí mismo)');
    else ko('6 nuevo admin no pudo operar: ' + JSON.stringify(error || data));
  }

  // 7. Revocación → bloqueo inmediato.
  {
    const { error } = await adminCli.rpc('admin_revoke_platform_admin', { p_profile_id: inviteeUid });
    if (error) ko('7 revoke error: ' + error.message);
    else {
      const { data: prof } = await admin.from('profiles').select('role').eq('id', inviteeUid).single();
      const { data: row } = await admin.from('platform_admin_invitations')
        .select('status, revoked_by, revoked_at').eq('id', invId).single();
      if (prof?.role === 'patient') ok('7a Revocado → role=patient');
      else ko('7a role inesperado: ' + JSON.stringify(prof));
      if (row?.status === 'revoked' && row?.revoked_by === adminUid && row?.revoked_at)
        ok('7b Registro → revoked (revoked_by/at)');
      else ko('7b registro inesperado: ' + JSON.stringify(row));

      const { error: blocked } = await invitee.rpc('admin_list_platform_admins');
      if (blocked && /No autorizado/i.test(blocked.message)) ok('7c Bloqueo INMEDIATO post-revocación');
      else ko('7c ¡el revocado siguió operando!: ' + JSON.stringify(blocked));

      const { data: aud } = await admin.from('audit_log').select('new_data')
        .eq('table_name', 'profiles').eq('record_id', inviteeUid)
        .order('created_at', { ascending: false }).limit(5);
      if ((aud ?? []).some((r) => r.new_data?.edited_via === 'platform_admin_revoke'))
        ok('7d audit platform_admin_revoke');
      else ko('7d audit ausente');
    }
  }

  // 8. Re-invitar tras revocación (historial = cuenta dedicada re-invitable).
  {
    const { data, error } = await adminCli.rpc('admin_invite_platform_admin', {
      p_phone: INVITEE_PHONE, p_display_name: 'Admin QA s7_44 (2da vuelta)',
    });
    if (!error && data?.invitation_id) ok('8 Ex-admin revocado es re-invitable (historial)');
    else ko('8 re-invitar tras revocación falló: ' + JSON.stringify(error));
  }

  // 8b. Cáscara que se volvió PACIENTE REAL (ficha vinculada) NO activa
  //     (defensa "cuenta dedicada" en accept) y deja la invitación pending.
  {
    const { data: cl } = await admin.from('clinics').select('id').limit(1).single();
    const { data: ficha, error: fErr } = await admin.from('patients').insert({
      clinic_id: cl.id, profile_id: inviteeUid, full_name: 'S744 Ficha QA',
      document_type: 'dui', document_number: null, date_of_birth: '1990-01-01',
      gender: 'otro', patient_type: 'privado', phone: INVITEE_PHONE, is_active: true,
      link_confirmed_at: new Date().toISOString(),
    }).select('id').single();
    if (fErr) { ko('8b fixture ficha falló: ' + fErr.message); }
    else {
      const { data: acc } = await invitee.rpc('accept_platform_admin_invitation');
      const { data: prof } = await admin.from('profiles').select('role').eq('id', inviteeUid).single();
      if (acc?.activated === false && acc?.reason === 'blocked_role' && prof?.role === 'patient')
        ok('8b Cuenta con ficha de paciente vinculada NO activa (blocked_role)');
      else ko('8b inesperado: ' + JSON.stringify({ acc, prof }));
      await admin.from('patients').delete().eq('id', ficha.id);
    }
  }

  // 9. Guard último admin de nuevo (quedó 1 activo).
  {
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
    if (count === 1) {
      const { error } = await adminCli.rpc('admin_revoke_platform_admin', { p_profile_id: adminUid });
      if (error?.code === 'P0052') ok('9 Guard último admin (post-ciclo) → P0052');
      else ko('9 Guard FALLÓ: ' + JSON.stringify(error));
    } else {
      ok(`9 (skip: hay ${count} admins activos)`);
    }
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  try {
    await admin.from('platform_admin_invitations').delete().eq('phone_normalized', INVITEE_PHONE);
    if (inviteeUid) await admin.auth.admin.deleteUser(inviteeUid).catch(() => {});
    await adminCli.auth.signOut().catch(() => {});
    await invitee.auth.signOut().catch(() => {});
    console.log('  ✅ cleanup OK (invitaciones del 99 + auth.user del 99)');
  } catch (ce) {
    console.log('  ⚠ cleanup parcial:', ce.message);
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_44 OK' : '❌ SMOKE s7_44 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
