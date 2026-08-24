-- ═══════════════════════════════════════════════════════════
-- Migración S7-74: SEEDOPS-POLICY-HARDENING
-- ═══════════════════════════════════════════════════════════
-- Defensa en profundidad sobre la ÚNICA policy de
-- `public.admin_seed_operations`. NO cierra un agujero abierto: cierra uno
-- que hoy no lo está, por dos barreras independientes, antes de que un
-- cambio futuro pueda abrirlo.
--
-- ── CAUSA EXACTA ──
-- `s7_73` creó la policy SIN cláusula `TO`:
--
--     CREATE POLICY seedops_select_admin ON public.admin_seed_operations
--       FOR SELECT USING (public.is_admin());
--
-- En PostgreSQL, omitir `TO` equivale a `TO PUBLIC`. Verificado en catálogo
-- (2026-08-23): la policy quedó live con `roles={public}`, no
-- `{authenticated}` como fijaba el diseño.
--
-- ── POR QUÉ NO HUBO EXPOSICIÓN ──
--   1. Una policy solo se evalúa DESPUÉS de los privilegios de tabla, y
--      `anon` tiene REVOKE ALL: nunca llega a evaluarla.
--   2. Aunque llegara, el USING exige `is_admin()`, que para `anon` es false
--      porque `auth.uid()` es NULL.
-- Dos barreras independientes. Esto es higiene, no un incidente.
--
-- ── QUÉ HACE ──
-- Una sola instrucción: ALTER POLICY ... TO authenticated.
-- Se prefiere ALTER POLICY sobre DROP + CREATE porque conserva la policy: no
-- existe ni un instante sin protección. Tampoco reescribe la expresión
-- USING, que se deja intacta a propósito.
--
-- ── QUÉ NO HACE ──
--   · NO modifica `s7_73`, que ya está aplicada en producción.
--   · NO toca la tabla, sus columnas, índices ni constraints.
--   · NO toca ninguna de las 6 RPCs ni el helper.
--   · NO toca Auth, `auth.users` ni ningún dato.
--   · NO toca privilegios de `service_role`. Que `service_role` tenga
--     EXECUTE sobre las RPCs y DML sobre la tabla es COMPORTAMIENTO POR
--     DEFECTO DE LA PLATAFORMA Supabase (ALTER DEFAULT PRIVILEGES en el
--     schema `public`), no un defecto de `s7_73`. La protección real es
--     otra: la secret key vive confinada en la Edge Function, la Edge NO
--     hace RPCs de negocio con ella, las RPCs exigen `is_admin()`, y usar
--     service_role NO convierte `auth.uid()` en un admin.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── Guardas PRE (abortan la transacción completa) ──────────
DO $$
DECLARE
  v_roles oid[];
  v_qual  text;
  v_check text;
  v_cmd   "char";
  v_n     integer;
  v_rows  bigint;
BEGIN
  IF to_regclass('public.admin_seed_operations') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: admin_seed_operations no existe (s7_73 sin aplicar?)';
  END IF;
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: is_admin() no existe';
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_policy
   WHERE polrelid = 'public.admin_seed_operations'::regclass;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PRE fallo: se esperaba exactamente 1 policy, hay %', v_n;
  END IF;

  SELECT p.polroles,
         pg_get_expr(p.polqual, p.polrelid),
         pg_get_expr(p.polwithcheck, p.polrelid),
         p.polcmd
    INTO v_roles, v_qual, v_check, v_cmd
    FROM pg_policy p
   WHERE p.polrelid = 'public.admin_seed_operations'::regclass
     AND p.polname  = 'seedops_select_admin';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: no existe la policy seedops_select_admin';
  END IF;
  IF v_cmd <> 'r' THEN
    RAISE EXCEPTION 'PRE fallo: la policy no es FOR SELECT (polcmd=%)', v_cmd;
  END IF;
  IF v_qual NOT LIKE '%is_admin()%' THEN
    RAISE EXCEPTION 'PRE fallo: USING inesperado: %', v_qual;
  END IF;
  IF v_check IS NOT NULL THEN
    RAISE EXCEPTION 'PRE fallo: la policy tiene WITH CHECK inesperado: %', v_check;
  END IF;

  -- Estados admitidos: {public} (lo que dejo s7_73) o ya {authenticated}
  -- (re-aplicacion idempotente). Cualquier otro exige revision humana.
  IF NOT (v_roles = ARRAY[0::oid]
          OR v_roles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]) THEN
    RAISE EXCEPTION 'PRE fallo: roles inesperados en la policy: %', v_roles;
  END IF;

  -- Se memoriza el conteo para probar en POST que NINGUN dato cambio.
  SELECT count(*) INTO v_rows FROM public.admin_seed_operations;
  PERFORM set_config('lucy.s7_74_rows', v_rows::text, true);
