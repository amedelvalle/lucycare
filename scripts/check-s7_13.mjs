/**
 * Verifica s7_13: la RPC `claim_doctor_profile` existe y rechaza
 * llamadas sin sesión válida (auth.uid() IS NULL).
 *
 * El comportamiento end-to-end (matchear phone + license, vincular
 * profile, marcar lucy_status='claimed' sin tocar published/booking/
 * operational) se confirma con un smoke-test manual desde
 * /medicos/<slug> usando un médico listed_only con datos conocidos.
 *
 * Uso: node scripts/check-s7_13.mjs
 */

import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';
import { supabaseAdmin as svc } from './_lib/supabase-admin.mjs';
const FAKE_UUID = '00000000-0000-0000-0000-000000000000';

console.log('═══ Verificando s7_13 (reclamo seguro de perfil) ═══\n');

// 1. RPC existe — invocando como anon debe responder un error específico
//    (no "function not found"). La función exige auth.uid() y phone verificado.
const { error: anonErr } = await anon.rpc('claim_doctor_profile', {
  p_doctor_id: FAKE_UUID,
  p_license_typed: 'X',
  p_tos_version: 'v1.0',
});

const missing = !!anonErr && (/could not find/i.test(anonErr.message) || /does not exist/i.test(anonErr.message));
const gatedNoSession = !!anonErr && (/iniciar sesión/i.test(anonErr.message) || /28000/.test(anonErr.code || ''));

if (missing) {
  console.log('  claim_doctor_profile   ❌ NO existe — corré migrations/s7_13_secure_claim_doctor_profile.sql');
  process.exit(1);
}

if (!gatedNoSession) {
  console.log(`  claim_doctor_profile   ⚠️  existe pero la respuesta sin sesión es inesperada: ${anonErr?.message ?? 'sin error'}`);
  process.exit(1);
}

console.log('  claim_doctor_profile   ✅ existe y rechaza sin sesión\n');

// 2. Sanity-check de datos: ¿hay al menos un doctor listed_only con phone + license?
const { data: candidates } = await svc
  .from('doctors')
  .select('id, license_number, profile_id, profiles:profile_id(phone)')
  .eq('lucy_status', 'listed_only')
  .not('license_number', 'is', null)
  .limit(3);

const usable = (candidates || []).filter(
  (d) => d.license_number && d.profiles && d.profiles.phone,
);

console.log(`  Sanity: ${usable.length}/3 doctores listed_only con phone + license disponibles para smoke-test manual.`);
if (usable[0]) {
  console.log(`  Ejemplo: doctor_id=${usable[0].id} license=${usable[0].license_number} phone=${usable[0].profiles.phone}`);
}

console.log('\n✅ s7_13 aplicado. Hacé el smoke manual desde /medicos/<slug> con un listed_only.');
process.exit(0);
