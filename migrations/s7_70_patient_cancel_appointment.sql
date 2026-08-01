-- ═══════════════════════════════════════════════════════════
-- Migración S7-70: CANCELACIÓN-PACIENTE-P0 + hardening atómico
--                  de public.appointments
-- ═══════════════════════════════════════════════════════════
-- Dos objetivos que DEBEN aplicarse juntos:
--
--   (A) Dar al paciente un camino LEGÍTIMO y trazable para cancelar
--       su propia cita futura: cancel_my_appointment.
--   (B) Retirarle el UPDATE DIRECTO sobre appointments, que hoy le
--       permite mucho más que cancelar.
--
-- Aplicar (A) sin (B) dejaría abierto el atajo; aplicar (B) sin (A)
-- dejaría al paciente sin ninguna forma de cancelar. Por eso una sola
-- transacción.
--
-- ── HALLAZGO QUE ORIGINA (B) — preflight del owner, 2026-07-31, PG 17.6 ──
--   appointments_update vigente:
--     FOR UPDATE · TO PUBLIC · WITH CHECK NULL
--     USING (is_clinic_member(clinic_id)
--            OR patient_id IN (SELECT p.id FROM patients p
--                              WHERE p.profile_id = auth.uid()))
--   + relacl: authenticated = arw  (UPDATE de TABLA COMPLETA)
--   + CERO ACL por columna sobre appointments
--
--   ⇒ Cualquier paciente autenticado puede escribir CUALQUIER columna de
--     su cita vía PATCH /rest/v1/appointments:
--       · status_id  → marcarse 'atendida' (affects_revenue=true; además
--                      dispara trg_generate_review_token y emite un token
--                      de reseña por una consulta que nunca ocurrió)
--       · price / payment_status → corromper datos de cobro
--       · doctor_id  → reasignar la cita a otro médico (with_check NULL
--                      hereda el USING, y patient_id no cambia ⇒ pasa)
--       · notes / internal_notes → inyectar texto que el médico lee
--       · start_time → auto-reprogramarse sin que el médico se entere
--
--   Mismo patrón que cerró s7_60 en `doctors`: la RLS filtra FILAS, no
--   COLUMNAS, y el grant es de tabla completa.
--
-- ── PREMISAS VERIFICADAS EN PREFLIGHT (re-verificadas abajo) ──
--   • appointments: relrowsecurity=true · relforcerowsecurity=false
--     owner=postgres (rolbypassrls=true)
--     ⇒ las RPC SECURITY DEFINER de esta migración NO pasan por RLS ni
--       por los grants de columna. Es el mismo mecanismo por el que
--       create_booking_with_intent (s7_66) siguió funcionando tras s7_67.
--   • schema public: anon/authenticated/PUBLIC SIN privilegio CREATE
--     (solo pg_database_owner) ⇒ SECURITY DEFINER es seguro.
--   • ALTER DEFAULT PRIVILEGES ACTIVOS en public (owners postgres y
--     supabase_admin): toda TABLA nueva nace con ALL para anon y
--     authenticated, y toda FUNCIÓN nueva nace con EXECUTE para anon.
--     ⇒ los REVOKE de los pasos 4 y 9 NO son opcionales: sin ellos la
--       tabla append-only nacería con INSERT/UPDATE/DELETE/TRUNCATE
--       abiertos y las RPC ejecutables por anónimos.
--   • Helpers legacy (get_user_doctor_id, is_clinic_member, get_user_role,
--     is_clinic_member_with_role) son SECURITY DEFINER SIN
--     `SET search_path` y referencian tablas sin calificar ⇒ heredan el
--     search_path del caller. Las RPC de esta migración NO los usan:
--     resuelven la autorización con SQL propio y calificado. (En la
--     POLICY de lectura sí se usa is_clinic_member: allí se evalúa en el
--     contexto del query del usuario, con su search_path normal, igual
--     que todas las policies vigentes.)
--
-- ── search_path DE LAS RPC ──
--   SET search_path = pg_catalog, public, pg_temp
--   pg_temp va EXPLÍCITO Y ÚLTIMO: si se omite, PostgreSQL busca el
--   esquema temporal ANTES que cualquier otro para nombres de relación
--   (justo lo contrario de lo buscado). Mismo patrón que s7_66.
--   Además, todos los objetos van calificados.
--
-- ── QUÉ NO TOCA ──
--   INSERT (cerrado por s7_67) · DELETE/TRUNCATE (cerrados por s7_68) ·
--   appointments_select · appointments_self_select · triggers ·
--   cancel_reasons · la ruta del médico · service_role · datos · frontend.
--   audit_log queda como AUDIT-SEC-P0, frente separado.
--
-- ── SEGURIDAD DEL APPLY ──
--   Una sola transacción, pero el LOCK ACCESS EXCLUSIVE sobre appointments
--   se toma LO MÁS TARDE POSIBLE (paso 11), justo antes de tocar la tabla:
--   crear la tabla, el índice y las dos funciones bajo ese lock bloquearía
--   la agenda durante toda la compilación sin necesidad. Secuencia:
--     0. precondiciones generales, sin lock
--     1-10. objetos nuevos + REVOKE/GRANT propios
--     11. LOCK + REVERIFICACIÓN de lo sensible a drift (owner, RLS, FORCE,
--         definición semántica de appointments_update, grants de partida)
--     12-13. hardening
--     14. postcondiciones · COMMIT
--   Entre el LOCK y el COMMIT no hay creación de objetos ni trabajo
--   prolongado. Las comprobaciones son SEMÁNTICAS (nombre, comando, roles,
--   USING y WITH CHECK por igualdad canónica insensible a espacios).
--   Cualquier drift → RAISE EXCEPTION y revierte todo: imposible quedar a
--   medias. lock_timeout 5s: si la tabla está ocupada, aborta sin cambios.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- Protección operativa del lock: si no se obtiene rápido, aborta SIN cambios
-- en vez de bloquear la tabla de citas en producción. Ambos son SET LOCAL:
-- solo viven dentro de esta transacción.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ⚠️ El LOCK ACCESS EXCLUSIVE sobre appointments NO se toma acá: se toma
--    en el paso 11, inmediatamente antes de tocar la tabla. Crear la
--    tabla, el índice y las dos funciones bajo ese lock bloquearía la
--    agenda durante toda la compilación. Después del lock solo hay
--    reverificación, hardening, postcondiciones y COMMIT.

