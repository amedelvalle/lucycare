-- ============================================================
-- s7_91 · MULTICOUNTRY-GEO-P0 · FUNDACION 3B · paso 2 de 3
-- Ubicacion EMPAREJADA en admin_approve_and_create_doctor
-- ============================================================
--
-- Migracion 112. CREATE OR REPLACE de admin_approve_and_create_doctor con el
-- cuerpo VERBATIM de s7_64 salvo TRES hunks, marcados (s7_91):
--   (1) DECLARE: dos variables con el override territorial crudo;
--   (2) la resolucion de departamento y municipio, que sustituye las dos lineas
--       COALESCE de s7_64 (L147-L148);
--   (3) un bloque de validacion de la ubicacion final, despues de la
--       clasificacion y antes de la primera escritura.
-- Todo lo demas —gates, email, especialidad, clasificacion, ramas new/reuse,
-- credencial, vinculo del lead, auditoria y retorno— es IDENTICO a s7_64. Firma,
-- tipo de retorno, SECURITY DEFINER, search_path, dueño y privilegios no cambian:
-- CREATE OR REPLACE conserva los grants, y esta migracion no emite ninguno.
--
-- ── EL BUG QUE CORRIGE ──
-- s7_64 resuelve cada campo POR SEPARADO:
--     v_dept_id := COALESCE(override.department_id,   lead.department_id)
--     v_muni_id := COALESCE(override.municipality_id, lead.municipality_id)
-- En LucyAdmin, cambiar el departamento del override vacia el municipio; el
-- service omite las claves vacias; y el RPC recupera el municipio del LEAD, que
-- pertenece a OTRO departamento. Resultado: una clinica con departamento del
-- override y municipio heredado del lead, guardada sin error.
--
-- ── SEMANTICA NUEVA ──
--   1. sin departamento en el override -> se conserva el par del lead;
--   2. override con departamento -> el municipio sale SOLO del override;
--   3. override con departamento y municipio omitido o vacio -> municipio NULL;
--   4. nunca se hereda el municipio del lead despues de cambiar de departamento;
--   5. municipio sin departamento -> P0024 (override con municipio y sin
--      departamento, o par final con municipio y sin departamento);
--   6. departamento + municipio -> se valida que municipalities.department_id
--      coincida; si no, o si el municipio no existe -> P0025;
--   7. ninguna otra semantica cambia. Las validaciones nuevas corren DESPUES de
--      todas las existentes, asi que una solicitud con varios problemas sigue
--      recibiendo el mismo error que hoy.
-- Las reglas 5 y 6 se aplican al par FINAL, venga del override o del lead: un
-- lead con par incoherente —solo posible por la RPC publica— tambien aborta.
-- Preflight del 2026-09-13: 0 solicitudes con par incoherente.
--
-- ── QUE NO HACE ──
-- No toca country_id ni territory_unit_id · no crea helper ni trigger · no retira
-- la guarda de F3A · sin backfill · sin UI · no toca profiles,
-- doctor_affiliation_requests (esquema ni datos), clinics existentes ni SEO.
--
-- ── COMO APLICARLA ──
-- BLOQUES AUTONOMOS, cada uno pegado ENTERO en una pestaña nueva:
--   PASO 1 = seccion 0          · guardas PRE · solo lectura
--   PASO 2 = secciones 1 a 3    · BEGIN -> GUARDA -> CREATE OR REPLACE -> POST -> COMMIT
-- Si el PASO 1 lanza excepcion, NO continuar.


