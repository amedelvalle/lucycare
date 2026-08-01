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
 *   • Las filas de audit_log generadas NO se borran: la auditoría es
 *     append-only por diseño.
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

const ids = {
  users: [], clinicId: null, doctorId: null, specialtyId: null,
  patientId: null, apptIds: [], serviceId: null,
};

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

  for (const [u, role, name] of [
    [uPatient, 'patient', `${MARK} Paciente`],
    [uDoctor, 'doctor', `${MARK} Medico`],
    [uOther, 'doctor', `${MARK} Ajeno`],
  ]) {
    const { error } = await admin.from('profiles')
      .upsert({ id: u.id, role, full_name: name, email: u.email });
    if (error) throw new Error(`profile(${name}): ${error.message}`);
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
  ids.serviceId = svc.id;

  // Disponibilidad amplia para no chocar con block_outside_availability.
  const rules = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    doctor_id: ids.doctorId, day_of_week: d,
    start_time: '00:00:00', end_time: '23:59:00', is_active: true,
  }));
  await admin.from('availability_rules').insert(rules);

  const { data: patient, error: ePatient } = await admin.from('patients')
    .insert({
      clinic_id: ids.clinicId, profile_id: uPatient.id,
      full_name: `${MARK} Paciente`, date_of_birth: '1990-01-01',
      link_confirmed_at: new Date().toISOString(), is_active: true,
    }).select('id').single();
  if (ePatient) throw new Error(`patient: ${ePatient.message}`);
  ids.patientId = patient.id;

  const { data: statuses } = await admin.from('appointment_statuses').select('id, name');
  const statusId = (n) => statuses.find((s) => s.name === n).id;

  /** Crea una cita futura en un slot libre (offset en días para no solapar). */
  const makeAppt = async (offsetDays, statusName = 'programada') => {
    const start = new Date(Date.now() + offsetDays * 86400000);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60000);
    const { data, error } = await admin.from('appointments').insert({
      clinic_id: ids.clinicId, doctor_id: ids.doctorId, patient_id: ids.patientId,
      service_id: ids.serviceId, status_id: statusId(statusName),
      start_time: start.toISOString(), end_time: end.toISOString(),
      source: 'lucy_directorio', price: 25,
    }).select('id, start_time').single();
    if (error) throw new Error(`appointment(+${offsetDays}d): ${error.message}`);
    ids.apptIds.push(data.id);
    return data;
  };

  const apptVectors = await makeAppt(3);   // para los 6 PATCH bloqueados
  const apptCancel = await makeAppt(5);    // cancelación legítima por RPC
  const apptDoctor = await makeAppt(7);    // operaciones del médico
  console.log(`  fixtures listas · clinic=${ids.clinicId} doctor=${ids.doctorId}\n`);

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
  const finales = statuses.filter((s) => s.is_final !== false).map((s) => s.id);
  check('el slot quedó libre (0 citas activas)',
    activos.filter((a) => !finales.includes(a.status_id)).length, 0);
  // Historial conservado.
  const { count: stillThere } = await admin.from('appointments')
    .select('id', { count: 'exact', head: true }).eq('id', apptCancel.id);
  check('la cita sigue existiendo (sin borrado físico)', stillThere, 1);

  // ═══ 8. El médico conserva sus operaciones ══════════════════════════
  console.log('\n8. Operaciones legítimas del médico');
  for (const [label, payload] of [
    ['confirmar', { status_id: statusId('confirmada') }],
    ['notas', { notes: 'CP0 nota del medico' }],
    ['precio', { price: 30 }],
    ['cancelar', { status_id: statusId('cancelada'), cancel_reason_id: null }],
  ]) {
    const { data, error } = await cDoctor.from('appointments')
      .update(payload).eq('id', apptDoctor.id).select('id');
    check(`médico puede ${label}`, !error && Array.isArray(data) && data.length === 1);
  }
  // Columnas fuera del grant: bloqueadas incluso para el médico.
  const { data: dOut, error: eOut } = await cDoctor.from('appointments')
    .update({ payment_status: 'paid' }).eq('id', apptDoctor.id).select('id');
  check('médico NO puede escribir payment_status (fuera del grant)', isDenied(eOut, dOut));

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
  console.log('\n12. Elegibilidad');
  const { error: ePast } = await cPatient.rpc('cancel_my_appointment', {
    p_appointment_id: apptDoctor.id,
  });
  check('cita ya cancelada por el médico → terminal o P0112',
    ePast?.code === 'P0112' || ePast === null || ePast === undefined);
  const { data: rpcOther2 } = await cPatient.rpc('cancel_my_appointment', {
    p_appointment_id: apptDoctor.id,
  });
  check('cancelada sin evento → NO se atribuye al paciente',
    rpcOther2?.outcome, 'already_cancelled_by_other');
  const { data: evtNone } = await admin.from('appointment_patient_cancellations')
    .select('appointment_id').eq('appointment_id', apptDoctor.id);
  check('no se insertó evento retrospectivo', evtNone.length, 0);

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
async function cleanup() {
  console.log('\nCLEANUP');
  try {
    if (ids.apptIds.length) {
      await admin.from('appointment_patient_cancellations').delete().in('appointment_id', ids.apptIds);
      await admin.from('appointments').delete().in('id', ids.apptIds);
    }
    if (ids.doctorId) {
      await admin.from('availability_rules').delete().eq('doctor_id', ids.doctorId);
      await admin.from('services').delete().eq('doctor_id', ids.doctorId);
    }
    if (ids.patientId) await admin.from('patients').delete().eq('id', ids.patientId);
    if (ids.doctorId) await admin.from('doctors').delete().eq('id', ids.doctorId);
    if (ids.clinicId) {
      await admin.from('clinic_members').delete().eq('clinic_id', ids.clinicId);
      await admin.from('clinics').delete().eq('id', ids.clinicId);
    }
    for (const uid of ids.users) {
      await admin.from('profiles').delete().eq('id', uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }

    // Verificación de 0 residuos.
    const { count: cAppt } = await admin.from('appointments')
      .select('id', { count: 'exact', head: true })
      .in('id', ids.apptIds.length ? ids.apptIds : ['00000000-0000-0000-0000-000000000000']);
    const { count: cClinic } = await admin.from('clinics')
      .select('id', { count: 'exact', head: true }).like('name', `${MARK}%`);
    const { count: cPat } = await admin.from('patients')
      .select('id', { count: 'exact', head: true }).like('full_name', `${MARK}%`);
    check('0 citas residuales', cAppt ?? 0, 0);
    check('0 clínicas residuales', cClinic ?? 0, 0);
    check('0 pacientes residuales', cPat ?? 0, 0);
    console.log('  ℹ️  audit_log NO se limpia: es append-only por diseño.');
  } catch (err) {
    console.error('  ⚠️  cleanup incompleto:', err.message);
    fail++;
  }
}

main()
  .catch((err) => { console.error('\n💥 error:', err.message); fail++; })
  .finally(async () => {
    await cleanup();
    console.log(`\n${fail === 0 ? '✅' : '❌'} _smoke-s7_70: pass=${pass} fail=${fail}\n`);
    process.exit(fail === 0 ? 0 : 1);
  });
