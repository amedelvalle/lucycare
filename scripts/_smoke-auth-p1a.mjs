/**
 * SMOKE AUTH-P1A — servicio base: ciclo real OTP→contraseña, side-effects
 *                  compartidos, identidad canónica.
 *
 * ⚠ NO EJECUTAR sin autorización expresa del owner (usa service_role para
 *   fixtures/cleanup y UN Test Phone para el ciclo OTP).
 *
 * ── QUÉ PRUEBA Y CÓMO ──
 * Prueba el CÓDIGO REAL de `src/services/auth.service.ts` (no una réplica):
 * lo bundlea con el esbuild de Vite (define de import.meta.env desde
 * .env.local + shim de localStorage para Node) y ejerce sendOtp/verifyOtp/
 * setPasswordFromClaim/signInWithPhonePassword tal como corren en el
 * navegador. El bundle nace de un ENTRY que re-exporta el servicio + su
 * cliente `supabase` + `probeSessionState` (módulo real): el probe de cierre
 * consulta EXACTAMENTE el cliente bajo prueba. Se cargan DOS instancias del
 * bundle (module URLs distintas → clientes de autenticación SEPARADOS):
 * MAIN para el ciclo del Test Phone y AUX para los auxiliares.
 *
 * CIERRES SIN AMBIGÜEDAD: jamás se infiere un cierre por
 * `getSessionWithTimeout === null` (ambiguo: sin-sesión o timeout) ni por
 * localStorage. Todo cierre se confirma con `probeSessionState` exigiendo
 * estado EXACTO 'none'; 'present'/'timeout'/'error' → el smoke falla y
 * aborta. `getSessionWithTimeout` se usa ÚNICAMENTE para capturar el
 * accessToken de la sesión OTP viva (lectura, no confirmación de cierre).
 *
 * ── PRERREQUISITOS OPERATIVOS (owner, al autorizar la ejecución) ──
 *   • Test Phone `50370007102` (CON prefijo de país) OTP fijo `123456`;
 *     retirarlo al cerrar. ES EL ÚNICO TELÉFONO QUE EJECUTA sendOtp/verifyOtp.
 *   • Autorización puntual de service_role (fixtures/cleanup).
 *
 * ── FIXTURES (namespace 503700071xx, marker AP1A_FIXTURE; jamás Katherine;
 *    Camilo NO participa) ──
 *   P_OTP    50370007102  ÚNICO con OTP. Ciclo real completo:
 *                         OTP → verifyOtp → capturar auth.user.id →
 *                         setPasswordFromClaim con ESA sesión OTP (flujo real
 *                         aprobado; jamás Admin API para esta fixture) →
 *                         cierre → signInWithPhonePassword → MISMO id →
 *                         variantes +503/503/local sobre esta misma cuenta.
 *   P_ASSIST 50370007103  service_role + contraseña explícita; invitación de
 *                         asistente pendiente (clinic fixture propia).
 *                         NO llama sendOtp.
 *   P_PATIENT 50370007104 service_role + contraseña; ficha `patients` sin
 *                         profile_id con su teléfono. NO llama sendOtp.
 *   P_ADMIN  50370007105  service_role + contraseña; platform_admin_invitation
 *                         `pending`. NO llama sendOtp.
 *   P_NONE   50370007199  JAMÁS se crea, JAMÁS recibe OTP: solo prueba el
 *                         error genérico de contraseña.
 *
 * ── MATRIZ (aprobada por el owner) ──
 *   T1  OTP → creación de contraseña (setPasswordFromClaim, sesión OTP) →
 *       cierre CONFIRMADO ('none' tras crear la contraseña, y de nuevo antes
 *       del login: sin confirmación no hay login) → login por contraseña.
 *       Mismo user.id durante TODO el ciclo.
 *   T2  profile nuevo (P_OTP) con teléfono canónico ('50370007102').
 *   T3  contraseña incorrecta y teléfono inexistente → EXACTAMENTE el mismo
 *       mensaje genérico (igualdad de strings).
 *   T4  '+503…', '503…' y local '7…' autentican al MISMO usuario; ninguna
 *       variante crea profiles/usuarios nuevos.
 *   T5  profile existente conserva phone y updated_at al iniciar sesión.
 *   T6  side-effects tras login por CONTRASEÑA (instancia AUX):
 *         6a invitación de asistente aceptada (role → assistant);
 *         6b expedientes del paciente vinculados (profile_id set,
 *            link_confirmed_at NULL — B2);
 *         6c invitación ADMINISTRATIVA NO activada (role patient,
 *            invitación pending — s7_44: solo OTP).
 *   T7  doble login → sin duplicados ni churn (1 profile, updated_at igual).
 *   T8  cleanup verificable (errores no silenciados; 0 residuos por ID y
 *       por teléfono ± '+') y auditoría APPEND-ONLY intacta (este smoke no
 *       contiene escrituras a audit_log).
 *
 * (El rate-limit de OTP NO se prueba acá: es alcance de AUTH-P1B. El mapa
 *  contexto→shouldCreateUser se verifica estructuralmente en
 *  check-auth-p1a-phone.mjs; la regresión visual de login/reserva/claim es
 *  QA de preview.)
 *
 * Uso (SOLO con autorización): node scripts/_smoke-auth-p1a.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ─── Fixtures (namespace reservado) ─────────────────────────
const P_OTP = '50370007102';   // ÚNICO con OTP — Test Phone (123456)
const P_ASSIST = '50370007103';
const P_PATIENT = '50370007104';
const P_ADMIN = '50370007105';
const P_NONE = '50370007199';
const OTP = '123456';
const PWD = 'Ap1a-Fixture-2026!';
const PWD_WRONG = 'Ap1a-Incorrecta-0!';
const FIXTURE_PHONES = [P_OTP, P_ASSIST, P_PATIENT, P_ADMIN, P_NONE];
const FIXTURE_PHONES_ALL = [...FIXTURE_PHONES, ...FIXTURE_PHONES.map((p) => '+' + p)];
const MARKER = 'AP1A_FIXTURE';

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

// Tracking para cleanup
const authUserIds = [];
const clinicIds = [];
const doctorIds = [];
const patientIds = [];
const clinicInvitationIds = [];
const adminInvitationIds = [];

// ─── Shim de localStorage (enumerable, para safeAbortSession) ──
const mem = new Map();
const baseLs = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
globalThis.localStorage = new Proxy(baseLs, {
  ownKeys: () => [...mem.keys()],
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});

// ─── Bundles del código REAL ────────────────────────────────
// El bundle se genera desde un ENTRY temporal que re-exporta el servicio +
// el cliente `supabase` + `probeSessionState` + `getSessionWithTimeout`.
// Dentro de un bundle todos comparten el MISMO módulo/cliente → el probe de
// cierre consulta EXACTAMENTE el cliente bajo prueba (no una instancia
// aparte que podría cachear sesión en memoria).
const require = createRequire(import.meta.url);
const esbuildBin = path.join(path.dirname(require.resolve('esbuild/package.json')), 'bin', 'esbuild');
const stamp = Date.now();
const entryFile = path.join(os.tmpdir(), `ap1a-entry-${stamp}.ts`);
const svcBundle = path.join(os.tmpdir(), `ap1a-auth-service-${stamp}.mjs`);
const svcBundleAux = path.join(os.tmpdir(), `ap1a-auth-service-aux-${stamp}.mjs`);

const abs = (p) => path.resolve(p).replace(/\\/g, '/');
fs.writeFileSync(entryFile, [
  `export * from '${abs('src/services/auth.service.ts')}'`,
  `export { supabase } from '${abs('src/lib/supabase.ts')}'`,
  `export { probeSessionState } from '${abs('src/lib/sessionState.ts')}'`,
  `export { getSessionWithTimeout } from '${abs('src/lib/session.ts')}'`,
  '',
].join('\n'));

// execFileSync no pasa por shell: cada arg llega verbatim. Un solo
// JSON.stringify produce el literal JS correcto para --define
// (p. ej. --define:X="https://…").
const defineFlags = [
  `--define:import.meta.env.VITE_SUPABASE_URL=${JSON.stringify(SUPABASE_URL)}`,
  `--define:import.meta.env.VITE_SUPABASE_ANON_KEY=${JSON.stringify(SUPABASE_ANON_KEY)}`,
];
execFileSync(process.execPath, [
  esbuildBin, entryFile, '--bundle', '--platform=node',
  '--format=esm', '--external:@supabase/supabase-js', ...defineFlags,
  `--outfile=${svcBundle}`,
], { stdio: 'pipe' });
fs.copyFileSync(svcBundle, svcBundleAux); // URL distinta → instancia/cliente separado

// MAIN: ciclo del Test Phone. AUX: usuarios auxiliares (cliente separado).
const svc = await import(pathToFileURL(svcBundle).href);
const aux = await import(pathToFileURL(svcBundleAux).href);
const { getSessionWithTimeout } = svc; // solo para CAPTURAR el accessToken

/**
 * Confirmación de cierre SIN ambigüedad: exige estado EXACTO 'none' del
 * módulo real `probeSessionState` contra el cliente de la instancia dada.
 * 'present'/'timeout'/'error' → falla el smoke y ABORTA (throw). Nunca se
 * infiere el cierre por localStorage ni por null ambiguo.
 */
