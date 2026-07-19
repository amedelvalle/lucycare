-- ═══════════════════════════════════════════════════════════
-- Migración S7-64: F1-c / PR B — retiro lógico de doctors.license_number
--                  (cierra F1-c1: cero lectores y cero escritores
--                   operativos de la columna; la columna NO se dropea)
-- ═══════════════════════════════════════════════════════════
-- CONTEXTO: s7_61 (modelo doctor_credentials + dual-write) · s7_62 (cutover
-- de lectores con fallback) · s7_63 (el approve escribe la credencial
-- directamente). Sincronía columna ↔ credencial verificada por el owner
-- (2026-07-18): 114/114/114, 0 drift, 0 faltantes, 0 duplicados.
--
-- ── QUÉ HACE (3 piezas) ──
--   1. admin_approve_and_create_doctor — CREATE OR REPLACE, cuerpo VERBATIM
--      de s7_63 salvo DOS hunks: (a) el INSERT de doctors deja de escribir
--      license_number (la columna queda NULL para médicos nuevos); (b) el
--      audit REDACTA el valor ('license_number' texto plano → 'has_license'
--      boolean, principio de s7_61; históricos intactos). La escritura
--      directa de la credencial (s7_63) se conserva intacta y pasa a ser la
--      ÚNICA fuente de la credencial en el alta por afiliación.
--   2. claim_doctor_profile — CREATE OR REPLACE, cuerpo VERBATIM de s7_62
--      salvo TRES hunks conectados que retiran el fallback: (a) DECLARE
--      pierde v_doctor_license; (b) el SELECT de la sección 2 deja de leer
--      d.license_number; (c) la sección 5 sin fila JVPM ya NO cae a la
--      columna → v_effective_license = NULL → P0006 (revisión manual).
--      La regla vinculante de F1-b se conserva: pending/verified se usan,
--      rejected NO se usa; lo que muere es el "si no hay fila, mirá la
--      columna".
--   3. Corte del dual-write — DROP del trigger trg_sync_license_to_credential
--      Y de su función sync_license_to_credential() (sin lógica obsoleta).
--
-- ── DESPUÉS DE ESTA MIGRACIÓN ──
--   • Ningún objeto de DB LEE ni ESCRIBE doctors.license_number en runtime.
--   • La columna sigue EXISTIENDO (con sus 114 valores históricos congelados)
--     como red de seguridad. El DROP físico es F1-c2 (PR C), con
--     re-verificación de sincronía + respaldo como precondiciones.
--   • El frontend (mismo PR) retira columnFallback de resolveJvpm y deja de
--     pedir license_number en los selects de panel/receta.
--   • import-doctors.mjs (mismo PR) deduplica por doctor_credentials y crea
--     la credencial directamente; ya no escribe la columna.
--
-- ── ORDEN SEGURO (por qué esto no rompe nada) ──
--   • s7_63 ya está LIVE: el approve escribe la credencial por su cuenta →
--     cortar el trigger no deja a ningún médico nuevo sin credencial.
--   • Sincronía 0-drift + 114/114 con credencial → retirar el fallback no
--     deja a ningún médico existente sin licencia (nadie dependía de él).
--   • El frontend nuevo (sin fallback) es compatible con la DB anterior y
--     con ésta: en ambas, toda lectura resuelve desde doctor_credentials.
--
-- ── NO TOCA ──
-- doctors.license_number (la columna y sus datos quedan; DROP = PR C) ·
-- grants de s7_60 (el SELECT residual muere con la columna en PR C) ·
-- doctor_credentials (tabla/RLS/grants/audit/índices intactos) ·
-- doctor_affiliation_requests.license_number (OTRA tabla: la licencia del
-- lead se sigue capturando, mostrando en la bandeja y usando como fuente de
-- la credencial) · OTP · TOS · roles · publicación · auth.users · datos.
--
-- ── REVERSIBLE ──
-- Re-aplicar s7_63 (approve) + s7_62 (claim + trigger/función). Sin pérdida
-- de datos: la columna conserva sus valores históricos.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. admin_approve_and_create_doctor — sin escritura de la columna ──
-- Cuerpo VERBATIM de s7_63 salvo DOS hunks:
--   (a) el INSERT de doctors pierde license_number;
--   (b) el payload de audit_log REDACTA el valor: 'license_number' (texto
--       plano, herencia de s7_22) → 'has_license' boolean. Mismo principio
--       que el audit de doctor_credentials (s7_61): el secreto no se
--       duplica en audit_log. Los registros HISTÓRICOS no se modifican
--       (audit_log es append-only por diseño).
-- Gates, ramas new/reuse, credencial directa, P0091 y retorno: IDÉNTICOS.
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
  -- (s7_63) nombre de la constraint que colisionó, para mapear P0091.
  v_constraint        text;
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
  -- (s7_64) F1-c1: license_number YA NO se escribe — la columna queda NULL
  -- para todo médico nuevo. La licencia del lead vive en doctor_credentials
  -- (bloque siguiente), que es la única fuente que leen panel/receta/claim.
  INSERT INTO doctors (
    profile_id, clinic_id, specialty_id,
    lucy_status, is_published, is_operational, booking_enabled
  ) VALUES (
    v_profile_id, v_clinic_id, v_specialty_id,
    'listed_only'::lucy_status, false, false, false
  ) RETURNING id INTO v_doctor_id;

  -- ─── (s7_63) doctor_credentials: escritura DIRECTA de la credencial ───
  -- Única fuente de la credencial en el alta por afiliación (el trigger de
  -- dual-write se elimina en esta misma migración). Mismo btrim, mismo
  -- status 'pending', mismo mapeo de la colisión antifraude a P0091.
  IF v_lead.license_number IS NOT NULL AND btrim(v_lead.license_number) <> '' THEN
    BEGIN
      INSERT INTO doctor_credentials (doctor_id, type, value, status)
      VALUES (v_doctor_id, 'JVPM', btrim(v_lead.license_number), 'pending')
      ON CONFLICT (doctor_id, type) WHERE type IN ('JVPM', 'NUE')
      DO NOTHING;
    EXCEPTION
      WHEN unique_violation THEN
        -- Item correcto = CONSTRAINT_NAME (sin prefijo PG_; ese solo lo
        -- llevan PG_EXCEPTION_DETAIL / _HINT / _CONTEXT).
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint = 'doctor_credentials_registry_uniq' THEN
          RAISE EXCEPTION 'Ese número de licencia (JVPM) ya está registrado para otro médico.'
            USING ERRCODE = 'P0091';
        ELSE
          RAISE;
        END IF;
    END;
  END IF;

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
      -- (s7_64) REDACTADO: el JVPM ya no se escribe en texto plano en el
      -- audit (principio de s7_61); queda solo la señal booleana.
      'has_license',        (v_lead.license_number IS NOT NULL AND btrim(v_lead.license_number) <> ''),
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

