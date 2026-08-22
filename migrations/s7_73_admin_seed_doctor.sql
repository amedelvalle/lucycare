-- ═══════════════════════════════════════════════════════════
-- Migración S7-73: ADMIN-DOCTOR-SEED-P0 — perfil médico sembrado
-- ═══════════════════════════════════════════════════════════
-- LucyAdmin crea por anticipado un perfil profesional publicable, para
-- prospección comercial. El médico lo toma después con el Claim EXISTENTE,
-- que esta migración NO toca.
--
-- ── POR QUÉ HAY UN auth.user TÉCNICO ──
-- `public.profiles.id` tiene `FOREIGN KEY (id) REFERENCES auth.users(id)
-- ON DELETE CASCADE` (verificado en catálogo, 2026-08-22). Un profile sin
-- identidad Auth es IMPOSIBLE. La fila técnica es un requisito de la FK, no
-- una cuenta: sin teléfono, sin contraseña, sin confirmar, email `.invalid`
-- (RFC 2606, no resoluble) y BANEADA. La crea la Edge Function por
-- **Admin API**. Esta migración JAMÁS escribe `auth.users`.
--
-- ── QUÉ CREA ──
--   1. admin_seed_operations   — control de idempotencia y concurrencia
--   2. _seed_doctor_email()    — email técnico determinístico (privado)
--   3. admin_claim_seed_operation()        — reclamo atómico (PK)
--   4. admin_lookup_seed_user()            — recuperación determinista
--   5. admin_seed_operation_set_auth_created()  — transición CAS
--   6. admin_seed_operation_mark_failed()       — transición CAS
--   7. admin_create_seed_doctor()          — transacción de negocio
--
-- ── INVARIANTES FORZADAS SERVER-SIDE ──
--   • booking_enabled = false  ← LITERAL, jamás parámetro
--   • lucy_status     = 'listed_only'
--   • is_operational  = true   (para que el médico entre al panel tras el
--                               Claim sin intervención de LucyAdmin)
--   • is_published    = solo si el admin lo pide Y cumple D1
--   • NO se crea clinic_members (lo hace el Claim para la identidad real)
--   • NO se escribe doctors.license_number (deuda F1-c2; la fuente
--     canónica es doctor_credentials)
--
-- ── MÁQUINA DE ESTADOS ──
-- started → auth_created → completed ; started/auth_created → failed.
-- `completed` y `failed` son TERMINALES.
-- ⚠️ Los CHECK de la tabla validan la FORMA de cada estado, no la legalidad
-- de las transiciones. Lo que garantiza las transiciones es la combinación
-- de: (a) `authenticated` SIN DML directo sobre la tabla, y (b) las RPCs de
-- transición, que hacen compare-and-set bajo `FOR UPDATE`.
--
-- ── ERRORES TIPADOS ──
--   P0120 no autorizado
--   P0121 operación no encontrada
--   P0122 payload distinto para la misma operation_id
--   P0123 transición ilegal (estado terminal o inesperado)
--   P0124 seed_user_id distinto del ya persistido
--   P0125 el auth.user no es un seed válido de esta operación
--   P0126 el profile del seed no existe
--   P0127 el profile ya tiene doctor/patient/membership
--   P0128 teléfono de claim ya usado por otro médico
--   P0129 publicación pedida sin cumplir D1
--   P0130 especialidad inexistente
--   P0131 datos obligatorios faltantes
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 0. Guardas PRE (abortan la transacción completa) ───────
DO $$
BEGIN
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'PRE falló: is_admin() no existe';
  END IF;
  IF to_regprocedure('public.normalize_phone_sv(text)') IS NULL THEN
    RAISE EXCEPTION 'PRE falló: normalize_phone_sv(text) no existe (s7_40)';
  END IF;
  IF to_regclass('public.doctor_credentials') IS NULL THEN
    RAISE EXCEPTION 'PRE falló: doctor_credentials no existe (s7_61)';
  END IF;
  IF to_regclass('public.doctors') IS NULL OR to_regclass('public.clinics') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'PRE falló: faltan tablas núcleo';
  END IF;
END $$;

