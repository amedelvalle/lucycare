/**
 * Setup de doctor de prueba para Fase 4 PR-B (password en flujo de
 * Reclamar perfil).
 *
 * Crea un médico ficticio en estado `listed_only` con phone + license
 * conocidos, NO publicado, NO operativo, NO con booking, NO verified.
 *
 * Sirve EXCLUSIVAMENTE para validar el flujo del modal de Reclamar
 * perfil + nuevo step "Crear contraseña" sin tocar datos reales.
 *
 * Datos del seed:
 *   - Phone   : +50375000099  (canónico: 50375000099)
 *   - OTP     : 123456 (Test Phone, hay que configurarlo en Supabase)
 *   - Email   : test-prb@lucycare.test
 *   - License : TEST-PRB-001
 *   - Full name: [Test PRB] Doctor Prueba
 *   - lucy_status: listed_only
 *   - is_published: false
 *   - is_operational: false
 *   - booking_enabled: false
 *   - user_metadata.test_doctor_prb = true (marker para cleanup)
 *
 * Marker para cleanup: `auth.users.user_metadata.test_doctor_prb=true`
 * + email `test-prb@lucycare.test`. Ambos coinciden y se borran juntos.
 *
 * Uso:
 *   node scripts/setup-test-doctor-prb.mjs              # dry-run (info)
 *   node scripts/setup-test-doctor-prb.mjs --apply      # crear seed
 *                                                      # (is_published=false
 *                                                      # por default)
 *   node scripts/setup-test-doctor-prb.mjs --publish    # flip
 *                                                      # is_published=true
 *                                                      # SOLO durante
 *                                                      # el smoke
 *   node scripts/setup-test-doctor-prb.mjs --unpublish  # flip
 *                                                      # is_published=false
 *                                                      # (revertir al
 *                                                      # estado oculto)
 *   node scripts/setup-test-doctor-prb.mjs --reset      # revertir claim
 *                                                      # (lucy_status =
 *                                                      # listed_only,
 *                                                      # tos_accepted_at
 *                                                      # = NULL,
 *                                                      # password = nuevo
 *                                                      # random; útil
 *                                                      # para repetir
 *                                                      # smoke del modal)
 *   node scripts/setup-test-doctor-prb.mjs --clean      # eliminar todo
 *                                                      # (auth.user,
 *                                                      # profile, doctor,
 *                                                      # clinic, members)
 *
 * Flujo operativo recomendado:
 *   --apply       (una vez)
 *   --publish     (antes del smoke; el seed se vuelve visible en /doctor/{id})
 *   …smoke…
 *   --unpublish   (al terminar — vuelve a estado oculto)
 *   --clean       (cuando termines definitivamente con QA del PR-B)
 *
 * Pre-requisito operativo (manual, una sola vez):
 *   Agregar el phone +50375000099 con OTP 123456 en
 *   Supabase Dashboard → Authentication → Phone → Test Phone Numbers.
 *   Sin eso, el OTP no llega aunque el seed exista.
 *
 * Reglas:
 *   - NO afecta a Camilo ni a ningún médico real.
 *   - NO publica en directorio (is_published=false).
 *   - NO se debe dejar para piloto: correr --clean al terminar el smoke.
 */
import { supabaseAdmin as svc } from './_lib/supabase-admin.mjs';

const TEST_PHONE = '50375000099'; // canónico (sin +)
const TEST_PHONE_E164 = `+${TEST_PHONE}`;
const TEST_EMAIL = 'test-prb@lucycare.test';
const TEST_LICENSE = 'TEST-PRB-001';
const TEST_FULL_NAME = '[Test PRB] Doctor Prueba';
const TEST_CLINIC_NAME = '[Test PRB] Clínica de prueba';
const META_MARKER = { test_doctor_prb: true };

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const RESET = args.has('--reset');
const CLEAN = args.has('--clean');
const PUBLISH = args.has('--publish');
const UNPUBLISH = args.has('--unpublish');

console.log('═══ Setup Test Doctor para Fase 4 PR-B ═══\n');

async function findExistingUser() {
  // Busca por email primero, después por phone como fallback.
  const { data: byEmail } = await svc
    .from('profiles')
    .select('id, email, phone, role, full_name')
    .eq('email', TEST_EMAIL)
    .maybeSingle();
  if (byEmail) return byEmail;
  const { data: byPhone } = await svc
    .from('profiles')
    .select('id, email, phone, role, full_name')
    .eq('phone', TEST_PHONE)
    .maybeSingle();
  return byPhone ?? null;
}

async function findDoctorFor(profileId) {
  const { data } = await svc
    .from('doctors')
    .select('id, profile_id, clinic_id, lucy_status, is_published, license_number, tos_accepted_at')
    .eq('profile_id', profileId)
    .maybeSingle();
  return data;
}

