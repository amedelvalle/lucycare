-- ═══════════════════════════════════════════════════════════════════════
-- s7_71a — AUDIT-SEC-P0 · PR 1: cobertura server-side de `appointments`
-- ═══════════════════════════════════════════════════════════════════════
--
-- CONTEXTO
-- --------
-- El diagnóstico AUDIT-SEC-P0 (Fase 0, read-only) confirmó que `audit_log`
-- admite INSERT arbitrario por `public` / `anon` / `authenticated`:
--
--     policy `audit_log_insert_only` — PERMISSIVE, roles={public},
--     cmd=INSERT, WITH CHECK **true**   (única policy de la tabla)
--     ACL: {postgres=arwdDxtm, anon=arwdDxtm,
--           authenticated=arwdDxtm, service_role=arwdDxtm}
--
-- El cierre de ese agujero (REVOKE + DROP POLICY) es **s7_71b**, y NO se
-- toca acá. Antes hay que garantizar que la auditoría legítima de agenda
-- exista del lado del servidor, porque hoy los tres eventos de
-- `appointments` se auditan ÚNICAMENTE desde el cliente:
--
--     src/services/appointments.service.ts:342  (cambio de estado)
--     src/services/appointments.service.ts:500  (edición / reprogramación)
--     src/services/walkIn.service.ts:252        (walk-in)
--
-- …y esas llamadas son fire-and-forget (`auditLog.service.ts:29-32` hace
-- console.warn y NO relanza). Revocar el INSERT sin sustituirlas primero
-- eliminaría esa auditoría **en silencio**.
--
-- `appointments` tiene hoy 7 triggers (s6_01, s6_02, s6_03, s6_04, s6_10,
-- s7_09, s7_55) y NINGUNO escribe en `audit_log`: todos son guardas de
-- negocio. Esta migración añade el primero de auditoría.
--
-- QUÉ HACE
-- --------
--   1. `public.audit_appointments_fn()` — SECURITY DEFINER, search_path
--      fijado, `public.audit_log` calificado, whitelist de columnas.
--   2. REVOKE EXECUTE de esa función para PUBLIC/anon/authenticated/
--      service_role (el trigger sigue disparando por ownership).
--   3. Trigger `audit_appointments` AFTER INSERT OR UPDATE.
--   4. CREATE OR REPLACE de `cancel_my_appointment`: conserva ÍNTEGRAS sus
--      validaciones de s7_70, fija el contexto transaccional y elimina
--      ÚNICAMENTE su INSERT manual en `audit_log` (pasa a producirlo el
--      trigger, una sola vez).
--
-- QUÉ **NO** HACE (es s7_71b)
-- ---------------------------
--   · NO revoca privilegios de `audit_log` ni de `audit_log_id_seq`.
--   · NO borra la policy `audit_log_insert_only`.
--   · NO añade la columna `integrity_epoch`.
--   · NO toca `_admin_log_doctor_change`.
--   · NO cambia el frontend.
--
-- ESTADO TRANSITORIO ESPERADO
-- ---------------------------
-- Entre s7_71a y s7_71b hay **doble auditoría** en cambio de estado,
-- edición y walk-in (trigger + cliente). Es redundante y NO dañino, y es
-- justamente lo que permite comparar ambas salidas en la validación.
--
-- REVERSIÓN: migrations/s7_71a_rollback.sql
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 0. PREFLIGHT — aborta si el estado real no es el esperado ─────────
DO $pre$
BEGIN
  IF to_regclass('public.appointments') IS NULL THEN
    RAISE EXCEPTION 's7_71a PRE: no existe public.appointments';
  END IF;

  IF to_regclass('public.audit_log') IS NULL THEN
    RAISE EXCEPTION 's7_71a PRE: no existe public.audit_log';
  END IF;

  IF to_regclass('public.appointment_statuses') IS NULL THEN
    RAISE EXCEPTION 's7_71a PRE: no existe public.appointment_statuses';
  END IF;

  -- s7_70 debe estar aplicada: se hace CREATE OR REPLACE sobre su RPC.
  IF to_regprocedure('public.cancel_my_appointment(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 's7_71a PRE: no existe cancel_my_appointment(uuid,text,text) — s7_70 no aplicada';
  END IF;

  IF to_regclass('public.appointment_patient_cancellations') IS NULL THEN
    RAISE EXCEPTION 's7_71a PRE: no existe appointment_patient_cancellations — s7_70 no aplicada';
  END IF;

  -- Columnas de audit_log que se escriben.
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_log'
        AND column_name IN ('user_id','action','table_name','record_id','old_data','new_data')
     ) <> 6 THEN
    RAISE EXCEPTION 's7_71a PRE: audit_log no tiene las 6 columnas esperadas';
  END IF;

  -- Columnas de la whitelist.
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'appointments'
        AND column_name IN ('status_id','cancel_reason_id','start_time','end_time',
                            'doctor_id','patient_id','service_id','source','price')
     ) <> 9 THEN
    RAISE EXCEPTION 's7_71a PRE: appointments no tiene las 9 columnas de la whitelist';
  END IF;

  -- El estado 'cancelada' se usa para validar el contexto.
  IF NOT EXISTS (SELECT 1 FROM public.appointment_statuses WHERE name = 'cancelada') THEN
    RAISE EXCEPTION 's7_71a PRE: no existe el estado ''cancelada''';
  END IF;

  -- auth.uid() y auth.jwt() son la fuente del actor. auth.role() NO se usa
  -- (deprecada en algunas versiones de Supabase) — decisión del owner.
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 's7_71a PRE: no existe auth.uid()';
  END IF;
  IF to_regprocedure('auth.jwt()') IS NULL THEN
    RAISE EXCEPTION 's7_71a PRE: no existe auth.jwt()';
  END IF;

  -- No debe haber ya un trigger de auditoría sobre appointments.
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname = 'public'
      AND c.relname = 'appointments' AND t.tgname = 'audit_appointments'
  ) THEN
    RAISE NOTICE 's7_71a PRE: el trigger audit_appointments ya existe — se recreará';
  END IF;
