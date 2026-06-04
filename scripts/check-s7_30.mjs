/**
 * Verifica s7_30: distinción adenda de texto vs adenda de receta.
 *
 * Sanity acotado (la validación funcional real es empírica con sesión de
 * médico, post-apply — ver smoke en el PR):
 *  - la columna consultation_amendments.affects_prescriptions existe
 *    (SELECT anon → 0 filas por RLS, pero sin error de "columna inexistente").
 *  - amend_consultation sigue existiendo y rechaza a quien no es médico.
 *
 * Uso: node scripts/check-s7_30.mjs
 */
import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_30 (adenda texto vs receta) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

// 1. Columna affects_prescriptions existe
{
  const { error } = await anon
    .from('consultation_amendments')
    .select('affects_prescriptions')
    .limit(1);
  if (error && /column .* does not exist|affects_prescriptions/i.test(error.message))
    fail('affects_prescriptions NO existe — ¿s7_30 aplicada?: ' + error.message);
  else if (error && /relation/i.test(error.message))
    fail('consultation_amendments NO existe — ¿s7_29/s7_30 aplicadas?: ' + error.message);
  else pass('consultation_amendments.affects_prescriptions existe (lectura anon sin error de columna)');
}

// 2. amend_consultation existe y rechaza a quien no es médico
{
  const { error } = await anon.rpc('amend_consultation', {
    p_consultation_id: '00000000-0000-0000-0000-000000000000',
    p_reason: 'x',
  });
  if (!error) fail('amend_consultation no devolvió error como anon (inesperado)');
  else if (/does not exist|could not find/i.test(error.message))
    fail('amend_consultation NO existe — ¿s7_30 aplicada?: ' + error.message);
  else pass('amend_consultation existe y rechaza a quien no es médico → ' + error.message);
}

console.log('\n  ⏭️  Smoke empírico (post-apply, sesión médico real):');
console.log('     - amend SOLO texto → adenda con affects_prescriptions=false.');
console.log('     - amend con prescription_ops (replace/add/remove) → affects_prescriptions=true.');
console.log('     - impresión: "RECETA CORREGIDA" SOLO cuando hay una adenda con true.');
console.log('     - corrección solo de texto → NO marca la receta; sí aparece en historial.\n');

console.log(`${allOk ? '✅ s7_30 sanity OK (validar empírico en smoke)' : '❌ s7_30 con fallas'}`);
process.exit(allOk ? 0 : 1);
