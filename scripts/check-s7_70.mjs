/**
 * check-s7_70.mjs — CANCELACIÓN-PACIENTE-P0 + hardening de appointments.
 *
 *   node scripts/check-s7_70.mjs
 *
 * Verificación ESTRUCTURAL del texto de la migración y de los tipos
 * generados. SIN red, SIN Supabase, SIN service_role, SIN datos.
 * La verificación de COMPORTAMIENTO vive en _smoke-s7_70.mjs y requiere
 * autorización separada.
 *
 * Este check es el guardián del "impuesto permanente" de los grants por
 * columna: si alguien agrega una columna a appointments y no la otorga,
 * o si alguien amplía la lista sin revisarla, acá falla — no en producción.
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
/** Normaliza espacios para comparar SQL sin depender del formato. */
const canon = (s) => s.replace(/\s+/g, ' ').trim();

console.log('\ncheck-s7_70 — cancelación por paciente + hardening de appointments\n');

const sql = read('migrations/s7_70_patient_cancel_appointment.sql');

// ─── 1. Atomicidad ────────────────────────────────────────────────────
{
  console.log('1. Atomicidad');
  check('abre BEGIN', /^\s*BEGIN;/m.test(sql));
  check('cierra COMMIT', /^\s*COMMIT;\s*$/m.test(sql.trimEnd() + '\n'));
  check('un solo BEGIN', (sql.match(/^\s*BEGIN;/gm) || []).length, 1);
  check('un solo COMMIT', (sql.match(/^\s*COMMIT;/gm) || []).length, 1);
  check('sin ROLLBACK dentro de la migración', /^\s*ROLLBACK;/m.test(sql) === false);
  check('LOCK ACCESS EXCLUSIVE sobre appointments',
    /LOCK TABLE public\.appointments IN ACCESS EXCLUSIVE MODE;/.test(sql));
  check('un solo LOCK TABLE en toda la migración',
    (sql.match(/LOCK TABLE public\.appointments IN ACCESS EXCLUSIVE MODE;/g) || []).length, 1);
  check('lock_timeout acotado antes del LOCK',
    /SET LOCAL lock_timeout = '5s';/.test(sql)
    && sql.indexOf("SET LOCAL lock_timeout") < sql.indexOf('LOCK TABLE public.appointments'), true);
  check('statement_timeout acotado antes del LOCK',
    /SET LOCAL statement_timeout = '60s';/.test(sql)
    && sql.indexOf("SET LOCAL statement_timeout") < sql.indexOf('LOCK TABLE public.appointments'), true);
  // Solo sentencias SET completas (terminadas en `;`): el `SET search_path`
  // de las funciones es un atributo, no una sentencia de transacción.
  check('los timeouts son SET LOCAL (no escapan de la transacción)',
    /^\s*SET (?!LOCAL)[^;\n]*;/m.test(sql) === false);
  // El hardening y la creación de la RPC deben ir en la MISMA transacción.
  const iRpc = sql.indexOf('CREATE FUNCTION public.cancel_my_appointment');
  const iPol = sql.indexOf('DROP POLICY "appointments_update"');
  const iCommit = sql.indexOf('\nCOMMIT;');
  check('cancel_my_appointment se crea ANTES del hardening', iRpc > 0 && iRpc < iPol, true);
  check('el hardening ocurre antes del COMMIT', iPol > 0 && iPol < iCommit, true);
}

