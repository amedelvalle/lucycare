-- ============================================================
-- s7_90 · MULTICOUNTRY-GEO-P0 · FUNDACION 3B · paso 1 de 3
-- Correccion M2 del registro legacy CH-16: Cancasque -> San Miguel de Mercedes
-- ============================================================
--
-- Migracion 111. Corrige el NOMBRE de una sola fila del catalogo legacy
-- `municipalities`. Nada mas.
--
-- ── POR QUE ──
-- La base legacy cargo `CH-16` como «Cancasque», un distrito que el DL 762
-- reformado por DL 978 no reconoce. El id `CH-16` corresponde a San Miguel de
-- Mercedes, que es como ya lo cargo `s7_88` en `administrative_units`. Tras esta
-- migracion el catalogo legacy y el nuevo dicen lo mismo para ese id, y los
-- selectores legacy dejan de ofrecer un distrito inexistente. Es un cambio de
-- DATO visible e intencional, no un cambio de UI.
--
-- ── LA CONDICION: CERO REFERENCIAS ──
-- Renombrar cambia el significado de toda fila que ya apunte a `CH-16`: una
-- clinica registrada como «Cancasque» pasaria a ser de San Miguel de Mercedes
-- sin que nadie lo decida. Por eso M2 SOLO procede con 0 referencias vivas.
-- Las referencias se DESCUBREN, no se enumeran: toda FK hacia
-- `municipalities.id` (desde `pg_constraint`) mas toda columna de `public` cuyo
-- nombre contenga `municipality` sin FK. Es la misma semantica que el precheck
-- versionado en docs/ANALISIS_MULTICOUNTRY_GEO.md §6.4. Precheck del 2026-09-13:
-- 3 columnas inspeccionadas, 0 referencias.
--
-- ── ATOMICIDAD CON LAS ESCRITURAS CONCURRENTES ──
-- Dentro de la transaccion, la fila `CH-16` se bloquea con FOR UPDATE ANTES de
-- recontar. Toda escritura que quiera referenciarla necesita FOR KEY SHARE sobre
-- esa fila, asi que queda en espera hasta el COMMIT: el recuento y el cambio son
-- atomicos. Si el recuento no da 0, la transaccion aborta sin cambios.
--
-- ── QUE HACE, EXACTAMENTE ──
--   · UPDATE de `municipalities.name` en la fila `CH-16`, con el valor previo
--     exacto en el WHERE (nombre, departamento y agrupador).
--
-- ── QUE NO HACE ──
-- No cambia id, `department_id` ni `district` · no toca ninguna otra fila de
-- `municipalities` · no toca `departments`, `clinics`, `profiles`,
-- `doctor_affiliation_requests`, `administrative_units` ni `countries` · sin DDL,
-- sin funciones, sin triggers, sin grants, sin RLS · sin backfill · no retira la
-- guarda de F3A · sin frontend.
--
-- ── COMO APLICARLA ──
-- Dos BLOQUES AUTONOMOS, cada uno pegado ENTERO en una pestaña nueva del SQL
-- Editor (regla del 2026-09-13):
--   PASO 1 = seccion 0          · guardas PRE · solo lectura
--   PASO 2 = secciones 1 a 3    · BEGIN -> guarda con bloqueo -> UPDATE -> POST -> COMMIT
-- Si el PASO 1 lanza excepcion, NO continuar.


-- ─── 0. Guardas PRE (solo lectura) ──────────────────────────
DO $PRE$
DECLARE
  r      record;
  v_n    bigint;
  v_cols int := 0;
  v_refs bigint := 0;
  v_fila record;
