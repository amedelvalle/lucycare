-- ============================================================
-- LUCYCARE — Políticas de Row Level Security (RLS)
-- Versión 1.0 • Abril 2026
-- ============================================================
-- EJECUTAR DESPUÉS del schema principal.
-- Prerequisito: Todas las 24 tablas ya creadas con RLS habilitado.
-- ============================================================

-- ============================================================
-- FUNCIONES HELPER PARA RLS
-- ============================================================

-- Obtener el rol del usuario actual desde profiles
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Verificar si el usuario es miembro activo de una clínica
CREATE OR REPLACE FUNCTION is_clinic_member(p_clinic_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM clinic_members
    WHERE clinic_id = p_clinic_id
      AND profile_id = auth.uid()
      AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Verificar si el usuario es miembro con rol específico en una clínica
CREATE OR REPLACE FUNCTION is_clinic_member_with_role(p_clinic_id UUID, p_role clinic_member_role)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM clinic_members
    WHERE clinic_id = p_clinic_id
      AND profile_id = auth.uid()
      AND role = p_role
      AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Obtener los clinic_ids donde el usuario es miembro activo
CREATE OR REPLACE FUNCTION get_user_clinic_ids()
RETURNS SETOF UUID AS $$
  SELECT clinic_id FROM clinic_members
  WHERE profile_id = auth.uid()
    AND is_active = true;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Obtener el doctor_id del usuario actual (si es médico)
CREATE OR REPLACE FUNCTION get_user_doctor_id()
RETURNS UUID AS $$
  SELECT id FROM doctors WHERE profile_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- 1. PROFILES
-- ============================================================
-- Cualquiera autenticado puede ver perfiles (para mostrar nombres)
-- Solo el propio usuario puede editar su perfil
CREATE POLICY profiles_select ON profiles
  FOR SELECT USING (true);

CREATE POLICY profiles_update ON profiles
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY profiles_insert ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

-- ============================================================
-- 2. CLINICS
-- ============================================================
-- Miembros de la clínica pueden verla
-- Solo el dueño puede editarla
-- Cualquier doctor autenticado puede crear una clínica
CREATE POLICY clinics_select ON clinics
  FOR SELECT USING (
    is_clinic_member(id)
    OR owner_id = auth.uid()
  );

CREATE POLICY clinics_insert ON clinics
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY clinics_update ON clinics
  FOR UPDATE USING (owner_id = auth.uid());

-- ============================================================
-- 3. CLINIC_MEMBERS
-- ============================================================
-- Miembros activos de la clínica pueden ver otros miembros
-- Solo el dueño (owner) puede agregar/editar miembros
CREATE POLICY clinic_members_select ON clinic_members
  FOR SELECT USING (is_clinic_member(clinic_id));

CREATE POLICY clinic_members_insert ON clinic_members
  FOR INSERT WITH CHECK (
    is_clinic_member_with_role(clinic_id, 'owner')
  );

CREATE POLICY clinic_members_update ON clinic_members
  FOR UPDATE USING (
    is_clinic_member_with_role(clinic_id, 'owner')
  );

CREATE POLICY clinic_members_delete ON clinic_members
  FOR DELETE USING (
    is_clinic_member_with_role(clinic_id, 'owner')
  );

-- ============================================================
-- 4. CATÁLOGOS DEL SISTEMA (lectura pública)
-- ============================================================

-- specialties: Todos pueden leer (directorio público)
CREATE POLICY specialties_select ON specialties
  FOR SELECT USING (true);

CREATE POLICY specialties_admin ON specialties
  FOR ALL USING (get_user_role() = 'admin');

-- appointment_statuses: Todos autenticados pueden leer
CREATE POLICY appointment_statuses_select ON appointment_statuses
  FOR SELECT USING (true);

CREATE POLICY appointment_statuses_admin ON appointment_statuses
  FOR ALL USING (get_user_role() = 'admin');

-- cancel_reasons: Todos autenticados pueden leer
CREATE POLICY cancel_reasons_select ON cancel_reasons
  FOR SELECT USING (true);

CREATE POLICY cancel_reasons_admin ON cancel_reasons
  FOR ALL USING (get_user_role() = 'admin');

-- block_types: Todos autenticados pueden leer
CREATE POLICY block_types_select ON block_types
  FOR SELECT USING (true);

CREATE POLICY block_types_admin ON block_types
  FOR ALL USING (get_user_role() = 'admin');

-- departments: Lectura pública (directorio)
CREATE POLICY departments_select ON departments
  FOR SELECT USING (true);

-- municipalities: Lectura pública (directorio)
CREATE POLICY municipalities_select ON municipalities
  FOR SELECT USING (true);

-- ============================================================
-- 5. DOCTORS (Perfil público del directorio)
-- ============================================================
-- SELECT público: cualquiera puede buscar médicos (directorio)
-- Solo los publicados son visibles para anónimos
-- INSERT/UPDATE: solo el propio médico (profile_id = auth.uid())
CREATE POLICY doctors_select_public ON doctors
  FOR SELECT USING (
    is_published = true  -- Visitante anónimo ve solo publicados
    OR profile_id = auth.uid()  -- El propio médico ve su perfil siempre
    OR is_clinic_member(clinic_id)  -- Miembros de su clínica lo ven
  );

CREATE POLICY doctors_insert ON doctors
  FOR INSERT WITH CHECK (profile_id = auth.uid());

CREATE POLICY doctors_update ON doctors
  FOR UPDATE USING (profile_id = auth.uid());

-- ============================================================
-- 6. DOCTOR_IMAGES
-- ============================================================
-- SELECT público (galería del directorio)
-- INSERT/UPDATE/DELETE: solo el médico dueño
CREATE POLICY doctor_images_select ON doctor_images
  FOR SELECT USING (true);

CREATE POLICY doctor_images_insert ON doctor_images
  FOR INSERT WITH CHECK (
    doctor_id = get_user_doctor_id()
  );

CREATE POLICY doctor_images_update ON doctor_images
  FOR UPDATE USING (
    doctor_id = get_user_doctor_id()
  );

CREATE POLICY doctor_images_delete ON doctor_images
  FOR DELETE USING (
    doctor_id = get_user_doctor_id()
  );

-- ============================================================
-- 7. AVAILABILITY_RULES
-- ============================================================
-- SELECT público (para que pacientes vean disponibilidad en booking)
-- INSERT/UPDATE: solo el médico o miembros de su clínica
CREATE POLICY availability_rules_select ON availability_rules
  FOR SELECT USING (true);

CREATE POLICY availability_rules_insert ON availability_rules
  FOR INSERT WITH CHECK (
    doctor_id = get_user_doctor_id()
    OR is_clinic_member(clinic_id)
  );

CREATE POLICY availability_rules_update ON availability_rules
  FOR UPDATE USING (
    doctor_id = get_user_doctor_id()
    OR is_clinic_member(clinic_id)
  );

CREATE POLICY availability_rules_delete ON availability_rules
  FOR DELETE USING (
    doctor_id = get_user_doctor_id()
  );

-- ============================================================
-- 8. AVAILABILITY_OVERRIDES
-- ============================================================
-- SELECT público (para excluir bloqueos del booking)
-- INSERT/UPDATE: médico o miembros de su clínica
CREATE POLICY availability_overrides_select ON availability_overrides
  FOR SELECT USING (true);

CREATE POLICY availability_overrides_insert ON availability_overrides
  FOR INSERT WITH CHECK (
    doctor_id = get_user_doctor_id()
    OR is_clinic_member(clinic_id)
  );

CREATE POLICY availability_overrides_update ON availability_overrides
  FOR UPDATE USING (
    doctor_id = get_user_doctor_id()
    OR is_clinic_member(clinic_id)
  );

CREATE POLICY availability_overrides_delete ON availability_overrides
  FOR DELETE USING (
    doctor_id = get_user_doctor_id()
    OR is_clinic_member(clinic_id)
  );

-- ============================================================
-- 9. PATIENTS
-- ============================================================
-- Solo miembros de la clínica pueden ver pacientes de esa clínica
-- Paciente con cuenta Lucy puede ver su propio registro
-- INSERT: miembros de la clínica (médico o secretaria crean pacientes)
CREATE POLICY patients_select ON patients
  FOR SELECT USING (
    is_clinic_member(clinic_id)
    OR profile_id = auth.uid()
  );

CREATE POLICY patients_insert ON patients
  FOR INSERT WITH CHECK (
    is_clinic_member(clinic_id)
  );

CREATE POLICY patients_update ON patients
  FOR UPDATE USING (
    is_clinic_member(clinic_id)
  );

-- ============================================================
-- 10. SERVICES (catálogo por médico)
-- ============================================================
-- SELECT público (se muestran en directorio y booking)
-- INSERT/UPDATE: solo el médico dueño
CREATE POLICY services_select ON services
  FOR SELECT USING (true);

CREATE POLICY services_insert ON services
  FOR INSERT WITH CHECK (
    doctor_id = get_user_doctor_id()
  );

CREATE POLICY services_update ON services
  FOR UPDATE USING (
    doctor_id = get_user_doctor_id()
  );

-- ============================================================
-- 11. DIAGNOSES (catálogo por médico)
-- ============================================================
-- Solo el médico dueño ve y gestiona su catálogo de diagnósticos
-- Secretaria NO tiene acceso (dato clínico)
CREATE POLICY diagnoses_select ON diagnoses
  FOR SELECT USING (
    doctor_id = get_user_doctor_id()
  );

CREATE POLICY diagnoses_insert ON diagnoses
  FOR INSERT WITH CHECK (
    doctor_id = get_user_doctor_id()
  );

CREATE POLICY diagnoses_update ON diagnoses
  FOR UPDATE USING (
    doctor_id = get_user_doctor_id()
  );

-- ============================================================
-- 12. MEDICATIONS (catálogo por médico)
-- ============================================================
-- Solo el médico dueño ve y gestiona su catálogo de medicamentos
CREATE POLICY medications_select ON medications
  FOR SELECT USING (
    doctor_id = get_user_doctor_id()
  );

CREATE POLICY medications_insert ON medications
  FOR INSERT WITH CHECK (
    doctor_id = get_user_doctor_id()
  );

CREATE POLICY medications_update ON medications
  FOR UPDATE USING (
    doctor_id = get_user_doctor_id()
  );

-- ============================================================
-- 13. APPOINTMENT_REASONS (catálogo por médico)
-- ============================================================
-- Miembros de clínica pueden ver (secretaria necesita para agendar)
CREATE POLICY appointment_reasons_select ON appointment_reasons
  FOR SELECT USING (
    doctor_id = get_user_doctor_id()
    OR doctor_id IN (
      SELECT d.id FROM doctors d
      WHERE d.clinic_id IN (SELECT get_user_clinic_ids())
    )
  );

CREATE POLICY appointment_reasons_insert ON appointment_reasons
  FOR INSERT WITH CHECK (
    doctor_id = get_user_doctor_id()
  );

CREATE POLICY appointment_reasons_update ON appointment_reasons
  FOR UPDATE USING (
    doctor_id = get_user_doctor_id()
  );

-- ============================================================
-- 14. APPOINTMENTS (tabla central)
-- ============================================================
-- Miembros de la clínica ven todas las citas de esa clínica
-- Paciente ve solo sus propias citas
-- INSERT: miembros de clínica O paciente autenticado (booking)
CREATE POLICY appointments_select ON appointments
  FOR SELECT USING (
    is_clinic_member(clinic_id)
    OR patient_id IN (
      SELECT p.id FROM patients p WHERE p.profile_id = auth.uid()
    )
  );

CREATE POLICY appointments_insert ON appointments
  FOR INSERT WITH CHECK (
    is_clinic_member(clinic_id)
    OR (
      -- Paciente puede crear cita desde directorio
      patient_id IN (
        SELECT p.id FROM patients p WHERE p.profile_id = auth.uid()
      )
      AND source = 'lucy_directorio'
    )
  );

CREATE POLICY appointments_update ON appointments
  FOR UPDATE USING (
    is_clinic_member(clinic_id)
    OR patient_id IN (
      SELECT p.id FROM patients p WHERE p.profile_id = auth.uid()
    )
  );

-- ============================================================
-- 15. CONSULTATIONS (dato más sensible)
-- ============================================================
-- SOLO el médico tratante puede ver/crear/editar consultas
-- Secretaria NO tiene acceso — decisión cerrada del proyecto
-- Paciente NO tiene acceso directo (accede vía portal futuro)
CREATE POLICY consultations_select ON consultations
  FOR SELECT USING (
    doctor_id = get_user_doctor_id()
  );

CREATE POLICY consultations_insert ON consultations
  FOR INSERT WITH CHECK (
    doctor_id = get_user_doctor_id()
  );

CREATE POLICY consultations_update ON consultations
  FOR UPDATE USING (
    doctor_id = get_user_doctor_id()
    -- El trigger prevent_signed_consultation_edit bloquea firmadas
  );

-- ============================================================
-- 16. VITALS
-- ============================================================
-- Miembros de clínica con rol doctor o assistant pueden ver/crear
-- (enfermería/secretaria captura signos vitales pre-consulta)
-- Pero solo en el contexto de citas de su clínica
CREATE POLICY vitals_select ON vitals
  FOR SELECT USING (
    appointment_id IN (
      SELECT a.id FROM appointments a
      WHERE is_clinic_member(a.clinic_id)
    )
  );

CREATE POLICY vitals_insert ON vitals
  FOR INSERT WITH CHECK (
    appointment_id IN (
      SELECT a.id FROM appointments a
      WHERE is_clinic_member(a.clinic_id)
    )
  );

CREATE POLICY vitals_update ON vitals
  FOR UPDATE USING (
    appointment_id IN (
      SELECT a.id FROM appointments a
      WHERE is_clinic_member(a.clinic_id)
    )
  );

-- ============================================================
-- 17. CONSULTATION_DIAGNOSES
-- ============================================================
-- SOLO el médico tratante (a través de la consulta)
CREATE POLICY consultation_diagnoses_select ON consultation_diagnoses
  FOR SELECT USING (
    consultation_id IN (
      SELECT c.id FROM consultations c
      WHERE c.doctor_id = get_user_doctor_id()
    )
  );

CREATE POLICY consultation_diagnoses_insert ON consultation_diagnoses
  FOR INSERT WITH CHECK (
    consultation_id IN (
      SELECT c.id FROM consultations c
      WHERE c.doctor_id = get_user_doctor_id()
    )
  );

CREATE POLICY consultation_diagnoses_update ON consultation_diagnoses
  FOR UPDATE USING (
    consultation_id IN (
      SELECT c.id FROM consultations c
      WHERE c.doctor_id = get_user_doctor_id()
    )
  );

CREATE POLICY consultation_diagnoses_delete ON consultation_diagnoses
  FOR DELETE USING (
    consultation_id IN (
      SELECT c.id FROM consultations c
      WHERE c.doctor_id = get_user_doctor_id()
        AND c.signed_at IS NULL  -- Solo si no está firmada
    )
  );

-- ============================================================
-- 18. PRESCRIPTIONS
-- ============================================================
-- SOLO el médico tratante (a través de la consulta)
CREATE POLICY prescriptions_select ON prescriptions
  FOR SELECT USING (
    consultation_id IN (
      SELECT c.id FROM consultations c
      WHERE c.doctor_id = get_user_doctor_id()
    )
  );

CREATE POLICY prescriptions_insert ON prescriptions
  FOR INSERT WITH CHECK (
    consultation_id IN (
      SELECT c.id FROM consultations c
      WHERE c.doctor_id = get_user_doctor_id()
    )
  );

CREATE POLICY prescriptions_update ON prescriptions
  FOR UPDATE USING (
    consultation_id IN (
      SELECT c.id FROM consultations c
      WHERE c.doctor_id = get_user_doctor_id()
    )
  );

CREATE POLICY prescriptions_delete ON prescriptions
  FOR DELETE USING (
    consultation_id IN (
      SELECT c.id FROM consultations c
      WHERE c.doctor_id = get_user_doctor_id()
        AND c.signed_at IS NULL  -- Solo si no está firmada
    )
  );

-- ============================================================
-- 19. NOTIFICATIONS
-- ============================================================
-- Usuario ve solo sus propias notificaciones
-- Sistema (Edge Functions con service_role) crea notificaciones
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (
    recipient_id = auth.uid()
    OR is_clinic_member(clinic_id)
  );

-- INSERT solo por service_role (Edge Functions)
-- No se necesita policy de INSERT para usuarios normales

-- ============================================================
-- 20. REVIEWS
-- ============================================================
-- SELECT público (se muestran en directorio)
-- INSERT: solo pacientes autenticados
-- UPDATE/DELETE: solo el autor
CREATE POLICY reviews_select ON reviews
  FOR SELECT USING (is_visible = true OR patient_profile_id = auth.uid());

CREATE POLICY reviews_insert ON reviews
  FOR INSERT WITH CHECK (
    patient_profile_id = auth.uid()
  );

CREATE POLICY reviews_update ON reviews
  FOR UPDATE USING (
    patient_profile_id = auth.uid()
  );

-- ============================================================
-- NOTA: audit_log NO tiene RLS
-- ============================================================
-- La tabla audit_log no tiene políticas RLS.
-- Solo se escribe mediante triggers (SECURITY DEFINER).
-- Ningún usuario puede leer, editar o borrar registros de auditoría
-- desde el frontend. Solo accesible vía Supabase Dashboard o
-- queries con service_role key.

-- ============================================================
-- FIN DE POLÍTICAS RLS
-- ============================================================
-- Siguiente paso: ejecutar seed data
-- ============================================================
