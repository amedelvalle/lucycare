/**
 * Verifica s7_34: sync de cambio de teléfono (trigger en auth.users).
 *
 * No hay RPC ni columna nueva consultable por anon para sanity directo (es un
 * trigger sobre auth.users). La verificación real es el smoke automatizado
 * (node scripts/_smoke-s7_34.mjs), que simula el cambio con service_role.
 *
 * Acá solo confirmamos conectividad mínima (audit_log accesible con
 * service_role) y dejamos el pointer al smoke.
 *
 * Uso: node scripts/check-s7_34.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_34 (sync cambio de teléfono) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

{
  const { error } = await admin.from('audit_log').select('id').limit(1);
  if (error) fail('audit_log no accesible: ' + error.message);
  else pass('audit_log accesible (service_role)');
}

console.log('\n  ⏭️  Verificación real: node scripts/_smoke-s7_34.mjs (automatizado, sin OTP):');
console.log('     - admin.updateUserById cambia auth.users.phone → dispara el trigger.');
console.log('     - profiles.phone y patients.phone vinculadas quedan en el nuevo número.');
console.log('     - audit_log registra edited_via=phone_change (old/new).');
console.log('     El end-to-end OTP (updateUser→verifyOtp) se valida en la UI (F-C/F-D).\n');

console.log(`${allOk ? '✅ s7_34 sanity OK (correr smoke para la verificación real)' : '❌ s7_34 con fallas'}`);
process.exit(allOk ? 0 : 1);
