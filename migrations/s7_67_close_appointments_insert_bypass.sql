-- ═══════════════════════════════════════════════════════════
-- Migración S7-67: AUTH-P1B1B (C) — cierre del INSERT directo
--                  de pacientes sobre public.appointments
-- ═══════════════════════════════════════════════════════════
-- Paso C del frente AUTH-P1B1B. Deja como ÚNICO camino público de
-- creación de citas:
--     register_booking_intent → create_booking_with_intent
--
-- ── PREMISA VERIFICADA EN PREFLIGHT (owner, 2026-07-24, PG 17.6) ──
--   • appointments: relrowsecurity=true · relforcerowsecurity=false
--     owner=postgres (rolsuper=false, rolbypassrls=true)
--   • create_booking_with_intent(uuid,text,text): SECURITY DEFINER,
--     owner=postgres, search_path = pg_catalog, public, pg_temp
--     ⇒ la RPC NO pasa por RLS (owner con BYPASSRLS y, además, FORCE
--       apagado con owner de función = owner de tabla). Endurecer la
--       policy de INSERT no la afecta. La migración RE-VERIFICA este
--       estado exacto y aborta si difiere.
--   • policies que habilitan INSERT: 1 permisiva (appointments_insert),
--     0 restrictivas, 0 FOR ALL ⇒ cerrar esa policy cierra el bypass.
--     (Las policies permisivas se combinan con OR: si hubiera una
--      segunda, este cierre sería inútil. De ahí la precondición.)
--   • is_clinic_member(uuid) = miembro ACTIVO de clinic_members, SIN
--     distinción de rol ⇒ médico Y asistente conservan el walk-in.
--
-- ── QUÉ HACE ──
--   1. appointments_insert pasa de
--        is_clinic_member(clinic_id)
--        OR (patient_id IN (mis patients) AND source='lucy_directorio')
--      a
--        is_clinic_member(clinic_id)
--      y se acota a `authenticated` (antes PUBLIC).
--   2. REVOKE INSERT ON appointments FROM anon (grant legacy del schema
--      inicial; la RLS ya lo neutralizaba, esto quita el privilegio).
--
-- ── QUÉ NO TOCA (alcance aprobado por el owner) ──
--   DELETE · TRUNCATE · UPDATE · REFERENCES · TRIGGER · MAINTAIN ·
--   is_clinic_member · appointments_select · appointments_self_select ·
--   appointments_update · triggers (s6_03/s6_04/s6_10/s7_09/s7_55 siguen
--   como red final) · service_role · datos · esquema · frontend.
--   El endurecimiento general de grants de `appointments` es frente aparte.
--
-- ── SEGURIDAD DEL APPLY ──
--   Bajo LOCK TABLE ACCESS EXCLUSIVE (validación + sustitución + revoke en
--   el MISMO bloqueo). PRECONDICIONES que exigen el estado EXACTO del
--   preflight (policy por igualdad canónica de su WITH CHECK, cmd/permisiva/
--   roles; premisa real del bypass por owners/FORCE/BYPASSRLS) y
--   POSTCONDICIONES por igualdad canónica ANTES del COMMIT. Cualquier drift
--   → RAISE EXCEPTION revierte todo: imposible quedar en estado parcial.
--   El DROP de la policy es fail-closed (sin IF EXISTS): su ausencia aborta.
--
-- ── ROLLBACK / QA ──
--   El rollback literal y el instrumental de verificación (check/smoke/
--   ledger/cleanup/fixture) se preservan en el HANDOFF EXTERNO del frente,
--   FUERA de este repositorio. No forman parte del árbol versionado.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- Serializa contra cualquier escritura/validación concurrente sobre la tabla:
-- toda la migración (precondiciones, sustitución de policy, revoke,
-- postcondiciones) ocurre bajo el MISMO bloqueo.
LOCK TABLE public.appointments IN ACCESS EXCLUSIVE MODE;

