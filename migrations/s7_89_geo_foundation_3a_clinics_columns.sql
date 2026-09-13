-- ============================================================
-- s7_89 · MULTICOUNTRY-GEO-P0 · FUNDACION 3A
-- Columnas territoriales en `clinics`, sin datos y sin consumidores
-- ============================================================
--
-- Migracion 110. Anade a `clinics` dos columnas NULLABLE que conectaran la
-- clinica con el modelo territorial generico, mas su integridad e indices.
-- NO las rellena ni las usa nadie: es la entrada de Fundacion 3, igual de
-- desconectada que Fundacion 1.
--
-- ── QUE HACE, EXACTAMENTE ──
--   · `clinics.country_id smallint NULL`
--   · `clinics.territory_unit_id bigint NULL`   -- unidad mas especifica conocida
--   · FK `country_id -> countries(id)`
--   · FK compuesta `(territory_unit_id, country_id) -> administrative_units(id, country_id)`
--   · CHECK `territory_unit_id IS NULL OR country_id IS NOT NULL`
--   · un indice por cada columna nueva
--
-- ── QUE NO HACE ──
-- Sin DEFAULT · sin backfill · sin helper de mapeo · sin cambios en los tres
-- escritores de ubicacion · sin lectores · sin grants nuevos · sin trigger ·
-- sin UI · sin tocar `department_id` / `municipality_id` ni sus FK legacy ·
-- sin tocar `profiles`, `doctor_affiliation_requests`,
-- `administrative_units`, `countries` ni `doctor_booking_ready`.
--
-- Despues de aplicarla, TODOS los flujos siguen dependiendo exclusivamente del
-- modelo legacy. Las columnas nuevas quedan NULL en todas las filas.
--
-- ── POR QUE EL CHECK NO ES OPCIONAL ──
-- La FK compuesta usa MATCH SIMPLE, el default de PostgreSQL: si CUALQUIERA de
-- sus columnas es NULL, no verifica nada. Sin el CHECK, una clinica podria
-- tener unidad territorial y `country_id` NULL, y la integridad pais <-> unidad
-- quedaria sin comprobar justo en ese caso. Con el CHECK: si hay unidad, hay
-- pais, y entonces la FK compuesta si verifica que la unidad es de ese pais.
--
-- La FK individual de `country_id` cubre el caso inverso: una clinica con pais
-- y sin unidad —la mayoria del padron, que no tiene ubicacion cargada— tiene
-- que apuntar a un pais existente, y MATCH SIMPLE no lo comprobaria.
--
-- ── PRIVILEGIOS: SIN GRANTS NUEVOS, PERO HEREDADOS ──
-- `clinics` no tiene ningun GRANT, REVOKE ni policy versionado: sus privilegios
-- vienen del esquema inicial. Si ese esquema dio un privilegio a NIVEL DE
-- TABLA, las columnas nuevas lo HEREDAN automaticamente, sin ningun GRANT en
-- esta migracion. Eso no se puede leer del repositorio. El POST lo MIDE y lo
-- reporta, y exige que las columnas nuevas no queden MAS accesibles que la
-- columna legacy `department_id`. Con todas las filas en NULL, no hay
-- exposicion de datos en esta fase.
--
-- ── LOCK ──
-- ⚠️ Es la primera fundacion que altera una tabla EN USO por el runtime.
-- `ALTER TABLE ... ADD COLUMN` sin DEFAULT es un cambio de catalogo, sin
-- reescritura, pero toma ACCESS EXCLUSIVE sobre `clinics` durante la
-- transaccion: el directorio espera ese instante. Validar las FK y el CHECK
-- escanea `clinics`, que tiene del orden de un centenar de filas. Aplicar en
-- un momento de trafico bajo.
--
-- ── COMO APLICARLA ──
--   PASO 1 = seccion 0        · guardas PRE  · solo lectura
--   PASO 2 = secciones 1 a 3  · BEGIN -> DDL -> POST -> COMMIT
-- Seleccionar cada bloque desde su apertura real (`DO $PRE$` / `BEGIN;`)
-- hasta su terminador completo. Si el PASO 1 lanza excepcion, NO continuar.


