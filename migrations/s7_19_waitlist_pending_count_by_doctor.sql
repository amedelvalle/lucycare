-- ═══════════════════════════════════════════════════════════
-- Migración S7-19: Conteo de pendientes en bulk por médico
-- ═══════════════════════════════════════════════════════════
-- Cierra feedback operativo del PR Directorio PR-B: el contador
-- de pendientes del waitlist queda visible en /admin/medicos
-- (listado general), no solo dentro de /admin/medicos/:id.
--
-- En lugar de llamar admin_count_waitlist_for_doctor N veces
-- desde el frontend (N+1 para 113 médicos), devolvemos en una
-- sola RPC solo los pares (doctor_id, count) que tienen al menos
-- 1 pendiente. Los médicos sin pendientes simplemente no
-- aparecen en el resultado.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_waitlist_pending_count_by_doctor()
RETURNS TABLE (doctor_id uuid, pending_count int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;

  RETURN QUERY
  SELECT w.doctor_id, count(*)::int AS pending_count
  FROM waitlist_entries w
  WHERE w.status = 'pending'
  GROUP BY w.doctor_id
  HAVING count(*) > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_waitlist_pending_count_by_doctor() TO authenticated;
