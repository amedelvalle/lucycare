/**
 * _smoke-s7_71a.mjs — AUDIT-SEC-P0 · PR 1: cobertura server-side de appointments.
 *
 * ── MODOS ──────────────────────────────────────────────────────────────
 *
 *   node scripts/_smoke-s7_71a.mjs
 *       Guard. Imprime la ayuda y sale con 0. NO toca la DB.
 *
 *   ASP0_RUN_ID=<id> node scripts/_smoke-s7_71a.mjs --preflight
 *       READ-ONLY. No escribe ni crea nada. Reporta las identidades
 *       sintéticas EXACTAS que usaría --run, verifica que no colisionen con
 *       nada existente ni con datos reales, y comprueba precondiciones.
 *       Debe revisarlo y autorizarlo el owner ANTES de --run.
 *
 *   ASP0_RUN_ID=<id> ASP0_SMOKE_AUTHORIZED=1 \
 *     node scripts/_smoke-s7_71a.mjs --run
 *       ESCRIBE. Requiere autorización explícita del owner.
 *
 *   …--run --include-sign
 *       Añade el caso de firma de consulta. SOLO local/staging: en
 *       producción esa ruta se prueba con el bloque owner-only
 *       BEGIN/ROLLBACK de docs/OWNER_S7_71A_APPLY.md §13.
 *
 * `ASP0_RUN_ID` es OBLIGATORIO en ambos modos y fija las identidades de
 * forma determinista: --preflight y --run usan EXACTAMENTE las mismas. El
 * script nunca inventa ni cambia identidades en silencio.
 *
 * ── REGLAS DE DATOS (vinculantes) ──────────────────────────────────────
 *   • Fixtures SINTÉTICAS creadas desde cero y marcadas `S7_71_FIXTURE`.
 *   • JAMÁS Katherine. JAMÁS Camilo. JAMÁS Test Phones reservados. Los
 *     números prohibidos viven en FORBIDDEN_PHONES y solo actúan como
 *     GUARDA que aborta: nunca como fixture, destino, fallback ni argumento
 *     de Auth, tabla o RPC.
 *   • Usuarios Auth creados y eliminados SIEMPRE por la Admin API
 *     (`auth.admin.createUser` / `auth.admin.deleteUser`). NUNCA por SQL
 *     sobre `auth.users`.
 *   • Todo el bloque de escrituras va en try/finally: el cleanup corre
 *     aunque una aserción falle a mitad.
 *   • El borrado de `audit_log` usa una ALLOWLIST explícita de los UUID de
 *     la corrida. `created_at >= RUN_STARTED_AT` es condición ADICIONAL,
 *     nunca criterio suficiente. Si aparece un record_id fuera de la
 *     allowlist, se ABORTA sin borrar.
 *   • Verificación final de CERO residuos; si queda alguno, exit ≠ 0.
 *
 * ── QUÉ **NO** SE PRUEBA ACÁ (y dónde sí) ──────────────────────────────
 *   · Explotación del agujero de `audit_log`: solo local/staging, nunca
 *     contra producción. Quedó probada documentalmente en la Fase 0.
 *   · `actor_kind='db_direct'` y contexto rechazado: exigen conexión sin
 *     JWT y `set_config` server-side, no alcanzables desde PostgREST.
 *     Bloques owner-only §11 y §12 de la guía.
 *   · Firma de consulta en producción: bloque owner-only §13 (ver arriba).
 *   · Cierre de privilegios: es s7_71b.
 */
import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './_lib/env.mjs';

// ═════════════════════════════════════════════════════════════════════
// MODO Y GUARDS
// ═════════════════════════════════════════════════════════════════════
const ARGV = process.argv.slice(2);
const WANT_PREFLIGHT = ARGV.includes('--preflight');
const WANT_RUN = ARGV.includes('--run');
const INCLUDE_SIGN = ARGV.includes('--include-sign');
const AUTHORIZED = process.env.ASP0_SMOKE_AUTHORIZED === '1';
const RUN_ID = (process.env.ASP0_RUN_ID || '').trim();

const HELP = `
_smoke-s7_71a — modos disponibles

  1) PREFLIGHT (read-only, no escribe nada):
       ASP0_RUN_ID=<id> node scripts/_smoke-s7_71a.mjs --preflight

  2) CORRIDA (escribe; requiere autorización del owner):
       ASP0_RUN_ID=<id> ASP0_SMOKE_AUTHORIZED=1 \\
         node scripts/_smoke-s7_71a.mjs --run

  <id>: 4-12 caracteres [a-z0-9]. Fija las identidades sintéticas de forma
        determinista, para que --preflight y --run usen EXACTAMENTE las
        mismas y el owner pueda autorizarlas antes de escribir.

Requisitos: migración s7_71a aplicada · SUPABASE_URL, SUPABASE_ANON_KEY y
SUPABASE_SERVICE_ROLE_KEY en .env.local.

No se tocó la base de datos.
`;

if (!WANT_PREFLIGHT && !WANT_RUN) { console.log(HELP); process.exit(0); }
if (WANT_RUN && !AUTHORIZED) {
  console.log(`\n⛔ --run sin ASP0_SMOKE_AUTHORIZED=1. No se tocó la base de datos.\n${HELP}`);
  process.exit(0);
}
if (!/^[a-z0-9]{4,12}$/.test(RUN_ID)) {
  console.log(`\n⛔ Falta ASP0_RUN_ID válido (4-12 caracteres [a-z0-9]).\n${HELP}`);
  process.exit(0);
}

const URL = requireEnv('SUPABASE_URL');
const ANON = requireEnv('SUPABASE_ANON_KEY');
const SERVICE = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

const MARK = 'S7_71_FIXTURE';
const NIL = '00000000-0000-0000-0000-000000000000';
const RUN_STARTED_AT = new Date().toISOString();

// ═════════════════════════════════════════════════════════════════════
// IDENTIDADES SINTÉTICAS — deterministas a partir de ASP0_RUN_ID
// ═════════════════════════════════════════════════════════════════════

/**
 * GUARDA, no dato. Ningún valor de esta lista puede llegar a una fixture,
 * a un destino, a un fallback ni a una llamada de Auth/tabla/RPC.
 *   50372608827 — Katherine (dato REAL, prohibido en toda circunstancia)
 *   50378627694 — Camilo, cuenta demo oficial
 *   50378056365 — admin de plataforma (Test Phone)
 *   50375000001 — paciente de prueba Fase 1 (Test Phone)
 */
