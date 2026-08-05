/**
 * _smoke-s7_71a.mjs — AUDIT-SEC-P0 · PR 1: cobertura server-side de appointments.
 *
 * ⛔ NO SE AUTOEJECUTA. Requiere DOS confirmaciones explícitas:
 *
 *      ASP0_SMOKE_AUTHORIZED=1 node scripts/_smoke-s7_71a.mjs --run
 *
 *    Sin ambas imprime este encabezado y sale con 0 sin tocar la DB.
 *
 * ── REQUISITOS DE EJECUCIÓN (autorización SEPARADA del owner) ──
 *   • service_role (crea y limpia las fixtures). Su uso exige autorización
 *     puntual del owner, incluso para pruebas.
 *   • La migración s7_71a YA aplicada. El smoke NO aplica SQL.
 *   • SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.
 *
 * ── REGLAS DE DATOS (vinculantes) ──
 *   • Fixtures SINTÉTICAS creadas desde cero y marcadas `S7_71_FIXTURE`.
 *   • JAMÁS Katherine. JAMÁS Camilo. JAMÁS datos reales. Los números
 *     prohibidos viven en FORBIDDEN_PHONES y solo se usan como GUARDA que
 *     aborta la corrida: nunca como fixture, destino, fallback ni argumento
 *     de Auth, profiles, patients, appointments o RPC.
 *   • Médico, clínica, pacientes y citas PROPIOS: la prueba de firma de
 *     consulta es irreversible y no puede tocar el paciente demo.
 *   • Usuarios de prueba con email + teléfono sintético confirmados por
 *     service_role: no se envía ningún SMS, no se toca Twilio.
 *   • Sesión `authenticated` real vía generateLink + verifyOtp (Turnstile
 *     ACTIVO no permite signInWithPassword desde un script).
 *   • Cleanup obligatorio con verificación de CERO residuos.
 *   • La auditoría de las fixtures se borra SOLO para los UUID sintéticos de
 *     ESTA corrida, en las tablas que el smoke escribe y con created_at
 *     posterior al inicio. La auditoría de datos reales nunca se toca.
 *
 * ── QUÉ PRUEBA ──
 *   Que el trigger `audit_appointments` produce EXACTAMENTE una fila por
 *   evento, con la clasificación correcta, sin notes/internal_notes, y que
 *   `cancel_my_appointment` deja UNA sola fila (no dos).
 *
 * ── QUÉ **NO** PRUEBA ACÁ (y dónde sí) ──
 *   · La explotación del agujero de `audit_log` (INSERT falsificado con
 *     user_id arbitrario, helper inseguro): esas pruebas "ANTES" se corren
 *     SOLO en local o en un ambiente aislado, NUNCA contra producción. El
 *     agujero quedó probado documentalmente por policy + ACL en la Fase 0.
 *   · `actor_kind='db_direct'` y el rechazo de contexto falsificado: exigen
 *     una conexión SIN JWT y `set_config` server-side, ninguno alcanzable
 *     desde PostgREST. Bloque SQL owner-only, transaccional y con ROLLBACK,
 *     en docs/OWNER_S7_71A_APPLY.md §11 y §12.
 *   · El cierre de privilegios: es s7_71b.
 */
import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './_lib/env.mjs';

