/**
 * Verifica s7_59: la RPC `amend_consultation` sigue desplegada con la firma
 * vigente (8 args) y gateada tras el cambio de `alternatives`.
 *
 * Sanity liviano SIN tocar datos. La verificación REAL (alternativas
 * corregibles/borrables en `replace`, asignables en `add`, clave ausente
 * conserva, y NO regresión de F6) la hace `_smoke-s7_59.mjs` con FIXTURES
 * PROPIAS AISLADAS. Acá no se crea ni modifica nada.
 *
 * Uso: node scripts/check-s7_59.mjs
 */
import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_59 (amend_consultation · alternatives) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

// La función existe con la firma vigente y rechaza al caller sin médico.
// Si no existiera, PostgREST devuelve PGRST202.
{
  const { error } = await anon.rpc('amend_consultation', {
    p_consultation_id: '00000000-0000-0000-0000-000000000000',
    p_reason: 'check s7_59',
    p_consultation_changes: {},
    p_prescription_ops: [],
    p_reason_category: null,
    p_diagnosis_ops: [],
    p_family_history_ops: [],
    p_vitals_changes: {},
  });

  if (!error) fail('amend_consultation respondió SIN error a un caller anónimo (gate roto)');
  else if (error.code === 'PGRST202') fail('amend_consultation NO existe con la firma de 8 args → ¿s7_59 sin aplicar?');
  else if (error.code === '42501') pass('amend_consultation existe (firma 8 args) y rechaza al caller sin médico (42501)');
  else pass(`amend_consultation existe (firma 8 args); anon rechazado con ${error.code}`);
}

console.log(`\n${allOk ? '✅ check s7_59 OK' : '❌ check s7_59 con fallas'}`);
console.log('   (alternatives corregibles + no regresión de F6 → scripts/_smoke-s7_59.mjs)');
process.exit(allOk ? 0 : 1);
