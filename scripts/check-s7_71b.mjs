/**
 * check-s7_71b.mjs — AUDIT-SEC-P0 · PR 2: cierre de la escritura arbitraria
 * sobre `audit_log`.
 *
 *   node scripts/check-s7_71b.mjs
 *
 * Verificación ESTRUCTURAL del texto de la migración, de su rollback y del
 * retiro del escritor de frontend. SIN red, SIN Supabase, SIN service_role,
 * SIN datos.
 *
 * ⚠️ LA MIGRACIÓN YA FUE APLICADA MANUALMENTE EN PRODUCCIÓN antes de este PR.
 * El archivo versionado es el texto EFECTIVO que se ejecutó, sin retoques
 * posteriores. Por eso este check incluye una aserción de CHECKSUM: si alguien
 * "mejora" la migración después, deja de coincidir con lo aplicado y el check
 * falla. Esa es la garantía de que el repo refleja producción.
 *
 * ⚠️ DISTINCIÓN IMPORTANTE. El preflight que realmente se ejecutó comprueba
 * SEIS invariantes (§ "preflight aplicado"). Las verificaciones más estrictas
 * —43 escritores, todos con owner postgres, ACL baseline, exactamente dos
 * llamadores del helper, FORCE RLS=false— se hicieron por CATÁLOGO en la
 * Fase A y en la verificación post-apply, NO por el preflight. Este check no
 * afirma lo contrario.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

/**
 * ¿El archivo está REALMENTE versionado en git?
 *
 * `.gitignore` ignora `*.sql` con una única excepción, `!migrations/*.sql`.
 * `docs/rollbacks/` NO está exceptuado, así que el rollback solo entra al
 * repositorio con `git add -f`. Sin esta comprobación, el archivo existe en
 * disco, el check pasa entero… y el rollback se queda fuera del PR en
 * silencio. Comprobar la existencia no basta: hay que comprobar el rastreo.
 */