END
$pre$;

-- ─── 1. Función de auditoría ───────────────────────────────────────────
--
-- ACTOR (decisión vinculante del owner):
--   · auth.uid()            → identidad del usuario
--   · auth.jwt() ->> 'role' → rol del JWT de la solicitud
--   · current_user          → SOLO como `db_executor` (dentro de una
--     función SECURITY DEFINER es siempre `postgres`, así que NO es el
--     actor funcional).
--   NO se usa auth.role(). NO se almacena auth.jwt() completo ni ningún
--   otro claim.
--
--   `user_id` es NOT NULL y sin FK. Un trigger AFTER que abortara rompería
--   la escritura de la cita (es el bug vivo de audit_profiles_identity_fn,
--   s7_32:116, que usa auth.uid() pelado). Por eso COALESCE al centinela
--   de s4_02. El actor REAL queda en new_data.actor_kind.
--
-- PRIVACIDAD:
--   Whitelist explícita de 9 columnas. NUNCA to_jsonb(NEW) completo.
--   `notes`, `internal_notes` y `updated_at` quedan FUERA por diseño:
--   son texto libre que puede contener detalle clínico, ya viven en
--   `appointments`, y su valor probatorio no compensa duplicarlos.
--   Misma regla que s7_70:444 aplicó a la nota de cancelación.
--
-- RUIDO:
--   Si ninguna columna de la whitelist cambió, NO se escribe fila.
CREATE OR REPLACE FUNCTION public.audit_appointments_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_uid        uuid    := auth.uid();
  v_jwt_role   text    := auth.jwt() ->> 'role';
  v_actor_kind text;

  v_old        jsonb   := '{}'::jsonb;
  v_new        jsonb   := '{}'::jsonb;

  -- Grupos de cambio (para la clasificación total).
  v_g_status   boolean := false;   -- status_id, cancel_reason_id
  v_g_time     boolean := false;   -- start_time, end_time
  v_g_assign   boolean := false;   -- patient_id, doctor_id
  v_g_detail   boolean := false;   -- service_id, source, price
  v_c_patient  boolean := false;
  v_c_doctor   boolean := false;
  v_n_groups   int     := 0;
  v_change     text;

  -- Contexto transaccional (solo cancel_my_appointment lo fija en s7_71a).
  v_ctx_raw    text;
  v_ctx        jsonb;
  v_ctx_via    text;
  v_ctx_reason text;
  v_ctx_ok     boolean := false;
  v_ctx_seen   boolean := false;

  v_old_status text;
  v_new_status text;