// ─── 1b. Ventana del ACCESS EXCLUSIVE — lo más corta posible ──────────
// El lock debe tomarse DESPUÉS de crear y asegurar todo lo nuevo, y solo
// puede haber reverificación + hardening + postcondiciones antes del COMMIT.
{
  console.log('\n1b. Ventana del lock');
  const iLock = sql.indexOf('LOCK TABLE public.appointments IN ACCESS EXCLUSIVE MODE;');
  const iCommit = sql.indexOf('\nCOMMIT;');
  const iTable = sql.indexOf('CREATE TABLE public.appointment_patient_cancellations');
  const iIndex = sql.indexOf('CREATE INDEX idx_appt_patient_cancellations_cancelled_at');
  const iRls = sql.indexOf('ALTER TABLE public.appointment_patient_cancellations ENABLE ROW LEVEL SECURITY');
  const iSelPol = sql.indexOf('CREATE POLICY appointment_patient_cancellations_select');
  const iFn1 = sql.indexOf('CREATE FUNCTION public.cancel_my_appointment');
  const iFn2 = sql.indexOf('CREATE FUNCTION public.list_recent_patient_cancellations');
  const iGrantExec = sql.indexOf('GRANT EXECUTE ON FUNCTION public.cancel_my_appointment');
  const iDrop = sql.indexOf('DROP POLICY "appointments_update"');
  const iRevoke = sql.indexOf('REVOKE UPDATE ON public.appointments FROM authenticated;');
  const iPost = sql.indexOf('DO $post$');

  for (const [label, idx] of [
    ['la tabla', iTable], ['el índice', iIndex], ['la RLS', iRls],
    ['la policy de lectura', iSelPol], ['cancel_my_appointment', iFn1],
    ['list_recent_patient_cancellations', iFn2], ['los GRANT EXECUTE', iGrantExec],
  ]) {
    check(`${label} se crea ANTES de tomar el lock`, idx > 0 && idx < iLock, true);
  }

  // Nada pesado después del lock.
  const afterLock = sql.slice(iLock, iCommit);
  check('tras el LOCK no se crean tablas', /CREATE TABLE/.test(afterLock) === false);
  check('tras el LOCK no se crean índices', /CREATE INDEX/.test(afterLock) === false);
  check('tras el LOCK no se crean funciones', /CREATE FUNCTION/.test(afterLock) === false);
  check('tras el LOCK no se crean tipos ni triggers',
    /CREATE (TYPE|TRIGGER|MATERIALIZED)/.test(afterLock) === false);

  // Reverificación bajo el lock, antes del hardening.
  const iRelock = sql.indexOf('DO $relock$');
  check('hay bloque de reverificación bajo el lock', iRelock > 0, true);
  check('la reverificación va después del LOCK y antes del hardening',
    iRelock > iLock && iRelock < iDrop, true);
  const relock = between(sql, 'DO $relock$', '$relock$;');
  check('RELOCK: owner de appointments', /v_owner_nm <> current_user/.test(relock));
  check('RELOCK: relrowsecurity', /v_rls IS NOT TRUE/.test(relock));
  check('RELOCK: relforcerowsecurity', /v_force IS NOT FALSE/.test(relock));
  check('RELOCK: definición semántica de appointments_update',
    /polcmd/.test(relock) && /polpermissive/.test(relock) && /polroles/.test(relock)
    && /polqual/.test(relock) && /polwithcheck/.test(relock));
  check('RELOCK: comparación canónica del USING (no literal)',
    /regexp_replace\(coalesce\(v_using, ''\), '\\s', '', 'g'\)/.test(relock));
  check('RELOCK: grant UPDATE actual de authenticated',
    /has_table_privilege\('authenticated', 'public\.appointments', 'UPDATE'\)/.test(relock));
  check('RELOCK: ausencia de UPDATE para anon',
    /has_table_privilege\('anon', 'public\.appointments', 'UPDATE'\)/.test(relock));

  // Orden final: reverificación → hardening → grants → postcondiciones → COMMIT.
  check('orden tras el lock: relock < drop policy < revoke/grant < post < commit',
    iLock < iRelock && iRelock < iDrop && iDrop < iRevoke && iRevoke < iPost && iPost < iCommit, true);
}

// ─── 2. Tabla append-only ─────────────────────────────────────────────
{
  console.log('\n2. appointment_patient_cancellations');
  const ddl = between(sql, 'CREATE TABLE public.appointment_patient_cancellations', 'COMMENT ON TABLE');
  check('appointment_id es PRIMARY KEY (una fila por cita)',
    /appointment_id\s+uuid PRIMARY KEY/.test(ddl));
  check('FK a appointments', /REFERENCES public\.appointments\(id\)/.test(ddl));
  check('FK sin ON DELETE (no hard-delete)', /REFERENCES public\.appointments\(id\)\s*,/.test(ddl));
  check('cancelled_at NOT NULL', /cancelled_at\s+timestamptz NOT NULL/.test(ddl));
  check('cancelled_by_profile_id NOT NULL + FK a profiles',
    /cancelled_by_profile_id\s+uuid NOT NULL[\s\S]*?REFERENCES public\.profiles\(id\)/.test(ddl));
  check('reason con CHECK de 4 valores',
    /'no_puedo_asistir', 'otro_horario', 'ya_no_necesito', 'otro'/.test(ddl));
  check('note con CHECK <= 300', /char_length\(note\) <= 300/.test(ddl));
  check('índice cancelled_at DESC',
    /CREATE INDEX idx_appt_patient_cancellations_cancelled_at[\s\S]*?\(cancelled_at DESC\)/.test(sql));
  check('RLS habilitada',
    /ALTER TABLE public\.appointment_patient_cancellations ENABLE ROW LEVEL SECURITY;/.test(sql));
}