END $$;

-- ─── Cambio único ──────────────────────────────────────────
ALTER POLICY seedops_select_admin
  ON public.admin_seed_operations
  TO authenticated;

-- ─── Guardas POST ──────────────────────────────────────────
DO $$
DECLARE
  v_roles oid[];
  v_qual  text;
  v_check text;
  v_cmd   "char";
  v_n     integer;
  v_rows  bigint;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_policy
   WHERE polrelid = 'public.admin_seed_operations'::regclass;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'POST fallo: la tabla quedo con % policies', v_n;
  END IF;

  SELECT p.polroles,
         pg_get_expr(p.polqual, p.polrelid),
         pg_get_expr(p.polwithcheck, p.polrelid),
         p.polcmd
    INTO v_roles, v_qual, v_check, v_cmd
    FROM pg_policy p
   WHERE p.polrelid = 'public.admin_seed_operations'::regclass
     AND p.polname  = 'seedops_select_admin';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'POST fallo: desaparecio la policy seedops_select_admin';
  END IF;
  IF v_roles <> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')] THEN
    RAISE EXCEPTION 'POST fallo: la policy no quedo en TO authenticated';
  END IF;
  IF v_cmd <> 'r' THEN
    RAISE EXCEPTION 'POST fallo: la policy dejo de ser FOR SELECT';
  END IF;
  IF v_qual NOT LIKE '%is_admin()%' THEN
    RAISE EXCEPTION 'POST fallo: se altero el USING: %', v_qual;
  END IF;
  IF v_check IS NOT NULL THEN
    RAISE EXCEPTION 'POST fallo: aparecio un WITH CHECK: %', v_check;
  END IF;

  -- RLS sigue activa.
  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.admin_seed_operations'::regclass) THEN
    RAISE EXCEPTION 'POST fallo: RLS dejo de estar activa';
  END IF;

  -- Privilegios de tabla intactos.
  IF NOT has_table_privilege('authenticated', 'public.admin_seed_operations', 'SELECT') THEN
    RAISE EXCEPTION 'POST fallo: authenticated perdio SELECT';
  END IF;
  IF has_table_privilege('authenticated', 'public.admin_seed_operations', 'INSERT')
  OR has_table_privilege('authenticated', 'public.admin_seed_operations', 'UPDATE')
  OR has_table_privilege('authenticated', 'public.admin_seed_operations', 'DELETE') THEN
    RAISE EXCEPTION 'POST fallo: authenticated gano DML';
  END IF;
  IF has_table_privilege('anon', 'public.admin_seed_operations', 'SELECT')
  OR has_table_privilege('anon', 'public.admin_seed_operations', 'INSERT')
  OR has_table_privilege('anon', 'public.admin_seed_operations', 'UPDATE')
  OR has_table_privilege('anon', 'public.admin_seed_operations', 'DELETE') THEN
    RAISE EXCEPTION 'POST fallo: anon gano privilegios';
  END IF;

  -- Ningun dato cambio.
  SELECT count(*) INTO v_rows FROM public.admin_seed_operations;
  IF v_rows <> current_setting('lucy.s7_74_rows', true)::bigint THEN
    RAISE EXCEPTION 'POST fallo: cambio el numero de filas (% -> %)',
      current_setting('lucy.s7_74_rows', true), v_rows;
  END IF;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- Rollback: docs/rollbacks/s7_74_rollback.sql
-- ═══════════════════════════════════════════════════════════
