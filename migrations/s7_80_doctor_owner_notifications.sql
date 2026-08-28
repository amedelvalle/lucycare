-- ============================================================
-- s7_80_doctor_owner_notifications.sql
-- DOCTOR-OWNER-NOTIFICATIONS-P0
--
-- Avisa por correo al owner cuando ocurre uno de DOS eventos, y solo dos:
--   1. un médico completa el formulario de afiliación;
--   2. un médico reclama un perfil existente.
--
-- ── ARQUITECTURA ──
--   outbox → Database Webhook (pg_net) → Edge Function → Resend
--
-- Esta migración crea ÚNICAMENTE la mitad que vive en la base: la outbox, sus
-- dos puntos de encolado y las dos RPCs que consume el procesador. NO instala
-- `pg_net`, NO crea la webhook y NO envía correo. La outbox es funcional sin
-- `pg_net`: lo único que falta sin la extensión es quién despierte al
-- procesador.
--
-- ── INVARIANTE QUE MANDA SOBRE TODO LO DEMÁS ──
-- Un fallo del correo JAMÁS puede revertir ni impedir una afiliación o un
-- claim. Por eso el encolado va envuelto en un bloque de excepción que se
-- traga cualquier error: se pierde el aviso, nunca el evento de negocio.
--
-- ── POR QUÉ UNA OUTBOX Y NO UN POST DIRECTO ──
--   · No bloqueo: la fila se escribe en la MISMA transacción; el envío ocurre
--     fuera de ella. Resend caído = una fila esperando.
--   · Idempotencia: "¿ya lo enviamos?" no tiene respuesta sin estado durable.
--   · Observabilidad: el ciclo de vida ES la columna `status`
--     (pending → sending → sent | failed | needs_reconciliation).
--
-- ── VENTANA DE IDEMPOTENCIA (23 h) ──
-- Resend conserva la Idempotency-Key 24 h. Un reintento posterior a ese plazo
-- ya NO sería idempotente y mandaría un segundo correo. Por eso la
-- recuperación automática de `sending` está acotada a 23 h desde el PRIMER
-- intento; pasada la ventana, la fila queda en `needs_reconciliation` con
-- `idem_window_expired` y NO se reenvía sola. Detalle en
-- `notify_owner_claim_batch`.
--
-- ── DÓNDE SE ENCOLA CADA EVENTO, Y POR QUÉ SON DISTINTOS ──
--   Afiliación → trigger AFTER INSERT sobre `doctor_affiliation_requests`.
--     Una fila = un lead. La rama `unique_violation` de
--     `submit_affiliation_request` NO inserta, así que un reenvío del mismo
--     médico no vuelve a avisar. El éxito del frontend NO es el evento: esa
--     RPC devuelve success:true también cuando no insertó nada.
--   Claim → dentro de `claim_doctor_profile`, tras el audit_log.
--     Un trigger sobre `doctors` NO puede distinguir el claim self-service de
--     un `admin_set_lucy_status(listed_only -> claimed)`: ambos producen la
--     misma transición de columna. La inserción en la RPC es semántica exacta,
--     no heurística, y es verificable con A/B contra s7_64.
--
-- ── SIN PII EN LA OUTBOX ──
-- Guarda tipo de evento, clave de deduplicación, IDs canónicos y estado.
-- Nombre, teléfono y correo NO se copian: los resuelve
-- `notify_owner_claim_batch` en el momento del envío, con una allowlist
-- explícita que vive en la BASE, no en el remitente.
--
-- ── NO TOCA ──
-- audit_log (inmutable desde s7_71b, y esto es estado operativo mutable),
-- admin_list_doctors, admin_export_doctors, Auth, Twilio, Turnstile, la RLS de
-- otras tablas, ni una sola línea de `src/`.
--
-- Aplicar en el SQL Editor de Supabase. Verificar con:
--   node scripts/check-s7_80.mjs
-- ============================================================

-- ─── 0. PRE — bloqueantes ───────────────────────────────────
DO $pre$
DECLARE
  v_src text;