const FORBIDDEN_PHONES = ['50372608827', '50378627694', '50378056365', '50375000001'];

const assertNotForbidden = (phone, where) => {
  const digits = String(phone).replace(/\D/g, '');
  if (FORBIDDEN_PHONES.some((f) => digits.includes(f) || f.includes(digits))) {
    throw new Error(`ABORTADO: teléfono prohibido en ${where}. Este smoke jamás usa datos reales, la cuenta demo ni Test Phones reservados.`);
  }
  return phone;
};

/** Hash determinista y estable de ASP0_RUN_ID → 3 dígitos. */
const runSeed = (() => {
  let h = 0;
  for (const c of RUN_ID) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 900 + 100;            // 100..999
})();

/** Las TRES identidades. Idénticas en --preflight y en --run. */
const IDENTITIES = ['patient', 'doctora', 'doctorb'].map((tag, i) => ({
  tag,
  email: `asp0.${tag}.${RUN_ID}@lucycare.test`,
  // Rango sintético 5037000xxx?, fuera de todo número real conocido.
  phone: assertNotForbidden(`5037000${runSeed}${i}`, `identidad ${tag}`),
}));

// ═════════════════════════════════════════════════════════════════════
// ESTADO Y UTILIDADES
// ═════════════════════════════════════════════════════════════════════
let pass = 0, fail = 0;
const ok = (d) => { console.log(`  ✅ ${d}`); pass++; };
const ko = (d) => { console.log(`  ❌ ${d}`); fail++; };
const check = (d, cond) => (cond ? ok(d) : ko(d));

const ids = {
  users: [], clinicId: null, specialtyId: null,
  doctorId: null, doctorId2: null,
  patientId: null, patientId2: null, extraPatients: [],
  serviceIds: [], ruleIds: [], apptIds: [], consultIds: [], eventApptIds: [],
};

/** Tablas que el smoke escribe. Acota el borrado de auditoría. */
const SMOKE_TABLES = [
  'appointments', 'patients', 'profiles', 'clinics', 'clinic_members',
  'doctors', 'services', 'availability_rules', 'consultations',
  'appointment_patient_cancellations',
];

/** ALLOWLIST: conjunto EXACTO de UUID creados por esta corrida. */
const allowlist = () => [
  ...ids.users, ids.clinicId, ids.doctorId, ids.doctorId2,
  ids.patientId, ids.patientId2, ...ids.extraPatients,
  ...ids.serviceIds, ...ids.ruleIds, ...ids.apptIds, ...ids.consultIds,
].filter(Boolean);

async function auditRows(apptId) {
  const { data, error } = await admin
    .from('audit_log')
    .select('id, action, old_data, new_data, user_id, created_at')
    .eq('table_name', 'appointments').eq('record_id', apptId)
    .gte('created_at', RUN_STARTED_AT).order('id', { ascending: true });
  if (error) throw new Error(`audit_log no legible: ${error.message}`);
  return data ?? [];
}
const kindOf = (row) => row?.new_data?.change_kind ?? null;

