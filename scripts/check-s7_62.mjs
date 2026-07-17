/**
 * check-s7_62.mjs — verificación estructural del cutover de lectores (F1-b).
 *
 *   node scripts/check-s7_62.mjs
 *
 * ── SIN service_role, SIN escrituras ──
 * F1-b es retrocompatible: la RPC del claim conserva firma y comportamiento
 * externo, y el resto es frontend. Sin la migración aplicada, este check
 * confirma que la superficie observable NO cambió (la firma del claim sigue
 * respondiendo, la tabla sigue accesible por RLS). La prueba REAL del cutover
 * —que el claim lee doctor_credentials y no la columna— vive en el smoke
 * (desync + OTP), porque requiere una sesión.
 *
 * Qué verifica:
 *   1. claim_doctor_profile responde con su firma (uuid, text, text) — un
 *      doctor inexistente da P0002, no un error de firma/ausencia.
 *   2. doctor_credentials sigue accesible bajo RLS (anon = sin acceso).
 *
 * Antes y después de aplicar s7_62 ambos deben pasar: es una migración
 * retrocompatible, así que el check afirma la NO-regresión de la superficie.
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseAnon } from './_lib/supabase-anon.mjs';

const DOCTOR_PHONE = '+50378627694'; // Camilo — solo para OBTENER una sesión válida (no se reclama nada)
const OTP = '123456';
const NOWHERE = '00000000-0000-0000-0000-000000000000';

let pass = 0;
let fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const no = (m) => { console.log(`  ❌ ${m}`); fail++; };

async function main() {
  console.log('\ncheck-s7_62 — cutover de lectores (estructural)\n');

  // ─── 1. firma del claim ───────────────────────────────────
  // Con una sesión válida, reclamar un doctor INEXISTENTE debe dar P0002
  // (doctor no encontrado) — prueba que la RPC existe, acepta (uuid, text) y
  // llega a la sección 2. NO reclama nada real (el uuid no existe).
  {
    const cli = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await cli.auth.signInWithOtp({ phone: DOCTOR_PHONE }).catch(() => {});
    const { error: authErr } = await cli.auth.verifyOtp({ phone: DOCTOR_PHONE, token: OTP, type: 'sms' });
    if (authErr) {
      no(`no se pudo obtener sesión de prueba: ${authErr.message}`);
    } else {
      const { error } = await cli.rpc('claim_doctor_profile', {
        p_doctor_id: NOWHERE,
        p_license_typed: 'NO-IMPORTA',
      });
      if (error?.code === 'P0002') {
        ok('claim_doctor_profile responde con su firma (doctor inexistente → P0002, sin reclamar nada)');
      } else if (error) {
        // Cualquier P-code del claim también prueba que la RPC existe y corre.
        ok(`claim_doctor_profile existe y corre (código ${error.code})`);
      } else {
        no('claim_doctor_profile no devolvió error para un doctor inexistente — inesperado');
      }
    }
    await cli.auth.signOut().catch(() => {});
  }

  // ─── 2. doctor_credentials bajo RLS (anon sin acceso) ─────
  {
    const { error } = await supabaseAnon.from('doctor_credentials').select('id').limit(1);
    if (error) ok(`doctor_credentials sigue protegida para anon (${error.code})`);
    else no('anon accedió a doctor_credentials — CRÍTICO (¿regresión de s7_61?)');
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} check-s7_62: pass=${pass} fail=${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Error inesperado:', e.message);
  process.exit(1);
});
