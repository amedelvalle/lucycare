BEGIN;

-- ═══ PREFLIGHT: aborta si el estado base no es el medido en Fase A ═══
DO $pre$
DECLARE v_bad int; v_n int;
BEGIN
  IF to_regclass('public.audit_log') IS NULL THEN
    RAISE EXCEPTION 's7_71b PRE: falta public.audit_log';
  END IF;
  IF to_regclass('public.audit_log_id_seq') IS NULL THEN
    RAISE EXCEPTION 's7_71b PRE: falta la secuencia audit_log_id_seq';
  END IF;
  IF to_regprocedure('public._admin_log_doctor_change(uuid,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 's7_71b PRE: falta _admin_log_doctor_change';
  END IF;

  -- RLS habilitado: sin él, quitar la policy no cierra nada
  IF NOT EXISTS (SELECT 1 FROM pg_class
                 WHERE oid='public.audit_log'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 's7_71b PRE: RLS no habilitado en audit_log';
  END IF;

  -- el owner debe seguir auditando con CERO policies
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
                 WHERE c.oid='public.audit_log'::regclass AND r.rolbypassrls) THEN
    RAISE EXCEPTION 's7_71b PRE: el owner de audit_log no tiene BYPASSRLS';
  END IF;

  -- estado base: exactamente la policy permisiva medida
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname='public' AND tablename='audit_log';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_71b PRE: se esperaba 1 policy en audit_log, hay %', v_n;
  END IF;

  -- NINGÚN escritor puede ser INVOKER: perdería la auditoría al revocar
  -- (prokind='f' + OFFSET 0: pg_get_functiondef falla sobre agregados)
  SELECT count(*) INTO v_bad
  FROM (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prokind='f' AND NOT p.prosecdef
        OFFSET 0) c
  WHERE pg_get_functiondef(c.oid) ILIKE '%INSERT INTO%audit_log%';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 's7_71b PRE: % escritor(es) de audit_log son SECURITY INVOKER', v_bad;
  END IF;

  -- NINGÚN escritor con owner sin BYPASSRLS
  SELECT count(*) INTO v_bad
  FROM (SELECT c.oid, c.proowner
        FROM (SELECT p.oid, p.proowner FROM pg_proc p
              JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.prokind='f'
              OFFSET 0) c
        WHERE pg_get_functiondef(c.oid) ILIKE '%INSERT INTO%audit_log%') w
  JOIN pg_roles r ON r.oid = w.proowner
  WHERE NOT r.rolbypassrls;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 's7_71b PRE: % escritor(es) con owner sin BYPASSRLS', v_bad;
  END IF;

  -- TODO llamador del helper debe ser DEFINER (protege el paso 5)
  SELECT count(*) INTO v_bad
  FROM (SELECT p.oid, p.prosecdef FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prokind='f'
          AND p.proname <> '_admin_log_doctor_change'
        OFFSET 0) c
  WHERE NOT c.prosecdef
    AND pg_get_functiondef(c.oid) ILIKE '%_admin_log_doctor_change%';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 's7_71b PRE: % llamador(es) de _admin_log_doctor_change son INVOKER', v_bad;
  END IF;
END $pre$;

-- ═══ 1. Cerrar la tabla para los roles de cliente ═══
REVOKE ALL ON TABLE public.audit_log FROM PUBLIC;
REVOKE ALL ON TABLE public.audit_log FROM anon;
REVOKE ALL ON TABLE public.audit_log FROM authenticated;

-- ═══ 2. service_role: SOLO SELECT ═══
REVOKE ALL ON TABLE public.audit_log FROM service_role;
GRANT  SELECT ON TABLE public.audit_log TO service_role;

-- ═══ 3. Secuencia: sin privilegios para cliente ni service_role ═══
REVOKE ALL ON SEQUENCE public.audit_log_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.audit_log_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.audit_log_id_seq FROM authenticated;
REVOKE ALL ON SEQUENCE public.audit_log_id_seq FROM service_role;

-- ═══ 4. Eliminar la ÚNICA policy permisiva. NO se crea ninguna. ═══
DROP POLICY IF EXISTS audit_log_insert_only ON public.audit_log;

-- ═══ 5. _admin_log_doctor_change deja de ser superficie invocable ═══
--     Revocar a PUBLIC NO basta: hay grants explícitos a los tres roles.
REVOKE ALL ON FUNCTION public._admin_log_doctor_change(uuid,text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._admin_log_doctor_change(uuid,text,jsonb,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public._admin_log_doctor_change(uuid,text,jsonb,jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public._admin_log_doctor_change(uuid,text,jsonb,jsonb) FROM service_role;

COMMIT;

-- Fuera de la transacción: refrescar el caché de esquema de PostgREST
NOTIFY pgrst, 'reload schema';