// ═════════════════════════════════════════════════════════════════════
// PREFLIGHT — READ-ONLY. No escribe. No crea. No modifica.
// ═════════════════════════════════════════════════════════════════════
async function preflight() {
  console.log('\n_smoke-s7_71a — PREFLIGHT (read-only, no escribe nada)\n');
  console.log(`  ASP0_RUN_ID: ${RUN_ID}   ·   marca: ${MARK}\n`);

  // ── 1. Identidades propuestas, exactas ──
  console.log('1. Identidades sintéticas propuestas (las mismas que usará --run)');
  for (const id of IDENTITIES) {
    console.log(`   · ${id.tag.padEnd(8)} email=${id.email}   phone=${id.phone}`);
  }
  console.log(`   · prefijo de nombres: "${MARK} …"`);
  console.log('   · los UUID los asigna la DB al crear; no son predecibles.');

  // ── 2. No colisionan con datos prohibidos ──
  console.log('\n2. No colisión con datos reales ni reservados');
  for (const id of IDENTITIES) {
    check(`${id.tag}: teléfono ≠ Katherine`, !id.phone.includes('50372608827'));
    check(`${id.tag}: teléfono ≠ Camilo (demo)`, !id.phone.includes('50378627694'));
    check(`${id.tag}: teléfono ≠ Test Phone reservado`,
      !['50378056365', '50375000001'].some((f) => id.phone.includes(f)));
    check(`${id.tag}: correo en dominio de prueba`, id.email.endsWith('@lucycare.test'));
  }

  // ── 3. Ausencia en Auth (Admin API read-only) ──
  console.log('\n3. Ausencia en Auth (Admin API, solo lectura)');
  const emails = new Set(IDENTITIES.map((i) => i.email));
  const phones = new Set(IDENTITIES.map((i) => i.phone));
  let scanned = 0, collisions = [], listErr = null;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { listErr = error.message; break; }
    const users = data?.users ?? [];
    scanned += users.length;
    for (const u of users) {
      if (emails.has(u.email ?? '')) collisions.push(`email ${u.email}`);
      if (phones.has((u.phone ?? '').replace(/\D/g, ''))) collisions.push(`phone ${u.phone}`);
    }
    if (users.length < 200) break;
  }
  if (listErr) {
    ko(`no se pudo listar Auth (${listErr}) — verificar manualmente antes de --run`);
  } else {
    console.log(`   (usuarios escaneados: ${scanned})`);
    check(`sin colisiones en Auth (${collisions.length})`, collisions.length === 0);
    collisions.forEach((c) => console.log(`      ⚠️  ${c}`));
  }
  console.log('   ℹ️  listUsers pagina de forma poco fiable en este proyecto (bug GoTrue');
  console.log('       documentado); por eso se cruza además contra profiles abajo.');

  // ── 4. Ausencia en tablas de negocio ──
  console.log('\n4. Ausencia en tablas de negocio');
  const like = `${MARK}%`;
  const probes = [
    ['profiles · email',   admin.from('profiles').select('id', { count: 'exact', head: true }).in('email', [...emails])],
    ['profiles · phone',   admin.from('profiles').select('id', { count: 'exact', head: true }).in('phone', [...phones])],
    ['patients · marca',   admin.from('patients').select('id', { count: 'exact', head: true }).like('full_name', like)],
    ['clinics · marca',    admin.from('clinics').select('id', { count: 'exact', head: true }).like('name', like)],
    ['services · marca',   admin.from('services').select('id', { count: 'exact', head: true }).like('name', like)],
  ];
  for (const [label, q] of probes) {
    const { count, error } = await q;
    if (error) ko(`${label}: no consultable (${error.message})`);
    else check(`${label}: 0 filas previas (${count ?? 0})`, (count ?? 0) === 0);
  }

  // Tablas donde no hay columna marcable: se comprueba que existan y sean
  // legibles, para que el cleanup posterior pueda verificarlas.
  for (const t of ['doctors', 'clinic_members', 'appointments', 'booking_intents', 'auth_creation_grants']) {
    const { error } = await admin.from(t).select('*', { count: 'exact', head: true }).limit(1);
    check(`${t}: legible para la verificación de residuos`, !error);
    if (error) console.log(`      ⚠️  ${error.message}`);
  }

  // ── 5. Precondiciones del catálogo ──
  console.log('\n5. Precondiciones del catálogo');
  const { data: spec } = await admin.from('specialties').select('id').limit(1).maybeSingle();
  check('hay al menos una especialidad', !!spec);

  const { data: sts } = await admin.from('appointment_statuses').select('id, name');
  const need = ['programada', 'confirmada', 'cancelada'];
  for (const n of need) check(`estado '${n}' existe`, !!(sts ?? []).find((s) => s.name === n));

  const { count: crCount } = await admin.from('cancel_reasons')
    .select('id', { count: 'exact', head: true });
  check(`cancel_reasons disponible (${crCount ?? 0} filas)`, (crCount ?? 0) > 0);
  if ((crCount ?? 0) === 0) {
    console.log('      ⚠️  sin motivos: el caso 5.6/5.7 (cancel_reason_id) fallaría en --run.');
  }

  // ── 6. Contrato esperado de las RPC de booking ──
  console.log('\n6. Contrato esperado de las RPC de booking');
  console.log(`
   register_booking_intent(p_doctor_id uuid, p_service_id uuid,
                           p_start_local timestamp, p_phone text) → jsonb
       se espera una clave de id: intent_id | id | booking_intent_id
   create_booking_with_intent(p_intent_id uuid, p_patient_name text,
                              p_notes text) → jsonb
       se espera una clave de cita: appointment_id | id

   ⚠️  NO se verifica llamándolas: ambas ESCRIBEN, y el preflight es
       read-only. --run falla de inmediato e imprime las claves reales si
       el contrato no coincide; nunca continúa en silencio.`);

  // ── 7. Migración aplicada ──
  console.log('\n7. Migración s7_71a aplicada');
  console.log(`
   No se comprueba desde acá: verificar la existencia del trigger, el
   SECURITY DEFINER, el search_path y el REVOKE de EXECUTE con las consultas
   read-only de docs/OWNER_S7_71A_APPLY.md §4 (1 a 4). Este preflight es
   estrictamente de SOLO LECTURA: no ejecuta ninguna RPC, ni siquiera para
   sondear, porque una llamada es una llamada.`);

  console.log(`\n${fail === 0 ? '✅' : '❌'} preflight: ${pass} OK, ${fail} fallos`);
  console.log(fail === 0
    ? '\n   Nada se escribió. Autorizá estas identidades antes de correr --run.\n'
    : '\n   ⛔ Hay colisiones o precondiciones incumplidas: NO ejecutar --run.\n');
  process.exit(fail === 0 ? 0 : 1);
}

// ═════════════════════════════════════════════════════════════════════
// SESIONES Y FIXTURES
// ═════════════════════════════════════════════════════════════════════

/**
 * Usuario Auth sintético. SIEMPRE por la Admin API, nunca por SQL sobre
 * auth.users. El user_id se registra ANTES de cualquier otra escritura,
 * para que el finally pueda eliminarlo aunque todo lo demás falle.
 */
async function createUser(identity) {
  assertNotForbidden(identity.phone, `createUser(${identity.tag})`);
  const { data, error } = await admin.auth.admin.createUser({
    email: identity.email, phone: identity.phone,
    email_confirm: true, phone_confirm: true,
    user_metadata: { fixture: MARK, run_id: RUN_ID },
  });
  if (error) throw new Error(`createUser(${identity.tag}): ${error.message}`);
  ids.users.push(data.user.id);
  return { ...identity, id: data.user.id };
}

/**
 * Sesión `authenticated` real sin endpoints protegidos por CAPTCHA:
 * generateLink (no envía correo) + verifyOtp desde un cliente anon.
 * Ningún token, link ni credencial se imprime ni se persiste.
 */
async function sessionFor(user) {
  const { data: link, error: eLink } = await admin.auth.admin.generateLink({
    type: 'magiclink', email: user.email,
  });
  if (eLink) throw new Error(`generateLink(${user.tag}): ${eLink.message}`);
  const hashedToken = link?.properties?.hashed_token;
  if (!hashedToken) throw new Error(`generateLink(${user.tag}): sin properties.hashed_token`);
  const c = anonClient();
  const { data, error } = await c.auth.verifyOtp({ token_hash: hashedToken, type: 'email' });
  if (error) throw new Error(`verifyOtp(${user.tag}): ${error.message}`);
  if (data.user?.id !== user.id) throw new Error(`verifyOtp(${user.tag}): la sesión es de otro usuario`);
  return c;
}

let dayOffset = 3;
const nextSlot = () => {
  const start = new Date(Date.now() + dayOffset++ * 86400000);
  start.setUTCHours(15, 0, 0, 0);
  return { start, end: new Date(start.getTime() + 30 * 60000) };
};

