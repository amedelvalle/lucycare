-- ═══════════════════════════════════════════════════════════
-- Migración S7-46: F4-2 — backend del merge admin de fichas (intra-clínica)
-- ═══════════════════════════════════════════════════════════
-- Contexto: docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md (DM1–DM9
-- cerradas) + columnas pasivas `patients.merged_into_patient_id`/`merged_at`
-- de s7_45. Alcance ESTRICTO: fusiona dos fichas `patients` de la MISMA
-- clínica que son la misma persona, re-apuntando su expediente (appointments
-- / consultations / vitals) a la ficha destino y NEUTRALIZANDO la fuente
-- (no hard-delete). NO toca identidad global (`profiles`), `auth.users`,
-- credenciales ni roles; NO fusiona expedientes cross-clínica; sin UI; sin
-- unmerge implementado (pero el log nace con todo para la reversa formal).
--
-- Piezas:
--   1. Tabla `patient_merge_log` (trazabilidad + reversibilidad formal).
--   2. Bypass propio `app.merging_patients` añadido a DOS guards-trigger
--      (sin reutilizar `app.amending`):
--        • prevent_signed_consultation_edit (s7_29): el re-point de
--          consultations.patient_id de una consulta FIRMADA lo dispararía.
--        • prevent_linked_patient_identity_edit (P0030, s7_33): al neutralizar
--          una fuente VINCULADA (caso E3) se cambia document_number/profile_id
--          (campos de identidad) → lo dispararía.
--   3. Helper interno `_patient_merge_eligibility(source, target)` (read-only):
--      diagnóstico + evidencia + dirección + conteos + drafts + block_code.
--      Lo usan preflight y merge → MISMA lógica, sin drift.
--   4. RPC `admin_merge_patients_preflight(source, target)` — dry-run.
--   5. RPC `admin_merge_patients(source, target, reason)` — transaccional,
--      revalida TODO server-side (el preflight no es autoritativo).
--
-- Errores (serie P0060–P0068, no colisiona con códigos previos):
--   P0001 no admin · P0060 distinta clínica/no existe · P0061 ya fusionada ·
--   P0062 source==target · P0063 evidencia insuficiente o anti-evidencia ·
--   P0064 dirección inválida (la vinculada debe ser destino) ·
--   P0065 ambas vinculadas a profiles distintos · P0066 motivo < 10 ·
--   P0067 borrador abierto en la fuente · P0068 ficha inactiva.
--
-- Borrador abierto en el TARGET = warning informativo (no bloquea): no se
-- mueve ni se modifica (DM3c). En la fuente SÍ bloquea (P0067).
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Tabla de log (trazabilidad + reversa formal futura) ──
CREATE TABLE IF NOT EXISTS patient_merge_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_patient_id uuid NOT NULL REFERENCES patients(id),  -- NO ACTION: la fuente se conserva
  target_patient_id uuid NOT NULL REFERENCES patients(id),
  clinic_id         uuid NOT NULL REFERENCES clinics(id),
  merged_by         uuid NOT NULL REFERENCES profiles(id),
  reason            text NOT NULL,
  evidence          jsonb NOT NULL,   -- {type:'same_document'|'same_profile', detail:...}
  source_snapshot   jsonb NOT NULL,   -- to_jsonb(source) ANTES del merge (ficha entera)
  target_snapshot   jsonb NOT NULL,   -- to_jsonb(target) ANTES
  moved_counts      jsonb NOT NULL,   -- {appointments,consultations,vitals}
  moved_ids         jsonb NOT NULL,   -- {appointment_ids[],consultation_ids[],vitals_ids[]} ← reversa precisa
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Reversa formal (prevista; NULL en F4-2, la usa el unmerge futuro):
  unmerged_at       timestamptz,
  unmerged_by       uuid REFERENCES profiles(id),
  unmerge_reason    text
);

CREATE INDEX IF NOT EXISTS patient_merge_log_source ON patient_merge_log(source_patient_id);
CREATE INDEX IF NOT EXISTS patient_merge_log_target ON patient_merge_log(target_patient_id);

ALTER TABLE patient_merge_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "merge_log_admin_select" ON patient_merge_log;
CREATE POLICY "merge_log_admin_select" ON patient_merge_log
  FOR SELECT TO authenticated
  USING (is_admin());
-- Sin policy INSERT/UPDATE/DELETE: solo las RPCs definer escriben.

