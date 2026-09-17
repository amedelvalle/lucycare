-- ============================================================
-- s7_97 · MULTICOUNTRY-GEO-P0 · F3F
-- Alcance territorial publico: una RPC que resuelve una unidad y sus descendientes
-- ============================================================
--
-- Migracion 118. Crea EXCLUSIVAMENTE una funcion de lectura:
--   · public.directory_territory_scope(p_country_iso text, p_unit_id bigint)
--       RETURNS TABLE (unit_id bigint): la unidad pedida y sus descendientes
--       ACTIVOS, con la cadena completa hasta la raiz activa, ordenados por unit_id.
--       Solo ids: sin nombres, niveles ni metadata (la navegacion sigue en
--       directory_territory_units de s7_96).
--       ISO inexistente, NULL, vacio o en minusculas, pais sin directory_enabled,
--       unidad NULL, inexistente, inactiva, con algun ancestro inactivo o de otro
--       pais -> CONJUNTO VACIO, nunca excepcion. Un scope vacio NO significa
--       "sin filtro": el consumidor debe tratarlo como cero coincidencias.
--
-- ── CONTRATO APROBADO POR EL OWNER (F3F, 2026-09-17) ──
-- Variante F3F-a: el Home seguira consultando doctors por PostgREST y filtrara
-- clinics.territory_unit_id con la lista devuelta (in). Se resuelve con el cierre
-- de s7_94 (fila propia depth = 0 incluida), sin recursion y sin grants de tabla.
-- Preflight F3F PRE-0 de produccion (PostgreSQL 17.6), Z = 0: cierre 888 filas,
-- 320 filas propias, 0 cruces de pais; maximo SV 37 ids; San Salvador 25 ids y
-- 9 publicados (igual que el filtro legacy SS); S2 = 36 y 0 dentro de cualquier
-- scope; planes sin Recursive Union, sin CTE Scan y sin Seq Scan del cierre.
--
-- ── SEGURIDAD ──
-- Las tablas GEO tienen RLS activa, 0 policies y 0 privilegios de cliente. Leer
-- el cierre sin abrir grants exige SECURITY DEFINER con dueño postgres.
--   · plpgsql, STABLE, search_path fijo, referencias calificadas;
--   · sin SQL dinamico, sin auth.uid(), sin tablas fuera del catalogo y el cierre;
--   · los DEFAULT PRIVILEGES de public conceden EXECUTE a anon, authenticated y
--     service_role en funciones nuevas (medido): REVOKE ALL a PUBLIC, anon,
--     authenticated y service_role, y despues GRANT EXECUTE solo a anon y
--     authenticated. El POST exige la ACL exacta.
--
-- ── LO QUE NO TOCA ──
-- Ni RLS, ni policies, ni grants/ACL de tablas, ni roles, ni el catalogo, ni el
-- cierre, ni clinics, doctors, profiles ni datos, ni las RPC de s7_96. El POST
-- compara una instantanea tomada en la misma transaccion (REPEATABLE READ).
--
-- ── ROLLBACK Y CONSUMIDORES ──
-- docs/rollbacks/s7_97_rollback.sql. El cuerpo nombra el catalogo y el cierre:
-- mientras exista, los rollbacks de s7_92, s7_93, s7_94 y s7_95 la detectan como
-- consumidora y se niegan, y el de s7_96 se niega en su VERIFICA (arnes: medido
-- para s7_94, s7_95 y s7_96). Orden OBLIGATORIO:
--   revertir frontend F3E-3B -> s7_97 -> revertir frontend F3E-2 -> s7_96 -> s7_95 -> s7_94 -> s7_93 R2 -> verificar -> s7_92.
-- Un consumidor de frontend NO es detectable desde la base: revertirlo primero.
--
-- ── COMO APLICARLA ──
-- BLOQUES AUTONOMOS, cada uno pegado ENTERO en una pestaña nueva:
--   PASO 1 = seccion 0      · guardas PRE · solo lectura
--   PASO 2 = secciones 1-5  · BEGIN -> GUARDA -> funcion -> privilegios -> POST -> COMMIT
-- Si el PASO 1 lanza excepcion, NO continuar. Ante cualquier error del editor,
-- clasificar primero con docs/smokes/s7_97_state_readonly.sql.
-- Runbook: docs/OWNER_S7_97_APPLY.md.


