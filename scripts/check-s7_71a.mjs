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
 */
const stripComments = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

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
