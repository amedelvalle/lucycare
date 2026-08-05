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
 *
 * ── REGLAS DE DATOS (vinculantes) ──
 *   • Fixtures SINTÉTICAS creadas desde cero y marcadas `S7_71_FIXTURE`.
 *   • JAMÁS Katherine (50372608827). JAMÁS Camilo. JAMÁS datos reales.
 *   • Médico, clínica, paciente y citas PROPIOS: la prueba de firma de
 *     consulta es irreversible y no puede tocar el paciente demo.
 *   • Usuario de prueba por EMAIL + contraseña: no se envía ningún SMS,
 *     no se toca Twilio ni el flujo OTP.
 *   • Cleanup obligatorio con verificación de 0 residuos.
 *   • La auditoría generada por las fixtures SÍ se borra, pero SOLO la
 *     acotada al conjunto EXACTO de UUID sintéticos y a filas posteriores
 *     al inicio de la corrida. La auditoría de datos reales nunca se toca.
 *
 * ── QUÉ PRUEBA ──
 *   Que el trigger `audit_appointments` produce EXACTAMENTE una fila por
 *   evento, con la clasificación correcta, sin notes/internal_notes, y que
 *   `cancel_my_appointment` deja UNA sola fila (no dos).
 *
 * ── QUÉ **NO** PRUEBA (y por qué) ──
 *   · La explotación del agujero de `audit_log` (INSERT falsificado con
 *     user_id arbitrario, helper inseguro). Esas pruebas "ANTES" se corren
 *     SOLO en local o en un ambiente aislado, NUNCA contra producción: el
 *     agujero ya quedó probado documentalmente por policy + ACL en el
 *     preflight del owner.
 *   · `actor_kind='db_direct'`: exige una conexión directa a Postgres sin
 *     JWT. supabase-js siempre pasa por PostgREST con JWT, así que este
 *     caso NO es alcanzable desde el smoke — se verifica con una consulta
 *     read-only del owner (ver §11).
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

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = requireEnv([
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
]);

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MARK = 'S7_71_FIXTURE';
const RUN_STARTED_AT = new Date().toISOString();

let pass = 0, fail = 0;
const ok = (d) => { console.log(`  ✅ ${d}`); pass++; };
const ko = (d) => { console.log(`  ❌ ${d}`); fail++; };
const check = (d, cond) => (cond ? ok(d) : ko(d));

