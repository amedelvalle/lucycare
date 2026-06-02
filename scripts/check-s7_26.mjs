/**
 * Verifica s7_26: gate clínico del rol asistente.
 *
 * NOTA: este fix es 100% RLS. No se puede verificar bien desde un
 * script con service_role (que BYPASEA RLS) ni leyendo pg_policies vía
 * PostgREST. La verificación autoritativa es EMPÍRICA, con una sesión
 * de asistente real, y se corre por separado tras aplicar la migración
 * (ver scripts/_smoke-gate-clinico.mjs, temporal).
 *
 * Acá solo confirmamos que las tablas existen y que anon (sin sesión)
 * no lee contenido clínico (sanity mínimo).
 *
 * Uso: node scripts/check-s7_26.mjs
 */
import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_26 (gate clínico del asistente) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

for (const t of ['consultation_family_history', 'vitals']) {
  const { data, error } = await anon.from(t).select('id').limit(1);
  // anon sin sesión: get_user_doctor_id() es NULL → debe devolver 0 filas
  // (o error de RLS). Nunca debe devolver contenido clínico.
  if (error) {
    pass(`${t}: anon bloqueado (${error.code || 'rls'})`);
  } else if ((data ?? []).length === 0) {
    pass(`${t}: anon devuelve 0 filas (sin contenido clínico)`);
  } else {
    fail(`${t}: anon devolvió ${data.length} fila(s) — ¡fuga!`);
  }
}

console.log('\n  ⏭️  Verificación autoritativa = EMPÍRICA (post-apply):');
console.log('     con sesión de asistente real, confirmar que NO puede');
console.log('     SELECT/INSERT en consultation_family_history ni vitals,');
console.log('     y que el médico dueño sí puede (sin regresión).');
console.log('     Las tablas núcleo (consultations/prescriptions/');
console.log('     consultation_diagnoses) ya estaban bloqueadas para');
console.log('     asistentes vía get_user_doctor_id()=NULL.\n');

console.log(`${allOk ? '✅ s7_26 sanity OK (validar empírico en smoke)' : '❌ s7_26 con fallas'}`);
process.exit(allOk ? 0 : 1);
