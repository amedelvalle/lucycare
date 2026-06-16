-- ═══════════════════════════════════════════════════════════
-- Migración S7-49: F4-3b V1 — backend de la bandeja de vínculos rechazados
-- ═══════════════════════════════════════════════════════════
-- Contexto: B2 (`s7_43`, #128) persiste en `patient_link_rejections` los
-- rechazos paciente-driven ("No son mías") como cola `pending_review`, sin
-- ninguna superficie de admin. Este backend le da a LucyAdmin lectura +
-- resolución administrativa de esa cola ya existente.
--
-- Alcance ESTRICTO (backend-only, sin UI):
--   • SOLO la cola `patient_link_rejections` (rechazos del paciente).
--   • NO detección proactiva de pares débiles, NO fuzzy, NO merge.
--   • Resolver/reabrir es **bookkeeping administrativo**: NO re-vincula la
--     ficha, NO fusiona, NO cambia `patients`/`profiles`/`auth.users`/identidad.
--   • La fila sigue excluyendo el par del auto-link del claim mientras exista
--     (independiente de `status`); `status` solo refleja la revisión admin.
--
-- Piezas:
--   1. Columna `patient_link_rejections.resolution_note text` (motivo de la
--      resolución; la tabla no tenía dónde registrarlo).
--   2. RPC read `admin_list_patient_link_rejections(p_status)` — metadatos +
--      estado ACTUAL de la ficha; sin contenido clínico, sin JSON crudo.
--   3. RPC `admin_resolve_link_rejection(p_rejection_id, p_resolution_note,
--      p_reopen)` — resolver (motivo ≥10) o reabrir; audit en cada transición
--      (el audit de reabrir conserva el estado previo, incl. resolution_note).
--
-- Errores: P0001 no admin · P0080 rechazo inexistente · P0081 motivo < 10.
-- (Serie nueva P0080–P0081, sin colisión con P0060–P0077.)
--
-- NO toca `patients`, `profiles`, `auth.users` ni RLS existentes. La tabla
-- `patient_link_rejections` conserva su RLS de `s7_43` (admin SELECT/UPDATE,
-- sin INSERT/DELETE públicos). No hard-delete.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Columna de motivo de resolución ─────────────────────
ALTER TABLE patient_link_rejections ADD COLUMN IF NOT EXISTS resolution_note text;

COMMENT ON COLUMN patient_link_rejections.resolution_note IS
  'F4-3b (s7_49): nota/motivo que LucyAdmin registra al resolver el rechazo. NULL mientras pending_review.';

-- ─── 2. RPC de lectura de la cola (read-only, admin-only) ───
-- Devuelve metadatos administrativos + estado ACTUAL de la ficha (puede haber
-- cambiado desde el rechazo: re-vinculada a otro profile, fusionada, inactiva).
-- NUNCA contenido clínico ni JSON crudo de snapshots.
CREATE OR REPLACE FUNCTION admin_list_patient_link_rejections(p_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador de plataforma puede usar esta herramienta' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.rejected_at DESC), '[]'::jsonb)
  INTO v
  FROM (
    SELECT
      r.id,
      r.status,
      r.rejected_at,
      r.resolved_at,
      r.resolved_by,
      rb.full_name                AS resolved_by_name,
      r.resolution_note,
      r.phone_normalized,
      jsonb_build_object(
        'id', p.id,
        'full_name', p.full_name,
        'clinic_id', p.clinic_id,
        'clinic_name', c.name,
        'is_active', p.is_active,
        'profile_id', p.profile_id,                 -- vinculada/desvinculada/re-vinculada hoy
        'merged_into_patient_id', p.merged_into_patient_id
      )                           AS patient,
      jsonb_build_object(
        'profile_id', r.profile_id,
        'full_name', rp.full_name
      )                           AS rejected_by
    FROM patient_link_rejections r
    LEFT JOIN patients p ON p.id = r.patient_id
    LEFT JOIN clinics  c ON c.id = p.clinic_id
    LEFT JOIN profiles rp ON rp.id = r.profile_id    -- profile que rechazó
    LEFT JOIN profiles rb ON rb.id = r.resolved_by   -- admin que resolvió
    WHERE p_status IS NULL OR r.status = p_status
  ) t;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION admin_list_patient_link_rejections(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_patient_link_rejections(text) FROM anon;
GRANT EXECUTE ON FUNCTION admin_list_patient_link_rejections(text) TO authenticated;

-- ─── 3. RPC de transición (resolver / reabrir) ──────────────
-- SOLO escribe `patient_link_rejections` + `audit_log`. No toca `patients`,
-- `profiles`, `auth.users` ni la identidad. No re-vincula ni fusiona.
CREATE OR REPLACE FUNCTION admin_resolve_link_rejection(
  p_rejection_id uuid,
  p_resolution_note text,
  p_reopen boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
  r       patient_link_rejections%ROWTYPE;
  v_old   jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador de plataforma puede usar esta herramienta' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO r FROM patient_link_rejections WHERE id = p_rejection_id FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'El rechazo de vínculo no existe' USING ERRCODE = 'P0080';
  END IF;

  -- Estado previo (para el audit; en reabrir conserva el resolution_note anterior).
  v_old := jsonb_build_object(
    'status', r.status, 'resolved_by', r.resolved_by,
    'resolved_at', r.resolved_at, 'resolution_note', r.resolution_note);

  IF p_reopen THEN
    -- Reabrir: vuelve a pending_review, limpia campos de resolución.
    UPDATE patient_link_rejections
       SET status = 'pending_review', resolved_by = NULL, resolved_at = NULL, resolution_note = NULL
     WHERE id = p_rejection_id;

    INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      v_admin, 'update'::audit_action, 'patient_link_rejections', p_rejection_id,
      v_old,
      jsonb_build_object('status', 'pending_review', 'edited_via', 'admin_reopen_link_rejection')
    );

    RETURN jsonb_build_object('success', true, 'id', p_rejection_id, 'status', 'pending_review');
  END IF;

  -- Resolver: exige motivo (≥10). Bookkeeping: marca revisado, sin tocar la ficha.
  IF p_resolution_note IS NULL OR length(btrim(p_resolution_note)) < 10 THEN
    RAISE EXCEPTION 'El motivo es obligatorio (mínimo 10 caracteres)' USING ERRCODE = 'P0081';
  END IF;

  UPDATE patient_link_rejections
     SET status = 'resolved', resolved_by = v_admin, resolved_at = now(),
         resolution_note = btrim(p_resolution_note)
   WHERE id = p_rejection_id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_admin, 'update'::audit_action, 'patient_link_rejections', p_rejection_id,
    v_old,
    jsonb_build_object(
      'status', 'resolved', 'resolved_by', v_admin,
      'resolution_note', btrim(p_resolution_note), 'edited_via', 'admin_resolve_link_rejection')
  );

  RETURN jsonb_build_object('success', true, 'id', p_rejection_id, 'status', 'resolved');
END;
$$;

REVOKE ALL ON FUNCTION admin_resolve_link_rejection(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_resolve_link_rejection(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION admin_resolve_link_rejection(uuid, text, boolean) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_49.mjs + node scripts/_smoke-s7_49.mjs
-- ───────────────────────────────────────────────────────────
