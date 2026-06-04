/**
 * Verifica s7_31: B1.5-a — amend de diagnósticos/antecedentes/vitales +
 * inmutabilidad de vitals.
 *
 * Sanity acotado (la validación funcional real es empírica con sesión de
 * médico — ver smoke en el PR / smoke OTP opcional):
 *  - amend_consultation con la FIRMA NUEVA (incluye p_diagnosis_ops,
 *    p_family_history_ops, p_vitals_changes) existe y rechaza a quien no es
 *    médico. Si la firma vieja siguiera viva o la nueva no existiera, PostgREST
 *    devolvería "could not find function ... in the schema cache".
 *
 * Lo que NO se puede verificar como anon (requiere sesión de médico):
 *  - aplicar ops de diagnóstico/antecedente/vitales,
 *  - que el UPDATE directo de vitales de una cita firmada quede bloqueado.
 *  → smoke empírico abajo.
 *
 * Uso: node scripts/check-s7_31.mjs
 */
import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_31 (amend diag/antecedentes/vitales + inmutabilidad vitals) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

// amend_consultation con la firma NUEVA existe y rechaza a no-médico
{
  const { error } = await anon.rpc('amend_consultation', {
    p_consultation_id: '00000000-0000-0000-0000-000000000000',
    p_reason: 'x',
    p_diagnosis_ops: [],
    p_family_history_ops: [],
    p_vitals_changes: {},
  });
  if (!error) {
    fail('amend_consultation no devolvió error como anon (inesperado)');
  } else if (/could not find|does not exist|schema cache/i.test(error.message)) {
    fail('amend_consultation con firma nueva NO existe — ¿s7_31 aplicada?: ' + error.message);
  } else {
    pass('amend_consultation (firma nueva con diag/antecedentes/vitales) existe y rechaza a no-médico → ' + error.message);
  }
}

console.log('\n  ⏭️  Smoke empírico (post-apply, sesión de médico dueño real):');
console.log('     - amend con p_diagnosis_ops (add/replace/remove) → aplica en consultation_diagnoses; adenda con before/after.');
console.log('     - amend con p_family_history_ops → aplica en consultation_family_history.');
console.log('     - amend con p_vitals_changes → actualiza la fila de vitals de la cita (bmi del cliente).');
console.log('     - corrección SOLO de estos bloques → affects_prescriptions=false (NO "RECETA CORREGIDA").');
console.log('     - UPDATE directo de vitals de una cita con consulta FIRMADA (sesión de médico) → bloqueado por RLS.');
console.log('     - captura de vitals en borrador (no firmada) → sigue permitida.\n');

console.log(`${allOk ? '✅ s7_31 sanity OK (validar empírico en smoke)' : '❌ s7_31 con fallas'}`);
process.exit(allOk ? 0 : 1);
