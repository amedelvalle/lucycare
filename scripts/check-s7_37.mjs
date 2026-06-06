/**
 * Verifica s7_37: snapshot histórico de catálogo en receta/diagnóstico.
 *
 * Sanity con service_role:
 *  1. Columnas snapshot existen en prescriptions y consultation_diagnoses.
 *  2. Backfill completo: no quedan filas con FK no-null y snapshot NULL.
 *
 * Verificación funcional (trigger al insertar, snapshot congelado al editar
 * catálogo, amend_consultation): node scripts/_smoke-s7_37.mjs
 *
 * Uso: node scripts/check-s7_37.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_37 (snapshot histórico de catálogo) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

{
  const { error } = await admin
    .from('prescriptions')
    .select('medication_name_snapshot, active_ingredient_snapshot, concentration_snapshot, presentation_snapshot')
    .limit(1);
  if (error) fail('columnas snapshot de prescriptions no accesibles: ' + error.message);
  else pass('prescriptions tiene columnas snapshot');
}
{
  const { error } = await admin
    .from('consultation_diagnoses')
    .select('diagnosis_name_snapshot')
    .limit(1);
  if (error) fail('columna diagnosis_name_snapshot no accesible: ' + error.message);
  else pass('consultation_diagnoses tiene diagnosis_name_snapshot');
}

{
  const { count, error } = await admin
    .from('prescriptions')
    .select('id', { count: 'exact', head: true })
    .not('medication_id', 'is', null)
    .is('medication_name_snapshot', null);
  if (error) fail('conteo backfill prescriptions: ' + error.message);
  else if ((count ?? 0) === 0) pass('backfill prescriptions completo (0 sin snapshot)');
  else fail(`${count} prescriptions con medication_id y sin snapshot → backfill incompleto`);
}
{
  const { count, error } = await admin
    .from('consultation_diagnoses')
    .select('id', { count: 'exact', head: true })
    .not('diagnosis_id', 'is', null)
    .is('diagnosis_name_snapshot', null);
  if (error) fail('conteo backfill diagnoses: ' + error.message);
  else if ((count ?? 0) === 0) pass('backfill consultation_diagnoses completo (0 sin snapshot)');
  else fail(`${count} consultation_diagnoses con diagnosis_id y sin snapshot → backfill incompleto`);
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_37.mjs\n');
console.log(`${allOk ? '✅ s7_37 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_37 con fallas'}`);
process.exit(allOk ? 0 : 1);
