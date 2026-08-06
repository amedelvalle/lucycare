-- ═══════════════════════════════════════════════════════════════════════
-- s7_71a — ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════
--
-- Revierte migrations/s7_71a_audit_appointments_coverage.sql:
--   1. elimina el trigger `audit_appointments`;
--   2. elimina la función `audit_appointments_fn()`;
--   3. restaura `cancel_my_appointment` al cuerpo EXACTO de s7_70
--      (migrations/s7_70_patient_cancel_appointment.sql:329-468), incluido
--      su INSERT manual en `audit_log`.
--
-- NO BORRA DATOS. Las filas de `audit_log` escritas por el trigger mientras
-- s7_71a estuvo activa se CONSERVAN: son auditoría legítima y append-only.
-- Tras el rollback, las rutas de agenda vuelven a auditarse únicamente
-- desde el cliente (fire-and-forget), salvo la cancelación del paciente,
-- que recupera su INSERT server-side.
--
-- ATOMICIDAD (lo que realmente garantiza que no haya estados intermedios)
-- ------------------------------------------------------------------------
-- La ausencia de un estado observable con doble auditoría —o con ninguna—
-- la garantiza el `BEGIN` … `COMMIT`, NO el orden de las sentencias. Las
-- tres operaciones viven en una sola transacción: hasta el COMMIT, el resto
-- de la base ve el estado previo completo; después, el posterior completo.
-- NO hay COMMIT intermedio: exactamente un BEGIN y un COMMIT.
--
-- El orden interno (restaurar la RPC antes de quitar el trigger) es una
-- precaución SECUNDARIA, útil solo si alguien ejecutara las sentencias
-- sueltas fuera de la transacción. Por sí solo NO evitaría la doble
-- auditoría: entre ambas sentencias, la RPC restaurada y el trigger
-- coexistirían.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Restaurar cancel_my_appointment al cuerpo de s7_70 ─────────────
-- Copia literal de migrations/s7_70_patient_cancel_appointment.sql:329-468.
-- CREATE OR REPLACE preserva la ACL: no se re-otorga nada.
CREATE OR REPLACE FUNCTION public.cancel_my_appointment(
  p_appointment_id uuid,
  p_reason         text DEFAULT NULL,
  p_note           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_uid          uuid := auth.uid();
  v_reason       text;
  v_note         text;
  v_appt         public.appointments%ROWTYPE;
  v_status_name  text;
  v_cancel_id    uuid;
  v_has_event    boolean;
BEGIN
  -- 7.1 Sesión obligatoria.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado.' USING ERRCODE = 'P0110';
  END IF;

  -- 7.2 Normalización ANTES de validar: '' y solo-espacios → NULL.
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  v_note   := nullif(btrim(coalesce(p_note,   '')), '');

  IF v_reason IS NOT NULL
     AND v_reason NOT IN ('no_puedo_asistir', 'otro_horario', 'ya_no_necesito', 'otro') THEN
    RAISE EXCEPTION 'Motivo no válido.' USING ERRCODE = 'P0114';
  END IF;
  -- Se RECHAZA, no se trunca: truncar alteraría lo que el paciente escribió.
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN
    RAISE EXCEPTION 'La nota supera el máximo permitido.' USING ERRCODE = 'P0115';
  END IF;

  -- 7.3 Bloqueo Y pertenencia en la MISMA sentencia.
  SELECT a.* INTO v_appt
  FROM public.appointments a
  JOIN public.patients p ON p.id = a.patient_id
  WHERE a.id = p_appointment_id
    AND p.profile_id = v_uid
    AND p.link_confirmed_at IS NOT NULL
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pudimos procesar la solicitud.' USING ERRCODE = 'P0111';
  END IF;

  SELECT s.name INTO v_status_name
  FROM public.appointment_statuses s
  WHERE s.id = v_appt.status_id;

  -- 7.5 Idempotencia ESTRICTA.
  IF v_status_name = 'cancelada' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.appointment_patient_cancellations c
      WHERE c.appointment_id = v_appt.id
    ) INTO v_has_event;

    IF v_has_event THEN
      RETURN jsonb_build_object(
        'success', true,
        'outcome', 'already_cancelled_by_patient',
        'appointment_id', v_appt.id
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'already_cancelled_by_other',
      'appointment_id', v_appt.id
    );
  END IF;

  -- 7.6 Elegibilidad.
  IF v_status_name IS DISTINCT FROM 'programada'
     AND v_status_name IS DISTINCT FROM 'confirmada' THEN
    RAISE EXCEPTION 'Esta cita ya no puede cancelarse.' USING ERRCODE = 'P0112';
  END IF;
  IF v_appt.start_time <= now() THEN
    RAISE EXCEPTION 'Esta cita ya no puede cancelarse.' USING ERRCODE = 'P0113';
  END IF;

  SELECT s.id INTO v_cancel_id
  FROM public.appointment_statuses s
  WHERE s.name = 'cancelada';
  IF v_cancel_id IS NULL THEN
    RAISE EXCEPTION 'No pudimos procesar la solicitud.' USING ERRCODE = 'P0111';
  END IF;

  -- 7.7 UPDATE acotado ÚNICAMENTE a status_id.
  UPDATE public.appointments
  SET status_id = v_cancel_id
  WHERE id = v_appt.id;

  -- 7.8 Evento append-only, misma transacción.
  INSERT INTO public.appointment_patient_cancellations
    (appointment_id, cancelled_at, cancelled_by_profile_id, reason, note)
  VALUES
    (v_appt.id, now(), v_uid, v_reason, v_note);

  -- 7.9 Auditoría server-side. La nota libre NO va al audit.
  INSERT INTO public.audit_log
    (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_uid,
    'update'::public.audit_action,
    'appointments',
    v_appt.id,
    jsonb_build_object('status', v_status_name),
    jsonb_build_object(
      'status', 'cancelada',
      'edited_via', 'patient_self_cancel',
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'outcome', 'cancelled',
    'appointment_id', v_appt.id,
    'cancelled_at', now()
  );
END
$fn$;

COMMENT ON FUNCTION public.cancel_my_appointment(uuid, text, text) IS NULL;

-- ─── 2. Quitar el trigger y su función ─────────────────────────────────
DROP TRIGGER IF EXISTS audit_appointments ON public.appointments;
DROP FUNCTION IF EXISTS public.audit_appointments_fn();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN POST-ROLLBACK (read-only):
--
--   SELECT count(*) FROM pg_trigger t
--   JOIN pg_class c ON c.oid = t.tgrelid
--   WHERE NOT t.tgisinternal AND c.relname = 'appointments'
--     AND t.tgname = 'audit_appointments';            -- esperado: 0
--
--   SELECT to_regprocedure('public.audit_appointments_fn()');  -- NULL
--
--   SELECT prosrc LIKE '%INSERT INTO public.audit_log%'
--   FROM pg_proc WHERE oid =
--     to_regprocedure('public.cancel_my_appointment(uuid,text,text)');
--                                                      -- esperado: true
-- ═══════════════════════════════════════════════════════════════════════
