-- ═══════════════════════════════════════════════════════════
-- Migración S7-16: RLS hardening de `profiles`
-- ═══════════════════════════════════════════════════════════
-- Cierra hallazgo #2 de docs/SECURITY_GATE_PILOTO.md.
--
-- Hoy `profiles` permite SELECT anónimo completo: cualquiera con
-- la anon key del bundle puede dumpear los 120 profiles con email
-- y teléfono del admin, 113 médicos y 6 pacientes.
--
-- Diseño:
--
-- 1. GRANTS por rol y columna:
--    - anon: SELECT (id, full_name, avatar_url) — únicas columnas
--      necesarias para el directorio público. Email y phone NUNCA
--      se exponen a anon.
--    - authenticated: SELECT todas las columnas + UPDATE + INSERT
--      (necesario para ensureProfile en signup).
--    - service_role: ya tiene acceso total por convención.
--
--    Si PostgREST recibe una request anon pidiendo email/phone,
--    rechaza con 403 (column-level grant insuficiente).
--
-- 2. POLICIES de SELECT (PERMISSIVE = combinadas con OR):
--    - anon: solo profiles vinculados a doctores publicados.
--    - authenticated: self O admin O médico-publicado O clinic-mate
--      O paciente-de-mi-clínica.
--
-- 3. POLICY de UPDATE: solo self. (Admin usa RPCs gateadas.)
-- 4. POLICY de INSERT: solo self con id = auth.uid()
--    (caso ensureProfile en flujo de OTP nuevo).
--
-- 5. Nada de RLS cambia para service_role. Scripts admin siguen
--    operando full access.
--
-- IMPORTANTE: el directorio público (`profiles!inner(full_name,
-- avatar_url)` desde getDoctors y getDoctorDetail) sigue funcionando
-- sin cambios en código del frontend, porque las columnas pedidas
-- coinciden con las columnas que anon tiene grant.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Resetear estado actual ──────────────────────────────
-- Quitar policies existentes en profiles (drop por nombre defensivo)
DROP POLICY IF EXISTS "profiles_select_all"           ON profiles;
DROP POLICY IF EXISTS "profiles_select_authenticated" ON profiles;
DROP POLICY IF EXISTS "profiles_select_anon"          ON profiles;
DROP POLICY IF EXISTS "profiles_select_public"        ON profiles;
DROP POLICY IF EXISTS "profiles_update_own"           ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own"           ON profiles;
DROP POLICY IF EXISTS "Allow public read"             ON profiles;
DROP POLICY IF EXISTS "Allow authenticated read"      ON profiles;
DROP POLICY IF EXISTS "Allow user update own profile" ON profiles;
-- Y las nuevas, idempotente:
DROP POLICY IF EXISTS "profiles_anon_published_doctor" ON profiles;
DROP POLICY IF EXISTS "profiles_self_select"           ON profiles;
DROP POLICY IF EXISTS "profiles_admin_select"          ON profiles;
DROP POLICY IF EXISTS "profiles_published_doctor_select" ON profiles;
DROP POLICY IF EXISTS "profiles_clinic_mate_select"    ON profiles;
DROP POLICY IF EXISTS "profiles_clinic_patient_select" ON profiles;
DROP POLICY IF EXISTS "profiles_self_update"           ON profiles;
DROP POLICY IF EXISTS "profiles_self_insert"           ON profiles;

-- Asegurar RLS habilitado
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ─── 2. Column grants ───────────────────────────────────────
-- Anon: solo columnas necesarias para el directorio público
REVOKE ALL ON profiles FROM anon;
GRANT SELECT (id, full_name, avatar_url) ON profiles TO anon;

-- Authenticated: lectura completa (filtrada por RLS) + insert/update
REVOKE ALL ON profiles FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON profiles TO authenticated;

-- service_role no se toca (full access por convención).

-- ─── 3. Policies de SELECT ──────────────────────────────────

-- Anon: solo filas de médicos publicados.
-- Combinado con el grant column-level (id, full_name, avatar_url),
-- esto significa que anon solo ve esas 3 columnas de profiles de
-- médicos que aparecen en el directorio.
CREATE POLICY "profiles_anon_published_doctor" ON profiles
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM doctors d
    WHERE d.profile_id = profiles.id
      AND d.is_published = true
  ));

-- Self: el usuario logueado siempre puede ver su propio profile.
CREATE POLICY "profiles_self_select" ON profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- Admin de plataforma: ve todos.
CREATE POLICY "profiles_admin_select" ON profiles
  FOR SELECT TO authenticated
  USING (is_admin());

-- Médico publicado visible a cualquier authenticated (info de
-- contacto profesional). Riesgo aceptado: un paciente logueado
-- puede leer email/phone de médicos publicados. Para piloto OK;
-- si se quiere restringir más tarde se mueve a una vista pública
-- y se desnormaliza.
CREATE POLICY "profiles_published_doctor_select" ON profiles
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM doctors d
    WHERE d.profile_id = profiles.id
      AND d.is_published = true
  ));

-- Clinic-mate: médico ve a su asistente y viceversa, y ambos ven
-- al owner de la clínica. Cubre /panel/equipo.
CREATE POLICY "profiles_clinic_mate_select" ON profiles
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM clinic_members me
    JOIN clinic_members them ON them.clinic_id = me.clinic_id
    WHERE me.profile_id = auth.uid()
      AND me.is_active = true
      AND them.profile_id = profiles.id
      AND them.is_active = true
  ));

-- Doctor/asistente ve profile vinculado a sus pacientes (cuando
-- el paciente tiene profile_id seteado por haber hecho OTP).
CREATE POLICY "profiles_clinic_patient_select" ON profiles
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM patients p
    JOIN clinic_members cm ON cm.clinic_id = p.clinic_id
    WHERE p.profile_id = profiles.id
      AND cm.profile_id = auth.uid()
      AND cm.is_active = true
  ));

-- ─── 4. Policy de UPDATE — solo self ───────────────────────
-- Admin no edita profiles directamente; usa admin_update_doctor_profile RPC.
CREATE POLICY "profiles_self_update" ON profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ─── 5. Policy de INSERT — solo self ────────────────────────
-- Caso: ensureProfile en flujo OTP cuando el usuario es nuevo
-- (auth.service.ts:128). El INSERT es siempre con id = auth.uid().
CREATE POLICY "profiles_self_insert" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);
