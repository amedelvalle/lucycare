-- ═══════════════════════════════════════════════════════════
-- Migración S7-24: fixes de Afiliación Fase 2 (follow-up post-smoke)
-- ═══════════════════════════════════════════════════════════
-- Tres correcciones detectadas en el smoke end-to-end de afiliación:
--
--  (A) ROLE PRE-CLAIM — raíz del "Perfil reclamado" falso.
--      s7_22/s7_23 dejaban el profile recién creado con role='doctor'
--      ANTES de que el médico reclamara. Como ese profile coincide con
--      el auth.user que el médico reusa al hacer OTP, entraba al panel
--      pre-claim y veía "Perfil reclamado" (PanelLayout) sin haber
--      ejecutado claim_doctor_profile.
--
--      Los médicos IMPORTADOS no sufren esto: su doctor.profile_id
--      apunta a un profile huérfano (role=doctor, SIN auth.users); el
--      login real del médico es un auth.user nuevo con profile
--      role='patient' hasta que reclama. claim_doctor_profile (s7_13)
--      re-apunta y sube a role='doctor'.
--
--      Fix: el profile que crea Fase 2 queda role='patient' (pre-claim),
--      consistente con el login de un importado. claim_doctor_profile
--      lo promueve a 'doctor' al reclamar (s7_13 líneas 159-162; para
--      Fase 2 el caso profile_id == auth.uid() toma ese mismo camino).
--      Resultado: un médico listed_only NO entra al panel ni ve
--      "Perfil reclamado" antes de reclamar de verdad.
--
--  (B) NOMBRE DE CLÍNICA — fallback generaba "Consultorio Dr. Dr. X"
--      cuando el full_name ya traía "Dr."/"Dra.". Se antepone el
--      honorífico solo si el nombre no lo trae ya.
--
--  (C) admin_list_affiliation_requests ahora devuelve department_id y
--      municipality_id (además de los *_name) para que el modal admin
--      "Crear médico" pueda PRECARGAR los selects de ubicación. La
--      persistencia ya funcionaba (la RPC arrastra del lead vía
--      COALESCE), pero el modal mostraba los selects vacíos.
--
-- Idempotente: CREATE OR REPLACE reemplaza las versiones de s7_21/s7_23
-- in-place. No cambia firmas → no rompe GRANTs ni callers.
-- ═══════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- (A)+(B) admin_approve_and_create_doctor — role pre-claim + clinic name
-- ─────────────────────────────────────────────────────────────
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

  -- Email override: solo si el lead NO trajo email.
  v_override_email := NULLIF(btrim(lower(p_overrides->>'email')), '');
  IF v_lead.email IS NOT NULL AND btrim(v_lead.email) <> '' THEN
    v_email := v_lead.email;
  ELSIF v_override_email IS NOT NULL THEN
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

  -- (B) Nombre de clínica: anteponer "Dr." solo si el nombre no lo trae.
  v_clinic_name  := COALESCE(
    NULLIF(btrim(p_overrides->>'clinic_name'), ''),
    v_lead.clinic_name,
    CASE
      WHEN v_full_name ~* '^\s*dr(a)?\.?\s'
        THEN 'Consultorio ' || v_full_name
      ELSE 'Consultorio Dr. ' || v_full_name
    END
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
  -- (A) role='patient' PRE-CLAIM (no 'doctor'). claim_doctor_profile
  --     promueve a 'doctor' al reclamar. Coexiste con el trigger
  --     handle_new_user (que también deja 'patient' por default).
  INSERT INTO profiles (id, full_name, email, phone, role)
  VALUES (v_user_id, v_full_name, v_email, v_phone_normalized, 'patient')
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email     = COALESCE(EXCLUDED.email, profiles.email),
    phone     = COALESCE(profiles.phone, EXCLUDED.phone),
    role      = 'patient'::user_role,
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
  -- El rol de membresía es independiente del profile.role; 'owner'
  -- describe la relación con la clínica, no el rol de auth.
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
         email       = COALESCE(email, v_email),
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
      'profile_role',       'patient',
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

-- ─────────────────────────────────────────────────────────────
-- (C) admin_list_affiliation_requests — agregar department_id +
--     municipality_id al retorno (para precarga del modal admin).
-- ─────────────────────────────────────────────────────────────
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
  department_id      text,
  department_name    text,
  municipality_id    text,
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
    f.department_id, dep.name AS department_name,
    f.municipality_id, mun.name AS municipality_name,
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
