/**
 * check-s7_66.mjs — AUTH-P1B1B(A): verificación de las RPCs de reserva por intent.
 *
 *   node scripts/check-s7_66.mjs            # SOLO análisis estático (sin DB)
 *   node scripts/check-s7_66.mjs --runtime  # + denegaciones runtime (requiere
 *                                            #   s7_66 APLICADA; usa anon + una
 *                                            #   sesión de Test Phone)
 *
 * ── DOS PARTES ──
 *  A) ESTÁTICA (por defecto, SIN DB, SIN service_role): lee el .sql de la
 *     migración, quita comentarios y valida la superficie que NO se puede leer
 *     como anon: matriz completa de GRANT/REVOKE por función y rol (incl.
 *     service_role/supabase_auth_admin/directory_editor/operations_admin),
 *     SECURITY DEFINER, search_path='', referencias calificadas, fase/origen de
 *     grilla, error público genérico P009F, código independiente del tope de
 *     intents (P009G), conteo unido a grants vigentes, campos obligatorios de
 *     patients/appointments, validación de nombre/notas, y appointments_insert
 *     intacto (no lo toca la migración).
 *  B) RUNTIME (solo con --runtime, requiere s7_66 aplicada): confirma el
 *     comportamiento de anon/authenticated contra la DB. La matriz de EXECUTE
 *     para los roles administrativos se verifica de forma ESTÁTICA aquí y con la
 *     query A2 de docs/OWNER_S7_66_APPLY.md (las claves EXECUTE por rol no son
 *     legibles como anon).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_PATH = join(__dirname, '..', 'migrations', 's7_66_booking_intent_transaction.sql');

const RUNTIME = process.argv.includes('--runtime');

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const no = (m) => { console.log(`  ❌ ${m}`); fail++; };
const assert = (cond, okMsg, noMsg) => (cond ? ok(okMsg) : no(noMsg ?? okMsg));

// Firmas exactas (idénticas a las del .sql).
const SIG_VALIDATE = 'validate_booking_slot(uuid, uuid, timestamp without time zone)';
const SIG_REGISTER = 'register_booking_intent(uuid, uuid, timestamp without time zone, text)';
const SIG_CREATE   = 'create_booking_with_intent(uuid, text, text)';
const ADMIN_ROLES  = ['service_role', 'supabase_auth_admin', 'directory_editor', 'operations_admin', 'PUBLIC'];

// ─────────────────────────── PARTE A: ESTÁTICA ───────────────────────────
function staticChecks() {
  console.log('\ncheck-s7_66 — A) análisis estático del SQL (sin DB)\n');

  const raw = readFileSync(SQL_PATH, 'utf8');
  // Quitar comentarios de línea (`-- …`); ningún literal contiene `--`.
  const code = raw.replace(/--[^\n]*/g, '');
  const has = (s) => code.includes(s);
  const countOf = (re) => (code.match(re) || []).length;

  const grantTo = (sig, role) => has(`GRANT EXECUTE ON FUNCTION public.${sig} TO ${role}`);
  const revokeFrom = (sig, role) => has(`REVOKE ALL ON FUNCTION public.${sig} FROM ${role}`);

  // 1. Las 3 funciones definidas, SECURITY DEFINER en las 3, y search_path POR
  //    FUNCIÓN: validate/register = '' ; create = pg_catalog, public, pg_temp
  //    (excepción necesaria: create escribe en patients → trigger audit_patients
  //    legacy que hereda el search_path del caller).
  assert(has('CREATE OR REPLACE FUNCTION public.validate_booking_slot')
      && has('CREATE OR REPLACE FUNCTION public.register_booking_intent')
      && has('CREATE OR REPLACE FUNCTION public.create_booking_with_intent'),
    'las 3 funciones se definen (CREATE OR REPLACE)');
  assert(countOf(/SECURITY DEFINER/g) === 3, 'SECURITY DEFINER en las 3 funciones',
    `SECURITY DEFINER esperado ×3; encontrado ×${countOf(/SECURITY DEFINER/g)}`);
  const fnHeader = (name) => {
    const start = code.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
    const bodyAt = code.indexOf('AS $$', start);
    return start >= 0 && bodyAt > start ? code.slice(start, bodyAt) : '';
  };
  assert(fnHeader('validate_booking_slot').includes("SET search_path = ''"),
    "validate_booking_slot: SET search_path = '' (read-only, sin triggers)");
  assert(fnHeader('register_booking_intent').includes("SET search_path = ''"),
    "register_booking_intent: SET search_path = '' (tablas no auditadas)");
  assert(fnHeader('create_booking_with_intent').includes('SET search_path = pg_catalog, public, pg_temp')
      && !fnHeader('create_booking_with_intent').includes("SET search_path = ''"),
    'create_booking_with_intent: SET search_path = pg_catalog, public, pg_temp (NO vacío — evita 42P01 del trigger audit_patients)');

  // 2. Referencias calificadas: sin tablas public.* sin calificar.
  const TABLES = 'doctors|services|availability_rules|availability_overrides|appointments|appointment_statuses|patients|booking_intents|auth_creation_grants';
  const unqualified = code.match(new RegExp(`\\b(from|join|update)\\s+(?!public\\.)(?:${TABLES})\\b`, 'ig')) || [];
  assert(unqualified.length === 0, 'referencias a tablas 100% calificadas con public.',
    `referencias sin calificar: ${JSON.stringify(unqualified)}`);

  // 3. Matriz de permisos.
  // 3a. validate: helper interno → NINGÚN GRANT EXECUTE (a ningún rol).
  assert(!has('GRANT EXECUTE ON FUNCTION public.validate_booking_slot'),
    'validate_booking_slot: sin GRANT EXECUTE a ningún rol (helper interno)',
    'validate_booking_slot NO debe tener GRANT EXECUTE — helper interno');
  // 3b. validate: REVOKE explícito de todos los roles.
  assert(['PUBLIC', 'anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'directory_editor', 'operations_admin']
      .every((r) => revokeFrom(SIG_VALIDATE, r)),
    'validate_booking_slot: REVOKE explícito de PUBLIC/anon/authenticated/service_role/supabase_auth_admin/directory_editor/operations_admin');
  // 3c. register: GRANT solo anon + authenticated; REVOKE de todos.
  assert(grantTo(SIG_REGISTER, 'anon') && grantTo(SIG_REGISTER, 'authenticated'),
    'register_booking_intent: GRANT EXECUTE a anon + authenticated');
  assert(ADMIN_ROLES.every((r) => !grantTo(SIG_REGISTER, r)),
    'register_booking_intent: SIN GRANT a service_role/supabase_auth_admin/directory_editor/operations_admin/PUBLIC');
  assert(['PUBLIC', 'anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'directory_editor', 'operations_admin']
      .every((r) => revokeFrom(SIG_REGISTER, r)),
    'register_booking_intent: REVOKE explícito de los 7 roles antes del GRANT');
  // 3d. create: GRANT solo authenticated; REVOKE de todos (incl. anon).
  assert(grantTo(SIG_CREATE, 'authenticated'),
    'create_booking_with_intent: GRANT EXECUTE a authenticated');
  assert(!grantTo(SIG_CREATE, 'anon') && ADMIN_ROLES.every((r) => !grantTo(SIG_CREATE, r)),
    'create_booking_with_intent: SIN GRANT a anon/service_role/supabase_auth_admin/directory_editor/operations_admin/PUBLIC');
  assert(['PUBLIC', 'anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'directory_editor', 'operations_admin']
      .every((r) => revokeFrom(SIG_CREATE, r)),
    'create_booking_with_intent: REVOKE explícito de los 7 roles antes del GRANT');
  // 3e. Guard de existencia para los access_level (no son roles de Postgres).
  assert(has("pg_roles WHERE rolname = 'directory_editor'") && has("pg_roles WHERE rolname = 'operations_admin'"),
    'REVOKE de directory_editor/operations_admin guardado por pg_roles (apply-safe)');

  // 4. Fase/origen de grilla.
  assert(has('EXTRACT(EPOCH FROM r.start_time) / 60') && has('mod(') && has('AS phase') && has('v_distinct_grids'),
    'ambigüedad de grilla por (slot_duration_min, phase) — detecta slot y fase distintos');

  // 5. Error público genérico P009F en register (captura los específicos).
  const SPECIFIC = ["'P009C'", "'P009D'", "'P009E'", "'P0097'", "'P0098'", "'P0099'", "'P009B'"];
  assert(has('EXCEPTION') && SPECIFIC.every((c) => code.includes(`SQLSTATE ${c}`)) && has("ERRCODE = 'P009F'"),
    'register genériza P009C/P009D/P009E/P0097/P0098/P0099/P009B → P009F (público)');
  // validate mantiene los códigos internos específicos.
  assert(SPECIFIC.every((c) => code.includes(`ERRCODE = ${c}`)),
    'validate_booking_slot conserva sus códigos internos específicos (P009C…P0099/P009B)');

  // 6. Tope de intents con código independiente P009G (no reutiliza P009B).
  assert(has("Demasiadas reservas en curso. Esperá unos minutos.' USING ERRCODE = 'P009G'"),
    'tope de intents usa P009G (código independiente, no P009B)');

  // 7. Conteo del tope unido a grants vigentes.
  const grantJoin = /count\(\*\)\s+INTO\s+v_open_cnt[\s\S]*?EXISTS\s*\([\s\S]*?auth_creation_grants[\s\S]*?flow\s*=\s*'booking'[\s\S]*?revoked_at\s+IS\s+NULL[\s\S]*?expires_at\s*>\s*now\(\)/i;
  assert(grantJoin.test(code),
    'el conteo del tope solo cuenta intents con grant booking vigente/no-revocado');

  // 8. Campos obligatorios de patients y appointments (INSERT del create).
  const PAT_COLS = ['profile_id', 'clinic_id', 'full_name', 'phone', 'document_type', 'document_number', 'date_of_birth', 'gender', 'patient_type', 'link_confirmed_at'];
  const patInsert = /INSERT INTO public\.patients\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/i.exec(code);
  assert(patInsert && PAT_COLS.every((c) => patInsert[1].includes(c))
      && ["'dui'", "'2000-01-01'", "'otro'", "'privado'"].every((v) => patInsert[2].includes(v)),
    'INSERT patients: profile_id/clinic_id/full_name/phone/document_type/document_number/date_of_birth/gender/patient_type/link_confirmed_at + dui/2000-01-01/otro/privado');
  const APT_COLS = ['clinic_id', 'doctor_id', 'patient_id', 'service_id', 'status_id', 'start_time', 'end_time', 'source', 'notes', 'payment_status'];
  const aptInsert = /INSERT INTO public\.appointments\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/i.exec(code);
  assert(aptInsert && APT_COLS.every((c) => aptInsert[1].includes(c))
      && aptInsert[2].includes("'lucy_directorio'") && aptInsert[2].includes("'pending'"),
    'INSERT appointments: clinic/doctor/patient/service/status/start/end/source/notes/payment + lucy_directorio/pending');

  // 9. Validación de nombre y notas (códigos diferenciados, sin truncar).
  assert(has("ERRCODE = 'P009H'") && has("ERRCODE = 'P009I'") && has("ERRCODE = 'P009J'")
      && has('char_length(v_name) > 150') && has('char_length(v_notes) > 2000'),
    'nombre/notas: P009H (requerido) / P009I (>150) / P009J (>2000), sin truncado silencioso');

  // 10. appointments_insert (y toda la RLS/grants de appointments) intacto.
  assert(!/appointments_insert/i.test(code), 'la migración NO menciona appointments_insert (additive)');
  assert(!/(create|alter|drop)\s+policy/i.test(code), 'la migración NO crea/altera/borra políticas RLS');
  assert(!new RegExp(`(GRANT|REVOKE)[^;]*\\bON\\s+(TABLE\\s+)?public\\.appointments\\b`, 'i').test(code),
    'la migración NO toca grants de la tabla appointments');
  assert(!/ALTER\s+TABLE\s+public\.appointments\b/i.test(code), 'la migración NO altera la tabla appointments');
}

// ─────────────────────────── PARTE B: RUNTIME ────────────────────────────
async function runtimeChecks() {
  console.log('\ncheck-s7_66 — B) denegaciones runtime (requiere s7_66 aplicada)\n');
  const { createClient } = await import('@supabase/supabase-js');
  const { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseAnon } = await import('./_lib/supabase-anon.mjs');

  const DOCTOR_PHONE = '+50378627694'; // Camilo — solo para OBTENER una sesión authenticated
  const OTP = '123456';
  const NOWHERE = '00000000-0000-0000-0000-000000000000';

  // 1. register: anon ejecuta; teléfono inválido → P0095.
  {
    const { error } = await supabaseAnon.rpc('register_booking_intent', {
      p_doctor_id: NOWHERE, p_service_id: NOWHERE, p_start_local: '2999-01-01T09:00:00', p_phone: 'no-es-telefono',
    });
    if (error?.code === 'P0095') ok('register ejecutable por anon y rechaza teléfono inválido (P0095)');
    else if (error?.code === 'PGRST202') { no('register no existe (PGRST202) — ¿s7_66 sin aplicar? corré sin --runtime'); return; }
    else if (error?.code === '42501') no('anon NO puede ejecutar register — debe poder (pre-OTP)');
    else no(`register: esperado P0095; recibido ${error?.code} ${error?.message}`);
  }
  // 2. create: anon DENEGADO.
  {
    const { error } = await supabaseAnon.rpc('create_booking_with_intent', { p_intent_id: NOWHERE, p_patient_name: 'x' });
    if (error && !['PGRST202', 'P0092', '28000'].includes(error.code)) ok(`create denegado a anon (${error.code})`);
    else no(`create: anon no fue denegado (${error?.code ?? 'sin error'}) — CRÍTICO`);
  }
  // 3. validate: helper interno, sin EXECUTE para anon.
  {
    const { error } = await supabaseAnon.rpc('validate_booking_slot', { p_doctor_id: NOWHERE, p_service_id: NOWHERE, p_start_local: '2999-01-01T09:00:00' });
    if (error) ok(`validate no ejecutable por anon (${error.code})`);
    else no('validate ejecutada por anon — helper interno, CRÍTICO');
  }
  // 4. authenticated: create llega a la lógica; validate denegado.
  {
    const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    await auth.auth.signInWithOtp({ phone: DOCTOR_PHONE }).catch(() => {});
    const { error: authErr } = await auth.auth.verifyOtp({ phone: DOCTOR_PHONE, token: OTP, type: 'sms' });
    if (authErr) { no(`no se pudo obtener sesión authenticated: ${authErr.message}`); return; }
    const { error: cErr } = await auth.rpc('create_booking_with_intent', { p_intent_id: NOWHERE, p_patient_name: 'x' });
    if (cErr && ['P0092', 'P0095'].includes(cErr.code)) ok(`create ejecutable por authenticated (llega a la lógica: ${cErr.code})`);
    else if (cErr?.code === '42501') no('authenticated NO puede ejecutar create — debe poder');
    else ok(`create corre para authenticated (código ${cErr?.code ?? 'ok'})`);
    const { error: vErr } = await auth.rpc('validate_booking_slot', { p_doctor_id: NOWHERE, p_service_id: NOWHERE, p_start_local: '2999-01-01T09:00:00' });
    if (vErr) ok(`validate denegado a authenticated (${vErr.code})`);
    else no('validate ejecutada por authenticated — helper interno, CRÍTICO');
    await auth.auth.signOut().catch(() => {});
  }
  // 5. no-regresión: anon sin acceso a las tablas de s7_65.
  for (const t of ['booking_intents', 'auth_creation_grants']) {
    const { error } = await supabaseAnon.from(t).select('id').limit(1);
    if (error) ok(`${t} sin acceso para anon (${error.code})`);
    else no(`anon accedió a ${t} — CRÍTICO`);
  }
}

async function main() {
  staticChecks();
  if (RUNTIME) await runtimeChecks();
  else console.log('\nℹ Runtime OMITIDO (sin --runtime). La matriz EXECUTE de roles administrativos se validó estáticamente; para las denegaciones runtime corré con --runtime tras aplicar s7_66.');
  console.log(`\n${fail === 0 ? '✅' : '❌'} check-s7_66: pass=${pass} fail=${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Error inesperado:', e.message); process.exit(1); });
