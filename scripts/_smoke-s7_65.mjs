/**
 * SMOKE s7_65 — AUTH-P1B1A: constraints del modelo + denegaciones de acceso.
 *
 * ⚠ NO EJECUTAR sin autorización expresa del owner (usa service_role para
 *   fixtures/cleanup).
 *
 * ── 100% SINTÉTICO ──
 * Ninguna referencia a cuentas reales: el smoke crea su PROPIA cadena
 * completa (auth.user → profile → clínica → médico → servicio →
 * booking_intent → grant) en el namespace AP65_FIXTURE. **Camilo NO
 * participa** (ni como FK ni como sesión) y **Katherine está excluida**.
 * Namespace: teléfonos 503700065xx · correos @ap65fixture.invalid ·
 * marcador AP65_FIXTURE en nombres e issued_by.
 *
 * La MATRIZ DE ELEGIBILIDAD del hook vive en docs/OWNER_S7_65_VERIFY.md §C
 * (bajo SET LOCAL ROLE supabase_auth_admin): el hook solo es ejecutable por
 * ese rol, así que este smoke no puede —ni debe— invocarlo.
 *
 * COBERTURA
 *   T1  Denegaciones: anon y authenticated no acceden a las tablas nuevas
 *       ni ejecutan el hook; sí pueden ejecutar auth_phone_e164 (necesaria
 *       para índices/CHECKs de tablas operativas).
 *   T2  APPEND-ONLY: un grant VENCIDO no revocado NO bloquea uno nuevo del
 *       mismo sujeto.
 *   T3  Pruebas NEGATIVAS de cada constraint de auth_creation_grants:
 *       3a phone NO canónico · 3b email con mayúsculas/espacios · 3c email
 *       vacío · 3d flow='booking' con subject_type='email' · 3e booking sin
 *       intent · 3f authorized CON intent (bicondicional) · 3g issued_by en
 *       blanco · 3h TTL booking > 15 min · 3i TTL authorized > 24 h ·
 *       3j expires_at <= created_at · 3k enums inválidos · 3l UNIQUE por intent.
 *   T4  Pruebas NEGATIVAS de booking_intents: end_at <= start_at · TTL > 15
 *       min · phone_e164 NO canónico.
 *   T5  Cleanup por IDs exactos + verificación complementaria por teléfono,
 *       correo y marker + auth.user eliminado. audit_log NO se toca.
 *
 * Uso (SOLO con autorización): node scripts/_smoke-s7_65.mjs
 */
import { supabaseAdmin as admin } from './_lib/supabase-admin.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './_lib/supabase-anon.mjs';

const MARKER = 'AP65_FIXTURE';
const DOCTOR_PHONE = '50370006501';        // médico sintético (canónico sin '+')
const SUBJ_PHONE = '+50370006502';         // sujeto phone de los grants (E.164)
const SUBJ_EMAIL = 'ap65@ap65fixture.invalid';
const FIXTURE_PHONES = [DOCTOR_PHONE, SUBJ_PHONE, '+' + DOCTOR_PHONE, SUBJ_PHONE.slice(1)];
const EMAIL_DOMAIN = '@ap65fixture.invalid';

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const ko = (m) => { console.log('  ❌', m); fail++; };

// Tracking para cleanup por ID exacto
const authUserIds = [];
const profileIds = [];
const clinicIds = [];
const doctorIds = [];
const serviceIds = [];
const intentIds = [];
const grantIds = [];
/** Builder del intent fixture y su id válido (se asignan en el SETUP). */
let mkIntent = null;
let validIntentId = null;

const expectRejected = (label, error) => {
  // 23514 CHECK · 23502 NOT NULL · 23505 UNIQUE · 22P02 input inválido
  if (error && ['23514', '23502', '23505', '22P02'].includes(error.code))
    ok(`${label} → rechazado (${error.code})`);
  else if (error) ko(`${label} → error inesperado: ${error.code} ${error.message}`);
  else ko(`${label} → ACEPTADO (constraint ausente) — CRÍTICO`);
};

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();

