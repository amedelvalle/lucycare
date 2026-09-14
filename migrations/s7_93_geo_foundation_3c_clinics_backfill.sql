-- ============================================================
-- s7_93 · MULTICOUNTRY-GEO-P0 · FUNDACION 3C
-- Backfill historico de clinics.country_id / territory_unit_id
-- ============================================================
--
-- Migracion 114. Rellena la geo de las 23 clinicas historicas que tienen
-- ubicacion legacy coherente y geo NULL, medidas en el preflight v2 de
-- produccion del 2026-09-14 (Z = 0):
--   119 clinicas = 96 sin ubicacion + 0 solo departamento + 23 departamento y
--   municipio coherentes + 0 incoherentes; 0 ya derivadas; 0 divergencias.
--
-- ── DECISIONES DEL OWNER (C1-C6) ──
--   · C1: updated_at se conserva. Solo se desactiva trg_clinics_updated_at
--     alrededor del UPDATE; trg_clinics_territory_sync sigue ACTIVO y valida
--     cada fila (P0183 si el valor no fuera el que deriva el legacy).
--   · C2: huella bloqueante sobre (id, department_id, municipality_id,
--     country_id, territory_unit_id) de TODAS las clinicas, orden por id.
--     Debe ser exactamente la del preflight; si difiere, STOP y repetir preflight.
--   · C3: rollback exacto R2 en docs/rollbacks/s7_93_rollback.sql, limitado a
--     los mismos 23 ids.
--   · C4: STOP ante incoherencias o divergencias.
--   · C5: las clinicas sin ubicacion legacy permanecen sin geo. Sin inferencias.
--   · C6: una sola transaccion.
--
-- ── QUE HACE ──
--   · exige bajo lock la huella C39 y que el conjunto pendiente
--     id|department_id|municipality_id sea EXACTAMENTE la lista C39.5;
--   · actualiza SOLO esos 23 ids, y solo si su legacy sigue siendo el listado y
--     su geo sigue NULL;
--   · country_id / territory_unit_id salen EXCLUSIVAMENTE del resolver vivo
--     public._territory_from_legacy_sv; exige exactamente 23 filas;
--   · POST dentro de la transaccion: 96 sin ubicacion y sin geo, 23 derivadas a
--     nivel 3 con su legacy_id, 0 pendientes, 0 divergencias, 0 nivel 2, y
--     ninguna columna distinta de las dos geo cambiada (updated_at incluido).
--
-- ── QUE NO HACE ──
-- No crea objetos, no toca grants, RLS, policies ni funciones. No toca las 96
-- clinicas sin ubicacion. No usa telefonos ni heuristicos. Sin F3D/F3E, sin UI,
-- sin otros paises.
--
-- ── LOCK ──
-- SET LOCAL lock_timeout = 5s y LOCK SHARE ROW EXCLUSIVE al inicio del PASO 2:
-- bloquea escrituras sobre clinics, no lecturas. Si no se obtiene, aborta sin
-- cambios. Desactivar un trigger es DDL: pgrst_ddl_watch notifica una recarga de
-- esquema de PostgREST al COMMIT, inocua.
--
-- ── COMO APLICARLA ──
-- BLOQUES AUTONOMOS, cada uno pegado ENTERO en una pestaña nueva:
--   PASO 1 = seccion 0      · guardas PRE · solo lectura
--   PASO 2 = secciones 1-6  · BEGIN -> ... -> POST -> COMMIT
-- Si el PASO 1 lanza excepcion, NO continuar. Ante cualquier error del editor,
-- clasificar primero el estado con el bloque read-only del runbook.


