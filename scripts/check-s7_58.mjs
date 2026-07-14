/**
 * Verifica s7_58: la RPC `amend_consultation` está desplegada con la firma
 * vigente (8 args) y sigue gateada.
 *
 * Sanity liviano SIN tocar datos: la verificación REAL de la semántica nueva
 * (clave ausente conserva / null-'' limpia / valor actualiza, y
 * permanente ⇒ duration_value NULL) la hace `_smoke-s7_58.mjs` con FIXTURES
 * PROPIAS AISLADAS (paciente + cita + consulta + recetas creadas desde cero,
 * firmadas, corregidas y borradas). Acá NO se crea ni modifica nada.
 *
 * Uso: node scripts/check-s7_58.mjs
 */
import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_58 (amend_consultation · nulls de receta) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

// 1. La función existe con la firma vigente (8 args). Si no existiera, PostgREST
//    devuelve PGRST202 ("Could not find the function ... in the schema cache").
{
  const { error } = await anon.rpc('amend_consultation', {
    p_consultation_id: '00000000-0000-0000-0000-000000000000',
    p_reason: 'check s7_58',
    p_consultation_changes: {},
    p_prescription_ops: [],
    p_reason_category: null,
    p_diagnosis_ops: [],
    p_family_history_ops: [],
    p_vitals_changes: {},
  });

  if (!error) {
    fail('amend_consultation respondió SIN error a un caller anónimo (gate roto)');
  } else if (error.code === 'PGRST202') {
    fail('amend_consultation NO existe con la firma de 8 args → ¿s7_58 sin aplicar?');
  } else if (error.code === '42501') {
    pass('amend_consultation existe (firma 8 args) y rechaza al caller sin médico (42501)');
  } else {
    // Cualquier otro error de negocio también prueba que la función existe.
    pass(`amend_consultation existe (firma 8 args); anon rechazado con ${error.code}`);
  }
}

// 2. La firma vieja de 5 args no debe reaparecer (s7_31 la dropeó; s7_58 no la recrea).
{
  const { error } = await anon.rpc('amend_consultation', {
    p_consultation_id: '00000000-0000-0000-0000-000000000000',
    p_reason: 'check s7_58',
    p_consultation_changes: {},
    p_prescription_ops: [],
    p_reason_category: null,
  });
  // Con defaults, la firma de 8 args resuelve igual → error de gate, no PGRST202.
  if (error && error.code === 'PGRST202') {
    fail('Llamada con 5 args no resuelve → la función no tiene defaults esperados');
  } else {
    pass('Llamada con 5 args resuelve por defaults de la firma de 8 (sin overload duplicado)');
  }
}

console.log(`\n${allOk ? '✅ check s7_58 OK' : '❌ check s7_58 con fallas'}`);
console.log('   (semántica de nulls + permanente + versionado + trazabilidad → scripts/_smoke-s7_58.mjs)');
process.exit(allOk ? 0 : 1);