BEGIN
  IF to_regclass('public.doctors') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.specialties') IS NULL
     OR to_regclass('public.doctor_affiliation_requests') IS NULL THEN
    RAISE EXCEPTION 'PRE falló: faltan tablas núcleo';
  END IF;

  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'PRE falló: is_admin() no existe';
  END IF;

  IF to_regprocedure('public.claim_doctor_profile(uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION 'PRE falló: claim_doctor_profile(uuid,text,text) no existe';
  END IF;

  -- La versión vigente DEBE ser la de s7_64 (sin fallback a la columna de
  -- licencia). Si no lo es, alguien la reemplazó por fuera y el cuerpo que
  -- esta migración reescribe no sería el que creemos: abortamos antes de
  -- pisarlo.
  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public.claim_doctor_profile(uuid, text, text)'::regprocedure;

  IF v_src IS NULL OR position('doctor_credentials' in v_src) = 0 THEN
    RAISE EXCEPTION 'PRE falló: claim_doctor_profile no parece la versión de s7_64';
  END IF;
  IF position('_enqueue_doctor_owner_notification' in v_src) > 0 THEN
    RAISE EXCEPTION 'PRE falló: claim_doctor_profile ya trae el enqueue — s7_80 parece aplicada';
  END IF;

  RAISE NOTICE 's7_80 PRE: OK';
END $pre$;

-- ─── 1. Outbox ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.doctor_owner_notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type          text NOT NULL,

  -- Clave de deduplicación. Su significado DEPENDE del evento, y es
  -- deliberado (ver `_enqueue_doctor_owner_notification`).
  dedupe_key          text NOT NULL,

  -- Sujetos. Solo IDs canónicos: ni nombres, ni teléfonos, ni correos.
  subject_request_id  uuid REFERENCES public.doctor_affiliation_requests(id) ON DELETE CASCADE,
  subject_doctor_id   uuid REFERENCES public.doctors(id) ON DELETE CASCADE,
  subject_profile_id  uuid REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Entrega
  status              text NOT NULL DEFAULT 'pending',
  attempts            int  NOT NULL DEFAULT 0,

  -- Cuándo se presentó la Idempotency-Key al proveedor POR PRIMERA VEZ. No es
  -- decorativo: Resend conserva esa clave 24 h, así que este sello es el que
  -- decide si un reintento sigue siendo seguro o si reenviaría de verdad.
  -- Se fija en la primera reclamación y NUNCA se reescribe.
  first_attempt_at    timestamptz,
  last_attempt_at     timestamptz,
  last_error_code     text,
  provider_message_id text,
  sent_at             timestamptz,

  occurred_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT don_event_type_chk
    CHECK (event_type IN ('affiliation_submitted', 'doctor_profile_claimed')),
  -- `needs_reconciliation` NO es un fallo de envío: es "no sé si salió y ya no
  -- puedo averiguarlo sin arriesgar un duplicado". Ver la ventana de
  -- idempotencia en notify_owner_claim_batch.
  CONSTRAINT don_status_chk
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'needs_reconciliation')),
  CONSTRAINT don_dedupe_not_blank
    CHECK (btrim(dedupe_key) <> ''),
  CONSTRAINT don_attempts_non_negative
    CHECK (attempts >= 0),

  -- FORMA de cada evento: el sujeto correcto presente, los demás ausentes.
  CONSTRAINT don_affiliation_shape CHECK (
    event_type <> 'affiliation_submitted'
    OR (subject_request_id IS NOT NULL AND subject_doctor_id IS NULL AND subject_profile_id IS NULL)),
  CONSTRAINT don_claim_shape CHECK (
    event_type <> 'doctor_profile_claimed'
    OR (subject_doctor_id IS NOT NULL AND subject_profile_id IS NOT NULL AND subject_request_id IS NULL)),

  -- FORMA de cada estado de entrega.
  CONSTRAINT don_sending_shape CHECK (
    status <> 'sending' OR (last_attempt_at IS NOT NULL AND first_attempt_at IS NOT NULL)),
  CONSTRAINT don_sent_shape    CHECK (status <> 'sent'    OR sent_at IS NOT NULL),
  CONSTRAINT don_failed_shape  CHECK (status <> 'failed'  OR btrim(coalesce(last_error_code, '')) <> ''),
  -- Una fila a reconciliar SIEMPRE dice desde cuándo y por qué.
  CONSTRAINT don_reconcile_shape CHECK (
    status <> 'needs_reconciliation'
    OR (first_attempt_at IS NOT NULL AND btrim(coalesce(last_error_code, '')) <> '')),
  -- El primer intento nunca puede ser posterior al último.
  CONSTRAINT don_attempt_order CHECK (
    first_attempt_at IS NULL OR last_attempt_at IS NULL OR first_attempt_at <= last_attempt_at)
);

-- Un aviso por (tipo, clave). Para el claim la clave es el PROPIO id de la
-- fila, así que este índice NO suprime nada entre transacciones: cada claim
-- real genera un evento nuevo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_don_event_dedupe
  ON public.doctor_owner_notifications (event_type, dedupe_key);

-- Soporte del drenado: solo lo que queda por entregar.
CREATE INDEX IF NOT EXISTS idx_don_drain
  ON public.doctor_owner_notifications (occurred_at, id)
  WHERE status IN ('pending', 'sending');

COMMENT ON TABLE public.doctor_owner_notifications IS
  'Outbox de avisos al owner (afiliación completada, perfil reclamado). Sin '
  'PII: solo IDs canónicos y estado de entrega. Sin DML de cliente — solo las '
  'funciones SECURITY DEFINER de s7_80 escriben acá. NO es auditoría: '
  'audit_log es inmutable y esto es estado operativo mutable.';