-- ─── 0. Guardas PRE ─────────────────────────────────────────
DO $PRE$
DECLARE
  v_pais smallint;
  v_n    int;
BEGIN
  -- Fundaciones 1 y 2A aplicadas.
  SELECT count(*) INTO v_n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('countries', 'country_levels', 'administrative_units');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 's7_89 PRE: faltan tablas de Fundacion 1 (hay % de 3)', v_n;
  END IF;

  SELECT id INTO v_pais FROM public.countries WHERE iso_alpha2 = 'SV';
  IF v_pais IS NULL THEN
    RAISE EXCEPTION 's7_89 PRE: no existe el pais SV';
  END IF;

  SELECT count(*) INTO v_n FROM public.administrative_units WHERE country_id = v_pais;
  IF v_n <> 320 THEN
    RAISE EXCEPTION 's7_89 PRE: esperaba las 320 unidades de SV de Fundacion 2A, hay %', v_n;
  END IF;

  -- La FK compuesta necesita un UNIQUE exactamente sobre (id, country_id).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'au_id_country_key' AND contype = 'u') THEN
    RAISE EXCEPTION 's7_89 PRE: falta au_id_country_key, soporte de la FK compuesta';
  END IF;

  -- IDEMPOTENCIA: si las columnas ya existen, no se reaplica.
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'clinics'
     AND column_name IN ('country_id', 'territory_unit_id');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_89 PRE: clinics ya tiene % de las columnas nuevas — no reaplicar', v_n;
  END IF;

  -- Las columnas legacy siguen donde estaban.
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'clinics'
     AND column_name IN ('department_id', 'municipality_id');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 's7_89 PRE: clinics deberia tener department_id y municipality_id, tiene %', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.departments;
  IF v_n <> 14 THEN RAISE EXCEPTION 's7_89 PRE: esperaba 14 departamentos, hay %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.municipalities;
  IF v_n <> 262 THEN RAISE EXCEPTION 's7_89 PRE: esperaba 262 municipios legacy, hay %', v_n; END IF;

  SELECT count(*) INTO v_n
    FROM pg_constraint con JOIN pg_class tgt ON tgt.oid = con.confrelid
   WHERE con.contype = 'f' AND tgt.relname IN ('departments', 'municipalities');
  IF v_n <> 7 THEN RAISE EXCEPTION 's7_89 PRE: esperaba 7 FK territoriales legacy, hay %', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'doctor_booking_ready';
  IF v_n <> 1 THEN RAISE EXCEPTION 's7_89 PRE: doctor_booking_ready no esta en su estado (hay %)', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.clinics;
  RAISE NOTICE 's7_89: guardas PRE OK — clinics tiene % filas, columnas nuevas ausentes', v_n;
END $PRE$;


-- ═══════════════════════════════════════════════════════════
-- PASO 2 · EL CAMBIO — secciones 1 a 3, en UNA transaccion
-- ═══════════════════════════════════════════════════════════
BEGIN;


-- ─── 1. Columnas ────────────────────────────────────────────
-- Sin DEFAULT, deliberadamente: un default clasificaria en silencio. Las
-- columnas nacen NULL y las rellena Fundacion 3C, con precheck y verificacion.

ALTER TABLE public.clinics
  ADD COLUMN country_id        smallint,
  ADD COLUMN territory_unit_id bigint;

COMMENT ON COLUMN public.clinics.country_id IS
  'Pais de la clinica. NULL hasta Fundacion 3C. Se resuelve SIEMPRE por '
  'countries.iso_alpha2; ningun consumidor debe depender de su valor numerico.';

COMMENT ON COLUMN public.clinics.territory_unit_id IS
  'Unidad territorial MAS ESPECIFICA conocida de la clinica, de cualquier nivel. '
  'NULL hasta Fundacion 3C. Durante la coexistencia la fuente operativa sigue '
  'siendo department_id / municipality_id.';


