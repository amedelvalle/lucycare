/**
 * Verifica s7_33: Paciente Global F3.1 — sync espejo + guard de identidad.
 *
 * Sanity anon acotado (la validación real es el smoke con sesiones reales):
 *  - claim_patient_records sigue existiendo y NO es ejecutable por anon
 *    (REVOKE anon / GRANT authenticated).
 * Los triggers (guard en patients, sync en profiles) se validan en el smoke.
 *
 * Uso: node scripts/check-s7_33.mjs
 */
import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_33 (sync espejo + guard identidad) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

{
  const { error } = await anon.rpc('claim_patient_records');
  if (!error) fail('claim_patient_records no devolvió error como anon (debería estar REVOKE anon)');
  else if (/does not exist|could not find/i.test(error.message))
    fail('claim_patient_records NO existe — ¿s7_33 aplicada?: ' + error.message);
  else pass('claim_patient_records existe y no es ejecutable por anon → ' + error.message);
}

console.log('\n  ⏭️  Smoke (sesiones reales) — node scripts/_smoke-s7_33.mjs:');
console.log('     - médico NO puede editar identidad de paciente vinculado (P0030).');
console.log('     - médico SÍ puede editar campos locales (alergias, etc.).');
console.log('     - update de profiles → se refleja en patients vinculadas (sync ongoing).');
console.log('     - claim copia identidad global (global gana; local-only se conserva).');
console.log('     - paciente NO vinculado → identidad editable como hoy.\n');

console.log(`${allOk ? '✅ s7_33 sanity OK (validar empírico en smoke)' : '❌ s7_33 con fallas'}`);
process.exit(allOk ? 0 : 1);
