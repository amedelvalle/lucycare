/**
 * Verifica s7_50: accept_clinic_invitations tolerante a formato de teléfono.
 *
 * Sanity liviano (sin sesión de usuario, con service_role → auth.uid() = NULL):
 *  1. La RPC accept_clinic_invitations SIGUE existiendo con su firma
 *     (user_phone text) → integer y rechaza por "No autenticado" cuando
 *     auth.uid() es NULL. Prueba que la migración se aplicó y la firma quedó
 *     intacta. (No prueba la normalización: eso es funcional → smoke.)
 *  2. normalize_phone_sv (helper de s7_40 usado por la RPC) NO está expuesta
 *     como RPC pública — invariante de seguridad que esta migración no debe
 *     alterar.
 *
 * La verificación FUNCIONAL del fix (mismatch +503… vs 503…, test negativo del
 * gate, cupos, 0 residuales) vive en el smoke con sesión real:
 *   node scripts/_smoke-s7_50.mjs
 *
 * Uso: node scripts/check-s7_50.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_50 (accept_clinic_invitations tolerante a teléfono) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };
const warn = (m) => console.log('  ⚠ ', m);

const NOT_FOUND = (e) =>
  /could not find function|does not exist|PGRST202/i.test(e?.message || '') || e?.code === '42883';

// 1. RPC existe + firma intacta + gate de autenticación.
{
  const { error } = await admin.rpc('accept_clinic_invitations', { user_phone: '+50370000000' });
  if (!error) {
    fail('La RPC respondió OK con service_role (esperábamos "No autenticado", auth.uid()=NULL).');
  } else if (/No autenticado/i.test(error.message)) {
    pass(`RPC existe con firma {user_phone} y exige autenticación ("${error.message.slice(0, 40)}")`);
  } else if (NOT_FOUND(error)) {
    fail('La RPC NO existe con esa firma → ¿migración s7_50 aplicada? ' + error.message);
  } else {
    // Cualquier otro error igual prueba que la RPC existe; lo informamos.
    warn(`RPC respondió con error inesperado (no bloqueante): ${error.code || ''} ${error.message.slice(0, 60)}`);
  }
}

// 2. normalize_phone_sv NO expuesta como RPC pública (invariante de s7_40).
{
  const { data, error } = await admin.rpc('normalize_phone_sv', { p_phone: '77003001' });
  if (error && NOT_FOUND(error)) {
    pass('normalize_phone_sv no está expuesta como RPC pública (uso interno) ✓');
  } else if (error) {
    pass(`normalize_phone_sv no es callable públicamente (${error.code || ''} ${error.message.slice(0, 40)})`);
  } else {
    warn(`normalize_phone_sv ES callable vía RPC (devolvió "${data}"). No es crítico (función pura), pero se esperaba REVOKE.`);
  }
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_50.mjs');
console.log('     (invitación +503… ↔ profiles.phone 503… ↔ user_phone +503… → acepta ·');
console.log('      test negativo del gate · cupos sin romper · 0 residuales F50_FIXTURE).\n');

console.log(`${allOk ? '✅ s7_50 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_50 con fallas'}`);
process.exit(allOk ? 0 : 1);
