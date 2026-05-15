-- ═══════════════════════════════════════════════════════════
-- Migración S6-01: Calificación y reputación médica (Fase A)
-- ═══════════════════════════════════════════════════════════
-- Capa de datos del módulo de reputación. NO incluye UI.
--
-- Componentes:
--   1. Extiende `reviews` con 6 criterios + NPS + promedio ponderado
--   2. Tabla `review_tokens` (link único, 1 uso, vence 7 días)
--   3. Trigger: al pasar una cita a 'atendida' genera el token
--   4. RPC submit_review(token, ...) — canje público sin login
--   5. RPC get_review_link(appointment_id) — el doctor copia el link
--   6. Vista doctor_rating_stats — agregado público (ventana 12 meses)
--   7. RLS: tablas bloqueadas; acceso solo vía RPC/vista
--
-- Pesos del promedio ponderado (suman 100):
--   Trato 20 · Claridad 20 · Confianza 20 · Escucha 15 · Satisfacción 15 · Puntualidad 10
--
-- Reglas (decididas 2026-05-15):
--   - Token: 1 uso, vence 7 días, solo citas nuevas (sin backfill)
--   - Etiquetas: criterio ≥4.5 y ≥10 reseñas
--   - Ranking "Mejor valorados": score ≥4.7 y ≥20 reseñas
--   - Ventana pública: últimos 12 meses
--   - NPS: interno (no se expone en la vista pública)
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Extender reviews ────────────────────────────────────
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS rating_punctuality   smallint CHECK (rating_punctuality   BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS rating_treatment     smallint CHECK (rating_treatment     BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS rating_clarity       smallint CHECK (rating_clarity       BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS rating_listening     smallint CHECK (rating_listening     BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS rating_confidence    smallint CHECK (rating_confidence    BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS rating_satisfaction  smallint CHECK (rating_satisfaction  BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS nps                  smallint CHECK (nps BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS submitted_at         timestamptz;

-- `rating` (ya existía) pasa a ser el promedio ponderado calculado al insertar.
-- Una sola reseña por cita.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_appointment_unique
  ON reviews(appointment_id)
  WHERE appointment_id IS NOT NULL;

-- Índice para recencia (ventana 12 meses por médico)
CREATE INDEX IF NOT EXISTS idx_reviews_doctor_submitted
  ON reviews(doctor_id, submitted_at);

-- ─── 2. Tabla review_tokens ─────────────────────────────────
CREATE TABLE IF NOT EXISTS review_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  uuid NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_tokens_token
  ON review_tokens(token)
  WHERE used_at IS NULL;

-- ─── 3. Trigger: generar token al pasar cita a 'atendida' ───
-- Se dispara solo cuando status_id cambia al estado cuyo name = 'atendida'.
-- Idempotente: si ya hay token para esa cita, no hace nada.
CREATE OR REPLACE FUNCTION generate_review_token()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  atendida_id uuid;
BEGIN
  SELECT id INTO atendida_id
  FROM appointment_statuses
  WHERE name = 'atendida'
  LIMIT 1;

  IF atendida_id IS NULL THEN
    RETURN NEW; -- no existe el estado; no bloquear la transición
  END IF;

  IF NEW.status_id = atendida_id
     AND (OLD.status_id IS DISTINCT FROM NEW.status_id) THEN
    INSERT INTO review_tokens (appointment_id, token, expires_at)
    VALUES (
      NEW.id,
      encode(gen_random_bytes(24), 'hex'),
      now() + interval '7 days'
    )
    ON CONFLICT (appointment_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_review_token ON appointments;
CREATE TRIGGER trg_generate_review_token
  AFTER UPDATE OF status_id ON appointments
  FOR EACH ROW EXECUTE FUNCTION generate_review_token();

-- ─── 4. RPC submit_review ───────────────────────────────────
-- Canje público (SIN login). Valida token, calcula promedio ponderado,
-- inserta la reseña y quema el token. Una sola vez por cita.
CREATE OR REPLACE FUNCTION submit_review(
  p_token         text,
  p_punctuality   smallint,
  p_treatment     smallint,
  p_clarity       smallint,
  p_listening     smallint,
  p_confidence    smallint,
  p_satisfaction  smallint,
  p_nps           smallint DEFAULT NULL,
  p_comment       text     DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tok           RECORD;
  appt          RECORD;
  atendida_id   uuid;
  weighted      numeric;
BEGIN
  SELECT * INTO tok FROM review_tokens WHERE token = p_token;
  IF tok IS NULL THEN
    RAISE EXCEPTION 'Link inválido';
  END IF;
  IF tok.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta encuesta ya fue respondida';
  END IF;
  IF tok.expires_at < now() THEN
    RAISE EXCEPTION 'El link expiró';
  END IF;

  SELECT a.*, s.name AS status_name
  INTO appt
  FROM appointments a
  JOIN appointment_statuses s ON s.id = a.status_id
  WHERE a.id = tok.appointment_id;

  IF appt IS NULL OR appt.status_name <> 'atendida' THEN
    RAISE EXCEPTION 'La cita no está en estado atendida';
  END IF;

  -- Validar rangos (defensa extra al CHECK de columna)
  IF p_punctuality  NOT BETWEEN 1 AND 5
  OR p_treatment    NOT BETWEEN 1 AND 5
  OR p_clarity      NOT BETWEEN 1 AND 5
  OR p_listening    NOT BETWEEN 1 AND 5
  OR p_confidence   NOT BETWEEN 1 AND 5
  OR p_satisfaction NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Calificaciones fuera de rango (1-5)';
  END IF;

  -- Promedio ponderado: Trato 20 · Claridad 20 · Confianza 20 · Escucha 15 · Satisf 15 · Puntual 10
  weighted := round(
      (p_treatment    * 0.20)
    + (p_clarity      * 0.20)
    + (p_confidence   * 0.20)
    + (p_listening    * 0.15)
    + (p_satisfaction * 0.15)
    + (p_punctuality  * 0.10)
  , 2);

  INSERT INTO reviews (
    appointment_id, doctor_id, patient_profile_id,
    rating_punctuality, rating_treatment, rating_clarity,
    rating_listening, rating_confidence, rating_satisfaction,
    nps, comment, rating, is_visible, submitted_at
  ) VALUES (
    appt.id, appt.doctor_id, appt.patient_id,
    p_punctuality, p_treatment, p_clarity,
    p_listening, p_confidence, p_satisfaction,
    p_nps, NULLIF(btrim(p_comment), ''), weighted, true, now()
  )
  ON CONFLICT (appointment_id) DO NOTHING;

  UPDATE review_tokens SET used_at = now() WHERE id = tok.id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_review(
  text, smallint, smallint, smallint, smallint, smallint, smallint, smallint, text
) TO anon, authenticated;

-- ─── 5. RPC get_review_link ─────────────────────────────────
-- El doctor/asistente de la clínica obtiene el token de una cita suya
-- para copiar el link y enviarlo manualmente por WhatsApp.
CREATE OR REPLACE FUNCTION get_review_link(p_appointment_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid       uuid;
  appt      RECORD;
  tok_text  text;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT a.id, a.clinic_id, a.doctor_id
  INTO appt
  FROM appointments a
  WHERE a.id = p_appointment_id;

  IF appt IS NULL THEN
    RAISE EXCEPTION 'Cita no encontrada';
  END IF;

  -- El caller debe ser el doctor de la cita o miembro de la clínica
  IF NOT (
    EXISTS (SELECT 1 FROM doctors d WHERE d.id = appt.doctor_id AND d.profile_id = uid)
    OR is_clinic_member(appt.clinic_id)
  ) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta cita';
  END IF;

  SELECT token INTO tok_text FROM review_tokens WHERE appointment_id = p_appointment_id;
  RETURN tok_text; -- NULL si la cita aún no está atendida (sin token)
END;
$$;

GRANT EXECUTE ON FUNCTION get_review_link(uuid) TO authenticated;

-- ─── 6. Vista doctor_rating_stats ───────────────────────────
-- Agregado público. Solo reseñas visibles de los últimos 12 meses.
-- score_adjusted = (C·m + Σrating) / (C + n)  con C=10, m=4.0 (bayesiano).
CREATE OR REPLACE VIEW doctor_rating_stats AS
WITH win AS (
  SELECT *
  FROM reviews
  WHERE is_visible = true
    AND submitted_at >= now() - interval '12 months'
)
SELECT
  d.id AS doctor_id,
  d.specialty_id,
  COALESCE(cnt.n, 0)                                           AS n_reviews,
  CASE WHEN COALESCE(cnt.n,0) = 0 THEN NULL
       ELSE round((10 * 4.0 + COALESCE(cnt.sum_rating,0)) / (10 + cnt.n), 2)
  END                                                          AS score_adjusted,
  round(avg_punctuality, 2)   AS avg_punctuality,
  round(avg_treatment, 2)     AS avg_treatment,
  round(avg_clarity, 2)       AS avg_clarity,
  round(avg_listening, 2)     AS avg_listening,
  round(avg_confidence, 2)    AS avg_confidence,
  round(avg_satisfaction, 2)  AS avg_satisfaction,
  -- ≥4.7 y ≥20 reseñas → elegible para ranking "Mejor valorados"
  (COALESCE(cnt.n,0) >= 20
   AND round((10 * 4.0 + COALESCE(cnt.sum_rating,0)) / (10 + NULLIF(cnt.n,0)), 2) >= 4.7
  )                                                            AS is_top_rated
FROM doctors d
LEFT JOIN LATERAL (
  SELECT
    count(*)                    AS n,
    sum(rating)                 AS sum_rating,
    avg(rating_punctuality)     AS avg_punctuality,
    avg(rating_treatment)       AS avg_treatment,
    avg(rating_clarity)         AS avg_clarity,
    avg(rating_listening)       AS avg_listening,
    avg(rating_confidence)      AS avg_confidence,
    avg(rating_satisfaction)    AS avg_satisfaction
  FROM win
  WHERE win.doctor_id = d.id
) cnt ON true;

GRANT SELECT ON doctor_rating_stats TO anon, authenticated;

-- ─── 7. RLS ─────────────────────────────────────────────────
-- Tablas bloqueadas: acceso solo vía RPC (SECURITY DEFINER) y la vista.
-- Admin usa service_role (bypassa RLS) vía Supabase SQL — trazabilidad Sprint 6.
ALTER TABLE reviews        ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_tokens  ENABLE ROW LEVEL SECURITY;
-- Sin políticas permisivas: anon/authenticated no acceden directo a las filas.
-- (Los comentarios anónimos para la vista médica se sirven en Fase F vía RPC.)
