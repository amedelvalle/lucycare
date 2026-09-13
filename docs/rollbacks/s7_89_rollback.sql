-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK de s7_89 · MULTICOUNTRY-GEO-P0 · Fundacion 3A
--
-- ⛔ NO EJECUTAR salvo FAIL explicito y autorizacion del owner.
--
-- s7_89 solo ANADIO a `clinics` dos columnas NULL, cuatro constraints —entre
-- ellas la guarda temporal `clinics_geo_f3a_temp_null_chk`— y dos indices. No relleno datos, no toco `department_id` / `municipality_id` ni
-- sus FK legacy, y ningun flujo lee ni escribe las columnas nuevas. Por eso
-- este rollback es un DROP de lo que aquella creo y no restaura nada.
--
-- ⚠️ ATOMICO. Todo va dentro de un unico `BEGIN; ... COMMIT;`, con el COMMIT
-- DESPUES de la verificacion: si algo no cuadra, la excepcion aborta y NO se
-- borra nada.
--
-- ⚠️ COMPROBACION PREVIA — mientras la guarda temporal exista, esto solo
--    puede dar 0. Si devuelve algo distinto de 0, F3B ya retiro la guarda y
--    se ejecuto una fase posterior (F3B / F3C): ESTE ROLLBACK PERDERIA DATOS o
--    romperia escritores que ya dependen de las columnas. Detenerse y
--    consultar al owner:
--
--      SELECT count(*) FROM public.clinics
--       WHERE country_id IS NOT NULL OR territory_unit_id IS NOT NULL;
--
--    Y si algun escritor de ubicacion ya escribe estas columnas, revertir
--    primero ese escritor: dejar la columna sin su consumidor antes de soltarla.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- Guarda previa, dentro de la transaccion: nunca borrar columnas con datos.
DO $PREVIA$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.clinics
   WHERE country_id IS NOT NULL OR territory_unit_id IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'rollback s7_89: % clinicas tienen datos en las columnas nuevas — hay fases posteriores aplicadas, NO se revierte', v_n;
  END IF;
END $PREVIA$;

DROP INDEX IF EXISTS public.clinics_territory_unit_id_idx;
DROP INDEX IF EXISTS public.clinics_country_id_idx;

ALTER TABLE public.clinics
  DROP CONSTRAINT IF EXISTS clinics_geo_f3a_temp_null_chk,
  DROP CONSTRAINT IF EXISTS clinics_territory_requires_country_chk,
  DROP CONSTRAINT IF EXISTS clinics_territory_unit_country_fkey,
  DROP CONSTRAINT IF EXISTS clinics_country_fkey;

ALTER TABLE public.clinics
  DROP COLUMN IF EXISTS territory_unit_id,
  DROP COLUMN IF EXISTS country_id;

-- ─── Verificacion del rollback ─────────────────────────────────────────
DO $ROLLBACK$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'clinics'
     AND column_name IN ('country_id', 'territory_unit_id');
  IF v_n <> 0 THEN RAISE EXCEPTION 'rollback s7_89: quedan % columnas nuevas', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.clinics'::regclass
     AND conname IN ('clinics_geo_f3a_temp_null_chk', 'clinics_territory_requires_country_chk',
                     'clinics_territory_unit_country_fkey', 'clinics_country_fkey');
  IF v_n <> 0 THEN RAISE EXCEPTION 'rollback s7_89: quedan % constraints de s7_89', v_n; END IF;

  -- Lo que el rollback NO puede llevarse por delante.
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'clinics'
     AND column_name IN ('department_id', 'municipality_id');
  IF v_n <> 2 THEN RAISE EXCEPTION 'rollback s7_89: se perdieron columnas legacy (%)', v_n; END IF;

  SELECT count(*) INTO v_n
    FROM pg_constraint con JOIN pg_class tgt ON tgt.oid = con.confrelid
   WHERE con.contype = 'f' AND tgt.relname IN ('departments', 'municipalities');
  IF v_n <> 7 THEN RAISE EXCEPTION 'rollback s7_89: debian quedar las 7 FK legacy, hay %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.administrative_units
   WHERE country_id = (SELECT id FROM public.countries WHERE iso_alpha2 = 'SV');
  IF v_n <> 320 THEN RAISE EXCEPTION 'rollback s7_89: administrative_units quedo en %', v_n; END IF;

  RAISE NOTICE 'rollback s7_89: OK — clinics sin columnas territoriales nuevas, legacy y Fundacion 2A intactos';
END $ROLLBACK$;

-- Solo ahora, con la verificacion pasada.
COMMIT;