async function buildFixtures() {
  const [idPatient, idDoctorA, idDoctorB] = IDENTITIES;
  const uPatient = await createUser(idPatient);
  const uDoctorA = await createUser(idDoctorA);
  const uDoctorB = await createUser(idDoctorB);

  // handle_new_user ya creó profiles. Se actualiza SOLO `role`: tocar las
  // columnas de identidad dispararía audit_profiles_identity_fn (s7_32),
  // que inserta auth.uid() (NULL bajo service_role) en audit_log.user_id
  // NOT NULL y reventaría.
  for (const [u, role] of [[uPatient, 'patient'], [uDoctorA, 'doctor'], [uDoctorB, 'doctor']]) {
    const { data, error } = await admin.from('profiles').update({ role }).eq('id', u.id).select('id');
    if (error) throw new Error(`profile(${u.tag}): ${error.message}`);
    if (data?.length !== 1) throw new Error(`profile(${u.tag}): handle_new_user no creó exactamente una fila`);
  }

  // Canario: si la sesión falla, se aborta antes de crear fixtures de negocio.
  const cPatient = await sessionFor(uPatient);

  const { data: spec, error: eSpec } = await admin.from('specialties').select('id').limit(1).single();
  if (eSpec) throw new Error(`specialties: ${eSpec.message}`);
  ids.specialtyId = spec.id;

  const { data: clinic, error: eClinic } = await admin.from('clinics')
    .insert({ name: `${MARK} Clinica ${RUN_ID}`, owner_id: uDoctorA.id }).select('id').single();
  if (eClinic) throw new Error(`clinic: ${eClinic.message}`);
  ids.clinicId = clinic.id;

  for (const u of [uDoctorA, uDoctorB]) {
    const { error } = await admin.from('clinic_members')
      .insert({ clinic_id: ids.clinicId, profile_id: u.id, role: 'owner', is_active: true });
    if (error) throw new Error(`clinic_member(${u.tag}): ${error.message}`);
  }

  for (const [u, key] of [[uDoctorA, 'doctorId'], [uDoctorB, 'doctorId2']]) {
    const { data, error } = await admin.from('doctors')
      .insert({ clinic_id: ids.clinicId, profile_id: u.id, specialty_id: ids.specialtyId })
      .select('id').single();
    if (error) throw new Error(`doctor(${u.tag}): ${error.message}`);
    ids[key] = data.id;
  }

  for (const n of ['Consulta', 'Control']) {
    const { data, error } = await admin.from('services')
      .insert({ doctor_id: ids.doctorId, name: `${MARK} ${n}`, duration_minutes: 30, is_active: true })
      .select('id').single();
    if (error) throw new Error(`service ${n}: ${error.message}`);
    ids.serviceIds.push(data.id);
  }

  const rules = [];
  for (const docId of [ids.doctorId, ids.doctorId2]) {
    for (let d = 0; d <= 6; d++) {
      rules.push({ clinic_id: ids.clinicId, doctor_id: docId, day_of_week: d,
        start_time: '00:00:00', end_time: '23:59:00', is_active: true });
    }
  }
  const { data: ruleRows, error: eRules } = await admin.from('availability_rules').insert(rules).select('id');
  if (eRules) throw new Error(`availability_rules: ${eRules.message}`);
  ids.ruleIds.push(...(ruleRows ?? []).map((r) => r.id));

  const { data: p1, error: eP1 } = await admin.from('patients').insert({
    clinic_id: ids.clinicId, profile_id: uPatient.id,
    full_name: `${MARK} Paciente Uno`, date_of_birth: '1990-01-01', gender: 'otro',
    link_confirmed_at: new Date().toISOString(), is_active: true,
  }).select('id').single();
  if (eP1) throw new Error(`patient 1: ${eP1.message}`);
  ids.patientId = p1.id;

  const { data: p2, error: eP2 } = await admin.from('patients').insert({
    clinic_id: ids.clinicId, full_name: `${MARK} Paciente Dos`,
    date_of_birth: '1991-02-02', gender: 'otro', is_active: true,
  }).select('id').single();
  if (eP2) throw new Error(`patient 2: ${eP2.message}`);
  ids.patientId2 = p2.id;

  const { data: statuses, error: eSt } = await admin
    .from('appointment_statuses').select('id, name');
  if (eSt) throw new Error(`statuses: ${eSt.message}`);
  const statusId = (n) => {
    const s = statuses.find((x) => x.name === n);
    if (!s) throw new Error(`no existe el estado '${n}'`);
    return s.id;
  };
  const { data: reason } = await admin.from('cancel_reasons').select('id').limit(1).maybeSingle();

  return {
    uPatient, uDoctorA, uDoctorB, cPatient,
    clinicId: ids.clinicId, doctorId: ids.doctorId, doctorId2: ids.doctorId2,
    patientId: ids.patientId, patientId2: ids.patientId2,
    serviceId: ids.serviceIds[0], serviceId2: ids.serviceIds[1],
    statusProgramada: statusId('programada'), statusConfirmada: statusId('confirmada'),
    cancelReasonId: reason?.id ?? null,
  };
}

async function insertAppointment(fx, overrides = {}) {
  const { start, end } = nextSlot();
  const { data, error } = await admin.from('appointments').insert({
    clinic_id: fx.clinicId, doctor_id: fx.doctorId, patient_id: fx.patientId,
    service_id: fx.serviceId, status_id: fx.statusProgramada,
    start_time: start.toISOString(), end_time: end.toISOString(),
    source: 'lucy_directorio', price: 25, ...overrides,
  }).select('id, start_time, status_id').single();
  if (error) throw new Error(`insertAppointment: ${error.message}`);
  ids.apptIds.push(data.id);
  return data;
}

async function bookViaIntent(fx) {
  const { start } = nextSlot();
  const startLocal = start.toISOString().replace('Z', '').split('.')[0];

  const { data: intent, error: eIntent } = await fx.cPatient.rpc('register_booking_intent', {
    p_doctor_id: fx.doctorId, p_service_id: fx.serviceId,
    p_start_local: startLocal,
    p_phone: assertNotForbidden(fx.uPatient.phone, 'register_booking_intent'),
  });
  if (eIntent) throw new Error(`register_booking_intent: ${eIntent.message}`);
  const intentId = intent?.intent_id ?? intent?.id ?? intent?.booking_intent_id;
  if (!intentId) throw new Error(`register_booking_intent: contrato inesperado — claves: ${Object.keys(intent ?? {}).join(', ')}`);

  const { data: booking, error: eBook } = await fx.cPatient.rpc('create_booking_with_intent', {
    p_intent_id: intentId, p_patient_name: `${MARK} Paciente Uno`, p_notes: null,
  });
  if (eBook) throw new Error(`create_booking_with_intent: ${eBook.message}`);
  const appointmentId = booking?.appointment_id ?? booking?.id;
  if (!appointmentId) throw new Error(`create_booking_with_intent: contrato inesperado — claves: ${Object.keys(booking ?? {}).join(', ')}`);
  ids.apptIds.push(appointmentId);

  // La RPC puede haber creado su propia ficha: se registra para el cleanup.
  const { data: appt } = await admin.from('appointments')
    .select('patient_id').eq('id', appointmentId).maybeSingle();
  if (appt?.patient_id && ![ids.patientId, ids.patientId2].includes(appt.patient_id)) {
    ids.extraPatients.push(appt.patient_id);
  }
  return { appointmentId, profileId: fx.uPatient.id };
}