/**
 * PREFLIGHT (condición 1 del owner): inventaria el namespace AP65_FIXTURE en
 * TODAS las tablas involucradas ANTES de crear nada. Una corrida limpia debe
 * partir de 0. Si encuentra CUALQUIER residuo del namespace, imprime el
 * inventario y ABORTA sin crear fixtures — así no se pisan restos de una
 * corrida previa ni objetos ajenos que casaran con el namespace.
 *
 * Sobre auth.users: NO se usa listUsers paginado (bug conocido del proyecto,
 * CLAUDE.md) para concluir que un teléfono/correo está libre. La señal
 * confiable es `profiles` — el auth.user del médico se crea por correo único
 * (timestamp), y handle_new_user le crea su profile con ese correo; un
 * residuo AP65 se detecta por `profiles.email LIKE %@ap65fixture.invalid`,
 * por `profiles.phone` del namespace y por `full_name LIKE 'AP65_FIXTURE%'`.
 * Además, createUser por correo FALLA si el correo ya existe (unicidad), lo
 * que cierra el hueco de un auth.user huérfano con ese correo.
 */
async function preflightInventory() {
  const items = [];
  const scan = async (label, q) => {
    const { data, error } = await q;
    if (error) throw new Error(`preflight ${label}: no verificable (${error.message})`);
    for (const row of data ?? []) items.push({ tabla: label, id: row.id });
  };
  await scan('profiles(phone)', admin.from('profiles').select('id').in('phone', FIXTURE_PHONES));
  await scan('profiles(email)', admin.from('profiles').select('id').like('email', `%${EMAIL_DOMAIN}`));
  await scan('profiles(marker)', admin.from('profiles').select('id').like('full_name', `${MARKER}%`));
  await scan('clinics(marker)', admin.from('clinics').select('id').like('name', `${MARKER}%`));
  await scan('services(marker)', admin.from('services').select('id').like('name', `${MARKER}%`));
  await scan('patients(phone)', admin.from('patients').select('id').in('phone', FIXTURE_PHONES));
  await scan('booking_intents(phone)', admin.from('booking_intents').select('id').in('phone_e164', FIXTURE_PHONES));
  await scan('grants(subject)', admin.from('auth_creation_grants').select('id').in('subject_normalized', [SUBJ_PHONE, SUBJ_EMAIL]));
  await scan('grants(issued_by)', admin.from('auth_creation_grants').select('id').eq('issued_by', MARKER));

  if (items.length > 0) {
    console.log(`  ⛔ PREFLIGHT: ${items.length} residuo(s) del namespace AP65_FIXTURE ANTES de crear fixtures:`);
    for (const it of items) console.log(`     ${it.tabla} · id=${it.id}`);
    console.log('  ⛔ ABORTADO sin crear fixtures — limpiar los residuos y reintentar.');
    process.exit(1);
  }
  ok('preflight: 0 residuos del namespace AP65_FIXTURE (DB limpia para la corrida)');
}

console.log('═══ SMOKE s7_65 (modelo de elegibilidad — 100% sintético) ═══\n');

