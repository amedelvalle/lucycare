-- ═══════════════════════════════════════════════════════════
-- Migración S6-05: Fix ON CONFLICT en submit_review
-- ═══════════════════════════════════════════════════════════
-- s6_01 creó un índice único PARCIAL en reviews(appointment_id)
--   ... WHERE appointment_id IS NOT NULL
-- pero submit_review usa `ON CONFLICT (appointment_id) DO NOTHING`
-- sin el mismo predicado. Postgres no infiere un índice único
-- parcial → error:
--   "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification"
--
-- Fix: replicar el predicado en el ON CONFLICT. CREATE OR REPLACE,
-- idempotente. No toca índices ni datos.
-- ═══════════════════════════════════════════════════════════

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

  IF p_punctuality  NOT BETWEEN 1 AND 5
  OR p_treatment    NOT BETWEEN 1 AND 5
  OR p_clarity      NOT BETWEEN 1 AND 5
  OR p_listening    NOT BETWEEN 1 AND 5
  OR p_confidence   NOT BETWEEN 1 AND 5
  OR p_satisfaction NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Calificaciones fuera de rango (1-5)';
  END IF;

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
  -- Predicado replicado para que infiera el índice único parcial de s6_01
  ON CONFLICT (appointment_id) WHERE appointment_id IS NOT NULL DO NOTHING;

  UPDATE review_tokens SET used_at = now() WHERE id = tok.id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_review(
  text, smallint, smallint, smallint, smallint, smallint, smallint, smallint, text
) TO anon, authenticated;
