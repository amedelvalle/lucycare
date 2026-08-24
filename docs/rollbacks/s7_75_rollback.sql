-- ═══════════════════════════════════════════════════════════
-- ROLLBACK de S7-75 — SEED-CLAIM-PHONE-SMS-CAPABLE
-- ═══════════════════════════════════════════════════════════
-- ⚠️ NO EJECUTAR salvo instrucción explícita del owner.
--
-- AUTOSUFICIENTE: se copia este archivo COMPLETO al SQL Editor de Supabase y
-- se ejecuta de una sola vez. No necesita `\i`, ni psql, ni leer otro archivo,
-- ni pegar nada a mano, ni scripts, ni acceso al repositorio.
--
-- Por eso los dos cuerpos previos van DUPLICADOS literalmente más abajo. En un
-- rollback de emergencia, la autosuficiencia vale más que no repetir texto: un
-- archivo que exige copiar fragmentos de otra migración no es un rollback, es
-- una instrucción. Los cuerpos se generan PROGRAMÁTICAMENTE desde
-- `migrations/s7_73_admin_seed_doctor.sql` (líneas 166-263 y 465-721) y
-- `scripts/check-s7_75.mjs` verifica que coinciden con esa fuente carácter por
-- carácter, de modo que no pueden divergir en silencio.
--
-- ── QUÉ DEVUELVE ──
-- Las dos RPCs vuelven a usar `auth_phone_e164` para el teléfono de claim, y
-- el helper `_seed_claim_phone_e164` desaparece.
--
-- ⚠️ El estado resultante es ESTRICTAMENTE MÁS PERMISIVO: un teléfono de
-- claim FIJO (`2XXXXXXX`) —o extranjero— vuelve a dar `claim_ready = true`, y
-- el perfil vuelve a poder nacer publicado e IMPOSIBLE de reclamar en
-- silencio, porque el Claim manda el código por SMS y un fijo no lo recibe.
--
-- ── QUÉ NO TOCA ──
-- `auth_phone_e164`, `clinic_phone`, la tabla, la policy, los grants de las
-- RPCs, la idempotencia, `auth.users` ni ningún dato.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 0. Guardas PRE ─────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public._seed_claim_phone_e164(text)') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: s7_75 no parece aplicada (falta el helper)';
  END IF;
  IF to_regprocedure('public.admin_create_seed_doctor(uuid,uuid,text,jsonb,uuid)') IS NULL
     OR to_regprocedure('public.admin_claim_seed_operation(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: faltan las RPCs de s7_73';
  END IF;
  IF to_regprocedure('public.auth_phone_e164(text)') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: auth_phone_e164(text) no existe; los cuerpos restaurados la necesitan';
  END IF;
END $$;

-- ─── 1. Cuerpos previos, tal cual quedaron en s7_73 ─────────

CREATE OR REPLACE FUNCTION public.admin_claim_seed_operation(
  p_operation_id uuid,
  p_payload_hash text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row         public.admin_seed_operations%ROWTYPE;
  v_stale       boolean;
  v_token       uuid;
  v_slug        text;
  v_published   boolean;
  v_claim_ready boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0120';
  END IF;
  IF p_operation_id IS NULL OR btrim(coalesce(p_payload_hash, '')) = '' THEN
    RAISE EXCEPTION 'operation_id y payload_hash son obligatorios' USING ERRCODE = 'P0131';
  END IF;

  v_token := gen_random_uuid();

  INSERT INTO public.admin_seed_operations (operation_id, requested_by, payload_hash, lease_token)
  VALUES (p_operation_id, auth.uid(), p_payload_hash, v_token)
  ON CONFLICT (operation_id) DO NOTHING;

  IF FOUND THEN
    RETURN jsonb_build_object('action', 'claimed', 'operation_id', p_operation_id,
                              'lease_token', v_token);
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
    -- Idempotencia OBSERVABLE: un retry debe ver exactamente el mismo
    -- resultado que la primera respuesta, no una versión empobrecida. Se
    -- reconstruye desde lo PERSISTIDO (slug, publicación y claim readiness
    -- con el mismo criterio del claim real).
    -- `seed_user_id` NO se devuelve: es interno y el cliente no lo necesita.
    SELECT d.slug,
           d.is_published,
           (public.auth_phone_e164(coalesce(p.phone, '')) IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.doctor_credentials dc
                         WHERE dc.doctor_id = d.id
                           AND dc.type = 'JVPM'
                           AND dc.status <> 'rejected'))
      INTO v_slug, v_published, v_claim_ready
    FROM public.doctors d
    LEFT JOIN public.profiles p ON p.id = d.profile_id
    WHERE d.id = v_row.doctor_id;

    RETURN jsonb_build_object(
      'action', 'completed', 'operation_id', p_operation_id,
      'doctor_id', v_row.doctor_id, 'clinic_id', v_row.clinic_id,
      'slug', v_slug,
      'is_published', coalesce(v_published, false),
      'claim_ready', coalesce(v_claim_ready, false));
  END IF;

  IF v_row.status = 'failed' THEN
    RETURN jsonb_build_object(
      'action', 'failed', 'operation_id', p_operation_id, 'error_code', v_row.error_code);
  END IF;

  -- No terminal ('started' o 'auth_created'): ¿el worker anterior sigue vivo?
  -- Mismo criterio para ambos: si el arriendo está fresco, NADIE más entra.
  v_stale := (now() - v_row.updated_at) > interval '120 seconds';
  IF NOT v_stale THEN
    RETURN jsonb_build_object('action', 'in_progress', 'operation_id', p_operation_id);
  END IF;

  -- Abandonada: la retomamos. ROTAR el token es lo que expulsa al worker
  -- viejo: cuando despierte, su token ya no coincide y no podrá mutar nada.
  UPDATE public.admin_seed_operations
     SET lease_token = v_token, updated_at = now()
   WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object('action', 'resume', 'operation_id', p_operation_id,
                            'seed_user_id', v_row.seed_user_id,
                            'lease_token', v_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_seed_doctor(
  p_operation_id uuid,
  p_seed_user_id uuid,
  p_payload_hash text,
  p_payload      jsonb,
  p_lease_token  uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
DECLARE
  -- ⚠️ NINGUNA inicialización derivada del payload acá. PL/pgSQL evalúa el
  -- DECLARE al ENTRAR al bloque, ANTES del BEGIN: un cast fallable (::uuid,
  -- ::numeric, ::int) lanzaría 22P02 antes del gate `is_admin()`, dando a un
  -- no-admin un error distinto al de "no autorizado". Todo lo derivado del
  -- payload se calcula en el cuerpo, después de autorizar.
  v_row          public.admin_seed_operations%ROWTYPE;
  v_full_name    text;
  v_specialty    uuid;
  v_specialty_in text;
  v_clinic_name  text;
  v_address      text;
  v_clinic_phone text;
  v_dept         text;
  v_muni         text;
  v_claim_phone  text;
  v_claim_e164   text;
  v_email        text;
  v_bio          text;
  v_jvpm         text;
  v_fee_in       text;
  v_years_in     text;
  v_fee          numeric;
  v_years        int;
  v_publish      boolean;
  v_cumple_d1    boolean;
  v_claim_ready  boolean;
  v_clinic_id    uuid;
  v_doctor_id    uuid;
  v_dup_doctor   uuid;
  v_slug         text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0120';
  END IF;

  -- ── 8.0 Recién ahora se interpreta el payload ──
  -- Los valores fallables se VALIDAN antes de castear, así que un dato
  -- malformado produce un error tipado nuestro y no un 22P02 crudo.
  v_full_name    := nullif(btrim(coalesce(p_payload->>'full_name', '')), '');
  v_clinic_name  := nullif(btrim(coalesce(p_payload->>'clinic_name', '')), '');
  v_address      := nullif(btrim(coalesce(p_payload->>'clinic_address', '')), '');
  v_clinic_phone := nullif(regexp_replace(coalesce(p_payload->>'clinic_phone', ''), '\D', '', 'g'), '');
  v_dept         := nullif(btrim(coalesce(p_payload->>'department_id', '')), '');
  v_muni         := nullif(btrim(coalesce(p_payload->>'municipality_id', '')), '');
  v_claim_phone  := public.normalize_phone_sv(coalesce(p_payload->>'claim_phone', ''));
  v_email        := nullif(lower(btrim(coalesce(p_payload->>'email', ''))), '');
  v_bio          := nullif(btrim(coalesce(p_payload->>'bio', '')), '');
  v_jvpm         := nullif(btrim(coalesce(p_payload->>'jvpm', '')), '');
  v_publish      := coalesce(p_payload->>'publish', 'false') = 'true';

  v_specialty_in := nullif(btrim(coalesce(p_payload->>'specialty_id', '')), '');
  IF v_specialty_in IS NOT NULL THEN
    IF v_specialty_in !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'La especialidad indicada no es válida' USING ERRCODE = 'P0130';
    END IF;
    v_specialty := v_specialty_in::uuid;
  END IF;

  v_fee_in := nullif(btrim(coalesce(p_payload->>'consultation_fee', '')), '');
  IF v_fee_in IS NOT NULL THEN
    IF v_fee_in !~ '^[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'La tarifa no es un número válido' USING ERRCODE = 'P0131';
    END IF;
    v_fee := v_fee_in::numeric;
  END IF;

  v_years_in := nullif(btrim(coalesce(p_payload->>'experience_years', '')), '');
  IF v_years_in IS NOT NULL THEN
    IF v_years_in !~ '^[0-9]{1,3}$' THEN
      RAISE EXCEPTION 'Los años de experiencia no son un número válido' USING ERRCODE = 'P0131';
    END IF;
    v_years := v_years_in::int;
  END IF;

  -- ── 8.1 Operación válida y en el estado esperado ──
  SELECT * INTO v_row FROM public.admin_seed_operations
  WHERE operation_id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Operación no encontrada' USING ERRCODE = 'P0121';
  END IF;

  -- OWNERSHIP primero: si otro worker retomó la operación, este no escribe.
  IF v_row.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'La operación fue retomada por otro proceso' USING ERRCODE = 'P0132';
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
    -- El teléfono de claim DEBE ser utilizable por el hook de Auth. Si
    -- `auth_phone_e164` lo rechaza, el médico no podría crear su identidad
    -- (`hook_before_user_created` es fail-closed) y el perfil nacería
    -- publicado pero IMPOSIBLE de reclamar, en silencio. Se valida con la
    -- MISMA función que usa el hook, no con una heurística paralela.
    -- (Es el teléfono PRIVADO de verificación; `clinics.phone` no se valida
    -- así porque no participa del reclamo.)
    IF public.auth_phone_e164(v_claim_phone) IS NULL THEN
      RAISE EXCEPTION 'El teléfono de verificación del reclamo no tiene un formato que Auth pueda usar'
        USING ERRCODE = 'P0133';
    END IF;

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

  -- Claim readiness: MISMO criterio que usa el claim real.
  --   teléfono utilizable por Auth  +  credencial JVPM utilizable.
  -- Se calcula con `auth_phone_e164`, no con "el campo vino informado":
  -- un teléfono presente pero inservible daría un falso positivo.
  v_claim_ready := (v_claim_phone IS NOT NULL
                    AND public.auth_phone_e164(v_claim_phone) IS NOT NULL
                    AND v_jvpm IS NOT NULL);

  RETURN jsonb_build_object(
    'action', 'completed', 'operation_id', p_operation_id,
    'doctor_id', v_doctor_id, 'clinic_id', v_clinic_id,
    'slug', v_slug,
    'is_published', (v_publish AND v_cumple_d1),
    'claim_ready', v_claim_ready
  );
END;
$$;
-- ─── 2. Eliminar el helper ──────────────────────────────────
-- DESPUÉS de restaurar los cuerpos: mientras alguna RPC lo referenciara,
-- borrarlo dejaría las funciones apuntando a algo inexistente.
DROP FUNCTION IF EXISTS public._seed_claim_phone_e164(text);

-- ─── 3. Guardas POST ────────────────────────────────────────
DO $$
DECLARE
  v_oid_claim  oid := to_regprocedure('public.admin_claim_seed_operation(uuid,text)');
  v_oid_create oid := to_regprocedure('public.admin_create_seed_doctor(uuid,uuid,text,jsonb,uuid)');
BEGIN
  -- 3.1 El helper ya no existe y nadie lo referencia.
  IF to_regprocedure('public._seed_claim_phone_e164(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'POST fallo: el helper sigue existiendo';
  END IF;
  IF (SELECT count(*) FROM pg_proc
       WHERE oid IN (v_oid_claim, v_oid_create)
         AND prosrc LIKE '%_seed_claim_phone_e164%') <> 0 THEN
    RAISE EXCEPTION 'POST fallo: alguna RPC sigue referenciando el helper eliminado';
  END IF;

  -- 3.2 Las dos volvieron a la global: es el comportamiento anterior.
  IF (SELECT count(*) FROM pg_proc
       WHERE oid IN (v_oid_claim, v_oid_create)
         AND prosrc LIKE '%public.auth_phone_e164(%') <> 2 THEN
    RAISE EXCEPTION 'POST fallo: los cuerpos originales no quedaron restaurados';
  END IF;

  -- 3.3 Firmas: siguen siendo dos, sin sobrecargas.
  IF v_oid_claim IS NULL OR v_oid_create IS NULL THEN
    RAISE EXCEPTION 'POST fallo: falta alguna RPC';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('admin_claim_seed_operation','admin_create_seed_doctor')) <> 2 THEN
    RAISE EXCEPTION 'POST fallo: hay sobrecargas de las RPCs';
  END IF;

  -- 3.4 SECURITY DEFINER y search_path exactos.
  IF NOT (SELECT bool_and(prosecdef) FROM pg_proc WHERE oid IN (v_oid_claim, v_oid_create)) THEN
    RAISE EXCEPTION 'POST fallo: alguna RPC dejo de ser SECURITY DEFINER';
  END IF;
  IF (SELECT array_to_string(proconfig, ', ') FROM pg_proc WHERE oid = v_oid_claim)
     <> 'search_path=public, pg_catalog' THEN
    RAISE EXCEPTION 'POST fallo: search_path de admin_claim_seed_operation';
  END IF;
  IF (SELECT array_to_string(proconfig, ', ') FROM pg_proc WHERE oid = v_oid_create)
     <> 'search_path=public, auth, pg_catalog' THEN
    RAISE EXCEPTION 'POST fallo: search_path de admin_create_seed_doctor';
  END IF;

  -- 3.5 Ownership uniforme y ACL de las RPCs intacta.
  IF (SELECT count(DISTINCT proowner) FROM pg_proc
       WHERE oid IN (v_oid_claim, v_oid_create)) <> 1 THEN
    RAISE EXCEPTION 'POST fallo: el ownership no es uniforme';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid_claim, 'EXECUTE')
  OR NOT has_function_privilege('authenticated', v_oid_create, 'EXECUTE') THEN
    RAISE EXCEPTION 'POST fallo: authenticated perdio EXECUTE';
  END IF;
  IF has_function_privilege('anon', v_oid_claim, 'EXECUTE')
  OR has_function_privilege('anon', v_oid_create, 'EXECUTE') THEN
    RAISE EXCEPTION 'POST fallo: anon gano EXECUTE';
  END IF;

  -- 3.6 CONDUCTA anterior restaurada: la global vuelve a mandar, y con ella
  -- vuelve a pasar un fijo. Es justamente lo que este rollback re-habilita.
  IF public.auth_phone_e164('22220073') <> '+50322220073' THEN
    RAISE EXCEPTION 'POST fallo: auth_phone_e164 no se comporta como antes';
  END IF;
  IF public.auth_phone_e164('70069973') <> '+50370069973' THEN
    RAISE EXCEPTION 'POST fallo: auth_phone_e164 no se comporta como antes (movil)';
  END IF;
END $$;

COMMIT;
