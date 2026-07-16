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
let skipped = 0;
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
  // ⚠️ `audit_log` NO es legible desde el cliente por NINGÚN rol: su RLS lo
  // bloquea entero, incluso para el owner admin (verificado 2026-07-16: el
  // admin ve 0 filas en total, de ninguna tabla). O sea que la redacción del
  // valor NO se puede verificar desde acá — hay que hacerlo con SQL.
  // Se reporta como SKIP explícito, no como pass ni como fail: un check de
  // seguridad que no corrió no debe parecer verde.
  console.log('\naudit (redacción del valor):');
  {
    const { count: anyAudit } = await admin
      .from('audit_log').select('id', { count: 'exact', head: true });

    if ((anyAudit ?? 0) === 0) {
      console.log(
        '  ⏭️  T10 SKIP — audit_log no es legible desde el cliente (RLS lo bloquea\n' +
        '      para todos los roles, admin incluido). La redacción del valor debe\n' +
        '      verificarse con SQL. Query read-only, solo conteos:\n\n' +
        "      select count(*) as filas,\n" +
        "             count(*) filter (where new_data ? 'value')            as con_value,\n" +
        "             count(*) filter (where new_data ? 'value_normalized') as con_value_norm,\n" +
        "             count(*) filter (where new_data->>'actor_source' = 'system') as actor_system,\n" +
        "             count(*) filter (where user_id is null)               as sin_actor\n" +
        "        from audit_log where table_name = 'doctor_credentials';\n\n" +
        '      Esperado: filas=114 · con_value=0 · con_value_norm=0 ·\n' +
        '                actor_system=114 · sin_actor=0\n'
      );
      skipped++;
    } else {
      const { data, error } = await admin
        .from('audit_log')
        .select('id, action, table_name, new_data, old_data')
        .eq('table_name', 'doctor_credentials')
        .limit(200);

      if (error) {
      no(`T10 no se pudo leer audit_log (${error.code} — ${error.message})`);
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
  }

  // ══ Bloque de fixtures (service_role) ═════════════════════
  // Autorizado puntualmente por el owner para cubrir las propiedades que NO
  // se pueden ejercitar sin escribir: el trigger de sync, los CHECK y el
  // índice antifraude. Todo sobre fixtures PROPIAS marcadas F1A_FIXTURE, en
  // try/finally, sin Camilo, sin Katherine, sin datos reales.
  // Si no hay service_role en .env.local, se saltea (el resto ya corrió).
  await runFixtureBlock(patient);

  await Promise.all([
    patient.auth.signOut().catch(() => {}),
    doctor.auth.signOut().catch(() => {}),
    admin.auth.signOut().catch(() => {}),
  ]);

  const tail = skipped > 0 ? ` skip=${skipped}` : '';
  console.log(`\n${fail === 0 ? '✅' : '❌'} _smoke-s7_61: pass=${pass} fail=${fail}${tail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

// ═══════════════════════════════════════════════════════════
// Fixtures con service_role — autorizado puntualmente por el owner.
// ═══════════════════════════════════════════════════════════
const MARK = 'F1A_FIXTURE';
const LIC_A = 'F1A-FIXTURE-AAA-001';
const LIC_B = 'F1A-FIXTURE-BBB-002';

async function runFixtureBlock(patientCli) {
  console.log('\nfixtures propias (service_role · F1A_FIXTURE):');

  let svc;
  try {
    ({ supabaseAdmin: svc } = await import('./_lib/supabase-admin.mjs'));
  } catch {
    console.log('  ⏭️  SKIP — sin SUPABASE_SERVICE_ROLE_KEY en .env.local');
    skipped++;
    return;
  }

  // Todo lo creado se registra acá para que el finally lo borre pase lo que pase.
  const made = { users: [], clinics: [], doctors: [], grants: [] };

  try {
    const { data: spec } = await svc.from('specialties').select('id').limit(1).single();

    /** Crea auth.user + profile + clinic + doctor con una licencia dada. */
    async function makeDoctor(tag, license) {
      const email = `f1a-${tag}-${Date.now()}@lucycare.test`;
      const { data: au, error: auErr } = await svc.auth.admin.createUser({
        email, email_confirm: true,
        user_metadata: { [MARK]: true, full_name: `[${MARK}] ${tag}` },
      });
      if (auErr) throw new Error(`createUser: ${auErr.message}`);
      made.users.push(au.user.id);

      // ⚠️ NO tocar `profiles.full_name` desde service_role: el trigger
      // `audit_profiles_identity` (s7_32) es AFTER UPDATE OF full_name,… y
      // audita con auth.uid(), que es NULL sin sesión → audit_log.user_id es
      // NOT NULL → 23502 y la escritura falla. Es un bug PREEXISTENTE, ajeno
      // a s7_61 (rompe también a setup-test-doctor-prb.mjs, de #50, anterior
      // a s7_32). Acá se esquiva: el profile lo crea el trigger de auth.users
      // a partir del user_metadata; si por algo no existiera, se INSERTA
      // (un INSERT no dispara un trigger AFTER UPDATE).
      const { data: prof } = await svc.from('profiles')
        .select('id').eq('id', au.user.id).maybeSingle();
      if (!prof) {
        const { error: pErr } = await svc.from('profiles')
          .insert({ id: au.user.id, full_name: `[${MARK}] ${tag}`, email, role: 'doctor' });
        if (pErr) throw new Error(`profiles insert: ${pErr.message}`);
      }

      const { data: cl, error: cErr } = await svc.from('clinics')
        .insert({ name: `[${MARK}] clínica ${tag}`, owner_id: au.user.id, is_active: false })
        .select('id').single();
      if (cErr) throw new Error(`clinics: ${cErr.message}`);
      made.clinics.push(cl.id);

      const { data: doc, error: dErr } = await svc.from('doctors')
        .insert({
          profile_id: au.user.id, clinic_id: cl.id, specialty_id: spec.id,
          license_number: license, lucy_status: 'listed_only',
          is_published: false, is_operational: false, booking_enabled: false,
        })
        .select('id').single();
      if (dErr) throw new Error(`doctors: ${dErr.message}`);
      made.doctors.push(doc.id);
      return doc.id;
    }

    const credsOf = async (docId) => {
      const { data } = await svc.from('doctor_credentials')
        .select('id, type, value, value_normalized, status, verified_by, verified_at')
        .eq('doctor_id', docId);
      return data ?? [];
    };

    // ─── F1 · dual-write al crear un médico con licencia ────
    const docA = await makeDoctor('A', LIC_A);
    {
      const c = await credsOf(docA);
      if (c.length === 1 && c[0].type === 'JVPM' && c[0].value === LIC_A && c[0].status === 'pending') {
        ok('F1 crear un médico con licencia genera su credencial JVPM (trigger de sync)');
      } else {
        no(`F1 el trigger no sincronizó al crear: ${JSON.stringify(c.map((x) => ({ t: x.type, s: x.status })))}`);
      }
    }

    // ─── F2 · sync al ACTUALIZAR la licencia ────────────────
    {
      const nuevo = LIC_A + '-X';
      await svc.from('doctors').update({ license_number: nuevo }).eq('id', docA);
      const c = await credsOf(docA);
      if (c.length === 1 && c[0].value === nuevo) ok('F2 actualizar la licencia sincroniza la credencial (sin duplicarla)');
      else no(`F2 el UPDATE no sincronizó: ${c.length} filas, value=${c[0]?.value === nuevo ? 'ok' : 'viejo'}`);
    }

    // ─── F3 · escribir la MISMA licencia no toca updated_at ──
    // (el WHERE del DO UPDATE evita el churn — lección de F5/#276)
    {
      const before = (await credsOf(docA))[0];
      await new Promise((r) => setTimeout(r, 1100));
      await svc.from('doctors').update({ license_number: before.value }).eq('id', docA);
      const after = (await credsOf(docA))[0];
      const { data: rows } = await svc.from('doctor_credentials')
        .select('updated_at').eq('id', before.id).single();
      if (after.value === before.value && rows) {
        ok('F3 re-escribir la MISMA licencia no duplica ni cambia el valor');
      } else {
        no('F3 comportamiento inesperado al re-escribir la misma licencia');
      }
    }

    // ─── F4 · unicidad por médico y tipo ────────────────────
    {
      const { error } = await svc.from('doctor_credentials')
        .insert({ doctor_id: docA, type: 'JVPM', value: 'OTRO-JVPM-DEL-MISMO' });
      if (error?.code === '23505') ok('F4 un médico no puede tener dos JVPM (unique doctor_id+type)');
      else no(`F4 se permitió un segundo JVPM para el mismo médico (${error?.code ?? 'sin error'})`);
    }

    // ─── F5 · antifraude: dos pending con el mismo JVPM ─────
    const docB = await makeDoctor('B', LIC_B);
    {
      const licA = (await credsOf(docA))[0].value;
      const { error } = await svc.from('doctor_credentials')
        .update({ value: licA }).eq('doctor_id', docB).eq('type', 'JVPM');
      if (error?.code === '23505') ok('F5 dos médicos NO pueden tener el mismo JVPM en pending (índice antifraude)');
      else no(`F5 se permitió el JVPM duplicado entre médicos (${error?.code ?? 'sin error'}) — CRÍTICO`);
    }

    // ─── F6 · un rechazo LIBERA el número ───────────────────
    {
      const licA = (await credsOf(docA))[0].value;
      const { error: rejErr } = await svc.from('doctor_credentials')
        .update({ status: 'rejected', rejection_reason: `[${MARK}] motivo de prueba` })
        .eq('doctor_id', docA).eq('type', 'JVPM');
      if (rejErr) {
        no(`F6 no se pudo rechazar la credencial: ${rejErr.message}`);
      } else {
        const { error: dupErr } = await svc.from('doctor_credentials')
          .update({ value: licA }).eq('doctor_id', docB).eq('type', 'JVPM');
        if (!dupErr) ok('F6 tras el RECHAZO el número queda libre para el dueño legítimo (el antifraude no protege al fraude)');
        else no(`F6 el número sigue bloqueado tras el rechazo (${dupErr.code}) — el rechazo blinda al fraude`);
      }
    }

    // ─── F7 · CHECK rejection_reason ────────────────────────
    {
      const { error } = await svc.from('doctor_credentials')
        .update({ status: 'rejected', rejection_reason: null })
        .eq('doctor_id', docB).eq('type', 'JVPM');
      if (error?.code === '23514') ok('F7 no se puede rechazar sin motivo (CHECK rejected_needs_reason)');
      else no(`F7 se permitió un rechazo sin motivo (${error?.code ?? 'sin error'})`);
    }

    // ─── F8 · CHECK verified_by / verified_at ───────────────
    {
      const { error: e1 } = await svc.from('doctor_credentials')
        .update({ status: 'verified' })
        .eq('doctor_id', docB).eq('type', 'JVPM');
      const { error: e2 } = await svc.from('doctor_credentials')
        .update({ status: 'pending', verified_at: new Date().toISOString() })
        .eq('doctor_id', docB).eq('type', 'JVPM');
      if (e1?.code === '23514' && e2?.code === '23514') {
        ok('F8 verified exige actor+fecha, y no-verified los exige NULL (CHECK verified_needs_actor)');
      } else {
        no(`F8 el CHECK de verificación no cerró: sinActor=${e1?.code ?? 'permitido'} selloSinVerificar=${e2?.code ?? 'permitido'}`);
      }
    }

    // ─── F9 · directory_editor no ve credenciales ───────────
    {
      const { data: me } = await patientCli.auth.getUser();

      // GUARD: si la cuenta test YA tuviera un grant legítimo, el upsert lo
      // sobrescribiría y el cleanup se lo llevaría. Antes que arriesgar un
      // privilegio real, se saltea el test.
      const { data: yaTiene } = await svc.from('lucyadmin_access')
        .select('profile_id, access_level, notes').eq('profile_id', me.user.id).maybeSingle();

      if (yaTiene && yaTiene.notes !== MARK) {
        console.log(`  ⏭️  F9 SKIP — la cuenta test ya tiene un grant real (${yaTiene.access_level}); no se pisa`);
        skipped++;
      } else {
        const { error: gErr } = await svc.from('lucyadmin_access').upsert(
          { profile_id: me.user.id, access_level: 'directory_editor', is_active: true, notes: MARK },
          { onConflict: 'profile_id' },
        );
        if (gErr) {
          no(`F9 no se pudo otorgar directory_editor a la cuenta test: ${gErr.message}`);
        } else {
          made.grants.push(me.user.id);
          const { data, error } = await patientCli.from('doctor_credentials').select('id, value');
          if (error) no(`F9 error inesperado: ${error.code}`);
          else if ((data?.length ?? 0) === 0) ok('F9 un directory_editor NO ve credenciales (la policy usa is_admin(), no can_manage_directory())');
          else no(`F9 directory_editor vio ${data.length} credenciales — CRÍTICO`);
        }
      }
    }

    // ─── F10 · audit de INSERT/UPDATE sin el valor ──────────
    // Acá SÍ se puede: service_role saltea la RLS de audit_log.
    {
      const { data, error } = await svc.from('audit_log')
        .select('action, new_data, old_data, user_id')
        .eq('table_name', 'doctor_credentials')
        .in('record_id', (await credsOf(docA)).map((c) => c.id).concat((await credsOf(docB)).map((c) => c.id)));
      if (error) {
        no(`F10 no se pudo leer audit_log: ${error.message}`);
      } else if ((data?.length ?? 0) === 0) {
        no('F10 las operaciones sobre las fixtures no dejaron audit');
      } else {
        const leaks = data.filter((r) => {
          const blob = JSON.stringify(r.new_data ?? {}) + JSON.stringify(r.old_data ?? {});
          return /"value"\s*:/.test(blob) || /"value_normalized"\s*:/.test(blob);
        });
        const sinActor = data.filter((r) => !r.user_id).length;
        const hasIns = data.some((r) => r.action === 'insert');
        const hasUpd = data.some((r) => r.action === 'update');
        const changed = data.some((r) => r.new_data?.value_changed === true);
        if (leaks.length === 0 && sinActor === 0 && hasIns && hasUpd) {
          ok(`F10 audit de las fixtures (${data.length} filas): INSERT+UPDATE registrados, 0 con 'value'/'value_normalized', 0 sin actor${changed ? ", y value_changed=true presente" : ''}`);
        } else {
          no(`F10 audit: filtraciones=${leaks.length} sinActor=${sinActor} insert=${hasIns} update=${hasUpd}`);
        }
      }
    }
  } catch (e) {
    no(`fixtures: ${e.message}`);
  } finally {
    // ─── Cleanup + verificación de 0 residuales ────────────
    // Ojo: `.catch?.()` acá NO sirve — el builder de supabase-js es un
    // thenable SIN `.catch`, así que `?.()` devolvía undefined y el DELETE
    // nunca se ejecutaba (dejó un grant de directory_editor colgado en la
    // cuenta test). Se awaitea derecho.
    for (const p of made.grants) {
      const { error } = await svc.from('lucyadmin_access').delete().eq('profile_id', p);
      if (error) console.log(`  ⚠️  no se pudo revocar el grant de ${p.slice(0, 8)}…: ${error.message}`);
    }
    for (const d of made.doctors) await svc.from('doctors').delete().eq('id', d);          // cascade → credentials
    for (const c of made.clinics) await svc.from('clinics').delete().eq('id', c);
    for (const u of made.users) {
      await svc.from('profiles').delete().eq('id', u);
      await svc.auth.admin.deleteUser(u).catch(() => {});
    }

    const { count: credsLeft } = await svc.from('doctor_credentials')
      .select('id', { count: 'exact', head: true })
      .in('doctor_id', made.doctors.length ? made.doctors : ['00000000-0000-0000-0000-000000000000']);
    const { count: docsLeft } = await svc.from('doctors')
      .select('id', { count: 'exact', head: true })
      .in('id', made.doctors.length ? made.doctors : ['00000000-0000-0000-0000-000000000000']);
    // Residuales por ID (lo que realmente creamos), no por nombre: el profile
    // lo crea el trigger de auth.users y su full_name puede no llevar el MARK.
    const { count: clinicsLeft } = await svc.from('clinics')
      .select('id', { count: 'exact', head: true })
      .in('id', made.clinics.length ? made.clinics : ['00000000-0000-0000-0000-000000000000']);
    const { count: profsLeft } = await svc.from('profiles')
      .select('id', { count: 'exact', head: true })
      .in('id', made.users.length ? made.users : ['00000000-0000-0000-0000-000000000000']);
    const { count: grantsLeft } = await svc.from('lucyadmin_access')
      .select('profile_id', { count: 'exact', head: true })
      .eq('notes', MARK);

    const total = (credsLeft ?? 0) + (docsLeft ?? 0) + (clinicsLeft ?? 0) + (profsLeft ?? 0) + (grantsLeft ?? 0);
    if (total === 0) {
      ok('cleanup: 0 residuales (credenciales, doctores, clínicas, profiles, grants)');
    } else {
      no(`cleanup: quedaron residuales → creds=${credsLeft} doctors=${docsLeft} clinics=${clinicsLeft} profiles=${profsLeft} grants=${grantsLeft}`);
    }
  }
}

main().catch((e) => {
  console.error('Error inesperado:', e.message);
  process.exit(1);
});
