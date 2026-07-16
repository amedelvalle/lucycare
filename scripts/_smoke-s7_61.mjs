/**
 * _smoke-s7_61.mjs — matriz de acceso de doctor_credentials + audit redactado.
 *
 *   node scripts/_smoke-s7_61.mjs
 *
 * ── SIN service_role ──
 * Todo con la anon key y sesiones reales (Test Phones de CLAUDE.md). La
 * matriz de acceso es el objetivo del frente: probarla desde el cliente —como
 * la vería un atacante— vale más que leerla con una llave que saltea la RLS.
 *
 * ── Sin fixtures, sin escrituras, sin residuales ──
 * Este smoke NO crea nada. Todas las escrituras que intenta DEBEN fallar (es
 * lo que prueba), y usan un UUID inexistente, así que ni siquiera apuntan a
 * una fila real. Ningún JVPM se imprime: se asertan forma y longitud, jamás
 * el valor.
 *
 * ── El truco del audit ──
 * El backfill de §9 dispara el trigger de audit → deja 114 filas en
 * `audit_log`. Eso permite verificar que la REDACCIÓN funciona sin escribir
 * nada: si el trigger filtrara el número, esas filas ya lo tendrían.
 *
 * ── Qué NO cubre (ver el PR) ──
 * El trigger de sync (§8), los CHECK constraints (§2) y el índice antifraude
 * (§3) solo se pueden ejercitar ESCRIBIENDO en `doctors`/`doctor_credentials`,
 * lo que exige fixtures con service_role. Quedan fuera por el alcance
 * autorizado. Son propiedades de integridad, no de acceso: el núcleo de
 * seguridad de F1-a sí queda cubierto acá.
 *
 * Antes de aplicar s7_61 debe FALLAR (la tabla no existe). Después: entero.
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseAnon } from './_lib/supabase-anon.mjs';

const DOCTOR_PHONE = '+50378627694';  // Camilo — cuenta demo (médico)
const PATIENT_PHONE = '+50375000001'; // paciente test Fase 1
const ADMIN_PHONE = '+50378056365';   // admin de plataforma
const OTP = '123456';
const NOWHERE = '00000000-0000-0000-0000-000000000000';
const EXPECTED_BACKFILL = 114;

let pass = 0;
let fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const no = (m) => { console.log(`  ❌ ${m}`); fail++; };

async function signIn(phone, label) {
  const cli = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await cli.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await cli.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error(`no se pudo autenticar ${label}: ${error?.message}`);
  return cli;
}

/** Las 3 escrituras directas deben estar bloqueadas para todo rol. */
async function expectNoWrites(cli, label) {
  const { error: i } = await cli.from('doctor_credentials')
    .insert({ doctor_id: NOWHERE, type: 'JVPM', value: 'PROBE' });
  const { error: u } = await cli.from('doctor_credentials')
    .update({ status: 'verified' }).eq('id', NOWHERE);
  const { error: d } = await cli.from('doctor_credentials')
    .delete().eq('id', NOWHERE);
  if (i && u && d) ok(`${label} no escribe directo (insert=${i.code} update=${u.code} delete=${d.code})`);
  else no(`${label} PUDO escribir → insert=${i?.code ?? 'OK'} update=${u?.code ?? 'OK'} delete=${d?.code ?? 'OK'}`);
}

