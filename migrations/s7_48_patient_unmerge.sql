-- ═══════════════════════════════════════════════════════════
-- Migración S7-48: F4 — Unmerge formal de fichas (reversa del merge admin)
-- ═══════════════════════════════════════════════════════════
-- Contexto: docs/ANALISIS_PACIENTE_GLOBAL_F4_UNMERGE.md (decisiones cerradas
-- 2026-06-15). Revierte UNA fusión previa de `admin_merge_patients` (s7_46),
-- devolviendo a la ficha FUENTE exactamente las filas registradas en
-- `patient_merge_log.moved_ids` y restaurándola desde `source_snapshot`, sin
-- tocar lo que el DESTINO acumuló después del merge.
--
-- Alcance ESTRICTO (backend-only, sin UI):
--   • NO toca identidad global (`profiles`), `auth.users`, roles ni credenciales.
--     (Restaurar `patients.profile_id` desde el snapshot re-vincula una FICHA
--      local; el chequeo de existencia de ese profile SOLO lo lee, no lo modifica.)
--   • NO desfusiona identidades; solo revierte fichas `patients`.
--   • NO reescribe el destino desde `target_snapshot` (solo diff/audit/warnings).
--   • NO hard-delete; reversa ATÓMICA (todo o nada); sin reversa parcial.
--   • NO maneja cadenas (A→B→C) ni reversa fuera de orden: bloquea.
--
-- Piezas:
--   1. Bypass propio `app.unmerging_patients` añadido a los DOS guards
--      (sin reutilizar `app.merging_patients`; sus bypass previos intactos):
--        • prevent_signed_consultation_edit (s7_29/s7_46): devolver una consulta
--          FIRMADA a la fuente dispara el guard.
--        • prevent_linked_patient_identity_edit (P0030, s7_33/s7_46): restaurar la
--          identidad local de la fuente (defensivo; con la fuente neutralizada
--          OLD.profile_id es NULL y el guard no se dispararía, pero se cubre).
--   2. Helper interno `_patient_unmerge_eligibility(p_merge_log_id)` (read-only),
--      compartido por preflight y RPC → misma lógica, sin drift.
--   3. RPC `admin_unmerge_patients_preflight(p_merge_log_id)` — dry-run.
--   4. RPC `admin_unmerge_patients(p_merge_log_id, p_reason)` — transaccional,
--      revalida TODO server-side, rellena `unmerge_*` (append-only) + audit.
--
-- Errores (serie P0070–P0077, según el documento aprobado):
--   P0001 no admin · P0070 log/fuente/destino inexistente · P0071 ya revertido ·
--   P0072 fuente fuera del estado fusionado esperado · P0073 destino inválido
--   (fusionado a un tercero / fuera de la clínica) · P0074 conflicto de documento
--   al restaurar · P0075 `moved_ids` con drift (fila ausente/re-apuntada) ·
--   P0076 motivo < 10 · P0077 `profile_id` del snapshot inexistente.
--
-- NO modifica el esquema de `patient_merge_log` (las columnas `unmerged_at`/
-- `unmerged_by`/`unmerge_reason` ya existen desde s7_46). NO re-aplica s7_46.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Bypass `app.unmerging_patients` en los dos guards ────
-- (a) Inmutabilidad de consulta firmada (base s7_46): se AÑADE el bypass del
--     unmerge; los de app.amending y app.merging_patients quedan idénticos.
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
  IF current_setting('app.unmerging_patients', true) = 'on' THEN
    RETURN NEW;  -- re-point inverso en unmerge admin (admin_unmerge_patients)
  END IF;
  IF OLD.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede editar una consulta firmada. La consulta fue firmada el %', OLD.signed_at;
  END IF;
  RETURN NEW;
END;
$$;

-- (b) Identidad de paciente vinculado (P0030, base s7_46): se AÑADE el bypass
--     del unmerge; los de syncing/merging quedan idénticos.
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
  IF current_setting('app.unmerging_patients', true) = 'on' THEN
    RETURN NEW;  -- restauración de la fuente en unmerge admin
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

