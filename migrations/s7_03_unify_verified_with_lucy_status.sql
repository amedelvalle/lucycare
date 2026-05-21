-- ═══════════════════════════════════════════════════════════
-- Migración S7-03: is_verified derivado de lucy_status='verified'
-- ═══════════════════════════════════════════════════════════
-- Decisión 2026-05-20: una sola fuente de verdad para "verificado".
--
-- Dependencias: admin_platform_stats (vista de s7_01) y la RPC
-- get_platform_stats() que devuelve su tipo, ambas usan is_verified.
-- Por eso hay que DROP vista+RPC → ALTER columna → recrear, en orden.
--
-- Semántica final:
--   lucy_status (editable): listed_only|claimed|booking_enabled|verified
--   is_verified (DERIVADO): = (lucy_status='verified')
--   is_published / is_operational: independientes (sin cambios)
-- ═══════════════════════════════════════════════════════════

-- 1. Backfill seguro: preservar verificaciones históricas en lucy_status
UPDATE doctors
SET lucy_status = 'verified'::lucy_status, updated_at = now()
WHERE is_verified = true AND lucy_status <> 'verified';

-- 2. Drop dependientes que usan is_verified (se recrean abajo idéntico DDL)
DROP FUNCTION IF EXISTS get_platform_stats();
DROP VIEW IF EXISTS admin_platform_stats;

-- 3. Reemplazar la columna por GENERATED ALWAYS (no editable manualmente)
ALTER TABLE doctors DROP COLUMN is_verified;
ALTER TABLE doctors
  ADD COLUMN is_verified boolean
  GENERATED ALWAYS AS (lucy_status = 'verified') STORED;

-- 4. Eliminar la RPC que editaba is_verified directamente (obsoleta).
DROP FUNCTION IF EXISTS admin_set_doctor_verified(uuid, boolean);

-- 5. Recrear admin_platform_stats (DDL idéntico al de s7_01)
CREATE OR REPLACE VIEW admin_platform_stats AS
SELECT
  (SELECT count(*) FROM doctors)                                          AS doctors_total,
  (SELECT count(*) FROM doctors WHERE is_published)                       AS doctors_published,
  (SELECT count(*) FROM doctors WHERE is_verified)                        AS doctors_verified,
  (SELECT count(*) FROM patients)                                         AS patients_total,
  (SELECT count(*) FROM clinic_members
     WHERE role = 'assistant' AND is_active)                              AS assistants_active,
  (SELECT count(*) FROM appointments)                                     AS appointments_total,
  (SELECT count(*) FROM appointments a
     JOIN appointment_statuses s ON s.id = a.status_id
     WHERE s.name = 'atendida')                                           AS appointments_attended,
  (SELECT count(*) FROM consultations WHERE status = 'signed')            AS consultations_signed,
  (SELECT count(*) FROM reviews WHERE is_visible)                         AS reviews_total,
  (SELECT round(avg(rating), 2) FROM reviews WHERE is_visible)            AS reviews_avg_score;

REVOKE ALL ON admin_platform_stats FROM anon, authenticated;

-- 6. Recrear get_platform_stats() (DDL idéntico al de s7_01)
CREATE OR REPLACE FUNCTION get_platform_stats()
RETURNS admin_platform_stats
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result admin_platform_stats;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol admin';
  END IF;

  SELECT * INTO result FROM admin_platform_stats;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_platform_stats() TO authenticated;
