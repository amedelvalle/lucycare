-- ═══════════════════════════════════════════════════════════
-- Migración S7-25: ubicación estructurada en la ficha admin del médico
-- ═══════════════════════════════════════════════════════════
-- Permite que LucyAdmin > Médicos > Editar > Clínica edite
-- Departamento + Municipio como IDs estructurados (mismas listas
-- jerárquicas que usa el Home), persistidos en clinics.department_id /
-- clinics.municipality_id. El Home filtra por esas columnas
-- (directory.service: .eq('clinics.department_id'|'municipality_id')),
-- así que esto da datos confiables al filtro del directorio.
--
-- Dos cambios:
--   (A) admin_update_doctor_clinic — agrega p_department_id /
--       p_municipality_id (text; los catálogos usan IDs cortos text).
--       Valida: dept existe; muni existe y pertenece al dept; muni sin
--       dept es inválido. Enforcement: un médico PUBLICADO u OPERATIVO
--       no puede quedar sin dept+muni (obligatorios).
--   (B) admin_get_doctor_detail — devuelve clinic_department_id /
--       clinic_municipality_id para precargar los selects.
--
-- Sin lat/lng ni geolocalización (fuera de alcance).
-- Firmas cambian (params nuevos / columnas nuevas) → DROP + CREATE.
-- ═══════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- (A) admin_update_doctor_clinic — + department_id / municipality_id
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS admin_update_doctor_clinic(uuid, text, text, text);

CREATE FUNCTION admin_update_doctor_clinic(
  p_doctor_id       uuid,
  p_name            text,
  p_address         text,
  p_phone           text,
  p_department_id   text DEFAULT NULL,
  p_municipality_id text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id    uuid;
  v_old          record;
  v_name         text := btrim(coalesce(p_name, ''));
  v_address      text := nullif(btrim(coalesce(p_address, '')), '');
  v_phone        text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  v_dept         text := nullif(btrim(coalesce(p_department_id, '')), '');
  v_muni         text := nullif(btrim(coalesce(p_municipality_id, '')), '');
  v_published    boolean;
  v_operational  boolean;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'El nombre de la clínica no puede quedar vacío'; END IF;

  SELECT d.clinic_id, c.name, c.address_line, c.phone,
         c.department_id, c.municipality_id,
         d.is_published, d.is_operational
  INTO v_old
  FROM doctors d JOIN clinics c ON c.id = d.clinic_id
  WHERE d.id = p_doctor_id;
  IF v_old.clinic_id IS NULL THEN RAISE EXCEPTION 'Clínica del médico no encontrada'; END IF;
  v_clinic_id   := v_old.clinic_id;
  v_published   := v_old.is_published;
  v_operational := v_old.is_operational;

  -- ─── Validación de ubicación estructurada ───
  -- Municipio sin departamento no tiene sentido (jerárquico).
  IF v_muni IS NOT NULL AND v_dept IS NULL THEN
    RAISE EXCEPTION 'Seleccioná un departamento antes que el municipio' USING ERRCODE = 'P0001';
  END IF;

  -- Departamento debe existir.
  IF v_dept IS NOT NULL THEN
    PERFORM 1 FROM departments WHERE id = v_dept;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El departamento indicado no existe' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- Municipio debe existir y pertenecer al departamento.
  IF v_muni IS NOT NULL THEN
    PERFORM 1 FROM municipalities WHERE id = v_muni AND department_id = v_dept;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El municipio no existe o no pertenece al departamento indicado' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- ─── Obligatorios para publicados / operativos ───
  -- Un médico visible en el directorio (is_published) o que opera agenda
  -- (is_operational) debe tener ubicación estructurada completa, para que
  -- el filtro del Home sea confiable.
  IF (v_published OR v_operational) AND (v_dept IS NULL OR v_muni IS NULL) THEN
    RAISE EXCEPTION 'Departamento y Municipio son obligatorios para médicos publicados u operativos'
      USING ERRCODE = 'P0004';
  END IF;

  UPDATE clinics
  SET name            = v_name,
      address_line    = v_address,
      phone           = v_phone,
      department_id   = v_dept,
      municipality_id = v_muni
  WHERE id = v_clinic_id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'clinics', v_clinic_id,
    jsonb_build_object(
      'name', v_old.name, 'address_line', v_old.address_line, 'phone', v_old.phone,
      'department_id', v_old.department_id, 'municipality_id', v_old.municipality_id
    ),
    jsonb_build_object(
      'name', v_name, 'address_line', v_address, 'phone', v_phone,
      'department_id', v_dept, 'municipality_id', v_muni, 'edited_via', 'admin'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_doctor_clinic(uuid, text, text, text, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- (B) admin_get_doctor_detail — + clinic_department_id / _municipality_id
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS admin_get_doctor_detail(uuid);

CREATE FUNCTION admin_get_doctor_detail(p_doctor_id uuid)
RETURNS TABLE (
  doctor_id              uuid,
  profile_id             uuid,
  clinic_id              uuid,
  full_name              text,
  email                  text,
  phone                  text,
  avatar_url             text,
  specialty_id           uuid,
  specialty_name         text,
  bio                    text,
  clinic_name            text,
  clinic_address         text,
  clinic_phone           text,
  clinic_department_id   text,
  clinic_municipality_id text,
  is_published           boolean,
  is_operational         boolean,
  lucy_status            lucy_status
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  RETURN QUERY
  SELECT
    d.id, d.profile_id, d.clinic_id,
    p.full_name, p.email, p.phone, p.avatar_url,
    d.specialty_id, s.name AS specialty_name,
    d.bio,
    c.name AS clinic_name, c.address_line AS clinic_address, c.phone AS clinic_phone,
    c.department_id AS clinic_department_id, c.municipality_id AS clinic_municipality_id,
    d.is_published, d.is_operational, d.lucy_status
  FROM doctors d
  LEFT JOIN profiles    p ON p.id = d.profile_id
  LEFT JOIN specialties s ON s.id = d.specialty_id
  LEFT JOIN clinics     c ON c.id = d.clinic_id
  WHERE d.id = p_doctor_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_doctor_detail(uuid) TO authenticated;
