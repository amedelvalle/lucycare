-- ============================================================
-- s7_87 · MULTICOUNTRY-GEO-P0 · FUNDACION 1
-- ============================================================
--
-- Tres tablas nuevas y cuatro filas de semilla. Migracion 108.
--
-- ℹ️ NUMERACION. Existe un PROTOTIPO DESCARTADO con este mismo numero en la
-- rama local `claude/s7_87-geo` (commit 30649f7). Esa rama no esta mergeada ni
-- aplicada, asi que NO consume numeracion de la historia canonica: la siguiente
-- migracion real despues de s7_86 es esta.
--
-- ── ATOMICIDAD ──
-- Las secciones 1 a 4 —el PASO 2, lo unico que MODIFICA la base— van envueltas
-- en un `BEGIN; ... COMMIT;` EXPLICITO. En PostgreSQL el DDL es transaccional y
-- ninguna sentencia de aqui es de las que no admiten transaccion (no hay
-- `CREATE INDEX CONCURRENTLY` ni equivalentes), de modo que el bloque entero se
-- aplica o no se aplica ninguna parte.
--
-- No se deja al comportamiento implicito del cliente. El SQL Editor envuelve
-- una seleccion multi-sentencia en una transaccion implicita, pero eso es una
-- propiedad del CLIENTE, no del script: si alguien pegara las sentencias de a
-- una, cada una haria autocommit y un fallo a mitad dejaria tablas creadas sin
-- semilla. El `BEGIN`/`COMMIT` explicito hace que la garantia viaje CON el
-- archivo. «Todo es CREATE» describe el contenido; no garantiza nada.
--
-- ── ALCANCE ──
-- Crea `countries`, `country_levels` y `administrative_units`, y siembra
-- El Salvador con sus tres niveles. Nada mas.
--
-- ── QUE NO HACE ──
-- `administrative_unit_paths` · `rebuild_administrative_unit_paths` ·
-- `verify_administrative_units` · ninguna de las 14/44/262 unidades ·
-- columnas nuevas en `clinics` · Honduras · cambios al modelo legacy ·
-- lectores, writers o frontend.
--
-- ── POR QUE ESTO NO PUEDE ROMPER NADA ──
-- No es que sea pequena: es que esta DESCONECTADA. No hay un solo `ALTER` sobre
-- un objeto existente, ninguna FK previa se toca, ninguna fila existente se lee
-- ni se escribe, y ningun objeto actual referencia a los nuevos. Si el diseno
-- resultara equivocado, no hay nada que se rompa: hay tres tablas sin usar.
-- Como todo es `CREATE`, un fallo a mitad no deja residuo.
--
-- ── IDENTIDAD: INTERNA Y OPACA ──
-- Las PK son `IDENTITY`, sin ningun significado externo. Los codigos oficiales
-- (ISO 3166, INE) y los IDs territoriales legacy de SV ('SS', 'SS-12') viven en
-- columnas APARTE y anulables. Nombres, codigos y estructura pueden cambiar sin
-- tocar una sola clave primaria ni una sola FK.
--
-- `iso_alpha2` SI lleva CHECK de formato, y ahi es donde corresponde: tiene que
-- casar VERBATIM con la cabecera `x-vercel-ip-country`, que emite alpha-2 en
-- mayusculas. Un 'sv' o un 'SLV' no cruzaria nunca y el fallo seria silencioso.
-- La leccion de la version anterior fue no poner ese contrato sobre la PK.
--
-- ── SEGURIDAD: MINIMO PRIVILEGIO ESTRICTO ──
-- RLS habilitada y **CERO policies**, **CERO grants** a `anon`, `authenticated`
-- y `service_role`. Ningun runtime consume estas tablas todavia, asi que ningun
-- rol necesita leerlas. El privilegio llega con su caso de uso, en el PR que
-- introduzca al primer consumidor.
--
-- Los REVOKE no son decorativos: Supabase puede tener DEFAULT PRIVILEGES sobre
-- el esquema `public` que otorguen acceso automatico a las tablas nuevas. Sin
-- el REVOKE explicito, estas tablas podrian nacer legibles.
--
-- ── COMO APLICARLA ──
-- Tres pasos, seleccionando cada bloque en el SQL Editor:
--   PASO 1 = seccion 0        · guardas PRE   · solo lectura, diagnostico
--   PASO 2 = secciones 1 a 4  · LA MIGRACION  · BEGIN ... COMMIT, atomica
--   PASO 3 = seccion 5        · guardas POST  · solo lectura, diagnostico
--
-- Si el PASO 1 lanza excepcion, NO continuar. Si el PASO 3 fallara, la
-- migracion ya esta comiteada: revertir con `docs/rollbacks/s7_87_rollback.sql`.
-- (Alternativa disponible si se prefiere: mover el bloque POST DENTRO del
-- BEGIN/COMMIT, con lo que un fallo de verificacion revierte solo. Se dejo
-- fuera para conservarlo como paso de diagnostico independiente.)


