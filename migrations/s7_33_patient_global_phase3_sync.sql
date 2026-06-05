-- ═══════════════════════════════════════════════════════════
-- Migración S7-33: Paciente Global Fase 3 (F3.1 backend) —
-- sync espejo profiles → patients + guard de identidad local
-- ═══════════════════════════════════════════════════════════
-- Opción B (sync espejo): `profiles` = verdad canónica de identidad;
-- `patients` = espejo local sincronizado (compatibilidad con consulta/receta/
-- listado que leen `patients`). Datos clínicos/administrativos locales
-- (blood_type, allergies, emergency_*, notes, patient_type, photo_url,
-- is_active) siguen editables por la clínica.
--
-- Tres piezas:
--  (a) GUARD: trigger BEFORE UPDATE en patients que bloquea editar identidad
--      local (full_name, phone, email, document_*, date_of_birth, gender)
--      cuando profile_id IS NOT NULL — salvo el bypass del sync.
--  (b) CLAIM: claim_patient_records copia la identidad global → local al
--      vincular (COALESCE: global gana donde existe; local se conserva donde
--      el perfil está null). NO promueve local → global (eso es F2.2).
--  (c) SYNC ONGOING: trigger AFTER UPDATE de identidad en profiles propaga los
--      campos CAMBIADOS a las patients vinculadas (cross-clínica), sin anular
--      columnas NOT NULL de patients y sin pisar campos no relacionados.
--
-- phone: read-only + guardado, pero NO entra al sync ongoing (el paciente no
-- lo edita; coincide por construcción como clave de match). Cambio de teléfono
-- = flujo OTP posterior.
-- ═══════════════════════════════════════════════════════════

