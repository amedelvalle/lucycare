/**
 * _smoke-s7_70.mjs — CANCELACIÓN-PACIENTE-P0 + hardening de appointments.
 *
 * ⛔ NO SE AUTOEJECUTA. Requiere DOS confirmaciones explícitas:
 *
 *      CP0_SMOKE_AUTHORIZED=1 node scripts/_smoke-s7_70.mjs --run
 *
 *    Sin ambas imprime este encabezado y sale con 0 sin tocar la DB.
 *
 * ── REQUISITOS DE EJECUCIÓN (autorización SEPARADA del owner) ──
 *   • service_role (crea y limpia las fixtures). Su uso exige autorización
 *     puntual del owner, incluso para pruebas.
 *   • La migración s7_70 YA aplicada. El smoke NO aplica SQL.
 *
 * ── REGLAS DE DATOS (vinculantes) ──
 *   • Fixtures SINTÉTICAS creadas desde cero y marcadas `CP0_FIXTURE`.
 *   • JAMÁS Katherine, JAMÁS Camilo, JAMÁS pacientes o médicos reales.
 *   • Usuarios de prueba por EMAIL + contraseña: no se envía ningún SMS,
 *     no se toca Twilio ni el flujo OTP.
 *   • Cleanup obligatorio con verificación de 0 residuos.
 *   • La auditoría generada por las fixtures SÍ se borra, pero SOLO la
 *     acotada al conjunto EXACTO de UUID sintéticos, a las tablas que el
 *     smoke escribe y a filas posteriores al inicio de la corrida. Sin
 *     filtros por nombre, correo ni prefijo. La auditoría de datos reales
 *     nunca se toca.
 *
 * ── QUÉ PRUEBA ──
 *   El paciente pierde el UPDATE directo (6 vectores) y gana la RPC.
 *   El médico conserva todas sus operaciones. Nadie de otra clínica toca
 *   la cita. La tabla de eventos es append-only incluso para el dueño.
 *
 * ── SOBRE EL A/B ──
 *   La existencia previa del agujero NO se prueba ejecutando los PATCH
 *   inseguros contra producción: quedó probada documentalmente por la
 *   combinación policy + ACL capturada en el preflight del owner
 *   (appointments_update con rama de paciente + authenticated=arw sobre
 *   tabla completa, sin ACL por columna).
 */
import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './_lib/env.mjs';

