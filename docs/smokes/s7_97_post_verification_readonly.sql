-- ════════════════════════════════════════════════════════════════════
-- s7_97 · VERIFICACION POST · en cualquier momento tras aplicar
-- SOLO LECTURA · transaccion READ ONLY que termina SIEMPRE en ROLLBACK · sin datos
-- personales · NO lee auth.users.
-- Ejecuta la RPC como anon y authenticated (y comprueba que service_role no puede),
-- verifica contrato, ACL, catalogo y cierre cerrados, consumidores, planes y el
-- consumo esperado por el Home. Las filas de datos (San Salvador 9, S2 36, 46
-- publicados) son las del preflight F3F PRE-0 (2026-09-17): dejan de valer cuando
-- las clinicas cambien legitimamente.
-- Pegar ENTERO en una pestaña nueva, desde BEGIN hasta ROLLBACK.
-- Salida: tabla del SELECT final (seccion, orden, clave, valor, esperado, ok) + fila Z.
-- ════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';

DO $s797post$
DECLARE
  v_out  jsonb := '[]'::jsonb;
  v_sv   smallint;
  v_dgr  bigint;
  v_dpe  bigint;
  v_mgr  bigint;
  v_hoja bigint;
  v_ss   bigint;
  v_rol  text;
  v_txt  text;
  v_esp  text;
  v_n    bigint;
  v_plan jsonb;
  k      text;
  rc     record;
  v_ord  int := 0;
  v_q    text;
