-- ============================================================
-- s7_86 · ADMIN-DOCTOR-EXPORT-ONBOARDING — onboarding en el CSV
-- ============================================================
--
-- Follow-up minimo de `s7_79`. El CSV de medicos pasa de 17 a 20 columnas:
-- `Onboarding`, `Proxima accion` y `Listo para reservas`.
--
-- ── QUE CAMBIA, EXACTAMENTE ──
-- DOS ediciones sobre el cuerpo de `s7_79`:
--   1. un `LEFT JOIN LATERAL public._doctor_onboarding(d.id)`;
--   2. tres claves en la allowlist, leidas de ese payload.
--
-- Todo lo demas se reproduce IDENTICO: firma, SECURITY DEFINER, VOLATILE,
-- search_path, gate `is_admin()`/P0140, formato csv/P0142, MAX_EXPORT 10000 con
-- P0146, la reutilizacion de `admin_list_doctors`, el orden dentro de
-- `jsonb_agg` y la auditoria no-PII. `check-s7_86` lo prueba con A/B byte a
-- byte contra `s7_79`.
--
-- ⚠️ `s7_78` y `s7_79` NO se modifican ni se reaplican.
--
-- ── UNA SOLA EVALUACION POR MEDICO ──
-- Es la razon de que la funcion vaya en el FROM y no en la lista de seleccion.
-- PostgreSQL NO elimina subexpresiones comunes entre llamadas a funcion, y
-- `STABLE` no lo cambia: tres `_doctor_onboarding(d.id)` en el SELECT serian
-- tres evaluaciones por fila. Un function RTE es un `Function Scan`, evaluado
-- una vez por fila externa, y las tres claves leen una columna materializada.
--
-- Tampoco puede colapsar por inlining: PostgreSQL se niega a inlinear funciones
-- SQL `SECURITY DEFINER` o con clausula `SET`, y `_doctor_onboarding` es ambas.
--
-- `LEFT JOIN ... ON true` y no `CROSS JOIN LATERAL`: si la funcion no devolviera
-- fila, un CROSS JOIN eliminaria al medico del CSV sin aviso. Un export que
-- pierde filas en silencio es justo lo que P0146 existe para evitar.
--
-- ── LO QUE NO SE TOCA ──
-- `admin_list_doctors` queda intacta: es la fuente del predicado que comparten
-- listado y export. `_doctor_onboarding` tampoco se modifica — se consume tal
-- como quedo en `s7_85`, sin duplicar la definicion de etapa.
--
-- El payload del listado NO se amplia: el coste de onboarding vive dentro de
-- `admin_export_doctors`, que solo se invoca al pulsar «Exportar CSV».
--
-- La traduccion al espanol de `stage` y `next_action` se hace en el frontend,
-- igual que `Estado LucyCare`. La base emite el codigo canonico.


-- ─── 0. Guardas PRE ─────────────────────────────────────────
DO $PRE$
DECLARE
  v_n int;
BEGIN
  -- s7_85 debe estar aplicada: sin ella no hay onboarding que exportar.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_doctor_onboarding';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_86 PRE: _doctor_onboarding no existe (falta s7_85)';
  END IF;

  -- Debe seguir siendo la caja negra que garantiza una evaluacion por fila.
  -- Si perdiera SECURITY DEFINER o el SET, PostgreSQL podria inlinearla y el
  -- Function Scan dejaria de ser una barrera.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = '_doctor_onboarding'
       AND p.prosecdef AND p.proconfig IS NOT NULL
  ) THEN
    RAISE EXCEPTION 's7_86 PRE: _doctor_onboarding perdio SECURITY DEFINER o SET search_path';
  END IF;

  -- El export de s7_79 debe estar en su sitio, con su firma.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_export_doctors';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_86 PRE: esperaba 1 admin_export_doctors, hay %', v_n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_export_doctors'
       AND p.prosrc LIKE '%''slug'',         d.slug%'
  ) THEN
    RAISE EXCEPTION 's7_86 PRE: el export vigente no es el de s7_79';
  END IF;

  -- Y s7_86 no debe estar ya aplicada.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'admin_export_doctors'
       AND p.prosrc LIKE '%onb_stage%'
  ) THEN
    RAISE EXCEPTION 's7_86 PRE: ya aplicada — no reaplicar';
  END IF;

  RAISE NOTICE 's7_86: guardas PRE OK';
END $PRE$;


