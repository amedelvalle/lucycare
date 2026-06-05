/**
 * Verifica s7_35: RPC find_patient_match_candidates (Paciente Global Fase 5).
 *
 * Sanity liviano: la RPC es authenticated-scoped (exige is_clinic_member o
 * is_admin sobre p_clinic_id). Con service_role auth.uid() es NULL → ni admin
 * ni miembro → debe rechazar con el error de autorización (P0001). Eso prueba
 * dos cosas a la vez: la función EXISTE (está aplicada) y el gate funciona.
 *
 * Si la función no estuviera aplicada, el error sería "could not find function"
 * (PGRST202 / 42883) en vez del mensaje de autorización.
 *
 * Verificación funcional real (intra/cross/weak/strong/none + privacidad):
 *   node scripts/_smoke-s7_35.mjs  (corre con sesión de Camilo, fixtures + cleanup)
 *
 * Uso: node scripts/check-s7_35.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_35 (find_patient_match_candidates) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

{
  const { error } = await admin.rpc('find_patient_match_candidates', {
    p_clinic_id: '00000000-0000-0000-0000-000000000000',
    p_phone: '50370000000',
  });
  if (!error) {
    fail('La RPC respondió OK con service_role (esperábamos rechazo de autorización).');
  } else if (/No autorizado/i.test(error.message) || error.code === 'P0001') {
    pass(`RPC existe y rechaza a no-miembros (${error.code || ''} ${error.message.slice(0, 50)})`);
  } else if (/could not find function|does not exist|PGRST202/i.test(error.message) || error.code === '42883') {
    fail('La RPC NO existe → ¿migración s7_35 aplicada? ' + error.message);
  } else {
    // Otro error (p. ej. permiso) — no es el esperado pero la función responde.
    fail('Error inesperado: ' + (error.code || '') + ' ' + error.message);
  }
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_35.mjs');
console.log('     (intra con detalle · cross strong por documento · cross weak por teléfono ·');
console.log('      none · autorización de no-miembro · privacidad: cross sin PII).\n');

console.log(`${allOk ? '✅ s7_35 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_35 con fallas'}`);
process.exit(allOk ? 0 : 1);
