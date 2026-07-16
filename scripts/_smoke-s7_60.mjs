/**
 * _smoke-s7_60.mjs — matriz de permisos sobre public.doctors tras el hardening.
 *
 *   node scripts/_smoke-s7_60.mjs
 *
 * Cubre los tres hallazgos que cierra s7_60:
 *   #1 anon lee license_number de médicos publicados
 *   #2 un médico autenticado puede auto-verificarse (lucy_status → is_verified)
 *   #3 un usuario autenticado puede insertarse como médico
 *
 * ── Seguridad de este smoke (leer antes de tocarlo) ──
 * • NO usa service_role. Solo la anon key y una sesión de médico real.
 * • TODAS las pruebas filtran por un UUID inexistente → matchean CERO filas.
 *   El privilegio de columna se evalúa al planificar, ANTES de filtrar filas:
 *   falta el grant → 42501; sobra → 0 filas afectadas. Distingue los dos
 *   estados SIN leer ni escribir un solo dato real.
 * • Por eso NO crea fixtures ni necesita limpieza: no hay residuales posibles.
 * • La sesión usa la cuenta demo (Camilo). Su fila NO se toca en ningún caso.
 *   Jamás Katherine ni datos reales.
 *
 * ── A/B (medido 2026-07-16, contra la DB SIN s7_60 aplicada) ──
 * Este smoke da pass=13 fail=12, reproduciendo los tres hallazgos:
 *   T1  ×4 → anon lee license_number / is_operational / tos_*
 *   T5      → anon puede ejecutar UPDATE
 *   T7-T12  → el médico puede escribir lucy_status, license_number,
 *             is_operational, profile_id, clinic_id, slug
 *   T21     → el grant de INSERT sigue abierto
 * Y ya pasa T13-T20, que son la no-regresión del panel.
 * Tras aplicar s7_60 debe dar pass=25 fail=0.
 *
 * ── Nota sobre T21 y UNIQUE(profile_id) ──
 * Contra la DB actual T21 muere en 23505 (doctors_profile_id_key), no en
 * 23503: existe un UNIQUE sobre profile_id, o sea UNA fila de doctors por
 * perfil. Eso NO mitiga el hallazgo #3 — lo acota a quien todavía no tiene
 * fila, es decir CUALQUIER PACIENTE. Un médico existente no puede duplicarse
 * a sí mismo; un paciente sí puede insertarse como médico. Cualquiera de los
 * dos códigos (23503/23505) prueba lo mismo: la query pasó el control de
 * privilegios. Lo único que cierra el vector es no tener el grant → 42501.
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseAnon } from './_lib/supabase-anon.mjs';

const DOCTOR_PHONE = '+50378627694'; // cuenta demo (Camilo) — Test Phone
const OTP = '123456';
const NOWHERE = '00000000-0000-0000-0000-000000000000';
const DENIED = '42501';

let pass = 0;
let fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const no = (m) => { console.log(`  ❌ ${m}`); fail++; };

async function signInDoctor() {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await client.auth.signInWithOtp({ phone: DOCTOR_PHONE }).catch(() => {});
  const { data, error } = await client.auth.verifyOtp({
    phone: DOCTOR_PHONE, token: OTP, type: 'sms',
  });
  if (error || !data?.session) {
    throw new Error(`No se pudo autenticar la cuenta demo: ${error?.message}`);
  }
  return client;
}

/** UPDATE sobre cero filas: aísla el privilegio de columna. */
async function probeUpdate(client, patch) {
  const { error } = await client.from('doctors').update(patch).eq('id', NOWHERE);
  return error;
}

async function expectDenied(client, patch, label) {
  const error = await probeUpdate(client, patch);
  if (error?.code === DENIED) ok(`${label} → 42501 permission denied`);
  else if (error) no(`${label} → error inesperado ${error.code}: ${error.message}`);
  else no(`${label} → PERMITIDO. El grant sigue abierto (¿migración aplicada?)`);
}

async function expectAllowed(client, patch, label) {
  const error = await probeUpdate(client, patch);
  if (!error) ok(`${label} → permitido (sin regresión)`);
  else if (error.code === DENIED) no(`${label} → 42501. El grant quedó DEMASIADO estrecho: rompe el panel`);
  else no(`${label} → error inesperado ${error.code}: ${error.message}`);
}

