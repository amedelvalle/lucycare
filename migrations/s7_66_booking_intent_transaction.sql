-- ═══════════════════════════════════════════════════════════
-- Migración S7-66: AUTH-P1B1B (A) — intención de reserva +
--                  creación transaccional de la cita (ADDITIVE-ONLY)
-- ═══════════════════════════════════════════════════════════
-- Frente AUTH-P1B (protección server-side previa a las pantallas de P1C).
-- Entrega A de B1B: las 3 RPCs del flujo de reserva por INTENT, sobre las
-- tablas inertes de s7_65 (booking_intents, auth_creation_grants).
--
-- ADDITIVE-ONLY: NO toca appointments_insert, NO revoca grants de
-- appointments, NO toca el frontend. El cierre del INSERT directo del
-- paciente es s7_67 (paso C), posterior al despliegue del frontend (B).
-- Los triggers s6_03 / s6_04 / s7_55 se CONSERVAN como defensa final: estas
-- RPCs son SECURITY DEFINER (bypassan RLS por owner), así que la creación de
-- la cita sigue disparándolos.
--
-- ── DECISIONES CERRADAS (owner) ──
--   • Duración: end_at = start_at + availability_rules.slot_duration_min
--     (NO la duración del servicio).
--   • Zona horaria: la firma recibe `timestamp without time zone` (naive
--     local) y la RPC convierte con `AT TIME ZONE 'America/El_Salvador'`
--     (mismo literal que s6_04). No se depende del TimeZone de PostgREST.
--   • Teléfono: SOLO auth.jwt() ->> 'phone', canónico, fail-closed. Nunca
--     auth.users ni profiles.phone.
--   • Idempotencia: reusar intent vigente solo si coinciden la 5-tupla Y su
--     grant booking está vigente/no-revocado; si no, nueva pareja.
--   • patients get-or-create: advisory lock por (auth.uid, clinic_id) — NO
--     existe UNIQUE(profile_id, clinic_id) que respalde ON CONFLICT.
--
-- ── SEGURIDAD ── SECURITY DEFINER · referencias 100% calificadas · sin SQL
-- dinámico. REVOKE EXPLÍCITO (no depender de defaults) de PUBLIC, anon,
-- authenticated, service_role, supabase_auth_admin y —guardado por existencia—
-- directory_editor / operations_admin (que NO son roles de Postgres, sino
-- access_level en lucyadmin_access; el guard evita que el REVOKE rompa el
-- apply). validate_booking_slot es helper INTERNO (sin EXECUTE para NINGÚN
-- rol). register_booking_intent: EXECUTE solo anon + authenticated.
-- create_booking_with_intent: EXECUTE solo authenticated.
--
-- ── search_path (NO uniforme, a propósito) ──
--   • validate_booking_slot  → SET search_path = ''  (read-only; no triggers)
--   • register_booking_intent → SET search_path = '' (escribe solo en tablas
--     NO auditadas: booking_intents / auth_creation_grants)
--   • create_booking_with_intent → SET search_path = pg_catalog, public, pg_temp
--     EXCEPCIÓN NECESARIA: inserta en `patients`, cuyo trigger de auditoría
--     legacy `audit_patients` (s4_02) hace `INSERT INTO audit_log …` SIN
--     calificar el esquema y SIN fijar su propio search_path → hereda el del
--     caller. Con '' el trigger no resuelve `audit_log` y aborta con 42P01.
--     Pinnear a pg_catalog, public, pg_temp es el patrón de TODA función
--     escritora del repo (s7_13/s7_20/s7_46/…) y es inmune a inyección (el
--     search_path lo fija la función; pg_catalog va primero). REQUISITO DE
--     SEGURIDAD antes del reapply: anon/authenticated (y PUBLIC) NO deben tener
--     CREATE sobre el schema public (query de preflight en
--     docs/OWNER_S7_66_APPLY.md). DEUDA TÉCNICA: la causa de fondo es que los
--     triggers de auditoría legacy (s4_02) dependen del search_path del caller;
--     calificarlos (public.audit_log + SET search_path propio) es un frente
--     aparte (NO se toca aquí).
--
-- ── P-CODES ──
--   INTERNOS (validate; y create para su caller autenticado):
--     P0092 intent inexistente        P0097 no alineado a la grilla de slots
--     P0093 intent ya consumido       P0098 bloqueado por override
--     P0094 intent vencido            P0099 grilla de disponibilidad ambigua
--     P0095 teléfono JWT ausente/inv  P009A clinic/end_at recalculado ≠ intent
--     P0096 teléfono ≠ intent         P009B slot ocupado (pre-check; s7_55 = P0090)
--     P009C médico no reservable      P009D servicio inválido
--     P009E fecha en el pasado        P009H nombre de paciente requerido
--     P009I nombre demasiado largo (>150)   P009J notas demasiado largas (>2000)
--   PÚBLICOS de register_booking_intent (anon; NO enumeran al médico):
--     P0095 teléfono inválido
--     P009F horario no disponible  (genérico: agrupa P009B/C/D/E/P0097/P0098/P0099)
--     P009G demasiadas solicitudes vigentes  (tope de intents con grant vivo)
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Helper interno: validate_booking_slot ─────────────────────────
-- Valida médico/servicio/fecha/contención/alineación/overrides/ambigüedad
-- y DEVUELVE la clínica derivada y el end_at recalculado. NO decide sobre
-- el solape final (eso lo hace s7_55 atómicamente al insertar), pero SÍ hace
-- un pre-check de ocupación para no emitir un intent sobre un slot tomado.
-- Lanza P-codes en cada rechazo (no devuelve NULL silencioso).
CREATE OR REPLACE FUNCTION public.validate_booking_slot(
  p_doctor_id   uuid,
  p_service_id  uuid,
  p_start_local timestamp without time zone,
  OUT o_clinic_id uuid,
  OUT o_start_at  timestamptz,
  OUT o_end_at    timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking_ok  boolean;
  v_start_local timestamp without time zone := p_start_local;
  v_dow         int;
  v_time        time;
  v_date        date;
  v_slot_min    int;
  v_end_time    time;
  v_distinct_grids int;
BEGIN
  -- ── Médico reservable ──
  SELECT (d.is_published AND d.booking_enabled AND d.is_operational), d.clinic_id
    INTO v_booking_ok, o_clinic_id
  FROM public.doctors d
  WHERE d.id = p_doctor_id;

  IF NOT FOUND OR v_booking_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'El médico no está disponible para reservas en línea.'
      USING ERRCODE = 'P009C';
  END IF;

  -- ── Servicio activo y del mismo médico (la clínica se deriva del médico) ──
  PERFORM 1 FROM public.services s
   WHERE s.id = p_service_id AND s.doctor_id = p_doctor_id AND s.is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El servicio seleccionado no es válido.' USING ERRCODE = 'P009D';
  END IF;

  -- ── Instante canónico (naive local → timestamptz), mismo literal que s6_04 ──
  o_start_at := v_start_local AT TIME ZONE 'America/El_Salvador';

  -- ── Fecha en el pasado (defensa; s6_03 la repite al insertar) ──
  IF o_start_at < now() - interval '2 minutes' THEN
    RAISE EXCEPTION 'No se puede reservar en una fecha u hora pasada.'
      USING ERRCODE = 'P009E';
  END IF;

  -- Partes locales para comparar con las reglas (que guardan hora/día local).
  v_dow  := EXTRACT(DOW FROM v_start_local)::int;   -- 0=domingo
  v_time := v_start_local::time;
  v_date := v_start_local::date;

  -- ── Anti-ambigüedad de grilla ──
  -- Entre las reglas ACTIVAS aplicables al instante (que lo contienen), dos
  -- reglas pertenecen a la MISMA grilla solo si tienen igual slot_duration_min
  -- Y la diferencia entre sus start_time es múltiplo exacto de ese slot (misma
  -- fase). Cada grilla se canoniza como (slot_duration_min, phase), con
  --   phase = (start_time en minutos desde medianoche) mod slot_duration_min.
  -- Ej. slot 30': 08:00 y 09:00 → phase 0 y 0 (misma grilla); 08:00 y 08:15 →
  -- phase 0 y 15 (grillas distintas → ambiguo). Cubre a la vez slot distinto y
  -- fase/origen distinto. (Hoy 0 casos en prod; guarda defensiva.)
  SELECT count(*)
    INTO v_distinct_grids
  FROM (
    SELECT DISTINCT
      r.slot_duration_min,
      mod((EXTRACT(EPOCH FROM r.start_time) / 60)::int, r.slot_duration_min) AS phase
    FROM public.availability_rules r
    WHERE r.doctor_id = p_doctor_id
      AND r.is_active = true
      AND r.day_of_week = v_dow
      AND r.start_time <= v_time
      AND r.end_time   >  v_time
  ) grids;
  IF v_distinct_grids > 1 THEN
    RAISE EXCEPTION 'La disponibilidad del médico es ambigua en ese horario.'
      USING ERRCODE = 'P0099';
  END IF;

  -- ── Regla que CONTIENE el inicio, y de ahí el slot_duration_min + end_at ──
  -- (una sola por el chequeo de ambigüedad anterior; LIMIT 1 por robustez.)
  SELECT r.slot_duration_min
    INTO v_slot_min
  FROM public.availability_rules r
  WHERE r.doctor_id = p_doctor_id
    AND r.is_active = true
    AND r.day_of_week = v_dow
    AND r.start_time <= v_time
  ORDER BY r.start_time DESC
  LIMIT 1;

  IF v_slot_min IS NULL THEN
    RAISE EXCEPTION 'El médico no tiene disponibilidad en ese horario.'
      USING ERRCODE = 'P0097';
  END IF;

  o_end_at  := o_start_at + make_interval(mins => v_slot_min);
  v_end_time := (v_start_local + make_interval(mins => v_slot_min))::time;

  -- ── Contención COMPLETA [start,end] dentro de una regla activa ──
  PERFORM 1 FROM public.availability_rules r
   WHERE r.doctor_id = p_doctor_id
     AND r.is_active = true
     AND r.day_of_week = v_dow
     AND r.start_time <= v_time
     AND r.end_time   >= v_end_time;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El médico no tiene disponibilidad en ese horario.'
      USING ERRCODE = 'P0097';
  END IF;

  -- ── Alineación a la cuadrícula: (v_time - rule.start_time) múltiplo de
  --    slot_duration_min. Se recorre la(s) regla(s) que contienen el inicio
  --    y basta con que UNA alinee. ──
  IF NOT EXISTS (
    SELECT 1 FROM public.availability_rules r
    WHERE r.doctor_id = p_doctor_id
      AND r.is_active = true
      AND r.day_of_week = v_dow
      AND r.start_time <= v_time
      AND r.end_time   >= v_end_time
      AND r.slot_duration_min = v_slot_min
      AND mod(
        (EXTRACT(EPOCH FROM (v_time - r.start_time)) / 60)::int,
        r.slot_duration_min
      ) = 0
  ) THEN
    RAISE EXCEPTION 'El horario no coincide con un turno disponible.'
      USING ERRCODE = 'P0097';
  END IF;

  -- ── Overrides: bloqueo total (time_start/end NULL) o parcial que solape ──
  IF EXISTS (
    SELECT 1 FROM public.availability_overrides o
    WHERE o.doctor_id = p_doctor_id
      AND o.is_blocked = true
      AND o.date_start <= v_date
      AND o.date_end   >= v_date
      AND (
        (o.time_start IS NULL OR o.time_end IS NULL)      -- día completo
        OR (o.time_start < v_end_time AND o.time_end > v_time)  -- parcial solapa
      )
  ) THEN
    RAISE EXCEPTION 'El horario está bloqueado por el médico.'
      USING ERRCODE = 'P0098';
  END IF;

  -- ── Pre-check de ocupación (misma semántica que s7_55; el guard ATÓMICO
  --    definitivo lo aplica s7_55 con advisory lock al INSERT) ──
  IF EXISTS (
    SELECT 1
    FROM public.appointments a
    JOIN public.appointment_statuses st ON st.id = a.status_id
    WHERE a.doctor_id = p_doctor_id
      AND st.is_final = false
      AND tstzrange(a.start_time, a.end_time, '[)')
          && tstzrange(o_start_at, o_end_at, '[)')
  ) THEN
    RAISE EXCEPTION 'Ese horario ya está ocupado.' USING ERRCODE = 'P009B';
  END IF;
END;
$$;

-- ── Permisos: helper INTERNO. REVOKE EXPLÍCITO de TODO rol (no depender de
--    defaults); NINGÚN GRANT (solo lo invocan las otras dos RPC, definer).
--    directory_editor / operations_admin NO son roles de Postgres (son
--    access_level en lucyadmin_access) → el REVOKE se guarda por existencia
--    para no abortar el apply si el rol no existe. ──
REVOKE ALL ON FUNCTION public.validate_booking_slot(uuid, uuid, timestamp without time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_booking_slot(uuid, uuid, timestamp without time zone) FROM anon;
REVOKE ALL ON FUNCTION public.validate_booking_slot(uuid, uuid, timestamp without time zone) FROM authenticated;
REVOKE ALL ON FUNCTION public.validate_booking_slot(uuid, uuid, timestamp without time zone) FROM service_role;
REVOKE ALL ON FUNCTION public.validate_booking_slot(uuid, uuid, timestamp without time zone) FROM supabase_auth_admin;
DO $perm$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'directory_editor') THEN
    REVOKE ALL ON FUNCTION public.validate_booking_slot(uuid, uuid, timestamp without time zone) FROM directory_editor;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operations_admin') THEN
    REVOKE ALL ON FUNCTION public.validate_booking_slot(uuid, uuid, timestamp without time zone) FROM operations_admin;
  END IF;
END
$perm$;

-- ─── 2. register_booking_intent (pre-OTP; anon + authenticated) ───────
CREATE OR REPLACE FUNCTION public.register_booking_intent(
  p_doctor_id   uuid,
  p_service_id  uuid,
  p_start_local timestamp without time zone,
  p_phone       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone     text := public.auth_phone_e164(p_phone);
  v_clinic    uuid;
  v_start_at  timestamptz;
  v_end_at    timestamptz;
  v_existing  uuid;
  v_intent_id uuid;
  v_open_cnt  int;
BEGIN
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Número de teléfono inválido.' USING ERRCODE = 'P0095';
  END IF;

  -- Serializa las emisiones concurrentes del MISMO teléfono → evita crear
  -- dos intents por dos reenvíos de OTP simultáneos.
  PERFORM pg_advisory_xact_lock(hashtextextended('bkint:' || v_phone, 0));

  -- Validación completa (deriva clínica y end_at). Los rechazos específicos de
  -- validate_booking_slot revelan existencia/estado del médico a un caller
  -- ANÓNIMO → se colapsan en UN error público genérico (P009F, "horario no
  -- disponible"), sin enumeración. El detalle específico NO se pierde: queda en
  -- el log del servidor (validate ya distingue el motivo). P0095 (teléfono) se
  -- maneja arriba y sigue siendo su propio código.
  BEGIN
    SELECT o_clinic_id, o_start_at, o_end_at
      INTO v_clinic, v_start_at, v_end_at
    FROM public.validate_booking_slot(p_doctor_id, p_service_id, p_start_local);
  EXCEPTION
    WHEN SQLSTATE 'P009C' OR SQLSTATE 'P009D' OR SQLSTATE 'P009E'
      OR SQLSTATE 'P0097' OR SQLSTATE 'P0098' OR SQLSTATE 'P0099'
      OR SQLSTATE 'P009B' THEN
      RAISE EXCEPTION 'Ese horario no está disponible. Elegí otro.'
        USING ERRCODE = 'P009F';
  END;

  -- ── Idempotencia: reusar un intent vigente de la 5-tupla SOLO si su grant
  --    booking sigue vigente y no revocado. ──
  SELECT bi.id INTO v_existing
  FROM public.booking_intents bi
  WHERE bi.phone_e164  = v_phone
    AND bi.doctor_id   = p_doctor_id
    AND bi.service_id  = p_service_id
    AND bi.start_at    = v_start_at
    AND bi.consumed_at IS NULL
    AND bi.expires_at  > now()
    AND EXISTS (
      SELECT 1 FROM public.auth_creation_grants g
      WHERE g.booking_intent_id = bi.id
        AND g.flow = 'booking'
        AND g.revoked_at IS NULL
        AND g.expires_at > now()
    )
  ORDER BY bi.expires_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('intent_id', v_existing, 'reused', true);
  END IF;

  -- Anti-spam: contar SOLO intents cuyo grant booking sigue VIVO (intent no
  -- consumido y vigente, Y grant flow='booking' no-revocado y vigente). Los
  -- huérfanos, vencidos o con grant revocado NO cuentan (coherente con la
  -- idempotencia de arriba). Código propio P009G — NO se reutiliza P009B.
  SELECT count(*) INTO v_open_cnt
  FROM public.booking_intents bi
  WHERE bi.phone_e164 = v_phone
    AND bi.consumed_at IS NULL
    AND bi.expires_at > now()
    AND EXISTS (
      SELECT 1 FROM public.auth_creation_grants g
      WHERE g.booking_intent_id = bi.id
        AND g.flow = 'booking'
        AND g.revoked_at IS NULL
        AND g.expires_at > now()
    );
  IF v_open_cnt >= 3 THEN
    RAISE EXCEPTION 'Demasiadas reservas en curso. Esperá unos minutos.' USING ERRCODE = 'P009G';
  END IF;

  -- Nueva pareja intent + grant (misma transacción, TTL 15 min).
  INSERT INTO public.booking_intents
    (doctor_id, clinic_id, service_id, start_at, end_at, phone_e164, expires_at)
  VALUES
    (p_doctor_id, v_clinic, p_service_id, v_start_at, v_end_at, v_phone, now() + interval '15 minutes')
  RETURNING id INTO v_intent_id;

  INSERT INTO public.auth_creation_grants
    (subject_type, subject_normalized, flow, booking_intent_id, context, expires_at, issued_by)
  VALUES
    ('phone', v_phone, 'booking', v_intent_id,
     jsonb_build_object('doctor_id', p_doctor_id, 'service_id', p_service_id),
     now() + interval '15 minutes', 'register_booking_intent');

  RETURN jsonb_build_object('intent_id', v_intent_id, 'reused', false);
END;
$$;

-- ── Permisos: REVOKE EXPLÍCITO de todo rol, luego GRANT solo a anon +
--    authenticated (pre-OTP). directory_editor/operations_admin guardados. ──
REVOKE ALL ON FUNCTION public.register_booking_intent(uuid, uuid, timestamp without time zone, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_booking_intent(uuid, uuid, timestamp without time zone, text) FROM anon;
REVOKE ALL ON FUNCTION public.register_booking_intent(uuid, uuid, timestamp without time zone, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.register_booking_intent(uuid, uuid, timestamp without time zone, text) FROM service_role;
REVOKE ALL ON FUNCTION public.register_booking_intent(uuid, uuid, timestamp without time zone, text) FROM supabase_auth_admin;
DO $perm$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'directory_editor') THEN
    REVOKE ALL ON FUNCTION public.register_booking_intent(uuid, uuid, timestamp without time zone, text) FROM directory_editor;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operations_admin') THEN
    REVOKE ALL ON FUNCTION public.register_booking_intent(uuid, uuid, timestamp without time zone, text) FROM operations_admin;
  END IF;
END
$perm$;
GRANT EXECUTE ON FUNCTION public.register_booking_intent(uuid, uuid, timestamp without time zone, text) TO anon;
GRANT EXECUTE ON FUNCTION public.register_booking_intent(uuid, uuid, timestamp without time zone, text) TO authenticated;

-- ─── 3. create_booking_with_intent (post-OTP; authenticated) ──────────
-- search_path = pg_catalog, public, pg_temp (NO ''): esta función INSERTA en
-- `patients`, que dispara el trigger de auditoría legacy `audit_patients`
-- (s4_02). Ese trigger hace `INSERT INTO audit_log …` SIN calificar el esquema
-- y NO fija su propio search_path → hereda el del caller; con '' no resuelve
-- `audit_log` y aborta con 42P01. Ver la nota de SEGURIDAD del encabezado.
CREATE OR REPLACE FUNCTION public.create_booking_with_intent(
  p_intent_id    uuid,
  p_patient_name text,
  p_notes        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_jwt_phone  text := public.auth_phone_e164(auth.jwt() ->> 'phone');
  v_name       text := btrim(coalesce(p_patient_name, ''));
  v_notes      text := nullif(btrim(coalesce(p_notes, '')), '');
  v_intent     public.booking_intents%ROWTYPE;
  v_clinic     uuid;
  v_start_at   timestamptz;
  v_end_at     timestamptz;
  v_patient_id uuid;
  v_status_id  uuid;
  v_appt_id    uuid;
BEGIN
  -- 1. Sesión.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para reservar.' USING ERRCODE = '28000';
  END IF;

  -- 4. Teléfono del JWT (fail-closed).
  IF v_jwt_phone IS NULL THEN
    RAISE EXCEPTION 'Tu sesión no tiene un teléfono válido.' USING ERRCODE = 'P0095';
  END IF;

  -- 4c. Nombre y notas: límites server-side. No hay límite explícito en
  --     frontend/tipos/DB (el nombre deriva del perfil; las notas no se
  --     capturan en el flujo público) → se aplican los defaults del owner
  --     (nombre 150, notas 2000). btrim; nombre obligatorio no vacío; notas
  --     vacías → NULL. Se RECHAZA el exceso con códigos diferenciados; NUNCA
  --     se trunca en silencio.
  IF v_name = '' THEN
    RAISE EXCEPTION 'El nombre del paciente es obligatorio.' USING ERRCODE = 'P009H';
  END IF;
  IF char_length(v_name) > 150 THEN
    RAISE EXCEPTION 'El nombre del paciente es demasiado largo (máximo 150).' USING ERRCODE = 'P009I';
  END IF;
  IF v_notes IS NOT NULL AND char_length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'Las notas son demasiado largas (máximo 2000).' USING ERRCODE = 'P009J';
  END IF;

  -- 2. Bloquear el intent.
  SELECT * INTO v_intent
  FROM public.booking_intents
  WHERE id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva no encontrada.' USING ERRCODE = 'P0092';
  END IF;

  -- 3. Vigencia y no-consumo.
  IF v_intent.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta reserva ya fue completada.' USING ERRCODE = 'P0093';
  END IF;
  IF v_intent.expires_at <= now() THEN
    RAISE EXCEPTION 'La reserva expiró. Elegí el horario de nuevo.' USING ERRCODE = 'P0094';
  END IF;

  -- 4b. El teléfono del JWT debe coincidir con el del intent.
  IF v_jwt_phone <> v_intent.phone_e164 THEN
    RAISE EXCEPTION 'El teléfono de tu sesión no coincide con la reserva.' USING ERRCODE = 'P0096';
  END IF;

  -- 5. Revalidar el slot (los 15 min pudieron cambiar reglas/overrides/citas).
  SELECT o_clinic_id, o_start_at, o_end_at
    INTO v_clinic, v_start_at, v_end_at
  FROM public.validate_booking_slot(v_intent.doctor_id, v_intent.service_id,
                                    (v_intent.start_at AT TIME ZONE 'America/El_Salvador'));

  -- 6. clinic_id y end_at recalculados == guardados.
  IF v_clinic <> v_intent.clinic_id
     OR v_start_at <> v_intent.start_at
     OR v_end_at   <> v_intent.end_at THEN
    RAISE EXCEPTION 'La reserva ya no es válida. Elegí el horario de nuevo.' USING ERRCODE = 'P009A';
  END IF;

  -- 7. get-or-create de patient ATÓMICO (advisory lock por uid+clínica; no
  --    hay UNIQUE(profile_id, clinic_id) que respalde ON CONFLICT).
  PERFORM pg_advisory_xact_lock(hashtextextended('patient:' || v_uid::text || ':' || v_intent.clinic_id::text, 0));

  SELECT p.id INTO v_patient_id
  FROM public.patients p
  WHERE p.profile_id = v_uid AND p.clinic_id = v_intent.clinic_id
  LIMIT 1;

  IF v_patient_id IS NULL THEN
    INSERT INTO public.patients
      (profile_id, clinic_id, full_name, phone, document_type, document_number,
       date_of_birth, gender, patient_type, link_confirmed_at)
    VALUES
      (v_uid, v_intent.clinic_id, v_name, v_intent.phone_e164, 'dui', NULL,
       '2000-01-01', 'otro', 'privado', now())
    RETURNING id INTO v_patient_id;
  END IF;
  -- Paciente EXISTENTE: se reutiliza tal cual; NO se sobrescribe ningún dato
  -- (nombre/teléfono/documento/etc. quedan como estaban).

  -- 8. Crear la cita (los triggers s6_03/s6_04/s7_55 disparan como red final).
  SELECT id INTO v_status_id FROM public.appointment_statuses WHERE name = 'programada';
  IF v_status_id IS NULL THEN
    RAISE EXCEPTION 'Error de configuración: estado no encontrado.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.appointments
    (clinic_id, doctor_id, patient_id, service_id, status_id,
     start_time, end_time, source, notes, payment_status)
  VALUES
    (v_intent.clinic_id, v_intent.doctor_id, v_patient_id, v_intent.service_id, v_status_id,
     v_intent.start_at, v_intent.end_at, 'lucy_directorio', v_notes, 'pending')
  RETURNING id INTO v_appt_id;

  -- 9. Consumir el intent.
  UPDATE public.booking_intents
     SET consumed_at = now(), consumed_appointment_id = v_appt_id
   WHERE id = p_intent_id;

  -- 10. Cualquier excepción anterior aborta TODA la transacción (rollback
  --     total: ni cita ni consumo parcial).
  RETURN jsonb_build_object('success', true, 'appointment_id', v_appt_id);
END;
$$;

-- ── Permisos: REVOKE EXPLÍCITO de todo rol, luego GRANT solo a authenticated
--    (post-OTP). directory_editor/operations_admin guardados por existencia. ──
REVOKE ALL ON FUNCTION public.create_booking_with_intent(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_booking_with_intent(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.create_booking_with_intent(uuid, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.create_booking_with_intent(uuid, text, text) FROM service_role;
REVOKE ALL ON FUNCTION public.create_booking_with_intent(uuid, text, text) FROM supabase_auth_admin;
DO $perm$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'directory_editor') THEN
    REVOKE ALL ON FUNCTION public.create_booking_with_intent(uuid, text, text) FROM directory_editor;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operations_admin') THEN
    REVOKE ALL ON FUNCTION public.create_booking_with_intent(uuid, text, text) FROM operations_admin;
  END IF;
END
$perm$;
GRANT EXECUTE ON FUNCTION public.create_booking_with_intent(uuid, text, text) TO authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- Verificación:
--   node scripts/check-s7_66.mjs            -- análisis estático (sin DB): matriz
--                                              GRANT/REVOKE, definer, search_path,
--                                              fase de grilla, P009F/P009G, mapeos
--   node scripts/check-s7_66.mjs --runtime  -- + denegaciones runtime (post-apply)
--   node scripts/_smoke-s7_66.mjs           -- E2E (requiere autorización de
--                                              service_role + 2 Test Phones;
--                                              fixtures AP66_FIXTURE)
--   docs/OWNER_S7_66_APPLY.md         -- aplicación + QA runtime del owner
--                                        (incluye el claim `phone` del JWT)
--
-- ORDEN DEL FRENTE: A (esta, additive) → B (frontend a la RPC) → C (s7_67:
--   REVOKE INSERT a anon + policy appointments_inster = solo is_clinic_member).
--   s7_66 NO cierra el bypass todavía (lo hace s7_67, tras validar B).
-- ═══════════════════════════════════════════════════════════
