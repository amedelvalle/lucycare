-- ═══════════════════════════════════════════════════════════
-- Migración S7-29: correcciones post-firma — Etapa B (B1: backend/modelo/RPC)
-- ═══════════════════════════════════════════════════════════
-- Habilita la CORRECCIÓN CONTROLADA de consultas firmadas, sin reabrir la
-- edición libre (Etapa A / s7_28 sigue bloqueando el UPDATE directo).
--
-- Alcance B1 (opción b — lo crítico/operativo):
--   • Campos principales de la consulta: chief_complaint,
--     history_present_illness, physical_exam, internal_analysis, plan,
--     family_history_notes.
--   • Recetas: corrección/versionado (v2) — medicamento, dosis, frecuencia,
--     duración, indicaciones.
-- Diferido a B1.5/B2 (el MODELO ya queda preparado, sin rehacer arquitectura):
--   • diagnósticos (consultation_diagnoses), antecedentes estructurados
--     (consultation_family_history), signos vitales (vitals).
--   El snapshot captura TODO el estado (incluidos esos), así que sumarlos
--   después es solo extender el "apply" de la RPC.
--
-- Principios:
--   • Append-only: nada se sobrescribe en silencio. Cada corrección crea
--     una adenda con snapshot antes/después + motivo + autor + versión.
--   • Recetas: la versión anterior NO se borra (queda histórica,
--     is_current=false); se crea la v2 (is_current=true, replaces_id).
--   • Solo el médico DUEÑO corrige (get_user_doctor_id()); asistente no.
--   • Motivo OBLIGATORIO.
--   • Campos PROHIBIDOS → rechazo EXPLÍCITO (no se ignoran en silencio):
--     paciente, médico, fecha de consulta, signed_at, status, des-firmar.
--   • La RPC es SECURITY DEFINER → bypasea la RLS de Etapa A (es el ÚNICO
--     camino para tocar un firmado). La edición directa sigue bloqueada.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Tabla de adendas (append-only) ──────────────────────
CREATE TABLE IF NOT EXISTS consultation_amendments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  version         int  NOT NULL,                 -- 2, 3, … (la firma original = v1)
  reason          text NOT NULL,                 -- motivo OBLIGATORIO (interno, Q3)
  reason_category text,
  corrected_by    uuid NOT NULL REFERENCES profiles(id),
  corrected_at    timestamptz NOT NULL DEFAULT now(),
  snapshot_before jsonb NOT NULL,                -- estado completo antes
  snapshot_after  jsonb NOT NULL,                -- estado completo después
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultation_id, version)
);
CREATE INDEX IF NOT EXISTS idx_consultation_amendments_consultation
  ON consultation_amendments (consultation_id, version);

ALTER TABLE consultation_amendments ENABLE ROW LEVEL SECURITY;

-- Lectura: solo el médico dueño de la consulta (consistente con el gate
-- clínico). INSERT/UPDATE/DELETE: nadie directo → solo la RPC definer.
DROP POLICY IF EXISTS consultation_amendments_select ON consultation_amendments;
CREATE POLICY consultation_amendments_select ON consultation_amendments
  FOR SELECT USING (
    consultation_id IN (SELECT c.id FROM consultations c WHERE c.doctor_id = get_user_doctor_id())
  );

-- ─── 2. Versionado de recetas ───────────────────────────────
ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS version     int     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_current  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS replaces_id uuid    NULL REFERENCES prescriptions(id);

-- Las recetas existentes quedan version=1, is_current=true (default). Las
-- lecturas/impresión deberán filtrar is_current=true (B2/B3).

-- ─── 2.bis Bypass controlado del guard de inmutabilidad ─────
-- El trigger pre-existente prevent_signed_consultation_edit (BEFORE UPDATE
-- ON consultations) bloquea TODO update de una consulta firmada — y los
-- triggers corren aun dentro de RPC SECURITY DEFINER. Le agregamos un
-- bypass por GUC de sesión `app.amending`: SOLO la RPC amend_consultation
-- lo setea (transaction-local), para aplicar la corrección trazable.
-- Cualquier otro UPDATE de una consulta firmada se sigue bloqueando (y la
-- RLS de Etapa A ya filtra la fila firmada para `authenticated`, así que
-- un cliente directo ni siquiera llega a este trigger).
CREATE OR REPLACE FUNCTION prevent_signed_consultation_edit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.amending', true) = 'on' THEN
    RETURN NEW;  -- corrección controlada vía amend_consultation()
  END IF;
  IF OLD.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede editar una consulta firmada. La consulta fue firmada el %', OLD.signed_at;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 3. Helper: snapshot completo de la consulta ────────────
