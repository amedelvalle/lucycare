-- ═══════════════════════════════════════════════════════════
-- Migración S6-10: Bloquear reprogramación de citas no editables
-- ═══════════════════════════════════════════════════════════
-- Feature "Editar cita": no se puede mover fecha/hora si la cita ya
-- está en estado final (atendida/cancelada/no_asistio) o tiene una
-- consulta firmada. Defensa de fondo, además de UI + servicio.
--
-- Ya existen (no se tocan):
--   s6_03 → bloquea start_time en el pasado
--   s6_04 → bloquea start_time fuera de disponibilidad
--   s6_02 → bloquea cambios de estado con consulta firmada
-- Esta migración cubre el hueco: editar start_time de una cita
-- cuyo estado ya no admite reprogramación.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION block_reschedule_locked_appointment()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  st_name    text;
  has_signed boolean;
BEGIN
  -- Solo si realmente cambia start_time
  IF NEW.start_time IS NOT DISTINCT FROM OLD.start_time THEN
    RETURN NEW;
  END IF;

  SELECT name INTO st_name
  FROM appointment_statuses WHERE id = NEW.status_id;

  IF st_name IN ('atendida', 'cancelada', 'no_asistio') THEN
    RAISE EXCEPTION 'Esta cita ya no puede modificarse por su estado actual.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM consultations
    WHERE appointment_id = NEW.id AND status = 'signed'
  ) INTO has_signed;

  IF has_signed THEN
    RAISE EXCEPTION 'Esta cita ya no puede modificarse por su estado actual.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_reschedule_locked ON appointments;
CREATE TRIGGER trg_block_reschedule_locked
  BEFORE UPDATE OF start_time ON appointments
  FOR EACH ROW EXECUTE FUNCTION block_reschedule_locked_appointment();