-- ─── 0. Guardas PRE (solo lectura) ──────────────────────────
DO $PRE$
DECLARE
  v_lista CONSTANT text :=
    '220fbc6a-91f9-4098-95ab-55cef178dd80|SO|SO-06 ; '
    '30baca1a-09aa-47d2-9918-ca4b0def6554|LP|LP-15 ; '
    '8319a5ed-1fde-451b-a572-d151c22e6616|SS|SS-12 ; '
    '8b24611d-6b7d-4f2c-bbf5-ec53f5c4bded|LI|LI-21 ; '
    '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0|SS|SS-12 ; '
    'a83a625b-527b-423d-8088-1d79ef494013|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000001|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000002|SA|SA-05 ; '
    'c0000001-0000-0000-0000-000000000003|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000004|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000005|SM|SM-09 ; '
    'c0000001-0000-0000-0000-000000000006|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000007|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000008|LI|LI-21 ; '
    'c0000001-0000-0000-0000-000000000009|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000010|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000011|LI|LI-11 ; '
    'c0000001-0000-0000-0000-000000000012|SS|SS-12 ; '
    'c3983794-0963-47f4-aea7-c5ec636555b4|SS|SS-12 ; '
    'c5061c92-8e19-4244-870f-7d738e5b6fa1|SO|SO-07 ; '
    'cc53c91f-af6f-4873-b7bf-61db7be4306d|SS|SS-12 ; '
    'e5d0b444-8fc9-42fa-bfb1-b83b4d057d76|SS|SS-12 ; '
    'f7882a4c-69aa-48fc-aa0b-9d7e2192ec0d|SS|SS-12';
  v_huella CONSTANT text := '63a5e35b49e91f904df565b2d1717475';
  v_n   bigint;
  v_txt text;
BEGIN
  -- C2: huella de los datos relevantes de TODAS las clinicas.
  SELECT md5(coalesce(string_agg(
           c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|' ||
           coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'),
           E'\n' ORDER BY c.id), ''))
    INTO v_txt FROM public.clinics c;
  IF v_txt IS DISTINCT FROM v_huella THEN
    RAISE EXCEPTION 's7_93 PRE: la huella C2 cambio desde el preflight (%): STOP y repetir preflight', v_txt;
  END IF;

  -- C39.5: el conjunto pendiente es exactamente la lista.
  SELECT coalesce(string_agg(c.id::text || '|' || c.department_id || '|' || coalesce(c.municipality_id, 'NULL'), ' ; ' ORDER BY c.id), '(ninguna)')
    INTO v_txt
    FROM public.clinics c
   WHERE c.department_id IS NOT NULL AND c.country_id IS NULL AND c.territory_unit_id IS NULL;
  IF v_txt IS DISTINCT FROM v_lista THEN
    RAISE EXCEPTION 's7_93 PRE: el conjunto pendiente no es la lista C39.5: STOP y repetir preflight';
  END IF;

  -- C4: sin incoherencias ni geo previa.
  SELECT count(*) INTO v_n
    FROM public.clinics c
   WHERE (c.municipality_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.municipalities m WHERE m.id = c.municipality_id AND m.department_id = c.department_id))
      OR (c.department_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.id = c.department_id));
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_93 PRE: % clinicas incoherentes: STOP', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.clinics WHERE country_id IS NOT NULL OR territory_unit_id IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_93 PRE: % clinicas ya tienen geo — no reaplicar', v_n; END IF;

  -- Recuentos del preflight.
  IF (SELECT count(*) FROM public.clinics) <> 119
     OR (SELECT count(*) FROM public.clinics WHERE department_id IS NULL AND municipality_id IS NULL) <> 96
     OR (SELECT count(*) FROM public.clinics WHERE department_id IS NOT NULL AND municipality_id IS NULL) <> 0 THEN
    RAISE EXCEPTION 's7_93 PRE: recuentos distintos de 119 / 96 / 0: STOP y repetir preflight';
  END IF;

  -- s7_92 en pie: triggers normales, funciones intactas, guarda F3A ausente.
  SELECT string_agg(t.tgname::text || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 's7_93 PRE: triggers de clinics inesperados (%)', v_txt;
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND ((p.proname = '_territory_from_legacy_sv' AND md5(p.prosrc) IN ('b8a0d02700685b5d340c8ab1ebfcec17', 'bdb0723c0257b31fe1aaa2bfc609dd6c'))
           OR (p.proname = '_clinics_territory_sync' AND md5(p.prosrc) IN ('d472f713d7cb54581f0cc7a374c52185', '0cecd35ba759d9fbc84b1f98a82a0202')))) <> 2 THEN
    RAISE EXCEPTION 's7_93 PRE: las funciones de s7_92 no son las aplicadas';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinics_geo_f3a_temp_null_chk') THEN
    RAISE EXCEPTION 's7_93 PRE: la guarda F3A existe: s7_92 no esta aplicada';
  END IF;

  -- Sin consumidores del modelo nuevo (F3D/F3E no iniciadas).
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
     AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels)\M';
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_93 PRE: % funciones consumen el modelo nuevo: STOP', v_n; END IF;

  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 's7_93 PRE: aplicar como postgres (current_user=%)', current_user;
  END IF;

  RAISE NOTICE 's7_93: guardas PRE OK — huella C2 y lista C39.5 exactas, 119 / 96 / 23, sin geo previa, s7_92 en pie';
