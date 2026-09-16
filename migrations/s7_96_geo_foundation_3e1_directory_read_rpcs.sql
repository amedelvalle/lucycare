-- ============================================================
-- s7_96 · MULTICOUNTRY-GEO-P0 · F3E-1
-- Superficie publica de LECTURA del catalogo territorial: dos RPC estrechos
-- ============================================================
--
-- Migracion 117. Crea EXCLUSIVAMENTE dos funciones de lectura:
--   · public.directory_countries()
--       una fila por (pais habilitado para directorio, nivel territorial):
--       country_id, iso_alpha2, country_name, level, level_label;
--       ordenada por iso_alpha2 y level. Generica: no asume tres niveles.
--   · public.directory_territory_units(p_country_iso text, p_parent_id bigint DEFAULT NULL)
--       id, name, level, parent_id de las unidades ACTIVAS:
--         p_parent_id NULL  -> unidades raiz del pais;
--         p_parent_id dado  -> hijos activos de ese padre, solo si el padre es
--                              activo y pertenece al pais pedido.
--       ISO inexistente, pais no habilitado, ISO NULL/vacio, padre ajeno,
--       inexistente o inactivo -> CONJUNTO VACIO, nunca excepcion.
--       El ISO se compara EXACTO (mayusculas, como lo guarda countries con su
--       CHECK ^[A-Z]{2}$): 'sv' devuelve vacio.
--
-- ── CONTRATO APROBADO POR EL OWNER (F3E-1, 2026-09-16) ──
--   · sin has_children (el preflight midio que puede degradar a scan global);
--   · sin legacy_id, official_code, fuentes, booking_enabled ni cierre;
--   · country_id se entrega para filtrar clinics.country_id en runtime, pero la
--     identidad externa sigue siendo iso_alpha2: el id NO es constante, URL ni
--     configuracion;
--   · ningun dato de tenant, usuario, clinica, medico, paciente ni membresia.
--
-- ── SEGURIDAD ──
-- Las tablas GEO tienen RLS activa, 0 policies y 0 privilegios de cliente
-- (preflight F3E-1A de produccion, PG 17.6). Leerlas sin abrir grants exige
-- SECURITY DEFINER con dueño postgres (dueño de las tablas; RLS no forzada).
--   · STABLE, search_path fijo, referencias calificadas, columnas allowlisted;
--   · sin SQL dinamico, sin auth.uid(), sin tablas fuera del catalogo;
--   · los DEFAULT PRIVILEGES de public conceden EXECUTE a anon, authenticated y
--     service_role en funciones nuevas: NO se depende de ellos. REVOKE ALL a
--     PUBLIC, anon, authenticated y service_role, y despues GRANT EXECUTE solo a
--     anon y authenticated. El POST exige la ACL exacta.
--
-- ── LO QUE NO TOCA ──
-- Ni RLS, ni policies, ni grants/ACL de tablas, ni roles, ni ownership existente,
-- ni clinics, doctors, profiles, pacientes, membresias ni datos. El POST compara
-- huellas de todo eso contra una instantanea tomada en la misma transaccion
-- (REPEATABLE READ) y exige ademas las constantes del preflight.
--
-- ── ROLLBACK Y CONSUMIDORES ──
-- docs/rollbacks/s7_96_rollback.sql. Los cuerpos nombran el catalogo, asi que los
-- rollbacks historicos de s7_92, s7_93 y s7_95 los detectan como consumidores y
-- se niegan (medido); el de s7_94 no (no usan el cierre). Orden OBLIGATORIO:
--   revertir frontend F3E-2 -> s7_96 -> s7_95 -> s7_94 -> s7_93 R2 -> verificar -> s7_92.
-- Un consumidor de frontend NO es detectable desde la base: revertirlo primero.
--
-- ── COMO APLICARLA ──
-- BLOQUES AUTONOMOS, cada uno pegado ENTERO en una pestaña nueva:
--   PASO 1 = seccion 0      · guardas PRE · solo lectura
--   PASO 2 = secciones 1-6  · BEGIN -> GUARDA -> funciones -> privilegios -> POST -> COMMIT
-- Si el PASO 1 lanza excepcion, NO continuar. Ante cualquier error del editor,
-- clasificar primero con docs/smokes/s7_96_state_readonly.sql.
-- Runbook: docs/OWNER_S7_96_APPLY.md.


