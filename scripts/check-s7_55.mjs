/**
 * Verifica s7_55: bloqueo atómico de doble reserva (trigger anti-solapamiento).
 *
 * Sanity liviano SIN tocar datos reales (el owner pidió no tocar producción):
 * confirma que appointment_statuses expone `is_final` y que existen estados
 * final y no-final (base de la regla), y que appointments es accesible. La
 * verificación REAL del trigger (existencia + asociación a appointments + lógica
 * de solapamiento + advisory lock) la hace el smoke con FIXTURES AISLADAS
 * (inserta una cita y una solapada → P0090). Aquí NO se inserta ninguna cita
 * para no arriesgar datos de producción.
 *
 * Uso: node scripts/check-s7_55.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_55 (anti-solapamiento de citas) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

// 1. appointment_statuses accesible + is_final presente + hay final y no-final.
{
  const { data, error } = await admin.from('appointment_statuses').select('name,is_final');
  if (error) fail('appointment_statuses no accesible: ' + error.message);
  else {
    const nonFinal = (data ?? []).filter((s) => s.is_final === false).map((s) => s.name);
    const finals = (data ?? []).filter((s) => s.is_final === true).map((s) => s.name);
    if (nonFinal.length > 0 && finals.length > 0) {
      pass(`is_final presente · no-final=[${nonFinal.join(', ')}] · final=[${finals.join(', ')}]`);
    } else {
      fail('Falta al menos un estado final y uno no-final para la regla.');
    }
  }
}

// 2. appointments accesible (solo lectura, sin insertar).
{
  const { error } = await admin.from('appointments').select('id').limit(1);
  if (error) fail('appointments no accesible: ' + error.message);
  else pass('appointments accesible (solo lectura, sin insertar)');
}

console.log('\n  ⏭️  Verificación funcional (trigger existe/asociado + solapamiento + lock):');
console.log('     node scripts/_smoke-s7_55.mjs  (fixtures aisladas, 0 datos reales, cleanup).');
console.log('     El smoke prueba que una cita solapada es rechazada con P0090.\n');

console.log(`${allOk ? '✅ s7_55 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_55 con fallas'}`);
process.exit(allOk ? 0 : 1);
