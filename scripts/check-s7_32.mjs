/**
 * Verifica s7_32: Paciente Global F2.1 — identidad global en `profiles`.
 *
 * Sanity anon (privacidad): anon puede leer id/full_name/avatar_url (directorio)
 * pero NO document_number ni date_of_birth (grant column-level no los incluye →
 * PostgREST rechaza). La validación funcional completa es el smoke OTP.
 *
 * Uso: node scripts/check-s7_32.mjs
 */
import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_32 (identidad global en profiles) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

// Baseline: anon SÍ puede pedir columnas del directorio
{
  const { error } = await anon.from('profiles').select('id, full_name, avatar_url').limit(1);
  if (error) fail('anon no pudo leer id/full_name/avatar_url (baseline roto): ' + error.message);
  else pass('anon lee id/full_name/avatar_url (directorio, esperado)');
}

// DUI: anon NO debe poder leerlo
{
  const { error } = await anon.from('profiles').select('document_number').limit(1);
  if (!error) fail('⚠ anon PUDO leer document_number (FUGA DE DUI)');
  else if (/permission denied|not.*grant|42501|column/i.test(error.message)) pass('anon NO puede leer document_number → ' + error.message);
  else fail('anon document_number error inesperado: ' + error.message);
}

// DOB: anon NO debe poder leerlo
{
  const { error } = await anon.from('profiles').select('date_of_birth').limit(1);
  if (!error) fail('⚠ anon PUDO leer date_of_birth (FUGA)');
  else if (/permission denied|not.*grant|42501|column/i.test(error.message)) pass('anon NO puede leer date_of_birth → ' + error.message);
  else fail('anon date_of_birth error inesperado: ' + error.message);
}

console.log('\n  ⏭️  Smoke OTP (sesión de paciente real) — ver node scripts/_smoke-s7_32.mjs:');
console.log('     - paciente actualiza document/DOB/género/depto-muni → OK (audita).');
console.log('     - paciente intenta cambiar role / is_active / phone → BLOQUEADO (grant column).');
console.log('     - documento duplicado en otro profile → rechazo UNIQUE.');
console.log('     - municipio fuera del departamento → P0004.\n');

console.log(`${allOk ? '✅ s7_32 sanity OK (validar empírico en smoke)' : '❌ s7_32 con fallas'}`);
process.exit(allOk ? 0 : 1);