BEGIN
  -- ── 1.1 Clasificación del actor ──────────────────────────────────────
  IF v_uid IS NOT NULL AND v_jwt_role = 'service_role' THEN
    v_actor_kind := 'service_role_impersonating';
  ELSIF v_uid IS NOT NULL THEN
    v_actor_kind := 'user';
  ELSIF v_jwt_role = 'service_role' THEN
    v_actor_kind := 'service_role';
  ELSIF v_jwt_role = 'anon' THEN
    v_actor_kind := 'anon';
  ELSIF v_jwt_role IS NULL THEN
    v_actor_kind := 'db_direct';
  ELSE
    v_actor_kind := 'other:' || v_jwt_role;
  END IF;

  -- ── 1.2 INSERT ───────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    -- `source` se registra con su VALOR LITERAL. El trigger NO interpreta
    -- que 'manual' equivalga siempre a walk-in: eso es una lectura de
    -- producto, no un hecho de la fila.
    v_new := jsonb_build_object(
      'change_kind',  'appointment_created',
      'actor_kind',   v_actor_kind,
      'db_executor',  current_user,
      'source',       NEW.source::text,
      'status_id',    NEW.status_id,
      'doctor_id',    NEW.doctor_id,
      'patient_id',   NEW.patient_id,
      'service_id',   NEW.service_id,
      'start_time',   NEW.start_time,
      'end_time',     NEW.end_time,
      'price',        NEW.price
    );

    -- Un contexto presente en un INSERT no corresponde a ninguna ruta
    -- autorizada en s7_71a: se marca y se descarta.
    IF nullif(current_setting('app.audit_appointments_context', true), '') IS NOT NULL THEN
      v_new := v_new || jsonb_build_object('context_rejected', true);
    END IF;

    INSERT INTO public.audit_log
      (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      COALESCE(v_uid, '00000000-0000-0000-0000-000000000000'::uuid),
      'insert'::public.audit_action,
      'appointments',
      NEW.id,
      NULL,
      v_new
    );

    RETURN NEW;
  END IF;

  -- ── 1.3 UPDATE — diff de la whitelist ────────────────────────────────
  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    v_old := v_old || jsonb_build_object('status_id', OLD.status_id);
    v_new := v_new || jsonb_build_object('status_id', NEW.status_id);
    v_g_status := true;
  END IF;

  IF NEW.cancel_reason_id IS DISTINCT FROM OLD.cancel_reason_id THEN
    v_old := v_old || jsonb_build_object('cancel_reason_id', OLD.cancel_reason_id);
    v_new := v_new || jsonb_build_object('cancel_reason_id', NEW.cancel_reason_id);
    v_g_status := true;
  END IF;

  IF NEW.start_time IS DISTINCT FROM OLD.start_time THEN
    v_old := v_old || jsonb_build_object('start_time', OLD.start_time);
    v_new := v_new || jsonb_build_object('start_time', NEW.start_time);
    v_g_time := true;
  END IF;

  IF NEW.end_time IS DISTINCT FROM OLD.end_time THEN
    v_old := v_old || jsonb_build_object('end_time', OLD.end_time);
    v_new := v_new || jsonb_build_object('end_time', NEW.end_time);
    v_g_time := true;
  END IF;

  IF NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
    v_old := v_old || jsonb_build_object('patient_id', OLD.patient_id);
    v_new := v_new || jsonb_build_object('patient_id', NEW.patient_id);
    v_g_assign := true;  v_c_patient := true;
  END IF;

  IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id THEN
    v_old := v_old || jsonb_build_object('doctor_id', OLD.doctor_id);
    v_new := v_new || jsonb_build_object('doctor_id', NEW.doctor_id);
    v_g_assign := true;  v_c_doctor := true;
  END IF;

  IF NEW.service_id IS DISTINCT FROM OLD.service_id THEN
    v_old := v_old || jsonb_build_object('service_id', OLD.service_id);
    v_new := v_new || jsonb_build_object('service_id', NEW.service_id);
    v_g_detail := true;
  END IF;

  IF NEW.source IS DISTINCT FROM OLD.source THEN
    v_old := v_old || jsonb_build_object('source', OLD.source::text);
    v_new := v_new || jsonb_build_object('source', NEW.source::text);
    v_g_detail := true;
  END IF;

  IF NEW.price IS DISTINCT FROM OLD.price THEN
    v_old := v_old || jsonb_build_object('price', OLD.price);
    v_new := v_new || jsonb_build_object('price', NEW.price);
    v_g_detail := true;
  END IF;

  -- ── 1.4 Nada de la whitelist cambió → NO se escribe fila ─────────────
  --     (evita ruido por updated_at, notes, internal_notes, etc.)
  IF v_new = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  -- ── 1.5 Clasificación TOTAL: ninguna combinación queda sin etiqueta ──
  v_n_groups := (CASE WHEN v_g_status THEN 1 ELSE 0 END)
              + (CASE WHEN v_g_time   THEN 1 ELSE 0 END)
              + (CASE WHEN v_g_assign THEN 1 ELSE 0 END)
              + (CASE WHEN v_g_detail THEN 1 ELSE 0 END);

  IF v_n_groups > 1 THEN
    v_change := 'mixed';
  ELSIF v_g_status THEN
    v_change := 'status_change';
  ELSIF v_g_time THEN
    v_change := 'reschedule';
  ELSIF v_g_assign THEN
    v_change := CASE
                  WHEN v_c_patient AND v_c_doctor THEN 'reassign'
                  WHEN v_c_patient               THEN 'patient_reassign'
                  ELSE                                'doctor_reassign'
                END;
  ELSE
    v_change := 'appointment_update';   -- solo service_id / source / price
  END IF;

  -- ── 1.6 Contexto transaccional — VALIDADO contra OLD/NEW ─────────────
  --
  -- El GUC `app.audit_appointments_context` NO se acepta por confianza. En
  -- s7_71a la ÚNICA función que lo fija es cancel_my_appointment, y la
  -- etiqueta solo se conserva si la transición observada coincide con la
  -- que esa RPC garantiza (s7_70:415-437):
  --     · estado anterior ∈ {programada, confirmada}
  --     · estado nuevo    = cancelada
  --     · NINGUNA otra columna de la whitelist cambió
  --
  -- El GUC es transaction-local (set_config con is_local = true), así que
  -- no cruza sesiones. Si dentro de la MISMA transacción se tocara otra
  -- cita, la etiqueta filtrada NO pasaría esta validación y quedaría
  -- registrada como context_rejected. Esa es la defensa, no un flag.
  --
  -- NO existe ningún mecanismo que desactive el trigger.
  v_ctx_raw := nullif(current_setting('app.audit_appointments_context', true), '');

  IF v_ctx_raw IS NOT NULL THEN
    v_ctx_seen := true;
    BEGIN
      v_ctx := v_ctx_raw::jsonb;
    EXCEPTION WHEN others THEN
      v_ctx := NULL;
    END;

    v_ctx_via    := v_ctx ->> 'edited_via';
    v_ctx_reason := v_ctx ->> 'reason';

    IF v_ctx_via = 'patient_self_cancel' THEN
      SELECT s.name INTO v_old_status
      FROM public.appointment_statuses s WHERE s.id = OLD.status_id;
      SELECT s.name INTO v_new_status
      FROM public.appointment_statuses s WHERE s.id = NEW.status_id;

      IF v_old_status IN ('programada', 'confirmada')
         AND v_new_status = 'cancelada'
         AND v_change = 'status_change'
         AND NOT (v_new ? 'cancel_reason_id')   -- solo status_id cambió
      THEN
        v_ctx_ok := true;
      END IF;
    END IF;
  END IF;

  v_new := v_new || jsonb_build_object(
    'change_kind', v_change,
    'actor_kind',  v_actor_kind,
    'db_executor', current_user
  );

  IF v_ctx_ok THEN
    v_new := v_new || jsonb_build_object('edited_via', v_ctx_via);
    -- `reason` solo si es uno de los motivos válidos de s7_70:358.
    -- Se VALIDA contra la lista cerrada en vez de truncar.
    IF v_ctx_reason IN ('no_puedo_asistir', 'otro_horario', 'ya_no_necesito', 'otro') THEN
      v_new := v_new || jsonb_build_object('reason', v_ctx_reason);
    END IF;
  ELSIF v_ctx_seen THEN
    -- Hubo contexto y NO validó: se descartan edited_via y reason.
    v_new := v_new || jsonb_build_object('context_rejected', true);
  END IF;

  INSERT INTO public.audit_log
    (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    COALESCE(v_uid, '00000000-0000-0000-0000-000000000000'::uuid),
    'update'::public.audit_action,
    'appointments',
    NEW.id,
    v_old,
    v_new
  );

  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.audit_appointments_fn() IS
  's7_71a — auditoría server-side de appointments. Whitelist de 9 columnas; '
  'notes/internal_notes/updated_at EXCLUIDOS por diseño. Actor derivado de '
  'auth.uid() + auth.jwt()->>''role'' (current_user solo como db_executor). '
  'El contexto app.audit_appointments_context se valida contra OLD/NEW.';

