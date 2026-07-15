-- ═══════════════════════════════════════════════════════════
-- Migración S7-59: F7 — alternativas terapéuticas CORREGIBLES
--                  en la receta post-firma
-- ═══════════════════════════════════════════════════════════
-- PROBLEMA:
--   `alternatives` era el último campo de receta que la corrección post-firma
--   no podía tocar:
--     • en `replace` se arrastraba tal cual (`v_old.alternatives`) → no editable;
--     • en `add` ni siquiera figuraba en el INSERT → un medicamento agregado en
--       una corrección NUNCA podía tener alternativas.
--   Y `RecetaPrint` SÍ las imprime ("Alternativas: …"). Consecuencia: si unas
--   alternativas quedaban mal en una receta firmada, el médico NO tenía forma de
--   corregirlas — quedaban impresas para siempre.
--
-- FIX (quirúrgico: SOLO `alternatives`, dos puntos):
--   Se le aplica la MISMA regla vinculante que s7_58 fijó para el resto de los
--   campos de receta (y que la RPC ya usaba para vitales/diagnósticos/
--   antecedentes) — presencia de clave, no COALESCE ciego:
--
--     clave ausente              → conservar el valor anterior
--     clave presente (null / '') → limpiar (NULL)
--     clave presente con valor   → actualizar
--
--   1) `replace`: `v_old.alternatives` → CASE WHEN v_op ? 'alternatives' …
--   2) `add`:     se agrega la columna `alternatives` al INSERT.
--
-- NO CAMBIA (idéntico a s7_58): firma de la función, gates (médico dueño,
--   consulta firmada, motivo obligatorio, campos prohibidos P0013), versionado
--   de recetas (is_current / replaces_id / version), snapshots before/after,
--   consultation_amendments, affects_prescriptions, audit_log, los bloques de
--   diagnósticos / antecedentes / vitales, y TODA la semántica de nulls y de
--   'permanente' que introdujo F6 (duration_value / duration_unit / dosage /
--   frequency / instructions).
--
-- FUERA DE ALCANCE: sin backfill — las filas históricas quedan como están.
--   La receta impresa (`RecetaPrint`) NO se toca: ya sabe mostrar alternativas.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION amend_consultation(
  p_consultation_id      uuid,
  p_reason               text,
  p_consultation_changes jsonb DEFAULT '{}'::jsonb,
  p_prescription_ops     jsonb DEFAULT '[]'::jsonb,
  p_reason_category      text  DEFAULT NULL,
  p_diagnosis_ops        jsonb DEFAULT '[]'::jsonb,
  p_family_history_ops   jsonb DEFAULT '[]'::jsonb,
  p_vitals_changes       jsonb DEFAULT '{}'::jsonb
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
  v_appt       uuid;
  v_patient    uuid;
  -- s7_58: duración resuelta por presencia de clave + regla de 'permanente'
  v_dur_value  int;
  v_dur_unit   duration_unit;
BEGIN
  -- ─── Gates ───
  IF v_doctor_id IS NULL THEN
    RAISE EXCEPTION 'Solo el médico puede corregir una consulta' USING ERRCODE = '42501';
  END IF;

  SELECT doctor_id, signed_at, appointment_id, patient_id
    INTO v_owner, v_signed, v_appt, v_patient
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

  -- ─── Rechazo EXPLÍCITO de campos prohibidos (texto) ───
  FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_consultation_changes, '{}'::jsonb)) LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'Campo no corregible o prohibido: "%". No se permite cambiar paciente, médico, fechas, estado ni des-firmar.', v_key
        USING ERRCODE = 'P0013';
    END IF;
  END LOOP;

  -- ─── Snapshot ANTES ───
  v_before := consultation_snapshot(p_consultation_id);

  -- Bypass del guard de inmutabilidad de consultations SOLO esta transacción.
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

  -- ─── Operaciones de receta (versionado) ───
  FOR v_op IN SELECT jsonb_array_elements(COALESCE(p_prescription_ops, '[]'::jsonb)) LOOP
    v_action := COALESCE(v_op->>'op', 'replace');

    IF v_action = 'replace' THEN
      SELECT * INTO v_old FROM prescriptions
       WHERE id = (v_op->>'prescription_id')::uuid
         AND consultation_id = p_consultation_id AND is_current = true;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Receta a corregir no encontrada o no vigente (%).', v_op->>'prescription_id' USING ERRCODE = 'P0014';
      END IF;

      -- s7_58: presencia de clave (no COALESCE). Ausente → conserva; presente
      -- con null/'' → limpia; presente con valor → actualiza.
      v_dur_unit := CASE WHEN v_op ? 'duration_unit'
                         THEN NULLIF(v_op->>'duration_unit', '')::duration_unit
                         ELSE v_old.duration_unit END;
      v_dur_value := CASE WHEN v_op ? 'duration_value'
                          THEN NULLIF(v_op->>'duration_value', '')::int
                          ELSE v_old.duration_value END;
      -- Regla clínica: 'permanente' no lleva duración numérica (server-side, no
      -- depende de que el cliente la limpie).
      IF v_dur_unit = 'permanente'::duration_unit THEN
        v_dur_value := NULL;
      END IF;

      UPDATE prescriptions SET is_current = false WHERE id = v_old.id;
      INSERT INTO prescriptions (
        consultation_id, medication_id, dosage, frequency, duration_value,
        duration_unit, instructions, alternatives, version, is_current, replaces_id
      ) VALUES (
        p_consultation_id,
        COALESCE(NULLIF(v_op->>'medication_id','')::uuid, v_old.medication_id),
        CASE WHEN v_op ? 'dosage'
             THEN NULLIF(btrim(COALESCE(v_op->>'dosage', '')), '')
             ELSE v_old.dosage END,
        CASE WHEN v_op ? 'frequency'
             THEN NULLIF(btrim(COALESCE(v_op->>'frequency', '')), '')
             ELSE v_old.frequency END,
        v_dur_value,
        v_dur_unit,
        CASE WHEN v_op ? 'instructions'
             THEN NULLIF(btrim(COALESCE(v_op->>'instructions', '')), '')
             ELSE v_old.instructions END,
        -- s7_59 (F7): las alternativas ya son corregibles, con la misma regla.
        CASE WHEN v_op ? 'alternatives'
             THEN NULLIF(btrim(COALESCE(v_op->>'alternatives', '')), '')
             ELSE v_old.alternatives END,
        v_old.version + 1, true, v_old.id
      );

    ELSIF v_action = 'add' THEN
      IF NULLIF(v_op->>'medication_id','') IS NULL THEN
        RAISE EXCEPTION 'Agregar receta requiere medication_id' USING ERRCODE = 'P0016';
      END IF;

      v_dur_unit  := NULLIF(v_op->>'duration_unit', '')::duration_unit;
      v_dur_value := NULLIF(v_op->>'duration_value', '')::int;
      IF v_dur_unit = 'permanente'::duration_unit THEN
        v_dur_value := NULL;
      END IF;

      INSERT INTO prescriptions (
        consultation_id, medication_id, dosage, frequency,
        duration_value, duration_unit, instructions, alternatives, version, is_current
      ) VALUES (
        p_consultation_id, (v_op->>'medication_id')::uuid,
        NULLIF(btrim(COALESCE(v_op->>'dosage', '')), ''),
        NULLIF(btrim(COALESCE(v_op->>'frequency', '')), ''),
        v_dur_value, v_dur_unit,
        NULLIF(btrim(COALESCE(v_op->>'instructions', '')), ''),
        -- s7_59 (F7): un medicamento agregado en la corrección ya puede llevar
        -- alternativas (antes la columna ni figuraba → siempre NULL).
        NULLIF(btrim(COALESCE(v_op->>'alternatives', '')), ''),
        1, true
      );

    ELSIF v_action = 'remove' THEN
      UPDATE prescriptions SET is_current = false
       WHERE id = (v_op->>'prescription_id')::uuid AND consultation_id = p_consultation_id;
    ELSE
      RAISE EXCEPTION 'Operación de receta inválida: "%"', v_action USING ERRCODE = 'P0015';
    END IF;
  END LOOP;

  -- ─── Operaciones de diagnósticos (in-place) ───
  FOR v_op IN SELECT jsonb_array_elements(COALESCE(p_diagnosis_ops, '[]'::jsonb)) LOOP
    v_action := COALESCE(v_op->>'op', 'replace');
    IF v_action = 'add' THEN
      IF NULLIF(v_op->>'diagnosis_id','') IS NULL THEN
        RAISE EXCEPTION 'Agregar diagnóstico requiere diagnosis_id' USING ERRCODE = 'P0017';
      END IF;
      INSERT INTO consultation_diagnoses (consultation_id, diagnosis_id, diagnosis_type, diagnosis_status, notes)
      VALUES (
        p_consultation_id, (v_op->>'diagnosis_id')::uuid,
        COALESCE(NULLIF(v_op->>'diagnosis_type','')::diagnosis_type, 'presuntivo'::diagnosis_type),
        COALESCE(NULLIF(v_op->>'diagnosis_status','')::diagnosis_status, 'activo'::diagnosis_status),
        NULLIF(v_op->>'notes','')
      );
    ELSIF v_action = 'replace' THEN
      IF NULLIF(v_op->>'id','') IS NULL THEN
        RAISE EXCEPTION 'Corregir diagnóstico requiere id' USING ERRCODE = 'P0017';
      END IF;
      UPDATE consultation_diagnoses SET
        diagnosis_id     = COALESCE(NULLIF(v_op->>'diagnosis_id','')::uuid, diagnosis_id),
        diagnosis_type   = COALESCE(NULLIF(v_op->>'diagnosis_type','')::diagnosis_type, diagnosis_type),
        diagnosis_status = COALESCE(NULLIF(v_op->>'diagnosis_status','')::diagnosis_status, diagnosis_status),
        notes            = CASE WHEN v_op ? 'notes' THEN NULLIF(v_op->>'notes','') ELSE notes END
      WHERE id = (v_op->>'id')::uuid AND consultation_id = p_consultation_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Diagnóstico a corregir no encontrado (%).', v_op->>'id' USING ERRCODE = 'P0018';
      END IF;
    ELSIF v_action = 'remove' THEN
      DELETE FROM consultation_diagnoses WHERE id = (v_op->>'id')::uuid AND consultation_id = p_consultation_id;
    ELSE
      RAISE EXCEPTION 'Operación de diagnóstico inválida: "%"', v_action USING ERRCODE = 'P0019';
    END IF;
  END LOOP;

  -- ─── Operaciones de antecedentes familiares estructurados (in-place) ───
  FOR v_op IN SELECT jsonb_array_elements(COALESCE(p_family_history_ops, '[]'::jsonb)) LOOP
    v_action := COALESCE(v_op->>'op', 'replace');
    IF v_action = 'add' THEN
      IF NULLIF(v_op->>'family_history_id','') IS NULL THEN
        RAISE EXCEPTION 'Agregar antecedente requiere family_history_id' USING ERRCODE = 'P0020';
      END IF;
      INSERT INTO consultation_family_history (consultation_id, family_history_id, notes)
      VALUES (p_consultation_id, (v_op->>'family_history_id')::uuid, NULLIF(v_op->>'notes',''));
    ELSIF v_action = 'replace' THEN
      IF NULLIF(v_op->>'id','') IS NULL THEN
        RAISE EXCEPTION 'Corregir antecedente requiere id' USING ERRCODE = 'P0020';
      END IF;
      UPDATE consultation_family_history SET
        family_history_id = COALESCE(NULLIF(v_op->>'family_history_id','')::uuid, family_history_id),
        notes             = CASE WHEN v_op ? 'notes' THEN NULLIF(v_op->>'notes','') ELSE notes END
      WHERE id = (v_op->>'id')::uuid AND consultation_id = p_consultation_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Antecedente a corregir no encontrado (%).', v_op->>'id' USING ERRCODE = 'P0021';
      END IF;
    ELSIF v_action = 'remove' THEN
      DELETE FROM consultation_family_history WHERE id = (v_op->>'id')::uuid AND consultation_id = p_consultation_id;
    ELSE
      RAISE EXCEPTION 'Operación de antecedente inválida: "%"', v_action USING ERRCODE = 'P0022';
    END IF;
  END LOOP;

  -- ─── Signos vitales (in-place; 1 fila por cita). bmi lo manda el cliente. ───
  IF p_vitals_changes IS NOT NULL AND p_vitals_changes <> '{}'::jsonb THEN
    IF v_appt IS NULL THEN
      RAISE EXCEPTION 'No se pueden corregir signos vitales: la consulta no tiene cita asociada' USING ERRCODE = 'P0023';
    END IF;
    IF EXISTS (SELECT 1 FROM vitals WHERE appointment_id = v_appt) THEN
      UPDATE vitals SET
        systolic_bp      = CASE WHEN p_vitals_changes ? 'systolic_bp'      THEN NULLIF(p_vitals_changes->>'systolic_bp','')::numeric      ELSE systolic_bp END,
        diastolic_bp     = CASE WHEN p_vitals_changes ? 'diastolic_bp'     THEN NULLIF(p_vitals_changes->>'diastolic_bp','')::numeric     ELSE diastolic_bp END,
        heart_rate       = CASE WHEN p_vitals_changes ? 'heart_rate'       THEN NULLIF(p_vitals_changes->>'heart_rate','')::numeric       ELSE heart_rate END,
        respiratory_rate = CASE WHEN p_vitals_changes ? 'respiratory_rate' THEN NULLIF(p_vitals_changes->>'respiratory_rate','')::numeric ELSE respiratory_rate END,
        temperature      = CASE WHEN p_vitals_changes ? 'temperature'      THEN NULLIF(p_vitals_changes->>'temperature','')::numeric      ELSE temperature END,
        spo2             = CASE WHEN p_vitals_changes ? 'spo2'             THEN NULLIF(p_vitals_changes->>'spo2','')::numeric             ELSE spo2 END,
        weight_kg        = CASE WHEN p_vitals_changes ? 'weight_kg'        THEN NULLIF(p_vitals_changes->>'weight_kg','')::numeric        ELSE weight_kg END,
        height_cm        = CASE WHEN p_vitals_changes ? 'height_cm'        THEN NULLIF(p_vitals_changes->>'height_cm','')::numeric        ELSE height_cm END,
        bmi              = CASE WHEN p_vitals_changes ? 'bmi'              THEN NULLIF(p_vitals_changes->>'bmi','')::numeric              ELSE bmi END,
        recorded_at      = now(),
        recorded_by      = auth.uid()
      WHERE appointment_id = v_appt;
    ELSE
      INSERT INTO vitals (
        appointment_id, patient_id, systolic_bp, diastolic_bp, heart_rate,
        respiratory_rate, temperature, spo2, weight_kg, height_cm, bmi,
        recorded_at, recorded_by
      ) VALUES (
        v_appt, v_patient,
        NULLIF(p_vitals_changes->>'systolic_bp','')::numeric,
        NULLIF(p_vitals_changes->>'diastolic_bp','')::numeric,
        NULLIF(p_vitals_changes->>'heart_rate','')::numeric,
        NULLIF(p_vitals_changes->>'respiratory_rate','')::numeric,
        NULLIF(p_vitals_changes->>'temperature','')::numeric,
        NULLIF(p_vitals_changes->>'spo2','')::numeric,
        NULLIF(p_vitals_changes->>'weight_kg','')::numeric,
        NULLIF(p_vitals_changes->>'height_cm','')::numeric,
        NULLIF(p_vitals_changes->>'bmi','')::numeric,
        now(), auth.uid()
      );
    END IF;
  END IF;

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

GRANT EXECUTE ON FUNCTION amend_consultation(uuid, text, jsonb, jsonb, text, jsonb, jsonb, jsonb) TO authenticated;