-- ─── (a) Guard: bloquear edición de identidad de paciente vinculado ──
CREATE OR REPLACE FUNCTION prevent_linked_patient_identity_edit()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Bypass SOLO para el sync (lo setea sync_identity_to_patients).
  IF current_setting('app.syncing_patient_identity', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF OLD.profile_id IS NOT NULL AND (
       NEW.full_name       IS DISTINCT FROM OLD.full_name
    OR NEW.phone           IS DISTINCT FROM OLD.phone
    OR NEW.email           IS DISTINCT FROM OLD.email
    OR NEW.document_type   IS DISTINCT FROM OLD.document_type
    OR NEW.document_number IS DISTINCT FROM OLD.document_number
    OR NEW.date_of_birth   IS DISTINCT FROM OLD.date_of_birth
    OR NEW.gender          IS DISTINCT FROM OLD.gender
  ) THEN
    RAISE EXCEPTION 'Los datos de identidad de un paciente vinculado se gestionan desde su perfil Lucy'
      USING ERRCODE = 'P0030';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_linked_patient_identity_edit_trg ON patients;
CREATE TRIGGER prevent_linked_patient_identity_edit_trg
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION prevent_linked_patient_identity_edit();

-- ─── (c) Sync ongoing: profiles → patients vinculadas ───────────────
-- Propaga SOLO los campos de identidad que cambiaron. No anula las NOT NULL de
-- patients (full_name/date_of_birth/gender/document_type) si el global es null.
-- document_number/email (nullable en patients) propagan incluido null.
-- profiles.document_type es text → cast ::document_type (mismos 4 valores).
CREATE OR REPLACE FUNCTION sync_identity_to_patients()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.syncing_patient_identity', 'on', true);

  UPDATE patients p SET
    full_name       = CASE WHEN NEW.full_name       IS DISTINCT FROM OLD.full_name       AND NEW.full_name       IS NOT NULL THEN NEW.full_name                       ELSE p.full_name END,
    email           = CASE WHEN NEW.email           IS DISTINCT FROM OLD.email                                               THEN NEW.email                           ELSE p.email END,
    document_type   = CASE WHEN NEW.document_type   IS DISTINCT FROM OLD.document_type   AND NEW.document_type   IS NOT NULL THEN NEW.document_type::document_type   ELSE p.document_type END,
    document_number = CASE WHEN NEW.document_number IS DISTINCT FROM OLD.document_number                                     THEN NEW.document_number                 ELSE p.document_number END,
    date_of_birth   = CASE WHEN NEW.date_of_birth   IS DISTINCT FROM OLD.date_of_birth   AND NEW.date_of_birth   IS NOT NULL THEN NEW.date_of_birth                   ELSE p.date_of_birth END,
    gender          = CASE WHEN NEW.gender          IS DISTINCT FROM OLD.gender          AND NEW.gender          IS NOT NULL THEN NEW.gender                          ELSE p.gender END,
    updated_at      = now()
  WHERE p.profile_id = NEW.id;

  PERFORM set_config('app.syncing_patient_identity', 'off', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_identity_to_patients_trg ON profiles;
CREATE TRIGGER sync_identity_to_patients_trg
  AFTER UPDATE OF full_name, email, document_type, document_number, date_of_birth, gender ON profiles
  FOR EACH ROW EXECUTE FUNCTION sync_identity_to_patients();

-- ─── (b) Claim: copiar identidad global → local al vincular ─────────
-- CREATE OR REPLACE conservando todo s7_20; el único cambio es que el UPDATE
-- que setea profile_id además copia la identidad del profile del caller
-- (COALESCE: global gana donde existe; local se conserva donde el perfil es
-- null). En ese momento OLD.profile_id IS NULL → el guard (a) permite. phone NO
-- se copia (es la clave de match, ya coincide).
CREATE OR REPLACE FUNCTION claim_patient_records()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          uuid := auth.uid();
  v_user_phone_norm  text;
  v_linked_count     int;
  v_total_count      int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión primero' USING ERRCODE = '28000';
  END IF;

  SELECT regexp_replace(coalesce(au.phone, ''), '\D', '', 'g')
    INTO v_user_phone_norm
  FROM auth.users au
  WHERE au.id = v_user_id
    AND au.phone_confirmed_at IS NOT NULL;

  IF v_user_phone_norm IS NULL OR v_user_phone_norm = '' THEN
    RETURN jsonb_build_object('success', true, 'linked_count', 0, 'reason', 'no_phone_confirmed');
  END IF;

  SELECT count(*) INTO v_total_count
  FROM patients p
  WHERE p.profile_id IS NULL
    AND regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = v_user_phone_norm;

  IF v_total_count = 0 THEN
    RETURN jsonb_build_object('success', true, 'linked_count', 0);
  END IF;

  -- Vincular + copiar identidad global (global gana, local se conserva).
  UPDATE patients p
     SET profile_id      = v_user_id,
         full_name       = COALESCE(prof.full_name, p.full_name),
         email           = COALESCE(prof.email, p.email),
         document_type   = COALESCE(prof.document_type::document_type, p.document_type),
         document_number = COALESCE(prof.document_number, p.document_number),
         date_of_birth   = COALESCE(prof.date_of_birth, p.date_of_birth),
         gender          = COALESCE(prof.gender, p.gender),
         updated_at      = now()
    FROM profiles prof
   WHERE prof.id = v_user_id
     AND p.profile_id IS NULL
     AND regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = v_user_phone_norm;

  GET DIAGNOSTICS v_linked_count = ROW_COUNT;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_user_id, 'update'::audit_action, 'patients', v_user_id,
    jsonb_build_object('profile_id', null),
    jsonb_build_object(
      'profile_id', v_user_id, 'linked_count', v_linked_count,
      'phone_norm', v_user_phone_norm, 'edited_via', 'claim_patient_records'
    )
  );

  RETURN jsonb_build_object('success', true, 'linked_count', v_linked_count);
END;
$$;

REVOKE ALL ON FUNCTION claim_patient_records() FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_patient_records() FROM anon;
GRANT EXECUTE ON FUNCTION claim_patient_records() TO authenticated;
