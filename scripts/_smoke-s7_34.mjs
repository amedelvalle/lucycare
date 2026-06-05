/**
 * SMOKE s7_34 (Cambio de teléfono — F-B) — automatizado, sin OTP.
 *
 * Simula el cambio de teléfono con service_role: admin.updateUserById cambia
 * auth.users.phone → dispara el trigger sync_phone_to_identity → verifica que
 * profiles.phone, patients.phone (vinculada) y audit_log quedan sincronizados.
 * Fixtures throwaway + cleanup en finally.
 *
 * (El end-to-end OTP real — updateUser({phone}) → verifyOtp(type:'phone_change')
 * — es el flujo de UI; acá probamos el sync server-side que es lo de s7_34.)
 *
 * Uso: node scripts/_smoke-s7_34.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

const CAMILO_CLINIC = '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0';
const rnd = () => '5039' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const OLD = rnd();
let NEW = rnd();
while (NEW === OLD) NEW = rnd();

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };
let uId = null, plId = null;

console.log('═══ SMOKE s7_34 (sync cambio de teléfono) ═══\n');
console.log(`  (old=${OLD} → new=${NEW})\n`);

try {
  // Usuario throwaway con phone OLD + ficha vinculada con phone OLD
  const { data: u, error: cuErr } = await admin.auth.admin.createUser({ phone: OLD, phone_confirm: true });
  if (cuErr || !u?.user) throw new Error('createUser falló: ' + cuErr?.message);
  uId = u.user.id;
  await admin.from('profiles').update({ full_name: 'Phone Test', role: 'patient', phone: OLD }).eq('id', uId);

  const { data: pl, error: plErr } = await admin.from('patients').insert({
    clinic_id: CAMILO_CLINIC, profile_id: uId, full_name: 'Phone Test',
    document_type: 'dui', date_of_birth: '1990-01-01', gender: 'otro',
    patient_type: 'privado', phone: OLD, is_active: true,
  }).select('id').single();
  if (plErr) throw new Error('insert PL falló: ' + plErr.message);
  plId = pl.id;
  ok('Fixtures: usuario throwaway (phone OLD) + ficha vinculada (phone OLD)');

  // Cambiar el teléfono → dispara el trigger
  const { error: upErr } = await admin.auth.admin.updateUserById(uId, { phone: NEW });
  if (upErr) throw new Error('updateUserById(phone) falló: ' + upErr.message);

  // Verificaciones
  const { data: prof } = await admin.from('profiles').select('phone').eq('id', uId).single();
  if (prof.phone === NEW) ok('profiles.phone sincronizado al nuevo número');
  else ko(`profiles.phone NO sincronizado (=${prof.phone})`);

  const { data: pat } = await admin.from('patients').select('phone').eq('id', plId).single();
  if (pat.phone === NEW) ok('patients.phone (ficha vinculada) sincronizado al nuevo número');
  else ko(`patients.phone NO sincronizado (=${pat.phone})`);

  const { data: au } = await admin.from('audit_log')
    .select('old_data, new_data, user_id')
    .eq('record_id', uId).order('created_at', { ascending: false }).limit(3);
  const entry = (au ?? []).find((a) => a.new_data?.edited_via === 'phone_change');
  if (entry && entry.new_data.phone === NEW && entry.old_data.phone === OLD && entry.user_id === uId)
    ok('audit_log registró edited_via=phone_change (old→new, user_id=NEW.id)');
  else ko('audit_log de phone_change ausente/incorrecto: ' + JSON.stringify(entry ?? null));
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup —');
  if (plId) await admin.from('patients').delete().eq('id', plId);
  if (uId) await admin.auth.admin.deleteUser(uId).catch(() => {});
  console.log('  ✅ cleanup OK');
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_34 OK' : '❌ SMOKE s7_34 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
