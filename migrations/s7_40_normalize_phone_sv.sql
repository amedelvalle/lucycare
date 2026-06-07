-- ═══════════════════════════════════════════════════════════
-- Migración S7-40: RPC F5 tolerante a teléfono crudo (defensa en profundidad)
-- ═══════════════════════════════════════════════════════════
-- Paciente Global Fase 5 — `find_patient_match_candidates` (s7_35) normalizaba
-- el teléfono SOLO quitando no-dígitos (regexp_replace '\D'). No aplicaba la
-- regla SV de prefijo de país, así que dependía de que TODO caller mandara el
-- teléfono ya canonicalizado (lo hace hoy `findPatientMatchCandidates` con
-- `normalizePhoneSV`). Si un caller futuro pasara crudo `71234567`, la RPC lo
-- comparaba contra el almacenado `50371234567` y NO matcheaba → falso "sin
-- coincidencias". Lo mismo con filas legacy cuyo `phone` no esté canónico.
--
-- Esta migración:
--   1. Agrega un helper SQL `normalize_phone_sv(text)` que replica EXACTAMENTE
--      `src/lib/phone.ts::normalizePhoneSV` (forma canónica `503XXXXXXXX`).
--   2. `CREATE OR REPLACE` de la RPC aplicando el helper a AMBOS lados de cada
--      comparación de teléfono (input y filas). Así `71234567`, `50371234567`,
--      `+50371234567`, `+503 7123-4567`, `(503) 7123 4567` colapsan al mismo
--      valor, sin importar el formato del input NI cómo esté guardada la fila.
--
-- INVARIANTES (no cambian):
--   • Firma idéntica (uuid, text, text, text) → preserva GRANTs y NO cambia los
--     tipos generados (database.types.ts no se regenera).
--   • Salida idéntica: { intra_clinic: [...], cross_clinic: { match } }.
--   • Cross-clínica sigue devolviendo SOLO señal mínima (nivel), sin PII.
--   • SECURITY DEFINER + gate is_admin()/is_clinic_member() intactos.
--   • Documento sin cambios (ya era tolerante: strip [^A-Z0-9] + upper).
--
-- SEGURIDAD:
--   • `normalize_phone_sv` es IMMUTABLE y pura (sin acceso a datos). Se le hace
--     REVOKE ALL ... FROM PUBLIC para que NO quede expuesta como RPC de
--     PostgREST (anon/authenticated no la ven). La RPC definer la usa igual
--     porque corre como owner.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Helper de normalización SV (espejo de normalizePhoneSV) ──
-- Reglas (idénticas al helper JS):
--   • strip todo lo que no sea dígito.
--   • '' / null            → NULL.
--   • '^503\d{8}$'         → tal cual (ya canónico, 11 dígitos).
--   • '^\d{8}$' (8 díg.)   → '503' + dígitos.
--   • cualquier otra cosa  → los dígitos tal como vinieron (best-effort).
CREATE OR REPLACE FUNCTION normalize_phone_sv(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN d IS NULL OR d = ''     THEN NULL
    WHEN d ~ '^503[0-9]{8}$'     THEN d
    WHEN d ~ '^[0-9]{8}$'        THEN '503' || d
    ELSE d
  END
  FROM (SELECT regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) AS s(d);
$$;

-- No exponerla como RPC pública: solo uso interno (la RPC definer la llama).
REVOKE ALL ON FUNCTION normalize_phone_sv(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION normalize_phone_sv(text) FROM anon;
REVOKE ALL ON FUNCTION normalize_phone_sv(text) FROM authenticated;

-- ─── 2. RPC con normalización SV en ambos lados ──
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
  -- F5 hardening: el input se canonicaliza con la MISMA regla SV que las filas
  -- (normalize_phone_sv), no solo quitando no-dígitos. Tolera teléfono crudo.
  v_phone_norm   text := normalize_phone_sv(p_phone);
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
  v_doc_provided := (
    v_doc_type IS NOT NULL
    AND v_doc_norm IS NOT NULL
    AND (v_doc_type <> 'dui' OR length(v_doc_norm) = 9)
  );

  -- ── Intra-clínica: DETALLE (caller con permiso RLS sobre estas fichas) ──
  -- Comparación de teléfono: normalize_phone_sv en ambos lados.
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
             AND normalize_phone_sv(p.phone) = v_phone_norm
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
          AND normalize_phone_sv(p.phone) = v_phone_norm)
        OR (v_doc_provided
          AND p.document_type::text = v_doc_type
          AND regexp_replace(upper(coalesce(p.document_number, '')), '[^A-Z0-9]', '', 'g') = v_doc_norm)
      )
    ORDER BY p.created_at
    LIMIT 5
  ) t;

  -- ── Cross-clínica / global: SOLO señal mínima (sin PII) ──
  -- STRONG: documento válido existe en profiles (global) o en patients de
  -- OTRA clínica (activos). (Documento sin cambios respecto a s7_35.)
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
  -- Comparación de teléfono: normalize_phone_sv en ambos lados.
  IF NOT v_cross_strong AND v_phone_norm IS NOT NULL THEN
    v_cross_weak :=
      EXISTS (
        SELECT 1 FROM patients p3
        WHERE p3.clinic_id <> p_clinic_id
          AND p3.is_active = true
          AND normalize_phone_sv(p3.phone) = v_phone_norm
      )
      OR EXISTS (
        SELECT 1 FROM profiles pr2
        WHERE normalize_phone_sv(pr2.phone) = v_phone_norm
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

-- Firma idéntica → CREATE OR REPLACE preserva privilegios; reafirmamos por las dudas.
REVOKE ALL ON FUNCTION find_patient_match_candidates(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION find_patient_match_candidates(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION find_patient_match_candidates(uuid, text, text, text) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación rápida (manual):
--   SELECT normalize_phone_sv('+503 7700-3001');  -- → 50377003001
--   SELECT normalize_phone_sv('77003001');        -- → 50377003001
--   SELECT normalize_phone_sv('50377003001');     -- → 50377003001
-- Verificación automatizada: node scripts/check-s7_40.mjs
-- Verificación funcional (con sesión real): node scripts/_smoke-s7_40.mjs
-- ───────────────────────────────────────────────────────────
