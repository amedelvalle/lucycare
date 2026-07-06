/**
 * Verifica s7_54: RPCs admin_pharma_summary + admin_pharma_medication_ranking +
 * admin_pharma_doctor_ranking (Analytics Farma — solo agregados, gate is_admin()).
 *
 * Sanity liviano (sin sesión): con service_role auth.uid() es NULL → no es admin
 * → las 3 RPCs deben rechazar (P0001). Prueba que EXISTEN (migración aplicada) y
 * que el gate funciona. Si no existieran → "could not find function" (PGRST202 /
 * 42883).
 *
 * Verificación funcional real (agregados + rankings + umbral + 0 PII):
 *   node scripts/_smoke-s7_54.mjs  (sesión admin, fixtures aisladas + cleanup)
 *
 * Uso: node scripts/check-s7_54.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_54 (Analytics Farma) ═══\n');

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
    fail(`${rpc}: NO existe → ¿migración s7_54 aplicada? ${error.message}`);
  } else {
    fail(`${rpc}: error inesperado: ${error.code || ''} ${error.message}`);
  }
}

await checkGate('admin_pharma_summary', {});
await checkGate('admin_pharma_medication_ranking', { p_limit: 5 });
await checkGate('admin_pharma_doctor_ranking', { p_limit: 5 });

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_54.mjs');
console.log('     (conteos · ranking medicamentos/médicos · global vs personal · permanente ·');
console.log('      exclusión borradores/is_current=false · signed_at · umbral · 0 PII · cleanup).\n');

console.log(`${allOk ? '✅ s7_54 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_54 con fallas'}`);
process.exit(allOk ? 0 : 1);
