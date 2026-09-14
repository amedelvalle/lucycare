-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK de s7_92 · MULTICOUNTRY-GEO-P0 · F3B paso 3
--
-- ⛔ NO EJECUTAR salvo FAIL explicito y autorizacion del owner.
--
-- ⛔ VALIDO SOLO ANTES DE F3C / F3E y MIENTRAS NINGUN CONSUMIDOR lea el modelo
-- nuevo (decision E5). La PREVIA aborta si encuentra cualquier otra funcion o
-- vista que use country_id, territory_unit_id o el catalogo territorial.
--
-- Deshace s7_92 y vuelve EXACTAMENTE al estado de F3A:
--   1. quita el trigger trg_clinics_territory_sync y sus dos funciones;
--   2. vuelve a NULL country_id y territory_unit_id en las clinicas que el
--      trigger haya poblado, con trg_clinics_updated_at DESACTIVADO durante ese
--      UPDATE para no alterar updated_at ni ninguna otra columna;
--   3. reinstala la guarda temporal clinics_geo_f3a_temp_null_chk con la misma
--      definicion y el MISMO comentario de s7_89.
-- Grants, RLS y policies de clinics no se tocan en ninguna direccion.
--
-- ⚠️ Revertir PIERDE los valores derivados (se recalculan al reaplicar s7_92 en
-- las filas que vuelvan a escribirse) y vuelve a bloquear las columnas.
--
-- ⚠️ ATOMICO. Un unico BEGIN / COMMIT, con el COMMIT DESPUES de la verificacion.
-- lock_timeout de 5 s: si no se obtiene el lock de clinics, aborta sin cambios.
-- Pegar ENTERO en una pestaña nueva del SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.clinics IN ACCESS EXCLUSIVE MODE;

DO $PREVIA$
DECLARE
  v_n   bigint;
  v_txt text;
