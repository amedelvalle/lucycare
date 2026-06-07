/**
 * Verifica s7_40: RPC F5 tolerante a teléfono crudo + helper normalize_phone_sv.
 *
 * Sanity liviano (sin sesión de usuario):
 *  1. La RPC find_patient_match_candidates SIGUE existiendo y rechaza a
 *     no-miembros (P0001) — prueba que la migración se aplicó y el gate quedó
 *     intacto. (Con service_role auth.uid() es NULL → ni admin ni miembro.)
 *  2. normalize_phone_sv NO está expuesta como RPC pública: llamarla vía
 *     PostgREST debe fallar con "could not find function" (PGRST202 / 42883)
 *     porque se le hizo REVOKE de PUBLIC/anon/authenticated. Es uso interno de
 *     la RPC definer. (Si fuera callable, lo marcamos como warn — exponer una
 *     función pura no es crítico, pero no es lo deseado.)
 *
 * La verificación FUNCIONAL de la canonicalización (71234567, +503…, intra,
 * cross weak, no PII, no-regresión) vive en el smoke con sesión real:
 *   node scripts/_smoke-s7_40.mjs
 *
 * Uso: node scripts/check-s7_40.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_40 (RPC F5 tolerante a teléfono crudo) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };
const warn = (m) => console.log('  ⚠ ', m);

const NOT_FOUND = (e) =>
  /could not find function|does not exist|PGRST202/i.test(e?.message || '') || e?.code === '42883';

// 1. RPC existe + gate de autorización intacto.
{
  const { error } = await admin.rpc('find_patient_match_candidates', {
    p_clinic_id: '00000000-0000-0000-0000-000000000000',
    p_phone: '50370000000',
  });
  if (!error) {
    fail('La RPC respondió OK con service_role (esperábamos rechazo de autorización).');
  } else if (/No autorizado/i.test(error.message) || error.code === 'P0001') {
    pass(`RPC existe y rechaza a no-miembros (${error.code || ''} ${error.message.slice(0, 50)})`);
  } else if (NOT_FOUND(error)) {
    fail('La RPC NO existe → ¿migración s7_40 aplicada? ' + error.message);
  } else {
    fail('Error inesperado en la RPC: ' + (error.code || '') + ' ' + error.message);
  }
}

// 2. normalize_phone_sv NO expuesta como RPC pública.
{
  const { data, error } = await admin.rpc('normalize_phone_sv', { p_phone: '77003001' });
  if (error && NOT_FOUND(error)) {
    pass('normalize_phone_sv no está expuesta como RPC pública (uso interno) ✓');
  } else if (error) {
    // Otro error (p.ej. permiso) — igual no es callable como RPC pública.
    pass(`normalize_phone_sv no es callable públicamente (${error.code || ''} ${error.message.slice(0, 40)})`);
  } else {
    warn(`normalize_phone_sv ES callable vía RPC (devolvió "${data}"). No es crítico (función pura), pero se esperaba REVOKE. Revisar grants.`);
  }
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_40.mjs');
console.log('     (71234567 / 50371234567 / +50371234567 / +503 7123-4567 → intra match ·');
console.log('      cross weak por teléfono crudo · no PII cross · no-regresión s7_35).\n');

console.log(`${allOk ? '✅ s7_40 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_40 con fallas'}`);
process.exit(allOk ? 0 : 1);