BEGIN
  -- Valor previo EXACTO de la fila.
  SELECT m.id, m.name, m.department_id, m.district INTO v_fila
    FROM public.municipalities m WHERE m.id = 'CH-16';
  IF NOT FOUND THEN
    RAISE EXCEPTION 's7_90 PRE: no existe municipalities.id = CH-16';
  END IF;
  IF v_fila.name IS DISTINCT FROM 'Cancasque'
     OR v_fila.department_id IS DISTINCT FROM 'CH'
     OR v_fila.district IS DISTINCT FROM 'Chalatenango Sur' THEN
    RAISE EXCEPTION 's7_90 PRE: CH-16 no tiene el valor previo esperado (name=%, department_id=%, district=%) — no reaplicar',
      v_fila.name, v_fila.department_id, v_fila.district;
  END IF;

  SELECT count(*) INTO v_n FROM public.municipalities WHERE name = 'Cancasque';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_90 PRE: esperaba exactamente 1 fila llamada Cancasque, hay %', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM public.municipalities WHERE name = 'San Miguel de Mercedes';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_90 PRE: ya existe % fila(s) llamada(s) San Miguel de Mercedes', v_n;
  END IF;

  -- Legacy y catalogo nuevo en el estado medido.
  SELECT count(*) INTO v_n FROM public.departments;
  IF v_n <> 14 THEN RAISE EXCEPTION 's7_90 PRE: esperaba 14 departamentos, hay %', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.municipalities;
  IF v_n <> 262 THEN RAISE EXCEPTION 's7_90 PRE: esperaba 262 municipios legacy, hay %', v_n; END IF;

  SELECT count(*) INTO v_n
    FROM pg_constraint con JOIN pg_class tgt ON tgt.oid = con.confrelid
   WHERE con.contype = 'f' AND tgt.relname IN ('departments', 'municipalities');
  IF v_n <> 7 THEN RAISE EXCEPTION 's7_90 PRE: esperaba 7 FK territoriales legacy, hay %', v_n; END IF;

  SELECT count(*) INTO v_n
    FROM public.administrative_units u JOIN public.countries c ON c.id = u.country_id
   WHERE c.iso_alpha2 = 'SV';
  IF v_n <> 320 THEN RAISE EXCEPTION 's7_90 PRE: esperaba 320 unidades de SV, hay %', v_n; END IF;

  -- El catalogo nuevo ya dice San Miguel de Mercedes para CH-16, bajo el agrupador y el departamento correctos.
  SELECT count(*) INTO v_n
    FROM public.administrative_units u3
    JOIN public.administrative_units u2 ON u2.id = u3.parent_id
    JOIN public.administrative_units u1 ON u1.id = u2.parent_id
    JOIN public.countries c ON c.id = u3.country_id
   WHERE c.iso_alpha2 = 'SV' AND u3.level = 3 AND u3.legacy_id = 'CH-16'
     AND u3.name = 'San Miguel de Mercedes'
     AND u2.name = 'Chalatenango Sur' AND u1.legacy_id = 'CH';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_90 PRE: administrative_units no tiene CH-16 como San Miguel de Mercedes bajo Chalatenango Sur / CH';
  END IF;

  -- >> descubrimiento de referencias a CH-16 (identico en todos los bloques)
  FOR r IN
    SELECT src_ns.nspname AS esquema, src.relname AS tabla, a_src.attname AS columna
      FROM pg_constraint con
      JOIN pg_class     src    ON src.oid = con.conrelid
      JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
      JOIN pg_class     tgt    ON tgt.oid = con.confrelid
      JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
      JOIN unnest(con.conkey, con.confkey) AS k(src_att, tgt_att) ON true
      JOIN pg_attribute a_src  ON a_src.attrelid = con.conrelid  AND a_src.attnum = k.src_att
      JOIN pg_attribute a_tgt  ON a_tgt.attrelid = con.confrelid AND a_tgt.attnum = k.tgt_att
     WHERE con.contype = 'f'
       AND tgt_ns.nspname = 'public' AND tgt.relname = 'municipalities'
       AND a_tgt.attname = 'id'
    UNION
    SELECT c.table_schema::name, c.table_name::name, c.column_name::name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.column_name ILIKE '%municipality%'
       AND c.table_name <> 'municipalities'
  LOOP
    v_cols := v_cols + 1;
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = %L', r.esquema, r.tabla, r.columna, 'CH-16')
      INTO v_n;
    v_refs := v_refs + v_n;
  END LOOP;
  -- << descubrimiento de referencias a CH-16

  IF v_cols < 3 THEN
    RAISE EXCEPTION 's7_90 PRE: el descubrimiento inspecciono % columnas (minimo 3): la sonda no midio', v_cols;
  END IF;
  IF v_refs <> 0 THEN
    RAISE EXCEPTION 's7_90 PRE: CH-16 tiene % referencias vivas — M2 NO procede, STOP', v_refs;
  END IF;

  RAISE NOTICE 's7_90: guardas PRE OK — CH-16 = Cancasque · CH · Chalatenango Sur, % columnas inspeccionadas, 0 referencias', v_cols;
