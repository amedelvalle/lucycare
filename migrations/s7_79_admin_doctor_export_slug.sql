-- ============================================================
-- s7_79 · ADMIN-DOCTOR-EXPORT-URL-P0 — slug en el export de médicos
-- ============================================================
--
-- Follow-up mínimo de `s7_78`. El CSV de médicos pasa de 15 a 17 columnas:
-- `Slug` y `URL pública`.
--
-- ── QUÉ CAMBIA, EXACTAMENTE ──
-- UNA clave en la allowlist: `'slug', d.slug`. Nada más.
--
-- El resto se reproduce IDÉNTICO a `s7_78`: firma, SECURITY DEFINER, VOLATILE,
-- search_path, gate `is_admin()`/P0140, formato csv/P0142, MAX_EXPORT 10000 con
-- P0146, la reutilización de `admin_list_doctors`, el orden dentro de
-- `jsonb_agg` y la auditoría no-PII. Es `CREATE OR REPLACE`, así que conserva
-- owner y grants sin necesidad de repetirlos.
--
-- ⚠️ `s7_78` NO se modifica ni se reaplica. Ese archivo es el registro de lo
-- que se ejecutó el 2026-08-26 y se queda como está.
--
-- ── POR QUÉ EL DATO YA ESTABA AL ALCANCE ──
-- `admin_export_doctors` ya hacía `JOIN public.doctors d ON d.id = l.id` para
-- llegar a `profile_id` y `clinic_id`. `d.slug` estaba en ese mismo JOIN: lo
-- único que faltaba era EMITIRLO. Por eso no hay JOIN nuevo, ni consulta extra,
-- ni coste adicional — el plan de ejecución no cambia.
--
-- `admin_list_doctors` NO se toca. Podría haberse extendido para devolver el
-- slug, pero es la fuente del predicado que comparten listado y export: tocarla
-- arriesga el universo de ambos para ahorrar un `d.slug` que ya se tenía.
--
-- ── LA URL NO SE CONSTRUYE ACÁ ──
-- La RPC devuelve el slug crudo. `https://lucycare.app/doctor/<slug>` se arma
-- en el frontend, y solo cuando el médico está PUBLICADO: `fetchDoctorDetail`
-- filtra por `is_published = true`, así que la URL de un no publicado renderiza
-- «Médico no encontrado». Una columna llamada «URL pública» con enlaces muertos
-- sería peor que una celda vacía.
--
-- El dominio es una constante de PRESENTACIÓN, no un dato: guardarlo en la base
-- obligaría a una migración para cambiar de dominio. Vive en el servicio.
--
-- Dato observado el 2026-08-26, como contexto y NO como invariante: 39 de 115
-- médicos tienen slug; los 36 publicados lo tienen todos; 3 no publicados
-- conservan un slug congelado de cuando sí lo estuvieron —el trigger
-- `trg_set_doctor_slug` solo dispara con `is_published = true AND slug IS NULL`
-- y nunca reescribe—.
-- ============================================================

-- ─── 1. RPC de exportación, con slug ────────────────────────
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
        'slug',         d.slug
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
  'ADMIN-DOCTOR-EXPORT-P0 + s7_79. Devuelve la base administrativa de médicos que cumple EXACTAMENTE los filtros activos del listado, no la página visible. Reutiliza admin_list_doctors para el universo —el predicado vive en un solo lugar y no puede derivar— y enriquece por id con correo, dirección, departamento, municipio y slug. Allowlist explícita de 16 campos: sin license_number, sin credenciales, sin UUID internos, sin bio, sin TOS. El slug es el valor canónico de doctors.slug, nunca reconstruido; la URL pública se arma en el frontend y solo para publicados. Tope 10000; por encima aborta con P0146 en vez de truncar. Audita SOLO metadata no-PII: nunca el texto buscado ni las filas. Gate is_admin(): directory_editor recibe P0140.';

-- ─── 2. Grants ──────────────────────────────────────────────
-- `CREATE OR REPLACE` conserva owner y privilegios, así que en teoría no haría
-- falta repetirlos. Se reponen igual para que la migración sea autosuficiente
-- —aplicable sobre una base donde alguien los hubiera cambiado a mano— y para
-- que el POST verifique el estado FINAL, no el heredado.
REVOKE ALL ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) TO authenticated;

