/**
 * check-s7_71a.mjs — AUDIT-SEC-P0 · PR 1: cobertura server-side de appointments.
 *
 *   node scripts/check-s7_71a.mjs
 *
 * Verificación ESTRUCTURAL del texto de la migración y de su rollback.
 * SIN red, SIN Supabase, SIN service_role, SIN datos.
 * La verificación de COMPORTAMIENTO vive en _smoke-s7_71a.mjs y requiere
 * autorización separada.
 *
 * Este check es el guardián de tres invariantes que, si se rompen, no se
 * notan hasta producción:
 *   · la whitelist de columnas (notes / internal_notes NUNCA se auditan);
 *   · la clasificación TOTAL de change_kind (ninguna combinación sin etiqueta);
 *   · la preservación ÍNTEGRA de las validaciones de s7_70 en la RPC.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const sha256hex = (x) => createHash('sha256').update(x, 'utf8').digest('hex');
// Se importa la implementación REAL del fingerprint (el smoke no tiene
// efectos secundarios al importarse: sus guards viven dentro de main()).
import {
  stableStringify, fingerprintOf, flatManifest, identitiesFor,
  normalizePhone, migrationSha256, catalogChecks, authFailureReport,
  OWNER_ATTESTATION, identitiesFingerprint, evaluateAttestation,
  resolveAuthState, preflightVerdict, collisionVerdict, smokeSha256, fileSha256, SMOKE_PATH,
  ACTIVE_SUPABASE_TEST_PHONES, REAL_OR_DEMO_PHONES,
  HISTORICAL_OR_RESERVED_PHONES, PRIOR_FIXTURE_PHONES,
  DOC_PLACEHOLDER_PHONES, FORBIDDEN_PHONES, FORBIDDEN_NORMALIZED,
  SYNTHETIC_PHONES,
  // ── Médico QA persistente, horario local, denylist y fail-closed ──
  QA_DOCTOR, QA_SERVICE_NAMES, QA_PERSISTENT_PHONES,
  qaBaselineChecks, qaManifestIds, buildPermanentIds, permanentHits, assertNotPermanent,
  SV_TIMEZONE, svTodayLocal, addDaysLocal, dowLocal, buildLocalSlot,
  countResult, summarizeInventory, partitionExternal,
  CLEANUP_TARGETS, cleanupColumnFor, deleteVerdict,
} from './_smoke-s7_71a.mjs';

let pass = 0, fail = 0;
const check = (desc, got, expected = true) => {
  const ok = got === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${desc}${ok ? '' : ` → ${JSON.stringify(got)} (esperado ${JSON.stringify(expected)})`}`);
  ok ? pass++ : fail++;
};
const read = (p) => fs.readFileSync(p, 'utf8');
const between = (s, a, b) => {
  const i = s.indexOf(a);
  if (i < 0) return '';
  const j = b ? s.indexOf(b, i + 1) : s.length;
  return s.slice(i, j < 0 ? s.length : j);
};
/**
 * Quita los comentarios `--` para que las aserciones estructurales miren
 * SOLO el SQL ejecutable. Sin esto, la propia documentación de la migración
 * (que nombra lo que NO hace) dispararía falsos positivos.
 * Seguro acá: ninguna cadena literal de estas migraciones contiene `--`.
 *
 * `[^\n]` en vez de `.$`: en JS `.` NO matchea `\r`, y los archivos del repo
 * están con CRLF. Con `--.*$` los comentarios sobrevivían en silencio.
 */
const stripComments = (s) => s.replace(/--[^\n]*/g, '');

console.log('\ncheck-s7_71a — cobertura server-side de appointments\n');

const sqlRaw = read('migrations/s7_71a_audit_appointments_coverage.sql');
// El rollback vive FUERA de migrations/ a propósito: dentro del namespace de
// migraciones aplicables podría tomarse por pendiente y revertir la cobertura
// justo después de aplicarla (ordena inmediatamente tras su forward).
const ROLLBACK_PATH = 'docs/rollbacks/s7_71a_rollback.sql';
const rbRaw  = read(ROLLBACK_PATH);
const sql    = stripComments(sqlRaw);
const rb     = stripComments(rbRaw);

// Cuerpo de la función de auditoría y de la RPC, aislados (ya sin comentarios).
const fnAudit  = between(sql, 'CREATE OR REPLACE FUNCTION public.audit_appointments_fn()',
                              'COMMENT ON FUNCTION public.audit_appointments_fn()');
const fnCancel = between(sql, 'CREATE OR REPLACE FUNCTION public.cancel_my_appointment(',
                              'COMMENT ON FUNCTION public.cancel_my_appointment(');

// ─── 1. Atomicidad ────────────────────────────────────────────────────
{
  console.log('1. Atomicidad');
  check('abre BEGIN', /^\s*BEGIN;/m.test(sql));
  check('cierra COMMIT', /^\s*COMMIT;/m.test(sql));
  check('un solo BEGIN', (sql.match(/^\s*BEGIN;/gm) || []).length, 1);
  check('un solo COMMIT', (sql.match(/^\s*COMMIT;/gm) || []).length, 1);
  check('sin ROLLBACK dentro de la migración', /^\s*ROLLBACK;/m.test(sql) === false);
  check('el rollback también es transaccional',
    /^\s*BEGIN;/m.test(rb) && /^\s*COMMIT;/m.test(rb), true);
}

// ─── 2. Preflight ─────────────────────────────────────────────────────
{
  console.log('\n2. Preflight que aborta');
  const pre = between(sql, 'DO $pre$', '$pre$;');
  check('verifica public.appointments', /to_regclass\('public\.appointments'\)/.test(pre));
  check('verifica public.audit_log', /to_regclass\('public\.audit_log'\)/.test(pre));
  check('verifica appointment_statuses', /to_regclass\('public\.appointment_statuses'\)/.test(pre));
  check('exige s7_70 aplicada (cancel_my_appointment)',
    /to_regprocedure\('public\.cancel_my_appointment\(uuid,text,text\)'\)/.test(pre));
  check('exige appointment_patient_cancellations',
    /to_regclass\('public\.appointment_patient_cancellations'\)/.test(pre));
  check('verifica las 6 columnas de audit_log', /<> 6/.test(pre));
  check('verifica las 9 columnas de la whitelist', /<> 9/.test(pre));
  check('verifica el estado cancelada', /name = 'cancelada'/.test(pre));
  check('verifica auth.uid()', /to_regprocedure\('auth\.uid\(\)'\)/.test(pre));
  check('verifica auth.jwt()', /to_regprocedure\('auth\.jwt\(\)'\)/.test(pre));
  check('el preflight puede abortar', /RAISE EXCEPTION 's7_71a PRE:/.test(pre));
}

// ─── 3. Función de auditoría — forma ──────────────────────────────────
{
  console.log('\n3. audit_appointments_fn — forma');
  check('existe', fnAudit.length > 0);
  check('SECURITY DEFINER', /SECURITY DEFINER/.test(fnAudit));
  check('search_path fijado y con pg_catalog primero',
    /SET search_path = pg_catalog, public, pg_temp/.test(fnAudit));
  check('escribe en public.audit_log CALIFICADO',
    /INSERT INTO public\.audit_log/.test(fnAudit));
  check('sin INSERT a audit_log SIN calificar',
    /INSERT INTO\s+audit_log/.test(fnAudit) === false);
  check('castea el enum calificado', /::public\.audit_action/.test(fnAudit));
  // Ninguna tabla referenciada sin esquema dentro de la función.
  check('todas las tablas van calificadas',
    /(FROM|INTO|UPDATE|JOIN)\s+(?!public\.|pg_catalog\.)(appointments|audit_log|appointment_statuses)\b/
      .test(fnAudit) === false);
}

// ─── 4. Actor ─────────────────────────────────────────────────────────
{
  console.log('\n4. Actor (decisión vinculante del owner)');
  check('usa auth.uid()', /auth\.uid\(\)/.test(fnAudit));
  check("usa auth.jwt() ->> 'role'", /auth\.jwt\(\)\s*->>\s*'role'/.test(fnAudit));
  check('NO usa auth.role()', /auth\.role\(\)/.test(fnAudit) === false);
  check('NO almacena auth.jwt() completo',
    /'jwt'\s*,\s*v_jwt|jsonb_build_object\([^)]*auth\.jwt\(\)\s*\)/.test(fnAudit) === false);
  check('current_user solo como db_executor',
    /'db_executor',\s*current_user/.test(fnAudit));
  check('current_user NO se usa como actor_kind',
    /actor_kind\s*:=\s*current_user/.test(fnAudit) === false);

  for (const kind of ['user', 'anon', 'service_role', 'service_role_impersonating', 'db_direct']) {
    check(`clasifica ${kind}`, new RegExp(`'${kind}'`).test(fnAudit));
  }

  check('user_id con COALESCE al centinela (no aborta la cita)',
    /COALESCE\(v_uid, '00000000-0000-0000-0000-000000000000'::uuid\)/.test(fnAudit));
  check('dos escrituras con COALESCE (INSERT y UPDATE)',
    (fnAudit.match(/COALESCE\(v_uid, '00000000-0000-0000-0000-000000000000'::uuid\)/g) || []).length, 2);
}

// ─── 5. Whitelist y privacidad ────────────────────────────────────────
{
  console.log('\n5. Whitelist y privacidad');
  check('NO usa to_jsonb(NEW) completo', /to_jsonb\(NEW\)/.test(fnAudit) === false);
  check('NO usa to_jsonb(OLD) completo', /to_jsonb\(OLD\)/.test(fnAudit) === false);
  check('NUNCA registra notes', /\bNEW\.notes\b|\bOLD\.notes\b/.test(fnAudit) === false);
  check('NUNCA registra internal_notes',
    /internal_notes/.test(fnAudit) === false);
  check('NUNCA registra updated_at', /updated_at/.test(fnAudit) === false);

  for (const col of ['status_id', 'cancel_reason_id', 'start_time', 'end_time',
                     'doctor_id', 'patient_id', 'service_id', 'source', 'price']) {
    check(`whitelist incluye ${col}`,
      new RegExp(`NEW\\.${col} IS DISTINCT FROM OLD\\.${col}`).test(fnAudit));
  }
  check('las 9 columnas se comparan con IS DISTINCT FROM',
    (fnAudit.match(/IS DISTINCT FROM OLD\./g) || []).length, 9);
}

// ─── 6. Sin ruido ─────────────────────────────────────────────────────
{
  console.log('\n6. Sin escritura cuando nada relevante cambió');
  check('guard de salida temprana', /IF v_new = '\{\}'::jsonb THEN\s+RETURN NEW;/.test(fnAudit));
  check('el guard va ANTES de la clasificación',
    fnAudit.indexOf("IF v_new = '{}'::jsonb") < fnAudit.indexOf('v_n_groups :='), true);
}

// ─── 7. Clasificación TOTAL ───────────────────────────────────────────
{
  console.log('\n7. change_kind — clasificación total');
  check('INSERT → appointment_created', /'change_kind',\s*'appointment_created'/.test(fnAudit));
  check('INSERT registra source literal', /'source',\s*NEW\.source::text/.test(fnAudit));

  for (const k of ['status_change', 'reschedule', 'patient_reassign',
                   'doctor_reassign', 'reassign', 'appointment_update', 'mixed']) {
    check(`clasifica ${k}`, new RegExp(`'${k}'`).test(fnAudit));
  }

  check('rama ELSE final (ninguna combinación sin etiqueta)',
    /ELSE\s+v_change := 'appointment_update';/.test(fnAudit));
  check('>1 grupo → mixed', /IF v_n_groups > 1 THEN\s+v_change := 'mixed';/.test(fnAudit));
  check('los 4 grupos suman en v_n_groups',
    (fnAudit.match(/CASE WHEN v_g_\w+\s+THEN 1 ELSE 0 END/g) || []).length, 4);
}

// ─── 8. Contexto validado ─────────────────────────────────────────────
{
  console.log('\n8. Contexto transaccional VALIDADO');
  check('GUC específico app.audit_appointments_context',
    /app\.audit_appointments_context/.test(fnAudit));
  check('lee el GUC con missing_ok',
    /current_setting\('app\.audit_appointments_context', true\)/.test(fnAudit));
  check('nullif contra cadena vacía (no revienta el cast)',
    /nullif\(current_setting\('app\.audit_appointments_context', true\), ''\)/.test(fnAudit));
  check('valida estado anterior elegible',
    /v_old_status IN \('programada', 'confirmada'\)/.test(fnAudit));
  check('valida estado nuevo cancelada', /v_new_status = 'cancelada'/.test(fnAudit));
  check('valida que ninguna otra columna relevante cambió',
    /v_change = 'status_change'/.test(fnAudit)
    && /NOT \(v_new \? 'cancel_reason_id'\)/.test(fnAudit), true);
  check('registra context_rejected cuando no valida',
    /'context_rejected', true/.test(fnAudit));
  check('el reason se valida contra la lista cerrada de s7_70',
    /v_ctx_reason IN \('no_puedo_asistir', 'otro_horario', 'ya_no_necesito', 'otro'\)/.test(fnAudit));
  check('NINGÚN flag desactiva el trigger',
    /audit_appointments_skip|skip_audit|disable_audit/.test(sql) === false);
  check('el trigger nunca retorna antes por contexto',
    /IF .*context.* THEN\s+RETURN NEW;/i.test(fnAudit) === false);
}

// ─── 9. REVOKE y trigger ──────────────────────────────────────────────
{
  console.log('\n9. REVOKE EXECUTE y trigger');
  const rev = between(sql, 'REVOKE EXECUTE ON FUNCTION public.audit_appointments_fn()', ';');
  check('revoca a PUBLIC', /PUBLIC/.test(rev));
  check('revoca a anon', /\banon\b/.test(rev));
  check('revoca a authenticated', /\bauthenticated\b/.test(rev));
  check('revoca a service_role', /\bservice_role\b/.test(rev));
  check('el REVOKE va después de crear la función',
    sql.indexOf('CREATE OR REPLACE FUNCTION public.audit_appointments_fn()')
      < sql.indexOf('REVOKE EXECUTE ON FUNCTION public.audit_appointments_fn()'), true);

  check('trigger AFTER INSERT OR UPDATE',
    /AFTER INSERT OR UPDATE ON public\.appointments/.test(sql));
  check('SIN DELETE en el trigger',
    /AFTER[^;]*DELETE[^;]*ON public\.appointments/.test(sql) === false);
  check('FOR EACH ROW', /FOR EACH ROW EXECUTE FUNCTION public\.audit_appointments_fn\(\)/.test(sql));
  check('DROP TRIGGER IF EXISTS previo (idempotente)',
    /DROP TRIGGER IF EXISTS audit_appointments ON public\.appointments;/.test(sql));
}

// ─── 10. cancel_my_appointment preservada ─────────────────────────────
{
  console.log('\n10. cancel_my_appointment — s7_70 preservada');
  check('es CREATE OR REPLACE (conserva la ACL)',
    /CREATE OR REPLACE FUNCTION public\.cancel_my_appointment\(/.test(sql));
  check('sin DROP FUNCTION de la RPC (perdería los grants)',
    /DROP FUNCTION[^;]*cancel_my_appointment/.test(sql) === false);
  check('misma firma', /p_appointment_id uuid,\s+p_reason\s+text DEFAULT NULL,\s+p_note\s+text DEFAULT NULL/.test(fnCancel));
  check('SECURITY DEFINER', /SECURITY DEFINER/.test(fnCancel));
  check('search_path idéntico al de s7_70',
    /SET search_path = pg_catalog, public, pg_temp/.test(fnCancel));

  // Validaciones que NO pueden perderse.
  for (const [desc, re] of [
    ['P0110 sesión obligatoria',       /P0110/],
    ['P0111 mensaje genérico',         /P0111/],
    ['P0112 elegibilidad de estado',   /P0112/],
    ['P0113 cita ya empezada',         /P0113/],
    ['P0114 motivo no válido',         /P0114/],
    ['P0115 nota supera el máximo',    /P0115/],
    ['lista cerrada de motivos',       /'no_puedo_asistir', 'otro_horario', 'ya_no_necesito', 'otro'/],
    ['límite de 300 caracteres',       /char_length\(v_note\) > 300/],
    ['normalización con nullif+btrim',  /nullif\(btrim\(coalesce\(p_reason, ''\)\), ''\)/],
    ['pertenencia + link_confirmed_at', /p\.link_confirmed_at IS NOT NULL/],
    ['FOR UPDATE OF a',                 /FOR UPDATE OF a/],
    ['idempotencia por fila de evento', /already_cancelled_by_patient/],
    ['resultado already_cancelled_by_other', /already_cancelled_by_other/],
    ['evento append-only',              /INSERT INTO public\.appointment_patient_cancellations/],
    ['UPDATE acotado a status_id',      /UPDATE public\.appointments\s+SET status_id = v_cancel_id/],
  ]) check(`conserva ${desc}`, re.test(fnCancel));

  // Los dos ÚNICOS cambios respecto de s7_70.
  check('(a) fija el contexto antes del UPDATE',
    /PERFORM set_config\(\s*'app\.audit_appointments_context'/.test(fnCancel)
    && fnCancel.indexOf('set_config') < fnCancel.indexOf('UPDATE public.appointments'), true);
  check('el contexto es transaction-local (is_local = true)',
    /\)::text,\s*true\s*\)/.test(fnCancel));
  check('(b) elimina su INSERT manual en audit_log',
    /INSERT INTO public\.audit_log/.test(fnCancel) === false);
  check('el contexto lleva edited_via', /'edited_via', 'patient_self_cancel'/.test(fnCancel));
  check('el contexto lleva reason', /'reason',\s+v_reason/.test(fnCancel));
  check('la nota libre NO viaja en el contexto',
    between(fnCancel, "PERFORM set_config", 'UPDATE public.appointments').includes('v_note') === false);
  check('mismos valores de retorno',
    /'outcome', 'cancelled'/.test(fnCancel) && /'cancelled_at', now\(\)/.test(fnCancel), true);
}