BEGIN
  -- Lo que se va a quitar existe, y la guarda no.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.clinics'::regclass
                    AND tgname = 'trg_clinics_territory_sync') THEN
    RAISE EXCEPTION 'rollback s7_92: no existe trg_clinics_territory_sync — no se revierte';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('_territory_from_legacy_sv', '_clinics_territory_sync')) <> 2 THEN
    RAISE EXCEPTION 'rollback s7_92: faltan las funciones de s7_92 — no se revierte';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinics_geo_f3a_temp_null_chk') THEN
    RAISE EXCEPTION 'rollback s7_92: la guarda de F3A ya existe — no se revierte';
  END IF;
  SELECT string_agg(tgname::text, ',' ORDER BY tgname) INTO v_txt
    FROM pg_trigger WHERE tgrelid = 'public.clinics'::regclass AND NOT tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync,trg_clinics_updated_at' THEN
    RAISE EXCEPTION 'rollback s7_92: triggers de clinics inesperados (%) — no se revierte', v_txt;
  END IF;
  IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.clinics'::regclass
       AND tgname = 'trg_clinics_updated_at') <> 'O' THEN
    RAISE EXCEPTION 'rollback s7_92: trg_clinics_updated_at no esta en modo normal — no se revierte';
  END IF;

  -- E5: ningun consumidor del modelo nuevo fuera de s7_92.
  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
     AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels)\M';
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'rollback s7_92: hay funciones que usan el modelo nuevo (%) — el rollback ya no es valido', v_txt;
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_depend d
   WHERE d.classid = 'pg_rewrite'::regclass
     AND (d.refobjid IN ('public.administrative_units'::regclass, 'public.countries'::regclass,
                         'public.country_levels'::regclass)
          OR (d.refobjid = 'public.clinics'::regclass
              AND d.refobjsubid IN (SELECT a.attnum FROM pg_attribute a
                                     WHERE a.attrelid = 'public.clinics'::regclass
                                       AND a.attname IN ('country_id', 'territory_unit_id'))));
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'rollback s7_92: hay % dependencias de vistas sobre el modelo nuevo — el rollback ya no es valido', v_n;
  END IF;

  -- Huellas: todo menos las dos columnas que se vacian.
  PERFORM set_config('s7_92rb.filas',
    (SELECT md5(coalesce(string_agg((to_jsonb(c) - 'country_id' - 'territory_unit_id')::text, E'\n' ORDER BY c.id), ''))
       FROM public.clinics c), true);
  PERFORM set_config('s7_92rb.total', (SELECT count(*) FROM public.clinics)::text, true);
  PERFORM set_config('s7_92rb.acl',
    (SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity::text || '|' || relforcerowsecurity::text
       FROM pg_class WHERE oid = 'public.clinics'::regclass), true);
  PERFORM set_config('s7_92rb.policies',
    (SELECT coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
                                ';' ORDER BY policyname), '')
       FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics'), true);
  PERFORM set_config('s7_92rb.otras_funciones',
    (SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                           || md5(p.prosrc) || coalesce(p.proacl::text, ''), ','
                           ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')), true);

  SELECT count(*) INTO v_n FROM public.clinics WHERE country_id IS NOT NULL OR territory_unit_id IS NOT NULL;
  RAISE NOTICE 'rollback s7_92 PREVIA OK — % clinicas con columnas territoriales pobladas se vaciaran', v_n;
END $PREVIA$;

-- 1. Sincronizacion fuera.
DROP TRIGGER trg_clinics_territory_sync ON public.clinics;
DROP FUNCTION public._clinics_territory_sync();
DROP FUNCTION public._territory_from_legacy_sv(text, text);

-- 2. Columnas nuevas a NULL sin mover updated_at.
ALTER TABLE public.clinics DISABLE TRIGGER trg_clinics_updated_at;
UPDATE public.clinics
   SET country_id = NULL, territory_unit_id = NULL
 WHERE country_id IS NOT NULL OR territory_unit_id IS NOT NULL;
ALTER TABLE public.clinics ENABLE TRIGGER trg_clinics_updated_at;

-- 3. Guarda temporal de F3A, identica a s7_89.
ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_geo_f3a_temp_null_chk
  CHECK (country_id IS NULL AND territory_unit_id IS NULL);

COMMENT ON CONSTRAINT clinics_geo_f3a_temp_null_chk ON public.clinics IS
  'TEMPORAL DE FUNDACION 3A. Mantiene NULL country_id y territory_unit_id '
  'mientras la tabla conserve INSERT/UPDATE de cliente. Solo puede retirarse en '
  'Fundacion 3B, dentro de la misma transicion que establezca el dual-write '
  'controlado y su proteccion. No retirarla sola.';

DO $VERIFICA$
DECLARE
  v_n   bigint;
  v_txt text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_clinics_territory_sync')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('_territory_from_legacy_sv', '_clinics_territory_sync')) THEN
    RAISE EXCEPTION 'rollback s7_92 VERIFICA: quedan objetos de s7_92';
  END IF;
  SELECT string_agg(tgname::text || '[' || tgenabled::text || ']', ',' ORDER BY tgname) INTO v_txt
    FROM pg_trigger WHERE tgrelid = 'public.clinics'::regclass AND NOT tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 'rollback s7_92 VERIFICA: triggers de clinics inesperados (%)', v_txt;
  END IF;

  SELECT count(*) INTO v_n FROM public.clinics WHERE country_id IS NOT NULL OR territory_unit_id IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 'rollback s7_92 VERIFICA: % clinicas con geo', v_n; END IF;
  IF (SELECT count(*) FROM public.clinics)::text IS DISTINCT FROM current_setting('s7_92rb.total') THEN
    RAISE EXCEPTION 'rollback s7_92 VERIFICA: cambio el numero de clinicas';
  END IF;
  SELECT md5(coalesce(string_agg((to_jsonb(c) - 'country_id' - 'territory_unit_id')::text, E'\n' ORDER BY c.id), '')) INTO v_txt
    FROM public.clinics c;
  IF v_txt IS DISTINCT FROM current_setting('s7_92rb.filas') THEN
    RAISE EXCEPTION 'rollback s7_92 VERIFICA: cambio alguna otra columna de clinics (updated_at incluido)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint con
                  WHERE con.conname = 'clinics_geo_f3a_temp_null_chk' AND con.contype = 'c'
                    AND con.conrelid = 'public.clinics'::regclass AND con.convalidated
                    AND lower(regexp_replace(pg_get_constraintdef(con.oid), '[()[:space:]]', '', 'g'))
                        = 'checkcountry_idisnullandterritory_unit_idisnull'
                    AND obj_description(con.oid, 'pg_constraint') =
                        'TEMPORAL DE FUNDACION 3A. Mantiene NULL country_id y territory_unit_id '
                        'mientras la tabla conserve INSERT/UPDATE de cliente. Solo puede retirarse en '
                        'Fundacion 3B, dentro de la misma transicion que establezca el dual-write '
                        'controlado y su proteccion. No retirarla sola.') THEN
    RAISE EXCEPTION 'rollback s7_92 VERIFICA: la guarda de F3A no quedo identica a s7_89';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.clinics'::regclass AND convalidated
         AND conname IN ('clinics_territory_requires_country_chk', 'clinics_country_fkey',
                         'clinics_territory_unit_country_fkey')) <> 3 THEN
    RAISE EXCEPTION 'rollback s7_92 VERIFICA: CHECK estructural o FKs geo ausentes';
  END IF;

  SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity::text || '|' || relforcerowsecurity::text INTO v_txt
    FROM pg_class WHERE oid = 'public.clinics'::regclass;
  IF v_txt IS DISTINCT FROM current_setting('s7_92rb.acl') THEN
    RAISE EXCEPTION 'rollback s7_92 VERIFICA: cambiaron los privilegios o la RLS de clinics';
  END IF;
  SELECT coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
                             ';' ORDER BY policyname), '') INTO v_txt
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics';
  IF v_txt IS DISTINCT FROM current_setting('s7_92rb.policies') THEN
    RAISE EXCEPTION 'rollback s7_92 VERIFICA: cambiaron las policies de clinics';
  END IF;
  SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                        || md5(p.prosrc) || coalesce(p.proacl::text, ''), ','
                        ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public';
  IF v_txt IS DISTINCT FROM current_setting('s7_92rb.otras_funciones') THEN
    RAISE EXCEPTION 'rollback s7_92 VERIFICA: cambio alguna otra funcion de public';
  END IF;

  RAISE NOTICE 'rollback s7_92 OK — sincronizacion retirada, columnas NULL, guarda F3A reinstalada, resto de clinics intacto';
END $VERIFICA$;

COMMIT;