// ─────────────────────────────────────────────────────────────────────
// GUARD DE EJECUCIÓN
// ─────────────────────────────────────────────────────────────────────
const ARMED = process.argv.includes('--run') && process.env.ASP0_SMOKE_AUTHORIZED === '1';
if (!ARMED) {
  console.log(`
_smoke-s7_71a — NO EJECUTADO (guard activo).

Este smoke escribe en la base de datos y usa service_role.
Para ejecutarlo hace falta autorización explícita del owner y:

    ASP0_SMOKE_AUTHORIZED=1 node scripts/_smoke-s7_71a.mjs --run

Requisitos previos:
  · migración s7_71a aplicada por el owner;
  · SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY en .env.local.

No se tocó la base de datos.
`);
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

/**
 * GUARDA, no dato. Ningún valor de esta lista puede llegar a una fixture,
 * a un destino, a un fallback ni a una llamada de Auth/tabla/RPC.
 * `assertNotForbidden` aborta la corrida si alguno se cuela.
 */
const FORBIDDEN_PHONES = ['50372608827', '50378627694', '50378056365', '50375000001'];
const assertNotForbidden = (phone, where) => {
  const digits = String(phone).replace(/\D/g, '');
  if (FORBIDDEN_PHONES.some((f) => digits.includes(f))) {
    throw new Error(`ABORTADO: teléfono prohibido usado en ${where}. Este smoke jamás toca datos reales ni la cuenta demo.`);
  }
  return phone;
};

let pass = 0, fail = 0;
const ok = (d) => { console.log(`  ✅ ${d}`); pass++; };
const ko = (d) => { console.log(`  ❌ ${d}`); fail++; };
const check = (d, cond) => (cond ? ok(d) : ko(d));

/** UUID sintéticos de ESTA corrida. El cleanup se acota a este conjunto. */
const ids = {
  users: [], clinicId: null, specialtyId: null,
  doctorId: null, doctorId2: null,
  patientId: null, patientId2: null,
  serviceIds: [], ruleIds: [], apptIds: [], consultIds: [], eventApptIds: [],
};

/** Tablas que el smoke escribe: acota el borrado de auditoría por table_name. */
const SMOKE_TABLES = [
  'appointments', 'patients', 'profiles', 'clinics', 'clinic_members',
  'doctors', 'services', 'availability_rules', 'consultations',
  'appointment_patient_cancellations',
];

const allSyntheticIds = () => [
  ...ids.users, ids.clinicId, ids.doctorId, ids.doctorId2,
  ids.patientId, ids.patientId2,
  ...ids.serviceIds, ...ids.ruleIds, ...ids.apptIds, ...ids.consultIds,
].filter(Boolean);

/** Filas de audit_log de `appointments` para un id, posteriores al inicio. */
async function auditRows(apptId) {
  const { data, error } = await admin
    .from('audit_log')
    .select('id, action, old_data, new_data, user_id, created_at')
    .eq('table_name', 'appointments')
    .eq('record_id', apptId)
    .gte('created_at', RUN_STARTED_AT)
    .order('id', { ascending: true });
  if (error) throw new Error(`audit_log no legible: ${error.message}`);
  return data ?? [];
}
const kindOf = (row) => row?.new_data?.change_kind ?? null;

// ═════════════════════════════════════════════════════════════════════
// HELPERS DE SESIÓN
// ═════════════════════════════════════════════════════════════════════

/**
 * Usuario Auth sintético con email Y teléfono confirmados por service_role.
 * El teléfono es necesario para el flujo de booking intent y se genera
 * sintético; `assertNotForbidden` garantiza que nunca colisione con un
 * número real ni con la cuenta demo. No se envía ningún SMS.
 */
async function createUser(tag, seq) {
  const stamp = Date.now().toString().slice(-6);
  const email = `asp0.${tag}.${stamp}@lucycare.test`;
  // Rango sintético 5037000xxxx, fuera de los números reales conocidos.
  const phone = assertNotForbidden(`5037000${String(seq).padStart(4, '0')}`, `createUser(${tag})`);

  const { data, error } = await admin.auth.admin.createUser({
    email, phone, email_confirm: true, phone_confirm: true,
    user_metadata: { fixture: MARK },
  });
  if (error) throw new Error(`createUser(${tag}): ${error.message}`);
  ids.users.push(data.user.id);
  return { id: data.user.id, email, phone, tag };
}

/**
 * Sesión `authenticated` REAL sin pasar por endpoints protegidos por CAPTCHA.
 * Turnstile está ACTIVO, así que signInWithPassword/signInWithOtp con la anon
 * key son rechazados. `verifyOtp` NO está protegido. Entonces:
 *   1. service_role genera un magiclink (generateLink NO envía correo);
 *   2. un cliente anon independiente lo canjea con verifyOtp;
 *   3. queda un JWT de `authenticated` genuino.
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
  if (!data?.session?.access_token) throw new Error(`verifyOtp(${user.tag}): sin sesión`);
  if (data.user?.id !== user.id) throw new Error(`verifyOtp(${user.tag}): la sesión es de otro usuario`);
  return c;
}

// ═════════════════════════════════════════════════════════════════════
// FIXTURES
// ═════════════════════════════════════════════════════════════════════

/** Contador de slots: cada cita futura va a un día distinto (anti-solapamiento s7_55). */
let dayOffset = 3;
const nextSlot = () => {
  const start = new Date(Date.now() + dayOffset++ * 86400000);
  start.setUTCHours(15, 0, 0, 0);
  return { start, end: new Date(start.getTime() + 30 * 60000) };
};

/**
 * Crea el mundo sintético completo:
 *   3 usuarios Auth (paciente, médico A, médico B) + perfiles
 *   1 clínica · 2 médicos en ella · 2 servicios · disponibilidad 24×7
 *   2 fichas de paciente (la primera vinculada y confirmada)
 *   catálogo de estados y un motivo de cancelación
 */
async function buildFixtures() {
  const uPatient = await createUser('patient', 1);
  const uDoctorA = await createUser('doctora', 2);
  const uDoctorB = await createUser('doctorb', 3);

  // handle_new_user YA creó profiles. Se hace UPDATE de `role` únicamente:
  // un upsert chocaría con full_name NOT NULL, y tocar las columnas de
  // identidad dispararía audit_profiles_identity_fn (s7_32), que inserta
  // auth.uid() (NULL bajo service_role) en audit_log.user_id NOT NULL y
  // reventaría. `role` NO está entre las columnas que ese trigger vigila.
  for (const [u, role] of [[uPatient, 'patient'], [uDoctorA, 'doctor'], [uDoctorB, 'doctor']]) {
    const { data, error } = await admin.from('profiles').update({ role }).eq('id', u.id).select('id');
    if (error) throw new Error(`profile(${u.tag}): ${error.message}`);
    if (data?.length !== 1) throw new Error(`profile(${u.tag}): handle_new_user no creó exactamente una fila`);
  }

  // Canario: si el mecanismo de sesión falla, se aborta antes de crear
  // fixtures de negocio y el cleanup solo deshace usuarios y perfiles.
  const cPatient = await sessionFor(uPatient);

  const { data: spec, error: eSpec } = await admin.from('specialties').select('id').limit(1).single();
  if (eSpec) throw new Error(`specialties: ${eSpec.message}`);
  ids.specialtyId = spec.id;

  const { data: clinic, error: eClinic } = await admin.from('clinics')
    .insert({ name: `${MARK} Clinica`, owner_id: uDoctorA.id }).select('id').single();
  if (eClinic) throw new Error(`clinic: ${eClinic.message}`);
  ids.clinicId = clinic.id;

  for (const u of [uDoctorA, uDoctorB]) {
    const { error } = await admin.from('clinic_members')
      .insert({ clinic_id: ids.clinicId, profile_id: u.id, role: 'owner', is_active: true });
    if (error) throw new Error(`clinic_member(${u.tag}): ${error.message}`);
  }

  // DOS médicos en la MISMA clínica: el cambio de doctor_id debe ser una
  // reasignación legítima, no un cruce entre clínicas.
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

  // Disponibilidad amplia para ambos médicos: evita trg_block_outside_availability.
  const rules = [];
  for (const docId of [ids.doctorId, ids.doctorId2]) {
    for (let d = 0; d <= 6; d++) {
      rules.push({
        clinic_id: ids.clinicId, doctor_id: docId, day_of_week: d,
        start_time: '00:00:00', end_time: '23:59:00', is_active: true,
      });
    }
  }
  const { data: ruleRows, error: eRules } = await admin.from('availability_rules').insert(rules).select('id');
  if (eRules) throw new Error(`availability_rules: ${eRules.message}`);
  ids.ruleIds.push(...(ruleRows ?? []).map((r) => r.id));

  // Ficha 1: vinculada y CONFIRMADA (cancel_my_appointment lo exige, s7_43).
  const { data: p1, error: eP1 } = await admin.from('patients').insert({
    clinic_id: ids.clinicId, profile_id: uPatient.id,
    full_name: `${MARK} Paciente Uno`, date_of_birth: '1990-01-01', gender: 'otro',
    link_confirmed_at: new Date().toISOString(), is_active: true,
  }).select('id').single();
  if (eP1) throw new Error(`patient 1: ${eP1.message}`);
  ids.patientId = p1.id;

  // Ficha 2: destino de la prueba de patient_reassign. Sin profile_id.
  const { data: p2, error: eP2 } = await admin.from('patients').insert({
    clinic_id: ids.clinicId, full_name: `${MARK} Paciente Dos`,
    date_of_birth: '1991-02-02', gender: 'otro', is_active: true,
  }).select('id').single();
  if (eP2) throw new Error(`patient 2: ${eP2.message}`);
  ids.patientId2 = p2.id;

  const { data: statuses, error: eSt } = await admin
    .from('appointment_statuses').select('id, name, is_final');
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
    statusId, statusProgramada: statusId('programada'),
    statusConfirmada: statusId('confirmada'),
    cancelReasonId: reason?.id ?? null,
  };
}

