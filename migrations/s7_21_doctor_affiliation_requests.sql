-- ═══════════════════════════════════════════════════════════
-- Migración S7-21: Doctor Affiliation Requests (Afiliación Fase 1)
-- ═══════════════════════════════════════════════════════════
-- Tabla de leads para médicos que quieren afiliarse a LucyCare y NO
-- existen aún en el directorio (no fueron importados via
-- import-doctors.mjs).
--
-- Diferencia con "Reclamar perfil" (PR #32 + #50): aquel asume que el
-- médico YA EXISTE en `doctors` con lucy_status='listed_only'. Este
-- flujo captura intent + datos básicos para que LucyAdmin valide y
-- después (Fase 2) cree el doctor.
--
-- Reglas cerradas Q1-Q10 (ver docs/PLAN_AFILIACION_MEDICO.md):
--   • Mínimo absoluto = nombre + phone + LOPD (Lectura A).
--   • License/JVPM recomendada pero no bloqueante. Lead sin license
--     entra con incomplete=true (columna GENERATED).
--   • Rate limit: UNIQUE phone normalizado activo + 1 req/IP/24h.
--   • Consentimiento LOPD obligatorio (consent_accepted_at + version).
--   • Sin auto-creación de doctor/profile/clinic en Fase 1.
--   • RLS estricto: solo service_role + is_admin() leen. Anon solo
--     INSERT vía RPC.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Enum de estado ──────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'affiliation_status') THEN
    CREATE TYPE affiliation_status AS ENUM (
      'pending',     -- recién creado, esperando triage admin
      'in_review',   -- admin lo tomó, validando
      'approved',    -- admin validó. En Fase 1 no crea doctor, solo marca.
      'rejected',    -- admin descartó
      'expired'      -- TTL futuro; no se usa todavía en MVP
    );
  END IF;
END $$;

-- ─── 2. Tabla principal ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS doctor_affiliation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Datos del médico (obligatorios mínimos — Lectura A)
  full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
  phone text NOT NULL CHECK (length(btrim(phone)) > 0),
  phone_normalized text NOT NULL CHECK (length(phone_normalized) >= 7),

  -- Datos del médico (opcionales)
  email text,
  specialty_id uuid REFERENCES specialties(id) ON DELETE SET NULL,
  specialty_other text,
  license_number text,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  municipality_id uuid REFERENCES municipalities(id) ON DELETE SET NULL,
  address_line text,
  clinic_name text,
  message text CHECK (length(coalesce(message, '')) <= 500),

  -- Consentimiento LOPD (obligatorio)
  consent_accepted_at timestamptz NOT NULL,
  consent_version text NOT NULL,

  -- Forense / rate limit
  ip_address inet,
  user_agent text,

  -- Workflow admin
  status affiliation_status NOT NULL DEFAULT 'pending',
  admin_notes text,
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,

  -- Vinculación Fase 2 (NULL en Fase 1; el admin marca approved sin crear doctor)
  doctor_id uuid REFERENCES doctors(id) ON DELETE SET NULL,
  clinic_id uuid REFERENCES clinics(id) ON DELETE SET NULL,

  -- Indica si el lead vino sin info importante (license, email o specialty).
  -- Admin debe contactar para completar antes de aprobar/crear doctor.
  incomplete boolean GENERATED ALWAYS AS (
    coalesce(btrim(license_number), '') = ''
    OR coalesce(btrim(email), '') = ''
    OR (specialty_id IS NULL AND coalesce(btrim(specialty_other), '') = '')
  ) STORED
);

-- ─── 3. Índices ─────────────────────────────────────────────
-- UNIQUE: solo un lead activo por phone normalizado.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_affiliation_phone
  ON doctor_affiliation_requests (phone_normalized)
  WHERE status NOT IN ('rejected', 'expired');

-- UNIQUE compuesto: si hay email+license, no permitir duplicado activo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_affiliation_email_license
  ON doctor_affiliation_requests (
    lower(email),
    upper(regexp_replace(license_number, '\s', '', 'g'))
  )
  WHERE status NOT IN ('rejected', 'expired')
    AND email IS NOT NULL
    AND license_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_affiliation_status_created
  ON doctor_affiliation_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliation_created
  ON doctor_affiliation_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliation_ip_recent
  ON doctor_affiliation_requests (ip_address, created_at)
  WHERE ip_address IS NOT NULL;