-- ─── 3. Guardas POST ────────────────────────────────────────
DO $$
DECLARE
  v_oid oid;
  v_src text;
  v_n   int;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_export_doctors';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 's7_79 POST: admin_export_doctors no existe';
  END IF;

  -- 3.1 · una sola definición: CREATE OR REPLACE no debe haber creado un overload
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_export_doctors';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_79 POST: hay % definiciones de admin_export_doctors, esperaba 1 (¿cambió la firma?)', v_n;
  END IF;

  -- 3.2 · atributos preservados
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 's7_79 POST: se perdió SECURITY DEFINER';
  END IF;
  IF (SELECT provolatile::text FROM pg_proc WHERE oid = v_oid) <> 'v' THEN
    RAISE EXCEPTION 's7_79 POST: la función debe seguir siendo VOLATILE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = v_oid
       AND proconfig @> ARRAY['search_path=public, pg_catalog']
  ) THEN
    RAISE EXCEPTION 's7_79 POST: se perdió el SET search_path';
  END IF;
  IF (SELECT pg_get_function_identity_arguments(v_oid))
     <> 'p_search text, p_published boolean, p_operational boolean, p_lucy_status lucy_status, p_formato text' THEN
    RAISE EXCEPTION 's7_79 POST: la firma cambió — %', pg_get_function_identity_arguments(v_oid);
  END IF;

  -- 3.3 · privilegios de los cuatro roles, sin defaults
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 's7_79 POST: anon conserva EXECUTE';
  END IF;
  IF has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 's7_79 POST: service_role conserva EXECUTE';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 's7_79 POST: authenticated no puede ejecutarla';
  END IF;
  IF (SELECT proacl FROM pg_proc WHERE oid = v_oid) IS NULL THEN
    RAISE EXCEPTION 's7_79 POST: la función conserva los privilegios por defecto (PUBLIC con EXECUTE)';
  END IF;
  -- La entrada de PUBLIC es la que EMPIEZA por '='. Buscar '=X/' en el ACL
  -- aplanado daría un falso positivo con `authenticated=X/owner`.
  IF EXISTS (
    SELECT 1 FROM pg_proc p, unnest(p.proacl) AS a
     WHERE p.oid = v_oid AND a::text LIKE '=%'
  ) THEN
    RAISE EXCEPTION 's7_79 POST: PUBLIC conserva privilegios sobre la función';
  END IF;

  -- ─── Cuerpo EJECUTABLE, sin comentarios ───────────────────
  -- Mirar `prosrc` crudo da falsos positivos: los comentarios nombran a
  -- propósito lo prohibido. Lección de s7_77, aplicada también acá.
  SELECT regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', '', 'gs'),
                        '--[^\n]*', '', 'g')
    INTO v_src FROM pg_proc WHERE oid = v_oid;

  -- 3.4 · EL CAMBIO: el slug se emite
  IF v_src !~ '''slug'',\s*d\.slug' THEN
    RAISE EXCEPTION 's7_79 POST: la allowlist no emite d.slug';
  END IF;

  -- 3.5 · y NO se genera ni se reconstruye
  IF v_src LIKE '%slugify_name%' OR v_src LIKE '%_doctor_next_slug%' THEN
    RAISE EXCEPTION 's7_79 POST: el export estaría GENERANDO slugs; solo debe leerlos';
  END IF;

  -- 3.6 · la URL no se construye en la base
  IF v_src LIKE '%lucycare.app%' OR v_src LIKE '%https://%' THEN
    RAISE EXCEPTION 's7_79 POST: la URL pública no debe construirse en la RPC';
  END IF;

  -- 3.7 · TODO lo demás sigue intacto
  IF v_src NOT LIKE '%admin_list_doctors%' THEN
    RAISE EXCEPTION 's7_79 POST: dejó de reutilizar admin_list_doctors';
  END IF;
  IF v_src NOT LIKE '%P0140%' THEN RAISE EXCEPTION 's7_79 POST: falta el gate P0140'; END IF;
  IF v_src NOT LIKE '%P0142%' THEN RAISE EXCEPTION 's7_79 POST: falta P0142'; END IF;
  IF v_src NOT LIKE '%P0146%' THEN RAISE EXCEPTION 's7_79 POST: falta el tope P0146'; END IF;
  IF v_src NOT LIKE '%10000%' THEN RAISE EXCEPTION 's7_79 POST: MAX_EXPORT ya no es 10000'; END IF;
  IF v_src !~ 'jsonb_agg\s*\(\s*x\.fila\s+ORDER BY\s+x\.created_at DESC,\s*x\.id\s*\)' THEN
    RAISE EXCEPTION 's7_79 POST: se perdió el ORDER BY dentro de jsonb_agg';
  END IF;
  IF v_src NOT LIKE '%con_busqueda%' THEN
    RAISE EXCEPTION 's7_79 POST: se perdió el booleano con_busqueda de la auditoría';
  END IF;
  IF position('P0146' in v_src) > position('INSERT INTO public.audit_log' in v_src) THEN
    RAISE EXCEPTION 's7_79 POST: la auditoría quedó antes del control del tope';
  END IF;

  -- 3.8 · nada prohibido se coló al ampliar la allowlist
  IF v_src LIKE '%license_number%' OR v_src LIKE '%doctor_credentials%'
     OR v_src LIKE '%tos_accepted_at%' OR v_src LIKE '%avatar_url%'
     OR v_src LIKE '%stripe%' OR v_src LIKE '%d.bio%' THEN
    RAISE EXCEPTION 's7_79 POST: el cuerpo referencia una columna prohibida';
  END IF;
  IF v_src ~ 'SELECT\s+\*' THEN
    RAISE EXCEPTION 's7_79 POST: hay un SELECT * — la allowlist debe ser explícita';
  END IF;

  -- 3.9 · admin_list_doctors sigue intacta y sin techo
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_list_doctors'
     AND p.prosrc LIKE '%GREATEST(p_limit, 1)%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_79 POST: admin_list_doctors cambió o adquirió un clamp';
  END IF;
  -- y NO devuelve slug: el export lo toma del JOIN, no del listado
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_list_doctors'
     AND p.prosrc LIKE '%slug%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_79 POST: admin_list_doctors fue modificada para incluir slug; este frente NO debía tocarla';
  END IF;

  RAISE NOTICE 's7_79: guardas POST OK';
END $$;