async function main() {
  console.log('\n_smoke-s7_61 — doctor_credentials: acceso + audit\n');

  // ══ anon ══════════════════════════════════════════════════
  console.log('anon:');
  {
    const { data, error } = await supabaseAnon.from('doctor_credentials').select('id');
    if (error) ok(`T1 anon no accede a la tabla (${error.code})`);
    else no(`T1 anon accedió: ${data?.length ?? 0} filas — CRÍTICO`);
  }
  await expectNoWrites(supabaseAnon, 'T2 anon');

  // ══ paciente — el test del frente ═════════════════════════
  console.log('\npaciente autenticado (el riesgo que F1 viene a cerrar):');
  const patient = await signIn(PATIENT_PHONE, 'paciente');
  {
    const { data, error } = await patient.from('doctor_credentials').select('id, type, value');
    if (error) no(`T3 paciente: error inesperado ${error.code} — ${error.message} (debe ver 0 filas, no fallar)`);
    else if ((data?.length ?? 0) === 0) ok('T3 paciente ve CERO credenciales — el secreto es inalcanzable POR FILA');
    else no(`T3 paciente vio ${data.length} credenciales — CRÍTICO: el secreto sigue expuesto`);
  }
  await expectNoWrites(patient, 'T4 paciente');

  // ══ médico ════════════════════════════════════════════════
  console.log('\nmédico autenticado:');
  const doctor = await signIn(DOCTOR_PHONE, 'médico');
  let myDoctorId = null;
  {
    const { data, error } = await doctor
      .from('doctor_credentials')
      .select('id, doctor_id, type, status, value, is_public, verified_by, verified_at, rejection_reason');
    if (error) {
      no(`T5 médico: ${error.code} — ${error.message}`);
    } else if ((data?.length ?? 0) !== 1) {
      no(`T5 médico ve ${data?.length ?? 0} credenciales — esperaba 1 (la suya)`);
    } else {
      const c = data[0];
      myDoctorId = c.doctor_id;
      const shape = c.type === 'JVPM' && c.status === 'pending' &&
        typeof c.value === 'string' && c.value.length > 0 &&
        c.is_public === false && c.verified_by === null &&
        c.verified_at === null && c.rejection_reason === null;
      if (shape) ok('T5 médico ve SOLO la suya, con la forma del backfill (JVPM · pending · con valor · no pública · sin verificar)');
      else no(`T5 forma inesperada: type=${c.type} status=${c.status} is_public=${c.is_public} verified_by=${c.verified_by}`);
    }
  }

  // Aislamiento: pedir explícitamente la de OTRO médico publicado.
  {
    const { data: others } = await supabaseAnon
      .from('doctors').select('id').eq('is_published', true).limit(5);
    const other = (others ?? []).find((d) => d.id !== myDoctorId);
    if (!other) {
      no('T6 no se encontró otro médico publicado para probar aislamiento');
    } else {
      const { data, error } = await doctor
        .from('doctor_credentials').select('id, value').eq('doctor_id', other.id);
      if (error) no(`T6 error inesperado ${error.code}`);
      else if ((data?.length ?? 0) === 0) ok('T6 el médico NO ve la credencial de otro médico publicado');
      else no(`T6 el médico vio ${data.length} credenciales ajenas — CRÍTICO`);
    }
  }
  await expectNoWrites(doctor, 'T7 médico');

  // ══ admin ═════════════════════════════════════════════════
  console.log('\nowner admin:');
  const admin = await signIn(ADMIN_PHONE, 'admin');
  {
    const { count, error } = await admin
      .from('doctor_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'JVPM');
    if (error) no(`T8 admin: ${error.code} — ${error.message}`);
    else if (count === EXPECTED_BACKFILL) ok(`T8 admin ve las ${count} credenciales JVPM (backfill completo)`);
    else no(`T8 admin ve ${count} JVPM, esperaba ${EXPECTED_BACKFILL}`);
  }
  // El admin ve, pero tampoco escribe directo: no hay policies de escritura.
  await expectNoWrites(admin, 'T9 admin');

  // ══ audit redactado ═══════════════════════════════════════
  console.log('\naudit (el backfill dejó 114 filas — sirven de evidencia):');
  {
    const { data, error } = await admin
      .from('audit_log')
      .select('id, action, table_name, new_data, old_data')
      .eq('table_name', 'doctor_credentials')
      .limit(200);

    if (error) {
      // Si el admin no puede leer audit_log, no es una falla de s7_61:
      // es que la verificación necesita otra vía. Se reporta como tal.
      no(`T10 no se pudo leer audit_log con sesión de admin (${error.code} — ${error.message}). La redacción queda SIN VERIFICAR por este medio`);
    } else if ((data?.length ?? 0) === 0) {
      no('T10 no hay filas de audit para doctor_credentials — ¿corrió el backfill? ¿está el trigger?');
    } else {
      const leaks = data.filter((r) => {
        const blob = JSON.stringify(r.new_data ?? {}) + JSON.stringify(r.old_data ?? {});
        return /"value"\s*:/.test(blob) || /"value_normalized"\s*:/.test(blob);
      });
      if (leaks.length === 0) {
        ok(`T10 ninguna de las ${data.length} filas de audit contiene 'value' ni 'value_normalized' — la redacción funciona`);
      } else {
        no(`T10 ${leaks.length}/${data.length} filas de audit CONTIENEN el valor — el secreto se filtró a audit_log`);
      }
      const inserts = data.filter((r) => r.action === 'insert').length;
      if (inserts > 0) ok(`T11 el trigger de audit registró los INSERT del backfill (${inserts})`);
      else no('T11 no hay acciones insert auditadas para doctor_credentials');

      // El backfill corre sin sesión → auth.uid() es NULL → el trigger
      // atribuye al médico y marca actor_source='system'. Que NO diga
      // 'session' es lo que impide fingir que una persona lo hizo.
      const sys = data.filter((r) => r.new_data?.actor_source === 'system').length;
      const noActor = data.filter((r) => !r.new_data?.actor_source).length;
      if (sys === data.length) {
        ok(`T12 las ${sys} filas del backfill quedaron marcadas actor_source='system' (no fingen ser una acción humana)`);
      } else if (noActor > 0) {
        no(`T12 ${noActor}/${data.length} filas de audit sin actor_source`);
      } else {
        no(`T12 solo ${sys}/${data.length} filas con actor_source='system'`);
      }
    }
  }

  await Promise.all([
    patient.auth.signOut().catch(() => {}),
    doctor.auth.signOut().catch(() => {}),
    admin.auth.signOut().catch(() => {}),
  ]);

  console.log(`\n${fail === 0 ? '✅' : '❌'} _smoke-s7_61: pass=${pass} fail=${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Error inesperado:', e.message);
  process.exit(1);
});