-- ─── 0. Guardas PRE ─────────────────────────────────────────
DO $PRE$
DECLARE
  v_n int;
BEGIN
  -- Los tres nombres tienen que estar libres. Verificado tambien en el
  -- repositorio: no existe ningun objeto con estos nombres.
  SELECT count(*) INTO v_n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('countries', 'country_levels', 'administrative_units');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_87 PRE: % de las tres tablas ya existen — no reaplicar', v_n;
  END IF;

  -- El modelo legacy debe estar donde lo dejo la medicion read-only. Esta
  -- migracion no lo toca; si cambio, el diagnostico ya no describe esta base.
  SELECT count(*) INTO v_n FROM public.departments;
  IF v_n <> 14 THEN
    RAISE EXCEPTION 's7_87 PRE: esperaba 14 departamentos, hay %', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.municipalities;
  IF v_n <> 262 THEN
    RAISE EXCEPTION 's7_87 PRE: esperaba 262 municipios, hay %', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_constraint con JOIN pg_class tgt ON tgt.oid = con.confrelid
   WHERE con.contype = 'f' AND tgt.relname IN ('departments', 'municipalities');
  IF v_n <> 7 THEN
    RAISE EXCEPTION 's7_87 PRE: esperaba 7 FK territoriales, hay %', v_n;
  END IF;

  RAISE NOTICE 's7_87: guardas PRE OK';
END $PRE$;


-- ═══════════════════════════════════════════════════════════
-- PASO 2 · LA MIGRACION — secciones 1 a 4, en UNA transaccion
-- ═══════════════════════════════════════════════════════════
BEGIN;


-- ─── 1. countries ───────────────────────────────────────────
-- `smallint` y no `bigint`: los paises son unas decenas para siempre, y
-- `clinics.country_id` sera la columna mas caliente del modelo territorial.
-- Dos bytes por fila valen la pena ahi.
--
-- ⚠️ INVARIANTE: ningun consumidor debe depender del VALOR NUMERICO de
-- `countries.id`. Para resolver un pais se consulta `iso_alpha2`, siempre — la
-- semilla de niveles de mas abajo es el primer ejemplo y lo hace asi.
-- La PK es completamente opaca: no se le fija un valor de arranque especial,
-- porque desplazar la secuencia no impediria un hardcode, solo cambiaria el
-- numero magico. La proteccion real es la resolucion por iso_alpha2 y la
-- guarda estatica de `check-s7_87` sobre el codigo.

CREATE TABLE public.countries (
  id                smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  iso_alpha2        text     NOT NULL,
  name              text     NOT NULL,
  directory_enabled boolean  NOT NULL DEFAULT false,
  booking_enabled   boolean  NOT NULL DEFAULT false,
  CONSTRAINT countries_iso_alpha2_key   UNIQUE (iso_alpha2),
  CONSTRAINT countries_iso_alpha2_chk   CHECK (iso_alpha2 ~ '^[A-Z]{2}$'),
  CONSTRAINT countries_name_not_blank   CHECK (btrim(name) <> '')
);