-- ─── 0. Guardas PRE (solo lectura) ──────────────────────────
DO $PRE$
DECLARE
  v_n bigint;
  r   record;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_approve_and_create_doctor';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_91 PRE: esperaba 1 definicion de admin_approve_and_create_doctor, hay %', v_n;
  END IF;

  SELECT pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_function_result(p.oid)             AS retorno,
         p.prosecdef                               AS definer,
         lower(replace(coalesce(array_to_string(p.proconfig, ','), ''), ' ', '')) AS config,
         md5(p.prosrc)                             AS huella,
         coalesce(p.proacl::text, 'NULL')          AS acl
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_approve_and_create_doctor';

  IF r.args IS DISTINCT FROM 'p_request_id uuid, p_overrides jsonb' THEN
    RAISE EXCEPTION 's7_91 PRE: firma inesperada (%)', r.args;
  END IF;
  IF r.retorno IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 's7_91 PRE: retorno inesperado (%)', r.retorno;
  END IF;
  IF r.definer IS DISTINCT FROM true THEN
    RAISE EXCEPTION 's7_91 PRE: la funcion deberia ser SECURITY DEFINER';
  END IF;
  IF r.config IS DISTINCT FROM 'search_path=public,auth' THEN
    RAISE EXCEPTION 's7_91 PRE: search_path inesperado (%)', r.config;
  END IF;
  -- El cuerpo VIVO es exactamente el de s7_64 (con LF o con CRLF).
  IF r.huella NOT IN ('1e3d840fff8bdfc1a7e7b0dbf245fb14', '73ffe4972c87e3ca580a8e40778d1328') THEN
    RAISE EXCEPTION 's7_91 PRE: la definicion viva no es la de s7_64 (md5=%) — no reaplicar', r.huella;
  END IF;

  SELECT count(*) INTO v_n FROM pg_proc WHERE prosrc ~ 'P002[45]';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_91 PRE: P0024/P0025 ya se usan en % funcion(es)', v_n;
  END IF;

  -- Secuencia de F3B: s7_90 aplicada y guarda F3A en pie.
  IF NOT EXISTS (SELECT 1 FROM public.municipalities
                  WHERE id = 'CH-16' AND name = 'San Miguel de Mercedes') THEN
    RAISE EXCEPTION 's7_91 PRE: s7_90 no esta aplicada (CH-16)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'clinics_geo_f3a_temp_null_chk'
                    AND conrelid = 'public.clinics'::regclass AND convalidated) THEN
    RAISE EXCEPTION 's7_91 PRE: la guarda temporal de F3A no esta en pie';
  END IF;

  RAISE NOTICE 's7_91: guardas PRE OK — cuerpo vivo = s7_64 (md5 %), acl %', r.huella, r.acl;
END $PRE$;


-- ═══════════════════════════════════════════════════════════
-- PASO 2 · EL CAMBIO — secciones 1 a 3, en UNA transaccion
-- ═══════════════════════════════════════════════════════════
BEGIN;


-- ─── 1. Guarda y huellas previas ─────────────────────────────
DO $GUARDA$
DECLARE
  r record;
BEGIN
  SELECT md5(p.prosrc) AS huella, coalesce(p.proacl::text, 'NULL') AS acl,
         pg_get_userbyid(p.proowner) AS dueno
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_approve_and_create_doctor';
  IF NOT FOUND THEN
    RAISE EXCEPTION 's7_91 GUARDA: no existe admin_approve_and_create_doctor';
  END IF;
  IF r.huella NOT IN ('1e3d840fff8bdfc1a7e7b0dbf245fb14', '73ffe4972c87e3ca580a8e40778d1328') THEN
    RAISE EXCEPTION 's7_91 GUARDA: la definicion viva no es la de s7_64';
  END IF;

  PERFORM set_config('s7_91.acl', r.acl, true);
  PERFORM set_config('s7_91.dueno', r.dueno, true);
  -- Huella de TODAS las demas funciones de public: ninguna puede cambiar.
  PERFORM set_config('s7_91.otras_funciones',
    (SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                           || md5(p.prosrc) || coalesce(p.proacl::text, ''), ','
                           ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname <> 'admin_approve_and_create_doctor'), true);

  RAISE NOTICE 's7_91 GUARDA: cuerpo vivo = s7_64, huellas tomadas';
END $GUARDA$;


-- ─── 2. La funcion: cuerpo de s7_64 + tres hunks (s7_91) ─────
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
  -- (s7_91) override territorial crudo: decide de que fuente sale el par.
  v_ov_dept_id        text;
  v_ov_muni_id        text;
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
  -- (s7_91) Ubicacion EMPAREJADA: departamento y municipio salen de la MISMA
  -- fuente. Si el override trae departamento, el municipio sale SOLO del
  -- override (NULL si no viene): nunca se hereda el municipio del lead despues
  -- de cambiar de departamento. Sin departamento en el override se conserva el
  -- par del lead. Las validaciones van despues de la clasificacion.
  v_ov_dept_id := NULLIF(p_overrides->>'department_id', '');
  v_ov_muni_id := NULLIF(p_overrides->>'municipality_id', '');
  IF v_ov_dept_id IS NOT NULL THEN
    v_dept_id := v_ov_dept_id;
    v_muni_id := v_ov_muni_id;
  ELSE
    v_dept_id := v_lead.department_id;
    v_muni_id := v_lead.municipality_id;
  END IF;

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

  -- ─── (s7_91) Validar la ubicacion final, antes de cualquier escritura ───
  -- Despues de las validaciones previas, para no cambiar que error recibe hoy
  -- una solicitud con varios problemas a la vez.
  IF v_ov_muni_id IS NOT NULL AND v_ov_dept_id IS NULL THEN
    RAISE EXCEPTION 'El override trae municipio sin departamento' USING ERRCODE = 'P0024';
  END IF;
  IF v_muni_id IS NOT NULL AND v_dept_id IS NULL THEN
    RAISE EXCEPTION 'El municipio no puede quedar sin departamento' USING ERRCODE = 'P0024';
  END IF;
  IF v_muni_id IS NOT NULL THEN
    PERFORM 1 FROM municipalities WHERE id = v_muni_id AND department_id = v_dept_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El municipio no existe o no pertenece al departamento indicado' USING ERRCODE = 'P0025';
    END IF;
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