-- ─── 0. Guardas PRE (solo lectura) ──────────────────────────
DO $PRE$
DECLARE
  v_etapa      CONSTANT text := 'PRE';
  -- Constantes del preflight F3E-1A de produccion (2026-09-16), aprobadas por el owner.
  v_c2         CONSTANT text := '7cef00d1d24a004edbc4678fe6d41948';
  v_estados    CONSTANT text := '119|59|24|36|0';
  v_lista      CONSTANT text := '36|783399dce61a926b523d637311faeed5fdc22908984cb12fb3fe543b926489e8';
  v_publicados CONSTANT text := '46|46|0';
  v_visibles   CONSTANT text := '43|43|0';
  v_paises     CONSTANT text := 'SV';
  v_niveles    CONSTANT text := 'SV:1,2,3';
  v_unidades   CONSTANT text := '14|44|262|0';
  v_clinics    CONSTANT text := '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}|true|false';
  v_policies   CONSTANT text := '20ad37b9';
  v_geo        CONSTANT text := 'administrative_unit_closure={postgres=arwdDxtm/postgres}|true|false|postgres|0;administrative_units={postgres=arwdDxtm/postgres}|true|false|postgres|0;countries={postgres=arwdDxtm/postgres}|true|false|postgres|0;country_levels={postgres=arwdDxtm/postgres}|true|false|postgres|0';
  v_sv   smallint;
  v_txt  text;
  v_n    bigint;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 's7_96 %: debe ejecutarse como postgres (dueño de las tablas GEO), no como %', v_etapa, current_user;
  END IF;
  IF NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 's7_96 %: % no tiene CREATE en el esquema public', v_etapa, current_user;
  END IF;

  -- No reaplicar ni colisionar.
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('directory_countries', 'directory_territory_units');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_96 %: ya existen % funciones directory_countries/directory_territory_units — s7_96 aplicada o colision: NO reaplicar', v_etapa, v_n;
  END IF;

  -- Runtime de s7_92 presente y normal.
  IF to_regprocedure('public._territory_from_legacy_sv(text, text)') IS NULL
     OR to_regprocedure('public._clinics_territory_sync()') IS NULL THEN
    RAISE EXCEPTION 's7_96 %: falta el runtime de s7_92 — fuera del alcance', v_etapa;
  END IF;
  SELECT string_agg(t.tgname || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 's7_96 %: triggers de clinics inesperados (%)', v_etapa, v_txt;
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
    RAISE EXCEPTION 's7_96 %: el catalogo GEO no esta cerrado como en el preflight (%)', v_etapa, v_txt;
  END IF;
  IF (SELECT bool_or(has_table_privilege(r.rol, t.tbl, x.priv))
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),
             unnest(ARRAY['public.countries', 'public.country_levels', 'public.administrative_units', 'public.administrative_unit_closure']) t(tbl),
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)) THEN
    RAISE EXCEPTION 's7_96 %: un rol cliente tiene privilegios sobre el catalogo GEO', v_etapa;
  END IF;

  -- clinics: privilegios, RLS y policies como en el preflight.
  SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity INTO v_txt
    FROM pg_class WHERE oid = 'public.clinics'::regclass;
  IF v_txt IS DISTINCT FROM v_clinics THEN
    RAISE EXCEPTION 's7_96 %: privilegios o RLS de clinics distintos del preflight (%)', v_etapa, v_txt;
  END IF;
  SELECT left(md5(coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ';' ORDER BY policyname), '')), 8)
    INTO v_txt FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics';
  IF v_txt IS DISTINCT FROM v_policies THEN
    RAISE EXCEPTION 's7_96 %: policies de clinics distintas del preflight (%)', v_etapa, v_txt;
  END IF;

  -- Sin consumidores del modelo territorial (predicado del rollback de s7_95).
  SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
             AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels|administrative_unit_closure)\M')
       + (SELECT count(*) FROM pg_depend dp JOIN pg_attribute a ON a.attrelid = dp.refobjid AND a.attnum = dp.refobjsubid
           WHERE dp.classid = 'pg_rewrite'::regclass AND dp.refobjid = 'public.clinics'::regclass AND a.attname IN ('country_id', 'territory_unit_id'))
       + (SELECT count(*) FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '\m(country_id|territory_unit_id)\M')
    INTO v_n;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_96 %: ya hay % consumidores del modelo territorial — fuera del alcance', v_etapa, v_n;
  END IF;

  -- Paises, niveles y unidades.
  SELECT coalesce(string_agg(iso_alpha2, ',' ORDER BY iso_alpha2), '') INTO v_txt FROM public.countries WHERE directory_enabled;
  IF v_txt IS DISTINCT FROM v_paises THEN
    RAISE EXCEPTION 's7_96 %: paises habilitados distintos del preflight (%)', v_etapa, v_txt;
  END IF;
  SELECT coalesce(string_agg(s.x, ';' ORDER BY s.x), '') INTO v_txt
    FROM (SELECT c.iso_alpha2 || ':' || string_agg(l.level::text, ',' ORDER BY l.level) AS x
            FROM public.countries c JOIN public.country_levels l ON l.country_id = c.id
           WHERE c.directory_enabled GROUP BY c.iso_alpha2) s;
  IF v_txt IS DISTINCT FROM v_niveles THEN
    RAISE EXCEPTION 's7_96 %: niveles de los paises habilitados distintos del preflight (%)', v_etapa, v_txt;
  END IF;
  SELECT id INTO STRICT v_sv FROM public.countries WHERE iso_alpha2 = 'SV';
  SELECT count(*) FILTER (WHERE level = 1 AND is_active) || '|' || count(*) FILTER (WHERE level = 2 AND is_active) || '|'
         || count(*) FILTER (WHERE level = 3 AND is_active) || '|' || count(*) FILTER (WHERE NOT is_active)
    INTO v_txt FROM public.administrative_units WHERE country_id = v_sv;
  IF v_txt IS DISTINCT FROM v_unidades THEN
    RAISE EXCEPTION 's7_96 %: unidades de SV distintas del preflight (%)', v_etapa, v_txt;
  END IF;
  SELECT count(*) INTO v_n FROM public.administrative_units WHERE (parent_id IS NULL) <> (level = 1);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_96 %: % unidades rompen raiz <=> nivel 1', v_etapa, v_n;
  END IF;

  -- Datos: huella C2 de clinics, estados del invariante v2 y directorio.
  SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
             || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'), E'\n' ORDER BY c.id), ''))
    INTO v_txt FROM public.clinics c;
  IF v_txt IS DISTINCT FROM v_c2 THEN
    RAISE EXCEPTION 's7_96 %: la huella C2 de clinics cambio desde el preflight (%) — STOP, repetir preflight', v_etapa, v_txt;
  END IF;
  WITH aud AS (
    SELECT a.record_id, a.new_data ->> 'edited_via' AS via FROM public.audit_log a
     WHERE a.table_name = 'clinics' AND a.new_data ->> 'migration' = 's7_95'
  ), lista AS (
    SELECT record_id AS clinic_id FROM aud GROUP BY record_id
    HAVING count(*) FILTER (WHERE via = 'owner_attestation_f3e0') - count(*) FILTER (WHERE via = 'owner_attestation_f3e0_rollback') = 1
  )
  SELECT count(*) || '|' || encode(sha256(convert_to(coalesce(string_agg(clinic_id::text, E'\n' ORDER BY clinic_id), ''), 'UTF8')), 'hex')
    INTO v_txt FROM lista;
  IF v_txt IS DISTINCT FROM v_lista THEN
    RAISE EXCEPTION 's7_96 %: lista atestada de s7_95 distinta del preflight (%)', v_etapa, v_txt;
  END IF;
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
  IF v_txt IS DISTINCT FROM v_estados THEN
    RAISE EXCEPTION 's7_96 %: estados S0/S1/S2 distintos del preflight (%)', v_etapa, v_txt;
  END IF;
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
  IF v_txt IS DISTINCT FROM v_publicados || '#' || v_visibles THEN
    RAISE EXCEPTION 's7_96 %: directorio distinto del preflight (%)', v_etapa, v_txt;
  END IF;

  RAISE NOTICE 's7_96 % OK — catalogo cerrado, sin consumidores, datos y directorio iguales al preflight', v_etapa;
