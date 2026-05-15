-- ═══════════════════════════════════════════════════════════
-- Migración S6-03: Bloquear citas en el pasado
-- ═══════════════════════════════════════════════════════════
-- Bug de integridad de agenda: se podían crear (y reprogramar)
-- citas con fecha/hora anterior al momento actual.
--
-- Defensa de fondo en DB (cubre TODOS los caminos: booking del
-- directorio, walk-in, follow-up, reprogramación y requests directos).
--
-- `start_time` es timestamptz: la comparación con now() es un
-- instante absoluto, así que la zona horaria (America/El_Salvador)
-- queda correctamente contemplada sin lógica extra.
--
-- Gracia de 2 minutos: evita falsos positivos al crear una cita
-- "para ahora" (walk-in) donde el insert ocurre segundos después.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION block_past_appointment()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  -- En UPDATE solo validar si realmente cambia start_time
  IF TG_OP = 'UPDATE' AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time THEN
    RETURN NEW;
  END IF;

  IF NEW.start_time < now() - interval '2 minutes' THEN
    RAISE EXCEPTION 'No se puede crear una cita en una fecha u hora pasada.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_past_appointment ON appointments;
CREATE TRIGGER trg_block_past_appointment
  BEFORE INSERT OR UPDATE OF start_time ON appointments
  FOR EACH ROW EXECUTE FUNCTION block_past_appointment();
