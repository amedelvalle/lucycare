-- ═══════════════════════════════════════════════════════════
-- Migración S7-43: B2 — Confirmación post-claim de fichas vinculadas
-- ═══════════════════════════════════════════════════════════
-- Contexto (docs/ANALISIS_PACIENTE_GLOBAL_OWNERSHIP.md, D3/D4 aprobadas):
-- `claim_patient_records` vincula por teléfono OTP toda ficha sin dueño cuyo
-- número coincida. Un teléfono mal tipeado por el médico (R1) o compartido
-- (R2) puede vincular fichas a la persona equivocada, que las vería como
-- atenciones propias. B2 agrega la capa de confirmación del lado del paciente:
--
--   1. `patients.link_confirmed_at` — NULL = vinculada pero NO confirmada por
--      el paciente (la UI la muestra en "Atenciones por confirmar", separada
--      de las atenciones normales). Legacy: las fichas ya vinculadas quedan
--      NULL → piden confirmación una vez (decisión owner). Las fichas que el
--      propio paciente crea al reservar nacen confirmadas (frontend).
--   2. `patient_link_rejections` — registro de "no son mías": cola
--      `pending_review` para LucyAdmin (SIN bandeja UI en este PR; tabla +
--      audit). Evita el re-link automático del mismo par ficha↔profile.
--   3. RPC `confirm_patient_link(p_patient_id)` — self-gated, sella la
--      confirmación + audit.
--   4. RPC `reject_patient_link(p_patient_id)` — self-gated, desvincula
--      (profile_id = NULL) + registra rechazo + audit.
--   5. `claim_patient_records` (CREATE OR REPLACE, base = versión viva de
--      s7_33 con copia de identidad global→local): EXCLUYE pares rechazados.
--      Sigue idempotente. Otro profile legítimo SÍ puede vincular la ficha
--      rechazada después (el rechazo es por par, no por ficha).
--
-- SEGURIDAD:
--   • RPCs SECURITY DEFINER con gate `patients.profile_id = auth.uid()` —
--     nadie confirma/rechaza fichas ajenas (P0040).
--   • `patient_link_rejections` con RLS: solo `is_admin()` lee/actualiza;
--     INSERT solo vía la RPC definer. Sin acceso anon/authenticated directo.
--   • El guard P0030 (s7_33) no se ve afectado: ni `link_confirmed_at` ni
--     `profile_id` son campos de identidad guardados por el trigger.
--
-- Errores: P0040 = ficha no encontrada o no pertenece al caller.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Columna de confirmación ──────────────────────────────
ALTER TABLE patients ADD COLUMN IF NOT EXISTS link_confirmed_at timestamptz;

COMMENT ON COLUMN patients.link_confirmed_at IS
  'B2 (s7_43): cuándo el paciente confirmó que esta ficha vinculada es suya. NULL = vinculada sin confirmar (UI la separa en "Atenciones por confirmar").';

-- ─── 2. Tabla de rechazos ("no son mías") ────────────────────
CREATE TABLE IF NOT EXISTS patient_link_rejections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  profile_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone_normalized text,
  rejected_at      timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'pending_review'
                   CHECK (status IN ('pending_review', 'resolved')),
  resolved_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at      timestamptz,

  -- Un rechazo por par ficha↔profile (re-rechazar refresca la fila).
  CONSTRAINT patient_link_rejections_pair_uniq UNIQUE (patient_id, profile_id)
);

CREATE INDEX IF NOT EXISTS patient_link_rejections_pending
  ON patient_link_rejections(status) WHERE status = 'pending_review';

ALTER TABLE patient_link_rejections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "link_rejections_admin_select" ON patient_link_rejections;
CREATE POLICY "link_rejections_admin_select" ON patient_link_rejections
  FOR SELECT TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS "link_rejections_admin_update" ON patient_link_rejections;
CREATE POLICY "link_rejections_admin_update" ON patient_link_rejections
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
-- Sin policy de INSERT: solo la RPC definer inserta. Sin DELETE.

-- ─── 3. RPC confirm_patient_link ─────────────────────────────
CREATE OR REPLACE FUNCTION confirm_patient_link(p_patient_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_already timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión primero' USING ERRCODE = '28000';
  END IF;

  SELECT link_confirmed_at INTO v_already
  FROM patients
  WHERE id = p_patient_id AND profile_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha no encontrada o no te pertenece' USING ERRCODE = 'P0040';
  END IF;

  -- Idempotente: si ya estaba confirmada, no re-sella ni re-audita.
  IF v_already IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_confirmed', true);
  END IF;

  UPDATE patients
     SET link_confirmed_at = now(), updated_at = now()
   WHERE id = p_patient_id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_user_id, 'update'::audit_action, 'patients', p_patient_id,
    jsonb_build_object('link_confirmed_at', null),
    jsonb_build_object('link_confirmed_at', now(), 'edited_via', 'link_confirmed')
  );

  RETURN jsonb_build_object('success', true, 'already_confirmed', false);
END;
$$;

REVOKE ALL ON FUNCTION confirm_patient_link(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_patient_link(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION confirm_patient_link(uuid) TO authenticated;

-- ─── 4. RPC reject_patient_link ──────────────────────────────
CREATE OR REPLACE FUNCTION reject_patient_link(p_patient_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_phone_norm text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión primero' USING ERRCODE = '28000';
  END IF;

  SELECT normalize_phone_sv(phone) INTO v_phone_norm
  FROM patients
  WHERE id = p_patient_id AND profile_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha no encontrada o no te pertenece' USING ERRCODE = 'P0040';
  END IF;

  -- Registrar el rechazo (re-rechazo refresca la fila y la reabre a revisión).
  INSERT INTO patient_link_rejections (patient_id, profile_id, phone_normalized)
  VALUES (p_patient_id, v_user_id, v_phone_norm)
  ON CONFLICT (patient_id, profile_id) DO UPDATE
    SET rejected_at = now(), status = 'pending_review',
        resolved_by = NULL, resolved_at = NULL;

  -- Desvincular. La ficha queda en la clínica (la relación clínica es del
  -- médico); solo se rompe el vínculo con ESTA identidad. El guard P0030 no
  -- aplica (profile_id/link_confirmed_at no son campos de identidad guardados).
  UPDATE patients
     SET profile_id = NULL, link_confirmed_at = NULL, updated_at = now()
   WHERE id = p_patient_id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_user_id, 'update'::audit_action, 'patients', p_patient_id,
    jsonb_build_object('profile_id', v_user_id),
    jsonb_build_object(
      'profile_id', null, 'rejection_status', 'pending_review',
      'phone_norm', v_phone_norm, 'edited_via', 'link_rejected'
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION reject_patient_link(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION reject_patient_link(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION reject_patient_link(uuid) TO authenticated;

-- ─── 5. claim_patient_records: excluir pares rechazados ─────
-- Base = versión viva de s7_33 (vincula + copia identidad global→local).
-- Único cambio: NOT EXISTS contra patient_link_rejections en el count y en el
-- UPDATE. Sigue idempotente; otro profile puede vincular la ficha rechazada.
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
    AND regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = v_user_phone_norm
    AND NOT EXISTS (
      SELECT 1 FROM patient_link_rejections r
      WHERE r.patient_id = p.id AND r.profile_id = v_user_id
    );

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
     AND regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = v_user_phone_norm
     AND NOT EXISTS (
       SELECT 1 FROM patient_link_rejections r
       WHERE r.patient_id = p.id AND r.profile_id = v_user_id
     );

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

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_43.mjs + node scripts/_smoke-s7_43.mjs
-- ───────────────────────────────────────────────────────────
