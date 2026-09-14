-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK de s7_93 · MULTICOUNTRY-GEO-P0 · F3C · R2 EXACTO
--
-- ⛔ NO EJECUTAR salvo FAIL explicito y autorizacion del owner.
--
-- ⛔ VALIDO SOLO ANTES DE F3D / F3E y mientras NINGUN consumidor lea el modelo
-- nuevo. La PREVIA aborta si encuentra funciones o vistas que lo usen.
--
-- Vacia country_id / territory_unit_id EXCLUSIVAMENTE en los 23 ids que relleno
-- s7_93 (lista C39.5 del preflight v2 de produccion). Antes de tocar nada exige,
-- por cada id, que la fila exista, que su department_id y municipality_id sigan
-- siendo los listados y que su geo siga siendo exactamente la que deriva ese
-- legacy. Si CUALQUIERA cambio despues de s7_93, aborta sin cambios.
--
-- No toca ninguna otra clinica: una geo derivada legitimamente despues por una
-- escritura normal queda intacta (la VERIFICA lo comprueba con huella).
--
-- Para vaciar se desactivan AMBOS triggers solo durante ese UPDATE: sin
-- desactivar trg_clinics_territory_sync el vaciado falla con P0183, y sin
-- desactivar trg_clinics_updated_at se moveria updated_at. Los dos se restauran y
-- se verifican antes del COMMIT.
--
-- ⚠️ ATOMICO. Un unico BEGIN / COMMIT, con el COMMIT DESPUES de la verificacion.
-- lock_timeout de 5 s. Pegar ENTERO en una pestaña nueva del SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.clinics IN SHARE ROW EXCLUSIVE MODE;

DO $PREVIA$
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
  v_n   bigint;
  v_txt text;
