-- ═══════════════════════════════════════════════════════════
-- Migración S7-47: F4-3-search — RPC de descubrimiento de candidatos a merge
-- ═══════════════════════════════════════════════════════════
-- Contexto: docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md + F4-2 (s7_46).
-- La UI de F4-3 (`/admin/pacientes`) necesita DESCUBRIR pares/grupos
-- fusionables sin que el admin pegue UUIDs a mano. El admin no tiene RLS
-- sobre `patients`, así que el descubrimiento va por RPC `SECURITY DEFINER`
-- admin-only.
--
-- READ-ONLY. NO ejecuta merge, NO escribe, NO toca datos, NO audit.
--
-- ALCANCE V1 (decisión owner): SOLO candidatos `same_profile` (E3) —
-- agrupa por `(clinic_id, profile_id)` con `profile_id IS NOT NULL`,
-- contando SOLO fichas vivas (activas y no fusionadas) y exigiendo ≥2.
-- NO lista candidatos por teléfono, nombre, walk-ins, teléfono compartido,
-- ni casos F4/E2/override (quedan como backlog F4-3b / F4-D / revisión DM3b).
--
-- Devuelve GRUPOS (no pares): un (clinic, profile) puede tener 2, 3+ fichas;
-- la UI deja al admin elegir source/target dentro del grupo y usar
-- `admin_merge_patients_preflight`/`admin_merge_patients` (s7_46) por par.
--
-- AYUDA (no bloqueo) para la futura UI: si alguna ficha del grupo tiene
-- `link_confirmed_at IS NULL` (vinculada por claim pero NO confirmada por el
-- paciente — B2/s7_43), el grupo trae `has_unconfirmed_links=true` +
-- conteos + warning `W_UNCONFIRMED_LINK`. La RPC NO decide el merge; solo
-- ayuda a descubrir y advertir. El gate real de evidencia/elegibilidad lo
-- aplica el preflight/merge de s7_46.
--
-- Solo expone IDENTIDAD (nombre/documento/DOB/género/teléfono) + CONTEOS;
-- NUNCA contenido clínico (diagnósticos, recetas, notas, texto de consultas).
--
-- Errores: P0001 = no es admin.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_list_patient_merge_candidates()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador de plataforma puede usar esta herramienta' USING ERRCODE = 'P0001';
  END IF;

  WITH
  -- Fichas VIVAS candidatas: vinculadas, activas, no fusionadas.
  live AS (
    SELECT p.id, p.clinic_id, p.profile_id, p.full_name, p.document_type,
           p.document_number, p.date_of_birth, p.gender, p.phone,
           p.is_active, p.link_confirmed_at, p.created_at
    FROM patients p
    WHERE p.profile_id IS NOT NULL
      AND p.is_active = true
      AND p.merged_into_patient_id IS NULL
  ),
  -- Grupos (clinic, profile) con ≥2 fichas vivas = candidatos E3.
  grp AS (
    SELECT clinic_id, profile_id
    FROM live
    GROUP BY clinic_id, profile_id
    HAVING count(*) >= 2
  ),
  -- Conteos de expediente por ficha (solo números; sin contenido clínico).
  per_patient AS (
    SELECT l.*,
      (SELECT count(*) FROM appointments  a WHERE a.patient_id = l.id) AS appt_count,
      (SELECT count(*) FROM consultations c WHERE c.patient_id = l.id) AS cons_count,
      (SELECT count(*) FROM vitals        v WHERE v.patient_id = l.id) AS vit_count
    FROM live l
    JOIN grp g ON g.clinic_id = l.clinic_id AND g.profile_id = l.profile_id
  )
  SELECT COALESCE(jsonb_agg(group_obj ORDER BY group_obj->>'clinic_name', group_obj->>'profile_full_name'), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'clinic_id', pp.clinic_id,
      'clinic_name', (SELECT cl.name FROM clinics cl WHERE cl.id = pp.clinic_id),
      'profile_id', pp.profile_id,
      'profile_full_name', (SELECT pr.full_name FROM profiles pr WHERE pr.id = pp.profile_id),
      'patient_count', count(*),
      'confirmed_links_count',   count(*) FILTER (WHERE pp.link_confirmed_at IS NOT NULL),
      'unconfirmed_links_count', count(*) FILTER (WHERE pp.link_confirmed_at IS NULL),
      'has_unconfirmed_links',   bool_or(pp.link_confirmed_at IS NULL),
      'warnings', CASE WHEN bool_or(pp.link_confirmed_at IS NULL)
                       THEN jsonb_build_array(jsonb_build_object(
                              'code', 'W_UNCONFIRMED_LINK',
                              'message', 'El grupo tiene fichas vinculadas por claim aún NO confirmadas por el paciente.'))
                       ELSE '[]'::jsonb END,
      'patients', jsonb_agg(
        jsonb_build_object(
          'id', pp.id, 'full_name', pp.full_name, 'document_type', pp.document_type,
          'document_number', pp.document_number, 'date_of_birth', pp.date_of_birth,
          'gender', pp.gender, 'phone', pp.phone, 'is_active', pp.is_active,
          'link_confirmed_at', pp.link_confirmed_at, 'created_at', pp.created_at,
          'counts', jsonb_build_object(
            'appointments', pp.appt_count,
            'consultations', pp.cons_count,
            'vitals', pp.vit_count)
        ) ORDER BY pp.created_at, pp.id)
    ) AS group_obj
    FROM per_patient pp
    GROUP BY pp.clinic_id, pp.profile_id
  ) groups;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION admin_list_patient_merge_candidates() FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_patient_merge_candidates() FROM anon;
GRANT EXECUTE ON FUNCTION admin_list_patient_merge_candidates() TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_47.mjs + node scripts/_smoke-s7_47.mjs
-- ───────────────────────────────────────────────────────────