-- ─── 2. REVOKE EXECUTE ─────────────────────────────────────────────────
-- El trigger NO necesita este privilegio: PostgreSQL verifica EXECUTE al
-- CREAR el trigger, no al dispararlo, y la función corre por ownership
-- (owner = postgres, dueño de audit_log). El REVOKE es defensa en
-- profundidad contra invocación directa vía PostgREST.
REVOKE EXECUTE ON FUNCTION public.audit_appointments_fn()
  FROM PUBLIC, anon, authenticated, service_role;

-- ─── 3. Trigger ────────────────────────────────────────────────────────
-- AFTER: las guardas BEFORE de s6_02/s6_03/s6_04/s6_10/s7_09/s7_55 ya
-- validaron la fila. SIN DELETE: ninguna ruta de producto borra citas —
-- solo lo hacen los fixtures de smokes, y auditarlos generaría filas que a
-- su vez habría que limpiar. Es una brecha de cobertura DECLARADA: si
-- alguna vez se borra una cita en producción, no quedará rastro.
DROP TRIGGER IF EXISTS audit_appointments ON public.appointments;
CREATE TRIGGER audit_appointments
  AFTER INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.audit_appointments_fn();

-- ─── 4. cancel_my_appointment — una sola auditoría ─────────────────────
--
-- CAMBIOS RESPECTO DE s7_70 (exhaustivos, dos y solo dos):
--   (a) se fija `app.audit_appointments_context` ANTES del UPDATE (7.7);
--   (b) se ELIMINA el INSERT manual en audit_log (7.9 de s7_70).
--
-- TODO lo demás se conserva ÍNTEGRO: normalización de reason/note, lista
-- cerrada de motivos (P0114), límite de 300 caracteres de la nota (P0115),
-- bloqueo + pertenencia en la misma sentencia, mensaje genérico (P0111),
-- idempotencia estricta por fila de evento, elegibilidad (P0112/P0113),
-- el UPDATE acotado a status_id, el evento append-only y los mismos
-- valores de retorno.
--
-- El motivo NO puede derivarse de OLD/NEW: s7_70:431-436 es explícito en
-- que el UPDATE toca ÚNICAMENTE `status_id` y no `cancel_reason_id`, y la
-- fila de appointment_patient_cancellations se inserta DESPUÉS (7.8), de
-- modo que el trigger AFTER no puede verla. Por eso el contexto lo
-- transporta.
--
-- `v_note` (texto libre del paciente), `notes` e `internal_notes` NO entran
-- al contexto ni a la auditoría.
--
-- CREATE OR REPLACE preserva la ACL de la función (s7_70 la dejó en
-- {postgres=X, service_role=X, authenticated=X}). No se re-otorga nada.
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

  -- Mensaje GENÉRICO e idéntico para "no existe", "es de otro" y "vínculo
  -- sin confirmar": no se revela la existencia de citas ajenas.
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

  -- 7.6-bis (s7_71a) Contexto transaccional para el trigger de auditoría.
  --   is_local = true → muere con la transacción.
  --   Solo viaja `edited_via` y `reason` (lista cerrada ya validada arriba).
  --   La nota libre `v_note` NO viaja: es texto del paciente y vive en su
  --   tabla. El trigger REVALIDA la etiqueta contra OLD/NEW.
  PERFORM set_config(
    'app.audit_appointments_context',
    jsonb_build_object(
      'edited_via', 'patient_self_cancel',
      'reason',     v_reason
    )::text,
    true
  );

  -- 7.7 UPDATE acotado ÚNICAMENTE a status_id. `updated_at` lo pone el
  --     trigger trg_appointments_updated_at. No se toca ninguna otra
  --     columna (ni cancel_reason_id, que es del médico).
  --     El trigger audit_appointments (s7_71a) produce ACÁ la única fila
  --     de auditoría de esta operación.
  UPDATE public.appointments
  SET status_id = v_cancel_id
  WHERE id = v_appt.id;

  -- 7.8 Evento append-only, misma transacción.
  INSERT INTO public.appointment_patient_cancellations
    (appointment_id, cancelled_at, cancelled_by_profile_id, reason, note)
  VALUES
    (v_appt.id, now(), v_uid, v_reason, v_note);

  -- 7.9 (s7_71a) El INSERT manual en audit_log se ELIMINÓ: lo produce el
  --     trigger en 7.7, una sola vez, con el mismo edited_via y el mismo
  --     reason. Duplicarlo generaría dos filas por cancelación.

  RETURN jsonb_build_object(
    'success', true,
    'outcome', 'cancelled',
    'appointment_id', v_appt.id,
    'cancelled_at', now()
  );
END
$fn$;

COMMENT ON FUNCTION public.cancel_my_appointment(uuid, text, text) IS
  's7_70 + s7_71a — cancelación por el paciente. s7_71a: fija '
  'app.audit_appointments_context antes del UPDATE y delega la auditoría al '
  'trigger audit_appointments (una sola fila). Validaciones de s7_70 intactas.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════
-- POST-APPLY (dev, sin service_role):
--   node scripts/check-s7_71a.mjs
--   node scripts/_smoke-s7_71a.mjs     ← requiere autorización aparte
--
-- GATE: si algo falla, NO se abre s7_71b.
-- ═══════════════════════════════════════════════════════════════════════
