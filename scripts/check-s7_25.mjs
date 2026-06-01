/**
 * Verifica s7_25: ubicación estructurada en la ficha admin del médico.
 *
 * Limitación (igual que check-s7_22/24): las RPCs admin tienen gate
 * is_admin(), que service_role NO satisface. Acá solo confirmamos que
 * las funciones EXISTEN con la nueva firma y rechazan a anon; la
 * validación funcional (guardar dept/muni, precarga, obligatorios para
 * publicados/operativos) se hace en smoke con sesión admin real.
 *
 * Uso: node scripts/check-s7_25.mjs
 */
import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_25 (ubicación admin del médico) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

// 1. admin_update_doctor_clinic con la NUEVA firma (6 args) existe.
{
  const { error } = await anon.rpc('admin_update_doctor_clinic', {
    p_doctor_id: '00000000-0000-0000-0000-000000000000',
    p_name: 'x', p_address: null, p_phone: null,
    p_department_id: null, p_municipality_id: null,
  });
  if (!error) fail('admin_update_doctor_clinic no devolvió error como anon (inesperado)');
  else if (/does not exist|could not find|function .* does not/i.test(error.message))
    fail('admin_update_doctor_clinic(6 args) NO existe — ¿s7_25 aplicada?: ' + error.message);
  else pass('admin_update_doctor_clinic (6 args) existe y rechaza anon');
}

// 2. admin_get_doctor_detail existe y rechaza anon.
{
  const { error } = await anon.rpc('admin_get_doctor_detail', {
    p_doctor_id: '00000000-0000-0000-0000-000000000000',
  });
  if (!error) fail('admin_get_doctor_detail no devolvió error como anon (inesperado)');
  else if (/does not exist|could not find/i.test(error.message))
    fail('admin_get_doctor_detail NO existe — ¿s7_25 aplicada?');
  else pass('admin_get_doctor_detail existe y rechaza anon');
}

console.log('\n  ⏭️  Validación funcional en smoke (sesión admin real):');
console.log('     - editar dept/muni en /admin/medicos/:id → persiste en clinics.');
console.log('     - precarga de los selects con el valor actual.');
console.log('     - municipio depende del departamento.');
console.log('     - publicado/operativo sin dept+muni → rechazo (P0004).');
console.log('     - el médico aparece bajo el filtro de ese dept/muni en el Home.\n');

console.log(`${allOk ? '✅ s7_25 sanity OK (validar funcional en smoke)' : '❌ s7_25 con fallas'}`);
process.exit(allOk ? 0 : 1);