-- ─── 0. Guardas PRE (solo lectura) ──────────────────────────
DO $PRE$
DECLARE
  v_etapa      CONSTANT text := 'PRE';
  -- Constantes estructurales (preflight F3F PRE-0 de produccion, 2026-09-17, y huellas de s7_94).
  v_paises     CONSTANT text := 'SV';
  v_niveles    CONSTANT text := 'SV:1,2,3';
  v_unidades   CONSTANT text := '14|44|262|0';
  v_catalogo   CONSTANT text := '460e807050a0da8bea0891965b1b9fd7';
  v_cierre     CONSTANT text := '888|0=320,1=306,2=262|af230f5086d871b1cce24e34de4b6cec';
  v_geo        CONSTANT text := 'administrative_unit_closure={postgres=arwdDxtm/postgres}|true|false|postgres|0;administrative_units={postgres=arwdDxtm/postgres}|true|false|postgres|0;countries={postgres=arwdDxtm/postgres}|true|false|postgres|0;country_levels={postgres=arwdDxtm/postgres}|true|false|postgres|0';
  v_acl_96     CONSTANT text := 'anon=X/postgres,authenticated=X/postgres,postgres=X/postgres';
  v_md5_c96    CONSTANT text[] := ARRAY['d3fa8ee9a257868fc75480860ed7c4a6', '54aeee13db6d9cc1ddf02f121839d674'];
  v_md5_u96    CONSTANT text[] := ARRAY['3083c7c5ad5a790c044e89bd7d554afc', '243b51249cb406b28b90fe5087387229'];
  v_sv   smallint;
  v_txt  text;
  v_n    bigint;
  k      text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 's7_97 %: debe ejecutarse como postgres (dueño de las tablas GEO), no como %', v_etapa, current_user;
  END IF;
  IF NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 's7_97 %: % no tiene CREATE en el esquema public', v_etapa, current_user;
  END IF;

  -- No reaplicar ni colisionar.
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'directory_territory_scope';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_97 %: ya existen % funciones directory_territory_scope — s7_97 aplicada o colision: NO reaplicar', v_etapa, v_n;
  END IF;

  -- s7_96 aplicada exactamente: las dos RPC con forma, cuerpo y ACL de s7_96.
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('directory_countries', 'directory_territory_units');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 's7_97 %: s7_96 no esta aplicada completa (% funciones directory_*) — fuera del alcance', v_etapa, v_n;
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
    RAISE EXCEPTION 's7_97 %: las RPC de s7_96 no tienen su forma (%)', v_etapa, v_txt;
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.directory_countries()'::regprocedure) <> ALL (v_md5_c96)
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.directory_territory_units(text, bigint)'::regprocedure) <> ALL (v_md5_u96) THEN
    RAISE EXCEPTION 's7_97 %: el cuerpo de alguna RPC de s7_96 cambio', v_etapa;
  END IF;
  FOR k IN SELECT unnest(ARRAY['public.directory_countries()', 'public.directory_territory_units(text, bigint)']) LOOP
    SELECT string_agg(a::text, ',' ORDER BY a::text) INTO v_txt FROM pg_proc p, unnest(p.proacl) a WHERE p.oid = k::regprocedure;
    IF v_txt IS DISTINCT FROM v_acl_96 THEN
      RAISE EXCEPTION 's7_97 %: la ACL de % no es la de s7_96 (%)', v_etapa, k, v_txt;
    END IF;
  END LOOP;

  -- Runtime de s7_92 presente y normal.
  IF to_regprocedure('public._territory_from_legacy_sv(text, text)') IS NULL
     OR to_regprocedure('public._clinics_territory_sync()') IS NULL THEN
    RAISE EXCEPTION 's7_97 %: falta el runtime de s7_92 — fuera del alcance', v_etapa;
  END IF;
  SELECT string_agg(t.tgname || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 's7_97 %: triggers de clinics inesperados (%)', v_etapa, v_txt;
  END IF;

  -- Catalogo GEO cerrado al cliente: ACL, RLS, force, dueño y 0 policies.
  SELECT string_agg(c.relname || '=' || coalesce(c.relacl::text, 'NULL') || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity
                    || '|' || pg_get_userbyid(c.relowner) || '|'
                    || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname),
                    ';' ORDER BY c.relname) INTO v_txt
    FROM pg_class c
   WHERE c.oid IN ('public.countries'::regclass, 'public.country_levels'::regclass,
                   'public.administrative_units'::regclass, 'public.administrative_unit_closure'::regclass);
  IF v_txt IS DISTINCT FROM v_geo THEN
    RAISE EXCEPTION 's7_97 %: el catalogo GEO no esta cerrado como en el preflight (%)', v_etapa, v_txt;
  END IF;
  IF (SELECT bool_or(has_table_privilege(r.rol, t.tbl, x.priv))
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),
             unnest(ARRAY['public.countries', 'public.country_levels', 'public.administrative_units', 'public.administrative_unit_closure']) t(tbl),
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)) THEN
    RAISE EXCEPTION 's7_97 %: un rol cliente tiene privilegios sobre el catalogo GEO', v_etapa;
  END IF;

  -- Consumidores: el modelo solo lo leen las 2 RPC de s7_96; el cierre no lo lee nadie.
  SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
     AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels)\M';
  IF v_txt IS DISTINCT FROM 'directory_countries,directory_territory_units' THEN
    RAISE EXCEPTION 's7_97 %: consumidores del modelo distintos de las RPC de s7_96 (%) — fuera del alcance', v_etapa, v_txt;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~* '(administrative_unit_closure|au_id_country_level_key|auc_descendant_level_idx|ancestor_unit_id|descendant_unit_id)';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_97 %: ya hay % funciones que leen el cierre — fuera del alcance', v_etapa, v_n;
  END IF;

  -- Paises, niveles y unidades.
  SELECT coalesce(string_agg(iso_alpha2, ',' ORDER BY iso_alpha2), '') INTO v_txt FROM public.countries WHERE directory_enabled;
  IF v_txt IS DISTINCT FROM v_paises THEN
    RAISE EXCEPTION 's7_97 %: paises habilitados distintos del preflight (%)', v_etapa, v_txt;
  END IF;
  SELECT coalesce(string_agg(s.x, ';' ORDER BY s.x), '') INTO v_txt
    FROM (SELECT c.iso_alpha2 || ':' || string_agg(l.level::text, ',' ORDER BY l.level) AS x
            FROM public.countries c JOIN public.country_levels l ON l.country_id = c.id
           WHERE c.directory_enabled GROUP BY c.iso_alpha2) s;
  IF v_txt IS DISTINCT FROM v_niveles THEN
    RAISE EXCEPTION 's7_97 %: niveles de los paises habilitados distintos del preflight (%)', v_etapa, v_txt;
  END IF;
  SELECT id INTO STRICT v_sv FROM public.countries WHERE iso_alpha2 = 'SV';
  SELECT count(*) FILTER (WHERE level = 1 AND is_active) || '|' || count(*) FILTER (WHERE level = 2 AND is_active) || '|'
         || count(*) FILTER (WHERE level = 3 AND is_active) || '|' || count(*) FILTER (WHERE NOT is_active)
    INTO v_txt FROM public.administrative_units WHERE country_id = v_sv;
  IF v_txt IS DISTINCT FROM v_unidades THEN
    RAISE EXCEPTION 's7_97 %: unidades de SV distintas del preflight (%)', v_etapa, v_txt;
  END IF;

  -- Catalogo y cierre: huellas de s7_94 (regla D8: el cierre esta sincronizado con el arbol).
  SELECT md5(string_agg(u.id || '|' || u.country_id || '|' || coalesce(u.parent_id::text, 'NULL') || '|' || u.level || '|' || u.is_active,
                        E'\n' ORDER BY u.id))
    INTO v_txt FROM public.administrative_units u;
  IF v_txt IS DISTINCT FROM v_catalogo THEN
    RAISE EXCEPTION 's7_97 %: la huella del catalogo cambio (%) — STOP, repetir preflight', v_etapa, v_txt;
  END IF;
  SELECT (SELECT count(*) FROM public.administrative_unit_closure) || '|'
         || (SELECT string_agg(z.depth || '=' || z.n, ',' ORDER BY z.depth) FROM (SELECT depth, count(*) AS n FROM public.administrative_unit_closure GROUP BY depth) z) || '|'
         || (SELECT md5(string_agg(ancestor_unit_id || '|' || descendant_unit_id || '|' || depth, E'\n' ORDER BY ancestor_unit_id, descendant_unit_id)) FROM public.administrative_unit_closure)
    INTO v_txt;
  IF v_txt IS DISTINCT FROM v_cierre THEN
    RAISE EXCEPTION 's7_97 %: el cierre no es el de s7_94 (filas|reparto|huella = %) — STOP', v_etapa, v_txt;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.administrative_unit_closure cl
    JOIN public.administrative_units x ON x.id = cl.ancestor_unit_id
    JOIN public.administrative_units y ON y.id = cl.descendant_unit_id
   WHERE x.country_id <> cl.country_id OR y.country_id <> cl.country_id;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_97 %: % filas del cierre con pais cruzado', v_etapa, v_n;
  END IF;

  RAISE NOTICE 's7_97 % OK — s7_96 exacta, catalogo cerrado, cierre de s7_94 intacto, sin lectores del cierre', v_etapa;