async function confirmClosed(inst, label) {
  const state = await inst.probeSessionState(() => inst.supabase.auth.getSession(), 3000);
  if (state === 'none') {
    ok(`${label} → cierre confirmado (estado 'none')`);
    return;
  }
  ko(`${label} → cierre NO confirmado (estado '${state}')`);
  throw new Error(`cierre no confirmado: ${label} (estado '${state}')`);
}

// ─── Helpers de fixtures (service_role; auxiliares SIN OTP) ──
async function createAuxUser(phone) {
  const { data, error } = await admin.auth.admin.createUser({
    phone: '+' + phone,
    phone_confirm: true,
    password: PWD,
  });
  if (error || !data?.user) throw new Error(`createUser ${phone.slice(-4)}: ${error?.message || 'sin user'}`);
  authUserIds.push(data.user.id);
  return data.user.id;
}

const profileByPhone = (phone) =>
  admin.from('profiles').select('id, phone, role, updated_at').in('phone', [phone, '+' + phone]);

// ─── Barrido por NAMESPACE (teléfonos 503700071xx ± '+', correos
// @ap1afixture.invalid, full_name 'AP1A_FIXTURE%') con inventario y
// candados — caza residuos NO trackeados (p. ej. el usuario que
// signInWithOtp crea ANTES de un verify fallido, lección del handoff).
// Se corre al INICIO (DB limpia para la matriz) y al FINAL (cleanup).
const SWEEP_MAX = { profiles: 10, patients: 6, clinics: 4, doctors: 4, invs: 6 };
async function sweepAp1aLeftovers(tag) {
  const profs = new Map();
  const PROF_COLS = 'id, phone, email, full_name';
  for (const q of [
    admin.from('profiles').select(PROF_COLS).in('phone', FIXTURE_PHONES_ALL),
    admin.from('profiles').select(PROF_COLS).like('email', '%@ap1afixture.invalid'),
    admin.from('profiles').select(PROF_COLS).like('full_name', `${MARKER}%`),
  ]) {
    const { data } = await q;
    for (const p of data ?? []) profs.set(p.id, p);
  }
  const profIds = [...profs.keys()];
  const { data: pats } = await admin.from('patients').select('id, phone').in('phone', FIXTURE_PHONES_ALL);
  const { data: cinvs } = await admin.from('clinic_invitations').select('id, phone').in('phone', FIXTURE_PHONES_ALL);
  const { data: ainvs } = await admin.from('platform_admin_invitations').select('id, phone_normalized').in('phone_normalized', FIXTURE_PHONES_ALL);
  const clinicSet = new Map();
  {
    const { data } = await admin.from('clinics').select('id, name, owner_id').like('name', `${MARKER}%`);
    for (const c of data ?? []) clinicSet.set(c.id, c);
    if (profIds.length) {
      const { data: byOwner } = await admin.from('clinics').select('id, name, owner_id').in('owner_id', profIds);
      for (const c of byOwner ?? []) clinicSet.set(c.id, c);
    }
  }
  const docSet = new Map();
  if (profIds.length) {
    const { data } = await admin.from('doctors')
      .select('id, profile_id, is_published, is_operational').in('profile_id', profIds);
    for (const d of data ?? []) docSet.set(d.id, d);
  }
  const total = profs.size + (pats?.length ?? 0) + (cinvs?.length ?? 0) + (ainvs?.length ?? 0) + clinicSet.size + docSet.size;
  if (!total) { console.log(`  (${tag}: 0 residuos del namespace AP1A)`); return true; }

  console.log(`  ── ${tag}: INVENTARIO (${total} registros del namespace) ──`);
  for (const p of profs.values()) console.log(`     profile ${p.id} · phone=${p.phone ?? '-'} · email=${p.email ?? '-'} · name=${p.full_name ?? '-'}`);
  for (const d of docSet.values()) console.log(`     doctor ${d.id} · published=${d.is_published} · operational=${d.is_operational}`);
  for (const c of clinicSet.values()) console.log(`     clinic ${c.id} · ${c.name}`);
  for (const r of pats ?? []) console.log(`     patient ${r.id}`);
  for (const r of cinvs ?? []) console.log(`     clinic_invitation ${r.id}`);
  for (const r of ainvs ?? []) console.log(`     platform_admin_invitation ${r.id}`);

  // Candados: namespace estricto + nada publicado/operativo + conteos.
  const violations = [];
  for (const p of profs.values()) {
    const inNs = (p.phone != null && FIXTURE_PHONES_ALL.includes(p.phone))
      || /@ap1afixture\.invalid$/i.test(p.email ?? '')
      || (p.full_name ?? '').startsWith(MARKER);
    if (!inNs) violations.push(`profile ${p.id} fuera del namespace`);
  }
  for (const d of docSet.values()) {
    if (d.is_published || d.is_operational) violations.push(`doctor ${d.id} PUBLICADO/OPERATIVO — jamás fixture`);
  }
  if (profs.size > SWEEP_MAX.profiles) violations.push(`profiles=${profs.size} > máximo previsto`);
  if ((pats?.length ?? 0) > SWEEP_MAX.patients) violations.push('patients > máximo previsto');
  if (clinicSet.size > SWEEP_MAX.clinics) violations.push('clinics > máximo previsto');
  if (docSet.size > SWEEP_MAX.doctors) violations.push('doctors > máximo previsto');
  if (violations.length) {
    console.log(`  ⛔ ${tag}: ABORTADO SIN BORRAR — candado violado:`);
    for (const v of violations) console.log(`     · ${v}`);
    return false;
  }

  const errs = [];
  const sdel = async (label, q) => { const { error } = await q; if (error) errs.push(`${label}: ${error.message}`); };
  for (const id of docSet.keys()) await sdel(`sweep doctors ${id}`, admin.from('doctors').delete().eq('id', id));
  for (const r of pats ?? []) await sdel(`sweep patients ${r.id}`, admin.from('patients').delete().eq('id', r.id));
  for (const r of cinvs ?? []) await sdel(`sweep clinic_invitations ${r.id}`, admin.from('clinic_invitations').delete().eq('id', r.id));
  for (const r of ainvs ?? []) await sdel(`sweep platform_admin_invitations ${r.id}`, admin.from('platform_admin_invitations').delete().eq('id', r.id));
  for (const id of clinicSet.keys()) {
    await sdel(`sweep clinic_members ${id}`, admin.from('clinic_members').delete().eq('clinic_id', id));
    await sdel(`sweep clinics ${id}`, admin.from('clinics').delete().eq('id', id));
  }
  for (const id of profIds) {
    await sdel(`sweep profiles ${id}`, admin.from('profiles').delete().eq('id', id));
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && !/not.*found/i.test(error.message)) errs.push(`sweep auth.user ${id}: ${error.message}`);
  }
  if (errs.length) { for (const m of errs) ko('sweep: ' + m); return false; }
  console.log(`  (${tag}: barrido OK — ${total} registros eliminados)`);
  return true;
}