END $PRE$;


-- ═══════════════════════════════════════════════════════════
-- PASO 2 · EL CAMBIO — secciones 1 a 3, en UNA transaccion
-- ═══════════════════════════════════════════════════════════
BEGIN;


-- ─── 1. Guarda con bloqueo: FOR UPDATE, recuento y huellas ──
DO $GUARDA$
DECLARE
  r      record;
  v_n    bigint;
  v_cols int := 0;
  v_refs bigint := 0;
  v_fila record;
BEGIN
  -- Bloquea CH-16 ANTES de recontar: nadie puede referenciarla hasta el COMMIT.
  SELECT m.id, m.name, m.department_id, m.district INTO v_fila
    FROM public.municipalities m WHERE m.id = 'CH-16'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 's7_90 GUARDA: no existe municipalities.id = CH-16';
  END IF;
  IF v_fila.name IS DISTINCT FROM 'Cancasque'
     OR v_fila.department_id IS DISTINCT FROM 'CH'
     OR v_fila.district IS DISTINCT FROM 'Chalatenango Sur' THEN
    RAISE EXCEPTION 's7_90 GUARDA: CH-16 no tiene el valor previo esperado (name=%, department_id=%, district=%)',
      v_fila.name, v_fila.department_id, v_fila.district;
  END IF;

  -- >> descubrimiento de referencias a CH-16 (identico en todos los bloques)
  FOR r IN
    SELECT src_ns.nspname AS esquema, src.relname AS tabla, a_src.attname AS columna
      FROM pg_constraint con
      JOIN pg_class     src    ON src.oid = con.conrelid
      JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
      JOIN pg_class     tgt    ON tgt.oid = con.confrelid
      JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
      JOIN unnest(con.conkey, con.confkey) AS k(src_att, tgt_att) ON true
      JOIN pg_attribute a_src  ON a_src.attrelid = con.conrelid  AND a_src.attnum = k.src_att
      JOIN pg_attribute a_tgt  ON a_tgt.attrelid = con.confrelid AND a_tgt.attnum = k.tgt_att
     WHERE con.contype = 'f'
       AND tgt_ns.nspname = 'public' AND tgt.relname = 'municipalities'
       AND a_tgt.attname = 'id'
    UNION
    SELECT c.table_schema::name, c.table_name::name, c.column_name::name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.column_name ILIKE '%municipality%'
       AND c.table_name <> 'municipalities'
  LOOP
    v_cols := v_cols + 1;
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = %L', r.esquema, r.tabla, r.columna, 'CH-16')
      INTO v_n;
    v_refs := v_refs + v_n;
  END LOOP;
  -- << descubrimiento de referencias a CH-16

  IF v_cols < 3 THEN
    RAISE EXCEPTION 's7_90 GUARDA: el descubrimiento inspecciono % columnas (minimo 3)', v_cols;
  END IF;
  IF v_refs <> 0 THEN
    RAISE EXCEPTION 's7_90 GUARDA: CH-16 tiene % referencias vivas — M2 NO procede, STOP', v_refs;
  END IF;

  -- Huellas ANTES del cambio, para demostrar en el POST que nada mas cambio.
  -- Viven como configuracion LOCAL de la transaccion: desaparecen con ella.
  PERFORM set_config('s7_90.huella_otras_municipalities',
    (SELECT md5(string_agg(m::text, E'\n' ORDER BY m.id))
       FROM public.municipalities m WHERE m.id <> 'CH-16'), true);
  PERFORM set_config('s7_90.ch16_sin_nombre',
    (SELECT (to_jsonb(m) - 'name')::text FROM public.municipalities m WHERE m.id = 'CH-16'), true);
  PERFORM set_config('s7_90.huella_departments',
    (SELECT md5(string_agg(d::text, E'\n' ORDER BY d.id)) FROM public.departments d), true);
  PERFORM set_config('s7_90.huella_administrative_units',
    (SELECT md5(string_agg(u::text, E'\n' ORDER BY u.id)) FROM public.administrative_units u), true);

  RAISE NOTICE 's7_90 GUARDA: CH-16 bloqueada, % columnas inspeccionadas, 0 referencias, huellas tomadas', v_cols;