-- ─── 3. Guardas POST — DENTRO de la transaccion ────────────────
DO $POST$
DECLARE
  v_n bigint;
  r   record;
  v_txt text;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_approve_and_create_doctor';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 's7_91 POST: esperaba 1 definicion, hay % (¿sobrecarga nueva?)', v_n;
  END IF;

  SELECT pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_function_result(p.oid)             AS retorno,
         p.prosecdef                               AS definer,
         lower(replace(coalesce(array_to_string(p.proconfig, ','), ''), ' ', '')) AS config,
         md5(p.prosrc)                             AS huella,
         coalesce(p.proacl::text, 'NULL')          AS acl,
         pg_get_userbyid(p.proowner)               AS dueno
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_approve_and_create_doctor';

  -- El cuerpo vivo es EXACTAMENTE el de esta migracion (con LF o con CRLF).
  IF r.huella NOT IN ('a249f92a4b7d3388ee49a11f56edb4b3', 'd36698a985b73a457b87bfa12b23cb75') THEN
    RAISE EXCEPTION 's7_91 POST: el cuerpo vivo no es el de s7_91 (md5=%)', r.huella;
  END IF;

  IF r.args IS DISTINCT FROM 'p_request_id uuid, p_overrides jsonb'
     OR r.retorno IS DISTINCT FROM 'jsonb'
     OR r.definer IS DISTINCT FROM true
     OR r.config IS DISTINCT FROM 'search_path=public,auth' THEN
    RAISE EXCEPTION 's7_91 POST: cambio la firma, el retorno, SECURITY DEFINER o el search_path';
  END IF;

  IF r.acl IS DISTINCT FROM current_setting('s7_91.acl') THEN
    RAISE EXCEPTION 's7_91 POST: cambiaron los privilegios (% -> %)', current_setting('s7_91.acl'), r.acl;
  END IF;
  IF r.dueno IS DISTINCT FROM current_setting('s7_91.dueno') THEN
    RAISE EXCEPTION 's7_91 POST: cambio el dueño de la funcion';
  END IF;

  SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                        || md5(p.prosrc) || coalesce(p.proacl::text, ''), ','
                        ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)))
    INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname <> 'admin_approve_and_create_doctor';
  IF v_txt IS DISTINCT FROM current_setting('s7_91.otras_funciones') THEN
    RAISE EXCEPTION 's7_91 POST: cambio alguna otra funcion de public';
  END IF;

  -- Fuera de alcance, intacto.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'clinics_geo_f3a_temp_null_chk'
                    AND conrelid = 'public.clinics'::regclass AND convalidated) THEN
    RAISE EXCEPTION 's7_91 POST: la guarda temporal de F3A no esta en pie';
  END IF;
  SELECT count(*) INTO v_n FROM public.clinics WHERE country_id IS NOT NULL OR territory_unit_id IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_91 POST: % clinicas con columnas territoriales nuevas', v_n; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.clinics'::regclass
                AND NOT tgisinternal AND tgname <> 'trg_clinics_updated_at') THEN
    RAISE EXCEPTION 's7_91 POST: clinics tiene un trigger nuevo';
  END IF;

  RAISE NOTICE 's7_91: guardas POST OK — cuerpo = s7_91 (md5 %), firma/retorno/definer/search_path/dueño/acl intactos, resto de funciones sin cambios, F3A intacta', r.huella;
END $POST$;


COMMIT;
-- ═══════════════════════════════════════════════════════════
-- FIN DEL PASO 2.
-- El POST corre DENTRO de la transaccion: si una guarda lanza, la funcion vuelve
-- a su definicion de s7_64.
-- ═══════════════════════════════════════════════════════════
