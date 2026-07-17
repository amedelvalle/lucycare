-- ═══════════════════════════════════════════════════════════
-- Migración S7-62: cutover de lectores a doctor_credentials — F1-b
-- ═══════════════════════════════════════════════════════════
-- Diseño: docs/ANALISIS_CREDENCIALES_MEDICAS.md (§0.2 lo que F1 debe resolver).
-- Continúa s7_61 (F1-a: modelo + backfill + dual-write).
--
-- ── QUÉ HACE ──
-- Mueve la LECTURA del JVPM desde `doctors.license_number` hacia
-- `doctor_credentials`, con la columna como FALLBACK temporal. Dos funciones,
-- ambas CREATE OR REPLACE (mismas firmas, retrocompatibles):
--
--   1. claim_doctor_profile — valida la licencia tipeada contra la credencial
--      (fallback a la columna). Único diff funcional vs s7_13: la sección 5.
--   2. sync_license_to_credential — mapea SOLO la colisión del índice
--      antifraude `doctor_credentials_registry_uniq` a un P-code estable
--      (P0091); cualquier otro unique_violation se re-lanza intacto.
--
-- Los lectores de panel/receta se mueven en el frontend (mismo PR).
--
-- ── PROCEDENCIA DE LOS CUERPOS (verificado a HEAD 787c8fb) ──
-- `claim_doctor_profile`: s7_13 es el ÚNICO CREATE OR REPLACE en migrations/;
-- las menciones en s7_24/s7_42/s7_60/s7_61 son comentarios, ninguna re-emite
-- la función. Se re-emite el cuerpo de s7_13 VERBATIM salvo la sección 5 y
-- dos variables nuevas. (No fue posible cotejar contra pg_proc de la DB sin
-- service_role; se toma origin/main como fuente de verdad del proyecto.)
-- `sync_license_to_credential`: cuerpo de s7_61, envuelto en un handler.
--
-- ── COMPATIBILIDAD (F1-b, NO F1-c) ──
-- Se MANTIENEN: `doctors.license_number`, el trigger de dual-write, el
-- fallback de lectura, y los grants de s7_60 (el riesgo residual NO se cierra
-- acá). Nada de F1-c (drop de columna, corte del dual-write, revocación) se
-- toca.
--
-- ── NO TOCA ──
-- OTP · teléfono · TOS · roles · publicación · verificación · agenda ·
-- is_verified · lucy_status · la tabla/RLS/grants de doctor_credentials ·
-- el audit · auth.users · datos.
--
-- ── REVERSIBLE ──
-- Re-aplicar los cuerpos de s7_13 (claim) y s7_61 (sync). Sin pérdida de
-- datos: no toca tabla ni columna.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. claim_doctor_profile — lee la credencial, columna = fallback ──
-- Cuerpo VERBATIM de s7_13, con SOLO estos cambios:
--   • DECLARE: + v_cred_license, v_effective_license
--   • sección 5: la fuente pasa a ser doctor_credentials (JVPM), con
--     doctors.license_number como fallback temporal.
-- Todo lo demás (OTP P0001, doctor P0002, estado P0003, phone P0004/P0005,
-- vinculación, roles, audit, retorno) queda IDÉNTICO. P0006/P0007 conservados.
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
  -- F1-b: fuente de la licencia = doctor_credentials; columna = fallback.
  v_cred_license              text;
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

  -- ─── 5. License match — F1-b: fuente = doctor_credentials, fallback = columna ─
  -- La credencial JVPM MANDA; doctors.license_number es solo respaldo mientras
  -- dura F1-b (F1-c dropea la columna y elimina el fallback). one_per_type
  -- garantiza ≤1 fila JVPM. NO se filtra por status: la licencia identifica al
  -- profesional; el estado de verificación es otra cosa (F2/F4). El valor se
  -- compara en variable interna y NUNCA se devuelve.
  v_cred_license := (
    SELECT dc.value
    FROM doctor_credentials dc
    WHERE dc.doctor_id = p_doctor_id AND dc.type = 'JVPM'
    LIMIT 1
  );
  v_effective_license := COALESCE(NULLIF(btrim(v_cred_license), ''), v_doctor_license);

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

