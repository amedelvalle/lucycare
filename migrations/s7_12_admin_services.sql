-- ═══════════════════════════════════════════════════════════
-- Migración S7-12: RPCs admin para servicios del médico (B3-admin)
-- ═══════════════════════════════════════════════════════════
-- Permite que el admin plataforma administre los servicios de
-- CUALQUIER médico desde /admin/medicos/:id, igual que el médico lo
-- hace para los suyos en /panel/servicios.
--
-- 5 RPCs SECURITY DEFINER, todas gateadas por is_admin() y todas
-- escriben audit_log:
--
--   admin_list_doctor_services(doctor_id)
--   admin_create_service(doctor_id, name, duration_minutes, price, is_first_visit)
--   admin_update_service(service_id, name, duration_minutes, price, is_first_visit)
--   admin_set_service_active(service_id, is_active)
--   admin_delete_service(service_id)
--
-- admin_delete_service hace hard-delete; si el servicio tiene citas
-- (FK appointments.service_id), captura la foreign_key_violation y
-- la re-lanza con un mensaje en español manteniendo el SQLSTATE 23503
-- para que la UI pueda detectarlo y ofrecer desactivar.
--
-- Idempotente (CREATE OR REPLACE FUNCTION). No destructivo.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Lista de servicios del médico (activos + inactivos) ───
CREATE OR REPLACE FUNCTION admin_list_doctor_services(p_doctor_id uuid)
RETURNS TABLE (
  id               uuid,
  doctor_id        uuid,
  name             text,
  duration_minutes int,
  price            decimal,
  is_first_visit   boolean,
  is_active        boolean,
  sort_order       int
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  RETURN QUERY
  SELECT s.id, s.doctor_id, s.name, s.duration_minutes, s.price,
         s.is_first_visit, s.is_active, s.sort_order
  FROM services s
  WHERE s.doctor_id = p_doctor_id
  ORDER BY s.sort_order, s.name;
END;
$$;

-- ─── 2. Crear servicio ────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_create_service(
  p_doctor_id        uuid,
  p_name             text,
  p_duration_minutes int,
  p_price            decimal,
  p_is_first_visit   boolean
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id              uuid;
  v_next_sort       int;
  v_name            text := btrim(coalesce(p_name, ''));
  v_is_first_visit  boolean := coalesce(p_is_first_visit, false);
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'El nombre del servicio es obligatorio.'; END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN
    RAISE EXCEPTION 'La duración debe ser un número de minutos mayor a 0.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM doctors WHERE id = p_doctor_id) THEN
    RAISE EXCEPTION 'Médico no encontrado.';
  END IF;

  SELECT COALESCE(MAX(sort_order), -1) + 1
  INTO v_next_sort
  FROM services WHERE doctor_id = p_doctor_id;

  INSERT INTO services(doctor_id, name, duration_minutes, price, is_first_visit, is_active, sort_order)
  VALUES (p_doctor_id, v_name, p_duration_minutes, p_price, v_is_first_visit, true, v_next_sort)
  RETURNING id INTO v_id;

  INSERT INTO audit_log(user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'insert'::audit_action, 'services', v_id,
    NULL,
    jsonb_build_object(
      'doctor_id', p_doctor_id,
      'name', v_name,
      'duration_minutes', p_duration_minutes,
      'price', p_price,
      'is_first_visit', v_is_first_visit,
      'edited_via', 'admin'
    )
  );

  RETURN v_id;
END;
$$;

-- ─── 3. Editar nombre / duración / precio / primera vez ───────
CREATE OR REPLACE FUNCTION admin_update_service(
  p_service_id       uuid,
  p_name             text,
  p_duration_minutes int,
  p_price            decimal,
  p_is_first_visit   boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old             record;
  v_name            text := btrim(coalesce(p_name, ''));
  v_is_first_visit  boolean := coalesce(p_is_first_visit, false);
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'El nombre del servicio es obligatorio.'; END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN
    RAISE EXCEPTION 'La duración debe ser un número de minutos mayor a 0.';
  END IF;

  SELECT id, doctor_id, name, duration_minutes, price, is_first_visit, is_active
  INTO v_old
  FROM services WHERE id = p_service_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Servicio no encontrado.'; END IF;

  UPDATE services
  SET name = v_name,
      duration_minutes = p_duration_minutes,
      price = p_price,
      is_first_visit = v_is_first_visit
  WHERE id = p_service_id;

  INSERT INTO audit_log(user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'services', p_service_id,
    jsonb_build_object(
      'name', v_old.name,
      'duration_minutes', v_old.duration_minutes,
      'price', v_old.price,
      'is_first_visit', v_old.is_first_visit
    ),
    jsonb_build_object(
      'name', v_name,
      'duration_minutes', p_duration_minutes,
      'price', p_price,
      'is_first_visit', v_is_first_visit,
      'edited_via', 'admin'
    )
  );
END;
$$;

-- ─── 4. Activar / desactivar ──────────────────────────────────
CREATE OR REPLACE FUNCTION admin_set_service_active(
  p_service_id uuid,
  p_is_active  boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old boolean;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_is_active IS NULL THEN RAISE EXCEPTION 'Valor de is_active requerido.'; END IF;

  SELECT is_active INTO v_old FROM services WHERE id = p_service_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Servicio no encontrado.'; END IF;

  UPDATE services SET is_active = p_is_active WHERE id = p_service_id;

  INSERT INTO audit_log(user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'services', p_service_id,
    jsonb_build_object('is_active', v_old),
    jsonb_build_object('is_active', p_is_active, 'edited_via', 'admin')
  );
END;
$$;

-- ─── 5. Eliminar (hard-delete; FK 23503 si tiene citas) ───────
CREATE OR REPLACE FUNCTION admin_delete_service(p_service_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old record;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;

  SELECT id, doctor_id, name, duration_minutes, price, is_first_visit, is_active, sort_order
  INTO v_old FROM services WHERE id = p_service_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Servicio no encontrado.'; END IF;

  BEGIN
    DELETE FROM services WHERE id = p_service_id;
  EXCEPTION WHEN foreign_key_violation THEN
    -- La cita referencia el servicio (appointments.service_id). Re-lanzamos
    -- conservando el SQLSTATE 23503 para que la UI lo detecte y ofrezca
    -- desactivar el servicio en lugar de borrarlo.
    RAISE EXCEPTION 'No se puede eliminar el servicio: tiene citas asociadas. Desactivalo en su lugar.'
      USING ERRCODE = '23503';
  END;

  INSERT INTO audit_log(user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'delete'::audit_action, 'services', p_service_id,
    jsonb_build_object(
      'doctor_id', v_old.doctor_id,
      'name', v_old.name,
      'duration_minutes', v_old.duration_minutes,
      'price', v_old.price,
      'is_first_visit', v_old.is_first_visit,
      'is_active', v_old.is_active
    ),
    jsonb_build_object('edited_via', 'admin')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_list_doctor_services(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_create_service(uuid, text, int, decimal, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_service(uuid, text, int, decimal, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_service_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_service(uuid) TO authenticated;
