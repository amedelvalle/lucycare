/**
 * Verifica s7_44: administración de LucyAdmins (Fase 1).
 *
 * Sanity liviano (sin sesión de usuario):
 *  1. Tabla `platform_admin_invitations` existe y anon NO la lee (RLS).
 *  2. Las 4 RPCs existen y exigen sesión/admin:
 *     - admin_invite_platform_admin / admin_revoke_platform_admin /
 *       admin_list_platform_admins → con service_role (auth.uid() NULL)
 *       rechazan con 'No autorizado' (42501).
 *     - accept_platform_admin_invitation → exige sesión (28000).
 *
 * Verificación funcional real: node scripts/_smoke-s7_44.mjs
 * (invitar/bloqueos/TTL/activación por OTP/revocación/guard último admin).
 *
 * Uso: node scripts/check-s7_44.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_44 (administración de LucyAdmins) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

const NOT_FOUND = (e) =>
  /could not find function|does not exist|PGRST202/i.test(e?.message || '') || e?.code === '42883';
const DENIED = (e) => /No autorizado/i.test(e?.message || '') || e?.code === '42501';
const NO_AUTH = (e) => /iniciar sesión/i.test(e?.message || '') || e?.code === '28000';

// 1. Tabla + RLS anon
{
  const { error } = await admin.from('platform_admin_invitations').select('id').limit(1);
  if (error) fail('Tabla platform_admin_invitations NO existe: ' + error.message);
  else pass('Tabla platform_admin_invitations existe');

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: anonData, error: anonErr } = await anon.from('platform_admin_invitations').select('id').limit(1);
  if (anonErr || (anonData ?? []).length === 0) pass('anon no lee platform_admin_invitations (RLS)');
  else fail('anon PUDO leer platform_admin_invitations: ' + JSON.stringify(anonData));
}

// 2. RPCs con gates
const BOGUS = '00000000-0000-0000-0000-000000000000';
for (const [fn, args, expect] of [
  ['admin_invite_platform_admin', { p_phone: '50370000000', p_display_name: 'X Y' }, DENIED],
  ['admin_revoke_platform_admin', { p_profile_id: BOGUS }, DENIED],
  ['admin_list_platform_admins', undefined, DENIED],
  ['accept_platform_admin_invitation', undefined, NO_AUTH],
]) {
  const { error } = args ? await admin.rpc(fn, args) : await admin.rpc(fn);
  if (!error) fail(`${fn} respondió OK sin sesión (esperábamos rechazo).`);
  else if (expect(error)) pass(`${fn} existe y rechaza sin sesión/admin (${error.code || ''})`);
  else if (NOT_FOUND(error)) fail(`${fn} NO existe → ¿migración s7_44 aplicada? ${error.message}`);
  else fail(`${fn} error inesperado: ${error.code || ''} ${error.message}`);
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_44.mjs');
console.log('     (bloqueos P0050/P0051/P0053/P0055 · TTL/re-invitar · activación por OTP ·');
console.log('      revocación con bloqueo inmediato · guard último admin P0052 · cleanup).\n');

console.log(`${allOk ? '✅ s7_44 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_44 con fallas'}`);
process.exit(allOk ? 0 : 1);