// ─── 3. REVOKE frente a ALTER DEFAULT PRIVILEGES ──────────────────────
// Sin estos REVOKE la tabla nace con ALL y las funciones con EXECUTE
// para anon: los defaults de public los otorgan automáticamente.
{
  console.log('\n3. REVOKE frente a default privileges');
  for (const role of ['PUBLIC', 'anon', 'authenticated']) {
    check(`REVOKE ALL de la tabla para ${role}`,
      new RegExp(`REVOKE ALL ON TABLE public\\.appointment_patient_cancellations FROM ${role};`).test(sql));
  }
  check('REVOKE ALL de cancel_my_appointment (PUBLIC, anon, authenticated)',
    /REVOKE ALL ON FUNCTION public\.cancel_my_appointment\(uuid, text, text\)\s*FROM PUBLIC, anon, authenticated;/.test(sql));
  check('REVOKE ALL de list_recent_patient_cancellations (PUBLIC, anon, authenticated)',
    /REVOKE ALL ON FUNCTION public\.list_recent_patient_cancellations\(\)\s*FROM PUBLIC, anon, authenticated;/.test(sql));
  check('el REVOKE de la tabla precede al GRANT SELECT',
    sql.indexOf('REVOKE ALL ON TABLE public.appointment_patient_cancellations FROM authenticated;')
      < sql.indexOf('GRANT SELECT ON TABLE public.appointment_patient_cancellations'), true);
  check('el REVOKE de funciones precede al GRANT EXECUTE',
    sql.indexOf('REVOKE ALL ON FUNCTION public.cancel_my_appointment')
      < sql.indexOf('GRANT EXECUTE ON FUNCTION public.cancel_my_appointment'), true);
}

// ─── 4. Grants mínimos ────────────────────────────────────────────────
{
  console.log('\n4. Grants mínimos');
  check('SELECT de la tabla solo para authenticated',
    /GRANT SELECT ON TABLE public\.appointment_patient_cancellations TO authenticated;/.test(sql));
  check('sin GRANT INSERT/UPDATE/DELETE sobre la tabla nueva',
    /GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*appointment_patient_cancellations/.test(sql) === false);
  check('EXECUTE de ambas RPC solo para authenticated',
    /GRANT EXECUTE ON FUNCTION public\.cancel_my_appointment\(uuid, text, text\)\s*TO authenticated;/.test(sql)
    && /GRANT EXECUTE ON FUNCTION public\.list_recent_patient_cancellations\(\)\s*TO authenticated;/.test(sql));
  check('sin GRANT a anon en toda la migración',
    /GRANT[^;]*\bTO\b[^;]*\banon\b/.test(sql) === false);
  check('service_role no se toca', /service_role/.test(sql.replace(/^--.*$/gm, '')) === false);
}

