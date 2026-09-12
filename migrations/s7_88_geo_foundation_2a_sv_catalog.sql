-- ============================================================
-- s7_88 · MULTICOUNTRY-GEO-P0 · FUNDACION 2A
-- Carga del catalogo territorial de El Salvador en administrative_units
-- ============================================================
--
-- Migracion 109. Puebla UNICAMENTE `administrative_units`, con 320 filas:
--   nivel 1 ·  14 departamentos
--   nivel 2 ·  44 municipios   (reforma territorial de 2023)
--   nivel 3 · 262 distritos    (los antiguos municipios)
--
-- ── QUE NO TOCA ──
-- `departments` · `municipalities` · `clinics` · `countries` ·
-- `country_levels` · `doctor_booking_ready` · frontend y filtros actuales ·
-- Auth · Twilio · SEO. Cero `ALTER`, cero `DROP`, cero cambios de esquema:
-- esta migracion solo INSERTA en una tabla que hoy esta vacia.
--
-- ── PROCEDENCIA DE LOS DATOS ──
-- Catalogo candidato validado en la auditoria B2, SHA-256
--   63d40d8ab28dc3ea192a5b340625cc10904891eb5a84a0e618b6dcee98934f74
-- derivado del snapshot de la base y corregido con EXACTAMENTE 7 correcciones
-- sustantivas contra la fuente juridica vigente:
--
--   Decreto Legislativo N.o 762, Ley Especial para la Reestructuracion
--   Municipal, emitido el 13/06/2023, publicado en el Diario Oficial N.o 110,
--   Tomo 439, del 14/06/2023, REFORMADO por el Decreto Legislativo N.o 978 del
--   19/03/2024, publicado en el Diario Oficial N.o 63, Tomo 443, del
--   05/04/2024. Vigencia territorial desde el 01/05/2024.
--
-- Los 320 nombres de esta migracion NO se teclearon: se generaron del CSV
-- validado. Cuatro diferencias tipograficas frente al decreto se conservan a
-- proposito y estan documentadas en el manifest del candidato.
--
-- ── IDENTIDAD Y PADRES ──
-- ⚠️ NINGUN id literal. El pais se resuelve por `iso_alpha2 = 'SV'` y los
-- padres se resuelven RELACIONALMENTE, por nombre dentro del nivel superior:
-- los 14 nombres de departamento y los 44 de municipio son unicos, verificado.
-- Los nombres de distrito NO lo son —5 se repiten entre departamentos— y por
-- eso el nivel 3 resuelve su padre por el MUNICIPIO, nunca por su propio
-- nombre.
--
-- ⚠️ `legacy_id` solo donde existe puente legacy REAL:
--   nivel 1 → `departments.id`     ('SS')      · 14 valores
--   nivel 2 → NULL                              · 44 municipios, son NUEVOS
--   nivel 3 → `municipalities.id`  ('SS-12')   · 262 valores
-- No se inventa ningun `legacy_id` para los municipios de 2023: no tienen
-- equivalente en el modelo anterior, y un valor inventado seria un puente
-- hacia ninguna parte.
--
-- ⚠️ `official_code` queda NULL en las 320. El decreto NO asigna codigos y no
-- se infiere ninguno. `official_source` y `official_source_date` SI se
-- registran, con la fecha de la reforma vigente.
--
-- ── ATOMICIDAD ──
-- El PASO 2 va envuelto en `BEGIN; ... COMMIT;` con las guardas POST DENTRO,
-- antes del COMMIT: si una verificacion falla, la carga entera se revierte
-- sola y la tabla queda vacia.
--
-- ── COMO APLICARLA ──
--   PASO 1 = seccion 0        · guardas PRE  · solo lectura
--   PASO 2 = secciones 1 a 3  · BEGIN -> carga -> POST -> COMMIT
-- Si el PASO 1 lanza excepcion, NO continuar.


-- ─── 0. Guardas PRE ─────────────────────────────────────────
DO $PRE$
DECLARE
  v_pais smallint;
  v_n    int;
