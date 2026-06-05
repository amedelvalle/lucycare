-- ═══════════════════════════════════════════════════════════
-- Migración S7-35: Paciente Global Fase 5 — dedup preventivo (backend)
-- ═══════════════════════════════════════════════════════════
-- RPC de apoyo a la creación de paciente/walk-in. Dado el teléfono y/o
-- documento que el médico está por registrar, devuelve coincidencias para
-- ayudarlo a NO crear un duplicado — respetando privacidad cross-clínica.
--
-- DECISIONES (firmadas en docs/ANALISIS_PACIENTE_GLOBAL.md §Fase 5):
--   • Intra-clínica → DETALLE (id, nombre, teléfono, activo). El caller ya
--     tiene permiso RLS sobre esas fichas. Match por teléfono y/o documento.
--   • Cross-clínica / identidad global (profiles) → SOLO SEÑAL MÍNIMA, sin
--     ninguna PII (ni nombre, ni clínica, ni médico, ni teléfono, ni el
--     documento de la otra ficha). Solo el nivel del match.
--   • STRONG (cross): el documento válido ingresado existe en `profiles`
--     (identidad global) o en `patients` de OTRA clínica. Solo si el caller
--     ingresó document_type + número válido (DUI = 9 dígitos).
--   • WEAK (cross): el teléfono existe en `patients` de otra clínica o en
--     `profiles`. El teléfono NUNCA es strong (familiares, responsables de
--     menores, oficina, número compartido).
--   • No bloquea nada. Es advisory. El único bloqueo fuerte sigue siendo el
--     UNIQUE(clinic_id, document_type, document_number) de la DB en el INSERT.
--
-- SEGURIDAD:
--   • SECURITY DEFINER + search_path explícito: necesita leer `patients` de
--     otras clínicas y `profiles` globales, que el médico NO ve por RLS.
--   • Autorización: solo miembros activos de p_clinic_id (is_clinic_member) o
--     admin. Evita que un usuario enumere documentos/teléfonos de la plataforma.
--   • La respuesta cross-clínica es un booleano de nivel — nunca expone filas.
--
-- NORMALIZACIÓN (igual criterio que createBasicPatient / claim):
--   • teléfono: solo dígitos (regexp_replace '\D').
--   • documento: mayúsculas + solo [A-Z0-9] (quita el guion del DUI, etc.),
--     comparado contra el mismo normalizado de las filas. document_type debe
--     coincidir.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION find_patient_match_candidates(
  p_clinic_id       uuid,
  p_phone           text DEFAULT NULL,
  p_document_type   text DEFAULT NULL,
  p_document_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_norm   text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  v_doc_norm     text := nullif(regexp_replace(upper(coalesce(p_document_number, '')), '[^A-Z0-9]', '', 'g'), '');
  v_doc_type     text := nullif(trim(coalesce(p_document_type, '')), '');
  v_doc_provided boolean;
  v_intra        jsonb;
  v_cross_strong boolean := false;
  v_cross_weak   boolean := false;
  v_cross        text := 'none';
BEGIN
  -- ── Autorización: solo miembros activos de la clínica (o admin) ──
  IF NOT (is_admin() OR is_clinic_member(p_clinic_id)) THEN
    RAISE EXCEPTION 'No autorizado para consultar coincidencias en esta clínica.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Documento "válido para matching": tipo + número; DUI = 9 dígitos ──
  -- (La validación completa vive en el cliente / createBasicPatient.)
  v_doc_provided := (
    v_doc_type IS NOT NULL
    AND v_doc_norm IS NOT NULL
    AND (v_doc_type <> 'dui' OR length(v_doc_norm) = 9)
  );

  -- ── Intra-clínica: DETALLE (caller con permiso RLS sobre estas fichas) ──
  SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_intra
  FROM (
    SELECT
      p.id,
      p.full_name,
      p.phone,
      p.is_active,
      CASE
        WHEN v_phone_norm IS NOT NULL
             AND regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = v_phone_norm
             AND v_doc_provided
             AND p.document_type::text = v_doc_type
             AND regexp_replace(upper(coalesce(p.document_number, '')), '[^A-Z0-9]', '', 'g') = v_doc_norm
          THEN 'both'
        WHEN v_doc_provided
             AND p.document_type::text = v_doc_type
             AND regexp_replace(upper(coalesce(p.document_number, '')), '[^A-Z0-9]', '', 'g') = v_doc_norm
          THEN 'document'
        ELSE 'phone'
      END AS match
    FROM patients p
    WHERE p.clinic_id = p_clinic_id
      AND p.is_active = true
      AND (
        (v_phone_norm IS NOT NULL
          AND regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = v_phone_norm)
        OR (v_doc_provided
          AND p.document_type::text = v_doc_type
          AND regexp_replace(upper(coalesce(p.document_number, '')), '[^A-Z0-9]', '', 'g') = v_doc_norm)
      )
    ORDER BY p.created_at
    LIMIT 5
  ) t;

  -- ── Cross-clínica / global: SOLO señal mínima (sin PII) ──
  -- STRONG: documento válido existe en profiles (global) o en patients de
  -- OTRA clínica (activos).
  IF v_doc_provided THEN
    v_cross_strong :=
      EXISTS (
        SELECT 1 FROM profiles pr
        WHERE pr.document_type::text = v_doc_type
          AND regexp_replace(upper(coalesce(pr.document_number, '')), '[^A-Z0-9]', '', 'g') = v_doc_norm
      )
      OR EXISTS (
        SELECT 1 FROM patients p2
        WHERE p2.clinic_id <> p_clinic_id
          AND p2.is_active = true
          AND p2.document_type::text = v_doc_type
          AND regexp_replace(upper(coalesce(p2.document_number, '')), '[^A-Z0-9]', '', 'g') = v_doc_norm
      );
  END IF;

  -- WEAK: teléfono existe en patients de OTRA clínica o en profiles. Nunca
  -- es strong por sí solo. Solo se evalúa si no hubo strong.
  IF NOT v_cross_strong AND v_phone_norm IS NOT NULL THEN
    v_cross_weak :=
      EXISTS (
        SELECT 1 FROM patients p3
        WHERE p3.clinic_id <> p_clinic_id
          AND p3.is_active = true
          AND regexp_replace(coalesce(p3.phone, ''), '\D', '', 'g') = v_phone_norm
      )
      OR EXISTS (
        SELECT 1 FROM profiles pr2
        WHERE regexp_replace(coalesce(pr2.phone, ''), '\D', '', 'g') = v_phone_norm
      );
  END IF;

  v_cross := CASE
    WHEN v_cross_strong THEN 'strong'
    WHEN v_cross_weak   THEN 'weak'
    ELSE 'none'
  END;

  RETURN jsonb_build_object(
    'intra_clinic', v_intra,
    'cross_clinic', jsonb_build_object('match', v_cross)
  );
END;
$$;

REVOKE ALL ON FUNCTION find_patient_match_candidates(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION find_patient_match_candidates(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION find_patient_match_candidates(uuid, text, text, text) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación rápida (manual):
--   SELECT find_patient_match_candidates(
--     '<clinic_id>', '+503 7700-3001', 'dui', '00000000-0');
-- Esperado: { "intra_clinic": [...], "cross_clinic": { "match": "none|weak|strong" } }
-- Verificación automatizada: node scripts/check-s7_35.mjs + node scripts/_smoke-s7_35.mjs
-- ───────────────────────────────────────────────────────────
