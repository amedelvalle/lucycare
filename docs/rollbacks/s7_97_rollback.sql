-- ============================================================
-- ROLLBACK de s7_97 · MULTICOUNTRY-GEO-P0 · F3F
-- Retira la RPC de alcance territorial public.directory_territory_scope(text, bigint).
-- ============================================================
--
-- ⛔ NO EJECUTAR SIN ORDEN EXPLICITA DEL OWNER.
--
-- ⛔ ANTES: revertir el frontend de F3E-3B si ya consume esta RPC. Un consumidor
-- de frontend NO es detectable desde la base: este archivo no puede comprobarlo.
--
-- ── ORDEN VIGENTE Y BLOQUEANTE ──
--   revertir frontend F3E-3B -> rollback de s7_97 -> revertir frontend F3E-2
--   -> s7_96 -> s7_95 -> s7_94 -> s7_93 R2 -> verificar estado -> s7_92.
-- Mientras s7_97 este aplicada, los rollbacks de s7_92, s7_93, s7_94 y s7_95 la
-- detectan como consumidora y se niegan, y el de s7_96 se niega en su VERIFICA
-- (quedan consumidores del modelo). Los rollbacks historicos no se modifican.
--
-- ── VALIDO SOLO MIENTRAS ──
--   · la funcion siga EXACTAMENTE como la dejo s7_97 (firma, retorno, cuerpo por
--     md5, SECURITY DEFINER, STABLE, search_path, dueño y ACL);
--   · ningun objeto de la base dependa de ella (vistas, funciones que la nombren,
--     policies).
-- Si alguna condicion falla, se niega sin tocar nada y hay que reevaluar.
--
-- ── QUE HACE ──
--   BEGIN (REPEATABLE READ) -> lock_timeout 5s -> PREVIA (validez + instantanea)
--   -> RETIRO (REVOKE y DROP ensamblados, RESTRICT) -> VERIFICA (ausente, cierre
--   sin lectores, modelo solo con las RPC de s7_96, nada mas cambio) -> COMMIT.
-- No toca datos, tablas, el cierre, el catalogo, RLS, policies, grants de tablas,
-- roles ni las RPC de s7_96.
--
-- ── REGLA DEL SQL EDITOR ──
-- La funcion retirada no existira al terminar: las ordenes de retiro se ensamblan
-- con format() y el texto del archivo no nombra la funcion junto a esas ordenes.
--
-- Pegar ENTERO en una pestaña nueva. Ante cualquier error del editor, clasificar
-- primero el estado con docs/smokes/s7_97_state_readonly.sql.

BEGIN ISOLATION LEVEL REPEATABLE READ;

SET LOCAL lock_timeout = '5s';


