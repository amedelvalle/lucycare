-- ═══════════════════════════════════════════════════════════
-- Migración S7-22: admin_approve_and_create_doctor (Afiliación Fase 2)
-- ═══════════════════════════════════════════════════════════
-- RPC admin para convertir un lead `doctor_affiliation_requests` en
-- estado `approved` a un `doctors` row en `listed_only`.
--
-- Diseño (basado en docs/PLAN_AFILIACION_MEDICO.md §9 y decisión del
-- owner del 2026-05-27):
--
--   • Solo `is_admin()` puede ejecutar.
--   • Solo leads con `status = 'approved'` y sin `doctor_id` previo.
--   • Crea `auth.users` "dormant" (encrypted_password=NULL,
--     phone_confirmed_at=NULL, email_confirmed_at=NULL) — el médico
--     reclamará después por OTP. Mismo principio que
--     `import-doctors.mjs` pero sin auto-confirmar.
--   • Si existe trigger `handle_new_user`, auto-crea profile en
--     role='patient' con full_name=''. Hacemos UPSERT defensivo
--     para garantizar role='doctor' + datos reales.
--   • Crea `clinics` (auto), `clinic_members` (owner), `doctors`
--     en `listed_only` con todos los flags conservadores en false.
--   • Vincula `doctor_id` y `clinic_id` en el lead.
--   • Audit log con `edited_via='admin_approve_and_create_doctor'`.
--
-- NO toca:
--   • `is_published`, `is_operational`, `booking_enabled`, `is_verified`
--     → todos quedan en false.
--   • `services`, `availability_rules` → el médico los configurará
--     después en /panel.
--   • TOS del doctor → el flujo de Reclamar perfil los registra.
--
-- Errores tipados:
--   P0001 lead no encontrado
--   P0002 lead no está en estado approved (estado actual en el msg)
--   P0003 lead ya tiene doctor_id vinculado (evita duplicados)
--   P0004 specialty_id provista no existe en catálogo
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
  v_phone_normalized  text;
  v_specialty_id      uuid;
  v_clinic_name       text;
  v_address_line      text;
  v_dept_id           text;
  v_muni_id           text;