END
$PRE$;


-- ─── 1. Transaccion (PASO 2) ────────────────────────────────
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';

-- ─── 2. GUARDA: las mismas comprobaciones que el PRE ────────
DO $GUARDA$
DECLARE
  v_etapa      CONSTANT text := 'GUARDA';
  -- Constantes del preflight F3E-1A de produccion (2026-09-16), aprobadas por el owner.
  v_c2         CONSTANT text := '7cef00d1d24a004edbc4678fe6d41948';
  v_estados    CONSTANT text := '119|59|24|36|0';
  v_lista      CONSTANT text := '36|783399dce61a926b523d637311faeed5fdc22908984cb12fb3fe543b926489e8';
  v_publicados CONSTANT text := '46|46|0';
  v_visibles   CONSTANT text := '43|43|0';
  v_paises     CONSTANT text := 'SV';
  v_niveles    CONSTANT text := 'SV:1,2,3';
  v_unidades   CONSTANT text := '14|44|262|0';
  v_clinics    CONSTANT text := '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}|true|false';
  v_policies   CONSTANT text := '20ad37b9';
  v_geo        CONSTANT text := 'administrative_unit_closure={postgres=arwdDxtm/postgres}|true|false|postgres|0;administrative_units={postgres=arwdDxtm/postgres}|true|false|postgres|0;countries={postgres=arwdDxtm/postgres}|true|false|postgres|0;country_levels={postgres=arwdDxtm/postgres}|true|false|postgres|0';
  v_sv   smallint;
  v_txt  text;
  v_n    bigint;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 's7_96 %: debe ejecutarse como postgres (dueño de las tablas GEO), no como %', v_etapa, current_user;
  END IF;
  IF NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 's7_96 %: % no tiene CREATE en el esquema public', v_etapa, current_user;
  END IF;

  -- No reaplicar ni colisionar.
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('directory_countries', 'directory_territory_units');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_96 %: ya existen % funciones directory_countries/directory_territory_units — s7_96 aplicada o colision: NO reaplicar', v_etapa, v_n;
  END IF;

  -- Runtime de s7_92 presente y normal.
  IF to_regprocedure('public._territory_from_legacy_sv(text, text)') IS NULL
     OR to_regprocedure('public._clinics_territory_sync()') IS NULL THEN
    RAISE EXCEPTION 's7_96 %: falta el runtime de s7_92 — fuera del alcance', v_etapa;
  END IF;
  SELECT string_agg(t.tgname || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 's7_96 %: triggers de clinics inesperados (%)', v_etapa, v_txt;
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
    RAISE EXCEPTION 's7_96 %: el catalogo GEO no esta cerrado como en el preflight (%)', v_etapa, v_txt;
  END IF;
  IF (SELECT bool_or(has_table_privilege(r.rol, t.tbl, x.priv))
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),
             unnest(ARRAY['public.countries', 'public.country_levels', 'public.administrative_units', 'public.administrative_unit_closure']) t(tbl),
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)) THEN
    RAISE EXCEPTION 's7_96 %: un rol cliente tiene privilegios sobre el catalogo GEO', v_etapa;
  END IF;

  -- clinics: privilegios, RLS y policies como en el preflight.
  SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity INTO v_txt
    FROM pg_class WHERE oid = 'public.clinics'::regclass;
  IF v_txt IS DISTINCT FROM v_clinics THEN
    RAISE EXCEPTION 's7_96 %: privilegios o RLS de clinics distintos del preflight (%)', v_etapa, v_txt;
  END IF;
  SELECT left(md5(coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ';' ORDER BY policyname), '')), 8)
    INTO v_txt FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics';
  IF v_txt IS DISTINCT FROM v_policies THEN
    RAISE EXCEPTION 's7_96 %: policies de clinics distintas del preflight (%)', v_etapa, v_txt;
  END IF;

  -- Sin consumidores del modelo territorial (predicado del rollback de s7_95).
  SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
             AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels|administrative_unit_closure)\M')
       + (SELECT count(*) FROM pg_depend dp JOIN pg_attribute a ON a.attrelid = dp.refobjid AND a.attnum = dp.refobjsubid
           WHERE dp.classid = 'pg_rewrite'::regclass AND dp.refobjid = 'public.clinics'::regclass AND a.attname IN ('country_id', 'territory_unit_id'))
       + (SELECT count(*) FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '\m(country_id|territory_unit_id)\M')
    INTO v_n;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_96 %: ya hay % consumidores del modelo territorial — fuera del alcance', v_etapa, v_n;
  END IF;

  -- Paises, niveles y unidades.
  SELECT coalesce(string_agg(iso_alpha2, ',' ORDER BY iso_alpha2), '') INTO v_txt FROM public.countries WHERE directory_enabled;
  IF v_txt IS DISTINCT FROM v_paises THEN
    RAISE EXCEPTION 's7_96 %: paises habilitados distintos del preflight (%)', v_etapa, v_txt;
  END IF;
  SELECT coalesce(string_agg(s.x, ';' ORDER BY s.x), '') INTO v_txt
    FROM (SELECT c.iso_alpha2 || ':' || string_agg(l.level::text, ',' ORDER BY l.level) AS x
            FROM public.countries c JOIN public.country_levels l ON l.country_id = c.id
           WHERE c.directory_enabled GROUP BY c.iso_alpha2) s;
  IF v_txt IS DISTINCT FROM v_niveles THEN
    RAISE EXCEPTION 's7_96 %: niveles de los paises habilitados distintos del preflight (%)', v_etapa, v_txt;
  END IF;
  SELECT id INTO STRICT v_sv FROM public.countries WHERE iso_alpha2 = 'SV';
  SELECT count(*) FILTER (WHERE level = 1 AND is_active) || '|' || count(*) FILTER (WHERE level = 2 AND is_active) || '|'
         || count(*) FILTER (WHERE level = 3 AND is_active) || '|' || count(*) FILTER (WHERE NOT is_active)
    INTO v_txt FROM public.administrative_units WHERE country_id = v_sv;
  IF v_txt IS DISTINCT FROM v_unidades THEN
    RAISE EXCEPTION 's7_96 %: unidades de SV distintas del preflight (%)', v_etapa, v_txt;
  END IF;
  SELECT count(*) INTO v_n FROM public.administrative_units WHERE (parent_id IS NULL) <> (level = 1);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_96 %: % unidades rompen raiz <=> nivel 1', v_etapa, v_n;
  END IF;

  -- Datos: huella C2 de clinics, estados del invariante v2 y directorio.
  SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|'
             || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'), E'\n' ORDER BY c.id), ''))
    INTO v_txt FROM public.clinics c;
  IF v_txt IS DISTINCT FROM v_c2 THEN
    RAISE EXCEPTION 's7_96 %: la huella C2 de clinics cambio desde el preflight (%) — STOP, repetir preflight', v_etapa, v_txt;
  END IF;
  WITH aud AS (
    SELECT a.record_id, a.new_data ->> 'edited_via' AS via FROM public.audit_log a
     WHERE a.table_name = 'clinics' AND a.new_data ->> 'migration' = 's7_95'
  ), lista AS (
    SELECT record_id AS clinic_id FROM aud GROUP BY record_id
    HAVING count(*) FILTER (WHERE via = 'owner_attestation_f3e0') - count(*) FILTER (WHERE via = 'owner_attestation_f3e0_rollback') = 1
  )
  SELECT count(*) || '|' || encode(sha256(convert_to(coalesce(string_agg(clinic_id::text, E'\n' ORDER BY clinic_id), ''), 'UTF8')), 'hex')
    INTO v_txt FROM lista;
  IF v_txt IS DISTINCT FROM v_lista THEN
    RAISE EXCEPTION 's7_96 %: lista atestada de s7_95 distinta del preflight (%)', v_etapa, v_txt;
  END IF;
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
  IF v_txt IS DISTINCT FROM v_estados THEN
    RAISE EXCEPTION 's7_96 %: estados S0/S1/S2 distintos del preflight (%)', v_etapa, v_txt;
  END IF;
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
  IF v_txt IS DISTINCT FROM v_publicados || '#' || v_visibles THEN
    RAISE EXCEPTION 's7_96 %: directorio distinto del preflight (%)', v_etapa, v_txt;
  END IF;

  RAISE NOTICE 's7_96 % OK — catalogo cerrado, sin consumidores, datos y directorio iguales al preflight', v_etapa;
