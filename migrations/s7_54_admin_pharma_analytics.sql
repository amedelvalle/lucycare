-- ═══════════════════════════════════════════════════════════
-- Migración S7-54: Analytics Farma — inteligencia de prescripción (backend)
-- ═══════════════════════════════════════════════════════════
-- Capa estratégica INTERNA (LucyAdmin) de prescripción agregada. Tres RPCs de
-- SOLO LECTURA que devuelven AGREGADOS/CONTEOS; NUNCA pacientes, recetas
-- individuales ni texto clínico. Diseño en docs/ANALISIS_ANALYTICS_FARMA.md.
--
-- BASE DE CÁLCULO (vinculante, §7 del análisis):
--   • prescriptions.is_current = true            (no versiones corregidas)
--   • consultations.status = 'signed'            (no borradores)
--   • fecha  = consultations.signed_at           (prescriptions no tiene fecha)
--   • médico = consultations.doctor_id
--   • medicamento = SNAPSHOTS históricos de prescriptions (s7_37; NO depende del
--     catálogo actual)
--   • fuente global/personal = medications.doctor_id  (NULL = Base Lucy global)
--
-- SEGURIDAD:
--   • SECURITY DEFINER + SET search_path = public + gate is_admin() → P0001
--     para anon/médico/asistente/paciente. REVOKE PUBLIC/anon, GRANT authenticated.
--   • SOLO agregados: la salida NO contiene patient_id, nombre/teléfono/email/
--     documento/DOB de paciente, appointment_id, consultation_id, la receta
--     individual, diagnóstico, notas, vitales, antecedentes, instructions,
--     alternatives, dosage/frequency crudos, ni la relación paciente↔medicamento.
--     Solo IDs técnicos (medication_id/doctor_id), datos públicos del médico
--     (nombre/especialidad) y snapshots de catálogo (nombre/PA/concentración/
--     presentación del medicamento — no son PII de paciente).
--   • STABLE. No escribe, no crea tablas, no toca RLS ni datos.
--
-- UMBRAL DE PRIVACIDAD (celda mínima):
--   • Los DOS rankings aplican HAVING count(*) >= p_min_count (default 3): no se
--     listan combinaciones (medicamento / médico) con volumen < 3 → mitiga la
--     re-identificación por celda chica. El summary NO se umbraliza (son totales
--     generales, no una combinación específica). El caller puede bajar el umbral
--     (p_min_count) para inspección interna; nunca sube el riesgo del summary.
--
-- FECHAS: p_date_from inclusivo (>=); p_date_to inclusivo por día (< +1 día);
--   NULL = sin ese límite.
-- ═══════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────
-- 1. admin_pharma_summary — totales agregados (jsonb)
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_pharma_summary(
  p_date_from    date DEFAULT NULL,
  p_date_to      date DEFAULT NULL,
  p_doctor_id    uuid DEFAULT NULL,
  p_specialty_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to_excl timestamptz := CASE WHEN p_date_to IS NULL THEN NULL ELSE (p_date_to + interval '1 day') END;
  v record;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0001';
  END IF;

  SELECT
    count(*)                                                 AS total_prescriptions,
    count(DISTINCT p.medication_id)                          AS unique_medications,
    count(DISTINCT c.doctor_id)                              AS prescribing_doctors,
    count(DISTINCT p.consultation_id)                        AS signed_consultations_with_meds,
    count(*) FILTER (WHERE m.doctor_id IS NULL)              AS src_global,
    count(*) FILTER (WHERE m.doctor_id IS NOT NULL)          AS src_personal,
    count(*) FILTER (WHERE p.duration_unit = 'permanente')   AS permanent
  INTO v
  FROM prescriptions p
  JOIN consultations c ON c.id = p.consultation_id
  JOIN doctors d       ON d.id = c.doctor_id
  LEFT JOIN medications m ON m.id = p.medication_id
  WHERE p.is_current
    AND c.status = 'signed'
    AND (p_date_from IS NULL OR c.signed_at >= p_date_from)
    AND (v_to_excl   IS NULL OR c.signed_at <  v_to_excl)
    AND (p_doctor_id    IS NULL OR c.doctor_id    = p_doctor_id)
    AND (p_specialty_id IS NULL OR d.specialty_id = p_specialty_id);

  RETURN jsonb_build_object(
    'range', jsonb_build_object('from', p_date_from, 'to', p_date_to),
    'total_prescriptions', v.total_prescriptions,
    'unique_medications', v.unique_medications,
    'prescribing_doctors', v.prescribing_doctors,
    'signed_consultations_with_meds', v.signed_consultations_with_meds,
    'by_source', jsonb_build_object('global', v.src_global, 'personal', v.src_personal),
    'permanent', v.permanent
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_pharma_summary(date, date, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_pharma_summary(date, date, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION admin_pharma_summary(date, date, uuid, uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- 2. admin_pharma_medication_ranking — top medicamentos
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_pharma_medication_ranking(
  p_date_from    date DEFAULT NULL,
  p_date_to      date DEFAULT NULL,
  p_doctor_id    uuid DEFAULT NULL,
  p_specialty_id uuid DEFAULT NULL,
  p_limit        int  DEFAULT 20,
  p_min_count    int  DEFAULT 3
)
RETURNS TABLE (
  medication_id       uuid,
  medication_name     text,
  active_ingredient   text,
  concentration       text,
  presentation        text,
  is_global           boolean,
  times_prescribed    bigint,
  consultations_count bigint,
  distinct_doctors    bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to_excl timestamptz := CASE WHEN p_date_to IS NULL THEN NULL ELSE (p_date_to + interval '1 day') END;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    p.medication_id,
    max(p.medication_name_snapshot)    AS medication_name,
    max(p.active_ingredient_snapshot)  AS active_ingredient,
    max(p.concentration_snapshot)      AS concentration,
    max(p.presentation_snapshot)       AS presentation,
    bool_or(m.doctor_id IS NULL)       AS is_global,
    count(*)                           AS times_prescribed,
    count(DISTINCT p.consultation_id)  AS consultations_count,
    count(DISTINCT c.doctor_id)        AS distinct_doctors
  FROM prescriptions p
  JOIN consultations c ON c.id = p.consultation_id
  JOIN doctors d       ON d.id = c.doctor_id
  LEFT JOIN medications m ON m.id = p.medication_id
  WHERE p.is_current
    AND c.status = 'signed'
    AND (p_date_from IS NULL OR c.signed_at >= p_date_from)
    AND (v_to_excl   IS NULL OR c.signed_at <  v_to_excl)
    AND (p_doctor_id    IS NULL OR c.doctor_id    = p_doctor_id)
    AND (p_specialty_id IS NULL OR d.specialty_id = p_specialty_id)
  GROUP BY p.medication_id
  HAVING count(*) >= GREATEST(1, COALESCE(p_min_count, 3))
  ORDER BY count(*) DESC, max(p.medication_name_snapshot) ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 200));
END;
$$;

REVOKE ALL ON FUNCTION admin_pharma_medication_ranking(date, date, uuid, uuid, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_pharma_medication_ranking(date, date, uuid, uuid, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION admin_pharma_medication_ranking(date, date, uuid, uuid, int, int) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- 3. admin_pharma_doctor_ranking — ranking por médico
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_pharma_doctor_ranking(
  p_date_from    date DEFAULT NULL,
  p_date_to      date DEFAULT NULL,
  p_specialty_id uuid DEFAULT NULL,
  p_limit        int  DEFAULT 20,
  p_min_count    int  DEFAULT 3
)
RETURNS TABLE (
  doctor_id           uuid,
  doctor_name         text,
  specialty_name      text,
  total_prescriptions bigint,
  unique_medications  bigint,
  global_count        bigint,
  personal_count      bigint,
  permanent_count     bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to_excl timestamptz := CASE WHEN p_date_to IS NULL THEN NULL ELSE (p_date_to + interval '1 day') END;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    c.doctor_id,
    pr.full_name                                            AS doctor_name,
    s.name                                                  AS specialty_name,
    count(*)                                                AS total_prescriptions,
    count(DISTINCT p.medication_id)                         AS unique_medications,
    count(*) FILTER (WHERE m.doctor_id IS NULL)             AS global_count,
    count(*) FILTER (WHERE m.doctor_id IS NOT NULL)         AS personal_count,
    count(*) FILTER (WHERE p.duration_unit = 'permanente')  AS permanent_count
  FROM prescriptions p
  JOIN consultations c ON c.id = p.consultation_id
  JOIN doctors d       ON d.id = c.doctor_id
  LEFT JOIN profiles pr    ON pr.id = d.profile_id
  LEFT JOIN specialties s  ON s.id = d.specialty_id
  LEFT JOIN medications m  ON m.id = p.medication_id
  WHERE p.is_current
    AND c.status = 'signed'
    AND (p_date_from IS NULL OR c.signed_at >= p_date_from)
    AND (v_to_excl   IS NULL OR c.signed_at <  v_to_excl)
    AND (p_specialty_id IS NULL OR d.specialty_id = p_specialty_id)
  GROUP BY c.doctor_id, pr.full_name, s.name
  HAVING count(*) >= GREATEST(1, COALESCE(p_min_count, 3))
  ORDER BY count(*) DESC, pr.full_name ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 200));
END;
$$;

REVOKE ALL ON FUNCTION admin_pharma_doctor_ranking(date, date, uuid, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_pharma_doctor_ranking(date, date, uuid, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION admin_pharma_doctor_ranking(date, date, uuid, int, int) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_54.mjs + node scripts/_smoke-s7_54.mjs
-- ───────────────────────────────────────────────────────────
