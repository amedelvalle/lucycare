/**
 * check-s7_63.mjs — verificación estructural de PR A / F1-c
 *                   (admin_approve_and_create_doctor escribe la credencial).
 *
 *   node scripts/check-s7_63.mjs
 *
 * ── SIN service_role, SIN escrituras ──
 * s7_63 es retrocompatible por diseño: misma firma, mismos gates, mismo
 * comportamiento observable con el trigger activo. Este check confirma que
 * la superficie NO cambió. La prueba REAL de la escritura directa (la
 * autosuficiencia sin trigger) vive en el bloque A/B del owner (SQL Editor,
 * con rollback) y la convivencia trigger+directo en _smoke-s7_63.mjs.
 *
 * Qué verifica:
 *   1. admin_approve_and_create_doctor existe, acepta (uuid, jsonb) y su gate
 *      is_admin() sigue intacto — una sesión NO-admin (Camilo, médico) recibe
 *      42501 sin que se cree nada (el uuid no existe y el gate corre primero).
 *   2. anon no puede ejecutarla (denegación, no PGRST202 "no existe").
 *   3. doctor_credentials sigue protegida para anon (no-regresión s7_61).
 *
 * Antes y después de aplicar s7_63 los 3 deben pasar (no-regresión de
 * superficie).
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseAnon } from './_lib/supabase-anon.mjs';

const DOCTOR_PHONE = '+50378627694'; // Camilo — solo para OBTENER una sesión NO-admin (no se crea nada)
const OTP = '123456';
const NOWHERE = '00000000-0000-0000-0000-000000000000';

let pass = 0;
let fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const no = (m) => { console.log(`  ❌ ${m}`); fail++; };

async function main() {
  console.log('\ncheck-s7_63 — approve escribe la credencial (estructural)\n');

  // ─── 1. firma + gate is_admin con sesión NO-admin ─────────
  // El gate corre ANTES de leer el lead: con un médico (no admin) el
  // resultado esperado es 42501, sin tocar ningún dato.
  {
    const cli = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await cli.auth.signInWithOtp({ phone: DOCTOR_PHONE }).catch(() => {});
    const { error: authErr } = await cli.auth.verifyOtp({ phone: DOCTOR_PHONE, token: OTP, type: 'sms' });
    if (authErr) {
      no(`no se pudo obtener sesión de prueba: ${authErr.message}`);
    } else {
      const { error } = await cli.rpc('admin_approve_and_create_doctor', {
        p_request_id: NOWHERE,
        p_overrides: {},
      });
      if (error?.code === '42501') {
        ok('admin_approve_and_create_doctor existe, acepta (uuid, jsonb) y su gate is_admin sigue intacto (no-admin → 42501)');
      } else if (error) {
        no(`esperado 42501 para sesión no-admin; recibido: ${error.code} ${error.message}`);
      } else {
        no('la RPC NO rechazó a una sesión no-admin — CRÍTICO (¿gate perdido en la re-emisión?)');
      }
    }
    await cli.auth.signOut().catch(() => {});
  }

  // ─── 2. anon sin ejecución ────────────────────────────────
  {
    const { error } = await supabaseAnon.rpc('admin_approve_and_create_doctor', {
      p_request_id: NOWHERE,
      p_overrides: {},
    });
    if (error && error.code !== 'PGRST202') {
      ok(`anon no puede ejecutarla y la RPC existe (${error.code})`);
    } else if (error?.code === 'PGRST202') {
      no('PGRST202: la RPC no existe — ¿s7_63 borró la función?');
    } else {
      no('anon ejecutó la RPC sin error — CRÍTICO');
    }
  }

  // ─── 3. doctor_credentials bajo RLS (anon sin acceso) ─────
  {
    const { error } = await supabaseAnon.from('doctor_credentials').select('id').limit(1);
    if (error) ok(`doctor_credentials sigue protegida para anon (${error.code})`);
    else no('anon accedió a doctor_credentials — CRÍTICO (¿regresión de s7_61?)');
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} check-s7_63: pass=${pass} fail=${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Error inesperado:', e.message);
  process.exit(1);
});
