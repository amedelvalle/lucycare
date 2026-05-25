-- ═══════════════════════════════════════════════════════════
-- Migración S7-20: Paciente Global Fase 1
-- ═══════════════════════════════════════════════════════════
-- Habilita el primer paso del modelo de paciente global
-- (docs/ANALISIS_PACIENTE_GLOBAL.md, decisiones DA1-DA4 firmadas):
--
--   1. RPC claim_patient_records: vincula filas legacy de patients
--      al profile del usuario logueado, solo cuando el match es
--      fuerte (phone OTP-verified == patient.phone_normalized).
--
--   2. Policies SELECT-self defensivas en patients y appointments
--      para que el paciente logueado vea sus propias filas. Las
--      policies se nombran patients_self_select y appointments_self_select
--      para no chocar con policies existentes (clinic_members, admin,
--      doctor). Solo se hace DROP IF EXISTS de esos nombres específicos
--      — no se toca ninguna otra policy.
--
-- Restricciones aplicadas:
--   - Solo SELECT en las policies (no INSERT/UPDATE/DELETE).
--   - RPC restringida a authenticated (REVOKE FROM PUBLIC).
--   - No vincula por nombre, email ni documento. Solo por phone
--     normalizado verificado por OTP.
--   - Idempotente. audit_log registra el conteo.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. RPC claim_patient_records ────────────────────────────
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
  -- 1.1 Auth requerido
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión primero' USING ERRCODE = '28000';
  END IF;

  -- 1.2 Phone confirmado en auth.users. NO confiamos en lo que el
  --     usuario pase como parámetro — leemos directo del registro
  --     de auth, que solo se setea cuando Supabase/Twilio confirma
  --     el OTP. Comparación canónica: solo dígitos.
  SELECT regexp_replace(coalesce(au.phone, ''), '\D', '', 'g')
    INTO v_user_phone_norm
  FROM auth.users au
  WHERE au.id = v_user_id
    AND au.phone_confirmed_at IS NOT NULL;

  -- Si no tiene phone confirmado, no hacemos nada (no es error —
  -- el paciente puede haber entrado por email/password en el futuro,
  -- no queremos romper login).
  IF v_user_phone_norm IS NULL OR v_user_phone_norm = '' THEN
    RETURN jsonb_build_object(
      'success', true,
      'linked_count', 0,
      'reason', 'no_phone_confirmed'
    );
  END IF;

  -- 1.3 Conteo previo de filas que VAN a vincularse (para audit_log)
  SELECT count(*) INTO v_total_count
  FROM patients p
  WHERE p.profile_id IS NULL
    AND regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = v_user_phone_norm;

  IF v_total_count = 0 THEN
    -- Nada que hacer. Idempotente: re-llamadas no fallan ni escriben audit.
    RETURN jsonb_build_object(
      'success', true,
      'linked_count', 0
    );
  END IF;

  -- 1.4 Vincular. UPDATE solo profile_id en filas con NULL y
  --     phone matching. Idempotente.
  UPDATE patients
     SET profile_id = v_user_id,
         updated_at = now()
   WHERE profile_id IS NULL
     AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_user_phone_norm;

  GET DIAGNOSTICS v_linked_count = ROW_COUNT;

  -- 1.5 Audit log — una sola fila resumiendo la operación.
  --     record_id apunta al profile del paciente (mejor que NULL).
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_user_id,
    'update'::audit_action,
    'patients',
    v_user_id,                              -- referencia al actor/sujeto
    jsonb_build_object('profile_id', null),
    jsonb_build_object(
      'profile_id',  v_user_id,
      'linked_count', v_linked_count,
      'phone_norm',   v_user_phone_norm,
      'edited_via',   'claim_patient_records'
    )
  );

  RETURN jsonb_build_object(
    'success',      true,
    'linked_count', v_linked_count
  );
END;
$$;

-- 1.6 Permisos: solo authenticated. NO anon.
REVOKE ALL ON FUNCTION claim_patient_records() FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_patient_records() FROM anon;
GRANT EXECUTE ON FUNCTION claim_patient_records() TO authenticated;

-- ─── 2. Policies SELECT-self defensivas ─────────────────────
-- Reglas:
--  - DROP IF EXISTS aplica SOLO a los nombres específicos nuevos.
--  - No tocamos otras policies (admin, clinic_members, doctor).
--  - Solo SELECT. No agregamos INSERT/UPDATE/DELETE.

-- 2.1 patients: el paciente ve sus propias filas (las que tiene
--     vinculadas via profile_id).
DROP POLICY IF EXISTS "patients_self_select" ON patients;
CREATE POLICY "patients_self_select" ON patients
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

-- 2.2 appointments: el paciente ve sus citas (aquellas cuyo
--     patient_id pertenece a uno de SUS patients vinculados).
--     Usamos EXISTS porque es más claro y permite al planner
--     filtrar eficientemente con el índice por patient_id.
DROP POLICY IF EXISTS "appointments_self_select" ON appointments;
CREATE POLICY "appointments_self_select" ON appointments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM patients p
    WHERE p.id = appointments.patient_id
      AND p.profile_id = auth.uid()
  ));

-- ─── 3. RLS habilitada (idempotente) ────────────────────────
-- Por seguridad, asegurar que RLS esté ENABLE en ambas tablas.
-- Si ya estaba enabled, este comando es no-op.
ALTER TABLE patients     ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
