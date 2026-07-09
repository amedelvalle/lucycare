-- ═══════════════════════════════════════════════════════════
-- Migración S7-57: Niveles de acceso administrativo LucyAdmin (capability)
-- ═══════════════════════════════════════════════════════════
-- Introduce acceso administrativo POR NIVELES, aditivo y de mínimo privilegio,
-- SIN tocar `is_admin()` ni el enum `user_role`. Primer uso real:
-- `directory_editor` (editor del directorio médico). `operations_admin` queda
-- DISEÑADO en el modelo/funciones pero INERTE (ninguna RPC operativa se le
-- abre en este PR; su primer uso llegará en un PR-C futuro).
--
-- MODELO:
--   • owner_admin  = profiles.role='admin' + is_admin()  (NO vive en la tabla).
--   • operations_admin / directory_editor = filas en lucyadmin_access.
--   • Niveles anidados por rank: directory_editor(1) ⊂ operations_admin(2) ⊂
--     owner_admin(∞ vía is_admin()).
--   • Toda capacidad nueva = is_admin() OR (fila activa con rank >= umbral) →
--     un owner conserva TODO sin necesitar fila. is_admin() = superset absoluto.
--
-- SEGURIDAD:
--   • is_admin() INTACTO (las ~95 superficies admin históricas no cambian).
--   • lucyadmin_access con RLS admin-only (solo el owner la gestiona).
--   • Re-gate QUIRÚRGICO: solo las RPCs de datos PÚBLICOS del médico pasan de
--     is_admin() → can_manage_directory(). Todo lo demás sigue is_admin().
--   • auth.users / login / roles / verificación / lucy_status / is_operational /
--     booking_enabled / avatar(Storage RLS) / hard-delete / pacientes /
--     analytics / afiliaciones / waitlist / administradores → SIGUEN owner-only.
--   • Audit diferenciado: edited_via = actor efectivo (_lucyadmin_actor()):
--     'admin' | 'operations_admin' | 'directory_editor'.
--
-- Verificación: node scripts/check-s7_57.mjs  +  node scripts/_smoke-s7_57.mjs
-- ═══════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────
-- 1. Tabla lucyadmin_access (solo niveles intermedio/limitado)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lucyadmin_access (
  profile_id   uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  access_level text NOT NULL CHECK (access_level IN ('directory_editor', 'operations_admin')),
  is_active    boolean NOT NULL DEFAULT true,
  granted_by   uuid REFERENCES profiles(id),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  notes        text
);

COMMENT ON TABLE lucyadmin_access IS
  'Acceso administrativo por niveles (aditivo a is_admin()). owner_admin NO vive '
  'aquí (= profiles.role=admin). Solo directory_editor / operations_admin.';

-- RLS: solo el owner (is_admin()) puede ver/gestionar esta tabla. Las RPCs son
-- SECURITY DEFINER (la evalúan saltando RLS); esto protege el acceso DIRECTO.
ALTER TABLE lucyadmin_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lucyadmin_access_admin_all ON lucyadmin_access;
CREATE POLICY lucyadmin_access_admin_all ON lucyadmin_access
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

REVOKE ALL ON lucyadmin_access FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON lucyadmin_access TO authenticated;  -- RLS lo restringe a admin

-- ───────────────────────────────────────────────────────────
-- 2. Helpers internos (rank + actor efectivo para audit)
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _lucyadmin_rank(p_level text)
RETURNS int LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_level
    WHEN 'directory_editor' THEN 1
    WHEN 'operations_admin' THEN 2
    ELSE 0
  END;
$$;

-- Etiqueta del actor efectivo para audit_log.edited_via.
-- owner (is_admin) → 'admin'; si no, el nivel activo de la fila; si nada → NULL.
CREATE OR REPLACE FUNCTION _lucyadmin_actor()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN is_admin() THEN 'admin'
    ELSE (SELECT access_level FROM lucyadmin_access
          WHERE profile_id = auth.uid() AND is_active = true LIMIT 1)
  END;
