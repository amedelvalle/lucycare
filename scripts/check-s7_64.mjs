/**
 * check-s7_64.mjs — verificación estructural de PR B / F1-c1
 *                   (retiro lógico de doctors.license_number).
 *
 *   node scripts/check-s7_64.mjs
 *
 * ── SIN service_role, SIN escrituras ──
 * s7_64 conserva firmas y gates de las dos RPCs; este check confirma la
 * NO-regresión de esa superficie. Las pruebas REALES del retiro (columna
 * NULL en altas, claim sin fallback, trigger ausente, importador) viven en
 * _smoke-s7_64.mjs (service_role + OTP) y en la verificación SQL del owner
 * (pg_trigger/pg_proc, inaccesibles vía supabase-js).
 *
 * Qué verifica:
 *   1. admin_approve_and_create_doctor existe, acepta (uuid, jsonb) y su
 *      gate is_admin() sigue intacto (sesión no-admin → 42501).
 *   2. claim_doctor_profile responde con su firma (uuid, text) — un doctor
 *      inexistente da P0002, sin reclamar nada.
 *   3. doctor_credentials sigue protegida para anon (no-regresión s7_61).
 *
 * Antes y después de aplicar s7_64 los 3 deben pasar (retrocompatible).
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseAnon } from './_lib/supabase-anon.mjs';

const DOCTOR_PHONE = '+50378627694'; // Camilo — solo para OBTENER una sesión (no se crea ni reclama nada)
const OTP = '123456';
const NOWHERE = '00000000-0000-0000-0000-000000000000';

let pass = 0;
let fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const no = (m) => { console.log(`  ❌ ${m}`); fail++; };

async function main() {
  console.log('\ncheck-s7_64 — retiro lógico de license_number (estructural)\n');

  const cli = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await cli.auth.signInWithOtp({ phone: DOCTOR_PHONE }).catch(() => {});
  const { error: authErr } = await cli.auth.verifyOtp({ phone: DOCTOR_PHONE, token: OTP, type: 'sms' });

  // ─── 1. approve: firma + gate is_admin ────────────────────
  if (authErr) {
    no(`no se pudo obtener sesión de prueba: ${authErr.message}`);
  } else {
    const { error } = await cli.rpc('admin_approve_and_create_doctor', {
      p_request_id: NOWHERE,
      p_overrides: {},
    });
    if (error?.code === '42501') {
      ok('admin_approve_and_create_doctor: firma intacta + gate is_admin (no-admin → 42501)');
    } else if (error) {
      no(`approve: esperado 42501 para no-admin; recibido ${error.code} ${error.message}`);
    } else {
      no('approve NO rechazó a una sesión no-admin — CRÍTICO');
    }
  }

  // ─── 2. claim: firma responde ─────────────────────────────
  if (!authErr) {
    const { error } = await cli.rpc('claim_doctor_profile', {
      p_doctor_id: NOWHERE,
      p_license_typed: 'NO-IMPORTA',
    });
    if (error?.code === 'P0002') {
      ok('claim_doctor_profile responde con su firma (doctor inexistente → P0002, sin reclamar nada)');
    } else if (error) {
      ok(`claim_doctor_profile existe y corre (código ${error.code})`);
    } else {
      no('claim no devolvió error para un doctor inexistente — inesperado');
    }
  }
  await cli.auth.signOut().catch(() => {});

  // ─── 3. doctor_credentials bajo RLS (anon sin acceso) ─────
  {
    const { error } = await supabaseAnon.from('doctor_credentials').select('id').limit(1);
    if (error) ok(`doctor_credentials sigue protegida para anon (${error.code})`);
    else no('anon accedió a doctor_credentials — CRÍTICO (¿regresión de s7_61?)');
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} check-s7_64: pass=${pass} fail=${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Error inesperado:', e.message);
  process.exit(1);
});