/** UUID sintéticos creados por esta corrida. El cleanup se acota a ellos. */
const created = {
  profiles: [], clinics: [], doctors: [], patients: [],
  appointments: [], consultations: [], authUsers: [],
};

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
async function main() {
  console.log('\n_smoke-s7_71a — cobertura server-side de appointments\n');
  console.log(`  marca: ${MARK} · inicio: ${RUN_STARTED_AT}\n`);

  // ─── 0. FIXTURES ───────────────────────────────────────────────────
  // Médico, clínica y paciente PROPIOS. Nada real, nada demo.
  console.log('0. Fixtures sintéticas');
  const fx = await buildFixtures();
  ok(`fixtures creadas (doctor=${fx.doctorId.slice(0, 8)}… patient=${fx.patientId.slice(0, 8)}…)`);

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
    check('1.7 db_executor registrado', typeof rows[0]?.new_data?.db_executor === 'string');
    const blob = JSON.stringify(rows[0]);
    check('1.8 NO contiene la nota libre', !blob.includes('NOTA_LIBRE_NO_DEBE_AUDITARSE'));
    check('1.9 NO contiene la nota interna', !blob.includes('NOTA_INTERNA_NO_DEBE_AUDITARSE'));
  }

  // ─── 2. Reserva vía create_booking_with_intent ─────────────────────
  // COBERTURA NUEVA: esta ruta NO auditaba `appointments` antes de s7_71a.
  console.log('\n2. Reserva por create_booking_with_intent (cobertura NUEVA)');
  {
    const r = await bookViaIntent(fx);
    if (!r) {
      ko('2.0 no se pudo completar el flujo de intent — revisar setup');
    } else {
      const rows = await auditRows(r.appointmentId);
      check('2.1 exactamente 1 fila', rows.length === 1);
      check('2.2 action = insert', rows[0]?.action === 'insert');
      check('2.3 change_kind = appointment_created', kindOf(rows[0]) === 'appointment_created');
      check('2.4 source literal registrado', typeof rows[0]?.new_data?.source === 'string');
      check('2.5 actor_kind = user (paciente con sesión)',
        rows[0]?.new_data?.actor_kind === 'user');
      check('2.6 user_id = el paciente, no el centinela',
        rows[0]?.user_id === r.profileId);
    }
  }

  // ─── 3. Cambio de estado ───────────────────────────────────────────
  console.log('\n3. Cambio de estado');
  {
    const appt = await insertAppointment(fx, { source: 'manual' });
    const before = (await auditRows(appt.id)).length;
    await admin.from('appointments')
      .update({ status_id: fx.statusConfirmada }).eq('id', appt.id);
    const rows = await auditRows(appt.id);
    check('3.1 se agregó exactamente 1 fila', rows.length === before + 1);
    const last = rows[rows.length - 1];
    check('3.2 action = update', last?.action === 'update');
    check('3.3 change_kind = status_change', kindOf(last) === 'status_change');
    check('3.4 old_data lleva el status anterior', !!last?.old_data?.status_id);
    check('3.5 new_data lleva el status nuevo',
      last?.new_data?.status_id === fx.statusConfirmada);
    check('3.6 sin context_rejected', last?.new_data?.context_rejected === undefined);
  }

  // ─── 4. Reprogramación ─────────────────────────────────────────────
  console.log('\n4. Reprogramación');
  {
    const appt = await insertAppointment(fx, { source: 'manual' });
    const before = (await auditRows(appt.id)).length;
    const s = new Date(Date.now() + 8 * 864e5); const e = new Date(s.getTime() + 30 * 6e4);
    await admin.from('appointments')
      .update({ start_time: s.toISOString(), end_time: e.toISOString() }).eq('id', appt.id);
    const rows = await auditRows(appt.id);
    check('4.1 se agregó exactamente 1 fila', rows.length === before + 1);
    const last = rows[rows.length - 1];
    check('4.2 change_kind = reschedule', kindOf(last) === 'reschedule');
    check('4.3 old y new llevan start_time',
      !!last?.old_data?.start_time && !!last?.new_data?.start_time);
    check('4.4 old y new llevan end_time',
      !!last?.old_data?.end_time && !!last?.new_data?.end_time);
  }

  // ─── 5. Doctor, servicio, precio y motivo ──────────────────────────
  console.log('\n5. Doctor / servicio / precio / motivo');
  {
    // 5a. solo doctor → doctor_reassign
    const a1 = await insertAppointment(fx, { source: 'manual' });
    let n = (await auditRows(a1.id)).length;
    await admin.from('appointments').update({ doctor_id: fx.doctorId2 }).eq('id', a1.id);
    let rows = await auditRows(a1.id);
    check('5.1 doctor → 1 fila', rows.length === n + 1);
    check('5.2 change_kind = doctor_reassign', kindOf(rows[rows.length - 1]) === 'doctor_reassign');

    // 5b. solo servicio y precio → appointment_update
    const a2 = await insertAppointment(fx, { source: 'manual' });
    n = (await auditRows(a2.id)).length;
    await admin.from('appointments')
      .update({ service_id: fx.serviceId, price: 42 }).eq('id', a2.id);
    rows = await auditRows(a2.id);
    check('5.3 servicio+precio → 1 fila', rows.length === n + 1);
    check('5.4 change_kind = appointment_update',
      kindOf(rows[rows.length - 1]) === 'appointment_update');
    check('5.5 registra el precio', rows[rows.length - 1]?.new_data?.price === 42);

    // 5c. solo motivo → status_change (cancel_reason_id ∈ grupo STATUS)
    const a3 = await insertAppointment(fx, { source: 'manual' });
    n = (await auditRows(a3.id)).length;
    await admin.from('appointments')
      .update({ cancel_reason_id: fx.cancelReasonId }).eq('id', a3.id);
    rows = await auditRows(a3.id);
    check('5.6 motivo → 1 fila', rows.length === n + 1);
    check('5.7 change_kind = status_change', kindOf(rows[rows.length - 1]) === 'status_change');

    // 5d. estado + horario a la vez → mixed
    const a4 = await insertAppointment(fx, { source: 'manual' });
    n = (await auditRows(a4.id)).length;
    const s = new Date(Date.now() + 9 * 864e5);
    await admin.from('appointments').update({
      status_id: fx.statusConfirmada,
      start_time: s.toISOString(),
      end_time: new Date(s.getTime() + 30 * 6e4).toISOString(),
    }).eq('id', a4.id);
    rows = await auditRows(a4.id);
    check('5.8 estado+horario → 1 fila', rows.length === n + 1);
    check('5.9 change_kind = mixed', kindOf(rows[rows.length - 1]) === 'mixed');
  }

  // ─── 6. cancel_my_appointment — UNA sola fila ──────────────────────
  console.log('\n6. cancel_my_appointment (prueba central: sin duplicado)');
  {
    const r = await cancelAsPatient(fx);
    if (!r) {
      ko('6.0 no se pudo ejecutar la RPC como paciente — revisar setup');
    } else {
      const rows = await auditRows(r.appointmentId);
      const updates = rows.filter((x) => x.action === 'update');
      check('6.1 EXACTAMENTE 1 fila de update (sin duplicado)', updates.length === 1);
      const last = updates[0];
      check('6.2 edited_via = patient_self_cancel',
        last?.new_data?.edited_via === 'patient_self_cancel');
      check('6.3 conserva el motivo', last?.new_data?.reason === 'no_puedo_asistir');
      check('6.4 change_kind = status_change', kindOf(last) === 'status_change');
      check('6.5 contexto ACEPTADO (sin context_rejected)',
        last?.new_data?.context_rejected === undefined);
      check('6.6 user_id = el paciente', last?.user_id === r.profileId);
      check('6.7 la nota libre NO está en la auditoría',
        !JSON.stringify(last).includes(r.note));
    }
  }

  // ─── 7. Merge / unmerge → clasificación genérica ───────────────────
  console.log('\n7. Merge / unmerge (clasificación genérica)');
  {
    // s7_71a NO instala setters para merge/unmerge: el cambio de patient_id
    // debe quedar como `patient_reassign`, no como una etiqueta inventada.
    const appt = await insertAppointment(fx, { source: 'manual' });
    const n = (await auditRows(appt.id)).length;
    await admin.from('appointments').update({ patient_id: fx.patientId2 }).eq('id', appt.id);
    const rows = await auditRows(appt.id);
    const last = rows[rows.length - 1];
    check('7.1 se agregó 1 fila', rows.length === n + 1);
    check('7.2 change_kind = patient_reassign', kindOf(last) === 'patient_reassign');
    check('7.3 SIN etiqueta patient_merge inventada',
      last?.new_data?.edited_via === undefined);
    check('7.4 old y new llevan patient_id',
      !!last?.old_data?.patient_id && !!last?.new_data?.patient_id);
  }

  // ─── 8. Firma de consulta → status_change ──────────────────────────
  console.log('\n8. Firma de consulta (cascada de s6_02)');
  {
    const r = await signConsultation(fx);
    if (!r) {
      ko('8.0 no se pudo firmar la consulta — revisar setup');
    } else {
      const rows = await auditRows(r.appointmentId);
      const last = rows[rows.length - 1];
      check('8.1 la cascada dejó auditoría de appointments', rows.length >= 1);
      check('8.2 change_kind = status_change', kindOf(last) === 'status_change');
      check('8.3 SIN etiqueta consultation_signed inventada',
        last?.new_data?.edited_via === undefined);
    }
  }

  // ─── 9. Actualización irrelevante → SIN fila ───────────────────────
  console.log('\n9. Actualización irrelevante (sin ruido)');
  {
    const appt = await insertAppointment(fx, { source: 'manual' });
    const before = (await auditRows(appt.id)).length;
    await admin.from('appointments')
      .update({ notes: 'solo notas', internal_notes: 'solo internas' }).eq('id', appt.id);
    const after = (await auditRows(appt.id)).length;
    check('9.1 NO se escribió ninguna fila nueva', after === before);
  }

  // ─── 10. service_role ──────────────────────────────────────────────
  console.log('\n10. Escritura por service_role');
  {
    // Todas las escrituras de fixtures de este smoke son service_role.
    const appt = await insertAppointment(fx, { source: 'manual' });
    const rows = await auditRows(appt.id);
    const last = rows[rows.length - 1];
    check('10.1 actor_kind = service_role', last?.new_data?.actor_kind === 'service_role');
    check('10.2 user_id = centinela (sin auth.uid())',
      last?.user_id === '00000000-0000-0000-0000-000000000000');
    check('10.3 NO aborta la escritura de la cita', !!appt.id);
  }

  // ─── 11. Sin JWT (db_direct) — NO alcanzable desde el smoke ────────
  console.log('\n11. Escritura sin JWT (db_direct)');
  console.log(`
  ⏭️  NO EJECUTABLE desde este smoke: supabase-js siempre pasa por PostgREST
      con un JWT, así que auth.jwt() nunca es NULL acá. Verificarlo requiere
      una conexión directa (SQL Editor). Consulta read-only para el owner:

        BEGIN;
          UPDATE public.appointments SET status_id = status_id WHERE id = '<uuid>';
          -- no cambia nada → el trigger NO debe escribir fila
          SELECT new_data->>'actor_kind'
          FROM public.audit_log
          WHERE table_name = 'appointments' AND record_id = '<uuid>'
          ORDER BY id DESC LIMIT 1;
        ROLLBACK;

      Esperado tras un cambio REAL de status desde el SQL Editor:
        actor_kind = 'db_direct'  ·  user_id = 00000000-...-000000000000
`);

  // ─── 12. Contexto falsificado → rechazado ──────────────────────────
  console.log('\n12. Contexto que no coincide con la transición');
  console.log(`
  ⏭️  NO EJECUTABLE desde este smoke: fijar app.audit_appointments_context
      exige set_config server-side, que PostgREST no expone (y eso mismo es
      parte de la defensa). Consulta read-only para el owner:

        BEGIN;
          SELECT set_config('app.audit_appointments_context',
            '{"edited_via":"patient_self_cancel","reason":"otro"}', true);
          UPDATE public.appointments SET price = 99 WHERE id = '<uuid>';
          SELECT new_data->>'change_kind', new_data->>'edited_via',
                 new_data->>'context_rejected'
          FROM public.audit_log
          WHERE table_name='appointments' AND record_id='<uuid>'
          ORDER BY id DESC LIMIT 1;
        ROLLBACK;

      Esperado: change_kind='appointment_update', edited_via=NULL,
                context_rejected='true'
`);

  // ─── 13. CLEANUP ───────────────────────────────────────────────────
  console.log('\n13. Cleanup');
  await cleanup();

  console.log(`\n${fail === 0 ? '✅' : '❌'} _smoke-s7_71a: ${pass} OK, ${fail} fallos\n`);
  process.exit(fail === 0 ? 0 : 1);
}