-- ─── 1. PRECONDICIONES ────────────────────────────────────────────────
DO $pre$
DECLARE
  v_rls          boolean;
  v_named        int;
  v_perm_insert  int;
  v_perm_names   text;
  v_restr_insert int;
  v_pol_cmd      "char";
  v_pol_perm     boolean;
  v_pol_roles    oid[];
  v_check        text;
  v_rpc_oid      regprocedure;
  v_rpc_count    int;
  v_definer      boolean;
  v_tbl_owner    oid;
  v_fn_owner     oid;
  v_tbl_owner_nm text;
  v_fn_owner_nm  text;
  v_force        boolean;
  v_super        boolean;
  v_bypass       boolean;
  -- WITH CHECK canónico capturado por pg_get_expr en el preflight (2026-07-24).
  v_expected     text :=
    '(is_clinic_member(clinic_id) OR ((patient_id IN ( SELECT p.id FROM patients p WHERE (p.profile_id = auth.uid()))) AND (source = ''lucy_directorio''::appointment_source)))';
BEGIN
  -- 1.1 RLS activa en la tabla.
  SELECT c.relrowsecurity INTO v_rls
  FROM pg_class c WHERE c.oid = 'public.appointments'::regclass;
  IF v_rls IS NOT TRUE THEN
    RAISE EXCEPTION 's7_67 PRE: RLS no está activa en public.appointments (relrowsecurity=%)', v_rls;
  END IF;

  -- 1.2 Panorama de policies que habilitan INSERT (cmd 'a' o '*'):
  --     debe haber EXACTAMENTE una permisiva y ser appointments_insert,
  --     y CERO restrictivas.
  SELECT count(*), coalesce(string_agg(p.polname, ', ' ORDER BY p.polname), '')
    INTO v_perm_insert, v_perm_names
  FROM pg_policy p
  WHERE p.polrelid = 'public.appointments'::regclass
    AND p.polcmd IN ('a', '*') AND p.polpermissive;
  IF v_perm_insert <> 1 THEN
    RAISE EXCEPTION 's7_67 PRE: se esperaba 1 policy permisiva que habilite INSERT; hay % (%)',
      v_perm_insert, v_perm_names;
  END IF;
  IF v_perm_names <> 'appointments_insert' THEN
    RAISE EXCEPTION 's7_67 PRE: la única policy permisiva de INSERT no es appointments_insert (es "%")',
      v_perm_names;
  END IF;
  SELECT count(*) INTO v_restr_insert
  FROM pg_policy p
  WHERE p.polrelid = 'public.appointments'::regclass
    AND p.polcmd IN ('a', '*') AND NOT p.polpermissive;
  IF v_restr_insert <> 0 THEN
    RAISE EXCEPTION 's7_67 PRE: existen % policies RESTRICTIVAS que afectan INSERT; el cierre debe rediseñarse',
      v_restr_insert;
  END IF;

  -- 1.3 appointments_insert existe EXACTAMENTE una vez y su forma es la
  --     original EXACTA: FOR INSERT (cmd 'a'), permisiva, roles = {PUBLIC}.
  SELECT count(*) INTO v_named
  FROM pg_policy p
  WHERE p.polrelid = 'public.appointments'::regclass AND p.polname = 'appointments_insert';
  IF v_named <> 1 THEN
    RAISE EXCEPTION 's7_67 PRE: appointments_insert existe % veces (se esperaba exactamente 1)', v_named;
  END IF;
  SELECT p.polcmd, p.polpermissive, p.polroles, pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_pol_cmd, v_pol_perm, v_pol_roles, v_check
  FROM pg_policy p
  WHERE p.polrelid = 'public.appointments'::regclass AND p.polname = 'appointments_insert';
  IF v_pol_cmd <> 'a' THEN
    RAISE EXCEPTION 's7_67 PRE: appointments_insert no es FOR INSERT (polcmd=%; se esperaba a)', v_pol_cmd;
  END IF;
  IF v_pol_perm IS NOT TRUE THEN
    RAISE EXCEPTION 's7_67 PRE: appointments_insert no es PERMISSIVE';
  END IF;
  IF v_pol_roles IS DISTINCT FROM ARRAY[0::oid] THEN
    RAISE EXCEPTION 's7_67 PRE: appointments_insert no aplica exactamente a PUBLIC (polroles=%)', v_pol_roles;
  END IF;

  -- 1.4 WITH CHECK por IGUALDAD CANÓNICA con el capturado en el preflight.
  --     Normalización permitida: espacios/saltos + prefijo `public.`.
  --     Cualquier cláusula extra o faltante (p.ej. "... OR true") aborta.
  IF v_check IS NULL THEN
    RAISE EXCEPTION 's7_67 PRE: appointments_insert no tiene WITH CHECK';
  END IF;
  IF replace(regexp_replace(v_check,    '\s', '', 'g'), 'public.', '')
   <> replace(regexp_replace(v_expected,'\s', '', 'g'), 'public.', '') THEN
    RAISE EXCEPTION 's7_67 PRE: el WITH CHECK NO coincide (igualdad canónica) con el capturado en el preflight. Actual: %', v_check;
  END IF;

  -- 1.5 Privilegios de partida.
  IF NOT has_table_privilege('anon', 'public.appointments', 'INSERT') THEN
    RAISE EXCEPTION 's7_67 PRE: anon ya no tiene INSERT efectivo sobre appointments (¿migración ya aplicada?)';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.appointments', 'INSERT') THEN
    RAISE EXCEPTION 's7_67 PRE: authenticated NO tiene INSERT efectivo; el walk-in del panel se rompería';
  END IF;

  -- 1.6 La RPC del camino único: FIRMA EXACTA + sin sobrecargas + DEFINER +
  --     PREMISA REAL del bypass (owners/FORCE/BYPASSRLS), no solo prosecdef.
  v_rpc_oid := to_regprocedure('public.create_booking_with_intent(uuid, text, text)');
  IF v_rpc_oid IS NULL THEN
    RAISE EXCEPTION 's7_67 PRE: no existe public.create_booking_with_intent(uuid, text, text) — firma esperada ausente';
  END IF;
  SELECT count(*) INTO v_rpc_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_booking_with_intent';
  IF v_rpc_count <> 1 THEN
    RAISE EXCEPTION 's7_67 PRE: create_booking_with_intent tiene % definiciones (se esperaba exactamente 1) — ambigüedad/sobrecarga', v_rpc_count;
  END IF;
  SELECT p.prosecdef, p.proowner INTO v_definer, v_fn_owner FROM pg_proc p WHERE p.oid = v_rpc_oid;
  IF v_definer IS NOT TRUE THEN
    RAISE EXCEPTION 's7_67 PRE: create_booking_with_intent(uuid,text,text) no es SECURITY DEFINER (prosecdef=%)', v_definer;
  END IF;
  SELECT c.relowner, c.relforcerowsecurity INTO v_tbl_owner, v_force
  FROM pg_class c WHERE c.oid = 'public.appointments'::regclass;
  v_tbl_owner_nm := pg_get_userbyid(v_tbl_owner);
  v_fn_owner_nm  := pg_get_userbyid(v_fn_owner);
  SELECT r.rolsuper, r.rolbypassrls INTO v_super, v_bypass FROM pg_roles r WHERE r.oid = v_fn_owner;

  -- 1.6a La RPC DEBE poder esquivar la RLS, o cerrar la policy la bloquearía:
  --   owner de la función es superuser · O tiene BYPASSRLS · O
  --   owner de la función = owner de la tabla y FORCE RLS apagado.
  IF NOT (v_super OR v_bypass OR (v_fn_owner = v_tbl_owner AND NOT v_force)) THEN
    RAISE EXCEPTION 's7_67 PRE: la RPC NO puede bypassar la RLS (fn_owner=%, super=%, bypassrls=%, tbl_owner=%, force=%) — cerrar la policy bloquearía el camino único',
      v_fn_owner_nm, v_super, v_bypass, v_tbl_owner_nm, v_force;
  END IF;

  -- 1.6b Además, el estado EXACTO capturado por el preflight (drift → abortar).
  IF v_tbl_owner_nm <> 'postgres' OR v_fn_owner_nm <> 'postgres'
     OR v_bypass IS NOT TRUE OR v_force IS NOT FALSE THEN
    RAISE EXCEPTION 's7_67 PRE: drift del estado del preflight (tbl_owner=%, fn_owner=%, rolbypassrls=%, relforcerowsecurity=%)',
      v_tbl_owner_nm, v_fn_owner_nm, v_bypass, v_force;
  END IF;

  RAISE NOTICE 's7_67 PRE: todas las precondiciones OK.';
