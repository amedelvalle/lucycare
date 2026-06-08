-- ═══════════════════════════════════════════════════════════
-- Migración S7-42: Afiliación — crear médico cuando el teléfono ya
--                  pertenece a un usuario existente (paciente)
-- ═══════════════════════════════════════════════════════════
-- PROBLEMA: admin_approve_and_create_doctor (s7_24) SIEMPRE hace
-- INSERT INTO auth.users con phone = lead.phone_normalized. Si la persona
-- ya tiene un auth.user (típico: se logueó como paciente por OTP), el
-- INSERT choca con el UNIQUE `users_phone_key` (23505) y LucyAdmin ve el
-- error crudo de Postgres. El caso "paciente existente → ahora médico" es
-- válido en producción y el flujo no lo contemplaba.
--
-- ESTA MIGRACIÓN:
--   1. `admin_affiliation_preflight(p_request_id)` — RPC de LECTURA (definer,
--      is_admin) que clasifica el lead contra auth.users/profiles/doctors/
--      clinic_members ANTES de crear, para que la UI muestre el copy/
--      confirmación correctos. No escribe nada.
--   2. `admin_approve_and_create_doctor` — CREATE OR REPLACE (firma idéntica)
--      que re-ejecuta la clasificación DENTRO de la transacción y ramifica:
--        • new                     → crea auth.user dormant (path actual).
--        • reuse_patient           → NO crea auth.user; reusa el profile del
--                                    paciente existente; crea clinic+member+
--                                    doctor sobre ese profile_id. role queda
--                                    'patient' pre-claim (ya lo es). Solo si
--                                    p_overrides->>'confirm_reuse' = 'true';
--                                    si no → P0013 (requiere confirmación).
--        • block_doctor            → P0010 (ya existe médico con ese teléfono).
--        • block_sensitive         → P0011 (teléfono de assistant/admin u otro
--                                    rol/membresía → revisión manual).
--        • block_identity_conflict → P0012 (email del lead pertenece a otro
--                                    usuario, o email existe con teléfono nuevo
--                                    → identidad ambigua, revisión manual).
--
-- INVARIANTES (sin cambios): el doctor nace listed_only, no publicado/no
-- operativo/no booking/no verified. El reclamo posterior sigue exigiendo OTP
-- + licencia/JVPM + TOS (claim_doctor_profile; ya soporta profile_id==auth.uid,
-- que es el caso reuse). En reuse NO se sobreescribe email/nombre/teléfono del
-- usuario existente (evita choque con users_email_key y respeta su identidad).
--
-- P-CODES NUEVOS: P0010 block_doctor · P0011 block_sensitive ·
--                 P0012 block_identity_conflict · P0013 requires_confirmation.
-- (Ya existentes: P0001 lead no encontrado · P0002 no approved · P0003 ya
--  vinculado · P0004 especialidad inválida · P0005 email override inválido.)
--
-- El match de teléfono usa normalize_phone_sv (s7_40) en ambos lados.
-- ═══════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- Helper interno: clasifica el lead. Devuelve (class, existing_user_id,
-- existing_doctor_id). Lo usan preflight (lectura) y la create (transacción)
-- para una sola fuente de verdad.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _affiliation_classify(
  p_phone_normalized text,
  p_email            text,
  OUT o_class         text,
  OUT o_user_id       uuid,
  OUT o_doctor_id     uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_by_phone uuid;
  v_user_by_email uuid;
  v_role          text;
  v_has_doctor    boolean;
  v_has_membership boolean;
BEGIN
  o_class := 'new';
  o_user_id := NULL;
  o_doctor_id := NULL;

  -- Usuario por teléfono (normalizado en ambos lados).
  SELECT u.id INTO v_user_by_phone
  FROM auth.users u
  WHERE p_phone_normalized IS NOT NULL
    AND normalize_phone_sv(u.phone) = p_phone_normalized
  LIMIT 1;

  -- Usuario por email (si el lead trajo email).
  IF p_email IS NOT NULL AND btrim(p_email) <> '' THEN
    SELECT u.id INTO v_user_by_email
    FROM auth.users u
    WHERE lower(u.email) = lower(p_email)
    LIMIT 1;
  END IF;

  -- Sin usuario por teléfono.
  IF v_user_by_phone IS NULL THEN
    IF v_user_by_email IS NOT NULL THEN
      -- El email pertenece a alguien pero el teléfono es nuevo → ambiguo.
      o_class := 'block_identity_conflict';
      o_user_id := v_user_by_email;
    ELSE
      o_class := 'new';
    END IF;
    RETURN;
  END IF;

  -- Hay usuario por teléfono.
  o_user_id := v_user_by_phone;

  -- Email del lead pertenece a OTRO usuario → ambiguo.
  IF v_user_by_email IS NOT NULL AND v_user_by_email <> v_user_by_phone THEN
    o_class := 'block_identity_conflict';
    RETURN;
  END IF;

  -- ¿Ya es médico?
  SELECT EXISTS(SELECT 1 FROM doctors d WHERE d.profile_id = v_user_by_phone)
    INTO v_has_doctor;
  IF v_has_doctor THEN
    SELECT d.id INTO o_doctor_id FROM doctors d WHERE d.profile_id = v_user_by_phone LIMIT 1;
    o_class := 'block_doctor';
    RETURN;
  END IF;

  -- Defensivo: si el auth.user NO tiene fila en profiles (anomalía; el
  -- trigger handle_new_user debería crearla siempre), NO reusamos a ciegas
  -- → revisión manual. Evita que clinics/clinic_members/doctors fallen por
  -- FK contra un profile inexistente DESPUÉS de pasar la clasificación.
  SELECT p.role::text INTO v_role FROM profiles p WHERE p.id = v_user_by_phone;
  IF NOT FOUND THEN
    o_class := 'block_sensitive';
    RETURN;
  END IF;

  -- ¿Rol sensible o membresía activa en una clínica?
  SELECT EXISTS(
    SELECT 1 FROM clinic_members cm
    WHERE cm.profile_id = v_user_by_phone AND cm.is_active = true
  ) INTO v_has_membership;

  IF v_role <> 'patient' OR v_has_membership THEN
    o_class := 'block_sensitive';
    RETURN;
  END IF;

  -- Paciente limpio (con profile), sin doctor ni membresía → reusable.
  o_class := 'reuse_patient';
END;
$$;

REVOKE ALL ON FUNCTION _affiliation_classify(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _affiliation_classify(text, text) FROM anon;
REVOKE ALL ON FUNCTION _affiliation_classify(text, text) FROM authenticated;

-- ─────────────────────────────────────────────────────────────
-- Preflight (lectura) para la UI.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_affiliation_preflight(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_lead doctor_affiliation_requests%ROWTYPE;
  v_c    record;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lead FROM doctor_affiliation_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud de afiliación no encontrada' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_c FROM _affiliation_classify(v_lead.phone_normalized, v_lead.email);

  RETURN jsonb_build_object(
    'classification',    v_c.o_class,
    'existing_user_id',  v_c.o_user_id,
    'existing_doctor_id',v_c.o_doctor_id,
    'lead_status',       v_lead.status,
    'already_linked',    (v_lead.doctor_id IS NOT NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_affiliation_preflight(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_affiliation_preflight(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION admin_affiliation_preflight(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- Create endurecida: clasifica dentro de la transacción y ramifica.
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

  v_c                 record;
  v_reused            boolean := false;
  v_confirm_reuse     boolean := (lower(coalesce(p_overrides->>'confirm_reuse','')) = 'true');
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

  -- ─── Resolver overrides (idéntico a s7_24) ───
  v_full_name        := COALESCE(NULLIF(btrim(p_overrides->>'full_name'), ''), v_lead.full_name);
  v_phone_normalized := v_lead.phone_normalized;  -- phone NUNCA se sobreescribe

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

  v_specialty_id := COALESCE(NULLIF(p_overrides->>'specialty_id', '')::uuid, v_lead.specialty_id);

  v_clinic_name := COALESCE(
    NULLIF(btrim(p_overrides->>'clinic_name'), ''),
    v_lead.clinic_name,
    CASE WHEN v_full_name ~* '^\s*dr(a)?\.?\s'
      THEN 'Consultorio ' || v_full_name
      ELSE 'Consultorio Dr. ' || v_full_name END
  );
  v_address_line := COALESCE(NULLIF(btrim(p_overrides->>'address_line'), ''), v_lead.address_line);
  v_dept_id := COALESCE(NULLIF(p_overrides->>'department_id', ''), v_lead.department_id);
  v_muni_id := COALESCE(NULLIF(p_overrides->>'municipality_id', ''), v_lead.municipality_id);

  IF v_specialty_id IS NOT NULL THEN
    PERFORM 1 FROM specialties WHERE id = v_specialty_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La especialidad indicada no existe en el catálogo' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  -- ─── Clasificación (misma fuente que preflight) ───
  SELECT * INTO v_c FROM _affiliation_classify(v_phone_normalized, v_email);

  IF v_c.o_class = 'block_doctor' THEN
    RAISE EXCEPTION 'Ya existe un médico registrado con este teléfono (doctor_id %).', v_c.o_doctor_id
      USING ERRCODE = 'P0010';
  ELSIF v_c.o_class = 'block_sensitive' THEN
    RAISE EXCEPTION 'Este teléfono pertenece a una cuenta con otro rol (asistente/administrador) o membresía activa. Requiere revisión manual.'
      USING ERRCODE = 'P0011';
  ELSIF v_c.o_class = 'block_identity_conflict' THEN
    RAISE EXCEPTION 'El correo del lead pertenece a otra cuenta o no coincide con el teléfono. Identidad ambigua: requiere revisión manual.'
      USING ERRCODE = 'P0012';
  ELSIF v_c.o_class = 'reuse_patient' AND NOT v_confirm_reuse THEN
    RAISE EXCEPTION 'Este teléfono ya pertenece a una cuenta de paciente. Confirmá la vinculación para crear el médico sobre esa cuenta.'
      USING ERRCODE = 'P0013';
  END IF;

  -- ─── Resolver el profile (crear nuevo vs reusar existente) ───
  IF v_c.o_class = 'reuse_patient' THEN
    -- REUSAR: no se crea auth.user. Se conserva la cuenta del paciente.
    -- NO se tocan phone/email/role (credenciales/contactos sensibles).
    v_user_id    := v_c.o_user_id;
    v_profile_id := v_c.o_user_id;
    v_reused     := true;

    -- El médico no puede quedar "(sin nombre)": la ficha admin / el listado /
    -- el directorio leen profiles.full_name. Si el paciente tiene full_name
    -- vacío, lo completamos con el nombre público del lead. Solo si está
    -- vacío → NO pisamos un nombre real ya cargado por el paciente.
    UPDATE profiles
       SET full_name = v_full_name, updated_at = now()
     WHERE id = v_profile_id
       AND coalesce(btrim(full_name), '') = '';
  ELSE
    -- NEW: auth.user dormant (path original de s7_24).
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

    -- UPSERT profile role='patient' PRE-CLAIM (fix s7_24).
    INSERT INTO profiles (id, full_name, email, phone, role)
    VALUES (v_user_id, v_full_name, v_email, v_phone_normalized, 'patient')
    ON CONFLICT (id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email     = COALESCE(EXCLUDED.email, profiles.email),
      phone     = COALESCE(profiles.phone, EXCLUDED.phone),
      role      = 'patient'::user_role,
      updated_at = now();
    v_profile_id := v_user_id;
  END IF;

  -- ─── clinic ───
  INSERT INTO clinics (
    name, address_line, phone, owner_id, is_active,
    department_id, municipality_id
  ) VALUES (
    v_clinic_name, v_address_line, v_phone_normalized,
    v_profile_id, true, v_dept_id, v_muni_id
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
      'reused_existing_user', v_reused,
      'existing_user_id',   CASE WHEN v_reused THEN v_profile_id ELSE NULL END,
      'edited_via',         'admin_approve_and_create_doctor',
      'source_request_id',  p_request_id,
      'auth_user_dormant',  (NOT v_reused)
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
      'reused_existing_user', v_reused,
      'edited_via', 'admin_approve_and_create_doctor'
    )
  );

  RETURN jsonb_build_object(
    'success',    true,
    'doctor_id',  v_doctor_id,
    'clinic_id',  v_clinic_id,
    'profile_id', v_profile_id,
    'reused_existing_user', v_reused,
    'email_via_override', v_email_was_override
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_approve_and_create_doctor(uuid, jsonb) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación manual:
--   SELECT admin_affiliation_preflight('<request_id>');
--   -- new: SELECT admin_approve_and_create_doctor('<req>', '{}');
--   -- reuse: SELECT admin_approve_and_create_doctor('<req>', '{"confirm_reuse":"true"}');
-- Automatizada: node scripts/check-s7_42.mjs + node scripts/_smoke-s7_42.mjs
-- ───────────────────────────────────────────────────────────