async function pickSpecialty() {
  const { data } = await svc.from('specialties').select('id, name').limit(1);
  if (!data || data.length === 0) {
    throw new Error('No hay specialties en DB — cargar al menos una antes del seed.');
  }
  return data[0];
}

// ─── MODE: --publish / --unpublish ───
if (PUBLISH || UNPUBLISH) {
  const targetValue = PUBLISH;
  const mode = PUBLISH ? '--publish' : '--unpublish';
  console.log(`Modo ${mode}: ${targetValue ? 'mostrando' : 'ocultando'} seed en directorio…`);
  const profile = await findExistingUser();
  if (!profile) {
    console.error('  No hay seed. Corré --apply primero.');
    process.exit(1);
  }
  const doctor = await findDoctorFor(profile.id);
  if (!doctor) {
    console.error('  No hay doctor vinculado al seed. Inconsistencia — corré --clean y --apply.');
    process.exit(1);
  }
  if (doctor.is_published === targetValue) {
    console.log(`  El seed ya está con is_published=${targetValue}. Nada que hacer.`);
    process.exit(0);
  }
  const { error: dErr } = await svc
    .from('doctors')
    .update({ is_published: targetValue, updated_at: new Date().toISOString() })
    .eq('id', doctor.id);
  if (dErr) {
    console.error(`  Error: ${dErr.message}`);
    process.exit(1);
  }
  console.log(`  ✅ doctor (id=${doctor.id.slice(0, 8)}…) is_published=${targetValue}`);
  if (PUBLISH) {
    console.log('\n  ⚠ El seed ahora APARECE en el directorio público con prefix "[Test PRB]".');
    console.log('  ⚠ Acordate de correr --unpublish (o --clean) cuando termines el smoke.');
  }
  process.exit(0);
}

// ─── MODE: --clean ───
if (CLEAN) {
  console.log('Modo --clean: eliminando seed de prueba…');
  const profile = await findExistingUser();
  if (!profile) {
    console.log('  No hay seed para borrar. ✅');
    process.exit(0);
  }
  const userId = profile.id;
  const doctor = await findDoctorFor(userId);
  // Borrar dependencias en orden: clinic_members, doctor, clinic, profile, auth.user.
  if (doctor) {
    await svc.from('clinic_members').delete().eq('user_id', userId);
    await svc.from('doctors').delete().eq('id', doctor.id);
    if (doctor.clinic_id) {
      await svc.from('clinics').delete().eq('id', doctor.clinic_id);
    }
  }
  await svc.from('profiles').delete().eq('id', userId);
  const { error: authErr } = await svc.auth.admin.deleteUser(userId);
  if (authErr) {
    console.warn('  ⚠ auth.admin.deleteUser:', authErr.message);
  }
  console.log(`  ✅ Eliminado seed completo (profile ${userId.slice(0, 8)}…).`);
  process.exit(0);
}

// ─── MODE: --reset ───
if (RESET) {
  console.log('Modo --reset: revirtiendo claim + password para repetir smoke…');
  const profile = await findExistingUser();
  if (!profile) {
    console.error('  No hay seed. Corré --apply primero.');
    process.exit(1);
  }
  const userId = profile.id;
  const doctor = await findDoctorFor(userId);
  if (!doctor) {
    console.error('  No hay doctor vinculado al seed. Inconsistencia — corré --clean y --apply de nuevo.');
    process.exit(1);
  }
  // Revertir el claim
  const { error: dErr } = await svc
    .from('doctors')
    .update({
      lucy_status: 'listed_only',
      tos_accepted_at: null,
      tos_version: null,
    })
    .eq('id', doctor.id);
  if (dErr) {
    console.error('  Error revirtiendo doctor:', dErr.message);
    process.exit(1);
  }
  // Borrar clinic_members del owner (PR-B no los modifica, pero si el
  // claim del flow corre, se crean — para repetir el smoke desde cero
  // los quitamos).
  await svc.from('clinic_members').delete().eq('user_id', userId);

  // Resetear password a uno random conocido (no podemos "borrar" el
  // password con Admin API; lo mejor es ponerlo random así --apply de
  // nuevo no tiene credenciales viejas).
  const random = `Reset-${Math.random().toString(36).slice(2, 10)}!Aa1`;
  const { error: pErr } = await svc.auth.admin.updateUserById(userId, { password: random });
  if (pErr) {
    console.warn('  ⚠ no se pudo resetear password (no crítico):', pErr.message);
  }

  console.log('  ✅ Reset listo. El seed volvió a lucy_status=listed_only sin TOS aceptado.');
  console.log('     Phone y email siguen siendo los mismos. Repetí el smoke desde el directorio.');
  process.exit(0);
}

