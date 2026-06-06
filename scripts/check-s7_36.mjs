/**
 * Verifica s7_36: ciclo de vida de invitación (Mi equipo Fase 2).
 *
 * Sanity liviano con service_role:
 *  1. La columna `clinic_invitations.expires_at` existe.
 *  2. La RPC `resend_invitation` existe (con service_role auth.uid() es NULL →
 *     responde 'No autenticado'; si no existiera sería 'could not find function').
 *  3. `invitation_ttl()` responde (= 14 días).
 *
 * Verificación funcional real (default TTL, cupo vigente vs vencida, accept que
 * ignora vencidas, resend que revalida cupo y revive):
 *   node scripts/_smoke-s7_36.mjs
 *
 * Uso: node scripts/check-s7_36.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Verificando s7_36 (ciclo de vida de invitación) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

{
  const { error } = await admin.from('clinic_invitations').select('expires_at').limit(1);
  if (error) fail('columna expires_at no accesible: ' + error.message);
  else pass('clinic_invitations.expires_at existe');
}

{
  const { error } = await admin.rpc('resend_invitation', {
    p_invitation_id: '00000000-0000-0000-0000-000000000000',
  });
  if (!error) fail('resend_invitation respondió OK con service_role (esperábamos rechazo).');
  else if (/No autenticado/i.test(error.message)) pass('resend_invitation existe (rechaza sin sesión)');
  else if (/could not find function|does not exist|PGRST202/i.test(error.message) || error.code === '42883')
    fail('resend_invitation NO existe → ¿migración s7_36 aplicada? ' + error.message);
  else fail('resend_invitation error inesperado: ' + (error.code || '') + ' ' + error.message);
}

{
  const { data, error } = await admin.rpc('invitation_ttl');
  if (error) fail('invitation_ttl no responde: ' + error.message);
  else pass('invitation_ttl() = ' + JSON.stringify(data));
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_36.mjs\n');
console.log(`${allOk ? '✅ s7_36 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_36 con fallas'}`);
process.exit(allOk ? 0 : 1);