-- ─── 2. Integridad ──────────────────────────────────────────

ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_country_fkey
  FOREIGN KEY (country_id) REFERENCES public.countries (id);

-- La unidad pertenece al pais de la clinica. Reutiliza au_id_country_key.
ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_territory_unit_country_fkey
  FOREIGN KEY (territory_unit_id, country_id)
  REFERENCES public.administrative_units (id, country_id);

-- Sin esto, MATCH SIMPLE dejaria pasar una unidad sin pais.
ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_territory_requires_country_chk
  CHECK (territory_unit_id IS NULL OR country_id IS NOT NULL);


-- ─── 3. Indices ─────────────────────────────────────────────
-- `country_id` servira al filtro nacional del directorio; `territory_unit_id`
-- al join con la closure table. Ambos sirven ademas a las comprobaciones de FK
-- cuando se borre o actualice una fila de `countries` o de
-- `administrative_units`: PostgreSQL no indexa por su cuenta el lado que
-- referencia. A la escala actual no cambian ninguna latencia medible; se
-- crean por estabilidad del plan cuando crezca el padron.

CREATE INDEX clinics_country_id_idx        ON public.clinics (country_id);
CREATE INDEX clinics_territory_unit_id_idx ON public.clinics (territory_unit_id);


-- ─── Guardas POST — DENTRO de la transaccion ────────────────
DO $POST$
DECLARE
  v_n     int;
  v_txt   text;
  v_bool  boolean;
  v_rol   text;
  v_priv  text;
  v_nuevo boolean;
  v_legacy boolean;
