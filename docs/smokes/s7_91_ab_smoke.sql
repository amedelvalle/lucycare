-- ════════════════════════════════════════════════════════════════════
-- s7_91 · SMOKE A/B · SOLO LECTURA · autoverificable
--
-- Ejecuta, sobre una matriz de casos y con ids legacy REALES:
--   A · el fragmento ACTUAL de admin_approve_and_create_doctor (s7_64 L147-L148,
--       copiado verbatim), y
--   B · el fragmento CORREGIDO de s7_91 (hunks 2 y 3, copiados verbatim).
-- No crea objetos, no abre transaccion y no escribe: solo lee departments y
-- municipalities. No llama a la funcion real (tiene gate is_admin y escribe).
--
-- Resultado:
--   · «Success. No rows returned» = TODAS las expectativas se cumplen, INCLUIDA
--     la de que el fragmento actual produce el par incoherente (el bug) y el
--     corregido no produce ninguno.
--   · Error «SMOKE s7_91 FAIL: …» = alguna expectativa no se cumplio; el mensaje
--     lista los casos.
-- Pegar ENTERO en una pestaña nueva. Se puede ejecutar ANTES de aplicar s7_91:
-- prueba los fragmentos, no la funcion viva.
-- ════════════════════════════════════════════════════════════════════
DO $AB$
DECLARE
  -- Mismos nombres que en la funcion, para que los fragmentos corran tal cual.
  v_lead         record;
  p_overrides    jsonb;
  v_dept_id      text;
  v_muni_id      text;
  v_ov_dept_id   text;
  v_ov_muni_id   text;
  -- Datos de prueba reales: otro departamento distinto de CH y uno de sus municipios.
  v_d2           text;
  v_m2           text;
  c              record;
  v_actual       text;
  v_corregido    text;
  v_esp_actual   text;
  v_esp_corr     text;
  v_fallos       text := '';
  v_casos        int  := 0;
  v_incoh_actual int  := 0;
  v_incoh_corr   int  := 0;