END $GUARDA$;


-- ─── 2. El cambio: SOLO el nombre, con el valor previo exacto en el WHERE ──
UPDATE public.municipalities
   SET name = 'San Miguel de Mercedes'
 WHERE id = 'CH-16'
   AND name = 'Cancasque'
   AND department_id = 'CH'
   AND district = 'Chalatenango Sur';


-- ─── 3. Guardas POST — DENTRO de la transaccion ────────────────
DO $POST$
DECLARE
  r      record;
  v_n    bigint;
  v_cols int := 0;
  v_refs bigint := 0;
  v_txt  text;
BEGIN
  -- CH-16 corregida.
  SELECT name INTO v_txt FROM public.municipalities WHERE id = 'CH-16';
  IF v_txt IS DISTINCT FROM 'San Miguel de Mercedes' THEN
    RAISE EXCEPTION 's7_90 POST: CH-16 deberia llamarse San Miguel de Mercedes, se llama %', v_txt;
  END IF;

  -- Id, departamento, agrupador y cualquier otra columna de CH-16, identicos.
  SELECT (to_jsonb(m) - 'name')::text INTO v_txt FROM public.municipalities m WHERE m.id = 'CH-16';
  IF v_txt IS DISTINCT FROM current_setting('s7_90.ch16_sin_nombre') THEN
    RAISE EXCEPTION 's7_90 POST: CH-16 cambio algo mas que el nombre';
  END IF;

  -- Cancasque ya no existe como registro.
  SELECT count(*) INTO v_n FROM public.municipalities WHERE name = 'Cancasque';
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_90 POST: todavia hay % fila(s) llamada(s) Cancasque', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.municipalities WHERE name = 'San Miguel de Mercedes';
  IF v_n <> 1 THEN RAISE EXCEPTION 's7_90 POST: esperaba 1 San Miguel de Mercedes, hay %', v_n; END IF;

  -- Ninguna otra fila cambio.
  SELECT md5(string_agg(m::text, E'\n' ORDER BY m.id)) INTO v_txt
    FROM public.municipalities m WHERE m.id <> 'CH-16';
  IF v_txt IS DISTINCT FROM current_setting('s7_90.huella_otras_municipalities') THEN
    RAISE EXCEPTION 's7_90 POST: cambiaron otras filas de municipalities';
  END IF;

  SELECT count(*) INTO v_n FROM public.municipalities;
  IF v_n <> 262 THEN RAISE EXCEPTION 's7_90 POST: municipalities cambio de tamano: %', v_n; END IF;

  SELECT md5(string_agg(d::text, E'\n' ORDER BY d.id)) INTO v_txt FROM public.departments d;
  IF v_txt IS DISTINCT FROM current_setting('s7_90.huella_departments') THEN
    RAISE EXCEPTION 's7_90 POST: departments cambio';
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_constraint con JOIN pg_class tgt ON tgt.oid = con.confrelid
   WHERE con.contype = 'f' AND tgt.relname IN ('departments', 'municipalities');
  IF v_n <> 7 THEN RAISE EXCEPTION 's7_90 POST: las 7 FK territoriales legacy cambiaron (%)', v_n; END IF;

  -- Catalogo nuevo intacto: huella completa y 14 / 44 / 262.
  SELECT md5(string_agg(u::text, E'\n' ORDER BY u.id)) INTO v_txt FROM public.administrative_units u;
  IF v_txt IS DISTINCT FROM current_setting('s7_90.huella_administrative_units') THEN
    RAISE EXCEPTION 's7_90 POST: administrative_units cambio';
  END IF;

  SELECT string_agg(t.level::text || ':' || t.n::text, ',' ORDER BY t.level) INTO v_txt
    FROM (SELECT u.level, count(*) AS n
            FROM public.administrative_units u JOIN public.countries c ON c.id = u.country_id
           WHERE c.iso_alpha2 = 'SV' GROUP BY u.level) t;
  IF v_txt IS DISTINCT FROM '1:14,2:44,3:262' THEN
    RAISE EXCEPTION 's7_90 POST: el catalogo nuevo no es 14/44/262 (%)', v_txt;
  END IF;

  -- Legacy y catalogo nuevo dicen lo mismo para CH-16.
  SELECT count(*) INTO v_n
    FROM public.administrative_units u JOIN public.municipalities m ON m.id = u.legacy_id
   WHERE u.legacy_id = 'CH-16' AND u.level = 3 AND u.name = m.name;
  IF v_n <> 1 THEN RAISE EXCEPTION 's7_90 POST: legacy y catalogo nuevo no coinciden para CH-16'; END IF;

  -- >> descubrimiento de referencias a CH-16 (identico en todos los bloques)
  FOR r IN
    SELECT src_ns.nspname AS esquema, src.relname AS tabla, a_src.attname AS columna
      FROM pg_constraint con
      JOIN pg_class     src    ON src.oid = con.conrelid
      JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
      JOIN pg_class     tgt    ON tgt.oid = con.confrelid
      JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
      JOIN unnest(con.conkey, con.confkey) AS k(src_att, tgt_att) ON true
      JOIN pg_attribute a_src  ON a_src.attrelid = con.conrelid  AND a_src.attnum = k.src_att
      JOIN pg_attribute a_tgt  ON a_tgt.attrelid = con.confrelid AND a_tgt.attnum = k.tgt_att
     WHERE con.contype = 'f'
       AND tgt_ns.nspname = 'public' AND tgt.relname = 'municipalities'
       AND a_tgt.attname = 'id'
    UNION
    SELECT c.table_schema::name, c.table_name::name, c.column_name::name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.column_name ILIKE '%municipality%'
       AND c.table_name <> 'municipalities'
  LOOP
    v_cols := v_cols + 1;
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = %L', r.esquema, r.tabla, r.columna, 'CH-16')
      INTO v_n;
    v_refs := v_refs + v_n;
  END LOOP;
  -- << descubrimiento de referencias a CH-16

  IF v_cols < 3 OR v_refs <> 0 THEN
    RAISE EXCEPTION 's7_90 POST: referencias a CH-16 = % sobre % columnas (esperado 0 sobre >= 3)', v_refs, v_cols;
  END IF;

  -- F3A intacta: la guarda sigue y las columnas nuevas siguen vacias.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'clinics_geo_f3a_temp_null_chk'
                    AND conrelid = 'public.clinics'::regclass AND convalidated) THEN
    RAISE EXCEPTION 's7_90 POST: la guarda temporal de F3A no esta en pie';
  END IF;

  RAISE NOTICE 's7_90: guardas POST OK — CH-16 = San Miguel de Mercedes, id/departamento/agrupador intactos, 261 filas y catalogo nuevo sin cambios, 0 referencias';
END $POST$;


COMMIT;
-- ═══════════════════════════════════════════════════════════
-- FIN DEL PASO 2.
-- El POST corre DENTRO de la transaccion: si una guarda lanza, el cambio se
-- revierte y CH-16 queda como estaba.
-- ═══════════════════════════════════════════════════════════
