-- ═══════════════════════════════════════════════════════════
-- Migración S7-28: inmutabilidad server-side de consultas firmadas
-- (Correcciones post-firma — Etapa A; cierra deuda técnica #2)
-- ═══════════════════════════════════════════════════════════
-- Hoy una consulta firmada se puede editar por API directa: el RLS de
-- UPDATE/INSERT de consultations/prescriptions/consultation_diagnoses/
-- consultation_family_history NO chequea `signed_at` → edición silenciosa.
-- (El front la bloquea solo client-side; el DELETE de hijos sí estaba
-- bloqueado post-firma → inconsistencia.)
--
-- Etapa A cierra la fuga SIN ser bloqueo absoluto definitivo:
--   1. La FIRMA pasa a una RPC `sign_consultation()` SECURITY DEFINER
--      (gate: solo médico dueño; rechaza si ya firmada). Como es definer
--      (owner postgres, BYPASSRLS) puede setear signed_at aunque la RLS
--      endurecida no lo permita a `authenticated`.
--   2. Se endurece el RLS: `authenticated` solo puede UPDATE/INSERT
--      contenido clínico de consultas EN BORRADOR (`signed_at IS NULL`).
--      Sobre una firmada queda bloqueado.
--
-- La corrección controlada (adenda/versionado/motivo) es la **Etapa B**
-- (RPC `amend_consultation` definer, que bypaseará esta RLS). NO entra acá.
--
-- Sync consulta firmada → cita 'atendida': lo sigue haciendo el trigger
-- `sync_appointment_on_sign` (s6_02), que dispara con el UPDATE de la RPC.
--
-- vitals: se gatea por appointment_id (sin signed_at propio) → su
-- inmutabilidad se maneja en Etapa B. No se toca acá.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. RPC de firma (gate server-side) ─────────────────────
CREATE OR REPLACE FUNCTION sign_consultation(p_consultation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor_id uuid := get_user_doctor_id();   -- NULL si no es médico (asistente)
  v_owner     uuid;
  v_status    text;
BEGIN
  IF v_doctor_id IS NULL THEN
    RAISE EXCEPTION 'Solo el médico puede firmar una consulta' USING ERRCODE = '42501';
  END IF;

  SELECT doctor_id, status::text INTO v_owner, v_status
  FROM consultations WHERE id = p_consultation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consulta no encontrada' USING ERRCODE = 'P0002';
  END IF;

  -- Gate: solo el médico DUEÑO de la consulta puede firmar.
  IF v_owner IS DISTINCT FROM v_doctor_id THEN
    RAISE EXCEPTION 'Solo el médico tratante puede firmar esta consulta' USING ERRCODE = '42501';
  END IF;

  -- Rechazar si ya está firmada (o en estado distinto a draft).
  IF v_status = 'signed' THEN
    RAISE EXCEPTION 'La consulta ya está firmada' USING ERRCODE = 'P0003';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'La consulta no está en borrador (estado: %)', v_status USING ERRCODE = 'P0004';
  END IF;

  -- Firmar. Como SECURITY DEFINER, bypasea la RLS endurecida de abajo.
  -- El trigger sync_appointment_on_sign (s6_02) sincroniza la cita → atendida.
  UPDATE consultations
     SET status = 'signed', signed_at = now(), updated_at = now()
   WHERE id = p_consultation_id;

  RETURN jsonb_build_object('success', true, 'consultation_id', p_consultation_id, 'status', 'signed');
END;
$$;

GRANT EXECUTE ON FUNCTION sign_consultation(uuid) TO authenticated;

-- ─── 2. RLS endurecida: no editar/insertar contenido de firmados ────
-- Patrón: reproducimos el predicado de dueño existente + `signed_at IS NULL`.

-- 2.1 consultations — UPDATE solo borradores (la firma la hace la RPC definer)
DROP POLICY IF EXISTS consultations_update ON consultations;
CREATE POLICY consultations_update ON consultations
  FOR UPDATE
  USING (doctor_id = get_user_doctor_id() AND signed_at IS NULL)
  WITH CHECK (doctor_id = get_user_doctor_id() AND signed_at IS NULL);

-- 2.2 prescriptions — UPDATE/INSERT solo si la consulta padre está en borrador
DROP POLICY IF EXISTS prescriptions_update ON prescriptions;
CREATE POLICY prescriptions_update ON prescriptions
  FOR UPDATE
  USING (consultation_id IN (
    SELECT c.id FROM consultations c
     WHERE c.doctor_id = get_user_doctor_id() AND c.signed_at IS NULL))
  WITH CHECK (consultation_id IN (
    SELECT c.id FROM consultations c
     WHERE c.doctor_id = get_user_doctor_id() AND c.signed_at IS NULL));

DROP POLICY IF EXISTS prescriptions_insert ON prescriptions;
CREATE POLICY prescriptions_insert ON prescriptions
  FOR INSERT
  WITH CHECK (consultation_id IN (
    SELECT c.id FROM consultations c
     WHERE c.doctor_id = get_user_doctor_id() AND c.signed_at IS NULL));

-- 2.3 consultation_diagnoses — idem
DROP POLICY IF EXISTS consultation_diagnoses_update ON consultation_diagnoses;
CREATE POLICY consultation_diagnoses_update ON consultation_diagnoses
  FOR UPDATE
  USING (consultation_id IN (
    SELECT c.id FROM consultations c
     WHERE c.doctor_id = get_user_doctor_id() AND c.signed_at IS NULL))
  WITH CHECK (consultation_id IN (
    SELECT c.id FROM consultations c
     WHERE c.doctor_id = get_user_doctor_id() AND c.signed_at IS NULL));

DROP POLICY IF EXISTS consultation_diagnoses_insert ON consultation_diagnoses;
CREATE POLICY consultation_diagnoses_insert ON consultation_diagnoses
  FOR INSERT
  WITH CHECK (consultation_id IN (
    SELECT c.id FROM consultations c
     WHERE c.doctor_id = get_user_doctor_id() AND c.signed_at IS NULL));

-- 2.4 consultation_family_history — idem (doctor-scoped tras s7_26)
DROP POLICY IF EXISTS cfh_update ON consultation_family_history;
CREATE POLICY cfh_update ON consultation_family_history
  FOR UPDATE
  USING (consultation_id IN (
    SELECT c.id FROM consultations c
     WHERE c.doctor_id = get_user_doctor_id() AND c.signed_at IS NULL))
  WITH CHECK (consultation_id IN (
    SELECT c.id FROM consultations c
     WHERE c.doctor_id = get_user_doctor_id() AND c.signed_at IS NULL));

DROP POLICY IF EXISTS cfh_insert ON consultation_family_history;
CREATE POLICY cfh_insert ON consultation_family_history
  FOR INSERT
  WITH CHECK (consultation_id IN (
    SELECT c.id FROM consultations c
     WHERE c.doctor_id = get_user_doctor_id() AND c.signed_at IS NULL));

-- Nota: las policies SELECT y DELETE NO se tocan. DELETE de hijos ya
-- exige signed_at IS NULL (no se puede borrar contenido de firmados).
-- consultations no tiene policy DELETE para authenticated (sin cambio).