COMMENT ON COLUMN public.countries.id IS
  'Identidad INTERNA y completamente opaca. No es el codigo ISO y no debe '
  'usarse como tal. NINGUN consumidor debe depender de su valor numerico: para '
  'resolver un pais se consulta por iso_alpha2.';

COMMENT ON COLUMN public.countries.iso_alpha2 IS
  'ISO 3166-1 alpha-2. Metadato EXTERNO: debe casar verbatim con la cabecera '
  'x-vercel-ip-country. Si ISO reasignara un codigo, cambia esta columna y '
  'ninguna FK se entera.';

COMMENT ON COLUMN public.countries.booking_enabled IS
  'GATE NACIONAL de reserva en linea. Eje SEPARADO de doctors.booking_enabled y '
  'de las cinco condiciones de doctor_booking_ready, que esta migracion no '
  'toca. La reservabilidad publica sera readiness del medico AND pais '
  'habilitado, combinada fuera de esa funcion.';

COMMENT ON COLUMN public.countries.directory_enabled IS
  'Si el directorio publico de este pais esta abierto. Independiente de '
  'booking_enabled: un pais puede listar medicos informativos sin admitir '
  'reservas.';


-- ─── 2. country_levels ──────────────────────────────────────
-- Las etiquetas de cada nivel, POR PAIS. Es lo que evita hardcodear
-- «Departamento» en la UI: SV usa Departamento/Municipio/Distrito, Costa Rica
-- usaria Provincia/Canton/Distrito, y ninguno de los dos es un caso especial.

CREATE TABLE public.country_levels (
  country_id     smallint NOT NULL REFERENCES public.countries(id),
  level          smallint NOT NULL,
  label_singular text     NOT NULL,
  label_plural   text     NOT NULL,
  PRIMARY KEY (country_id, level),
  CONSTRAINT country_levels_level_chk    CHECK (level >= 1),
  CONSTRAINT country_levels_labels_chk   CHECK (btrim(label_singular) <> ''
                                            AND btrim(label_plural)   <> '')
);


-- ─── 3. administrative_units ────────────────────────────────
-- El arbol territorial generico. Cualquier profundidad, sin DDL nuevo por pais.
--
-- `legacy_id` es el puente de migracion: guardara 'SS' y 'SS-12' cuando la
-- Fundacion 2 mapee el catalogo salvadoreno. NO es identidad y nada lo parsea.
--
-- `official_code` guardara 'SV-SS' o el codigo INE cuando exista fuente actual
-- y fechada. Nace NULL: registrar la ausencia es mas honesto que inventarla.

CREATE TABLE public.administrative_units (
  id               bigint   GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_id       smallint NOT NULL,
  parent_id        bigint,
  level            smallint NOT NULL,
  name             text     NOT NULL,
  legacy_id        text,
  official_code    text,
  official_source  text,
  -- Fecha de la fuente, no «version». Si algun catalogo oficial trae una
  -- version TEXTUAL de verdad, se agregara `official_version text` aparte: son
  -- dos cosas distintas y mezclarlas obliga a inventar una fecha o a perder la
  -- version.
  official_source_date date,
  is_active        boolean  NOT NULL DEFAULT true,

  -- Toda unidad tiene etiqueta, por construccion. Sin esta FK, un nivel
  -- cargado por error quedaria sin label y la UI tendria que inventar un
  -- fallback — justo el bucket 'Otros' que este modelo viene a eliminar.
  CONSTRAINT au_country_level_fkey
    FOREIGN KEY (country_id, level) REFERENCES public.country_levels (country_id, level),

  -- Soporte de la FK compuesta de abajo, y de la futura FK desde clinics.
  CONSTRAINT au_id_country_key UNIQUE (id, country_id),

  -- El padre pertenece SIEMPRE al mismo pais. `MATCH SIMPLE` (el default de
  -- PostgreSQL) no verifica cuando alguna columna es NULL, de modo que una
  -- raiz —parent_id NULL— pasa sin necesidad de excepcion.
  CONSTRAINT au_parent_country_fkey
    FOREIGN KEY (parent_id, country_id)
    REFERENCES public.administrative_units (id, country_id),

  CONSTRAINT au_level_chk       CHECK (level >= 1),
  CONSTRAINT au_name_not_blank  CHECK (btrim(name) <> ''),

  -- Raiz si y solo si nivel 1. Es lo unico de la coherencia jerarquica que se
  -- puede expresar sin mirar otras filas; el resto (parent.level = level - 1,
  -- ausencia de ciclos) ira en la funcion de verificacion de la Fundacion 2.
  CONSTRAINT au_root_iff_level_1 CHECK ((parent_id IS NULL) = (level = 1))
);