-- ─── 4. Trigger updated_at ──────────────────────────────────
DROP TRIGGER IF EXISTS trg_affiliation_updated_at ON doctor_affiliation_requests;
CREATE TRIGGER trg_affiliation_updated_at
  BEFORE UPDATE ON doctor_affiliation_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── 5. Trigger audit_log ───────────────────────────────────
CREATE OR REPLACE FUNCTION audit_doctor_affiliation_requests_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action  audit_action;
  v_old     jsonb;
  v_new     jsonb;
  v_user_id uuid;
BEGIN
  -- auth.uid() es NULL en el INSERT desde anon (vía RPC).
  -- Caemos al ID del propio lead para tener actor identificable.
  v_user_id := COALESCE(auth.uid(), CASE WHEN TG_OP <> 'DELETE' THEN NEW.id ELSE OLD.id END);

  IF TG_OP = 'INSERT' THEN
    v_action := 'insert'::audit_action;
    v_old    := NULL;
    v_new    := jsonb_build_object(
      'status',            NEW.status,
      'incomplete',        NEW.incomplete,
      'has_email',         NEW.email IS NOT NULL,
      'has_license',       NEW.license_number IS NOT NULL,
      'has_specialty',     NEW.specialty_id IS NOT NULL OR coalesce(btrim(NEW.specialty_other), '') <> '',
      'edited_via',        'submit_affiliation_request',
      'consent_version',   NEW.consent_version
    );
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update'::audit_action;
    v_old    := jsonb_build_object('status', OLD.status, 'admin_notes', OLD.admin_notes);
    v_new    := jsonb_build_object(
      'status',       NEW.status,
      'admin_notes',  NEW.admin_notes,
      'reviewed_by',  NEW.reviewed_by,
      'doctor_id',    NEW.doctor_id,
      'edited_via',   'admin'
    );
  ELSE -- DELETE
    v_action := 'delete'::audit_action;
    v_old    := jsonb_build_object('status', OLD.status);
    v_new    := NULL;
  END IF;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (v_user_id, v_action, 'doctor_affiliation_requests',
          CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
          v_old, v_new);

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_doctor_affiliation_requests ON doctor_affiliation_requests;
CREATE TRIGGER trg_audit_doctor_affiliation_requests
  AFTER INSERT OR UPDATE OR DELETE ON doctor_affiliation_requests
  FOR EACH ROW EXECUTE FUNCTION audit_doctor_affiliation_requests_fn();

-- ─── 6. RLS estricto ────────────────────────────────────────
-- Anon/authenticated/doctor: NO leen NI escriben directo. Toda
-- interacción es vía RPCs SECURITY DEFINER gateadas.
-- service_role tiene full access por convención.
ALTER TABLE doctor_affiliation_requests ENABLE ROW LEVEL SECURITY;

-- Sin policies = nadie puede SELECT/INSERT/UPDATE/DELETE excepto
-- service_role. Las RPCs corren como definer (postgres) y pueden
-- bypass RLS para hacer su trabajo.
REVOKE ALL ON doctor_affiliation_requests FROM anon;
REVOKE ALL ON doctor_affiliation_requests FROM authenticated;

