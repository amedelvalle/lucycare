-- ═══════════════════════════════════════════════════════════
-- Migración S7-41: Lista de espera global cross-médicos (admin)
-- ═══════════════════════════════════════════════════════════
-- Hoy la lista de espera solo se ve por médico dentro de
-- /admin/medicos/:id (RPC admin_list_waitlist_for_doctor, atada a un
-- doctor y sin nombre/especialidad del médico). Esta migración agrega
-- UNA RPC de lectura cross-médicos para la vista global
-- /admin/lista-espera, con join al médico/perfil/especialidad/clínica y
-- todos los filtros + paginación, devolviendo el total con count(*) OVER().
--
-- NO duplica la acción de cambio de estado: la UI sigue usando
-- admin_update_waitlist_entry (s7_18), que opera por entry_id.
--
-- SEGURIDAD:
--   • SECURITY DEFINER + gate is_admin() obligatorio (igual que el resto
--     de admin_*). Lee waitlist de TODOS los médicos, que un no-admin no
--     debe ver. No cambia la RLS ni la visibilidad del médico (doctor sigue
--     viendo solo lo suyo por la policy waitlist_doctor_self_select).
--   • PII expuesta: nombre/teléfono/mensaje/notas/estado/fechas — lo mismo
--     que la vista per-médico ya mostraba. Sin datos clínicos.
--
-- FECHAS:
--   • p_date_from inclusivo (>=).
--   • p_date_to inclusivo a nivel UX → en SQL se aplica como
--     < p_date_to + interval '1 day' para no perder registros por la hora.
--     (Se castea p_date_to a date para anclar al inicio del día.)
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_list_waitlist(
  p_status        text        DEFAULT NULL,   -- pending|contacted|cancelled | NULL=todas
  p_doctor_id     uuid        DEFAULT NULL,
  p_specialty_id  uuid        DEFAULT NULL,
  p_search        text        DEFAULT NULL,   -- paciente (nombre/teléfono) o médico
  p_date_from     date        DEFAULT NULL,   -- inclusivo
  p_date_to       date        DEFAULT NULL,   -- inclusivo (UX) → < date_to + 1 día
  p_limit         int         DEFAULT 25,
  p_offset        int         DEFAULT 0
)
RETURNS TABLE (
  id                uuid,
  doctor_id         uuid,
  doctor_name       text,
  specialty_name    text,
  clinic_name       text,
  patient_name      text,
  patient_phone     text,
  patient_message   text,
  status            text,
  contacted_at      timestamptz,
  notes             text,
  created_at        timestamptz,
  total_count       bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_search_like text;
  v_search_digits text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0001';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('pending','contacted','cancelled') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status USING ERRCODE = 'P0105';
  END IF;

  -- Patrón de búsqueda textual (nombre paciente / nombre médico), escapando
  -- los comodines LIKE del input.
  IF v_search IS NOT NULL THEN
    v_search_like := '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%';
    -- Para teléfono: solo dígitos del término → match contra phone_normalized.
    v_search_digits := nullif(regexp_replace(v_search, '\D', '', 'g'), '');
  END IF;

  RETURN QUERY
  SELECT
    w.id,
    w.doctor_id,
    pr.full_name                          AS doctor_name,
    s.name                                AS specialty_name,
    c.name                                AS clinic_name,
    w.patient_name,
    w.patient_phone,
    w.patient_message,
    w.status,
    w.contacted_at,
    w.notes,
    w.created_at,
    count(*) OVER()                       AS total_count
  FROM waitlist_entries w
  JOIN doctors d        ON d.id = w.doctor_id
  LEFT JOIN profiles pr ON pr.id = d.profile_id
  LEFT JOIN specialties s ON s.id = d.specialty_id
  LEFT JOIN clinics c   ON c.id = d.clinic_id
  WHERE (p_status IS NULL OR w.status = p_status)
    AND (p_doctor_id IS NULL OR w.doctor_id = p_doctor_id)
    AND (p_specialty_id IS NULL OR d.specialty_id = p_specialty_id)
    AND (p_date_from IS NULL OR w.created_at >= p_date_from)
    AND (p_date_to IS NULL OR w.created_at < (p_date_to + interval '1 day'))
    AND (
      v_search IS NULL
      OR w.patient_name ILIKE v_search_like
      OR pr.full_name ILIKE v_search_like
      OR (v_search_digits IS NOT NULL AND w.patient_phone_normalized LIKE '%' || v_search_digits || '%')
    )
  ORDER BY w.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200))
  OFFSET GREATEST(0, p_offset);
END;
$$;

REVOKE ALL ON FUNCTION admin_list_waitlist(text, uuid, uuid, text, date, date, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_waitlist(text, uuid, uuid, text, date, date, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION admin_list_waitlist(text, uuid, uuid, text, date, date, int, int) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_41.mjs + node scripts/_smoke-s7_41.mjs
-- ───────────────────────────────────────────────────────────