async function cancelAsPatient(fx) {
  const appt = await insertAppointment(fx, { status_id: fx.statusProgramada });
  ids.eventApptIds.push(appt.id);
  const note = `${MARK} nota libre que NO debe auditarse`;
  const { data, error } = await fx.cPatient.rpc('cancel_my_appointment', {
    p_appointment_id: appt.id, p_reason: 'no_puedo_asistir', p_note: note,
  });
  if (error) throw new Error(`cancel_my_appointment: ${error.message}`);
  if (data?.outcome !== 'cancelled') throw new Error(`cancel_my_appointment: outcome inesperado ${JSON.stringify(data)}`);
  return { appointmentId: appt.id, profileId: fx.uPatient.id, note };
}

/**
 * Firma una consulta ligada a una cita → dispara sync_appointment_on_sign
 * (s6_02), que actualiza appointments.status_id en cascada.
 *
 * ⚠️ SOLO local/staging (`--include-sign`). En producción esta ruta se
 * prueba con el bloque owner-only BEGIN/ROLLBACK de la guía §13.
 * Reversibilidad verificada por lectura de código: s7_28 restringe UPDATE
 * (policies), NO DELETE; no hay policy ni trigger de DELETE sobre
 * consultations; y service_role tiene rolbypassrls=true (preflight). Las
 * tablas dependientes son consultation_amendments, prescriptions,
 * consultation_diagnoses y consultation_family_history: el cleanup las
 * borra antes que la consulta. Aun así, en producción se prefiere el
 * ROLLBACK a un borrado.
 */
async function signConsultation(fx) {
  const appt = await insertAppointment(fx, { status_id: fx.statusConfirmada });
  const { data: cons, error: eCons } = await admin.from('consultations').insert({
    appointment_id: appt.id, clinic_id: fx.clinicId,
    doctor_id: fx.doctorId, patient_id: fx.patientId,
    status: 'draft', started_at: new Date().toISOString(), chief_complaint: MARK,
  }).select('id').single();
  if (eCons) throw new Error(`consultation: ${eCons.message}`);
  ids.consultIds.push(cons.id);

  const { error: eSign } = await admin.from('consultations')
    .update({ status: 'signed', signed_at: new Date().toISOString() }).eq('id', cons.id);
  if (eSign) throw new Error(`firmar consulta: ${eSign.message}`);
  return { appointmentId: appt.id, consultationId: cons.id };
}

