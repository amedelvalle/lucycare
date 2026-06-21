-- ═══════════════════════════════════════════════════════════
-- Migración S7-51: Lista de espera en el panel (médico + asistente)
-- ═══════════════════════════════════════════════════════════
-- Permite que el MÉDICO dueño y el ASISTENTE de su clínica vean y gestionen
-- la lista de espera de ese médico desde el panel, SIN depender de LucyAdmin.
--
-- Alcance:
--   • NUEVAS RPCs paralelas (NO se tocan ni se ensanchan las admin_*):
--       - clinic_list_waitlist(p_doctor_id, p_status, p_limit, p_offset)
--       - clinic_update_waitlist_entry(p_entry_id, p_status, p_notes)
--   • SECURITY DEFINER + gate server-side: el caller debe ser el médico dueño
--     del doctor_id (get_user_doctor_id() = doctor_id) O miembro de la clínica
--     de ese médico (is_clinic_member(clinic)). NO se confía en el doctor_id del
--     cliente sin validar. Sin cross-clínica ni cross-médico.
--   • Estados permitidos: pending / contacted / cancelled (igual que admin).
--   • Audita los cambios de estado/notas (edited_via='clinic').
--
-- NO toca: el esquema de waitlist_entries (status/notes/contacted_* ya existen),
-- la RLS existente, submit_waitlist_entry (público), las RPCs admin_* (vista
-- global cross-médicos y supervisión siguen reservadas a LucyAdmin), ni el dedup.
-- Sin nuevas columnas. Sin identidad/auth.users.
-- ═══════════════════════════════════════════════════════════

-- ─── Helper interno: gate de autorización por médico/clínica ──
-- Devuelve el clinic_id del médico si el caller tiene derecho (dueño o miembro);
-- lanza P0001 si no. Centraliza el gate para list + update.
CREATE OR REPLACE FUNCTION _clinic_waitlist_authorize(p_doctor_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = 'P0001';
  END IF;

  SELECT clinic_id INTO v_clinic FROM doctors WHERE id = p_doctor_id;
  IF v_clinic IS NULL THEN
    RAISE EXCEPTION 'Médico no encontrado.' USING ERRCODE = 'P0107';
  END IF;

  -- Dueño del doctor_id O miembro de la clínica de ese médico.
  IF get_user_doctor_id() = p_doctor_id OR is_clinic_member(v_clinic) THEN
    RETURN v_clinic;
  END IF;

  RAISE EXCEPTION 'No autorizado para esta lista de espera.' USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION _clinic_waitlist_authorize(uuid) FROM PUBLIC, anon, authenticated;

-- ─── 1. Listado scoped (médico/asistente de la clínica) ─────
-- Orden: pendientes primero, luego más recientes. total_count via window
-- (mismo patrón que admin_list_waitlist / s7_41) → rows + total en una query.
CREATE OR REPLACE FUNCTION clinic_list_waitlist(
  p_doctor_id  uuid,
  p_status     text DEFAULT NULL,
  p_limit      int  DEFAULT 50,
  p_offset     int  DEFAULT 0
)
RETURNS TABLE (
  id               uuid,
  patient_name     text,
  patient_phone    text,
  patient_message  text,
  status           text,
  contacted_at     timestamptz,
  notes            text,
  created_at       timestamptz,
  total_count      bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM _clinic_waitlist_authorize(p_doctor_id);

  IF p_status IS NOT NULL AND p_status NOT IN ('pending','contacted','cancelled') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status USING ERRCODE = 'P0105';
  END IF;

  RETURN QUERY
  SELECT w.id, w.patient_name, w.patient_phone, w.patient_message,
         w.status, w.contacted_at, w.notes, w.created_at,
         count(*) OVER() AS total_count
  FROM waitlist_entries w
  WHERE w.doctor_id = p_doctor_id
    AND (p_status IS NULL OR w.status = p_status)
  ORDER BY (w.status = 'pending') DESC, w.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200))
  OFFSET GREATEST(0, p_offset);
END;
$$;

REVOKE ALL ON FUNCTION clinic_list_waitlist(uuid, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION clinic_list_waitlist(uuid, text, int, int) TO authenticated;

-- ─── 2. Actualizar estado / nota (scoped) ───────────────────
-- Espejo funcional de admin_update_waitlist_entry pero gateado por clínica/
-- propiedad y auditado con edited_via='clinic'. NO toca la RPC admin.
CREATE OR REPLACE FUNCTION clinic_update_waitlist_entry(
  p_entry_id  uuid,
  p_status    text,
  p_notes     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor_id   uuid;
  v_old         waitlist_entries%ROWTYPE;
  v_clean_notes text := nullif(btrim(coalesce(p_notes, '')), '');
BEGIN
  IF p_status NOT IN ('pending','contacted','cancelled') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status USING ERRCODE = 'P0105';
  END IF;

  -- Resolver el médico de la entrada y autorizar al caller sobre esa clínica.
  SELECT doctor_id, status, contacted_at, notes
    INTO v_doctor_id, v_old.status, v_old.contacted_at, v_old.notes
  FROM waitlist_entries WHERE id = p_entry_id;
  IF v_doctor_id IS NULL THEN
    RAISE EXCEPTION 'Entrada no encontrada' USING ERRCODE = 'P0106';
  END IF;

  PERFORM _clinic_waitlist_authorize(v_doctor_id);

  UPDATE waitlist_entries
     SET status = p_status,
         contacted_at = CASE
           WHEN p_status = 'contacted' AND v_old.contacted_at IS NULL THEN now()
           WHEN p_status = 'pending'                                  THEN NULL
           ELSE contacted_at
         END,
         contacted_by = CASE WHEN p_status = 'contacted' THEN auth.uid() ELSE contacted_by END,
         notes = v_clean_notes,
         updated_at = now()
   WHERE id = p_entry_id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'waitlist_entries', p_entry_id,
    jsonb_build_object('status', v_old.status, 'notes', v_old.notes),
    jsonb_build_object('status', p_status, 'notes', v_clean_notes, 'edited_via', 'clinic')
  );
END;
$$;

REVOKE ALL ON FUNCTION clinic_update_waitlist_entry(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION clinic_update_waitlist_entry(uuid, text, text) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_51.mjs + node scripts/_smoke-s7_51.mjs
-- ───────────────────────────────────────────────────────────