BEGIN
  -- s7_87 tiene que estar aplicada.
  SELECT count(*) INTO v_n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('countries', 'country_levels', 'administrative_units');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 's7_88 PRE: faltan tablas de Fundacion 1 (hay % de 3) — aplicar s7_87 primero', v_n;
  END IF;

  -- El pais se resuelve POR iso_alpha2, nunca por un id literal.
  SELECT id INTO v_pais FROM public.countries WHERE iso_alpha2 = 'SV';
  IF v_pais IS NULL THEN
    RAISE EXCEPTION 's7_88 PRE: no existe el pais SV en countries';
  END IF;

  -- Los tres niveles tienen que estar declarados, o la FK (country_id, level) rechaza todo.
  SELECT count(*) INTO v_n FROM public.country_levels
   WHERE country_id = v_pais AND level IN (1, 2, 3);
  IF v_n <> 3 THEN
    RAISE EXCEPTION 's7_88 PRE: SV debe tener los niveles 1, 2 y 3 declarados, tiene %', v_n;
  END IF;

  -- ABORT SEGURO / IDEMPOTENCIA: si ya hay unidades de SV, no se reaplica.
  SELECT count(*) INTO v_n FROM public.administrative_units WHERE country_id = v_pais;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_88 PRE: administrative_units ya tiene % unidades de SV — no reaplicar', v_n;
  END IF;

  -- El modelo legacy, intacto y en su tamano conocido.
  SELECT count(*) INTO v_n FROM public.departments;
  IF v_n <> 14 THEN RAISE EXCEPTION 's7_88 PRE: esperaba 14 departamentos, hay %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.municipalities;
  IF v_n <> 262 THEN RAISE EXCEPTION 's7_88 PRE: esperaba 262 municipios legacy, hay %', v_n; END IF;

  SELECT count(*) INTO v_n
    FROM pg_constraint con JOIN pg_class tgt ON tgt.oid = con.confrelid
   WHERE con.contype = 'f' AND tgt.relname IN ('departments', 'municipalities');
  IF v_n <> 7 THEN RAISE EXCEPTION 's7_88 PRE: esperaba 7 FK territoriales, hay %', v_n; END IF;

  RAISE NOTICE 's7_88: guardas PRE OK — pais SV resuelto, administrative_units vacia';
END $PRE$;


-- ═══════════════════════════════════════════════════════════
-- PASO 2 · LA CARGA — secciones 1 a 3, en UNA transaccion
-- ═══════════════════════════════════════════════════════════
BEGIN;


-- ─── 1. Los 320 registros ───────────────────────────────────
DO $CARGA$
DECLARE
  v_pais smallint;
  v_n    int;
  -- Procedencia, identica en las 320 filas.
  c_src  constant text := 'DL 762 (DO 110, T.439, 14/06/2023), reformado por DL 978 (DO 63, T.443, 05/04/2024)';
  c_date constant date := DATE '2024-04-05';
