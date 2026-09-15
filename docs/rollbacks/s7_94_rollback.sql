-- ============================================================
-- ROLLBACK de s7_94 · MULTICOUNTRY-GEO-P0 · FUNDACION 3D
-- Retira public.administrative_unit_closure y el indice unico
-- public.au_id_country_level_key del catalogo.
-- ============================================================
--
-- ⛔ NO EJECUTAR SIN ORDEN EXPLICITA DEL OWNER.
--
-- ⛔ VALIDO SOLO MIENTRAS:
--   · ningun objeto consuma el cierre (funciones, vistas, policies, triggers,
--     FK que lo referencien, privilegios de cliente, publicaciones);
--   · el catalogo y el cierre sigan EXACTAMENTE como los dejo s7_94 (huellas
--     del preflight). Una carga de otro pais o cualquier edicion del catalogo
--     posterior invalida este rollback: se niega y hay que reevaluar;
--   · F3E no exista.
--
-- ── ORDEN VIGENTE (owner, 2026-09-14) ──
--   rollback de s7_94 -> s7_93 R2 -> verificar estado -> rollback de s7_92.
-- Este archivo es el PRIMER paso de esa cadena y no la ejecuta entera.
--
-- ── QUE HACE ──
--   BEGIN -> lock_timeout 5s -> LOCK SHARE ROW EXCLUSIVE del catalogo -> PREVIA
--   (validez y huellas) -> RETIRO (tabla, luego indice; RESTRICT) -> VERIFICA
--   (ambos ausentes, nada mas cambio) -> COMMIT.
--
-- ── REGLA DEL SQL EDITOR ──
-- Los objetos retirados no existiran al terminar. Por eso el DDL de retiro se
-- ensambla con format() y el texto del archivo no nombra la relacion junto a
-- la orden de retiro.
--
-- Pegar ENTERO en una pestaña nueva. Ante cualquier error del editor,
-- clasificar primero el estado con el bloque read-only del runbook.

BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.administrative_units IN SHARE ROW EXCLUSIVE MODE;