// ─── 10-bis. EQUIVALENCIA EXACTA de cancel_my_appointment ─────────────
//
// No basta con una lista de invariantes: una lista solo prueba lo que
// alguien pensó en listar. Acá se compara el CUERPO COMPLETO de las tres
// versiones —s7_70 (original), s7_71a (forward) y el rollback— tras
// normalizar comentarios y whitespace, y se exige que las ÚNICAS
// diferencias del forward sean las dos autorizadas:
//     (a) + PERFORM set_config('app.audit_appointments_context', …, true)
//     (b) − INSERT INTO public.audit_log (…) VALUES (…);
// Cualquier otra diferencia falla.
{
  console.log('\n10-bis. Equivalencia EXACTA de cancel_my_appointment');

  const s70raw = read('migrations/s7_70_patient_cancel_appointment.sql');
  const s70 = stripComments(s70raw);

  /** Cuerpo entre `AS $fn$` y el `$fn$;` que lo cierra. */
  const bodyOf = (src, header) => {
    const i = src.indexOf(header);
    if (i < 0) return null;
    const a = src.indexOf('AS $fn$', i);
    if (a < 0) return null;
    const b = src.indexOf('$fn$;', a + 7);
    if (b < 0) return null;
    return src.slice(a + 'AS $fn$'.length, b);
  };

  /** Normaliza: colapsa whitespace y quita líneas vacías. */
  const canon = (s) => s.replace(/\s+/g, ' ').trim();

  /** Tokeniza en sentencias comparables (separadas por `;`). */
  const stmts = (s) => canon(s).split(';').map((x) => x.trim()).filter(Boolean);

  const bOrig = bodyOf(s70, 'CREATE FUNCTION public.cancel_my_appointment(');
  const bFwd  = bodyOf(sql, 'CREATE OR REPLACE FUNCTION public.cancel_my_appointment(');
  const bRb   = bodyOf(rb,  'CREATE OR REPLACE FUNCTION public.cancel_my_appointment(');

  check('se aisló el cuerpo de s7_70', typeof bOrig === 'string' && bOrig.length > 500);
  check('se aisló el cuerpo del forward', typeof bFwd === 'string' && bFwd.length > 500);
  check('se aisló el cuerpo del rollback', typeof bRb === 'string' && bRb.length > 500);

  if (bOrig && bFwd && bRb) {
    // ── ROLLBACK ≡ s7_70, sin diferencias funcionales ──
    const sOrig = stmts(bOrig);
    const sRb   = stmts(bRb);
    const soloEnOrig = sOrig.filter((x) => !sRb.includes(x));
    const soloEnRb   = sRb.filter((x) => !sOrig.includes(x));
    check(`rollback ≡ s7_70 — nada falta (${soloEnOrig.length})`, soloEnOrig.length === 0);
    check(`rollback ≡ s7_70 — nada sobra (${soloEnRb.length})`, soloEnRb.length === 0);
    if (soloEnOrig.length) console.log(`      falta:  ${soloEnOrig[0].slice(0, 120)}…`);
    if (soloEnRb.length)   console.log(`      sobra:  ${soloEnRb[0].slice(0, 120)}…`);

    // ── FORWARD vs s7_70: exactamente 2 diferencias autorizadas ──
    const sFwd = stmts(bFwd);
    const soloOrig = sOrig.filter((x) => !sFwd.includes(x));   // eliminado
    const soloFwd  = sFwd.filter((x) => !sOrig.includes(x));   // agregado

    const esInsertAudit = (x) =>
      /^INSERT INTO public\.audit_log/i.test(x) && /audit_action/i.test(x);
    const esSetConfig = (x) =>
      /^PERFORM set_config\( 'app\.audit_appointments_context'/i.test(x)
      || (/^PERFORM set_config/i.test(x) && /app\.audit_appointments_context/i.test(x));

    check(`forward elimina exactamente 1 sentencia (${soloOrig.length})`, soloOrig.length === 1);
    check('lo eliminado es el INSERT manual en audit_log',
      soloOrig.length === 1 && esInsertAudit(soloOrig[0]));
    if (soloOrig.length && !esInsertAudit(soloOrig[0])) {
      console.log(`      eliminado inesperado: ${soloOrig[0].slice(0, 160)}…`);
    }

    check(`forward agrega exactamente 1 sentencia (${soloFwd.length})`, soloFwd.length === 1);
    check('lo agregado es el set_config del contexto',
      soloFwd.length === 1 && esSetConfig(soloFwd[0]));
    if (soloFwd.length && !esSetConfig(soloFwd[0])) {
      console.log(`      agregado inesperado: ${soloFwd[0].slice(0, 160)}…`);
    }

    // ── Toda sentencia de s7_70 que NO sea el INSERT debe sobrevivir ──
    const perdidas = sOrig.filter((x) => !esInsertAudit(x) && !sFwd.includes(x));
    check(`ninguna otra sentencia de s7_70 se perdió (${perdidas.length})`, perdidas.length === 0);
    if (perdidas.length) console.log(`      perdida: ${perdidas[0].slice(0, 160)}…`);

    // ── Ninguna sentencia nueva salvo el set_config ──
    const nuevas = sFwd.filter((x) => !esSetConfig(x) && !sOrig.includes(x));
    check(`ninguna otra sentencia nueva en el forward (${nuevas.length})`, nuevas.length === 0);
    if (nuevas.length) console.log(`      nueva: ${nuevas[0].slice(0, 160)}…`);

    // ── Firma y atributos idénticos en las 3 ──
    // Se ancla al encabezado CREATE de cada archivo (no al primer
    // `cancel_my_appointment(` del texto, que cae en el preflight). Se
    // compara desde el nombre en adelante, así `CREATE FUNCTION` vs
    // `CREATE OR REPLACE FUNCTION` —diferencia obligada— no cuenta.
    const sigOf = (src, header) => {
      const i = src.indexOf(header);
      if (i < 0) return null;
      const j = src.indexOf('cancel_my_appointment(', i);
      return canon(src.slice(j, src.indexOf('AS $fn$', j)));
    };
    const sigOrig = sigOf(s70, 'CREATE FUNCTION public.cancel_my_appointment(');
    const sigFwd  = sigOf(sql, 'CREATE OR REPLACE FUNCTION public.cancel_my_appointment(');
    const sigRb   = sigOf(rb,  'CREATE OR REPLACE FUNCTION public.cancel_my_appointment(');
    check('firma+atributos idénticos: s7_70 vs forward', sigOrig === sigFwd);
    check('firma+atributos idénticos: s7_70 vs rollback', sigOrig === sigRb);
    if (sigOrig !== sigFwd) console.log(`      s7_70: ${sigOrig}\n      fwd:   ${sigFwd}`);
  }
}

// ─── 11. Alcance: NO es s7_71b ────────────────────────────────────────
{
  console.log('\n11. Alcance — s7_71a no invade s7_71b');
  check('NO revoca privilegios de audit_log',
    /REVOKE[^;]*ON (TABLE )?public\.audit_log/.test(sql) === false);
  check('NO toca la secuencia', /audit_log_id_seq/.test(sql) === false);
  check('NO borra la policy', /DROP POLICY[^;]*audit_log_insert_only/.test(sql) === false);
  check('NO crea policies', /CREATE POLICY/.test(sql) === false);
  check('NO añade integrity_epoch', /integrity_epoch/.test(sql) === false);
  check('NO toca _admin_log_doctor_change',
    /_admin_log_doctor_change/.test(sql) === false);
  check('NO hace ALTER TABLE', /ALTER TABLE/.test(sql) === false);
  check('NO borra datos',
    /DELETE FROM|TRUNCATE/.test(sql) === false);
}

// ─── 12. Rollback ─────────────────────────────────────────────────────
{
  console.log('\n12. Rollback');
  check('elimina el trigger',
    /DROP TRIGGER IF EXISTS audit_appointments ON public\.appointments;/.test(rb));
  check('elimina la función',
    /DROP FUNCTION IF EXISTS public\.audit_appointments_fn\(\);/.test(rb));
  check('restaura cancel_my_appointment',
    /CREATE OR REPLACE FUNCTION public\.cancel_my_appointment\(/.test(rb));
  check('la versión restaurada recupera el INSERT manual',
    /INSERT INTO public\.audit_log/.test(rb));
  check('restaura ANTES de quitar el trigger',
    rb.indexOf('CREATE OR REPLACE FUNCTION public.cancel_my_appointment')
      < rb.indexOf('DROP TRIGGER IF EXISTS audit_appointments'), true);
  check('el rollback NO borra datos', /DELETE FROM|TRUNCATE/.test(rb) === false);
  check('el rollback NO toca grants de audit_log',
    /GRANT|REVOKE/.test(rb) === false);
  check('la versión restaurada NO fija el contexto',
    /app\.audit_appointments_context/.test(rb) === false);
}

// ─── 12-bis. Bloques SQL owner-only (db_direct y context_rejected) ────
//
// Estos dos casos NO son alcanzables desde supabase-js (haría falta una
// conexión sin JWT y `set_config` server-side). Deben existir como bloques
// transaccionales con ROLLBACK en la guía del owner, y este check verifica
// tanto su presencia como sus expectativas.
{
  console.log('\n12-bis. Bloques SQL owner-only en la guía');
  const doc = read('docs/OWNER_S7_71A_APPLY.md');

  const blkDbDirect = between(doc, '## 11. Prueba owner-only', '## 12. Prueba owner-only');
  const blkCtx      = between(doc, '## 12. Prueba owner-only', '## 13. Prueba owner-only');
  const blkSign     = between(doc, '## 13. Prueba owner-only', null);

  check('existe la sección 11 (db_direct)', blkDbDirect.length > 200);
  check('existe la sección 12 (context_rejected)', blkCtx.length > 200);
  check('existe la sección 13 (firma de consulta)', blkSign.length > 200);

  for (const [nombre, blk] of [['11 db_direct', blkDbDirect],
                               ['12 context_rejected', blkCtx],
                               ['13 firma', blkSign]]) {
    check(`§${nombre}: es transaccional (BEGIN)`, /^BEGIN;/m.test(blk));
    check(`§${nombre}: termina en ROLLBACK (no persiste)`, /^ROLLBACK;/m.test(blk));
    check(`§${nombre}: SIN COMMIT`, /^COMMIT;/m.test(blk) === false);
    check(`§${nombre}: usa fixtures sintéticas propias`, /S7_71_(DBDIRECT|CTX|SIGN)/.test(blk));
    check(`§${nombre}: NO modifica grants ni policies`,
      /GRANT |REVOKE |CREATE POLICY|DROP POLICY|ALTER TABLE/.test(blk) === false);
    check(`§${nombre}: NO borra datos`, /DELETE FROM|TRUNCATE/.test(blk) === false);
    check(`§${nombre}: sin teléfonos prohibidos`,
      /50372608827|50378627694|50378056365|50375000001/.test(blk) === false);
  }

  // §13 — firma de consulta: debe documentar la verificación de
  // reversibilidad y declarar que la corrida productiva NO la cubre.
  check('§13 documenta que s7_28 no bloquea DELETE', /s7_28.*DELETE|DELETE.*s7_28/s.test(blkSign));
  check('§13 lista las tablas dependientes de la firma',
    /consultation_amendments/.test(blkSign) && /consultation_diagnoses/.test(blkSign));
  check('§13 prueba la cascada de sync_appointment_on_sign',
    /sync_appointment_on_sign/.test(blkSign));
  check('§13 espera estado atendida', /atendida/.test(blkSign));
  check('§13 espera change_kind = status_change', /status_change/.test(blkSign));
  check('§13 verifica el filtro de notes/internal_notes',
    /filtro_notes/.test(blkSign) && /filtro_internas/.test(blkSign));
  check('§13 declara que la corrida productiva NO cubre la firma',
    /corrida productiva del smoke NO cubre la firma/i.test(blkSign.replace(/\s+/g, ' ')));

  // Expectativas explícitas de cada bloque.
  check('§11 espera actor_kind = db_direct', /db_direct/.test(blkDbDirect));
  check('§11 espera el uuid centinela',
    /00000000-0000-0000-0000-000000000000/.test(blkDbDirect));
  check('§11 espera db_executor presente', /db_executor/.test(blkDbDirect));
  check('§11 consulta actor_kind desde audit_log',
    /new_data ->> 'actor_kind'/.test(blkDbDirect));

  check('§12 fija app.audit_appointments_context',
    /set_config\(\s*'app\.audit_appointments_context'/.test(blkCtx));
  check('§12 usa la etiqueta patient_self_cancel', /patient_self_cancel/.test(blkCtx));
  check('§12 provoca una transición incompatible (cambio de precio)',
    /UPDATE public\.appointments\s+SET price/.test(blkCtx));
  check('§12 espera context_rejected', /context_rejected/.test(blkCtx));
  check('§12 espera edited_via descartado', /edited_via.*NULL|NULL \(descartado\)/s.test(blkCtx));
  check('§12 espera reason descartado', /reason.*NULL|NULL \(descartado\)/s.test(blkCtx));
  check('§12 espera change_kind derivado de la transición real',
    /appointment_update/.test(blkCtx));

  // La guía debe explicar que la atomicidad —no el orden— evita el estado
  // intermedio, y que no hay COMMIT intermedio en el rollback.
  // El markdown envuelve líneas: se normaliza el whitespace antes de buscar.
  const docFlat = doc.replace(/\s+/g, ' ');
  check('la guía atribuye la seguridad a BEGIN/COMMIT, no al orden',
    /No es el orden de las sentencias: es el \*\*`BEGIN` … `COMMIT`\*\*/.test(docFlat));
  check('la guía degrada el orden a precaución secundaria',
    /precaución \*\*secundaria\*\*/.test(docFlat));
  check('la guía declara que no hay COMMIT intermedio',
    /No hay `COMMIT` intermedio/.test(docFlat));
  check('el rollback lo documenta también',
    /NO hay COMMIT intermedio/.test(rbRaw));
}

// ─── 12-ter. Guardas de datos reales ──────────────────────────────────
//
// El número de Katherine solo puede aparecer como GUARDA que aborta. Nunca
// como fixture, destino, fallback ni argumento de Auth/tabla/RPC.
{
  console.log('\n12-ter. Guardas de datos reales (Katherine y demo)');
  const smoke = read('scripts/_smoke-s7_71a.mjs');
  const K = '50372608827';

  // El número puede aparecer más de una vez, pero SIEMPRE con forma de
  // guarda: dentro de FORBIDDEN_PHONES o dentro de una aserción negada
  // (`!id.phone.includes('…')`). Nunca en una escritura.
  const aparicionesK = (smoke.match(new RegExp(K, 'g')) || []).length;
  check(`el número aparece pocas veces y todas como guarda (${aparicionesK})`,
    aparicionesK <= 3);
  check('está declarado en la categoría de datos reales',
    /REAL_OR_DEMO_PHONES = \[[\s\S]*?'50372608827'/.test(smoke));
  // Fuera de la constante, solo puede aparecer con forma de GUARDA: una
  // aserción sobre la propia lista (`FORBIDDEN_NORMALIZED.has(...)`), un
  // comentario, o una comparación negada. Nunca en una escritura.
  check('toda otra aparición tiene forma de guarda o comentario',
    smoke.split('\n')
      .filter((l) => l.includes(K))
      .every((l) =>
        /FORBIDDEN_NORMALIZED\.has\(/.test(l)     // aserción sobre la lista
        || /^\s*['"]?503/.test(l.trim())          // entrada de la constante
        || /^\s*(\/\/|\*|--)/.test(l.trim())      // comentario
        || /!\s*\w+(\.\w+)*\.includes\(/.test(l)  // comparación negada
      ));

  check('existe la guarda assertNotForbidden', /function assertNotForbidden|const assertNotForbidden/.test(smoke));
  check('la guarda ABORTA con excepción',
    /throw new Error\(\s*`ABORTADO: teléfono prohibido/.test(smoke));
  check('la guarda cubre también la cuenta demo (Camilo)', /50378627694/.test(smoke));

  // Nunca como argumento de escritura.
  for (const [desc, re] of [
    ['createUser',   new RegExp(`createUser\\([^)]*${K}`)],
    ['insert',       new RegExp(`insert\\([^)]*${K}`, 's')],
    ['update',       new RegExp(`update\\([^)]*${K}`, 's')],
    ['rpc',          new RegExp(`rpc\\([^)]*${K}`, 's')],
    ['phone:',       new RegExp(`phone:\\s*['"\`][^'"\`]*${K}`)],
    ['fallback ??',  new RegExp(`\\?\\?\\s*['"\`][^'"\`]*${K}`)],
    ['auth.admin',   new RegExp(`auth\\.admin[^;]*${K}`, 's')],
  ]) check(`nunca se usa en ${desc}`, re.test(smoke) === false);

  // ── Los tres sintéticos son FIJOS, no generados por hash ──
  const TRIPLE = ['50370008800', '50370008801', '50370008802'];
  check('los tres sintéticos están declarados como constante fija',
    new RegExp(`const SYNTHETIC_PHONES = \\['${TRIPLE[0]}', '${TRIPLE[1]}', '${TRIPLE[2]}'\\]`).test(smoke));
  check('están dentro del espacio sintético 5037000xxxx',
    TRIPLE.every((p) => /^5037000\d{4}$/.test(p)));
  check('son consecutivos',
    Number(TRIPLE[1]) === Number(TRIPLE[0]) + 1 && Number(TRIPLE[2]) === Number(TRIPLE[1]) + 1);
  check('NO se generan por hash (runSeed eliminado)', /runSeed/.test(smoke) === false);
  check('todo teléfono de fixture pasa por la guarda',
    /assertNotForbidden\(SYNTHETIC_PHONES\[i\]/.test(smoke));
  check('createUser revalida la guarda antes de escribir',
    /assertNotForbidden\(identity\.phone, `createUser/.test(smoke));
  check('el preflight exige autorización del owner antes de --run',
    /requieren AUTORIZACIÓN del owner antes de --run/.test(smoke));

  // ── El prefijo 50369 quedó ELIMINADO de todo el PR ──
  const pr5 = ['migrations/s7_71a_audit_appointments_coverage.sql',
               ROLLBACK_PATH,
               'scripts/check-s7_71a.mjs',
               'scripts/_smoke-s7_71a.mjs',
               'docs/OWNER_S7_71A_APPLY.md'];
  for (const f of pr5) {
    check(`sin rango 50369 en ${f.split('/').pop()}`, /50369\d{6}/.test(read(f)) === false);
  }

  // ── Los tres no colisionan con nada conocido ──
  for (const p of TRIPLE) {
    check(`${p}: ausente de CLAUDE.md`, read('CLAUDE.md').includes(p) === false);
  }
  // La pertenencia a las categorías se comprueba en §14 sobre los arrays
  // REALES importados, no por texto. Acá solo queda lo estructural.

  check('la lista declara que el grep NO es fuente suficiente',
    /por sí solo es INSUFICIENTE/.test(smoke));
  check('la lista nombra las cuatro fuentes',
    /Test Phone Numbers/.test(smoke) && /CLAUDE\.md/.test(smoke)
    && /handoff canónico/.test(smoke) && /scripts\//.test(smoke), true);
  check('advierte que hay que actualizarla si cambian los Test Phones',
    /hay que actualizar\s*\n?\s*\*?\s*esta constante/.test(smoke));
  check('existe normalizePhone', /export const normalizePhone = /.test(smoke));
  check('la normalización quita el prefijo 503',
    /d\.length === 11 && d\.startsWith\('503'\) \? d\.slice\(3\) : d/.test(smoke));
  check('la normalización quita separadores', /replace\(\/\\D\/g, ''\)/.test(smoke));
  check('la comparación usa el set normalizado',
    /FORBIDDEN_NORMALIZED\.has\(normalizePhone\(phone\)\)/.test(smoke));
  check('el preflight imprime las categorías por separado',
    /cat\('ACTIVE_SUPABASE_TEST_PHONES'/.test(smoke)
    && /cat\('HISTORICAL_OR_RESERVED_PHONES'/.test(smoke)
    && /cat\('REAL_OR_DEMO_PHONES'/.test(smoke), true);
  check('el preflight imprime el total crudo y el normalizado',
    /TOTAL crudo: \$\{FORBIDDEN_PHONES\.length\}/.test(smoke)
    && /FORBIDDEN_NORMALIZED\.size/.test(smoke), true);
  check('el preflight reporta cuántas se dedujeron por normalización',
    /deduplicadas por normalización/.test(smoke));
  check('el preflight advierte que el grep no basta',
    /El grep del repo NO basta/.test(smoke));
  check('el preflight verifica que Katherine esté en la lista',
    /Katherine está en la lista/.test(smoke));
  check('el preflight verifica los Test Phones documentados',
    /los Test Phones documentados están en la lista/.test(smoke));
  check('el preflight verifica el formato sin 503',
    /la comparación tolera el formato sin 503/.test(smoke));

  // ── Contrato de RPC: no declarado validado ──
  check('el contrato se declara NO validado por ejecución',
    /CONTRATO ESPERADO SEGÚN CÓDIGO, TODAVÍA NO VALIDADO MEDIANTE\s*\n?\s*EJECUCIÓN/
      .test(smoke.replace(/\s+/g, ' ')) || /TODAVÍA NO VALIDADO MEDIANTE/.test(smoke));
  check('el preflight no afirma haber validado el JSON real',
    /contrato validado|JSON validado/i.test(smoke) === false);
}

// ─── 12-quater. Sin placeholders ──────────────────────────────────────
{
  console.log('\n12-quater. Sin helpers placeholder en el smoke');
  const smoke = read('scripts/_smoke-s7_71a.mjs');
  for (const [desc, re] of [
    ['sin TODO',                 /\bTODO\b/],
    ['sin FIXME',                /\bFIXME\b/],
    ['sin NOT_IMPLEMENTED',      /NOT_IMPLEMENTED/],
    ['sin "implement later"',    /implement later/i],
    ['sin "pendiente de la corrida"', /pendiente de la corrida/i],
    ['sin throw de no-implementado', /throw new Error\([^)]*(no implementad|se completa en la corrida)/i],
  ]) check(desc, re.test(smoke) === false);

  for (const fn of ['buildFixtures', 'insertAppointment', 'bookViaIntent',
                    'cancelAsPatient', 'signConsultation', 'cleanup']) {
    const re = new RegExp(`async function ${fn}\\s*\\(`);
    check(`${fn}() está definida`, re.test(smoke));
  }
  check('buildFixtures crea usuarios reales', /admin\.auth\.admin\.createUser/.test(smoke));
  check('bookViaIntent llama register_booking_intent',
    /rpc\('register_booking_intent'/.test(smoke));
  check('bookViaIntent llama create_booking_with_intent',
    /rpc\('create_booking_with_intent'/.test(smoke));
  check('cancelAsPatient llama la RPC', /rpc\('cancel_my_appointment'/.test(smoke));
  check('signConsultation firma la consulta',
    /status: 'signed'/.test(smoke));
  check('cleanup verifica CERO residuos', /CERO residuos/.test(smoke));
  check('el smoke conserva el doble guard',
    /--run/.test(smoke) && /ASP0_SMOKE_AUTHORIZED === '1'/.test(smoke), true);
}

// ─── 12-quinquies. Seguridad operativa del smoke ──────────────────────
{
  console.log('\n12-quinquies. Seguridad operativa del smoke');
  const smoke = read('scripts/_smoke-s7_71a.mjs');

  // ── Modo --preflight read-only ──
  check('existe el modo --preflight', /WANT_PREFLIGHT = ARGV\.includes\('--preflight'\)/.test(smoke));
  check('preflight() está definida', /async function preflight\(\)/.test(smoke));
  // El camino read-only son TRES funciones: preflight() y las dos que usa
  // (listAllAuthUsers, buildManifest, verifyNoCollisions). Todas deben
  // estar libres de escrituras.
  const pf = between(smoke, 'async function preflight()', 'async function verifyFingerprintBeforeWriting');
  const roPath = [
    pf,
    between(smoke, 'async function listAllAuthUsers()', 'async function buildManifest'),
    between(smoke, 'async function buildManifest()', 'function fingerprintOf'),
    between(smoke, 'async function verifyNoCollisions(', 'async function preflight()'),
  ].join('\n');

  check('el camino read-only NO crea usuarios', /auth\.admin\.createUser/.test(roPath) === false);
  check('el camino read-only NO genera links', /generateLink/.test(roPath) === false);
  check('el camino read-only NO inserta', /\.insert\(/.test(roPath) === false);
  // `.update({` = UPDATE de PostgREST. Se distingue de `createHash().update(…)`,
  // que recibe una expresión, no un objeto literal.
  check('el camino read-only NO actualiza', /\.update\(\s*\{/.test(roPath) === false);
  check('el camino read-only NO borra', /\.delete\(/.test(roPath) === false);
  // Se busca la LLAMADA (`.rpc('…')`), no la mención en el texto del
  // contrato que el preflight imprime.
  check('el camino read-only NO llama ninguna RPC', /\.rpc\(/.test(roPath) === false);

  check('preflight reporta las identidades exactas', /Identidades sintéticas propuestas/.test(pf));
  check('preflight verifica Auth con Admin API read-only',
    /listAllAuthUsers\(\)/.test(roPath) && /admin\.auth\.admin\.listUsers/.test(roPath), true);
  check('preflight comprueba profiles/patients/clinics/services',
    /profiles · email/.test(roPath) && /patients · marca/.test(roPath));
  check('preflight comprueba booking_intents y grants',
    /booking_intents/.test(pf) && /auth_creation_grants/.test(pf));
  check('preflight descarta Katherine', /Katherine está en la lista/.test(pf));
  check('preflight descarta Camilo (demo)', /Camilo \(demo\) está en la lista/.test(pf));
  check('preflight descarta Test Phones reservados',
    /los Test Phones documentados están en la lista/.test(pf));
  check('preflight verifica cancel_reasons vía catalogChecks',
    /catalogChecks\(manifest\)/.test(pf));
  check('preflight documenta el contrato de las RPC de booking',
    /register_booking_intent\(p_doctor_id/.test(pf) && /create_booking_with_intent\(p_intent_id/.test(pf));
  check('preflight aborta con exit ≠ 0 si hay colisión',
    /process\.exit\(usable \? 0 : 1\)/.test(pf));

  // ── Identidades deterministas ──
  check('ASP0_RUN_ID es obligatorio', /ASP0_RUN_ID/.test(smoke)
    && /\^\[a-z0-9\]\{4,12\}\$/.test(smoke), true);
  check('las identidades se derivan del RUN_ID (deterministas)',
    /export const identitiesFor = \(runId\) => \['patient', 'doctora', 'doctorb'\]\.map/.test(smoke));
  check('las 3 identidades pasan por la guarda',
    /assertNotForbidden\(SYNTHETIC_PHONES\[i\], `identidad \$\{tag\}`\)/.test(smoke));

  // ── Inventario EXHAUSTIVO de Auth ──
  const la = between(smoke, 'async function listAllAuthUsers()', 'async function buildManifest');
  check('existe listAllAuthUsers()', la.length > 200);
  check('usa páginas pequeñas para acotar el fallo (50)', /AUTH_PER_PAGE = 50;/.test(smoke));
  check('recorre desde page = 1', /for \(let page = 1; page <= AUTH_MAX_PAGES; page\+\+\)/.test(la));
  check('NO usa batch.length < perPage como prueba de finalización',
    /if \(batch\.length < AUTH_PER_PAGE\) \{ complete = true/.test(la) === false);
  check('lee la metadata real: total', /num\(data\?\.total\)/.test(la));
  check('lee la metadata real: lastPage', /num\(data\?\.lastPage\)/.test(la));
  check('lee la metadata real: nextPage', /num\(data\?\.nextPage\)/.test(la));
  check('termina por total alcanzado', /if \(total !== null && byId\.size >= total\)/.test(la));
  check('termina por lastPage alcanzado', /if \(lastPage !== null && page >= lastPage\)/.test(la));
  // El comentario que lo explica vive en el encabezado de la función, que
  // `stripComments` elimina; se busca sobre el texto CRUDO del smoke.
  check('contempla total múltiplo exacto de perPage (no corta por página llena)',
    /múltiplo exacto de `perPage`/.test(read('scripts/_smoke-s7_71a.mjs')));
  check('detecta límite silencioso de perPage',
    /límite silencioso/.test(la) && /effectivePerPage = batch\.length/.test(la));
  check('detecta metadata inconsistente (total cambia entre páginas)',
    /el total anunciado cambió entre páginas/.test(la));
  check('detecta metadata inconsistente (lastPage cambia)',
    /lastPage cambió entre páginas/.test(la));
  check('detecta metadata AUSENTE y falla cerrado',
    /no devolvió total, lastPage ni nextPage/.test(la));
  check('detecta discrepancia total vs ids únicos',
    /discrepancia: la API anunció total=/.test(la));
  check('registra páginas y usuarios únicos',
    /pages\+\+/.test(la) && /byId\.set\(u\.id, u\)/.test(la));
  check('detecta páginas repetidas (firma por ids)',
    /seenPages\.has\(sig\)/.test(la) && /paginación rota/.test(la));
  check('detecta ausencia de avance', /no aportó ningún id nuevo \(sin avance\)/.test(la));
  check('impone un tope defensivo de páginas', /AUTH_MAX_PAGES = 400;/.test(smoke)
    && /tope defensivo de \$\{AUTH_MAX_PAGES\} páginas/.test(la), true);
  check('aborta si la API devuelve error', /listUsers\(page=\$\{page\}\) falló/.test(la));
  check('la validación final puede revocar complete',
    /if \(complete && total !== null && byId\.size !== total\)/.test(la));
  check('FALLA CERRADO: sin inventario completo no hay huella ni --run',
    /FALLA CERRADO: no se leen catálogos, no se construye manifiesto/.test(smoke));
  check('la colisión se busca por email normalizado',
    /emailSet\.has\(u\.email\.toLowerCase\(\)\)/.test(smoke));
  check('la colisión se busca por teléfono normalizado',
    /phoneSet\.has\(normalizePhone\(u\.phone\)\)/.test(smoke));
  check('profiles se declara comprobación ADICIONAL, no sustituto',
    /comprobación ADICIONAL, nunca un\s*\*? ?sustituto|comprobaciones ADICIONALES:/.test(smoke.replace(/\s+/g, ' ')));
  check('NUNCA SQL sobre auth.users para el inventario',
    /Nunca se consulta `auth\.users` por SQL/.test(smoke));

  // ── Manifiesto y huella ──
  // Estructura del manifiesto PLANO. El contenido y la sensibilidad se
  // prueban en §15 sobre la implementación real importada.
  const bm = between(smoke, 'export function flatManifest(', 'export function fingerprintOf');
  check('existe flatManifest()', bm.length > 200);
  check('el manifiesto incluye run_id', /run_id: runId/.test(bm));
  check('el manifiesto incluye un email por identidad', /m\[`email_\$\{i\}`\] = id\.email/.test(bm));
  check('el manifiesto incluye un teléfono por identidad', /m\[`phone_\$\{i\}`\] = id\.phone/.test(bm));
  check('el manifiesto incluye specialty_id', /specialty_id: specialtyId/.test(bm));
  check('los estados van PLANOS, sin objeto anidado',
    /programada_status_id: programadaId/.test(bm)
    && /confirmada_status_id: confirmadaId/.test(bm)
    && /cancelada_status_id: canceladaId/.test(bm), true);
  check('el manifiesto incluye cancel_reason_id', /cancel_reason_id: cancelReasonId/.test(bm));
  check('el manifiesto incluye el host del proyecto', /project_host: host/.test(bm));
  check('el manifiesto incluye la versión de la migración',
    /migration_version: 's7_71a'/.test(bm));
  check('el manifiesto incluye el SHA-256 de la migración',
    /migration_sha256: migrationSha/.test(bm));
  check('el SHA-256 normaliza CRLF a LF antes de hashear',
    /readFileSync\(path, 'utf8'\)\.replace\(\/\\r\\n\/g, '\\n'\)/.test(smoke));
  check('el host sale de SUPABASE_URL, nunca la clave',
    /new globalThis\.URL\(URL\)\.hostname/.test(smoke));
  // Patrones de SECRETO, no palabras sueltas: `qa_service_first_visit_id` es
  // un id de catálogo perfectamente público y contiene "service". La garantía
  // dura sobre el contenido real vive en §15, que inspecciona un manifiesto
  // construido, no el texto fuente.
  check('el manifiesto NO incluye claves ni secretos',
    /SERVICE_ROLE|ANON_KEY|SUPABASE_KEY|\btoken\b|password|secret/i.test(bm) === false);
  check('el manifiesto subió de versión (v: 6)', /v: 6,/.test(bm));
  check('advierte contra el replacer array de JSON.stringify',
    /NO usar `JSON\.stringify\(obj, Object\.keys\(obj\)\.sort\(\)\)`/.test(smoke));
  check('la huella es SHA-256 sobre la serialización canónica',
    /createHash\('sha256'\)\.update\(stableStringify\(manifest\), 'utf8'\)\.digest\('hex'\)/.test(smoke));
  check('stableStringify ordena recursivamente',
    /export function stableStringify\(value\)/.test(smoke)
    && /Object\.keys\(value\)\.sort\(\)/.test(smoke)
    && /value\.map\(stableStringify\)/.test(smoke), true);
  check('preflight emite ASP0_PREFLIGHT_FINGERPRINT',
    /ASP0_PREFLIGHT_FINGERPRINT=\$\{fp\}/.test(smoke));
  check('no se emite huella si hay colisión o inventario incompleto',
    /NO se emite huella: --run queda bloqueado/.test(smoke));
  check('--run exige la huella', /WANT_RUN && !\/\^\[0-9a-f\]\{64\}\$\/\.test\(EXPECTED_FINGERPRINT\)/.test(smoke));
  check('la huella se verifica ANTES de la primera escritura',
    /async function verifyFingerprintBeforeWriting\(\)/.test(smoke)
    && smoke.indexOf('await verifyFingerprintBeforeWriting()') < smoke.indexOf('await buildFixtures(manifest)'), true);
  check('--run reconstruye el manifiesto',
    /const manifest = await buildManifest\(authState\);[\s\S]{0,120}fingerprintOf\(manifest\)/.test(smoke));
  check('--run aborta si la huella no coincide',
    /ABORTADO antes de escribir: la huella del manifiesto no coincide/.test(smoke));
  check('--run repite las comprobaciones de colisión',
    /await verifyNoCollisions\(\{ verbose: false, auth \}\)/.test(smoke));
  check('--run aborta si aparece colisión',
    /ABORTADO antes de escribir: colisión detectada/.test(smoke));
  check('el smoke no escribe archivos', /writeFileSync|appendFileSync/.test(smoke) === false);

  // ── try/finally global ──
  check('la corrida va en try/finally', /try \{\s*await run\(\);/.test(smoke));
  check('el finally ejecuta el cleanup', /\} finally \{[\s\S]{0,400}await cleanup\(\)/.test(smoke));
  check('el cleanup acumula errores sin interrumpir',
    /cleanupErrors\.push/.test(smoke));
  check('el cleanup del cleanup también está protegido',
    /cleanupErrors\.push\(`cleanup abortó/.test(smoke));
  check('el proceso falla si queda cualquier residuo',
    /const clean = fail === 0 && cleanupErrors\.length === 0 && !runError/.test(smoke));

  // ── Ciclo de vida de Auth ──
  check('los user_id se registran al crearlos', /ids\.users\.push\(data\.user\.id\)/.test(smoke));
  check('los usuarios se borran con la Admin API',
    /admin\.auth\.admin\.deleteUser\(uid\)/.test(smoke));
  check('NUNCA se toca auth.users por SQL',
    /from\(['"]auth\.users['"]\)|DELETE FROM auth\.users/.test(smoke) === false);
  check('se verifica la ausencia con getUserById',
    /admin\.auth\.admin\.getUserById\(uid\)/.test(smoke));
  check('los usuarios que sobrevivan cuentan como residuo',
    /rows\.push\(\{ label: 'auth\.users \(getUserById\)', result: authUnknown\.length > 0/.test(smoke)
    && /count: authLeft/.test(smoke), true);
  check('un getUserById que falla NO cuenta como usuario eliminado',
    /if \(\/not\.\?found\/i\.test\(error\.message \?\? ''\)\) continue;/.test(smoke)
    && /authUnknown\.push/.test(smoke), true);
  for (const t of ['profiles', 'patients', 'doctors', 'clinic_members',
                   'appointments', 'booking_intents', 'auth_creation_grants']) {
    check(`el inventario final cubre ${t}`, new RegExp(`'${t}'`).test(smoke));
  }

  // ── audit_log: allowlist obligatoria ──
  const ca = between(smoke, 'async function cleanupAuditLog()', 'async function finalInventory');
  check('el borrado de audit_log usa allowlist explícita', /\.in\('record_id', allow\)/.test(ca));
  check('created_at es condición ADICIONAL, no suficiente',
    /\.in\('record_id', allow\)[\s\S]{0,200}\.gte\('created_at', RUN_STARTED_AT\)/.test(ca));
  check('reporta cantidad y record_id previstos antes de borrar',
    /audit_log previsto: \$\{filas\.length\}/.test(ca));
  check('aborta si aparece un record_id fuera de la allowlist',
    /const fuera = distintos\.filter/.test(ca) && /ABORTADO: record_id fuera de la allowlist/.test(ca));
  check('no borra nada cuando aborta',
    /console\.error\(`  ⛔ ABORTADO[\s\S]{0,80}return;/.test(ca));
  check('verifica cero filas sintéticas después',
    /audit_log \(sintético\)/.test(smoke));
  check('ningún DELETE de audit_log solo por fecha',
    /audit_log'\)\.delete\(\)\s*\.gte\('created_at'/.test(smoke) === false);

  // ── Firma de consulta: opt-in, no productiva ──
  check('la firma es opt-in con --include-sign', /INCLUDE_SIGN = ARGV\.includes\('--include-sign'\)/.test(smoke));
  check('por defecto NO se ejecuta la firma', /if \(INCLUDE_SIGN\) \{/.test(smoke));
  check('el smoke declara que sin la bandera NO cuenta como cobertura',
    /NO cuenta como cobertura de firma/.test(smoke));
  check('el cleanup borra las dependencias de la consulta',
    /consultation_amendments/.test(smoke) && /consultation_diagnoses/.test(smoke));
}

// ─── 13. Higiene ──────────────────────────────────────────────────────
{
  console.log('\n13. Higiene');
  for (const [desc, re] of [
    ['sin service_role key',   /eyJ[A-Za-z0-9_-]{20,}/],
    ['sin claves de Turnstile', /0x4AAA[A-Za-z0-9_-]{8,}/],
    ['sin tokens de GitHub',    /gh[pousr]_[A-Za-z0-9]{16,}/],
    ['sin teléfonos reales',    /50372608827/],
  ]) {
    check(`${desc} (migración)`, re.test(sql) === false);
    check(`${desc} (rollback)`,  re.test(rb) === false);
  }
  // Sobre el texto CRUDO: acá sí se verifica la documentación.
  check('el rollback documenta que NO borra datos',
    /NO BORRA DATOS/i.test(rbRaw));
  check('la migración documenta qué queda para s7_71b',
    /QUÉ \*\*NO\*\* HACE \(es s7_71b\)/.test(sqlRaw));
}

// ─── 14. Categorías de teléfonos — sobre la implementación REAL ───────
{
  console.log('\n14. Categorías de teléfonos prohibidos (implementación real)');

  const ACTIVOS_ESPERADOS = [
    '50378627694', '50378056365', '50378873634', '50378590126',
    '50375000001', '50375000099', '50378626108', '50377507479',
    '50377316374', '50376193396', '50370007201',
  ];

  check(`ACTIVE_SUPABASE_TEST_PHONES tiene exactamente 11 (${ACTIVE_SUPABASE_TEST_PHONES.length})`,
    ACTIVE_SUPABASE_TEST_PHONES.length === 11);
  for (const p of ACTIVOS_ESPERADOS) {
    check(`activo ${p} presente`, ACTIVE_SUPABASE_TEST_PHONES.includes(p));
  }
  check('no hay activos de más',
    ACTIVE_SUPABASE_TEST_PHONES.every((p) => ACTIVOS_ESPERADOS.includes(p)));

  check('Katherine está en REAL_OR_DEMO_PHONES', REAL_OR_DEMO_PHONES.includes('50372608827'));
  check('Camilo está en ambas categorías (activo + demo)',
    ACTIVE_SUPABASE_TEST_PHONES.includes('50378627694')
    && REAL_OR_DEMO_PHONES.includes('50378627694'), true);
  check('50370007202 es histórico, NO activo',
    HISTORICAL_OR_RESERVED_PHONES.includes('50370007202')
    && !ACTIVE_SUPABASE_TEST_PHONES.includes('50370007202'), true);
  check('77316374 está clasificado como histórico/alias',
    HISTORICAL_OR_RESERVED_PHONES.includes('77316374'));

  check('las cinco categorías existen y no están vacías',
    [ACTIVE_SUPABASE_TEST_PHONES, REAL_OR_DEMO_PHONES, HISTORICAL_OR_RESERVED_PHONES,
     PRIOR_FIXTURE_PHONES, DOC_PLACEHOLDER_PHONES].every((c) => Array.isArray(c) && c.length > 0));

  check('77316374 normaliza igual que 50377316374',
    normalizePhone('77316374') === normalizePhone('50377316374'));
  check('la unión normalizada deduplica', FORBIDDEN_NORMALIZED.size < FORBIDDEN_PHONES.length);
  const dups = FORBIDDEN_PHONES.length - FORBIDDEN_NORMALIZED.size;
  check(`se deduplicaron ${dups} entradas (Camilo + alias sin 503)`, dups === 2);
  console.log(`     crudo: ${FORBIDDEN_PHONES.length} · normalizado único: ${FORBIDDEN_NORMALIZED.size}`);

  check('todos los activos están en FORBIDDEN_NORMALIZED',
    ACTIVE_SUPABASE_TEST_PHONES.every((p) => FORBIDDEN_NORMALIZED.has(normalizePhone(p))));

  for (const p of SYNTHETIC_PHONES) {
    check(`candidato ${p} NO está prohibido`, !FORBIDDEN_NORMALIZED.has(normalizePhone(p)));
  }

  // El OTP fijo no puede aparecer en el código ni en la documentación nueva.
  const smokeRaw = read('scripts/_smoke-s7_71a.mjs');
  const docRaw = read('docs/OWNER_S7_71A_APPLY.md');
  // Token AISLADO, no subcadena: el placeholder de documentación
  // 503·12345678 contiene esos seis dígitos y no es un OTP.
  const OTP = String(120000 + 3456);   // no se escribe literal en el repo
  const otpSuelto = new RegExp(`(?<!\\d)${OTP}(?!\\d)`);
  check('el smoke NO documenta el OTP fijo', otpSuelto.test(smokeRaw) === false);
  check('la guía NO documenta el OTP fijo', otpSuelto.test(docRaw) === false);
  check('las migraciones NO documentan el OTP fijo',
    otpSuelto.test(read('migrations/s7_71a_audit_appointments_coverage.sql')) === false);

  const pfRaw = between(smokeRaw, 'async function preflight()', 'async function verifyFingerprintBeforeWriting');
  check('preflight imprime ACTIVE_SUPABASE_TEST_PHONES con su cantidad',
    /ACTIVE_SUPABASE_TEST_PHONES/.test(pfRaw)
    && /\$\{ACTIVE_SUPABASE_TEST_PHONES\.length\}/.test(pfRaw), true);
  check('preflight imprime HISTORICAL_OR_RESERVED_PHONES', /HISTORICAL_OR_RESERVED_PHONES/.test(pfRaw));
  check('preflight imprime el total normalizado', /FORBIDDEN_NORMALIZED\.size/.test(pfRaw));
}

// ─── 15. Fingerprint — pruebas de sensibilidad (puras, sin DB) ────────
{
  console.log('\n15. Fingerprint — serialización canónica y sensibilidad');

  check('stableStringify ordena claves anidadas',
    stableStringify({ b: { z: 1, a: 2 }, a: 3 }) === '{"a":3,"b":{"a":2,"z":1}}');
  check('stableStringify conserva el orden de los arrays',
    stableStringify({ a: [3, 1, 2] }) === '{"a":[3,1,2]}');
  check('stableStringify serializa valores anidados profundos',
    stableStringify({ a: { b: { c: 'x' } } }) === '{"a":{"b":{"c":"x"}}}');
  check('stableStringify maneja null', stableStringify({ a: null }) === '{"a":null}');

  // Demostración del defecto que se corrigió: el replacer array descarta
  // silenciosamente las claves de los objetos anidados.
  const anidado = { top: 1, nested: { inner: 'MARCA_ESTRUCTURAL' } };
  check('el replacer array DESCARTA claves anidadas (bug corregido)',
    JSON.stringify(anidado, Object.keys(anidado).sort()).includes('MARCA_ESTRUCTURAL') === false);
  check('stableStringify SÍ las conserva',
    stableStringify(anidado).includes('MARCA_ESTRUCTURAL'));

  const base = {
    projectHost: 'proyecto.supabase.co',
    migrationSha: 'a'.repeat(64),
    runId: 'test01',
    identities: identitiesFor('test01'),
    specialtyId: 'spec-1', programadaId: 'st-p', confirmadaId: 'st-c',
    canceladaId: 'st-x', cancelReasonId: 'cr-1',
  };
  const m0 = flatManifest(base);
  const fp0 = fingerprintOf(m0);
  check('la huella es un sha256 hex', /^[0-9a-f]{64}$/.test(fp0));

  const barajado = {};
  for (const k of Object.keys(m0).sort().reverse()) barajado[k] = m0[k];
  check('mismo manifiesto con claves en otro orden → MISMA huella',
    fingerprintOf(barajado) === fp0);

  check('el manifiesto es completamente plano',
    Object.values(m0).every((v) => v === null || typeof v !== 'object'));

  const distinta = (mut, desc) =>
    check(`cambiar ${desc} → huella DISTINTA`,
      fingerprintOf(flatManifest({ ...base, ...mut })) !== fp0);

  distinta({ projectHost: 'otro.supabase.co' }, 'project_host');
  distinta({ migrationSha: 'b'.repeat(64) }, 'migration_sha256');
  distinta({ runId: 'test02' }, 'run_id');
  distinta({ specialtyId: 'spec-2' }, 'specialty_id');
  distinta({ programadaId: 'st-p2' }, 'programada_status_id');
  distinta({ confirmadaId: 'st-c2' }, 'confirmada_status_id');
  distinta({ canceladaId: 'st-x2' }, 'cancelada_status_id');
  distinta({ cancelReasonId: 'cr-2' }, 'cancel_reason_id');

  for (let i = 0; i < 3; i++) {
    const ids = identitiesFor('test01').map((x) => ({ ...x }));
    ids[i].email = `mutado-${i}@lucycare.test`;
    check(`cambiar email_${i} → huella DISTINTA`,
      fingerprintOf(flatManifest({ ...base, identities: ids })) !== fp0);
  }
  for (let i = 0; i < 3; i++) {
    const ids = identitiesFor('test01').map((x) => ({ ...x }));
    ids[i].phone = `5037000999${i}`;
    check(`cambiar phone_${i} → huella DISTINTA`,
      fingerprintOf(flatManifest({ ...base, identities: ids })) !== fp0);
  }

  const blob = JSON.stringify(m0);
  for (const [desc, re] of [
    ['service_role key', /eyJ[A-Za-z0-9_-]{20,}/],
    ['nombre de variable de servicio', /SERVICE_ROLE/i],
    ['anon key', /ANON_KEY/i],
    ['token', /token/i],
    ['password', /password/i],
  ]) check(`el manifiesto NO contiene ${desc}`, re.test(blob) === false);
  check('solo va el hostname, nunca la URL completa',
    m0.project_host === 'proyecto.supabase.co' && !blob.includes('http'), true);

  // ── Checksum de la migración: determinista y normalizado a LF ──
  const sha1 = migrationSha256();
  check('migrationSha256 es determinista entre llamadas', sha1 === migrationSha256());
  check('migrationSha256 devuelve sha256 hex', /^[0-9a-f]{64}$/.test(sha1));
  const lf = read('migrations/s7_71a_audit_appointments_coverage.sql').replace(/\r\n/g, '\n');
  check('el checksum se calcula sobre contenido normalizado a LF', sha1 === sha256hex(lf));
  const crlf = lf.replace(/\n/g, '\r\n');
  check('CRLF y LF del mismo archivo dan la MISMA huella',
    sha256hex(crlf.replace(/\r\n/g, '\n')) === sha1);
  check('el método de normalización está documentado en el código',
    /contenido NORMALIZADO A LF, no el binario/.test(read('scripts/_smoke-s7_71a.mjs')));
}

// ─── 16. Catálogos: la lógica REAL del preflight, sin DB ─────────────
//
// Esta sección existe por un fallo concreto: tras aplanar el manifiesto, el
// preflight seguía leyendo `manifest.appointment_statuses[n]`, una clave que
// ya no existía, y reventó con TypeError EN PRODUCCIÓN. El check anterior no
// lo vio porque solo validaba la estructura del código, nunca la ejecución.
// Acá se ejercita `catalogChecks()` —la misma función que usa preflight—
// con manifiestos de ejemplo.
{
  console.log('\n16. Validación de catálogos (lógica real, sin DB)');

  const completo = flatManifest({
    projectHost: 'p.supabase.co', migrationSha: 'a'.repeat(64), runId: 'test01',
    identities: identitiesFor('test01'),
    specialtyId: 'spec-1', programadaId: 'st-p', confirmadaId: 'st-c',
    canceladaId: 'st-x', cancelReasonId: 'cr-1',
  });

  const res = catalogChecks(completo);
  check('catalogChecks devuelve 5 comprobaciones', res.length === 5);
  check('con un manifiesto completo, las 5 pasan', res.every(([, okc]) => okc === true));
  check('usa las claves PLANAS de estado',
    res.some(([d]) => d.includes('programada'))
    && res.some(([d]) => d.includes('confirmada'))
    && res.some(([d]) => d.includes('cancelada')), true);

  // Cada campo ausente debe producir UN false, nunca una excepción.
  for (const clave of ['specialty_id', 'programada_status_id', 'confirmada_status_id',
                       'cancelada_status_id', 'cancel_reason_id']) {
    const roto = { ...completo, [clave]: null };
    let lanzo = false, fallos = 0;
    try { fallos = catalogChecks(roto).filter(([, okc]) => !okc).length; }
    catch { lanzo = true; }
    check(`sin ${clave}: reporta fallo y NO lanza`, lanzo === false && fallos === 1);
  }

  // El caso exacto del bug: un manifiesto SIN la clave anidada anterior.
  let lanzoUndefined = false;
  try { catalogChecks({}); } catch { lanzoUndefined = true; }
  check('un manifiesto vacío NO produce TypeError', lanzoUndefined === false);
  check('un manifiesto vacío reporta los 5 fallos',
    catalogChecks({}).filter(([, okc]) => !okc).length === 5);
  let lanzoNulo = false;
  try { catalogChecks(null); } catch { lanzoNulo = true; }
  check('catalogChecks(null) NO lanza', lanzoNulo === false);

  // Nadie puede volver a leer la clave anidada eliminada.
  // `stripComments` solo quita comentarios SQL (`--`); acá hace falta
  // descartar también los de JS, porque la explicación del bug menciona la
  // clave a propósito.
  const smokeRaw = read('scripts/_smoke-s7_71a.mjs');
  const codigo = smokeRaw.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  check('NO queda ninguna lectura de manifest.appointment_statuses',
    /manifest\.appointment_statuses/.test(codigo) === false);
  check('NO queda ningún acceso indexado a appointment_statuses[',
    /appointment_statuses\s*\[/.test(codigo) === false);
  check('buildFixtures usa las claves planas',
    /statusProgramada: manifest\.programada_status_id/.test(codigo)
    && /statusConfirmada: manifest\.confirmada_status_id/.test(codigo), true);
  check('el preflight usa catalogChecks()',
    /const catRes = catalogChecks\(manifest\)/.test(codigo));
  check('el preflight deriva catalogsOk del resultado real',
    /const catalogsOk = catRes\.every\(\(\[, c\]\) => c === true\)/.test(codigo));
}

// ─── 17. Fallo inmediato del inventario de Auth ──────────────────────
{
  console.log('\n17. Fallo inmediato de Auth (corte antes de catálogos)');
  const smokeRaw = read('scripts/_smoke-s7_71a.mjs');
  const codigo = stripComments(smokeRaw);
  const pfCode = between(codigo, 'async function preflight()', 'async function verifyFingerprintBeforeWriting');

  check('el inventario se resuelve ANTES de los catálogos',
    pfCode.indexOf('await listAllAuthUsers()') < pfCode.indexOf('await buildManifest(authState)'));
  check('sin atestación válida, sale con exit 1',
    /if \(!authRes\.proceed\) \{[\s\S]*?process\.exit\(1\);/.test(pfCode));
  check('el corte ocurre antes de construir el manifiesto',
    pfCode.indexOf('process.exit(1)') < pfCode.indexOf('await buildManifest(authState)'));
  check('imprime el diagnóstico estructurado', /authFailureReport\(auth\)/.test(pfCode));
  check('NO usa profiles como sustituto',
    /La tabla profiles NO se usa como sustituto de Auth/.test(smokeRaw));

  // El diagnóstico: cifras sí, datos de usuario no.
  const afr = between(codigo, 'export function authFailureReport(auth)', '\n}');
  check('el diagnóstico reporta la página exacta que falló', /failedPage/.test(afr));
  check('el diagnóstico reporta el perPage efectivo', /effectivePerPage/.test(afr));
  check('el diagnóstico reporta los usuarios únicos acumulados', /auth\.unique/.test(afr));
  check('el diagnóstico reporta la metadata de la última página sana',
    /lastHealthyMeta/.test(afr));
  check('el diagnóstico NO imprime emails ni teléfonos',
    /email|phone/i.test(afr) === false);
  check('lastHealthyMeta solo guarda cifras',
    /lastHealthyMeta = \{ page, batch: batch\.length, total: mTotal, lastPage: mLast, nextPage: mNext \}/
      .test(codigo));

  check('AUTH_PER_PAGE bajó a 50', /const AUTH_PER_PAGE = 50;/.test(codigo));
  check('el tope defensivo se ajustó', /const AUTH_MAX_PAGES = 400;/.test(codigo));
  check('no se omite una página defectuosa (break, no continue)',
    /failedPage = page;[\s\S]{0,120}break;/.test(codigo));
}

// ─── 18. Metadatos seguros antes del inventario ──────────────────────
{
  console.log('\n18. Metadatos seguros antes de listUsers');
  const smokeRaw = read('scripts/_smoke-s7_71a.mjs');
  const codigo = stripComments(smokeRaw);
  const pfCode = between(codigo, 'async function preflight()', 'async function verifyFingerprintBeforeWriting');

  for (const [desc, re] of [
    ['project_host',      /project_host      : \$\{projectHost\(\)/],
    ['migration_version', /migration_version : s7_71a/],
    ['migration_sha256',  /migration_sha256  : \$\{migrationSha256\(\)\}/],
    ['HEAD',              /HEAD              : \$\{repoHead\(\)\}/],
    ['RUN_ID',            /ASP0_RUN_ID       : \$\{RUN_ID\}/],
  ]) check(`imprime ${desc} antes del inventario`, re.test(pfCode));

  check('imprime los candidatos antes del inventario',
    pfCode.indexOf('candidatos:') < pfCode.indexOf('await listAllAuthUsers()'));
  check('todos los metadatos van antes de listUsers',
    pfCode.indexOf('migration_sha256') < pfCode.indexOf('await listAllAuthUsers()'));
  check('NO imprime la URL completa',
    /console\.log\([^)]*\bURL\b[^)]*\)/.test(pfCode) === false);
  check('repoHead no lanza si git falla', /catch \{ return '\(no disponible\)'; \}/.test(codigo));
}

// ─── 19. Atestación manual del owner (excepción acotada) ─────────────
{
  console.log('\n19. Atestación manual del owner');

  const IDS = identitiesFor('s771a0805a');
  const base = {
    attested: '1', date: '2026-08-06',
    attestedRunId: 's771a0805a', runId: 's771a0805a', identities: IDS,
  };

  // ── Constantes atadas al conjunto exacto ──
  check('la atestación fija el RUN_ID autorizado', OWNER_ATTESTATION.run_id === 's771a0805a');
  check('la atestación fija la fecha de verificación', OWNER_ATTESTATION.date === '2026-08-06');
  check('el sha de identidades es sha256 hex',
    /^[0-9a-f]{64}$/.test(OWNER_ATTESTATION.identities_sha256));
  check('el sha corresponde a las 6 identidades reales',
    identitiesFingerprint(IDS) === OWNER_ATTESTATION.identities_sha256);

  // ── Caso válido ──
  const okAtt = evaluateAttestation(base);
  check('con las tres variables exactas, la atestación es VÁLIDA', okAtt.valid === true);
  check('devuelve el sha de las identidades', okAtt.sha === OWNER_ATTESTATION.identities_sha256);

  // ── Cada variable es obligatoria ──
  for (const [desc, mut] of [
    ['sin ASP0_OWNER_AUTH_ATTESTED',          { attested: '' }],
    ['con ASP0_OWNER_AUTH_ATTESTED=0',        { attested: '0' }],
    ['sin fecha',                             { date: '' }],
    ['con fecha distinta',                    { date: '2026-08-07' }],
    ['sin RUN_ID atestado',                   { attestedRunId: '' }],
    ['con RUN_ID atestado distinto',          { attestedRunId: 'otrorun01' }],
  ]) check(`${desc} → atestación INVÁLIDA`, evaluateAttestation({ ...base, ...mut }).valid === false);

  // ── No se puede reutilizar con otro RUN_ID ──
  const otroRun = evaluateAttestation({
    ...base, runId: 'otrorun01', identities: identitiesFor('otrorun01'),
  });
  check('no se puede reutilizar con otro RUN_ID', otroRun.valid === false);
  check('el motivo señala identidades y RUN_ID',
    otroRun.reasons.some((r) => /otro RUN_ID/.test(r))
    && otroRun.reasons.some((r) => /identidades NO son las atestadas/.test(r)), true);

  // ── No se pueden cambiar las identidades ──
  for (let i = 0; i < 3; i++) {
    const mail = IDS.map((x) => ({ ...x }));
    mail[i].email = `otro-${i}@lucycare.test`;
    check(`cambiar email_${i} → atestación INVÁLIDA`,
      evaluateAttestation({ ...base, identities: mail }).valid === false);

    const tel = IDS.map((x) => ({ ...x }));
    tel[i].phone = `5037000999${i}`;
    check(`cambiar phone_${i} → atestación INVÁLIDA`,
      evaluateAttestation({ ...base, identities: tel }).valid === false);
  }

  // ── Manifiesto: campos de Auth y sensibilidad de la huella ──
  const manBase = {
    projectHost: 'p.supabase.co', migrationSha: 'a'.repeat(64), runId: 's771a0805a',
    identities: IDS, specialtyId: 's', programadaId: 'p', confirmadaId: 'c',
    canceladaId: 'x', cancelReasonId: 'r',
    authInventoryComplete: false, authVerificationMode: 'owner_manual_exact_search',
    authUsersInspected: 100, authTotalAnnounced: 139, authFailedPage: 3,
    ownerAttestedNoCollisions: true, ownerAttestedDate: '2026-08-06',
    ownerAttestedIdentitiesSha256: OWNER_ATTESTATION.identities_sha256,
  };
  const man = flatManifest(manBase);
  const fpBase = fingerprintOf(man);

  for (const k of ['auth_inventory_complete', 'auth_verification_mode',
                   'auth_users_inspected', 'auth_total_announced', 'auth_failed_page',
                   'owner_attested_no_collisions', 'owner_attested_date',
                   'owner_attested_identities_sha256']) {
    check(`el manifiesto incluye ${k}`, Object.prototype.hasOwnProperty.call(man, k));
  }
  check('el manifiesto sigue siendo plano',
    Object.values(man).every((v) => v === null || typeof v !== 'object'));
  check('auth_inventory_complete = false bajo atestación',
    man.auth_inventory_complete === false);
  check('auth_verification_mode = owner_manual_exact_search',
    man.auth_verification_mode === 'owner_manual_exact_search');

  for (const [desc, mut] of [
    ['auth_inventory_complete',         { authInventoryComplete: true }],
    ['auth_verification_mode',          { authVerificationMode: 'listusers_exhaustive' }],
    ['auth_users_inspected',            { authUsersInspected: 139 }],
    ['auth_total_announced',            { authTotalAnnounced: 140 }],
    ['auth_failed_page',                { authFailedPage: 4 }],
    ['owner_attested_no_collisions',    { ownerAttestedNoCollisions: null }],
    ['owner_attested_date',             { ownerAttestedDate: '2026-08-07' }],
    ['owner_attested_identities_sha256', { ownerAttestedIdentitiesSha256: 'b'.repeat(64) }],
  ]) check(`cambiar ${desc} → huella DISTINTA`,
    fingerprintOf(flatManifest({ ...manBase, ...mut })) !== fpBase);

  check('el manifiesto subió a v: 6', man.v === 6);
  const blob = JSON.stringify(man);
  check('el manifiesto sigue sin secretos',
    /eyJ[A-Za-z0-9_-]{20,}|SERVICE_ROLE|ANON_KEY|token|password/i.test(blob) === false);

  // ── Estructura del código ──
  const codigo = read('scripts/_smoke-s7_71a.mjs').split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  check('el default sigue siendo fail-closed (sin atestación, exit 1)',
    /if \(!authRes\.proceed\) \{[\s\S]*?process\.exit\(1\);/.test(codigo));
  check('las tres variables se leen del entorno',
    /ASP0_OWNER_AUTH_ATTESTED \|\|/.test(codigo)
    && /ASP0_OWNER_AUTH_ATTESTED_DATE \|\|/.test(codigo)
    && /ASP0_OWNER_AUTH_ATTESTED_RUN_ID \|\|/.test(codigo), true);
  check('las colisiones se comprueban igual con atestación',
    /const v = collisionVerdict\(\{/.test(codigo));
  check('los catálogos se validan igual con atestación',
    /catalogChecks\(manifest\)/.test(codigo));
  check('--run exige la misma atestación',
    /ABORTADO antes de escribir: inventario de Auth incompleto y sin atestación válida/.test(codigo));
  check('una colisión aborta aunque haya atestación',
    /ABORTADO antes de escribir: colisión detectada/.test(codigo));
  check('el preflight declara el alcance exacto de la excepción',
    /EXCLUSIVAMENTE esas 3 direcciones y 3 teléfonos/.test(read('scripts/_smoke-s7_71a.mjs')));
  check('el preflight aclara que la atestación NO sustituye el inventario',
    /atestación no lo sustituye/.test(read('scripts/_smoke-s7_71a.mjs').replace(/\s+/g, ' ')));
  check('el preflight marca el inventario como INCOMPLETO aun con atestación',
    /El inventario de Auth SIGUE marcado como INCOMPLETO/.test(read('scripts/_smoke-s7_71a.mjs').replace(/\s+/g, ' ')));
  // Con atestación válida la huella DEBE emitirse: el inventario incompleto
  // se registra en el manifiesto, no se contabiliza como fallo del preflight.
  check('el inventario incompleto no se contabiliza como fallo antes de la atestación',
    /ko\('inventario de Auth COMPLETO \(NO\)'\)/.test(codigo) === false);
  check('el hecho queda registrado en el manifiesto, no en el contador',
    /auth_inventory_complete = false/.test(read('scripts/_smoke-s7_71a.mjs')));
}

// ─── 20. Flujo de atestación — casos A–H sobre la lógica REAL ────────
{
  console.log('\n20. Flujo de atestación (casos A–H, lógica real, sin DB)');

  const IDS = identitiesFor('s771a0805a');
  const attOk = evaluateAttestation({
    attested: '1', date: '2026-08-06',
    attestedRunId: 's771a0805a', runId: 's771a0805a', identities: IDS,
  });
  const attCon = (mut) => evaluateAttestation({
    attested: '1', date: '2026-08-06',
    attestedRunId: 's771a0805a', runId: 's771a0805a', identities: IDS, ...mut,
  });

  const authIncompleto = { complete: false, unique: 100, total: 139, failedPage: 3 };
  const authCompleto = { complete: true, unique: 139, total: 139, failedPage: null };

  const manFrom = (authState) => flatManifest({
    projectHost: 'p.supabase.co', migrationSha: 'a'.repeat(64), smokeSha: 'b'.repeat(64),
    runId: 's771a0805a', identities: IDS, specialtyId: 's',
    programadaId: 'p', confirmadaId: 'c', canceladaId: 'x', cancelReasonId: 'r',
    ...authState,
  });

  // ── A. Auth incompleto SIN atestación ──
  {
    const r = resolveAuthState({ auth: authIncompleto, attestation: attCon({ attested: '' }) });
    const v = preflightVerdict({ authProceed: r.proceed, noCollisions: true, catalogsOk: true });
    check('A · sin atestación: NO continúa', r.proceed === false);
    check('A · sin atestación: no hay authState (no hay manifiesto aprobado)', r.authState === null);
    check('A · sin atestación: NO emite fingerprint', v.emitFingerprint === false);
    check('A · sin atestación: exit 1', v.exitCode === 1);
    check('A · el motivo lo explica', r.reasons.some((x) => /ASP0_OWNER_AUTH_ATTESTED=1/.test(x)));
  }

  // ── B. Fecha incorrecta ──
  {
    const r = resolveAuthState({ auth: authIncompleto, attestation: attCon({ date: '2026-08-07' }) });
    const v = preflightVerdict({ authProceed: r.proceed, noCollisions: true, catalogsOk: true });
    check('B · fecha incorrecta: NO continúa', r.proceed === false);
    check('B · fecha incorrecta: exit 1', v.exitCode === 1);
    check('B · el motivo menciona la fecha', r.reasons.some((x) => /DATE debe ser 2026-08-06/.test(x)));
  }

  // ── C. RUN_ID incorrecto ──
  {
    const r = resolveAuthState({ auth: authIncompleto, attestation: attCon({ attestedRunId: 'otro12345' }) });
    const v = preflightVerdict({ authProceed: r.proceed, noCollisions: true, catalogsOk: true });
    check('C · RUN_ID incorrecto: NO continúa', r.proceed === false);
    check('C · RUN_ID incorrecto: exit 1', v.exitCode === 1);
    check('C · el motivo menciona el RUN_ID', r.reasons.some((x) => /RUN_ID/.test(x)));
  }

  // ── D. Hash de identidades incorrecto ──
  {
    const otras = IDS.map((x, i) => ({ ...x, email: `intruso-${i}@lucycare.test` }));
    const r = resolveAuthState({ auth: authIncompleto, attestation: attCon({ identities: otras }) });
    const v = preflightVerdict({ authProceed: r.proceed, noCollisions: true, catalogsOk: true });
    check('D · identidades distintas: NO continúa', r.proceed === false);
    check('D · identidades distintas: exit 1', v.exitCode === 1);
    check('D · el motivo señala el hash',
      r.reasons.some((x) => /identidades NO son las atestadas/.test(x)));
  }

  // ── E. Atestación VÁLIDA ──
  {
    const r = resolveAuthState({ auth: authIncompleto, attestation: attOk });
    const v = preflightVerdict({ authProceed: r.proceed, noCollisions: true, catalogsOk: true });
    const m = manFrom(r.authState);
    check('E · atestación válida: continúa', r.proceed === true);
    check('E · modo owner_manual_exact_search', r.mode === 'owner_manual_exact_search');
    check('E · auth_inventory_complete = false', m.auth_inventory_complete === false);
    check('E · auth_verification_mode correcto',
      m.auth_verification_mode === 'owner_manual_exact_search');
    check('E · owner_attested_no_collisions = true', m.owner_attested_no_collisions === true);
    check('E · registra los 100 de 139 y la página 3',
      m.auth_users_inspected === 100 && m.auth_total_announced === 139
      && m.auth_failed_page === 3, true);
    check('E · registra la fecha de atestación', m.owner_attested_date === '2026-08-06');
    check('E · registra el sha de identidades',
      m.owner_attested_identities_sha256 === OWNER_ATTESTATION.identities_sha256);
    check('E · EMITE fingerprint', v.emitFingerprint === true);
    check('E · exit 0', v.exitCode === 0);
  }

  // ── F. Colisión entre los 100 recuperados, con atestación válida ──
  {
    const r = resolveAuthState({ auth: authIncompleto, attestation: attOk });
    const v = preflightVerdict({ authProceed: r.proceed, noCollisions: false, catalogsOk: true });
    check('F · colisión en Auth: ABORTA pese a atestación válida', v.emitFingerprint === false);
    check('F · exit 1', v.exitCode === 1);
    check('F · el bloqueo se nombra', v.blockers.some((b) => /colisión detectada/.test(b)));
  }

  // ── G. Colisión en tablas, con atestación válida ──
  //     `verifyNoCollisions` devuelve un único booleano para Auth y tablas,
  //     así que este caso entra por la misma puerta que F: lo relevante es
  //     que la atestación NO lo neutraliza.
  {
    const r = resolveAuthState({ auth: authIncompleto, attestation: attOk });
    const v = preflightVerdict({ authProceed: true, noCollisions: false, catalogsOk: true });
    check('G · colisión en tablas: ABORTA pese a atestación válida', v.emitFingerprint === false);
    check('G · exit 1', v.exitCode === 1);
    check('G · la atestación seguía siendo válida', r.proceed === true);
  }

  // ── H. Auth COMPLETO sin atestación ──
  {
    const r = resolveAuthState({ auth: authCompleto, attestation: attCon({ attested: '' }) });
    const v = preflightVerdict({ authProceed: r.proceed, noCollisions: true, catalogsOk: true });
    const m = manFrom(r.authState);
    check('H · Auth completo sin atestación: continúa', r.proceed === true);
    check('H · modo listusers_exhaustive', r.mode === 'listusers_exhaustive');
    check('H · auth_inventory_complete = true', m.auth_inventory_complete === true);
    check('H · sin campos de atestación',
      m.owner_attested_no_collisions === null && m.owner_attested_date === null
      && m.owner_attested_identities_sha256 === null, true);
    check('H · EMITE fingerprint', v.emitFingerprint === true);
    check('H · exit 0', v.exitCode === 0);
  }

  // ── Un catálogo faltante también bloquea ──
  {
    const r = resolveAuthState({ auth: authIncompleto, attestation: attOk });
    const v = preflightVerdict({ authProceed: r.proceed, noCollisions: true, catalogsOk: false });
    check('catálogo faltante: NO emite fingerprint', v.emitFingerprint === false);
    check('catálogo faltante: el bloqueo se nombra',
      v.blockers.some((b) => /catálogo requerido faltante/.test(b)));
  }

  // ── El modo de verificación cambia la huella ──
  {
    const inc = manFrom(resolveAuthState({ auth: authIncompleto, attestation: attOk }).authState);
    const com = manFrom(resolveAuthState({ auth: authCompleto, attestation: attOk }).authState);
    check('modos distintos → huellas distintas', fingerprintOf(inc) !== fingerprintOf(com));
  }
}

// ─── 21. smoke_sha256 — la huella cubre el propio script ─────────────
{
  console.log('\n21. smoke_sha256 (la huella cubre el código del smoke)');

  const IDS = identitiesFor('s771a0805a');
  const base = {
    projectHost: 'p.supabase.co', migrationSha: 'a'.repeat(64), smokeSha: 'b'.repeat(64),
    runId: 's771a0805a', identities: IDS, specialtyId: 's',
    programadaId: 'p', confirmadaId: 'c', canceladaId: 'x', cancelReasonId: 'r',
  };
  const m = flatManifest(base);
  const fp0 = fingerprintOf(m);

  check('el manifiesto incluye smoke_sha256',
    Object.prototype.hasOwnProperty.call(m, 'smoke_sha256'));
  check('el manifiesto conserva migration_sha256',
    Object.prototype.hasOwnProperty.call(m, 'migration_sha256'));
  check('el manifiesto subió a v: 6', m.v === 6);
  check('cambiar smoke_sha256 → huella DISTINTA',
    fingerprintOf(flatManifest({ ...base, smokeSha: 'c'.repeat(64) })) !== fp0);
  check('cambiar migration_sha256 → huella DISTINTA',
    fingerprintOf(flatManifest({ ...base, migrationSha: 'c'.repeat(64) })) !== fp0);

  // El checksum real se calcula desde el archivo, con el mismo criterio LF.
  const real = smokeSha256();
  check('smokeSha256 devuelve sha256 hex', /^[0-9a-f]{64}$/.test(real));
  check('smokeSha256 es determinista', real === smokeSha256());
  const lf = read('scripts/_smoke-s7_71a.mjs').replace(/\r\n/g, '\n');
  check('usa el MISMO criterio LF que la migración', real === sha256hex(lf));
  check('migración y smoke usan la misma función', real === fileSha256(SMOKE_PATH));
  check('el checksum del smoke ≠ el de la migración', real !== migrationSha256());

  // Estructura: se recalcula desde el archivo real, no desde una constante.
  const codigo = read('scripts/_smoke-s7_71a.mjs').split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  check('la ruta sale de import.meta.url, no de un literal',
    /export const SMOKE_PATH = fileURLToPath\(import\.meta\.url\)/.test(codigo));
  check('buildManifest recalcula el smoke desde el archivo',
    /smokeSha: smokeSha256\(\)/.test(codigo));
  check('el HEAD de git NO entra en el manifiesto',
    /head|repoHead/.test(between(codigo, 'export function flatManifest(', 'export function fingerprintOf')) === false);
}

// ─── 22. El EMPALME: collisionVerdict, la función que decidía mal ────
//
// Las tres veces que un preflight falló con todo en verde, la causa fue un
// empalme entre piezas correctas, no una pieza incorrecta. `preflightVerdict`
// estaba cubierto; `verifyNoCollisions` no, y su `return` seguía exigiendo
// `auth.complete`. Esta sección cubre la decisión de colisiones.
{
  console.log('\n22. Empalme de colisiones (collisionVerdict, lógica real)');

  const V = collisionVerdict;

  // ── Los siete casos mínimos ──
  const casos = [
    ['Auth incompleto + sin atestación + 0 colisiones',
      { authComplete: false, ownerAttestationValid: false, authHits: 0, tableHits: 0 }, false],
    ['Auth incompleto + atestación inválida',
      { authComplete: false, ownerAttestationValid: false, authHits: 0, tableHits: 0 }, false],
    ['Auth incompleto + atestación válida + 0 colisiones',
      { authComplete: false, ownerAttestationValid: true, authHits: 0, tableHits: 0 }, true],
    ['Auth incompleto + atestación válida + colisión en Auth',
      { authComplete: false, ownerAttestationValid: true, authHits: 1, tableHits: 0 }, false],
    ['Auth incompleto + atestación válida + colisión en tablas',
      { authComplete: false, ownerAttestationValid: true, authHits: 0, tableHits: 1 }, false],
    ['Auth completo + 0 colisiones + sin atestación',
      { authComplete: true, ownerAttestationValid: false, authHits: 0, tableHits: 0 }, true],
    ['Auth completo + colisión',
      { authComplete: true, ownerAttestationValid: false, authHits: 1, tableHits: 0 }, false],
  ];
  for (const [desc, entrada, esperado] of casos) {
    check(`${desc} → ${esperado}`, V(entrada).ok === esperado);
  }

  // ── Las tres condiciones se reportan por separado ──
  {
    const r = V({ authComplete: false, ownerAttestationValid: true, authHits: 0, tableHits: 2 });
    check('reporta auth_inventory_acceptable', r.auth_inventory_acceptable === true);
    check('reporta no_auth_collisions', r.no_auth_collisions === true);
    check('reporta no_table_collisions', r.no_table_collisions === false);
    check('una colisión en tablas basta para bloquear', r.ok === false);
  }
  {
    const r = V({ authComplete: false, ownerAttestationValid: false, authHits: 0, tableHits: 0 });
    check('sin atestación, el inventario NO es aceptable',
      r.auth_inventory_acceptable === false);
  }

  // ── Regresión exacta del bug: incompleto + atestado + cero colisiones ──
  check('REGRESIÓN: incompleto con atestación válida y 0 colisiones NO bloquea',
    V({ authComplete: false, ownerAttestationValid: true, authHits: 0, tableHits: 0 }).ok === true);

  // ── Solo `true` estricto cuenta como aceptable ──
  for (const v of [1, 'true', 'sí', {}, []]) {
    check(`ownerAttestationValid=${JSON.stringify(v)} NO se acepta como válido`,
      V({ authComplete: false, ownerAttestationValid: v, authHits: 0, tableHits: 0 }).ok === false);
  }

  // ── Estructura: sin bypass y con la atestación DERIVADA internamente ──
  const codigo = read('scripts/_smoke-s7_71a.mjs').split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const vnc = between(codigo, 'async function verifyNoCollisions(', '\n}');

  check('verifyNoCollisions ya NO acepta allowIncomplete',
    /allowIncomplete/.test(vnc) === false);
  check('verifyNoCollisions ya NO retorna auth.complete && …',
    /return auth\.complete && authHits/.test(vnc) === false);
  check('deriva la atestación internamente con evaluateAttestation',
    /const ownerAttestationValid = evaluateAttestation\(\{/.test(vnc));
  check('la atestación NO llega como parámetro del llamador',
    /async function verifyNoCollisions\(\{ verbose, auth: authPrevio \}\)/.test(codigo));
  check('la atestación interna usa las tres variables de entorno',
    /attested: ATT_FLAG, date: ATT_DATE, attestedRunId: ATT_RUN_ID/.test(vnc));
  check('el retorno pasa por collisionVerdict', /return v\.ok;/.test(vnc)
    && /const v = collisionVerdict\(\{/.test(vnc), true);
  check('las tres condiciones son explícitas en la función pura',
    /auth_inventory_acceptable = authComplete === true \|\| ownerAttestationValid === true/.test(codigo)
    && /no_auth_collisions = authHits === 0/.test(codigo)
    && /no_table_collisions = tableHits === 0/.test(codigo), true);
  check('una sonda no consultable cuenta como colisión potencial',
    /tableHits \+= 1;/.test(vnc));
  check('las filas encontradas suman a tableHits', /tableHits \+= n;/.test(vnc));

  // ── Salida coherente: un gate bloqueante se contabiliza como fallo ──
  check('los gates bloqueantes se contabilizan con ko()',
    /verdict\.blockers\.forEach\(\(b\) => ko\(`GATE BLOQUEANTE/.test(codigo));
  check('la salida distingue inventario, atestación, colisiones y veredicto',
    /inventario Auth completo/.test(codigo) && /atestación del owner válida/.test(codigo)
    && /colisiones reales/.test(codigo) && /VEREDICTO FINAL/.test(codigo), true);
  check('el símbolo final refleja el veredicto, no solo el contador',
    /\$\{usable \? '✅' : '❌'\} preflight/.test(codigo));
}

// ═════════════════════════════════════════════════════════════════════
// CORRECCIÓN DEL SMOKE (2026-08-06) — secciones 23 a 27
//
// La corrida del 2026-08-06 falló en la sección 2 con
// «register_booking_intent: Ese horario no está disponible». No era un
// defecto de s7_71a: era del INSTRUMENTO. Las fixtures creaban médicos con
// los tres booleanos en false y `validate_booking_slot` los rechaza (P009C).
// Estas cinco secciones cubren las seis correcciones acordadas.
// ═════════════════════════════════════════════════════════════════════

// ─── 23. Médico QA: resolución única y baseline ───────────────────────
{
  console.log('\n23. Médico QA persistente — resolución y baseline');
  const smoke = read('scripts/_smoke-s7_71a.mjs');
  const codigo = smoke.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  // ── La fuente de identidad NO puede ser un UUID ──
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const SENTINEL = '00000000-0000-0000-0000-000000000000';
  const uuidsEnCodigo = (codigo.match(UUID_RE) || []).filter((u) => u.toLowerCase() !== SENTINEL);
  check(`el smoke NO hardcodea ningún UUID (${uuidsEnCodigo.length})`, uuidsEnCodigo.length === 0);
  if (uuidsEnCodigo.length) console.log(`      · ${[...new Set(uuidsEnCodigo)].join(', ')}`);
  check('el centinela de user_id sigue siendo la única excepción',
    codigo.includes(SENTINEL));
  check('QA_DOCTOR no contiene ningún UUID',
    Object.values(QA_DOCTOR).every((v) => !new RegExp(UUID_RE.source, 'i').test(String(v))));

  // ── Identificadores estables exigidos por el owner ──
  check('resuelve por teléfono', QA_DOCTOR.phone === '50370008803');
  check('resuelve por correo exacto', QA_DOCTOR.email === 'asp0.qa.doctor@lucycare.test');
  check('resuelve por full_name exacto',
    QA_DOCTOR.fullName === 'QA LucyCare — Perfil médico de prueba');
  check('resuelve por metadata.fixture', QA_DOCTOR.metadataFixture === 'S7_71_QA_DOCTOR');
  check('resuelve por nombre exacto de clínica',
    QA_DOCTOR.clinicName === 'QA LucyCare — Clínica de prueba');
  check('resuelve por los dos nombres de servicio',
    QA_SERVICE_NAMES.length === 2
    && QA_SERVICE_NAMES[0] === 'QA — No reservar (consulta)'
    && QA_SERVICE_NAMES[1] === 'QA — No reservar (control)', true);

  // ── La cadena completa, eslabón por eslabón ──
  // Fin de tramo por el NOMBRE de la función siguiente, no por '\n}\n': los
  // archivos del repo están en CRLF y '}' va seguido de '\r\n', así que ese
  // delimitador no casa nunca y `between` devolvería el resto del archivo —
  // una aserción que parece pasar mientras mira código que no es el suyo.
  const rq = between(codigo, 'async function resolveQaDoctor()', 'async function buildManifest(');
  check('resolveQaDoctor() existe', /async function resolveQaDoctor\(\)/.test(codigo));
  // Un tramo VACÍO haría pasar por verdadera cualquier aserción negativa
  // sobre él. Se exige que tenga cuerpo antes de afirmar nada.
  check('el tramo de resolveQaDoctor no está vacío', rq.length > 500);
  check('exige exactamente UNA fila por eslabón',
    /devolvió \$\{list\.length\} filas, /.test(smoke) && /list\.length !== 1/.test(rq), true);
  check('eslabón profile por teléfono', /\.eq\('phone', QA_DOCTOR\.phone\)/.test(rq));
  check('eslabón auth.user por getUserById del id resuelto',
    /admin\.auth\.admin\.getUserById\(profile\.id\)/.test(rq));
  check('eslabón doctor por profile_id', /\.eq\('profile_id', profile\.id\)/.test(rq));
  check('eslabón clinic por el clinic_id del médico', /\.eq\('id', doctor\.clinic_id\)/.test(rq));
  check('eslabón services por los dos nombres exactos',
    /\.in\('name', QA_SERVICE_NAMES\)/.test(rq));
  check('la resolución es READ-ONLY (sin insert/update/delete/rpc)',
    /\.insert\(|\.update\(\s*\{|\.delete\(|\.rpc\(/.test(rq) === false);

  // ── getUserById verifica email, teléfono y metadata ──
  const bl = qaBaselineChecks({});
  const etiquetas = bl.map(([d]) => d);
  check('el baseline verifica el email de auth', etiquetas.includes('auth: email exacto'));
  check('el baseline verifica el teléfono de auth', etiquetas.includes('auth: teléfono exacto'));
  check('el baseline verifica user_metadata.fixture',
    etiquetas.includes('auth: user_metadata.fixture exacta'));

  // ── Baseline: publicado + operativo, PERO booking desactivado ──
  const qaOk = {
    role: 'doctor', fullName: QA_DOCTOR.fullName,
    authEmail: QA_DOCTOR.email, authPhone: QA_DOCTOR.phone,
    authFixture: QA_DOCTOR.metadataFixture, clinicName: QA_DOCTOR.clinicName,
    lucyStatus: 'claimed', isPublished: true, isOperational: true, bookingEnabled: false,
    services: [
      { name: QA_SERVICE_NAMES[0], isFirstVisit: true, isActive: true },
      { name: QA_SERVICE_NAMES[1], isFirstVisit: false, isActive: true },
    ],
    availabilityRules: 0, appointments: 0, bookingIntents: 0, availabilityOverrides: 0,
  };
  const todos = (qa) => qaBaselineChecks(qa).every(([, c]) => c === true);
  check('baseline correcto → pasa entero', todos(qaOk));

  for (const [desc, mut] of [
    ['role distinto de doctor', { role: 'patient' }],
    ['full_name alterado', { fullName: 'Otro nombre' }],
    ['email de auth distinto', { authEmail: 'otro@lucycare.test' }],
    ['teléfono de auth distinto', { authPhone: '50370008899' }],
    ['metadata.fixture distinta', { authFixture: 'OTRA' }],
    ['clínica con otro nombre', { clinicName: 'Otra clínica' }],
    ['lucy_status distinto', { lucyStatus: 'verified' }],
    ['is_published = false', { isPublished: false }],
    ['is_operational = false', { isOperational: false }],
    ['booking_enabled = true', { bookingEnabled: true }],
    ['availability_rules > 0', { availabilityRules: 1 }],
    ['appointments > 0', { appointments: 1 }],
    ['booking_intents > 0', { bookingIntents: 1 }],
    ['availability_overrides > 0', { availabilityOverrides: 1 }],
  ]) check(`baseline rechaza: ${desc}`, todos({ ...qaOk, ...mut }) === false);

  // Un conteo NULO (no verificable) tampoco puede pasar por cero.
  for (const campo of ['availabilityRules', 'appointments', 'bookingIntents', 'availabilityOverrides']) {
    check(`baseline rechaza ${campo} desconocido (null)`,
      todos({ ...qaOk, [campo]: null }) === false);
  }

  // ── Exactamente dos servicios, con las dos ramas de first_visit ──
  check('baseline rechaza un solo servicio',
    todos({ ...qaOk, services: [qaOk.services[0]] }) === false);
  check('baseline rechaza tres servicios',
    todos({ ...qaOk, services: [...qaOk.services, { name: 'X', isFirstVisit: false, isActive: true }] }) === false);
  check('baseline rechaza consulta con is_first_visit = false',
    todos({ ...qaOk, services: [{ ...qaOk.services[0], isFirstVisit: false }, qaOk.services[1]] }) === false);
  check('baseline rechaza control con is_first_visit = true',
    todos({ ...qaOk, services: [qaOk.services[0], { ...qaOk.services[1], isFirtVisit: true, isFirstVisit: true }] }) === false);
  check('baseline rechaza un servicio inactivo',
    todos({ ...qaOk, services: [{ ...qaOk.services[0], isActive: false }, qaOk.services[1]] }) === false);
  check('qaBaselineChecks nunca lanza con entrada vacía',
    Array.isArray(qaBaselineChecks(undefined)) && qaBaselineChecks(undefined).every(([, c]) => c === false), true);

  // ── El baseline es BLOQUEANTE del preflight ──
  check('un baseline QA incumplido bloquea la huella',
    preflightVerdict({ authProceed: true, noCollisions: true, catalogsOk: true, qaBaselineOk: false })
      .emitFingerprint === false);
  check('el bloqueo se nombra explícitamente',
    preflightVerdict({ authProceed: true, noCollisions: true, catalogsOk: true, qaBaselineOk: false })
      .blockers.some((b) => /baseline del médico QA/.test(b)));
  check('sin el parámetro, el veredicto no cambia (retrocompatible)',
    preflightVerdict({ authProceed: true, noCollisions: true, catalogsOk: true }).emitFingerprint === true);
  check('el preflight pasa qaBaselineOk al veredicto',
    /preflightVerdict\(\{[\s\S]{0,160}qaBaselineOk,/.test(codigo));

  // ── El teléfono QA es identidad PERSISTENTE, no colisión ni fixture ──
  check('el teléfono QA está en su propia categoría',
    QA_PERSISTENT_PHONES.length === 1 && QA_PERSISTENT_PHONES[0] === QA_DOCTOR.phone, true);
  check('el teléfono QA está protegido contra uso como fixture',
    FORBIDDEN_NORMALIZED.has(normalizePhone(QA_DOCTOR.phone)));
  check('el teléfono QA NO es una de las 3 identidades sintéticas',
    SYNTHETIC_PHONES.every((p) => normalizePhone(p) !== normalizePhone(QA_DOCTOR.phone)));
  check('el preflight declara que encontrar al QA no es colisión',
    /la identidad QA es PERSISTENTE y ESPERADA: encontrarla NO es una/.test(smoke));
}

// ─── 24. Horario local de El Salvador — un solo literal ───────────────
{
  console.log('\n24. Horario local (sin conversión UTC insegura)');
  const smoke = read('scripts/_smoke-s7_71a.mjs');
  const codigo = smoke.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  // ── El patrón exacto que causaba el desfase ya no existe ──
  check('NO queda toISOString().replace(\'Z\',\'\')',
    /toISOString\(\)\.replace\('Z'/.test(codigo) === false);
  check('p_start_local NO se deriva de un instante UTC',
    /p_start_local: startLocal/.test(codigo) === false);
  check('p_start_local sale del literal local construido',
    /p_start_local: slot\.startLocal/.test(codigo));
  check('la zona horaria es la de El Salvador', SV_TIMEZONE === 'America/El_Salvador');

  // ── Aritmética de calendario, pura ──
  check('addDaysLocal suma días', addDaysLocal('2026-08-06', 3) === '2026-08-09');
  check('addDaysLocal cruza fin de mes', addDaysLocal('2026-08-30', 3) === '2026-09-02');
  check('addDaysLocal cruza fin de año', addDaysLocal('2026-12-30', 3) === '2027-01-02');
  check('addDaysLocal respeta el año bisiesto', addDaysLocal('2028-02-27', 3) === '2028-03-01');
  check('dowLocal: 0 = domingo (igual que EXTRACT(DOW))', dowLocal('2026-08-09') === 0);
  check('dowLocal: lunes = 1', dowLocal('2026-08-10') === 1);
  check('dowLocal: sábado = 6', dowLocal('2026-08-08') === 6);
  check('svTodayLocal devuelve YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(svTodayLocal()));

  // ── El slot completo sale de UN literal ──
  const s = buildLocalSlot({ today: '2026-08-06', daysAhead: 3, hour: 10, slotMinutes: 30 });
  check('la fecha del slot es hoy + daysAhead', s.date === '2026-08-09');
  check('el literal local no lleva zona ni Z', s.startLocal === '2026-08-09T10:00:00');
  check('el literal tiene la forma YYYY-MM-DDTHH:mm:ss',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s.startLocal));
  check('day_of_week se deriva del MISMO literal', s.dayOfWeek === dowLocal(s.date));
  check('start_time se deriva del MISMO literal', s.startLocal.endsWith(s.startTime));
  check('slot_duration_min es 30 explícito', s.slotMinutes === 30);
  check('el fin de la CITA es start + 30', s.appointmentEndTime === '10:30:00');
  check('la ventana de la regla cubre el fin de la cita',
    s.endTime > s.appointmentEndTime);
  check('la regla arranca en la hora de la cita → fase 0 (alineado)',
    s.startTime === '10:00:00');

  // ── Guardas: nada de pasado, madrugada ni cruce de medianoche ──
  for (const [desc, args] of [
    ['daysAhead = 0 (hoy)', { today: '2026-08-06', daysAhead: 0 }],
    ['daysAhead negativo', { today: '2026-08-06', daysAhead: -1 }],
    ['fecha inválida', { today: 'ayer', daysAhead: 3 }],
    ['hora de madrugada', { today: '2026-08-06', daysAhead: 3, hour: 3 }],
    ['ventana que cruzaría medianoche', { today: '2026-08-06', daysAhead: 3, hour: 23 }],
  ]) {
    let lanzo = false;
    try { buildLocalSlot(args); } catch { lanzo = true; }
    check(`buildLocalSlot rechaza ${desc}`, lanzo);
  }

  // Ninguna hora válida puede producir una ventana que cruce el día.
  for (let h = 8; h + 2 <= 20; h++) {
    const x = buildLocalSlot({ today: '2026-08-06', daysAhead: 3, hour: h });
    if (x.endTime <= x.startTime) check(`hora ${h}: la ventana no cruza medianoche`, false);
  }
  check('toda hora aceptada produce una ventana dentro del mismo día', true);

  // ── La regla temporal se crea con lo que dice el slot ──
  const bvi = between(codigo, 'async function bookViaIntent(fx)', 'async function verifyQaRestored');
  check('el tramo de bookViaIntent no está vacío', bvi.length > 500);
  check('la regla usa day_of_week del slot', /day_of_week: slot\.dayOfWeek/.test(bvi));
  check('la regla usa start_time y end_time del slot',
    /start_time: slot\.startTime, end_time: slot\.endTime/.test(bvi));
  check('slot_duration_min se fija EXPLÍCITAMENTE',
    /slot_duration_min: slot\.slotMinutes/.test(bvi));
  check('se crea UNA sola regla temporal',
    (bvi.match(/from\('availability_rules'\)\.insert\(/g) || []).length, 1);
}

// ─── 25. Denylist de objetos permanentes ──────────────────────────────
{
  console.log('\n25. Denylist de objetos permanentes del médico QA');
  const smoke = read('scripts/_smoke-s7_71a.mjs');
  const codigo = smoke.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  const qa = {
    profileId: 'p-1', doctorId: 'd-1', clinicId: 'c-1',
    serviceFirstVisitId: 's-1', serviceFollowUpId: 's-2',
  };
  const deny = buildPermanentIds(qa);

  check('la denylist tiene los 5 objetos permanentes', deny.size === 5);
  for (const [k, v] of Object.entries(qaManifestIds(qa))) {
    check(`la denylist protege ${k}`, deny.has(v));
  }
  check('permanentHits detecta un id permanente',
    permanentHits(['x', 'd-1'], deny).length === 1);
  check('permanentHits ignora los ids de la corrida',
    permanentHits(['x', 'y'], deny).length === 0);
  check('permanentHits tolera null y undefined',
    permanentHits([null, undefined, 'x'], deny).length === 0);

  for (const [desc, lista] of [
    ['el profile/auth.user', ['p-1']],
    ['el médico', ['d-1']],
    ['la clínica', ['c-1']],
    ['un servicio', ['s-2']],
    ['una lista mixta', ['ok-1', 'c-1']],
  ]) {
    let lanzo = false;
    try { assertNotPermanent(lista, 'test', deny); } catch { lanzo = true; }
    check(`assertNotPermanent LANZA si la lista incluye ${desc}`, lanzo);
  }
  check('assertNotPermanent deja pasar una lista limpia',
    assertNotPermanent(['a', 'b'], 'test', deny).length === 2);
  check('la aserción LANZA, no filtra en silencio',
    /throw new Error\(\s*`ABORTADO: \$\{where\} intentó operar sobre/.test(smoke));

  // ── Todas las superficies de borrado están guardadas ──
  const cl = between(codigo, 'async function cleanup()', 'async function cleanupAuditLog');
  check('el tramo de cleanup no está vacío', cl.length > 500);
  for (const sup of ['cleanup/users', 'cleanup/patients', 'cleanup/doctors',
                     'cleanup/services', 'cleanup/availability_rules', 'cleanup/clinics',
                     'cleanup/appointments', 'cleanup/booking_intents']) {
    check(`guarda declarada para ${sup}`, cl.includes(`'${sup}'`));
  }
  check('deleteUser tiene su propia guarda, uno por uno',
    /assertNotPermanent\(\[uid\], 'cleanup\/deleteUser'\)/.test(codigo));
  check('la guarda de deleteUser va ANTES de la llamada',
    codigo.indexOf("assertNotPermanent([uid], 'cleanup/deleteUser')")
      < codigo.indexOf('admin.auth.admin.deleteUser(uid)'), true);
  check('la denylist se construye desde la resolución, no de una constante',
    /PERMANENT_IDS = buildPermanentIds\(qa\)/.test(codigo));
  check('se documenta el CASCADE de profiles_id_fkey',
    /profiles_id_fkey` es ON DELETE CASCADE/.test(smoke));

  // ── Lo ÚNICO mutable del médico QA ──
  check('solo se modifica booking_enabled',
    /\.update\(\{ booking_enabled: value \}\)\.eq\('id', QA\.doctorId\)/.test(codigo));
  check('el UPDATE al médico QA afecta exactamente 1 fila o falla',
    /afectó \$\{data\?\.length\} filas, se esperaba 1/.test(smoke));
  check('la regla temporal se borra por ruleId, NUNCA por doctor_id',
    /\.from\('availability_rules'\)\s*\n?\s*\.delete\(\{ count: 'exact' \}\)\.eq\('id', ruleId\)/
      .test(codigo.replace(/\r/g, '')));
  check('el borrado de la regla temporal exige count exacto 1',
    /borró \$\{count\} fila\(s\), se esperaba 1/.test(smoke));
  check('no existe ningún delete de reglas por doctor_id del QA',
    /from\('availability_rules'\)[\s\S]{0,80}delete[\s\S]{0,60}QA\.doctorId/.test(codigo) === false);

  // ── El restore corre primero y pase lo que pase ──
  check('bookViaIntent restaura en su propio finally',
    /\} finally \{[\s\S]{0,400}await restoreQaState\(\);[\s\S]{0,80}await deleteQaTempRules\(\);/.test(codigo));
  check('el cleanup restaura ANTES de cualquier borrado',
    cl.indexOf('await restoreQaState()') >= 0
    && cl.indexOf('await restoreQaState()') < cl.indexOf('await del('), true);
  check('el cleanup corre desde el finally global',
    /\} finally \{[\s\S]{0,400}await cleanup\(\)/.test(codigo));
  check('restoreQaState es idempotente (sin snapshot no hace nada)',
    /if \(!qaSnapshot\.taken \|\| !QA\) \{/.test(codigo));
  check('el restore fallido se registra como error de cleanup',
    /cleanupErrors\.push\(`restore de booking_enabled/.test(codigo));
  check('se verifica que quedó restaurado y con 0 reglas',
    /async function verifyQaRestored\(\)/.test(codigo)
    && /13\.3 booking_enabled del médico QA restaurado y 0 reglas temporales/.test(codigo), true);
  check('--run aborta si booking_enabled ya venía en true',
    /booking_enabled del médico QA ya es true/.test(smoke));
  check('la sección 2 revalida el estado base antes de tocar nada',
    /no es false al entrar a la sección 2/.test(smoke));
}

// ─── 26. Fail-closed: conteos, intents y actividad externa ────────────
{
  console.log('\n26. Inventario fail-closed, booking_intents y actividad externa');
  const smoke = read('scripts/_smoke-s7_71a.mjs');
  const codigo = smoke.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  // ── countResult: un error JAMÁS es un cero ──
  check('conteo válido → OK', countResult({ count: 3, error: null }).status === 'OK');
  check('conteo cero → OK con 0',
    countResult({ count: 0, error: null }).status === 'OK'
    && countResult({ count: 0, error: null }).count === 0, true);
  check('error → ERROR, nunca 0', countResult({ count: null, error: { message: 'x' } }).status === 'ERROR');
  check('error → count queda en null, no en 0',
    countResult({ count: null, error: { message: 'x' } }).count === null);
  check('count no numérico → ERROR', countResult({ count: undefined, error: null }).status === 'ERROR');
  check('count NaN → ERROR', countResult({ count: NaN, error: null }).status === 'ERROR');
  check('NUNCA se devuelve -1', countResult({ count: null, error: { message: 'x' } }).count !== -1);
  check('el smoke ya no usa -1 como conteo', /return -1;/.test(codigo) === false);
  check('el acumulador ya no ignora los negativos',
    /if \(n > 0\) residuals \+= n/.test(codigo) === false);

  // ── summarizeInventory: un desconocido impide declarar cero ──
  const fila = (label, status, count = null) => ({ label, result: { status, count } });
  {
    const r = summarizeInventory([fila('a', 'OK', 0), fila('b', 'OK', 0)]);
    check('todo en cero y conocido → se puede declarar cero',
      r.canDeclareZero === true && r.residuals === 0 && r.exitClean === true, true);
  }
  {
    const r = summarizeInventory([fila('a', 'OK', 0), fila('b', 'ERROR')]);
    check('un conteo desconocido → NO se puede declarar cero', r.canDeclareZero === false);
    check('un conteo desconocido → exit sucio', r.exitClean === false);
    check('el desconocido se nombra', r.unknown.includes('b'));
    check('un desconocido NO suma como residuo', r.residuals === 0);
  }
  {
    const r = summarizeInventory([fila('a', 'OK', 2)]);
    check('residuos reales → NO se puede declarar cero', r.canDeclareZero === false);
    check('residuos reales se cuentan', r.residuals === 2);
  }
  {
    const r = summarizeInventory([fila('a', 'ERROR'), fila('b', 'ERROR')]);
    check('varios desconocidos se listan todos', r.unknown.length === 2);
  }
  check('summarizeInventory tolera entrada vacía',
    summarizeInventory([]).canDeclareZero === true && summarizeInventory(undefined).residuals === 0, true);

  check('el inventario NO imprime cero residuos con conteos desconocidos',
    /NO se puede declarar cero residuos: \$\{resumen\.unknown\.length\}/.test(smoke));
  check('los desconocidos entran en cleanupErrors → exit ≠ 0',
    /resumen\.unknown\.forEach\(\(u\) => cleanupErrors\.push\(`conteo DESCONOCIDO/.test(codigo));
  check('el finally sigue intentando el resto del inventario',
    /for \(const \[label, col, list\] of filas\)/.test(codigo));
  check('el proceso falla si hay errores de cleanup',
    /const clean = fail === 0 && cleanupErrors\.length === 0 && !runError/.test(codigo));

  // ── booking_intents: sin created_by, con allowlist de id ──
  check('NO queda ninguna referencia a created_by',
    /created_by/.test(codigo) === false);
  check('el intent_id exacto se captura', /ids\.intentIds\.push\(intentId\)/.test(codigo));
  check('el borrado de intents va por id allowlisted',
    /await del\('booking_intents \(por id allowlisted\)', 'booking_intents', ids\.intentIds\)/.test(codigo));
  check('el inventario cuenta intents por id, no por created_by',
    /\['booking_intents', 'id', ids\.intentIds\]/.test(codigo));
  check('la corrida verifica que se capturó el intentId',
    /2\.8 se capturó el intent_id exacto/.test(smoke));

  // ── Actividad externa: se reporta, hace fallar y NO se borra ──
  {
    const p = partitionExternal([{ id: 'a' }, { id: 'z' }], ['a']);
    check('partitionExternal separa lo propio', p.mine.length === 1 && p.mine[0] === 'a', true);
    check('partitionExternal detecta lo externo', p.external.length === 1 && p.external[0] === 'z', true);
  }
  check('partitionExternal acepta ids sueltos',
    partitionExternal(['a', 'z'], ['a']).external[0] === 'z');
  check('sin allowlist, TODO es externo',
    partitionExternal([{ id: 'a' }], []).external.length === 1);
  check('allowlist vacía no vuelve propio a nadie',
    partitionExternal([{ id: 'a' }], [null, undefined]).mine.length === 0);

  const dx = between(codigo, 'async function detectExternalQaActivity()', 'async function main()');
  check('detectExternalQaActivity() existe y su tramo no está vacío', dx.length > 300);
  check('la detección NO borra nada', /\.delete\(/.test(dx) === false);
  check('lo externo se reporta explícitamente', /NO se borran/.test(smoke));
  check('doctor_id y RUN_STARTED_AT son solo defensas de ventana',
    /\.eq\('doctor_id', QA\.doctorId\)\.gte\('created_at', RUN_STARTED_AT\)/.test(dx));
  check('la allowlist de UUID es lo único que autoriza el borrado',
    /nunca criterio suficiente para borrar/.test(smoke)
    && /DEFENSAS ADICIONALES/.test(smoke), true);
  check('una sonda no verificable cuenta como fallo, no como cero',
    /total \+= 1;\s+\/\/ no verificable/.test(smoke));
  check('la actividad externa hace fallar la corrida',
    /13\.4 sin actividad externa sobre el médico QA/.test(smoke));
  check('se advierte que podría ser una reserva real',
    /podría ser una reserva real/.test(smoke));
}

// ─── 27. El médico QA dentro del manifiesto y la huella ───────────────
{
  console.log('\n27. UUID resueltos dentro del manifiesto y del fingerprint');
  const smoke = read('scripts/_smoke-s7_71a.mjs');
  const codigo = smoke.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  const base = {
    projectHost: 'p.supabase.co', migrationSha: 'a'.repeat(64), smokeSha: 'b'.repeat(64),
    runId: 's771a0805a', identities: identitiesFor('s771a0805a'), specialtyId: 's',
    programadaId: 'p', confirmadaId: 'c', canceladaId: 'x', cancelReasonId: 'r',
    qaProfileId: 'qp', qaDoctorId: 'qd', qaClinicId: 'qc',
    qaServiceFirstVisitId: 'qs1', qaServiceFollowUpId: 'qs2',
  };
  const m = flatManifest(base);
  const fp0 = fingerprintOf(m);

  for (const k of ['qa_profile_id', 'qa_doctor_id', 'qa_clinic_id',
                   'qa_service_first_visit_id', 'qa_service_follow_up_id']) {
    check(`el manifiesto incluye ${k}`, Object.prototype.hasOwnProperty.call(m, k));
  }
  check('el manifiesto sigue siendo completamente plano',
    Object.values(m).every((v) => v === null || typeof v !== 'object'));

  for (const [campo, valor] of [
    ['qaProfileId', 'otro'], ['qaDoctorId', 'otro'], ['qaClinicId', 'otro'],
    ['qaServiceFirstVisitId', 'otro'], ['qaServiceFollowUpId', 'otro'],
  ]) {
    check(`cambiar ${campo} → huella DISTINTA`,
      fingerprintOf(flatManifest({ ...base, [campo]: valor })) !== fp0);
  }
  check('sin los ids del QA la huella también cambia',
    fingerprintOf(flatManifest({
      ...base, qaProfileId: null, qaDoctorId: null, qaClinicId: null,
      qaServiceFirstVisitId: null, qaServiceFollowUpId: null,
    })) !== fp0);

  check('buildManifest resuelve al médico QA, no lo recibe',
    /const qa = await resolveQaDoctor\(\);/.test(codigo));
  check('los ids resueltos entran al manifiesto', /\.\.\.qaManifestIds\(qa\)/.test(codigo));
  check('--run re-resuelve y compara con el manifiesto aprobado',
    /los UUID del médico QA coinciden con el manifiesto aprobado/.test(smoke));
  check('--run aborta si el QA resuelve a otros UUID',
    /el médico QA resuelve a UUID distintos de los aprobados/.test(smoke));
  check('--run revalida el baseline antes de escribir',
    /el baseline del médico QA no se cumple/.test(smoke));

  // ── El camino read-only sigue siendo read-only con la resolución dentro ──
  const roPath = [
    between(codigo, 'async function preflight()', 'async function verifyFingerprintBeforeWriting'),
    between(codigo, 'async function listAllAuthUsers()', 'export function authFailureReport'),
    // ⚠️ La firma es `buildManifest(authState = {})`: buscar
    // 'async function buildManifest()' devolvía cadena VACÍA y esta parte del
    // camino read-only quedaba sin verificar.
    between(codigo, 'async function buildManifest(', 'export function flatManifest'),
    between(codigo, 'async function resolveQaDoctor()', 'async function buildManifest('),
    between(codigo, 'async function verifyNoCollisions(', 'async function preflight()'),
  ];
  check('los cinco tramos read-only son no vacíos', roPath.every((t) => t.length > 100));
  const ro = roPath.join('\n');
  check('el camino read-only NO inserta', /\.insert\(/.test(ro) === false);
  check('el camino read-only NO actualiza', /\.update\(\s*\{/.test(ro) === false);
  check('el camino read-only NO borra', /\.delete\(/.test(ro) === false);
  check('el camino read-only NO llama RPC', /\.rpc\(/.test(ro) === false);
  check('el camino read-only NO crea ni borra usuarios',
    /createUser|deleteUser|generateLink/.test(ro) === false);
  check('el camino read-only SÍ resuelve al médico QA',
    /getUserById\(profile\.id\)/.test(ro));
}

// ─── 28. Orden de borrado del cleanup (corrida del 2026-08-06) ────────
//
// La corrida dejó SEIS residuos en producción. Las diez secciones de
// auditoría pasaron; el fallo fue del cleanup, por dos defectos:
//
//   1. ORDEN INVERSO a la cadena de FKs. Funcionaba por accidente: al borrar
//      los médicos sintéticos, sus citas se iban por CASCADA y el DELETE
//      explícito de `appointments` nunca tenía que funcionar. El médico QA no
//      se borra jamás, así que su cita sobrevivió y bloqueó en dominó a
//      intents, servicios, pacientes, perfiles y usuarios de Auth.
//   2. `auth_creation_grants.issued_by` es TEXTO (`'register_booking_intent'`),
//      no un uuid: el borrado por `issued_by` afectaba 0 filas y el inventario
//      contaba con el mismo criterio, así que el grant era INVISIBLE.
{
  console.log('\n28. Orden de borrado y captura de grants');
  const smoke = read('scripts/_smoke-s7_71a.mjs');
  const codigo = smoke.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const cl = between(codigo, 'async function cleanup()', 'async function cleanupAuditLog');
  const fi = between(codigo, 'async function finalInventory(', 'async function detectExternalQaActivity');
  check('el tramo de cleanup no está vacío', cl.length > 500);
  check('el tramo del inventario no está vacío', fi.length > 500);

  // ── issued_by ELIMINADO como criterio ──
  check('el cleanup NO borra grants por issued_by',
    /auth_creation_grants'\)\.delete\(\)[\s\S]{0,80}issued_by/.test(codigo) === false);
  check('el inventario NO cuenta grants por issued_by',
    /\['auth_creation_grants', 'issued_by'/.test(codigo) === false);
  check('no queda ningún uso de issued_by como criterio',
    /issued_by', ids\.users/.test(codigo) === false);
  check('se documenta por qué issued_by no sirve (es texto)',
    /issued_by` es TEXTO/.test(smoke));

  // ── booking_intent_id como criterio de captura ──
  check('los grants se capturan por booking_intent_id',
    /from\('auth_creation_grants'\)\.select\('id'\)\.eq\('booking_intent_id', intentId\)/.test(codigo));
  check('los grantId capturados se guardan en su allowlist',
    /ids\.grantIds\.push\(\.\.\.\(grants \?\? \[\]\)\.map\(\(g\) => g\.id\)\)/.test(codigo));
  check('existe la lista grantIds', /grantIds: \[\]/.test(codigo));
  check('el borrado de grants va por id allowlisted',
    /await del\('auth_creation_grants \(por id allowlisted\)', 'auth_creation_grants', ids\.grantIds\)/.test(codigo));
  check('la corrida verifica que se capturaron los grants',
    /2\.11 grants capturados por booking_intent_id/.test(smoke));
  check('una captura fallida impide declarar limpieza',
    /grantsCaptureFailed/.test(codigo)
    && /auth_creation_grants \(captura fallida\)/.test(codigo), true);
  check('la captura fallida entra como ERROR en el inventario',
    /label: 'auth_creation_grants \(captura fallida\)',\s*\n?\s*result: \{ status: 'ERROR'/.test(codigo.replace(/\r/g, '')));

  // ── ORDEN: cada dependencia antes que aquello de lo que depende ──
  // El orden lo determina la SECUENCIA de llamadas `await del(label, tabla, …)`.
  // `[^;]*?` y no `[^)]*`: varias etiquetas llevan paréntesis —«(por id
  // allowlisted)»— y `[^)]*` cortaba en ellos, dando -1 en silencio.
  const pos = (tabla) => {
    const m = cl.match(new RegExp(`await del\\([^;]*?,\\s*'${tabla}'`));
    return m ? cl.indexOf(m[0]) : -1;
  };
  const pGrant = pos('auth_creation_grants');
  const pIntent = pos('booking_intents');
  const pAppt = pos('appointments');
  const pPatient = pos('patients');
  const pService = pos('services');
  const pRule = pos('availability_rules');
  const pDoctor = pos('doctors');
  const pProfile = pos('profiles');
  const pUser = cl.indexOf('deleteUser');
  const pCanc = pos('appointment_patient_cancellations');

  for (const [label, p] of [['grants', pGrant], ['intents', pIntent], ['citas', pAppt],
                            ['pacientes', pPatient], ['servicios', pService], ['reglas', pRule],
                            ['médicos', pDoctor], ['perfiles', pProfile], ['cancelaciones', pCanc]]) {
    check(`el cleanup borra ${label}`, p >= 0);
  }
  check('dependencias de la cita ANTES que la cita', pCanc < pAppt && pCanc >= 0, true);
  check('grant ANTES que intent (FK booking_intent_id)', pGrant < pIntent && pGrant >= 0, true);
  check('intent ANTES que appointment (FK consumed_appointment_id)', pIntent < pAppt && pIntent >= 0, true);
  check('appointment ANTES que patient (FK patient_id)', pAppt < pPatient && pAppt >= 0, true);
  check('appointment ANTES que service (FK service_id)', pAppt < pService && pAppt >= 0, true);
  check('patient ANTES que profile (FK profile_id)', pPatient < pProfile && pPatient >= 0, true);
  check('profile ANTES que auth.user', pProfile < pUser && pProfile >= 0, true);
  check('appointment ANTES que doctor (no se depende de la cascada)', pAppt < pDoctor && pAppt >= 0, true);

  // ── No depender de cascadas ──
  check('se declara la prohibición de depender de cascadas',
    /no depender de ninguna cascada/i.test(smoke));
  check('se documenta que el orden anterior funcionaba por accidente',
    /funcionaba por accidente/.test(smoke));
  check('las citas se borran por allowlist de ids, nunca por doctor_id',
    /await del\('citas', 'appointments', ids\.apptIds\)/.test(codigo));
  check('servicios y reglas se borran por allowlist de ids',
    /await del\('servicios', 'services', ids\.serviceIds\)/.test(codigo)
    && /await del\('reglas de disponibilidad', 'availability_rules', ids\.ruleIds\)/.test(codigo), true);
  check('las membresías se borran por allowlist de ids, no por clinic_id',
    /await del\('membresías', 'clinic_members', ids\.memberIds\)/.test(codigo));
  check('los memberId se capturan al crear la membresía',
    /ids\.memberIds\.push\(data\.id\)/.test(codigo));

  // ── DELETE parcial: count exacto, sin seleccionar columnas ──
  check('cada DELETE usa count exacto', /\.delete\(\{ count: 'exact' \}\)/.test(codigo));
  check('el helper cuenta ANTES de borrar para detectar borrados parciales',
    /const pre = countResult\(await admin\.from\(table\)/.test(codigo));
  check('el veredicto del borrado pasa por deleteVerdict',
    /const v = deleteVerdict\(\{/.test(codigo));
  check('un error o borrado parcial entra en cleanupErrors',
    /cleanupErrors\.push\(`\$\{label\} \[\$\{v\.status\}\]: \$\{v\.detail\}`\)/.test(codigo));
  check('el finally sigue con el resto del cleanup pese al error',
    /catch \(e\) \{\s*cleanupErrors\.push\(`\$\{label\}: \$\{e\.message\}`\)/.test(codigo.replace(/\r/g, '')));

  // ── Inventario final por IDs exactos ──
  for (const [desc, re] of [
    ['appointmentIds', /\['appointments', 'id', ids\.apptIds\]/],
    ['patientIds', /\['patients', 'id', patientIds\]/],
    ['grantIds', /\['auth_creation_grants', 'id', ids\.grantIds\]/],
    ['intentIds', /\['booking_intents', 'id', ids\.intentIds\]/],
    ['profileIds', /\['profiles', 'id', ids\.users\]/],
    ['memberIds', /\['clinic_members', 'id', ids\.memberIds\]/],
    ['ruleIds', /\['availability_rules', 'id', ids\.ruleIds\]/],
    ['serviceIds', /\['services', 'id', ids\.serviceIds\]/],
  ]) check(`el inventario cuenta ${desc} por id exacto`, re.test(fi));
  check('el inventario cubre authUserIds por getUserById',
    /admin\.auth\.admin\.getUserById\(uid\)/.test(fi));
  check('sonda de RELACIÓN: grants por booking_intent_id',
    /\['auth_creation_grants \(por booking_intent_id\)', 'booking_intent_id', ids\.intentIds\]/.test(fi));

  // ── Un grant residual impide declarar limpieza (lógica REAL) ──
  {
    const fila = (label, status, count = null) => ({ label, result: { status, count } });
    const conGrant = summarizeInventory([
      fila('appointments', 'OK', 0), fila('auth_creation_grants', 'OK', 1),
    ]);
    check('un grant residual impide declarar cero', conGrant.canDeclareZero === false);
    check('un grant residual fuerza exit sucio', conGrant.exitClean === false);
    check('un grant residual se cuenta como residuo', conGrant.residuals === 1);

    const grantDesconocido = summarizeInventory([
      fila('appointments', 'OK', 0), fila('auth_creation_grants (captura fallida)', 'ERROR'),
    ]);
    check('una captura de grants desconocida impide declarar cero',
      grantDesconocido.canDeclareZero === false);
    check('la captura desconocida se nombra',
      grantDesconocido.unknown.includes('auth_creation_grants (captura fallida)'));
  }

  // ── Nada externo se borra: todo criterio es una allowlist de ids ──
  const llamadas = cl.match(/await del\([^;]*\)/g) || [];
  check(`el cleanup borra solo mediante el helper de allowlist (${llamadas.length})`,
    llamadas.length >= 10);
  check('ninguna llamada de borrado pasa doctor_id, clinic_id ni profile_id',
    llamadas.some((d) => /doctorId\b(?!s)|clinicId'|profile_id/.test(d)) === false);
  // El único DELETE inline admitido es el de las dependencias de consulta, que
  // se filtran por `consultation_id` (columna que sí existe en las cuatro).
  const inline = (cl.replace(/\r/g, '').match(/admin\.from\([^)]*\)\s*\n?\s*\.delete\(\{ count: 'exact' \}\)[^;]*/g) || []);
  // Dos formas admitidas: la del helper —que filtra por la columna declarada
  // en CLEANUP_TARGETS— y la de las dependencias de consulta.
  check(`todo DELETE del cleanup filtra por columna declarada o consultation_id (${inline.length})`,
    inline.length === 2
    && inline.every((d) => /\.in\(column, list\)/.test(d) || /\.in\('consultation_id', ids\.consultIds\)/.test(d)), true);
  check('ningún DELETE inline usa .select(\'id\')', /\.delete\(\)[\s\S]{0,40}\.select\('id'\)/.test(cl) === false);
  check('la denylist cubre también grants y membresías',
    cl.includes("'cleanup/auth_creation_grants'") && cl.includes("'cleanup/clinic_members'"), true);
}

// ─── 29. El helper de DELETE no puede asumir la columna `id` ──────────
//
// La corrida del 2026-08-07 dejó 23 residuos por esto: el helper hacía
// `.select('id')` sobre el builder para saber cuántas filas borraba, y
// `appointment_patient_cancellations` NO tiene columna `id` (su clave es
// `appointment_id`). PostgREST rechazó la consulta, el borrado no se ejecutó y
// la fila superviviente bloqueó por FK todo lo que venía detrás.
{
  console.log('\n29. Helper de DELETE: sin suposición universal de columna id');
  const smoke = read('scripts/_smoke-s7_71a.mjs');
  const codigo = smoke.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  // ── El patrón exacto que causó el fallo ya no existe ──
  check("el helper YA NO hace .select('id') sobre el builder de DELETE",
    /promise\.select\('id'\)/.test(codigo) === false);
  check('ningún DELETE selecciona columnas para contar',
    /\.delete\(\)\.select\(/.test(codigo) === false);
  check("todos los DELETE usan .delete({ count: 'exact' })",
    /\.delete\(\{ count: 'exact' \}\)/.test(codigo)
    && (codigo.match(/\.delete\(\)/g) || []).length === 0, true);

  // ── CLEANUP_TARGETS: la columna real de cada tabla ──
  check('CLEANUP_TARGETS está exportada', Array.isArray(CLEANUP_TARGETS));
  check('declara appointment_patient_cancellations',
    CLEANUP_TARGETS.some((t) => t.table === 'appointment_patient_cancellations'));
  check('appointment_patient_cancellations usa appointment_id',
    cleanupColumnFor('appointment_patient_cancellations') === 'appointment_id');
  check('appointment_patient_cancellations está marcada SIN columna id',
    CLEANUP_TARGETS.find((t) => t.table === 'appointment_patient_cancellations').hasIdColumn === false);
  check('NO todas las tablas usan id (la suposición universal es falsa)',
    CLEANUP_TARGETS.some((t) => t.column !== 'id'));
  for (const t of ['auth_creation_grants', 'booking_intents', 'appointments',
                   'patients', 'services', 'doctors', 'clinics', 'profiles',
                   'availability_rules', 'clinic_members']) {
    check(`${t} declara su columna de filtro`, cleanupColumnFor(t) === 'id');
  }
  // Una tabla no declarada NO se borra a ciegas.
  {
    let lanzo = false;
    try { cleanupColumnFor('tabla_inexistente'); } catch { lanzo = true; }
    check('una tabla no declarada hace LANZAR, no adivinar la columna', lanzo);
  }
  check('la declaración explica por qué no hay convención universal',
    /NO existe una convención universal/.test(smoke));

  // ── El esquema real respalda la declaración ──
  {
    const tipos = read('src/types/database.types.ts');
    const bloque = between(tipos, 'appointment_patient_cancellations: {', 'Insert: {');
    check('el esquema confirma que la tabla NO tiene columna id',
      bloque.length > 0 && /^\s*id:/m.test(bloque) === false, true);
    check('el esquema confirma que sí tiene appointment_id',
      /appointment_id: string/.test(bloque));
  }

  // ── deleteVerdict: exacto / cero / null / parcial ──
  const V = deleteVerdict;
  check('exacto → OK', V({ preCount: 3, deletedCount: 3 }).ok === true);
  check('exacto → status OK', V({ preCount: 3, deletedCount: 3 }).status === 'OK');
  check('cero existentes y cero borradas → OK', V({ preCount: 0, deletedCount: 0 }).ok === true);
  check('parcial → NO ok', V({ preCount: 3, deletedCount: 1 }).ok === false);
  check('parcial → status PARTIAL', V({ preCount: 3, deletedCount: 1 }).status === 'PARTIAL');
  check('parcial informa ambos números',
    /borradas 1 de 3 existentes/.test(V({ preCount: 3, deletedCount: 1 }).detail));
  check('borró 0 de 3 → PARTIAL, no éxito', V({ preCount: 3, deletedCount: 0 }).status === 'PARTIAL');
  check('count null → UNKNOWN', V({ preCount: 3, deletedCount: null }).status === 'UNKNOWN');
  check('count undefined → UNKNOWN', V({ preCount: 3, deletedCount: undefined }).status === 'UNKNOWN');
  check('count NaN → UNKNOWN', V({ preCount: 3, deletedCount: NaN }).status === 'UNKNOWN');
  check('preCount desconocido → UNKNOWN', V({ preCount: null, deletedCount: 3 }).status === 'UNKNOWN');
  check('preCount desconocido NO se declara éxito', V({ preCount: null, deletedCount: 3 }).ok === false);
  check('error → ERROR', V({ error: { message: 'FK violation' } }).status === 'ERROR');
  check('error → NO ok', V({ error: { message: 'FK violation' } }).ok === false);
  check('el error de FK se conserva en el detalle',
    /FK violation/.test(V({ error: { message: 'FK violation' } }).detail));
  check('ningún estado distinto de OK se considera éxito',
    ['ERROR', 'UNKNOWN', 'PARTIAL'].every((s) => [
      V({ error: { message: 'x' } }), V({ preCount: 1, deletedCount: null }), V({ preCount: 3, deletedCount: 1 }),
    ].filter((r) => r.status === s).every((r) => r.ok === false)));

  // ── Integración: el helper llama a cleanupColumnFor, no adivina ──
  check('el helper obtiene la columna de CLEANUP_TARGETS',
    /const column = cleanupColumnFor\(table\);/.test(codigo));
  check('el helper recibe tabla y allowlist explícitas',
    /const del = async \(label, table, values\) =>/.test(codigo));
  check('el helper ignora allowlists vacías sin tocar la DB',
    /if \(list\.length === 0\) return;/.test(codigo));
  check('el borrado de audit_log también usa count exacto y deleteVerdict',
    /audit_log'\)\.delete\(\{ count: 'exact' \}\)/.test(codigo)
    && /const vAudit = deleteVerdict\(\{/.test(codigo), true);

  // ── Las protecciones previas siguen en pie ──
  const cl2 = between(codigo, 'async function cleanup()', 'async function cleanupAuditLog');
  const p = (t) => {
    const m = cl2.match(new RegExp(`await del\\([^;]*?,\\s*'${t}'`));
    return m ? cl2.indexOf(m[0]) : -1;
  };
  check('sigue: cancelaciones antes que citas', p('appointment_patient_cancellations') < p('appointments'), true);
  check('sigue: grants antes que intents', p('auth_creation_grants') < p('booking_intents'), true);
  check('sigue: intents antes que citas', p('booking_intents') < p('appointments'), true);
  check('sigue: citas antes que pacientes', p('appointments') < p('patients'), true);
  check('sigue: pacientes antes que perfiles', p('patients') < p('profiles'), true);
  check('sigue: la denylist del médico QA', /assertNotPermanent\(ids\.grantIds/.test(cl2));
  check('sigue: el inventario final completo', /auth_creation_grants \(por booking_intent_id\)/.test(codigo));
  check('sigue: la actividad externa nunca se borra', /NO se borran/.test(smoke));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} check-s7_71a: ${pass} OK, ${fail} fallos\n`);
process.exit(fail === 0 ? 0 : 1);
