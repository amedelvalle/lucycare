-- ═══════════════════════════════════════════════════════════
-- Migración S7-09: bloquear servicios inactivos en citas
-- ═══════════════════════════════════════════════════════════
-- B3-doctor permite desactivar servicios. El perfil público y el
-- booking ya respetan is_active. Falta el guard de backend: que no se
-- creen (ni reasignen) citas con un service_id inactivo — sin depender
-- solo del filtro visual.
--
-- Trigger BEFORE INSERT OR UPDATE en appointments:
--   - INSERT con service_id inactivo            → bloqueado.
--   - UPDATE que CAMBIA service_id a uno inactivo → bloqueado.
--   - UPDATE que NO cambia service_id            → permitido (una cita
--     histórica cuyo servicio quedó inactivo se sigue editando: fecha,
--     notas, precio, estado, etc.).
--   - service_id NULL                            → permitido.
--
-- IS DISTINCT FROM maneja NULLs correctamente. Idempotente
-- (CREATE OR REPLACE + DROP TRIGGER IF EXISTS). No destructivo: las
-- citas existentes no se tocan.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION block_inactive_service_appointment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.service_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.service_id IS DISTINCT FROM OLD.service_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM services
      WHERE id = NEW.service_id AND is_active = true
    ) THEN
      RAISE EXCEPTION 'No se puede asignar un servicio inactivo a una cita.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_inactive_service ON appointments;

CREATE TRIGGER trg_block_inactive_service
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION block_inactive_service_appointment();
