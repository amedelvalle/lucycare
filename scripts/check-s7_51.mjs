/**
 * Verifica s7_51: RPCs de lista de espera del panel (médico/asistente).
 *
 * Sanity liviano (service_role → auth.uid() = NULL):
 *  1. clinic_list_waitlist existe y el gate rechaza sin autenticación
 *     (auth.uid() NULL → P0001 "No autenticado"). Si NOT_FOUND → migración no aplicada.
 *  2. clinic_update_waitlist_entry existe (con un entry_id inexistente → P0106
 *     "Entrada no encontrada", que prueba que la función está desplegada).
 *  3. Las RPCs admin_* siguen existiendo (no se rompieron / no se ensancharon):
 *     admin_list_waitlist_for_doctor con service_role → "No autorizado" (is_admin false).
 *
 * Verificación FUNCIONAL (gate por médico/asistente, cross-doctor, update, audit)
 * vive en el smoke con sesiones reales: node scripts/_smoke-s7_51.mjs
 *
 * Uso: node scripts/check-s7_51.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_51 (lista de espera del panel) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

const NOT_FOUND = (e) =>
  /could not find function|does not exist|PGRST202/i.test(e?.message || '') || e?.code === '42883';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// 1. clinic_list_waitlist existe + gate exige autenticación.
{
  const { error } = await admin.rpc('clinic_list_waitlist', { p_doctor_id: ZERO_UUID });
  if (!error) fail('clinic_list_waitlist respondió OK con service_role (esperábamos rechazo de auth).');
  else if (error.code === 'P0001' || /No autenticado|No autorizado/i.test(error.message)) {
    pass(`clinic_list_waitlist existe y exige auth (${error.code || ''} ${error.message.slice(0, 40)})`);
  } else if (NOT_FOUND(error)) {
    fail('clinic_list_waitlist NO existe → ¿migración s7_51 aplicada? ' + error.message);
  } else {
    fail('Error inesperado en clinic_list_waitlist: ' + (error.code || '') + ' ' + error.message);
  }
}

// 2. clinic_update_waitlist_entry existe (entry inexistente → P0106).
{
  const { error } = await admin.rpc('clinic_update_waitlist_entry', { p_entry_id: ZERO_UUID, p_status: 'contacted' });
  if (!error) fail('clinic_update_waitlist_entry respondió OK con entry inexistente (esperábamos P0106).');
  else if (error.code === 'P0106' || /no encontrada/i.test(error.message)) {
    pass('clinic_update_waitlist_entry existe (entry inexistente → P0106) ✓');
  } else if (NOT_FOUND(error)) {
    fail('clinic_update_waitlist_entry NO existe → ¿migración s7_51 aplicada? ' + error.message);
  } else if (error.code === 'P0001') {
    pass('clinic_update_waitlist_entry existe (gate de auth) ✓');
  } else {
    fail('Error inesperado en clinic_update_waitlist_entry: ' + (error.code || '') + ' ' + error.message);
  }
}

// 3. La RPC admin sigue intacta (no ensanchada): rechaza a no-admin.
{
  const { error } = await admin.rpc('admin_list_waitlist_for_doctor', { p_doctor_id: ZERO_UUID });
  if (error && /No autorizado/i.test(error.message)) {
    pass('admin_list_waitlist_for_doctor sigue gated a is_admin (intacta) ✓');
  } else if (error && NOT_FOUND(error)) {
    fail('admin_list_waitlist_for_doctor desapareció (no debía tocarse): ' + error.message);
  } else if (!error) {
    fail('admin_list_waitlist_for_doctor respondió OK con service_role (gate roto?).');
  } else {
    pass(`admin_list_waitlist_for_doctor responde con gate (${error.code || ''}) ✓`);
  }
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_51.mjs');
console.log(`\n${allOk ? '✅ s7_51 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_51 con fallas'}`);
process.exit(allOk ? 0 : 1);