DO $PREVIA$
DECLARE
  v_acl CONSTANT text := 'anon=X/postgres,authenticated=X/postgres,postgres=X/postgres';
  v_md5 CONSTANT text[] := ARRAY['08116cf0c80730e76e2cae4531153989', 'a69870a3a900247ad60d4d9c2730d375'];
  v_txt text;
  v_n   bigint;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'rollback s7_97: debe ejecutarse como postgres, no como %', current_user;
  END IF;

  -- Exactamente la funcion de s7_97, sin alterar.
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'directory_territory_scope';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'rollback s7_97: se esperaba 1 funcion directory_territory_scope, hay % — clasificar con el ESTADO, no se revierte', v_n;
  END IF;
  SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
                    || ' vol=' || p.provolatile::text || ' def=' || p.prosecdef || ' lang=' || l.lanname
                    || ' cfg=' || coalesce(p.proconfig::text, '') || ' owner=' || pg_get_userbyid(p.proowner)
                    || ' args=' || pg_get_function_arguments(p.oid), E'\n' ORDER BY p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('directory_territory_scope');
  IF v_txt IS DISTINCT FROM 'directory_territory_scope(p_country_iso text, p_unit_id bigint) TABLE(unit_id bigint) vol=s def=true lang=plpgsql cfg={"search_path=public, pg_temp"} owner=postgres args=p_country_iso text, p_unit_id bigint' THEN
    RAISE EXCEPTION 'rollback s7_97: la funcion no tiene la forma de s7_97 (%) — no se revierte', v_txt;
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.directory_territory_scope(text, bigint)'::regprocedure) <> ALL (v_md5) THEN
    RAISE EXCEPTION 'rollback s7_97: el cuerpo cambio despues de s7_97 — no se revierte';
  END IF;
  SELECT string_agg(a::text, ',' ORDER BY a::text) INTO v_txt FROM pg_proc p, unnest(p.proacl) a WHERE p.oid = 'public.directory_territory_scope(text, bigint)'::regprocedure;
  IF v_txt IS DISTINCT FROM v_acl THEN
    RAISE EXCEPTION 'rollback s7_97: la ACL cambio despues de s7_97 (%) — no se revierte', v_txt;
  END IF;

  -- Sin dependientes en la base.
  SELECT count(*) INTO v_n FROM pg_depend d
   WHERE d.refclassid = 'pg_proc'::regclass
     AND d.refobjid = 'public.directory_territory_scope(text, bigint)'::regprocedure
     AND d.deptype <> 'i';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'rollback s7_97: % objetos dependen de la RPC — el rollback ya no es valido', v_n;
  END IF;
  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.proname <> 'directory_territory_scope'
     AND p.prosrc ~ '\mdirectory_territory_scope\M';
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'rollback s7_97: hay funciones que usan la RPC (%) — el rollback ya no es valido', v_txt;
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '\mdirectory_territory_scope\M';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'rollback s7_97: % policies usan la RPC — el rollback ya no es valido', v_n;
  END IF;

  PERFORM set_config('s7_97rb.snap', (
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
                     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname <> 'directory_territory_scope'),
      'triggers', (SELECT md5(coalesce(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), E'\n' ORDER BY t.tgrelid::regclass::text, t.tgname), '')) FROM pg_trigger t WHERE NOT t.tgisinternal),
      'default_acl', (SELECT md5(coalesce(string_agg(pg_get_userbyid(defaclrole) || ':' || defaclnamespace || ':' || defaclobjtype::text || ':' || defaclacl::text, E'\n' ORDER BY pg_get_userbyid(defaclrole), defaclnamespace, defaclobjtype), '')) FROM pg_default_acl),
      'roles', (SELECT md5(coalesce(string_agg(r.rolname || ':' || r.rolsuper || r.rolinherit || r.rolcreaterole || r.rolcreatedb || r.rolcanlogin || r.rolreplication || r.rolbypassrls, E'\n' ORDER BY r.rolname), '')) FROM pg_roles r),
      'membresias', (SELECT md5(coalesce(string_agg(m.roleid::regrole::text || '>' || m.member::regrole::text || ':' || m.admin_option, E'\n' ORDER BY m.roleid::regrole::text, m.member::regrole::text), '')) FROM pg_auth_members m),
      'esquemas', (SELECT md5(coalesce(string_agg(nspname || ':' || coalesce(nspacl::text, 'NULL') || ':' || pg_get_userbyid(nspowner), E'\n' ORDER BY nspname), '')) FROM pg_namespace),
      'catalogo_geo', (SELECT md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.countries x), '') || '#'
                              || coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.country_id, x.level) FROM public.country_levels x), '') || '#'
                              || coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.administrative_units x), ''))),
      'cierre', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.ancestor_unit_id, x.descendant_unit_id), '')) FROM public.administrative_unit_closure x),
      'clinics_c2', (SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
                            || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'), E'\n' ORDER BY c.id), '')) FROM public.clinics c),
      'directorio', (SELECT md5(coalesce(string_agg(d.id::text || '|' || d.is_published || '|' || d.clinic_id::text, E'\n' ORDER BY d.id), '')) FROM public.doctors d),
      'n_funciones_public', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace)
    )
    -- instantanea:fin
  )::text, true);

  RAISE NOTICE 'rollback s7_97 PREVIA OK — la RPC sigue como la dejo s7_97 y sin dependientes';
END
$PREVIA$;


DO $RETIRO$
BEGIN
  -- RESTRICT (por defecto): si apareciera un dependiente no detectado, aborta.
  EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated, service_role', 'public', 'directory_territory_scope', 'text, bigint');
  EXECUTE format('DROP FUNCTION %I.%I(%s)', 'public', 'directory_territory_scope', 'text, bigint');
  RAISE NOTICE 'rollback s7_97 RETIRO: EXECUTE revocado y RPC retirada';
END
$RETIRO$;