END
$GUARDA$;

-- Instantanea de todo lo que s7_96 NO debe cambiar (misma expresion en el POST).
DO $SNAP$
BEGIN
  PERFORM set_config('s7_96.snap', (
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
END
$SNAP$;


-- ─── 3. directory_countries() ───────────────────────────────
CREATE FUNCTION public.directory_countries()
RETURNS TABLE (country_id smallint, iso_alpha2 text, country_name text, level smallint, level_label text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT c.id, c.iso_alpha2, c.name, l.level, l.label_singular
    FROM public.countries c
    JOIN public.country_levels l ON l.country_id = c.id
   WHERE c.directory_enabled
   ORDER BY c.iso_alpha2, l.level;
$fn$;


-- ─── 4. directory_territory_units(p_country_iso, p_parent_id) ───
CREATE FUNCTION public.directory_territory_units(p_country_iso text, p_parent_id bigint DEFAULT NULL)
RETURNS TABLE (id bigint, name text, level smallint, parent_id bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_country smallint;
BEGIN
  SELECT c.id INTO v_country
    FROM public.countries c
   WHERE c.iso_alpha2 = p_country_iso
     AND c.directory_enabled;

  IF v_country IS NULL THEN
    RETURN;
  END IF;

  IF p_parent_id IS NULL THEN
    RETURN QUERY
      SELECT u.id, u.name, u.level, u.parent_id
        FROM public.administrative_units u
       WHERE u.country_id = v_country
         AND u.level = 1
         AND u.parent_id IS NULL
         AND u.is_active
       ORDER BY u.name, u.id;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT u.id, u.name, u.level, u.parent_id
      FROM public.administrative_units u
     WHERE u.parent_id = p_parent_id
       AND u.country_id = v_country
       AND u.is_active
       AND EXISTS (SELECT 1
                     FROM public.administrative_units pa
                    WHERE pa.id = p_parent_id
                      AND pa.country_id = v_country
                      AND pa.is_active)
     ORDER BY u.name, u.id;
END
$fn$;


-- ─── 5. Dueño y privilegios explicitos ──────────────────────
ALTER FUNCTION public.directory_countries() OWNER TO postgres;
ALTER FUNCTION public.directory_territory_units(text, bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.directory_countries() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.directory_territory_units(text, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.directory_countries() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.directory_territory_units(text, bigint) TO anon, authenticated;

COMMENT ON FUNCTION public.directory_countries() IS
  's7_96 (F3E-1): paises habilitados para directorio y sus niveles territoriales, una fila por nivel. '
  'country_id es interno y solo sirve para filtrar clinics.country_id en runtime; la identidad externa es iso_alpha2.';
COMMENT ON FUNCTION public.directory_territory_units(text, bigint) IS
  's7_96 (F3E-1): unidades territoriales activas de un pais habilitado; raiz con p_parent_id NULL, hijos con p_parent_id. '
  'ISO invalido o deshabilitado, o padre ajeno, inexistente o inactivo: conjunto vacio.';


-- ─── 6. POST ────────────────────────────────────────────────
DO $POST$
DECLARE
  v_c2         CONSTANT text := '7cef00d1d24a004edbc4678fe6d41948';
  v_publicados CONSTANT text := '46|46|0';
  v_visibles   CONSTANT text := '43|43|0';
  v_acl        CONSTANT text := 'anon=X/postgres,authenticated=X/postgres,postgres=X/postgres';
  v_md5_countries CONSTANT text[] := ARRAY['1804439ffc598fa98321da2bf28eec08', 'cf27c8ed4ba4d97f13f99894b7057596'];
  v_md5_units     CONSTANT text[] := ARRAY['3083c7c5ad5a790c044e89bd7d554afc', '243b51249cb406b28b90fe5087387229'];
  v_sv    smallint;
  v_par   bigint;
  v_hoja  bigint;
  v_rol   text;
  v_txt   text;
  v_esp   text;
  v_n     bigint;
  v_fallos text := '';
  v_antes jsonb;
  v_ahora jsonb;
  k       text;
BEGIN
  SELECT id INTO STRICT v_sv FROM public.countries WHERE iso_alpha2 = 'SV';

  -- 6.1 Objetos: exactamente las dos funciones, con firma, retorno, volatilidad,
  -- SECURITY DEFINER, search_path, dueño, lenguaje y cuerpo exactos.
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('directory_countries', 'directory_territory_units');
  IF v_n <> 2 THEN v_fallos := v_fallos || ' | funciones directory_* = ' || v_n; END IF;
  SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
                    || ' vol=' || p.provolatile::text || ' def=' || p.prosecdef || ' lang=' || l.lanname
                    || ' cfg=' || coalesce(p.proconfig::text, '') || ' owner=' || pg_get_userbyid(p.proowner)
                    || ' args=' || pg_get_function_arguments(p.oid), E'\n' ORDER BY p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('directory_countries', 'directory_territory_units');
  IF v_txt IS DISTINCT FROM
       'directory_countries() TABLE(country_id smallint, iso_alpha2 text, country_name text, level smallint, level_label text) vol=s def=true lang=sql cfg={"search_path=public, pg_temp"} owner=postgres args=' || E'\n'
    || 'directory_territory_units(p_country_iso text, p_parent_id bigint) TABLE(id bigint, name text, level smallint, parent_id bigint) vol=s def=true lang=plpgsql cfg={"search_path=public, pg_temp"} owner=postgres args=p_country_iso text, p_parent_id bigint DEFAULT NULL::bigint' THEN
    v_fallos := v_fallos || ' | forma de las funciones: ' || coalesce(v_txt, 'NULL');
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.directory_countries()'::regprocedure) <> ALL (v_md5_countries) THEN
    v_fallos := v_fallos || ' | cuerpo de directory_countries distinto del artefacto';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.directory_territory_units(text, bigint)'::regprocedure) <> ALL (v_md5_units) THEN
    v_fallos := v_fallos || ' | cuerpo de directory_territory_units distinto del artefacto';
  END IF;

  -- 6.2 ACL exacta: solo el dueño, anon y authenticated; nada para PUBLIC ni service_role.
  FOR k IN SELECT unnest(ARRAY['public.directory_countries()', 'public.directory_territory_units(text, bigint)']) LOOP
    SELECT string_agg(a::text, ',' ORDER BY a::text) INTO v_txt FROM pg_proc p, unnest(p.proacl) a WHERE p.oid = k::regprocedure;
    IF v_txt IS DISTINCT FROM v_acl THEN v_fallos := v_fallos || ' | ACL de ' || k || ': ' || coalesce(v_txt, 'NULL'); END IF;
    IF NOT has_function_privilege('anon', k, 'EXECUTE') OR NOT has_function_privilege('authenticated', k, 'EXECUTE')
       OR has_function_privilege('service_role', k, 'EXECUTE') THEN
      v_fallos := v_fallos || ' | EXECUTE efectivo de ' || k || ' incorrecto';
    END IF;
  END LOOP;

  -- 6.3 Catalogo GEO sigue cerrado al cliente.
  IF (SELECT bool_or(has_table_privilege(r.rol, t.tbl, x.priv))
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),
             unnest(ARRAY['public.countries', 'public.country_levels', 'public.administrative_units', 'public.administrative_unit_closure']) t(tbl),
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)) THEN
    v_fallos := v_fallos || ' | un rol cliente tiene privilegios sobre el catalogo GEO';
  END IF;

  -- 6.4 Nada mas cambio: misma expresion que la instantanea.
  v_antes := current_setting('s7_96.snap', true)::jsonb;
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
  IF v_antes IS NULL THEN
    v_fallos := v_fallos || ' | falta la instantanea de la GUARDA';
  ELSE
    FOR k IN SELECT jsonb_object_keys(v_antes) LOOP
      IF k = 'n_funciones_public' THEN
        IF (v_ahora ->> k)::bigint <> (v_antes ->> k)::bigint + 2 THEN
          v_fallos := v_fallos || ' | funciones en public: antes ' || (v_antes ->> k) || ', ahora ' || (v_ahora ->> k) || ' (esperado +2)';
        END IF;
      ELSIF (v_ahora ->> k) IS DISTINCT FROM (v_antes ->> k) THEN
        v_fallos := v_fallos || ' | cambio ' || k;
      END IF;
    END LOOP;
  END IF;
  IF (v_ahora ->> 'clinics_c2') IS DISTINCT FROM v_c2 THEN
    v_fallos := v_fallos || ' | huella C2 de clinics distinta de la de referencia';
  END IF;
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
  IF v_txt IS DISTINCT FROM v_publicados || '#' || v_visibles THEN
    v_fallos := v_fallos || ' | directorio: ' || v_txt;
  END IF;

  -- 6.5 Consumidores: los rollbacks historicos detectan exactamente estas dos funciones.
  SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
     AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels)\M';
  IF v_txt IS DISTINCT FROM 'directory_countries,directory_territory_units' THEN
    v_fallos := v_fallos || ' | consumidores para s7_92/s7_93: ' || v_txt;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~* '(administrative_unit_closure|au_id_country_level_key|auc_descendant_level_idx|ancestor_unit_id|descendant_unit_id)';
  IF v_n <> 0 THEN v_fallos := v_fallos || ' | consumidores del cierre (s7_94): ' || v_n; END IF;

  -- 6.6 Comportamiento real bajo anon y authenticated (y service_role denegado).
  SELECT u.parent_id INTO v_par FROM public.administrative_units u
   WHERE u.country_id = v_sv AND u.is_active AND u.parent_id IS NOT NULL
   GROUP BY u.parent_id ORDER BY count(*) DESC, u.parent_id LIMIT 1;
  SELECT min(u.id) INTO v_hoja FROM public.administrative_units u
   WHERE u.country_id = v_sv AND u.is_active AND NOT EXISTS (SELECT 1 FROM public.administrative_units ch WHERE ch.parent_id = u.id);

  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('role', v_rol)::text, true);
    PERFORM set_config('request.jwt.claim.role', v_rol, true);

    -- paises: mismas filas y mismo orden que el catalogo.
    SELECT string_agg(c.id || '|' || c.iso_alpha2 || '|' || c.name || '|' || l.level || '|' || l.label_singular, ';' ORDER BY c.iso_alpha2, l.level)
      INTO v_esp FROM public.countries c JOIN public.country_levels l ON l.country_id = c.id WHERE c.directory_enabled;
    EXECUTE format('SET LOCAL ROLE %I', v_rol);
    SELECT string_agg(f.country_id || '|' || f.iso_alpha2 || '|' || f.country_name || '|' || f.level || '|' || f.level_label, ';' ORDER BY f.n)
      INTO v_txt FROM public.directory_countries() WITH ORDINALITY AS f(country_id, iso_alpha2, country_name, level, level_label, n);
    RESET ROLE;
    IF v_txt IS DISTINCT FROM v_esp THEN v_fallos := v_fallos || ' | ' || v_rol || ' directory_countries: ' || coalesce(v_txt, 'NULL'); END IF;

    -- raiz de SV.
    SELECT string_agg(u.id || '|' || u.name || '|' || u.level || '|NULL', ';' ORDER BY u.name, u.id)
      INTO v_esp FROM public.administrative_units u WHERE u.country_id = v_sv AND u.parent_id IS NULL AND u.is_active;
    EXECUTE format('SET LOCAL ROLE %I', v_rol);
    SELECT string_agg(f.id || '|' || f.name || '|' || f.level || '|' || coalesce(f.parent_id::text, 'NULL'), ';' ORDER BY f.n)
      INTO v_txt FROM public.directory_territory_units('SV') WITH ORDINALITY AS f(id, name, level, parent_id, n);
    RESET ROLE;
    IF v_txt IS DISTINCT FROM v_esp THEN v_fallos := v_fallos || ' | ' || v_rol || ' raiz SV distinta'; END IF;

    -- hijos del padre con mas hijos.
    SELECT string_agg(u.id || '|' || u.name || '|' || u.level || '|' || u.parent_id, ';' ORDER BY u.name, u.id)
      INTO v_esp FROM public.administrative_units u WHERE u.parent_id = v_par AND u.is_active;
    EXECUTE format('SET LOCAL ROLE %I', v_rol);
    SELECT string_agg(f.id || '|' || f.name || '|' || f.level || '|' || f.parent_id, ';' ORDER BY f.n)
      INTO v_txt FROM public.directory_territory_units('SV', v_par) WITH ORDINALITY AS f(id, name, level, parent_id, n);
    RESET ROLE;
    IF v_txt IS DISTINCT FROM v_esp THEN v_fallos := v_fallos || ' | ' || v_rol || ' hijos de ' || v_par || ' distintos'; END IF;

    -- contratos invalidos: conjunto vacio, sin excepcion.
    EXECUTE format('SET LOCAL ROLE %I', v_rol);
    SELECT (SELECT count(*) FROM public.directory_territory_units('XX'))
         + (SELECT count(*) FROM public.directory_territory_units(NULL))
         + (SELECT count(*) FROM public.directory_territory_units(''))
         + (SELECT count(*) FROM public.directory_territory_units('sv'))
         + (SELECT count(*) FROM public.directory_territory_units('XX', v_par))
         + (SELECT count(*) FROM public.directory_territory_units('SV', -1))
         + (SELECT count(*) FROM public.directory_territory_units('SV', v_hoja))
      INTO v_n;
    RESET ROLE;
    IF v_n <> 0 THEN v_fallos := v_fallos || ' | ' || v_rol || ' contratos invalidos devolvieron ' || v_n || ' filas'; END IF;

    -- lectura directa del catalogo: denegada.
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
    PERFORM count(*) FROM public.directory_countries();
    RESET ROLE;
    v_fallos := v_fallos || ' | service_role pudo ejecutar directory_countries';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM count(*) FROM public.directory_territory_units('SV');
    RESET ROLE;
    v_fallos := v_fallos || ' | service_role pudo ejecutar directory_territory_units';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  IF v_fallos <> '' THEN
    RAISE EXCEPTION 's7_96 POST fallo:%', v_fallos;
  END IF;
  RAISE NOTICE 's7_96 POST OK — 2 RPC con contrato, ACL y comportamiento exactos; catalogo cerrado; nada mas cambio';
END
$POST$;

COMMIT;
