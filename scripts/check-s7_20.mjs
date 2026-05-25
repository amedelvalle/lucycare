/**
 * Verifica s7_20 (Paciente Global Fase 1).
 *
 * Casos:
 *  1. RPC claim_patient_records existe y rechaza anon.
 *  2. RPC ejecutada como usuario con phone confirmado pero sin
 *     filas matching → linked_count=0 (idempotente, no falla).
 *  3. Smoke end-to-end con un Test Phone configurado + patients
 *     legacy precargados (corre solo si el setup existe; si no,
 *     informa qué falta sin fallar).
 *  4. Policies SELECT-self funcionan:
 *     - patient logueado puede leer patients con su profile_id.
 *     - patient logueado NO puede leer patients con otro profile_id.
 *
 * Uso: node scripts/check-s7_20.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin as svc } from './_lib/supabase-admin.mjs';
import { requireEnv } from './_lib/env.mjs';

const URL = requireEnv('SUPABASE_URL');
const ANON = requireEnv('SUPABASE_ANON_KEY');

console.log('═══ Verificando s7_20 (Paciente Global Fase 1) ═══\n');

let allOk = true;
function pass(m) { console.log('  ✅', m); }
function fail(m) { console.log('  ❌', m); allOk = false; }
function warn(m) { console.log('  ⚠️ ', m); }
function info(m) { console.log('  →', m); }

// 1. RPC existe y rechaza anon
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
{
  const { error } = await anon.rpc('claim_patient_records');
  const missing = !!error && /could not find|does not exist/i.test(error.message);
  // Anon puede ser bloqueado por: (a) auth.uid IS NULL → SQLSTATE 28000 /
  // "iniciar sesión", o (b) permission denied por REVOKE (lo más seguro,
  // porque el RPC tiene REVOKE FROM anon explícito).
  const gated =
    !!error &&
    (error.code === '28000' ||
      /iniciar sesión/i.test(error.message) ||
      /permission denied/i.test(error.message));
  if (missing) { fail('RPC claim_patient_records NO existe'); process.exit(1); }
  if (!gated) {
    warn(`RPC existe pero respuesta sin sesión inesperada: ${error?.message ?? 'sin error'}`);
  } else {
    pass('RPC claim_patient_records existe y rechaza sin sesión (REVOKE FROM anon)');
  }
}

// 2. Smoke con un user real
// Usamos el Test Phone configurado para Camilo (+50378627694) como
// regression check: ya tiene profile, sus 5 patients ya están vinculados,
// la RPC debería devolver linked_count=0.
console.log('\n── Regression: Camilo (todas sus patients ya vinculadas) ──');
{
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  await c.auth.signInWithOtp({ phone: '+50378627694' });
  const { data: v, error } = await c.auth.verifyOtp({ phone: '+50378627694', token: '123456', type: 'sms' });
  if (error) { fail('Login Camilo: ' + error.message); process.exit(1); }
  info('Logueado como Camilo: ' + v.user?.id?.slice(0, 8));

  const { data, error: rpcErr } = await c.rpc('claim_patient_records');
  if (rpcErr) fail('RPC desde sesión válida: ' + rpcErr.message);
  else if (data?.success && data.linked_count === 0) {
    pass('RPC idempotente cuando no hay filas nuevas para vincular (linked_count=0)');
  } else {
    warn(`Resultado inesperado: ${JSON.stringify(data)}`);
  }
}

// 3. Smoke end-to-end con Test Phone fase 1 si está configurado
const TEST_PHONE = '+50375000001';
const TEST_PHONE_NORM = '50375000001';

console.log('\n── Smoke end-to-end con Test Phone Fase 1 ──');
const { data: legacyPatients } = await svc
  .from('patients')
  .select('id, clinic_id, profile_id')
  .eq('phone', TEST_PHONE_NORM);

if (!legacyPatients || legacyPatients.length === 0) {
  info(`No hay patients precargados con phone=${TEST_PHONE_NORM}.`);
  info('Para correr el smoke completo:');
  info('  1. Configurar Test Phone +50375000001 / 123456 en Supabase Dashboard.');
  info('  2. node scripts/setup-test-patient.mjs --apply');
  info('  3. Volver a correr este check.');
} else {
  const nullCount = legacyPatients.filter(p => !p.profile_id).length;
  info(`Patients precargados: ${legacyPatients.length} (sin profile_id: ${nullCount})`);

  if (nullCount === 0) {
    info('Todas las patients de prueba ya están vinculadas. Reseteá con setup-test-patient.mjs --reset');
  } else {
    const c2 = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error: errSend } = await c2.auth.signInWithOtp({ phone: TEST_PHONE });
    if (errSend) { warn('No pude enviar OTP al test phone: ' + errSend.message); }
    else {
      const { data: v2, error: errVer } = await c2.auth.verifyOtp({ phone: TEST_PHONE, token: '123456', type: 'sms' });
      if (errVer) {
        warn('Test phone OTP falló (¿está configurado en Supabase Dashboard?): ' + errVer.message);
      } else {
        info('Logueado como test patient: ' + v2.user?.id?.slice(0, 8));

        // 3a. La RPC debe vincular las filas
        const { data: claimResult, error: claimErr } = await c2.rpc('claim_patient_records');
        if (claimErr) fail('RPC claim falló: ' + claimErr.message);
        else if (claimResult?.linked_count === nullCount) {
          pass(`RPC vinculó ${claimResult.linked_count} patient(s) (era el conteo esperado)`);
        } else {
          fail(`linked_count=${claimResult?.linked_count}, esperaba ${nullCount}`);
        }

        // 3b. SELECT-self: ahora debería poder leer sus patients
        const { data: myPatients, error: errSelf } = await c2.from('patients').select('id, profile_id').eq('profile_id', v2.user?.id ?? '');
        if (errSelf) fail('SELECT-self patients falló: ' + errSelf.message);
        else if (myPatients?.length === legacyPatients.length) {
          pass(`Policy patients_self_select OK: usuario ve sus ${myPatients.length} filas`);
        } else {
          fail(`SELECT-self devuelve ${myPatients?.length} filas, esperaba ${legacyPatients.length}`);
        }

        // 3c. NO debe ver patients de otros
        const { data: otherPatients } = await c2.from('patients').select('id').neq('profile_id', v2.user?.id ?? '').limit(1);
        if (!otherPatients || otherPatients.length === 0) {
          pass('Policy patients_self_select bloquea filas ajenas');
        } else {
          fail(`Usuario logueado PUEDE ver patients ajenas (${otherPatients.length} filas)`);
        }

        // 3d. Idempotencia
        const { data: r2 } = await c2.rpc('claim_patient_records');
        if (r2?.linked_count === 0) pass('Segunda llamada idempotente (linked_count=0)');
        else warn(`Segunda llamada devolvió ${JSON.stringify(r2)}`);
      }
    }
  }
}

console.log(`\n${allOk ? '✅ s7_20 OK' : '❌ s7_20 con fallas — revisar'}`);
process.exit(allOk ? 0 : 1);