/** Crea una cita futura en un slot libre. `overrides` puede fijar source/notas. */
async function insertAppointment(fx, overrides = {}) {
  const { start, end } = nextSlot();
  const { data, error } = await admin.from('appointments').insert({
    clinic_id: fx.clinicId, doctor_id: fx.doctorId, patient_id: fx.patientId,
    service_id: fx.serviceId, status_id: fx.statusProgramada,
    start_time: start.toISOString(), end_time: end.toISOString(),
    source: 'lucy_directorio', price: 25,
    ...overrides,
  }).select('id, start_time, status_id').single();
  if (error) throw new Error(`insertAppointment: ${error.message}`);
  ids.apptIds.push(data.id);
  return data;
}

/**
 * Reserva por el camino real: register_booking_intent → create_booking_with_intent.
 * COBERTURA NUEVA: esta ruta NO auditaba `appointments` antes de s7_71a.
 * Se ejecuta con la SESIÓN del paciente (no service_role) para que
 * actor_kind sea `user` y user_id el uuid real.
 */
async function bookViaIntent(fx) {
  const { start } = nextSlot();
  // p_start_local es `timestamp without time zone`: hora local, sin zona.
  const startLocal = start.toISOString().replace('Z', '').split('.')[0];

  const { data: intent, error: eIntent } = await fx.cPatient.rpc('register_booking_intent', {
    p_doctor_id: fx.doctorId,
    p_service_id: fx.serviceId,
    p_start_local: startLocal,
    p_phone: assertNotForbidden(fx.uPatient.phone, 'register_booking_intent'),
  });
  if (eIntent) throw new Error(`register_booking_intent: ${eIntent.message}`);

  const intentId = intent?.intent_id ?? intent?.id ?? intent?.booking_intent_id;
  if (!intentId) {
    throw new Error(`register_booking_intent: no se encontró el id del intent en la respuesta (claves: ${Object.keys(intent ?? {}).join(', ')})`);
  }

  const { data: booking, error: eBook } = await fx.cPatient.rpc('create_booking_with_intent', {
    p_intent_id: intentId,
    p_patient_name: `${MARK} Paciente Uno`,
    p_notes: null,
  });
  if (eBook) throw new Error(`create_booking_with_intent: ${eBook.message}`);

  const appointmentId = booking?.appointment_id ?? booking?.id;
  if (!appointmentId) {
    throw new Error(`create_booking_with_intent: no se encontró appointment_id (claves: ${Object.keys(booking ?? {}).join(', ')})`);
  }
  ids.apptIds.push(appointmentId);

  // La RPC pudo crear su propia ficha de paciente: se registra para el cleanup.
  const { data: appt } = await admin.from('appointments')
    .select('patient_id').eq('id', appointmentId).maybeSingle();
  if (appt?.patient_id && appt.patient_id !== ids.patientId && appt.patient_id !== ids.patientId2) {
    if (!ids.extraPatients) ids.extraPatients = [];
    ids.extraPatients.push(appt.patient_id);
  }

  return { appointmentId, profileId: fx.uPatient.id };
}