-- ─── 2. Helper interno de elegibilidad (read-only, compartido) ──
-- Devuelve diagnóstico completo + `block_code` (primer fallo, o NULL). NO chequea
-- el motivo (P0076, exclusivo del RPC). Solo metadatos/conteos — sin contenido
-- clínico. Lee `profiles` SOLO para confirmar existencia (P0077); no lo modifica.
CREATE OR REPLACE FUNCTION _patient_unmerge_eligibility(p_merge_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lg               patient_merge_log%ROWTYPE;
  s                patients%ROWTYPE;
  t                patients%ROWTYPE;
  v_block          text := NULL;
  v_snap_profile   uuid;
  v_snap_doc       text;
  v_snap_doctype   text;
  v_appt_ids       uuid[];
  v_cons_ids       uuid[];
  v_vit_ids        uuid[];
  v_exp_appt       int; v_exp_cons int; v_exp_vit int;
  v_act_appt       int; v_act_cons int; v_act_vit int;
  v_drift          boolean := false;
  v_doc_conflict   boolean := false;
  v_profile_missing boolean := false;
  v_target_new     int := 0;
  v_old_merge      boolean := false;
  v_warnings       jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO lg FROM patient_merge_log WHERE id = p_merge_log_id;
  IF lg.id IS NULL THEN
    RETURN jsonb_build_object('block_code','P0070',
      'block_reason','El registro de fusión no existe','eligible',false);
  END IF;
  IF lg.unmerged_at IS NOT NULL THEN
    RETURN jsonb_build_object('block_code','P0071',
      'block_reason','Esta fusión ya fue revertida','eligible',false,'merge_log_id',lg.id);
  END IF;

  SELECT * INTO s FROM patients WHERE id = lg.source_patient_id;
  SELECT * INTO t FROM patients WHERE id = lg.target_patient_id;
  IF s.id IS NULL OR t.id IS NULL THEN
    RETURN jsonb_build_object('block_code','P0070',
      'block_reason','La ficha fuente o destino ya no existe','eligible',false,'merge_log_id',lg.id);
  END IF;

  v_snap_profile := nullif(lg.source_snapshot->>'profile_id','')::uuid;
  v_snap_doc     := nullif(btrim(lg.source_snapshot->>'document_number'),'');
  v_snap_doctype := lg.source_snapshot->>'document_type';

  -- moved_ids → uuid[]
  v_appt_ids := ARRAY(SELECT (jsonb_array_elements_text(coalesce(lg.moved_ids->'appointment_ids','[]'::jsonb)))::uuid);
  v_cons_ids := ARRAY(SELECT (jsonb_array_elements_text(coalesce(lg.moved_ids->'consultation_ids','[]'::jsonb)))::uuid);
  v_vit_ids  := ARRAY(SELECT (jsonb_array_elements_text(coalesce(lg.moved_ids->'vitals_ids','[]'::jsonb)))::uuid);
  v_exp_appt := coalesce(array_length(v_appt_ids,1),0);
  v_exp_cons := coalesce(array_length(v_cons_ids,1),0);
  v_exp_vit  := coalesce(array_length(v_vit_ids,1),0);
  SELECT count(*) INTO v_act_appt FROM appointments  WHERE id = ANY(v_appt_ids) AND patient_id = t.id;
  SELECT count(*) INTO v_act_cons FROM consultations WHERE id = ANY(v_cons_ids) AND patient_id = t.id;
  SELECT count(*) INTO v_act_vit  FROM vitals        WHERE id = ANY(v_vit_ids)  AND patient_id = t.id;
  v_drift := (v_act_appt <> v_exp_appt) OR (v_act_cons <> v_exp_cons) OR (v_act_vit <> v_exp_vit);

  -- Conflicto de documento al restaurar (solo si el snapshot traía documento).
  IF v_snap_doc IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM patients
      WHERE clinic_id = lg.clinic_id
        AND document_type = v_snap_doctype::document_type  -- columna enum vs texto del snapshot
        AND document_number = v_snap_doc
        AND id <> s.id
    ) INTO v_doc_conflict;
  END IF;

  -- Existencia del profile a restaurar.
  IF v_snap_profile IS NOT NULL THEN
    v_profile_missing := NOT EXISTS(SELECT 1 FROM profiles WHERE id = v_snap_profile);
  END IF;

  -- Historia nueva en el destino (filas que NO están en moved_ids) → warning.
  v_target_new :=
      (SELECT count(*) FROM appointments  WHERE patient_id = t.id AND NOT (id = ANY(v_appt_ids)))
    + (SELECT count(*) FROM consultations WHERE patient_id = t.id AND NOT (id = ANY(v_cons_ids)))
    + (SELECT count(*) FROM vitals        WHERE patient_id = t.id AND NOT (id = ANY(v_vit_ids)));

  v_old_merge := (lg.created_at < now() - interval '30 days');

  -- Bloqueos en orden: estado fuente → estado destino → drift → documento → profile.
  IF NOT (s.is_active = false
          AND s.merged_into_patient_id = t.id
          AND s.merged_at IS NOT NULL
          AND s.clinic_id = lg.clinic_id) THEN
    v_block := 'P0072';
  ELSIF NOT (t.merged_into_patient_id IS NULL AND t.clinic_id = lg.clinic_id) THEN
    v_block := 'P0073';
  ELSIF v_drift THEN
    v_block := 'P0075';
  ELSIF v_doc_conflict THEN
    v_block := 'P0074';
  ELSIF v_profile_missing THEN
    v_block := 'P0077';
  END IF;

  -- Warnings (no bloquean).
  IF v_target_new > 0 THEN
    v_warnings := v_warnings || jsonb_build_object('code','W_TARGET_NEW_HISTORY',
      'message', format('El destino tiene %s registro(s) posteriores al merge que se conservarán', v_target_new));
  END IF;
  IF v_old_merge THEN
    v_warnings := v_warnings || jsonb_build_object('code','W_OLD_MERGE',
      'message','La fusión es de hace más de 30 días');
  END IF;
  IF v_snap_profile IS NOT NULL THEN
    v_warnings := v_warnings || jsonb_build_object('code','W_REMERGE_RISK',
      'message','Al revertir, la fuente vuelve a quedar vinculada al mismo perfil en la clínica (estado E3)');
  END IF;

  RETURN jsonb_build_object(
    'block_code', v_block,
    'eligible', (v_block IS NULL),
    'merge_log_id', lg.id,
    'clinic_id', lg.clinic_id,
    'merged_by', lg.merged_by,
    'merged_at', lg.created_at,
    'merge_reason', lg.reason,
    'evidence', lg.evidence,
    'source', jsonb_build_object('id', s.id, 'full_name', s.full_name, 'is_active', s.is_active,
      'profile_id', s.profile_id, 'document_type', s.document_type, 'document_number', s.document_number,
      'merged_into_patient_id', s.merged_into_patient_id, 'merged_at', s.merged_at, 'clinic_id', s.clinic_id),
    'target', jsonb_build_object('id', t.id, 'full_name', t.full_name, 'is_active', t.is_active,
      'profile_id', t.profile_id, 'merged_into_patient_id', t.merged_into_patient_id, 'clinic_id', t.clinic_id),
    'restore', jsonb_build_object('profile_id', v_snap_profile, 'document_type', v_snap_doctype,
      'document_number', v_snap_doc, 'document_conflict', v_doc_conflict, 'profile_missing', v_profile_missing),
    'moved_expected', jsonb_build_object('appointments', v_exp_appt, 'consultations', v_exp_cons, 'vitals', v_exp_vit),
    'moved_present_on_target', jsonb_build_object('appointments', v_act_appt, 'consultations', v_act_cons, 'vitals', v_act_vit),
    'moved_drift', v_drift,
    'target_new_history', v_target_new,
    'warnings', v_warnings
  );