BEGIN
  -- ─── 0. Auth gate ───
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  -- ─── 1. Cargar lead ───
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

  -- ─── 2. Resolver overrides ───
  -- Pattern: override > lead > fallback
  v_full_name        := COALESCE(NULLIF(btrim(p_overrides->>'full_name'), ''), v_lead.full_name);
  v_email            := v_lead.email;  -- email NO se sobreescribe por seguridad (es identidad)
  v_phone_normalized := v_lead.phone_normalized;  -- phone tampoco
  v_specialty_id     := COALESCE(
    NULLIF(p_overrides->>'specialty_id', '')::uuid,
    v_lead.specialty_id
  );
  v_clinic_name      := COALESCE(
    NULLIF(btrim(p_overrides->>'clinic_name'), ''),
    v_lead.clinic_name,
    'Consultorio Dr. ' || v_full_name
  );
  v_address_line     := COALESCE(
    NULLIF(btrim(p_overrides->>'address_line'), ''),
    v_lead.address_line
  );
  v_dept_id          := COALESCE(NULLIF(p_overrides->>'department_id', ''), v_lead.department_id);
  v_muni_id          := COALESCE(NULLIF(p_overrides->>'municipality_id', ''), v_lead.municipality_id);

  -- Validar specialty si fue provista
  IF v_specialty_id IS NOT NULL THEN
    PERFORM 1 FROM specialties WHERE id = v_specialty_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La especialidad indicada no existe en el catálogo' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  -- ─── 3. Crear auth.users "dormant" ───
  -- Confirmaciones en NULL: el médico confirma su phone cuando hace OTP
  -- en el flujo de Reclamar perfil. Sin encrypted_password = sin password
  -- inicial (lo crea durante el reclamo, Fase 4 PR-B).
  v_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    phone,
    encrypted_password,
    email_confirmed_at,
    phone_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    email_change_token_current,
    recovery_token,
    phone_change,
    phone_change_token,
    reauthentication_token
  ) VALUES (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_email,
    v_phone_normalized,
    NULL,
    NULL,
    NULL,
    '{"provider": "phone", "providers": ["phone"]}'::jsonb,
    jsonb_build_object(
      'full_name',     v_full_name,
      'created_via',   'admin_approve_and_create_doctor',
      'source_request_id', p_request_id
    ),
    now(),
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    ''
  );

  -- ─── 4. UPSERT profile ───
  -- Si existe trigger handle_new_user, ya creó un profile con
  -- role='patient' y full_name=''. UPSERT garantiza role='doctor' y
  -- datos correctos. Si no existe trigger, el INSERT crea el profile.
  INSERT INTO profiles (id, full_name, email, phone, role)
  VALUES (v_user_id, v_full_name, v_email, v_phone_normalized, 'doctor')
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email     = COALESCE(profiles.email, EXCLUDED.email),
    phone     = COALESCE(profiles.phone, EXCLUDED.phone),
    role      = 'doctor'::user_role,
    updated_at = now();
  v_profile_id := v_user_id;

  -- ─── 5. Crear clinic (auto, is_active=true para que aparezca en
  --      directorio cuando admin la publique después) ───
  INSERT INTO clinics (
    name, address_line, phone, owner_id, is_active,
    department_id, municipality_id
  ) VALUES (
    v_clinic_name, v_address_line, v_phone_normalized,
    v_profile_id, true,
    v_dept_id, v_muni_id
  ) RETURNING id INTO v_clinic_id;

  -- ─── 6. Crear clinic_member como owner ───
  INSERT INTO clinic_members (clinic_id, profile_id, role, is_active)
  VALUES (v_clinic_id, v_profile_id, 'owner'::clinic_member_role, true);

  -- ─── 7. Crear doctor en listed_only ───
  -- Todos los flags conservadores: no publicado, no operativo, no booking.
  -- is_verified es GENERATED de lucy_status='verified' (s7_03).
  INSERT INTO doctors (
    profile_id, clinic_id, specialty_id, license_number,
    lucy_status, is_published, is_operational, booking_enabled
  ) VALUES (
    v_profile_id, v_clinic_id, v_specialty_id, v_lead.license_number,
    'listed_only'::lucy_status, false, false, false
  ) RETURNING id INTO v_doctor_id;

  -- ─── 8. Vincular lead ───
  UPDATE doctor_affiliation_requests
     SET doctor_id   = v_doctor_id,
         clinic_id   = v_clinic_id,
         reviewed_by = COALESCE(reviewed_by, auth.uid()),
         reviewed_at = COALESCE(reviewed_at, now()),
         updated_at  = now()
   WHERE id = p_request_id;

  -- ─── 9. Audit log ───
  INSERT INTO audit_log (user_id, action, table_name, record_id, new_data)
  VALUES (
    auth.uid(),
    'insert'::audit_action,
    'doctors',
    v_doctor_id,
    jsonb_build_object(
      'lucy_status',        'listed_only',
      'profile_id',         v_profile_id,
      'clinic_id',          v_clinic_id,
      'license_number',     v_lead.license_number,
      'specialty_id',       v_specialty_id,
      'edited_via',         'admin_approve_and_create_doctor',
      'source_request_id',  p_request_id,
      'auth_user_dormant',  true
    )
  );

  -- También audit del cambio en la solicitud
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(),
    'update'::audit_action,
    'doctor_affiliation_requests',
    p_request_id,
    jsonb_build_object('doctor_id', NULL, 'clinic_id', NULL),
    jsonb_build_object(
      'doctor_id',  v_doctor_id,
      'clinic_id',  v_clinic_id,
      'edited_via', 'admin_approve_and_create_doctor'
    )
  );

  RETURN jsonb_build_object(
    'success',    true,
    'doctor_id',  v_doctor_id,
    'clinic_id',  v_clinic_id,
    'profile_id', v_profile_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_approve_and_create_doctor(uuid, jsonb) TO authenticated;