END $PRE$;


-- ═══════════════════════════════════════════════════════════
-- PASO 2 · EL BACKFILL — secciones 1 a 6, en UNA transaccion
-- ═══════════════════════════════════════════════════════════
BEGIN;

SET LOCAL lock_timeout = '5s';


-- ─── 1. Lock: bloquea escrituras, no lecturas ────────────────
LOCK TABLE public.clinics IN SHARE ROW EXCLUSIVE MODE;


-- ─── 2. GUARDA bajo lock: huella, lista y huellas para el POST ─
DO $GUARDA$
DECLARE
  v_lista CONSTANT text :=
    '220fbc6a-91f9-4098-95ab-55cef178dd80|SO|SO-06 ; '
    '30baca1a-09aa-47d2-9918-ca4b0def6554|LP|LP-15 ; '
    '8319a5ed-1fde-451b-a572-d151c22e6616|SS|SS-12 ; '
    '8b24611d-6b7d-4f2c-bbf5-ec53f5c4bded|LI|LI-21 ; '
    '8ea0fd8f-87a9-45f9-8f4e-f358764f58c0|SS|SS-12 ; '
    'a83a625b-527b-423d-8088-1d79ef494013|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000001|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000002|SA|SA-05 ; '
    'c0000001-0000-0000-0000-000000000003|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000004|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000005|SM|SM-09 ; '
    'c0000001-0000-0000-0000-000000000006|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000007|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000008|LI|LI-21 ; '
    'c0000001-0000-0000-0000-000000000009|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000010|SS|SS-12 ; '
    'c0000001-0000-0000-0000-000000000011|LI|LI-11 ; '
    'c0000001-0000-0000-0000-000000000012|SS|SS-12 ; '
    'c3983794-0963-47f4-aea7-c5ec636555b4|SS|SS-12 ; '
    'c5061c92-8e19-4244-870f-7d738e5b6fa1|SO|SO-07 ; '
    'cc53c91f-af6f-4873-b7bf-61db7be4306d|SS|SS-12 ; '
    'e5d0b444-8fc9-42fa-bfb1-b83b4d057d76|SS|SS-12 ; '
    'f7882a4c-69aa-48fc-aa0b-9d7e2192ec0d|SS|SS-12';
  v_huella CONSTANT text := '63a5e35b49e91f904df565b2d1717475';
  v_n   bigint;
  v_txt text;
