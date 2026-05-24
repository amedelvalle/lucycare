-- ═══════════════════════════════════════════════════════════
-- Migración S7-13: Reclamo seguro del perfil del médico
-- ═══════════════════════════════════════════════════════════
-- Reemplaza el flujo cliente-only de claimProfile.service.ts por
-- una RPC SECURITY DEFINER que valida server-side dos cosas:
--
--   1. Teléfono verificado de la sesión actual (auth.users.phone con
--      phone_confirmed_at NOT NULL) == teléfono del profile del médico
--      listado (normalizados con regexp \D).
--   2. Licencia tipeada == doctors.license_number
--      (case-insensitive, sin espacios).
--
-- Solo si ambos matchean, cambia ÚNICAMENTE:
--   - lucy_status: 'listed_only' → 'claimed'
--   - tos_accepted_at, tos_version
--   - vincula doctors.profile_id al auth.uid() actual
--   - asegura profiles.role='doctor' del auth.uid() actual
--   - upsert clinic_members como 'owner'
--
-- NUNCA toca:
--   - is_verified (es GENERATED de lucy_status='verified')
--   - is_published
--   - booking_enabled
--   - is_operational
--   - services
--   - availability_rules
--
-- Audit log con edited_via='claim_self_service' y snapshots.
--
-- Errores tipados (SQLSTATE custom P0xxx) para que el frontend
-- mapee mensajes amigables:
--   P0001  no hay teléfono verificado en la sesión
--   P0002  doctor no encontrado
--   P0003  doctor ya reclamado / estado distinto a listed_only
--   P0004  profile del médico sin teléfono registrado
--   P0005  el teléfono de la sesión no coincide con el del médico
--   P0006  el médico no tiene licencia registrada
--   P0007  la licencia ingresada no coincide
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION claim_doctor_profile(
  p_doctor_id     uuid,
  p_license_typed text,
  p_tos_version   text DEFAULT 'v1.0'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id                   uuid := auth.uid();
  v_user_phone_norm           text;
  v_doctor_profile_id         uuid;
  v_doctor_clinic_id          uuid;
  v_doctor_lucy_status        lucy_status;
  v_doctor_license            text;
  v_doctor_phone_norm         text;
  v_typed_license_norm        text;
  v_doctor_license_norm       text;
  v_tos_version               text := nullif(btrim(coalesce(p_tos_version, '')), '');
BEGIN
  -- ─── 0. Auth ───
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión primero' USING ERRCODE = '28000';
  END IF;

  -- ─── 1. Teléfono verificado en auth.users de la sesión actual ───
  -- Solo aceptamos el phone que Supabase/Twilio ya confirmó (phone_confirmed_at).
  -- No confiamos en lo que el usuario tipea en el modal.
  SELECT regexp_replace(coalesce(au.phone, ''), '\D', '', 'g')
    INTO v_user_phone_norm
  FROM auth.users au
  WHERE au.id = v_user_id
    AND au.phone_confirmed_at IS NOT NULL;

  IF v_user_phone_norm IS NULL OR v_user_phone_norm = '' THEN
    RAISE EXCEPTION 'Para reclamar un perfil necesitás iniciar sesión con tu teléfono verificado por SMS'
      USING ERRCODE = 'P0001';
  END IF;

  -- ─── 2. Cargar doctor + profile vinculado (phone) ───
  SELECT
    d.profile_id,
    d.clinic_id,
    d.lucy_status,
    d.license_number,
    regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') AS profile_phone_norm
  INTO
    v_doctor_profile_id,
    v_doctor_clinic_id,
    v_doctor_lucy_status,
    v_doctor_license,
    v_doctor_phone_norm
  FROM doctors d
  LEFT JOIN profiles p ON p.id = d.profile_id
  WHERE d.id = p_doctor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil de médico no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- ─── 3. Solo se puede reclamar lo que está listed_only ───
  IF v_doctor_lucy_status IS DISTINCT FROM 'listed_only'::lucy_status THEN
    RAISE EXCEPTION 'Este perfil ya fue reclamado o tiene un estado distinto. Si creés que es un error, contactanos.'
      USING ERRCODE = 'P0003';
  END IF;

  -- ─── 4. Phone match (server-side, sobre lo verificado por Twilio) ───
  IF v_doctor_phone_norm IS NULL OR v_doctor_phone_norm = '' THEN
    RAISE EXCEPTION 'El perfil del médico no tiene teléfono registrado. Necesitamos revisarlo manualmente; contactanos.'
      USING ERRCODE = 'P0004';
  END IF;

  IF v_user_phone_norm <> v_doctor_phone_norm THEN
    RAISE EXCEPTION 'El teléfono con el que iniciaste sesión no coincide con el registrado para este perfil. Si sos el profesional, contactanos para revisión manual.'
      USING ERRCODE = 'P0005';
  END IF;

  -- ─── 5. License match (case-insensitive, sin espacios) ───
  v_doctor_license_norm := upper(regexp_replace(coalesce(v_doctor_license, ''), '\s', '', 'g'));
  v_typed_license_norm  := upper(regexp_replace(coalesce(p_license_typed, ''), '\s', '', 'g'));

  IF v_doctor_license_norm = '' THEN
    RAISE EXCEPTION 'El perfil del médico no tiene licencia registrada. Necesitamos revisarlo manualmente; contactanos.'
      USING ERRCODE = 'P0006';
  END IF;

  IF v_typed_license_norm = '' OR v_typed_license_norm <> v_doctor_license_norm THEN
    RAISE EXCEPTION 'La licencia ingresada no coincide con la registrada para este perfil. Si sos el profesional, contactanos para revisión manual.'
      USING ERRCODE = 'P0007';
  END IF;

  -- ─── 6. Vincular profile/doctor ───
  -- Caso normal (importados): doctor.profile_id == auth.uid() porque
  -- Supabase devolvió el auth.users existente al hacer OTP con el mismo phone.
  -- Caso seed/legacy: doctor.profile_id apunta a otro profile (sin auth.users).
  --   Re-apuntamos al auth.uid() actual y desactivamos el viejo profile huérfano.
  IF v_doctor_profile_id IS DISTINCT FROM v_user_id THEN
    -- Copiar datos no destructivos del profile viejo al actual si están vacíos
    UPDATE profiles AS me
      SET full_name  = COALESCE(NULLIF(btrim(me.full_name), ''), old.full_name),
          email      = COALESCE(me.email, old.email),
          avatar_url = COALESCE(me.avatar_url, old.avatar_url),
          updated_at = now()
    FROM profiles AS old
    WHERE me.id = v_user_id
      AND old.id = v_doctor_profile_id;

    -- Desactivar el profile huérfano para que no figure en listados
    IF v_doctor_profile_id IS NOT NULL THEN
      UPDATE profiles
         SET is_active = false,
             updated_at = now()
       WHERE id = v_doctor_profile_id;
    END IF;
  END IF;

  -- Asegurar role='doctor' en mi profile actual
  UPDATE profiles
     SET role = 'doctor'::user_role,
         updated_at = now()
   WHERE id = v_user_id;

  -- ─── 7. Update doctor: SOLO lucy_status + tos + profile_id ───
  -- NO tocar: is_published, booking_enabled, is_operational, is_verified, license_number.
  UPDATE doctors
     SET profile_id      = v_user_id,
         lucy_status     = 'claimed'::lucy_status,
         tos_accepted_at = now(),
         tos_version     = COALESCE(v_tos_version, tos_version, 'v1.0'),
         updated_at      = now()
   WHERE id = p_doctor_id;

  -- ─── 8. clinic_members como owner (idempotente) ───
  IF v_doctor_clinic_id IS NOT NULL THEN
    INSERT INTO clinic_members (clinic_id, profile_id, role, is_active)
    VALUES (v_doctor_clinic_id, v_user_id, 'owner'::clinic_member_role, true)
    ON CONFLICT (clinic_id, profile_id) DO UPDATE
      SET role = 'owner'::clinic_member_role,
          is_active = true;
  END IF;

  -- ─── 9. Audit log ───
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_user_id,
    'update'::audit_action,
    'doctors',
    p_doctor_id,
    jsonb_build_object(
      'lucy_status', v_doctor_lucy_status,
      'profile_id',  v_doctor_profile_id
    ),
    jsonb_build_object(
      'lucy_status',     'claimed',
      'profile_id',      v_user_id,
      'tos_version',     COALESCE(v_tos_version, 'v1.0'),
      'claimed_at',      now(),
      'edited_via',      'claim_self_service'
    )
  );

  RETURN jsonb_build_object(
    'success',     true,
    'doctor_id',   p_doctor_id,
    'lucy_status', 'claimed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION claim_doctor_profile(uuid, text, text) TO authenticated;

-- ─── Limpieza: la versión vieja que confiaba en el cliente queda
--      sin uso; el frontend la dejará de llamar. Si más adelante
--      querés purgarla, hacelo en una migración aparte. ──────────
