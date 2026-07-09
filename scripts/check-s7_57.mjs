/**
 * Verifica s7_57: niveles de acceso administrativo LucyAdmin (capability).
 *
 * Sanity liviano (sin sesión de usuario): con service_role auth.uid() es NULL →
 * no es admin y no tiene fila en lucyadmin_access → can_manage_directory()=false.
 *   • Las RPCs re-gateadas + las nuevas directory_* deben rechazar (No autorizado)
 *     → prueba que EXISTEN (migración aplicada) y que el gate por capacidad corre.
 *   • Las funciones de capacidad (can_*) deben EXISTIR y devolver false.
 *   • my_lucyadmin_access() debe devolver un objeto bien formado (can_access=false).
 *
 * Verificación funcional real (matriz admin/editor/ops/inactivo/normal + audit):
 *   node scripts/_smoke-s7_57.mjs  (sesiones reales, fixtures aisladas + cleanup)
 *
 * Uso (SOLO tras aplicar s7_57): node scripts/check-s7_57.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_57 (niveles de acceso LucyAdmin) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

const DUMMY = '00000000-0000-0000-0000-000000000000';

// Con service_role el gate can_manage_directory() = false → debe rechazar.
async function checkGate(rpc, args) {
  const { error } = await admin.rpc(rpc, args);
  if (!error) {
    fail(`${rpc}: respondió OK con service_role (esperábamos rechazo por capacidad).`);
  } else if (/No autorizado/i.test(error.message) || error.code === 'P0001') {
    pass(`${rpc}: existe y rechaza sin capacidad (${error.code || ''} ${error.message.slice(0, 32)})`);
  } else if (/could not find function|does not exist|PGRST202/i.test(error.message) || error.code === '42883') {
    fail(`${rpc}: NO existe → ¿migración s7_57 aplicada? ${error.message}`);
  } else {
    fail(`${rpc}: error inesperado: ${error.code || ''} ${error.message}`);
  }
}

// Las capacidades no lanzan: existen y devuelven false para service_role.
async function checkBoolFalse(fn) {
  const { data, error } = await admin.rpc(fn);
  if (error) fail(`${fn}: error (¿existe?): ${error.code || ''} ${error.message.slice(0, 40)}`);
  else if (data === false) pass(`${fn}: existe y devuelve false sin sesión`);
  else fail(`${fn}: esperaba false, got ${JSON.stringify(data)}`);
}

// ─── RPCs re-gateadas + nuevas (deben rechazar sin capacidad) ───
await checkGate('admin_update_doctor_clinic', { p_doctor_id: DUMMY, p_name: 'x', p_address: null, p_phone: null });
await checkGate('admin_update_doctor_info', { p_doctor_id: DUMMY, p_specialty_id: null, p_bio: null });
await checkGate('admin_set_doctor_published', { p_doctor_id: DUMMY, p_value: true });
await checkGate('admin_list_doctor_services', { p_doctor_id: DUMMY });
await checkGate('admin_create_service', { p_doctor_id: DUMMY, p_name: 'x', p_duration_minutes: 30, p_price: 0, p_is_first_visit: false });
await checkGate('admin_update_service', { p_service_id: DUMMY, p_name: 'x', p_duration_minutes: 30, p_price: 0, p_is_first_visit: false });
await checkGate('admin_set_service_active', { p_service_id: DUMMY, p_is_active: true });
await checkGate('directory_list_doctors', {});
await checkGate('directory_get_doctor_detail', { p_doctor_id: DUMMY });
await checkGate('directory_update_doctor_name', { p_doctor_id: DUMMY, p_full_name: 'x' });

// ─── Funciones de capacidad (existen, devuelven false sin sesión) ───
await checkBoolFalse('can_access_lucyadmin');
await checkBoolFalse('can_manage_directory');
await checkBoolFalse('can_manage_doctor_operations');
await checkBoolFalse('can_manage_lucyadmin_users');

// ─── my_lucyadmin_access() (objeto bien formado) ───
{
  const { data, error } = await admin.rpc('my_lucyadmin_access');
  if (error) fail(`my_lucyadmin_access: error (¿existe?): ${error.message}`);
  else if (data && typeof data === 'object' && data.can_access_lucyadmin === false && data.can_manage_directory === false)
    pass('my_lucyadmin_access: existe y devuelve objeto coherente (sin capacidad)');
  else fail('my_lucyadmin_access: forma inesperada: ' + JSON.stringify(data));
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_57.mjs');
console.log('     (matriz admin/editor/operations/inactivo/normal · sin login creds · audit por actor).\n');

console.log(`${allOk ? '✅ s7_57 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_57 con fallas'}`);
process.exit(allOk ? 0 : 1);
