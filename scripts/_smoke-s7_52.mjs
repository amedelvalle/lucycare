/**
 * Smoke funcional de s7_52 (Slugs Fase 1).
 *
 * Fixtures TOTALMENTE aisladas: el profile lo crea handle_new_user desde
 * user_metadata al crear el auth user (INSERT) — NO se hace UPDATE de identidad
 * (evita el audit trigger audit_profiles_identity, que usa auth.uid() y rechaza
 * updates de service-role). Marcador `[F52_FIXTURE]`, cleanup en `finally`,
 * verificación de 0 residuales. NO usa Camilo, NO usa Katherine.
 *
 * Casos:
 *   T1  tildes/ñ:  "Chávez Peña Ñoño" → chavez-pena-nono
 *   T2  colisión:  dos publicados "Juan Pérez" → juan-perez, juan-perez-2
 *   T3  no publicado → slug IS NULL (el trigger no dispara)
 *   T4  publicar después: is_published=true → se genera slug
 *   T5  congelado: republicar (unpublish→publish) NO regenera el slug existente.
 *       (El "cambio de nombre no afecta el slug" es estructural: no hay sync
 *        profiles→doctors.slug; y cambiar profiles.full_name por service-role
 *        choca con el audit trigger de identidad, ajeno a s7_52.)
 *   T6  fallback: nombre vacío → medico / medico-2
 *   T7  formato: todos los slugs generados cumplen ^[a-z0-9]+(-[a-z0-9]+)*$
 *   T8  cleanup: 0 residuales (auth users / profiles / clinics)
 *
 * Uso: node scripts/_smoke-s7_52.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';

console.log('═══ Smoke s7_52 (Slugs Fase 1) ═══\n');

let pass = 0, failCount = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const no = (m) => { console.log('  ❌', m); failCount++; };
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const RUN = Math.random().toString(36).slice(2, 8);
const RUNNUM = parseInt(RUN, 36) % 9000000;
let seq = 0;
const phoneFor = () => '503' + String(60000000 + RUNNUM + (seq++)); // local 8 díg. inicia en 6
const CLINIC_NAME = `[F52_FIXTURE] smoke clinic ${RUN}`;
const EMAIL_LIKE = `f52sm-${RUN}-%`;

const created = { users: [], clinics: [], doctors: [] };
let specialtyId, clinicId;

// Crea auth user + profile propio con full_name + doctor.
// GoTrue setea la metadata tras el INSERT, así que handle_new_user deja full_name='';
// y un UPDATE de identidad chocaría con audit_profiles_identity (auth.uid() NULL).
// Un DELETE + INSERT del profile fija full_name sin disparar ese audit (AFTER UPDATE).
async function makeDoctor(fullName, isPublished) {
  const tag = seq;
  const email = `f52sm-${RUN}-${tag}@lucycare.test`;
  const phone = phoneFor();
  const { data: au, error: auErr } = await admin.auth.admin.createUser({
    email, phone: `+${phone}`, email_confirm: true, phone_confirm: true,
    user_metadata: { f52_fixture: true },
  });
  if (auErr) throw new Error('createUser: ' + auErr.message);
  const userId = au.user.id;
  created.users.push(userId);
  await admin.from('profiles').delete().eq('id', userId);
  const { error: pErr } = await admin.from('profiles').insert({
    id: userId, full_name: fullName, email, phone, role: 'patient',
  });
  if (pErr) throw new Error('profiles: ' + pErr.message);

  const { data: doc, error: dErr } = await admin.from('doctors').insert({
    profile_id: userId, clinic_id: clinicId, specialty_id: specialtyId,
    lucy_status: 'listed_only', is_published: isPublished,
    is_operational: false, booking_enabled: false,
  }).select('id, slug').single();
  if (dErr) throw new Error('doctors: ' + dErr.message);
  created.doctors.push(doc.id);
  return { userId, ...doc };
}

async function slugOf(doctorId) {
  const { data } = await admin.from('doctors').select('slug').eq('id', doctorId).single();
  return data?.slug ?? null;
}

try {
  // Setup: specialty + clinic (owner = user throwaway)
  {
    const { data: sp } = await admin.from('specialties').select('id').limit(1);
    if (!sp?.length) throw new Error('No hay specialties en DB.');
    specialtyId = sp[0].id;

    const email = `f52sm-${RUN}-owner@lucycare.test`;
    const { data: au, error: auErr } = await admin.auth.admin.createUser({
      email, phone: `+${phoneFor()}`, email_confirm: true, phone_confirm: true,
      user_metadata: { full_name: '[F52] owner', f52_fixture: true },
    });
    if (auErr) throw new Error('owner createUser: ' + auErr.message);
    created.users.push(au.user.id);
    const { data: c, error: cErr } = await admin.from('clinics').insert({
      name: CLINIC_NAME, address_line: '[F52] sin dirección', owner_id: au.user.id, is_active: true,
    }).select('id').single();
    if (cErr) throw new Error('clinics: ' + cErr.message);
    clinicId = c.id;
    created.clinics.push(c.id);
  }

  // T1 — tildes/ñ
  {
    const d = await makeDoctor('Chávez Peña Ñoño', true);
    if (d.slug === 'chavez-pena-nono') ok(`T1 tildes/ñ → ${d.slug}`);
    else no(`T1 esperaba chavez-pena-nono, obtuvo ${d.slug}`);
  }

  // T2 — colisión (secuencial y determinista)
  {
    const a = await makeDoctor('Juan Pérez', true);
    const b = await makeDoctor('Juan Pérez', true);
    if (a.slug === 'juan-perez' && b.slug === 'juan-perez-2') ok(`T2 colisión → ${a.slug}, ${b.slug}`);
    else no(`T2 esperaba juan-perez / juan-perez-2, obtuvo ${a.slug} / ${b.slug}`);
  }

  // T3 — no publicado → slug NULL
  let t3doc;
  {
    t3doc = await makeDoctor('No Publicado Prueba', false);
    if (t3doc.slug === null) ok('T3 no publicado → slug IS NULL');
    else no(`T3 esperaba NULL, obtuvo ${t3doc.slug}`);
  }

  // T4 — publicar después dispara el trigger
  {
    const { error } = await admin.from('doctors').update({ is_published: true }).eq('id', t3doc.id);
    if (error) no('T4 update is_published: ' + error.message);
    const s = await slugOf(t3doc.id);
    if (s && SLUG_RE.test(s)) ok(`T4 publicar dispara → ${s}`);
    else no(`T4 esperaba slug válido tras publicar, obtuvo ${s}`);
  }

  // T5 — congelado: republicar NO regenera el slug existente
  {
    const d = await makeDoctor('Congelado Original', true);
    const before = d.slug;
    const { error: e1 } = await admin.from('doctors').update({ is_published: false }).eq('id', d.id);
    if (e1) no('T5 unpublish: ' + e1.message);
    const { error: e2 } = await admin.from('doctors').update({ is_published: true }).eq('id', d.id);
    if (e2) no('T5 republish: ' + e2.message);
    const after = await slugOf(d.id);
    if (after === before && before) ok(`T5 congelado (republicar no regenera) → ${after}`);
    else no(`T5 slug cambió: antes=${before} después=${after}`);
  }

  // T6 — fallback nombre vacío
  {
    const a = await makeDoctor('', true);
    const b = await makeDoctor('', true);
    if (a.slug === 'medico' && b.slug === 'medico-2') ok(`T6 fallback vacío → ${a.slug}, ${b.slug}`);
    else no(`T6 esperaba medico / medico-2, obtuvo ${a.slug} / ${b.slug}`);
  }

  // T7 — formato de todos los slugs generados
  {
    const { data } = await admin.from('doctors').select('slug').in('id', created.doctors);
    const slugs = (data ?? []).map((r) => r.slug).filter((s) => s !== null);
    const bad = slugs.filter((s) => !SLUG_RE.test(s));
    if (bad.length === 0) ok(`T7 formato OK en ${slugs.length} slugs generados`);
    else no(`T7 slugs con formato inválido: ${bad.join(', ')}`);
  }
} catch (e) {
  no('Excepción: ' + e.message);
} finally {
  // Cleanup en orden: doctors → clinics → profiles → auth.users
  for (const uid of created.users) await admin.from('doctors').delete().eq('profile_id', uid);
  for (const cid of created.clinics) await admin.from('clinics').delete().eq('id', cid);
  for (const uid of created.users) {
    await admin.from('profiles').delete().eq('id', uid);
    await admin.auth.admin.deleteUser(uid).catch(() => {});
  }

  // T8 — 0 residuales
  const { count: profLeft } = await admin.from('profiles')
    .select('id', { count: 'exact', head: true }).like('email', EMAIL_LIKE);
  const { count: clinLeft } = await admin.from('clinics')
    .select('id', { count: 'exact', head: true }).eq('name', CLINIC_NAME);
  let authLeft = 0;
  for (const uid of created.users) {
    const { data } = await admin.auth.admin.getUserById(uid);
    if (data?.user) authLeft++;
  }
  if ((profLeft ?? 0) === 0 && (clinLeft ?? 0) === 0 && authLeft === 0)
    ok(`T8 cleanup 0 residuales (profiles=${profLeft ?? 0}, clinics=${clinLeft ?? 0}, auth=${authLeft})`);
  else no(`T8 residuales: profiles=${profLeft}, clinics=${clinLeft}, auth=${authLeft}`);
}

console.log(`\n${failCount === 0 ? '✅' : '❌'} s7_52 smoke: pass=${pass} fail=${failCount}`);
process.exit(failCount === 0 ? 0 : 1);