$$;

-- ───────────────────────────────────────────────────────────
-- 3. Funciones de capacidad (is_admin() = superset absoluto)
-- ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION can_access_lucyadmin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_admin() OR EXISTS (
    SELECT 1 FROM lucyadmin_access
    WHERE profile_id = auth.uid() AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION can_manage_directory()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_admin() OR EXISTS (
    SELECT 1 FROM lucyadmin_access
    WHERE profile_id = auth.uid() AND is_active = true
      AND _lucyadmin_rank(access_level) >= 1
  );
$$;

CREATE OR REPLACE FUNCTION can_manage_doctor_operations()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_admin() OR EXISTS (
    SELECT 1 FROM lucyadmin_access
    WHERE profile_id = auth.uid() AND is_active = true
      AND _lucyadmin_rank(access_level) >= 2
  );
$$;

-- Gestionar accesos LucyAdmin (y administradores) = SOLO owner.
CREATE OR REPLACE FUNCTION can_manage_lucyadmin_users()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_admin();
$$;

-- Snapshot de acceso del caller (lo consume el guard/nav del frontend en PR-B).
-- owner → level='owner_admin' (calculado, NO almacenado).
CREATE OR REPLACE FUNCTION my_lucyadmin_access()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'level', CASE
               WHEN is_admin() THEN 'owner_admin'
               ELSE (SELECT access_level FROM lucyadmin_access
                     WHERE profile_id = auth.uid() AND is_active = true LIMIT 1)
             END,
    'can_access_lucyadmin',  can_access_lucyadmin(),
    'can_manage_directory',  can_manage_directory(),
    'can_manage_operations', can_manage_doctor_operations(),
    'can_manage_users',      can_manage_lucyadmin_users()
  );
$$;

REVOKE ALL ON FUNCTION _lucyadmin_actor()            FROM anon;
REVOKE ALL ON FUNCTION can_access_lucyadmin()        FROM anon;
REVOKE ALL ON FUNCTION can_manage_directory()        FROM anon;
REVOKE ALL ON FUNCTION can_manage_doctor_operations() FROM anon;
REVOKE ALL ON FUNCTION can_manage_lucyadmin_users()  FROM anon;
REVOKE ALL ON FUNCTION my_lucyadmin_access()         FROM anon;
GRANT EXECUTE ON FUNCTION can_access_lucyadmin()        TO authenticated;
GRANT EXECUTE ON FUNCTION can_manage_directory()        TO authenticated;
GRANT EXECUTE ON FUNCTION can_manage_doctor_operations() TO authenticated;
GRANT EXECUTE ON FUNCTION can_manage_lucyadmin_users()  TO authenticated;
GRANT EXECUTE ON FUNCTION my_lucyadmin_access()         TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 4. RE-GATE de RPCs de datos PÚBLICOS del médico
--    is_admin()  →  can_manage_directory()
--    + audit edited_via = _lucyadmin_actor()
--    (mismo cuerpo/firma que su migración original; solo cambia gate + actor)
-- ═══════════════════════════════════════════════════════════

-- 4.1 Clínica (nombre/dirección/teléfono público/depto/muni) — base s7_25.
--     Edita el registro `clinics`; NO reasigna clínica ni toca clinic_members.
CREATE OR REPLACE FUNCTION admin_update_doctor_clinic(
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
  IF NOT can_manage_directory() THEN RAISE EXCEPTION 'No autorizado'; END IF;
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

  IF v_muni IS NOT NULL AND v_dept IS NULL THEN
    RAISE EXCEPTION 'Seleccioná un departamento antes que el municipio' USING ERRCODE = 'P0001';
  END IF;
  IF v_dept IS NOT NULL THEN
    PERFORM 1 FROM departments WHERE id = v_dept;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El departamento indicado no existe' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  IF v_muni IS NOT NULL THEN
    PERFORM 1 FROM municipalities WHERE id = v_muni AND department_id = v_dept;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El municipio no existe o no pertenece al departamento indicado' USING ERRCODE = 'P0003';
    END IF;
  END IF;
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
      'department_id', v_dept, 'municipality_id', v_muni, 'edited_via', _lucyadmin_actor()
    )
  );