// ═════════════════════════════════════════════════════════════════════
// CORRIDA
// ═════════════════════════════════════════════════════════════════════
async function run() {
  console.log('\n_smoke-s7_71a — cobertura server-side de appointments\n');
  console.log(`  ASP0_RUN_ID: ${RUN_ID} · marca: ${MARK} · inicio: ${RUN_STARTED_AT}`);
  console.log(`  firma de consulta: ${INCLUDE_SIGN ? 'INCLUIDA (--include-sign, solo local/staging)' : 'EXCLUIDA (ver guía §13)'}\n`);

  console.log('0. Fixtures sintéticas');
  const fx = await buildFixtures();
  ok(`clínica ${ids.clinicId.slice(0, 8)}… · 2 médicos · 2 fichas · 2 servicios`);
  ok('sesión authenticated del paciente abierta (sin imprimir credenciales)');

  // ─── 1. INSERT manual (walk-in) ────────────────────────────────────
  console.log('\n1. Creación manual (walk-in)');
  {
    const appt = await insertAppointment(fx, {
      source: 'manual',
      notes: 'NOTA_LIBRE_NO_DEBE_AUDITARSE',
      internal_notes: 'NOTA_INTERNA_NO_DEBE_AUDITARSE',
    });
    const rows = await auditRows(appt.id);
    check('1.1 exactamente 1 fila', rows.length === 1);
    check('1.2 action = insert', rows[0]?.action === 'insert');
    check('1.3 change_kind = appointment_created', kindOf(rows[0]) === 'appointment_created');
    check('1.4 source literal = manual', rows[0]?.new_data?.source === 'manual');
    check('1.5 old_data nulo en INSERT', rows[0]?.old_data === null);
    check('1.6 actor_kind = service_role', rows[0]?.new_data?.actor_kind === 'service_role');
    check('1.7 db_executor presente', typeof rows[0]?.new_data?.db_executor === 'string');
    const blob = JSON.stringify(rows[0]);
    check('1.8 NO contiene la nota libre', !blob.includes('NOTA_LIBRE_NO_DEBE_AUDITARSE'));
    check('1.9 NO contiene la nota interna', !blob.includes('NOTA_INTERNA_NO_DEBE_AUDITARSE'));
  }

  // ─── 2. create_booking_with_intent ─────────────────────────────────
  console.log('\n2. Reserva por create_booking_with_intent (cobertura NUEVA)');
  {
    const r = await bookViaIntent(fx);
    const rows = await auditRows(r.appointmentId);
    check('2.1 exactamente 1 fila', rows.length === 1);
    check('2.2 action = insert', rows[0]?.action === 'insert');
    check('2.3 change_kind = appointment_created', kindOf(rows[0]) === 'appointment_created');
    check('2.4 source literal registrado', typeof rows[0]?.new_data?.source === 'string');
    check('2.5 actor_kind = user', rows[0]?.new_data?.actor_kind === 'user');
    check('2.6 user_id = el paciente (no el centinela)', rows[0]?.user_id === r.profileId);
  }

  // ─── 3. Cambio de estado ───────────────────────────────────────────
  console.log('\n3. Cambio de estado');
  {
    const appt = await insertAppointment(fx);
    const before = (await auditRows(appt.id)).length;
    const { error } = await admin.from('appointments')
      .update({ status_id: fx.statusConfirmada }).eq('id', appt.id);
    if (error) throw new Error(`update estado: ${error.message}`);
    const rows = await auditRows(appt.id);
    check('3.1 se agregó exactamente 1 fila', rows.length === before + 1);
    const last = rows[rows.length - 1];
    check('3.2 action = update', last?.action === 'update');
    check('3.3 change_kind = status_change', kindOf(last) === 'status_change');
    check('3.4 old_data lleva el status anterior', !!last?.old_data?.status_id);
    check('3.5 new_data lleva el status nuevo', last?.new_data?.status_id === fx.statusConfirmada);
    check('3.6 sin context_rejected', last?.new_data?.context_rejected === undefined);
  }

  // ─── 4. Reprogramación ─────────────────────────────────────────────
  console.log('\n4. Reprogramación');
  {
    const appt = await insertAppointment(fx);
    const before = (await auditRows(appt.id)).length;
    const { start, end } = nextSlot();
    const { error } = await admin.from('appointments')
      .update({ start_time: start.toISOString(), end_time: end.toISOString() }).eq('id', appt.id);
    if (error) throw new Error(`reprogramar: ${error.message}`);
    const rows = await auditRows(appt.id);
    check('4.1 se agregó exactamente 1 fila', rows.length === before + 1);
    const last = rows[rows.length - 1];
    check('4.2 change_kind = reschedule', kindOf(last) === 'reschedule');
    check('4.3 old y new llevan start_time', !!last?.old_data?.start_time && !!last?.new_data?.start_time);
    check('4.4 old y new llevan end_time', !!last?.old_data?.end_time && !!last?.new_data?.end_time);
  }

  // ─── 5. Doctor / servicio / precio / motivo ────────────────────────
  console.log('\n5. Doctor / servicio / precio / motivo');
  {
    const a1 = await insertAppointment(fx);
    let n = (await auditRows(a1.id)).length;
    const { error: e1 } = await admin.from('appointments').update({ doctor_id: fx.doctorId2 }).eq('id', a1.id);
    if (e1) throw new Error(`cambio de doctor: ${e1.message}`);
    let rows = await auditRows(a1.id);
    check('5.1 doctor → 1 fila', rows.length === n + 1);
    check('5.2 change_kind = doctor_reassign', kindOf(rows[rows.length - 1]) === 'doctor_reassign');

    const a2 = await insertAppointment(fx);
    n = (await auditRows(a2.id)).length;
    const { error: e2 } = await admin.from('appointments')
      .update({ service_id: fx.serviceId2, price: 42 }).eq('id', a2.id);
    if (e2) throw new Error(`servicio+precio: ${e2.message}`);
    rows = await auditRows(a2.id);
    check('5.3 servicio+precio → 1 fila', rows.length === n + 1);
    check('5.4 change_kind = appointment_update', kindOf(rows[rows.length - 1]) === 'appointment_update');
    check('5.5 registra el precio nuevo', Number(rows[rows.length - 1]?.new_data?.price) === 42);

    if (fx.cancelReasonId) {
      const a3 = await insertAppointment(fx);
      n = (await auditRows(a3.id)).length;
      const { error: e3 } = await admin.from('appointments')
        .update({ cancel_reason_id: fx.cancelReasonId }).eq('id', a3.id);
      if (e3) throw new Error(`motivo: ${e3.message}`);
      rows = await auditRows(a3.id);
      check('5.6 motivo → 1 fila', rows.length === n + 1);
      check('5.7 change_kind = status_change', kindOf(rows[rows.length - 1]) === 'status_change');
    } else {
      ko('5.6/5.7 catálogo cancel_reasons vacío — el preflight debió abortar antes');
    }

    const a4 = await insertAppointment(fx);
    n = (await auditRows(a4.id)).length;
    const slot = nextSlot();
    const { error: e4 } = await admin.from('appointments').update({
      status_id: fx.statusConfirmada,
      start_time: slot.start.toISOString(), end_time: slot.end.toISOString(),
    }).eq('id', a4.id);
    if (e4) throw new Error(`estado+horario: ${e4.message}`);
    rows = await auditRows(a4.id);
    check('5.8 estado+horario → 1 fila', rows.length === n + 1);
    check('5.9 change_kind = mixed', kindOf(rows[rows.length - 1]) === 'mixed');
  }

  // ─── 6. cancel_my_appointment — UNA sola fila ──────────────────────
  console.log('\n6. cancel_my_appointment (prueba central: sin duplicado)');
  {
    const r = await cancelAsPatient(fx);
    const rows = await auditRows(r.appointmentId);
    const updates = rows.filter((x) => x.action === 'update');
    check('6.1 EXACTAMENTE 1 fila de update (sin duplicado)', updates.length === 1);
    const last = updates[0];
    check('6.2 edited_via = patient_self_cancel', last?.new_data?.edited_via === 'patient_self_cancel');
    check('6.3 conserva el motivo', last?.new_data?.reason === 'no_puedo_asistir');
    check('6.4 change_kind = status_change', kindOf(last) === 'status_change');
    check('6.5 contexto ACEPTADO (sin context_rejected)', last?.new_data?.context_rejected === undefined);
    check('6.6 user_id = el paciente', last?.user_id === r.profileId);
    check('6.7 actor_kind = user', last?.new_data?.actor_kind === 'user');
    check('6.8 la nota libre NO está en la auditoría', !JSON.stringify(last).includes(r.note));
  }

  // ─── 7. Reasignación de paciente (merge/unmerge genérico) ──────────
  console.log('\n7. Reasignación de paciente (merge/unmerge, sin setter)');
  {
    const appt = await insertAppointment(fx);
    const n = (await auditRows(appt.id)).length;
    // Ida y vuelta: emula el ciclo merge → unmerge. NO se llama a
    // admin_merge_patients, así que NO se genera patient_merge_log: las
    // fixtures quedan eliminables solo con appointments + patients.
    const { error: e1 } = await admin.from('appointments')
      .update({ patient_id: fx.patientId2 }).eq('id', appt.id);
    if (e1) throw new Error(`reasignar paciente: ${e1.message}`);
    const rowsA = await auditRows(appt.id);
    const lastA = rowsA[rowsA.length - 1];
    check('7.1 ida → 1 fila', rowsA.length === n + 1);
    check('7.2 change_kind = patient_reassign', kindOf(lastA) === 'patient_reassign');
    check('7.3 SIN etiqueta patient_merge inventada', lastA?.new_data?.edited_via === undefined);
    check('7.4 old y new llevan patient_id', !!lastA?.old_data?.patient_id && !!lastA?.new_data?.patient_id);

    const { error: e2 } = await admin.from('appointments')
      .update({ patient_id: fx.patientId }).eq('id', appt.id);
    if (e2) throw new Error(`revertir reasignación: ${e2.message}`);
    const rowsB = await auditRows(appt.id);
    check('7.5 vuelta → 1 fila más', rowsB.length === n + 2);
    check('7.6 vuelta también patient_reassign', kindOf(rowsB[rowsB.length - 1]) === 'patient_reassign');
    check('7.7 la cita vuelve a la ficha original (eliminable)',
      rowsB[rowsB.length - 1]?.new_data?.patient_id === fx.patientId);
  }

  // ─── 8. Firma de consulta ──────────────────────────────────────────
  console.log('\n8. Firma de consulta (cascada de s6_02)');
  if (INCLUDE_SIGN) {
    const r = await signConsultation(fx);
    const rows = await auditRows(r.appointmentId);
    const updates = rows.filter((x) => x.action === 'update');
    check('8.1 la cascada dejó auditoría de appointments', updates.length >= 1);
    const last = updates[updates.length - 1];
    check('8.2 change_kind = status_change', kindOf(last) === 'status_change');
    check('8.3 SIN etiqueta consultation_signed inventada', last?.new_data?.edited_via === undefined);
  } else {
    console.log(`
  ⏭️  NO EJECUTADO en esta corrida (sin --include-sign).
      La firma es irreversible en el sentido de producto, así que en
      producción esta ruta se prueba con el bloque owner-only
      BEGIN/ROLLBACK de docs/OWNER_S7_71A_APPLY.md §13.
      Esta corrida NO cuenta como cobertura de firma.
`);
  }

  // ─── 9. Actualización irrelevante → SIN fila ───────────────────────
  console.log('\n9. Actualización irrelevante (sin ruido)');
  {
    const appt = await insertAppointment(fx);
    const before = (await auditRows(appt.id)).length;
    const { error } = await admin.from('appointments')
      .update({ notes: 'solo notas', internal_notes: 'solo internas' }).eq('id', appt.id);
    if (error) throw new Error(`update irrelevante: ${error.message}`);
    check('9.1 NO se escribió ninguna fila nueva', (await auditRows(appt.id)).length === before);
  }

  // ─── 10. service_role ──────────────────────────────────────────────
  console.log('\n10. Escritura por service_role');
  {
    const appt = await insertAppointment(fx);
    const rows = await auditRows(appt.id);
    const last = rows[rows.length - 1];
    check('10.1 actor_kind = service_role', last?.new_data?.actor_kind === 'service_role');
    check('10.2 user_id = centinela (sin auth.uid())', last?.user_id === NIL);
    check('10.3 NO aborta la escritura de la cita', !!appt.id);
  }

  // ─── 11-12. Owner-only ─────────────────────────────────────────────
  console.log('\n11-12. db_direct y contexto rechazado');
  console.log(`
  ⏭️  NO ALCANZABLES desde supabase-js: exigen conexión SIN JWT y
      set_config server-side, ninguno expuesto por PostgREST (y eso mismo
      es parte de la defensa). Bloques owner-only, transaccionales y con
      ROLLBACK, en docs/OWNER_S7_71A_APPLY.md §11 y §12.
`);
}