-- ─── 1. La funcion ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_export_doctors(
  p_search      text        DEFAULT NULL,
  p_published   boolean     DEFAULT NULL,
  p_operational boolean     DEFAULT NULL,
  p_lucy_status lucy_status DEFAULT NULL,
  p_formato     text        DEFAULT 'csv'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- VOLATILE (por defecto): esta función ESCRIBE la fila de auditoría. Declararla
-- STABLE sería mentirle al planificador y el INSERT fallaría.
SET search_path = public, pg_catalog
AS $$
DECLARE
  -- Tope duro. Con 10 001 filas devueltas sabemos que el conjunto EXCEDE el
  -- tope sin tener que contar dos veces.
  MAX_EXPORT constant int := 10000;
  v_rows  jsonb;
  v_n     int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0140';
  END IF;

  -- P0 exporta CSV y nada más. Aceptar 'xlsx' sería peor que inútil: generaría
  -- un archivo que ninguna parte del sistema sabe producir.
  IF coalesce(btrim(lower(p_formato)), '') <> 'csv' THEN
    RAISE EXCEPTION 'Formato no soportado' USING ERRCODE = 'P0142';
  END IF;

  -- ⚠️ ALLOWLIST de columnas. Es el ÚNICO lugar que decide qué viaja al
  -- navegador. No hay `SELECT *`: un campo nuevo en `doctors` o en `profiles`
  -- no se filtra solo por existir.
  --
  -- ⚠️ ORDEN DEL ARRAY JSON. El `ORDER BY` va DENTRO de `jsonb_agg`, que es la
  -- única construcción que PostgreSQL garantiza para el orden de un agregado.
  -- No se confía en el orden incidental de la subconsulta: un `ORDER BY` en el
  -- subquery NO obliga al agregado —el planificador puede reordenar—, y el
  -- `ORDER BY` interno de `admin_list_doctors` tampoco sobrevive al JOIN.
  -- El desempate por `id` es lo que lo hace determinista: sin él, dos médicos
  -- con el mismo `created_at` podrían salir en cualquier orden entre corridas.
  SELECT
    coalesce(jsonb_agg(x.fila ORDER BY x.created_at DESC, x.id), '[]'::jsonb),
    count(*)
  INTO v_rows, v_n
  FROM (
    SELECT
      l.id,
      l.created_at,
      jsonb_build_object(
        'full_name',    p.full_name,
        'specialty',    l.specialty,
        'phone',        p.phone,
        'email',        p.email,
        'clinic_name',  c.name,
        'clinic_address', c.address_line,
        'department',   dp.name,
        'municipality', mu.name,
        'lucy_status',  l.lucy_status,
        -- Derivadas del enum CANÓNICO, no de columnas paralelas. `is_verified`
        -- es GENERATED de `lucy_status='verified'`, así que se calcula del
        -- mismo sitio y no puede discrepar.
        'reclamado',    (l.lucy_status IN ('claimed', 'booking_enabled', 'verified')),
        'verificado',   (l.lucy_status = 'verified'),
        'publicado',    l.is_published,
        'agenda',       l.booking_enabled,
        'operativo',    l.is_operational,
        'created_at',   l.created_at,
        -- s7_79 · ÚNICO cambio funcional respecto de s7_78.
        -- Se emite el valor CANÓNICO tal cual: no se genera ni se reconstruye
        -- desde el nombre. Quien asigna slugs es `trg_set_doctor_slug`, y solo
        -- al publicar. NULL viaja como null y el frontend lo deja en blanco.
        'slug',         d.slug,
        -- s7_86 · las TRES salen del mismo payload ya evaluado.
        'onb_stage',       onb.payload ->> 'stage',
        'onb_next_action', onb.payload ->> 'next_action',
        'booking_ready',   coalesce((onb.payload -> 'booking_ready')::boolean, false)
      ) AS fila
    FROM public.admin_list_doctors(
           p_search, p_published, p_operational, p_lucy_status,
           MAX_EXPORT + 1, 0
         ) l
    JOIN      public.doctors        d  ON d.id  = l.id
    LEFT JOIN public.profiles       p  ON p.id  = d.profile_id
    LEFT JOIN public.clinics        c  ON c.id  = d.clinic_id
    LEFT JOIN public.departments    dp ON dp.id = c.department_id
    LEFT JOIN public.municipalities mu ON mu.id = c.municipality_id
    -- s7_86 · UNA evaluación de onboarding por médico.
    -- La función va en el FROM, no en la lista de selección: así es un
    -- Function Scan que se evalua una vez por fila externa, y las tres
    -- claves de abajo leen una columna ya materializada. Con tres llamadas
    -- escalares serian tres evaluaciones por medico: PostgreSQL no deduplica
    -- llamadas a funcion, y _doctor_onboarding no se puede inlinear por ser
    -- SECURITY DEFINER y tener SET search_path.
    -- LEFT JOIN y no CROSS JOIN: si la funcion no devolviera fila, un CROSS
    -- JOIN borraria al medico del CSV en silencio.
    LEFT JOIN LATERAL public._doctor_onboarding(d.id) AS onb(payload) ON true
  ) x;

  -- Se pidió MAX_EXPORT + 1 justamente para poder distinguir «cabe» de «no
  -- cabe». Se aborta: un CSV recortado en silencio es peor que un error, porque
  -- el que lo recibe no tiene forma de notar lo que falta.
  IF v_n > MAX_EXPORT THEN
    RAISE EXCEPTION 'Exportación demasiado grande' USING ERRCODE = 'P0146';
  END IF;

  -- ─── Auditoría · SOLO metadata ────────────────────────────
  -- NO se guarda el texto buscado, ni nombres, correos, teléfonos o filas. De
  -- la búsqueda solo se registra SI la hubo. `audit_log` es inmutable desde
  -- s7_71b: lo que entre acá no se puede corregir después.
  --
  -- s7_79 NO la modifica: el slug es una columna más del archivo, y la auditoría
  -- registra CUÁNTAS filas salieron, no cuáles ni con qué campos.
  INSERT INTO public.audit_log (user_id, action, table_name, record_id,
                                old_data, new_data)
  VALUES (
    auth.uid(), 'select'::public.audit_action, 'admin_doctor_export', NULL, NULL,
    jsonb_build_object(
      'accion',            'export_base_medicos',
      'formato',           'csv',
      'registros',         v_n,
      'con_busqueda',      (nullif(btrim(coalesce(p_search, '')), '') IS NOT NULL),
      'filtro_published',  p_published,
      'filtro_operational', p_operational,
      'filtro_lucy_status', p_lucy_status,
      'edited_via',        'admin_doctor_export',
      'exportado_at',      now()
    )
  );

  RETURN jsonb_build_object('total', v_n, 'rows', v_rows);
END;
$$;

COMMENT ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) IS
  'ADMIN-DOCTOR-EXPORT-P0 + s7_79 + s7_86. Devuelve la base administrativa de medicos que cumple EXACTAMENTE los filtros activos del listado, no la pagina visible. Reutiliza admin_list_doctors para el universo y enriquece por id con correo, direccion, departamento, municipio, slug y onboarding. El onboarding entra por LEFT JOIN LATERAL sobre _doctor_onboarding: UNA evaluacion por medico, reutilizada por las tres claves onb_stage / onb_next_action / booking_ready. Allowlist explicita: sin license_number, sin credenciales, sin UUID internos, sin bio, sin TOS. Tope 10000; por encima aborta con P0146 en vez de truncar. Audita SOLO metadata no-PII. Gate is_admin(): directory_editor recibe P0140.';

