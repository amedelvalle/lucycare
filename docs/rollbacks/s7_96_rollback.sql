-- ============================================================
-- ROLLBACK de s7_96 · MULTICOUNTRY-GEO-P0 · F3E-1
-- Retira las dos RPC de lectura del catalogo territorial:
-- public.directory_countries() y public.directory_territory_units(text, bigint).
-- ============================================================
--
-- ⛔ NO EJECUTAR SIN ORDEN EXPLICITA DEL OWNER.
--
-- ⛔ ANTES: revertir el frontend de F3E-2 si ya consume estas RPC. Un consumidor
-- de frontend NO es detectable desde la base: este archivo no puede comprobarlo.
--
-- ── ORDEN VIGENTE Y BLOQUEANTE ──
--   revertir frontend F3E-2 -> rollback de s7_96 -> s7_95 -> s7_94 -> s7_93 R2
--   -> verificar estado -> s7_92.
-- Mientras s7_96 este aplicada, los rollbacks de s7_92, s7_93 y s7_95 detectan
-- estas funciones como consumidores y se niegan. Este archivo es el PRIMER paso
-- de la cadena y no la ejecuta entera. Los rollbacks historicos no se modifican.
--
-- ── VALIDO SOLO MIENTRAS ──
--   · las dos funciones sigan EXACTAMENTE como las dejo s7_96 (firma, retorno,
--     cuerpo por md5, SECURITY DEFINER, STABLE, search_path, dueño y ACL);
--   · ningun objeto de la base dependa de ellas (vistas, funciones que las
--     nombren, policies).
-- Si alguna condicion falla, se niega sin tocar nada y hay que reevaluar.
--
-- ── QUE HACE ──
--   BEGIN (REPEATABLE READ) -> lock_timeout 5s -> PREVIA (validez + instantanea)
--   -> RETIRO (DROP FUNCTION ensamblado, RESTRICT) -> VERIFICA (ausentes, sin
--   consumidores del modelo, nada mas cambio) -> COMMIT.
-- No toca datos, tablas, RLS, policies, grants de tablas ni roles.
--
-- ── REGLA DEL SQL EDITOR ──
-- Las funciones retiradas no existiran al terminar: la orden de retiro se ensambla
-- con format() y el texto del archivo no nombra la funcion junto a esa orden.
--
-- Pegar ENTERO en una pestaña nueva. Ante cualquier error del editor, clasificar
-- primero el estado con docs/smokes/s7_96_state_readonly.sql.

BEGIN ISOLATION LEVEL REPEATABLE READ;

SET LOCAL lock_timeout = '5s';