-- ─── 2. RLS y grants ────────────────────────────────────────
-- Sin DML de cliente. Ni siquiera service_role toca la tabla directamente:
-- entra por las dos RPCs, que aplican la allowlist de campos.
ALTER TABLE public.doctor_owner_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_owner_notifications FROM PUBLIC;
REVOKE ALL ON public.doctor_owner_notifications FROM anon;
REVOKE ALL ON public.doctor_owner_notifications FROM authenticated;
REVOKE ALL ON public.doctor_owner_notifications FROM service_role;

DROP POLICY IF EXISTS don_select_admin ON public.doctor_owner_notifications;
CREATE POLICY don_select_admin ON public.doctor_owner_notifications
  FOR SELECT USING (public.is_admin());
-- Deliberadamente SIN policies de INSERT/UPDATE/DELETE.
GRANT SELECT ON public.doctor_owner_notifications TO authenticated;

-- service_role: SOLO lectura, y solo para diagnóstico y smoke ("¿por qué esta
-- fila sigue en sending?"). NINGÚN privilegio de escritura: la mutación sigue
-- pasando obligatoriamente por las dos RPCs, que son las que aplican la
-- allowlist de campos y la reclamación atómica. Sin este GRANT, un incidente
-- en producción sería inauditable desde scripts.
GRANT SELECT ON public.doctor_owner_notifications TO service_role;

-- ─── 3. Encolado — best-effort por construcción ─────────────
CREATE OR REPLACE FUNCTION public._enqueue_doctor_owner_notification(
  p_event_type text,
  p_request_id uuid DEFAULT NULL,
  p_doctor_id  uuid DEFAULT NULL,
  p_profile_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $enq$
DECLARE
  v_id     uuid := gen_random_uuid();
  v_dedupe text;
BEGIN
  -- La clave de deduplicación depende del evento, y la asimetría es DELIBERADA:
  --
  --   affiliation_submitted  -> id de la solicitud. Clave natural y estable:
  --     una solicitud, un aviso, siempre.
  --
  --   doctor_profile_claimed -> el PROPIO id de este aviso. Es decir, CERO
  --     supresión entre transacciones. Un admin puede revertir un claim con
  --     `admin_set_lucy_status` y el médico volver a reclamar: ese segundo
  --     claim es legítimo y DEBE volver a notificar. Deduplicar por doctor_id
  --     (o por doctor_id + profile_id) lo silenciaría, y silenciar un aviso
  --     legítimo es peor que repetirlo.
  --
  -- La unicidad "un correo por claim real" NO depende de esta clave: la da la
  -- guarda `lucy_status = 'listed_only'` de claim_doctor_profile, que hace
  -- morir el segundo intento en P0003 ANTES de llegar hasta aquí.
  IF p_event_type = 'affiliation_submitted' THEN
    v_dedupe := p_request_id::text;
  ELSE
    v_dedupe := v_id::text;
  END IF;

  INSERT INTO public.doctor_owner_notifications (
    id, event_type, dedupe_key,
    subject_request_id, subject_doctor_id, subject_profile_id
  ) VALUES (
    v_id, p_event_type, v_dedupe,
    p_request_id, p_doctor_id, p_profile_id
  )
  ON CONFLICT (event_type, dedupe_key) DO NOTHING;

EXCEPTION WHEN OTHERS THEN
  -- INVARIANTE DEL FRENTE. El evento de negocio SIEMPRE gana.
  --
  -- Este bloque cubre también el trigger de la Database Webhook, que se
  -- encadena a este INSERT y por tanto corre DENTRO de esta subtransacción:
  -- si `pg_net` fallara al encolar la petición HTTP, tampoco podría revertir
  -- la afiliación ni el claim. Se pierde el aviso y queda constancia.
  RAISE WARNING 's7_80: no se pudo encolar el aviso (%): %', p_event_type, SQLERRM;
END;
$enq$;

REVOKE ALL ON FUNCTION public._enqueue_doctor_owner_notification(text, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._enqueue_doctor_owner_notification(text, uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._enqueue_doctor_owner_notification(text, uuid, uuid, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public._enqueue_doctor_owner_notification(text, uuid, uuid, uuid) FROM service_role;

-- ─── 4. Afiliación — trigger AFTER INSERT ───────────────────
CREATE OR REPLACE FUNCTION public._notify_owner_affiliation_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $aff$
BEGIN
  PERFORM public._enqueue_doctor_owner_notification('affiliation_submitted', NEW.id, NULL, NULL);
  RETURN NEW;
END;
$aff$;

-- Solo INSERT. Un UPDATE de estado (triage admin) no es un lead nuevo.
DROP TRIGGER IF EXISTS trg_notify_owner_affiliation ON public.doctor_affiliation_requests;
CREATE TRIGGER trg_notify_owner_affiliation
  AFTER INSERT ON public.doctor_affiliation_requests
  FOR EACH ROW EXECUTE FUNCTION public._notify_owner_affiliation_fn();

-- ─── 5. Claim — cuerpo VERBATIM de s7_64 + el bloque mínimo ─
-- Todo lo que sigue hasta el GRANT es idéntico a s7_64 salvo UN bloque
-- marcado `s7_80`. Verificado por A/B estructural en check-s7_80.mjs:
-- quitando ese bloque, el cuerpo debe ser byte-idéntico al de s7_64.
CREATE OR REPLACE FUNCTION claim_doctor_profile(
  p_doctor_id     uuid,
  p_license_typed text,
  p_tos_version   text DEFAULT 'v1.0'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id                   uuid := auth.uid();
  v_user_phone_norm           text;
  v_doctor_profile_id         uuid;
  v_doctor_clinic_id          uuid;
  v_doctor_lucy_status        lucy_status;
  v_doctor_phone_norm         text;
  v_typed_license_norm        text;
  v_doctor_license_norm       text;
  v_tos_version               text := nullif(btrim(coalesce(p_tos_version, '')), '');
  -- F1-c1: la ÚNICA fuente de la licencia es doctor_credentials.
  v_cred_license              text;
  v_cred_status               credential_status;
  v_effective_license         text;
BEGIN
  -- ─── 0. Auth ───
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión primero' USING ERRCODE = '28000';
  END IF;

  -- ─── 1. Teléfono verificado en auth.users de la sesión actual ───
  -- Solo aceptamos el phone que Supabase/Twilio ya confirmó (phone_confirmed_at).
  -- No confiamos en lo que el usuario tipea en el modal.
  SELECT regexp_replace(coalesce(au.phone, ''), '\D', '', 'g')
    INTO v_user_phone_norm
  FROM auth.users au
  WHERE au.id = v_user_id
    AND au.phone_confirmed_at IS NOT NULL;

  IF v_user_phone_norm IS NULL OR v_user_phone_norm = '' THEN
    RAISE EXCEPTION 'Para reclamar un perfil necesitás iniciar sesión con tu teléfono verificado por SMS'
      USING ERRCODE = 'P0001';
  END IF;

  -- ─── 2. Cargar doctor + profile vinculado (phone) ───
  -- (s7_64) Ya NO se lee d.license_number: el claim no tiene ningún lector
  -- de la columna.
  SELECT
    d.profile_id,
    d.clinic_id,
    d.lucy_status,
    regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') AS profile_phone_norm
  INTO
    v_doctor_profile_id,
    v_doctor_clinic_id,
    v_doctor_lucy_status,
    v_doctor_phone_norm
  FROM doctors d
  LEFT JOIN profiles p ON p.id = d.profile_id
  WHERE d.id = p_doctor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil de médico no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- ─── 3. Solo se puede reclamar lo que está listed_only ───
  IF v_doctor_lucy_status IS DISTINCT FROM 'listed_only'::lucy_status THEN
    RAISE EXCEPTION 'Este perfil ya fue reclamado o tiene un estado distinto. Si creés que es un error, contactanos.'
      USING ERRCODE = 'P0003';
  END IF;

  -- ─── 4. Phone match (server-side, sobre lo verificado por Twilio) ───
  IF v_doctor_phone_norm IS NULL OR v_doctor_phone_norm = '' THEN
    RAISE EXCEPTION 'El perfil del médico no tiene teléfono registrado. Necesitamos revisarlo manualmente; contactanos.'
      USING ERRCODE = 'P0004';
  END IF;

  IF v_user_phone_norm <> v_doctor_phone_norm THEN
    RAISE EXCEPTION 'El teléfono con el que iniciaste sesión no coincide con el registrado para este perfil. Si sos el profesional, contactanos para revisión manual.'
      USING ERRCODE = 'P0005';
  END IF;

  -- ─── 5. License match — F1-c1: fuente ÚNICA = doctor_credentials ─
  -- Regla (de F1-b, intacta): una credencial JVPM 'pending'/'verified' es
  -- utilizable; 'rejected' NO lo es. (s7_64) Sin fila JVPM ya NO hay
  -- fallback: v_effective_license queda NULL y cae a P0006 (revisión
  -- manual). one_per_type garantiza ≤1 fila JVPM. El valor se compara en
  -- variable interna y NUNCA se devuelve.
  SELECT dc.value, dc.status
    INTO v_cred_license, v_cred_status
  FROM doctor_credentials dc
  WHERE dc.doctor_id = p_doctor_id AND dc.type = 'JVPM'
  LIMIT 1;

  IF FOUND THEN
    -- La credencial existe: su ESTADO manda.
    IF v_cred_status = 'rejected' THEN
      v_effective_license := NULL;                              -- rechazada ⇒ inutilizable
    ELSE
      v_effective_license := NULLIF(btrim(v_cred_license), ''); -- pending / verified
    END IF;
  ELSE
    -- (s7_64) No hay fila JVPM → no hay licencia utilizable. La columna ya
    -- no se consulta (el fallback murió con F1-c1).
    v_effective_license := NULL;
  END IF;

  v_doctor_license_norm := upper(regexp_replace(coalesce(v_effective_license, ''), '\s', '', 'g'));
  v_typed_license_norm  := upper(regexp_replace(coalesce(p_license_typed, ''), '\s', '', 'g'));

  IF v_doctor_license_norm = '' THEN
    RAISE EXCEPTION 'El perfil del médico no tiene licencia registrada. Necesitamos revisarlo manualmente; contactanos.'
      USING ERRCODE = 'P0006';
  END IF;

  IF v_typed_license_norm = '' OR v_typed_license_norm <> v_doctor_license_norm THEN
    RAISE EXCEPTION 'La licencia ingresada no coincide con la registrada para este perfil. Si sos el profesional, contactanos para revisión manual.'
      USING ERRCODE = 'P0007';
  END IF;

  -- ─── 6. Vincular profile/doctor ───
  -- Caso normal (importados): doctor.profile_id == auth.uid() porque
  -- Supabase devolvió el auth.users existente al hacer OTP con el mismo phone.
  -- Caso seed/legacy: doctor.profile_id apunta a otro profile (sin auth.users).
  --   Re-apuntamos al auth.uid() actual y desactivamos el viejo profile huérfano.
  IF v_doctor_profile_id IS DISTINCT FROM v_user_id THEN
    -- Copiar datos no destructivos del profile viejo al actual si están vacíos
    UPDATE profiles AS me
      SET full_name  = COALESCE(NULLIF(btrim(me.full_name), ''), old.full_name),
          email      = COALESCE(me.email, old.email),
          avatar_url = COALESCE(me.avatar_url, old.avatar_url),
          updated_at = now()
    FROM profiles AS old
    WHERE me.id = v_user_id
      AND old.id = v_doctor_profile_id;

    -- Desactivar el profile huérfano para que no figure en listados
    IF v_doctor_profile_id IS NOT NULL THEN
      UPDATE profiles
         SET is_active = false,
             updated_at = now()
       WHERE id = v_doctor_profile_id;
    END IF;
  END IF;

  -- Asegurar role='doctor' en mi profile actual
  UPDATE profiles
     SET role = 'doctor'::user_role,
         updated_at = now()
   WHERE id = v_user_id;

  -- ─── 7. Update doctor: SOLO lucy_status + tos + profile_id ───
  -- NO tocar: is_published, booking_enabled, is_operational, is_verified, license_number.
  UPDATE doctors
     SET profile_id      = v_user_id,
         lucy_status     = 'claimed'::lucy_status,
         tos_accepted_at = now(),
         tos_version     = COALESCE(v_tos_version, tos_version, 'v1.0'),
         updated_at      = now()
   WHERE id = p_doctor_id;

  -- ─── 8. clinic_members como owner (idempotente) ───
  IF v_doctor_clinic_id IS NOT NULL THEN
    INSERT INTO clinic_members (clinic_id, profile_id, role, is_active)
    VALUES (v_doctor_clinic_id, v_user_id, 'owner'::clinic_member_role, true)
    ON CONFLICT (clinic_id, profile_id) DO UPDATE
      SET role = 'owner'::clinic_member_role,
          is_active = true;
  END IF;

  -- ─── 9. Audit log ───
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_user_id,
    'update'::audit_action,
    'doctors',
    p_doctor_id,
    jsonb_build_object(
      'lucy_status', v_doctor_lucy_status,
      'profile_id',  v_doctor_profile_id
    ),
    jsonb_build_object(
      'lucy_status',     'claimed',
      'profile_id',      v_user_id,
      'tos_version',     COALESCE(v_tos_version, 'v1.0'),
      'claimed_at',      now(),
      'edited_via',      'claim_self_service'
    )
  );

  -- >>> s7_80 ENQUEUE BEGIN
  -- Aviso al owner. ÚNICO añadido de s7_80 sobre el cuerpo de s7_64.
  --
  -- Va aquí, después de la auditoría, porque a esta altura todo el efecto
  -- del claim ya está escrito y solo falta devolver. El helper se traga
  -- cualquier error (ver su bloque EXCEPTION): si el aviso falla, el claim
  -- ya está hecho y así se queda. El correo NUNCA puede revertirlo.
  --
  -- Cada claim real genera un `outbox.id` nuevo: sin deduplicación por
  -- doctor_id, para que un claim legítimo posterior vuelva a notificar.
  PERFORM public._enqueue_doctor_owner_notification(
    'doctor_profile_claimed', NULL, p_doctor_id, v_user_id);
  -- <<< s7_80 ENQUEUE END

  RETURN jsonb_build_object(
    'success',     true,
    'doctor_id',   p_doctor_id,
    'lucy_status', 'claimed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION claim_doctor_profile(uuid, text, text) TO authenticated;

-- ─── 6. Drenado atómico de la outbox ────────────────────────
-- Reclama filas para envío y devuelve EXACTAMENTE los campos aprobados.
--
-- ATOMICIDAD: `FOR UPDATE SKIP LOCKED` garantiza que dos invocaciones
-- concurrentes NUNCA tomen la misma fila — la segunda salta las bloqueadas en
-- vez de esperarlas. Sin esto, dos webhooks casi simultáneas procesarían el
-- mismo evento y mandarían el correo dos veces.
--
-- RECUPERACIÓN DE `sending`, Y SU LÍMITE DURO:
--
-- Una fila que quedó en `sending` más de `p_stale_after` vuelve al lote. Es
-- seguro SOLO mientras el proveedor siga reconociendo la Idempotency-Key
-- derivada del `id`: dentro de esa ventana, un reintento devuelve el mensaje
-- original en vez de mandar otro correo.
--
-- ⚠️ Resend conserva la Idempotency-Key **24 horas**. Pasadas esas 24 h, la
-- clave caduca y el MISMO reintento dejaría de ser idempotente: mandaría un
-- segundo correo de verdad. Por eso la recuperación NO puede alcanzar filas
-- arbitrariamente antiguas.
--
-- Regla: se usan **23 h** como techo, con una hora de margen frente al límite
-- real del proveedor.
--   · dentro de ventana  → reintento con el MISMO id y la MISMA clave;
--   · fuera de ventana   → NO se reenvía. La fila pasa a
--                          `needs_reconciliation` con `idem_window_expired`.
--
-- `needs_reconciliation` es terminal para el automatismo y significa: "no sé
-- si ese correo salió, y ya no puedo averiguarlo sin arriesgar un duplicado".
-- Lo resuelve una persona mirando los logs de Resend. Se prefiere un aviso en
-- duda a un aviso duplicado.
--
-- El techo se aplica con LEAST, no con COALESCE: ningún llamador puede pedir
-- una ventana mayor, ni por error ni a propósito.
CREATE OR REPLACE FUNCTION public.notify_owner_claim_batch(
  p_limit              int      DEFAULT 25,
  p_stale_after        interval DEFAULT interval '10 minutes',
  p_idempotency_window interval DEFAULT interval '23 hours'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $batch$
DECLARE
  -- Piso y TECHO: un lote gigante alargaría la transacción y el tiempo de la
  -- Edge Function sin ganar nada.
  v_limit int      := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_stale interval := GREATEST(COALESCE(p_stale_after, interval '10 minutes'), interval '1 minute');
  -- TECHO DURO de 23 h. Ver arriba.
  v_window interval := LEAST(
                         GREATEST(COALESCE(p_idempotency_window, interval '23 hours'), interval '1 minute'),
                         interval '23 hours');
  v_rows  jsonb;
BEGIN
  -- ── Paso 1: retirar de circulación lo que ya no es idempotente ──
  -- Va ANTES de elegir el lote, de modo que una fila caducada no pueda
  -- colarse en él por ninguna vía.
  UPDATE public.doctor_owner_notifications
     SET status          = 'needs_reconciliation',
         last_error_code = 'idem_window_expired',
         updated_at      = now()
   WHERE status = 'sending'
     AND first_attempt_at IS NOT NULL
     AND first_attempt_at <= now() - v_window;

  -- ── Paso 2: reclamar el lote ──
  WITH picked AS (
    SELECT n.id
      FROM public.doctor_owner_notifications n
     WHERE n.status = 'pending'
        OR (n.status = 'sending'
            AND n.last_attempt_at < now() - v_stale
            -- Cinturón además del tirante del paso 1: aunque alguien llamara
            -- con una ventana distinta, aquí no entra nada caducado.
            AND n.first_attempt_at > now() - v_window)
     ORDER BY n.occurred_at, n.id
     LIMIT v_limit
       FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.doctor_owner_notifications n
       SET status           = 'sending',
           attempts         = n.attempts + 1,
           -- Se fija UNA vez y no se reescribe: es el origen de la ventana.
           first_attempt_at = COALESCE(n.first_attempt_at, now()),
           last_attempt_at  = now(),
           updated_at       = now()
      FROM picked
     WHERE n.id = picked.id
    RETURNING n.id, n.event_type, n.occurred_at, n.attempts,
              n.subject_request_id, n.subject_doctor_id
  )
  SELECT COALESCE(jsonb_agg(
           -- ALLOWLIST EXPLÍCITA. Lo que no esté nombrado aquí no sale de la
           -- base. Fuera quedan a propósito: licencia/JVPM, DUI, direcciones,
           -- el texto libre `message` del lead, tokens y cualquier dato
           -- clínico. El remitente no puede añadir lo que no recibe.
           jsonb_build_object(
             'id',          c.id,
             'event_type',  c.event_type,
             'occurred_at', c.occurred_at,
             'attempt',     c.attempts,
             'full_name',
               CASE WHEN c.event_type = 'affiliation_submitted'
                    THEN r.full_name ELSE p.full_name END,
             'specialty',
               CASE WHEN c.event_type = 'affiliation_submitted'
                    THEN COALESCE(rs.name, NULLIF(btrim(r.specialty_other), ''))
                    ELSE ds.name END,
             -- Teléfono y correo SOLO en el aviso de afiliación: son el dato
             -- de contacto que hace accionable el lead. En el de claim no
             -- aportan nada y por eso no viajan.
             'phone',
               CASE WHEN c.event_type = 'affiliation_submitted' THEN r.phone END,
             'email',
               CASE WHEN c.event_type = 'affiliation_submitted' THEN r.email END,
             'doctor_id',   c.subject_doctor_id,
             'lucy_status',
               CASE WHEN c.event_type = 'doctor_profile_claimed'
                    THEN d.lucy_status::text END
           ) ORDER BY c.occurred_at, c.id), '[]'::jsonb)
    INTO v_rows
    FROM claimed c
    LEFT JOIN public.doctor_affiliation_requests r ON r.id = c.subject_request_id
    LEFT JOIN public.specialties rs ON rs.id = r.specialty_id
    LEFT JOIN public.doctors     d  ON d.id  = c.subject_doctor_id
    LEFT JOIN public.specialties ds ON ds.id = d.specialty_id
    LEFT JOIN public.profiles    p  ON p.id  = d.profile_id;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$batch$;

REVOKE ALL ON FUNCTION public.notify_owner_claim_batch(int, interval, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_owner_claim_batch(int, interval, interval) FROM anon;
REVOKE ALL ON FUNCTION public.notify_owner_claim_batch(int, interval, interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.notify_owner_claim_batch(int, interval, interval) TO service_role;

-- ─── 7. Resultado del envío ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_owner_mark_result(
  p_id                  uuid,
  p_status              text,
  p_provider_message_id text DEFAULT NULL,
  p_error_code          text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $mark$
DECLARE
  v_hit int;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('sent', 'failed') THEN
    RAISE EXCEPTION 'Estado no admitido: %', COALESCE(p_status, '(null)')
      USING ERRCODE = 'P0150';
  END IF;

  IF p_status = 'sent' THEN
    -- Desde CUALQUIER estado que no sea ya `sent`. Registrar una entrega
    -- confirmada nunca puede fallar por una carrera: perder ese dato dejaría
    -- la fila reintentable y arriesgaría un correo duplicado.
    UPDATE public.doctor_owner_notifications
       SET status              = 'sent',
           sent_at             = now(),
           provider_message_id = NULLIF(btrim(COALESCE(p_provider_message_id, '')), ''),
           last_error_code     = NULL,
           updated_at          = now()
     WHERE id = p_id
       AND status <> 'sent';
  ELSE
    -- Solo desde `sending`: si otra invocación ya la retomó, no la pisamos.
    UPDATE public.doctor_owner_notifications
       SET status          = 'failed',
           last_error_code  = LEFT(NULLIF(btrim(COALESCE(p_error_code, '')), ''), 64),
           updated_at       = now()
     WHERE id = p_id
       AND status = 'sending';
  END IF;

  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit = 0 THEN
    -- NO es excepción a propósito: si esto abortara, la Edge Function trataría
    -- como fallido un envío que quizá ya salió, y el reintento duplicaría.
    RAISE WARNING 's7_80: notify_owner_mark_result sin efecto (id=%, status=%)', p_id, p_status;
  END IF;
END;
$mark$;

REVOKE ALL ON FUNCTION public.notify_owner_mark_result(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_owner_mark_result(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.notify_owner_mark_result(uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.notify_owner_mark_result(uuid, text, text, text) TO service_role;

-- ─── 8. POST — verificación ─────────────────────────────────
DO $post$
DECLARE
  v_src   text;
  v_count int;
BEGIN
  -- 8.1 Outbox y su blindaje
  IF to_regclass('public.doctor_owner_notifications') IS NULL THEN
    RAISE EXCEPTION 'POST falló: no existe la outbox';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_class WHERE oid = 'public.doctor_owner_notifications'::regclass AND relrowsecurity;
  IF v_count <> 1 THEN RAISE EXCEPTION 'POST falló: RLS no está activa en la outbox'; END IF;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'doctor_owner_notifications' AND cmd <> 'SELECT';
  IF v_count <> 0 THEN RAISE EXCEPTION 'POST falló: la outbox tiene policies de escritura'; END IF;

  SELECT count(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'doctor_owner_notifications'
    AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
    AND privilege_type <> 'SELECT';
  IF v_count <> 0 THEN RAISE EXCEPTION 'POST falló: hay privilegios de escritura sobre la outbox'; END IF;

  SELECT count(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'doctor_owner_notifications'
    AND grantee = 'anon';
  IF v_count <> 0 THEN RAISE EXCEPTION 'POST falló: anon tiene acceso a la outbox'; END IF;

  -- service_role puede LEER (diagnóstico) pero nunca escribir.
  SELECT count(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name = 'doctor_owner_notifications'
    AND grantee = 'service_role' AND privilege_type <> 'SELECT';
  IF v_count <> 0 THEN RAISE EXCEPTION 'POST falló: service_role puede escribir en la outbox'; END IF;

  -- 8.2 Trigger de afiliación: existe y es solo AFTER INSERT
  SELECT count(*) INTO v_count
  FROM pg_trigger
  WHERE tgrelid = 'public.doctor_affiliation_requests'::regclass
    AND tgname = 'trg_notify_owner_affiliation' AND NOT tgisinternal;
  IF v_count <> 1 THEN RAISE EXCEPTION 'POST falló: falta trg_notify_owner_affiliation'; END IF;

  SELECT count(*) INTO v_count
  FROM pg_trigger
  WHERE tgrelid = 'public.doctor_affiliation_requests'::regclass
    AND tgname = 'trg_notify_owner_affiliation'
    AND (tgtype & 4) = 4   -- INSERT
    AND (tgtype & 8) = 0   -- sin DELETE
    AND (tgtype & 16) = 0; -- sin UPDATE
  IF v_count <> 1 THEN RAISE EXCEPTION 'POST falló: el trigger no es exclusivamente AFTER INSERT'; END IF;

  -- 8.3 El claim quedó con el enqueue Y conserva sus invariantes
  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public.claim_doctor_profile(uuid, text, text)'::regprocedure;

  IF position('_enqueue_doctor_owner_notification' in v_src) = 0 THEN
    RAISE EXCEPTION 'POST falló: claim_doctor_profile no encola el aviso';
  END IF;
  IF position('doctor_credentials' in v_src) = 0
     OR position('P0003' in v_src) = 0
     OR position('tos_accepted_at' in v_src) = 0
     OR position('clinic_members' in v_src) = 0
     OR position('audit_log' in v_src) = 0 THEN
    RAISE EXCEPTION 'POST falló: claim_doctor_profile perdió alguna invariante de s7_64';
  END IF;

  -- 8.4 Guarda: NO se tocó el universo compartido por listado y export
  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public.admin_list_doctors(text, boolean, boolean, lucy_status, int, int)'::regprocedure;
  IF v_src IS NOT NULL AND position('doctor_owner_notifications' in v_src) > 0 THEN
    RAISE EXCEPTION 'POST falló: admin_list_doctors quedó contaminada';
  END IF;

  -- 8.5 Ventana de idempotencia: el techo de 23 h no se puede saltar
  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public.notify_owner_claim_batch(int, interval, interval)'::regprocedure;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'POST falló: notify_owner_claim_batch no tiene la firma con ventana';
  END IF;
  IF position('interval ''23 hours''' in v_src) = 0 OR position('LEAST(' in v_src) = 0 THEN
    RAISE EXCEPTION 'POST falló: falta el techo de 23 h de la ventana de idempotencia';
  END IF;
  IF position('idem_window_expired' in v_src) = 0 THEN
    RAISE EXCEPTION 'POST falló: no se marca idem_window_expired fuera de ventana';
  END IF;

  -- La firma vieja (sin ventana) NO debe sobrevivir: quedaría otorgada a
  -- service_role y permitiría drenar sin el techo.
  IF to_regprocedure('public.notify_owner_claim_batch(int, interval)') IS NOT NULL THEN
    RAISE EXCEPTION 'POST falló: sobrevive la firma sin ventana de idempotencia';
  END IF;

  -- 8.6 `pg_net` — informativo, NO bloqueante
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE WARNING 's7_80: pg_net NO está instalada. La outbox encolará correctamente, '
                  'pero NADA la drenará hasta habilitar Database Webhooks y crear la '
                  'webhook. Es el estado esperado en el paso 1 del rollout.';
  END IF;

  RAISE NOTICE 's7_80 POST: OK';
END $post$;
