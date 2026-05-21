-- ═══════════════════════════════════════════════════════════
-- Migración S7-04: búsqueda + filtros + paginación para admin médicos
-- ═══════════════════════════════════════════════════════════
-- Reemplaza admin_list_doctors con una versión filtrable y paginable
-- server-side. Todos los parámetros son opcionales (con default), así
-- que llamadas sin args siguen funcionando (5 médicos o 5000).
--
-- Retorna las mismas columnas + total_count (count(*) OVER ()) para
-- que el cliente arme la paginación sin segunda query.
-- ═══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS admin_list_doctors();

CREATE OR REPLACE FUNCTION admin_list_doctors(
  p_search       text         DEFAULT NULL,
  p_published    boolean      DEFAULT NULL,
  p_operational  boolean      DEFAULT NULL,
  p_lucy_status  lucy_status  DEFAULT NULL,
  p_limit        integer      DEFAULT 50,
  p_offset       integer      DEFAULT 0
)
RETURNS TABLE (
  id              uuid,
  full_name       text,
  phone           text,
  specialty       text,
  clinic_name     text,
  is_verified     boolean,
  is_published    boolean,
  booking_enabled boolean,
  is_operational  boolean,
  lucy_status     lucy_status,
  created_at      timestamptz,
  total_count     bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search text := nullif(btrim(p_search), '');
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      d.id,
      p.full_name,
      p.phone,
      s.name        AS specialty,
      c.name        AS clinic_name,
      d.is_verified,
      d.is_published,
      d.booking_enabled,
      d.is_operational,
      d.lucy_status,
      d.created_at
    FROM doctors d
    LEFT JOIN profiles    p ON p.id = d.profile_id
    LEFT JOIN specialties s ON s.id = d.specialty_id
    LEFT JOIN clinics     c ON c.id = d.clinic_id
    WHERE (p_published   IS NULL OR d.is_published   = p_published)
      AND (p_operational IS NULL OR d.is_operational = p_operational)
      AND (p_lucy_status IS NULL OR d.lucy_status    = p_lucy_status)
      AND (
        v_search IS NULL
        OR p.full_name        ILIKE '%' || v_search || '%'
        OR s.name             ILIKE '%' || v_search || '%'
        OR COALESCE(p.phone, '') ILIKE '%' || v_search || '%'
      )
  )
  SELECT
    f.id, f.full_name, f.phone, f.specialty, f.clinic_name,
    f.is_verified, f.is_published, f.booking_enabled, f.is_operational,
    f.lucy_status, f.created_at,
    count(*) OVER ()::bigint AS total_count
  FROM filtered f
  ORDER BY f.created_at DESC
  LIMIT GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_list_doctors(text, boolean, boolean, lucy_status, integer, integer) TO authenticated;