-- ─── 2. Bypass `app.merging_patients` en los dos guards ──────
-- (a) Guard de inmutabilidad de consulta firmada (base s7_29; se le AÑADE el
--     bypass del merge — el de app.amending se conserva idéntico).
CREATE OR REPLACE FUNCTION prevent_signed_consultation_edit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.amending', true) = 'on' THEN
    RETURN NEW;  -- corrección controlada vía amend_consultation()
  END IF;
  IF current_setting('app.merging_patients', true) = 'on' THEN
    RETURN NEW;  -- re-point de patient_id en merge admin (admin_merge_patients)
  END IF;
  IF OLD.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede editar una consulta firmada. La consulta fue firmada el %', OLD.signed_at;
  END IF;
  RETURN NEW;
END;
$$;

-- (b) Guard de identidad de paciente vinculado (base s7_33, P0030; se le AÑADE
--     el bypass del merge — el de app.syncing_patient_identity se conserva).
CREATE OR REPLACE FUNCTION prevent_linked_patient_identity_edit()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.syncing_patient_identity', true) = 'on' THEN
    RETURN NEW;  -- sync espejo profiles→patients (sync_identity_to_patients)
  END IF;
  IF current_setting('app.merging_patients', true) = 'on' THEN
    RETURN NEW;  -- neutralización de la fuente en merge admin
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