-- ⚠️ AÑADIDO SOBRE EL ALCANCE ENUMERADO — justificado, retirable.
-- Sin esto, correr el backfill de la Fundacion 2 dos veces duplicaria en
-- silencio las 276 unidades salvadorenas. Es lo que hace ese backfill
-- IDEMPOTENTE y su reconciliacion demostrable.
CREATE UNIQUE INDEX au_country_legacy_key
  ON public.administrative_units (country_id, legacy_id)
  WHERE legacy_id IS NOT NULL;

-- ℹ️ NO hay unique sobre `official_code`, a proposito. No se ha cargado ningun
-- codigo todavia y no esta establecido que todo sistema oficial futuro respete
-- la misma regla de unicidad. Se evaluara en la Fundacion 2, contra datos
-- reales. Poner la constraint antes seria decidir sin evidencia.

-- Indices minimos de consulta. Los dos que sirven al selector territorial:
-- primer nivel de un pais, e hijos de una unidad. Nada mas: no hay ninguna
-- consulta que busque por codigo oficial, y crear un indice «por si acaso» es
-- peso muerto.
CREATE INDEX au_country_level_active_idx
  ON public.administrative_units (country_id, level, is_active);

CREATE INDEX au_parent_active_idx
  ON public.administrative_units (parent_id, is_active);

COMMENT ON COLUMN public.administrative_units.id IS
  'Identidad INTERNA y opaca. Nombres, codigos oficiales y estructura pueden '
  'cambiar sin tocarla.';

COMMENT ON COLUMN public.administrative_units.legacy_id IS
  'ID territorial legacy de El Salvador (''SS'', ''SS-12''). Puente de '
  'migracion. NO es identidad y ningun codigo lo parsea.';

COMMENT ON COLUMN public.administrative_units.official_code IS
  'Codigo oficial (ISO 3166-2, INE). Metadato anulable, NUNCA identidad. Nace '
  'NULL hasta que exista fuente actual y fechada.';


-- ─── 4. Semilla y privilegios ───────────────────────────────
-- Solo El Salvador y sus tres niveles. Ninguna unidad territorial: el catalogo
-- 14/44/262 es Fundacion 2, y antes hay que validar los nombres de los 262
-- distritos contra la fuente oficial.

INSERT INTO public.countries (iso_alpha2, name, directory_enabled, booking_enabled)
VALUES ('SV', 'El Salvador', true, true);

INSERT INTO public.country_levels (country_id, level, label_singular, label_plural)
SELECT c.id, v.level, v.singular, v.plural
  FROM public.countries c
  CROSS JOIN (VALUES (1::smallint, 'Departamento', 'Departamentos'),
                     (2::smallint, 'Municipio',    'Municipios'),
                     (3::smallint, 'Distrito',     'Distritos')) AS v(level, singular, plural)
 WHERE c.iso_alpha2 = 'SV';

-- RLS habilitada y CERO policies: sin policy, ningun rol sujeto a RLS lee nada.
-- Es la postura mas cerrada posible y la correcta para tablas que todavia no
-- tienen consumidor.
ALTER TABLE public.countries            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.country_levels       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.administrative_units ENABLE ROW LEVEL SECURITY;