DO $PREVIA$
DECLARE
  v_acl           CONSTANT text := 'anon=X/postgres,authenticated=X/postgres,postgres=X/postgres';
  v_md5_countries CONSTANT text[] := ARRAY['1804439ffc598fa98321da2bf28eec08', 'cf27c8ed4ba4d97f13f99894b7057596'];
  v_md5_units     CONSTANT text[] := ARRAY['3083c7c5ad5a790c044e89bd7d554afc', '243b51249cb406b28b90fe5087387229'];
  v_txt text;
  v_n   bigint;
  k     text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'rollback s7_96: debe ejecutarse como postgres, no como %', current_user;
  END IF;

  -- Exactamente las dos funciones de s7_96, sin alterar.
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('directory_countries', 'directory_territory_units');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'rollback s7_96: se esperaban 2 funciones directory_*, hay % — clasificar con el ESTADO, no se revierte', v_n;
  END IF;
  SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
                    || ' vol=' || p.provolatile::text || ' def=' || p.prosecdef || ' lang=' || l.lanname
                    || ' cfg=' || coalesce(p.proconfig::text, '') || ' owner=' || pg_get_userbyid(p.proowner)
                    || ' args=' || pg_get_function_arguments(p.oid), E'\n' ORDER BY p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('directory_countries', 'directory_territory_units');
  IF v_txt IS DISTINCT FROM
       'directory_countries() TABLE(country_id smallint, iso_alpha2 text, country_name text, level smallint, level_label text) vol=s def=true lang=sql cfg={"search_path=public, pg_temp"} owner=postgres args=' || E'\n'
    || 'directory_territory_units(p_country_iso text, p_parent_id bigint) TABLE(id bigint, name text, level smallint, parent_id bigint) vol=s def=true lang=plpgsql cfg={"search_path=public, pg_temp"} owner=postgres args=p_country_iso text, p_parent_id bigint DEFAULT NULL::bigint' THEN
    RAISE EXCEPTION 'rollback s7_96: las funciones no tienen la forma de s7_96 (%) — no se revierte', v_txt;
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.directory_countries()'::regprocedure) <> ALL (v_md5_countries)
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.directory_territory_units(text, bigint)'::regprocedure) <> ALL (v_md5_units) THEN
    RAISE EXCEPTION 'rollback s7_96: el cuerpo de alguna funcion cambio despues de s7_96 — no se revierte';
  END IF;
  FOR k IN SELECT unnest(ARRAY['public.directory_countries()', 'public.directory_territory_units(text, bigint)']) LOOP
    SELECT string_agg(a::text, ',' ORDER BY a::text) INTO v_txt FROM pg_proc p, unnest(p.proacl) a WHERE p.oid = k::regprocedure;
    IF v_txt IS DISTINCT FROM v_acl THEN
      RAISE EXCEPTION 'rollback s7_96: la ACL de % cambio despues de s7_96 (%) — no se revierte', k, v_txt;
    END IF;
  END LOOP;

  -- Sin dependientes en la base.
  SELECT count(*) INTO v_n FROM pg_depend d
   WHERE d.refclassid = 'pg_proc'::regclass
     AND d.refobjid IN ('public.directory_countries()'::regprocedure, 'public.directory_territory_units(text, bigint)'::regprocedure)
     AND d.deptype <> 'i';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'rollback s7_96: % objetos dependen de las RPC — el rollback ya no es valido', v_n;
  END IF;
  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.proname NOT IN ('directory_countries', 'directory_territory_units')
     AND p.prosrc ~ '\m(directory_countries|directory_territory_units)\M';
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'rollback s7_96: hay funciones que usan las RPC (%) — el rollback ya no es valido', v_txt;
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '\m(directory_countries|directory_territory_units)\M';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'rollback s7_96: % policies usan las RPC — el rollback ya no es valido', v_n;
  END IF;

  PERFORM set_config('s7_96rb.snap', (
    -- instantanea:ini
    SELECT jsonb_build_object(
      'policies', (SELECT md5(coalesce(string_agg(schemaname || '.' || tablename || ':' || policyname || ':' || permissive || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), E'\n' ORDER BY schemaname, tablename, policyname), '')) FROM pg_policies),
      'relaciones', (SELECT md5(coalesce(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, 'NULL') || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity || ':' || pg_get_userbyid(c.relowner), E'\n' ORDER BY n.nspname, c.relname), ''))
                       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname NOT LIKE 'pg_temp%' AND n.nspname NOT LIKE 'pg_toast_temp%'),
      'columnas', (SELECT md5(coalesce(string_agg(a.attrelid::regclass::text || '.' || a.attname || ':' || a.attacl::text, E'\n' ORDER BY a.attrelid::regclass::text, a.attname), ''))
                     FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE a.attacl IS NOT NULL AND n.nspname NOT IN ('pg_catalog', 'information_schema')),
      'funciones', (SELECT md5(coalesce(string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, 'NULL') || ':' || p.prosecdef || ':' || coalesce(p.proconfig::text, '') || ':' || pg_get_userbyid(p.proowner), E'\n' ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), ''))
                      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('directory_countries', 'directory_territory_units')),
      'triggers', (SELECT md5(coalesce(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), E'\n' ORDER BY t.tgrelid::regclass::text, t.tgname), '')) FROM pg_trigger t WHERE NOT t.tgisinternal),
      'default_acl', (SELECT md5(coalesce(string_agg(pg_get_userbyid(defaclrole) || ':' || defaclnamespace || ':' || defaclobjtype::text || ':' || defaclacl::text, E'\n' ORDER BY pg_get_userbyid(defaclrole), defaclnamespace, defaclobjtype), '')) FROM pg_default_acl),
      'roles', (SELECT md5(coalesce(string_agg(r.rolname || ':' || r.rolsuper || r.rolinherit || r.rolcreaterole || r.rolcreatedb || r.rolcanlogin || r.rolreplication || r.rolbypassrls, E'\n' ORDER BY r.rolname), '')) FROM pg_roles r),
      'membresias', (SELECT md5(coalesce(string_agg(m.roleid::regrole::text || '>' || m.member::regrole::text || ':' || m.admin_option, E'\n' ORDER BY m.roleid::regrole::text, m.member::regrole::text), '')) FROM pg_auth_members m),
      'esquemas', (SELECT md5(coalesce(string_agg(nspname || ':' || coalesce(nspacl::text, 'NULL') || ':' || pg_get_userbyid(nspowner), E'\n' ORDER BY nspname), '')) FROM pg_namespace),
      'catalogo_geo', (SELECT md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.countries x), '') || '#'
                              || coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.country_id, x.level) FROM public.country_levels x), '') || '#'
                              || coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.administrative_units x), '') || '#'
                              || (SELECT count(*) FROM public.administrative_unit_closure)::text)),
      'clinics_c2', (SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
                            || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'), E'\n' ORDER BY c.id), '')) FROM public.clinics c),
      'n_funciones_public', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace)
    )
    -- instantanea:fin
  )::text, true);

  RAISE NOTICE 'rollback s7_96 PREVIA OK — las dos RPC siguen como las dejo s7_96 y sin dependientes';