END
$pre$;

-- ─── 2. CIERRE DEL BYPASS ─────────────────────────────────────────────
-- El INSERT directo queda reservado a miembros ACTIVOS de la clínica.
-- Se elimina la rama de paciente: es exactamente el camino que explotaba
-- `createBooking`, sin consumidores desde PR #301 (BookingCard usa las RPC).
-- DROP fail-closed (sin IF EXISTS): si la policy no existiera, aborta.
DROP POLICY "appointments_insert" ON public.appointments;
CREATE POLICY "appointments_insert" ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_clinic_member(clinic_id));

-- ─── 3. RETIRO DEL PRIVILEGIO LEGACY DE anon ──────────────────────────
-- NO se revoca a PUBLIC: relacl no tiene entrada para PUBLIC (sería no-op).
-- NO se revoca a authenticated: el walk-in del panel lo necesita.
REVOKE INSERT ON TABLE public.appointments FROM anon;

-- ─── 4. POSTCONDICIONES (antes del COMMIT) ────────────────────────────
DO $post$
DECLARE
  v_perm_insert int;
  v_name        text;
  v_pol_cmd     "char";
  v_pol_perm    boolean;
  v_roles       oid[];
  v_check       text;
  v_rpc_oid     regprocedure;
  v_rpc_count   int;
  v_definer     boolean;
  v_tbl_owner   oid;
  v_fn_owner    oid;
  v_force       boolean;
  v_super       boolean;
  v_bypass      boolean;
  -- WITH CHECK esperado tras la migración.
  v_expected    text := 'public.is_clinic_member(clinic_id)';
