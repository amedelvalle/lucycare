/**
 * _smoke-s7_62.mjs — cutover de lectores + P0091 + desync del claim (F1-b).
 *
 *   node scripts/_smoke-s7_62.mjs                 # solo estructural (sin escrituras)
 *   node scripts/_smoke-s7_62.mjs --fixtures      # + bloque con service_role
 *
 * ── ESTADO DE AUTORIZACIÓN ──
 * El bloque de fixtures (service_role + OTP) NO está autorizado a ejecutarse
 * todavía. Sin `--fixtures` el smoke corre solo la parte estructural (lecturas)
 * y SALTEA el resto con un mensaje explícito. Cuando el owner autorice y defina
 * el Test Phone dedicado, se corre con `--fixtures`.
 *
 * ── Qué prueba el bloque de fixtures (cuando se habilite) ──
 *   R1  el embed doctor_credentials(value,type,status) devuelve el JVPM = la columna
 *   R2  una cuenta ajena ve [] en el embed (fail-closed)
 *   P1  dos médicos con el mismo JVPM → el 2º aborta con P0091 (constraint
 *       doctor_credentials_registry_uniq), NO un 23505 crudo
 *   P2  un 23505 de OTRA constraint NO se convierte en P0091
 *   C1  DESYNC DEL CLAIM (la prueba central): fixture con columna='COL-X' y
 *       credencial='CRED-Y' →
 *         • claim(typed='CRED-Y') → éxito  ⇒ el claim lee la CREDENCIAL
 *         • claim(typed='COL-X')  → P0007  ⇒ el claim IGNORA la columna
 *       (dos fixtures: el claim es irreversible, listed_only→claimed)
 *
 *   ── Regla de credencial 'rejected' (ajuste vinculante) ──
 *   J1  claim con credencial JVPM 'rejected' → P0006 (perfil sin credencial),
 *       AUNQUE doctors.license_number contenga el MISMO valor tipeado. Prueba
 *       que un rechazo NO se revive desde la columna.
 *   J2  getConsultationContext (como el médico dueño): con credencial 'rejected'
 *       la receta recibe license_number = null (no imprime el JVPM rechazado),
 *       y NO cae a la columna.
 *   J3  getMyDoctorProfile (como el médico dueño): credencial 'rejected' → el
 *       panel NO la presenta como vigente (license_number = null).
 *   J4  credencial JVPM AUSENTE (0 filas) → fallback a doctors.license_number
 *       (el fallback es solo para este caso, no para evadir un estado).
 *   J5  credencial 'pending' y 'verified' → siguen usables en claim/receta/panel.
 *
 *   Nota: J2/J3 se validan consultando el embed CON la sesión del médico dueño
 *   (la RLS de doctor_credentials solo le muestra su fila), reproduciendo lo
 *   que hacen getConsultationContext/getMyDoctorProfile; la resolución de
 *   `rejected`/fallback la aplica el helper resolveJvpm (frontend) y aquí se
 *   verifica su misma regla sobre las filas reales.
 *
 * ── Requisitos del bloque de fixtures (a confirmar por el owner) ──
 *   • SUPABASE_SERVICE_ROLE_KEY en .env.local (autorización puntual);
 *   • un Test Phone DEDICADO para las fixtures del claim (NO Camilo ni
 *     Katherine), con OTP fijo, configurado en Supabase → env TEST_DOCTOR_PHONE.
 *     El claim exige sesión OTP con teléfono confirmado; sin ese Test Phone la
 *     prueba C1 (desync) no puede correr.
 *   • fixtures marcadas F1B_FIXTURE, try/finally, cleanup con 0 residuales.
 *
 * ── El desync, en detalle (por qué prueba lo que dice) ──
 * El trigger sincroniza en UNA dirección (doctors → doctor_credentials). Al
 * escribir doctor_credentials.value directamente (service_role), la columna y
 * la credencial quedan DISTINTAS sin que el trigger las re-alinee. Entonces el
 * valor que el claim acepta revela de qué tabla lee: acepta 'CRED-Y' (credencial)
 * y rechaza 'COL-X' (columna). Un test que solo probara "el claim anda" no
 * distinguiría la fuente.
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseAnon } from './_lib/supabase-anon.mjs';

const WANT_FIXTURES = process.argv.includes('--fixtures');
const OTP = '123456';

let pass = 0;
let fail = 0;
let skipped = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const no = (m) => { console.log(`  ❌ ${m}`); fail++; };

// Réplica EXACTA de la regla de src/services/doctorProfile.service.ts::resolveJvpm,
// para asertar aquí lo mismo que resuelve el frontend (J2–J5). Si divergen, es un
// bug: la regla debe vivir en un solo lugar conceptual.
function resolveJvpm(rows, columnFallback) {
  const jvpm = (rows ?? []).find((c) => c.type === 'JVPM');
  if (jvpm) return jvpm.status === 'rejected' ? null : (jvpm.value ?? null);
  return columnFallback ?? null;
}

async function main() {
  console.log('\n_smoke-s7_62 — cutover de lectores (F1-b)\n');

  // ══ estructural (sin escrituras) ══════════════════════════
  console.log('estructural:');
  {
    const { error } = await supabaseAnon.from('doctor_credentials').select('id').limit(1);
    if (error) ok(`anon no accede a doctor_credentials (${error.code})`);
    else no('anon accedió a doctor_credentials — CRÍTICO');
  }

  // ══ fixtures (service_role + OTP) — gateado ═══════════════
  if (!WANT_FIXTURES) {
    console.log('\nbloque de fixtures:');
    console.log(
      '  ⏭️  SKIP — no autorizado / sin --fixtures.\n' +
      '      Cuando el owner lo habilite: definir un Test Phone DEDICADO\n' +
      '      (NO Camilo ni Katherine) en TEST_DOCTOR_PHONE + SERVICE_ROLE_KEY,\n' +
      '      y correr `node scripts/_smoke-s7_62.mjs --fixtures`.\n' +
      '      Prueba R1/R2 (embed), P1/P2 (P0091) y C1 (desync del claim).',
    );
    skipped++;
  } else {
    console.log('\nbloque de fixtures: --fixtures pedido');
    const phone = process.env.TEST_DOCTOR_PHONE;
    let svc;
    try {
      ({ supabaseAdmin: svc } = await import('./_lib/supabase-admin.mjs'));
    } catch {
      no('bloque de fixtures: falta SUPABASE_SERVICE_ROLE_KEY en .env.local');
    }
    if (svc && !phone) {
      no('bloque de fixtures: falta TEST_DOCTOR_PHONE (Test Phone dedicado para el claim E2E). No se ejecuta para no improvisar un teléfono.');
    } else if (svc && phone) {
      await runFixtures(svc, phone);
    }
  }

  const tail = skipped > 0 ? ` skip=${skipped}` : '';
  console.log(`\n${fail === 0 ? '✅' : '❌'} _smoke-s7_62: pass=${pass} fail=${fail}${tail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

// ═══════════════════════════════════════════════════════════
// Bloque de fixtures (service_role + OTP) — F1B_FIXTURE.
// Solo corre con `--fixtures` + TEST_DOCTOR_PHONE + SERVICE_ROLE_KEY.
// Fixtures propias, try/finally, cleanup con verificación de 0 residuales.
// Jamás Camilo ni Katherine. El Test Phone es DEDICADO (env TEST_DOCTOR_PHONE).
//
// ⚠️ Este bloque se ejecuta por primera vez cuando el owner autorice y
// configure el Test Phone. Los patrones (makeDoctor, OTP, cleanup) reusan los
// ya depurados en _smoke-s7_61; la mecánica end-to-end se valida en esa corrida.
// ═══════════════════════════════════════════════════════════
const MARK = 'F1B_FIXTURE';
const COL_X = 'F1B-COL-X-0001';   // valor de la COLUMNA (doctors.license_number)
const CRED_Y = 'F1B-CRED-Y-0002'; // valor de la CREDENCIAL (desincronizado)
const LIC_DUP = 'F1B-DUP-0003';   // JVPM duplicado para P1
const LIC_ABS = 'F1B-ABS-0004';   // para J4 (luego se borra la credencial)

async function signInFixture(phone) {
  const cli = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await cli.auth.signInWithOtp({ phone }).catch(() => {});
  const { data, error } = await cli.auth.verifyOtp({ phone, token: OTP, type: 'sms' });
  if (error || !data?.session) throw new Error(`OTP falló para ${phone}: ${error?.message}`);
  return cli;
}

async function runFixtures(svc, testPhone) {
  const phoneE164 = testPhone.startsWith('+') ? testPhone : `+${testPhone}`;
  const made = { users: [], clinics: [], doctors: [] };

  // Best-effort: limpiar un usuario del Test Phone que haya quedado de una
  // corrida abortada (mismo phone → createUser fallaría por duplicado).
  async function purgePhoneUser() {
    const { data } = await svc.auth.admin.listUsers();
    const u = (data?.users ?? []).find((x) => (x.phone ?? '').replace(/\D/g, '') === phoneE164.replace(/\D/g, ''));
    if (u) {
      const { data: dd } = await svc.from('doctors').select('id, clinic_id').eq('profile_id', u.id);
      for (const d of dd ?? []) {
        await svc.from('doctors').delete().eq('id', d.id);
        if (d.clinic_id) await svc.from('clinics').delete().eq('id', d.clinic_id);
      }
      await svc.from('profiles').delete().eq('id', u.id);
      await svc.auth.admin.deleteUser(u.id).catch(() => {});
    }
  }

  const { data: spec } = await svc.from('specialties').select('id').limit(1).single();

  // Médico con service_role (email random), SIN teléfono → para P1/P2/J4/R2.
  async function makeSvcDoctor(tag, license) {
    const email = `f1b-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@lucycare.test`;
    const { data: au, error: e } = await svc.auth.admin.createUser({
      email, email_confirm: true, user_metadata: { [MARK]: true, full_name: `[${MARK}] ${tag}` },
    });
    if (e) throw new Error(`createUser(${tag}): ${e.message}`);
    made.users.push(au.user.id);
    const { data: prof } = await svc.from('profiles').select('id').eq('id', au.user.id).maybeSingle();
    if (!prof) {
      // INSERT (no UPDATE de full_name: evita el trigger audit_profiles_identity/s7_32).
      const { error: pe } = await svc.from('profiles').insert({ id: au.user.id, full_name: `[${MARK}] ${tag}`, email, role: 'doctor' });
      if (pe) throw new Error(`profiles(${tag}): ${pe.message}`);
    }
    const { data: cl, error: ce } = await svc.from('clinics')
      .insert({ name: `[${MARK}] clínica ${tag}`, owner_id: au.user.id, is_active: false }).select('id').single();
    if (ce) throw new Error(`clinics(${tag}): ${ce.message}`);
    made.clinics.push(cl.id);
    const { data: doc, error: de } = await svc.from('doctors')
      .insert({ profile_id: au.user.id, clinic_id: cl.id, specialty_id: spec.id, license_number: license,
                lucy_status: 'listed_only', is_published: false, is_operational: false, booking_enabled: false })
      .select('id').single();
    if (de) throw new Error(`doctors(${tag}): ${de.message}`);
    made.doctors.push(doc.id);
    return doc.id;
  }

  const credRow = async (docId) => {
    const { data } = await svc.from('doctor_credentials')
      .select('id, value, status, verified_by, verified_at').eq('doctor_id', docId).eq('type', 'JVPM').maybeSingle();
    return data;
  };

  try {
    await purgePhoneUser();

    // ── Médico del CLAIM (phone = Test Phone dedicado, listed_only) ──
    const { data: au, error: ae } = await svc.auth.admin.createUser({
      phone: phoneE164, phone_confirm: true,
      user_metadata: { [MARK]: true, full_name: `[${MARK}] claim` },
    });
    if (ae) throw new Error(`createUser(claim/phone): ${ae.message}`);
    const claimUserId = au.user.id;
    made.users.push(claimUserId);

    const { data: prof } = await svc.from('profiles').select('id, phone').eq('id', claimUserId).maybeSingle();
    if (!prof) {
      const { error: pe } = await svc.from('profiles').insert({ id: claimUserId, phone: phoneE164.replace('+', ''), role: 'patient', full_name: `[${MARK}] claim` });
      if (pe) throw new Error(`profiles(claim): ${pe.message}`);
    }
    const { data: cl } = await svc.from('clinics')
      .insert({ name: `[${MARK}] clínica claim`, owner_id: claimUserId, is_active: false }).select('id').single();
    made.clinics.push(cl.id);
    const { data: dClaim } = await svc.from('doctors')
      .insert({ profile_id: claimUserId, clinic_id: cl.id, specialty_id: spec.id, license_number: COL_X,
                lucy_status: 'listed_only', is_published: false, is_operational: false, booking_enabled: false })
      .select('id').single();
    made.doctors.push(dClaim.id);
    const claimDoctorId = dClaim.id;

    // Sesión OTP del médico del claim.
    const session = await signInFixture(phoneE164);

    // ── R1 · embed devuelve el JVPM propio (RLS) ──
    {
      const { data } = await session.from('doctors')
        .select('id, license_number, doctor_credentials(value, type, status)').eq('id', claimDoctorId).single();
      const jvpm = resolveJvpm(data?.doctor_credentials, data?.license_number);
      if (jvpm === COL_X) ok('R1 el embed devuelve el JVPM propio (= la columna, sincronizado)');
      else no(`R1 embed inesperado: jvpm=${jvpm} esperaba ${COL_X}`);
    }

    // ── R2 · una cuenta ve solo lo suyo (otro médico → []) ──
    const dOther = await makeSvcDoctor('other', 'F1B-OTHER-9999');
    {
      const { data } = await session.from('doctors')
        .select('id, doctor_credentials(value, type, status)').eq('id', dOther).single();
      const rows = data?.doctor_credentials ?? [];
      if (rows.length === 0) ok('R2 el médico NO ve la credencial de otro (embed vacío por RLS)');
      else no(`R2 fuga: vio ${rows.length} credenciales ajenas`);
    }

    // ── J5-verified · verified es usable ──
    {
      await svc.from('doctor_credentials')
        .update({ status: 'verified', verified_by: claimUserId, verified_at: new Date().toISOString() })
        .eq('doctor_id', claimDoctorId).eq('type', 'JVPM');
      const { data } = await session.from('doctors')
        .select('license_number, doctor_credentials(value, type, status)').eq('id', claimDoctorId).single();
      const jvpm = resolveJvpm(data?.doctor_credentials, data?.license_number);
      if (jvpm === COL_X) ok('J5 verified → credencial usable (receta/panel la muestran)');
      else no(`J5 verified: jvpm=${jvpm} esperaba ${COL_X}`);
    }

    // ── J2/J3 · rejected NO se presenta y NO cae a la columna ──
    {
      await svc.from('doctor_credentials')
        .update({ status: 'rejected', verified_by: null, verified_at: null, rejection_reason: `[${MARK}] rechazo` })
        .eq('doctor_id', claimDoctorId).eq('type', 'JVPM');
      const { data } = await session.from('doctors')
        .select('license_number, doctor_credentials(value, type, status)').eq('id', claimDoctorId).single();
      const jvpm = resolveJvpm(data?.doctor_credentials, data?.license_number);
      if (jvpm === null) ok('J2/J3 rejected → receta/panel reciben null (no imprime ni presenta; no cae a la columna)');
      else no(`J2/J3 rejected revivido: jvpm=${jvpm} (columna=${COL_X})`);
    }

    // ── J1 · claim con credencial rejected → P0006 aunque la columna coincida ──
    {
      const { error } = await session.rpc('claim_doctor_profile', { p_doctor_id: claimDoctorId, p_license_typed: COL_X });
      if (error?.code === 'P0006') ok('J1 claim con credencial rejected → P0006 (no se revive desde la columna, aunque coincida)');
      else no(`J1 esperaba P0006, obtuvo ${error?.code ?? 'éxito'} — el rechazo NO debe reclamarse vía columna`);
    }

    // ── Desincronizar: credencial pending = CRED_Y, columna sigue COL_X ──
    await svc.from('doctor_credentials')
      .update({ status: 'pending', verified_by: null, verified_at: null, rejection_reason: null, value: CRED_Y })
      .eq('doctor_id', claimDoctorId).eq('type', 'JVPM');

    // ── C1-fail · claim con el valor de la COLUMNA → P0007 (la ignora) ──
    {
      const { error } = await session.rpc('claim_doctor_profile', { p_doctor_id: claimDoctorId, p_license_typed: COL_X });
      if (error?.code === 'P0007') ok('C1a claim(typed=COLUMNA) → P0007 (el claim IGNORA doctors.license_number)');
      else no(`C1a esperaba P0007, obtuvo ${error?.code ?? 'éxito'} — leería la columna`);
    }

    // ── C1-success · claim con el valor de la CREDENCIAL → éxito (la lee) ──
    // MUTA: listed_only → claimed. Es la última acción sobre este fixture.
    {
      const { data, error } = await session.rpc('claim_doctor_profile', { p_doctor_id: claimDoctorId, p_license_typed: CRED_Y });
      if (!error && data?.success) ok('C1b claim(typed=CREDENCIAL) → éxito (el claim LEE doctor_credentials)');
      else no(`C1b esperaba éxito, obtuvo ${error?.code ?? JSON.stringify(data)}`);
    }
    await session.auth.signOut().catch(() => {});

    // ── J4 · sin fila JVPM → fallback a la columna ──
    {
      const dAbs = await makeSvcDoctor('abs', LIC_ABS);
      await svc.from('doctor_credentials').delete().eq('doctor_id', dAbs).eq('type', 'JVPM');
      const { data } = await svc.from('doctors')
        .select('license_number, doctor_credentials(value, type, status)').eq('id', dAbs).single();
      const jvpm = resolveJvpm(data?.doctor_credentials, data?.license_number);
      if (jvpm === LIC_ABS) ok('J4 sin fila JVPM → fallback a doctors.license_number');
      else no(`J4 fallback falló: jvpm=${jvpm} esperaba ${LIC_ABS}`);
    }

    // ── P1 · JVPM duplicado vía trigger → P0091 ──
    {
      await makeSvcDoctor('dupA', LIC_DUP);                     // ocupa el JVPM
      const dB = await makeSvcDoctor('dupB', 'F1B-DUP-B-0005'); // otro distinto
      const { error } = await svc.from('doctors').update({ license_number: LIC_DUP }).eq('id', dB); // colisiona
      if (error?.code === 'P0091') ok('P1 dos médicos con el mismo JVPM → P0091 (registry_uniq, no 23505 crudo)');
      else no(`P1 esperaba P0091, obtuvo ${error?.code ?? 'sin error'}`);
    }

    // ── P2 · un 23505 de OTRA constraint NO se convierte en P0091 ──
    // INSERT directo de un 2º JVPM para el mismo médico viola one_per_type
    // (NO pasa por el trigger) → debe surgir su propio 23505, jamás P0091.
    {
      const dP2 = await makeSvcDoctor('p2', 'F1B-P2-0006');
      const { error } = await svc.from('doctor_credentials').insert({ doctor_id: dP2, type: 'JVPM', value: 'F1B-P2-SECOND' });
      if (error && error.code === '23505') ok('P2 otra colisión de unicidad (one_per_type) → 23505 propio, NO P0091');
      else if (error?.code === 'P0091') no('P2 un 23505 ajeno se convirtió en P0091 — el handler no está acotado');
      else no(`P2 esperaba 23505, obtuvo ${error?.code ?? 'sin error'}`);
    }
  } catch (e) {
    no(`fixtures: ${e.message}`);
  } finally {
    for (const d of made.doctors) await svc.from('doctors').delete().eq('id', d); // cascade → credentials
    for (const c of made.clinics) await svc.from('clinics').delete().eq('id', c);
    for (const u of made.users) {
      await svc.from('profiles').delete().eq('id', u);
      await svc.auth.admin.deleteUser(u).catch(() => {});
    }
    // Verificación de 0 residuales (por ID de lo creado + por marca).
    const nz = made.doctors.length ? made.doctors : ['00000000-0000-0000-0000-000000000000'];
    const { count: credsLeft } = await svc.from('doctor_credentials').select('id', { count: 'exact', head: true }).in('doctor_id', nz);
    const { count: docsLeft } = await svc.from('doctors').select('id', { count: 'exact', head: true }).in('id', nz);
    const { count: clinLeft } = await svc.from('clinics').select('id', { count: 'exact', head: true }).ilike('name', `%${MARK}%`);
    const total = (credsLeft ?? 0) + (docsLeft ?? 0) + (clinLeft ?? 0);
    if (total === 0) ok('cleanup: 0 residuales (credenciales, doctores, clínicas)');
    else no(`cleanup: residuales → creds=${credsLeft} doctors=${docsLeft} clinics=${clinLeft}`);
  }
}

main().catch((e) => {
  console.error('Error inesperado:', e.message);
  process.exit(1);
});