try {
  await preflightInventory();

  // ═══ SETUP: cadena completa AP65 ═══
  {
    const { data: cu, error: cuErr } = await admin.auth.admin.createUser({
      email: `ap65-doctor-${Date.now()}${EMAIL_DOMAIN}`,
      email_confirm: true,
      user_metadata: { full_name: `${MARKER} Dr` },
    });
    if (cuErr || !cu?.user) throw new Error('createUser: ' + (cuErr?.message || 'sin user'));
    const uid = cu.user.id;
    authUserIds.push(uid);

    // profile: handle_new_user suele crearlo; si no, INSERT con el mismo id.
    const { data: prof } = await admin.from('profiles').select('id').eq('id', uid).maybeSingle();
    if (prof) {
      const { error } = await admin.from('profiles').update({ phone: DOCTOR_PHONE }).eq('id', uid);
      if (error) throw new Error('update profile phone: ' + error.message);
    } else {
      const { error } = await admin.from('profiles').insert({
        id: uid, full_name: `${MARKER} Dr`, phone: DOCTOR_PHONE, role: 'patient',
      });
      if (error) throw new Error('insert profile: ' + error.message);
    }
    profileIds.push(uid);

    const { data: clinic, error: cErr } = await admin.from('clinics')
      .insert({ name: `${MARKER} Clinica`, owner_id: uid, is_active: true })
      .select('id').single();
    if (cErr) throw new Error('insert clinic: ' + cErr.message);
    clinicIds.push(clinic.id);

    const { data: doc, error: dErr } = await admin.from('doctors').insert({
      profile_id: uid, clinic_id: clinic.id, lucy_status: 'listed_only',
      is_published: false, is_operational: false, booking_enabled: false,
    }).select('id').single();
    if (dErr) throw new Error('insert doctor: ' + dErr.message);
    doctorIds.push(doc.id);

    const { data: svc, error: sErr } = await admin.from('services').insert({
      doctor_id: doc.id, name: `${MARKER} Consulta`, duration_minutes: 30, is_active: true,
    }).select('id').single();
    if (sErr) throw new Error('insert service: ' + sErr.message);
    serviceIds.push(svc.id);

    ok('SETUP cadena sintética AP65 creada (auth.user → profile → clínica → médico → servicio)');

    // Intent VÁLIDO de referencia (sostiene el grant de flow='booking')
    const startAt = new Date(Date.now() + 24 * 3600_000);
    mkIntent = (over = {}) => ({
      doctor_id: doc.id, clinic_id: clinic.id, service_id: svc.id,
      start_at: startAt.toISOString(),
      end_at: new Date(startAt.getTime() + 30 * 60_000).toISOString(),
      phone_e164: SUBJ_PHONE,
      expires_at: iso(10 * 60_000),
      ...over,
    });
    const { data: intent, error: iErr } = await admin.from('booking_intents')
      .insert(mkIntent()).select('id').single();
    if (iErr) throw new Error('insert intent válido: ' + iErr.message);
    intentIds.push(intent.id);
    validIntentId = intent.id;
    ok('SETUP booking_intent válido creado (E.164 canónico, TTL 15 min)');
  }

  // ═══ T1. Denegaciones de acceso ═══
  {
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const t of ['auth_creation_grants', 'booking_intents']) {
      const { error } = await anon.from(t).select('id').limit(1);
      if (error) ok(`T1a anon sin acceso a ${t} (${error.code})`);
      else ko(`T1a anon accedió a ${t} — CRÍTICO`);
    }
    const { error: hookErr } = await anon.rpc('hook_before_user_created', { event: {} });
    if (hookErr) ok(`T1b anon no ejecuta el hook (${hookErr.code})`);
    else ko('T1b anon EJECUTÓ el hook — CRÍTICO');

    const { data: fnData, error: fnErr } = await anon.rpc('auth_phone_e164', { p_input: '78627694' });
    if (!fnErr && fnData === '+50378627694')
      ok('T1c anon SÍ ejecuta auth_phone_e164 (necesaria para índices/CHECKs)');
    else ko(`T1c anon no pudo ejecutar auth_phone_e164: ${fnErr?.code ?? fnData}`);
  }

  // ═══ T2. Append-only ═══
  {
    const { data: g1, error: e1 } = await admin.from('auth_creation_grants').insert({
      subject_type: 'phone', subject_normalized: SUBJ_PHONE, flow: 'authorized',
      created_at: new Date(Date.now() - 23 * 3600_000).toISOString(),
      expires_at: iso(-60_000), issued_by: MARKER,
    }).select('id').single();
    if (e1) ko('T2a grant vencido no se pudo crear: ' + e1.message);
    else { grantIds.push(g1.id); ok('T2a grant VENCIDO creado'); }

    const { data: g2, error: e2 } = await admin.from('auth_creation_grants').insert({
      subject_type: 'phone', subject_normalized: SUBJ_PHONE, flow: 'authorized',
      expires_at: iso(3600_000), issued_by: MARKER,
    }).select('id').single();
    if (e2) ko('T2b APPEND-ONLY ROTO: el vencido bloqueó al nuevo: ' + e2.message);
    else { grantIds.push(g2.id); ok('T2b grant NUEVO del mismo sujeto convive con el vencido (append-only)'); }

    const { data: g3, error: e3 } = await admin.from('auth_creation_grants').insert({
      subject_type: 'email', subject_normalized: SUBJ_EMAIL, flow: 'authorized',
      expires_at: iso(3600_000), issued_by: MARKER,
    }).select('id').single();
    if (e3) ko('T2c grant email falló: ' + e3.message);
    else { grantIds.push(g3.id); ok('T2c grant email canónico creado'); }
  }

  // ═══ T3. Constraints de auth_creation_grants (pruebas negativas) ═══
  {
    const G = (over = {}) => ({
      subject_type: 'phone', subject_normalized: SUBJ_PHONE, flow: 'authorized',
      expires_at: iso(3600_000), issued_by: MARKER, ...over,
    });
    let r;
    // ── Canonicalidad NULL-SAFE: valores que auth_phone_e164 devuelve NULL
    //    para ellos DEBEN fallar (no "pasar" por el NULL del CHECK) ──
    r = await admin.from('auth_creation_grants').insert(G({ subject_normalized: '50370006502' }));
    expectRejected("T3a phone NO canónico (sin '+')", r.error);

    r = await admin.from('auth_creation_grants').insert(G({ subject_normalized: '78627694' }));
    expectRejected('T3a2 phone local sin normalizar', r.error);

    r = await admin.from('auth_creation_grants').insert(G({ subject_normalized: '+50399999999' }));
    expectRejected('T3a3 prefijo habilitado pero patrón nacional inválido (SV 9…)', r.error);

    r = await admin.from('auth_creation_grants').insert(G({ subject_normalized: '+9791234567' }));
    expectRejected('T3a4 código de país NO habilitado', r.error);

    r = await admin.from('auth_creation_grants').insert(G({ subject_normalized: '' }));
    // subject_normalized es NOT NULL; '' no es canónico → CHECK (o el propio
    // normalizador que devuelve NULL). Debe fallar por constraint.
    expectRejected('T3a5 subject_normalized vacío (phone)', r.error);

    r = await admin.from('auth_creation_grants').insert(
      G({ subject_normalized: '+503' + '7'.repeat(200) }));
    expectRejected('T3a6 entrada excesivamente larga (> 32) → no canónico', r.error);

    r = await admin.from('auth_creation_grants').insert(
      G({ subject_type: 'email', subject_normalized: 'AP65@ap65fixture.invalid' }));
    expectRejected('T3b email con mayúsculas', r.error);

    r = await admin.from('auth_creation_grants').insert(
      G({ subject_type: 'email', subject_normalized: ' ap65@ap65fixture.invalid ' }));
    expectRejected('T3b2 email con espacios', r.error);

    r = await admin.from('auth_creation_grants').insert(
      G({ subject_type: 'email', subject_normalized: '' }));
    expectRejected('T3c email vacío', r.error);

    r = await admin.from('auth_creation_grants').insert(G({
      subject_type: 'email', subject_normalized: SUBJ_EMAIL,
      flow: 'booking', booking_intent_id: validIntentId, expires_at: iso(10 * 60_000),
    }));
    expectRejected("T3d flow='booking' con subject_type='email'", r.error);

    r = await admin.from('auth_creation_grants').insert(
      G({ flow: 'booking', expires_at: iso(10 * 60_000) }));
    expectRejected("T3e flow='booking' SIN booking_intent_id", r.error);

    r = await admin.from('auth_creation_grants').insert(
      G({ flow: 'authorized', booking_intent_id: validIntentId }));
    expectRejected("T3f flow='authorized' CON booking_intent_id (bicondicional)", r.error);

    r = await admin.from('auth_creation_grants').insert(G({ issued_by: '   ' }));
    expectRejected('T3g issued_by en blanco', r.error);

    r = await admin.from('auth_creation_grants').insert(G({
      flow: 'booking', booking_intent_id: validIntentId, expires_at: iso(20 * 60_000),
    }));
    expectRejected('T3h TTL booking > 15 min', r.error);

    r = await admin.from('auth_creation_grants').insert(G({ expires_at: iso(25 * 3600_000) }));
    expectRejected('T3i TTL authorized > 24 h', r.error);

    r = await admin.from('auth_creation_grants').insert(G({ expires_at: iso(-1000) }));
    expectRejected('T3j expires_at <= created_at', r.error);

    r = await admin.from('auth_creation_grants').insert(G({ flow: 'otro' }));
    expectRejected('T3k flow fuera del enum', r.error);
    r = await admin.from('auth_creation_grants').insert(G({ subject_type: 'sms' }));
    expectRejected('T3k2 subject_type fuera del enum', r.error);

    // UNIQUE por intent: el primer grant booking válido debe entrar…
    const { data: bg, error: bgErr } = await admin.from('auth_creation_grants').insert(G({
      flow: 'booking', booking_intent_id: validIntentId, expires_at: iso(10 * 60_000),
    })).select('id').single();
    if (bgErr) ko('T3l setup: grant booking válido falló: ' + bgErr.message);
    else {
      grantIds.push(bg.id);
      ok('T3l grant booking válido (phone + intent + TTL) creado');
      const dup = await admin.from('auth_creation_grants').insert(G({
        flow: 'booking', booking_intent_id: validIntentId, expires_at: iso(10 * 60_000),
      }));
      expectRejected('T3l2 segundo grant sobre el MISMO intent (UNIQUE)', dup.error);
    }
  }

  // ═══ T4. Constraints de booking_intents (pruebas negativas) ═══
  {
    let r = await admin.from('booking_intents').insert(mkIntent({ end_at: mkIntent().start_at }));
    expectRejected('T4a end_at <= start_at', r.error);

    r = await admin.from('booking_intents').insert(mkIntent({ expires_at: iso(20 * 60_000) }));
    expectRejected('T4b TTL intent > 15 min', r.error);

    // Canonicalidad NULL-SAFE de phone_e164 (mismo criterio que los grants).
    r = await admin.from('booking_intents').insert(mkIntent({ phone_e164: '50370006502' }));
    expectRejected("T4c phone_e164 NO canónico (sin '+')", r.error);

    r = await admin.from('booking_intents').insert(mkIntent({ phone_e164: '78627694' }));
    expectRejected('T4c2 phone_e164 local sin normalizar', r.error);

    r = await admin.from('booking_intents').insert(mkIntent({ phone_e164: '+50399999999' }));
    expectRejected('T4c3 phone_e164 prefijo habilitado, patrón nacional inválido', r.error);

    r = await admin.from('booking_intents').insert(mkIntent({ phone_e164: '+9791234567' }));
    expectRejected('T4c4 phone_e164 código no habilitado', r.error);

    r = await admin.from('booking_intents').insert(mkIntent({ phone_e164: '' }));
    expectRejected('T4c5 phone_e164 vacío', r.error);

    r = await admin.from('booking_intents').insert(mkIntent({ phone_e164: '+503' + '7'.repeat(200) }));
    expectRejected('T4c6 phone_e164 excesivamente largo → no canónico', r.error);
  }
} catch (e) {
  ko('EXCEPCIÓN: ' + e.message);
} finally {
  // ═══ T5. Cleanup por IDs exactos (errores NO silenciados) ═══
  console.log('\n— cleanup por ID exacto (errores NO silenciados) —');
  const errs = [];
  const del = async (label, q) => { const { error } = await q; if (error) errs.push(`${label}: ${error.message}`); };

  for (const id of grantIds) await del(`grants ${id}`, admin.from('auth_creation_grants').delete().eq('id', id));
  for (const id of intentIds) await del(`intents ${id}`, admin.from('booking_intents').delete().eq('id', id));
  for (const id of serviceIds) await del(`services ${id}`, admin.from('services').delete().eq('id', id));
  for (const id of doctorIds) await del(`doctors ${id}`, admin.from('doctors').delete().eq('id', id));
  for (const id of clinicIds) {
    await del(`clinic_members ${id}`, admin.from('clinic_members').delete().eq('clinic_id', id));
    await del(`clinics ${id}`, admin.from('clinics').delete().eq('id', id));
  }
  for (const id of profileIds) await del(`profiles ${id}`, admin.from('profiles').delete().eq('id', id));
  for (const id of authUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && !/not.*found/i.test(error.message)) errs.push(`auth.user ${id}: ${error.message}`);
  }
  if (errs.length) { for (const m of errs) ko('cleanup: ' + m); }
  else ok('cleanup ejecutado sin errores');

  // ═══ Verificación de 0 residuos: ID · teléfono · correo · marker ═══
  const residual = async (label, q) => {
    const { data, error } = await q;
    if (error) ko(`residual ${label}: no verificable (${error.message})`);
    else if ((data?.length ?? 0) === 0) ok(`0 residuales en ${label}`);
    else ko(`RESIDUALES en ${label}: ` + JSON.stringify(data));
  };
  if (grantIds.length) await residual('grants (por ID)', admin.from('auth_creation_grants').select('id').in('id', grantIds));
  if (intentIds.length) await residual('intents (por ID)', admin.from('booking_intents').select('id').in('id', intentIds));
  if (doctorIds.length) await residual('doctors (por ID)', admin.from('doctors').select('id').in('id', doctorIds));
  if (serviceIds.length) await residual('services (por ID)', admin.from('services').select('id').in('id', serviceIds));
  if (clinicIds.length) await residual('clinics (por ID)', admin.from('clinics').select('id').in('id', clinicIds));
  if (profileIds.length) await residual('profiles (por ID)', admin.from('profiles').select('id').in('id', profileIds));

  await residual('grants por sujeto (teléfono/correo)',
    admin.from('auth_creation_grants').select('id').in('subject_normalized', [SUBJ_PHONE, SUBJ_EMAIL]));
  await residual('grants por marker', admin.from('auth_creation_grants').select('id').eq('issued_by', MARKER));
  await residual('intents por teléfono', admin.from('booking_intents').select('id').in('phone_e164', FIXTURE_PHONES));
  await residual('profiles por teléfono', admin.from('profiles').select('id').in('phone', FIXTURE_PHONES));
  await residual('profiles por correo fixture', admin.from('profiles').select('id').like('email', `%${EMAIL_DOMAIN}`));
  await residual('profiles por marker', admin.from('profiles').select('id').like('full_name', `${MARKER}%`));
  await residual('clinics por marker', admin.from('clinics').select('id').like('name', `${MARKER}%`));
  await residual('services por marker', admin.from('services').select('id').like('name', `${MARKER}%`));

  ok('auditoría append-only intacta (el smoke no contiene escrituras a audit_log)');
  console.log(`\n${fail === 0 ? '✅ SMOKE s7_65 OK' : '❌ SMOKE s7_65 con ' + fail + ' fallas'} (pass=${pass}, fail=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}
