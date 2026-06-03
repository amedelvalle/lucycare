/**
 * Verifica s7_28: inmutabilidad server-side de consultas firmadas (Etapa A).
 *
 * Sanity acotado (service_role bypasea RLS; el RLS real se valida empírico
 * con sesión de médico post-apply — ver smoke en el PR). Acá confirmamos
 * que la RPC sign_consultation existe y rechaza a quien no es médico.
 *
 * Uso: node scripts/check-s7_28.mjs
 */
import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_28 (inmutabilidad consultas firmadas) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

// sign_consultation existe y rechaza a anon (no es médico → 42501)
{
  const { error } = await anon.rpc('sign_consultation', {
    p_consultation_id: '00000000-0000-0000-0000-000000000000',
  });
  if (!error) fail('sign_consultation no devolvió error como anon (inesperado)');
  else if (/does not exist|could not find/i.test(error.message))
    fail('sign_consultation NO existe — ¿s7_28 aplicada?: ' + error.message);
  else pass('sign_consultation existe y rechaza a quien no es médico → ' + error.message);
}

console.log('\n  ⏭️  Smoke empírico (post-apply, sesión de médico real):');
console.log('     1. firmar vía RPC → consulta signed + cita → atendida (sync).');
console.log('     2. UPDATE directo de consulta/receta FIRMADA (médico dueño) → bloqueado por RLS.');
console.log('     3. editar BORRADOR → sigue OK.');
console.log('     4. asistente → bloqueado (gate s7_26 + RPC).');
console.log('     (Etapa A solo cierra la fuga; la corrección controlada = Etapa B.)\n');

console.log(`${allOk ? '✅ s7_28 sanity OK (validar empírico en smoke)' : '❌ s7_28 con fallas'}`);
process.exit(allOk ? 0 : 1);