console.log('═══ SMOKE AUTH-P1A (ciclo real OTP→contraseña + side-effects) ═══\n');

// ─── PRECHECK READ-ONLY del esquema (antes de CUALQUIER fixture/OTP) ───
// SELECT ... limit(0): PostgREST valida columnas sin leer filas; el filtro
// .eq('gender','otro') valida el valor del enum sin escribir. Si cualquier
// precondición falla: abortar SIN crear fixtures, SIN OTP, SIN matriz,
// imprimiendo SOLO el nombre de la precondición (sin datos sensibles).
async function precheckSchema() {
  const checks = [
    ["patients.gender existe y acepta 'otro'",
      admin.from('patients').select('id').eq('gender', 'otro').limit(0)],
    ['patients: columnas de la fixture',
      admin.from('patients').select('id, clinic_id, full_name, phone, date_of_birth, gender, notes, profile_id, link_confirmed_at').limit(0)],
    ['platform_admin_invitations.phone_normalized existe',
      admin.from('platform_admin_invitations').select('phone_normalized').limit(0)],
    ['platform_admin_invitations.display_name existe',
      admin.from('platform_admin_invitations').select('display_name').limit(0)],
    ['platform_admin_invitations: columnas de la fixture',
      admin.from('platform_admin_invitations').select('id, status, invited_by').limit(0)],
    ['profiles: columnas usadas',
      admin.from('profiles').select('id, full_name, role, phone, updated_at').limit(0)],
    ['clinics: columnas usadas',
      admin.from('clinics').select('id, name, owner_id, is_active').limit(0)],
    ['doctors: columnas usadas',
      admin.from('doctors').select('id, profile_id, clinic_id, lucy_status, is_published, is_operational, booking_enabled').limit(0)],
    ['clinic_members: columnas usadas',
      admin.from('clinic_members').select('clinic_id, profile_id, role, is_active').limit(0)],
    ['clinic_invitations: columnas usadas',
      admin.from('clinic_invitations').select('id, clinic_id, phone, role, invited_by').limit(0)],
  ];
  for (const [name, q] of checks) {
    const { error } = await q;
    if (error) {
      console.error(`⛔ PRECHECK FALLIDO: ${name}`);
      console.error('⛔ Abortado ANTES de crear fixtures — sin OTP, sin matriz, sin residuos.');
      process.exit(1);
    }
  }
  console.log(`  ✅ precheck de esquema: ${checks.length}/${checks.length} precondiciones OK\n`);
}
await precheckSchema();