BEGIN
  -- 4.1 Sigue habiendo exactamente UNA policy permisiva de INSERT, y es la nuestra.
  SELECT count(*), coalesce(string_agg(p.polname, ', ' ORDER BY p.polname), '')
    INTO v_perm_insert, v_name
  FROM pg_policy p
  WHERE p.polrelid = 'public.appointments'::regclass
    AND p.polcmd IN ('a', '*') AND p.polpermissive;
  IF v_perm_insert <> 1 OR v_name <> 'appointments_insert' THEN
    RAISE EXCEPTION 's7_67 POST: se esperaba 1 policy permisiva "appointments_insert"; hay % (%)',
      v_perm_insert, v_name;
  END IF;

  -- 4.2 Forma EXACTA: FOR INSERT, permisiva, roles = {authenticated}.
  SELECT p.polcmd, p.polpermissive, p.polroles, pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_pol_cmd, v_pol_perm, v_roles, v_check
  FROM pg_policy p
  WHERE p.polrelid = 'public.appointments'::regclass AND p.polname = 'appointments_insert';
  IF v_pol_cmd <> 'a' THEN
    RAISE EXCEPTION 's7_67 POST: appointments_insert no quedó FOR INSERT (polcmd=%)', v_pol_cmd;
  END IF;
  IF v_pol_perm IS NOT TRUE THEN
    RAISE EXCEPTION 's7_67 POST: appointments_insert no quedó PERMISSIVE';
  END IF;
  IF v_roles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid] THEN
    RAISE EXCEPTION 's7_67 POST: la policy no aplica únicamente a authenticated (polroles=%)',
      (SELECT coalesce(string_agg(r.rolname, ','), '{}') FROM pg_roles r WHERE r.oid = ANY(v_roles));
  END IF;

  -- 4.3 WITH CHECK por IGUALDAD CANÓNICA = solo is_clinic_member(clinic_id).
  --     (Rechaza "is_clinic_member(clinic_id) OR true" y cualquier extra.)
  IF v_check IS NULL THEN
    RAISE EXCEPTION 's7_67 POST: appointments_insert no tiene WITH CHECK';
  END IF;
  IF replace(regexp_replace(v_check,    '\s', '', 'g'), 'public.', '')
   <> replace(regexp_replace(v_expected,'\s', '', 'g'), 'public.', '') THEN
    RAISE EXCEPTION 's7_67 POST: el WITH CHECK NO es exactamente is_clinic_member(clinic_id). Actual: %', v_check;
  END IF;

  -- 4.4 Privilegios resultantes.
  IF has_table_privilege('anon', 'public.appointments', 'INSERT') THEN
    RAISE EXCEPTION 's7_67 POST: anon conserva INSERT efectivo sobre appointments';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.appointments', 'INSERT') THEN
    RAISE EXCEPTION 's7_67 POST: authenticated PERDIÓ INSERT efectivo; el walk-in quedaría roto';
  END IF;

  -- 4.5 La RPC del camino único sigue intacta (firma exacta, DEFINER) y su
  --     premisa de bypass sigue en pie (nada de esto debió cambiar).
  v_rpc_oid := to_regprocedure('public.create_booking_with_intent(uuid, text, text)');
  IF v_rpc_oid IS NULL THEN
    RAISE EXCEPTION 's7_67 POST: desapareció public.create_booking_with_intent(uuid, text, text)';
  END IF;
  SELECT count(*) INTO v_rpc_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_booking_with_intent';
  IF v_rpc_count <> 1 THEN
    RAISE EXCEPTION 's7_67 POST: create_booking_with_intent tiene % definiciones (se esperaba 1)', v_rpc_count;
  END IF;
  SELECT p.prosecdef, p.proowner INTO v_definer, v_fn_owner FROM pg_proc p WHERE p.oid = v_rpc_oid;
  IF v_definer IS NOT TRUE THEN
    RAISE EXCEPTION 's7_67 POST: create_booking_with_intent(uuid,text,text) dejó de ser SECURITY DEFINER';
  END IF;
  SELECT c.relowner, c.relforcerowsecurity INTO v_tbl_owner, v_force
  FROM pg_class c WHERE c.oid = 'public.appointments'::regclass;
  SELECT r.rolsuper, r.rolbypassrls INTO v_super, v_bypass FROM pg_roles r WHERE r.oid = v_fn_owner;
  IF NOT (v_super OR v_bypass OR (v_fn_owner = v_tbl_owner AND NOT v_force)) THEN
    RAISE EXCEPTION 's7_67 POST: la RPC ya no puede bypassar la RLS (super=%, bypassrls=%, mismo_owner=%, force=%)',
      v_super, v_bypass, (v_fn_owner = v_tbl_owner), v_force;
  END IF;

  RAISE NOTICE 's7_67 POST: todas las postcondiciones OK. Bypass cerrado.';
END
$post$;

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- ORDEN DEL FRENTE: A (s7_66, additive) ✅ → B (frontend, PR #301) ✅
--   → C (esta). Con s7_67 el INSERT directo de pacientes queda cerrado.
-- La verificación (check estático/runtime, smoke A/B before-after, ledger,
-- cleanup, fixture de asistente) y el rollback literal viven en el HANDOFF
-- EXTERNO del frente, fuera de este repositorio.
-- ═══════════════════════════════════════════════════════════