BEGIN
  SELECT md5(coalesce(string_agg(
           c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|' ||
           coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'),
           E'\n' ORDER BY c.id), ''))
    INTO v_txt FROM public.clinics c;
  IF v_txt IS DISTINCT FROM v_huella THEN
    RAISE EXCEPTION 's7_93 GUARDA: la huella C2 cambio (%): STOP y repetir preflight', v_txt;
  END IF;

  SELECT coalesce(string_agg(c.id::text || '|' || c.department_id || '|' || coalesce(c.municipality_id, 'NULL'), ' ; ' ORDER BY c.id), '(ninguna)')
    INTO v_txt
    FROM public.clinics c
   WHERE c.department_id IS NOT NULL AND c.country_id IS NULL AND c.territory_unit_id IS NULL;
  IF v_txt IS DISTINCT FROM v_lista THEN
    RAISE EXCEPTION 's7_93 GUARDA: el conjunto pendiente no es la lista C39.5: STOP y repetir preflight';
  END IF;

  SELECT count(*) INTO v_n
    FROM public.clinics c
   WHERE (c.municipality_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.municipalities m WHERE m.id = c.municipality_id AND m.department_id = c.department_id))
      OR (c.department_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.id = c.department_id));
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_93 GUARDA: % clinicas incoherentes: STOP', v_n; END IF;

  SELECT string_agg(t.tgname::text || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 's7_93 GUARDA: triggers de clinics inesperados (%)', v_txt;
  END IF;

  -- La lista viaja a las secciones siguientes como ajuste local a la transaccion.
  PERFORM set_config('s7_93.lista', v_lista, true);

  -- Huellas para el POST.
  PERFORM set_config('s7_93.no_geo',
    (SELECT md5(string_agg((to_jsonb(c) - 'country_id' - 'territory_unit_id')::text, E'\n' ORDER BY c.id)) FROM public.clinics c), true);
  PERFORM set_config('s7_93.acl',
    (SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity::text || '|' || relforcerowsecurity::text
       FROM pg_class WHERE oid = 'public.clinics'::regclass), true);
  PERFORM set_config('s7_93.policies',
    (SELECT coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
                                ';' ORDER BY policyname), '')
       FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics'), true);
  PERFORM set_config('s7_93.funciones',
    (SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                           || md5(p.prosrc) || coalesce(p.proacl::text, ''), ','
                           ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'), true);

  RAISE NOTICE 's7_93 GUARDA: clinics bloqueada para escritura, huella C2 y lista C39.5 exactas';
END $GUARDA$;


-- ─── 3. C1: solo el trigger de updated_at, solo durante el UPDATE ─
ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;


-- ─── 4. Backfill de los 23 ids, desde el resolver vivo ───────
DO $BACKFILL$
DECLARE
  v_n bigint;
BEGIN
  UPDATE public.clinics c
     SET (country_id, territory_unit_id) =
         (SELECT t.country_id, t.territory_unit_id
            FROM public._territory_from_legacy_sv(c.department_id, c.municipality_id) t)
    FROM (SELECT split_part(x.item, '|', 1)::uuid AS id,
                 split_part(x.item, '|', 2)       AS dep,
                 split_part(x.item, '|', 3)       AS mun
            FROM regexp_split_to_table(current_setting('s7_93.lista'), ' ; ') AS x(item)) l
   WHERE c.id = l.id
     AND c.department_id = l.dep
     AND c.municipality_id = l.mun
     AND c.country_id IS NULL
     AND c.territory_unit_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 23 THEN
    RAISE EXCEPTION 's7_93 BACKFILL: se actualizaron % filas, se esperaban exactamente 23', v_n;
  END IF;
  RAISE NOTICE 's7_93 BACKFILL: 23 filas, valores del resolver validados por trg_clinics_territory_sync';
END $BACKFILL$;


-- ─── 5. Restaurar el trigger de updated_at ───────────────────
ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;


-- ─── 6. Guardas POST — DENTRO de la transaccion ──────────────
DO $POST$
DECLARE
  v_n   bigint;
  v_txt text;
BEGIN
  SELECT string_agg(t.tgname::text || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 's7_93 POST: los triggers no quedaron normales (%)', v_txt;
  END IF;

  -- 119 clinicas; 96 sin ubicacion y sin geo; 0 pendientes; 0 geo parcial.
  IF (SELECT count(*) FROM public.clinics) <> 119 THEN
    RAISE EXCEPTION 's7_93 POST: cambio el numero de clinicas';
  END IF;
  SELECT count(*) INTO v_n FROM public.clinics
   WHERE department_id IS NULL AND municipality_id IS NULL AND country_id IS NULL AND territory_unit_id IS NULL;
  IF v_n <> 96 THEN RAISE EXCEPTION 's7_93 POST: esperaba 96 sin ubicacion y sin geo, hay %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.clinics
   WHERE department_id IS NULL AND municipality_id IS NULL AND (country_id IS NOT NULL OR territory_unit_id IS NOT NULL);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_93 POST: % clinicas sin ubicacion recibieron geo', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.clinics
   WHERE department_id IS NOT NULL AND (country_id IS NULL OR territory_unit_id IS NULL);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_93 POST: quedan % pendientes o con geo parcial', v_n; END IF;

  -- Las 23 de la lista: derivadas a nivel 3 de su propio municipio, en SV, igual al resolver.
  SELECT count(*) INTO v_n
    FROM (SELECT split_part(x.item, '|', 1)::uuid AS id, split_part(x.item, '|', 2) AS dep, split_part(x.item, '|', 3) AS mun
            FROM regexp_split_to_table(current_setting('s7_93.lista'), ' ; ') AS x(item)) l
    JOIN public.clinics c ON c.id = l.id AND c.department_id = l.dep AND c.municipality_id = l.mun
    JOIN public.administrative_units u ON u.id = c.territory_unit_id
    JOIN public.countries co ON co.id = c.country_id
    CROSS JOIN LATERAL public._territory_from_legacy_sv(l.dep, l.mun) t
   WHERE u.level = 3 AND u.legacy_id = l.mun AND u.country_id = c.country_id AND co.iso_alpha2 = 'SV'
     AND c.country_id = t.country_id AND c.territory_unit_id = t.territory_unit_id;
  IF v_n <> 23 THEN RAISE EXCEPTION 's7_93 POST: solo % de las 23 quedaron derivadas correctamente', v_n; END IF;

  -- Solo las 23 de la lista tienen geo.
  SELECT count(*) INTO v_n FROM public.clinics c
   WHERE (c.country_id IS NOT NULL OR c.territory_unit_id IS NOT NULL)
     AND c.id::text NOT IN (SELECT split_part(x.item, '|', 1) FROM regexp_split_to_table(current_setting('s7_93.lista'), ' ; ') AS x(item));
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_93 POST: % clinicas fuera de la lista tienen geo', v_n; END IF;

  -- 0 divergencias en toda la tabla y 0 unidades de nivel 2.
  SELECT count(*) INTO v_n FROM public.clinics c
    CROSS JOIN LATERAL public._territory_from_legacy_sv(c.department_id, c.municipality_id) t
   WHERE c.country_id IS DISTINCT FROM t.country_id OR c.territory_unit_id IS DISTINCT FROM t.territory_unit_id;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_93 POST: % divergencias entre legacy y geo', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.clinics c JOIN public.administrative_units u ON u.id = c.territory_unit_id WHERE u.level = 2;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_93 POST: % clinicas apuntan a nivel 2', v_n; END IF;

  -- Ninguna columna distinta de las dos geo cambio (updated_at incluido).
  SELECT md5(string_agg((to_jsonb(c) - 'country_id' - 'territory_unit_id')::text, E'\n' ORDER BY c.id)) INTO v_txt FROM public.clinics c;
  IF v_txt IS DISTINCT FROM current_setting('s7_93.no_geo') THEN
    RAISE EXCEPTION 's7_93 POST: cambio alguna columna distinta de country_id / territory_unit_id';
  END IF;

  -- Seguridad y funciones intactas.
  SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity::text || '|' || relforcerowsecurity::text INTO v_txt
    FROM pg_class WHERE oid = 'public.clinics'::regclass;
  IF v_txt IS DISTINCT FROM current_setting('s7_93.acl') THEN
    RAISE EXCEPTION 's7_93 POST: cambiaron los privilegios o la RLS de clinics';
  END IF;
  SELECT coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
                             ';' ORDER BY policyname), '') INTO v_txt
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics';
  IF v_txt IS DISTINCT FROM current_setting('s7_93.policies') THEN
    RAISE EXCEPTION 's7_93 POST: cambiaron las policies de clinics';
  END IF;
  SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                        || md5(p.prosrc) || coalesce(p.proacl::text, ''), ','
                        ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public';
  IF v_txt IS DISTINCT FROM current_setting('s7_93.funciones') THEN
    RAISE EXCEPTION 's7_93 POST: cambio alguna funcion de public';
  END IF;

  RAISE NOTICE 's7_93: guardas POST OK — 23 derivadas a nivel 3, 96 sin ubicacion sin geo, 0 pendientes, 0 divergencias, 0 nivel 2, resto de columnas intacto';
END $POST$;


COMMIT;
-- ═══════════════════════════════════════════════════════════
-- FIN DEL PASO 2.
-- Todo corre DENTRO de la transaccion: si cualquier guarda lanza, se revierte
-- entero y trg_clinics_updated_at vuelve a su estado previo (habilitado).
-- ═══════════════════════════════════════════════════════════
