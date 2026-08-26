-- ============================================================
-- s7_78 · ADMIN-DOCTOR-EXPORT — exportación de la base de médicos
-- ============================================================
--
-- Permite al Owner Admin descargar desde LucyAdmin la base administrativa de
-- médicos que cumple EXACTAMENTE los filtros activos en pantalla, no la página
-- visible.
--
-- ── POR QUÉ LLAMA A `admin_list_doctors` EN VEZ DE REPETIR SU WHERE ──
-- El predicado del listado (búsqueda ILIKE sobre nombre/especialidad/teléfono,
-- más los tres filtros booleanos/enum) vive en UN SOLO lugar: `s7_04`. Copiarlo
-- aquí crearía dos definiciones que se separarían al primer cambio, y el
-- síntoma sería silencioso: un CSV que no coincide con lo que el admin ve.
-- `admin_list_doctors` es `RETURNS TABLE`, así que se invoca en el `FROM` y el
-- export solo ENRIQUECE por `id` las columnas que esa RPC no devuelve —correo,
-- dirección, departamento y municipio—.
--
-- Verificado antes de escribir esto: `admin_list_doctors` aplica
-- `LIMIT GREATEST(p_limit, 1)`, un PISO de 1 sin techo. No hay `LEAST` ni clamp
-- interno, así que acepta `MAX_EXPORT + 1 = 10001` sin recortar.
--
-- ── ORDEN ──
-- El `ORDER BY` de la función invocada NO sobrevive al JOIN: PostgreSQL no
-- garantiza el orden de una subconsulta una vez que se une a otras tablas. Por
-- eso el orden determinista se aplica AQUÍ, al final, y con desempate por `id`.
--
-- ⚠️ Deuda registrada, NO corregida en este frente: `admin_list_doctors` ordena
-- por `created_at DESC` **sin desempate**, así que dos médicos creados en el
-- mismo instante pueden intercambiarse entre páginas de la pantalla. Es un
-- defecto de la paginación existente, no del export.
--
-- ── LO QUE NO HACE ──
-- No toca `doctors`, `profiles`, `clinics` ni ninguna tabla de negocio: es
-- READ-ONLY salvo la fila de auditoría. No exporta actividad (citas, atenciones,
-- última actividad, próxima cita) ni ratings: eso exigiría agregaciones sobre
-- tablas que crecen con el uso, y este export debe escalar a 10 000 médicos en
-- una sola pasada. Queda registrado como ADMIN-DOCTOR-EXPORT-P1.
--
-- No incluye `license_number` ni nada de `doctor_credentials`: el número de
-- registro profesional está protegido por RLS POR FILA (s7_61) y la columna de
-- `doctors` está en retiro lógico (F1-c1). Un CSV lo sacaría de ese control.
-- ============================================================

-- ─── 1. RPC de exportación ──────────────────────────────────
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
        'created_at',   l.created_at
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
  'ADMIN-DOCTOR-EXPORT-P0. Devuelve la base administrativa de médicos que cumple EXACTAMENTE los filtros activos del listado, no la página visible. Reutiliza admin_list_doctors para el universo —el predicado vive en un solo lugar y no puede derivar— y enriquece por id con correo, dirección, departamento y municipio. Allowlist explícita de 15 campos: sin license_number, sin credenciales, sin UUID internos, sin bio, sin TOS. Tope 10000; por encima aborta con P0146 en vez de truncar. Audita SOLO metadata no-PII: nunca el texto buscado ni las filas. Gate is_admin(): directory_editor recibe P0140.';

-- ─── 2. Grants — EXPLÍCITOS, sin depender de defaults ───────
--
-- PostgreSQL concede EXECUTE a PUBLIC por defecto al crear una función. Ese
-- default es justamente lo que no se quiere heredar, así que los cuatro roles
-- se declaran uno por uno:
--
--   · PUBLIC        → REVOKE. Quita el default.
--   · anon          → REVOKE. Un visitante sin sesión no exporta nada.
--   · authenticated → GRANT. Es la puerta; quién pasa lo decide `is_admin()`
--                     adentro, porque un GRANT no distingue niveles de admin.
--   · service_role  → REVOKE. Ningún script del proyecto necesita exportar la
--                     base de médicos, y `service_role` no tiene `auth.uid()`,
--                     así que el gate le devolvería P0140 igualmente. Se revoca
--                     de todos modos: defensa en profundidad, no confianza en
--                     que el gate nunca cambie.
--
-- `directory_editor` es `authenticated`, así que RECIBE el grant y, aun así, el
-- gate lo rechaza con P0140: `is_admin()` es `profiles.role='admin'` y ese nivel
-- vive en `lucyadmin_access`, no en `profiles.role`. Autenticado sí; autorizado
-- no. Ese es el punto: el privilegio no se amplía a ningún rol administrativo.
REVOKE ALL ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) TO authenticated;

