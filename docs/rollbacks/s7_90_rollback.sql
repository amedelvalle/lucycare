-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK de s7_90 · MULTICOUNTRY-GEO-P0 · Fundacion 3B paso 1 (M2 de CH-16)
--
-- ⛔ NO EJECUTAR salvo FAIL explicito y autorizacion del owner.
--
-- s7_90 solo cambio el NOMBRE de municipalities.id = CH-16, de «Cancasque» a
-- «San Miguel de Mercedes». Este rollback devuelve ese nombre y nada mas.
--
-- ⚠️ SOLO CON CERO REFERENCIAS. Despues de s7_90, una fila que apunte a CH-16
-- significa legitimamente San Miguel de Mercedes. Revertir el nombre la
-- etiquetaria como un distrito que no existe. Por eso la guarda bloquea CH-16,
-- descubre las referencias igual que la migracion y aborta si hay alguna.
--
-- ⚠️ ATOMICO. Un unico BEGIN / COMMIT, con el COMMIT DESPUES de la
-- verificacion: si algo no cuadra, la excepcion aborta y no cambia nada.
-- Pegar ENTERO en una pestaña nueva del SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $PREVIA$
DECLARE
  r      record;
  v_n    bigint;
  v_cols int := 0;
  v_refs bigint := 0;
  v_fila record;
BEGIN
  SELECT m.id, m.name, m.department_id, m.district INTO v_fila
    FROM public.municipalities m WHERE m.id = 'CH-16'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rollback s7_90: no existe municipalities.id = CH-16';
  END IF;
  IF v_fila.name IS DISTINCT FROM 'San Miguel de Mercedes'
     OR v_fila.department_id IS DISTINCT FROM 'CH'
     OR v_fila.district IS DISTINCT FROM 'Chalatenango Sur' THEN
    RAISE EXCEPTION 'rollback s7_90: CH-16 no esta en el estado que dejo s7_90 (name=%, department_id=%, district=%)',
      v_fila.name, v_fila.department_id, v_fila.district;
  END IF;

  SELECT count(*) INTO v_n FROM public.municipalities WHERE name = 'Cancasque';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'rollback s7_90: ya existe % fila(s) llamada(s) Cancasque', v_n;
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
    RAISE EXCEPTION 'rollback s7_90: el descubrimiento inspecciono % columnas (minimo 3)', v_cols;
  END IF;
  IF v_refs <> 0 THEN
    RAISE EXCEPTION 'rollback s7_90: CH-16 tiene % referencias — ya significan San Miguel de Mercedes, NO se revierte', v_refs;
  END IF;

  PERFORM set_config('s7_90rb.huella_otras_municipalities',
    (SELECT md5(string_agg(m::text, E'\n' ORDER BY m.id))
       FROM public.municipalities m WHERE m.id <> 'CH-16'), true);
  PERFORM set_config('s7_90rb.ch16_sin_nombre',
    (SELECT (to_jsonb(m) - 'name')::text FROM public.municipalities m WHERE m.id = 'CH-16'), true);
END $PREVIA$;

UPDATE public.municipalities
   SET name = 'Cancasque'
 WHERE id = 'CH-16'
   AND name = 'San Miguel de Mercedes'
   AND department_id = 'CH'
   AND district = 'Chalatenango Sur';

-- ─── Verificacion del rollback ─────────────────────────────────────────
DO $ROLLBACK$
DECLARE
  v_n   bigint;
  v_txt text;
BEGIN
  SELECT name INTO v_txt FROM public.municipalities WHERE id = 'CH-16';
  IF v_txt IS DISTINCT FROM 'Cancasque' THEN
    RAISE EXCEPTION 'rollback s7_90: CH-16 deberia volver a Cancasque, es %', v_txt;
  END IF;

  SELECT (to_jsonb(m) - 'name')::text INTO v_txt FROM public.municipalities m WHERE m.id = 'CH-16';
  IF v_txt IS DISTINCT FROM current_setting('s7_90rb.ch16_sin_nombre') THEN
    RAISE EXCEPTION 'rollback s7_90: CH-16 cambio algo mas que el nombre';
  END IF;

  SELECT md5(string_agg(m::text, E'\n' ORDER BY m.id)) INTO v_txt
    FROM public.municipalities m WHERE m.id <> 'CH-16';
  IF v_txt IS DISTINCT FROM current_setting('s7_90rb.huella_otras_municipalities') THEN
    RAISE EXCEPTION 'rollback s7_90: cambiaron otras filas de municipalities';
  END IF;

  SELECT count(*) INTO v_n FROM public.municipalities;
  IF v_n <> 262 THEN RAISE EXCEPTION 'rollback s7_90: municipalities quedo en %', v_n; END IF;

  RAISE NOTICE 'rollback s7_90: OK — CH-16 vuelve a Cancasque, id/departamento/agrupador y las otras 261 filas intactos';
END $ROLLBACK$;

-- Solo ahora, con la verificacion pasada.
COMMIT;