// ─────────────────────────────────────────────────────────────────────
// GUARD DE EJECUCIÓN
// ─────────────────────────────────────────────────────────────────────
const ARMED = process.argv.includes('--run') && process.env.CP0_SMOKE_AUTHORIZED === '1';
if (!ARMED) {
  console.log(`
_smoke-s7_70 — NO EJECUTADO (guard activo).

Este smoke escribe en la base de datos y usa service_role.
Para ejecutarlo hace falta autorización explícita del owner y:

    CP0_SMOKE_AUTHORIZED=1 node scripts/_smoke-s7_70.mjs --run

Requisitos previos:
  · migración s7_70 aplicada por el owner;
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

const MARK = 'CP0_FIXTURE';
let pass = 0, fail = 0;
const check = (desc, got, expected = true) => {
  const ok = got === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${desc}${ok ? '' : ` → ${JSON.stringify(got)} (esperado ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
};
/** Un PATCH bloqueado por privilegio/RLS: PostgREST devuelve 42501 o 0 filas. */
const isDenied = (error, data) =>
  (error && (error.code === '42501' || /permission denied/i.test(error.message || ''))) ||
  (!error && Array.isArray(data) && data.length === 0);

/** Instante de arranque: acota el borrado de auditoría a ESTA corrida. */
const RUN_STARTED_AT = new Date().toISOString();

const ids = {
  users: [], clinicId: null, doctorId: null, specialtyId: null,
  patientId: null, apptIds: [], serviceIds: [], ruleIds: [], eventIds: [],
};

/** Tablas que el smoke escribe: acota el borrado de auditoría por table_name. */
const SMOKE_TABLES = [
  'appointments', 'patients', 'profiles', 'clinics', 'clinic_members',
  'doctors', 'services', 'availability_rules', 'appointment_patient_cancellations',
];

/** Conjunto EXACTO de UUID sintéticos. Nada se borra fuera de este conjunto. */
const allSyntheticIds = () => [
  ...ids.users,          // usuarios Auth == perfiles (comparten id)
  ids.clinicId, ids.doctorId, ids.patientId,
  ...ids.serviceIds, ...ids.ruleIds, ...ids.apptIds, ...ids.eventIds,
].filter(Boolean);

/** Inventario legible de lo creado. Sin secretos, tokens ni contraseñas. */
function printInventory() {
  console.log('\nIDs SINTÉTICOS CREADOS (CP0_FIXTURE)');
  console.log(`  corrida iniciada: ${RUN_STARTED_AT}`);
  ids.users.forEach((u, i) => console.log(`  usuario Auth / perfil [${i}]: ${u}`));
  console.log(`  clínica:      ${ids.clinicId ?? '—'}`);
  console.log(`  membresías:   clinic_id=${ids.clinicId ?? '—'} × profile_id=${ids.users[1] ?? '—'}`);
  console.log(`  médico:       ${ids.doctorId ?? '—'}`);
  console.log(`  paciente:     ${ids.patientId ?? '—'}`);
  console.log(`  servicios:    ${ids.serviceIds.join(', ') || '—'}`);
  console.log(`  reglas:       ${ids.ruleIds.length} (${ids.ruleIds.join(', ') || '—'})`);
  console.log(`  citas:        ${ids.apptIds.join(', ') || '—'}`);
  console.log(`  eventos:      ${ids.eventIds.join(', ') || '—'}`);
  console.log(`  total de UUID sintéticos: ${allSyntheticIds().length}\n`);
}

async function createUser(tag) {
  const email = `cp0.${tag}.${Date.now()}@lucycare.test`;
  const password = `Cp0-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { fixture: MARK },
  });
  if (error) throw new Error(`createUser(${tag}): ${error.message}`);
  ids.users.push(data.user.id);
  return { id: data.user.id, email, password };
}

async function sessionFor(user) {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`signIn(${user.email}): ${error.message}`);
  return c;
}

async function main() {
  console.log('\n_smoke-s7_70 — cancelación por paciente + hardening\n');

  // ═══ SETUP (service_role) ═══════════════════════════════════════════
  console.log('SETUP — fixtures sintéticas CP0_FIXTURE');

  const uPatient = await createUser('patient');
  const uDoctor = await createUser('doctor');
  const uOther = await createUser('other');

  // ⚠️ NO se escribe `full_name` en profiles. El trigger legacy
  // audit_profiles_identity_fn (s7_32) se dispara con
  // `AFTER UPDATE OF full_name, document_type, …` e inserta `auth.uid()` en
  // audit_log.user_id, que es NOT NULL — bajo service_role auth.uid() es NULL
  // y la escritura revienta. `role` y `email` NO están en esa lista, así que
  // actualizarlos es seguro. El nombre visible del paciente vive en
  // patients.full_name, que es lo que consume la tarjeta del médico.
  // (Sanear ese trigger con COALESCE es AUDIT-SEC-P0, frente aparte.)
  for (const [u, role, label] of [
    [uPatient, 'patient', 'paciente'],
    [uDoctor, 'doctor', 'medico'],
    [uOther, 'doctor', 'ajeno'],
  ]) {
    const { error } = await admin.from('profiles')
      .upsert({ id: u.id, role, email: u.email });
    if (error) throw new Error(`profile(${label}): ${error.message}`);
  }

  const { data: spec } = await admin.from('specialties').select('id').limit(1).single();
  ids.specialtyId = spec.id;

  const { data: clinic, error: eClinic } = await admin.from('clinics')
    .insert({ name: `${MARK} Clinica` }).select('id').single();
  if (eClinic) throw new Error(`clinic: ${eClinic.message}`);
  ids.clinicId = clinic.id;

  const { error: eMember } = await admin.from('clinic_members')
    .insert({ clinic_id: ids.clinicId, profile_id: uDoctor.id, role: 'owner', is_active: true });
  if (eMember) throw new Error(`clinic_member: ${eMember.message}`);

  const { data: doctor, error: eDoctor } = await admin.from('doctors')
    .insert({ clinic_id: ids.clinicId, profile_id: uDoctor.id, specialty_id: ids.specialtyId })
    .select('id').single();
  if (eDoctor) throw new Error(`doctor: ${eDoctor.message}`);
  ids.doctorId = doctor.id;

  const { data: svc, error: eSvc } = await admin.from('services')
    .insert({ doctor_id: ids.doctorId, name: `${MARK} Consulta`, duration_minutes: 30, is_active: true })
    .select('id').single();
  if (eSvc) throw new Error(`service: ${eSvc.message}`);
  ids.serviceIds.push(svc.id);

  // Disponibilidad amplia para no chocar con block_outside_availability.
  const rules = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    doctor_id: ids.doctorId, day_of_week: d,
    start_time: '00:00:00', end_time: '23:59:00', is_active: true,
  }));
  const { data: ruleRows, error: eRules } = await admin
    .from('availability_rules').insert(rules).select('id');
  if (eRules) throw new Error(`availability_rules: ${eRules.message}`);
  ids.ruleIds.push(...(ruleRows ?? []).map((r) => r.id));

  const { data: patient, error: ePatient } = await admin.from('patients')
    .insert({
      clinic_id: ids.clinicId, profile_id: uPatient.id,
      full_name: `${MARK} Paciente`, date_of_birth: '1990-01-01',
      link_confirmed_at: new Date().toISOString(), is_active: true,
    }).select('id').single();
  if (ePatient) throw new Error(`patient: ${ePatient.message}`);
  ids.patientId = patient.id;

  // `is_final` DEBE seleccionarse: sin él, el cálculo de estados finales
  // daría `undefined !== false` = true para TODOS y el test del slot
  // liberado pasaría siempre (falso positivo).
  const { data: statuses, error: eStatuses } = await admin
    .from('appointment_statuses').select('id, name, is_final');
  if (eStatuses) throw new Error(`statuses: ${eStatuses.message}`);
  const statusId = (n) => statuses.find((s) => s.name === n).id;
  const FINAL_IDS = statuses.filter((s) => s.is_final === true).map((s) => s.id);
  if (FINAL_IDS.length === 0) throw new Error('catálogo sin estados finales: is_final no llegó');

  /** Crea una cita futura en un slot libre (offset en días para no solapar). */
  const makeAppt = async (offsetDays, statusName = 'programada') => {
    const start = new Date(Date.now() + offsetDays * 86400000);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60000);
    const { data, error } = await admin.from('appointments').insert({
      clinic_id: ids.clinicId, doctor_id: ids.doctorId, patient_id: ids.patientId,
      service_id: ids.serviceIds[0], status_id: statusId(statusName),
      start_time: start.toISOString(), end_time: end.toISOString(),
      source: 'lucy_directorio', price: 25,
    }).select('id, start_time').single();
    if (error) throw new Error(`appointment(+${offsetDays}d): ${error.message}`);
    ids.apptIds.push(data.id);
    return data;
  };

  const apptVectors = await makeAppt(3);   // para los 6 PATCH bloqueados
  const apptCancel = await makeAppt(5);    // cancelación legítima por RPC
  printInventory();

  const cPatient = await sessionFor(uPatient);
  const cDoctor = await sessionFor(uDoctor);
  const cOther = await sessionFor(uOther);

  // ═══ 1-6. El paciente NO puede escribir columnas de su cita ═════════
  console.log('1-6. UPDATE directo del paciente — debe quedar cerrado');
  const vectors = [
    ['status_id', { status_id: statusId('atendida') }],
    ['price', { price: 0 }],
    ['payment_status', { payment_status: 'paid' }],
    ['doctor_id', { doctor_id: ids.doctorId }],
    ['start_time', { start_time: new Date(Date.now() + 9 * 86400000).toISOString() }],
    ['internal_notes', { internal_notes: 'CP0 intento' }],
  ];
  for (const [col, payload] of vectors) {
    const { data, error } = await cPatient.from('appointments')
      .update(payload).eq('id', apptVectors.id).select('id');
    check(`paciente NO puede modificar ${col}`, isDenied(error, data));
  }
  // La fila quedó intacta.
  const { data: untouched } = await admin.from('appointments')
    .select('status_id, price, payment_status, internal_notes')
    .eq('id', apptVectors.id).single();
  check('la cita no cambió tras los 6 intentos',
    untouched.status_id === statusId('programada') && Number(untouched.price) === 25
    && untouched.payment_status === 'pending' && untouched.internal_notes === null);

  // ═══ 7. Cancelación legítima por RPC ════════════════════════════════
  console.log('\n7. Cancelación por RPC');
  const { data: rpc1, error: eRpc1 } = await cPatient.rpc('cancel_my_appointment', {
    p_appointment_id: apptCancel.id, p_reason: 'no_puedo_asistir', p_note: '  ',
  });
  check('la RPC responde éxito', !eRpc1 && rpc1?.outcome === 'cancelled');
  const { data: afterCancel } = await admin.from('appointments')
    .select('status_id').eq('id', apptCancel.id).single();
  check('estado = cancelada', afterCancel.status_id === statusId('cancelada'));
  const { data: evt } = await admin.from('appointment_patient_cancellations')
    .select('*').eq('appointment_id', apptCancel.id);
  check('1 fila de evento', evt.length, 1);
  if (evt.length) ids.eventIds.push(apptCancel.id);
  check('actor = el paciente', evt[0]?.cancelled_by_profile_id === uPatient.id);
  check('nota solo-espacios normalizada a NULL', evt[0]?.note, null);
  check('motivo persistido', evt[0]?.reason, 'no_puedo_asistir');
  const { data: audit } = await admin.from('audit_log').select('new_data')
    .eq('table_name', 'appointments').eq('record_id', apptCancel.id);
  check('auditoría con edited_via=patient_self_cancel',
    audit.some((r) => r.new_data?.edited_via === 'patient_self_cancel'));
  check('la nota libre NO está en audit_log',
    JSON.stringify(audit).includes('v_note') === false);

  // Idempotencia.
  const { data: rpc2 } = await cPatient.rpc('cancel_my_appointment', { p_appointment_id: apptCancel.id });
  check('doble envío → already_cancelled_by_patient', rpc2?.outcome, 'already_cancelled_by_patient');
  const { data: evt2 } = await admin.from('appointment_patient_cancellations')
    .select('appointment_id').eq('appointment_id', apptCancel.id);
  check('sigue habiendo 1 sola fila de evento', evt2.length, 1);

  // Horario liberado.
  const { data: activos } = await admin.from('appointments')
    .select('id, status_id').eq('doctor_id', ids.doctorId).eq('start_time', apptCancel.start_time);
  check('el slot quedó libre (0 citas activas)',
    activos.filter((a) => !FINAL_IDS.includes(a.status_id)).length, 0);
  // Historial conservado.
  const { count: stillThere } = await admin.from('appointments')
    .select('id', { count: 'exact', head: true }).eq('id', apptCancel.id);
  check('la cita sigue existiendo (sin borrado físico)', stillThere, 1);

  // ═══ 8. El médico conserva TODAS sus operaciones ════════════════════
  // Las transiciones terminales consumen la cita, así que cada una usa su
  // propia cita: encadenarlas sobre una sola daría falsos negativos.
  console.log('\n8. Operaciones legítimas del médico');

  const docUpd = async (label, apptId, payload) => {
    const { data, error } = await cDoctor.from('appointments')
      .update(payload).eq('id', apptId).select('id');
    check(`médico puede ${label}`, !error && Array.isArray(data) && data.length === 1);
  };

  // 8.a Columnas editables sobre una cita que no cambia de estado.
  const apptEdit = await makeAppt(13);
  await docUpd('editar notes', apptEdit.id, { notes: 'CP0 nota visible' });
  await docUpd('editar internal_notes', apptEdit.id, { internal_notes: 'CP0 nota interna' });
  await docUpd('editar price', apptEdit.id, { price: 30 });
  await docUpd('editar service_id', apptEdit.id, { service_id: ids.serviceIds[0] });
  await docUpd('escribir updated_at (el cliente lo manda)', apptEdit.id,
    { updated_at: new Date().toISOString() });
  // Reprogramar: start_time + end_time juntos, a un slot libre.
  const reStart = new Date(Date.now() + 14 * 86400000); reStart.setUTCMinutes(0, 0, 0);
  await docUpd('reprogramar start_time/end_time', apptEdit.id, {
    start_time: reStart.toISOString(),
    end_time: new Date(reStart.getTime() + 30 * 60000).toISOString(),
  });

  // 8.b Cadena completa de estados no terminales.
  const apptFlow = await makeAppt(15);
  await docUpd('confirmar', apptFlow.id, { status_id: statusId('confirmada') });
  await docUpd('pasar a sala', apptFlow.id, { status_id: statusId('en_sala') });
  await docUpd('atender', apptFlow.id, { status_id: statusId('atendida') });

  // 8.c Terminales, cada una en su propia cita.
  const apptNoShow = await makeAppt(17);
  await docUpd('marcar no asistió', apptNoShow.id, { status_id: statusId('no_asistio') });

  const apptDocCancel = await makeAppt(19);
  const { data: reasons } = await admin.from('cancel_reasons')
    .select('id').eq('is_active', true).limit(1);
  await docUpd('cancelar con cancel_reason_id', apptDocCancel.id, {
    status_id: statusId('cancelada'),
    cancel_reason_id: reasons?.[0]?.id ?? null,
  });

  // 8.d Columnas fuera del grant: bloqueadas incluso para el médico.
  for (const [col, payload] of [
    ['payment_status', { payment_status: 'paid' }],
    ['patient_id', { patient_id: ids.patientId }],
    ['doctor_id', { doctor_id: ids.doctorId }],
    ['clinic_id', { clinic_id: ids.clinicId }],
  ]) {
    const { data, error } = await cDoctor.from('appointments')
      .update(payload).eq('id', apptEdit.id).select('id');
    check(`médico NO puede escribir ${col} (fuera del grant)`, isDenied(error, data));
  }

  // ═══ 9. Otra clínica ════════════════════════════════════════════════
  console.log('\n9. Aislamiento entre clínicas');
  const { data: dOther, error: eOther } = await cOther.from('appointments')
    .update({ notes: 'CP0 ajeno' }).eq('id', apptVectors.id).select('id');
  check('usuario de otra clínica no modifica la cita', isDenied(eOther, dOther));
  const { data: rpcOther } = await cOther.rpc('cancel_my_appointment', {
    p_appointment_id: apptVectors.id,
  }).then((r) => r, (r) => r);
  check('la RPC rechaza a un tercero (P0111 genérico)',
    rpcOther === null || rpcOther === undefined || rpcOther?.outcome === undefined);

  // ═══ 10. Tabla de eventos append-only ═══════════════════════════════
  console.log('\n10. appointment_patient_cancellations es append-only');
  const { data: iData, error: iErr } = await cPatient
    .from('appointment_patient_cancellations')
    .insert({
      appointment_id: apptVectors.id, cancelled_at: new Date().toISOString(),
      cancelled_by_profile_id: uPatient.id,
    }).select('appointment_id');
  check('INSERT directo bloqueado', isDenied(iErr, iData));
  const { data: uData, error: uErr } = await cPatient
    .from('appointment_patient_cancellations')
    .update({ reason: 'otro' }).eq('appointment_id', apptCancel.id).select('appointment_id');
  check('UPDATE directo bloqueado', isDenied(uErr, uData));
  const { data: dData, error: dErr } = await cPatient
    .from('appointment_patient_cancellations')
    .delete().eq('appointment_id', apptCancel.id).select('appointment_id');
  check('DELETE directo bloqueado', isDenied(dErr, dData));
  const { data: readable } = await cPatient
    .from('appointment_patient_cancellations').select('appointment_id')
    .eq('appointment_id', apptCancel.id);
  check('el paciente SÍ puede leer su evento', readable?.length, 1);

  // ═══ 11. Validaciones de entrada ════════════════════════════════════
  console.log('\n11. Validación de motivo y nota');
  const apptV2 = await makeAppt(11);
  const { error: eBadReason } = await cPatient.rpc('cancel_my_appointment', {
    p_appointment_id: apptV2.id, p_reason: 'no_quiero',
  });
  check('motivo inválido → P0114', eBadReason?.code, 'P0114');
  const { error: eLongNote } = await cPatient.rpc('cancel_my_appointment', {
    p_appointment_id: apptV2.id, p_note: 'x'.repeat(301),
  });
  check('nota > 300 → P0115', eLongNote?.code, 'P0115');
  const { data: stillOpen } = await admin.from('appointments')
    .select('status_id').eq('id', apptV2.id).single();
  check('la cita NO se canceló en los intentos inválidos',
    stillOpen.status_id === statusId('programada'));

  // ═══ 12. Elegibilidad temporal y de estado ══════════════════════════
  console.log('\n12. Elegibilidad y no atribución');
  // Cita cancelada por el MÉDICO: no tiene fila de evento del paciente.
  const { data: rpcOther2, error: eOther2 } = await cPatient.rpc('cancel_my_appointment', {
    p_appointment_id: apptDocCancel.id,
  });
  check('cancelada por el médico → resultado terminal, sin error',
    !eOther2 && rpcOther2?.outcome === 'already_cancelled_by_other');
  check('no se atribuye al paciente', rpcOther2?.success, false);
  const { data: evtNone } = await admin.from('appointment_patient_cancellations')
    .select('appointment_id').eq('appointment_id', apptDocCancel.id);
  check('no se insertó evento retrospectivo', evtNone.length, 0);
  // Estado no cancelable (atendida).
  const { error: eAtendida } = await cPatient.rpc('cancel_my_appointment', {
    p_appointment_id: apptFlow.id,
  });
  check('cita atendida → P0112', eAtendida?.code, 'P0112');

  // ═══ 13. Tarjeta del médico ═════════════════════════════════════════
  console.log('\n13. list_recent_patient_cancellations');
  const { data: card, error: eCard } = await cDoctor.rpc('list_recent_patient_cancellations');
  check('el médico recibe su tarjeta', !eCard && Array.isArray(card));
  check('incluye la cancelación del paciente',
    (card ?? []).some((r) => r.appointment_id === apptCancel.id));
  check('máximo 5 filas', (card ?? []).length <= 5);
  const { data: cardPatient } = await cPatient.rpc('list_recent_patient_cancellations');
  check('un paciente no obtiene filas', (cardPatient ?? []).length, 0);
  const { data: cardOther } = await cOther.rpc('list_recent_patient_cancellations');
  check('un médico ajeno no ve estas cancelaciones',
    (cardOther ?? []).some((r) => r.appointment_id === apptCancel.id), false);
}

// ═══ CLEANUP ══════════════════════════════════════════════════════════
// Cada borrado se verifica: un error silenciado dejaría residuos y el
// "0 residuos" sería una afirmación falsa. Al final se cuenta CADA objeto.
async function cleanup() {
  console.log('\nCLEANUP');
  const NIL = '00000000-0000-0000-0000-000000000000';
  const apptIds = ids.apptIds.length ? ids.apptIds : [NIL];
  const userIds = ids.users.length ? ids.users : [NIL];
  let cleanupErrors = 0;

  /** Ejecuta un borrado y falla ruidosamente si la DB devuelve error. */
  const del = async (label, promise) => {
    const { error } = await promise;
    if (error) {
      console.error(`  ⚠️  fallo al borrar ${label}: ${error.message}`);
      cleanupErrors++;
    }
  };

  // 1. Eventos → citas (respeta la FK sin ON DELETE).
  await del('eventos de cancelación',
    admin.from('appointment_patient_cancellations').delete().in('appointment_id', apptIds));
  await del('citas', admin.from('appointments').delete().in('id', apptIds));

  // 2. Dependencias del médico.
  if (ids.doctorId) {
    await del('reglas de disponibilidad',
      admin.from('availability_rules').delete().eq('doctor_id', ids.doctorId));
    await del('servicios', admin.from('services').delete().eq('doctor_id', ids.doctorId));
  }

  // 3. Fichas, médico, membresías, clínica.
  if (ids.patientId) await del('paciente', admin.from('patients').delete().eq('id', ids.patientId));
  if (ids.doctorId) await del('médico', admin.from('doctors').delete().eq('id', ids.doctorId));
  if (ids.clinicId) {
    await del('membresías', admin.from('clinic_members').delete().eq('clinic_id', ids.clinicId));
    await del('clínica', admin.from('clinics').delete().eq('id', ids.clinicId));
  }

  // 4. Perfiles y usuarios de Auth.
  await del('perfiles', admin.from('profiles').delete().in('id', userIds));
  for (const uid of ids.users) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) {
      console.error(`  ⚠️  fallo al borrar auth user ${uid}: ${error.message}`);
      cleanupErrors++;
    }
  }

  // 5. AUDITORÍA — AL FINAL, después de borrar todo lo demás, y acotada al
  //    conjunto EXACTO de UUID sintéticos. Sin filtros por nombre, correo ni
  //    prefijo: solo record_id ∈ {ids de esta corrida} y table_name ∈ {tablas
  //    que el smoke escribe}, restringido además a filas creadas DESPUÉS del
  //    inicio de la corrida. Auditoría de datos reales: intacta.
  const synthetic = allSyntheticIds();
  const syntheticSafe = synthetic.length ? synthetic : [NIL];

  // 5.a La auditoría de la cancelación por RPC, con su marca específica.
  await del('audit_log · cancelación del paciente',
    admin.from('audit_log').delete()
      .eq('table_name', 'appointments')
      .in('record_id', apptIds)
      .eq('new_data->>edited_via', 'patient_self_cancel')
      .gte('created_at', RUN_STARTED_AT));

  // 5.b Cualquier otra auditoría que las fixtures hayan disparado (triggers
  //     legacy de patients/consultations/prescriptions, etc.).
  await del('audit_log · resto de fixtures',
    admin.from('audit_log').delete()
      .in('record_id', syntheticSafe)
      .in('table_name', SMOKE_TABLES)
      .gte('created_at', RUN_STARTED_AT));

  // ── Verificación de CERO residuos, objeto por objeto ──
  const countOf = async (table, col, filter) => {
    const q = admin.from(table).select(col, { count: 'exact', head: true });
    const { count, error } = await filter(q);
    if (error) {
      console.error(`  ⚠️  no se pudo contar ${table}: ${error.message}`);
      cleanupErrors++;
      return -1;
    }
    return count ?? 0;
  };

  check('0 eventos residuales',
    await countOf('appointment_patient_cancellations', 'appointment_id',
      (q) => q.in('appointment_id', apptIds)), 0);
  check('0 citas residuales',
    await countOf('appointments', 'id', (q) => q.in('id', apptIds)), 0);
  check('0 reglas de disponibilidad residuales',
    await countOf('availability_rules', 'id',
      (q) => q.eq('doctor_id', ids.doctorId ?? NIL)), 0);
  check('0 servicios residuales',
    await countOf('services', 'id', (q) => q.like('name', `${MARK}%`)), 0);
  check('0 pacientes residuales',
    await countOf('patients', 'id', (q) => q.like('full_name', `${MARK}%`)), 0);
  check('0 médicos residuales',
    await countOf('doctors', 'id', (q) => q.eq('id', ids.doctorId ?? NIL)), 0);
  check('0 membresías residuales',
    await countOf('clinic_members', 'profile_id',
      (q) => q.eq('clinic_id', ids.clinicId ?? NIL)), 0);
  check('0 clínicas residuales',
    await countOf('clinics', 'id', (q) => q.like('name', `${MARK}%`)), 0);
  check('0 perfiles residuales',
    await countOf('profiles', 'id', (q) => q.in('id', userIds)), 0);

  // Auditoría: cero filas para TODO el conjunto sintético, no solo para las
  // citas canceladas. Se cuenta por tabla para poder reportar el detalle.
  let auditTotal = 0;
  for (const t of SMOKE_TABLES) {
    const n = await countOf('audit_log', 'id',
      (q) => q.eq('table_name', t).in('record_id', syntheticSafe));
    if (n !== 0) console.log(`     · audit_log[${t}] = ${n}`);
    auditTotal += Math.max(n, 0);
  }
  check('0 auditorías residuales para TODO el conjunto sintético', auditTotal, 0);

  // Usuarios de Auth: se confirma con getUserById, NO con listUsers — esa
  // API está rota en este proyecto (paginación con fila corrupta) y daría
  // un falso "no existe". Un 403 intermitente es INDETERMINADO, no ausencia:
  // se reintenta antes de concluir.
  let ghosts = 0;
  for (const uid of ids.users) {
    let gone = false;
    for (let attempt = 0; attempt < 3 && !gone; attempt++) {
      const { data, error } = await admin.auth.admin.getUserById(uid);
      if (error && /not.?found/i.test(error.message || '')) { gone = true; break; }
      if (!error && !data?.user) { gone = true; break; }
      if (!error && data?.user) break;           // existe de verdad
      await new Promise((r) => setTimeout(r, 400)); // 403 → indeterminado
    }
    if (!gone) ghosts++;
  }
  check('0 usuarios Auth residuales (getUserById, no listUsers)', ghosts, 0);

  check('cleanup sin errores de escritura', cleanupErrors, 0);
  console.log(`  ℹ️  auditoría borrada SOLO para ${synthetic.length} UUID sintéticos, ` +
    `en ${SMOKE_TABLES.length} tablas, desde ${RUN_STARTED_AT}. ` +
    'La auditoría de datos reales no se toca.');
}

main()
  .catch((err) => { console.error('\n💥 error:', err.message); fail++; })
  .finally(async () => {
    await cleanup();
    console.log(`\n${fail === 0 ? '✅' : '❌'} _smoke-s7_70: pass=${pass} fail=${fail}\n`);
    process.exit(fail === 0 ? 0 : 1);
  });