-- ─── 7. RPC pública: submit_affiliation_request ─────────────
-- Validaciones mínimas (Lectura A), rate limit por IP, UNIQUE por
-- phone normalizado. Respuesta genérica para evitar enumeración.
CREATE OR REPLACE FUNCTION submit_affiliation_request(
  p_full_name      text,
  p_phone          text,
  p_consent_version text,
  p_email          text DEFAULT NULL,
  p_specialty_id   uuid DEFAULT NULL,
  p_specialty_other text DEFAULT NULL,
  p_license_number text DEFAULT NULL,
  p_department_id  uuid DEFAULT NULL,
  p_municipality_id uuid DEFAULT NULL,
  p_address_line   text DEFAULT NULL,
  p_clinic_name    text DEFAULT NULL,
  p_message        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_norm text;
  v_ip inet;
  v_ua text;
  v_recent_count int;
  v_headers jsonb;
BEGIN
  -- Validaciones obligatorias (Lectura A: name + phone + consent)
  IF coalesce(btrim(p_full_name), '') = '' THEN
    RAISE EXCEPTION 'Nombre requerido' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(btrim(p_phone), '') = '' THEN
    RAISE EXCEPTION 'Teléfono requerido' USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(btrim(p_consent_version), '') = '' THEN
    RAISE EXCEPTION 'Aceptación de privacidad requerida' USING ERRCODE = 'P0003';
  END IF;

  v_phone_norm := regexp_replace(p_phone, '\D', '', 'g');
  IF length(v_phone_norm) < 7 THEN
    RAISE EXCEPTION 'Teléfono inválido' USING ERRCODE = 'P0002';
  END IF;

  -- Headers para forense + rate limit. current_setting puede no estar
  -- disponible según contexto; usamos try/catch implícito (true = silent).
  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;

  IF v_headers IS NOT NULL THEN
    -- x-forwarded-for puede venir como lista "ip1, ip2"; tomamos la primera.
    v_ip := nullif(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1), '')::inet;
    v_ua := v_headers->>'user-agent';
  END IF;

  -- Rate limit: máx 1 solicitud por IP en últimas 24h.
  -- Si no podemos identificar IP, no aplicamos (mejor permitir que
  -- bloquear). Loguear no es crítico — ya queda en audit_log el INSERT.
  IF v_ip IS NOT NULL THEN
    SELECT count(*) INTO v_recent_count
    FROM doctor_affiliation_requests
    WHERE ip_address = v_ip
      AND created_at > now() - interval '24 hours';
    IF v_recent_count >= 1 THEN
      RAISE EXCEPTION
        'Ya recibimos una solicitud reciente desde esta conexión. Si necesitás contactarnos, escribinos por WhatsApp.'
        USING ERRCODE = 'P0010';
    END IF;
  END IF;

  -- INSERT con manejo idempotente: si viola UNIQUE por phone activo
  -- (ya hay lead pending/in_review/approved con ese phone), respondemos
  -- success: true para no filtrar enumeración. Idem email+license.
  BEGIN
    INSERT INTO doctor_affiliation_requests (
      full_name, phone, phone_normalized, email,
      specialty_id, specialty_other, license_number,
      department_id, municipality_id, address_line, clinic_name, message,
      consent_accepted_at, consent_version,
      ip_address, user_agent, status
    ) VALUES (
      btrim(p_full_name),
      btrim(p_phone),
      v_phone_norm,
      nullif(btrim(lower(p_email)), ''),
      p_specialty_id,
      nullif(btrim(p_specialty_other), ''),
      nullif(btrim(upper(p_license_number)), ''),
      p_department_id,
      p_municipality_id,
      nullif(btrim(p_address_line), ''),
      nullif(btrim(p_clinic_name), ''),
      nullif(btrim(p_message), ''),
      now(),
      btrim(p_consent_version),
      v_ip,
      v_ua,
      'pending'
    );
  EXCEPTION WHEN unique_violation THEN
    -- Lead activo duplicado: responder success genérico (no filtra).
    RETURN jsonb_build_object('success', true);
  END;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_affiliation_request(
  text, text, text, text, uuid, text, text, uuid, uuid, text, text, text
) TO anon, authenticated;

-- ─── 8. RPCs admin ──────────────────────────────────────────

