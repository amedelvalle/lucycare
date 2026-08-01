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
  // El hardening y la creación de la RPC deben ir en la MISMA transacción.
  const iRpc = sql.indexOf('CREATE FUNCTION public.cancel_my_appointment');
  const iPol = sql.indexOf('DROP POLICY "appointments_update"');
  const iCommit = sql.indexOf('\nCOMMIT;');
  check('cancel_my_appointment se crea ANTES del hardening', iRpc > 0 && iRpc < iPol, true);
  check('el hardening ocurre antes del COMMIT', iPol > 0 && iPol < iCommit, true);
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
  check('SELECT ... FOR UPDATE (serializa el doble clic)', /FOR UPDATE;/.test(fn));
  check('gate de sesión P0110', /P0110/.test(fn));
  check('pertenencia genérica P0111 (no revela citas ajenas)',
    (fn.match(/P0111/g) || []).length >= 2);
  check('exige link_confirmed_at IS NOT NULL', /link_confirmed_at IS NOT NULL/.test(fn));
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
  check('PRE: los objetos nuevos no existen todavía',
    /to_regclass\('public\.appointment_patient_cancellations'\) IS NOT NULL/.test(pre));
  check('PRE: deja constancia de trg_block_inactive_service',
    /trg_block_inactive_service/.test(pre));
  const post = between(sql, 'DO $post$', '$post$;');
  check('POST: valida la policy nueva semánticamente', /polwithcheck/.test(post));
  check('POST: authenticated pierde el UPDATE de tabla',
    /conserva UPDATE de TABLA completa/.test(post));
  check('POST: set exacto de columnas', /v_expected_cols/.test(post));
  check('POST: anon no ganó privilegios', /anon obtuvo privilegios/.test(post));
  check('POST: la tabla nueva sin escritura para authenticated',
    /conserva escritura sobre appointment_patient_cancellations/.test(post));
  check('POST: RPC no ejecutables por anon', /anon puede ejecutar alguna de las RPC/.test(post));
  check('POST: RLS activa y sin policies de escritura en la tabla nueva',
    /RLS no quedó activa/.test(post) && /policies de escritura/.test(post));
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

console.log(`\n${fail === 0 ? '✅' : '❌'} check-s7_70: pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