BEGIN
  PERFORM set_config('s7_93rb.lista', v_lista, true);

  IF (SELECT count(*) FROM regexp_split_to_table(v_lista, ' ; ')) <> 23 THEN
    RAISE EXCEPTION 'rollback s7_93: la lista no tiene 23 entradas';
  END IF;

  -- Triggers normales y s7_92 en pie.
  SELECT string_agg(t.tgname::text || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 'rollback s7_93: triggers de clinics inesperados (%) — no se revierte', v_txt;
  END IF;

  -- Validez: sin consumidores del modelo nuevo (F3D/F3E no iniciadas).
  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
     AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels)\M';
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'rollback s7_93: hay funciones que usan el modelo nuevo (%) — el rollback ya no es valido', v_txt;
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_depend d
   WHERE d.classid = 'pg_rewrite'::regclass
     AND (d.refobjid IN ('public.administrative_units'::regclass, 'public.countries'::regclass, 'public.country_levels'::regclass)
          OR (d.refobjid = 'public.clinics'::regclass
              AND d.refobjsubid IN (SELECT a.attnum FROM pg_attribute a
                                     WHERE a.attrelid = 'public.clinics'::regclass
                                       AND a.attname IN ('country_id', 'territory_unit_id'))));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'rollback s7_93: hay % dependencias de vistas sobre el modelo nuevo — el rollback ya no es valido', v_n;
  END IF;

  -- Cada una de las 23 filas sigue exactamente en el estado que dejo s7_93.
  SELECT string_agg(l.id::text, ', ' ORDER BY l.id) INTO v_txt
    FROM (SELECT split_part(x.item, '|', 1)::uuid AS id, split_part(x.item, '|', 2) AS dep, split_part(x.item, '|', 3) AS mun
            FROM regexp_split_to_table(v_lista, ' ; ') AS x(item)) l
    LEFT JOIN public.clinics c ON c.id = l.id
    LEFT JOIN LATERAL public._territory_from_legacy_sv(l.dep, l.mun) t ON true
   WHERE c.id IS NULL
      OR c.department_id IS DISTINCT FROM l.dep
      OR c.municipality_id IS DISTINCT FROM l.mun
      OR c.country_id IS NULL
      OR c.territory_unit_id IS NULL
      OR c.country_id IS DISTINCT FROM t.country_id
      OR c.territory_unit_id IS DISTINCT FROM t.territory_unit_id;
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'rollback s7_93: estas filas cambiaron despues de s7_93 (%) — no se revierte', v_txt;
  END IF;

  -- Huellas para la VERIFICA.
  PERFORM set_config('s7_93rb.no_geo',
    (SELECT md5(string_agg((to_jsonb(c) - 'country_id' - 'territory_unit_id')::text, E'\n' ORDER BY c.id)) FROM public.clinics c), true);
  PERFORM set_config('s7_93rb.geo_resto',
    (SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'),
                                    E'\n' ORDER BY c.id), ''))
       FROM public.clinics c
      WHERE c.id::text NOT IN (SELECT split_part(x.item, '|', 1) FROM regexp_split_to_table(v_lista, ' ; ') AS x(item))), true);
  PERFORM set_config('s7_93rb.total', (SELECT count(*) FROM public.clinics)::text, true);
  PERFORM set_config('s7_93rb.acl',
    (SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity::text || '|' || relforcerowsecurity::text
       FROM pg_class WHERE oid = 'public.clinics'::regclass), true);
  PERFORM set_config('s7_93rb.policies',
    (SELECT coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
                                ';' ORDER BY policyname), '')
       FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics'), true);
  PERFORM set_config('s7_93rb.funciones',
    (SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                           || md5(p.prosrc) || coalesce(p.proacl::text, ''), ','
                           ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'), true);

  RAISE NOTICE 'rollback s7_93 PREVIA OK — las 23 filas siguen en el estado de s7_93, sin consumidores';
END $PREVIA$;

-- Ambos triggers fuera, solo durante el vaciado.
ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_territory_sync;
ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;

DO $VACIADO$
DECLARE
  v_n bigint;
BEGIN
  UPDATE public.clinics c
     SET country_id = NULL, territory_unit_id = NULL
    FROM (SELECT split_part(x.item, '|', 1)::uuid AS id, split_part(x.item, '|', 2) AS dep, split_part(x.item, '|', 3) AS mun
            FROM regexp_split_to_table(current_setting('s7_93rb.lista'), ' ; ') AS x(item)) l
   WHERE c.id = l.id
     AND c.department_id = l.dep
     AND c.municipality_id = l.mun
     AND c.country_id IS NOT NULL
     AND c.territory_unit_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 23 THEN
    RAISE EXCEPTION 'rollback s7_93: se vaciaron % filas, se esperaban exactamente 23', v_n;
  END IF;
END $VACIADO$;

ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;
ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_territory_sync;

DO $VERIFICA$
DECLARE
  v_n   bigint;
  v_txt text;
BEGIN
  SELECT string_agg(t.tgname::text || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 'rollback s7_93 VERIFICA: los triggers no quedaron normales (%)', v_txt;
  END IF;

  SELECT count(*) INTO v_n
    FROM (SELECT split_part(x.item, '|', 1)::uuid AS id, split_part(x.item, '|', 2) AS dep, split_part(x.item, '|', 3) AS mun
            FROM regexp_split_to_table(current_setting('s7_93rb.lista'), ' ; ') AS x(item)) l
    JOIN public.clinics c ON c.id = l.id
   WHERE c.department_id = l.dep AND c.municipality_id = l.mun AND c.country_id IS NULL AND c.territory_unit_id IS NULL;
  IF v_n <> 23 THEN RAISE EXCEPTION 'rollback s7_93 VERIFICA: solo % de las 23 quedaron con legacy intacto y geo NULL', v_n; END IF;

  IF (SELECT count(*) FROM public.clinics)::text IS DISTINCT FROM current_setting('s7_93rb.total') THEN
    RAISE EXCEPTION 'rollback s7_93 VERIFICA: cambio el numero de clinicas';
  END IF;
  SELECT md5(string_agg((to_jsonb(c) - 'country_id' - 'territory_unit_id')::text, E'\n' ORDER BY c.id)) INTO v_txt FROM public.clinics c;
  IF v_txt IS DISTINCT FROM current_setting('s7_93rb.no_geo') THEN
    RAISE EXCEPTION 'rollback s7_93 VERIFICA: cambio alguna columna distinta de la geo (updated_at incluido)';
  END IF;
  SELECT md5(coalesce(string_agg(c.id::text || '|' || coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'),
                                 E'\n' ORDER BY c.id), '')) INTO v_txt
    FROM public.clinics c
   WHERE c.id::text NOT IN (SELECT split_part(x.item, '|', 1) FROM regexp_split_to_table(current_setting('s7_93rb.lista'), ' ; ') AS x(item));
  IF v_txt IS DISTINCT FROM current_setting('s7_93rb.geo_resto') THEN
    RAISE EXCEPTION 'rollback s7_93 VERIFICA: cambio la geo de alguna clinica fuera de la lista';
  END IF;

  SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity::text || '|' || relforcerowsecurity::text INTO v_txt
    FROM pg_class WHERE oid = 'public.clinics'::regclass;
  IF v_txt IS DISTINCT FROM current_setting('s7_93rb.acl') THEN
    RAISE EXCEPTION 'rollback s7_93 VERIFICA: cambiaron los privilegios o la RLS de clinics';
  END IF;
  SELECT coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
                             ';' ORDER BY policyname), '') INTO v_txt
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics';
  IF v_txt IS DISTINCT FROM current_setting('s7_93rb.policies') THEN
    RAISE EXCEPTION 'rollback s7_93 VERIFICA: cambiaron las policies de clinics';
  END IF;
  SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                        || md5(p.prosrc) || coalesce(p.proacl::text, ''), ','
                        ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public';
  IF v_txt IS DISTINCT FROM current_setting('s7_93rb.funciones') THEN
    RAISE EXCEPTION 'rollback s7_93 VERIFICA: cambio alguna funcion de public';
  END IF;

  RAISE NOTICE 'rollback s7_93 OK — 23 filas con geo NULL y legacy intacto, triggers normales, resto de clinics intacto';
END $VERIFICA$;

COMMIT;
