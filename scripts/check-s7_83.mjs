#!/usr/bin/env node
/**
 * check-s7_83.mjs — DOCTOR-WELCOME-EMAIL-P0.
 *
 * Dos mitades:
 *
 *  A) ESTÁTICA sobre `migrations/s7_83_doctor_welcome_email.sql`. Los cuerpos
 *     de función se miden SIN COMENTARIOS: `pg_proc.prosrc` los incluye, y ya
 *     costó caro una vez (s7_82) que una guarda SQL y su gemela en JS
 *     normalizaran distinto. Acá se normaliza igual en ambos lados.
 *
 *  B) CONDUCTUAL sobre `supabase/functions/send-doctor-welcome-email/render.ts`:
 *     se transpila el módulo REAL con esbuild y se ejecuta. No se lee su texto.
 *
 * Incluye MUTATION TESTS con expectativa invertida: mutaciones legítimas que
 * el check NO debe cazar. Sin ellas no se detectan los falsos positivos.
 *
 *   node scripts/check-s7_83.mjs
 *
 * No toca la base de datos ni la red.
 */
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const esbuildBin = path.join(path.dirname(require.resolve('esbuild/package.json')), 'bin', 'esbuild');

let pass = 0, fail = 0;
const check = (label, actual, esperado) => {
  const ok = actual === esperado;
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         esperaba: ${JSON.stringify(esperado)}\n         obtuvo  : ${JSON.stringify(actual)}`); }
};
const has = (label, hay, needle) => check(label, hay.includes(needle), true);
const hasNot = (label, hay, needle) => check(label, hay.includes(needle), false);

console.log('\ncheck-s7_83 — correo de bienvenida al médico\n');

// ═══════════════════════════════════════════════════════════
// A · MIGRACIÓN
// ═══════════════════════════════════════════════════════════
/**
 * Lee normalizando los finales de línea a LF.
 *
 * En Windows `core.autocrlf=true` deja los `.sql` con CRLF en el working tree,
 * mientras que en git el blob está en LF. Sin esta normalización, las
 * aserciones ancladas en `\n` fallan en un checkout y pasan en otro — el mismo
 * check daría resultados distintos según la máquina. Es la deuda ya registrada
 * para `check-s7_76`; acá se cierra en origen.
 */
const leerLFDe = (s) => s.split('\r\n').join('\n');
const leerLF = (p) => leerLFDe(fs.readFileSync(p, 'utf8'));

const SQL_PATH = path.join('migrations', 's7_83_doctor_welcome_email.sql');
const sqlRaw = leerLF(SQL_PATH);

/** Quita comentarios de línea y de bloque. MISMA normalización que usaría una guarda SQL. */
function stripSqlComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}
const sql = stripSqlComments(sqlRaw);

console.log('A · migración');

// ── Columnas exactas: las cinco acordadas, ni una más ──
for (const col of [
  'welcome_status', 'welcome_first_attempt_at', 'welcome_last_attempt_at',
  'welcome_sent_at', 'welcome_last_error_code',
]) {
  has(`columna ${col}`, sql, `ADD COLUMN IF NOT EXISTS ${col}`);
}
check('exactamente 5 columnas nuevas', (sql.match(/ADD COLUMN IF NOT EXISTS/g) || []).length, 5);

// La outbox NO se replica: este frente vive sobre la solicitud.
hasNot('sin tabla outbox nueva', sql, 'CREATE TABLE');
hasNot('sin pg_net', sql, 'net.http_post');
hasNot('sin trigger', sql, 'CREATE TRIGGER');
hasNot('sin Vault', sql, 'vault');
hasNot('sin pg_cron', sql, 'cron.schedule');

// No se tocan los frentes cerrados.
for (const forbidden of [
  'doctor_owner_notifications', 'notify_owner_claim_batch', 'notify_owner_mark_result',
  'claim_doctor_profile', 'admin_set_doctor_published', 'set_doctor_slug',
  'admin_list_affiliation_requests', 'DROP FUNCTION',
]) {
  hasNot(`no toca ${forbidden}`, sql, forbidden);
}

// ── Estados ──
has('CHECK de estados', sql, "welcome_status IN ('not_sent', 'sending', 'sent', 'failed')");
hasNot('sin skipped_no_email', sql, 'skipped_no_email');

// ── Guardas de forma ──
for (const c of [
  'dar_welcome_status_chk', 'dar_welcome_sent_shape', 'dar_welcome_sending_shape',
  'dar_welcome_failed_shape', 'dar_welcome_attempt_order', 'dar_welcome_not_sent_shape',
]) {
  has(`constraint ${c}`, sql, c);
}

// ── Las tres RPCs + el helper ──
const FUNCS = [
  'public._welcome_email_claimable',
  'public.admin_welcome_email_state',
  'public.admin_welcome_email_claim',
  'public.admin_welcome_email_mark',
];
for (const f of FUNCS) {
  has(`crea ${f}`, sql, `CREATE OR REPLACE FUNCTION ${f}`);
  has(`${f}: search_path fijo`, sql.split(`CREATE OR REPLACE FUNCTION ${f}`)[1] ?? '', 'SET search_path = public');
}

// ── Gate: las TRES RPCs admin gatean con is_admin(), igual que el resto de
//    afiliaciones. Se cuenta sobre el SQL SIN comentarios para que un
//    comentario que nombre is_admin() no lo dé por bueno.
check('is_admin() en las 3 RPCs admin', (sql.match(/IF NOT is_admin\(\) THEN/g) || []).length, 3);
check('P0160 en las 3 RPCs admin', (sql.match(/ERRCODE = 'P0160'/g) || []).length, 3);

// ── Privilegios explícitos de los cuatro roles ──
for (const f of FUNCS) {
  const sig = f === 'public._welcome_email_claimable'
    ? `${f}(text, timestamptz, timestamptz)`
    : f === 'public.admin_welcome_email_mark'
      ? `${f}(uuid, text, text)`
      : `${f}(uuid)`;
  has(`REVOKE PUBLIC de ${f}`, sql, `REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC`);
  has(`REVOKE anon de ${f}`, sql, `REVOKE ALL ON FUNCTION ${sig} FROM anon`);
  has(`REVOKE service_role de ${f}`, sql, `REVOKE ALL ON FUNCTION ${sig} FROM service_role`);
  has(`GRANT authenticated a ${f}`, sql, `GRANT EXECUTE ON FUNCTION ${sig} TO authenticated`);
}

// ── El reclamo lleva TODOS los gates en el WHERE del UPDATE ──
const claimBody = (sql.split('FUNCTION public.admin_welcome_email_claim')[1] ?? '')
  .split('REVOKE ALL')[0] ?? '';
for (const gate of [
  'd.id  = ar.doctor_id',
  "coalesce(btrim(ar.email), '') <> ''",
  'd.is_published = true',
  'd.slug IS NOT NULL',
  "d.lucy_status = 'listed_only'",
  '_welcome_email_claimable(',
]) {
  has(`claim gatea: ${gate}`, claimBody, gate);
}
has('claim: first_attempt_at nunca se reescribe', claimBody, 'coalesce(ar.welcome_first_attempt_at, now())');
has('claim: last_attempt_at siempre se actualiza', claimBody, 'welcome_last_attempt_at  = now()');
hasNot('claim NO usa profiles.email', claimBody, 'p.email');

// ── Ventanas ──
const winBody = (sql.split('FUNCTION public._welcome_email_claimable')[1] ?? '').split('REVOKE ALL')[0] ?? '';
has('ventana de 23 h', winBody, "interval '23 hours'");
has('espera de 10 minutos para sending', winBody, "interval '10 minutes'");
has("sent nunca se reclama", winBody, "WHEN p_status = 'sent'     THEN false");

// ── mark: solo transiciona desde sending y sanea el código ──
const markBody = (sql.split('FUNCTION public.admin_welcome_email_mark')[1] ?? '').split('REVOKE ALL')[0] ?? '';
has('mark: solo desde sending', markBody, "AND welcome_status = 'sending'");
has('mark: código acotado', markBody, "'^[a-z0-9_]{1,40}$'");
has('mark: rechaza estados fuera de contrato', markBody, "P0162");

// ── MUTATION TESTS de la mitad estática ──
console.log('\nA.bis · mutation tests de la migración');
{
  // Debe CAZAR: quitar un gate del claim.
  const mutado = sqlRaw.replace('AND d.is_published = true', '');
  const b = (stripSqlComments(mutado).split('FUNCTION public.admin_welcome_email_claim')[1] ?? '').split('REVOKE ALL')[0] ?? '';
  check('caza la pérdida del gate is_published', b.includes('d.is_published = true'), false);

  // Debe CAZAR: is_admin() nombrado solo en un comentario.
  const soloComentario = sqlRaw.replace('  IF NOT is_admin() THEN\n    RAISE EXCEPTION \'No autorizado\' USING ERRCODE = \'P0160\';\n  END IF;', '  -- IF NOT is_admin() THEN ... END IF;');
  check('caza is_admin() degradado a comentario',
    (stripSqlComments(soloComentario).match(/IF NOT is_admin\(\) THEN/g) || []).length, 2);

  // EXPECTATIVA INVERTIDA: reformatear un comentario NO debe alterar nada.
  const soloComentarioNuevo = sqlRaw.replace('-- ─── 1. Estado de la bienvenida, sobre la solicitud de afiliación ───────', '-- 1. estado');
  check('NO caza un cambio solo de comentario',
    stripSqlComments(soloComentarioNuevo) === sql, true);

  // EXPECTATIVA INVERTIDA: cambiar espacios en blanco fuera de las guardas.
  const espacios = sqlRaw.replace('\n\n-- ─── 2. Ventanas', '\n\n\n-- ─── 2. Ventanas');
  check('NO caza un cambio de espaciado',
    (stripSqlComments(espacios).match(/IF NOT is_admin\(\) THEN/g) || []).length, 3);
}

// ═══════════════════════════════════════════════════════════
// B · RENDER (conductual: se ejecuta el módulo real)
// ═══════════════════════════════════════════════════════════
console.log('\nB · render del correo (módulo real transpilado)');

const cacheDir = path.join('node_modules', '.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const outFile = path.join(cacheDir, 's7_83-render.mjs');
// Se invoca a TRAVÉS de Node: en Windows el `bin/esbuild` es un script con
// shebang, no un ejecutable, y `execFileSync` directo da ENOENT.
execFileSync(process.execPath, [
  esbuildBin,
  path.join('supabase', 'functions', 'send-doctor-welcome-email', 'render.ts'),
  '--bundle', '--format=esm', '--platform=neutral', `--outfile=${outFile}`,
], { stdio: 'pipe' });

const { renderWelcomeEmail, displayName, publicProfileUrl } = await import(pathToFileURL(path.resolve(outFile)).href);

// ── El tratamiento NUNCA se infiere. Si el nombre lo trae, se respeta; si no,
//    se usa tal cual. Anteponer "Dr." implicaría un sexo que el dato no tiene.
check('nombre con Dr. → se conserva', displayName('Dr. Harold Trillos'), 'Dr. Harold Trillos');
check('nombre con Dra. → se conserva el femenino', displayName('Dra. Pamela Bolaños'), 'Dra. Pamela Bolaños');
check('nombre SIN tratamiento → tal cual', displayName('Elba Angélica Lobo'), 'Elba Angélica Lobo');
check('"Drago" NO es tratamiento', displayName('Drago Pérez'), 'Drago Pérez');
check('espacios colapsados', displayName('  Elba   Lobo  '), 'Elba Lobo');
check('no se infiere tratamiento en minúsculas', displayName('elba lobo'), 'elba lobo');

// ── URL: dominio literal, jamás un origen recibido ──
check('URL pública canónica', publicProfileUrl('dr-harold-trillos'), 'https://lucycare.app/doctor/dr-harold-trillos');

const { subject, text } = renderWelcomeEmail({ name: 'Dr. Harold Trillos', slug: 'dr-harold-trillos' });
check('asunto aprobado', subject, 'Bienvenido a LucyCare, Dr. Harold Trillos');
has('saludo', text, 'Hola, Dr. Harold Trillos:');

// Sin tratamiento: el asunto y el saludo no lo inventan.
{
  const r = renderWelcomeEmail({ name: 'Elba Angélica Lobo', slug: 'elba-angelica-lobo' });
  check('asunto sin tratamiento', r.subject, 'Bienvenido a LucyCare, Elba Angélica Lobo');
  has('saludo sin tratamiento', r.text, 'Hola, Elba Angélica Lobo:');
  hasNot('no aparece "Dr." inventado', r.text, 'Dr. Elba');
}
has('enlace al perfil', text, 'https://lucycare.app/doctor/dr-harold-trillos');
has('CTA literal del perfil', text, '"¿Eres este profesional?"');
has('guía para empezar', text, 'https://medicos.lucycare.app/medicos/empezar');
has('firma', text, 'LucyCare para Médicos');

// ── Nada sensible en el cuerpo ──
for (const forbidden of ['JVPM', 'licencia', 'DUI', 'OTP', 'contraseña', 'token', 'service_role']) {
  hasNot(`sin ${forbidden} en el cuerpo`, text, forbidden);
}
// Control de sanidad: la sonda SÍ distingue. Si esto fallara, los `hasNot`
// de arriba no probarían nada.
has('control de sanidad: la sonda detecta lo que sí está', text, 'Bienvenido a LucyCare.');

// ═══════════════════════════════════════════════════════════
// A/B LF vs CRLF — el check debe dar LO MISMO con ambos finales
// ═══════════════════════════════════════════════════════════
console.log('\nA/B finales de línea');
{
  const crlf = sqlRaw.split('\n').join('\r\n');
  check('CRLF normalizado === LF', leerLFDe(crlf) === sqlRaw, true);

  const cuentaAdmin = (t) => (stripSqlComments(t).match(/IF NOT is_admin\(\) THEN/g) || []).length;
  check('is_admin() se cuenta igual bajo CRLF', cuentaAdmin(leerLFDe(crlf)), cuentaAdmin(sqlRaw));
  check('las 5 columnas se cuentan igual bajo CRLF',
    (stripSqlComments(leerLFDe(crlf)).match(/ADD COLUMN IF NOT EXISTS/g) || []).length, 5);

  // CONTROL DE SANIDAD: el texto con CRLF SIN normalizar es distinto del
  // original. Si esto fallara, el A/B no estaría midiendo nada.
  check('control: CRLF sin normalizar difiere del original', crlf === sqlRaw, false);
}

// ═══════════════════════════════════════════════════════════
// C · EDGE FUNCTION (estática, sobre el archivo real)
// ═══════════════════════════════════════════════════════════
console.log('\nC · Edge Function');
const ef = leerLF(path.join('supabase', 'functions', 'send-doctor-welcome-email', 'index.ts'));
const efCode = ef.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

has('From aprobado', efCode, "from: 'LucyCare para Médicos <medicos@lucycare.app>'");
has('Reply-To aprobado', efCode, "reply_to: 'medicos@lucycare.app'");
has('Idempotency-Key = id de la solicitud', efCode, "'Idempotency-Key': requestId");
has('contrato de entrada de un solo campo', efCode, "payload['affiliation_request_id']");
has('reutiliza RESEND_API_KEY', efCode, "Deno.env.get('RESEND_API_KEY')");
has('credencial en formato nuevo', efCode, "runtimeKey('SUPABASE_PUBLISHABLE_KEYS'");

// Sin service_role en ninguna forma: este flujo no lo necesita.
hasNot('sin SUPABASE_SECRET_KEYS', efCode, 'SUPABASE_SECRET_KEYS');
hasNot('sin service_role', efCode, 'service_role');
hasNot('sin SUPABASE_SERVICE_ROLE_KEY legacy', efCode, 'SUPABASE_SERVICE_ROLE_KEY');
hasNot('sin SUPABASE_ANON_KEY legacy', efCode, 'SUPABASE_ANON_KEY');
// El destinatario NUNCA viene del navegador.
hasNot('no acepta email del cliente', efCode, "payload['email']");
hasNot('no acepta slug del cliente', efCode, "payload['slug']");
has('el destinatario sale del claim', efCode, 'to: [claim.email]');

console.log(`\n${pass} ok · ${fail} FAIL   (${pass}/${pass + fail})\n`);
process.exit(fail === 0 ? 0 : 1);
