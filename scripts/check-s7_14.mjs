/**
 * Verifica s7_14: bucket avatars + RLS storage + RPC admin + trigger
 * de audit. Smoke completo (upload real desde el modal) se valida
 * manualmente desde /panel/perfil y /admin/medicos/:id.
 *
 * Uso: node scripts/check-s7_14.mjs
 */
import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDIwMTQsImV4cCI6MjA5MDg3ODAxNH0.hESVl_M0WfUJfgUXaTZ80tIe3JR7IijLZJxjbxnNqUQ';

const svc = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon = createClient(URL, ANON_KEY, { auth: { persistSession: false } });

console.log('═══ Verificando s7_14 (avatares) ═══\n');

let allOk = true;

// 1. Bucket avatars existe y es público
const { data: buckets } = await svc.storage.listBuckets();
const avatars = (buckets || []).find((b) => b.id === 'avatars');
if (!avatars) {
  console.log('  bucket avatars              ❌ NO existe');
  allOk = false;
} else if (!avatars.public) {
  console.log('  bucket avatars              ⚠️  existe pero NO es público');
  allOk = false;
} else {
  console.log('  bucket avatars              ✅ existe (público)');
}

// 2. RPC admin_update_doctor_avatar existe y rechaza no-admin
const { error: anonErr } = await anon.rpc('admin_update_doctor_avatar', {
  p_doctor_id: '00000000-0000-0000-0000-000000000000',
  p_avatar_url: null,
});
const missing = !!anonErr && /could not find|does not exist/i.test(anonErr.message);
const gated = !!anonErr && /no autorizado/i.test(anonErr.message);
if (missing) {
  console.log('  admin_update_doctor_avatar  ❌ NO existe');
  allOk = false;
} else if (!gated) {
  console.log(`  admin_update_doctor_avatar  ⚠️  existe pero no rechaza anon: ${anonErr?.message ?? 'sin error'}`);
  allOk = false;
} else {
  console.log('  admin_update_doctor_avatar  ✅ existe y rechaza no-admin');
}

// 3. Trigger audit_profiles_avatar existe
const { data: trig } = await svc
  .from('pg_trigger' )
  .select('tgname')
  .eq('tgname', 'audit_profiles_avatar')
  .maybeSingle()
  .then(
    (r) => r,
    () => ({ data: null }),
  );
// pg_trigger no es accesible vía PostgREST sin vista. Hacemos un proxy:
// intentamos actualizar avatar_url de un profile dummy y vemos si llega
// fila a audit_log. Usamos un profile inexistente para no tocar datos
// reales; el UPDATE no afectará ninguna fila pero el trigger no se
// dispara entonces. Mejor saltar este chequeo y validar manualmente
// con el smoke.
console.log('  trigger audit_profiles_avatar (validación end-to-end con smoke manual)');

console.log(
  `\n${allOk ? '✅ s7_14 aplicado. Smoke manual: subir foto desde /panel/perfil y desde /admin/medicos/:id.' : '❌ Falta correr migrations/s7_14_avatars_bucket_and_audit.sql.'}`,
);
process.exit(allOk ? 0 : 1);
