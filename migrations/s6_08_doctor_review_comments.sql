-- ═══════════════════════════════════════════════════════════
-- Migración S6-08: Vista médica de reputación (Fase E)
-- ═══════════════════════════════════════════════════════════
-- El médico ve en su panel sus comentarios de pacientes, ANÓNIMOS:
-- sin nombre, sin teléfono, sin fecha exacta — solo antigüedad
-- aproximada ("hace ~X meses"). reviews tiene RLS bloqueada, así
-- que se expone vía RPC SECURITY DEFINER que resuelve el doctor
-- desde auth.uid() y NO devuelve datos identificatorios.
--
-- El agregado (score, volumen, promedios por criterio) ya está en
-- la vista doctor_rating_stats (Fase A) — no se duplica acá.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_my_review_comments()
RETURNS TABLE (
  rating       numeric,
  comment      text,
  months_ago   integer
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  did uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Solo el propio médico (no asistentes): debe existir doctors.profile_id = uid
  SELECT id INTO did FROM doctors WHERE profile_id = uid;
  IF did IS NULL THEN
    RAISE EXCEPTION 'Solo el médico puede ver sus calificaciones';
  END IF;

  RETURN QUERY
  SELECT
    r.rating,
    r.comment,
    GREATEST(
      0,
      (EXTRACT(YEAR  FROM age(now(), r.submitted_at)) * 12
     + EXTRACT(MONTH FROM age(now(), r.submitted_at)))::int
    ) AS months_ago
  FROM reviews r
  WHERE r.doctor_id = did
    AND r.is_visible = true
    AND r.comment IS NOT NULL
    AND r.submitted_at IS NOT NULL
  ORDER BY r.submitted_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_review_comments() TO authenticated;
