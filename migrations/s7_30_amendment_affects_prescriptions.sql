-- ═══════════════════════════════════════════════════════════
-- Migración S7-30: distinguir adenda de TEXTO vs adenda de RECETA
-- ═══════════════════════════════════════════════════════════
-- Problema: tras s7_29 una corrección crea una adenda en
-- consultation_amendments, pero NO se registra si esa corrección tocó
-- recetas/medicamentos o solo texto de la consulta. La marca de impresión
-- "RECETA CORREGIDA" (PR #80) se disparaba con CUALQUIER adenda → una
-- corrección solo de texto marcaba la receta como corregida (incorrecto).
--
-- Fix (opción B): marcar explícitamente cada adenda con affects_prescriptions.
--   • true  → la corrección incluyó operaciones de receta (replace/add/remove).
--   • false → la corrección solo tocó campos de texto de la consulta.
-- Derivar de las filas de prescriptions NO sirve: un `add` nace
-- version=1/is_current=true, indistinguible de una receta original.
--
-- La tabla está vacía hoy (0 filas), así que DEFAULT false + setear en la RPC
-- es correcto desde el día uno, sin backfill.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Columna marcador ────────────────────────────────────
ALTER TABLE consultation_amendments
  ADD COLUMN IF NOT EXISTS affects_prescriptions boolean NOT NULL DEFAULT false;

-- ─── 2. amend_consultation: setear affects_prescriptions ─────
-- Idéntica a s7_29 salvo: (a) calcula v_affects_rx según p_prescription_ops;
-- (b) lo persiste en el INSERT de la adenda.
CREATE OR REPLACE FUNCTION amend_consultation(
  p_consultation_id    uuid,
  p_reason             text,
  p_consultation_changes jsonb DEFAULT '{}'::jsonb,
  p_prescription_ops   jsonb DEFAULT '[]'::jsonb,
  p_reason_category    text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor_id  uuid := get_user_doctor_id();
  v_owner      uuid;
  v_signed     timestamptz;
  v_reason     text := btrim(coalesce(p_reason, ''));
  v_allowed    text[] := ARRAY['chief_complaint','history_present_illness',
                               'physical_exam','internal_analysis','plan','family_history_notes'];
  v_key        text;
  v_before     jsonb;
  v_after      jsonb;
  v_version    int;
  v_op         jsonb;
  v_action     text;
  v_old        prescriptions%ROWTYPE;
  v_amend_id   uuid;
  v_affects_rx boolean := jsonb_array_length(COALESCE(p_prescription_ops, '[]'::jsonb)) > 0;
BEGIN
  -- ─── Gates ───
  IF v_doctor_id IS NULL THEN
    RAISE EXCEPTION 'Solo el médico puede corregir una consulta' USING ERRCODE = '42501';
  END IF;

  SELECT doctor_id, signed_at INTO v_owner, v_signed
    FROM consultations WHERE id = p_consultation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consulta no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner IS DISTINCT FROM v_doctor_id THEN
    RAISE EXCEPTION 'Solo el médico tratante puede corregir esta consulta' USING ERRCODE = '42501';
  END IF;
  IF v_signed IS NULL THEN
    RAISE EXCEPTION 'La consulta no está firmada; editá el borrador normalmente' USING ERRCODE = 'P0011';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'El motivo de corrección es obligatorio' USING ERRCODE = 'P0012';
  END IF;

  -- ─── Rechazo EXPLÍCITO de campos prohibidos / no corregibles ───
  FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_consultation_changes, '{}'::jsonb)) LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'Campo no corregible o prohibido: "%". No se permite cambiar paciente, médico, fechas, estado ni des-firmar.', v_key
        USING ERRCODE = 'P0013';
    END IF;
  END LOOP;

  -- ─── Snapshot ANTES (estado completo) ───
  v_before := consultation_snapshot(p_consultation_id);

  -- Habilitar el bypass del guard de inmutabilidad SOLO para esta transacción.
  PERFORM set_config('app.amending', 'on', true);

  -- ─── Aplicar cambios de la consulta (solo whitelist) ───
  UPDATE consultations SET
    chief_complaint         = CASE WHEN p_consultation_changes ? 'chief_complaint'         THEN p_consultation_changes->>'chief_complaint'         ELSE chief_complaint END,
    history_present_illness = CASE WHEN p_consultation_changes ? 'history_present_illness' THEN p_consultation_changes->>'history_present_illness' ELSE history_present_illness END,
    physical_exam           = CASE WHEN p_consultation_changes ? 'physical_exam'           THEN p_consultation_changes->>'physical_exam'           ELSE physical_exam END,
    internal_analysis       = CASE WHEN p_consultation_changes ? 'internal_analysis'       THEN p_consultation_changes->>'internal_analysis'       ELSE internal_analysis END,
    plan                    = CASE WHEN p_consultation_changes ? 'plan'                    THEN p_consultation_changes->>'plan'                    ELSE plan END,
    family_history_notes    = CASE WHEN p_consultation_changes ? 'family_history_notes'    THEN p_consultation_changes->>'family_history_notes'    ELSE family_history_notes END,
    updated_at              = now()
  WHERE id = p_consultation_id;

  -- ─── Aplicar operaciones de receta (versionado) ───
  FOR v_op IN SELECT jsonb_array_elements(COALESCE(p_prescription_ops, '[]'::jsonb)) LOOP
    v_action := COALESCE(v_op->>'op', 'replace');

    IF v_action = 'replace' THEN
      SELECT * INTO v_old FROM prescriptions
       WHERE id = (v_op->>'prescription_id')::uuid
         AND consultation_id = p_consultation_id
         AND is_current = true;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Receta a corregir no encontrada o no vigente (%).', v_op->>'prescription_id' USING ERRCODE = 'P0014';
      END IF;
      UPDATE prescriptions SET is_current = false WHERE id = v_old.id;
      INSERT INTO prescriptions (
        consultation_id, medication_id, dosage, frequency,
        duration_value, duration_unit, instructions, alternatives,
        version, is_current, replaces_id
      ) VALUES (
        p_consultation_id,
        COALESCE(NULLIF(v_op->>'medication_id','')::uuid, v_old.medication_id),
        COALESCE(v_op->>'dosage', v_old.dosage),
        COALESCE(v_op->>'frequency', v_old.frequency),
        COALESCE(NULLIF(v_op->>'duration_value','')::int, v_old.duration_value),
        COALESCE(NULLIF(v_op->>'duration_unit','')::duration_unit, v_old.duration_unit),
        COALESCE(v_op->>'instructions', v_old.instructions),
        v_old.alternatives,
        v_old.version + 1, true, v_old.id
      );

    ELSIF v_action = 'add' THEN
      IF NULLIF(v_op->>'medication_id','') IS NULL THEN
        RAISE EXCEPTION 'Agregar receta requiere medication_id' USING ERRCODE = 'P0016';
      END IF;
      INSERT INTO prescriptions (
        consultation_id, medication_id, dosage, frequency,
        duration_value, duration_unit, instructions, version, is_current
      ) VALUES (
        p_consultation_id, (v_op->>'medication_id')::uuid,
        v_op->>'dosage', v_op->>'frequency',
        NULLIF(v_op->>'duration_value','')::int, NULLIF(v_op->>'duration_unit','')::duration_unit,
        v_op->>'instructions', 1, true
      );

    ELSIF v_action = 'remove' THEN
      UPDATE prescriptions SET is_current = false
       WHERE id = (v_op->>'prescription_id')::uuid AND consultation_id = p_consultation_id;

    ELSE
      RAISE EXCEPTION 'Operación de receta inválida: "%"', v_action USING ERRCODE = 'P0015';
    END IF;
  END LOOP;

  -- Cerrar el bypass (transaction-local).
  PERFORM set_config('app.amending', 'off', true);

  -- ─── Snapshot DESPUÉS + adenda ───
  v_after := consultation_snapshot(p_consultation_id);
  v_version := (SELECT COALESCE(MAX(version), 1) FROM consultation_amendments WHERE consultation_id = p_consultation_id) + 1;

  INSERT INTO consultation_amendments (
    consultation_id, version, reason, reason_category, corrected_by,
    snapshot_before, snapshot_after, affects_prescriptions
  ) VALUES (
    p_consultation_id, v_version, v_reason, NULLIF(btrim(coalesce(p_reason_category,'')), ''),
    auth.uid(), v_before, v_after, v_affects_rx
  ) RETURNING id INTO v_amend_id;

  -- ─── Audit ───
  INSERT INTO audit_log (user_id, action, table_name, record_id, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'consultations', p_consultation_id,
    jsonb_build_object(
      'edited_via',            'consultation_amendment',
      'amendment_id',          v_amend_id,
      'version',               v_version,
      'reason',                v_reason,
      'affects_prescriptions', v_affects_rx
    )
  );

  RETURN jsonb_build_object('success', true, 'amendment_id', v_amend_id, 'version', v_version, 'affects_prescriptions', v_affects_rx);
END;
$$;

GRANT EXECUTE ON FUNCTION amend_consultation(uuid, text, jsonb, jsonb, text) TO authenticated;