BEGIN
  -- ── Forma de las columnas ──
  SELECT data_type INTO v_txt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'clinics' AND column_name = 'country_id';
  IF v_txt IS DISTINCT FROM 'smallint' THEN
    RAISE EXCEPTION 's7_89 POST: clinics.country_id deberia ser smallint, es %', v_txt;
  END IF;

  SELECT data_type INTO v_txt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'clinics' AND column_name = 'territory_unit_id';
  IF v_txt IS DISTINCT FROM 'bigint' THEN
    RAISE EXCEPTION 's7_89 POST: clinics.territory_unit_id deberia ser bigint, es %', v_txt;
  END IF;

  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'clinics'
     AND column_name IN ('country_id', 'territory_unit_id')
     AND is_nullable = 'YES' AND column_default IS NULL;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 's7_89 POST: las 2 columnas nuevas deben ser NULLABLE y SIN DEFAULT (cumplen %)', v_n;
  END IF;

  -- ── Integridad ──
  IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class t ON t.oid = con.confrelid
                  WHERE con.conname = 'clinics_country_fkey' AND t.relname = 'countries') THEN
    RAISE EXCEPTION 's7_89 POST: falta clinics_country_fkey hacia countries';
  END IF;

  SELECT cardinality(con.conkey) INTO v_n
    FROM pg_constraint con JOIN pg_class t ON t.oid = con.confrelid
   WHERE con.conname = 'clinics_territory_unit_country_fkey' AND t.relname = 'administrative_units';
  IF coalesce(v_n, 0) <> 2 THEN
    RAISE EXCEPTION 's7_89 POST: la FK compuesta hacia administrative_units no existe o no tiene 2 columnas (%)', coalesce(v_n, 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'clinics_territory_requires_country_chk' AND contype = 'c') THEN
    RAISE EXCEPTION 's7_89 POST: falta el CHECK que exige pais cuando hay unidad';
  END IF;

  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'clinics'
     AND indexname IN ('clinics_country_id_idx', 'clinics_territory_unit_id_idx');
  IF v_n <> 2 THEN RAISE EXCEPTION 's7_89 POST: faltan indices (hay % de 2)', v_n; END IF;

  -- ── TODOS los valores nuevos, NULL ──
  SELECT count(*) INTO v_n FROM public.clinics
   WHERE country_id IS NOT NULL OR territory_unit_id IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_89 POST: % clinicas tienen valores en las columnas nuevas — F3A no rellena nada', v_n;
  END IF;

  -- ── El modelo legacy, intacto ──
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'clinics'
     AND column_name IN ('department_id', 'municipality_id');
  IF v_n <> 2 THEN RAISE EXCEPTION 's7_89 POST: las columnas legacy de clinics cambiaron (%)', v_n; END IF;

  -- Las 7 FK legacy: siguen apuntando a departments/municipalities y NO ACTION.
  -- La FK nueva apunta a administrative_units, asi que no altera este conteo.
  SELECT count(*) INTO v_n
    FROM pg_constraint con JOIN pg_class tgt ON tgt.oid = con.confrelid
   WHERE con.contype = 'f' AND tgt.relname IN ('departments', 'municipalities')
     AND con.confupdtype = 'a';
  IF v_n <> 7 THEN RAISE EXCEPTION 's7_89 POST: las 7 FK territoriales legacy cambiaron (%)', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.departments;
  IF v_n <> 14 THEN RAISE EXCEPTION 's7_89 POST: departments cambio: %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.municipalities;
  IF v_n <> 262 THEN RAISE EXCEPTION 's7_89 POST: municipalities cambio: %', v_n; END IF;

  -- Fundacion 2A, intacta.
  SELECT count(*) INTO v_n FROM public.administrative_units
   WHERE country_id = (SELECT id FROM public.countries WHERE iso_alpha2 = 'SV');
  IF v_n <> 320 THEN RAISE EXCEPTION 's7_89 POST: administrative_units cambio: %', v_n; END IF;

  -- ── Fuera de alcance, sin cambios ──
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name IN ('profiles', 'doctor_affiliation_requests', 'doctors')
                AND column_name IN ('country_id', 'territory_unit_id')) THEN
    RAISE EXCEPTION 's7_89 POST: profiles, doctor_affiliation_requests o doctors ganaron columnas territoriales';
  END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'doctor_booking_ready';
  IF v_n <> 1 THEN RAISE EXCEPTION 's7_89 POST: doctor_booking_ready fue alterada (hay %)', v_n; END IF;

  IF NOT has_function_privilege('anon', 'public.doctor_booking_ready(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 's7_89 POST: doctor_booking_ready perdio el EXECUTE de anon';
  END IF;

  -- ── Privilegios: MEDIDOS, no supuestos ──
  -- Las columnas nuevas no pueden quedar MAS accesibles que department_id. Pueden
  -- quedar igual (privilegio heredado de tabla) o menos (grants por columna).
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE'] LOOP
      v_legacy := has_column_privilege(v_rol, 'public.clinics', 'department_id', v_priv);
      FOREACH v_txt IN ARRAY ARRAY['country_id', 'territory_unit_id'] LOOP
        v_nuevo := has_column_privilege(v_rol, 'public.clinics', v_txt, v_priv);
        IF v_nuevo AND NOT v_legacy THEN
          RAISE EXCEPTION 's7_89 POST: % tiene % sobre clinics.% pero NO sobre department_id — F3A no puede ampliar acceso',
            v_rol, v_priv, v_txt;
        END IF;
      END LOOP;
      RAISE NOTICE 's7_89 privilegio medido · % · % · department_id=% · country_id=% · territory_unit_id=%',
        v_rol, v_priv, v_legacy,
        has_column_privilege(v_rol, 'public.clinics', 'country_id', v_priv),
        has_column_privilege(v_rol, 'public.clinics', 'territory_unit_id', v_priv);
    END LOOP;
  END LOOP;

  SELECT relrowsecurity INTO v_bool FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'clinics';
  RAISE NOTICE 's7_89 RLS de clinics (sin cambios, informativo): %', v_bool;

  RAISE NOTICE 's7_89: guardas POST OK — columnas NULL, integridad lista, legacy y runtime intactos';
END $POST$;


COMMIT;
-- ═══════════════════════════════════════════════════════════
-- FIN DEL PASO 2.
-- El POST corre DENTRO de la transaccion: si una guarda lanza, el DDL entero
-- se revierte y clinics queda exactamente como estaba.
-- ═══════════════════════════════════════════════════════════
