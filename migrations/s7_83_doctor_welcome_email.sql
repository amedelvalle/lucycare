-- ═══════════════════════════════════════════════════════════════════════
-- s7_83 · DOCTOR-WELCOME-EMAIL-P0
-- Correo de bienvenida al médico, disparado MANUALMENTE por el owner desde
-- LucyAdmin después de aprobar y publicar el perfil.
--
-- NO hay trigger, ni outbox, ni pg_net, ni wakeup, ni cron, ni Vault nuevo:
-- la publicación NO envía nada. El owner pulsa un botón y una Edge Function
-- autenticada con SU sesión hace el envío. Esta migración solo aporta el
-- estado persistente y las tres RPCs que lo gobiernan.
--
-- NO toca s7_80/s7_81/s7_82 (aviso al owner), ni el claim, ni la publicación,
-- ni admin_list_affiliation_requests.
--
-- Códigos de error: P0160–P0163.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Estado de la bienvenida, sobre la solicitud de afiliación ───────
-- Se guarda ACÁ y no en una outbox nueva: hay como mucho UN correo por
-- solicitud, así que la solicitud es su propio registro. Sin PII duplicada:
-- el correo, el nombre y el slug se resuelven por JOIN en cada llamada.

ALTER TABLE public.doctor_affiliation_requests
  ADD COLUMN IF NOT EXISTS welcome_status           text NOT NULL DEFAULT 'not_sent',
  -- Cuándo se presentó la Idempotency-Key a Resend por PRIMERA vez. Decide si
  -- un reintento sigue siendo seguro: el proveedor la olvida a las 24 h. Se
  -- fija una vez y NUNCA se reescribe.
  ADD COLUMN IF NOT EXISTS welcome_first_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS welcome_last_attempt_at  timestamptz,
  ADD COLUMN IF NOT EXISTS welcome_sent_at          timestamptz,
  -- Código corto y normalizado. NUNCA el cuerpo del error del proveedor, que
  -- puede arrastrar direcciones.
  ADD COLUMN IF NOT EXISTS welcome_last_error_code  text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dar_welcome_status_chk') THEN
    ALTER TABLE public.doctor_affiliation_requests
      ADD CONSTRAINT dar_welcome_status_chk
      CHECK (welcome_status IN ('not_sent', 'sending', 'sent', 'failed'));
  END IF;

  -- FORMA de cada estado. Una fila enviada siempre dice cuándo.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dar_welcome_sent_shape') THEN
    ALTER TABLE public.doctor_affiliation_requests
      ADD CONSTRAINT dar_welcome_sent_shape
      CHECK (welcome_status <> 'sent'
             OR (welcome_sent_at IS NOT NULL AND welcome_first_attempt_at IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dar_welcome_sending_shape') THEN
    ALTER TABLE public.doctor_affiliation_requests
      ADD CONSTRAINT dar_welcome_sending_shape
      CHECK (welcome_status <> 'sending'
             OR (welcome_first_attempt_at IS NOT NULL AND welcome_last_attempt_at IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dar_welcome_failed_shape') THEN
    ALTER TABLE public.doctor_affiliation_requests
      ADD CONSTRAINT dar_welcome_failed_shape
      CHECK (welcome_status <> 'failed'
             OR btrim(coalesce(welcome_last_error_code, '')) <> '');
  END IF;

  -- El primer intento nunca puede ser posterior al último.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dar_welcome_attempt_order') THEN
    ALTER TABLE public.doctor_affiliation_requests
      ADD CONSTRAINT dar_welcome_attempt_order
      CHECK (welcome_first_attempt_at IS NULL
             OR welcome_last_attempt_at IS NULL
             OR welcome_first_attempt_at <= welcome_last_attempt_at);
  END IF;

  -- `not_sent` es el estado virgen: no puede arrastrar rastros de un envío.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dar_welcome_not_sent_shape') THEN
    ALTER TABLE public.doctor_affiliation_requests
      ADD CONSTRAINT dar_welcome_not_sent_shape
      CHECK (welcome_status <> 'not_sent'
             OR (welcome_sent_at IS NULL AND welcome_first_attempt_at IS NULL));
  END IF;
END $$;

COMMENT ON COLUMN public.doctor_affiliation_requests.welcome_first_attempt_at IS
  'Primera presentación de la Idempotency-Key a Resend. Se fija una vez y NUNCA '
  'se reescribe: fuera de la ventana de 23 h un reintento ya no está protegido '
  'contra duplicados y deja de permitirse.';

-- ─── 2. Ventanas de recuperación ───────────────────────────────────────
-- No hay reintentos automáticos. Un intento se puede RECLAMAR de nuevo, a
-- mano, solo dentro de la ventana segura del proveedor:
--
--   not_sent  → siempre.
--   failed    → si el PRIMER intento tiene menos de 23 h.
--   sending   → además, si el ÚLTIMO intento tiene más de 10 minutos (evita
--               pisar una petición todavía en vuelo).
--   sent      → nunca.
--
-- Pasadas las 23 h con resultado incierto NO se reenvía: Resend ya olvidó la
-- clave y un reintento mandaría un correo de verdad. Queda visible para que
-- el owner decida.

CREATE OR REPLACE FUNCTION public._welcome_email_claimable(
  p_status           text,
  p_first_attempt_at timestamptz,
  p_last_attempt_at  timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_status = 'not_sent' THEN true
    WHEN p_status = 'sent'     THEN false
    WHEN p_status NOT IN ('sending', 'failed') THEN false
    WHEN p_first_attempt_at IS NULL THEN false
    WHEN p_first_attempt_at <= now() - interval '23 hours' THEN false
    WHEN p_status = 'failed'  THEN true
    -- sending: solo si el último intento ya no puede estar en vuelo.
    ELSE p_last_attempt_at IS NOT NULL
         AND p_last_attempt_at <= now() - interval '10 minutes'
  END;
$$;

REVOKE ALL ON FUNCTION public._welcome_email_claimable(text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._welcome_email_claimable(text, timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public._welcome_email_claimable(text, timestamptz, timestamptz) FROM service_role;
GRANT EXECUTE ON FUNCTION public._welcome_email_claimable(text, timestamptz, timestamptz) TO authenticated;

-- ─── 3. Lectura de estado para la UI ───────────────────────────────────
-- Devuelve un MOTIVO en clave estable; el texto para el owner lo pone el
-- frontend. Acá no se inventa copy ni se filtra el error del proveedor.

CREATE OR REPLACE FUNCTION public.admin_welcome_email_state(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        record;
  v_reason text;
  v_can    boolean := false;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0160';
  END IF;

  SELECT ar.welcome_status, ar.welcome_first_attempt_at, ar.welcome_last_attempt_at,
         ar.welcome_sent_at, ar.welcome_last_error_code, ar.doctor_id,
         coalesce(btrim(ar.email), '') AS email,
         d.is_published, d.slug, d.lucy_status
    INTO r
    FROM doctor_affiliation_requests ar
    LEFT JOIN doctors d ON d.id = ar.doctor_id
   WHERE ar.id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0161';
  END IF;

  -- Orden de evaluación = orden de lo que el owner debe resolver primero.
  IF    r.welcome_status = 'sent'          THEN v_reason := 'already_sent';
  ELSIF r.doctor_id IS NULL                THEN v_reason := 'no_doctor';
  ELSIF r.email = ''                       THEN v_reason := 'no_email';
  ELSIF coalesce(r.is_published, false) IS NOT TRUE THEN v_reason := 'not_published';
  ELSIF r.slug IS NULL                     THEN v_reason := 'no_slug';
  ELSIF r.lucy_status <> 'listed_only'     THEN v_reason := 'already_claimed';
  ELSIF _welcome_email_claimable(r.welcome_status, r.welcome_first_attempt_at,
                                 r.welcome_last_attempt_at) THEN
    v_reason := 'ok';
    v_can    := true;
  ELSIF r.welcome_status = 'sending'
        AND r.welcome_first_attempt_at > now() - interval '23 hours' THEN
    v_reason := 'sending_recent';
  ELSE
    -- Fuera de la ventana de 23 h con resultado incierto.
    v_reason := 'needs_review';
  END IF;

  RETURN jsonb_build_object(
    'status',           r.welcome_status,
    'first_attempt_at', r.welcome_first_attempt_at,
    'last_attempt_at',  r.welcome_last_attempt_at,
    'sent_at',          r.welcome_sent_at,
    'last_error_code',  r.welcome_last_error_code,
    'can_send',         v_can,
    'reason',           v_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_welcome_email_state(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_welcome_email_state(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_welcome_email_state(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_welcome_email_state(uuid) TO authenticated;

-- ─── 4. Reclamo ATÓMICO + resolución del destinatario ──────────────────
-- Todos los gates viven en el WHERE de UN SOLO UPDATE. Eso es lo que cierra
-- el doble envío: el UPDATE toma bloqueo de fila, así que una segunda llamada
-- concurrente ESPERA y, al reevaluar, ve `welcome_status='sending'` ya
-- comiteado y casa 0 filas. No hace falta advisory lock.
--
-- El destinatario sale de `doctor_affiliation_requests.email` — el correo que
-- el médico escribió y que el owner revisó al aprobar. NUNCA de profiles.email:
-- en la rama `reuse_patient` de s7_42 el email del lead no se copia al perfil.

CREATE OR REPLACE FUNCTION public.admin_welcome_email_claim(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_name  text;
  v_slug  text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0160';
  END IF;

  UPDATE doctor_affiliation_requests ar
     SET welcome_status           = 'sending',
         welcome_first_attempt_at = coalesce(ar.welcome_first_attempt_at, now()),
         welcome_last_attempt_at  = now(),
         welcome_last_error_code  = NULL,
         updated_at               = now()
    FROM doctors d
   WHERE ar.id = p_request_id
     AND d.id  = ar.doctor_id
     AND coalesce(btrim(ar.email), '') <> ''
     AND d.is_published = true
     AND d.slug IS NOT NULL
     AND d.lucy_status = 'listed_only'
     AND _welcome_email_claimable(ar.welcome_status, ar.welcome_first_attempt_at,
                                  ar.welcome_last_attempt_at)
  RETURNING btrim(ar.email),
            -- Nombre del PERFIL publicado, que es el que ve el paciente y del
            -- que derivó el slug. La solicitud solo cubre el hueco.
            coalesce(nullif(btrim((SELECT p.full_name FROM profiles p
                                    WHERE p.id = d.profile_id)), ''),
                     btrim(ar.full_name)),
            d.slug
    INTO v_email, v_name, v_slug;

  IF NOT FOUND THEN
    -- No se pudo reclamar. El motivo exacto lo da la función de estado, que
    -- ya distingue gate faltante de ventana agotada.
    RETURN jsonb_build_object('ok', false)
           || jsonb_build_object('state', admin_welcome_email_state(p_request_id));
  END IF;

  RETURN jsonb_build_object(
    'ok',         true,
    'request_id', p_request_id,
    'email',      v_email,
    'name',       v_name,
    'slug',       v_slug
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_welcome_email_claim(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_welcome_email_claim(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_welcome_email_claim(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_welcome_email_claim(uuid) TO authenticated;

-- ─── 5. Resultado del envío ────────────────────────────────────────────
-- Solo transiciona desde 'sending': un resultado que llega para una fila que
-- ya no es suya (otra petición la retomó) NO pisa nada.

CREATE OR REPLACE FUNCTION public.admin_welcome_email_mark(
  p_request_id uuid,
  p_status     text,
  p_error_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0160';
  END IF;

  IF p_status NOT IN ('sent', 'failed') THEN
    RAISE EXCEPTION 'Estado inválido' USING ERRCODE = 'P0162';
  END IF;

  -- Código corto y acotado. Si llega cualquier otra cosa —un cuerpo de error
  -- del proveedor, por ejemplo— se sustituye por un genérico en vez de
  -- persistirlo: esta columna no es un buzón de texto libre.
  v_code := lower(btrim(coalesce(p_error_code, '')));
  IF p_status = 'failed' THEN
    IF v_code !~ '^[a-z0-9_]{1,40}$' THEN
      v_code := 'unknown_error';
    END IF;
  ELSE
    v_code := NULL;
  END IF;

  UPDATE doctor_affiliation_requests
     SET welcome_status          = p_status,
         welcome_sent_at         = CASE WHEN p_status = 'sent' THEN now() ELSE welcome_sent_at END,
         welcome_last_error_code = v_code,
         updated_at              = now()
   WHERE id = p_request_id
     AND welcome_status = 'sending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La bienvenida no está en curso' USING ERRCODE = 'P0163';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_welcome_email_mark(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_welcome_email_mark(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_welcome_email_mark(uuid, text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_welcome_email_mark(uuid, text, text) TO authenticated;