BEGIN
  SELECT id INTO STRICT v_pais FROM public.countries WHERE iso_alpha2 = 'SV';

  -- ── nivel 1 · 14 departamentos · legacy_id = departments.id ──
  INSERT INTO public.administrative_units
    (country_id, parent_id, level, name, legacy_id, official_code, official_source, official_source_date)
  SELECT v_pais, NULL, 1, d.nombre, d.legacy, NULL, c_src, c_date
    FROM (VALUES
    ('Ahuachapán', 'AH'),
    ('Cabañas', 'CA'),
    ('Chalatenango', 'CH'),
    ('Cuscatlán', 'CU'),
    ('La Libertad', 'LI'),
    ('La Paz', 'LP'),
    ('La Unión', 'LU'),
    ('Morazán', 'MO'),
    ('San Miguel', 'SM'),
    ('San Salvador', 'SS'),
    ('San Vicente', 'SV'),
    ('Santa Ana', 'SA'),
    ('Sonsonate', 'SO'),
    ('Usulután', 'US')
    ) AS d(nombre, legacy);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 14 THEN RAISE EXCEPTION 's7_88: nivel 1 inserto % filas, esperaba 14', v_n; END IF;

  -- ── nivel 2 · 44 municipios · SIN legacy_id ──
  -- El padre se resuelve por NOMBRE del departamento dentro del nivel 1 de SV.
  -- Si un nombre no casara, entrarian menos de 44 filas y la guarda de abajo
  -- aborta: un JOIN que no encuentra padre no puede pasar inadvertido.
  INSERT INTO public.administrative_units
    (country_id, parent_id, level, name, legacy_id, official_code, official_source, official_source_date)
  SELECT v_pais, p.id, 2, d.nombre, NULL, NULL, c_src, c_date
    FROM (VALUES
    ('Ahuachapán', 'Ahuachapán Centro'),
    ('Ahuachapán', 'Ahuachapán Norte'),
    ('Ahuachapán', 'Ahuachapán Sur'),
    ('Cabañas', 'Cabañas Este'),
    ('Cabañas', 'Cabañas Oeste'),
    ('Chalatenango', 'Chalatenango Centro'),
    ('Chalatenango', 'Chalatenango Norte'),
    ('Chalatenango', 'Chalatenango Sur'),
    ('Cuscatlán', 'Cuscatlán Norte'),
    ('Cuscatlán', 'Cuscatlán Sur'),
    ('La Libertad', 'La Libertad Centro'),
    ('La Libertad', 'La Libertad Costa'),
    ('La Libertad', 'La Libertad Este'),
    ('La Libertad', 'La Libertad Norte'),
    ('La Libertad', 'La Libertad Oeste'),
    ('La Libertad', 'La Libertad Sur'),
    ('La Paz', 'La Paz Centro'),
    ('La Paz', 'La Paz Este'),
    ('La Paz', 'La Paz Oeste'),
    ('La Unión', 'La Unión Norte'),
    ('La Unión', 'La Unión Sur'),
    ('Morazán', 'Morazán Norte'),
    ('Morazán', 'Morazán Sur'),
    ('San Miguel', 'San Miguel Centro'),
    ('San Miguel', 'San Miguel Norte'),
    ('San Miguel', 'San Miguel Oeste'),
    ('San Salvador', 'San Salvador Centro'),
    ('San Salvador', 'San Salvador Este'),
    ('San Salvador', 'San Salvador Norte'),
    ('San Salvador', 'San Salvador Oeste'),
    ('San Salvador', 'San Salvador Sur'),
    ('San Vicente', 'San Vicente Norte'),
    ('San Vicente', 'San Vicente Sur'),
    ('Santa Ana', 'Santa Ana Centro'),
    ('Santa Ana', 'Santa Ana Este'),
    ('Santa Ana', 'Santa Ana Norte'),
    ('Santa Ana', 'Santa Ana Oeste'),
    ('Sonsonate', 'Sonsonate Centro'),
    ('Sonsonate', 'Sonsonate Este'),
    ('Sonsonate', 'Sonsonate Norte'),
    ('Sonsonate', 'Sonsonate Oeste'),
    ('Usulután', 'Usulután Este'),
    ('Usulután', 'Usulután Norte'),
    ('Usulután', 'Usulután Oeste')
    ) AS d(padre, nombre)
    JOIN public.administrative_units p
      ON p.country_id = v_pais AND p.level = 1 AND p.name = d.padre;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 44 THEN RAISE EXCEPTION 's7_88: nivel 2 inserto % filas, esperaba 44', v_n; END IF;

  -- ── nivel 3 · 262 distritos · legacy_id = municipalities.id ──
  -- El padre se resuelve por NOMBRE del municipio, que es unico en el nivel 2.
  -- NO por el nombre del distrito: hay 5 nombres repetidos entre departamentos.
  INSERT INTO public.administrative_units
    (country_id, parent_id, level, name, legacy_id, official_code, official_source, official_source_date)
  SELECT v_pais, p.id, 3, d.nombre, d.legacy, NULL, c_src, c_date
    FROM (VALUES
    ('Ahuachapán Centro', 'Ahuachapán', 'AH-05'),
    ('Ahuachapán Centro', 'Apaneca', 'AH-06'),
    ('Ahuachapán Centro', 'Concepción de Ataco', 'AH-07'),
    ('Ahuachapán Centro', 'Tacuba', 'AH-08'),
    ('Ahuachapán Norte', 'Atiquizaya', 'AH-01'),
    ('Ahuachapán Norte', 'El Refugio', 'AH-02'),
    ('Ahuachapán Norte', 'San Lorenzo', 'AH-03'),
    ('Ahuachapán Norte', 'Turín', 'AH-04'),
    ('Ahuachapán Sur', 'Guaymango', 'AH-09'),
    ('Ahuachapán Sur', 'Jujutla', 'AH-10'),
    ('Ahuachapán Sur', 'San Francisco Menéndez', 'AH-11'),
    ('Ahuachapán Sur', 'San Pedro Puxtla', 'AH-12'),
    ('Cabañas Este', 'Dolores', 'CA-03'),
    ('Cabañas Este', 'Guacotecti', 'CA-04'),
    ('Cabañas Este', 'San Isidro', 'CA-05'),
    ('Cabañas Este', 'Sensuntepeque', 'CA-01'),
    ('Cabañas Este', 'Victoria', 'CA-02'),
    ('Cabañas Oeste', 'Cinquera', 'CA-09'),
    ('Cabañas Oeste', 'Ilobasco', 'CA-06'),
    ('Cabañas Oeste', 'Jutiapa', 'CA-08'),
    ('Cabañas Oeste', 'Tejutepeque', 'CA-07'),
    ('Chalatenango Centro', 'Agua Caliente', 'CH-04'),
    ('Chalatenango Centro', 'Dulce Nombre de María', 'CH-05'),
    ('Chalatenango Centro', 'El Paraíso', 'CH-06'),
    ('Chalatenango Centro', 'La Reina', 'CH-07'),
    ('Chalatenango Centro', 'Nueva Concepción', 'CH-08'),
    ('Chalatenango Centro', 'San Fernando', 'CH-09'),
    ('Chalatenango Centro', 'San Francisco Morazán', 'CH-10'),
    ('Chalatenango Centro', 'San Rafael', 'CH-11'),
    ('Chalatenango Centro', 'Santa Rita', 'CH-12'),
    ('Chalatenango Centro', 'Tejutla', 'CH-13'),
    ('Chalatenango Norte', 'Citalá', 'CH-01'),
    ('Chalatenango Norte', 'La Palma', 'CH-02'),
    ('Chalatenango Norte', 'San Ignacio', 'CH-03'),
    ('Chalatenango Sur', 'Arcatao', 'CH-14'),
    ('Chalatenango Sur', 'Azacualpa', 'CH-15'),
    ('Chalatenango Sur', 'Chalatenango', 'CH-17'),
    ('Chalatenango Sur', 'Comalapa', 'CH-18'),
    ('Chalatenango Sur', 'Concepción Quezaltepeque', 'CH-19'),
    ('Chalatenango Sur', 'El Carrizal', 'CH-20'),
    ('Chalatenango Sur', 'La Laguna', 'CH-21'),
    ('Chalatenango Sur', 'Las Vueltas', 'CH-22'),
    ('Chalatenango Sur', 'Nombre de Jesús', 'CH-23'),
    ('Chalatenango Sur', 'Nueva Trinidad', 'CH-24'),
    ('Chalatenango Sur', 'Ojos de Agua', 'CH-25'),
    ('Chalatenango Sur', 'Potonico', 'CH-26'),
    ('Chalatenango Sur', 'San Antonio de la Cruz', 'CH-27'),
    ('Chalatenango Sur', 'San Antonio Los Ranchos', 'CH-28'),
    ('Chalatenango Sur', 'San Francisco Lempa', 'CH-29'),
    ('Chalatenango Sur', 'San Isidro Labrador', 'CH-30'),
    ('Chalatenango Sur', 'San José Cancasque', 'CH-31'),
    ('Chalatenango Sur', 'San José Las Flores', 'CH-32'),
    ('Chalatenango Sur', 'San Luis del Carmen', 'CH-33'),
    ('Chalatenango Sur', 'San Miguel de Mercedes', 'CH-16'),
    ('Cuscatlán Norte', 'Oratorio de Concepción', 'CU-03'),
    ('Cuscatlán Norte', 'San Bartolomé Perulapía', 'CU-04'),
    ('Cuscatlán Norte', 'San José Guayabal', 'CU-02'),
    ('Cuscatlán Norte', 'San Pedro Perulapán', 'CU-05'),
    ('Cuscatlán Norte', 'Suchitoto', 'CU-01'),
    ('Cuscatlán Sur', 'Candelaria', 'CU-09'),
    ('Cuscatlán Sur', 'Cojutepeque', 'CU-08'),
    ('Cuscatlán Sur', 'El Carmen', 'CU-10'),
    ('Cuscatlán Sur', 'El Rosario', 'CU-11'),
    ('Cuscatlán Sur', 'Monte San Juan', 'CU-12'),
    ('Cuscatlán Sur', 'San Cristóbal', 'CU-13'),
    ('Cuscatlán Sur', 'San Rafael Cedros', 'CU-14'),
    ('Cuscatlán Sur', 'San Ramón', 'CU-15'),
    ('Cuscatlán Sur', 'Santa Cruz Analquito', 'CU-16'),
    ('Cuscatlán Sur', 'Santa Cruz Michapa', 'CU-06'),
    ('Cuscatlán Sur', 'Tenancingo', 'CU-07'),
    ('La Libertad Centro', 'Ciudad Arce', 'LI-05'),
    ('La Libertad Centro', 'San Juan Opico', 'LI-04'),
    ('La Libertad Costa', 'Chiltiupán', 'LI-16'),
    ('La Libertad Costa', 'Jicalapa', 'LI-17'),
    ('La Libertad Costa', 'La Libertad', 'LI-18'),
    ('La Libertad Costa', 'Tamanique', 'LI-19'),
    ('La Libertad Costa', 'Teotepeque', 'LI-20'),
    ('La Libertad Este', 'Antiguo Cuscatlán', 'LI-11'),
    ('La Libertad Este', 'Huizúcar', 'LI-12'),
    ('La Libertad Este', 'Nuevo Cuscatlán', 'LI-13'),
    ('La Libertad Este', 'San José Villanueva', 'LI-14'),
    ('La Libertad Este', 'Zaragoza', 'LI-15'),
    ('La Libertad Norte', 'Quezaltepeque', 'LI-01'),
    ('La Libertad Norte', 'San Matías', 'LI-02'),
    ('La Libertad Norte', 'San Pablo Tacachico', 'LI-03'),
    ('La Libertad Oeste', 'Colón', 'LI-06'),
    ('La Libertad Oeste', 'Jayaque', 'LI-07'),
    ('La Libertad Oeste', 'Sacacoyo', 'LI-08'),
    ('La Libertad Oeste', 'Talnique', 'LI-09'),
    ('La Libertad Oeste', 'Tepecoyo', 'LI-10'),
    ('La Libertad Sur', 'Comasagua', 'LI-22'),
    ('La Libertad Sur', 'Santa Tecla', 'LI-21'),
    ('La Paz Centro', 'El Rosario', 'LP-08'),
    ('La Paz Centro', 'Jerusalén', 'LP-09'),
    ('La Paz Centro', 'Mercedes La Ceiba', 'LP-10'),
    ('La Paz Centro', 'Paraíso de Osorio', 'LP-11'),
    ('La Paz Centro', 'San Antonio Masahuat', 'LP-12'),
    ('La Paz Centro', 'San Emigdio', 'LP-13'),
    ('La Paz Centro', 'San Juan Tepezontes', 'LP-14'),
    ('La Paz Centro', 'San Luis La Herradura', 'LP-15'),
    ('La Paz Centro', 'San Miguel Tepezontes', 'LP-16'),
    ('La Paz Centro', 'San Pedro Nonualco', 'LP-17'),
    ('La Paz Centro', 'Santa María Ostuma', 'LP-18'),
    ('La Paz Centro', 'Santiago Nonualco', 'LP-19'),
    ('La Paz Este', 'San Juan Nonualco', 'LP-20'),
    ('La Paz Este', 'San Rafael Obrajuelo', 'LP-21'),
    ('La Paz Este', 'Zacatecoluca', 'LP-22'),
    ('La Paz Oeste', 'Cuyultitán', 'LP-01'),
    ('La Paz Oeste', 'Olocuilta', 'LP-02'),
    ('La Paz Oeste', 'San Francisco Chinameca', 'LP-07'),
    ('La Paz Oeste', 'San Juan Talpa', 'LP-03'),
    ('La Paz Oeste', 'San Luis Talpa', 'LP-04'),
    ('La Paz Oeste', 'San Pedro Masahuat', 'LP-05'),
    ('La Paz Oeste', 'Tapalhuaca', 'LP-06'),
    ('La Unión Norte', 'Anamorós', 'LU-01'),
    ('La Unión Norte', 'Bolívar', 'LU-02'),
    ('La Unión Norte', 'Concepción de Oriente', 'LU-03'),
    ('La Unión Norte', 'El Sauce', 'LU-04'),
    ('La Unión Norte', 'Lislique', 'LU-05'),
    ('La Unión Norte', 'Nueva Esparta', 'LU-06'),
    ('La Unión Norte', 'Pasaquina', 'LU-07'),
    ('La Unión Norte', 'Polorós', 'LU-08'),
    ('La Unión Norte', 'San José La Fuente', 'LU-09'),
    ('La Unión Norte', 'Santa Rosa de Lima', 'LU-10'),
    ('La Unión Sur', 'Conchagua', 'LU-11'),
    ('La Unión Sur', 'El Carmen', 'LU-12'),
    ('La Unión Sur', 'Intipucá', 'LU-13'),
    ('La Unión Sur', 'La Unión', 'LU-14'),
    ('La Unión Sur', 'Meanguera del Golfo', 'LU-15'),
    ('La Unión Sur', 'San Alejo', 'LU-16'),
    ('La Unión Sur', 'Yayantique', 'LU-17'),
    ('La Unión Sur', 'Yucuaiquín', 'LU-18'),
    ('Morazán Norte', 'Arambala', 'MO-01'),
    ('Morazán Norte', 'Cacaopera', 'MO-02'),
    ('Morazán Norte', 'Corinto', 'MO-03'),
    ('Morazán Norte', 'El Rosario', 'MO-04'),
    ('Morazán Norte', 'Joateca', 'MO-05'),
    ('Morazán Norte', 'Jocoaitique', 'MO-06'),
    ('Morazán Norte', 'Meanguera', 'MO-07'),
    ('Morazán Norte', 'Perquín', 'MO-08'),
    ('Morazán Norte', 'San Fernando', 'MO-09'),
    ('Morazán Norte', 'San Isidro', 'MO-10'),
    ('Morazán Norte', 'Torola', 'MO-11'),
    ('Morazán Sur', 'Chilanga', 'MO-12'),
    ('Morazán Sur', 'Delicias de Concepción', 'MO-13'),
    ('Morazán Sur', 'El Divisadero', 'MO-14'),
    ('Morazán Sur', 'Gualococti', 'MO-15'),
    ('Morazán Sur', 'Guatajiagua', 'MO-16'),
    ('Morazán Sur', 'Jocoro', 'MO-17'),
    ('Morazán Sur', 'Lolotiquillo', 'MO-18'),
    ('Morazán Sur', 'Osicala', 'MO-19'),
    ('Morazán Sur', 'San Carlos', 'MO-20'),
    ('Morazán Sur', 'San Francisco Gotera', 'MO-21'),
    ('Morazán Sur', 'San Simón', 'MO-22'),
    ('Morazán Sur', 'Sensembra', 'MO-23'),
    ('Morazán Sur', 'Sociedad', 'MO-24'),
    ('Morazán Sur', 'Yamabal', 'MO-25'),
    ('Morazán Sur', 'Yoloaiquín', 'MO-26'),
    ('San Miguel Centro', 'Chirilagua', 'SM-10'),
    ('San Miguel Centro', 'Comacarán', 'SM-12'),
    ('San Miguel Centro', 'Moncagua', 'SM-13'),
    ('San Miguel Centro', 'Quelepa', 'SM-14'),
    ('San Miguel Centro', 'San Miguel', 'SM-09'),
    ('San Miguel Centro', 'Uluazapa', 'SM-11'),
    ('San Miguel Norte', 'Carolina', 'SM-06'),
    ('San Miguel Norte', 'Chapeltique', 'SM-08'),
    ('San Miguel Norte', 'Ciudad Barrios', 'SM-01'),
    ('San Miguel Norte', 'Nuevo Edén de San Juan', 'SM-03'),
    ('San Miguel Norte', 'San Antonio del Mosco', 'SM-07'),
    ('San Miguel Norte', 'San Gerardo', 'SM-04'),
    ('San Miguel Norte', 'San Luis de la Reina', 'SM-05'),
    ('San Miguel Norte', 'Sesori', 'SM-02'),
    ('San Miguel Oeste', 'Chinameca', 'SM-15'),
    ('San Miguel Oeste', 'El Tránsito', 'SM-20'),
    ('San Miguel Oeste', 'Lolotique', 'SM-17'),
    ('San Miguel Oeste', 'Nueva Guadalupe', 'SM-16'),
    ('San Miguel Oeste', 'San Jorge', 'SM-18'),
    ('San Miguel Oeste', 'San Rafael Oriente', 'SM-19'),
    ('San Salvador Centro', 'Ayutuxtepeque', 'SS-10'),
    ('San Salvador Centro', 'Ciudad Delgado', 'SS-14'),
    ('San Salvador Centro', 'Cuscatancingo', 'SS-13'),
    ('San Salvador Centro', 'Mejicanos', 'SS-11'),
    ('San Salvador Centro', 'San Salvador y Capital de la República', 'SS-12'),
    ('San Salvador Este', 'Ilopango', 'SS-06'),
    ('San Salvador Este', 'San Martín', 'SS-07'),
    ('San Salvador Este', 'Soyapango', 'SS-08'),
    ('San Salvador Este', 'Tonacatepeque', 'SS-09'),
    ('San Salvador Norte', 'Aguilares', 'SS-01'),
    ('San Salvador Norte', 'El Paisnal', 'SS-02'),
    ('San Salvador Norte', 'Guazapa', 'SS-03'),
    ('San Salvador Oeste', 'Apopa', 'SS-04'),
    ('San Salvador Oeste', 'Nejapa', 'SS-05'),
    ('San Salvador Sur', 'Panchimalco', 'SS-15'),
    ('San Salvador Sur', 'Rosario de Mora', 'SS-16'),
    ('San Salvador Sur', 'San Marcos', 'SS-17'),
    ('San Salvador Sur', 'Santiago Texacuangos', 'SS-19'),
    ('San Salvador Sur', 'Santo Tomás', 'SS-18'),
    ('San Vicente Norte', 'Apastepeque', 'SV-01'),
    ('San Vicente Norte', 'San Esteban Catarina', 'SV-13'),
    ('San Vicente Norte', 'San Ildefonso', 'SV-03'),
    ('San Vicente Norte', 'San Lorenzo', 'SV-05'),
    ('San Vicente Norte', 'San Sebastián', 'SV-04'),
    ('San Vicente Norte', 'Santa Clara', 'SV-02'),
    ('San Vicente Norte', 'Santo Domingo', 'SV-06'),
    ('San Vicente Sur', 'Guadalupe', 'SV-08'),
    ('San Vicente Sur', 'San Cayetano Istepeque', 'SV-09'),
    ('San Vicente Sur', 'San Vicente', 'SV-07'),
    ('San Vicente Sur', 'Tecoluca', 'SV-10'),
    ('San Vicente Sur', 'Tepetitán', 'SV-11'),
    ('San Vicente Sur', 'Verapaz', 'SV-12'),
    ('Santa Ana Centro', 'Santa Ana', 'SA-05'),
    ('Santa Ana Este', 'Coatepeque', 'SA-06'),
    ('Santa Ana Este', 'El Congo', 'SA-07'),
    ('Santa Ana Norte', 'Masahuat', 'SA-01'),
    ('Santa Ana Norte', 'Metapán', 'SA-02'),
    ('Santa Ana Norte', 'Santa Rosa Guachipilín', 'SA-03'),
    ('Santa Ana Norte', 'Texistepeque', 'SA-04'),
    ('Santa Ana Oeste', 'Candelaria de la Frontera', 'SA-08'),
    ('Santa Ana Oeste', 'Chalchuapa', 'SA-09'),
    ('Santa Ana Oeste', 'El Porvenir', 'SA-10'),
    ('Santa Ana Oeste', 'San Antonio Pajonal', 'SA-11'),
    ('Santa Ana Oeste', 'San Sebastián Salitrillo', 'SA-12'),
    ('Santa Ana Oeste', 'Santiago de la Frontera', 'SA-13'),
    ('Sonsonate Centro', 'Nahulingo', 'SO-07'),
    ('Sonsonate Centro', 'San Antonio del Monte', 'SO-08'),
    ('Sonsonate Centro', 'Santo Domingo de Guzmán', 'SO-09'),
    ('Sonsonate Centro', 'Sonsonate', 'SO-05'),
    ('Sonsonate Centro', 'Sonzacate', 'SO-06'),
    ('Sonsonate Este', 'Armenia', 'SO-10'),
    ('Sonsonate Este', 'Caluco', 'SO-11'),
    ('Sonsonate Este', 'Cuisnahuat', 'SO-12'),
    ('Sonsonate Este', 'Izalco', 'SO-13'),
    ('Sonsonate Este', 'San Julián', 'SO-14'),
    ('Sonsonate Este', 'Santa Isabel Ishuatán', 'SO-15'),
    ('Sonsonate Norte', 'Juayúa', 'SO-01'),
    ('Sonsonate Norte', 'Nahuizalco', 'SO-02'),
    ('Sonsonate Norte', 'Salcoatitán', 'SO-03'),
    ('Sonsonate Norte', 'Santa Catarina Masahuat', 'SO-04'),
    ('Sonsonate Oeste', 'Acajutla', 'SO-16'),
    ('Usulután Este', 'California', 'US-23'),
    ('Usulután Este', 'Concepción Batres', 'US-11'),
    ('Usulután Este', 'Ereguayquín', 'US-12'),
    ('Usulután Este', 'Jucuarán', 'US-13'),
    ('Usulután Este', 'Ozatlán', 'US-14'),
    ('Usulután Este', 'San Dionisio', 'US-16'),
    ('Usulután Este', 'Santa Elena', 'US-15'),
    ('Usulután Este', 'Santa María', 'US-17'),
    ('Usulután Este', 'Tecapán', 'US-18'),
    ('Usulután Este', 'Usulután', 'US-10'),
    ('Usulután Norte', 'Alegría', 'US-01'),
    ('Usulután Norte', 'Berlín', 'US-02'),
    ('Usulután Norte', 'El Triunfo', 'US-03'),
    ('Usulután Norte', 'Estanzuelas', 'US-04'),
    ('Usulután Norte', 'Jucuapa', 'US-05'),
    ('Usulután Norte', 'Mercedes Umaña', 'US-06'),
    ('Usulután Norte', 'Nueva Granada', 'US-07'),
    ('Usulután Norte', 'San Buenaventura', 'US-08'),
    ('Usulután Norte', 'Santiago de María', 'US-09'),
    ('Usulután Oeste', 'Jiquilisco', 'US-19'),
    ('Usulután Oeste', 'Puerto El Triunfo', 'US-20'),
    ('Usulután Oeste', 'San Agustín', 'US-21'),
    ('Usulután Oeste', 'San Francisco Javier', 'US-22')
    ) AS d(padre, nombre, legacy)
    JOIN public.administrative_units p
      ON p.country_id = v_pais AND p.level = 2 AND p.name = d.padre;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 262 THEN RAISE EXCEPTION 's7_88: nivel 3 inserto % filas, esperaba 262', v_n; END IF;

  RAISE NOTICE 's7_88: cargadas 14 + 44 + 262 = 320 unidades';
