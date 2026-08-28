-- ============================================================
-- ROLLBACK de s7_80 · DOCTOR-OWNER-NOTIFICATIONS-P0
-- ============================================================
--
-- Deja la base exactamente como estaba antes de s7_80: sin outbox, sin
-- encolado y con claim_doctor_profile restaurada a su definicion de s7_64.
--
-- El cuerpo de claim_doctor_profile que aparece abajo NO se transcribio a
-- mano: se extrajo del propio migrations/s7_64_credentials_logical_retirement.sql
-- por programa, para que la definicion restaurada no pueda divergir por un
-- error de copia. Es literalmente lo que corre hoy en produccion.
--
-- ORDEN. Primero se restaura la RPC del claim y recien despues se borra el
-- helper que invoca. Al reves, quedaria una funcion referenciando algo que ya
-- no existe y el siguiente claim fallaria con "function does not exist" — es
-- decir, el rollback romperia justo el flujo que s7_80 prometia no tocar.
--
-- NO se ejecuta salvo FAIL explicito.
--
-- ANTES de correr esto, si ya existe la Database Webhook: BORRAR LA WEBHOOK
-- PRIMERO. Si no, cada INSERT sobre una tabla que ya no existe no llegara a
-- dispararla, pero la webhook quedaria apuntando a una funcion viva sin
-- fuente. El orden de desmontaje es el inverso al de montaje.
--
-- s7_64 NO se reaplica: este archivo reproduce su funcion, no ejecuta su
-- migracion.
--
-- audit_log NO se toca: es inmutable desde s7_71b y ninguna fila suya proviene
-- de s7_80.
-- ============================================================

-- ─── 1. Restaurar claim_doctor_profile a la definicion de s7_64 ───
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

-- ─── 2. Retirar el encolado de afiliacion ───
DROP TRIGGER IF EXISTS trg_notify_owner_affiliation ON public.doctor_affiliation_requests;
DROP FUNCTION IF EXISTS public._notify_owner_affiliation_fn();

-- ─── 3. Retirar las RPCs del procesador ───
-- Se borran AMBAS firmas: la vigente y la de la primera version local, que no
-- llevaba la ventana de idempotencia. Un DROP que solo nombre una dejaria la
-- otra viva y otorgada a service_role.
DROP FUNCTION IF EXISTS public.notify_owner_claim_batch(int, interval, interval);
DROP FUNCTION IF EXISTS public.notify_owner_claim_batch(int, interval);
DROP FUNCTION IF EXISTS public.notify_owner_mark_result(uuid, text, text, text);

-- ─── 4. Retirar el helper de encolado ───
-- Ya no queda ningun llamador: el paso 1 restauro la version sin enqueue.
DROP FUNCTION IF EXISTS public._enqueue_doctor_owner_notification(text, uuid, uuid, uuid);

-- ─── 5. Retirar la outbox ───
-- OJO: esto DESCARTA los avisos que aun no se hubieran enviado. Si importa
-- conservarlos, exportar antes:
--   SELECT * FROM public.doctor_owner_notifications ORDER BY occurred_at;
DROP TABLE IF EXISTS public.doctor_owner_notifications;

-- ─── 6. POST del rollback ───
DO $rbpost$
DECLARE
  v_src text;
BEGIN
  IF to_regclass('public.doctor_owner_notifications') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK fallo: la outbox sigue existiendo';
  END IF;
  IF to_regprocedure('public._enqueue_doctor_owner_notification(text, uuid, uuid, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK fallo: el helper de encolado sigue existiendo';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.doctor_affiliation_requests'::regclass
      AND tgname = 'trg_notify_owner_affiliation'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK fallo: el trigger de afiliacion sigue existiendo';
  END IF;

  -- El claim quedo restaurado Y funcional: sin enqueue, con sus invariantes.
  SELECT prosrc INTO v_src
  FROM pg_proc WHERE oid = 'public.claim_doctor_profile(uuid, text, text)'::regprocedure;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK fallo: claim_doctor_profile desaparecio';
  END IF;
  IF position('_enqueue_doctor_owner_notification' in v_src) > 0 THEN
    RAISE EXCEPTION 'ROLLBACK fallo: claim_doctor_profile sigue encolando';
  END IF;
  IF position('doctor_credentials' in v_src) = 0
     OR position('P0003' in v_src) = 0
     OR position('tos_accepted_at' in v_src) = 0
     OR position('clinic_members' in v_src) = 0
     OR position('audit_log' in v_src) = 0 THEN
    RAISE EXCEPTION 'ROLLBACK fallo: claim_doctor_profile perdio alguna invariante de s7_64';
  END IF;

  -- El trigger de AUDITORIA de afiliaciones (s7_21) NO es de s7_80 y debe
  -- seguir en pie. Borrarlo por error dejaria leads sin rastro.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.doctor_affiliation_requests'::regclass
      AND tgname = 'trg_audit_doctor_affiliation_requests'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK fallo: se perdio el trigger de auditoria de s7_21';
  END IF;

  RAISE NOTICE 's7_80 ROLLBACK: OK';
END $rbpost$;
