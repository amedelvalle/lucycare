-- ═══════════════════════════════════════════════════════════
-- Migración S7-23: admin_approve_and_create_doctor — email override
-- ═══════════════════════════════════════════════════════════
-- Refinamiento de la RPC de Fase 2 (s7_22) para aceptar email como
-- override del admin.
--
-- Motivo (smoke de PR #58): si el lead no trajo email (campo opcional
-- per Lectura A), el doctor creado queda sin email en auth.users +
-- profile, lo cual rompe el flujo de recuperación de contraseña
-- (Fase 4 PR-A). El admin sabe el email real del médico tras la
-- validación manual; debe poder ingresarlo en el modal de "Crear
-- médico".
--
-- Regla de seguridad:
--   - Si lead.email YA existe, el override se ignora (no permite
--     que admin cambie identidad declarada del médico).
--   - Si lead.email IS NULL, se acepta el override.
--   - Validación de formato mínima (debe contener @).
--   - Audit log refleja si fue override o tomado del lead.
--
-- CREATE OR REPLACE FUNCTION reemplaza la versión de s7_22 in-place.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_approve_and_create_doctor(
  p_request_id uuid,
  p_overrides  jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_lead              doctor_affiliation_requests%ROWTYPE;
  v_user_id           uuid;
  v_profile_id        uuid;
  v_clinic_id         uuid;
  v_doctor_id         uuid;

  -- Resolved values (override > lead > default)
  v_full_name         text;
  v_email             text;
  v_email_was_override boolean := false;
  v_phone_normalized  text;
  v_specialty_id      uuid;
  v_clinic_name       text;
  v_address_line      text;
  v_dept_id           text;
  v_muni_id           text;

  v_override_email    text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lead FROM doctor_affiliation_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud de afiliación no encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_lead.status <> 'approved' THEN
    RAISE EXCEPTION 'La solicitud no está en estado approved (actual: %)', v_lead.status
      USING ERRCODE = 'P0002';
  END IF;
  IF v_lead.doctor_id IS NOT NULL THEN
    RAISE EXCEPTION 'La solicitud ya tiene un médico vinculado (doctor_id %)', v_lead.doctor_id
      USING ERRCODE = 'P0003';
  END IF;

  -- ─── Resolver overrides ───
  v_full_name        := COALESCE(NULLIF(btrim(p_overrides->>'full_name'), ''), v_lead.full_name);
  v_phone_normalized := v_lead.phone_normalized;  -- phone NUNCA se sobreescribe

  -- Email override: solo si el lead NO trajo email. Si el lead sí
  -- trajo email, se respeta (regla de identidad — admin no cambia
  -- el email declarado del médico desde acá).
  v_override_email := NULLIF(btrim(lower(p_overrides->>'email')), '');
  IF v_lead.email IS NOT NULL AND btrim(v_lead.email) <> '' THEN
    v_email := v_lead.email;
  ELSIF v_override_email IS NOT NULL THEN
    -- Validación mínima de formato
    IF position('@' IN v_override_email) < 2 OR position('.' IN v_override_email) = 0 THEN
      RAISE EXCEPTION 'El email override no tiene formato válido' USING ERRCODE = 'P0005';
    END IF;
    v_email := v_override_email;
    v_email_was_override := true;
  ELSE
    v_email := NULL;
  END IF;

  v_specialty_id := COALESCE(
    NULLIF(p_overrides->>'specialty_id', '')::uuid,
    v_lead.specialty_id
  );
  v_clinic_name  := COALESCE(
    NULLIF(btrim(p_overrides->>'clinic_name'), ''),
    v_lead.clinic_name,
    'Consultorio Dr. ' || v_full_name
  );
  v_address_line := COALESCE(
    NULLIF(btrim(p_overrides->>'address_line'), ''),
    v_lead.address_line
  );
  v_dept_id := COALESCE(NULLIF(p_overrides->>'department_id', ''), v_lead.department_id);
  v_muni_id := COALESCE(NULLIF(p_overrides->>'municipality_id', ''), v_lead.municipality_id);

  IF v_specialty_id IS NOT NULL THEN
    PERFORM 1 FROM specialties WHERE id = v_specialty_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La especialidad indicada no existe en el catálogo' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  -- ─── auth.users dormant ───
  v_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, phone, encrypted_password,
    email_confirmed_at, phone_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new,
    email_change_token_current, recovery_token, phone_change,
    phone_change_token, reauthentication_token
  ) VALUES (
    v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    v_email, v_phone_normalized, NULL,
    NULL, NULL,
    '{"provider": "phone", "providers": ["phone"]}'::jsonb,
    jsonb_build_object(
      'full_name', v_full_name,
      'created_via', 'admin_approve_and_create_doctor',
      'source_request_id', p_request_id,
      'email_via_admin_override', v_email_was_override
    ),
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  -- ─── UPSERT profile ───
  INSERT INTO profiles (id, full_name, email, phone, role)
  VALUES (v_user_id, v_full_name, v_email, v_phone_normalized, 'doctor')
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email     = COALESCE(EXCLUDED.email, profiles.email),
    phone     = COALESCE(profiles.phone, EXCLUDED.phone),
    role      = 'doctor'::user_role,
    updated_at = now();
  v_profile_id := v_user_id;

  -- ─── clinic ───
  INSERT INTO clinics (
    name, address_line, phone, owner_id, is_active,
    department_id, municipality_id
  ) VALUES (
    v_clinic_name, v_address_line, v_phone_normalized,
    v_profile_id, true,
    v_dept_id, v_muni_id
  ) RETURNING id INTO v_clinic_id;

  -- ─── clinic_members (owner) ───
  INSERT INTO clinic_members (clinic_id, profile_id, role, is_active)
  VALUES (v_clinic_id, v_profile_id, 'owner'::clinic_member_role, true);

  -- ─── doctors en listed_only ───
  INSERT INTO doctors (
    profile_id, clinic_id, specialty_id, license_number,
    lucy_status, is_published, is_operational, booking_enabled
  ) VALUES (
    v_profile_id, v_clinic_id, v_specialty_id, v_lead.license_number,
    'listed_only'::lucy_status, false, false, false
  ) RETURNING id INTO v_doctor_id;

  -- ─── Vincular lead ───
  UPDATE doctor_affiliation_requests
     SET doctor_id   = v_doctor_id,
         clinic_id   = v_clinic_id,
         email       = COALESCE(email, v_email),  -- si el lead no tenía email y admin lo dio, persistirlo
         reviewed_by = COALESCE(reviewed_by, auth.uid()),
         reviewed_at = COALESCE(reviewed_at, now()),
         updated_at  = now()
   WHERE id = p_request_id;

  -- ─── Audit log ───
  INSERT INTO audit_log (user_id, action, table_name, record_id, new_data)
  VALUES (
    auth.uid(), 'insert'::audit_action, 'doctors', v_doctor_id,
    jsonb_build_object(
      'lucy_status',        'listed_only',
      'profile_id',         v_profile_id,
      'clinic_id',          v_clinic_id,
      'license_number',     v_lead.license_number,
      'specialty_id',       v_specialty_id,
      'email_via_admin_override', v_email_was_override,
      'edited_via',         'admin_approve_and_create_doctor',
      'source_request_id',  p_request_id,
      'auth_user_dormant',  true
    )
  );

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'doctor_affiliation_requests',
    p_request_id,
    jsonb_build_object('doctor_id', NULL, 'clinic_id', NULL),
    jsonb_build_object(
      'doctor_id',  v_doctor_id,
      'clinic_id',  v_clinic_id,
      'email_via_admin_override', v_email_was_override,
      'edited_via', 'admin_approve_and_create_doctor'
    )
  );

  RETURN jsonb_build_object(
    'success',    true,
    'doctor_id',  v_doctor_id,
    'clinic_id',  v_clinic_id,
    'profile_id', v_profile_id,
    'email_via_override', v_email_was_override
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_approve_and_create_doctor(uuid, jsonb) TO authenticated;