BEGIN
  SELECT id INTO v_sv FROM public.countries WHERE iso_alpha2 = 'SV';
  SELECT cl.ancestor_unit_id INTO v_dgr FROM public.administrative_unit_closure cl
   WHERE cl.country_id = v_sv AND cl.ancestor_level = 1 GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1;
  SELECT cl.ancestor_unit_id INTO v_dpe FROM public.administrative_unit_closure cl
   WHERE cl.country_id = v_sv AND cl.ancestor_level = 1 GROUP BY 1 ORDER BY count(*) ASC, 1 LIMIT 1;
  SELECT cl.ancestor_unit_id INTO v_mgr FROM public.administrative_unit_closure cl
   WHERE cl.country_id = v_sv AND cl.ancestor_level = 2 GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1;
  SELECT min(u.id) INTO v_hoja FROM public.administrative_units u
   WHERE u.country_id = v_sv AND u.is_active AND NOT EXISTS (SELECT 1 FROM public.administrative_units ch WHERE ch.parent_id = u.id);
  SELECT u.id INTO v_ss FROM public.administrative_units u WHERE u.country_id = v_sv AND u.level = 1 AND u.legacy_id = 'SS';

  -- A · objeto y ACL
  v_ord := v_ord + 1;
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'directory_territory_scope';
  v_out := v_out || jsonb_build_object('s', 'A objeto', 'o', v_ord, 'k', 'funciones directory_territory_scope (todos los esquemas)', 'v', v_n::text, 'e', '1');
  v_ord := v_ord + 1;
  SELECT p.provolatile::text || '|' || p.prosecdef || '|' || coalesce(p.proconfig::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || pg_get_function_result(p.oid) || '|' || pg_get_function_arguments(p.oid)
    INTO v_txt FROM pg_proc p WHERE p.oid = to_regprocedure('public.directory_territory_scope(text, bigint)');
  v_out := v_out || jsonb_build_object('s', 'A objeto', 'o', v_ord, 'k', 'volatilidad|definer|search_path|dueño|retorno|argumentos', 'v', coalesce(v_txt, 'NULL'),
    'e', 's|true|{"search_path=public, pg_temp"}|postgres|TABLE(unit_id bigint)|p_country_iso text, p_unit_id bigint');
  v_ord := v_ord + 1;
  SELECT string_agg(a::text, ',' ORDER BY a::text) INTO v_txt FROM pg_proc p, unnest(p.proacl) a WHERE p.oid = to_regprocedure('public.directory_territory_scope(text, bigint)');
  v_out := v_out || jsonb_build_object('s', 'A objeto', 'o', v_ord, 'k', 'ACL exacta', 'v', coalesce(v_txt, 'NULL'), 'e', 'anon=X/postgres,authenticated=X/postgres,postgres=X/postgres');
  v_ord := v_ord + 1;
  v_txt := CASE WHEN to_regprocedure('public.directory_territory_scope(text, bigint)') IS NULL THEN 'NULL'
                ELSE has_function_privilege('anon', 'public.directory_territory_scope(text, bigint)', 'EXECUTE') || '|' || has_function_privilege('authenticated', 'public.directory_territory_scope(text, bigint)', 'EXECUTE') || '|' || has_function_privilege('service_role', 'public.directory_territory_scope(text, bigint)', 'EXECUTE') END;
  v_out := v_out || jsonb_build_object('s', 'A objeto', 'o', v_ord, 'k', 'EXECUTE efectivo anon|authenticated|service_role', 'v', v_txt, 'e', 'true|true|false');
  v_ord := v_ord + 1;
  SELECT (md5(prosrc) IN ('08116cf0c80730e76e2cae4531153989', 'a69870a3a900247ad60d4d9c2730d375'))::text INTO v_txt FROM pg_proc WHERE oid = to_regprocedure('public.directory_territory_scope(text, bigint)');
  v_out := v_out || jsonb_build_object('s', 'A objeto', 'o', v_ord, 'k', 'cuerpo igual al artefacto (md5 LF o CRLF)', 'v', coalesce(v_txt, 'NULL'), 'e', 'true');
  v_ord := v_ord + 1;
  SELECT (prosrc !~* 'recursive')::text INTO v_txt FROM pg_proc WHERE oid = to_regprocedure('public.directory_territory_scope(text, bigint)');
  v_out := v_out || jsonb_build_object('s', 'A objeto', 'o', v_ord, 'k', 'cuerpo sin recursion (sin WITH RECURSIVE)', 'v', coalesce(v_txt, 'NULL'), 'e', 'true');

  -- B · seguridad y consumidores
  v_ord := v_ord + 1;
  SELECT bool_or(has_table_privilege(r2.rol, t.tbl, x.priv))::text INTO v_txt
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r2(rol),
         unnest(ARRAY['public.countries', 'public.country_levels', 'public.administrative_units', 'public.administrative_unit_closure']) t(tbl),
         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv);
  v_out := v_out || jsonb_build_object('s', 'B seguridad', 'o', v_ord, 'k', 'algun rol cliente con privilegios sobre el catalogo GEO o el cierre', 'v', v_txt, 'e', 'false');
  v_ord := v_ord + 1;
  SELECT string_agg(c.relname || '=' || coalesce(c.relacl::text, 'NULL') || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity
                    || '|' || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname), ';' ORDER BY c.relname) INTO v_txt
    FROM pg_class c WHERE c.oid IN ('public.countries'::regclass, 'public.country_levels'::regclass, 'public.administrative_units'::regclass, 'public.administrative_unit_closure'::regclass);
  v_out := v_out || jsonb_build_object('s', 'B seguridad', 'o', v_ord, 'k', 'catalogo GEO: relacl|RLS|force|policies', 'v', v_txt,
    'e', 'administrative_unit_closure={postgres=arwdDxtm/postgres}|true|false|0;administrative_units={postgres=arwdDxtm/postgres}|true|false|0;countries={postgres=arwdDxtm/postgres}|true|false|0;country_levels={postgres=arwdDxtm/postgres}|true|false|0');
  v_ord := v_ord + 1;
  SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity || '|'
         || (SELECT left(md5(coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ';' ORDER BY policyname), '')), 8)
               FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics')
    INTO v_txt FROM pg_class WHERE oid = 'public.clinics'::regclass;
  v_out := v_out || jsonb_build_object('s', 'B seguridad', 'o', v_ord, 'k', 'clinics: relacl|RLS|force|policies md5', 'v', v_txt,
    'e', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}|true|false|20ad37b9');
  v_ord := v_ord + 1;
  SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') INTO v_txt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
     AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels)\M';
  v_out := v_out || jsonb_build_object('s', 'B seguridad', 'o', v_ord, 'k', 'funciones que detectan los rollbacks de s7_92/s7_93', 'v', v_txt, 'e', 'directory_countries,directory_territory_scope,directory_territory_units');
  v_ord := v_ord + 1;
  SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') INTO v_txt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~* '(administrative_unit_closure|au_id_country_level_key|auc_descendant_level_idx|ancestor_unit_id|descendant_unit_id)';
  v_out := v_out || jsonb_build_object('s', 'B seguridad', 'o', v_ord, 'k', 'funciones que detecta el rollback de s7_94 (lectores del cierre)', 'v', v_txt, 'e', 'directory_territory_scope');

  -- C · comportamiento real por rol
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('role', v_rol)::text, true);
    PERFORM set_config('request.jwt.claim.role', v_rol, true);
    FOR rc IN SELECT * FROM (VALUES ('departamento grande', v_dgr, '37'), ('departamento pequeño', v_dpe, '12'),
                                   ('municipio grande', v_mgr, '21'), ('hoja', v_hoja, '1'), ('San Salvador', v_ss, '25')) AS t(nombre, unidad, cuantos) LOOP
      v_esp := (SELECT coalesce(string_agg(s.id::text, ',' ORDER BY s.id), '') FROM (
             SELECT x.id FROM public.administrative_units x WHERE x.id = rc.unidad AND x.is_active
             UNION SELECT c1.id FROM public.administrative_units c1 WHERE c1.parent_id = rc.unidad AND c1.is_active
             UNION SELECT c2.id FROM public.administrative_units c1 JOIN public.administrative_units c2 ON c2.parent_id = c1.id
                    WHERE c1.parent_id = rc.unidad AND c1.is_active AND c2.is_active) s);
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', v_rol);
        SELECT coalesce(string_agg(f.unit_id::text, ',' ORDER BY f.n), '') INTO v_txt
          FROM public.directory_territory_scope('SV', rc.unidad) WITH ORDINALITY AS f(unit_id, n);
        RESET ROLE;
      EXCEPTION WHEN OTHERS THEN v_txt := 'ERROR ' || SQLSTATE;
      END;
      RESET ROLE;
      v_ord := v_ord + 1;
      v_out := v_out || jsonb_build_object('s', 'C comportamiento', 'o', v_ord, 'k', v_rol || ' · ' || rc.nombre || ': ids (orden y arbol por parent_id)',
        'v', coalesce(array_length(string_to_array(nullif(v_txt, ''), ','), 1), 0) || '|' || (v_txt IS NOT DISTINCT FROM v_esp), 'e', rc.cuantos || '|true');
    END LOOP;

    v_ord := v_ord + 1;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_rol);
      SELECT (SELECT count(*) FROM public.directory_territory_scope(NULL, v_dgr)) || '|' || (SELECT count(*) FROM public.directory_territory_scope('', v_dgr)) || '|'
          || (SELECT count(*) FROM public.directory_territory_scope('sv', v_dgr)) || '|' || (SELECT count(*) FROM public.directory_territory_scope('XX', v_dgr)) || '|'
          || (SELECT count(*) FROM public.directory_territory_scope('SV', NULL)) || '|' || (SELECT count(*) FROM public.directory_territory_scope('SV', -1)) || '|'
          || (SELECT count(*) FROM public.directory_territory_scope('HN', v_hoja))
        INTO v_txt;
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN v_txt := 'ERROR ' || SQLSTATE;
    END;
    RESET ROLE;
    v_out := v_out || jsonb_build_object('s', 'C comportamiento', 'o', v_ord, 'k', v_rol || ' · filas con iso NULL | vacio | sv | XX | unidad NULL | -1 | (hoja SV, HN)', 'v', v_txt, 'e', '0|0|0|0|0|0|0');

    v_ord := v_ord + 1;
    v_txt := '';
    FOREACH k IN ARRAY ARRAY['administrative_unit_closure', 'administrative_units', 'countries', 'country_levels'] LOOP
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', v_rol);
        EXECUTE format('SELECT count(*) FROM public.%I', k) INTO v_n;
        RESET ROLE;
        v_txt := v_txt || k || '=LEIDA ';
      EXCEPTION WHEN insufficient_privilege THEN
        v_txt := v_txt || k || '=42501 ';
      END;
      RESET ROLE;
    END LOOP;
    v_out := v_out || jsonb_build_object('s', 'C comportamiento', 'o', v_ord, 'k', v_rol || ' · lectura directa del catalogo y del cierre', 'v', btrim(v_txt),
      'e', 'administrative_unit_closure=42501 administrative_units=42501 countries=42501 country_levels=42501');
  END LOOP;
  v_ord := v_ord + 1;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM count(*) FROM public.directory_territory_scope('SV', v_ss);
    RESET ROLE;
    v_txt := 'EJECUTA';
  EXCEPTION WHEN insufficient_privilege THEN
    v_txt := '42501';
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  v_out := v_out || jsonb_build_object('s', 'C comportamiento', 'o', v_ord, 'k', 'service_role · EXECUTE de directory_territory_scope', 'v', v_txt, 'e', '42501');

  -- D · planes de la consulta del cuerpo (valores literales; informativo + recursion/Seq Scan)
  v_q := 'SELECT cl.descendant_unit_id FROM public.administrative_units a JOIN public.administrative_unit_closure cl ON cl.ancestor_unit_id = a.id AND cl.country_id = %s '
      || 'JOIN public.administrative_units d ON d.id = cl.descendant_unit_id AND d.is_active WHERE a.id = %s AND a.country_id = %s AND a.is_active '
      || 'AND NOT EXISTS (SELECT 1 FROM public.administrative_unit_closure up JOIN public.administrative_units m ON m.id = up.ancestor_unit_id '
      || 'WHERE up.descendant_unit_id = cl.descendant_unit_id AND up.depth > 0 AND NOT m.is_active) ORDER BY cl.descendant_unit_id';
  FOR rc IN SELECT * FROM (VALUES ('departamento grande', v_dgr), ('hoja', v_hoja)) AS t(nombre, unidad) LOOP
    EXECUTE format('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' || v_q, v_sv, rc.unidad, v_sv) INTO v_plan;
    v_ord := v_ord + 1;
    v_out := v_out || jsonb_build_object('s', 'D planes', 'o', v_ord, 'k', rc.nombre || ' · ejecucion ms | planificacion ms | shared hit', 'v',
      (v_plan -> 0 ->> 'Execution Time') || ' | ' || (v_plan -> 0 ->> 'Planning Time') || ' | ' || coalesce(v_plan -> 0 -> 'Plan' ->> 'Shared Hit Blocks', '?'), 'e', '(info)');
    v_ord := v_ord + 1;
    SELECT count(*)::text INTO v_txt
      FROM jsonb_path_query(v_plan, (chr(36) || '.** ? (@."Node Type" == "Recursive Union" || @."Node Type" == "CTE Scan")')::jsonpath);
    v_out := v_out || jsonb_build_object('s', 'D planes', 'o', v_ord, 'k', rc.nombre || ' · nodos Recursive Union / CTE Scan', 'v', v_txt, 'e', '0');
    v_ord := v_ord + 1;
    SELECT count(*)::text INTO v_txt
      FROM jsonb_path_query(v_plan, (chr(36) || '.** ? (@."Node Type" == "Seq Scan" && @."Relation Name" == "administrative_unit_closure")')::jsonpath);
    v_out := v_out || jsonb_build_object('s', 'D planes', 'o', v_ord, 'k', rc.nombre || ' · Seq Scan sobre el cierre', 'v', v_txt, 'e', '0');
  END LOOP;

  -- E · consumo esperado por el Home (datos del preflight F3F PRE-0)
  v_ord := v_ord + 1;
  SELECT (SELECT count(*) FROM public.doctors dr JOIN public.clinics c ON c.id = dr.clinic_id
           WHERE dr.is_published AND c.country_id = v_sv AND c.territory_unit_id IN (SELECT f.unit_id FROM public.directory_territory_scope('SV', v_ss) f))
         || '|' || (SELECT count(*) FROM public.doctors dr JOIN public.clinics c ON c.id = dr.clinic_id
           WHERE dr.is_published AND c.country_id = v_sv AND c.department_id = 'SS')
    INTO v_txt;
  v_out := v_out || jsonb_build_object('s', 'E consumo', 'o', v_ord, 'k', 'publicados en scope San Salvador | por legacy SS', 'v', v_txt, 'e', '9|9');
  v_ord := v_ord + 1;
  SELECT count(*)::text INTO v_txt FROM public.clinics WHERE country_id = v_sv AND territory_unit_id IS NULL AND department_id IS NULL;
  v_out := v_out || jsonb_build_object('s', 'E consumo', 'o', v_ord, 'k', 'clinicas S2 (pais SV, sin territorio ni legacy)', 'v', v_txt, 'e', '36');
  v_ord := v_ord + 1;
  SELECT count(*)::text INTO v_txt FROM public.clinics c
   WHERE c.territory_unit_id IS NULL
     AND c.territory_unit_id IN (SELECT f.unit_id FROM public.administrative_units u
                                  CROSS JOIN LATERAL public.directory_territory_scope('SV', u.id) f
                                  WHERE u.country_id = v_sv);
  v_out := v_out || jsonb_build_object('s', 'E consumo', 'o', v_ord, 'k', 'clinicas sin territorio dentro del scope de CUALQUIER unidad', 'v', v_txt, 'e', '0');
  v_ord := v_ord + 1;
  SELECT count(*)::text INTO v_txt FROM public.clinics c
    JOIN public.administrative_units t ON t.id = c.territory_unit_id
   WHERE c.territory_unit_id NOT IN (SELECT f.unit_id FROM public.directory_territory_scope('SV',
           CASE t.level WHEN 1 THEN t.id WHEN 2 THEN t.parent_id
                        ELSE (SELECT p.parent_id FROM public.administrative_units p WHERE p.id = t.parent_id) END) f);
  v_out := v_out || jsonb_build_object('s', 'E consumo', 'o', v_ord, 'k', 'clinicas con territorio fuera del scope de su departamento', 'v', v_txt, 'e', '0');
  v_ord := v_ord + 1;
  SELECT (SELECT count(*) FROM public.doctors dr JOIN public.clinics c ON c.id = dr.clinic_id WHERE dr.is_published AND c.country_id = v_sv)
         || '|' || (SELECT count(*) FROM public.doctors dr JOIN public.clinics c ON c.id = dr.clinic_id WHERE dr.is_published AND c.country_id = v_sv AND c.territory_unit_id IS NULL)
    INTO v_txt;
  v_out := v_out || jsonb_build_object('s', 'E consumo', 'o', v_ord, 'k', 'publicados con pais SV sin filtro territorial | de ellos sin territorio', 'v', v_txt, 'e', '46|36');

  PERFORM set_config('s7_97.post', v_out::text, true);
END
$s797post$;

WITH r AS (
  SELECT x.s AS seccion, x.o AS orden, x.k AS clave, x.v AS valor, x.e AS esperado,
         CASE WHEN x.e = '(info)' THEN NULL ELSE x.v IS NOT DISTINCT FROM x.e END AS ok
    FROM jsonb_to_recordset(current_setting('s7_97.post', true)::jsonb) AS x(s text, o int, k text, v text, e text)
)
SELECT seccion, orden, clave, valor, esperado, ok FROM r
UNION ALL
SELECT 'Z resultado', 999, 'comprobaciones fallidas', (SELECT count(*) FROM r WHERE ok = false)::text, '0', (SELECT count(*) FROM r WHERE ok = false) = 0
ORDER BY orden;

ROLLBACK;
