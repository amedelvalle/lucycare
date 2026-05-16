-- ═══════════════════════════════════════════════════════════
-- Migración S6-04: Bloquear citas fuera de disponibilidad
-- ═══════════════════════════════════════════════════════════
-- Bug: se podían crear/reprogramar citas fuera del horario
-- configurado del médico (ej: Dr. con viernes 08:00–16:00 y
-- cita creada 20:30–21:00).
--
-- Defensa de fondo en DB (no se puede saltar por request directo;
-- cubre creación manual, walk-in, follow-up y reprogramación).
--
-- Regla: la cita COMPLETA (start..end) debe caer dentro de al
-- menos una availability_rule activa del médico para ese día de
-- la semana. Se evalúa en hora local America/El_Salvador (las
-- reglas están configuradas en hora local del médico).
-- day_of_week: 0=domingo .. 6=sábado (igual que JS getDay / DOW).
--
-- Los overrides que BLOQUEAN se validan en la capa de servicio
-- (availability.service), que ya tiene la lógica de slots.service.
-- Los overrides nunca AGREGAN disponibilidad en este modelo.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION block_outside_availability()
RETURNS trigger LANGUAGE plpgsql
AS $$
DECLARE
  loc_start   timestamp;
  loc_end     timestamp;
  dow         int;
  t_start     time;
  t_end       time;
BEGIN
  -- En UPDATE solo validar si cambia el horario
  IF TG_OP = 'UPDATE'
     AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
     AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time THEN
    RETURN NEW;
  END IF;

  loc_start := NEW.start_time AT TIME ZONE 'America/El_Salvador';
  loc_end   := NEW.end_time   AT TIME ZONE 'America/El_Salvador';

  dow     := EXTRACT(DOW FROM loc_start)::int;
  t_start := loc_start::time;
  t_end   := loc_end::time;

  IF NOT EXISTS (
    SELECT 1
    FROM availability_rules r
    WHERE r.doctor_id = NEW.doctor_id
      AND r.is_active = true
      AND r.day_of_week = dow
      AND r.start_time <= t_start
      AND r.end_time   >= t_end
  ) THEN
    RAISE EXCEPTION 'El médico no tiene disponibilidad en ese horario.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_outside_availability ON appointments;
CREATE TRIGGER trg_block_outside_availability
  BEFORE INSERT OR UPDATE OF start_time, end_time ON appointments
  FOR EACH ROW EXECUTE FUNCTION block_outside_availability();