END
$PRE$;


-- ─── 1. Transaccion (PASO 2) ────────────────────────────────
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';

-- ─── 2. GUARDA: las mismas comprobaciones que el PRE ────────
DO $GUARDA$
DECLARE
  v_etapa      CONSTANT text := 'GUARDA';
  -- Constantes estructurales (preflight F3F PRE-0 de produccion, 2026-09-17, y huellas de s7_94).
  v_paises     CONSTANT text := 'SV';
  v_niveles    CONSTANT text := 'SV:1,2,3';
  v_unidades   CONSTANT text := '14|44|262|0';
  v_catalogo   CONSTANT text := '460e807050a0da8bea0891965b1b9fd7';
  v_cierre     CONSTANT text := '888|0=320,1=306,2=262|af230f5086d871b1cce24e34de4b6cec';
  v_geo        CONSTANT text := 'administrative_unit_closure={postgres=arwdDxtm/postgres}|true|false|postgres|0;administrative_units={postgres=arwdDxtm/postgres}|true|false|postgres|0;countries={postgres=arwdDxtm/postgres}|true|false|postgres|0;country_levels={postgres=arwdDxtm/postgres}|true|false|postgres|0';
  v_acl_96     CONSTANT text := 'anon=X/postgres,authenticated=X/postgres,postgres=X/postgres';
  v_md5_c96    CONSTANT text[] := ARRAY['d3fa8ee9a257868fc75480860ed7c4a6', '54aeee13db6d9cc1ddf02f121839d674'];
  v_md5_u96    CONSTANT text[] := ARRAY['3083c7c5ad5a790c044e89bd7d554afc', '243b51249cb406b28b90fe5087387229'];
  v_sv   smallint;
  v_txt  text;
  v_n    bigint;
  k      text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 's7_97 %: debe ejecutarse como postgres (dueño de las tablas GEO), no como %', v_etapa, current_user;
  END IF;
  IF NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 's7_97 %: % no tiene CREATE en el esquema public', v_etapa, current_user;
  END IF;

  -- No reaplicar ni colisionar.
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'directory_territory_scope';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_97 %: ya existen % funciones directory_territory_scope — s7_97 aplicada o colision: NO reaplicar', v_etapa, v_n;
  END IF;

  -- s7_96 aplicada exactamente: las dos RPC con forma, cuerpo y ACL de s7_96.
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('directory_countries', 'directory_territory_units');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 's7_97 %: s7_96 no esta aplicada completa (% funciones directory_*) — fuera del alcance', v_etapa, v_n;
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
    RAISE EXCEPTION 's7_97 %: las RPC de s7_96 no tienen su forma (%)', v_etapa, v_txt;
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.directory_countries()'::regprocedure) <> ALL (v_md5_c96)
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.directory_territory_units(text, bigint)'::regprocedure) <> ALL (v_md5_u96) THEN
    RAISE EXCEPTION 's7_97 %: el cuerpo de alguna RPC de s7_96 cambio', v_etapa;
  END IF;
  FOR k IN SELECT unnest(ARRAY['public.directory_countries()', 'public.directory_territory_units(text, bigint)']) LOOP
    SELECT string_agg(a::text, ',' ORDER BY a::text) INTO v_txt FROM pg_proc p, unnest(p.proacl) a WHERE p.oid = k::regprocedure;
    IF v_txt IS DISTINCT FROM v_acl_96 THEN
      RAISE EXCEPTION 's7_97 %: la ACL de % no es la de s7_96 (%)', v_etapa, k, v_txt;
    END IF;
  END LOOP;

  -- Runtime de s7_92 presente y normal.
  IF to_regprocedure('public._territory_from_legacy_sv(text, text)') IS NULL
     OR to_regprocedure('public._clinics_territory_sync()') IS NULL THEN
    RAISE EXCEPTION 's7_97 %: falta el runtime de s7_92 — fuera del alcance', v_etapa;
  END IF;
  SELECT string_agg(t.tgname || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 's7_97 %: triggers de clinics inesperados (%)', v_etapa, v_txt;
  END IF;

  -- Catalogo GEO cerrado al cliente: ACL, RLS, force, dueño y 0 policies.
  SELECT string_agg(c.relname || '=' || coalesce(c.relacl::text, 'NULL') || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity
                    || '|' || pg_get_userbyid(c.relowner) || '|'
                    || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname),
                    ';' ORDER BY c.relname) INTO v_txt
    FROM pg_class c
   WHERE c.oid IN ('public.countries'::regclass, 'public.country_levels'::regclass,
                   'public.administrative_units'::regclass, 'public.administrative_unit_closure'::regclass);
  IF v_txt IS DISTINCT FROM v_geo THEN
    RAISE EXCEPTION 's7_97 %: el catalogo GEO no esta cerrado como en el preflight (%)', v_etapa, v_txt;
  END IF;
  IF (SELECT bool_or(has_table_privilege(r.rol, t.tbl, x.priv))
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),
             unnest(ARRAY['public.countries', 'public.country_levels', 'public.administrative_units', 'public.administrative_unit_closure']) t(tbl),
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)) THEN
    RAISE EXCEPTION 's7_97 %: un rol cliente tiene privilegios sobre el catalogo GEO', v_etapa;
  END IF;

  -- Consumidores: el modelo solo lo leen las 2 RPC de s7_96; el cierre no lo lee nadie.
  SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
     AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels)\M';
  IF v_txt IS DISTINCT FROM 'directory_countries,directory_territory_units' THEN
    RAISE EXCEPTION 's7_97 %: consumidores del modelo distintos de las RPC de s7_96 (%) — fuera del alcance', v_etapa, v_txt;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~* '(administrative_unit_closure|au_id_country_level_key|auc_descendant_level_idx|ancestor_unit_id|descendant_unit_id)';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_97 %: ya hay % funciones que leen el cierre — fuera del alcance', v_etapa, v_n;
  END IF;

  -- Paises, niveles y unidades.
  SELECT coalesce(string_agg(iso_alpha2, ',' ORDER BY iso_alpha2), '') INTO v_txt FROM public.countries WHERE directory_enabled;
  IF v_txt IS DISTINCT FROM v_paises THEN
    RAISE EXCEPTION 's7_97 %: paises habilitados distintos del preflight (%)', v_etapa, v_txt;
  END IF;
  SELECT coalesce(string_agg(s.x, ';' ORDER BY s.x), '') INTO v_txt
    FROM (SELECT c.iso_alpha2 || ':' || string_agg(l.level::text, ',' ORDER BY l.level) AS x
            FROM public.countries c JOIN public.country_levels l ON l.country_id = c.id
           WHERE c.directory_enabled GROUP BY c.iso_alpha2) s;
  IF v_txt IS DISTINCT FROM v_niveles THEN
    RAISE EXCEPTION 's7_97 %: niveles de los paises habilitados distintos del preflight (%)', v_etapa, v_txt;
  END IF;
  SELECT id INTO STRICT v_sv FROM public.countries WHERE iso_alpha2 = 'SV';
  SELECT count(*) FILTER (WHERE level = 1 AND is_active) || '|' || count(*) FILTER (WHERE level = 2 AND is_active) || '|'
         || count(*) FILTER (WHERE level = 3 AND is_active) || '|' || count(*) FILTER (WHERE NOT is_active)
    INTO v_txt FROM public.administrative_units WHERE country_id = v_sv;
  IF v_txt IS DISTINCT FROM v_unidades THEN
    RAISE EXCEPTION 's7_97 %: unidades de SV distintas del preflight (%)', v_etapa, v_txt;
  END IF;

  -- Catalogo y cierre: huellas de s7_94 (regla D8: el cierre esta sincronizado con el arbol).
  SELECT md5(string_agg(u.id || '|' || u.country_id || '|' || coalesce(u.parent_id::text, 'NULL') || '|' || u.level || '|' || u.is_active,
                        E'\n' ORDER BY u.id))
    INTO v_txt FROM public.administrative_units u;
  IF v_txt IS DISTINCT FROM v_catalogo THEN
    RAISE EXCEPTION 's7_97 %: la huella del catalogo cambio (%) — STOP, repetir preflight', v_etapa, v_txt;
  END IF;
  SELECT (SELECT count(*) FROM public.administrative_unit_closure) || '|'
         || (SELECT string_agg(z.depth || '=' || z.n, ',' ORDER BY z.depth) FROM (SELECT depth, count(*) AS n FROM public.administrative_unit_closure GROUP BY depth) z) || '|'
         || (SELECT md5(string_agg(ancestor_unit_id || '|' || descendant_unit_id || '|' || depth, E'\n' ORDER BY ancestor_unit_id, descendant_unit_id)) FROM public.administrative_unit_closure)
    INTO v_txt;
  IF v_txt IS DISTINCT FROM v_cierre THEN
    RAISE EXCEPTION 's7_97 %: el cierre no es el de s7_94 (filas|reparto|huella = %) — STOP', v_etapa, v_txt;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.administrative_unit_closure cl
    JOIN public.administrative_units x ON x.id = cl.ancestor_unit_id
    JOIN public.administrative_units y ON y.id = cl.descendant_unit_id
   WHERE x.country_id <> cl.country_id OR y.country_id <> cl.country_id;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_97 %: % filas del cierre con pais cruzado', v_etapa, v_n;
  END IF;

  RAISE NOTICE 's7_97 % OK — s7_96 exacta, catalogo cerrado, cierre de s7_94 intacto, sin lectores del cierre', v_etapa;
