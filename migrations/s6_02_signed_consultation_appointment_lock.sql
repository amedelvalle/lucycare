-- ═══════════════════════════════════════════════════════════
-- Migración S6-02: Integridad consulta firmada ↔ estado de cita
-- ═══════════════════════════════════════════════════════════
-- BUG CRÍTICO clínico-legal: una cita con consulta firmada podía
-- cancelarse o cambiar de estado porque firmar no bloqueaba ni
-- transicionaba la cita, y updateAppointmentStatus no tenía guarda.
--
-- Defensa de fondo en DB (no se puede saltar por UI):
--   1. Trigger en `consultations`: al pasar a 'signed', mueve la cita
--      asociada a 'atendida' de forma atómica (misma transacción).
--   2. Trigger en `appointments`: si existe una consulta 'signed' para
--      la cita, bloquea cualquier cambio de estado que NO sea hacia
--      'atendida' (cancelar, no_asistio, volver a estados previos).
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Firmar consulta → cita 'atendida' (atómico) ─────────
CREATE OR REPLACE FUNCTION sync_appointment_on_sign()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  atendida_id  uuid;
  cur_name     text;
BEGIN
  -- Solo cuando la consulta pasa a 'signed' y tiene cita asociada
  IF NEW.status = 'signed'
     AND (OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.appointment_id IS NOT NULL THEN

    SELECT id INTO atendida_id
    FROM appointment_statuses WHERE name = 'atendida' LIMIT 1;
    IF atendida_id IS NULL THEN
      RETURN NEW; -- catálogo incompleto: no bloquear la firma
    END IF;

    SELECT s.name INTO cur_name
    FROM appointments a
    JOIN appointment_statuses s ON s.id = a.status_id
    WHERE a.id = NEW.appointment_id;

    -- Si ya está en un estado final, no tocar (idempotente / respeta cancelada previa)
    IF cur_name IS NULL OR cur_name IN ('atendida', 'cancelada', 'no_asistio') THEN
      RETURN NEW;
    END IF;

    UPDATE appointments
    SET status_id = atendida_id, updated_at = now()
    WHERE id = NEW.appointment_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_appointment_on_sign ON consultations;
CREATE TRIGGER trg_sync_appointment_on_sign
  AFTER UPDATE OF status ON consultations
  FOR EACH ROW EXECUTE FUNCTION sync_appointment_on_sign();

-- ─── 2. Bloquear cambios de estado con consulta firmada ─────
CREATE OR REPLACE FUNCTION guard_appointment_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_signed   boolean;
  new_name     text;
BEGIN
  -- Solo si realmente cambia el estado
  IF NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM consultations
    WHERE appointment_id = NEW.id AND status = 'signed'
  ) INTO has_signed;

  IF NOT has_signed THEN
    RETURN NEW; -- sin consulta firmada: comportamiento normal
  END IF;

  SELECT name INTO new_name
  FROM appointment_statuses WHERE id = NEW.status_id;

  -- Con consulta firmada solo se permite que la cita quede 'atendida'
  -- (cubre la auto-transición del trigger 1 y la idempotencia).
  IF new_name IS DISTINCT FROM 'atendida' THEN
    IF new_name = 'cancelada' THEN
      RAISE EXCEPTION 'No se puede cancelar una cita con consulta firmada.';
    ELSE
      RAISE EXCEPTION 'No se puede cambiar el estado de una cita con consulta firmada.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_appointment_status_change ON appointments;
CREATE TRIGGER trg_guard_appointment_status_change
  BEFORE UPDATE OF status_id ON appointments
  FOR EACH ROW EXECUTE FUNCTION guard_appointment_status_change();
