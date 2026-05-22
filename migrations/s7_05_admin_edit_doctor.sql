-- ═══════════════════════════════════════════════════════════
-- Migración S7-05: Edición de info del médico por admin (Fase B2-A)
-- ═══════════════════════════════════════════════════════════
-- Cubre: Perfil (nombre/email/phone), Clínica (nombre/dirección/phone),
-- Profesional (especialidad, bio). NO toca contenido clínico.
--
-- IMPORTANTE: profiles.phone/email están atados a auth.users (login).
-- admin_update_doctor_profile actualiza AMBOS en la misma transacción
-- para no romper login. NO dispara verificación de Supabase (mantiene
-- confirmed) — alineado con "sin SMS/OTP para acciones admin".
--
-- Todas las RPCs SECURITY DEFINER + gateadas por is_admin() + audit_log.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Detalle editable del médico ─────────────────────────
CREATE OR REPLACE FUNCTION admin_get_doctor_detail(p_doctor_id uuid)
RETURNS TABLE (
  doctor_id        uuid,
  profile_id       uuid,
  clinic_id        uuid,
  full_name        text,
  email            text,
  phone            text,
  specialty_id     uuid,
  specialty_name   text,
  bio              text,
  clinic_name      text,
  clinic_address   text,
  clinic_phone     text,
  is_published     boolean,
  is_operational   boolean,
  lucy_status      lucy_status
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  RETURN QUERY
  SELECT
    d.id, d.profile_id, d.clinic_id,
    p.full_name, p.email, p.phone,
    d.specialty_id, s.name AS specialty_name,
    d.bio,
    c.name AS clinic_name, c.address_line AS clinic_address, c.phone AS clinic_phone,
    d.is_published, d.is_operational, d.lucy_status
  FROM doctors d
  LEFT JOIN profiles    p ON p.id = d.profile_id
  LEFT JOIN specialties s ON s.id = d.specialty_id
  LEFT JOIN clinics     c ON c.id = d.clinic_id
  WHERE d.id = p_doctor_id;
END;
$$;

-- ─── 2. Update PERFIL (toca auth.users + profiles, en transacción) ─
-- Bloquea limpiar phone Y email a la vez (deja al médico sin login).
CREATE OR REPLACE FUNCTION admin_update_doctor_profile(
  p_doctor_id  uuid,
  p_full_name  text,
  p_email      text,
  p_phone      text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_old        record;
  v_new_email  text := nullif(btrim(lower(p_email)), '');
  v_new_phone  text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  v_full_name  text := btrim(coalesce(p_full_name, ''));
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF v_full_name = '' THEN RAISE EXCEPTION 'El nombre no puede quedar vacío'; END IF;
  IF v_new_email IS NULL AND v_new_phone IS NULL THEN
    RAISE EXCEPTION 'El médico no puede quedar sin email ni teléfono (ambos son credenciales de login)';
  END IF;

  -- Snapshot anterior para audit
  SELECT d.profile_id, p.full_name, p.email, p.phone
  INTO v_old
  FROM doctors d JOIN profiles p ON p.id = d.profile_id
  WHERE d.id = p_doctor_id;
  IF v_old.profile_id IS NULL THEN RAISE EXCEPTION 'Médico no encontrado'; END IF;
  v_profile_id := v_old.profile_id;

  -- Actualiza auth.users (mantiene confirmed; no dispara verificación)
  UPDATE auth.users
  SET email = v_new_email,
      phone = v_new_phone,
      email_confirmed_at = CASE WHEN v_new_email IS NOT NULL THEN COALESCE(email_confirmed_at, now()) ELSE NULL END,
      phone_confirmed_at = CASE WHEN v_new_phone IS NOT NULL THEN COALESCE(phone_confirmed_at, now()) ELSE NULL END,
      updated_at = now()
  WHERE id = v_profile_id;

  -- Actualiza profiles (campos visibles)
  UPDATE profiles
  SET full_name = v_full_name,
      email = v_new_email,
      phone = v_new_phone,
      updated_at = now()
  WHERE id = v_profile_id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'profiles', v_profile_id,
    jsonb_build_object('full_name', v_old.full_name, 'email', v_old.email, 'phone', v_old.phone),
    jsonb_build_object('full_name', v_full_name, 'email', v_new_email, 'phone', v_new_phone, 'edited_via', 'admin')
  );
END;
$$;

-- ─── 3. Update CLINICA del médico ───────────────────────────
CREATE OR REPLACE FUNCTION admin_update_doctor_clinic(
  p_doctor_id  uuid,
  p_name       text,
  p_address    text,
  p_phone      text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id  uuid;
  v_old        record;
  v_name       text := btrim(coalesce(p_name, ''));
  v_address    text := nullif(btrim(coalesce(p_address, '')), '');
  v_phone      text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'El nombre de la clínica no puede quedar vacío'; END IF;

  SELECT d.clinic_id, c.name, c.address_line, c.phone
  INTO v_old
  FROM doctors d JOIN clinics c ON c.id = d.clinic_id
  WHERE d.id = p_doctor_id;
  IF v_old.clinic_id IS NULL THEN RAISE EXCEPTION 'Clínica del médico no encontrada'; END IF;
  v_clinic_id := v_old.clinic_id;

  UPDATE clinics
  SET name = v_name, address_line = v_address, phone = v_phone, updated_at = now()
  WHERE id = v_clinic_id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'clinics', v_clinic_id,
    jsonb_build_object('name', v_old.name, 'address_line', v_old.address_line, 'phone', v_old.phone),
    jsonb_build_object('name', v_name, 'address_line', v_address, 'phone', v_phone, 'edited_via', 'admin')
  );
END;
$$;

-- ─── 4. Update INFO profesional (especialidad + bio) ────────
CREATE OR REPLACE FUNCTION admin_update_doctor_info(
  p_doctor_id    uuid,
  p_specialty_id uuid,
  p_bio          text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old      record;
  v_bio      text := nullif(btrim(coalesce(p_bio, '')), '');
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_specialty_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM specialties WHERE id = p_specialty_id) THEN
      RAISE EXCEPTION 'Especialidad no encontrada';
    END IF;
  END IF;

  SELECT specialty_id, bio INTO v_old FROM doctors WHERE id = p_doctor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Médico no encontrado'; END IF;

  UPDATE doctors
  SET specialty_id = p_specialty_id, bio = v_bio, updated_at = now()
  WHERE id = p_doctor_id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'doctors', p_doctor_id,
    jsonb_build_object('specialty_id', v_old.specialty_id, 'bio', v_old.bio),
    jsonb_build_object('specialty_id', p_specialty_id, 'bio', v_bio, 'edited_via', 'admin')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_doctor_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_doctor_profile(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_doctor_clinic(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_doctor_info(uuid, uuid, text) TO authenticated;
