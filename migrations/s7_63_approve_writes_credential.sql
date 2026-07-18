-- ═══════════════════════════════════════════════════════════
-- Migración S7-63: F1-c / PR A — el approve escribe la credencial
--                  JVPM directamente (desacoplamiento del trigger)
-- ═══════════════════════════════════════════════════════════
-- CONTEXTO (preflight F1-c, handoff 2026-07-18 §4):
-- `admin_approve_and_create_doctor` (s7_42, vigente) INSERTA
-- `doctors.license_number`, y la credencial JVPM del médico nuevo la crea
-- SOLO el trigger `trg_sync_license_to_credential` (s7_61/s7_62) al
-- dispararse ese INSERT. Eso encadena el orden de F1-c: si PR B cortara el
-- dual-write (drop del trigger) sin este PR, los médicos nuevos nacerían
-- SIN credencial.
--
-- ESTA MIGRACIÓN (cambio mínimo, 2 puntos de diff sobre s7_42):
--   CREATE OR REPLACE de `admin_approve_and_create_doctor` con el cuerpo
--   VERBATIM de s7_42 salvo:
--     (1) DECLARE: variable nueva `v_constraint` (para mapear P0091);
--     (2) tras el INSERT de `doctors`: bloque que INSERTA la credencial
--         JVPM DIRECTAMENTE en `doctor_credentials`.
--
-- CONVIVENCIA CON EL TRIGGER (transitoria, hasta PR B):
--   El trigger AFTER INSERT ya corrió al completarse el INSERT de doctors
--   (los triggers AFTER ROW se disparan al final de la SENTENCIA, no de la
--   transacción), así que cuando este bloque ejecuta, la credencial YA
--   existe con el MISMO valor. El `ON CONFLICT (doctor_id, type)` arbitra
--   contra `doctor_credentials_one_per_type`: Postgres PRE-chequea el índice
--   árbitro y, al encontrar el conflicto, toma `DO NOTHING` SIN intentar el
--   insert físico → `doctor_credentials_registry_uniq` nunca se evalúa
--   contra la propia fila, no hay churn, no se dispara el audit de
--   doctor_credentials → CERO cambio observable respecto de s7_42.
--   Cuando PR B dropee el trigger, este INSERT pasa a ser el ÚNICO escritor
--   de la credencial en el alta por afiliación.
--
-- ANTIFRAUDE (paridad con el trigger de s7_62): si el JVPM del lead ya
-- pertenece a OTRO médico, hoy el trigger lanza P0091 durante el INSERT de
-- doctors (antes de llegar a este bloque). Post-PR B, ese INSERT ya no
-- valida nada → el handler de este bloque toma el relevo: la colisión de
-- `doctor_credentials_registry_uniq` se mapea al MISMO P0091 estable (que
-- el frontend ya traduce vía mapCreateError); cualquier otro
-- unique_violation se re-lanza intacto. El comportamiento observable del
-- flujo es idéntico antes y después de PR B.
--
-- SIN CAMBIOS: `_affiliation_classify` y `admin_affiliation_preflight`
-- (s7_42) NO se re-emiten. `doctors.license_number` se SIGUE escribiendo
-- (la retira PR B / el DROP es PR C). El trigger NO se toca. Claim,
-- frontend, importadores, tipos y scripts: intactos (alcance de PR B/C).
-- Firma, gates (42501/P0001/P0002/P0003/P0004/P0005/P0010–P0013), branches
-- new/reuse_patient, audit y retorno: IDÉNTICOS a s7_42.
--
-- Verificación: node scripts/check-s7_63.mjs + node scripts/_smoke-s7_63.mjs
--               + A/B del owner en SQL Editor (ver bloque al final).
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
  INSERT INTO doctors (
    profile_id, clinic_id, specialty_id, license_number,
    lucy_status, is_published, is_operational, booking_enabled
  ) VALUES (
    v_profile_id, v_clinic_id, v_specialty_id, v_lead.license_number,
    'listed_only'::lucy_status, false, false, false
  ) RETURNING id INTO v_doctor_id;

  -- ─── (s7_63) doctor_credentials: escritura DIRECTA de la credencial ───
  -- Hace al approve AUTOSUFICIENTE: no depende del trigger para que el
  -- médico nuevo tenga su credencial JVPM. Mientras el trigger exista
  -- (hasta PR B), el ON CONFLICT DO NOTHING absorbe esta segunda escritura
  -- sin churn (ver cabecera). Espejo del trigger de s7_62: mismo btrim,
  -- mismo status 'pending', mismo mapeo de la colisión antifraude a P0091.
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
-- Verificación automatizada:
--   node scripts/check-s7_63.mjs
--   node scripts/_smoke-s7_63.mjs
--
-- Verificación A/B del OWNER en el SQL Editor (UNA SOLA ejecución cada
-- bloque; el SQL Editor corre cada ejecución en su propia sesión y un
-- BEGIN separado del ROLLBACK haría rollback automático igual, pero el
-- test debe ser atómico). Prueba la AUTOSUFICIENCIA simulando el mundo
-- post-PR B (trigger deshabilitado) y se revierte entera:
--
--   • Corrida A (ANTES de aplicar s7_63, contra la RPC vieja):
--     el mismo bloque debe terminar con cred_count = 0 → reproduce el
--     problema ("sin trigger, el médico nace sin credencial").
--   • Corrida B (DESPUÉS de aplicar s7_63): cred_count = 1, status
--     'pending' → el approve es autosuficiente.
--
--   (El bloque usa SET LOCAL request.jwt.claims con el sub del admin real
--    para que auth.uid()/is_admin() funcionen dentro de la transacción, y
--    ALTER TABLE ... DISABLE TRIGGER — ambos se deshacen con el ROLLBACK.
--    Nada persiste. Ver el texto exacto del bloque en el PR.)
--
-- SIGUE (NO en este PR):
--   PR B (F1-c1): claim sin fallback · frontend sin columnFallback ·
--     import-doctors.mjs escribe la credencial · DROP del trigger.
--   PR C (F1-c2): DROP de doctors.license_number (previa re-verificación
--     de sincronía §6 + respaldo) · tipos · scripts.
-- ───────────────────────────────────────────────────────────