// ═════════════════════════════════════════════════════════════════════
// HELPERS DE FIXTURES
// ═════════════════════════════════════════════════════════════════════

/**
 * Crea clínica, dos médicos, dos pacientes, un servicio y un usuario
 * paciente con sesión (email + contraseña, SIN SMS).
 * Todo marcado con MARK para el cleanup.
 *
 * Implementación pendiente de detalle fino: se completa en la corrida
 * autorizada, siguiendo el patrón de _smoke-s7_70.mjs (buildFixtures).
 */
async function buildFixtures() {
  throw new Error(
    'buildFixtures() se completa en la corrida autorizada, siguiendo el patrón ' +
    'de _smoke-s7_70.mjs. NO se ejecuta ninguna escritura sin autorización del owner.'
  );
}

async function insertAppointment(_fx, _overrides) {
  throw new Error('insertAppointment() — pendiente de la corrida autorizada');
}
async function bookViaIntent(_fx) {
  throw new Error('bookViaIntent() — pendiente de la corrida autorizada');
}
async function cancelAsPatient(_fx) {
  throw new Error('cancelAsPatient() — pendiente de la corrida autorizada');
}
async function signConsultation(_fx) {
  throw new Error('signConsultation() — pendiente de la corrida autorizada');
}

/**
 * Cleanup acotado a los UUID sintéticos de ESTA corrida.
 * Orden inverso a la creación. Verificación de 0 residuos al final.
 * La auditoría se borra SOLO para los record_id sintéticos y solo para
 * filas posteriores a RUN_STARTED_AT.
 */