-- ─── 2. claim_doctor_profile — sin fallback a la columna ──────────────
-- Cuerpo VERBATIM de s7_62 salvo TRES hunks conectados:
--   (a) DECLARE pierde v_doctor_license;
--   (b) la sección 2 deja de leer d.license_number;
--   (c) la sección 5 sin fila JVPM → NULL (P0006), sin mirar la columna.
-- Regla F1-b intacta: pending/verified se usan; rejected NO. P0001–P0007,
-- OTP, TOS, roles, vinculación y audit IDÉNTICOS.
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
  v_doctor_phone_norm         text;
  v_typed_license_norm        text;
  v_doctor_license_norm       text;
  v_tos_version               text := nullif(btrim(coalesce(p_tos_version, '')), '');
  -- F1-c1: la ÚNICA fuente de la licencia es doctor_credentials.
  v_cred_license              text;
  v_cred_status               credential_status;
  v_effective_license         text;
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
  -- (s7_64) Ya NO se lee d.license_number: el claim no tiene ningún lector
  -- de la columna.
  SELECT
    d.profile_id,
    d.clinic_id,
    d.lucy_status,
    regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') AS profile_phone_norm
  INTO
    v_doctor_profile_id,
    v_doctor_clinic_id,
    v_doctor_lucy_status,
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

  -- ─── 5. License match — F1-c1: fuente ÚNICA = doctor_credentials ─
  -- Regla (de F1-b, intacta): una credencial JVPM 'pending'/'verified' es
  -- utilizable; 'rejected' NO lo es. (s7_64) Sin fila JVPM ya NO hay
  -- fallback: v_effective_license queda NULL y cae a P0006 (revisión
  -- manual). one_per_type garantiza ≤1 fila JVPM. El valor se compara en
  -- variable interna y NUNCA se devuelve.
  SELECT dc.value, dc.status
    INTO v_cred_license, v_cred_status
  FROM doctor_credentials dc
  WHERE dc.doctor_id = p_doctor_id AND dc.type = 'JVPM'
  LIMIT 1;

  IF FOUND THEN
    -- La credencial existe: su ESTADO manda.
    IF v_cred_status = 'rejected' THEN
      v_effective_license := NULL;                              -- rechazada ⇒ inutilizable
    ELSE
      v_effective_license := NULLIF(btrim(v_cred_license), ''); -- pending / verified
    END IF;
  ELSE
    -- (s7_64) No hay fila JVPM → no hay licencia utilizable. La columna ya
    -- no se consulta (el fallback murió con F1-c1).
    v_effective_license := NULL;
  END IF;

  v_doctor_license_norm := upper(regexp_replace(coalesce(v_effective_license, ''), '\s', '', 'g'));
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

-- ─── 3. Corte del dual-write ──────────────────────────────────────────
-- El trigger deja de existir Y su función también (sin lógica obsoleta).
-- Desde acá, doctors.license_number no tiene NINGÚN escritor operativo:
-- el approve escribe la credencial directamente (§1), import-doctors.mjs
-- la escribe directamente (mismo PR), y el mapeo P0091 del antifraude vive
-- en el bloque directo del approve (§1) y en la constraint misma
-- (doctor_credentials_registry_uniq) para cualquier otro escritor.
DROP TRIGGER IF EXISTS trg_sync_license_to_credential ON doctors;
DROP FUNCTION IF EXISTS sync_license_to_credential();

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- Verificación:
--   node scripts/check-s7_64.mjs     -- estructural (sin service_role)
--   node scripts/_smoke-s7_64.mjs    -- E2E (requiere autorización de
--                                       service_role; correr A/B: antes de
--                                       aplicar reproduce el estado viejo,
--                                       después debe dar todo verde)
--
-- Verificación del OWNER en SQL Editor (trigger y función eliminados):
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.doctors'::regclass AND NOT tgisinternal;
--   -- esperado: trg_doctors_updated_at, trg_set_doctor_slug (SIN
--   --           trg_sync_license_to_credential)
--   SELECT proname FROM pg_proc WHERE proname = 'sync_license_to_credential';
--   -- esperado: 0 filas
--
-- SIGUE (F1-c2 / PR C, NO en este PR):
--   re-verificación de sincronía §6 + respaldo → DROP COLUMN
--   doctors.license_number (el grant residual de authenticated muere con la
--   columna) → database.types.ts → scripts de test históricos.
-- ═══════════════════════════════════════════════════════════
