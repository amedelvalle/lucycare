/**
 * SMOKE s7_64 — PR B / F1-c1: retiro lógico de doctors.license_number.
 *
 * Corre con la SESIÓN del ADMIN de plataforma (test phone 50378056365) para
 * el approve, y con una sesión OTP del TEST PHONE DE CLAIM (ver abajo) para
 * el claim. Usa service_role SOLO para fixtures/cleanup (⚠ requiere
 * autorización del owner). Fixtures propias F64_FIXTURE, teléfonos/licencias
 * imposibles; cleanup con verificación de 0 residuales OPERATIVOS por ID
 * exacto + complementaria por clave natural. audit_log NO se toca
 * (append-only). JAMÁS Katherine; Camilo NO participa.
 *
 * ⚠ PRERREQUISITO OPERATIVO (owner): configurar TRES Test Phones de claim
 *   (CON prefijo de país) con OTP fijo `123456` en Supabase Auth → Phone →
 *   Test Phone Numbers, y RETIRARLOS al terminar:
 *     • 50370006499 — EXCLUSIVO de T5a (en la Corrida A su claim TRIUNFA por
 *       el fallback y deja al usuario vinculado a D1 → aislado para que esa
 *       mutación esperada no contamine ningún otro caso).
 *     • 50370006498 — T5d (claim exitoso pending). Aloja también T5b y T5c,
 *       cuyos fallos (P0006/P0007) son excepciones SIN mutación persistente.
 *     • 50370006497 — EXCLUSIVO de T5e (claim exitoso verified;
 *       `doctors.profile_id` es UNIQUE → cada claim exitoso necesita su
 *       propio usuario/teléfono).
 *
 * ── MODO A/B ──
 * Este smoke es el instrumento A/B de PR B:
 *   • Corrida A (ANTES de aplicar s7_64): las pruebas marcadas [D] deben
 *     FALLAR reproduciendo el estado viejo (columna escrita por el approve,
 *     trigger vivo, fallback del claim activo). Las demás pasan.
 *   • Corrida B (DESPUÉS de aplicar s7_64 + frontend + importador): TODO
 *     verde.
 *
 * Cubre (requisitos del owner para PR B):
 *   T1  approve rama new → médico correcto + 1 credencial JVPM pending +
 *       [D] doctors.license_number IS NULL + [D] audit REDACTADO
 *       (has_license=true, sin el valor del JVPM en el payload).
 *   T2  [D] trigger ausente (conductual): UPDATE de la columna NO toca la
 *       credencial. (La ausencia formal en pg_trigger/pg_proc la verifica el
 *       owner por SQL — inaccesible vía supabase-js.)
 *   T3  P0091 por licencia duplicada — pasa en AMBAS corridas (A: lo lanza
 *       el trigger vivo; B: el bloque directo del approve). Requiere la
 *       normalización post-T2 (en A el trigger cambió la credencial; se
 *       restaura antes de T3).
 *   T4  gate P0002 sin regresión.
 *   T5  MATRIZ COMPLETA del claim sin fallback (aislamiento por teléfono):
 *       a [D] SIN credencial, columna coincide → P0006 (antes: éxito).
 *           Phone A exclusivo — su éxito esperado en la Corrida A no
 *           contamina d/e.
 *       b credencial REJECTED, columna coincide → P0006 (sin fallback).
 *           Phone D compartido: el fallo no deja mutación persistente.
 *       c desync: typed = valor de la COLUMNA → P0007. Phone D (ídem b).
 *       d credencial PENDING, typed = credencial → éxito. Phone D.
 *       e credencial VERIFIED, typed = credencial → éxito. Phone E exclusivo.
 *   T6  importador: crea médico con credencial JVPM directa y columna NULL.
 *       ⚠ T6 NO es una diferencia A/B de la MIGRACIÓN: ejercita el
 *       importador NUEVO del árbol (que ya no escribe la columna ni depende
 *       del trigger) y debe pasar en AMBAS corridas. Su diferencial es de
 *       CÓDIGO (vs. el importador viejo), no del estado de la DB.
 *
 * (La rama reuse_patient no se repite: quedó cubierta por _smoke-s7_63 y el
 *  diff de s7_64 sobre el INSERT de doctors es idéntico para ambas ramas.)
 *
 * Uso: node scripts/_smoke-s7_64.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';
import { execFileSync } from 'node:child_process';
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ADMIN_PHONE = '50378056365';
const OTP = '123456';

// Fixtures F64 (se limpian; el Test Phone de claim lo configura el owner).
const P_NEW    = '50370006401';
const P_DUP    = '50370006402';
const P_PEND   = '50370006403';
const P_IMPORT = '50370006405';
const CLAIM_PHONE_A = '50370006499'; // Test Phone (OTP 123456) — EXCLUSIVO T5a
const CLAIM_PHONE_D = '50370006498'; // Test Phone (OTP 123456) — T5d (+ fallos sin mutación T5b/T5c)
const CLAIM_PHONE_E = '50370006497'; // Test Phone (OTP 123456) — EXCLUSIVO T5e
const L_A      = 'F64TESTA01';  // licencia approve new (y duplicado T3)
const L_TRIG   = 'F64TRIG99';   // valor escrito a la columna en T2
const L_NOCRED = 'F64NOCRED';   // columna del doctor SIN credencial (T5a)
const L_REJ    = 'F64REJECT1';  // credencial rejected + columna coincidente (T5b)
const L_CLAIMX = 'F64CLAIMX';   // credencial pending del doctor de claim (T5c/d)
const L_CLAIMY = 'F64CLAIMY';   // columna (desync) del doctor de claim
const L_VERIF  = 'F64VERIF01';  // credencial verified (T5e)
const L_IMP    = 'F64IMP001';   // licencia del importador
const FIXTURE_PHONES = [P_NEW, P_DUP, P_PEND, P_IMPORT, CLAIM_PHONE_A, CLAIM_PHONE_D, CLAIM_PHONE_E];
const FIXTURE_LICENSES = [L_A, L_TRIG, L_NOCRED, L_REJ, L_CLAIMX, L_CLAIMY, L_VERIF, L_IMP];

const adminCli = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const claimCliA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const claimCliD = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const claimCliE = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

// Tracking para cleanup (por ID exacto).
const leadIds = [];
const doctorIds = [];
const clinicIds = [];
const authUserIds = [];
let importTmpFile = null;

async function login(client, phone) {
  await client.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await client.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error(`OTP ${phone} falló: ${error?.message || 'sin sesión'}`);
  return data.user.id;
}

async function makeLead(phoneNorm, license, status = 'approved') {
  const { data, error } = await admin.from('doctor_affiliation_requests').insert({
    full_name: 'F64_FIXTURE Lead ' + phoneNorm.slice(-4),
    phone: phoneNorm,
    phone_normalized: phoneNorm,
    email: null,
    license_number: license,
    status,
    consent_accepted_at: new Date().toISOString(),
    consent_version: 'f64-smoke',
  }).select('id').single();
  if (error) throw new Error('insert lead falló: ' + error.message);
  leadIds.push(data.id);
  return data.id;
}

// Fixture de doctor reclamable: profiles.id tiene FK a auth.users
// (profiles_id_fkey, verificado en la Corrida A del 2026-07-18), así que el
// profile se obtiene creando un auth.user por EMAIL (sin phone — el phone de
// auth.users es UNIQUE y varias fixtures comparten teléfono) y luego se setea
// profiles.phone por UPDATE. Ese UPDATE es seguro con service_role: ni
// audit_profiles_identity (s7_32) ni el sync (s7_33) disparan en UPDATE OF
// phone (verificado en sus definiciones).
async function makeLegacyDoctor(phone, columnLicense) {
  const email = `f64-${phone.slice(-4)}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@f64fixture.invalid`;
  const { data: cu, error: cuErr } = await admin.auth.admin.createUser({
    email, email_confirm: true,
    user_metadata: { full_name: 'F64_FIXTURE Dr ' + phone.slice(-4) },
  });
  if (cuErr || !cu?.user) throw new Error('createUser fixture falló: ' + (cuErr?.message || 'sin user'));
  const profileId = cu.user.id;
  authUserIds.push(profileId); // registrado ANTES de cualquier uso

  // handle_new_user debería haber creado el profile; si no (usuario
  // email-only), se inserta con el MISMO id del auth.user (FK satisfecha).
  const { data: prof } = await admin.from('profiles').select('id').eq('id', profileId).maybeSingle();
  if (prof) {
    const { error: upErr } = await admin.from('profiles').update({ phone }).eq('id', profileId);
    if (upErr) throw new Error('set phone del profile fixture falló: ' + upErr.message);
  } else {
    const { error: insErr } = await admin.from('profiles').insert({
      id: profileId, full_name: 'F64_FIXTURE Dr ' + phone.slice(-4), phone, role: 'patient',
    });
    if (insErr) throw new Error('insert profile fixture falló: ' + insErr.message);
  }

  const { data: clinic, error: cErr } = await admin.from('clinics').insert({
    name: 'F64_FIXTURE Clinica ' + phone.slice(-4),
    owner_id: profileId, is_active: true,
  }).select('id').single();
  if (cErr) throw new Error('insert clinic legacy falló: ' + cErr.message);
  clinicIds.push(clinic.id);

  const { data: doc, error: dErr } = await admin.from('doctors').insert({
    profile_id: profileId, clinic_id: clinic.id,
    license_number: columnLicense,
    lucy_status: 'listed_only', is_published: false,
    is_operational: false, booking_enabled: false,
  }).select('id').single();
  if (dErr) throw new Error('insert doctor legacy falló: ' + dErr.message);
  doctorIds.push(doc.id);
  return { doctorId: doc.id, profileId, clinicId: clinic.id };
}

const create = (reqId, overrides = {}) =>
  adminCli.rpc('admin_approve_and_create_doctor', { p_request_id: reqId, p_overrides: overrides });

const credsOf = (doctorId) =>
  admin.from('doctor_credentials')
    .select('id, type, value, status, updated_at')
    .eq('doctor_id', doctorId);

// ── Barrido por CLAVE NATURAL, con candados ──
// Caza residuos NO trackeados (p. ej. de un éxito inesperado o una corrida
// abortada — lección de la Corrida A del 2026-07-18). Se corre al INICIO y
// al FINAL. Condiciones vinculantes del owner:
//   1. INVENTARIA e IMPRIME todo lo encontrado ANTES de borrar.
//   2. Namespace ESTRICTO: teléfonos reservados 503700064xx del smoke ·
//      licencias con prefijo F64 · correos @f64fixture.invalid · los IDs
//      residuales ya identificados (KNOWN_RESIDUAL_*).
//   3. ABORTA SIN BORRAR si: algo cae fuera del namespace · aparece un
//      médico publicado u operativo · el conteo supera lo previsto.
//   4. audit_log NO se toca.
// Devuelve true si quedó limpio; false si abortó (el caller decide).
const KNOWN_RESIDUAL_DOCTOR  = '6735129f-5ddb-41c8-986b-b0f76c534525'; // Corrida A 2026-07-18
const KNOWN_RESIDUAL_CRED    = 'b93b0807-c395-40b2-9de3-14c90d46d411';
const KNOWN_RESIDUAL_PROFILE = '911c60c2-2395-4023-bcbb-43ca7bb782bb';
const SWEEP_MAX = { doctors: 10, clinics: 10, profiles: 15, leads: 8 };
// Los teléfonos pueden quedar almacenados con o sin '+' según el escritor
// (auth/trigger/importador) — el barrido cubre ambas variantes.
const FIXTURE_PHONES_ALL = [...FIXTURE_PHONES, ...FIXTURE_PHONES.map((p) => '+' + p)];
const inNamespacePhone = (p) => p == null || FIXTURE_PHONES_ALL.includes(p);
const inNamespaceEmail = (e) => e == null || /@f64fixture\.invalid$/i.test(e);
const inNamespaceName  = (n) => (n ?? '').startsWith('F64_FIXTURE');

async function sweepFixtureLeftovers(tag) {
  // ── 1. Inventario (solo dentro del namespace consultable) ──
  const docs = new Map(); // id → {clinic_id, license_number, is_published, is_operational, profile_id}
  const addDoc = (d) => { if (d?.id) docs.set(d.id, d); };
  const DOC_COLS = 'id, clinic_id, license_number, is_published, is_operational, profile_id';
  const { data: byCol } = await admin.from('doctors').select(DOC_COLS).like('license_number', 'F64%');
  for (const d of byCol ?? []) addDoc(d);
  const { data: byCred } = await admin.from('doctor_credentials')
    .select('id, doctor_id, value').like('value', 'F64%');
  const credDoctorIds = [...new Set((byCred ?? []).map((c) => c.doctor_id))];
  if (credDoctorIds.length) {
    const { data: d2 } = await admin.from('doctors').select(DOC_COLS).in('id', credDoctorIds);
    for (const d of d2 ?? []) addDoc(d);
  }
  const { data: knownDoc } = await admin.from('doctors').select(DOC_COLS).eq('id', KNOWN_RESIDUAL_DOCTOR);
  for (const d of knownDoc ?? []) addDoc(d);

  const profs = new Map(); // id → {phone, email, full_name}
  const PROF_COLS = 'id, phone, email, full_name';
  const { data: pByPhone } = await admin.from('profiles').select(PROF_COLS).in('phone', FIXTURE_PHONES_ALL);
  for (const p of pByPhone ?? []) profs.set(p.id, p);
  const { data: pByEmail } = await admin.from('profiles').select(PROF_COLS).like('email', '%@f64fixture.invalid');
  for (const p of pByEmail ?? []) profs.set(p.id, p);
  // Caza profiles de fixture aunque su phone haya quedado NULL o en un
  // formato imprevisto (fuga observada en T6 de la Corrida A #2).
  const { data: pByName } = await admin.from('profiles').select(PROF_COLS).like('full_name', 'F64_FIXTURE%');
  for (const p of pByName ?? []) profs.set(p.id, p);
  const { data: pKnown } = await admin.from('profiles').select(PROF_COLS).eq('id', KNOWN_RESIDUAL_PROFILE);
  for (const p of pKnown ?? []) profs.set(p.id, p);

  const { data: leads } = await admin.from('doctor_affiliation_requests')
    .select('id, phone_normalized').in('phone_normalized', FIXTURE_PHONES);

  const clinicSet = new Set();
  for (const d of docs.values()) if (d.clinic_id) clinicSet.add(d.clinic_id);
  if (profs.size) {
    const { data: cByOwner } = await admin.from('clinics').select('id, owner_id').in('owner_id', [...profs.keys()]);
    for (const c of cByOwner ?? []) clinicSet.add(c.id);
  }

  const total = docs.size + clinicSet.size + profs.size + (leads?.length ?? 0);
  if (!total) { console.log(`  (${tag}: 0 residuos de fixture — nada que barrer)`); return true; }

  console.log(`  ── ${tag}: INVENTARIO (${total} registros) ──`);
  for (const d of docs.values())
    console.log(`     doctor ${d.id} · lic=${d.license_number ?? 'NULL'} · published=${d.is_published} · operational=${d.is_operational}`);
  for (const c of byCred ?? []) console.log(`     credencial ${c.id} · doctor=${c.doctor_id} · value=${c.value}`);
  for (const id of clinicSet) console.log(`     clinic ${id}`);
  for (const p of profs.values()) console.log(`     profile ${p.id} · phone=${p.phone ?? '-'} · email=${p.email ?? '-'}`);
  for (const l of leads ?? []) console.log(`     lead ${l.id} · phone=${l.phone_normalized}`);

  // ── 2. Candados: namespace + seguridad + conteo ──
  const violations = [];
  for (const d of docs.values()) {
    if (d.is_published || d.is_operational)
      violations.push(`doctor ${d.id} está PUBLICADO/OPERATIVO — jamás puede ser fixture`);
    if (d.license_number != null && !d.license_number.startsWith('F64') && d.id !== KNOWN_RESIDUAL_DOCTOR)
      violations.push(`doctor ${d.id} con licencia fuera del namespace: ${d.license_number}`);
  }
  for (const p of profs.values()) {
    const inNs = inNamespacePhone(p.phone) || inNamespaceEmail(p.email)
      || inNamespaceName(p.full_name) || p.id === KNOWN_RESIDUAL_PROFILE;
    if (!inNs)
      violations.push(`profile ${p.id} fuera del namespace (phone=${p.phone}, email=${p.email}, name=${p.full_name})`);
    if (p.phone != null && !FIXTURE_PHONES_ALL.includes(p.phone) && p.id !== KNOWN_RESIDUAL_PROFILE)
      violations.push(`profile ${p.id} con teléfono NO reservado: ${p.phone}`);
  }
  for (const c of byCred ?? []) {
    if (!c.value?.startsWith('F64') && c.id !== KNOWN_RESIDUAL_CRED)
      violations.push(`credencial ${c.id} con valor fuera del namespace: ${c.value}`);
  }
  if (docs.size > SWEEP_MAX.doctors) violations.push(`doctors=${docs.size} supera el máximo previsto (${SWEEP_MAX.doctors})`);
  if (clinicSet.size > SWEEP_MAX.clinics) violations.push(`clinics=${clinicSet.size} supera el máximo previsto (${SWEEP_MAX.clinics})`);
  if (profs.size > SWEEP_MAX.profiles) violations.push(`profiles=${profs.size} supera el máximo previsto (${SWEEP_MAX.profiles})`);
  if ((leads?.length ?? 0) > SWEEP_MAX.leads) violations.push(`leads=${leads.length} supera el máximo previsto (${SWEEP_MAX.leads})`);

  if (violations.length) {
    console.log(`  ⛔ ${tag}: ABORTADO SIN BORRAR — ${violations.length} violación(es) de candado:`);
    for (const v of violations) console.log(`     · ${v}`);
    return false;
  }

  // ── 3. Borrado (audit_log jamás se toca) ──
  const errs = [];
  const del = async (label, q) => { const { error } = await q; if (error) errs.push(`${label}: ${error.message}`); };
  for (const id of docs.keys()) await del(`sweep doctors ${id}`, admin.from('doctors').delete().eq('id', id));
  for (const id of clinicSet) {
    await del(`sweep clinic_members ${id}`, admin.from('clinic_members').delete().eq('clinic_id', id));
    await del(`sweep clinics ${id}`, admin.from('clinics').delete().eq('id', id));
  }
  for (const l of leads ?? []) await del(`sweep leads ${l.id}`, admin.from('doctor_affiliation_requests').delete().eq('id', l.id));
  for (const id of profs.keys()) {
    await del(`sweep profiles ${id}`, admin.from('profiles').delete().eq('id', id));
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && !/not.*found/i.test(error.message)) errs.push(`sweep auth.user ${id}: ${error.message}`);
  }
  if (errs.length) { for (const m of errs) ko('sweep: ' + m); return false; }
  console.log(`  (${tag}: barrido OK — ${total} registros eliminados)`);
  return true;
}

console.log('═══ SMOKE s7_64 (retiro lógico de license_number — PR B / F1-c1) ═══\n');

try {
  await login(adminCli, ADMIN_PHONE);
  if (!(await sweepFixtureLeftovers('barrido inicial'))) {
    console.error('\n⛔ Barrido inicial ABORTADO por candado — no se crean fixtures ni se borra nada. Revisar el inventario impreso con el owner.');
    process.exit(1);
  }

  let newDoctorId = null;

  // ─── T1. approve new: credencial directa + columna NULL ───
  {
    const reqId = await makeLead(P_NEW, L_A);
    const { data, error } = await create(reqId, {});
    if (error) {
      ko('T1a create new error: ' + (error.code || '') + ' ' + error.message);
    } else if (data?.success && data.reused_existing_user === false) {
      newDoctorId = data.doctor_id;
      doctorIds.push(data.doctor_id); clinicIds.push(data.clinic_id); authUserIds.push(data.profile_id);
      ok('T1a NEW → crea doctor (reused=false)');

      const { data: creds } = await credsOf(newDoctorId);
      if (creds?.length === 1 && creds[0].type === 'JVPM'
          && creds[0].status === 'pending' && creds[0].value === L_A)
        ok('T1b EXACTAMENTE 1 credencial JVPM pending con el valor del lead (escritura directa, sin trigger)');
      else ko('T1b credenciales inesperadas: ' + JSON.stringify(creds));

      const { data: doc } = await admin.from('doctors')
        .select('license_number, lucy_status, is_published').eq('id', newDoctorId).single();
      if (doc?.license_number === null)
        ok('T1c [D] doctors.license_number quedó NULL (el approve ya no escribe la columna)');
      else ko('T1c [D] la columna se escribió: ' + JSON.stringify(doc?.license_number) + ' (¿s7_64 sin aplicar?)');
      if (doc?.lucy_status === 'listed_only' && doc?.is_published === false)
        ok('T1d flags conservadores intactos');
      else ko('T1d flags inesperados: ' + JSON.stringify(doc));

      // T1e [D]: el audit del approve REDACTA el JVPM — has_license=true, sin
      // la clave license_number y sin el VALOR en ninguna parte del payload.
      const { data: audRows } = await admin.from('audit_log')
        .select('new_data').eq('table_name', 'doctors').eq('record_id', newDoctorId)
        .eq('action', 'insert').order('created_at', { ascending: false }).limit(1);
      const nd = audRows?.[0]?.new_data;
      if (!nd) ko('T1e no se encontró la fila de audit del approve');
      else {
        const raw = JSON.stringify(nd);
        if (nd.has_license === true && !('license_number' in nd) && !raw.includes(L_A))
          ok('T1e [D] audit REDACTADO: has_license=true, sin clave license_number, el JVPM fixture NO aparece en el payload');
        else ko('T1e [D] audit sin redactar: ' + raw);
      }
    } else {
      ko('T1a resultado inesperado: ' + JSON.stringify(data));
    }
  }

  // ─── T2. trigger ausente (conductual) ───
  if (newDoctorId) {
    const before = await credsOf(newDoctorId);
    const { error: upErr } = await admin.from('doctors')
      .update({ license_number: L_TRIG }).eq('id', newDoctorId);
    if (upErr) ko('T2 UPDATE de la columna falló: ' + upErr.message);
    else {
      const after = await credsOf(newDoctorId);
      const same = after.data?.length === 1
        && after.data[0].value === before.data?.[0]?.value
        && after.data[0].updated_at === before.data?.[0]?.updated_at;
      if (same) ok('T2 [D] escribir la columna NO tocó la credencial (dual-write muerto)');
      else ko('T2 [D] la credencial cambió al escribir la columna (¿trigger todavía vivo?): ' + JSON.stringify(after.data));
    }
  }

  // Normalización post-T2 (solo surte efecto en la Corrida A): si el trigger
  // vivo cambió la credencial a L_TRIG, se restaura a L_A para que T3 pruebe
  // el duplicado real en AMBAS corridas. En la B es un no-op exacto (el
  // .neq evita churn: 0 filas matchean).
  if (newDoctorId) {
    const { error } = await admin.from('doctor_credentials')
      .update({ value: L_A }).eq('doctor_id', newDoctorId).eq('type', 'JVPM').neq('value', L_A);
    if (error) ko('normalización post-T2 falló: ' + error.message);
  }

  // ─── T3. P0091: duplicado de licencia ───
  // Corrida A: lo lanza el trigger vivo. Corrida B: lo lanza el bloque
  // directo del approve. Debe pasar en AMBAS.
  {
    const reqId = await makeLead(P_DUP, L_A);
    const { data, error } = await create(reqId, {});
    if (error?.code === 'P0091') ok('T3 licencia duplicada → P0091 (antifraude activo en ambas corridas)');
    else {
      // Éxito inesperado: trackear TODO para el cleanup (lección de la
      // Corrida A del 2026-07-18, que dejó residuos sin trackear).
      if (data?.doctor_id) { doctorIds.push(data.doctor_id); clinicIds.push(data.clinic_id); authUserIds.push(data.profile_id); }
      ko('T3 esperado P0091: ' + JSON.stringify({ code: error?.code, msg: error?.message, success: data?.success }));
    }
  }

  // ─── T4. gate P0002 sin regresión ───
  {
    const reqId = await makeLead(P_PEND, 'F64PENDLIC', 'pending');
    const { error } = await create(reqId, {});
    if (error?.code === 'P0002') ok('T4 lead no-approved → P0002 (gate intacto)');
    else ko('T4 esperado P0002: ' + JSON.stringify({ code: error?.code, msg: error?.message }));
  }

  // ─── T5. MATRIZ COMPLETA del claim sin fallback ───
  {
    // ── AISLAMIENTO ──
    // Cada caso con mutación esperada tiene su PROPIO Test Phone/usuario:
    //   Phone A → D1/T5a  (en la Corrida A el fallback hace triunfar este
    //                      claim: el usuario A queda vinculado a D1; nada
    //                      más usa el phone A → cero contaminación).
    //   Phone D → D2/T5b + D3/T5c (fallos SIN mutación persistente: la
    //                      excepción revierte la transacción del claim) +
    //                      D3/T5d (único claim exitoso del usuario D).
    //   Phone E → D4/T5e  (claim exitoso propio; UNIQUE(profile_id) impide
    //                      reutilizar un usuario que ya reclamó).

    // D1 (phone A): SIN credencial pero CON columna (solo posible sin
    // trigger; en la Corrida A el trigger crea la credencial al insertar →
    // se borra a mano para que A y B partan del mismo estado).
    const d1 = await makeLegacyDoctor(CLAIM_PHONE_A, L_NOCRED);
    await admin.from('doctor_credentials').delete().eq('doctor_id', d1.doctorId);

    // D2 (phone D): credencial REJECTED y columna con el MISMO valor (si el
    // fallback viviera, la columna "rescataría" el claim — no debe).
    const d2 = await makeLegacyDoctor(CLAIM_PHONE_D, L_REJ);
    await admin.from('doctor_credentials').delete().eq('doctor_id', d2.doctorId);
    {
      const { error } = await admin.from('doctor_credentials').insert({
        doctor_id: d2.doctorId, type: 'JVPM', value: L_REJ, status: 'rejected',
        rejection_reason: 'F64_FIXTURE: prueba de rechazo (smoke s7_64)',
      });
      if (error) throw new Error('insert credencial rejected falló: ' + error.message);
    }

    // D3 (phone D): credencial PENDING (L_CLAIMX) y columna en DESYNC (L_CLAIMY).
    const d3 = await makeLegacyDoctor(CLAIM_PHONE_D, L_CLAIMY);
    await admin.from('doctor_credentials').delete().eq('doctor_id', d3.doctorId);
    {
      const { error } = await admin.from('doctor_credentials').insert({
        doctor_id: d3.doctorId, type: 'JVPM', value: L_CLAIMX, status: 'pending',
      });
      if (error) throw new Error('insert credencial pending falló: ' + error.message);
    }

    // D4 (phone E): credencial VERIFIED (columna NULL — irrelevante por
    // diseño). verified_by = el profile legacy de la MISMA fixture (FK a
    // profiles; cero datos reales).
    const d4 = await makeLegacyDoctor(CLAIM_PHONE_E, null);
    await admin.from('doctor_credentials').delete().eq('doctor_id', d4.doctorId);
    {
      const { error } = await admin.from('doctor_credentials').insert({
        doctor_id: d4.doctorId, type: 'JVPM', value: L_VERIF, status: 'verified',
        verified_by: d4.profileId, verified_at: new Date().toISOString(),
      });
      if (error) throw new Error('insert credencial verified falló: ' + error.message);
    }

    // Sesiones OTP de los tres Test Phones (crean su auth.user → cleanup;
    // registrados ANTES de usarlos).
    const claimUserA = await login(claimCliA, CLAIM_PHONE_A);
    authUserIds.push(claimUserA);
    const claimUserD = await login(claimCliD, CLAIM_PHONE_D);
    authUserIds.push(claimUserD);
    const claimUserE = await login(claimCliE, CLAIM_PHONE_E);
    authUserIds.push(claimUserE);

    // T5a [D] (phone A): sin fila JVPM → P0006 (la columna ya NO revive el claim).
    {
      const { error } = await claimCliA.rpc('claim_doctor_profile', {
        p_doctor_id: d1.doctorId, p_license_typed: L_NOCRED,
      });
      if (error?.code === 'P0006')
        ok('T5a [D] sin credencial → P0006 aunque la columna coincida (fallback muerto)');
      else if (!error)
        ko('T5a [D] el claim ACEPTÓ la licencia de la columna — el fallback sigue vivo (¿s7_64 sin aplicar?)');
      else ko('T5a esperado P0006: ' + JSON.stringify({ code: error.code, msg: error.message }));
    }

    // T5b (phone D): credencial REJECTED → P0006 aunque la columna coincida.
    // Fallo sin mutación → no afecta a T5c/T5d.
    {
      const { error } = await claimCliD.rpc('claim_doctor_profile', {
        p_doctor_id: d2.doctorId, p_license_typed: L_REJ,
      });
      if (error?.code === 'P0006')
        ok('T5b credencial rejected → P0006 aunque la columna coincida (el estado manda, sin fallback)');
      else if (!error)
        ko('T5b el claim ACEPTÓ una credencial rechazada — CRÍTICO');
      else ko('T5b esperado P0006: ' + JSON.stringify({ code: error.code, msg: error.message }));
    }

    // T5c (phone D): desync — typed = COLUMNA → P0007. Fallo sin mutación.
    {
      const { error } = await claimCliD.rpc('claim_doctor_profile', {
        p_doctor_id: d3.doctorId, p_license_typed: L_CLAIMY,
      });
      if (error?.code === 'P0007')
        ok('T5c typed=COLUMNA (desync) → P0007 (el claim no mira la columna)');
      else ko('T5c esperado P0007: ' + JSON.stringify({ code: error?.code, msg: error?.message }));
    }

    // T5d (phone D): credencial PENDING, typed = credencial → éxito.
    {
      const { data, error } = await claimCliD.rpc('claim_doctor_profile', {
        p_doctor_id: d3.doctorId, p_license_typed: L_CLAIMX,
      });
      if (!error && data?.success && data?.lucy_status === 'claimed')
        ok('T5d credencial pending + typed=CREDENCIAL → claim exitoso');
      else ko('T5d esperado éxito: ' + JSON.stringify({ code: error?.code, msg: error?.message, data }));
    }

    // T5e (phone E): credencial VERIFIED, typed = credencial → éxito.
    {
      const { data, error } = await claimCliE.rpc('claim_doctor_profile', {
        p_doctor_id: d4.doctorId, p_license_typed: L_VERIF,
      });
      if (!error && data?.success && data?.lucy_status === 'claimed')
        ok('T5e credencial verified + typed=CREDENCIAL → claim exitoso');
      else ko('T5e esperado éxito: ' + JSON.stringify({ code: error?.code, msg: error?.message, data }));
    }
  }

  // ─── T6. importador: credencial directa + columna NULL ───
  {
    // Hoja mínima con una especialidad EXISTENTE (no crear catálogo).
    const { data: spec } = await admin.from('specialties')
      .select('name').eq('is_active', true).limit(1).single();
    importTmpFile = path.join(os.tmpdir(), `f64-import-${Date.now()}.xlsx`);
    const ws = XLSX.utils.json_to_sheet([{
      source_row: 1,
      nombre: 'F64_FIXTURE Import Dr',
      especialidad_normalizada: spec?.name ?? 'Medicina General',
      colegiacion: L_IMP,
      email_principal: null,
      celular: P_IMPORT,
      telefono_fijo: null,
      clinica: 'F64_FIXTURE Clinica Import',
      direccion: null,
    }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Importar_100');
    XLSX.writeFile(wb, importTmpFile);

    let importOut = '';
    try {
      importOut = execFileSync(process.execPath,
        ['scripts/import-doctors.mjs', '--file', importTmpFile, '--sheet', 'Importar_100', '--apply'],
        { encoding: 'utf8' });
    } catch (e) {
      importOut = (e.stdout ?? '') + (e.stderr ?? '');
      ko('T6a el importador terminó con error: ' + (e.message?.split('\n')[0] ?? ''));
    }
    if (/Creados:\s*1/.test(importOut)) ok('T6a importador → 1 médico creado');
    else if (importOut) ko('T6a importador no reportó 1 creado. Salida: ' + importOut.slice(-400));

    const { data: profRows } = await admin.from('profiles')
      .select('id').in('phone', [P_IMPORT, '+' + P_IMPORT]).limit(1);
    const prof = profRows?.[0] ?? null;
    if (prof) {
      authUserIds.push(prof.id);
      const { data: doc } = await admin.from('doctors')
        .select('id, clinic_id, license_number').eq('profile_id', prof.id).maybeSingle();
      if (doc) {
        doctorIds.push(doc.id); clinicIds.push(doc.clinic_id);
        // T6 NO es diferencial de la migración: el importador NUEVO del árbol
        // no escribe la columna en ninguna corrida (su diferencial es de
        // código vs. el importador viejo, no del estado de la DB).
        if (doc.license_number === null)
          ok('T6b importador → doctors.license_number NULL');
        else ko('T6b importador escribió la columna: ' + JSON.stringify(doc.license_number));
        const { data: creds } = await credsOf(doc.id);
        if (creds?.length === 1 && creds[0].type === 'JVPM'
            && creds[0].status === 'pending' && creds[0].value === L_IMP)
          ok('T6c importador → 1 credencial JVPM pending directa');
        else ko('T6c credenciales del import inesperadas: ' + JSON.stringify(creds));
      } else ko('T6b no se encontró el doctor importado');
    } else ko('T6b no se encontró el profile importado (phone ' + P_IMPORT + ')');
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  console.log('\n— cleanup (errores NO silenciados) —');
  const cleanupErrors = [];
  const del = async (label, q) => {
    const { error } = await q;
    if (error) cleanupErrors.push(`${label}: ${error.message}`);
  };

  for (const id of doctorIds) await del(`doctors ${id}`, admin.from('doctors').delete().eq('id', id));
  for (const id of clinicIds) {
    await del(`clinic_members ${id}`, admin.from('clinic_members').delete().eq('clinic_id', id));
    await del(`clinics ${id}`, admin.from('clinics').delete().eq('id', id));
  }
  for (const id of leadIds) await del(`leads ${id}`, admin.from('doctor_affiliation_requests').delete().eq('id', id));
  for (const id of authUserIds) {
    await del(`profiles ${id}`, admin.from('profiles').delete().eq('id', id));
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && !/not.*found/i.test(error.message)) cleanupErrors.push(`auth.user ${id}: ${error.message}`);
  }
  if (importTmpFile) { try { fs.unlinkSync(importTmpFile); } catch { /* tmp, no bloquea */ } }

  if (cleanupErrors.length) { for (const m of cleanupErrors) ko('cleanup: ' + m); }
  else ok('cleanup ejecutado sin errores');

  // Barrido final por clave natural: caza cualquier residuo no trackeado
  // antes de la verificación.
  if (!(await sweepFixtureLeftovers('barrido final'))) {
    ko('barrido final abortado por candado — revisar el inventario impreso');
  }

  // ── Verificación de 0 residuales OPERATIVOS ──
  const residual = async (label, q) => {
    const { data, error } = await q;
    if (error) ko(`residual ${label}: no se pudo verificar (${error.message})`);
    else if ((data?.length ?? 0) === 0) ok(`0 residuales en ${label}`);
    else ko(`RESIDUALES en ${label}: ` + JSON.stringify(data));
  };
  if (doctorIds.length) {
    await residual('doctors (por ID)', admin.from('doctors').select('id').in('id', doctorIds));
    await residual('doctor_credentials (por doctor)', admin.from('doctor_credentials').select('id').in('doctor_id', doctorIds));
  }
  if (clinicIds.length) await residual('clinics (por ID)', admin.from('clinics').select('id').in('id', clinicIds));
  if (leadIds.length) await residual('leads (por ID)', admin.from('doctor_affiliation_requests').select('id').in('id', leadIds));
  if (authUserIds.length) await residual('profiles (por ID)', admin.from('profiles').select('id').in('id', authUserIds));
  await residual('leads por teléfono', admin.from('doctor_affiliation_requests').select('id').in('phone_normalized', FIXTURE_PHONES));
  await residual('profiles por teléfono (± prefijo +)', admin.from('profiles').select('id').in('phone', FIXTURE_PHONES_ALL));
  await residual('profiles por correo fixture', admin.from('profiles').select('id').like('email', '%@f64fixture.invalid'));
  await residual('profiles por nombre fixture', admin.from('profiles').select('id').like('full_name', 'F64_FIXTURE%'));
  await residual('credenciales por valor (prefijo F64)', admin.from('doctor_credentials').select('id').like('value', 'F64%'));
  await residual('doctors por licencia (prefijo F64)', admin.from('doctors').select('id').like('license_number', 'F64%'));

  await adminCli.auth.signOut().catch(() => {});
  await claimCliA.auth.signOut().catch(() => {});
  await claimCliD.auth.signOut().catch(() => {});
  await claimCliE.auth.signOut().catch(() => {});
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_64 OK' : '❌ SMOKE s7_64 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  console.log(`ℹ Recordatorio: retirar los Test Phones de claim (${CLAIM_PHONE_A}, ${CLAIM_PHONE_D}, ${CLAIM_PHONE_E}) al cerrar el frente.`);
  process.exit(fail === 0 ? 0 : 1);
}