// ═════════════════════════════════════════════════════════════════════
// CLEANUP — corre SIEMPRE desde el finally
// ═════════════════════════════════════════════════════════════════════
const cleanupErrors = [];

async function cleanup() {
  console.log('\n13. Cleanup (se ejecuta aunque la corrida haya fallado)');

  /** Ejecuta un borrado y ACUMULA el error sin interrumpir los siguientes. */
  const del = async (label, promise) => {
    try {
      const { error } = await promise;
      if (error) { cleanupErrors.push(`${label}: ${error.message}`); console.error(`  ⚠️  ${label}: ${error.message}`); }
      else console.log(`  🧹 ${label}`);
    } catch (e) {
      cleanupErrors.push(`${label}: ${e.message}`);
      console.error(`  ⚠️  ${label}: ${e.message}`);
    }
  };

  const has = (a) => Array.isArray(a) && a.length > 0;
  const patientIds = [ids.patientId, ids.patientId2, ...ids.extraPatients].filter(Boolean);
  const doctorIds = [ids.doctorId, ids.doctorId2].filter(Boolean);

  // ── 13.1 Dependencias de consultas (las genera la firma) ──
  if (has(ids.consultIds)) {
    for (const t of ['consultation_amendments', 'prescriptions',
                     'consultation_diagnoses', 'consultation_family_history']) {
      await del(`${t}`, admin.from(t).delete().in('consultation_id', ids.consultIds));
    }
    await del('consultas', admin.from('consultations').delete().in('id', ids.consultIds));
  }

  // ── 13.2 Eventos y citas ──
  if (has(ids.eventApptIds)) {
    await del('eventos de cancelación',
      admin.from('appointment_patient_cancellations').delete().in('appointment_id', ids.eventApptIds));
  }
  if (has(ids.apptIds)) await del('citas', admin.from('appointments').delete().in('id', ids.apptIds));

  // ── 13.3 Intents y grants generados por el flujo de booking ──
  if (has(ids.users)) {
    await del('booking_intents', admin.from('booking_intents').delete().in('created_by', ids.users));
    await del('auth_creation_grants', admin.from('auth_creation_grants').delete().in('issued_by', ids.users));
  }

  // ── 13.4 Dependencias de médicos ──
  if (has(doctorIds)) {
    await del('reglas de disponibilidad', admin.from('availability_rules').delete().in('doctor_id', doctorIds));
    await del('servicios', admin.from('services').delete().in('doctor_id', doctorIds));
  }

  // ── 13.5 Fichas, médicos, membresías, clínicas ──
  if (has(patientIds)) await del('pacientes', admin.from('patients').delete().in('id', patientIds));
  if (has(doctorIds)) await del('médicos', admin.from('doctors').delete().in('id', doctorIds));
  if (ids.clinicId) {
    await del('membresías', admin.from('clinic_members').delete().eq('clinic_id', ids.clinicId));
    await del('clínicas', admin.from('clinics').delete().eq('id', ids.clinicId));
  }

  // ── 13.6 Perfiles y usuarios de Auth (SIEMPRE por la Admin API) ──
  if (has(ids.users)) await del('perfiles', admin.from('profiles').delete().in('id', ids.users));
  for (const uid of ids.users) {
    try {
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) { cleanupErrors.push(`auth.user ${uid}: ${error.message}`); console.error(`  ⚠️  auth.user ${uid}: ${error.message}`); }
      else console.log(`  🧹 auth.user ${uid.slice(0, 8)}… (Admin API, nunca SQL)`);
    } catch (e) {
      cleanupErrors.push(`auth.user ${uid}: ${e.message}`);
    }
  }

  // ── 13.7 audit_log — ALLOWLIST explícita, con reporte y abort ──
  await cleanupAuditLog();

  // ── 13.8 Inventario final y verificación de CERO residuos ──
  await finalInventory(patientIds, doctorIds);
}

