-- ═══════════════════════════════════════════════════════════
-- Migración S7-45: F4-1 — claim tolerante fila por fila
-- ═══════════════════════════════════════════════════════════
-- Contexto (docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md, DM1–DM9
-- cerradas + Q1a/Q2/Q3 aprobadas por el owner 2026-06-12):
--
-- HALLAZGO F4 (repro smoke s7_43): `claim_patient_records` vincula con UN
-- solo UPDATE multi-fila que además copia la identidad global→local (s7_33),
-- incluido `document_number`. Si UNA ficha matcheada está en una clínica
-- donde la persona ya tiene OTRA ficha con ese documento, el UPDATE viola
-- UNIQUE(clinic_id, document_type, document_number) → la sentencia entera se
-- revierte → el claim aborta COMPLETO (todas las fichas, todas las clínicas)
-- y el hook fail-safe del login lo silencia.
--
-- F4-1 (esta migración):
--   1. Columnas PASIVAS en `patients` (infra de F4-2, NADA las escribe aún):
--      `merged_into_patient_id` (FK a patients, sin CASCADE, CHECK anti
--      self-reference) + `merged_at`. Único efecto operativo: el claim ignora
--      fichas marcadas como fusionadas (el merge real es F4-2).
--   2. `claim_patient_records` reescrita: LOOP fila por fila con bloque
--      EXCEPTION por ficha (subtransacción implícita) →
--      • una colisión NO aborta el resto: la ficha conflictiva queda INTACTA
--        (sin media-copia) y las demás se vinculan normal;
--      • `unique_violation` → skip 'unique_conflict'; cualquier otro error de
--        fila → skip 'error' (Q2) — SIEMPRE auditados con SQLSTATE;
--      • errores estructurales FUERA del loop (sin sesión 28000, etc.) NO se
--        ocultan: se propagan como antes;
--      • al cliente solo conteos: {success, linked_count, skipped_count[,
--        reason]} (Q3 — sin patient_id/clínica/detalle técnico; el detalle
--        por ficha vive SOLO en audit_log, admin-only):
--        - fila resumen `edited_via='claim_patient_records'` (+ skipped[]),
--        - fila por ficha saltada `edited_via='claim_skipped_unique'` /
--          `'claim_skipped_error'` con record_id = la ficha conflictiva.
--
-- SIN CAMBIOS de: firma/nombre de la RPC (frontend intacto), filtros de
-- matching (phone normalizado por dígitos, profile_id IS NULL, exclusión de
-- pares rechazados s7_43), copia COALESCE de identidad (s7_33), GRANTs.
-- NO hace merge, NO toca profiles/auth.users, NO resuelve duplicados,
-- NO hard-delete. Idempotente y re-aplicable (IF NOT EXISTS / OR REPLACE).
--
-- Errores: sin P-codes nuevos (28000 sin sesión se mantiene).
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Columnas pasivas de fusión (infra F4-2, inertes en F4-1) ──
ALTER TABLE patients ADD COLUMN IF NOT EXISTS merged_into_patient_id uuid
  REFERENCES patients(id);              -- sin ON DELETE CASCADE (default NO ACTION)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS merged_at timestamptz;

ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_merged_into_not_self;
ALTER TABLE patients ADD CONSTRAINT patients_merged_into_not_self
  CHECK (merged_into_patient_id IS NULL OR merged_into_patient_id <> id);

COMMENT ON COLUMN patients.merged_into_patient_id IS
  'F4 (s7_45): id de la ficha destino si esta ficha fue fusionada por LucyAdmin. PASIVA en F4-1 (solo la escribirá el merge de F4-2); el claim excluye fichas marcadas.';
COMMENT ON COLUMN patients.merged_at IS
  'F4 (s7_45): cuándo se fusionó esta ficha. PASIVA en F4-1.';