-- ─── 2. Grants ──────────────────────────────────────────────
-- `CREATE OR REPLACE` conserva owner y privilegios. Se reponen igual para que
-- la migracion sea autosuficiente y el POST verifique el estado FINAL.
REVOKE ALL ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) TO authenticated;

-- ─── 3. Guardas POST ────────────────────────────────────────
DO $POST$
DECLARE
  v_oid oid;
  v_src text;
  v_n   int;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_export_doctors';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 's7_86 POST: admin_export_doctors no existe';
  END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_export_doctors';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_86 POST: hay % definiciones, esperaba 1', v_n;
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 's7_86 POST: se perdio SECURITY DEFINER';
  END IF;
  IF (SELECT provolatile::text FROM pg_proc WHERE oid = v_oid) <> 'v' THEN
    RAISE EXCEPTION 's7_86 POST: la funcion debe seguir siendo VOLATILE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = v_oid
       AND proconfig @> ARRAY['search_path=public, pg_catalog']
  ) THEN
    RAISE EXCEPTION 's7_86 POST: se perdio el SET search_path';
  END IF;
  IF (SELECT pg_get_function_identity_arguments(v_oid))
     <> 'p_search text, p_published boolean, p_operational boolean, p_lucy_status lucy_status, p_formato text' THEN
    RAISE EXCEPTION 's7_86 POST: la firma cambio';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 's7_86 POST: anon conserva EXECUTE';
  END IF;
  IF has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 's7_86 POST: service_role conserva EXECUTE';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 's7_86 POST: authenticated no puede ejecutarla';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, unnest(p.proacl) AS a
     WHERE p.oid = v_oid AND a::text LIKE '=%'
  ) THEN
    RAISE EXCEPTION 's7_86 POST: PUBLIC conserva privilegios sobre la funcion';
  END IF;

  -- Cuerpo EJECUTABLE, sin comentarios: los comentarios nombran a proposito lo
  -- prohibido. Leccion de s7_77 y s7_82, aplicada tambien aca.
  SELECT regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', '', 'gs'),
                        '--[^\n]*', '', 'g')
    INTO v_src FROM pg_proc WHERE oid = v_oid;

  -- 3.1 · EL CAMBIO: el onboarding entra por LATERAL
  IF v_src !~ 'LEFT JOIN LATERAL\s+public\._doctor_onboarding\(d\.id\)\s+AS\s+onb\(payload\)\s+ON true' THEN
    RAISE EXCEPTION 's7_86 POST: falta el LEFT JOIN LATERAL de _doctor_onboarding';
  END IF;

  -- 3.2 · UNA sola llamada en todo el cuerpo ejecutable. Es la garantia de
  -- «una evaluacion por medico»: con tres llamadas escalares esto daria 3.
  SELECT count(*) INTO v_n FROM regexp_matches(v_src, '_doctor_onboarding\s*\(', 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_86 POST: hay % llamadas a _doctor_onboarding, esperaba exactamente 1', v_n;
  END IF;

  -- 3.3 · las tres claves leen el payload materializado
  IF v_src !~ '''onb_stage'',\s*onb\.payload' THEN
    RAISE EXCEPTION 's7_86 POST: onb_stage no lee onb.payload';
  END IF;
  IF v_src !~ '''onb_next_action'',\s*onb\.payload' THEN
    RAISE EXCEPTION 's7_86 POST: onb_next_action no lee onb.payload';
  END IF;
  IF v_src !~ '''booking_ready'',\s*coalesce\(\(onb\.payload' THEN
    RAISE EXCEPTION 's7_86 POST: booking_ready no lee onb.payload';
  END IF;

  -- 3.4 · TODO lo demas sigue intacto
  IF v_src NOT LIKE '%admin_list_doctors%' THEN
    RAISE EXCEPTION 's7_86 POST: dejo de reutilizar admin_list_doctors';
  END IF;
  IF v_src !~ '''slug'',\s*d\.slug' THEN
    RAISE EXCEPTION 's7_86 POST: se perdio el slug de s7_79';
  END IF;
  IF v_src NOT LIKE '%P0140%' THEN RAISE EXCEPTION 's7_86 POST: falta el gate P0140'; END IF;
  IF v_src NOT LIKE '%P0142%' THEN RAISE EXCEPTION 's7_86 POST: falta P0142'; END IF;
  IF v_src NOT LIKE '%P0146%' THEN RAISE EXCEPTION 's7_86 POST: falta el tope P0146'; END IF;
  IF v_src NOT LIKE '%10000%' THEN RAISE EXCEPTION 's7_86 POST: MAX_EXPORT ya no es 10000'; END IF;
  IF v_src !~ 'jsonb_agg\s*\(\s*x\.fila\s+ORDER BY\s+x\.created_at DESC,\s*x\.id\s*\)' THEN
    RAISE EXCEPTION 's7_86 POST: se perdio el ORDER BY dentro de jsonb_agg';
  END IF;
  IF v_src NOT LIKE '%con_busqueda%' THEN
    RAISE EXCEPTION 's7_86 POST: se perdio el booleano con_busqueda de la auditoria';
  END IF;
  IF position('P0146' in v_src) > position('INSERT INTO public.audit_log' in v_src) THEN
    RAISE EXCEPTION 's7_86 POST: la auditoria quedo antes del control del tope';
  END IF;

  -- 3.5 · nada prohibido se colo al ampliar la allowlist
  IF v_src LIKE '%license_number%' OR v_src LIKE '%doctor_credentials%'
     OR v_src LIKE '%tos_accepted_at%' OR v_src LIKE '%avatar_url%'
     OR v_src LIKE '%stripe%' OR v_src LIKE '%d.bio%' THEN
    RAISE EXCEPTION 's7_86 POST: el cuerpo referencia una columna prohibida';
  END IF;
  IF v_src LIKE '%profile_missing%' THEN
    RAISE EXCEPTION 's7_86 POST: el checklist detallado no va al CSV';
  END IF;
  IF v_src ~ 'SELECT\s+\*' THEN
    RAISE EXCEPTION 's7_86 POST: hay un SELECT *';
  END IF;

  -- 3.6 · admin_list_doctors sigue intacta y sin onboarding
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_list_doctors'
     AND p.prosrc LIKE '%GREATEST(p_limit, 1)%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_86 POST: admin_list_doctors cambio o adquirio un clamp';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_list_doctors'
     AND p.prosrc LIKE '%onboarding%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_86 POST: admin_list_doctors fue modificada; este frente NO debia tocarla';
  END IF;

  -- 3.7 · _doctor_onboarding no fue tocada
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = '_doctor_onboarding'
       AND p.provolatile = 's' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 's7_86 POST: _doctor_onboarding cambio de volatilidad o de seguridad';
  END IF;

  RAISE NOTICE 's7_86: guardas POST OK';
END $POST$;
