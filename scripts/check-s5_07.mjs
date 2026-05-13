import { createClient } from '@supabase/supabase-js';

const URL = 'https://kvrsfmzlrmmmavillpuj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2cnNmbXpscm1tbWF2aWxscHVqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjAxNCwiZXhwIjoyMDkwODc4MDE0fQ.ZdxQdkEuB_nIztj-JLSit-esJ_E76cQ_qgiV-uittsc';

const admin = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

console.log('═══ Verificando s5_07 (clinic_invitations) ═══\n');

// 1. Tabla clinic_invitations
const { error: tableErr } = await admin.from('clinic_invitations').select('id').limit(1);
const tableOk = !tableErr || !tableErr.message?.includes('Could not find');
console.log(`1. Tabla clinic_invitations:    ${tableOk ? '✅ existe' : '❌ NO existe'}`);
if (!tableOk) console.log(`   ↳ ${tableErr?.message}`);

// 2. RPC accept_clinic_invitations
const { error: rpcErr } = await admin.rpc('accept_clinic_invitations', { user_phone: '+50300000000' });
const rpcOk = !rpcErr || !rpcErr.message?.includes('Could not find') && !rpcErr.message?.includes('function');
// La RPC va a fallar con "El teléfono no coincide" porque el service_role no tiene auth.uid,
// pero eso confirma que la función existe.
const rpcExists = !rpcErr?.message?.includes('Could not find') && !rpcErr?.message?.includes('does not exist');
console.log(`2. RPC accept_clinic_invitations: ${rpcExists ? '✅ existe' : '❌ NO existe'}`);
if (!rpcExists) console.log(`   ↳ ${rpcErr?.message}`);

// 3. Estado actual de invitaciones
if (tableOk) {
  const { count: pendingCount } = await admin
    .from('clinic_invitations')
    .select('id', { count: 'exact', head: true })
    .is('accepted_at', null)
    .is('cancelled_at', null);
  const { count: totalCount } = await admin
    .from('clinic_invitations')
    .select('id', { count: 'exact', head: true });
  console.log(`\n3. Invitaciones registradas:    ${totalCount ?? 0} total · ${pendingCount ?? 0} pendientes`);
}

console.log('\n' + (tableOk && rpcExists ? '✅ s5_07 aplicado completamente. Podés probar S5-06.' : '❌ Falta correr s5_07. Pegá el SQL en Supabase Dashboard.'));