END
$GUARDA$;

-- Instantanea de todo lo que s7_97 NO debe cambiar (misma expresion en el POST).
DO $SNAP$
BEGIN
  PERFORM set_config('s7_97.snap', (
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
END
$SNAP$;


-- ─── 3. directory_territory_scope(p_country_iso, p_unit_id) ─
CREATE FUNCTION public.directory_territory_scope(p_country_iso text, p_unit_id bigint)
RETURNS TABLE (unit_id bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_country smallint;
BEGIN
  IF p_unit_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.id INTO v_country
    FROM public.countries c
   WHERE c.iso_alpha2 = p_country_iso
     AND c.directory_enabled;

  IF v_country IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT cl.descendant_unit_id
      FROM public.administrative_units a
      JOIN public.administrative_unit_closure cl
        ON cl.ancestor_unit_id = a.id
       AND cl.country_id = v_country
      JOIN public.administrative_units d
        ON d.id = cl.descendant_unit_id
       AND d.is_active
     WHERE a.id = p_unit_id
       AND a.country_id = v_country
       AND a.is_active
       AND NOT EXISTS (SELECT 1
                         FROM public.administrative_unit_closure up
                         JOIN public.administrative_units m ON m.id = up.ancestor_unit_id
                        WHERE up.descendant_unit_id = cl.descendant_unit_id
                          AND up.depth > 0
                          AND NOT m.is_active)
     ORDER BY cl.descendant_unit_id;
END
$fn$;


-- ─── 4. Dueño y privilegios explicitos ──────────────────────
ALTER FUNCTION public.directory_territory_scope(text, bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.directory_territory_scope(text, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.directory_territory_scope(text, bigint) TO anon, authenticated;

COMMENT ON FUNCTION public.directory_territory_scope(text, bigint) IS
  's7_97 (F3F): la unidad pedida y sus descendientes activos (cadena activa hasta la raiz) de un pais habilitado, solo ids, ordenados. '
  'ISO o pais invalido, unidad NULL, inexistente, inactiva o de otro pais: conjunto vacio. Un scope vacio significa cero coincidencias, no ausencia de filtro.';


-- ─── 5. POST ────────────────────────────────────────────────
DO $POST$
DECLARE
  v_acl        CONSTANT text := 'anon=X/postgres,authenticated=X/postgres,postgres=X/postgres';
  v_md5        CONSTANT text[] := ARRAY['08116cf0c80730e76e2cae4531153989', 'a69870a3a900247ad60d4d9c2730d375'];
  v_sv    smallint;
  v_dgr   bigint;
  v_dpe   bigint;
  v_mgr   bigint;
  v_hoja  bigint;
  v_ss    bigint;
  v_rol   text;
  v_txt   text;
  v_esp   text;
  v_n     bigint;
  v_fallos text := '';
  v_antes jsonb;
  v_ahora jsonb;
  k       text;
  rc      record;
BEGIN
  SELECT id INTO STRICT v_sv FROM public.countries WHERE iso_alpha2 = 'SV';

  -- 5.1 Objeto: exactamente una funcion, con forma y cuerpo exactos.
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'directory_territory_scope';
  IF v_n <> 1 THEN v_fallos := v_fallos || ' | funciones directory_territory_scope = ' || v_n; END IF;
  SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
                    || ' vol=' || p.provolatile::text || ' def=' || p.prosecdef || ' lang=' || l.lanname
                    || ' cfg=' || coalesce(p.proconfig::text, '') || ' owner=' || pg_get_userbyid(p.proowner)
                    || ' args=' || pg_get_function_arguments(p.oid), E'\n' ORDER BY p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('directory_territory_scope');
  IF v_txt IS DISTINCT FROM 'directory_territory_scope(p_country_iso text, p_unit_id bigint) TABLE(unit_id bigint) vol=s def=true lang=plpgsql cfg={"search_path=public, pg_temp"} owner=postgres args=p_country_iso text, p_unit_id bigint' THEN
    v_fallos := v_fallos || ' | forma de la funcion: ' || coalesce(v_txt, 'NULL');
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.directory_territory_scope(text, bigint)'::regprocedure) <> ALL (v_md5) THEN
    v_fallos := v_fallos || ' | cuerpo de directory_territory_scope distinto del artefacto';
  END IF;

  -- 5.2 ACL exacta: solo el dueño, anon y authenticated; nada para PUBLIC ni service_role.
  SELECT string_agg(a::text, ',' ORDER BY a::text) INTO v_txt FROM pg_proc p, unnest(p.proacl) a WHERE p.oid = 'public.directory_territory_scope(text, bigint)'::regprocedure;
  IF v_txt IS DISTINCT FROM v_acl THEN v_fallos := v_fallos || ' | ACL: ' || coalesce(v_txt, 'NULL'); END IF;
  IF NOT has_function_privilege('anon', 'public.directory_territory_scope(text, bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.directory_territory_scope(text, bigint)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.directory_territory_scope(text, bigint)', 'EXECUTE') THEN
    v_fallos := v_fallos || ' | EXECUTE efectivo incorrecto';
  END IF;

  -- 5.3 Catalogo GEO sigue cerrado al cliente.
  IF (SELECT bool_or(has_table_privilege(r2.rol, t.tbl, x.priv))
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r2(rol),
             unnest(ARRAY['public.countries', 'public.country_levels', 'public.administrative_units', 'public.administrative_unit_closure']) t(tbl),
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)) THEN
    v_fallos := v_fallos || ' | un rol cliente tiene privilegios sobre el catalogo GEO';
  END IF;

  -- 5.4 Nada mas cambio: misma expresion que la instantanea.
  v_antes := current_setting('s7_97.snap', true)::jsonb;
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
  IF v_antes IS NULL THEN
    v_fallos := v_fallos || ' | falta la instantanea de la GUARDA';
  ELSE
    FOR k IN SELECT jsonb_object_keys(v_antes) LOOP
      IF k = 'n_funciones_public' THEN
        IF (v_ahora ->> k)::bigint <> (v_antes ->> k)::bigint + 1 THEN
          v_fallos := v_fallos || ' | funciones en public: antes ' || (v_antes ->> k) || ', ahora ' || (v_ahora ->> k) || ' (esperado +1)';
        END IF;
      ELSIF (v_ahora ->> k) IS DISTINCT FROM (v_antes ->> k) THEN
        v_fallos := v_fallos || ' | cambio ' || k;
      END IF;
    END LOOP;
  END IF;

  -- 5.5 Consumidores: los rollbacks historicos la detectan; nada usa las RPC de s7_96.
  SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
     AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels)\M';
  IF v_txt IS DISTINCT FROM 'directory_countries,directory_territory_scope,directory_territory_units' THEN
    v_fallos := v_fallos || ' | consumidores para s7_92/s7_93: ' || v_txt;
  END IF;
  SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~* '(administrative_unit_closure|au_id_country_level_key|auc_descendant_level_idx|ancestor_unit_id|descendant_unit_id)';
  IF v_txt IS DISTINCT FROM 'directory_territory_scope' THEN
    v_fallos := v_fallos || ' | consumidores del cierre (s7_94): ' || v_txt;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.proname NOT IN ('directory_countries', 'directory_territory_units')
     AND p.prosrc ~ '\m(directory_countries|directory_territory_units)\M';
  IF v_n <> 0 THEN v_fallos := v_fallos || ' | funciones que usan las RPC de s7_96: ' || v_n; END IF;

  -- 5.6 Casos: departamento grande y pequeño, municipio grande, hoja y San Salvador.
  SELECT cl.ancestor_unit_id INTO v_dgr FROM public.administrative_unit_closure cl
   WHERE cl.country_id = v_sv AND cl.ancestor_level = 1 GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1;
  SELECT cl.ancestor_unit_id INTO v_dpe FROM public.administrative_unit_closure cl
   WHERE cl.country_id = v_sv AND cl.ancestor_level = 1 GROUP BY 1 ORDER BY count(*) ASC, 1 LIMIT 1;
  SELECT cl.ancestor_unit_id INTO v_mgr FROM public.administrative_unit_closure cl
   WHERE cl.country_id = v_sv AND cl.ancestor_level = 2 GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1;
  SELECT min(u.id) INTO v_hoja FROM public.administrative_units u
   WHERE u.country_id = v_sv AND u.is_active AND NOT EXISTS (SELECT 1 FROM public.administrative_units ch WHERE ch.parent_id = u.id);
  SELECT u.id INTO STRICT v_ss FROM public.administrative_units u WHERE u.country_id = v_sv AND u.level = 1 AND u.legacy_id = 'SS';

  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('role', v_rol)::text, true);
    PERFORM set_config('request.jwt.claim.role', v_rol, true);

    FOR rc IN SELECT * FROM (VALUES ('departamento grande', v_dgr, 37), ('departamento pequeño', v_dpe, 12),
                                   ('municipio grande', v_mgr, 21), ('hoja', v_hoja, 1), ('San Salvador', v_ss, 25)) AS t(nombre, unidad, cuantos) LOOP
      v_esp := (SELECT coalesce(string_agg(s.id::text, ',' ORDER BY s.id), '') FROM (
             SELECT x.id FROM public.administrative_units x WHERE x.id = rc.unidad AND x.is_active
             UNION SELECT c1.id FROM public.administrative_units c1 WHERE c1.parent_id = rc.unidad AND c1.is_active
             UNION SELECT c2.id FROM public.administrative_units c1 JOIN public.administrative_units c2 ON c2.parent_id = c1.id
                    WHERE c1.parent_id = rc.unidad AND c1.is_active AND c2.is_active) s);
      EXECUTE format('SET LOCAL ROLE %I', v_rol);
      SELECT coalesce(string_agg(f.unit_id::text, ',' ORDER BY f.n), '') INTO v_txt
        FROM public.directory_territory_scope('SV', rc.unidad) WITH ORDINALITY AS f(unit_id, n);
      RESET ROLE;
      IF v_txt IS DISTINCT FROM v_esp THEN v_fallos := v_fallos || ' | ' || v_rol || ' ' || rc.nombre || ': scope distinto del arbol'; END IF;
      IF array_length(string_to_array(v_txt, ','), 1) IS DISTINCT FROM rc.cuantos THEN
        v_fallos := v_fallos || ' | ' || v_rol || ' ' || rc.nombre || ': ' || coalesce(array_length(string_to_array(v_txt, ','), 1), 0) || ' ids (esperado ' || rc.cuantos || ')';
      END IF;
    END LOOP;

    -- contratos invalidos: conjunto vacio, sin excepcion.
    EXECUTE format('SET LOCAL ROLE %I', v_rol);
    SELECT (SELECT count(*) FROM public.directory_territory_scope(NULL, v_dgr))
         + (SELECT count(*) FROM public.directory_territory_scope('', v_dgr))
         + (SELECT count(*) FROM public.directory_territory_scope('sv', v_dgr))
         + (SELECT count(*) FROM public.directory_territory_scope('XX', v_dgr))
         + (SELECT count(*) FROM public.directory_territory_scope('SV', NULL))
         + (SELECT count(*) FROM public.directory_territory_scope('SV', -1))
         + (SELECT count(*) FROM public.directory_territory_scope('HN', v_hoja))
      INTO v_n;
    RESET ROLE;
    IF v_n <> 0 THEN v_fallos := v_fallos || ' | ' || v_rol || ' contratos invalidos devolvieron ' || v_n || ' filas'; END IF;

    -- el scope es exactamente lo que la navegacion publica de s7_96 alcanza desde San Salvador.
    EXECUTE format('SET LOCAL ROLE %I', v_rol);
    SELECT coalesce(string_agg(s.id::text, ',' ORDER BY s.id), '') INTO v_esp FROM (
      SELECT v_ss AS id
      UNION SELECT h.id FROM public.directory_territory_units('SV', v_ss) h
      UNION SELECT g.id FROM public.directory_territory_units('SV', v_ss) h CROSS JOIN LATERAL public.directory_territory_units('SV', h.id) g) s;
    SELECT coalesce(string_agg(f.unit_id::text, ',' ORDER BY f.unit_id), '') INTO v_txt FROM public.directory_territory_scope('SV', v_ss) f;
    RESET ROLE;
    IF v_txt IS DISTINCT FROM v_esp THEN v_fallos := v_fallos || ' | ' || v_rol || ' scope de San Salvador distinto de la navegacion'; END IF;

    -- lectura directa del catalogo y del cierre: denegada.
    FOREACH k IN ARRAY ARRAY['countries', 'country_levels', 'administrative_units', 'administrative_unit_closure'] LOOP
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', v_rol);
        EXECUTE format('SELECT count(*) FROM public.%I', k) INTO v_n;
        RESET ROLE;
        v_fallos := v_fallos || ' | ' || v_rol || ' pudo leer ' || k;
      EXCEPTION WHEN insufficient_privilege THEN
        NULL;
      END;
      RESET ROLE;
    END LOOP;
  END LOOP;

  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM count(*) FROM public.directory_territory_scope('SV', v_ss);
    RESET ROLE;
    v_fallos := v_fallos || ' | service_role pudo ejecutar directory_territory_scope';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  -- 5.7 Consumo: San Salvador por scope = por legacy; ninguna clinica sin territorio entra;
  -- toda clinica con territorio esta en el scope de su departamento.
  SELECT (SELECT count(*) FROM public.doctors dr JOIN public.clinics c ON c.id = dr.clinic_id
           WHERE dr.is_published AND c.country_id = v_sv AND c.territory_unit_id IN (SELECT f.unit_id FROM public.directory_territory_scope('SV', v_ss) f))
         - (SELECT count(*) FROM public.doctors dr JOIN public.clinics c ON c.id = dr.clinic_id
           WHERE dr.is_published AND c.country_id = v_sv AND c.department_id = 'SS')
    INTO v_n;
  IF v_n <> 0 THEN v_fallos := v_fallos || ' | publicados en San Salvador: scope y legacy difieren en ' || v_n; END IF;
  SELECT count(*) INTO v_n FROM public.clinics c
   WHERE c.territory_unit_id IS NULL
     AND c.territory_unit_id IN (SELECT f.unit_id FROM public.directory_territory_scope('SV', v_ss) f);
  IF v_n <> 0 THEN v_fallos := v_fallos || ' | clinicas sin territorio dentro de un scope: ' || v_n; END IF;
  SELECT count(*) INTO v_n FROM public.clinics c
    JOIN public.administrative_units t ON t.id = c.territory_unit_id
   WHERE c.territory_unit_id IS NOT NULL
     AND c.territory_unit_id NOT IN (SELECT f.unit_id FROM public.directory_territory_scope('SV',
           CASE t.level WHEN 1 THEN t.id WHEN 2 THEN t.parent_id
                        ELSE (SELECT p.parent_id FROM public.administrative_units p WHERE p.id = t.parent_id) END) f);
  IF v_n <> 0 THEN v_fallos := v_fallos || ' | clinicas con territorio fuera del scope de su departamento: ' || v_n; END IF;

  IF v_fallos <> '' THEN
    RAISE EXCEPTION 's7_97 POST fallo:%', v_fallos;
  END IF;
  RAISE NOTICE 's7_97 POST OK — RPC con contrato, ACL y comportamiento exactos; catalogo y cierre cerrados; nada mas cambio';
END
$POST$;

COMMIT;