DO $VERIFICA$
DECLARE
  v_antes jsonb;
  v_ahora jsonb;
  v_txt   text;
  v_n     bigint;
  k       text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'directory_territory_scope';
  IF v_n <> 0 THEN RAISE EXCEPTION 'rollback s7_97 VERIFICA: sigue existiendo % funcion directory_territory_scope', v_n; END IF;

  -- El cierre vuelve a no tener lectores (predicado del rollback de s7_94).
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~* '(administrative_unit_closure|au_id_country_level_key|auc_descendant_level_idx|ancestor_unit_id|descendant_unit_id)';
  IF v_n <> 0 THEN RAISE EXCEPTION 'rollback s7_97 VERIFICA: quedan % funciones que leen el cierre', v_n; END IF;

  -- El modelo vuelve a tener solo las RPC de s7_96 (predicado de los rollbacks de s7_92/s7_93).
  SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
     AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels)\M';
  IF v_txt IS DISTINCT FROM 'directory_countries,directory_territory_units' THEN
    RAISE EXCEPTION 'rollback s7_97 VERIFICA: consumidores del modelo distintos de las RPC de s7_96 (%)', v_txt;
  END IF;

  IF (SELECT bool_or(has_table_privilege(r.rol, t.tbl, x.priv))
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),
             unnest(ARRAY['public.countries', 'public.country_levels', 'public.administrative_units', 'public.administrative_unit_closure']) t(tbl),
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)) THEN
    RAISE EXCEPTION 'rollback s7_97 VERIFICA: un rol cliente tiene privilegios sobre el catalogo GEO';
  END IF;

  v_antes := current_setting('s7_97rb.snap')::jsonb;
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
                     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname <> 'directory_territory_scope'),
      'triggers', (SELECT md5(coalesce(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), E'\n' ORDER BY t.tgrelid::regclass::text, t.tgname), '')) FROM pg_trigger t WHERE NOT t.tgisinternal),
      'default_acl', (SELECT md5(coalesce(string_agg(pg_get_userbyid(defaclrole) || ':' || defaclnamespace || ':' || defaclobjtype::text || ':' || defaclacl::text, E'\n' ORDER BY pg_get_userbyid(defaclrole), defaclnamespace, defaclobjtype), '')) FROM pg_default_acl),
      'roles', (SELECT md5(coalesce(string_agg(r.rolname || ':' || r.rolsuper || r.rolinherit || r.rolcreaterole || r.rolcreatedb || r.rolcanlogin || r.rolreplication || r.rolbypassrls, E'\n' ORDER BY r.rolname), '')) FROM pg_roles r),
      'membresias', (SELECT md5(coalesce(string_agg(m.roleid::regrole::text || '>' || m.member::regrole::text || ':' || m.admin_option, E'\n' ORDER BY m.roleid::regrole::text, m.member::regrole::text), '')) FROM pg_auth_members m),
      'esquemas', (SELECT md5(coalesce(string_agg(nspname || ':' || coalesce(nspacl::text, 'NULL') || ':' || pg_get_userbyid(nspowner), E'\n' ORDER BY nspname), '')) FROM pg_namespace),
      'catalogo_geo', (SELECT md5(coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.countries x), '') || '#'
                              || coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.country_id, x.level) FROM public.country_levels x), '') || '#'
                              || coalesce((SELECT string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.id) FROM public.administrative_units x), ''))),
      'cierre', (SELECT md5(coalesce(string_agg(to_jsonb(x)::text, E'\n' ORDER BY x.ancestor_unit_id, x.descendant_unit_id), '')) FROM public.administrative_unit_closure x),
      'clinics_c2', (SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
                            || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'), E'\n' ORDER BY c.id), '')) FROM public.clinics c),
      'directorio', (SELECT md5(coalesce(string_agg(d.id::text || '|' || d.is_published || '|' || d.clinic_id::text, E'\n' ORDER BY d.id), '')) FROM public.doctors d),
      'n_funciones_public', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace)
    )
    -- instantanea:fin
  );
  FOR k IN SELECT jsonb_object_keys(v_antes) LOOP
    IF k = 'n_funciones_public' THEN
      IF (v_ahora ->> k)::bigint <> (v_antes ->> k)::bigint - 1 THEN
        RAISE EXCEPTION 'rollback s7_97 VERIFICA: funciones en public antes %, ahora % (esperado -1)', v_antes ->> k, v_ahora ->> k;
      END IF;
    ELSIF (v_ahora ->> k) IS DISTINCT FROM (v_antes ->> k) THEN
      RAISE EXCEPTION 'rollback s7_97 VERIFICA: cambio %', k;
    END IF;
  END LOOP;

  RAISE NOTICE 'rollback s7_97 VERIFICA OK — RPC retirada, cierre sin lectores, modelo solo con las RPC de s7_96, nada mas cambio. Siguiente paso posible: revertir frontend F3E-2 y rollback de s7_96';
END
$VERIFICA$;

COMMIT;
