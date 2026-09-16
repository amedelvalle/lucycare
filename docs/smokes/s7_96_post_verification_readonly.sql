-- ════════════════════════════════════════════════════════════════════
-- s7_96 · VERIFICACION POST · en cualquier momento tras aplicar
-- SOLO LECTURA · transaccion READ ONLY que termina SIEMPRE en ROLLBACK · sin datos
-- personales · NO lee auth.users.
-- Ejecuta las RPC como anon y authenticated (y comprueba que service_role no puede),
-- verifica contrato, ACL, catalogo cerrado, consumidores y las referencias de datos
-- del preflight F3E-1A. Las filas de datos (C2, estados, directorio) son «justo tras
-- aplicar»: dejan de valer cuando las clinicas cambien legitimamente.
-- Pegar ENTERO en una pestaña nueva, desde BEGIN hasta ROLLBACK.
-- Salida: tabla del SELECT final (seccion, orden, clave, valor, esperado, ok) + fila Z.
-- ════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';

DO $s796post$
DECLARE
  v_out  jsonb := '[]'::jsonb;
  v_sv   smallint;
  v_par  bigint;
  v_hoja bigint;
  v_rol  text;
  v_txt  text;
  v_esp  text;
  v_n    bigint;
  k      text;
  v_ord  int := 0;