-- CERO grants. `service_role` ignora la RLS, asi que su REVOKE es el que de
-- verdad cierra la puerta trasera.
REVOKE ALL ON TABLE public.countries            FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.country_levels       FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.administrative_units FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
-- ═══════════════════════════════════════════════════════════
-- FIN DEL PASO 2. Todo lo anterior se aplico o no se aplico nada.
-- ═══════════════════════════════════════════════════════════


-- ─── 5. Guardas POST ────────────────────────────────────────
DO $POST$
DECLARE
  v_n   int;
  v_txt text;
BEGIN
  -- ── 5.1 Las tres tablas y su forma ──
  SELECT count(*) INTO v_n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('countries', 'country_levels', 'administrative_units');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 's7_87 POST: esperaba 3 tablas nuevas, hay %', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'countries';
  IF v_n <> 5 THEN
    RAISE EXCEPTION 's7_87 POST: countries debe tener 5 columnas, tiene % — alcance excedido', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'country_levels';
  IF v_n <> 4 THEN
    RAISE EXCEPTION 's7_87 POST: country_levels debe tener 4 columnas, tiene %', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'administrative_units';
  IF v_n <> 10 THEN
    RAISE EXCEPTION 's7_87 POST: administrative_units debe tener 10 columnas, tiene %', v_n;
  END IF;

  -- ── 5.2 Identidad interna, no codigo externo ──
  SELECT is_identity INTO v_txt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'countries' AND column_name = 'id';
  IF v_txt <> 'YES' THEN
    RAISE EXCEPTION 's7_87 POST: countries.id no es IDENTITY';
  END IF;

  SELECT is_identity INTO v_txt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'administrative_units' AND column_name = 'id';
  IF v_txt <> 'YES' THEN
    RAISE EXCEPTION 's7_87 POST: administrative_units.id no es IDENTITY';
  END IF;

  SELECT data_type INTO v_txt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'countries' AND column_name = 'id';
  IF v_txt <> 'smallint' THEN
    RAISE EXCEPTION 's7_87 POST: countries.id deberia ser smallint, es %', v_txt;
  END IF;

  SELECT data_type INTO v_txt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'administrative_units' AND column_name = 'id';
  IF v_txt <> 'bigint' THEN
    RAISE EXCEPTION 's7_87 POST: administrative_units.id deberia ser bigint, es %', v_txt;
  END IF;

  -- ── 5.3 Las constraints que sostienen el modelo ──
  FOR v_txt IN SELECT unnest(ARRAY['countries_iso_alpha2_key', 'countries_iso_alpha2_chk',
                                   'au_country_level_fkey', 'au_id_country_key',
                                   'au_parent_country_fkey', 'au_root_iff_level_1'])
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = v_txt) THEN
      RAISE EXCEPTION 's7_87 POST: falta la constraint %', v_txt;
    END IF;
  END LOOP;

  -- La FK compuesta del padre tiene que ser de DOS columnas: con una sola no
  -- garantizaria que padre e hijo comparten pais.
  SELECT cardinality(conkey) INTO v_n FROM pg_constraint WHERE conname = 'au_parent_country_fkey';
  IF coalesce(v_n, 0) <> 2 THEN
    RAISE EXCEPTION 's7_87 POST: au_parent_country_fkey no es compuesta de 2 columnas (%)', coalesce(v_n, 0);
  END IF;

  FOR v_txt IN SELECT unnest(ARRAY['au_country_legacy_key',
                                   'au_country_level_active_idx', 'au_parent_active_idx'])
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                    WHERE schemaname = 'public' AND indexname = v_txt) THEN
      RAISE EXCEPTION 's7_87 POST: falta el indice %', v_txt;
    END IF;
  END LOOP;

  -- ── 5.4 La semilla, exacta ──
  SELECT count(*) INTO v_n FROM public.countries;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_87 POST: countries debe tener 1 fila, tiene %', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.countries
                  WHERE iso_alpha2 = 'SV' AND name = 'El Salvador'
                    AND directory_enabled AND booking_enabled) THEN
    RAISE EXCEPTION 's7_87 POST: la semilla de El Salvador no quedo como se esperaba';
  END IF;

  -- La semilla de niveles tiene que haber resuelto el pais POR iso_alpha2, no
  -- por un literal numerico: si lo hubiera hecho por id, no casaria con el
  -- valor generado. Es la forma ejecutable del invariante — ningun consumidor
  -- depende del valor numerico de countries.id.
  SELECT count(*) INTO v_n
    FROM public.country_levels cl
   WHERE cl.country_id = (SELECT id FROM public.countries WHERE iso_alpha2 = 'SV');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 's7_87 POST: los niveles no quedaron colgados del id real de SV (% de 3)', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.country_levels;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 's7_87 POST: country_levels debe tener 3 filas, tiene %', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.country_levels cl JOIN public.countries c ON c.id = cl.country_id
   WHERE c.iso_alpha2 = 'SV'
     AND (cl.level, cl.label_singular) IN ((1, 'Departamento'), (2, 'Municipio'), (3, 'Distrito'));
  IF v_n <> 3 THEN
    RAISE EXCEPTION 's7_87 POST: los tres niveles de SV no son Departamento/Municipio/Distrito';
  END IF;

  -- NINGUNA unidad territorial: el catalogo es Fundacion 2.
  SELECT count(*) INTO v_n FROM public.administrative_units;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_87 POST: administrative_units debe quedar VACIA, tiene % filas', v_n;
  END IF;

  -- ── 5.5 Minimo privilegio ──
  FOR v_txt IN SELECT unnest(ARRAY['countries', 'country_levels', 'administrative_units'])
  LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = v_txt) THEN
      RAISE EXCEPTION 's7_87 POST: % sin RLS', v_txt;
    END IF;

    SELECT count(*) INTO v_n FROM pg_policies
     WHERE schemaname = 'public' AND tablename = v_txt;
    IF v_n <> 0 THEN
      RAISE EXCEPTION 's7_87 POST: % tiene % policies, esperaba 0 (nadie la consume aun)', v_txt, v_n;
    END IF;

    SELECT count(*) INTO v_n FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = v_txt
       AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC');
    IF v_n <> 0 THEN
      RAISE EXCEPTION 's7_87 POST: % conserva % privilegios de cliente, esperaba 0', v_txt, v_n;
    END IF;
  END LOOP;

  -- ── 5.6 Cero impacto sobre lo que ya existia ──
  SELECT count(*) INTO v_n FROM public.departments;
  IF v_n <> 14 THEN
    RAISE EXCEPTION 's7_87 POST: departments cambio de tamano: %', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.municipalities;
  IF v_n <> 262 THEN
    RAISE EXCEPTION 's7_87 POST: municipalities cambio de tamano: %', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_constraint con JOIN pg_class tgt ON tgt.oid = con.confrelid
   WHERE con.contype = 'f' AND tgt.relname IN ('departments', 'municipalities')
     AND con.confupdtype = 'a';
  IF v_n <> 7 THEN
    RAISE EXCEPTION 's7_87 POST: las 7 FK territoriales previas debian seguir intactas, hay %', v_n;
  END IF;

  -- `clinics` no gana ninguna columna en Fundacion 1.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'clinics'
                AND column_name IN ('country_id', 'territory_unit_id')) THEN
    RAISE EXCEPTION 's7_87 POST: clinics NO debe cambiar en Fundacion 1';
  END IF;

  -- Y el eje de reservabilidad del medico, intacto.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'doctor_booking_ready';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_87 POST: doctor_booking_ready fue alterada (hay % definiciones)', v_n;
  END IF;

  RAISE NOTICE 's7_87: guardas POST OK — Fundacion 1 aplicada, cero impacto sobre el modelo vigente';
END $POST$;
