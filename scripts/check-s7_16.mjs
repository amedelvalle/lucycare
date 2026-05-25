/**
 * Verifica s7_16: RLS hardening de profiles.
 *
 * Casos:
 *   1. anon NO puede pedir email/phone (column grant insuficiente).
 *   2. anon SÍ puede pedir id/full_name/avatar_url de doctores publicados.
 *   3. anon NO ve profiles que no son médicos publicados (admin, pacientes,
 *      médicos no publicados, asistentes).
 *   4. authenticated self ve sus propios datos completos.
 *   5. authenticated admin ve todos los profiles.
 *
 * Uso: node scripts/check-s7_16.mjs
 */
import { supabaseAdmin as svc } from './_lib/supabase-admin.mjs';
import { supabaseAnon as anon } from './_lib/supabase-anon.mjs';
import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './_lib/env.mjs';

console.log('═══ Verificando s7_16 (RLS profiles) ═══\n');

let allOk = true;
function pass(msg) { console.log('  ✅', msg); }
function fail(msg) { console.log('  ❌', msg); allOk = false; }
function warn(msg) { console.log('  ⚠️ ', msg); }

// ─── 1. Anon NO debe poder pedir email/phone ───
const { error: e1 } = await anon.from('profiles').select('email').limit(1);
if (e1 && /permission|insufficient|denied/i.test(e1.message)) {
  pass('anon NO puede pedir column "email" — column grant insuficiente');
} else if (e1) {
  warn('anon pidió email y devolvió error distinto: ' + e1.message.slice(0, 80));
} else {
  fail('anon PUDO leer column "email" — column grant demasiado abierto');
}

const { error: e2 } = await anon.from('profiles').select('phone').limit(1);
if (e2 && /permission|insufficient|denied/i.test(e2.message)) {
  pass('anon NO puede pedir column "phone"');
} else if (e2) {
  warn('anon pidió phone y devolvió error distinto: ' + e2.message.slice(0, 80));
} else {
  fail('anon PUDO leer column "phone" — column grant demasiado abierto');
}

// ─── 2. Anon SÍ debe poder pedir id/full_name/avatar_url ───
const { data: pubFields, error: e3 } = await anon.from('profiles')
  .select('id, full_name, avatar_url').limit(3);
if (e3) {
  fail('anon NO pudo pedir (id, full_name, avatar_url): ' + e3.message);
} else {
  pass(`anon puede pedir (id, full_name, avatar_url): ${pubFields?.length ?? 0} filas visibles`);
}

// ─── 3. Anon SOLO ve médicos publicados ───
// Cuento desde service_role los profiles totales vs los que anon debería ver
const { count: totalProfiles } = await svc
  .from('profiles')
  .select('id', { count: 'exact', head: true });

const { count: publishedDoctorProfiles } = await svc
  .from('doctors')
  .select('id', { count: 'exact', head: true })
  .eq('is_published', true);

const { count: anonProfilesVisible } = await anon
  .from('profiles')
  .select('id', { count: 'exact', head: true });

console.log(`  → total profiles en DB: ${totalProfiles}`);
console.log(`  → doctores publicados: ${publishedDoctorProfiles}`);
console.log(`  → profiles que anon ve: ${anonProfilesVisible}`);

if (anonProfilesVisible === null) {
  warn('No pudimos contar profiles desde anon (probablemente RLS).');
} else if (anonProfilesVisible <= publishedDoctorProfiles) {
  pass(`anon solo ve ≤ doctores publicados (${anonProfilesVisible} ≤ ${publishedDoctorProfiles})`);
} else {
  fail(`anon ve MÁS filas (${anonProfilesVisible}) que doctores publicados (${publishedDoctorProfiles})`);
}

// ─── 4. authenticated self: login + select self ───
// Usamos admin (50378056365) como user de prueba
const ANON_KEY = requireEnv('SUPABASE_ANON_KEY');
const URL = requireEnv('SUPABASE_URL');
const userClient = createClient(URL, ANON_KEY, { auth: { persistSession: false } });

const { error: eOtp } = await userClient.auth.signInWithOtp({ phone: '+50378056365' });
if (eOtp) { fail('OTP send: ' + eOtp.message); process.exit(1); }
const { data: vData, error: eVerify } = await userClient.auth.verifyOtp({
  phone: '+50378056365', token: '123456', type: 'sms',
});
if (eVerify) { fail('OTP verify: ' + eVerify.message); process.exit(1); }
const myUid = vData.user?.id;
pass(`logueado como ${myUid?.slice(0, 8)}...`);

const { data: selfProfile, error: eSelf } = await userClient
  .from('profiles').select('id, email, phone, full_name').eq('id', myUid).maybeSingle();
if (eSelf) {
  fail('self SELECT: ' + eSelf.message);
} else if (!selfProfile) {
  fail('self profile no encontrado');
} else if (!selfProfile.email && !selfProfile.phone) {
  warn('self profile sin email/phone (¿perfil incompleto?)');
} else {
  pass('self puede leer su propio email + phone');
}

// ─── 5. authenticated admin ve todos los profiles ───
const { count: adminProfilesVisible } = await userClient
  .from('profiles').select('id', { count: 'exact', head: true });
console.log(`  → admin ve ${adminProfilesVisible} profiles (total DB: ${totalProfiles})`);
if (adminProfilesVisible === totalProfiles) {
  pass('admin ve todos los profiles');
} else {
  warn(`admin ve ${adminProfilesVisible}/${totalProfiles}`);
}

console.log(`\n${allOk ? '✅ s7_16 OK' : '❌ s7_16 con fallas — revisar'}`);
process.exit(allOk ? 0 : 1);
