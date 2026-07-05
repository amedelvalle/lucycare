/**
 * Verifica s7_53: RPCs admin_conversion_summary + admin_doctor_conversion_ranking
 * (dashboard interno de conversiones — solo agregados, gate is_admin()).
 *
 * Sanity liviano (sin sesión de usuario): con service_role auth.uid() es NULL →
 * no es admin → ambas RPCs deben rechazar (P0001). Eso prueba que EXISTEN
 * (migración aplicada) y que el gate funciona. Si no existieran, el error sería
 * "could not find function" (PGRST202 / 42883).
 *
 * Verificación funcional real (agregados + clasificación + ranking + 0 PII):
 *   node scripts/_smoke-s7_53.mjs  (sesión admin, fixtures aisladas + cleanup)
 *
 * Uso: node scripts/check-s7_53.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_53 (dashboard de conversiones) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

async function checkGate(rpc, args) {
  const { error } = await admin.rpc(rpc, args);
  if (!error) {
    fail(`${rpc}: respondió OK con service_role (esperábamos rechazo is_admin / P0001).`);
  } else if (/No autorizado/i.test(error.message) || error.code === 'P0001') {
    pass(`${rpc}: existe y rechaza a no-admin (${error.code || ''} ${error.message.slice(0, 40)})`);
  } else if (/could not find function|does not exist|PGRST202/i.test(error.message) || error.code === '42883') {
    fail(`${rpc}: NO existe → ¿migración s7_53 aplicada? ${error.message}`);
  } else {
    fail(`${rpc}: error inesperado: ${error.code || ''} ${error.message}`);
  }
}

await checkGate('admin_conversion_summary', {});
await checkGate('admin_doctor_conversion_ranking', { p_limit: 5 });

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_53.mjs');
console.log('     (agregados por source/estado · waitlist · afiliaciones · claims desde audit_log ·');
console.log('      reviews · ranking por médico · 0 PII en el payload · fixtures aisladas + cleanup).\n');

console.log(`${allOk ? '✅ s7_53 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_53 con fallas'}`);
process.exit(allOk ? 0 : 1);