async function main() {
  console.log('\n_smoke-s7_60 — matriz de permisos de public.doctors\n');

  // ══ anon ══════════════════════════════════════════════════
  console.log('anon (hallazgo #1 — fuga de credenciales):');
  for (const col of ['license_number', 'is_operational', 'tos_accepted_at', 'tos_version']) {
    const { error } = await supabaseAnon.from('doctors').select(col).eq('id', NOWHERE);
    if (error?.code === DENIED) ok(`T1 anon NO lee ${col}`);
    else if (error) no(`T1 anon ${col}: error inesperado ${error.code}`);
    else no(`T1 anon PUEDE leer ${col} — la fuga sigue abierta`);
  }

  const publicCols =
    'id,slug,profile_id,clinic_id,specialty_id,bio,consultation_fee,' +
    'experience_years,languages,education,is_verified,lucy_status,' +
    'booking_enabled,is_published,created_at,updated_at';
  {
    const { error } = await supabaseAnon.from('doctors').select(publicCols).eq('id', NOWHERE);
    if (!error) ok('T2 anon SÍ lee las 16 columnas del directorio');
    else no(`T2 anon perdió columnas públicas: ${error.code} — ${error.message}`);
  }

  // El directorio real debe seguir cargando (esto sí toca filas publicadas,
  // pero solo columnas públicas — las mismas que ve cualquier visitante).
  {
    const { data, error } = await supabaseAnon
      .from('doctors')
      .select('id,slug,is_verified,booking_enabled')
      .eq('is_published', true)
      .limit(5);
    if (!error && Array.isArray(data) && data.length > 0) {
      ok(`T3 el directorio público sigue cargando (${data.length} filas de muestra)`);
    } else {
      no(`T3 el directorio público se rompió: ${error?.code} — ${error?.message}`);
    }
  }

  console.log('\nanon (escritura):');
  {
    // Asserta el RESULTADO, no el grant: anon nunca satisface doctors_insert
    // (auth.uid() es NULL) → la RLS ya lo bloquea hoy. No-regresión.
    // El grant de INSERT se prueba de verdad en T21.
    const { error } = await supabaseAnon
      .from('doctors')
      .insert({ profile_id: NOWHERE, clinic_id: NOWHERE });
    if (error) ok(`T4 anon NO puede insertar (${error.code}; hoy vía RLS, tras s7_60 también vía grants)`);
    else no('T4 anon PUDO insertar — CRÍTICO');
  }
  {
    const error = await probeUpdate(supabaseAnon, { bio: 'probe' });
    if (error) ok(`T5 anon NO puede actualizar (${error.code})`);
    else no('T5 anon PUDO actualizar — el grant sigue abierto');
  }

  // ══ médico autenticado ════════════════════════════════════
  console.log('\nmédico autenticado (hallazgo #2 — auto-verificación):');
  let doctor;
  try {
    doctor = await signInDoctor();
    ok('T6 sesión de médico establecida (cuenta demo)');
  } catch (e) {
    no(`T6 ${e.message}`);
    console.log(`\n❌ _smoke-s7_60: pass=${pass} fail=${fail}\n`);
    process.exit(1);
  }

  // Lo que NO debe poder escribir
  await expectDenied(doctor, { lucy_status: 'verified' }, 'T7  UPDATE lucy_status (auto-verificarse)');
  await expectDenied(doctor, { license_number: 'FAKE-000' }, 'T8  UPDATE license_number');
  await expectDenied(doctor, { is_operational: true }, 'T9  UPDATE is_operational');
  await expectDenied(doctor, { profile_id: NOWHERE }, 'T10 UPDATE profile_id');
  await expectDenied(doctor, { clinic_id: NOWHERE }, 'T11 UPDATE clinic_id');
  await expectDenied(doctor, { slug: 'fake-slug' }, 'T12 UPDATE slug');

  // Lo que SÍ debe seguir pudiendo (o rompemos el panel)
  console.log('\nmédico autenticado (sin regresión — el panel debe seguir funcionando):');
  await expectAllowed(doctor, { bio: 'probe' }, 'T13 UPDATE bio');
  await expectAllowed(doctor, { specialty_id: NOWHERE }, 'T14 UPDATE specialty_id');
  await expectAllowed(doctor, { experience_years: 1 }, 'T15 UPDATE experience_years');
  await expectAllowed(doctor, { consultation_fee: 1 }, 'T16 UPDATE consultation_fee');
  await expectAllowed(doctor, { languages: ['Español'] }, 'T17 UPDATE languages');
  await expectAllowed(doctor, { is_published: true }, 'T18 UPDATE is_published');
  await expectAllowed(doctor, { booking_enabled: true }, 'T19 UPDATE booking_enabled');
  await expectAllowed(doctor, { updated_at: new Date().toISOString() }, 'T20 UPDATE updated_at');

  // ─── T21: INSERT (hallazgo #3), probado de verdad ─────────
  // Para aislar el GRANT hay que satisfacer la policy doctors_insert
  // (WITH CHECK profile_id = auth.uid()) → usamos el uid propio. Y para que
  // NO se cree ninguna fila, el clinic_id apunta a nada: la FK revienta.
  //   • grant abierto  → la query se ejecuta y muere en la FK (23503) o en
  //                      un UNIQUE (23505). Nada se inserta.
  //   • grant revocado → muere antes, al planificar (42501).
  // Un profile_id inexistente NO sirve acá: la RLS lo bloquearía con 42501
  // aunque el grant estuviera abierto, y el test pasaría por el motivo
  // equivocado.
  {
    const { data: { user } } = await doctor.auth.getUser();
    const { error } = await doctor
      .from('doctors')
      .insert({ profile_id: user.id, clinic_id: NOWHERE });
    if (error?.code === DENIED) {
      ok('T21 médico NO puede insertar en doctors (42501 — sin grant de INSERT)');
    } else if (error) {
      no(`T21 médico CONSERVA el grant de INSERT: la query se ejecutó y murió en ${error.code} (${error.message}). El hallazgo #3 sigue abierto`);
    } else {
      no('T21 médico PUDO insertar en doctors — CRÍTICO');
    }
  }

  // Riesgo residual documentado (→ PR-B): authenticated conserva SELECT.
  {
    const { error } = await doctor.from('doctors').select('license_number').eq('id', NOWHERE);
    if (!error) {
      ok('T22 authenticated conserva SELECT license_number — riesgo residual esperado (PR-B); el panel y la receta lo necesitan');
    } else {
      no(`T22 authenticated perdió SELECT license_number: rompe el panel y el "JVPM:" de la receta (${error.code})`);
    }
  }

  await doctor.auth.signOut().catch(() => {});

  console.log(`\n${fail === 0 ? '✅' : '❌'} _smoke-s7_60: pass=${pass} fail=${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Error inesperado:', e);
  process.exit(1);
});
