-- ═══════════════════════════════════════════════════════════
-- Migración S7-55: bloqueo ATÓMICO de doble reserva (anti-solapamiento)
-- ═══════════════════════════════════════════════════════════
-- CAUSA RAÍZ (diagnóstico): los 3 flujos (reserva pública booking.service,
-- walk-in walkIn.service, reschedule appointments.service) validan conflictos
-- SOLO en el cliente (check-then-insert/update), sin guard atómico en DB. El
-- trigger existente s6_04 solo valida la ventana de disponibilidad del médico,
-- NO el solapamiento con citas existentes. Dos reservas concurrentes (o
-- reintentos / dos pestañas) ambas leen "sin conflicto" y ambas insertan →
-- doble reserva (confirmado en prod: 2 citas 'programada' idénticas).
--
-- FIX: trigger server-side que impide crear/mover una cita que se SOLAPE con
-- otra cita ACTIVA del MISMO médico. Fuente de verdad en DB; los checks
-- client-side quedan como feedback rápido de UX (ya no como red de seguridad).
--
-- REGLA DE "ACTIVO" (alineada al catálogo, sin hardcodear nombres):
--   • bloquea si appointment_statuses.is_final = false  (programada/confirmada/en_sala)
--   • NO bloquea si is_final = true                     (cancelada/no_asistio/atendida
--     y cualquier estado final futuro)
--   Además, una cita ENTRANTE con estado final no se valida (no ocupa horario).
--
-- SOLAPAMIENTO: rango semiabierto tstzrange(start, end, '[)') con `&&`. Dos
-- citas adyacentes (una termina justo cuando empieza la otra) NO se solapan.
--
-- ATOMICIDAD / CONCURRENCIA: pg_advisory_xact_lock(doctor) al inicio serializa
-- las reservas concurrentes del MISMO médico dentro de la transacción → elimina
-- el race check-then-insert. Distintos médicos no se bloquean entre sí.
--
-- SEGURIDAD: SECURITY DEFINER + SET search_path = public — IMPRESCINDIBLE: el
-- chequeo de solapamiento debe ver TODAS las citas del médico (de cualquier
-- paciente); bajo RLS del invocador (p. ej. un paciente reservando) no vería la
-- cita en conflicto de otro paciente y no bloquearía. Solo LEE; NO escribe otras
-- filas, NO crea tablas, NO toca RLS ni modifica datos existentes.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION prevent_appointment_overlap()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_incoming_is_final boolean;
BEGIN
  -- La cita entrante en estado FINAL (cancelada/no_asistio/atendida) no ocupa
  -- horario → no hay nada que validar.
  SELECT s.is_final INTO v_incoming_is_final
  FROM appointment_statuses s
  WHERE s.id = NEW.status_id;

  IF v_incoming_is_final IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Serializa las reservas concurrentes del MISMO médico dentro de la
  -- transacción (clave = hash del doctor_id) → cierra el race check-then-insert.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.doctor_id::text)::bigint);

  -- Conflicto: otra cita del mismo médico, ACTIVA (is_final=false), cuyo rango
  -- [start,end) se solapa con el de la cita entrante. Excluye la propia (UPDATE).
  IF EXISTS (
    SELECT 1
    FROM appointments a
    JOIN appointment_statuses s ON s.id = a.status_id
    WHERE a.doctor_id = NEW.doctor_id
      AND a.id <> NEW.id
      AND s.is_final = false
      AND tstzrange(a.start_time, a.end_time, '[)')
          && tstzrange(NEW.start_time, NEW.end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'Ese horario ya está ocupado por otra cita activa del médico.'
      USING ERRCODE = 'P0090';
  END IF;

  RETURN NEW;
END;
$$;

-- Fires solo cuando cambia algo que afecta el solapamiento: médico, horario o
-- estado (reactivar una cita final re-valida). Editar notas/precio/servicio NO
-- dispara el trigger (no cambia el horario ni el estado).
DROP TRIGGER IF EXISTS trg_prevent_appointment_overlap ON appointments;
CREATE TRIGGER trg_prevent_appointment_overlap
  BEFORE INSERT OR UPDATE OF doctor_id, start_time, end_time, status_id ON appointments
  FOR EACH ROW EXECUTE FUNCTION prevent_appointment_overlap();

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_55.mjs + node scripts/_smoke-s7_55.mjs
-- ───────────────────────────────────────────────────────────