END
$PREVIA$;


DO $RETIRO$
BEGIN
  -- RESTRICT (por defecto): si apareciera un dependiente no detectado, aborta.
  EXECUTE format('DROP FUNCTION %I.%I(%s)', 'public', 'directory_territory_units', 'text, bigint');
  EXECUTE format('DROP FUNCTION %I.%I(%s)', 'public', 'directory_countries', '');
  RAISE NOTICE 'rollback s7_96 RETIRO: RPC retiradas';
END
$RETIRO$;


DO $VERIFICA$
DECLARE
  v_antes jsonb;
  v_ahora jsonb;
  v_n     bigint;
  k       text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('directory_countries', 'directory_territory_units');
  IF v_n <> 0 THEN RAISE EXCEPTION 'rollback s7_96 VERIFICA: siguen existiendo % funciones directory_*', v_n; END IF;

  -- El modelo territorial vuelve a no tener consumidores (predicado del rollback de s7_95).
  SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
             AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels|administrative_unit_closure)\M')
       + (SELECT count(*) FROM pg_depend dp JOIN pg_attribute a ON a.attrelid = dp.refobjid AND a.attnum = dp.refobjsubid
           WHERE dp.classid = 'pg_rewrite'::regclass AND dp.refobjid = 'public.clinics'::regclass AND a.attname IN ('country_id', 'territory_unit_id'))
       + (SELECT count(*) FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '\m(country_id|territory_unit_id)\M')
    INTO v_n;
  IF v_n <> 0 THEN RAISE EXCEPTION 'rollback s7_96 VERIFICA: quedan % consumidores del modelo territorial', v_n; END IF;

  IF (SELECT bool_or(has_table_privilege(r.rol, t.tbl, x.priv))
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),
             unnest(ARRAY['public.countries', 'public.country_levels', 'public.administrative_units', 'public.administrative_unit_closure']) t(tbl),
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)) THEN
    RAISE EXCEPTION 'rollback s7_96 VERIFICA: un rol cliente tiene privilegios sobre el catalogo GEO';
  END IF;

  v_antes := current_setting('s7_96rb.snap')::jsonb;
  v_ahora := (
    -- instantanea:ini
    SELECT jsonb_build_object(
      'policies', (SELECT md5(coalesce(string_agg(schemaname || '.' || tablename || ':' || policyname || ':' || permissive || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), E'\n' ORDER BY schemaname, tablename, policyname), '')) FROM pg_policies),
      'relaciones', (SELECT md5(coalesce(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, 'NULL') || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity || ':' || pg_get_userbyid(c.relowner), E'\n' ORDER BY n.nspname, c.relname), ''))
                       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname NOT LIKE 'pg_temp%' AND n.nspname NOT LIKE 'pg_toast_temp%'),
      'columnas', (SELECT md5(coalesce(string_agg(a.attrelid::regclass::text || '.' || a.attname || ':' || a.attacl::text, E'\n' ORDER BY a.attrelid::regclass::text, a.attname), ''))
                     FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE a.attacl IS NOT NULL AND n.nspname NOT IN ('pg_catalog', 'information_schema')),
      'funciones', (SELECT md5(coalesce(string_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, 'NULL') || ':' || p.prosecdef || ':' || coalesce(p.proconfig::text, '') || ':' || pg_get_userbyid(p.proowner), E'\n' ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), ''))
                      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('directory_countries', 'directory_territory_units')),
      'triggers', (SELECT md5(coalesce(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), E'\n' ORDER BY t.tgrelid::regclass::text, t.tgname), '')) FROM pg_trigger t WHERE NOT t.tgisinternal),
      'default_acl', (SELECT md5(coalesce(string_agg(pg_get_userbyid(defaclrole) || ':' || defaclnamespace || ':' || defaclobjtype::text || ':' || defaclacl::text, E'\n' ORDER BY pg_get_userbyid(defaclrole), defaclnamespace, defaclobjtype), '')) FROM pg_default_acl),
      'roles', (SELECT md5(coalesce(string_agg(r.rolname || ':' || r.rolsuper || r.rolinherit || r.rolcreaterole || r.rolcreatedb || r.rolcanlogin || r.rolreplication || r.rolbypassrls, E'\n' ORDER BY r.rolname), '')) FROM pg_roles r),
      'membresias', (SELECT md5(coalesce(string_agg(m.roleid::regrole::text || '>' || m.member::regrole::text || ':' || m.admin_option, E'\n' ORDER BY m.roleid::regrole::text, m.member::regrole::text), '')) FROM pg_auth_members m),
      'esquemas', (SELECT md5(coalesce(string_agg(nspname || ':' || coalesce(nspacl::text, 'NULL') || ':' || pg_get_userbyid(nspowner), E'\n' ORDER BY nspname), '')) FROM pg_namespace),
      'catalogo_geo', (SELECT md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.countries x), '') || '#'
                              || coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.country_id, x.level) FROM public.country_levels x), '') || '#'
                              || coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.administrative_units x), '') || '#'
                              || (SELECT count(*) FROM public.administrative_unit_closure)::text)),
      'clinics_c2', (SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
                            || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'), E'\n' ORDER BY c.id), '')) FROM public.clinics c),
      'n_funciones_public', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace)
    )
    -- instantanea:fin
  );
  FOR k IN SELECT jsonb_object_keys(v_antes) LOOP
    IF k = 'n_funciones_public' THEN
      IF (v_ahora ->> k)::bigint <> (v_antes ->> k)::bigint - 2 THEN
        RAISE EXCEPTION 'rollback s7_96 VERIFICA: funciones en public antes %, ahora % (esperado -2)', v_antes ->> k, v_ahora ->> k;
      END IF;
    ELSIF (v_ahora ->> k) IS DISTINCT FROM (v_antes ->> k) THEN
      RAISE EXCEPTION 'rollback s7_96 VERIFICA: cambio %', k;
    END IF;
  END LOOP;

  RAISE NOTICE 'rollback s7_96 VERIFICA OK — RPC retiradas, sin consumidores del modelo, nada mas cambio. Siguiente paso posible: rollback de s7_95';
END
$VERIFICA$;

COMMIT;