const trackedByGit = (p) => {
  try {
    execSync(`git ls-files --error-unmatch "${p}"`, { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch { return false; }
};

let pass = 0, fail = 0;
const check = (desc, got, expected = true) => {
  const ok = got === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${desc}${ok ? '' : ` → ${JSON.stringify(got)} (esperado ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
};
const read = (p) => fs.readFileSync(p, 'utf8');
/** Checksum determinista, normalizado a LF (mismo criterio que s7_71a). */
const sha256LF = (p) => createHash('sha256')
  .update(read(p).split('\r\n').join('\n'), 'utf8').digest('hex');
/** Quita comentarios `--` para mirar SOLO el SQL ejecutable. */
const stripComments = (s) => s.replace(/--[^\n]*/g, '');

console.log('\ncheck-s7_71b — cierre de la escritura arbitraria sobre audit_log\n');

const MIGRATION_PATH = 'migrations/s7_71b_audit_log_hardening.sql';
const ROLLBACK_PATH = 'docs/rollbacks/s7_71b_rollback.sql';

const sqlRaw = read(MIGRATION_PATH);
const rbRaw = read(ROLLBACK_PATH);
const sql = stripComments(sqlRaw);
const rb = stripComments(rbRaw);

// ─── 1. Checksum: la migración es EXACTAMENTE la aplicada ─────────────
{
  console.log('1. Checksum del SQL efectivamente aplicado');
  const APPLIED_SHA256 =
    '8fe8ccd6ee24b63e45c01852d10906b56fb098bf23f46aef94dc265a5dce2e37';
  const actual = sha256LF(MIGRATION_PATH);
  check('el archivo versionado coincide con el SQL aplicado en producción',
    actual === APPLIED_SHA256);
  if (actual !== APPLIED_SHA256) {
    console.log(`      aplicado : ${APPLIED_SHA256}`);
    console.log(`      archivo  : ${actual}`);
    console.log('      La migración NO debe modificarse: producción ya está endurecida.');
  }
  check('el checksum es sha256 hex', /^[0-9a-f]{64}$/.test(actual));
}

// ─── 2. Atomicidad ────────────────────────────────────────────────────
{
  console.log('\n2. Atomicidad');
  check('abre BEGIN', /^\s*BEGIN;/m.test(sql));
  check('cierra COMMIT', /^\s*COMMIT;/m.test(sql));
  check('un solo BEGIN', (sql.match(/^\s*BEGIN;/gm) || []).length, 1);
  check('un solo COMMIT', (sql.match(/^\s*COMMIT;/gm) || []).length, 1);
  check('sin ROLLBACK dentro de la migración', /^\s*ROLLBACK;/m.test(sql) === false);
  check('el rollback también es transaccional',
    /^\s*BEGIN;/m.test(rb) && /^\s*COMMIT;/m.test(rb), true);
}

// ─── 3. Preflight REALMENTE aplicado — seis invariantes ───────────────
//
// Ni una más. Las demás se comprobaron por catálogo, fuera de la migración.
{
  console.log('\n3. Preflight aplicado (las seis invariantes que sí ejecutó)');
  const pre = sqlRaw.slice(sqlRaw.indexOf('DO $pre$'), sqlRaw.indexOf('$pre$;'));
  check('el bloque de preflight existe', pre.length > 500);
  check('3.1 existe public.audit_log', /to_regclass\('public\.audit_log'\)/.test(pre));
  check('3.2 existe la secuencia', /to_regclass\('public\.audit_log_id_seq'\)/.test(pre));
  check('3.3 existe el helper',
    /to_regprocedure\('public\._admin_log_doctor_change\(uuid,text,jsonb,jsonb\)'\)/.test(pre));
  check('3.4 RLS habilitado', /relrowsecurity/.test(pre));
  check('3.5 el owner tiene BYPASSRLS', /rolbypassrls/.test(pre));
  check('3.6 exactamente 1 policy en el estado base', /v_n <> 1/.test(pre));
  check('el preflight aborta con RAISE EXCEPTION', /RAISE EXCEPTION 's7_71b PRE:/.test(pre));
  // El guard que hizo falta: pg_get_functiondef revienta sobre agregados.
  check('las sondas filtran por prokind = f',
    (pre.match(/prokind='f'/g) || []).length >= 3);
  check('las sondas usan la barrera OFFSET 0',
    (pre.match(/OFFSET 0/g) || []).length >= 3);
}

// ─── 4. Cierre de la tabla ────────────────────────────────────────────
{
  console.log('\n4. audit_log — cierre para los roles de cliente');
  for (const rol of ['PUBLIC', 'anon', 'authenticated']) {
    check(`REVOKE ALL sobre la tabla para ${rol}`,
      new RegExp(`REVOKE ALL ON TABLE public\\.audit_log FROM ${rol};`).test(sql));
  }
  check('service_role: REVOKE ALL previo',
    /REVOKE ALL ON TABLE public\.audit_log FROM service_role;/.test(sql));
  check('service_role: GRANT SELECT y nada más',
    /GRANT\s+SELECT ON TABLE public\.audit_log TO service_role;/.test(sql));
  check('NO se concede INSERT a service_role',
    /GRANT[^;]*INSERT[^;]*audit_log[^;]*service_role/.test(sql) === false);
  check('NO se concede DELETE a service_role',
    /GRANT[^;]*DELETE[^;]*audit_log[^;]*service_role/.test(sql) === false);
  check('un único GRANT en toda la migración',
    (sql.match(/^GRANT/gm) || []).length, 1);
}

// ─── 5. Secuencia ─────────────────────────────────────────────────────
{
  console.log('\n5. audit_log_id_seq — sin privilegios para nadie salvo el owner');
  for (const rol of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
    check(`REVOKE ALL sobre la secuencia para ${rol}`,
      new RegExp(`REVOKE ALL ON SEQUENCE public\\.audit_log_id_seq FROM ${rol};`).test(sql));
  }
  check('ningún GRANT sobre la secuencia',
    /GRANT[^;]*ON SEQUENCE/.test(sql) === false);
}

// ─── 6. Policies ──────────────────────────────────────────────────────
{
  console.log('\n6. Policies');
  check('elimina la única policy permisiva',
    /DROP POLICY IF EXISTS audit_log_insert_only ON public\.audit_log;/.test(sql));
  check('NO crea ninguna policy nueva', /CREATE POLICY/.test(sql) === false);
}

// ─── 7. El helper deja de ser invocable ───────────────────────────────
{
  console.log('\n7. _admin_log_doctor_change');
  for (const rol of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
    check(`REVOKE ALL sobre la función para ${rol}`,
      new RegExp(`REVOKE ALL ON FUNCTION public\\._admin_log_doctor_change\\(uuid,text,jsonb,jsonb\\) FROM ${rol};`).test(sql));
  }
  // Revocar solo a PUBLIC no bastaba: había grants explícitos a los tres roles.
  check('no basta con PUBLIC: se revoca a los cuatro',
    (sql.match(/REVOKE ALL ON FUNCTION public\._admin_log_doctor_change/g) || []).length, 4);
  check('NO se le añade un gate is_admin() redundante',
    /CREATE OR REPLACE FUNCTION[^;]*_admin_log_doctor_change/.test(sql) === false);
}

// ─── 8. Alcance: lo que la migración NO hace ──────────────────────────
{
  console.log('\n8. Alcance — decisiones del owner respetadas');
  check('NO activa FORCE ROW LEVEL SECURITY', /FORCE ROW LEVEL/i.test(sqlRaw) === false);
  check('NO añade integrity_epoch', /integrity_epoch/.test(sqlRaw) === false);
  check('NO altera la tabla', /ALTER TABLE/i.test(sql) === false);
  check('NO toca las tres _func huérfanas',
    /audit_(consultations|patients|prescriptions)_func/.test(sqlRaw) === false);
  check('NO toca el search_path de ningún escritor',
    /ALTER FUNCTION/i.test(sql) === false);
  check('NO redefine ninguna función', /CREATE OR REPLACE FUNCTION/.test(sql) === false);
  check('NO toca s7_71a',
    /s7_71a|audit_appointments_fn|cancel_my_appointment/.test(sql) === false);
  check('refresca el caché de PostgREST fuera de la transacción',
    sqlRaw.indexOf("NOTIFY pgrst") > sqlRaw.indexOf('COMMIT;'));
}

// ─── 9. Rollback ──────────────────────────────────────────────────────
{
  console.log('\n9. Rollback');
  check('vive FUERA de migrations/', fs.existsSync(ROLLBACK_PATH));
  check('no existe una copia dentro de migrations/',
    fs.existsSync('migrations/s7_71b_rollback.sql') === false);
  // `.gitignore` ignora *.sql salvo migrations/: sin `git add -f` el rollback
  // existe en disco pero NO entra al PR. Existir no basta.
  check('está VERSIONADO en git (no solo presente en disco)',
    trackedByGit(ROLLBACK_PATH));
  check('la migración está versionada en git',
    trackedByGit(MIGRATION_PATH));
  check('restaura los grants de tabla',
    (rb.match(/GRANT ALL ON TABLE public\.audit_log TO/g) || []).length, 3);
  check('restaura los grants de secuencia',
    (rb.match(/GRANT ALL ON SEQUENCE public\.audit_log_id_seq TO/g) || []).length, 3);
  check('restaura la policy permisiva',
    /CREATE POLICY audit_log_insert_only ON public\.audit_log/.test(rb));
  check('restaura el EXECUTE del helper',
    (rb.match(/GRANT EXECUTE ON FUNCTION public\._admin_log_doctor_change/g) || []).length, 4);
  check('advierte que REABRE la vulnerabilidad', /REABRE LA VULNERABILIDAD/i.test(rbRaw));
  check('declara que es SOLO EMERGENCIA', /SOLO EMERGENCIA/i.test(rbRaw));
  check('declara que NO revierte datos', /NO ES UNA REVERSIÓN DE DATOS/i.test(rbRaw));
  check('explica por qué vive fuera de migrations/',
    /POR QUÉ VIVE FUERA DE migrations/i.test(rbRaw));
}

// ─── 10. Frontend: cero escritores de cliente ─────────────────────────
{
  console.log('\n10. Frontend — el escritor de cliente desapareció');
  check('auditLog.service.ts eliminado',
    fs.existsSync('src/services/auditLog.service.ts') === false);

  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(p) : (/\.(ts|tsx)$/.test(e.name) ? [p] : []);
  });
  const fuentes = walk('src');
  const conLog = fuentes.filter((f) => /logAuditEntry/.test(read(f)));
  check(`cero logAuditEntry en src/ (${conLog.length})`, conLog.length === 0);
  conLog.forEach((f) => console.log(`      · ${f}`));

  const conImport = fuentes.filter((f) => /auditLog\.service/.test(read(f)));
  check(`cero imports de auditLog.service (${conImport.length})`, conImport.length === 0);
  conImport.forEach((f) => console.log(`      · ${f}`));

  const conInsert = fuentes.filter((f) => /from\('audit_log'\)/.test(read(f)));
  check(`ningún acceso de cliente a audit_log (${conInsert.length})`, conInsert.length === 0);
  conInsert.forEach((f) => console.log(`      · ${f}`));

  // Los tres call sites concretos que se retiraron.
  const appts = read('src/services/appointments.service.ts');
  const walkIn = read('src/services/walkIn.service.ts');
  check('appointments.service.ts sin logAuditEntry', /logAuditEntry/.test(appts) === false);
  check('walkIn.service.ts sin logAuditEntry', /logAuditEntry/.test(walkIn) === false);
  check('appointments.service.ts documenta que audita el trigger',
    /audit_appointments/.test(appts));
  check('walkIn.service.ts documenta que audita el trigger',
    /audit_appointments/.test(walkIn));
  // El payload del cliente metía texto libre en la auditoría; ya no existe.
  check('ya no hay ruta de cliente que lleve internal_notes a audit_log',
    /internal_notes: options\.internalNotes/.test(appts) === false);
  check('walkIn ya no llama a getUser solo para auditar',
    /supabase\.auth\.getUser\(\)/.test(walkIn) === false);
}

// ─── 11. Higiene ──────────────────────────────────────────────────────
{
  console.log('\n11. Higiene');
  for (const [desc, re] of [
    ['sin service_role key', /eyJ[A-Za-z0-9_-]{20,}/],
    ['sin claves de Turnstile', /0x4AAA[A-Za-z0-9_-]{8,}/],
    ['sin tokens de GitHub', /gh[pousr]_[A-Za-z0-9]{16,}/],
    ['sin teléfonos reales', /50372608827/],
  ]) {
    check(`${desc} (migración)`, re.test(sqlRaw) === false);
    check(`${desc} (rollback)`, re.test(rbRaw) === false);
  }
}

// ─── 12. Pre-apply vs post-apply — sin afirmaciones de más ────────────
//
// El owner señaló, con razón, que después del apply definimos requisitos de
// preflight más estrictos que NO formaron parte del SQL ejecutado. Este check
// no puede sugerir lo contrario.
{
  console.log('\n12. Frontera pre-apply / post-apply');
  const guia = read('docs/OWNER_S7_71B_APPLY.md');
  check('la guía declara APPLIED MANUALLY IN PRODUCTION',
    /APPLIED MANUALLY IN PRODUCTION/.test(guia));
  check('la guía fija la fecha 2026-08-07', /2026-08-07/.test(guia));
  check('la guía declara el timestamp exacto como NO recuperado',
    /no recuperado/i.test(guia));
  check('la guía publica el SHA-256 del SQL efectivo',
    /8fe8ccd6ee24b63e45c01852d10906b56fb098bf23f46aef94dc265a5dce2e37/.test(guia));
  check('la guía prohíbe volver a ejecutar la migración',
    /NO volver a ejecutar/i.test(guia));
  check('la guía separa lo comprobado por el preflight de lo comprobado por catálogo',
    /post-apply/i.test(guia) && /preflight/i.test(guia), true);
  check('la guía advierte que el timestamp NO sustituye a integrity_epoch',
    /no sustituye/i.test(guia));
  check('la guía deja fuera de alcance las _func y el debt de search_path',
    /_func/.test(guia) && /search_path/.test(guia), true);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} check-s7_71b: ${pass} OK, ${fail} fallos\n`);
process.exit(fail === 0 ? 0 : 1);