// ─── MODE: default / --apply ───
const existing = await findExistingUser();
if (existing) {
  console.log(`Ya hay seed: profile ${existing.id.slice(0, 8)}… (${existing.email ?? 'sin email'}, role=${existing.role})`);
  const doctor = await findDoctorFor(existing.id);
  if (doctor) {
    console.log(`  doctor: id=${doctor.id.slice(0, 8)}…  lucy_status=${doctor.lucy_status}  license=${doctor.license_number}`);
  } else {
    console.log('  ⚠ no hay doctor vinculado. Corré --clean y --apply de nuevo.');
  }
  console.log('\nPara repetir el smoke: --reset');
  console.log('Para borrar el seed:   --clean');
  process.exit(0);
}

console.log(`Phone   : ${TEST_PHONE_E164}`);
console.log(`Email   : ${TEST_EMAIL}`);
console.log(`License : ${TEST_LICENSE}`);
console.log(`Name    : ${TEST_FULL_NAME}`);
console.log(`Clinic  : ${TEST_CLINIC_NAME}`);
console.log('Estado final esperado: lucy_status=listed_only, is_published=false, is_operational=false, booking_enabled=false.');

if (!APPLY) {
  console.log('\n(dry-run: pasá --apply para crear el seed)');
  process.exit(0);
}

console.log('\nCreando seed…');

// 1. auth.user
const { data: au, error: auErr } = await svc.auth.admin.createUser({
  email: TEST_EMAIL,
  phone: TEST_PHONE_E164,
  email_confirm: true,
  phone_confirm: true,
  user_metadata: { ...META_MARKER, full_name: TEST_FULL_NAME },
});
if (auErr) {
  console.error('  ❌ auth.admin.createUser:', auErr.message);
  process.exit(1);
}
const userId = au.user.id;
console.log(`  ✅ auth.user creado (${userId.slice(0, 8)}…)`);

// 2. profile
const { error: pErr } = await svc.from('profiles').upsert(
  {
    id: userId,
    full_name: TEST_FULL_NAME,
    email: TEST_EMAIL,
    phone: TEST_PHONE,
    role: 'doctor',
  },
  { onConflict: 'id' },
);
if (pErr) {
  console.error('  ❌ profiles upsert:', pErr.message);
  console.error('     Cleanup: --clean y volvé a empezar.');
  process.exit(1);
}
console.log('  ✅ profile (role=doctor)');

// 3. clinic
// is_active=true es necesario porque getDoctorDetail joinea
// `clinics!inner` y la RLS de clinics para anon filtra is_active=true.
// La visibilidad real del seed se controla por doctors.is_published
// (false por default; --publish lo flipea durante el smoke).
const { data: clinic, error: cErr } = await svc
  .from('clinics')
  .insert({
    name: TEST_CLINIC_NAME,
    address_line: '[Test PRB] sin dirección',
    phone: TEST_PHONE,
    owner_id: userId,
    is_active: true,
  })
  .select('id')
  .single();
if (cErr) {
  console.error('  ❌ clinics insert:', cErr.message);
  process.exit(1);
}
console.log(`  ✅ clinic (id=${clinic.id.slice(0, 8)}…, is_active=true — necesario por RLS de clinics)`);

// 4. doctor
const specialty = await pickSpecialty();
const { data: doc, error: dErr } = await svc
  .from('doctors')
  .insert({
    profile_id: userId,
    clinic_id: clinic.id,
    specialty_id: specialty.id,
    license_number: TEST_LICENSE,
    lucy_status: 'listed_only',
    is_published: false,
    is_operational: false,
    booking_enabled: false,
  })
  .select('id')
  .single();
if (dErr) {
  console.error('  ❌ doctors insert:', dErr.message);
  process.exit(1);
}
console.log(`  ✅ doctor (id=${doc.id.slice(0, 8)}…, lucy_status=listed_only)`);

console.log('\n══════════════════════════════════════════════════════════');
console.log('Listo. Datos para el smoke:');
console.log(`  Phone E.164 : ${TEST_PHONE_E164}`);
console.log(`  OTP esperado: 123456 (requiere Test Phone configurado en Supabase Dashboard)`);
console.log(`  Email       : ${TEST_EMAIL}`);
console.log(`  Licencia    : ${TEST_LICENSE}`);
console.log(`  Doctor ID   : ${doc.id}`);
console.log('══════════════════════════════════════════════════════════');
console.log('\nPróximos pasos:');
console.log('  1. Si el phone no está en Test Phone Numbers de Supabase Auth → Phone, agregarlo con OTP 123456.');
console.log(`  2. Abrir /doctor/${doc.id} (preview o producción).`);
console.log('  3. Click "Reclamar mi perfil" → seguir el flow OTP + license + nuevo step Crear contraseña.');
console.log('  4. Cuando termines: node scripts/setup-test-doctor-prb.mjs --clean');