async function cleanup() {
  const del = async (label, q) => {
    const { error } = await q;
    console.log(`  ${error ? '❌' : '🧹'} ${label}${error ? ` — ${error.message}` : ''}`);
  };

  if (created.consultations.length)
    await del('consultations', admin.from('consultations').delete().in('id', created.consultations));
  if (created.appointments.length) {
    await del('audit_log · appointments sintéticas',
      admin.from('audit_log').delete()
        .eq('table_name', 'appointments')
        .in('record_id', created.appointments)
        .gte('created_at', RUN_STARTED_AT));
    await del('appointments', admin.from('appointments').delete().in('id', created.appointments));
  }
  if (created.patients.length)
    await del('patients', admin.from('patients').delete().in('id', created.patients));
  if (created.doctors.length)
    await del('doctors', admin.from('doctors').delete().in('id', created.doctors));
  if (created.clinics.length)
    await del('clinics', admin.from('clinics').delete().in('id', created.clinics));
  if (created.profiles.length)
    await del('profiles', admin.from('profiles').delete().in('id', created.profiles));
  for (const uid of created.authUsers) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    console.log(`  ${error ? '❌' : '🧹'} auth.user ${uid.slice(0, 8)}…`);
  }

  // Verificación de 0 residuos.
  console.log('\n  Verificación de residuos:');
  let residuals = 0;
  const countIn = async (table, ids) => {
    if (!ids.length) return 0;
    const { count } = await admin.from(table)
      .select('id', { count: 'exact', head: true }).in('id', ids);
    return count ?? 0;
  };
  for (const [table, ids] of [
    ['appointments', created.appointments], ['consultations', created.consultations],
    ['patients', created.patients], ['doctors', created.doctors],
    ['clinics', created.clinics], ['profiles', created.profiles],
  ]) {
    const n = await countIn(table, ids);
    residuals += n;
    console.log(`    · ${table}: ${n}`);
  }
  if (created.appointments.length) {
    const { count } = await admin.from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('table_name', 'appointments').in('record_id', created.appointments);
    residuals += count ?? 0;
    console.log(`    · audit_log[appointments]: ${count ?? 0}`);
  }
  check(`13.1 CERO residuos (${residuals})`, residuals === 0);
}

main().catch(async (e) => {
  console.error(`\n💥 ${e.message}\n`);
  try { await cleanup(); } catch { /* el cleanup no debe enmascarar el error */ }
  process.exit(1);
});