END;
$$;

-- 4.2 Info profesional (especialidad + bio) — base s7_05.
CREATE OR REPLACE FUNCTION admin_update_doctor_info(
  p_doctor_id    uuid,
  p_specialty_id uuid,
  p_bio          text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old      record;
  v_bio      text := nullif(btrim(coalesce(p_bio, '')), '');
BEGIN
  IF NOT can_manage_directory() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_specialty_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM specialties WHERE id = p_specialty_id) THEN
      RAISE EXCEPTION 'Especialidad no encontrada';
    END IF;
  END IF;

  SELECT specialty_id, bio INTO v_old FROM doctors WHERE id = p_doctor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Médico no encontrado'; END IF;

  UPDATE doctors
  SET specialty_id = p_specialty_id, bio = v_bio, updated_at = now()
  WHERE id = p_doctor_id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'doctors', p_doctor_id,
    jsonb_build_object('specialty_id', v_old.specialty_id, 'bio', v_old.bio),
    jsonb_build_object('specialty_id', p_specialty_id, 'bio', v_bio, 'edited_via', _lucyadmin_actor())
  );
END;
$$;

-- 4.3 Publicar/despublicar — base s7_02. Toca EXCLUSIVAMENTE is_published.
--     (Se re-implementa con audit inline para etiquetar edited_via=actor sin
--      tocar el helper _admin_log_doctor_change, que sigue sirviendo a las RPCs
--      owner-only verified/operational/lucy_status.)
CREATE OR REPLACE FUNCTION admin_set_doctor_published(
  p_doctor_id uuid, p_value boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE old_v boolean;
BEGIN
  IF NOT can_manage_directory() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT is_published INTO old_v FROM doctors WHERE id = p_doctor_id;
  IF old_v IS NULL THEN RAISE EXCEPTION 'Médico no encontrado'; END IF;
  UPDATE doctors SET is_published = p_value, updated_at = now() WHERE id = p_doctor_id;
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'doctors', p_doctor_id,
    jsonb_build_object('is_published', old_v),
    jsonb_build_object('is_published', p_value, 'edited_via', _lucyadmin_actor())
  );
END;
$$;

-- 4.4 Servicios públicos (leer / crear / editar / activar-desactivar) — base s7_12.
--     admin_delete_service (hard-delete) NO se re-gatea: sigue owner-only.
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
  IF NOT can_manage_directory() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  RETURN QUERY
  SELECT s.id, s.doctor_id, s.name, s.duration_minutes, s.price,
         s.is_first_visit, s.is_active, s.sort_order
  FROM services s
  WHERE s.doctor_id = p_doctor_id
  ORDER BY s.sort_order, s.name;
END;
$$;

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
  IF NOT can_manage_directory() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'El nombre del servicio es obligatorio.'; END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN
    RAISE EXCEPTION 'La duración debe ser un número de minutos mayor a 0.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM doctors WHERE id = p_doctor_id) THEN
    RAISE EXCEPTION 'Médico no encontrado.';
  END IF;

  SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_next_sort
  FROM services WHERE doctor_id = p_doctor_id;

  INSERT INTO services(doctor_id, name, duration_minutes, price, is_first_visit, is_active, sort_order)
  VALUES (p_doctor_id, v_name, p_duration_minutes, p_price, v_is_first_visit, true, v_next_sort)
  RETURNING id INTO v_id;

  INSERT INTO audit_log(user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'insert'::audit_action, 'services', v_id, NULL,
    jsonb_build_object(
      'doctor_id', p_doctor_id, 'name', v_name, 'duration_minutes', p_duration_minutes,
      'price', p_price, 'is_first_visit', v_is_first_visit, 'edited_via', _lucyadmin_actor()
    )
  );
  RETURN v_id;
