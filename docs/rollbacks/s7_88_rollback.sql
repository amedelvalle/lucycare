-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK de s7_88 · MULTICOUNTRY-GEO-P0 · Fundacion 2A
--
-- ⛔ NO EJECUTAR salvo FAIL explicito y autorizacion del owner.
--
-- s7_88 solo INSERTA en `administrative_units`. No altero esquema, no toco
-- `departments`, `municipalities`, `clinics` ni ninguna FK previa, y no leyo ni
-- escribio ninguna fila del modelo vigente. Por eso este rollback es un DELETE
-- acotado al pais SV y no tiene que restaurar nada.
--
-- ⚠️ ATOMICO. El borrado y su verificacion van dentro de un unico
-- `BEGIN; ... COMMIT;`, con el COMMIT DESPUES de la verificacion: si algo no
-- cuadra, la excepcion aborta y NO se borra nada.
--
-- ⚠️ COMPROBACION PREVIA — si algo de esto devuelve algo distinto de 0, hay
--    dependencias sobre las unidades y ESTE ROLLBACK FALLARA o perdera datos.
--    Detenerse y consultar al owner:
--
--      -- ¿alguien apunta ya a administrative_units?
--      SELECT count(*) FROM pg_constraint con
--        JOIN pg_class tgt ON tgt.oid = con.confrelid
--        JOIN pg_class src ON src.oid = con.conrelid
--       WHERE con.contype = 'f'
--         AND tgt.relname = 'administrative_units'
--         AND src.relname <> 'administrative_units';
--
--      -- ¿hay unidades de otro pais? (este rollback NO las toca)
--      SELECT count(*) FROM public.administrative_units
--       WHERE country_id <> (SELECT id FROM public.countries WHERE iso_alpha2 = 'SV');
--
--    Si Fundacion 3 ya hubiera poblado `clinics.territory_unit_id`, borrar
--    estas unidades romperia esa FK: revertir Fundacion 3 primero.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- Orden inverso de nivel: los hijos primero, por la FK compuesta al padre.
DELETE FROM public.administrative_units
 WHERE country_id = (SELECT id FROM public.countries WHERE iso_alpha2 = 'SV')
   AND level = 3;

DELETE FROM public.administrative_units
 WHERE country_id = (SELECT id FROM public.countries WHERE iso_alpha2 = 'SV')
   AND level = 2;

DELETE FROM public.administrative_units
 WHERE country_id = (SELECT id FROM public.countries WHERE iso_alpha2 = 'SV')
   AND level = 1;

-- ─── Verificacion del rollback ─────────────────────────────────────────
DO $ROLLBACK$
DECLARE
  v_pais smallint;
  v_n    int;
BEGIN
  SELECT id INTO STRICT v_pais FROM public.countries WHERE iso_alpha2 = 'SV';

  SELECT count(*) INTO v_n FROM public.administrative_units WHERE country_id = v_pais;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'rollback s7_88: quedan % unidades de SV', v_n;
  END IF;

  -- Lo que el rollback NO puede llevarse por delante.
  SELECT count(*) INTO v_n FROM public.countries;
  IF v_n < 1 THEN RAISE EXCEPTION 'rollback s7_88: countries quedo vacia'; END IF;

  SELECT count(*) INTO v_n FROM public.country_levels WHERE country_id = v_pais;
  IF v_n <> 3 THEN RAISE EXCEPTION 'rollback s7_88: los niveles de SV quedaron en %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.departments;
  IF v_n <> 14 THEN RAISE EXCEPTION 'rollback s7_88: departments quedo en %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.municipalities;
  IF v_n <> 262 THEN RAISE EXCEPTION 'rollback s7_88: municipalities quedo en %', v_n; END IF;

  SELECT count(*) INTO v_n
    FROM pg_constraint con JOIN pg_class tgt ON tgt.oid = con.confrelid
   WHERE con.contype = 'f' AND tgt.relname IN ('departments', 'municipalities');
  IF v_n <> 7 THEN
    RAISE EXCEPTION 'rollback s7_88: debian quedar las 7 FK territoriales previas, hay %', v_n;
  END IF;

  RAISE NOTICE 'rollback s7_88: OK — administrative_units sin unidades de SV, Fundacion 1 y legacy intactos';
END $ROLLBACK$;

-- Solo ahora, con la verificacion pasada.
COMMIT;

-- ℹ️ Este rollback deja la base en el estado POSTERIOR a Fundacion 1: las tres
--    tablas existen, `countries` y `country_levels` conservan su semilla, y
--    `administrative_units` vuelve a estar vacia. Para deshacer tambien
--    Fundacion 1, ejecutar despues `docs/rollbacks/s7_87_rollback.sql`.