BEGIN
  SELECT id INTO v_sv FROM public.countries WHERE iso_alpha2 = 'SV';
  SELECT u.parent_id INTO v_par FROM public.administrative_units u
   WHERE u.country_id = v_sv AND u.is_active AND u.parent_id IS NOT NULL
   GROUP BY u.parent_id ORDER BY count(*) DESC, u.parent_id LIMIT 1;
  SELECT min(u.id) INTO v_hoja FROM public.administrative_units u
   WHERE u.country_id = v_sv AND u.is_active AND NOT EXISTS (SELECT 1 FROM public.administrative_units ch WHERE ch.parent_id = u.id);

  -- A · objetos y ACL
  v_ord := v_ord + 1;
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('directory_countries', 'directory_territory_units');
  v_out := v_out || jsonb_build_object('s', 'A objetos', 'o', v_ord, 'k', 'funciones directory_* (todos los esquemas)', 'v', v_n::text, 'e', '2');
  FOR k IN SELECT unnest(ARRAY['public.directory_countries()', 'public.directory_territory_units(text, bigint)']) LOOP
    v_ord := v_ord + 1;
    SELECT p.provolatile::text || '|' || p.prosecdef || '|' || coalesce(p.proconfig::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || pg_get_function_result(p.oid)
      INTO v_txt FROM pg_proc p WHERE p.oid = to_regprocedure(k);
    v_out := v_out || jsonb_build_object('s', 'A objetos', 'o', v_ord, 'k', k || ': volatilidad|definer|search_path|dueño|retorno', 'v', coalesce(v_txt, 'NULL'),
      'e', CASE WHEN k LIKE '%countries%' THEN 's|true|{"search_path=public, pg_temp"}|postgres|TABLE(country_id smallint, iso_alpha2 text, country_name text, level smallint, level_label text)'
                ELSE 's|true|{"search_path=public, pg_temp"}|postgres|TABLE(id bigint, name text, level smallint, parent_id bigint)' END);
    v_ord := v_ord + 1;
    SELECT string_agg(a::text, ',' ORDER BY a::text) INTO v_txt FROM pg_proc p, unnest(p.proacl) a WHERE p.oid = to_regprocedure(k);
    v_out := v_out || jsonb_build_object('s', 'A objetos', 'o', v_ord, 'k', k || ': ACL exacta', 'v', coalesce(v_txt, 'NULL'), 'e', 'anon=X/postgres,authenticated=X/postgres,postgres=X/postgres');
    v_ord := v_ord + 1;
    v_txt := CASE WHEN to_regprocedure(k) IS NULL THEN 'NULL' ELSE has_function_privilege('anon', k, 'EXECUTE') || '|' || has_function_privilege('authenticated', k, 'EXECUTE') || '|' || has_function_privilege('service_role', k, 'EXECUTE') END;
    v_out := v_out || jsonb_build_object('s', 'A objetos', 'o', v_ord, 'k', k || ': EXECUTE efectivo anon|authenticated|service_role', 'v', v_txt, 'e', 'true|true|false');
    v_ord := v_ord + 1;
    SELECT md5(prosrc) INTO v_txt FROM pg_proc WHERE oid = to_regprocedure(k);
    v_out := v_out || jsonb_build_object('s', 'A objetos', 'o', v_ord, 'k', k || ': cuerpo igual al artefacto (md5 LF o CRLF)',
      'v', (CASE WHEN k LIKE '%countries%' THEN v_txt IN ('1804439ffc598fa98321da2bf28eec08', 'cf27c8ed4ba4d97f13f99894b7057596') ELSE v_txt IN ('3083c7c5ad5a790c044e89bd7d554afc', '243b51249cb406b28b90fe5087387229') END)::text, 'e', 'true');
  END LOOP;

  -- B · seguridad: catalogo cerrado y consumidores
  v_ord := v_ord + 1;
  SELECT bool_or(has_table_privilege(r.rol, t.tbl, x.priv))::text INTO v_txt
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),
         unnest(ARRAY['public.countries', 'public.country_levels', 'public.administrative_units', 'public.administrative_unit_closure']) t(tbl),
         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv);
  v_out := v_out || jsonb_build_object('s', 'B seguridad', 'o', v_ord, 'k', 'algun rol cliente con privilegios sobre el catalogo GEO', 'v', v_txt, 'e', 'false');
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
  v_out := v_out || jsonb_build_object('s', 'B seguridad', 'o', v_ord, 'k', 'funciones que detectan los rollbacks de s7_92/s7_93 (esperado: solo las RPC)', 'v', v_txt, 'e', 'directory_countries,directory_territory_units');
  v_ord := v_ord + 1;
  SELECT count(*)::text INTO v_txt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~* '(administrative_unit_closure|au_id_country_level_key|auc_descendant_level_idx|ancestor_unit_id|descendant_unit_id)';
  v_out := v_out || jsonb_build_object('s', 'B seguridad', 'o', v_ord, 'k', 'funciones que detecta el rollback de s7_94 (cierre)', 'v', v_txt, 'e', '0');

  -- C · comportamiento real por rol
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('role', v_rol)::text, true);
    PERFORM set_config('request.jwt.claim.role', v_rol, true);

    v_ord := v_ord + 1;
    SELECT string_agg(c.id || '|' || c.iso_alpha2 || '|' || c.name || '|' || l.level || '|' || l.label_singular, ';' ORDER BY c.iso_alpha2, l.level)
      INTO v_esp FROM public.countries c JOIN public.country_levels l ON l.country_id = c.id WHERE c.directory_enabled;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_rol);
      SELECT string_agg(f.country_id || '|' || f.iso_alpha2 || '|' || f.country_name || '|' || f.level || '|' || f.level_label, ';' ORDER BY f.n)
        INTO v_txt FROM public.directory_countries() WITH ORDINALITY AS f(country_id, iso_alpha2, country_name, level, level_label, n);
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN v_txt := 'ERROR ' || SQLSTATE;
    END;
    RESET ROLE;
    v_out := v_out || jsonb_build_object('s', 'C comportamiento', 'o', v_ord, 'k', v_rol || ' · directory_countries() = catalogo habilitado (filas y orden)', 'v', (v_txt IS NOT DISTINCT FROM v_esp)::text, 'e', 'true');
    v_ord := v_ord + 1;
    v_out := v_out || jsonb_build_object('s', 'C comportamiento', 'o', v_ord, 'k', v_rol || ' · directory_countries(): iso|nivel|etiqueta (info)',
      'v', coalesce((SELECT string_agg(split_part(x, '|', 2) || '|' || split_part(x, '|', 4) || '|' || split_part(x, '|', 5), ' ; ') FROM unnest(string_to_array(v_txt, ';')) x), 'NULL'), 'e', '(info)');

    v_ord := v_ord + 1;
    SELECT string_agg(u.id || '|' || u.name || '|' || u.level || '|NULL', ';' ORDER BY u.name, u.id)
      INTO v_esp FROM public.administrative_units u WHERE u.country_id = v_sv AND u.parent_id IS NULL AND u.is_active;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_rol);
      SELECT string_agg(f.id || '|' || f.name || '|' || f.level || '|' || coalesce(f.parent_id::text, 'NULL'), ';' ORDER BY f.n)
        INTO v_txt FROM public.directory_territory_units('SV') WITH ORDINALITY AS f(id, name, level, parent_id, n);
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN v_txt := 'ERROR ' || SQLSTATE;
    END;
    RESET ROLE;
    v_out := v_out || jsonb_build_object('s', 'C comportamiento', 'o', v_ord, 'k', v_rol || ' · raiz de SV = unidades activas sin padre (filas y orden) · filas',
      'v', (v_txt IS NOT DISTINCT FROM v_esp)::text || ' · ' || coalesce(array_length(string_to_array(v_txt, ';'), 1), 0), 'e', 'true · 14');

    v_ord := v_ord + 1;
    SELECT string_agg(u.id || '|' || u.name || '|' || u.level || '|' || u.parent_id, ';' ORDER BY u.name, u.id)
      INTO v_esp FROM public.administrative_units u WHERE u.parent_id = v_par AND u.is_active;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_rol);
      SELECT string_agg(f.id || '|' || f.name || '|' || f.level || '|' || f.parent_id, ';' ORDER BY f.n)
        INTO v_txt FROM public.directory_territory_units('SV', v_par) WITH ORDINALITY AS f(id, name, level, parent_id, n);
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN v_txt := 'ERROR ' || SQLSTATE;
    END;
    RESET ROLE;
    v_out := v_out || jsonb_build_object('s', 'C comportamiento', 'o', v_ord, 'k', v_rol || ' · hijos del padre con mas hijos = hijos activos (filas y orden) · filas',
      'v', (v_txt IS NOT DISTINCT FROM v_esp)::text || ' · ' || coalesce(array_length(string_to_array(v_txt, ';'), 1), 0),
      'e', 'true · ' || (SELECT count(*) FROM public.administrative_units u WHERE u.parent_id = v_par AND u.is_active));

    v_ord := v_ord + 1;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_rol);
      SELECT (SELECT count(*) FROM public.directory_territory_units('XX')) || '|' || (SELECT count(*) FROM public.directory_territory_units(NULL)) || '|'
          || (SELECT count(*) FROM public.directory_territory_units('')) || '|' || (SELECT count(*) FROM public.directory_territory_units('sv')) || '|'
          || (SELECT count(*) FROM public.directory_territory_units('XX', v_par)) || '|' || (SELECT count(*) FROM public.directory_territory_units('SV', -1)) || '|'
          || (SELECT count(*) FROM public.directory_territory_units('SV', v_hoja))
        INTO v_txt;
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN v_txt := 'ERROR ' || SQLSTATE;
    END;
    RESET ROLE;
    v_out := v_out || jsonb_build_object('s', 'C comportamiento', 'o', v_ord, 'k', v_rol || ' · filas con XX | NULL | vacio | sv | (XX, padre) | (SV, -1) | (SV, hoja)', 'v', v_txt, 'e', '0|0|0|0|0|0|0');

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
    v_out := v_out || jsonb_build_object('s', 'C comportamiento', 'o', v_ord, 'k', v_rol || ' · lectura directa del catalogo', 'v', btrim(v_txt),
      'e', 'administrative_unit_closure=42501 administrative_units=42501 countries=42501 country_levels=42501');
  END LOOP;

  v_ord := v_ord + 1;
  v_txt := '';
  FOREACH k IN ARRAY ARRAY['SELECT count(*) FROM public.directory_countries()', 'SELECT count(*) FROM public.directory_territory_units(''SV'')'] LOOP
    BEGIN
      EXECUTE 'SET LOCAL ROLE service_role';
      EXECUTE k INTO v_n;
      RESET ROLE;
      v_txt := v_txt || 'EJECUTA ';
    EXCEPTION WHEN insufficient_privilege THEN
      v_txt := v_txt || '42501 ';
    END;
    RESET ROLE;
  END LOOP;
  v_out := v_out || jsonb_build_object('s', 'C comportamiento', 'o', v_ord, 'k', 'service_role · directory_countries | directory_territory_units', 'v', btrim(v_txt), 'e', '42501 42501');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  -- D · datos de referencia (justo tras aplicar)
  v_ord := v_ord + 1;
  SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
             || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'), E'\n' ORDER BY c.id), ''))
    INTO v_txt FROM public.clinics c;
  v_out := v_out || jsonb_build_object('s', 'D datos', 'o', v_ord, 'k', 'huella C2 de clinics (justo tras aplicar)', 'v', v_txt, 'e', '7cef00d1d24a004edbc4678fe6d41948');
  v_ord := v_ord + 1;
  WITH aud AS (
    SELECT a.record_id, a.new_data ->> 'edited_via' AS via FROM public.audit_log a
     WHERE a.table_name = 'clinics' AND a.new_data ->> 'migration' = 's7_95'
  ), lista AS (
    SELECT record_id AS clinic_id FROM aud GROUP BY record_id
    HAVING count(*) FILTER (WHERE via = 'owner_attestation_f3e0') - count(*) FILTER (WHERE via = 'owner_attestation_f3e0_rollback') = 1
  ), deriv AS (
    SELECT c.id, c.department_id, c.municipality_id, c.country_id, c.territory_unit_id,
           CASE WHEN c.department_id IS NULL THEN NULL
                WHEN c.municipality_id IS NULL THEN
                  (SELECT u.id FROM public.administrative_units u WHERE u.country_id = v_sv AND u.legacy_id = c.department_id AND u.level = 1)
                ELSE
                  (SELECT u3.id FROM public.administrative_units u3
                     JOIN public.administrative_units u2 ON u2.id = u3.parent_id
                     JOIN public.administrative_units u1 ON u1.id = u2.parent_id
                    WHERE u3.country_id = v_sv AND u3.legacy_id = c.municipality_id AND u3.level = 3
                      AND u1.level = 1 AND u1.legacy_id = c.department_id
                      AND EXISTS (SELECT 1 FROM public.municipalities m WHERE m.id = c.municipality_id AND m.department_id = c.department_id))
           END AS esperada
      FROM public.clinics c
  ), cl AS (
    SELECT CASE WHEN d.department_id IS NULL AND d.municipality_id IS NULL AND d.country_id IS NULL AND d.territory_unit_id IS NULL THEN 'S0'
                WHEN d.department_id IS NOT NULL AND d.esperada IS NOT NULL AND d.country_id = v_sv AND d.territory_unit_id = d.esperada THEN 'S1'
                WHEN d.department_id IS NULL AND d.municipality_id IS NULL AND d.territory_unit_id IS NULL AND d.country_id = v_sv
                     AND d.id IN (SELECT clinic_id FROM lista) THEN 'S2'
                ELSE 'ANOMALIA' END AS estado
      FROM deriv d
  )
  SELECT count(*) || '|' || count(*) FILTER (WHERE estado = 'S0') || '|' || count(*) FILTER (WHERE estado = 'S1') || '|'
         || count(*) FILTER (WHERE estado = 'S2') || '|' || count(*) FILTER (WHERE estado = 'ANOMALIA')
    INTO v_txt FROM cl;
  v_out := v_out || jsonb_build_object('s', 'D datos', 'o', v_ord, 'k', 'clinicas total|S0|S1|S2|anomalias (justo tras aplicar)', 'v', v_txt, 'e', '119|59|24|36|0');
  v_ord := v_ord + 1;
  WITH pub AS (
    SELECT c.country_id,
           (coalesce(btrim(p.full_name), '') NOT IN ('', 'Sin nombre') AND d.specialty_id IS NOT NULL
            AND coalesce(btrim(c.name), '') <> '' AND coalesce(btrim(c.address_line), '') <> '') AS visible
      FROM public.doctors d JOIN public.clinics c ON c.id = d.clinic_id LEFT JOIN public.profiles p ON p.id = d.profile_id
     WHERE d.is_published
  )
  SELECT (count(*) || '|' || count(*) FILTER (WHERE country_id IS NOT NULL) || '|' || count(*) FILTER (WHERE country_id IS NULL))
         || '#' || (count(*) FILTER (WHERE visible) || '|' || count(*) FILTER (WHERE visible AND country_id IS NOT NULL) || '|' || count(*) FILTER (WHERE visible AND country_id IS NULL))
    INTO v_txt FROM pub;
  v_out := v_out || jsonb_build_object('s', 'D datos', 'o', v_ord, 'k', 'directorio publicados#visibles D1 (total|con pais|sin pais)', 'v', v_txt, 'e', '46|46|0#43|43|0');
  v_ord := v_ord + 1;
  v_out := v_out || jsonb_build_object('s', 'D datos', 'o', v_ord, 'k', 'current_user (info)', 'v', current_user::text, 'e', '(info)');

  PERFORM set_config('s7_96.post', v_out::text, true);
END
$s796post$;

WITH r AS (
  SELECT x.s AS seccion, x.o AS orden, x.k AS clave, x.v AS valor, x.e AS esperado,
         CASE WHEN x.e = '(info)' THEN NULL ELSE x.v IS NOT DISTINCT FROM x.e END AS ok
    FROM jsonb_to_recordset(current_setting('s7_96.post', true)::jsonb) AS x(s text, o int, k text, v text, e text)
)
SELECT seccion, orden, clave, valor, esperado, ok FROM r
UNION ALL
SELECT 'Z resultado', 999, 'comprobaciones fallidas', (SELECT count(*) FROM r WHERE ok = false)::text, '0', (SELECT count(*) FROM r WHERE ok = false) = 0
ORDER BY orden;

ROLLBACK;
