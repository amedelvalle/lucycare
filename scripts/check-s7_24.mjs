/**
 * Verifica s7_24: fixes de Afiliación Fase 2.
 *
 * Limitación (igual que check-s7_22): las RPCs admin tienen gate
 * is_admin(), que service_role NO satisface (no hay auth.uid()). Por
 * eso acá solo confirmamos que las funciones EXISTEN y rechazan a
 * anon; la validación funcional real (role='patient' pre-claim,
 * precarga dept/muni, nombre de clínica sin doble "Dr.") se hace en
 * el re-smoke end-to-end de afiliación con sesión admin/médico real.
 *
 * Uso: node scripts/check-s7_24.mjs
 */
import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_24 (fixes Afiliación Fase 2) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

// 1. admin_approve_and_create_doctor existe y rechaza anon (no "does not exist")
{
  const { error } = await anon.rpc('admin_approve_and_create_doctor', {
    p_request_id: '00000000-0000-0000-0000-000000000000',
    p_overrides: {},
  });
  if (!error) fail('admin_approve_and_create_doctor no devolvió error como anon (inesperado)');
  else if (/does not exist|could not find/i.test(error.message))
    fail('admin_approve_and_create_doctor NO existe — ¿migración s7_24 aplicada?');
  else pass('admin_approve_and_create_doctor existe y rechaza anon');
}

// 2. admin_list_affiliation_requests existe y rechaza anon
{
  const { error } = await anon.rpc('admin_list_affiliation_requests', {});
  if (!error) fail('admin_list_affiliation_requests no devolvió error como anon (inesperado)');
  else if (/does not exist|could not find/i.test(error.message))
    fail('admin_list_affiliation_requests NO existe — ¿migración s7_24 aplicada?');
  else pass('admin_list_affiliation_requests existe y rechaza anon');
}

console.log('\n  ⏭️  Validación funcional en re-smoke (sesión admin/médico real):');
console.log('     - profile del médico creado queda role=\'patient\' (no \'doctor\').');
console.log('     - tras claim_doctor_profile → role=\'doctor\' + lucy_status=\'claimed\'.');
console.log('     - modal admin precarga Departamento/Municipio del lead.');
console.log('     - nombre de clínica sin doble "Dr." cuando el nombre ya lo trae.\n');

console.log(`${allOk ? '✅ s7_24 sanity OK (validar funcional en smoke)' : '❌ s7_24 con fallas'}`);
process.exit(allOk ? 0 : 1);