END;
$$;

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
  IF NOT can_manage_directory() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'El nombre del servicio es obligatorio.'; END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN
    RAISE EXCEPTION 'La duración debe ser un número de minutos mayor a 0.';
  END IF;

  SELECT id, doctor_id, name, duration_minutes, price, is_first_visit, is_active
  INTO v_old FROM services WHERE id = p_service_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Servicio no encontrado.'; END IF;

  UPDATE services
  SET name = v_name, duration_minutes = p_duration_minutes,
      price = p_price, is_first_visit = v_is_first_visit
  WHERE id = p_service_id;

  INSERT INTO audit_log(user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'services', p_service_id,
    jsonb_build_object(
      'name', v_old.name, 'duration_minutes', v_old.duration_minutes,
      'price', v_old.price, 'is_first_visit', v_old.is_first_visit
    ),
    jsonb_build_object(
      'name', v_name, 'duration_minutes', p_duration_minutes, 'price', p_price,
      'is_first_visit', v_is_first_visit, 'edited_via', _lucyadmin_actor()
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_service_active(
  p_service_id uuid,
  p_is_active  boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_old boolean;
BEGIN
  IF NOT can_manage_directory() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_is_active IS NULL THEN RAISE EXCEPTION 'Valor de is_active requerido.'; END IF;

  SELECT is_active INTO v_old FROM services WHERE id = p_service_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Servicio no encontrado.'; END IF;

  UPDATE services SET is_active = p_is_active WHERE id = p_service_id;

  INSERT INTO audit_log(user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'services', p_service_id,
    jsonb_build_object('is_active', v_old),
    jsonb_build_object('is_active', p_is_active, 'edited_via', _lucyadmin_actor())
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 5. RPCs NUEVAS acotadas (gated can_manage_directory())
--    Lecturas SIN credenciales de login (email/phone) + update de nombre
--    acotado a profiles.full_name (jamás auth.users).
-- ═══════════════════════════════════════════════════════════

-- 5.1 Listado del directorio SIN teléfono/email de login.
CREATE OR REPLACE FUNCTION directory_list_doctors(
  p_search    text    DEFAULT NULL,
  p_published boolean DEFAULT NULL,
  p_limit     integer DEFAULT 50,
  p_offset    integer DEFAULT 0
)
RETURNS TABLE (
  id           uuid,
  full_name    text,
  specialty    text,
  clinic_name  text,
  is_verified  boolean,
  is_published boolean,
  lucy_status  lucy_status,
  created_at   timestamptz,
  total_count  bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_search text := nullif(btrim(p_search), '');
BEGIN
  IF NOT can_manage_directory() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  RETURN QUERY
  WITH filtered AS (
    SELECT d.id, p.full_name, s.name AS specialty, c.name AS clinic_name,
           d.is_verified, d.is_published, d.lucy_status, d.created_at
    FROM doctors d
    LEFT JOIN profiles    p ON p.id = d.profile_id
    LEFT JOIN specialties s ON s.id = d.specialty_id
    LEFT JOIN clinics     c ON c.id = d.clinic_id
    WHERE (p_published IS NULL OR d.is_published = p_published)
      AND (
        v_search IS NULL
        OR p.full_name ILIKE '%' || v_search || '%'
        OR s.name      ILIKE '%' || v_search || '%'
      )
  )
  SELECT f.id, f.full_name, f.specialty, f.clinic_name,
         f.is_verified, f.is_published, f.lucy_status, f.created_at,
         count(*) OVER ()::bigint AS total_count
  FROM filtered f
  ORDER BY f.created_at DESC
  LIMIT GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

-- 5.2 Detalle del médico SIN email/phone de login (solo campos públicos/editables).
CREATE OR REPLACE FUNCTION directory_get_doctor_detail(p_doctor_id uuid)
RETURNS TABLE (
  doctor_id              uuid,
  profile_id             uuid,
  clinic_id              uuid,
  full_name              text,
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
  is_verified            boolean,
  lucy_status            lucy_status
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT can_manage_directory() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  RETURN QUERY
  SELECT
    d.id, d.profile_id, d.clinic_id,
    p.full_name, p.avatar_url,
    d.specialty_id, s.name AS specialty_name, d.bio,
    c.name AS clinic_name, c.address_line AS clinic_address, c.phone AS clinic_phone,
    c.department_id AS clinic_department_id, c.municipality_id AS clinic_municipality_id,
    d.is_published, d.is_verified, d.lucy_status
  FROM doctors d
  LEFT JOIN profiles    p ON p.id = d.profile_id
  LEFT JOIN specialties s ON s.id = d.specialty_id
  LEFT JOIN clinics     c ON c.id = d.clinic_id
  WHERE d.id = p_doctor_id;
END;
$$;

-- 5.3 Nombre visible: SOLO profiles.full_name. NUNCA auth.users/email/phone/role.
CREATE OR REPLACE FUNCTION directory_update_doctor_name(
  p_doctor_id uuid,
  p_full_name text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_old_name   text;
  v_name       text := btrim(coalesce(p_full_name, ''));
BEGIN
  IF NOT can_manage_directory() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'El nombre no puede quedar vacío'; END IF;

  SELECT d.profile_id, p.full_name INTO v_profile_id, v_old_name
  FROM doctors d JOIN profiles p ON p.id = d.profile_id
  WHERE d.id = p_doctor_id;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'Médico no encontrado'; END IF;

  UPDATE profiles SET full_name = v_name, updated_at = now() WHERE id = v_profile_id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'profiles', v_profile_id,
    jsonb_build_object('full_name', v_old_name),
    jsonb_build_object('full_name', v_name, 'field', 'full_name', 'edited_via', _lucyadmin_actor())
  );
END;
$$;

REVOKE ALL ON FUNCTION directory_list_doctors(text, boolean, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION directory_get_doctor_detail(uuid)                        FROM anon;
REVOKE ALL ON FUNCTION directory_update_doctor_name(uuid, text)                 FROM anon;
GRANT EXECUTE ON FUNCTION directory_list_doctors(text, boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION directory_get_doctor_detail(uuid)                        TO authenticated;
GRANT EXECUTE ON FUNCTION directory_update_doctor_name(uuid, text)                 TO authenticated;

-- ───────────────────────────────────────────────────────────
-- ROLLBACK (additive; is_admin() nunca se tocó):
--   -- revertir el gate de las RPCs re-gateadas a is_admin() = re-aplicar
--   -- s7_02 / s7_05 / s7_12 / s7_25 (CREATE OR REPLACE originales).
--   DROP FUNCTION IF EXISTS directory_list_doctors(text, boolean, integer, integer);
--   DROP FUNCTION IF EXISTS directory_get_doctor_detail(uuid);
--   DROP FUNCTION IF EXISTS directory_update_doctor_name(uuid, text);
--   DROP FUNCTION IF EXISTS my_lucyadmin_access();
--   DROP FUNCTION IF EXISTS can_access_lucyadmin();
--   DROP FUNCTION IF EXISTS can_manage_directory();
--   DROP FUNCTION IF EXISTS can_manage_doctor_operations();
--   DROP FUNCTION IF EXISTS can_manage_lucyadmin_users();
--   DROP FUNCTION IF EXISTS _lucyadmin_actor();
--   DROP FUNCTION IF EXISTS _lucyadmin_rank(text);
--   DROP TABLE IF EXISTS lucyadmin_access;
--   -- corte inmediato sin deploy: UPDATE lucyadmin_access SET is_active=false;
-- ───────────────────────────────────────────────────────────