/** Cancela una cita propia por la RPC, con la sesión del paciente. */
async function cancelAsPatient(fx) {
  const appt = await insertAppointment(fx, { status_id: fx.statusProgramada });
  ids.eventApptIds.push(appt.id);
  const note = `${MARK} nota libre que NO debe auditarse`;

  const { data, error } = await fx.cPatient.rpc('cancel_my_appointment', {
    p_appointment_id: appt.id,
    p_reason: 'no_puedo_asistir',
    p_note: note,
  });
  if (error) throw new Error(`cancel_my_appointment: ${error.message}`);
  if (data?.outcome !== 'cancelled') {
    throw new Error(`cancel_my_appointment: outcome inesperado ${JSON.stringify(data)}`);
  }
  return { appointmentId: appt.id, profileId: fx.uPatient.id, note };
}

/**
 * Firma una consulta ligada a una cita. Dispara sync_appointment_on_sign
 * (s6_02), que actualiza appointments.status_id a 'atendida' en cascada.
 * COBERTURA NUEVA: esa cascada no auditaba `appointments`.
 */
async function signConsultation(fx) {
  const appt = await insertAppointment(fx, { status_id: fx.statusConfirmada });

  const { data: cons, error: eCons } = await admin.from('consultations').insert({
    appointment_id: appt.id, clinic_id: fx.clinicId,
    doctor_id: fx.doctorId, patient_id: fx.patientId,
    status: 'draft', started_at: new Date().toISOString(),
    chief_complaint: MARK,
  }).select('id').single();
  if (eCons) throw new Error(`consultation: ${eCons.message}`);
  ids.consultIds.push(cons.id);

  const { error: eSign } = await admin.from('consultations')
    .update({ status: 'signed', signed_at: new Date().toISOString() })
    .eq('id', cons.id);
  if (eSign) throw new Error(`firmar consulta: ${eSign.message}`);

  return { appointmentId: appt.id, consultationId: cons.id };
}