-- ─── 1. Tabla de operaciones ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_seed_operations (
  operation_id  uuid PRIMARY KEY,
  requested_by  uuid NOT NULL REFERENCES public.profiles(id),
  payload_hash  text NOT NULL,
  status        text NOT NULL DEFAULT 'started',
  seed_user_id  uuid,
  doctor_id     uuid REFERENCES public.doctors(id),
  clinic_id     uuid REFERENCES public.clinics(id),
  error_code    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT seedops_status_chk
    CHECK (status IN ('started', 'auth_created', 'completed', 'failed')),
  CONSTRAINT seedops_payload_hash_not_blank
    CHECK (btrim(payload_hash) <> ''),
  -- FORMA de cada estado (no legalidad de la transición: ver cabecera).
  CONSTRAINT seedops_completed_shape CHECK (
    status <> 'completed'
    OR (seed_user_id IS NOT NULL AND doctor_id IS NOT NULL AND clinic_id IS NOT NULL)),
  CONSTRAINT seedops_authcreated_shape CHECK (
    status <> 'auth_created' OR seed_user_id IS NOT NULL),
  CONSTRAINT seedops_failed_shape CHECK (
    status <> 'failed' OR btrim(coalesce(error_code, '')) <> '')
);

COMMENT ON TABLE public.admin_seed_operations IS
  'Control de idempotencia/concurrencia de la creación administrativa de '
  'perfiles médicos sembrados. La PK es la Idempotency-Key. Sin DML directo '
  'de cliente: solo las RPCs admin_* de esta migración escriben acá.';

CREATE INDEX IF NOT EXISTS idx_seedops_requested_by
  ON public.admin_seed_operations (requested_by, created_at DESC);

-- ─── 2. RLS y grants ────────────────────────────────────────
-- Sin DML de cliente: las transiciones SOLO ocurren por las RPCs.
ALTER TABLE public.admin_seed_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_seed_operations FROM PUBLIC;
REVOKE ALL ON public.admin_seed_operations FROM anon;
REVOKE ALL ON public.admin_seed_operations FROM authenticated;

DROP POLICY IF EXISTS seedops_select_admin ON public.admin_seed_operations;
CREATE POLICY seedops_select_admin ON public.admin_seed_operations
  FOR SELECT USING (public.is_admin());
-- Deliberadamente SIN policies de INSERT/UPDATE/DELETE.
GRANT SELECT ON public.admin_seed_operations TO authenticated;

