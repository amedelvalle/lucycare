-- ═══════════════════════════════════════════════════════════
-- Migración S7-06: Fix admin_update_doctor_clinic
-- ═══════════════════════════════════════════════════════════
-- BUG (detectado en smoke-test de PR #20): admin_update_doctor_clinic
-- escribía clinics.updated_at, columna que NO existe en la tabla
-- clinics (sí existe en doctors y profiles, no en clinics). El UPDATE
-- fallaba en runtime con:
--   column "updated_at" of relation "clinics" does not exist
--
-- FIX: CREATE OR REPLACE de la función sin `updated_at = now()`.
-- El resto queda idéntico a s7_05. No destructivo (reemplazo de
-- función). Las RPCs admin_update_doctor_profile / _info NO se tocan:
-- profiles y doctors sí tienen updated_at.
--
-- NOTA (post-aplicación): este fix fue PARCIAL. Al re-probar surgió un
-- segundo error — `record "new" has no field "updated_at"` — del
-- trigger trg_clinics_updated_at (BEFORE UPDATE ON clinics) que también
-- espera la columna. La causa raíz es que la tabla clinics nunca tuvo
-- la columna updated_at; se corrige en s7_07. Esta migración igual
-- queda válida: con la columna presente, el trigger setea updated_at
-- y la RPC no necesita hacerlo.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_update_doctor_clinic(
  p_doctor_id  uuid,
  p_name       text,
  p_address    text,
  p_phone      text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id  uuid;
  v_old        record;
  v_name       text := btrim(coalesce(p_name, ''));
  v_address    text := nullif(btrim(coalesce(p_address, '')), '');
  v_phone      text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'El nombre de la clínica no puede quedar vacío'; END IF;

  SELECT d.clinic_id, c.name, c.address_line, c.phone
  INTO v_old
  FROM doctors d JOIN clinics c ON c.id = d.clinic_id
  WHERE d.id = p_doctor_id;
  IF v_old.clinic_id IS NULL THEN RAISE EXCEPTION 'Clínica del médico no encontrada'; END IF;
  v_clinic_id := v_old.clinic_id;

  UPDATE clinics
  SET name = v_name, address_line = v_address, phone = v_phone
  WHERE id = v_clinic_id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'clinics', v_clinic_id,
    jsonb_build_object('name', v_old.name, 'address_line', v_old.address_line, 'phone', v_old.phone),
    jsonb_build_object('name', v_name, 'address_line', v_address, 'phone', v_phone, 'edited_via', 'admin')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_doctor_clinic(uuid, text, text, text) TO authenticated;