END;
$$;

REVOKE ALL ON FUNCTION _patient_unmerge_eligibility(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _patient_unmerge_eligibility(uuid) FROM anon;
-- Helper interno: lo invocan las RPCs definer (corren como owner). No se concede a authenticated.

-- ─── 3. RPC preflight (dry-run, read-only) ───────────────────
CREATE OR REPLACE FUNCTION admin_unmerge_patients_preflight(p_merge_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador de plataforma puede usar esta herramienta' USING ERRCODE = 'P0001';
  END IF;
  v := _patient_unmerge_eligibility(p_merge_log_id);
  RETURN v || jsonb_build_object('is_preflight', true);
END;
$$;

REVOKE ALL ON FUNCTION admin_unmerge_patients_preflight(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_unmerge_patients_preflight(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION admin_unmerge_patients_preflight(uuid) TO authenticated;

-- ─── 4. RPC unmerge (transaccional, autoritativa) ────────────
CREATE OR REPLACE FUNCTION admin_unmerge_patients(p_merge_log_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin        uuid := auth.uid();
  lg             patient_merge_log%ROWTYPE;
  s              patients%ROWTYPE;
  t              patients%ROWTYPE;
  v              jsonb;
  v_block        text;
  v_appt_ids     uuid[];
  v_cons_ids     uuid[];
  v_vit_ids      uuid[];
  v_n_appt       int;
  v_n_cons       int;
  v_n_vit        int;
  v_snap_profile uuid;
  v_snap_doc     text;
  v_snap_doctype text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador de plataforma puede usar esta herramienta' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'El motivo es obligatorio (mínimo 10 caracteres)' USING ERRCODE = 'P0076';
  END IF;

  SELECT * INTO lg FROM patient_merge_log WHERE id = p_merge_log_id FOR UPDATE;
  IF lg.id IS NULL THEN
    RAISE EXCEPTION 'El registro de fusión no existe' USING ERRCODE = 'P0070';
  END IF;

  -- Lock de ambas fichas (orden por id evita deadlock).
  PERFORM 1 FROM patients
    WHERE id IN (lg.source_patient_id, lg.target_patient_id)
    ORDER BY id FOR UPDATE;
  SELECT * INTO s FROM patients WHERE id = lg.source_patient_id;
  SELECT * INTO t FROM patients WHERE id = lg.target_patient_id;

  -- Revalidación autoritativa server-side (el preflight no cuenta).
  v := _patient_unmerge_eligibility(p_merge_log_id);
  v_block := v->>'block_code';
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION 'Unmerge no elegible (%): %', v_block, coalesce(v->>'block_reason','')
      USING ERRCODE = v_block;
  END IF;

  v_appt_ids := ARRAY(SELECT (jsonb_array_elements_text(coalesce(lg.moved_ids->'appointment_ids','[]'::jsonb)))::uuid);
  v_cons_ids := ARRAY(SELECT (jsonb_array_elements_text(coalesce(lg.moved_ids->'consultation_ids','[]'::jsonb)))::uuid);
  v_vit_ids  := ARRAY(SELECT (jsonb_array_elements_text(coalesce(lg.moved_ids->'vitals_ids','[]'::jsonb)))::uuid);
  v_snap_profile := nullif(lg.source_snapshot->>'profile_id','')::uuid;
  v_snap_doc     := nullif(btrim(lg.source_snapshot->>'document_number'),'');
  v_snap_doctype := lg.source_snapshot->>'document_type';

  -- Bypass propio del unmerge (transaction-local) para los dos guards.
  PERFORM set_config('app.unmerging_patients', 'on', true);

  -- Devolver destino→fuente SOLO las filas que hoy siguen en el destino.
  UPDATE appointments  SET patient_id = s.id WHERE id = ANY(v_appt_ids) AND patient_id = t.id;
  GET DIAGNOSTICS v_n_appt = ROW_COUNT;
  UPDATE consultations SET patient_id = s.id WHERE id = ANY(v_cons_ids) AND patient_id = t.id;  -- firmadas: bypass activo
  GET DIAGNOSTICS v_n_cons = ROW_COUNT;
  UPDATE vitals        SET patient_id = s.id WHERE id = ANY(v_vit_ids)  AND patient_id = t.id;
  GET DIAGNOSTICS v_n_vit = ROW_COUNT;

  -- Restaurar la fuente desde el snapshot (documento ya validado sin colisión).
  UPDATE patients SET
    is_active              = true,
    profile_id             = v_snap_profile,
    document_type          = coalesce(v_snap_doctype::document_type, document_type),
    document_number        = v_snap_doc,
    merged_into_patient_id = NULL,
    merged_at              = NULL,
    updated_at             = now()
  WHERE id = s.id;

  PERFORM set_config('app.unmerging_patients', 'off', true);

  -- Marcar el log (append-only: solo se rellenan los campos de reversa).
  UPDATE patient_merge_log SET
    unmerged_at    = now(),
    unmerged_by    = v_admin,
    unmerge_reason = btrim(p_reason)
  WHERE id = lg.id;

  -- Audit explícito (adicional a los triggers de patients/consultations).
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_admin, 'update'::audit_action, 'patients', s.id,
    jsonb_build_object('is_active', false, 'merged_into_patient_id', t.id,
                       'profile_id', NULL),
    jsonb_build_object('edited_via', 'admin_unmerge', 'merge_log_id', lg.id,
      'source_id', s.id, 'target_id', t.id,
      'moved_back', jsonb_build_object('appointments', v_n_appt,
        'consultations', v_n_cons, 'vitals', v_n_vit),
      'reason', btrim(p_reason))
  );

  RETURN jsonb_build_object(
    'success', true,
    'merge_log_id', lg.id,
    'source_id', s.id,
    'target_id', t.id,
    'moved_back', jsonb_build_object('appointments', v_n_appt,
      'consultations', v_n_cons, 'vitals', v_n_vit)
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_unmerge_patients(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_unmerge_patients(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION admin_unmerge_patients(uuid, text) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_48.mjs + node scripts/_smoke-s7_48.mjs
-- ───────────────────────────────────────────────────────────