CREATE OR REPLACE FUNCTION consultation_snapshot(p_consultation_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'consultation', (SELECT to_jsonb(c) FROM consultations c WHERE c.id = p_consultation_id),
    'prescriptions', (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.version), '[]'::jsonb)
                        FROM prescriptions p WHERE p.consultation_id = p_consultation_id),
    'diagnoses', (SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
                    FROM consultation_diagnoses d WHERE d.consultation_id = p_consultation_id),
    'family_history', (SELECT COALESCE(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
                         FROM consultation_family_history f WHERE f.consultation_id = p_consultation_id),
    'vitals', (SELECT COALESCE(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
                 FROM vitals v
                WHERE v.appointment_id = (SELECT appointment_id FROM consultations WHERE id = p_consultation_id))
  );
$$;

-- ─── 4. RPC de corrección controlada ────────────────────────
-- p_consultation_changes: solo campos de la whitelist (texto de consulta).
-- p_prescription_ops: array de operaciones de receta:
--   { "op":"replace", "prescription_id":"…", "dosage":"…", "frequency":"…",
--     "duration_value":7, "duration_unit":"días", "instructions":"…",
--     "medication_id":"…" }   → versiona (v2): la vigente pasa a histórica.
--   { "op":"add", "medication_id":"…", "dosage":"…", … }  → nueva receta.
--   { "op":"remove", "prescription_id":"…" }              → marca no vigente.
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
  -- Cualquier clave fuera de la whitelist (incl. patient_id, doctor_id,
  -- started_at, signed_at, status, id, clinic_id, appointment_id) → error.
  FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_consultation_changes, '{}'::jsonb)) LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'Campo no corregible o prohibido: "%". No se permite cambiar paciente, médico, fechas, estado ni des-firmar.', v_key
        USING ERRCODE = 'P0013';
    END IF;
  END LOOP;

  -- ─── Snapshot ANTES (estado completo) ───
  v_before := consultation_snapshot(p_consultation_id);

  -- Habilitar el bypass del guard de inmutabilidad SOLO para esta
  -- transacción (lo lee prevent_signed_consultation_edit).
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
        v_old.alternatives,                       -- se conserva (no se edita en B1)
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

  -- Cerrar el bypass (los SELECT del snapshot/adenda no lo necesitan; igual
  -- la GUC es transaction-local y se limpia al terminar la transacción).
  PERFORM set_config('app.amending', 'off', true);

  -- ─── Snapshot DESPUÉS + adenda ───
  v_after := consultation_snapshot(p_consultation_id);
  v_version := (SELECT COALESCE(MAX(version), 1) FROM consultation_amendments WHERE consultation_id = p_consultation_id) + 1;

  INSERT INTO consultation_amendments (
    consultation_id, version, reason, reason_category, corrected_by,
    snapshot_before, snapshot_after
  ) VALUES (
    p_consultation_id, v_version, v_reason, NULLIF(btrim(coalesce(p_reason_category,'')), ''),
    v_doctor_id, v_before, v_after
  ) RETURNING id INTO v_amend_id;

  -- ─── Audit ───
  INSERT INTO audit_log (user_id, action, table_name, record_id, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'consultations', p_consultation_id,
    jsonb_build_object(
      'edited_via',    'consultation_amendment',
      'amendment_id',  v_amend_id,
      'version',       v_version,
      'reason',        v_reason
    )
  );

  RETURN jsonb_build_object('success', true, 'amendment_id', v_amend_id, 'version', v_version);
END;
$$;

GRANT EXECUTE ON FUNCTION consultation_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION amend_consultation(uuid, text, jsonb, jsonb, text) TO authenticated;
