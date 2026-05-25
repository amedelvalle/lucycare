/**
 * Verifica s7_03: is_verified ahora es GENERATED ALWAYS desde
 * lucy_status='verified'; admin_set_doctor_verified fue eliminado.
 * Uso: node scripts/check-s7_03.mjs
 */

import { supabaseAdmin as a } from './_lib/supabase-admin.mjs';
console.log('═══ Verificando s7_03 (is_verified derivado de lucy_status) ═══\n');

// 1. RPC eliminada
const { error: rpcErr } = await a.rpc('admin_set_doctor_verified', {
  p_doctor_id: '00000000-0000-0000-0000-000000000000',
  p_value: true,
});
const rpcGone =
  !!rpcErr &&
  (/could not find/i.test(rpcErr.message) || /does not exist/i.test(rpcErr.message));
console.log(`1. admin_set_doctor_verified eliminada: ${rpcGone ? '✅ OK' : '❌ aún existe'}`);

// 2. Intento de UPDATE directo a is_verified debe fallar (columna generada)
const { data: anyDoc } = await a.from('doctors').select('id').limit(1).single();
let generatedOk = false;
if (anyDoc?.id) {
  const { error: updErr } = await a.from('doctors').update({ is_verified: true }).eq('id', anyDoc.id);
  generatedOk =
    !!updErr &&
    /generated|generada|cannot|can only be updated to DEFAULT/i.test(updErr.message);
  console.log(`2. UPDATE directo a is_verified rechazado: ${generatedOk ? '✅ OK (columna GENERATED)' : '❌ ' + (updErr?.message ?? 'permitió update')}`);
}

// 3. Consistencia actual: no debe haber filas con is_verified=true y lucy_status<>'verified'
const { data: inconsistent } = await a
  .from('doctors')
  .select('id, is_verified, lucy_status')
  .eq('is_verified', true)
  .neq('lucy_status', 'verified');
const consistent = (inconsistent?.length ?? 0) === 0;
console.log(`3. Sin estados contradictorios: ${consistent ? '✅ OK' : '❌ ' + inconsistent?.length + ' filas inconsistentes'}`);

const ok = rpcGone && generatedOk && consistent;
console.log(`\n${ok ? '✅ s7_03 aplicado.' : '❌ Falta correr migrations/s7_03_unify_verified_with_lucy_status.sql.'}`);
process.exit(ok ? 0 : 1);