END $CARGA$;


-- ─── 2. Guardas POST — DENTRO de la transaccion ─────────────
DO $POST$
DECLARE
  v_pais smallint;
  v_n    int;
BEGIN
  SELECT id INTO STRICT v_pais FROM public.countries WHERE iso_alpha2 = 'SV';

  -- ── 2.1 Conteos ──
  SELECT count(*) INTO v_n FROM public.administrative_units WHERE country_id = v_pais;
  IF v_n <> 320 THEN RAISE EXCEPTION 's7_88 POST: esperaba 320 unidades de SV, hay %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.administrative_units WHERE country_id = v_pais AND level = 1;
  IF v_n <> 14 THEN RAISE EXCEPTION 's7_88 POST: nivel 1 tiene %, esperaba 14', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.administrative_units WHERE country_id = v_pais AND level = 2;
  IF v_n <> 44 THEN RAISE EXCEPTION 's7_88 POST: nivel 2 tiene %, esperaba 44', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.administrative_units WHERE country_id = v_pais AND level = 3;
  IF v_n <> 262 THEN RAISE EXCEPTION 's7_88 POST: nivel 3 tiene %, esperaba 262', v_n; END IF;

  -- Ninguna unidad de otro pais: esta migracion carga SOLO SV.
  SELECT count(*) INTO v_n FROM public.administrative_units WHERE country_id <> v_pais;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: hay % unidades de otro pais', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.administrative_units WHERE level NOT IN (1, 2, 3);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: hay % unidades en un nivel inesperado', v_n; END IF;

  -- ── 2.2 Jerarquia: cero huerfanos, cero cruces de pais ──
  SELECT count(*) INTO v_n FROM public.administrative_units
   WHERE country_id = v_pais AND level = 1 AND parent_id IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: % raices con padre', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.administrative_units
   WHERE country_id = v_pais AND level > 1 AND parent_id IS NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: % unidades no raiz SIN padre (huerfanas)', v_n; END IF;

  -- El padre existe, es del MISMO pais y esta exactamente un nivel arriba.
  SELECT count(*) INTO v_n
    FROM public.administrative_units h
    LEFT JOIN public.administrative_units p ON p.id = h.parent_id
   WHERE h.country_id = v_pais AND h.level > 1
     AND (p.id IS NULL OR p.country_id <> h.country_id OR p.level <> h.level - 1);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_88 POST: % unidades con padre inexistente, de otro pais o de nivel incorrecto', v_n;
  END IF;

  -- Todo nivel 3 alcanza una raiz en exactamente dos saltos.
  SELECT count(*) INTO v_n
    FROM public.administrative_units h
    JOIN public.administrative_units p  ON p.id  = h.parent_id
    JOIN public.administrative_units gp ON gp.id = p.parent_id
   WHERE h.country_id = v_pais AND h.level = 3
     AND gp.level = 1 AND gp.parent_id IS NULL AND gp.country_id = v_pais;
  IF v_n <> 262 THEN
    RAISE EXCEPTION 's7_88 POST: solo % de 262 distritos alcanzan su raiz en dos saltos', v_n;
  END IF;

  -- Cada municipio tiene al menos un distrito, y cada departamento al menos un municipio.
  SELECT count(*) INTO v_n FROM public.administrative_units m
   WHERE m.country_id = v_pais AND m.level = 2
     AND NOT EXISTS (SELECT 1 FROM public.administrative_units h WHERE h.parent_id = m.id);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: % municipios sin ningun distrito', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.administrative_units d
   WHERE d.country_id = v_pais AND d.level = 1
     AND NOT EXISTS (SELECT 1 FROM public.administrative_units m WHERE m.parent_id = d.id);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: % departamentos sin ningun municipio', v_n; END IF;

  -- ── 2.3 legacy_id: puente real, y solo donde existe ──
  SELECT count(*) INTO v_n FROM public.administrative_units
   WHERE country_id = v_pais AND level = 2 AND legacy_id IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_88 POST: % municipios con legacy_id — los de 2023 NO tienen equivalente legacy', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.administrative_units
   WHERE country_id = v_pais AND level IN (1, 3) AND legacy_id IS NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: % unidades de nivel 1 o 3 SIN legacy_id', v_n; END IF;

  -- Correspondencia EXACTA de los 14 con departments.id.
  SELECT count(*) INTO v_n FROM public.administrative_units u
   WHERE u.country_id = v_pais AND u.level = 1
     AND NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.id = u.legacy_id);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: % legacy_id de nivel 1 no existen en departments', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.departments d
   WHERE NOT EXISTS (SELECT 1 FROM public.administrative_units u
                      WHERE u.country_id = v_pais AND u.level = 1 AND u.legacy_id = d.id);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: % departamentos legacy sin unidad que los puentee', v_n; END IF;

  -- Correspondencia EXACTA de los 262 con municipalities.id, en ambos sentidos.
  SELECT count(*) INTO v_n FROM public.administrative_units u
   WHERE u.country_id = v_pais AND u.level = 3
     AND NOT EXISTS (SELECT 1 FROM public.municipalities m WHERE m.id = u.legacy_id);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: % legacy_id de nivel 3 no existen en municipalities', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.municipalities m
   WHERE NOT EXISTS (SELECT 1 FROM public.administrative_units u
                      WHERE u.country_id = v_pais AND u.level = 3 AND u.legacy_id = m.id);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: % municipios legacy sin unidad que los puentee', v_n; END IF;

  -- ── 2.4 Metadatos oficiales ──
  SELECT count(*) INTO v_n FROM public.administrative_units
   WHERE country_id = v_pais AND official_code IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: % unidades con official_code — no se infiere ninguno', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.administrative_units
   WHERE country_id = v_pais
     AND (official_source IS NULL OR official_source_date IS NULL);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: % unidades sin fuente o sin fecha de fuente', v_n; END IF;

  SELECT count(DISTINCT official_source) INTO v_n FROM public.administrative_units WHERE country_id = v_pais;
  IF v_n <> 1 THEN RAISE EXCEPTION 's7_88 POST: la fuente deberia ser una sola, hay %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.administrative_units
   WHERE country_id = v_pais AND NOT is_active;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: % unidades nacieron inactivas', v_n; END IF;

  -- ── 2.5 Nada del modelo vigente cambio ──
  SELECT count(*) INTO v_n FROM public.departments;
  IF v_n <> 14 THEN RAISE EXCEPTION 's7_88 POST: departments cambio de tamano: %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.municipalities;
  IF v_n <> 262 THEN RAISE EXCEPTION 's7_88 POST: municipalities cambio de tamano: %', v_n; END IF;

  SELECT count(*) INTO v_n
    FROM pg_constraint con JOIN pg_class tgt ON tgt.oid = con.confrelid
   WHERE con.contype = 'f' AND tgt.relname IN ('departments', 'municipalities');
  IF v_n <> 7 THEN RAISE EXCEPTION 's7_88 POST: las 7 FK territoriales cambiaron: %', v_n; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'clinics'
                AND column_name IN ('country_id', 'territory_unit_id')) THEN
    RAISE EXCEPTION 's7_88 POST: clinics NO debe cambiar en Fundacion 2A';
  END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'doctor_booking_ready';
  IF v_n <> 1 THEN RAISE EXCEPTION 's7_88 POST: doctor_booking_ready fue alterada (hay %)', v_n; END IF;

  -- Los privilegios siguen cerrados: Fundacion 2A no abre lectura a nadie.
  SELECT count(*) INTO v_n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'administrative_units'
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC');
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_88 POST: administrative_units gano % privilegios de cliente', v_n; END IF;

  RAISE NOTICE 's7_88: guardas POST OK — 14/44/262/320, jerarquia integra, legacy puenteado, legacy model intacto';
END $POST$;


COMMIT;
-- ═══════════════════════════════════════════════════════════
-- FIN DEL PASO 2.
-- El POST corre DENTRO de la transaccion: si una guarda lanza, la carga
-- entera se revierte y administrative_units vuelve a quedar vacia.
-- ═══════════════════════════════════════════════════════════