// ─── 5. Policy de lectura ─────────────────────────────────────────────
{
  console.log('\n5. Policy de lectura de la tabla nueva');
  const pol = between(sql, 'CREATE POLICY appointment_patient_cancellations_select', 'CREATE FUNCTION');
  check('es FOR SELECT TO authenticated', /FOR SELECT TO authenticated/.test(pol));
  check('espeja la visibilidad de la cita (clínica o paciente dueño)',
    /public\.is_clinic_member\(a\.clinic_id\)/.test(pol) && /p\.profile_id = auth\.uid\(\)/.test(pol));
  check('no existe ninguna policy de escritura sobre la tabla nueva',
    /CREATE POLICY[^;]*appointment_patient_cancellations[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/i.test(sql) === false);
}

// ─── 6. RPC cancel_my_appointment ─────────────────────────────────────
{
  console.log('\n6. cancel_my_appointment');
  const fn = between(sql, 'CREATE FUNCTION public.cancel_my_appointment', '-- ─── 8.');
  check('SECURITY DEFINER', /SECURITY DEFINER/.test(fn));
  check('search_path = pg_catalog, public, pg_temp (pg_temp explícito y ÚLTIMO)',
    /SET search_path = pg_catalog, public, pg_temp/.test(fn));
  check('firma (uuid, text, text) con defaults NULL',
    /p_appointment_id uuid,\s*p_reason\s+text DEFAULT NULL,\s*p_note\s+text DEFAULT NULL/.test(fn));
  check('gate de sesión P0110', /P0110/.test(fn));
  // Pertenencia y bloqueo en la MISMA sentencia: nunca se bloquea una cita
  // ajena para verificar después.
  const lockStmt = between(fn, 'SELECT a.* INTO v_appt', 'IF NOT FOUND THEN');
  check('el FOR UPDATE incluye el JOIN a patients', /JOIN public\.patients p ON p\.id = a\.patient_id/.test(lockStmt));
  check('la pertenencia va en el WHERE del mismo SELECT',
    /p\.profile_id = v_uid/.test(lockStmt) && /p\.link_confirmed_at IS NOT NULL/.test(lockStmt));
  check('FOR UPDATE OF a (bloquea appointments, no patients)', /FOR UPDATE OF a;/.test(lockStmt));
  check('sin verificación de pertenencia POSTERIOR al lock',
    /IF NOT EXISTS \(\s*SELECT 1 FROM public\.patients/.test(fn) === false);
  check('sin fila → P0111 genérico',
    /IF NOT FOUND THEN\s*RAISE EXCEPTION[^;]*P0111/.test(fn));
  check('pertenencia genérica P0111 (no revela citas ajenas)',
    (fn.match(/P0111/g) || []).length >= 2);
  check('elegibilidad de estado P0112', /P0112/.test(fn));
  check('regla temporal start_time > now() → P0113',
    /v_appt\.start_time <= now\(\)/.test(fn) && /P0113/.test(fn));
  check('motivo inválido P0114', /P0114/.test(fn));
  check('nota > 300 P0115 (rechaza, no trunca)',
    /P0115/.test(fn) && /char_length\(v_note\) > 300/.test(fn) && /substr|left\(/.test(fn) === false);
  check('normaliza nota/motivo vacíos a NULL',
    /nullif\(btrim\(coalesce\(p_reason, ''\)\), ''\)/.test(fn)
    && /nullif\(btrim\(coalesce\(p_note,\s+''\)\), ''\)/.test(fn));
  // Idempotencia estricta.
  check('already_cancelled_by_patient SOLO si existe la fila de evento',
    /v_has_event/.test(fn) && /already_cancelled_by_patient/.test(fn));
  check('cancelada sin evento → terminal, sin atribuir al paciente',
    /already_cancelled_by_other/.test(fn));
  check('NO inserta eventos retrospectivos',
    canon(between(fn, 'IF v_status_name = \'cancelada\' THEN', 'END IF;'))
      .includes('INSERT INTO public.appointment_patient_cancellations') === false);
  // UPDATE acotado.
  const upd = between(fn, 'UPDATE public.appointments', 'WHERE id = v_appt.id;');
  check('UPDATE toca ÚNICAMENTE status_id', canon(upd), 'UPDATE public.appointments SET status_id = v_cancel_id');
  check('escribe el evento append-only',
    /INSERT INTO public\.appointment_patient_cancellations/.test(fn));
  check('escribe auditoría server-side con edited_via=patient_self_cancel',
    /INSERT INTO public\.audit_log/.test(fn) && /'edited_via', 'patient_self_cancel'/.test(fn));
  check('la nota libre NO va al audit_log',
    between(fn, 'INSERT INTO public.audit_log', 'RETURN jsonb_build_object').includes('v_note') === false);
  check('no usa helpers legacy (is_clinic_member/get_user_doctor_id/get_user_role)',
    /is_clinic_member|get_user_doctor_id|get_user_role|is_clinic_member_with_role/.test(fn) === false);
  check('todos los objetos calificados (sin FROM appointments sin esquema)',
    /(FROM|INTO|UPDATE|JOIN)\s+(?!public\.|pg_catalog\.)(appointments|patients|profiles|audit_log|appointment_statuses)\b/.test(fn) === false);
}

// ─── 7. RPC list_recent_patient_cancellations ─────────────────────────
{
  console.log('\n7. list_recent_patient_cancellations');
  const fn = between(sql, 'CREATE FUNCTION public.list_recent_patient_cancellations', '-- ─── 9.');
  check('sin parámetros (no acepta doctorId)',
    /CREATE FUNCTION public\.list_recent_patient_cancellations\(\)/.test(sql));
  check('SECURITY DEFINER + STABLE', /SECURITY DEFINER/.test(fn) && /STABLE/.test(fn));
  check('search_path = pg_catalog, public, pg_temp',
    /SET search_path = pg_catalog, public, pg_temp/.test(fn));
  check('deriva el médico de auth.uid() con SQL propio',
    /FROM public\.doctors d\s*WHERE d\.profile_id = v_uid/.test(fn));
  check('no usa helpers legacy',
    /is_clinic_member|get_user_doctor_id|get_user_role/.test(fn) === false);
  check('máximo fijo de 5 filas', /LIMIT 5;/.test(fn));
  check('ventana de 7 días server-side', /now\(\) - interval '7 days'/.test(fn));
  check('orden cancelled_at DESC', /ORDER BY c\.cancelled_at DESC/.test(fn));
  check('no expone la nota libre en la tarjeta',
    between(fn, 'RETURNS TABLE', 'LANGUAGE').includes('note') === false);
  check('sin doctor → sin resultados (no error)', /IF v_doctor_id IS NULL THEN\s*RETURN;/.test(fn));
}

// ─── 8. Hardening de appointments_update ──────────────────────────────
{
  console.log('\n8. Hardening de appointments_update');
  check('DROP fail-closed (sin IF EXISTS)',
    /DROP POLICY "appointments_update" ON public\.appointments;/.test(sql)
    && /DROP POLICY IF EXISTS "appointments_update"/.test(sql) === false);
  const pol = between(sql, 'CREATE POLICY "appointments_update"', '-- WITH CHECK explícito');
  check('FOR UPDATE TO authenticated (antes PUBLIC)', /FOR UPDATE TO authenticated/.test(pol));
  check('USING = is_clinic_member(clinic_id)', /USING\s+\(public\.is_clinic_member\(clinic_id\)\)/.test(pol));
  check('WITH CHECK explícito = is_clinic_member(clinic_id)',
    /WITH CHECK \(public\.is_clinic_member\(clinic_id\)\)/.test(pol));
  check('SIN rama de paciente (patient_id / profile_id ausentes)',
    /patient_id|profile_id/.test(pol) === false);
}

// ─── 9. Grant de UPDATE por columna — las 9 aprobadas, ni una más ─────
{
  console.log('\n9. UPDATE por columna (impuesto permanente vigilado)');
  check('REVOKE UPDATE de tabla antes del GRANT por columna',
    /REVOKE UPDATE ON public\.appointments FROM authenticated;/.test(sql)
    && sql.indexOf('REVOKE UPDATE ON public.appointments FROM authenticated;')
       < sql.indexOf('GRANT UPDATE ('), true);
  const grant = between(sql, 'GRANT UPDATE (', 'ON public.appointments TO authenticated;');
  const cols = grant
    .replace('GRANT UPDATE (', '')
    .replace(/\)\s*$/, '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .sort();
  const expected = [
    'cancel_reason_id', 'end_time', 'internal_notes', 'notes', 'price',
    'service_id', 'start_time', 'status_id', 'updated_at',
  ];
  check('exactamente 9 columnas', cols.length, 9);
  check('la lista es EXACTAMENTE la aprobada', cols.join(','), expected.join(','));
  for (const forbidden of ['patient_id', 'doctor_id', 'clinic_id', 'payment_status', 'stripe_payment_id', 'source']) {
    check(`${forbidden} fuera del grant`, cols.includes(forbidden), false);
  }
}

// ─── 10. Pre y postcondiciones ────────────────────────────────────────
{
  console.log('\n10. Pre y postcondiciones');
  check('bloque de PRECONDICIONES', /DO \$pre\$/.test(sql));
  check('bloque de POSTCONDICIONES', /DO \$post\$/.test(sql));
  const pre = between(sql, 'DO $pre$', '$pre$;');
  check('PRE: antidrift SEMÁNTICO (nombre, cmd, roles, USING, WITH CHECK)',
    /polname = 'appointments_update'/.test(pre) && /polcmd/.test(pre)
    && /polroles/.test(pre) && /polqual/.test(pre) && /polwithcheck/.test(pre));
  check('PRE: comparación insensible a espacios (no literal)',
    /regexp_replace\(v_using,\s*'\\\\s', '', 'g'\)|regexp_replace\(v_using, *'\\s', '', 'g'\)/.test(pre)
    || /regexp_replace\(v_using/.test(pre));
  check('PRE: verifica que no haya otra policy permisiva de UPDATE', /v_perm_upd <> 1/.test(pre));
  check('PRE: verifica que no haya policies RESTRICTIVAS', /v_restr_upd <> 0/.test(pre));
  check('PRE: premisa del DEFINER (FORCE off + owner BYPASSRLS)',
    /relforcerowsecurity/.test(pre) && /rolbypassrls/.test(pre));
  check('PRE: current_user con BYPASSRLS (owner REAL de las funciones)',
    /r\.rolname = current_user/.test(pre) && /v_cur_bypass IS NOT TRUE/.test(pre));
  check('PRE: current_user coincide con el owner de appointments',
    /current_user <> v_owner_nm/.test(pre));
  check('PRE: los objetos nuevos no existen todavía',
    /to_regclass\('public\.appointment_patient_cancellations'\) IS NOT NULL/.test(pre));
  check('PRE: deja constancia de trg_block_inactive_service',
    /trg_block_inactive_service/.test(pre));
  const post = between(sql, 'DO $post$', '$post$;');
  check('POST: valida la policy nueva semánticamente', /polwithcheck/.test(post));
  // `pg_get_expr` deparsa una llamada a función SIMPLE sin paréntesis
  // envolventes. Esperar "(is_clinic_member(clinic_id))" hace fallar la POST
  // con un falso drift y aborta la migración entera.
  check('POST: el valor esperado usa la forma DEPARSADA (sin paréntesis envolventes)',
    /v_expected\s+text := 'is_clinic_member\(clinic_id\)';/.test(post));
  check('POST: no espera la forma del DDL con paréntesis',
    /v_expected\s+text := '\(is_clinic_member\(clinic_id\)\)';/.test(post) === false);
  check('POST: authenticated pierde el UPDATE de tabla',
    /conserva UPDATE de TABLA completa/.test(post));
  check('POST: set exacto de columnas', /v_expected_cols/.test(post));
  check('POST: anon no ganó privilegios', /anon obtuvo privilegios/.test(post));
  check('POST: la tabla nueva sin escritura para authenticated',
    /conserva escritura sobre appointment_patient_cancellations/.test(post));
  check('POST: RPC no ejecutables por anon', /anon puede ejecutar alguna de las RPC/.test(post));
  check('POST: RLS activa en la tabla nueva', /RLS no quedó activa/.test(post));
  check('POST: EXACTAMENTE 1 policy SELECT en la tabla nueva',
    /v_sel_pols <> 1/.test(post));
  check('POST: CERO policies de escritura en la tabla nueva',
    /v_wr_pols <> 0/.test(post));
  check('POST: owner de ambas RPC = rol ejecutor',
    /pertenece a % y se esperaba %/.test(post) && /v_fn_owner_nm <> current_user/.test(post));
  check('POST: owner de las RPC con BYPASSRLS', /no tiene BYPASSRLS/.test(post));
  check('POST: ambas RPC son SECURITY DEFINER', /no es SECURITY DEFINER/.test(post));
  check('POST: proconfig EXACTO = search_path pg_catalog, public, pg_temp',
    /search_path=pg_catalog,public,pg_temp/.test(post)
    && /array_length\(v_cfg, 1\) <> 1/.test(post));
  check('POST: PUBLIC sin acceso a la tabla nueva',
    /PUBLIC conserva acceso a appointment_patient_cancellations/.test(post));
  check('POST: PUBLIC sin EXECUTE de las RPC',
    /PUBLIC puede ejecutar alguna de las RPC/.test(post));
}

// ─── 11. Tipos generados ──────────────────────────────────────────────
{
  console.log('\n11. database.types.ts');
  const t = read('src/types/database.types.ts');
  check('tabla appointment_patient_cancellations tipada',
    /appointment_patient_cancellations: \{/.test(t));
  check('cancel_my_appointment tipada', /cancel_my_appointment: \{/.test(t));
  check('list_recent_patient_cancellations tipada', /list_recent_patient_cancellations: \{/.test(t));
}

// ─── 12. Alcance: PR-A no toca frontend ───────────────────────────────
{
  console.log('\n12. Alcance de PR-A');
  check('la migración no referencia archivos de src/', /src\//.test(sql) === false);
}

// ─── 13. Invariantes del smoke (que no vuelva a regresar) ─────────────
{
  console.log('\n13. _smoke-s7_70 — invariantes');
  const sm = read('scripts/_smoke-s7_70.mjs');
  check('no se autoejecuta (exige --run + CP0_SMOKE_AUTHORIZED)',
    /process\.argv\.includes\('--run'\)/.test(sm)
    && /process\.env\.CP0_SMOKE_AUTHORIZED === '1'/.test(sm));
  check('selecciona is_final del catálogo de estados',
    /\.select\('id, name, is_final'\)/.test(sm));
  check('los estados finales se calculan con is_final === true',
    /s\.is_final === true/.test(sm) && /is_final !== false/.test(sm) === false);
  check('aborta si is_final no llegó (anti falso positivo)',
    /catálogo sin estados finales/.test(sm));
  const doctorOps = [
    'confirmar', 'pasar a sala', 'atender', 'marcar no asistió',
    'cancelar con cancel_reason_id', 'reprogramar start_time/end_time',
    'editar service_id', 'editar notes', 'editar internal_notes',
    'editar price', 'escribir updated_at',
  ];
  for (const op of doctorOps) {
    check(`cobertura médica: ${op}`, sm.includes(`'${op}`), true);
  }
  check('transiciones terminales en citas separadas',
    /apptNoShow/.test(sm) && /apptDocCancel/.test(sm) && /apptFlow/.test(sm));
  // Preparación de profiles sin disparar audit_profiles_identity_fn (s7_32).
  // Se ignoran los comentarios: el `//` que explica POR QUÉ no se usa
  // full_name menciona la columna, y no debe contar como uso.
  const setup = between(sm, 'const uPatient = await createUser', 'const { data: spec }')
    .replace(/^\s*\/\/.*$/gm, '');
  check('profiles NO se prepara con full_name (evita el trigger legacy)',
    /full_name/.test(setup) === false);
  check('profiles NO se prepara con email (lo pone handle_new_user)',
    /email/.test(setup) === false);
  check('sin upsert ni insert directo sobre profiles en todo el smoke',
    /from\('profiles'\)\s*\.\s*(upsert|insert)\(/.test(sm.replace(/^\s*\/\/.*$/gm, '')) === false);
  check('el setup usa update({ role }) sobre la fila de handle_new_user',
    /\.update\(\{ role \}\)/.test(setup) && /\.eq\('id', u\.id\)/.test(setup));
  check('confirma que se actualizó EXACTAMENTE una fila',
    /\.select\('id'\)/.test(setup) && /data\?\.length !== 1/.test(setup));
  check('aborta con error explícito si handle_new_user no creó la fila',
    /handle_new_user no creó exactamente una fila/.test(setup));
  // Impresión de IDs sintéticos.
  check('imprime el inventario de UUID sintéticos', /function printInventory\(\)/.test(sm));
  for (const obj of ['usuario Auth / perfil', 'clínica', 'membresías', 'médico',
    'paciente', 'servicios', 'reglas', 'citas', 'eventos']) {
    check(`inventario incluye ${obj}`, sm.includes(obj), true);
  }
  check('el inventario se imprime tras crear las fixtures', /printInventory\(\);/.test(sm));
  check('el inventario no imprime contraseñas ni tokens',
    /console\.log\([^)]*password|console\.log\([^)]*access_token/.test(sm) === false);
  // Cleanup de auditoría: al final, acotado, sin filtros amplios.
  const cl = between(sm, 'async function cleanup()', 'main()');
  check('la auditoría se borra AL FINAL (después de perfiles y usuarios Auth)',
    cl.indexOf("del('perfiles'") < cl.indexOf("del('audit_log · cancelación"), true);
  check('borra la auditoría de la cancelación con su marca específica',
    /\.eq\('new_data->>edited_via', 'patient_self_cancel'\)/.test(cl));
  check('borra el resto acotado a record_id ∈ IDs sintéticos',
    /\.in\('record_id', syntheticSafe\)/.test(cl));
  check('acota por table_name ∈ tablas del smoke',
    /\.in\('table_name', SMOKE_TABLES\)/.test(cl));
  check('acota por created_at >= inicio de la corrida',
    (cl.match(/\.gte\('created_at', RUN_STARTED_AT\)/g) || []).length >= 2);
  check('sin filtros amplios por nombre/correo/prefijo en el borrado de auditoría',
    /audit_log[\s\S]{0,400}?\.(like|ilike)\(/.test(cl) === false);
  check('verifica 0 auditorías para TODO el conjunto sintético (no solo citas)',
    /for \(const t of SMOKE_TABLES\)/.test(cl)
    && /0 auditorías residuales para TODO el conjunto sintético/.test(cl));
  check('cleanup valida el error de cada escritura', /cleanupErrors\+\+/.test(sm));
  check('cleanup verifica 0 residuos en todos los objetos',
    ['eventos', 'citas', 'reglas de disponibilidad', 'servicios', 'pacientes',
     'médicos', 'membresías', 'clínicas', 'perfiles']
      .every((o) => sm.includes(`0 ${o} residuales`))
    && sm.includes('0 auditorías residuales para TODO el conjunto sintético'));
  // Se prohíbe la LLAMADA a listUsers (rota en este proyecto), no su
  // mención en comentarios o en el texto de un check.
  check('usuarios Auth verificados con getUserById (sin llamar a listUsers)',
    /admin\.auth\.admin\.getUserById\(/.test(sm) && /listUsers\s*\(/.test(sm) === false);
  check('fixtures marcadas CP0_FIXTURE', /const MARK = 'CP0_FIXTURE'/.test(sm));

  // ── Columnas NOT NULL reales de cada fixture (extraídas de los Insert de
  //    database.types.ts). Cada una costó una corrida fallida; se fijan acá.
  check('clinics: owner_id presente (NOT NULL)', /owner_id: uDoctor\.id/.test(sm));
  check('availability_rules: clinic_id presente (NOT NULL)',
    /clinic_id: ids\.clinicId, doctor_id: ids\.doctorId, day_of_week/.test(sm));
  check('patients: gender presente (NOT NULL, enum gender_type)', /gender: 'otro'/.test(sm));
  check('patients: profile_id del usuario Auth paciente', /profile_id: uPatient\.id/.test(sm));
  check('patients: link_confirmed_at NO nulo (lo exige cancel_my_appointment)',
    /link_confirmed_at: new Date\(\)\.toISOString\(\)/.test(sm));
  check('patients: full_name y date_of_birth presentes',
    /full_name: `\$\{MARK\} Paciente`/.test(sm) && /date_of_birth: '1990-01-01'/.test(sm));
  check('doctor A: profile_id, clinic_id y membresía activa',
    /profile_id: uDoctor\.id, specialty_id/.test(sm)
    && /clinic_id: ids\.clinicId, profile_id: uDoctor\.id, role: 'owner', is_active: true/.test(sm));
  // Dos servicios: el cambio de service_id debe apuntar a uno DISTINTO.
  check('dos servicios sintéticos', /for \(const n of \['Consulta', 'Control'\]\)/.test(sm));
  check('el cambio de service_id usa el segundo servicio',
    /service_id: ids\.serviceIds\[1\]/.test(sm));
  // Aislamiento honesto: segunda clínica REAL con membresía, no un suelto.
  check('existe una segunda clínica sintética con owner propio',
    /name: `\$\{MARK\} Clinica B`, owner_id: uOther\.id/.test(sm));
  check('el usuario "other" tiene membresía activa en la clínica B',
    /clinic_id: ids\.clinicId2, profile_id: uOther\.id, role: 'owner', is_active: true/.test(sm));
  check('el usuario "other" es médico de la clínica B',
    /clinic_id: ids\.clinicId2, profile_id: uOther\.id, specialty_id/.test(sm));
  check('la prueba se llama "médico de OTRA clínica" (no "sin acceso")',
    /médico de OTRA clínica no modifica la cita/.test(sm));
  // cancel_reasons: solo lectura.
  check('cancel_reasons se lee, nunca se escribe',
    /from\('cancel_reasons'\)\s*\n?\s*\.select\(/.test(sm)
    && /from\('cancel_reasons'\)[\s\S]{0,80}?\.(insert|update|delete|upsert)\(/.test(sm) === false);
  // Cleanup en orden inverso a las FK.
  const cl2 = between(sm, 'async function cleanup()', 'main()');
  const order = ['appointment_patient_cancellations', "from('appointments')", 'availability_rules',
    "from('services')", "from('patients')", "from('doctors')", "from('clinic_members')",
    "from('clinics')", "from('profiles')", 'deleteUser', "from('audit_log')"];
  let lastIdx = -1, ordered = true;
  for (const token of order) {
    const i = cl2.indexOf(token);
    if (i < 0 || i < lastIdx) { ordered = false; break; }
    lastIdx = i;
  }
  check('cleanup respeta el orden inverso a las FK (eventos→…→clínicas→perfiles→auth→audit)', ordered);
  check('las clínicas se borran ANTES que los perfiles (clinics.owner_id → profiles)',
    cl2.indexOf("from('clinics')") < cl2.indexOf("from('profiles')"), true);
  check('cero residuos se verifica sobre TODOS los IDs sintéticos',
    /allSyntheticIds\(\)/.test(sm) && /syntheticSafe/.test(cl2));
  // review_tokens: solo verificación, nunca DELETE directo (lo borra el CASCADE).
  check('verifica 0 review_tokens por appointment_id exacto',
    /countOf\('review_tokens', 'id', \(q\) => q\.in\('appointment_id', apptIds\)\)/.test(cl2));
  check('sin DELETE directo sobre review_tokens',
    /from\('review_tokens'\)[\s\S]{0,60}?\.delete\(/.test(sm) === false);
  check('review_tokens no es requisito funcional (solo se cuenta)',
    /insert[\s\S]{0,40}review_tokens/i.test(sm) === false);
  // availability_rules simétrico para ambos médicos.
  check('cleanup de availability_rules cubre ambos médicos',
    /availability_rules'\)\.delete\(\)\.in\('doctor_id', doctorIdsAll\)/.test(cl2));
  check('verificación de reglas cubre ambos médicos',
    /q\.in\('doctor_id', doctorIdsCheck\.length \? doctorIdsCheck : \[NIL\]\)/.test(cl2));
  check('verificación de médicos cubre ambos', /0 médicos residuales \(ambos\)/.test(cl2));
  check('sin teléfonos ni datos reales (usuarios por email .test)',
    /@lucycare\.test/.test(sm) && /503\d{8}/.test(sm) === false);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} check-s7_70: pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
