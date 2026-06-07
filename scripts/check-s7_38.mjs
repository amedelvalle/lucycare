/**
 * Verifica s7_38: catálogo global + personal.
 *
 * Sanity con service_role:
 *  1. doctor_id admite NULL en diagnoses y medications (se puede crear un global).
 *  2. doctor_catalog_hidden existe.
 *
 * Verificación funcional (RLS global∪propios, ocultos, escritura propios,
 * no-doctor no escribe, auditoría): node scripts/_smoke-s7_38.mjs
 *
 * Uso: node scripts/check-s7_38.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_38 (catálogo global + personal) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

{
  const { data, error } = await admin.from('diagnoses')
    .insert({ name: '__check_global_dx__', is_active: true, usage_count: 0 })
    .select('id, doctor_id').single();
  if (error) fail('no se pudo crear diagnóstico global (doctor_id NULL): ' + error.message);
  else { pass('diagnoses.doctor_id admite NULL (global) — doctor_id=' + data.doctor_id);
    await admin.from('diagnoses').delete().eq('id', data.id); }
}
{
  const { data, error } = await admin.from('medications')
    .insert({ commercial_name: '__check_global_med__', is_active: true, usage_count: 0 })
    .select('id, doctor_id').single();
  if (error) fail('no se pudo crear medicamento global (doctor_id NULL): ' + error.message);
  else { pass('medications.doctor_id admite NULL (global)');
    await admin.from('medications').delete().eq('id', data.id); }
}
{
  const { error } = await admin.from('doctor_catalog_hidden').select('id').limit(1);
  if (error) fail('doctor_catalog_hidden no accesible: ' + error.message);
  else pass('doctor_catalog_hidden existe');
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_38.mjs\n');
console.log(`${allOk ? '✅ s7_38 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_38 con fallas'}`);
process.exit(allOk ? 0 : 1);
