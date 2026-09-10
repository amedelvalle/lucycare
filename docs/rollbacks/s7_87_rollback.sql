-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK de s7_87 · MULTICOUNTRY-GEO-P0 · Fundacion 1
--
-- ⛔ NO EJECUTAR salvo FAIL explicito y autorizacion del owner.
--
-- s7_87 solo CREA. No altero ninguna tabla existente, no toco ninguna FK
-- previa y no leyo ni escribio ninguna fila del modelo vigente. Por eso este
-- rollback es un DROP limpio y NO tiene que restaurar nada.
--
-- ⚠️ ATOMICO. Los tres DROP y su verificacion van dentro de un unico
-- `BEGIN; ... COMMIT;`, y el COMMIT esta DESPUES de la verificacion: si algo
-- no cuadra —por ejemplo, si el catalogo legacy hubiera quedado tocado—, la
-- excepcion aborta la transaccion y NO se borra nada. Nunca se llega a un
-- estado en el que se hayan soltado unas tablas y otras no.
--
-- ℹ️ Las secuencias IDENTITY caen con sus tablas: `DROP TABLE` se lleva la
-- secuencia que posee la columna. No hay que soltarlas por separado.
--
-- ⚠️ COMPROBACION PREVIA — si devuelve algo distinto de 0, hay catalogo
--    territorial cargado (Fundacion 2 o posterior) y ESTE ROLLBACK LO BORRA.
--    Detenerse y consultar al owner:
--
--      SELECT count(*) FROM public.administrative_units;
--      SELECT count(*) FROM public.countries WHERE iso_alpha2 <> 'SV';
--
--    Y si `clinics` ya tiene `country_id` o `territory_unit_id`, el DROP
--    fallara por dependencia: primero hay que revertir esa fundacion.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- Orden inverso al de creacion: las hijas primero.
DROP TABLE IF EXISTS public.administrative_units;
DROP TABLE IF EXISTS public.country_levels;
DROP TABLE IF EXISTS public.countries;

-- ─── Verificacion del rollback ─────────────────────────────────────────
DO $ROLLBACK$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('countries', 'country_levels', 'administrative_units');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'rollback s7_87: quedan % de las tres tablas', v_n;
  END IF;

  -- Lo que el rollback NO puede llevarse por delante. Es barato comprobarlo y
  -- demuestra que la Fundacion 1 no habia tocado nada de esto.
  SELECT count(*) INTO v_n FROM public.departments;
  IF v_n <> 14 THEN
    RAISE EXCEPTION 'rollback s7_87: departments quedo en %', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.municipalities;
  IF v_n <> 262 THEN
    RAISE EXCEPTION 'rollback s7_87: municipalities quedo en %', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_constraint con JOIN pg_class tgt ON tgt.oid = con.confrelid
   WHERE con.contype = 'f' AND tgt.relname IN ('departments', 'municipalities');
  IF v_n <> 7 THEN
    RAISE EXCEPTION 'rollback s7_87: debian quedar las 7 FK territoriales, hay %', v_n;
  END IF;

  RAISE NOTICE 'rollback s7_87: OK — base de vuelta al estado previo a la migracion 108';
END $ROLLBACK$;

-- Solo ahora, con la verificacion pasada.
COMMIT;