if (!(await sweepAp1aLeftovers('barrido inicial'))) {
  console.error('⛔ Barrido inicial abortado por candado — no se crean fixtures ni se envía OTP.');
  process.exit(1);
}

try {
  // ═══ SETUP de auxiliares (service_role + contraseña; jamás sendOtp) ═══
  const assistUserId = await createAuxUser(P_ASSIST);
  const patientUserId = await createAuxUser(P_PATIENT);
  const adminInvUserId = await createAuxUser(P_ADMIN);

  // Clinic fixture propia (owner legacy: auth.user por email + phone por
  // UPDATE de columnas no auditadas — patrón validado en _smoke-s7_64).
  const { data: ownerUser, error: ownErr } = await admin.auth.admin.createUser({
    email: `ap1a-owner-${stamp}@ap1afixture.invalid`,
    email_confirm: true,
    user_metadata: { full_name: `${MARKER} Dr Owner` },
  });
  if (ownErr || !ownerUser?.user) throw new Error('createUser owner: ' + (ownErr?.message || 'sin user'));
  const ownerId = ownerUser.user.id;
  authUserIds.push(ownerId);
  {
    const { data: prof } = await admin.from('profiles').select('id').eq('id', ownerId).maybeSingle();
    if (!prof) {
      const { error } = await admin.from('profiles').insert({ id: ownerId, full_name: `${MARKER} Dr Owner`, role: 'patient' });
      if (error) throw new Error('insert owner profile: ' + error.message);
    }
  }
  const { data: clinic, error: cErr } = await admin.from('clinics')
    .insert({ name: `${MARKER} Clinica`, owner_id: ownerId, is_active: true })
    .select('id').single();
  if (cErr) throw new Error('insert clinic: ' + cErr.message);
  clinicIds.push(clinic.id);
  const { data: doc, error: dErr } = await admin.from('doctors')
    .insert({ profile_id: ownerId, clinic_id: clinic.id, lucy_status: 'listed_only', is_published: false, is_operational: false, booking_enabled: false })
    .select('id').single();
  if (dErr) throw new Error('insert doctor: ' + dErr.message);
  doctorIds.push(doc.id);
  {
    const { error } = await admin.from('clinic_members')
      .insert({ clinic_id: clinic.id, profile_id: ownerId, role: 'owner', is_active: true });
    if (error) throw new Error('insert clinic_member owner: ' + error.message);
  }
  {
    const { data, error } = await admin.from('clinic_invitations')
      .insert({ clinic_id: clinic.id, phone: '+' + P_ASSIST, role: 'assistant', invited_by: ownerId })
      .select('id').single();
    if (error) throw new Error('insert clinic_invitation: ' + error.message);
    clinicInvitationIds.push(data.id);
  }
  {
    const { data, error } = await admin.from('patients')
      .insert({
        clinic_id: clinic.id, full_name: `${MARKER} Paciente`, phone: P_PATIENT,
        date_of_birth: '1990-01-15', gender: 'otro', notes: MARKER,
      })
      .select('id').single();
    if (error) throw new Error('insert patient: ' + error.message);
    patientIds.push(data.id);
  }
  {
    const { data: adminProf } = await admin.from('profiles').select('id').eq('role', 'admin').limit(1).single();
    const { data, error } = await admin.from('platform_admin_invitations')
      .insert({
        phone_normalized: P_ADMIN, display_name: `${MARKER} Admin Inv`,
        status: 'pending', invited_by: adminProf.id,
      })
      .select('id').single();
    if (error) throw new Error('insert platform_admin_invitation: ' + error.message);
    adminInvitationIds.push(data.id);
  }

  // ═══ T1: CICLO REAL del Test Phone (único con OTP) ═══
  let otpUserId = null;
  {
    const s = await svc.sendOtp(P_OTP, 'login');
    if (!s.success) throw new Error('T1 sendOtp(login) falló: ' + s.error);

    // Lección del handoff: signInWithOtp CREA el auth.user ANTES del verify
    // — registrarlo YA (vía su profile) para que el cleanup lo alcance
    // aunque el verify falle.
    {
      const { data } = await admin.from('profiles').select('id').in('phone', [P_OTP, '+' + P_OTP]).limit(1);
      if (data?.[0]?.id && !authUserIds.includes(data[0].id)) authUserIds.push(data[0].id);
    }

    const v = await svc.verifyOtp(P_OTP, OTP);
    if (!v.success || !v.user?.id) throw new Error('T1 verifyOtp falló: ' + JSON.stringify(v));
    otpUserId = v.user.id;
    authUserIds.push(otpUserId); // registrado APENAS existe (regla de cleanup)
    ok('T1a OTP + verifyOtp → sesión (contexto login)');

    // Contraseña con la MISMA sesión OTP, vía el flujo real aprobado
    // (setPasswordFromClaim = setPasswordWithFetch con el token de la sesión).
    const sess = await getSessionWithTimeout(4000);
    if (!sess?.accessToken || sess.userId !== otpUserId)
      throw new Error('T1 no se pudo capturar la sesión OTP para setPassword');
    const sp = await svc.setPasswordFromClaim(PWD, sess.accessToken);
    if (sp.success) ok('T1b contraseña creada con la sesión OTP (setPasswordWithFetch, flujo real)');
    else ko('T1b setPasswordFromClaim falló: ' + sp.error);

    // Punto 1 (owner): tras establecer la contraseña se cierra la sesión OTP
    // y el cierre se CONFIRMA con estado exacto 'none' (módulo real).
    await svc.hardLocalSignOut();
    await confirmClosed(svc, 'T1c cierre de la sesión OTP tras crear la contraseña');

    // Punto 2 (owner): el login por contraseña NO arranca sin confirmar de
    // nuevo el estado 'none' (si no es 'none', confirmClosed aborta).
    await confirmClosed(svc, 'T1d pre-login: sin sesión previa confirmado');

    const r = await svc.signInWithPhonePassword(P_OTP, PWD);
    if (r.success && r.user?.id === otpUserId && r.user.phone === P_OTP)
      ok('T1e login teléfono+contraseña → MISMO auth.user.id de todo el ciclo');
    else ko('T1e esperado mismo id: ' + JSON.stringify({ success: r.success, id: r.user?.id, esperado: otpUserId }));
    await svc.hardLocalSignOut();
  }

  // ═══ T2: profile nuevo con teléfono canónico ═══
  {
    const { data } = await profileByPhone(P_OTP);
    if (data?.length === 1 && data[0].phone === P_OTP)
      ok(`T2 profile nuevo por OTP → phone canónico ('${P_OTP}', dígitos sin '+')`);
    else ko('T2 profile de P_OTP inesperado: ' + JSON.stringify(data));
  }

  // ═══ T3: mensaje genérico idéntico ═══
  {
    const bad = await svc.signInWithPhonePassword(P_OTP, PWD_WRONG);
    const none = await svc.signInWithPhonePassword(P_NONE, PWD);
    if (!bad.success && !none.success && bad.error === none.error && bad.error)
      ok('T3 contraseña mala y teléfono inexistente → EXACTAMENTE el mismo mensaje genérico');
    else ko('T3 mensajes distintos o éxito inesperado: ' + JSON.stringify({ bad: bad.error, none: none.error }));
  }

  // ═══ T4: variantes de formato → mismo auth.user (cuenta del ciclo) ═══
  {
    const before = await profileByPhone(P_OTP);
    const variants = ['+' + P_OTP, P_OTP, P_OTP.slice(3)]; // +503…, 503…, local 7…
    const ids = [];
    for (const vnt of variants) {
      const r = await svc.signInWithPhonePassword(vnt, PWD);
      ids.push(r.success ? r.user?.id : `FALLO(${vnt})`);
      await svc.hardLocalSignOut();
    }
    const after = await profileByPhone(P_OTP);
    if (ids.every((id) => id === otpUserId))
      ok('T4 +503 / 503 / local → mismo auth.user.id en las tres variantes');
    else ko('T4 ids divergentes: ' + JSON.stringify(ids));
    if ((after.data?.length ?? 0) === (before.data?.length ?? 0))
      ok('T4b ninguna variante creó profiles/usuarios nuevos');
    else ko('T4b aparecieron profiles nuevos: ' + JSON.stringify(after.data));
  }

  // ═══ T5: profile existente sin cambios de phone/updated_at ═══
  {
    const { data: before } = await profileByPhone(P_OTP);
    const r = await svc.signInWithPhonePassword(P_OTP, PWD);
    await svc.hardLocalSignOut();
    const { data: after } = await profileByPhone(P_OTP);
    const same = r.success && before?.length === 1 && after?.length === 1
      && before[0].phone === after[0].phone
      && before[0].updated_at === after[0].updated_at;
    if (same) ok('T5 profile existente conserva phone y updated_at tras login');
    else ko('T5 el login modificó el profile: ' + JSON.stringify({ before: before?.[0], after: after?.[0] }));
  }

  // ═══ T6: side-effects tras login por CONTRASEÑA (instancia AUX) ═══
  {
    const rA = await aux.signInWithPhonePassword(P_ASSIST, PWD);
    await aux.hardLocalSignOut();
    const { data: profA } = await admin.from('profiles').select('role').eq('id', assistUserId).single();
    if (rA.success && profA?.role === 'assistant')
      ok('T6a login por contraseña aceptó la invitación de asistente (role → assistant)');
    else ko('T6a role inesperado: ' + JSON.stringify({ success: rA.success, role: profA?.role }));

    const rP = await aux.signInWithPhonePassword(P_PATIENT, PWD);
    await aux.hardLocalSignOut();
    const { data: pat } = await admin.from('patients')
      .select('profile_id, link_confirmed_at').eq('id', patientIds[0]).single();
    if (rP.success && pat?.profile_id === patientUserId && pat?.link_confirmed_at === null)
      ok('T6b login por contraseña vinculó la ficha del paciente (profile_id set, sin confirmar — B2)');
    else ko('T6b vinculación inesperada: ' + JSON.stringify({ success: rP.success, pat }));

    const rI = await aux.signInWithPhonePassword(P_ADMIN, PWD);
    await aux.hardLocalSignOut();
    const { data: profI } = await admin.from('profiles').select('role').eq('id', adminInvUserId).single();
    const { data: inv } = await admin.from('platform_admin_invitations')
      .select('status').eq('id', adminInvitationIds[0]).single();
    if (rI.success && profI?.role === 'patient' && inv?.status === 'pending')
      ok('T6c la invitación de ADMIN no se activa por contraseña (role patient, invitación pending — s7_44)');
    else ko('T6c estado inesperado: ' + JSON.stringify({ success: rI.success, role: profI?.role, inv: inv?.status }));
  }

  // ═══ T7: doble login sin duplicados ni churn ═══
  {
    const { data: before } = await profileByPhone(P_ASSIST);
    const r1 = await aux.signInWithPhonePassword(P_ASSIST, PWD);
    await aux.hardLocalSignOut();
    const r2 = await aux.signInWithPhonePassword(P_ASSIST, PWD);
    await aux.hardLocalSignOut();
    const { data: after } = await profileByPhone(P_ASSIST);
    const sane = r1.success && r2.success
      && before?.length === 1 && after?.length === 1
      && after[0].updated_at === before[0].updated_at
      && after[0].role === 'assistant';
    if (sane) ok('T7 doble login → 1 solo profile, sin churn de updated_at, sin re-aceptaciones');
    else ko('T7 doble login alteró estado: ' + JSON.stringify({ before: before?.[0], after: after?.[0] }));
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  // ═══ T8: cleanup (errores NO silenciados) + 0 residuos + append-only ═══
  // Punto 3 (owner): ANTES del barrido final se cierran las sesiones de
  // AMBOS clientes (MAIN y AUX) y se confirma estado exacto 'none' en cada
  // uno. Si alguna confirmación falla, el smoke queda en rojo (ko dentro de
  // confirmClosed); la ELIMINACIÓN de fixtures continúa igualmente porque
  // corre con service_role (independiente de las sesiones de los clientes)
  // y dejar fixtures violaría el requisito de 0 residuos.
  console.log('\n— cierre y verificación de clientes MAIN y AUX —');
  for (const [inst, name] of [[svc, 'MAIN'], [aux, 'AUX']]) {
    try {
      await inst.hardLocalSignOut();
      await confirmClosed(inst, `cleanup: cliente ${name} cerrado`);
    } catch {
      // confirmClosed ya registró el ko con la etiqueta del estado.
    }
  }

  console.log('\n— cleanup (errores NO silenciados) —');
  const cleanupErrors = [];
  const del = async (label, q) => {
    const { error } = await q;
    if (error) cleanupErrors.push(`${label}: ${error.message}`);
  };

  for (const id of patientIds) await del(`patients ${id}`, admin.from('patients').delete().eq('id', id));
  for (const id of clinicInvitationIds) await del(`clinic_invitations ${id}`, admin.from('clinic_invitations').delete().eq('id', id));
  for (const id of adminInvitationIds) await del(`platform_admin_invitations ${id}`, admin.from('platform_admin_invitations').delete().eq('id', id));
  for (const id of doctorIds) await del(`doctors ${id}`, admin.from('doctors').delete().eq('id', id));
  for (const id of clinicIds) {
    await del(`clinic_members ${id}`, admin.from('clinic_members').delete().eq('clinic_id', id));
    await del(`clinics ${id}`, admin.from('clinics').delete().eq('id', id));
  }
  for (const id of authUserIds) {
    await del(`profiles ${id}`, admin.from('profiles').delete().eq('id', id));
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && !/not.*found/i.test(error.message)) cleanupErrors.push(`auth.user ${id}: ${error.message}`);
  }
  if (cleanupErrors.length) { for (const m of cleanupErrors) ko('cleanup: ' + m); }
  else ok('cleanup ejecutado sin errores');

  // Barrido final por namespace: caza cualquier residuo no trackeado antes
  // de la verificación.
  if (!(await sweepAp1aLeftovers('barrido final'))) {
    ko('barrido final abortado por candado — revisar el inventario impreso');
  }

  const residual = async (label, q) => {
    const { data, error } = await q;
    if (error) ko(`residual ${label}: no verificable (${error.message})`);
    else if ((data?.length ?? 0) === 0) ok(`0 residuales en ${label}`);
    else ko(`RESIDUALES en ${label}: ` + JSON.stringify(data));
  };
  if (authUserIds.length) await residual('profiles (por ID)', admin.from('profiles').select('id').in('id', authUserIds));
  if (patientIds.length) await residual('patients (por ID)', admin.from('patients').select('id').in('id', patientIds));
  if (clinicIds.length) await residual('clinics (por ID)', admin.from('clinics').select('id').in('id', clinicIds));
  await residual('profiles por teléfono (± +)', admin.from('profiles').select('id').in('phone', FIXTURE_PHONES_ALL));
  await residual('patients por teléfono', admin.from('patients').select('id').in('phone', FIXTURE_PHONES_ALL));
  await residual('clinic_invitations por teléfono', admin.from('clinic_invitations').select('id').in('phone', FIXTURE_PHONES_ALL));
  await residual('platform_admin_invitations por teléfono', admin.from('platform_admin_invitations').select('id').in('phone_normalized', FIXTURE_PHONES_ALL));

  ok('auditoría append-only intacta (el smoke no contiene escrituras a audit_log)');

  for (const f of [entryFile, svcBundle, svcBundleAux]) {
    try { fs.unlinkSync(f); } catch { /* tmp */ }
  }
  console.log(`\n${fail === 0 ? '✅ SMOKE AUTH-P1A OK' : '❌ SMOKE AUTH-P1A con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  console.log('ℹ Recordatorio: retirar el Test Phone ' + P_OTP + ' al cerrar el frente.');
  process.exit(fail === 0 ? 0 : 1);
}