BEGIN
  SELECT d.id INTO v_d2 FROM public.departments d WHERE d.id <> 'CH' ORDER BY d.id LIMIT 1;
  SELECT m.id INTO v_m2 FROM public.municipalities m WHERE m.department_id = v_d2 ORDER BY m.id LIMIT 1;
  IF v_d2 IS NULL OR v_m2 IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.municipalities WHERE id = 'CH-16' AND department_id = 'CH') THEN
    RAISE EXCEPTION 'SMOKE s7_91: datos de prueba no disponibles (D2=%, M2=%)', v_d2, v_m2;
  END IF;

  FOR c IN
    SELECT * FROM (VALUES
      -- n, caso, lead_dept, lead_muni, override (con @D2@ / @M2@), esperado ACTUAL, esperado CORREGIDO
      (1,  'sin override territorial',                     'CH',       'CH-16',    '{}',                                            'CH|CH-16',       'CH|CH-16'),
      (2,  'BUG · override de departamento, municipio omitido', 'CH',   'CH-16',    '{"department_id":"@D2@"}',                      '@D2@|CH-16',     '@D2@|NULL'),
      (3,  'override de departamento y municipio',         'CH',       'CH-16',    '{"department_id":"@D2@","municipality_id":"@M2@"}', '@D2@|@M2@',  '@D2@|@M2@'),
      (4,  'BUG · override de departamento, municipio vacio', 'CH',     'CH-16',    '{"department_id":"@D2@","municipality_id":""}', '@D2@|CH-16',     '@D2@|NULL'),
      (5,  'override de municipio SIN departamento',       'CH',       'CH-16',    '{"municipality_id":"@M2@"}',                    'CH|@M2@',        'ERROR:P0024'),
      (6,  'override con municipio de otro departamento',  'CH',       'CH-16',    '{"department_id":"CH","municipality_id":"@M2@"}', 'CH|@M2@',       'ERROR:P0025'),
      (7,  'lead sin ubicacion, sin override',             NULL,       NULL,       '{}',                                            'NULL|NULL',      'NULL|NULL'),
      (8,  'lead con municipio sin departamento',          NULL,       'CH-16',    '{}',                                            'NULL|CH-16',     'ERROR:P0024'),
      (9,  'lead con par incoherente',                     'CH',       '@M2@',     '{}',                                            'CH|@M2@',        'ERROR:P0025'),
      (10, 'lead sin ubicacion, override solo departamento', NULL,     NULL,       '{"department_id":"CH"}',                        'CH|NULL',        'CH|NULL'),
      (11, 'lead solo departamento, override completo',    'CH',       NULL,       '{"department_id":"CH","municipality_id":"CH-16"}', 'CH|CH-16',     'CH|CH-16'),
      (12, 'override con municipio inexistente',           'CH',       'CH-16',    '{"department_id":"CH","municipality_id":"XX-99"}', 'CH|XX-99',     'ERROR:P0025'),
      (13, 'override con claves vacias',                   'CH',       'CH-16',    '{"department_id":"","municipality_id":""}',     'CH|CH-16',       'CH|CH-16'),
      (14, 'mismo departamento, municipio omitido',        'CH',       'CH-16',    '{"department_id":"CH"}',                        'CH|CH-16',       'CH|NULL')
    ) AS t(n, caso, lead_dept, lead_muni, ov, esp_actual, esp_corregido)
  LOOP
    v_casos := v_casos + 1;
    SELECT replace(c.lead_dept, '@D2@', v_d2) AS department_id,
           replace(replace(c.lead_muni, '@M2@', v_m2), '@D2@', v_d2) AS municipality_id
      INTO v_lead;
    p_overrides  := replace(replace(c.ov, '@D2@', v_d2), '@M2@', v_m2)::jsonb;
    v_esp_actual := replace(replace(c.esp_actual, '@D2@', v_d2), '@M2@', v_m2);
    v_esp_corr   := replace(replace(c.esp_corregido, '@D2@', v_d2), '@M2@', v_m2);

    -- ── A · fragmento ACTUAL (s7_64 L147-L148, verbatim) ──
    v_dept_id := NULL; v_muni_id := NULL;
    BEGIN
  v_dept_id := COALESCE(NULLIF(p_overrides->>'department_id', ''), v_lead.department_id);
  v_muni_id := COALESCE(NULLIF(p_overrides->>'municipality_id', ''), v_lead.municipality_id);
      v_actual := coalesce(v_dept_id, 'NULL') || '|' || coalesce(v_muni_id, 'NULL');
    EXCEPTION WHEN OTHERS THEN
      v_actual := 'ERROR:' || SQLSTATE;
    END;

    -- ── B · fragmento CORREGIDO (s7_91 hunks 2 y 3, verbatim) ──
    v_dept_id := NULL; v_muni_id := NULL; v_ov_dept_id := NULL; v_ov_muni_id := NULL;
    BEGIN
  -- (s7_91) Ubicacion EMPAREJADA: departamento y municipio salen de la MISMA
  -- fuente. Si el override trae departamento, el municipio sale SOLO del
  -- override (NULL si no viene): nunca se hereda el municipio del lead despues
  -- de cambiar de departamento. Sin departamento en el override se conserva el
  -- par del lead. Las validaciones van despues de la clasificacion.
  v_ov_dept_id := NULLIF(p_overrides->>'department_id', '');
  v_ov_muni_id := NULLIF(p_overrides->>'municipality_id', '');
  IF v_ov_dept_id IS NOT NULL THEN
    v_dept_id := v_ov_dept_id;
    v_muni_id := v_ov_muni_id;
  ELSE
    v_dept_id := v_lead.department_id;
    v_muni_id := v_lead.municipality_id;
  END IF;
  -- ─── (s7_91) Validar la ubicacion final, antes de cualquier escritura ───
  -- Despues de las validaciones previas, para no cambiar que error recibe hoy
  -- una solicitud con varios problemas a la vez.
  IF v_ov_muni_id IS NOT NULL AND v_ov_dept_id IS NULL THEN
    RAISE EXCEPTION 'El override trae municipio sin departamento' USING ERRCODE = 'P0024';
  END IF;
  IF v_muni_id IS NOT NULL AND v_dept_id IS NULL THEN
    RAISE EXCEPTION 'El municipio no puede quedar sin departamento' USING ERRCODE = 'P0024';
  END IF;
  IF v_muni_id IS NOT NULL THEN
    PERFORM 1 FROM municipalities WHERE id = v_muni_id AND department_id = v_dept_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El municipio no existe o no pertenece al departamento indicado' USING ERRCODE = 'P0025';
    END IF;
  END IF;

      v_corregido := coalesce(v_dept_id, 'NULL') || '|' || coalesce(v_muni_id, 'NULL');
    EXCEPTION WHEN OTHERS THEN
      v_corregido := 'ERROR:' || SQLSTATE;
    END;

    IF v_actual IS DISTINCT FROM v_esp_actual THEN
      v_fallos := v_fallos || format(' [caso %s ACTUAL: obtuvo %s, esperaba %s]', c.n, v_actual, v_esp_actual);
    END IF;
    IF v_corregido IS DISTINCT FROM v_esp_corr THEN
      v_fallos := v_fallos || format(' [caso %s CORREGIDO: obtuvo %s, esperaba %s]', c.n, v_corregido, v_esp_corr);
    END IF;

    -- Propiedad: ¿el par resultante es incoherente (municipio que no pertenece a su departamento)?
    IF v_actual NOT LIKE 'ERROR:%' AND split_part(v_actual, '|', 2) <> 'NULL'
       AND NOT EXISTS (SELECT 1 FROM public.municipalities m
                        WHERE m.id = split_part(v_actual, '|', 2)
                          AND m.department_id = split_part(v_actual, '|', 1)) THEN
      v_incoh_actual := v_incoh_actual + 1;
    END IF;
    IF v_corregido NOT LIKE 'ERROR:%' AND split_part(v_corregido, '|', 2) <> 'NULL'
       AND NOT EXISTS (SELECT 1 FROM public.municipalities m
                        WHERE m.id = split_part(v_corregido, '|', 2)
                          AND m.department_id = split_part(v_corregido, '|', 1)) THEN
      v_incoh_corr := v_incoh_corr + 1;
    END IF;
  END LOOP;

  -- A/B: el ACTUAL reproduce el bug (7 pares incoherentes: casos 2, 4, 5, 6, 8, 9 y 12)
  -- y el CORREGIDO no produce ninguno.
  IF v_incoh_actual <> 7 THEN
    v_fallos := v_fallos || format(' [el ACTUAL produjo %s pares incoherentes, esperaba 7]', v_incoh_actual);
  END IF;
  IF v_incoh_corr <> 0 THEN
    v_fallos := v_fallos || format(' [el CORREGIDO produjo %s pares incoherentes, esperaba 0]', v_incoh_corr);
  END IF;
  IF v_casos <> 14 THEN
    v_fallos := v_fallos || format(' [se ejecutaron %s casos, esperaba 14]', v_casos);
  END IF;

  IF v_fallos <> '' THEN
    RAISE EXCEPTION 'SMOKE s7_91 FAIL:%', v_fallos;
  END IF;
  RAISE NOTICE 'SMOKE s7_91 OK — 14 casos; actual: 7 pares incoherentes (bug reproducido); corregido: 0';
END $AB$;