-- ─── 3. Email técnico determinístico (helper privado) ───────
-- Determinístico ⇒ dado el operation_id se puede RECUPERAR el auth.user sin
-- enumerar. `.invalid` está reservado por RFC 2606: no resoluble, sin MX
-- posible, no registrable ⇒ ningún correo de recuperación puede entregarse.
CREATE OR REPLACE FUNCTION public._seed_doctor_email(p_operation_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT 'seed-' || p_operation_id::text || '@doctor-seed.invalid';
$$;

REVOKE ALL ON FUNCTION public._seed_doctor_email(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._seed_doctor_email(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._seed_doctor_email(uuid) FROM authenticated;

-- ─── 4. Reclamo atómico de la operación ─────────────────────
-- El INSERT sobre la PK ES el cerrojo: dos requests simultáneos con la misma
-- operation_id NO pueden avanzar ambos. El perdedor lee bajo FOR UPDATE.
CREATE OR REPLACE FUNCTION public.admin_claim_seed_operation(
  p_operation_id uuid,
  p_payload_hash text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row   public.admin_seed_operations%ROWTYPE;
  v_stale boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0120';
  END IF;
  IF p_operation_id IS NULL OR btrim(coalesce(p_payload_hash, '')) = '' THEN
    RAISE EXCEPTION 'operation_id y payload_hash son obligatorios' USING ERRCODE = 'P0131';
  END IF;

  INSERT INTO public.admin_seed_operations (operation_id, requested_by, payload_hash)
  VALUES (p_operation_id, auth.uid(), p_payload_hash)
  ON CONFLICT (operation_id) DO NOTHING;

  IF FOUND THEN
    RETURN jsonb_build_object('action', 'claimed', 'operation_id', p_operation_id);
  END IF;

  -- Perdimos la carrera (o es un retry): serializamos contra el ganador.
  SELECT * INTO v_row
  FROM public.admin_seed_operations
  WHERE operation_id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operación no encontrada' USING ERRCODE = 'P0121';
  END IF;

  IF v_row.payload_hash IS DISTINCT FROM p_payload_hash THEN
    RAISE EXCEPTION 'La misma operación fue iniciada con datos distintos'
      USING ERRCODE = 'P0122';
  END IF;

  IF v_row.status = 'completed' THEN
    RETURN jsonb_build_object(
      'action', 'completed', 'operation_id', p_operation_id,
      'doctor_id', v_row.doctor_id, 'clinic_id', v_row.clinic_id,
      'seed_user_id', v_row.seed_user_id);
  END IF;

  IF v_row.status = 'failed' THEN
    RETURN jsonb_build_object(
      'action', 'failed', 'operation_id', p_operation_id, 'error_code', v_row.error_code);
  END IF;

  IF v_row.status = 'auth_created' THEN
    RETURN jsonb_build_object(
      'action', 'resume', 'operation_id', p_operation_id, 'seed_user_id', v_row.seed_user_id);
  END IF;

  -- status = 'started': ¿el worker anterior sigue vivo?
  v_stale := (now() - v_row.updated_at) > interval '120 seconds';
  IF NOT v_stale THEN
    RETURN jsonb_build_object('action', 'in_progress', 'operation_id', p_operation_id);
  END IF;

  -- Abandonada: la retomamos y renovamos el arriendo.
  UPDATE public.admin_seed_operations
     SET updated_at = now()
   WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object('action', 'resume', 'operation_id', p_operation_id,
                            'seed_user_id', v_row.seed_user_id);
END;
$$;

-- ─── 5. Recuperación determinista del auth.user técnico ─────
-- NO es un buscador de auth.users: no acepta email ni patrón. Construye el
-- email desde el operation_id y devuelve un UUID o NULL. Las tres
-- condiciones extra impiden apropiarse de una identidad ajena que
-- casualmente ocupara ese email.
CREATE OR REPLACE FUNCTION public.admin_lookup_seed_user(p_operation_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
STABLE
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0120';
  END IF;

  SELECT au.id INTO v_id
  FROM auth.users au
  WHERE au.email = public._seed_doctor_email(p_operation_id)
    AND au.raw_app_meta_data->>'lucy_seed_doctor'  = 'true'
    AND au.raw_app_meta_data->>'seed_operation_id' = p_operation_id::text
    AND au.banned_until IS NOT NULL
    AND au.banned_until > now();

  RETURN v_id;  -- NULL si no existe o si no cumple TODAS las condiciones
END;
$$;

-- ─── 6. Transición started → auth_created (compare-and-set) ─
-- Idempotente SOLO si el UUID coincide: un worker viejo no puede sustituir
-- el seed_user_id que otro ya persistió.
CREATE OR REPLACE FUNCTION public.admin_seed_operation_set_auth_created(
  p_operation_id uuid,
  p_seed_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row public.admin_seed_operations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0120';
  END IF;
  IF p_seed_user_id IS NULL THEN
    RAISE EXCEPTION 'seed_user_id es obligatorio' USING ERRCODE = 'P0131';
  END IF;

  SELECT * INTO v_row FROM public.admin_seed_operations
  WHERE operation_id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operación no encontrada' USING ERRCODE = 'P0121';
  END IF;

  -- Terminales: NUNCA se reabren.
  IF v_row.status IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'La operación ya está en estado terminal (%)', v_row.status
      USING ERRCODE = 'P0123';
  END IF;

  -- Ya persistido: idempotente solo si es el MISMO usuario.
  IF v_row.seed_user_id IS NOT NULL AND v_row.seed_user_id <> p_seed_user_id THEN
    RAISE EXCEPTION 'La operación ya tiene otro seed_user_id persistido'
      USING ERRCODE = 'P0124';
  END IF;

  -- El UUID debe ser el seed técnico REAL de esta operación.
  IF public.admin_lookup_seed_user(p_operation_id) IS DISTINCT FROM p_seed_user_id THEN
    RAISE EXCEPTION 'El usuario indicado no es el seed técnico de esta operación'
      USING ERRCODE = 'P0125';
  END IF;

  UPDATE public.admin_seed_operations
     SET status = 'auth_created', seed_user_id = p_seed_user_id, updated_at = now()
   WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object('action', 'auth_created', 'operation_id', p_operation_id,
                            'seed_user_id', p_seed_user_id);
END;
$$;

-- ─── 7. Transición → failed (compare-and-set) ───────────────
CREATE OR REPLACE FUNCTION public.admin_seed_operation_mark_failed(
  p_operation_id uuid,
  p_error_code   text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row public.admin_seed_operations%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0120';
  END IF;
  IF btrim(coalesce(p_error_code, '')) = '' THEN
    RAISE EXCEPTION 'error_code es obligatorio' USING ERRCODE = 'P0131';
  END IF;

  SELECT * INTO v_row FROM public.admin_seed_operations
  WHERE operation_id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operación no encontrada' USING ERRCODE = 'P0121';
  END IF;

  IF v_row.status = 'completed' THEN
    RAISE EXCEPTION 'Una operación completada no puede marcarse como fallida'
      USING ERRCODE = 'P0123';
  END IF;

  IF v_row.status = 'failed' THEN
    -- Idempotente: se conserva el PRIMER error_code.
    RETURN jsonb_build_object('action', 'failed', 'operation_id', p_operation_id,
                              'error_code', v_row.error_code);
  END IF;

  UPDATE public.admin_seed_operations
     SET status = 'failed', error_code = btrim(p_error_code), updated_at = now()
   WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object('action', 'failed', 'operation_id', p_operation_id,
                            'error_code', btrim(p_error_code));
END;
$$;

-- ─── 8. Transacción de negocio: auth_created → completed ────
-- Se invoca con el JWT del admin (NO con service_role): así `auth.uid()` es
-- válido y el trigger audit_profiles_identity (s7_32) puede escribir su fila
-- al actualizar profiles.full_name — la ÚNICA columna auditada que el seed
-- necesita tocar. Con service_role, auth.uid() es NULL y ese trigger viola
-- el NOT NULL de audit_log.user_id, abortando la fila.
CREATE OR REPLACE FUNCTION public.admin_create_seed_doctor(
  p_operation_id uuid,
  p_seed_user_id uuid,
  p_payload_hash text,
  p_payload      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  v_row          public.admin_seed_operations%ROWTYPE;
  v_full_name    text := nullif(btrim(coalesce(p_payload->>'full_name', '')), '');
  v_specialty    uuid := nullif(btrim(coalesce(p_payload->>'specialty_id', '')), '')::uuid;
  v_clinic_name  text := nullif(btrim(coalesce(p_payload->>'clinic_name', '')), '');
  v_address      text := nullif(btrim(coalesce(p_payload->>'clinic_address', '')), '');
  v_clinic_phone text := nullif(regexp_replace(coalesce(p_payload->>'clinic_phone', ''), '\D', '', 'g'), '');
  v_dept         text := nullif(btrim(coalesce(p_payload->>'department_id', '')), '');
  v_muni         text := nullif(btrim(coalesce(p_payload->>'municipality_id', '')), '');
  v_claim_phone  text := public.normalize_phone_sv(coalesce(p_payload->>'claim_phone', ''));
  v_email        text := nullif(lower(btrim(coalesce(p_payload->>'email', ''))), '');
  v_bio          text := nullif(btrim(coalesce(p_payload->>'bio', '')), '');
  v_jvpm         text := nullif(btrim(coalesce(p_payload->>'jvpm', '')), '');
  v_fee          numeric := nullif(btrim(coalesce(p_payload->>'consultation_fee', '')), '')::numeric;
  v_years        int := nullif(btrim(coalesce(p_payload->>'experience_years', '')), '')::int;
  v_publish      boolean := coalesce((p_payload->>'publish')::boolean, false);
  v_cumple_d1    boolean;
  v_clinic_id    uuid;
  v_doctor_id    uuid;
  v_dup_doctor   uuid;
  v_slug         text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0120';
  END IF;

  -- ── 8.1 Operación válida y en el estado esperado ──
  SELECT * INTO v_row FROM public.admin_seed_operations
  WHERE operation_id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operación no encontrada' USING ERRCODE = 'P0121';
  END IF;

  -- Ya terminada: devolvemos lo existente en vez de volver a crear.
  IF v_row.status = 'completed' THEN
    RETURN jsonb_build_object('action', 'already_completed', 'operation_id', p_operation_id,
                              'doctor_id', v_row.doctor_id, 'clinic_id', v_row.clinic_id);
  END IF;
  IF v_row.status = 'failed' THEN
    RAISE EXCEPTION 'La operación está marcada como fallida' USING ERRCODE = 'P0123';
  END IF;
  IF v_row.status <> 'auth_created' THEN
    RAISE EXCEPTION 'La operación no tiene identidad técnica registrada' USING ERRCODE = 'P0123';
  END IF;
  IF v_row.payload_hash IS DISTINCT FROM p_payload_hash THEN
    RAISE EXCEPTION 'La misma operación fue iniciada con datos distintos' USING ERRCODE = 'P0122';
  END IF;
  IF v_row.seed_user_id IS DISTINCT FROM p_seed_user_id THEN
    RAISE EXCEPTION 'seed_user_id no coincide con el persistido' USING ERRCODE = 'P0124';
  END IF;

  -- ── 8.2 El auth.user ES el seed técnico de esta operación ──
  IF public.admin_lookup_seed_user(p_operation_id) IS DISTINCT FROM p_seed_user_id THEN
    RAISE EXCEPTION 'El usuario indicado no es el seed técnico de esta operación'
      USING ERRCODE = 'P0125';
  END IF;

  -- ── 8.3 Datos mínimos ──
  IF v_full_name IS NULL OR v_clinic_name IS NULL THEN
    RAISE EXCEPTION 'Nombre del médico y de la clínica son obligatorios' USING ERRCODE = 'P0131';
  END IF;
  IF v_specialty IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.specialties WHERE id = v_specialty) THEN
    RAISE EXCEPTION 'La especialidad indicada no existe' USING ERRCODE = 'P0130';
  END IF;

  -- ── 8.4 El profile del seed existe y está libre ──
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_seed_user_id) THEN
    RAISE EXCEPTION 'El perfil técnico no existe' USING ERRCODE = 'P0126';
  END IF;
  IF EXISTS (SELECT 1 FROM public.doctors        WHERE profile_id = p_seed_user_id)
  OR EXISTS (SELECT 1 FROM public.patients       WHERE profile_id = p_seed_user_id)
  OR EXISTS (SELECT 1 FROM public.clinic_members WHERE profile_id = p_seed_user_id) THEN
    RAISE EXCEPTION 'El perfil técnico ya está en uso' USING ERRCODE = 'P0127';
  END IF;

  -- ── 8.5 Duplicado de teléfono de claim, serializado ──
  -- profiles.phone NO tiene índice único (y no se agrega: sería cambio de
  -- modelo). El advisory lock cierra la carrera check→act. Patrón vigente
  -- del repo (s7_66, s7_69).
  IF v_claim_phone IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('seed_doctor_phone:' || v_claim_phone, 0));

    SELECT d.id INTO v_dup_doctor
    FROM public.doctors d
    JOIN public.profiles p ON p.id = d.profile_id
    WHERE public.normalize_phone_sv(coalesce(p.phone, '')) = v_claim_phone
    LIMIT 1;

    IF v_dup_doctor IS NOT NULL THEN
      RAISE EXCEPTION 'Ese teléfono de verificación ya pertenece a otro perfil médico (%)', v_dup_doctor
        USING ERRCODE = 'P0128';
    END IF;
  END IF;

  -- ── 8.6 D1 antes de publicar ──
  v_cumple_d1 := (v_full_name IS NOT NULL AND v_specialty IS NOT NULL
                  AND v_clinic_name IS NOT NULL AND v_address IS NOT NULL);
  IF v_publish AND NOT v_cumple_d1 THEN
    RAISE EXCEPTION 'Para publicar hacen falta nombre, especialidad, clínica y dirección'
      USING ERRCODE = 'P0129';
  END IF;

  -- ── 8.7 Profile: UPDATE (handle_new_user ya creó la fila) ──
  -- `role` NO se toca: 'patient' es lo correcto pre-claim (s7_24).
  -- `phone` es el teléfono PRIVADO de verificación del reclamo, distinto de
  -- clinics.phone (público). No se copia uno al otro.
  UPDATE public.profiles
     SET full_name  = v_full_name,
         phone      = coalesce(v_claim_phone, phone),
         email      = coalesce(v_email, email),
         updated_at = now()
   WHERE id = p_seed_user_id;

  -- ── 8.8 Clínica ──
  INSERT INTO public.clinics (name, address_line, phone, owner_id, is_active,
                              department_id, municipality_id)
  VALUES (v_clinic_name, v_address, v_clinic_phone, p_seed_user_id, true, v_dept, v_muni)
  RETURNING id INTO v_clinic_id;

  -- ── 8.9 Médico ──
  -- booking_enabled: LITERAL false. is_operational: true.
  INSERT INTO public.doctors (
    profile_id, clinic_id, specialty_id, bio, consultation_fee, experience_years,
    lucy_status, is_published, is_operational, booking_enabled
  ) VALUES (
    p_seed_user_id, v_clinic_id, v_specialty, v_bio, v_fee, v_years,
    'listed_only'::lucy_status, (v_publish AND v_cumple_d1), true, false
  )
  RETURNING id, slug INTO v_doctor_id, v_slug;

  -- ── 8.10 Credencial JVPM (opcional) ──
  -- Fuente canónica. doctors.license_number NO se escribe (deuda F1-c2).
  -- Un JVPM duplicado choca con doctor_credentials_registry_uniq (s7_61).
  IF v_jvpm IS NOT NULL THEN
    INSERT INTO public.doctor_credentials (doctor_id, type, value, status)
    VALUES (v_doctor_id, 'JVPM', v_jvpm, 'pending');
  END IF;

  -- ── 8.11 Auditoría ──
  INSERT INTO public.audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'insert'::audit_action, 'doctors', v_doctor_id, NULL,
    jsonb_build_object(
      'edited_via',   'admin_create_seed_doctor',
      'operation_id', p_operation_id,
      'seed_user_id', p_seed_user_id,
      'clinic_id',    v_clinic_id,
      'lucy_status',  'listed_only',
      'is_published', (v_publish AND v_cumple_d1),
      'booking_enabled', false,
      'is_operational',  true,
      'has_claim_phone', (v_claim_phone IS NOT NULL),
      'has_jvpm',        (v_jvpm IS NOT NULL)
    )
  );

  -- ── 8.12 Cierre de la operación ──
  UPDATE public.admin_seed_operations
     SET status = 'completed', doctor_id = v_doctor_id, clinic_id = v_clinic_id,
         updated_at = now()
   WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object(
    'action', 'completed', 'operation_id', p_operation_id,
    'doctor_id', v_doctor_id, 'clinic_id', v_clinic_id,
    'slug', v_slug,
    'is_published', (v_publish AND v_cumple_d1),
    'claim_ready', (v_claim_phone IS NOT NULL AND v_jvpm IS NOT NULL)
  );
END;
$$;

-- ─── 9. Grants mínimos ──────────────────────────────────────
-- Las cinco RPCs se invocan con el JWT del admin y gatean con is_admin().
-- `anon` no recibe nada. `service_role` NO las necesita: su único uso es el
-- Admin API (createUser/deleteUser), fuera de la base.
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_claim_seed_operation(uuid, text)',
    'public.admin_lookup_seed_user(uuid)',
    'public.admin_seed_operation_set_auth_created(uuid, uuid)',
    'public.admin_seed_operation_mark_failed(uuid, text)',
    'public.admin_create_seed_doctor(uuid, uuid, text, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);
  END LOOP;
END $$;

-- ─── 10. Guardas POST ───────────────────────────────────────
DO $$
DECLARE
  v_missing text;
BEGIN
  FOREACH v_missing IN ARRAY ARRAY[
    'public.admin_claim_seed_operation(uuid, text)',
    'public.admin_lookup_seed_user(uuid)',
    'public.admin_seed_operation_set_auth_created(uuid, uuid)',
    'public.admin_seed_operation_mark_failed(uuid, text)',
    'public.admin_create_seed_doctor(uuid, uuid, text, jsonb)',
    'public._seed_doctor_email(uuid)'
  ] LOOP
    IF to_regprocedure(v_missing) IS NULL THEN
      RAISE EXCEPTION 'POST falló: no se creó %', v_missing;
    END IF;
  END LOOP;

  IF to_regclass('public.admin_seed_operations') IS NULL THEN
    RAISE EXCEPTION 'POST falló: admin_seed_operations no existe';
  END IF;

  -- RLS activa y sin policies de escritura.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.admin_seed_operations'::regclass) THEN
    RAISE EXCEPTION 'POST falló: RLS no está activa en admin_seed_operations';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'admin_seed_operations'
      AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'POST falló: existe una policy de escritura en admin_seed_operations';
  END IF;

  -- authenticated NO puede hacer DML directo.
  IF has_table_privilege('authenticated', 'public.admin_seed_operations', 'INSERT')
  OR has_table_privilege('authenticated', 'public.admin_seed_operations', 'UPDATE')
  OR has_table_privilege('authenticated', 'public.admin_seed_operations', 'DELETE') THEN
    RAISE EXCEPTION 'POST falló: authenticated tiene DML sobre admin_seed_operations';
  END IF;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- Verificación:
--   node scripts/check-s7_73.mjs     -- estático, sin base
--   node scripts/_smoke-s7_73.mjs    -- E2E (requiere migración aplicada +
--                                       autorización explícita del owner)
-- ═══════════════════════════════════════════════════════════
