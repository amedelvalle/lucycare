/**
 * check-s7_61.mjs — verifica el modelo de doctor_credentials (F1-a).
 *
 *   node scripts/check-s7_61.mjs
 *
 * ── SIN service_role ──
 * Prueba COMPORTAMIENTO con la anon key y sesiones reales (Test Phones).
 * La matriz de acceso ES el objetivo del frente, así que probarla desde el
 * cliente —como la vería un atacante— vale más que leer el catálogo con una
 * llave que saltea la RLS.
 *
 * Qué verifica (5):
 *   1. anon NO tiene acceso a la tabla
 *   2. un PACIENTE autenticado ve CERO filas          ← el test del frente
 *   3. un MÉDICO ve exactamente SU credencial (JVPM, pending, con valor)
 *   4. el backfill cubrió los 114 médicos (contado con sesión de admin)
 *   5. nadie escribe directo: el médico no puede INSERT/UPDATE/DELETE
 *
 * El aislamiento cross-médico y la redacción del audit se prueban en
 * _smoke-s7_61 (T6 y T10).
 *
 * ── Datos ──
 * Solo lecturas. Ningún dato se modifica y ningún JVPM se imprime (los tests
 * asertan longitud/forma, nunca el valor). Cuentas demo/test documentadas en
 * CLAUDE.md. Jamás Katherine.
 *
 * Antes de aplicar s7_61 debe FALLAR (la tabla no existe). Después: 6/6.
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseAnon } from './_lib/supabase-anon.mjs';

const DOCTOR_PHONE = '+50378627694';  // Camilo — cuenta demo (médico)
const PATIENT_PHONE = '+50375000001'; // paciente test Fase 1
const ADMIN_PHONE = '+50378056365';   // admin de plataforma (Test Phone)
const OTP = '123456';
const DENIED = '42501';
const EXPECTED_BACKFILL = 114;        // pre-flight: 114 doctores, los 114 con licencia

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

async function main() {
  console.log('\ncheck-s7_61 — modelo doctor_credentials\n');

  // ─── 1. anon ──────────────────────────────────────────────
  {
    const { data, error } = await supabaseAnon.from('doctor_credentials').select('id');
    if (error) ok(`anon NO accede a doctor_credentials (${error.code})`);
    else no(`anon accedió y recibió ${data?.length ?? 0} filas — CRÍTICO`);
  }

  // ─── 2. paciente autenticado ← el test del frente ─────────
  {
    const patient = await signIn(PATIENT_PHONE, 'paciente');
    const { data, error } = await patient.from('doctor_credentials').select('id, type');
    if (error) {
      no(`paciente: error inesperado ${error.code} — ${error.message} (debería ver 0 filas, no fallar)`);
    } else if ((data?.length ?? 0) === 0) {
      ok('paciente autenticado ve CERO credenciales (la RLS filtra por fila)');
    } else {
      no(`paciente autenticado vio ${data.length} credenciales — CRÍTICO: el secreto sigue expuesto`);
    }
    await patient.auth.signOut().catch(() => {});
  }

  // ─── 3-4. médico ──────────────────────────────────────────
  const doctor = await signIn(DOCTOR_PHONE, 'médico');
  {
    const { data, error } = await doctor
      .from('doctor_credentials')
      .select('id, doctor_id, type, status, value, is_public, verified_by, verified_at');
    if (error) {
      no(`médico: ${error.code} — ${error.message}`);
    } else if ((data?.length ?? 0) !== 1) {
      no(`médico ve ${data?.length ?? 0} credenciales — esperaba exactamente 1 (la suya)`);
    } else {
      const c = data[0];
      const shape =
        c.type === 'JVPM' &&
        c.status === 'pending' &&
        typeof c.value === 'string' && c.value.length > 0 &&
        c.is_public === false &&
        c.verified_by === null && c.verified_at === null;
      if (shape) ok('médico ve SOLO su credencial, con la forma del backfill (JVPM · pending · con valor · no pública · sin verificar)');
      else no(`médico: forma inesperada → type=${c.type} status=${c.status} is_public=${c.is_public} valorVacío=${!c.value}`);
    }
  }

  // ─── 5. backfill (sesión de admin, no service_role) ───────
  {
    const admin = await signIn(ADMIN_PHONE, 'admin');
    const { count, error } = await admin
      .from('doctor_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'JVPM');
    if (error) {
      no(`admin: ${error.code} — ${error.message}`);
    } else if (count === EXPECTED_BACKFILL) {
      ok(`backfill completo: ${count} credenciales JVPM (= los 114 médicos con licencia)`);
    } else {
      no(`backfill incompleto: ${count} credenciales JVPM, esperaba ${EXPECTED_BACKFILL}`);
    }
    await admin.auth.signOut().catch(() => {});
  }

  // ─── 6. nadie escribe directo ─────────────────────────────
  {
    const { data: { user } } = await doctor.auth.getUser();
    const { error: insErr } = await doctor
      .from('doctor_credentials')
      .insert({ doctor_id: '00000000-0000-0000-0000-000000000000', type: 'JVPM', value: 'PROBE' });
    const { error: updErr } = await doctor
      .from('doctor_credentials')
      .update({ status: 'verified' })
      .eq('id', '00000000-0000-0000-0000-000000000000');
    const { error: delErr } = await doctor
      .from('doctor_credentials')
      .delete()
      .eq('id', '00000000-0000-0000-0000-000000000000');

    const allBlocked = !!insErr && !!updErr && !!delErr;
    if (allBlocked) {
      ok(`el médico no escribe directo (insert=${insErr.code} update=${updErr.code} delete=${delErr.code})`);
    } else {
      no(`escritura directa PERMITIDA → insert=${insErr?.code ?? 'OK'} update=${updErr?.code ?? 'OK'} delete=${delErr?.code ?? 'OK'} (user ${user?.id?.slice(0, 8)}…)`);
    }
  }

  await doctor.auth.signOut().catch(() => {});

  console.log(`\n${fail === 0 ? '✅' : '❌'} check-s7_61: pass=${pass} fail=${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Error inesperado:', e.message);
  process.exit(1);
});