-- ─── 2. sync_license_to_credential — colisión antifraude → P0091 ──────
-- Cuerpo de s7_61, envuelto en un handler que distingue la constraint POR
-- NOMBRE EXACTO. Solo `doctor_credentials_registry_uniq` (dos médicos con el
-- mismo JVPM) se convierte en P0091; cualquier otro unique_violation se
-- re-lanza intacto. El conflicto (doctor_id, type) NO llega acá: lo absorbe el
-- ON CONFLICT. Cubre TODOS los escritores de doctors.license_number (approve,
-- import, UPDATE manual) porque vive en el trigger.
CREATE OR REPLACE FUNCTION sync_license_to_credential()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_constraint text;
BEGIN
  -- Sin licencia no hay nada que sincronizar. NO se borra la credencial
  -- existente: vaciar la columna no es una acción que hoy pueda hacer nadie
  -- (s7_60 se la revocó al médico), y decidir qué significa "borrar una
  -- credencial" es de F2, no de un trigger de sync.
  IF NEW.license_number IS NULL OR btrim(NEW.license_number) = '' THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO doctor_credentials (doctor_id, type, value, status)
    VALUES (NEW.id, 'JVPM', btrim(NEW.license_number), 'pending')
    ON CONFLICT (doctor_id, type) WHERE type IN ('JVPM', 'NUE')
    DO UPDATE
       SET value            = EXCLUDED.value,
           -- El número cambió ⇒ lo que se hubiera verificado ya no es este
           -- número. Volver a 'pending' evita afirmar que un valor nuevo está
           -- verificado. Los tres campos se limpian juntos para respetar el
           -- CHECK `verified_needs_actor`.
           status           = 'pending',
           verified_by      = NULL,
           verified_at      = NULL,
           rejection_reason = NULL
     -- Solo si el valor REALMENTE cambió. Sin este WHERE, cualquier UPDATE de
     -- `doctors` que re-escriba la misma licencia tocaría updated_at y generaría
     -- una fila de audit por nada — el mismo error que ya se corrigió en los
     -- vitales (F5 / #276).
     WHERE doctor_credentials.value_normalized
           IS DISTINCT FROM upper(regexp_replace(EXCLUDED.value, '\s', '', 'g'));
  EXCEPTION
    WHEN unique_violation THEN
      -- Item correcto = CONSTRAINT_NAME (sin prefijo PG_; ese solo lo llevan
      -- PG_EXCEPTION_DETAIL / _HINT / _CONTEXT).
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'doctor_credentials_registry_uniq' THEN
        -- Dos médicos no pueden compartir el mismo JVPM. P-code estable para
        -- que el frontend lo mapee a un mensaje claro (no un 23505 crudo).
        RAISE EXCEPTION 'Ese número de licencia (JVPM) ya está registrado para otro médico.'
          USING ERRCODE = 'P0091';
      ELSE
        -- Cualquier otra colisión de unicidad se propaga sin reinterpretar.
        RAISE;
      END IF;
  END;

  RETURN NEW;
END $$;

-- El trigger en sí no cambia (mismo nombre, misma condición). Se re-crea por
-- idempotencia; `OF license_number` mantiene que NO corra al guardar bio,
-- tarifa, idiomas, is_published o booking_enabled.
DROP TRIGGER IF EXISTS trg_sync_license_to_credential ON doctors;
CREATE TRIGGER trg_sync_license_to_credential
  AFTER INSERT OR UPDATE OF license_number ON doctors
  FOR EACH ROW EXECUTE FUNCTION sync_license_to_credential();

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- Verificación:
--   node scripts/check-s7_62.mjs     -- firma del claim + P0091 (estructural)
--   node scripts/_smoke-s7_62.mjs    -- lectores + P0091 + desync del claim
--
-- El smoke del claim (desync columna vs credencial) requiere una sesión OTP →
-- un Test Phone dedicado (a definir por el owner; NO Camilo ni Katherine).
--
-- SIGUE (F1-c, no en este PR):
--   retirar el fallback de los lectores · re-emitir el claim sin fallback ·
--   cortar el dual-write (drop del trigger) · revocar el grant residual ·
--   DROPEAR doctors.license_number · actualizar scripts. ← cierra el riesgo.
-- ═══════════════════════════════════════════════════════════
