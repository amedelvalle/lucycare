/**
 * SMOKE s7_36 (Mi equipo Fase 2) — ciclo de vida de invitación.
 *
 * Sesiones: Camilo (titular de su clínica, para resend) + paciente test
 * (50375000001, para accept). Fixture: una invitación de asistente en la
 * clínica de Camilo dirigida al teléfono del paciente. Limpia todo en finally.
 *
 * Cubre las decisiones del owner:
 *  1. expires_at default ≈ invited_at + 14 días.
 *  2. Pendiente VIGENTE consume cupo (team_seats_used).
 *  3. VENCIDA no consume cupo (lo libera).
 *  4. accept ignora la VENCIDA → 0 aceptadas, sin clinic_members.
 *  5. resend por NO titular (paciente) → rechazado (P0001).
 *  6. resend por titular (Camilo) → extiende expires_at al futuro.
 *  7. Revivida vuelve a consumir cupo.
 *  8. accept de la revivida (vigente) → 1 aceptada, miembro activo + role=assistant.
 *
 * Uso: node scripts/_smoke-s7_36.mjs
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

let camiloId = null, ppId = null, ppPhone = null, invId = null;

async function login(client, phone) {
  await client.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await client.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error(`OTP ${phone} falló: ${error?.message || 'sin sesión'}`);
  return data.user.id;
}

const seatsUsed = async () => {
  const { data, error } = await admin.rpc('team_seats_used', { p_clinic_id: CAMILO_CLINIC });
  if (error) throw new Error('team_seats_used: ' + error.message);
  return data;
};

async function cleanup() {
  try {
    if (ppId) await admin.from('clinic_members').delete().eq('clinic_id', CAMILO_CLINIC).eq('profile_id', ppId);
    if (invId) await admin.from('clinic_invitations').delete().eq('id', invId);
    // Borrar cualquier invitación residual al teléfono del paciente en esta clínica
    if (ppPhone) await admin.from('clinic_invitations').delete().eq('clinic_id', CAMILO_CLINIC).eq('phone', ppPhone);
    if (ppId) await admin.from('profiles').update({ role: 'patient' }).eq('id', ppId).eq('role', 'assistant');
  } catch { /* best-effort */ }
}

console.log('═══ SMOKE s7_36 (ciclo de vida de invitación) ═══\n');

try {
  camiloId = await login(camilo, CAMILO_PHONE);
  ppId = await login(patient, PATIENT_PHONE);

  // Teléfono EXACTO del profile del paciente (para que accept matchee).
  const { data: pp } = await admin.from('profiles').select('phone').eq('id', ppId).single();
  ppPhone = pp?.phone;
  if (!ppPhone) throw new Error('El paciente test no tiene phone en profiles.');

  await cleanup(); // estado limpio previo

  // Fixture: invitación de asistente al teléfono del paciente (expires_at default).
  const { data: ins, error: insErr } = await admin.from('clinic_invitations').insert({
    clinic_id: CAMILO_CLINIC, phone: ppPhone, display_name: 'F2 Smoke', role: 'assistant',
    invited_by: camiloId,
  }).select('id, invited_at, expires_at').single();
  if (insErr) throw new Error('insert invitación falló (¿clínica llena?): ' + insErr.message);
  invId = ins.id;

  // 1. expires_at default ≈ invited_at + 14 días
  {
    const exp = new Date(ins.expires_at).getTime();
    const lo = Date.now() + 13 * 864e5, hi = Date.now() + 15 * 864e5;
    if (exp > lo && exp < hi) ok('1 expires_at default ≈ +14 días');
    else ko('1 expires_at fuera de rango: ' + ins.expires_at);
  }

  // 2. Pendiente vigente consume cupo
  const usedVigente = await seatsUsed();
  ok(`2 cupo con pendiente vigente = ${usedVigente} (incluye la invitación)`);

  // 3. Vencida no consume cupo
  await admin.from('clinic_invitations').update({ expires_at: new Date(Date.now() - 864e5).toISOString() }).eq('id', invId);
  {
    const usedVencida = await seatsUsed();
    if (usedVencida === usedVigente - 1) ok(`3 vencida libera cupo (${usedVigente} → ${usedVencida})`);
    else ko(`3 vencida debería bajar el cupo en 1: ${usedVigente} → ${usedVencida}`);
  }

  // 4. accept ignora la vencida
  {
    const { data: n, error } = await patient.rpc('accept_clinic_invitations', { user_phone: ppPhone });
    const { data: mem } = await admin.from('clinic_members').select('id').eq('clinic_id', CAMILO_CLINIC).eq('profile_id', ppId);
    if (error) ko('4 accept error: ' + error.message);
    else if (n === 0 && (mem ?? []).length === 0) ok('4 accept ignora la vencida (0 aceptadas, sin membership)');
    else ko(`4 accept NO debía aceptar vencida: n=${n}, members=${(mem ?? []).length}`);
  }

  // 5. resend por NO titular (paciente) → rechazado
  {
    const { error } = await patient.rpc('resend_invitation', { p_invitation_id: invId });
    if (error && (error.code === 'P0001' || /No autorizado/i.test(error.message))) ok('5 resend de no-titular rechazado (P0001)');
    else ko('5 resend de no-titular NO fue rechazado: ' + JSON.stringify(error));
  }

  // 6. resend por titular (Camilo) → extiende al futuro
  {
    const { data: newExp, error } = await camilo.rpc('resend_invitation', { p_invitation_id: invId });
    if (error) ko('6 resend titular error: ' + error.message);
    else if (new Date(newExp).getTime() > Date.now() + 13 * 864e5) ok('6 resend titular extiende expires_at (+~14 días)');
    else ko('6 resend no extendió: ' + newExp);
  }

  // 7. Revivida vuelve a consumir cupo
  {
    const usedRevivida = await seatsUsed();
    if (usedRevivida === usedVigente) ok(`7 revivida vuelve a consumir cupo (= ${usedRevivida})`);
    else ko(`7 cupo tras revivir debería ser ${usedVigente}: ${usedRevivida}`);
  }

  // 8. accept de la revivida (vigente) → aceptada
  {
    const { data: n, error } = await patient.rpc('accept_clinic_invitations', { user_phone: ppPhone });
    const { data: mem } = await admin.from('clinic_members').select('id, is_active, role').eq('clinic_id', CAMILO_CLINIC).eq('profile_id', ppId);
    const m = (mem ?? [])[0];
    if (error) ko('8 accept(revivida) error: ' + error.message);
    else if (n === 1 && m && m.is_active && m.role === 'assistant') ok('8 accept de la revivida → miembro activo (assistant)');
    else ko(`8 accept(revivida) inconsistente: n=${n}, member=${JSON.stringify(m)}`);
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  await cleanup();
  await camilo.auth.signOut().catch(() => {});
  await patient.auth.signOut().catch(() => {});
  console.log('  ✅ cleanup OK');
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_36 OK' : '❌ SMOKE s7_36 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
