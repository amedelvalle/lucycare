/**
 * Verifica s7_29: correcciones post-firma — Etapa B (B1 backend).
 *
 * Sanity acotado (la validación funcional real es empírica con sesión de
 * médico, post-apply — ver smoke en el PR):
 *  - tabla consultation_amendments existe (SELECT anon → 0 filas, no error
 *    de "relación inexistente").
 *  - RPC amend_consultation existe y rechaza a quien no es médico.
 *
 * Uso: node scripts/check-s7_29.mjs
 */
import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_29 (correcciones post-firma — B1) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

// 1. Tabla consultation_amendments existe
{
  const { error } = await anon.from('consultation_amendments').select('id').limit(1);
  if (error && /does not exist|relation/i.test(error.message))
    fail('consultation_amendments NO existe — ¿s7_29 aplicada?: ' + error.message);
  else pass('consultation_amendments existe (lectura anon sin error de relación)');
}

// 2. amend_consultation existe y rechaza a quien no es médico
{
  const { error } = await anon.rpc('amend_consultation', {
    p_consultation_id: '00000000-0000-0000-0000-000000000000',
    p_reason: 'x',
  });
  if (!error) fail('amend_consultation no devolvió error como anon (inesperado)');
  else if (/does not exist|could not find/i.test(error.message))
    fail('amend_consultation NO existe — ¿s7_29 aplicada?: ' + error.message);
  else pass('amend_consultation existe y rechaza a quien no es médico → ' + error.message);
}

console.log('\n  ⏭️  Smoke empírico (post-apply, sesión médico real):');
console.log('     - corregir consulta firmada vía RPC → adenda con before/after + motivo.');
console.log('     - receta corregida: vieja is_current=false (histórica) + v2 is_current=true.');
console.log('     - motivo vacío → rechazo (P0012).');
console.log('     - campo prohibido (patient_id/doctor_id/signed_at/status) → rechazo (P0013).');
console.log('     - asistente / no-dueño → rechazo.');
console.log('     - UPDATE directo de firmada sigue bloqueado (Etapa A intacta).\n');

console.log(`${allOk ? '✅ s7_29 sanity OK (validar empírico en smoke)' : '❌ s7_29 con fallas'}`);
process.exit(allOk ? 0 : 1);
