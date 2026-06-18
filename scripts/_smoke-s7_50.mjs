/**
 * SMOKE s7_50 — accept_clinic_invitations tolerante a formato de teléfono.
 *
 * Prueba el CASO REAL DE MISMATCH que el smoke de s7_36 esquivaba:
 *   • clinic_invitations.phone guardada como "+503XXXXXXXX" (como inviteMember).
 *   • profiles.phone como "503XXXXXXXX" (sin +, como guarda auth).
 *   • user_phone pasado como "+503XXXXXXXX" (como LoginModal/verifyOtp).
 *   → Con s7_50 (normalize en ambos lados) la invitación SE ACEPTA.
 *     (Con la versión literal vieja, el gate fallaba y no aceptaba — ver paso 0.)
 *
 * Estrategia de fixtures = OPCIÓN A (aislada):
 *   • Clínica fixture descartable marcada "F50_FIXTURE" (NO la de Camilo).
 *   • Invitado = cuenta de prueba 50375000001 (única vía de sesión OTP real);
 *     se REUSA su auth.user existente — NO se crea ni modifica ningún auth.user.
 *   • Si la RPC sube profiles.role de la cuenta test a 'assistant', el cleanup
 *     lo revierte a 'patient'. No se tocan columnas de identidad.
 *
 * Cubre: (T1) test negativo del gate; (T2) mismatch real → acepta; (T3) cupos
 * sin romper; (T4) idempotencia (no doble-accept); cleanup en finally con
 * verificación de 0 residuales F50_FIXTURE.
 *
 * Nota: los DELETE/UPDATE del fixture generan entradas en audit_log (append-only,
 * por diseño) — eso es esperado y NO cuenta como residual.
 *
 * Uso: node scripts/_smoke-s7_50.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const PATIENT_PHONE = '50375000001';            // Test Phone (login OTP), sin +
const PATIENT_PHONE_PLUS = '+50375000001';      // como lo pasa LoginModal
const INVITE_STORED = '+50375000001';           // como guarda inviteMember (+)
const WRONG_PHONE = '+50370000000';             // normaliza a otro número (test negativo)
const OTP = '123456';
const FIXTURE_TAG = 'F50_FIXTURE';

const patient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

let ppId = null;
let clinicId = null;

async function login(client, phone) {
  await client.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await client.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error(`OTP ${phone} falló: ${error?.message || 'sin sesión'}`);
  return data.user.id;
}

const seatsUsed = async (cid) => {
  const { data, error } = await admin.rpc('team_seats_used', { p_clinic_id: cid });
  if (error) throw new Error('team_seats_used: ' + error.message);
  return data;
};

// Borra TODO el fixture (idempotente). Resetea el rol de la cuenta test.
async function cleanup() {
  try {
    // Barrer clínicas fixture (de esta corrida y de cualquier corrida previa).
    const { data: clinics } = await admin
      .from('clinics').select('id').like('name', `${FIXTURE_TAG}%`);
    const ids = (clinics ?? []).map((c) => c.id);
    if (clinicId && !ids.includes(clinicId)) ids.push(clinicId);
    for (const id of ids) {
      await admin.from('clinic_members').delete().eq('clinic_id', id);
      await admin.from('clinic_invitations').delete().eq('clinic_id', id);
      await admin.from('clinics').delete().eq('id', id);
    }
    // Revertir rol del test patient a 'patient' si quedó como assistant.
    if (ppId) {
      await admin.from('profiles').update({ role: 'patient' }).eq('id', ppId).neq('role', 'patient');
    }
  } catch { /* best-effort */ }
}

console.log('═══ SMOKE s7_50 (accept tolerante a formato de teléfono) ═══\n');

