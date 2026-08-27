-- ============================================================
-- ROLLBACK de s7_79 · ADMIN-DOCTOR-EXPORT-URL-P0
-- ============================================================
--
-- Revierte el export de medicos a su definicion de s7_78, es decir: SIN la
-- clave 'slug' en la allowlist. El CSV vuelve de 17 a 15 columnas.
--
-- Este bloque NO se transcribio a mano: se extrajo del propio
-- migrations/s7_78_admin_doctor_export.sql, para que la definicion restaurada
-- no pueda divergir por un error de copia. Es literalmente lo que se aplico en
-- produccion el 2026-08-26.
--
-- s7_78 NO se reaplica: este archivo reproduce su funcion, no la ejecuta desde
-- su migracion. Y no toca admin_list_doctors, que s7_79 tampoco toco.
--
-- Las filas de audit_log con table_name='admin_doctor_export' NO se borran:
-- son evidencia de exportaciones que realmente ocurrieron, y audit_log es
-- inmutable desde s7_71b.
--
-- Tras aplicarlo, el frontend desplegado seguiria pidiendo dos columnas que la
-- RPC ya no devuelve: Slug y URL publica saldrian VACIAS —no rotas, porque el
-- servicio trata el campo ausente como null—. Aun asi conviene revertir tambien
-- ese despliegue.
-- ============================================================

BEGIN;

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

-- Grants repuestos, identicos a s7_78.
REVOKE ALL ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_export_doctors(text, boolean, boolean, lucy_status, text) TO authenticated;

-- ─── Verificacion del rollback ──────────────────────────────
DO $$
DECLARE
  v_src text;
  v_n   int;
BEGIN
  -- Cuerpo EJECUTABLE, sin comentarios: mirar `prosrc` crudo daría falsos
  -- positivos, porque los comentarios de la función nombran lo que se busca.
  SELECT regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'gs'), '--[^\n]*', '', 'g')
    INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_export_doctors';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'rollback s7_79: admin_export_doctors no existe';
  END IF;
  IF v_src ~ '''slug'',\s*d\.slug' THEN
    RAISE EXCEPTION 'rollback s7_79: el slug sigue en la allowlist';
  END IF;
  IF v_src NOT LIKE '%admin_list_doctors%' THEN
    RAISE EXCEPTION 'rollback s7_79: se perdio la reutilizacion del listado';
  END IF;
  IF v_src NOT LIKE '%P0140%' OR v_src NOT LIKE '%P0146%' OR v_src NOT LIKE '%10000%' THEN
    RAISE EXCEPTION 'rollback s7_79: se perdio el gate o el tope';
  END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_list_doctors';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'rollback s7_79: admin_list_doctors quedo en % definiciones', v_n;
  END IF;

  RAISE NOTICE 'rollback s7_79: OK — export de vuelta en la definicion de s7_78, sin slug';
END $$;

COMMIT;