// ═════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n_smoke-s7_71a — cobertura server-side de appointments\n');
  console.log(`  marca: ${MARK} · inicio: ${RUN_STARTED_AT}\n`);

  console.log('0. Fixtures sintéticas');
  const fx = await buildFixtures();
  ok(`clínica ${ids.clinicId.slice(0, 8)}… · médicos A/B · 2 fichas · 2 servicios`);
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

  // ─── 2. Reserva vía create_booking_with_intent ─────────────────────
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
    const { error: e1 } = await admin.from('appointments')
      .update({ doctor_id: fx.doctorId2 }).eq('id', a1.id);
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
      ko('5.6/5.7 no hay cancel_reasons en el catálogo — no se pudo probar el motivo');
    }

    const a4 = await insertAppointment(fx);
    n = (await auditRows(a4.id)).length;
    const slot = nextSlot();
    const { error: e4 } = await admin.from('appointments').update({
      status_id: fx.statusConfirmada,
      start_time: slot.start.toISOString(),
      end_time: slot.end.toISOString(),
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

  // ─── 7. Merge / unmerge → clasificación genérica ───────────────────
  console.log('\n7. Merge / unmerge (clasificación genérica, sin setter)');
  {
    const appt = await insertAppointment(fx);
    const n = (await auditRows(appt.id)).length;
    const { error } = await admin.from('appointments')
      .update({ patient_id: fx.patientId2 }).eq('id', appt.id);
    if (error) throw new Error(`reasignar paciente: ${error.message}`);
    const rows = await auditRows(appt.id);
    const last = rows[rows.length - 1];
    check('7.1 se agregó 1 fila', rows.length === n + 1);
    check('7.2 change_kind = patient_reassign', kindOf(last) === 'patient_reassign');
    check('7.3 SIN etiqueta patient_merge inventada', last?.new_data?.edited_via === undefined);
    check('7.4 old y new llevan patient_id', !!last?.old_data?.patient_id && !!last?.new_data?.patient_id);
  }

  // ─── 8. Firma de consulta → status_change ──────────────────────────
  console.log('\n8. Firma de consulta (cascada de s6_02)');
  {
    const r = await signConsultation(fx);
    const rows = await auditRows(r.appointmentId);
    const updates = rows.filter((x) => x.action === 'update');
    check('8.1 la cascada dejó auditoría de appointments', updates.length >= 1);
    const last = updates[updates.length - 1];
    check('8.2 change_kind = status_change', kindOf(last) === 'status_change');
    check('8.3 SIN etiqueta consultation_signed inventada', last?.new_data?.edited_via === undefined);
  }

  // ─── 9. Actualización irrelevante → SIN fila ───────────────────────
  console.log('\n9. Actualización irrelevante (sin ruido)');
  {
    const appt = await insertAppointment(fx);
    const before = (await auditRows(appt.id)).length;
    const { error } = await admin.from('appointments')
      .update({ notes: 'solo notas', internal_notes: 'solo internas' }).eq('id', appt.id);
    if (error) throw new Error(`update irrelevante: ${error.message}`);
    const after = (await auditRows(appt.id)).length;
    check('9.1 NO se escribió ninguna fila nueva', after === before);
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

  // ─── 11-12. db_direct y contexto rechazado ─────────────────────────
  console.log('\n11-12. db_direct y contexto rechazado');
  console.log(`
  ⏭️  NO ALCANZABLES desde supabase-js: exigen una conexión SIN JWT y
      set_config server-side, y PostgREST no expone ninguno de los dos
      (eso mismo es parte de la defensa).

      Bloques SQL owner-only, transaccionales y con ROLLBACK, en
      docs/OWNER_S7_71A_APPLY.md §11 (db_direct) y §12 (context_rejected).
      Usan fixtures sintéticas propias y no tocan datos existentes.
`);

  // ─── 13. CLEANUP ───────────────────────────────────────────────────
  await cleanup();

  console.log(`\n${fail === 0 ? '✅' : '❌'} _smoke-s7_71a: ${pass} OK, ${fail} fallos\n`);
  process.exit(fail === 0 ? 0 : 1);
}

// ═════════════════════════════════════════════════════════════════════
// CLEANUP + VERIFICACIÓN DE CERO RESIDUOS
// ═════════════════════════════════════════════════════════════════════
async function cleanup() {
  console.log('\n13. Cleanup');
  let cleanupErrors = 0;
  const del = async (label, promise) => {
    const { error } = await promise;
    if (error) {
      console.error(`  ⚠️  fallo al borrar ${label}: ${error.message}`);
      cleanupErrors++;
    } else {
      console.log(`  🧹 ${label}`);
    }
  };

  const apptIds = ids.apptIds.length ? ids.apptIds : [NIL];
  const userIds = ids.users.length ? ids.users : [NIL];
  const extraPatients = ids.extraPatients ?? [];

  // Orden inverso a las FK.
  if (ids.eventApptIds.length) {
    await del('eventos de cancelación',
      admin.from('appointment_patient_cancellations').delete().in('appointment_id', ids.eventApptIds));
  }
  if (ids.consultIds.length) {
    await del('consultas', admin.from('consultations').delete().in('id', ids.consultIds));
  }
  await del('citas', admin.from('appointments').delete().in('id', apptIds));

  const doctorIds = [ids.doctorId, ids.doctorId2].filter(Boolean);
  if (doctorIds.length) {
    await del('reglas de disponibilidad',
      admin.from('availability_rules').delete().in('doctor_id', doctorIds));
    await del('servicios', admin.from('services').delete().in('doctor_id', doctorIds));
  }

  const patientIds = [ids.patientId, ids.patientId2, ...extraPatients].filter(Boolean);
  if (patientIds.length) await del('pacientes', admin.from('patients').delete().in('id', patientIds));
  if (doctorIds.length) await del('médicos', admin.from('doctors').delete().in('id', doctorIds));
  if (ids.clinicId) {
    await del('membresías', admin.from('clinic_members').delete().eq('clinic_id', ids.clinicId));
    await del('clínicas', admin.from('clinics').delete().eq('id', ids.clinicId));
  }
  await del('perfiles', admin.from('profiles').delete().in('id', userIds));
  for (const uid of ids.users) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) { console.error(`  ⚠️  auth user ${uid}: ${error.message}`); cleanupErrors++; }
    else console.log(`  🧹 auth.user ${uid.slice(0, 8)}…`);
  }

  // AUDITORÍA — al final, acotada al conjunto EXACTO de UUID sintéticos,
  // a las tablas que el smoke escribe y a filas posteriores al inicio.
  const synthetic = [...allSyntheticIds(), ...extraPatients];
  const syntheticSafe = synthetic.length ? synthetic : [NIL];
  await del('audit_log · fixtures de esta corrida',
    admin.from('audit_log').delete()
      .in('record_id', syntheticSafe)
      .in('table_name', SMOKE_TABLES)
      .gte('created_at', RUN_STARTED_AT));

  // ── Verificación de CERO residuos ──
  console.log('\n  Verificación de residuos:');
  let residuals = 0;
  const countIn = async (table, col, ids_) => {
    if (!ids_.length) return 0;
    const { count, error } = await admin.from(table)
      .select('id', { count: 'exact', head: true }).in(col, ids_);
    if (error) { console.error(`  ⚠️  contar ${table}: ${error.message}`); cleanupErrors++; return -1; }
    return count ?? 0;
  };

  for (const [table, col, list] of [
    ['appointments', 'id', ids.apptIds],
    ['consultations', 'id', ids.consultIds],
    ['appointment_patient_cancellations', 'appointment_id', ids.eventApptIds],
    ['patients', 'id', patientIds],
    ['services', 'id', ids.serviceIds],
    ['availability_rules', 'id', ids.ruleIds],
    ['doctors', 'id', doctorIds],
    ['clinics', 'id', [ids.clinicId].filter(Boolean)],
    ['profiles', 'id', ids.users],
  ]) {
    const n = await countIn(table, col, list);
    if (n > 0) residuals += n;
    console.log(`    · ${table}: ${n}`);
  }

  {
    const { count, error } = await admin.from('audit_log')
      .select('id', { count: 'exact', head: true })
      .in('record_id', syntheticSafe)
      .in('table_name', SMOKE_TABLES)
      .gte('created_at', RUN_STARTED_AT);
    if (error) { console.error(`  ⚠️  contar audit_log: ${error.message}`); cleanupErrors++; }
    else { residuals += count ?? 0; console.log(`    · audit_log (sintético): ${count ?? 0}`); }
  }

  check(`13.1 CERO residuos (${residuals})`, residuals === 0);
  check('13.2 el cleanup no reportó errores', cleanupErrors === 0);
}

main().catch(async (e) => {
  console.error(`\n💥 ${e.message}\n`);
  try { await cleanup(); } catch (ce) { console.error(`cleanup falló: ${ce.message}`); }
  process.exit(1);
});