try {
  ppId = await login(patient, PATIENT_PHONE);

  // Formato real de profiles.phone (NO se modifica) — debe ser sin '+'.
  const { data: pp } = await admin.from('profiles').select('phone, role').eq('id', ppId).single();
  if (!pp?.phone) throw new Error('El test patient no tiene phone en profiles.');
  console.log(`  · profiles.phone del test patient: "${pp.phone}" (esperado sin '+')\n`);

  await cleanup(); // estado limpio previo

  // Fixture: clínica descartable (owner_id = la propia cuenta test, throwaway).
  const { data: clinic, error: cErr } = await admin.from('clinics').insert({
    name: `${FIXTURE_TAG} clinic`,
    owner_id: ppId,
  }).select('id').single();
  if (cErr) throw new Error('insert clínica fixture falló: ' + cErr.message);
  clinicId = clinic.id;

  // Fixture: invitación de asistente guardada en formato "+503…" (como inviteMember).
  const { data: inv, error: iErr } = await admin.from('clinic_invitations').insert({
    clinic_id: clinicId,
    phone: INVITE_STORED,
    display_name: FIXTURE_TAG,
    role: 'assistant',
    invited_by: ppId,
  }).select('id, phone, expires_at').single();
  if (iErr) throw new Error('insert invitación fixture falló: ' + iErr.message);
  if (inv.phone === INVITE_STORED) ok(`fixture: invitación guardada como "${inv.phone}" (con +)`);
  else ko(`fixture: invitación con formato inesperado "${inv.phone}"`);

  // ── T3a. Cupo antes de aceptar: 1 pendiente vigente ──
  {
    const used = await seatsUsed(clinicId);
    if (used === 1) ok('T3a cupo con 1 pendiente vigente = 1');
    else ko(`T3a cupo esperado 1 (1 pendiente), obtuvo ${used}`);
  }

  // ── T1. Test negativo del gate: user_phone que normaliza a OTRO número ──
  // El gate compara contra profiles.phone del usuario autenticado → debe rechazar.
  {
    const { data: n, error } = await patient.rpc('accept_clinic_invitations', { user_phone: WRONG_PHONE });
    const { data: mem } = await admin.from('clinic_members')
      .select('id').eq('clinic_id', clinicId).eq('profile_id', ppId);
    const rejected = !!error && /no coincide/i.test(error.message || '');
    if (rejected && (mem ?? []).length === 0) {
      ok('T1 gate rechaza teléfono ajeno (no se ensancha con la normalización)');
    } else {
      ko(`T1 gate NO rechazó como debía: n=${n}, error=${error?.message}, members=${(mem ?? []).length}`);
    }
  }

  // ── T2. Mismatch real: invitación "+503…", profiles "503…", user_phone "+503…" → ACEPTA ──
  {
    const { data: n, error } = await patient.rpc('accept_clinic_invitations', { user_phone: PATIENT_PHONE_PLUS });
    const { data: mem } = await admin.from('clinic_members')
      .select('id, is_active, role').eq('clinic_id', clinicId).eq('profile_id', ppId);
    const m = (mem ?? [])[0];
    const { data: invAfter } = await admin.from('clinic_invitations')
      .select('accepted_at').eq('id', inv.id).single();
    if (error) ko('T2 accept error: ' + error.message);
    else if (n === 1 && m && m.is_active && m.role === 'assistant' && invAfter?.accepted_at) {
      ok('T2 mismatch +503…/503…/+503… → acepta (miembro activo assistant, invitación marcada)');
    } else {
      ko(`T2 inconsistente: n=${n}, member=${JSON.stringify(m)}, accepted_at=${invAfter?.accepted_at}`);
    }
  }

  // ── T3b. Cupo después de aceptar: 1 asistente activo (0 pendientes) ──
  {
    const used = await seatsUsed(clinicId);
    if (used === 1) ok('T3b cupo con 1 asistente activo = 1 (lógica de cupos intacta)');
    else ko(`T3b cupo esperado 1 (1 activo), obtuvo ${used}`);
  }

  // ── T4. Idempotencia: re-aceptar no duplica (sin pendientes vigentes) ──
  {
    const { data: n, error } = await patient.rpc('accept_clinic_invitations', { user_phone: PATIENT_PHONE_PLUS });
    const { data: mem } = await admin.from('clinic_members')
      .select('id').eq('clinic_id', clinicId).eq('profile_id', ppId);
    if (!error && n === 0 && (mem ?? []).length === 1) ok('T4 re-accept → 0 (idempotente, sin duplicar membresía)');
    else ko(`T4 idempotencia falló: n=${n}, error=${error?.message}, members=${(mem ?? []).length}`);
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  await cleanup();

  // Verificación de 0 residuales F50_FIXTURE.
  let residuals = 0;
  try {
    if (clinicId) {
      const { count: ci } = await admin.from('clinic_invitations')
        .select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId);
      const { count: cm } = await admin.from('clinic_members')
        .select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId);
      residuals += (ci ?? 0) + (cm ?? 0);
    }
    const { count: cc } = await admin.from('clinics')
      .select('id', { count: 'exact', head: true }).like('name', `${FIXTURE_TAG}%`);
    residuals += (cc ?? 0);

    let roleResidual = 0;
    if (ppId) {
      const { data: pr } = await admin.from('profiles').select('role').eq('id', ppId).single();
      roleResidual = pr?.role === 'patient' ? 0 : 1;
      console.log(`  · role del test patient: ${pr?.role} ${roleResidual === 0 ? '(restaurado a patient ✓)' : '(⚠ NO es patient)'}`);
    }
    residuals += roleResidual;

    if (residuals === 0) ok('cleanup: 0 residuales F50_FIXTURE');
    else ko(`cleanup: ${residuals} residuales F50_FIXTURE`);
  } catch (e) {
    ko('cleanup/verificación de residuales falló: ' + e.message);
  }

  await patient.auth.signOut().catch(() => {});
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_50 OK' : '❌ SMOKE s7_50 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