-- ─── 0. PRECONDICIONES GENERALES (sin lock) ───────────────────────────
DO $pre$
DECLARE
  v_rls        boolean;
  v_force      boolean;
  v_owner_nm   text;
  v_bypass     boolean;
  v_cur_bypass boolean;
  v_named      int;
  v_perm_upd   int;
  v_perm_names text;
  v_restr_upd  int;
  v_pol_cmd    "char";
  v_pol_perm   boolean;
  v_pol_roles  oid[];
  v_using      text;
  v_check      text;
  v_expected   text :=
    '(is_clinic_member(clinic_id) OR (patient_id IN ( SELECT p.id FROM patients p WHERE (p.profile_id = auth.uid()))))';
  v_canon      text;
  v_canon_exp  text;
BEGIN
  -- 0.1 RLS activa y FORCE apagado (premisa del DEFINER).
  SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner)
    INTO v_rls, v_force, v_owner_nm
  FROM pg_class c WHERE c.oid = 'public.appointments'::regclass;
  IF v_rls IS NOT TRUE THEN
    RAISE EXCEPTION 's7_70 PRE: RLS no está activa en public.appointments (relrowsecurity=%)', v_rls;
  END IF;
  IF v_force IS NOT FALSE THEN
    RAISE EXCEPTION 's7_70 PRE: relforcerowsecurity=% en appointments; el DEFINER dejaría de saltar RLS', v_force;
  END IF;
  SELECT r.rolbypassrls INTO v_bypass FROM pg_roles r WHERE r.rolname = v_owner_nm;
  IF v_bypass IS NOT TRUE THEN
    RAISE EXCEPTION 's7_70 PRE: el owner de appointments (%) no tiene BYPASSRLS; las RPC no funcionarían', v_owner_nm;
  END IF;

  -- 0.1.b La premisa REAL del SECURITY DEFINER es el propietario de las
  --       FUNCIONES, no solo el de la tabla. Las funciones nacen siendo
  --       propiedad de current_user, así que es current_user quien debe
  --       tener BYPASSRLS. Si la migración se aplicara con un rol distinto
  --       del esperado, las RPC no saltarían RLS y el diseño no se sostiene.
  SELECT r.rolbypassrls INTO v_cur_bypass
  FROM pg_roles r WHERE r.rolname = current_user;
  IF v_cur_bypass IS NOT TRUE THEN
    RAISE EXCEPTION 's7_70 PRE: current_user (%) no tiene BYPASSRLS; las RPC SECURITY DEFINER no saltarían RLS', current_user;
  END IF;
  IF current_user <> v_owner_nm THEN
    RAISE EXCEPTION 's7_70 PRE: current_user (%) difiere del owner de appointments (%); las RPC quedarían con otro propietario', current_user, v_owner_nm;
  END IF;

  -- 0.2 Panorama de policies que habilitan UPDATE (cmd 'w' o '*'):
  --     exactamente UNA permisiva, llamada appointments_update, y CERO
  --     restrictivas. Si hubiera una segunda permisiva, cerrar esta sería
  --     inútil (las permisivas se combinan con OR).
  SELECT count(*), coalesce(string_agg(p.polname, ', ' ORDER BY p.polname), '')
    INTO v_perm_upd, v_perm_names
  FROM pg_policy p
  WHERE p.polrelid = 'public.appointments'::regclass
    AND p.polcmd IN ('w', '*') AND p.polpermissive;
  IF v_perm_upd <> 1 THEN
    RAISE EXCEPTION 's7_70 PRE: se esperaba 1 policy permisiva que habilite UPDATE; hay % (%)',
      v_perm_upd, v_perm_names;
  END IF;
  IF v_perm_names <> 'appointments_update' THEN
    RAISE EXCEPTION 's7_70 PRE: la única policy permisiva de UPDATE no es appointments_update (es "%")', v_perm_names;
  END IF;
  SELECT count(*) INTO v_restr_upd
  FROM pg_policy p
  WHERE p.polrelid = 'public.appointments'::regclass
    AND p.polcmd IN ('w', '*') AND NOT p.polpermissive;
  IF v_restr_upd <> 0 THEN
    RAISE EXCEPTION 's7_70 PRE: existen % policies RESTRICTIVAS sobre UPDATE; el cierre debe rediseñarse', v_restr_upd;
  END IF;

  -- 0.3 Forma SEMÁNTICA de appointments_update: existe una sola vez,
  --     es FOR UPDATE, permisiva y aplica a PUBLIC.
  SELECT count(*) INTO v_named
  FROM pg_policy p
  WHERE p.polrelid = 'public.appointments'::regclass AND p.polname = 'appointments_update';
  IF v_named <> 1 THEN
    RAISE EXCEPTION 's7_70 PRE: appointments_update existe % veces (se esperaba 1)', v_named;
  END IF;
  SELECT p.polcmd, p.polpermissive, p.polroles,
         pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_pol_cmd, v_pol_perm, v_pol_roles, v_using, v_check
  FROM pg_policy p
  WHERE p.polrelid = 'public.appointments'::regclass AND p.polname = 'appointments_update';
  IF v_pol_cmd <> 'w' THEN
    RAISE EXCEPTION 's7_70 PRE: appointments_update no es FOR UPDATE (polcmd=%)', v_pol_cmd;
  END IF;
  IF v_pol_perm IS NOT TRUE THEN
    RAISE EXCEPTION 's7_70 PRE: appointments_update no es PERMISSIVE';
  END IF;
  IF v_pol_roles IS DISTINCT FROM ARRAY[0::oid] THEN
    RAISE EXCEPTION 's7_70 PRE: appointments_update no aplica exactamente a PUBLIC (polroles=%)', v_pol_roles;
  END IF;

  -- 0.4 USING por IGUALDAD CANÓNICA (insensible a espacios/saltos y al
  --     prefijo `public.`), no por texto literal. Cualquier cláusula extra
  --     o faltante aborta.
  IF v_using IS NULL THEN
    RAISE EXCEPTION 's7_70 PRE: appointments_update no tiene USING';
  END IF;
  v_canon     := replace(regexp_replace(v_using,    '\s', '', 'g'), 'public.', '');
  v_canon_exp := replace(regexp_replace(v_expected, '\s', '', 'g'), 'public.', '');
  IF v_canon <> v_canon_exp THEN
    RAISE EXCEPTION 's7_70 PRE: el USING de appointments_update NO coincide con el capturado en el preflight. Actual: %', v_using;
  END IF;

  -- 0.5 WITH CHECK debe ser NULL (hereda el USING). Si alguien lo definió,
  --     el análisis de impacto ya no vale.
  IF v_check IS NOT NULL THEN
    RAISE EXCEPTION 's7_70 PRE: appointments_update tiene WITH CHECK propio (%); se esperaba NULL', v_check;
  END IF;

  -- 0.6 Privilegios de partida: authenticated con UPDATE efectivo (es lo
  --     que vamos a acotar) y anon SIN UPDATE (no debe ganarlo nunca).
  IF NOT has_table_privilege('authenticated', 'public.appointments', 'UPDATE') THEN
    RAISE EXCEPTION 's7_70 PRE: authenticated NO tiene UPDATE efectivo (¿migración ya aplicada?)';
  END IF;
  IF has_table_privilege('anon', 'public.appointments', 'UPDATE') THEN
    RAISE EXCEPTION 's7_70 PRE: anon tiene UPDATE sobre appointments; estado inesperado';
  END IF;

  -- 0.7 Los objetos nuevos no deben existir todavía (apply único).
  IF to_regclass('public.appointment_patient_cancellations') IS NOT NULL THEN
    RAISE EXCEPTION 's7_70 PRE: appointment_patient_cancellations ya existe';
  END IF;
  IF to_regprocedure('public.cancel_my_appointment(uuid, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 's7_70 PRE: cancel_my_appointment ya existe';
  END IF;
  IF to_regprocedure('public.list_recent_patient_cancellations()') IS NOT NULL THEN
    RAISE EXCEPTION 's7_70 PRE: list_recent_patient_cancellations ya existe';
  END IF;

  -- 0.8 El estado 'cancelada' debe existir en el catálogo.
  IF NOT EXISTS (SELECT 1 FROM public.appointment_statuses s WHERE s.name = 'cancelada') THEN
    RAISE EXCEPTION 's7_70 PRE: no existe appointment_statuses.name = ''cancelada''';
  END IF;

  -- 0.9 Dependencia documentada: trg_block_inactive_service se dispara en
  --     TODO UPDATE (sin lista de columnas) y su función NO tiene
  --     `SET search_path` propio; solo alcanza su SELECT sin calificar
  --     cuando service_id cambia. Nuestro UPDATE nunca toca service_id.
  --     Con search_path = pg_catalog, public, pg_temp el riesgo queda
  --     neutralizado igualmente; la precondición deja constancia de que el
  --     trigger sigue existiendo tal como se analizó.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.appointments'::regclass
      AND t.tgname = 'trg_block_inactive_service' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 's7_70 PRE: trg_block_inactive_service no existe; el análisis de triggers cambió';
  END IF;

  RAISE NOTICE 's7_70 PRE: OK — estado de partida verificado';
END
$pre$;

-- ─── 1. Tabla append-only de cancelaciones del paciente ───────────────
-- Una sola fila por cita: la PRIMARY KEY sobre appointment_id ES la
-- garantía de unicidad. La EXISTENCIA de la fila significa
-- "Cancelada por el paciente en LucyCare" — no hay flag redundante.
-- La FK no declara ON DELETE: un borrado físico de la cita quedaría
-- bloqueado, coherente con la política de no hard-delete del proyecto.
CREATE TABLE public.appointment_patient_cancellations (
  appointment_id          uuid PRIMARY KEY
                            REFERENCES public.appointments(id),
  cancelled_at            timestamptz NOT NULL,
  cancelled_by_profile_id uuid NOT NULL
                            REFERENCES public.profiles(id),
  reason                  text NULL,
  note                    text NULL,
  CONSTRAINT appointment_patient_cancellations_reason_chk
    CHECK (reason IS NULL OR reason IN
      ('no_puedo_asistir', 'otro_horario', 'ya_no_necesito', 'otro')),
  CONSTRAINT appointment_patient_cancellations_note_chk
    CHECK (note IS NULL OR char_length(note) <= 300)
);

COMMENT ON TABLE public.appointment_patient_cancellations IS
  'Append-only. La existencia de la fila = "Cancelada por el paciente en LucyCare". Solo cancel_my_appointment inserta; sin UPDATE/DELETE para anon/authenticated.';

-- ─── 2. Índice para la tarjeta del médico (orden cancelled_at DESC) ───
CREATE INDEX idx_appt_patient_cancellations_cancelled_at
  ON public.appointment_patient_cancellations (cancelled_at DESC);

-- ─── 3. RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.appointment_patient_cancellations ENABLE ROW LEVEL SECURITY;

-- ─── 4. REVOKE frente a ALTER DEFAULT PRIVILEGES ──────────────────────
-- Sin esto la tabla nace con ALL para anon y authenticated.
REVOKE ALL ON TABLE public.appointment_patient_cancellations FROM PUBLIC;
REVOKE ALL ON TABLE public.appointment_patient_cancellations FROM anon;
REVOKE ALL ON TABLE public.appointment_patient_cancellations FROM authenticated;

-- ─── 5. Única lectura concedida ───────────────────────────────────────
GRANT SELECT ON TABLE public.appointment_patient_cancellations TO authenticated;

-- ─── 6. Policy de lectura: espeja la visibilidad de la cita ───────────
-- Ve el evento quien puede ver la cita: el paciente dueño o un miembro
-- activo de la clínica. Sin policies de escritura: el único escritor es
-- la RPC DEFINER, que no pasa por RLS.
CREATE POLICY appointment_patient_cancellations_select
  ON public.appointment_patient_cancellations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.appointments a
      WHERE a.id = appointment_patient_cancellations.appointment_id
        AND (
          public.is_clinic_member(a.clinic_id)
          OR a.patient_id IN (
            SELECT p.id FROM public.patients p WHERE p.profile_id = auth.uid()
          )
        )
    )
  );

