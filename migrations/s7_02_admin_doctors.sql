-- ═══════════════════════════════════════════════════════════
-- Migración S7-02: Gestión de médicos por admin (Fase B)
-- ═══════════════════════════════════════════════════════════
-- 3 ejes independientes que controla el admin plataforma:
--   - Operatividad: NUEVO doctors.is_operational
--   - Directorio: is_published / is_verified / lucy_status
--   - Booking online: booking_enabled (ya existe; futura fase)
--
-- RPCs SECURITY DEFINER gateadas por is_admin(); cada acción
-- escribe a audit_log con old/new data. Sin policies de UPDATE
-- amplias — toda escritura pasa por estas RPCs.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Nuevo flag operativo (no rompe nada: default true) ──
ALTER TABLE doctors
  ADD COLUMN IF NOT EXISTS is_operational boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN doctors.is_operational IS
  'Eje OPERATIVIDAD. false = no puede usar panel/agenda/atender/firmar. '
  'Independiente de is_published / is_verified / lucy_status.';

-- ─── 2. Helper interno de auditoría (DRY) ───────────────────
CREATE OR REPLACE FUNCTION _admin_log_doctor_change(
  p_doctor_id uuid,
  p_field     text,
  p_old_value jsonb,
  p_new_value jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(),
    'update'::audit_action,
    'doctors',
    p_doctor_id,
    jsonb_build_object(p_field, p_old_value),
    jsonb_build_object(p_field, p_new_value)
  );
END;
$$;

-- ─── 3. RPCs de acción (admin-only) ─────────────────────────

CREATE OR REPLACE FUNCTION admin_set_doctor_verified(
  p_doctor_id uuid, p_value boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE old_v boolean;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT is_verified INTO old_v FROM doctors WHERE id = p_doctor_id;
  IF old_v IS NULL THEN RAISE EXCEPTION 'Médico no encontrado'; END IF;
  UPDATE doctors SET is_verified = p_value, updated_at = now() WHERE id = p_doctor_id;
  PERFORM _admin_log_doctor_change(p_doctor_id, 'is_verified', to_jsonb(old_v), to_jsonb(p_value));
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_doctor_published(
  p_doctor_id uuid, p_value boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE old_v boolean;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT is_published INTO old_v FROM doctors WHERE id = p_doctor_id;
  IF old_v IS NULL THEN RAISE EXCEPTION 'Médico no encontrado'; END IF;
  UPDATE doctors SET is_published = p_value, updated_at = now() WHERE id = p_doctor_id;
  PERFORM _admin_log_doctor_change(p_doctor_id, 'is_published', to_jsonb(old_v), to_jsonb(p_value));
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_doctor_operational(
  p_doctor_id uuid, p_value boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE old_v boolean;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT is_operational INTO old_v FROM doctors WHERE id = p_doctor_id;
  IF old_v IS NULL THEN RAISE EXCEPTION 'Médico no encontrado'; END IF;
  UPDATE doctors SET is_operational = p_value, updated_at = now() WHERE id = p_doctor_id;
  PERFORM _admin_log_doctor_change(p_doctor_id, 'is_operational', to_jsonb(old_v), to_jsonb(p_value));
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_lucy_status(
  p_doctor_id uuid, p_value lucy_status
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE old_v lucy_status;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT lucy_status INTO old_v FROM doctors WHERE id = p_doctor_id;
  IF old_v IS NULL THEN RAISE EXCEPTION 'Médico no encontrado'; END IF;
  UPDATE doctors SET lucy_status = p_value, updated_at = now() WHERE id = p_doctor_id;
  PERFORM _admin_log_doctor_change(p_doctor_id, 'lucy_status', to_jsonb(old_v::text), to_jsonb(p_value::text));
END;
$$;

-- ─── 4. Listado para el admin (todas las flags + nombre) ────
CREATE OR REPLACE FUNCTION admin_list_doctors()
RETURNS TABLE (
  id            uuid,
  full_name     text,
  phone         text,
  specialty     text,
  clinic_name   text,
  is_verified   boolean,
  is_published  boolean,
  booking_enabled boolean,
  is_operational boolean,
  lucy_status   lucy_status,
  created_at    timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  RETURN QUERY
  SELECT
    d.id,
    p.full_name,
    p.phone,
    s.name        AS specialty,
    c.name        AS clinic_name,
    d.is_verified,
    d.is_published,
    d.booking_enabled,
    d.is_operational,
    d.lucy_status,
    d.created_at
  FROM doctors d
  LEFT JOIN profiles    p ON p.id = d.profile_id
  LEFT JOIN specialties s ON s.id = d.specialty_id
  LEFT JOIN clinics     c ON c.id = d.clinic_id
  ORDER BY d.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_set_doctor_verified(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_doctor_published(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_doctor_operational(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_lucy_status(uuid, lucy_status) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_list_doctors() TO authenticated;