-- ─── 3. Helper interno de elegibilidad (read-only, compartido) ──
-- Devuelve el diagnóstico completo + `block_code` (primer fallo, o NULL).
-- NO chequea el motivo (P0066, eso es exclusivo del merge). Identidad
-- (nombre/documento/DOB) = metadatos que LucyCare gobierna; NO expone
-- contenido clínico (solo conteos).
CREATE OR REPLACE FUNCTION _patient_merge_eligibility(p_source_id uuid, p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s              patients%ROWTYPE;
  t              patients%ROWTYPE;
  v_same_clinic  boolean;
  v_src_doc      text;
  v_tgt_doc      text;
  v_same_document boolean;
  v_same_profile boolean;
  v_anti         boolean;
  v_evidence     text;
  v_src_linked   boolean;
  v_tgt_linked   boolean;
  v_src_drafts   int;
  v_tgt_drafts   int;
  v_appts        int;
  v_cons_signed  int;
  v_cons_draft   int;
  v_vitals       int;
  v_block        text := NULL;
  v_direction    text := 'free';  -- 'free' | 'forced_target_is_linked'
BEGIN
  SELECT * INTO s FROM patients WHERE id = p_source_id;
  SELECT * INTO t FROM patients WHERE id = p_target_id;

  -- Existencia + misma clínica (P0060) / self (P0062) primero.
  IF s.id IS NULL OR t.id IS NULL THEN
    RETURN jsonb_build_object('block_code', 'P0060',
      'block_reason', 'Una de las fichas no existe', 'eligible', false);
  END IF;
  IF p_source_id = p_target_id THEN
    RETURN jsonb_build_object('block_code', 'P0062',
      'block_reason', 'La ficha fuente y destino son la misma', 'eligible', false);
  END IF;

  v_same_clinic := (s.clinic_id = t.clinic_id);

  v_src_doc := nullif(btrim(s.document_number), '');
  v_tgt_doc := nullif(btrim(t.document_number), '');
  v_same_document := (s.document_type = t.document_type
                      AND v_src_doc IS NOT NULL AND v_src_doc = v_tgt_doc);
  v_same_profile := (s.profile_id IS NOT NULL AND s.profile_id = t.profile_id);
  v_anti := (s.date_of_birth IS DISTINCT FROM t.date_of_birth)
            OR (s.gender IS DISTINCT FROM t.gender);
  v_evidence := CASE WHEN v_same_document THEN 'same_document'
                     WHEN v_same_profile THEN 'same_profile'
                     ELSE 'none' END;
  v_src_linked := (s.profile_id IS NOT NULL);
  v_tgt_linked := (t.profile_id IS NOT NULL);

  SELECT count(*) INTO v_src_drafts FROM consultations WHERE patient_id = p_source_id AND signed_at IS NULL;
  SELECT count(*) INTO v_tgt_drafts FROM consultations WHERE patient_id = p_target_id AND signed_at IS NULL;
  SELECT count(*) INTO v_appts       FROM appointments  WHERE patient_id = p_source_id;
  SELECT count(*) INTO v_cons_signed FROM consultations WHERE patient_id = p_source_id AND signed_at IS NOT NULL;
  SELECT count(*) INTO v_cons_draft  FROM consultations WHERE patient_id = p_source_id AND signed_at IS NULL;
  SELECT count(*) INTO v_vitals      FROM vitals        WHERE patient_id = p_source_id;

  -- Evaluación de bloqueos en orden (el primero que falle gana).
  IF NOT v_same_clinic THEN
    v_block := 'P0060';
  ELSIF s.merged_into_patient_id IS NOT NULL OR t.merged_into_patient_id IS NOT NULL THEN
    v_block := 'P0061';
  ELSIF NOT s.is_active OR NOT t.is_active THEN
    v_block := 'P0068';
  ELSIF (NOT (v_same_document OR v_same_profile)) OR v_anti THEN
    v_block := 'P0063';
  ELSIF v_src_linked AND NOT v_tgt_linked THEN
    v_block := 'P0064';   -- la vinculada (fuente) debería ser el destino
  ELSIF v_src_linked AND v_tgt_linked AND s.profile_id <> t.profile_id THEN
    v_block := 'P0065';
  ELSIF v_src_drafts > 0 THEN
    v_block := 'P0067';
  END IF;

  IF (v_tgt_linked AND NOT v_src_linked) OR (v_src_linked AND v_tgt_linked) THEN
    v_direction := 'forced_target_is_linked';
  END IF;

  RETURN jsonb_build_object(
    'block_code', v_block,
    'eligible', (v_block IS NULL),
    'same_clinic', v_same_clinic,
    'clinic_id', s.clinic_id,
    'evidence', jsonb_build_object(
      'type', v_evidence,
      'same_document', v_same_document,
      'same_profile', v_same_profile,
      'anti_evidence', v_anti),
    'direction', v_direction,
    'source', jsonb_build_object(
      'id', s.id, 'full_name', s.full_name, 'document_type', s.document_type,
      'document_number', s.document_number, 'date_of_birth', s.date_of_birth,
      'gender', s.gender, 'phone', s.phone, 'is_active', s.is_active,
      'linked', v_src_linked, 'link_confirmed_at', s.link_confirmed_at,
      'merged_into_patient_id', s.merged_into_patient_id),
    'target', jsonb_build_object(
      'id', t.id, 'full_name', t.full_name, 'document_type', t.document_type,
      'document_number', t.document_number, 'date_of_birth', t.date_of_birth,
      'gender', t.gender, 'phone', t.phone, 'is_active', t.is_active,
      'linked', v_tgt_linked, 'link_confirmed_at', t.link_confirmed_at,
      'merged_into_patient_id', t.merged_into_patient_id),
    'counts', jsonb_build_object(
      'appointments', v_appts, 'consultations_signed', v_cons_signed,
      'consultations_draft', v_cons_draft, 'vitals', v_vitals),
    'source_open_drafts', v_src_drafts,
    'target_open_drafts', v_tgt_drafts
  );
END;
$$;

REVOKE ALL ON FUNCTION _patient_merge_eligibility(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _patient_merge_eligibility(uuid, uuid) FROM anon;
-- Helper interno: lo invocan las RPCs definer (corren como owner). No se concede a authenticated.

-- ─── 4. RPC preflight (dry-run, read-only) ───────────────────
CREATE OR REPLACE FUNCTION admin_merge_patients_preflight(p_source_id uuid, p_target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
  v_warnings jsonb := '[]'::jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador de plataforma puede usar esta herramienta' USING ERRCODE = 'P0001';
  END IF;

  v := _patient_merge_eligibility(p_source_id, p_target_id);

  -- Warning informativo (NO bloquea, DM3c): borrador abierto en el destino.
  IF (v->>'target_open_drafts')::int > 0 THEN
    v_warnings := v_warnings || jsonb_build_object(
      'code', 'W_TARGET_DRAFT',
      'message', 'El destino tiene una consulta en borrador (no se mueve ni se modifica).');
  END IF;

  RETURN v || jsonb_build_object('warnings', v_warnings, 'is_preflight', true);
END;
$$;

REVOKE ALL ON FUNCTION admin_merge_patients_preflight(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_merge_patients_preflight(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION admin_merge_patients_preflight(uuid, uuid) TO authenticated;

-- ─── 5. RPC merge (transaccional, autoritativa) ──────────────
CREATE OR REPLACE FUNCTION admin_merge_patients(p_source_id uuid, p_target_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin    uuid := auth.uid();
  s          patients%ROWTYPE;
  t          patients%ROWTYPE;
  v          jsonb;
  v_block    text;
  v_appt_ids uuid[];
  v_cons_ids uuid[];
  v_vit_ids  uuid[];
  v_n_appt   int;
  v_n_cons   int;
  v_n_vit    int;
  v_log_id   uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador de plataforma puede usar esta herramienta' USING ERRCODE = 'P0001';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'El motivo es obligatorio (mínimo 10 caracteres)' USING ERRCODE = 'P0066';
  END IF;

  -- Lock de ambas fichas (anti-carrera). El orden por id evita deadlocks.
  SELECT * INTO s FROM patients WHERE id = p_source_id FOR UPDATE;
  SELECT * INTO t FROM patients WHERE id = p_target_id FOR UPDATE;

  -- Revalidación autoritativa server-side (el preflight no cuenta).
  v := _patient_merge_eligibility(p_source_id, p_target_id);
  v_block := v->>'block_code';
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION 'Merge no elegible (%): %', v_block, (v->>'block_reason')
      USING ERRCODE = v_block;
  END IF;

  -- Capturar IDs ANTES de mover (después el WHERE patient_id=source ya no matchea).
  v_appt_ids := ARRAY(SELECT id FROM appointments  WHERE patient_id = p_source_id ORDER BY id);
  v_cons_ids := ARRAY(SELECT id FROM consultations WHERE patient_id = p_source_id ORDER BY id);
  v_vit_ids  := ARRAY(SELECT id FROM vitals        WHERE patient_id = p_source_id ORDER BY id);

  -- Bypass propio del merge (transaction-local) para los dos guards-trigger.
  PERFORM set_config('app.merging_patients', 'on', true);

  -- Re-point del expediente fuente → destino.
  UPDATE appointments  SET patient_id = p_target_id WHERE patient_id = p_source_id;
  GET DIAGNOSTICS v_n_appt = ROW_COUNT;
  UPDATE consultations SET patient_id = p_target_id WHERE patient_id = p_source_id;  -- firmadas: bypass activo
  GET DIAGNOSTICS v_n_cons = ROW_COUNT;
  UPDATE vitals        SET patient_id = p_target_id WHERE patient_id = p_source_id;
  GET DIAGNOSTICS v_n_vit = ROW_COUNT;

  -- Neutralizar la fuente (DM5): libera el UNIQUE(clinic,doc), desvincula,
  -- desactiva y marca. El teléfono se CONSERVA como traza. (Si la fuente
  -- estaba vinculada — caso E3 — el cambio de document_number/profile_id
  -- dispara P0030; el bypass lo permite.)
  UPDATE patients SET
    document_number        = NULL,
    profile_id             = NULL,
    is_active              = false,
    merged_into_patient_id = p_target_id,
    merged_at              = now(),
    updated_at             = now()
  WHERE id = p_source_id;

  PERFORM set_config('app.merging_patients', 'off', true);

  -- Log (con snapshots + moved_ids = base de la reversa formal futura).
  INSERT INTO patient_merge_log (
    source_patient_id, target_patient_id, clinic_id, merged_by, reason,
    evidence, source_snapshot, target_snapshot, moved_counts, moved_ids
  ) VALUES (
    p_source_id, p_target_id, s.clinic_id, v_admin, btrim(p_reason),
    v->'evidence',
    to_jsonb(s), to_jsonb(t),
    jsonb_build_object('appointments', v_n_appt, 'consultations', v_n_cons, 'vitals', v_n_vit),
    jsonb_build_object(
      'appointment_ids', to_jsonb(v_appt_ids),
      'consultation_ids', to_jsonb(v_cons_ids),
      'vitals_ids', to_jsonb(v_vit_ids))
  ) RETURNING id INTO v_log_id;

  -- Audit explícito (adicional a los triggers trg_audit_patients/consultations).
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_admin, 'update'::audit_action, 'patients', p_source_id,
    jsonb_build_object('profile_id', s.profile_id, 'is_active', s.is_active,
                       'document_number', s.document_number),
    jsonb_build_object(
      'edited_via', 'admin_merge', 'merged_into_patient_id', p_target_id,
      'target_patient_id', p_target_id, 'merge_log_id', v_log_id,
      'moved_counts', jsonb_build_object('appointments', v_n_appt,
        'consultations', v_n_cons, 'vitals', v_n_vit),
      'reason', btrim(p_reason))
  );

  RETURN jsonb_build_object(
    'success', true,
    'source_id', p_source_id,
    'target_id', p_target_id,
    'merge_log_id', v_log_id,
    'moved_counts', jsonb_build_object('appointments', v_n_appt,
      'consultations', v_n_cons, 'vitals', v_n_vit)
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_merge_patients(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_merge_patients(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION admin_merge_patients(uuid, uuid, text) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_46.mjs + node scripts/_smoke-s7_46.mjs
-- ───────────────────────────────────────────────────────────