-- ─── 2. claim_patient_records: fila por fila, tolerante a colisión ──
-- Base = versión viva de s7_43 (vincula + copia identidad global→local +
-- excluye pares rechazados). Cambia el "cómo" (loop con subtransacción por
-- ficha), no el "qué" (misma semántica de vinculación por ficha).
CREATE OR REPLACE FUNCTION claim_patient_records()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          uuid := auth.uid();
  v_user_phone_norm  text;
  v_linked_count     int := 0;
  v_skipped_count    int := 0;
  v_skipped          jsonb := '[]'::jsonb;
  v_rows             int;
  rec                record;
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
    RETURN jsonb_build_object('success', true, 'linked_count', 0,
                              'skipped_count', 0, 'reason', 'no_phone_confirmed');
  END IF;

  -- Candidatas: mismos filtros que s7_43 + exclusión de fichas fusionadas.
  -- Orden determinista para que el resultado sea reproducible.
  FOR rec IN
    SELECT p.id, p.clinic_id
    FROM patients p
    WHERE p.profile_id IS NULL
      AND p.merged_into_patient_id IS NULL
      AND regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = v_user_phone_norm
      AND NOT EXISTS (
        SELECT 1 FROM patient_link_rejections r
        WHERE r.patient_id = p.id AND r.profile_id = v_user_id
      )
    ORDER BY p.created_at, p.id
  LOOP
    BEGIN
      -- Vincular + copiar identidad global (global gana, local se conserva) —
      -- semántica idéntica a s7_33/s7_43, ahora UNA ficha por iteración. El
      -- bloque EXCEPTION crea una subtransacción: si esta ficha choca, queda
      -- intacta (sin media-copia) y el loop continúa con las demás.
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
         AND p.id = rec.id
         AND p.profile_id IS NULL;   -- re-chequeo anti-carrera

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows > 0 THEN
        v_linked_count := v_linked_count + 1;
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        v_skipped_count := v_skipped_count + 1;
        v_skipped := v_skipped || jsonb_build_object(
          'patient_id', rec.id, 'clinic_id', rec.clinic_id,
          'reason', 'unique_conflict', 'sqlstate', SQLSTATE);
        -- Audit por ficha saltada (best-effort: no rompe el claim).
        BEGIN
          INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
          VALUES (
            v_user_id, 'update'::audit_action, 'patients', rec.id,
            jsonb_build_object('profile_id', null),
            jsonb_build_object(
              'edited_via', 'claim_skipped_unique', 'reason', 'unique_conflict',
              'sqlstate', SQLSTATE, 'clinic_id', rec.clinic_id,
              'phone_norm', v_user_phone_norm));
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      WHEN OTHERS THEN
        -- Q2: cualquier otro error DE ESTA FILA tampoco mata el claim; queda
        -- auditado con SQLSTATE + mensaje acotado (nunca viaja al cliente).
        v_skipped_count := v_skipped_count + 1;
        v_skipped := v_skipped || jsonb_build_object(
          'patient_id', rec.id, 'clinic_id', rec.clinic_id,
          'reason', 'error', 'sqlstate', SQLSTATE);
        BEGIN
          INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
          VALUES (
            v_user_id, 'update'::audit_action, 'patients', rec.id,
            jsonb_build_object('profile_id', null),
            jsonb_build_object(
              'edited_via', 'claim_skipped_error', 'reason', 'error',
              'sqlstate', SQLSTATE, 'message', left(SQLERRM, 200),
              'clinic_id', rec.clinic_id, 'phone_norm', v_user_phone_norm));
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END;
  END LOOP;

  -- Resumen (igual que s7_43, ampliado con skips) — solo si hubo actividad.
  IF v_linked_count > 0 OR v_skipped_count > 0 THEN
    INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      v_user_id, 'update'::audit_action, 'patients', v_user_id,
      jsonb_build_object('profile_id', null),
      jsonb_build_object(
        'profile_id', v_user_id, 'linked_count', v_linked_count,
        'skipped_count', v_skipped_count, 'skipped', v_skipped,
        'phone_norm', v_user_phone_norm, 'edited_via', 'claim_patient_records'
      )
    );
  END IF;

  -- Q3: al cliente SOLO conteos — sin patient_id, clínica ni causa técnica.
  RETURN jsonb_build_object('success', true, 'linked_count', v_linked_count,
                            'skipped_count', v_skipped_count);
END;
$$;

REVOKE ALL ON FUNCTION claim_patient_records() FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_patient_records() FROM anon;
GRANT EXECUTE ON FUNCTION claim_patient_records() TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_45.mjs + node scripts/_smoke-s7_45.mjs
-- ───────────────────────────────────────────────────────────