-- ─── 3. Guardas POST ────────────────────────────────────────
-- Corren DENTRO de la migración: si algo no quedó como se espera, la
-- transacción aborta y no se deja media migración aplicada.
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
    RAISE EXCEPTION 's7_78 POST: admin_export_doctors no existe';
  END IF;

  -- 3.1 · SECURITY DEFINER
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 's7_78 POST: la función no es SECURITY DEFINER';
  END IF;

  -- 3.2 · VOLATILE: audita, así que no puede ser STABLE ni IMMUTABLE
  IF (SELECT provolatile::text FROM pg_proc WHERE oid = v_oid) <> 'v' THEN
    RAISE EXCEPTION 's7_78 POST: la función debe ser VOLATILE (escribe auditoría)';
  END IF;

  -- 3.3 · search_path fijo
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = v_oid
       AND proconfig @> ARRAY['search_path=public, pg_catalog']
  ) THEN
    RAISE EXCEPTION 's7_78 POST: falta SET search_path fijo';
  END IF;

  -- 3.4 · privilegios EXPLÍCITOS de los cuatro roles, sin defaults heredados
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 's7_78 POST: anon conserva EXECUTE';
  END IF;
  IF has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 's7_78 POST: service_role conserva EXECUTE';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 's7_78 POST: authenticated no puede ejecutarla';
  END IF;
  -- El default de PostgreSQL concede EXECUTE a PUBLIC: el REVOKE debe haberlo
  -- quitado. `proacl` nula significa "defaults vigentes", que es lo prohibido.
  --
  -- ⚠️ La entrada de PUBLIC es la que EMPIEZA por '=' (grantee vacío). Buscar
  -- '=X/' en el ACL entero daría un falso positivo con `authenticated=X/owner`,
  -- que es precisamente el privilegio que SÍ queremos. Por eso se recorre el
  -- array elemento a elemento en vez de aplanarlo a texto.
  IF (SELECT proacl FROM pg_proc WHERE oid = v_oid) IS NULL THEN
    RAISE EXCEPTION 's7_78 POST: la función conserva los privilegios por defecto (PUBLIC con EXECUTE)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, unnest(p.proacl) AS a
     WHERE p.oid = v_oid AND a::text LIKE '=%'
  ) THEN
    RAISE EXCEPTION 's7_78 POST: PUBLIC conserva privilegios sobre la función';
  END IF;

  -- ─── Análisis del cuerpo EJECUTABLE, sin comentarios ──────
  -- Mirar `prosrc` crudo da falsos positivos: los comentarios de esta misma
  -- migración nombran a propósito lo que está prohibido («sin license_number»,
  -- «aceptar xlsx sería peor que inútil»). Es la lección que ya costó dos
  -- correcciones en s7_77.
  SELECT regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', '', 'gs'),
                        '--[^\n]*', '', 'g')
    INTO v_src FROM pg_proc WHERE oid = v_oid;

  -- 3.5 · reutiliza el universo del listado
  IF v_src NOT LIKE '%admin_list_doctors%' THEN
    RAISE EXCEPTION 's7_78 POST: no reutiliza admin_list_doctors — el predicado quedaría duplicado';
  END IF;

  -- 3.6 · gate y formato
  IF v_src NOT LIKE '%P0140%' THEN RAISE EXCEPTION 's7_78 POST: falta el gate P0140'; END IF;
  IF v_src NOT LIKE '%P0142%' THEN RAISE EXCEPTION 's7_78 POST: falta el rechazo de formato P0142'; END IF;
  IF v_src NOT LIKE '%P0146%' THEN RAISE EXCEPTION 's7_78 POST: falta el tope P0146'; END IF;
  IF v_src NOT LIKE '%is_admin()%' THEN RAISE EXCEPTION 's7_78 POST: falta is_admin()'; END IF;

  -- 3.7 · el tope es 10000, no otro
  IF v_src NOT LIKE '%10000%' THEN
    RAISE EXCEPTION 's7_78 POST: MAX_EXPORT no es 10000';
  END IF;

  -- 3.8 · orden determinista GARANTIZADO por el agregado
  -- No basta con que exista un `ORDER BY`: tiene que estar DENTRO de
  -- `jsonb_agg`. Un `ORDER BY` en la subconsulta no obliga al agregado, así que
  -- el array podría salir en cualquier orden aunque el texto "parezca" correcto.
  IF v_src !~ 'jsonb_agg\s*\(\s*x\.fila\s+ORDER BY\s+x\.created_at DESC,\s*x\.id\s*\)' THEN
    RAISE EXCEPTION 's7_78 POST: el ORDER BY no está dentro de jsonb_agg — el orden del array no estaría garantizado';
  END IF;
  -- Y que no haya un ORDER BY suelto al final del SELECT del que alguien pueda
  -- fiarse por error: el único que manda es el del agregado.
  IF v_src ~ '\)\s*x\s*;\s*ORDER BY' THEN
    RAISE EXCEPTION 's7_78 POST: hay un ORDER BY externo que no gobierna el agregado';
  END IF;

  -- 3.8b · la auditoría se escribe DESPUÉS de las tres validaciones
  -- Un intento rechazado por P0146 no debe dejar una fila de export exitoso.
  -- (El RAISE aborta la transacción de todos modos, pero el orden textual es lo
  -- que impide que un refactor futuro mueva el INSERT antes del control.)
  IF position('P0140' in v_src) > position('INSERT INTO public.audit_log' in v_src)
     OR position('P0142' in v_src) > position('INSERT INTO public.audit_log' in v_src)
     OR position('P0146' in v_src) > position('INSERT INTO public.audit_log' in v_src) THEN
    RAISE EXCEPTION 's7_78 POST: la auditoría se escribe antes de alguna validación';
  END IF;

  -- 3.9 · NADA de credenciales ni de columnas prohibidas
  IF v_src LIKE '%license_number%' OR v_src LIKE '%doctor_credentials%'
     OR v_src LIKE '%tos_accepted_at%' OR v_src LIKE '%avatar_url%'
     OR v_src LIKE '%stripe%' OR v_src LIKE '%d.bio%' THEN
    RAISE EXCEPTION 's7_78 POST: el cuerpo referencia una columna prohibida';
  END IF;

  -- 3.10 · sin SELECT *: la allowlist debe ser explícita
  IF v_src ~ 'SELECT\s+\*' THEN
    RAISE EXCEPTION 's7_78 POST: hay un SELECT * — la allowlist debe ser explícita';
  END IF;

  -- 3.11 · la auditoría NO guarda el texto buscado
  IF v_src LIKE '%''busqueda'', p_search%' OR v_src LIKE '%''search'', p_search%' THEN
    RAISE EXCEPTION 's7_78 POST: la auditoría guardaría el texto buscado';
  END IF;
  IF v_src NOT LIKE '%con_busqueda%' THEN
    RAISE EXCEPTION 's7_78 POST: falta el booleano con_busqueda en la auditoría';
  END IF;

  -- 3.12 · no escribe en tablas de negocio
  IF v_src ~* '(INSERT|UPDATE|DELETE)\s+(INTO\s+)?(public\.)?(doctors|profiles|clinics|specialties)\b' THEN
    RAISE EXCEPTION 's7_78 POST: la función escribiría en una tabla de negocio';
  END IF;

  -- 3.13 · admin_list_doctors sigue sin techo, que es lo que hace viable el tope
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_list_doctors'
     AND p.prosrc LIKE '%GREATEST(p_limit, 1)%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_78 POST: admin_list_doctors ya no aplica GREATEST(p_limit, 1); revisar si adquirió un clamp';
  END IF;

  RAISE NOTICE 's7_78: guardas POST OK';
END $$;