DO $PREVIA$
DECLARE
  v_huella_catalogo CONSTANT text := '460e807050a0da8bea0891965b1b9fd7';
  v_huella_cierre   CONSTANT text := 'af230f5086d871b1cce24e34de4b6cec';
  v_n   bigint;
  v_txt text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'rollback s7_94: ejecutar como postgres (current_user=%)', current_user;
  END IF;
  IF to_regclass('public.administrative_unit_closure') IS NULL OR to_regclass('public.au_id_country_level_key') IS NULL THEN
    RAISE EXCEPTION 'rollback s7_94: s7_94 no esta aplicada completa (cierre o indice ausente) — clasificar el estado antes de nada';
  END IF;

  -- Validez: el cierre y el catalogo siguen como los dejo s7_94.
  SELECT md5(string_agg(u.id || '|' || u.country_id || '|' || coalesce(u.parent_id::text, 'NULL') || '|' || u.level || '|' || u.is_active,
                        E'\n' ORDER BY u.id))
    INTO v_txt FROM public.administrative_units u;
  IF v_txt IS DISTINCT FROM v_huella_catalogo THEN
    RAISE EXCEPTION 'rollback s7_94: el catalogo cambio despues de s7_94 (%) — el rollback ya no es valido', v_txt;
  END IF;
  SELECT count(*) || '|' || md5(string_agg(ancestor_unit_id || '|' || descendant_unit_id || '|' || depth, E'\n' ORDER BY ancestor_unit_id, descendant_unit_id))
    INTO v_txt FROM public.administrative_unit_closure;
  IF v_txt IS DISTINCT FROM '888|' || v_huella_cierre THEN
    RAISE EXCEPTION 'rollback s7_94: el cierre cambio despues de s7_94 (%) — el rollback ya no es valido', v_txt;
  END IF;

  -- Validez: sin consumidores del cierre.
  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~* '(administrative_unit_closure|au_id_country_level_key|auc_descendant_level_idx|ancestor_unit_id|descendant_unit_id)';
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'rollback s7_94: hay funciones que usan el cierre (%) — el rollback ya no es valido', v_txt;
  END IF;
  SELECT count(*) INTO v_n FROM pg_depend d
   WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = 'public.administrative_unit_closure'::regclass;
  IF v_n <> 0 THEN RAISE EXCEPTION 'rollback s7_94: % dependencias de vistas sobre el cierre — el rollback ya no es valido', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE tablename = 'administrative_unit_closure'
      OR coalesce(qual, '') ~* 'administrative_unit_closure' OR coalesce(with_check, '') ~* 'administrative_unit_closure';
  IF v_n <> 0 THEN RAISE EXCEPTION 'rollback s7_94: % policies usan el cierre — el rollback ya no es valido', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_trigger WHERE tgrelid = 'public.administrative_unit_closure'::regclass AND NOT tgisinternal;
  IF v_n <> 0 THEN RAISE EXCEPTION 'rollback s7_94: % triggers de usuario sobre el cierre — el rollback ya no es valido', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.administrative_unit_closure'::regclass;
  IF v_n <> 0 THEN RAISE EXCEPTION 'rollback s7_94: % FK referencian el cierre — el rollback ya no es valido', v_n; END IF;
  SELECT string_agg(conrelid::regclass::text || '.' || conname, ', ' ORDER BY conname) INTO v_txt
    FROM pg_constraint WHERE conindid = 'public.au_id_country_level_key'::regclass;
  IF v_txt IS DISTINCT FROM 'administrative_unit_closure.auc_ancestor_fkey, administrative_unit_closure.auc_descendant_fkey' THEN
    RAISE EXCEPTION 'rollback s7_94: el indice unico del catalogo tiene otros dependientes (%) — el rollback ya no es valido', v_txt;
  END IF;
  IF (SELECT bool_or(has_table_privilege(r.rol, 'public.administrative_unit_closure', x.priv))
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)) THEN
    RAISE EXCEPTION 'rollback s7_94: un rol cliente tiene privilegios sobre el cierre — ya hay un consumidor habilitado';
  END IF;
  SELECT count(*) INTO v_n FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'administrative_unit_closure';
  IF v_n <> 0 THEN RAISE EXCEPTION 'rollback s7_94: el cierre esta en % publicaciones — el rollback ya no es valido', v_n; END IF;

  -- Huellas para la VERIFICA.
  PERFORM set_config('s7_94rb.catalogo_filas',
    (SELECT md5(string_agg(to_jsonb(u)::text, E'\n' ORDER BY u.id)) FROM public.administrative_units u), true);
  PERFORM set_config('s7_94rb.clinics_filas',
    (SELECT md5(coalesce(string_agg(to_jsonb(c)::text, E'\n' ORDER BY c.id), '')) FROM public.clinics c), true);
  PERFORM set_config('s7_94rb.funciones',
    (SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                           || md5(p.prosrc) || coalesce(p.proacl::text, ''), ','
                           ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'), true);
  PERFORM set_config('s7_94rb.acl_catalogo',
    (SELECT string_agg(relname || '=' || coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity, ';' ORDER BY relname)
       FROM pg_class WHERE oid IN ('public.administrative_units'::regclass, 'public.countries'::regclass, 'public.country_levels'::regclass)), true);
  PERFORM set_config('s7_94rb.policies',
    (SELECT md5(coalesce(string_agg(tablename || ':' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
                                    ';' ORDER BY tablename, policyname), ''))
       FROM pg_policies WHERE schemaname = 'public'), true);
  PERFORM set_config('s7_94rb.constraints',
    (SELECT md5(string_agg(con.conrelid::regclass::text || ':' || con.conname || ':' || con.contype::text, ',' ORDER BY con.conrelid::regclass::text, con.conname))
       FROM pg_constraint con WHERE con.connamespace = 'public'::regnamespace
        AND con.conrelid <> 'public.administrative_unit_closure'::regclass), true);
  PERFORM set_config('s7_94rb.indices',
    (SELECT md5(string_agg(c.relname, ',' ORDER BY c.relname))
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'i'
        AND c.relname NOT IN ('administrative_unit_closure_pkey', 'auc_descendant_level_idx', 'au_id_country_level_key')), true);
  PERFORM set_config('s7_94rb.triggers',
    (SELECT md5(coalesce(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text, ',' ORDER BY t.tgrelid::regclass::text, t.tgname), ''))
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal), true);

  RAISE NOTICE 'rollback s7_94 PREVIA OK — cierre y catalogo intactos desde s7_94, sin consumidores';
END $PREVIA$;


DO $RETIRO$
BEGIN
  -- RESTRICT (por defecto): si apareciera un dependiente no detectado, aborta.
  EXECUTE format('DROP TABLE %I.%I', 'public', 'administrative_unit_closure');
  EXECUTE format('DROP INDEX %I.%I', 'public', 'au_id_country_level_key');
  RAISE NOTICE 'rollback s7_94 RETIRO: cierre e indice unico retirados';
END $RETIRO$;


DO $VERIFICA$
DECLARE
  v_huella_catalogo CONSTANT text := '460e807050a0da8bea0891965b1b9fd7';
  v_n   bigint;
  v_txt text;
BEGIN
  IF to_regclass('public.administrative_unit_closure') IS NOT NULL OR to_regclass('public.au_id_country_level_key') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback s7_94 VERIFICA: el cierre o el indice siguen existiendo';
  END IF;
  SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND (c.relname LIKE 'administrative\_unit\_closure%' OR c.relname LIKE 'auc\_%'))
       + (SELECT count(*) FROM pg_constraint WHERE conname LIKE 'auc\_%' OR conname LIKE 'administrative\_unit\_closure%')
       + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typname LIKE 'administrative\_unit\_closure%')
    INTO v_n;
  IF v_n <> 0 THEN RAISE EXCEPTION 'rollback s7_94 VERIFICA: quedan % objetos del cierre', v_n; END IF;

  SELECT md5(string_agg(u.id || '|' || u.country_id || '|' || coalesce(u.parent_id::text, 'NULL') || '|' || u.level || '|' || u.is_active,
                        E'\n' ORDER BY u.id))
    INTO v_txt FROM public.administrative_units u;
  IF v_txt IS DISTINCT FROM v_huella_catalogo THEN RAISE EXCEPTION 'rollback s7_94 VERIFICA: cambio la huella del catalogo'; END IF;
  IF (SELECT md5(string_agg(to_jsonb(u)::text, E'\n' ORDER BY u.id)) FROM public.administrative_units u) IS DISTINCT FROM current_setting('s7_94rb.catalogo_filas') THEN
    RAISE EXCEPTION 'rollback s7_94 VERIFICA: cambio alguna fila del catalogo';
  END IF;
  IF (SELECT md5(coalesce(string_agg(to_jsonb(c)::text, E'\n' ORDER BY c.id), '')) FROM public.clinics c) IS DISTINCT FROM current_setting('s7_94rb.clinics_filas') THEN
    RAISE EXCEPTION 'rollback s7_94 VERIFICA: cambio alguna fila de clinics';
  END IF;
  IF (SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                            || md5(p.prosrc) || coalesce(p.proacl::text, ''), ','
                            ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)))
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') IS DISTINCT FROM current_setting('s7_94rb.funciones') THEN
    RAISE EXCEPTION 'rollback s7_94 VERIFICA: cambio alguna funcion de public';
  END IF;
  IF (SELECT string_agg(relname || '=' || coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity, ';' ORDER BY relname)
        FROM pg_class WHERE oid IN ('public.administrative_units'::regclass, 'public.countries'::regclass, 'public.country_levels'::regclass))
     IS DISTINCT FROM current_setting('s7_94rb.acl_catalogo') THEN
    RAISE EXCEPTION 'rollback s7_94 VERIFICA: cambiaron los privilegios o la RLS del catalogo';
  END IF;
  IF (SELECT md5(coalesce(string_agg(tablename || ':' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
                                     ';' ORDER BY tablename, policyname), ''))
        FROM pg_policies WHERE schemaname = 'public') IS DISTINCT FROM current_setting('s7_94rb.policies') THEN
    RAISE EXCEPTION 'rollback s7_94 VERIFICA: cambio alguna policy de public';
  END IF;
  IF (SELECT md5(string_agg(con.conrelid::regclass::text || ':' || con.conname || ':' || con.contype::text, ',' ORDER BY con.conrelid::regclass::text, con.conname))
        FROM pg_constraint con WHERE con.connamespace = 'public'::regnamespace) IS DISTINCT FROM current_setting('s7_94rb.constraints') THEN
    RAISE EXCEPTION 'rollback s7_94 VERIFICA: cambio alguna constraint fuera del cierre';
  END IF;
  IF (SELECT md5(string_agg(c.relname, ',' ORDER BY c.relname))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'i') IS DISTINCT FROM current_setting('s7_94rb.indices') THEN
    RAISE EXCEPTION 'rollback s7_94 VERIFICA: cambio algun indice fuera de los retirados';
  END IF;
  IF (SELECT md5(coalesce(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text, ',' ORDER BY t.tgrelid::regclass::text, t.tgname), ''))
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT t.tgisinternal) IS DISTINCT FROM current_setting('s7_94rb.triggers') THEN
    RAISE EXCEPTION 'rollback s7_94 VERIFICA: cambio algun trigger de public';
  END IF;

  -- El siguiente paso de la cadena (R2 de s7_93) sigue siendo ejecutable.
  SELECT string_agg(t.tgname::text || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 'rollback s7_94 VERIFICA: triggers de clinics inesperados (%)', v_txt;
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
     AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels)\M';
  IF v_n <> 0 THEN RAISE EXCEPTION 'rollback s7_94 VERIFICA: % funciones invalidarian el R2 de s7_93', v_n; END IF;

  RAISE NOTICE 'rollback s7_94 OK — cierre e indice retirados, catalogo, clinics, funciones, seguridad, constraints, indices y triggers identicos';
END $VERIFICA$;


COMMIT;
