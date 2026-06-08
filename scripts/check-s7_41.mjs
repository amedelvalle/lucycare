/**
 * Verifica s7_41: RPC admin_list_waitlist (lista de espera global cross-médicos).
 *
 * Sanity liviano (sin sesión de usuario): la RPC exige is_admin(). Con
 * service_role auth.uid() es NULL → no es admin → debe rechazar (P0001). Eso
 * prueba que la función EXISTE (migración aplicada) y que el gate funciona.
 * Si no existiera, el error sería "could not find function" (PGRST202 / 42883).
 *
 * Verificación funcional real (cross-doctor + filtros + cambio de estado):
 *   node scripts/_smoke-s7_41.mjs  (sesión admin, fixtures + cleanup)
 *
 * Uso: node scripts/check-s7_41.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_41 (admin_list_waitlist) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

{
  const { error } = await admin.rpc('admin_list_waitlist', { p_limit: 1 });
  if (!error) {
    fail('La RPC respondió OK con service_role (esperábamos rechazo is_admin / P0001).');
  } else if (/No autorizado/i.test(error.message) || error.code === 'P0001') {
    pass(`RPC existe y rechaza a no-admin (${error.code || ''} ${error.message.slice(0, 50)})`);
  } else if (/could not find function|does not exist|PGRST202/i.test(error.message) || error.code === '42883') {
    fail('La RPC NO existe → ¿migración s7_41 aplicada? ' + error.message);
  } else {
    fail('Error inesperado: ' + (error.code || '') + ' ' + error.message);
  }
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_41.mjs');
console.log('     (cross-doctor · filtros estado/médico/búsqueda/fecha · total_count · cambio de estado).\n');

console.log(`${allOk ? '✅ s7_41 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_41 con fallas'}`);
process.exit(allOk ? 0 : 1);
