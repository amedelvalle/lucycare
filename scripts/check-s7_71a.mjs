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
const rbRaw  = read('migrations/s7_71a_rollback.sql');
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
  check('está declarado en FORBIDDEN_PHONES',
    /FORBIDDEN_PHONES = \[[^\]]*'50372608827'/.test(smoke));
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

  check('los teléfonos de fixture salen del rango sintético 50369…',
    /`50369\$\{runSeed\}00\$\{i\}`/.test(smoke));
  check('todo teléfono de fixture pasa por la guarda',
    /assertNotForbidden\(`50369/.test(smoke));
  check('createUser revalida la guarda antes de escribir',
    /assertNotForbidden\(identity\.phone, `createUser/.test(smoke));

  // ── El prefijo elegido no colisiona con nada del repositorio ──
  const universo = [read('CLAUDE.md'), read('docs/OWNER_S7_71A_APPLY.md'), smoke].join('\n');
  check('el prefijo 50369 no aparece en CLAUDE.md',
    /50369\d{6}/.test(read('CLAUDE.md')) === false);
  check('el rango 5037000xxxx quedó descartado (poblado por QA previo)',
    /rango `5037000xxxx` está densamente poblado/.test(smoke));

  // ── FORBIDDEN_PHONES: cobertura y normalización ──
  const fp = between(smoke, 'const FORBIDDEN_PHONES = [', '];');
  for (const [desc, num] of [
    ['Katherine',                     '50372608827'],
    ['Camilo (demo)',                 '50378627694'],
    ['Test Phone admin plataforma',   '50378056365'],
    ['Test Phone paciente Fase 1',    '50375000001'],
    ['sintético 50370007201',         '50370007201'],
    ['sintético 50370007202',         '50370007202'],
    ['QA 50375000099',                '50375000099'],
    ['QA 50377003001',                '50377003001'],
    ['QA 50370007299',                '50370007299'],
    ['QA 50370069901',                '50370069901'],
  ]) check(`FORBIDDEN_PHONES incluye ${desc}`, fp.includes(num));

  check(`FORBIDDEN_PHONES tiene cobertura amplia (${(fp.match(/'503\d{8}'/g) || []).length})`,
    (fp.match(/'503\d{8}'/g) || []).length >= 25);
  check('existe normalizePhone', /const normalizePhone = /.test(smoke));
  check('la normalización quita el prefijo 503',
    /d\.length === 11 && d\.startsWith\('503'\) \? d\.slice\(3\) : d/.test(smoke));
  check('la normalización quita separadores', /replace\(\/\\D\/g, ''\)/.test(smoke));
  check('la comparación usa el set normalizado',
    /FORBIDDEN_NORMALIZED\.has\(normalizePhone\(phone\)\)/.test(smoke));
  check('el preflight reporta la lista completa',
    /Teléfonos prohibidos \(\$\{FORBIDDEN_PHONES\.length\}\)/.test(smoke));
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
  void universo;
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
  check('preflight verifica cancel_reasons',
    /cancel_reasons tiene al menos un motivo/.test(pf));
  check('preflight documenta el contrato de las RPC de booking',
    /register_booking_intent\(p_doctor_id/.test(pf) && /create_booking_with_intent\(p_intent_id/.test(pf));
  check('preflight aborta con exit ≠ 0 si hay colisión',
    /process\.exit\(usable \? 0 : 1\)/.test(pf));

  // ── Identidades deterministas ──
  check('ASP0_RUN_ID es obligatorio', /ASP0_RUN_ID/.test(smoke)
    && /\^\[a-z0-9\]\{4,12\}\$/.test(smoke), true);
  check('las identidades se derivan del RUN_ID (deterministas)',
    /const IDENTITIES = \['patient', 'doctora', 'doctorb'\]\.map/.test(smoke));
  check('las 3 identidades pasan por la guarda',
    /assertNotForbidden\(`50369\$\{runSeed\}00\$\{i\}`/.test(smoke));

  // ── Inventario EXHAUSTIVO de Auth ──
  const la = between(smoke, 'async function listAllAuthUsers()', 'async function buildManifest');
  check('existe listAllAuthUsers()', la.length > 200);
  check('usa el perPage máximo (1000)', /AUTH_PER_PAGE = 1000/.test(smoke));
  check('recorre desde page = 1', /for \(let page = 1; page <= AUTH_MAX_PAGES; page\+\+\)/.test(la));
  check('termina al recibir una página menor que perPage',
    /if \(batch\.length < AUTH_PER_PAGE\) \{ complete = true; break; \}/.test(la));
  check('registra páginas y usuarios inspeccionados',
    /pages\+\+/.test(la) && /users\.push\(\.\.\.batch\)/.test(la));
  check('detecta páginas repetidas (firma por ids)',
    /seenPages\.has\(sig\)/.test(la) && /paginación rota/.test(la));
  check('detecta ausencia de avance', /no devolvió usuarios pero se esperaba avance/.test(la));
  check('impone un tope defensivo de páginas', /AUTH_MAX_PAGES = 200/.test(smoke)
    && /tope defensivo de \$\{AUTH_MAX_PAGES\} páginas/.test(la), true);
  check('aborta si la API devuelve error', /listUsers\(page=\$\{page\}\) falló/.test(la));
  check('solo `complete: true` por la salida sana', /complete = true/.test(la)
    && (la.match(/complete = true/g) || []).length === 1, true);
  check('FALLA CERRADO: sin inventario completo no hay --run',
    /FALLA CERRADO: no se autoriza --run/.test(smoke));
  check('la colisión se busca por email normalizado',
    /emailSet\.has\(u\.email\.toLowerCase\(\)\)/.test(smoke));
  check('la colisión se busca por teléfono normalizado',
    /phoneSet\.has\(normalizePhone\(u\.phone\)\)/.test(smoke));
  check('profiles se declara comprobación ADICIONAL, no sustituto',
    /comprobación ADICIONAL, nunca un\s*\*? ?sustituto|comprobaciones ADICIONALES:/.test(smoke.replace(/\s+/g, ' ')));
  check('NUNCA SQL sobre auth.users para el inventario',
    /Nunca se consulta `auth\.users` por SQL/.test(smoke));

  // ── Manifiesto y huella ──
  const bm = between(smoke, 'async function buildManifest()', 'function fingerprintOf');
  check('existe buildManifest()', bm.length > 200);
  check('el manifiesto incluye run_id', /run_id: RUN_ID/.test(bm));
  check('el manifiesto incluye los 3 emails', /emails: IDENTITIES\.map/.test(bm));
  check('el manifiesto incluye los 3 teléfonos', /phones: IDENTITIES\.map/.test(bm));
  check('el manifiesto incluye specialty_id', /specialty_id:/.test(bm));
  check('el manifiesto incluye los estados de cita', /appointment_statuses: statusMap/.test(bm));
  check('el manifiesto incluye cancel_reason_id', /cancel_reason_id:/.test(bm));
  check('el manifiesto NO incluye claves ni secretos',
    /SERVICE|ANON|KEY|token|password/i.test(bm) === false);
  check('la huella es SHA-256 sobre el manifiesto canónico',
    /createHash\('sha256'\)\.update\(canonical\)\.digest\('hex'\)/.test(smoke));
  check('preflight emite ASP0_PREFLIGHT_FINGERPRINT',
    /ASP0_PREFLIGHT_FINGERPRINT=\$\{fp\}/.test(smoke));
  check('no se emite huella si hay colisión o inventario incompleto',
    /NO se emite huella: --run queda bloqueado/.test(smoke));
  check('--run exige la huella', /WANT_RUN && !\/\^\[0-9a-f\]\{64\}\$\/\.test\(EXPECTED_FINGERPRINT\)/.test(smoke));
  check('la huella se verifica ANTES de la primera escritura',
    /async function verifyFingerprintBeforeWriting\(\)/.test(smoke)
    && smoke.indexOf('await verifyFingerprintBeforeWriting()') < smoke.indexOf('await buildFixtures(manifest)'), true);
  check('--run reconstruye el manifiesto', /const manifest = await buildManifest\(\);[\s\S]{0,120}fingerprintOf\(manifest\)/.test(smoke));
  check('--run aborta si la huella no coincide',
    /ABORTADO antes de escribir: la huella del manifiesto no coincide/.test(smoke));
  check('--run repite las comprobaciones de colisión',
    /await verifyNoCollisions\(\{ verbose: false \}\)/.test(smoke));
  check('--run aborta si aparece colisión',
    /ABORTADO antes de escribir: inventario de Auth incompleto o colisión/.test(smoke));
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
    /residuals \+= authLeft/.test(smoke));
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

console.log(`\n${fail === 0 ? '✅' : '❌'} check-s7_71a: ${pass} OK, ${fail} fallos\n`);
process.exit(fail === 0 ? 0 : 1);
