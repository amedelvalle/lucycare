/**
 * Verifica s7_52: Slugs Fase 1 (backend).
 *
 * Sanity liviano (sin sesión de usuario):
 *  1. Columna `doctors.slug` existe.
 *  2. UNIQUE parcial permite múltiples NULL (dos doctores slug=NULL coexisten).
 *  3. Duplicado no-NULL bloqueado (23505) — índice UNIQUE parcial activo.
 *  4. CHECK de formato activo (23514) para un slug inválido.
 *  5. Funciones internas NO ejecutables por anon (`slugify_name` / `_doctor_next_slug`).
 *
 * Los casos 2–4 requieren fixtures aisladas (doctor necesita profile+clinic+
 * auth user). Se crean con marcador `[F52_FIXTURE]` y se limpian en `finally`
 * (0 residuales). NO se usa Camilo ni Katherine ni datos reales.
 *
 * Verificación funcional real (generación/colisión/congelado/trigger):
 *   node scripts/_smoke-s7_52.mjs
 *
 * Uso: node scripts/check-s7_52.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

console.log('═══ Verificando s7_52 (Slugs Fase 1) ═══\n');

let allOk = true;
const pass = (m) => console.log('  ✅', m);
const fail = (m) => { console.log('  ❌', m); allOk = false; };

const RUN = Math.random().toString(36).slice(2, 8);
let seq = 0;
const uniqPhone = () => `50379${String(200000 + (seq++)).slice(-6)}`;
const FIX_CLINIC = '[F52_FIXTURE] check clinic';

const created = { users: [], clinics: [] };

async function pickSpecialty() {
  const { data } = await admin.from('specialties').select('id').limit(1);
  if (!data || !data.length) throw new Error('No hay specialties en DB.');
  return data[0].id;
}

// Crea un auth user + profile (rol doctor). Devuelve userId.
async function makeUser(tag) {
  const email = `f52chk-${RUN}-${tag}@lucycare.test`;
  const phone = uniqPhone();
  const { data: au, error: auErr } = await admin.auth.admin.createUser({
    email, phone: `+${phone}`, email_confirm: true, phone_confirm: true,
    user_metadata: { f52_fixture: true },
  });
  if (auErr) throw new Error('createUser: ' + auErr.message);
  const userId = au.user.id;
  created.users.push(userId);
  const { error: pErr } = await admin.from('profiles').upsert(
    { id: userId, full_name: `[F52] Check Doctor ${tag}`, email, phone, role: 'doctor' },
    { onConflict: 'id' },
  );
  if (pErr) throw new Error('profiles: ' + pErr.message);
  return userId;
}

// Crea un doctor NO publicado (slug=NULL, el trigger no dispara). Devuelve {id, slug}.
async function makeUnpublishedDoctor(userId, clinicId, specialtyId) {
  const { data: doc, error: dErr } = await admin.from('doctors').insert({
    profile_id: userId, clinic_id: clinicId, specialty_id: specialtyId,
    lucy_status: 'listed_only', is_published: false, is_operational: false, booking_enabled: false,
  }).select('id, slug').single();
  if (dErr) throw new Error('doctors: ' + dErr.message);
  return doc;
}

// 1. Columna existe
{
  const { error } = await admin.from('doctors').select('slug').limit(1);
  if (error) fail('Columna doctors.slug NO existe: ' + error.message);
  else pass('Columna doctors.slug existe');
}

// 2–4. Multiple NULL / dup bloqueado / CHECK de formato (fixtures + cleanup)
try {
  const specialtyId = await pickSpecialty();
  const user1 = await makeUser('a');
  const user2 = await makeUser('b');

  const { data: clinic, error: cErr } = await admin.from('clinics').insert({
    name: FIX_CLINIC, address_line: '[F52] sin dirección', owner_id: user1, is_active: true,
  }).select('id').single();
  if (cErr) throw new Error('clinics: ' + cErr.message);
  created.clinics.push(clinic.id);

  const docA = await makeUnpublishedDoctor(user1, clinic.id, specialtyId);
  const docB = await makeUnpublishedDoctor(user2, clinic.id, specialtyId);

  // 2. múltiples NULL coexisten
  if (docA.slug === null && docB.slug === null) pass('UNIQUE parcial permite múltiples slug=NULL');
  else fail(`Se esperaba slug=NULL en ambos fixtures no publicados (A=${docA.slug}, B=${docB.slug})`);

  // 4. CHECK de formato (slug inválido → 23514)
  {
    const { error } = await admin.from('doctors').update({ slug: 'Bad Slug!' }).eq('id', docA.id);
    if (error && (error.code === '23514' || /doctors_slug_format_chk/i.test(error.message)))
      pass('CHECK de formato activo (23514) para slug inválido');
    else if (error) fail('slug inválido rechazado con error inesperado: ' + error.code + ' ' + error.message);
    else fail('slug inválido ACEPTADO (CHECK ausente)');
  }

  // 3. duplicado no-NULL bloqueado (23505)
  {
    const uniq = `f52-chk-${RUN}`;
    const { error: e1 } = await admin.from('doctors').update({ slug: uniq }).eq('id', docA.id);
    if (e1) fail('No se pudo setear slug válido en A: ' + e1.message);
    const { error: e2 } = await admin.from('doctors').update({ slug: uniq }).eq('id', docB.id);
    if (e2 && e2.code === '23505') pass('Duplicado no-NULL bloqueado (23505) — UNIQUE parcial activo');
    else if (e2) fail('Duplicado rechazado con error inesperado: ' + e2.code + ' ' + e2.message);
    else fail('Duplicado no-NULL ACEPTADO (UNIQUE parcial ausente)');
  }
} catch (e) {
  fail('No se pudo verificar CHECK/UNIQUE: ' + e.message);
} finally {
  // Cleanup en orden: doctors → clinics → profiles → auth.users
  for (const uid of created.users) await admin.from('doctors').delete().eq('profile_id', uid);
  for (const cid of created.clinics) await admin.from('clinics').delete().eq('id', cid);
  for (const uid of created.users) {
    await admin.from('profiles').delete().eq('id', uid);
    await admin.auth.admin.deleteUser(uid).catch(() => {});
  }
}

// 5. Funciones internas sin EXECUTE para anon
{
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const r1 = await anon.rpc('slugify_name', { p_name: 'x' });
  if (r1.error) pass('anon NO puede ejecutar slugify_name (' + (r1.error.code || 'error') + ')');
  else fail('anon PUDO ejecutar slugify_name');
  const r2 = await anon.rpc('_doctor_next_slug', { p_base: 'x' });
  if (r2.error) pass('anon NO puede ejecutar _doctor_next_slug (' + (r2.error.code || 'error') + ')');
  else fail('anon PUDO ejecutar _doctor_next_slug');
}

console.log('\n  ⏭️  Verificación funcional: node scripts/_smoke-s7_52.mjs');
console.log('     (tildes/ñ · colisión -2 · no publicado=NULL · publicar dispara ·');
console.log('      congelado ante cambio de nombre · fallback medico · formato).\n');

console.log(`${allOk ? '✅ s7_52 sanity OK (correr smoke para la verificación funcional)' : '❌ s7_52 con fallas'}`);
process.exit(allOk ? 0 : 1);