-- ─── 7. RPC de cancelación del paciente ───────────────────────────────
CREATE FUNCTION public.cancel_my_appointment(
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
  --     La pertenencia (ficha del caller + vínculo confirmado, s7_43) va en
  --     el JOIN, no en una comprobación posterior: así NUNCA se bloquea una
  --     cita ajena o arbitraria. `FOR UPDATE OF a` bloquea solo la fila de
  --     appointments; `patients` no se bloquea.
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

  -- 7.5 Idempotencia ESTRICTA: solo se declara "ya cancelada por el
  --     paciente" cuando existe su fila de evento. Si la cita está
  --     cancelada SIN fila, la canceló otro actor: resultado terminal
  --     controlado, SIN atribuirla al paciente y SIN insertar eventos
  --     retrospectivos.
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

  -- 7.7 UPDATE acotado ÚNICAMENTE a status_id. `updated_at` lo pone el
  --     trigger trg_appointments_updated_at. No se toca ninguna otra
  --     columna (ni cancel_reason_id, que es del médico).
  UPDATE public.appointments
  SET status_id = v_cancel_id
  WHERE id = v_appt.id;

  -- 7.8 Evento append-only, misma transacción.
  INSERT INTO public.appointment_patient_cancellations
    (appointment_id, cancelled_at, cancelled_by_profile_id, reason, note)
  VALUES
    (v_appt.id, now(), v_uid, v_reason, v_note);

  -- 7.9 Auditoría server-side. La nota libre NO va al audit: es texto del
  --     paciente y ya vive en su tabla.
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

-- ─── 8. RPC de lectura para la tarjeta del médico ─────────────────────
-- NO acepta doctorId: lo deriva de auth.uid() con SQL propio y calificado
-- (los helpers legacy no son usables desde un search_path controlado).
-- Máximo fijo de 5 filas, ventana fija de 7 días, orden cancelled_at DESC.
-- La nota libre NO se expone acá: la tarjeta muestra solo el motivo.
CREATE FUNCTION public.list_recent_patient_cancellations()
RETURNS TABLE (
  appointment_id    uuid,
  patient_name      text,
  appointment_start timestamptz,
  cancelled_at      timestamptz,
  reason            text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_uid       uuid := auth.uid();
  v_doctor_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT d.id INTO v_doctor_id
  FROM public.doctors d
  WHERE d.profile_id = v_uid;

  -- Sin fila de doctor (paciente, asistente, admin) → sin resultados.
  -- El soporte a asistentes queda fuera de alcance por decisión del owner.
  IF v_doctor_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.appointment_id,
    p.full_name,
    a.start_time,
    c.cancelled_at,
    c.reason
  FROM public.appointment_patient_cancellations c
  JOIN public.appointments a ON a.id = c.appointment_id
  JOIN public.patients     p ON p.id = a.patient_id
  WHERE a.doctor_id = v_doctor_id
    AND c.cancelled_at >= now() - interval '7 days'
  ORDER BY c.cancelled_at DESC
  LIMIT 5;
END
$fn$;

-- ─── 9. REVOKE de funciones frente a ALTER DEFAULT PRIVILEGES ─────────
-- Sin esto ambas nacen con EXECUTE para anon.
REVOKE ALL ON FUNCTION public.cancel_my_appointment(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_recent_patient_cancellations()
  FROM PUBLIC, anon, authenticated;

-- ─── 10. EXECUTE mínimo ───────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.cancel_my_appointment(uuid, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_recent_patient_cancellations()
  TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- A PARTIR DE AQUÍ se toca public.appointments. El lock se toma AHORA y
-- se suelta con el COMMIT, unos milisegundos después: entre el LOCK y el
-- COMMIT solo hay reverificación, dos DDL de privilegios, la sustitución
-- de la policy y las postcondiciones. Ninguna creación de tabla, índice
-- o función, ni trabajo prolongado.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 11. LOCK + REVERIFICACIÓN BAJO EL LOCK ───────────────────────────
LOCK TABLE public.appointments IN ACCESS EXCLUSIVE MODE;

-- Las precondiciones del paso 0 se evaluaron SIN lock: entre aquel
-- momento y este, otra sesión pudo haber cambiado la policy o los grants.
-- Las sensibles a drift se repiten AHORA, ya bajo ACCESS EXCLUSIVE, que
-- es el único punto en el que el estado no puede moverse bajo los pies.
DO $relock$
DECLARE
  v_rls        boolean;
  v_force      boolean;
  v_owner_nm   text;
  v_pol_cmd    "char";
  v_pol_perm   boolean;
  v_pol_roles  oid[];
  v_using      text;
  v_check      text;
  v_expected   text :=
    '(is_clinic_member(clinic_id) OR (patient_id IN ( SELECT p.id FROM patients p WHERE (p.profile_id = auth.uid()))))';
BEGIN
  -- 11.1 Owner y flags de RLS de la tabla.
  SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner)
    INTO v_rls, v_force, v_owner_nm
  FROM pg_class c WHERE c.oid = 'public.appointments'::regclass;
  IF v_owner_nm <> current_user THEN
    RAISE EXCEPTION 's7_70 RELOCK: el owner de appointments cambió a % (se esperaba %)', v_owner_nm, current_user;
  END IF;
  IF v_rls IS NOT TRUE THEN
    RAISE EXCEPTION 's7_70 RELOCK: RLS dejó de estar activa en appointments';
  END IF;
  IF v_force IS NOT FALSE THEN
    RAISE EXCEPTION 's7_70 RELOCK: relforcerowsecurity pasó a %; el DEFINER dejaría de saltar RLS', v_force;
  END IF;

  -- 11.2 Definición SEMÁNTICA de appointments_update, otra vez.
  SELECT p.polcmd, p.polpermissive, p.polroles,
         pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_pol_cmd, v_pol_perm, v_pol_roles, v_using, v_check
  FROM pg_policy p
  WHERE p.polrelid = 'public.appointments'::regclass AND p.polname = 'appointments_update';
  IF NOT FOUND THEN
    RAISE EXCEPTION 's7_70 RELOCK: appointments_update desapareció entre las precondiciones y el lock';
  END IF;
  IF v_pol_cmd <> 'w' OR v_pol_perm IS NOT TRUE
     OR v_pol_roles IS DISTINCT FROM ARRAY[0::oid] THEN
    RAISE EXCEPTION 's7_70 RELOCK: appointments_update cambió de forma (cmd=%, perm=%, roles=%)',
      v_pol_cmd, v_pol_perm, v_pol_roles;
  END IF;
  IF v_check IS NOT NULL THEN
    RAISE EXCEPTION 's7_70 RELOCK: appointments_update ganó un WITH CHECK propio (%)', v_check;
  END IF;
  IF replace(regexp_replace(coalesce(v_using, ''), '\s', '', 'g'), 'public.', '')
   <> replace(regexp_replace(v_expected,           '\s', '', 'g'), 'public.', '') THEN
    RAISE EXCEPTION 's7_70 RELOCK: el USING de appointments_update cambió. Actual: %', v_using;
  END IF;

  -- 11.3 Grants de partida, otra vez: authenticated con UPDATE (lo que
  --      vamos a acotar) y anon sin él (no debe ganarlo nunca).
  IF NOT has_table_privilege('authenticated', 'public.appointments', 'UPDATE') THEN
    RAISE EXCEPTION 's7_70 RELOCK: authenticated perdió el UPDATE entre las precondiciones y el lock';
  END IF;
  IF has_table_privilege('anon', 'public.appointments', 'UPDATE') THEN
    RAISE EXCEPTION 's7_70 RELOCK: anon ganó UPDATE sobre appointments';
  END IF;

  RAISE NOTICE 's7_70 RELOCK: OK — estado reverificado bajo ACCESS EXCLUSIVE';
END
$relock$;

-- ─── 12. HARDENING: appointments_update sin rama de paciente ──────────
-- Fail-closed: sin IF EXISTS. Si la policy no está, la migración aborta.
DROP POLICY "appointments_update" ON public.appointments;
CREATE POLICY "appointments_update" ON public.appointments
  FOR UPDATE TO authenticated
  USING      (public.is_clinic_member(clinic_id))
  WITH CHECK (public.is_clinic_member(clinic_id));

-- WITH CHECK explícito (antes NULL, heredando el USING): misma semántica,
-- pero auditable y a prueba de cambios futuros del USING. Impide además
-- mover la cita a una clínica sobre la que el actor no tiene acceso.

-- ─── 13. UPDATE de authenticated acotado a 9 columnas ─────────────────
-- En PostgreSQL NO se puede revocar una columna de un grant de tabla:
-- hay que revocar el UPDATE de tabla y re-otorgar por columna.
-- ⚠️ Impuesto permanente: toda columna NUEVA de appointments deberá
--    otorgarse explícitamente o el panel se romperá EN SILENCIO.
--    check-s7_70 afirma esta lista exacta para que el olvido falle en el
--    check y no en producción.
-- Las 9 columnas son las que el panel escribe hoy (updateAppointmentStatus
-- + updateAppointment). Quedan FUERA a propósito: patient_id, doctor_id,
-- clinic_id, payment_status, stripe_payment_id, source, reason_id,
-- created_by, created_at, consultation_started_at, consultation_ended_at.
REVOKE UPDATE ON public.appointments FROM authenticated;
GRANT UPDATE (
  status_id,
  updated_at,
  cancel_reason_id,
  internal_notes,
  start_time,
  end_time,
  service_id,
  notes,
  price
) ON public.appointments TO authenticated;

-- ─── 14. POSTCONDICIONES ──────────────────────────────────────────────
DO $post$
DECLARE
  v_pol_cmd   "char";
  v_pol_perm  boolean;
  v_pol_roles oid[];
  v_using     text;
  v_check     text;
  -- OJO: `pg_get_expr` deparsa una llamada a función SIMPLE **sin** paréntesis
  -- envolventes (`is_clinic_member(clinic_id)`), a diferencia de una expresión
  -- compuesta como el `OR` de la policy anterior, que sí los lleva. El valor
  -- esperado debe ser la forma deparsada, no la que se escribió en el DDL.
  v_expected  text := 'is_clinic_member(clinic_id)';
  v_auth_oid  oid;
  v_cols      text;
  v_expected_cols text :=
    'cancel_reason_id,end_time,internal_notes,notes,price,service_id,start_time,status_id,updated_at';
  v_tbl_upd     boolean;
  v_sel_pols    int;
  v_wr_pols     int;
  v_fn_oid      oid;
  v_fn_name     text;
  v_fn_owner_nm text;
  v_secdef      boolean;
  v_cfg         text[];
BEGIN
  -- 14.1 La policy nueva, semánticamente.
  SELECT p.polcmd, p.polpermissive, p.polroles,
         pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_pol_cmd, v_pol_perm, v_pol_roles, v_using, v_check
  FROM pg_policy p
  WHERE p.polrelid = 'public.appointments'::regclass AND p.polname = 'appointments_update';
  IF NOT FOUND THEN
    RAISE EXCEPTION 's7_70 POST: appointments_update no existe tras la sustitución';
  END IF;
  IF v_pol_cmd <> 'w' OR v_pol_perm IS NOT TRUE THEN
    RAISE EXCEPTION 's7_70 POST: appointments_update no quedó como FOR UPDATE permisiva (cmd=%, perm=%)', v_pol_cmd, v_pol_perm;
  END IF;
  SELECT r.oid INTO v_auth_oid FROM pg_roles r WHERE r.rolname = 'authenticated';
  IF v_pol_roles IS DISTINCT FROM ARRAY[v_auth_oid] THEN
    RAISE EXCEPTION 's7_70 POST: appointments_update no aplica exactamente a authenticated (polroles=%)', v_pol_roles;
  END IF;
  IF replace(regexp_replace(coalesce(v_using,''), '\s', '', 'g'), 'public.', '')
   <> replace(regexp_replace(v_expected,          '\s', '', 'g'), 'public.', '') THEN
    RAISE EXCEPTION 's7_70 POST: USING inesperado: %', v_using;
  END IF;
  IF replace(regexp_replace(coalesce(v_check,''), '\s', '', 'g'), 'public.', '')
   <> replace(regexp_replace(v_expected,          '\s', '', 'g'), 'public.', '') THEN
    RAISE EXCEPTION 's7_70 POST: WITH CHECK inesperado: %', v_check;
  END IF;

  -- 14.2 El paciente pierde el UPDATE de tabla; quedan exactamente las 9
  --      columnas aprobadas.
  SELECT has_table_privilege('authenticated', 'public.appointments', 'UPDATE')
    INTO v_tbl_upd;
  IF v_tbl_upd IS TRUE THEN
    RAISE EXCEPTION 's7_70 POST: authenticated conserva UPDATE de TABLA completa';
  END IF;
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.appointments'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE');
  IF coalesce(v_cols, '') <> v_expected_cols THEN
    RAISE EXCEPTION 's7_70 POST: el set de columnas UPDATE de authenticated es "%" y se esperaba "%"', v_cols, v_expected_cols;
  END IF;

  -- 14.3 anon no ganó nada.
  IF has_table_privilege('anon', 'public.appointments', 'UPDATE')
     OR has_table_privilege('anon', 'public.appointment_patient_cancellations', 'SELECT')
     OR has_table_privilege('anon', 'public.appointment_patient_cancellations', 'INSERT') THEN
    RAISE EXCEPTION 's7_70 POST: anon obtuvo privilegios sobre appointments o sobre la tabla nueva';
  END IF;

  -- 14.4 La tabla nueva: sin escritura para authenticated, con SELECT.
  IF has_table_privilege('authenticated', 'public.appointment_patient_cancellations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.appointment_patient_cancellations', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.appointment_patient_cancellations', 'DELETE')
     OR has_table_privilege('authenticated', 'public.appointment_patient_cancellations', 'TRUNCATE') THEN
    RAISE EXCEPTION 's7_70 POST: authenticated conserva escritura sobre appointment_patient_cancellations';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.appointment_patient_cancellations', 'SELECT') THEN
    RAISE EXCEPTION 's7_70 POST: authenticated no puede leer appointment_patient_cancellations';
  END IF;

  -- 14.5 Las RPC: solo authenticated ejecuta.
  IF has_function_privilege('anon', 'public.cancel_my_appointment(uuid, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.list_recent_patient_cancellations()', 'EXECUTE') THEN
    RAISE EXCEPTION 's7_70 POST: anon puede ejecutar alguna de las RPC nuevas';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.cancel_my_appointment(uuid, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.list_recent_patient_cancellations()', 'EXECUTE') THEN
    RAISE EXCEPTION 's7_70 POST: authenticated no puede ejecutar alguna de las RPC nuevas';
  END IF;

  -- 14.6 RLS activa en la tabla nueva, EXACTAMENTE una policy de SELECT y
  --      CERO de escritura.
  IF NOT (SELECT c.relrowsecurity FROM pg_class c
          WHERE c.oid = 'public.appointment_patient_cancellations'::regclass) THEN
    RAISE EXCEPTION 's7_70 POST: RLS no quedó activa en appointment_patient_cancellations';
  END IF;
  SELECT count(*) INTO v_sel_pols
  FROM pg_policy p
  WHERE p.polrelid = 'public.appointment_patient_cancellations'::regclass
    AND p.polcmd = 'r';
  IF v_sel_pols <> 1 THEN
    RAISE EXCEPTION 's7_70 POST: se esperaba exactamente 1 policy SELECT en la tabla nueva; hay %', v_sel_pols;
  END IF;
  SELECT count(*) INTO v_wr_pols
  FROM pg_policy p
  WHERE p.polrelid = 'public.appointment_patient_cancellations'::regclass
    AND p.polcmd <> 'r';
  IF v_wr_pols <> 0 THEN
    RAISE EXCEPTION 's7_70 POST: existen % policies de escritura en appointment_patient_cancellations', v_wr_pols;
  END IF;

  -- 14.7 Las RPC: propietario esperado, SECURITY DEFINER y search_path
  --      EXACTO. Es la premisa que sostiene todo el diseño: sin owner con
  --      BYPASSRLS no saltan RLS, y sin el search_path correcto fallarían
  --      al resolver relaciones desde los triggers heredados.
  FOR v_fn_oid IN
    SELECT unnest(ARRAY[
      to_regprocedure('public.cancel_my_appointment(uuid, text, text)'),
      to_regprocedure('public.list_recent_patient_cancellations()')
    ])
  LOOP
    IF v_fn_oid IS NULL THEN
      RAISE EXCEPTION 's7_70 POST: alguna de las RPC no existe con la firma esperada';
    END IF;
    SELECT p.proname, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
      INTO v_fn_name, v_fn_owner_nm, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = v_fn_oid;

    IF v_fn_owner_nm <> current_user THEN
      RAISE EXCEPTION 's7_70 POST: % pertenece a % y se esperaba % (rol ejecutor)', v_fn_name, v_fn_owner_nm, current_user;
    END IF;
    IF NOT (SELECT r.rolbypassrls FROM pg_roles r WHERE r.rolname = v_fn_owner_nm) THEN
      RAISE EXCEPTION 's7_70 POST: el owner de % (%) no tiene BYPASSRLS', v_fn_name, v_fn_owner_nm;
    END IF;
    IF v_secdef IS NOT TRUE THEN
      RAISE EXCEPTION 's7_70 POST: % no es SECURITY DEFINER', v_fn_name;
    END IF;
    IF v_cfg IS NULL OR array_length(v_cfg, 1) <> 1 THEN
      RAISE EXCEPTION 's7_70 POST: % no tiene exactamente un ajuste en proconfig (%)', v_fn_name, v_cfg;
    END IF;
    -- Comparación canónica: el formato almacenado conserva los espacios de
    -- la declaración, así que se normalizan antes de comparar.
    IF replace(v_cfg[1], ' ', '') <> 'search_path=pg_catalog,public,pg_temp' THEN
      RAISE EXCEPTION 's7_70 POST: search_path de % es "%" y se esperaba "search_path=pg_catalog, public, pg_temp"', v_fn_name, v_cfg[1];
    END IF;
  END LOOP;

  -- 14.8 PUBLIC sin acceso a la tabla nueva ni a las RPC.
  IF has_table_privilege('public', 'public.appointment_patient_cancellations', 'SELECT')
     OR has_table_privilege('public', 'public.appointment_patient_cancellations', 'INSERT') THEN
    RAISE EXCEPTION 's7_70 POST: PUBLIC conserva acceso a appointment_patient_cancellations';
  END IF;
  IF has_function_privilege('public', 'public.cancel_my_appointment(uuid, text, text)', 'EXECUTE')
     OR has_function_privilege('public', 'public.list_recent_patient_cancellations()', 'EXECUTE') THEN
    RAISE EXCEPTION 's7_70 POST: PUBLIC puede ejecutar alguna de las RPC nuevas';
  END IF;

  RAISE NOTICE 's7_70 POST: OK — cancelación por RPC habilitada y UPDATE del paciente cerrado';
END
$post$;

COMMIT;