/**
 * Borra la auditoría de las fixtures SOLO por allowlist explícita.
 * `created_at >= RUN_STARTED_AT` es condición ADICIONAL, jamás suficiente:
 * sin la allowlist, un DELETE por fecha alcanzaría auditoría legítima
 * concurrente. Antes de borrar se reporta lo previsto y se ABORTA si
 * aparece cualquier record_id fuera de la lista.
 */
async function cleanupAuditLog() {
  const allow = allowlist();
  if (allow.length === 0) { console.log('  🧹 audit_log: nada que borrar (allowlist vacía)'); return; }

  const { data: previstas, error: eSel } = await admin.from('audit_log')
    .select('id, table_name, record_id')
    .in('record_id', allow)                       // ← criterio PRINCIPAL
    .in('table_name', SMOKE_TABLES)
    .gte('created_at', RUN_STARTED_AT);           // ← condición ADICIONAL
  if (eSel) {
    cleanupErrors.push(`audit_log (select previo): ${eSel.message}`);
    console.error(`  ⚠️  audit_log: no se pudo listar (${eSel.message}) — NO se borra nada`);
    return;
  }

  const filas = previstas ?? [];
  const distintos = [...new Set(filas.map((r) => r.record_id))];
  console.log(`  ℹ️  audit_log previsto: ${filas.length} fila(s) sobre ${distintos.length} record_id`);
  distintos.forEach((r) => console.log(`      · ${r}`));

  const fuera = distintos.filter((r) => !allow.includes(r));
  if (fuera.length > 0) {
    cleanupErrors.push(`audit_log: ${fuera.length} record_id FUERA de la allowlist — no se borró nada`);
    console.error(`  ⛔ ABORTADO: record_id fuera de la allowlist: ${fuera.join(', ')}`);
    return;
  }

  const { error: eDel } = await admin.from('audit_log').delete()
    .in('record_id', allow).in('table_name', SMOKE_TABLES).gte('created_at', RUN_STARTED_AT);
  if (eDel) { cleanupErrors.push(`audit_log (delete): ${eDel.message}`); console.error(`  ⚠️  audit_log: ${eDel.message}`); }
  else console.log(`  🧹 audit_log: ${filas.length} fila(s) sintéticas`);
}

/** Inventario final. Falla el proceso si queda CUALQUIER residuo. */
async function finalInventory(patientIds, doctorIds) {
  console.log('\n  Inventario final — verificación de CERO residuos');
  let residuals = 0;

  const countIn = async (table, col, list) => {
    if (!list.length) return 0;
    const { count, error } = await admin.from(table)
      .select('*', { count: 'exact', head: true }).in(col, list);
    if (error) { cleanupErrors.push(`contar ${table}: ${error.message}`); return -1; }
    return count ?? 0;
  };

  const filas = [
    ['appointments', 'id', ids.apptIds],
    ['consultations', 'id', ids.consultIds],
    ['appointment_patient_cancellations', 'appointment_id', ids.eventApptIds],
    ['patients', 'id', patientIds],
    ['services', 'id', ids.serviceIds],
    ['availability_rules', 'id', ids.ruleIds],
    ['doctors', 'id', doctorIds],
    ['clinic_members', 'profile_id', ids.users],
    ['clinics', 'id', [ids.clinicId].filter(Boolean)],
    ['booking_intents', 'created_by', ids.users],
    ['auth_creation_grants', 'issued_by', ids.users],
    ['profiles', 'id', ids.users],
  ];
  for (const [table, col, list] of filas) {
    const n = await countIn(table, col, list);
    if (n > 0) residuals += n;
    console.log(`    · ${String(table).padEnd(36)} ${n}`);
  }

  // audit_log sintético.
  const allow = allowlist();
  if (allow.length) {
    const { count, error } = await admin.from('audit_log')
      .select('id', { count: 'exact', head: true })
      .in('record_id', allow).in('table_name', SMOKE_TABLES).gte('created_at', RUN_STARTED_AT);
    if (error) cleanupErrors.push(`contar audit_log: ${error.message}`);
    else { residuals += count ?? 0; console.log(`    · ${'audit_log (sintético)'.padEnd(36)} ${count ?? 0}`); }
  }

  // Auth: getUserById NO debe encontrarlos.
  let authLeft = 0;
  for (const uid of ids.users) {
    const { data, error } = await admin.auth.admin.getUserById(uid);
    const stillThere = !error && !!data?.user?.id;
    if (stillThere) { authLeft++; console.log(`    · auth.user ${uid} → ⚠️ TODAVÍA EXISTE`); }
  }
  residuals += authLeft;
  console.log(`    · ${'auth.users (getUserById)'.padEnd(36)} ${authLeft}`);

  check(`13.1 CERO residuos (${residuals})`, residuals === 0);
  check(`13.2 el cleanup no acumuló errores (${cleanupErrors.length})`, cleanupErrors.length === 0);
  cleanupErrors.forEach((e) => console.log(`      · ${e}`));
}

// ═════════════════════════════════════════════════════════════════════
// ENTRYPOINT — todo lo que escribe va en try/finally
// ═════════════════════════════════════════════════════════════════════
async function main() {
  if (WANT_PREFLIGHT) { await preflight(); return; }

  let runError = null;
  try {
    await run();
  } catch (e) {
    runError = e;
    console.error(`\n💥 la corrida falló: ${e.message}`);
    fail++;
  } finally {
    // El cleanup corre SIEMPRE: ninguna aserción intermedia puede abandonar
    // fixtures. Sus propios errores se acumulan y se reportan.
    try {
      await cleanup();
    } catch (e) {
      cleanupErrors.push(`cleanup abortó: ${e.message}`);
      console.error(`\n💥 el cleanup abortó: ${e.message}`);
      fail++;
    }
  }

  const clean = fail === 0 && cleanupErrors.length === 0 && !runError;
  console.log(`\n${clean ? '✅' : '❌'} _smoke-s7_71a: ${pass} OK, ${fail} fallos, ${cleanupErrors.length} errores de cleanup\n`);
  process.exit(clean ? 0 : 1);
}

main();