-- 8.1 Listar leads con filtros + paginación
CREATE OR REPLACE FUNCTION admin_list_affiliation_requests(
  p_status      affiliation_status DEFAULT NULL,
  p_incomplete  boolean DEFAULT NULL,
  p_search      text DEFAULT NULL,
  p_limit       int DEFAULT 25,
  p_offset      int DEFAULT 0
) RETURNS TABLE (
  id                 uuid,
  created_at         timestamptz,
  updated_at         timestamptz,
  full_name          text,
  phone              text,
  phone_normalized   text,
  email              text,
  specialty_id       uuid,
  specialty_name     text,
  specialty_other    text,
  license_number     text,
  department_name    text,
  municipality_name  text,
  address_line       text,
  clinic_name        text,
  message            text,
  status             affiliation_status,
  incomplete         boolean,
  admin_notes        text,
  reviewed_at        timestamptz,
  reviewed_by_name   text,
  doctor_id          uuid,
  clinic_id          uuid,
  total_count        bigint
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search_norm text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;

  v_search_norm := nullif(btrim(lower(coalesce(p_search, ''))), '');

  RETURN QUERY
  WITH filtered AS (
    SELECT r.*
    FROM doctor_affiliation_requests r
    WHERE (p_status IS NULL OR r.status = p_status)
      AND (p_incomplete IS NULL OR r.incomplete = p_incomplete)
      AND (
        v_search_norm IS NULL
        OR lower(r.full_name) LIKE '%' || v_search_norm || '%'
        OR lower(coalesce(r.email, '')) LIKE '%' || v_search_norm || '%'
        OR r.phone_normalized LIKE '%' || regexp_replace(v_search_norm, '\D', '', 'g') || '%'
        OR lower(coalesce(r.license_number, '')) LIKE '%' || v_search_norm || '%'
      )
  ),
  counted AS (
    SELECT count(*) AS total FROM filtered
  )
  SELECT
    f.id, f.created_at, f.updated_at,
    f.full_name, f.phone, f.phone_normalized, f.email,
    f.specialty_id, s.name AS specialty_name, f.specialty_other,
    f.license_number,
    dep.name AS department_name,
    mun.name AS municipality_name,
    f.address_line, f.clinic_name, f.message,
    f.status, f.incomplete,
    f.admin_notes, f.reviewed_at, rp.full_name AS reviewed_by_name,
    f.doctor_id, f.clinic_id,
    counted.total AS total_count
  FROM filtered f
  CROSS JOIN counted
  LEFT JOIN specialties s    ON s.id = f.specialty_id
  LEFT JOIN departments dep  ON dep.id = f.department_id
  LEFT JOIN municipalities mun ON mun.id = f.municipality_id
  LEFT JOIN profiles rp      ON rp.id = f.reviewed_by
  ORDER BY f.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_list_affiliation_requests(
  affiliation_status, boolean, text, int, int
) TO authenticated;

-- 8.2 Marcar in_review
CREATE OR REPLACE FUNCTION admin_mark_in_review(
  p_id    uuid,
  p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current affiliation_status;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;

  SELECT status INTO v_current FROM doctor_affiliation_requests WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
  IF v_current NOT IN ('pending', 'in_review') THEN
    RAISE EXCEPTION 'No se puede mover a in_review desde el estado actual (%)', v_current;
  END IF;

  UPDATE doctor_affiliation_requests
     SET status      = 'in_review',
         admin_notes = COALESCE(NULLIF(btrim(p_notes), ''), admin_notes),
         reviewed_by = auth.uid(),
         reviewed_at = COALESCE(reviewed_at, now())
   WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION admin_mark_in_review(uuid, text) TO authenticated;

-- 8.3 Rechazar (obliga admin_notes)
CREATE OR REPLACE FUNCTION admin_reject_affiliation_request(
  p_id    uuid,
  p_notes text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current affiliation_status;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF coalesce(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'Nota interna obligatoria para rechazar';
  END IF;

  SELECT status INTO v_current FROM doctor_affiliation_requests WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
  IF v_current IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'No se puede rechazar desde el estado actual (%)', v_current;
  END IF;

  UPDATE doctor_affiliation_requests
     SET status      = 'rejected',
         admin_notes = btrim(p_notes),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION admin_reject_affiliation_request(uuid, text) TO authenticated;

-- 8.4 Marcar aprobado SIN crear doctor (Fase 1).
-- En Fase 2 se agregará admin_approve_and_create_doctor que sí crea
-- el doctors row. Por ahora aprobar es una señal interna para que
-- admin sepa "ya validé, ahora me toca crear el doctor manualmente
-- y avisar al médico" (Q3 = comunicación manual).
CREATE OR REPLACE FUNCTION admin_mark_approved_pending_creation(
  p_id    uuid,
  p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current affiliation_status;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;

  SELECT status INTO v_current FROM doctor_affiliation_requests WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
  IF v_current NOT IN ('pending', 'in_review') THEN
    RAISE EXCEPTION 'No se puede aprobar desde el estado actual (%)', v_current;
  END IF;

  UPDATE doctor_affiliation_requests
     SET status      = 'approved',
         admin_notes = COALESCE(NULLIF(btrim(p_notes), ''), admin_notes),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION admin_mark_approved_pending_creation(uuid, text) TO authenticated;

-- 8.5 Conteo de pendientes (para badge en sidebar)
CREATE OR REPLACE FUNCTION admin_count_affiliation_pending()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RETURN 0; END IF;
  RETURN (SELECT count(*)::int FROM doctor_affiliation_requests WHERE status = 'pending');
END;
$$;
GRANT EXECUTE ON FUNCTION admin_count_affiliation_pending() TO authenticated;

-- ─── 9. Verificación final ──────────────────────────────────
-- (Opcional) Comprobar que las RPCs existen y los grants están OK.
-- Se complementa con scripts/check-s7_21.mjs.
