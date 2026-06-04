-- ═══════════════════════════════════════════════════════════
-- Migración S7-32: Paciente Global Fase 2 (F2.1 backend) —
-- identidad global del paciente en `profiles`
-- ═══════════════════════════════════════════════════════════
-- Agrega a `profiles` los datos de identidad global del paciente (DUI/DOB/
-- género/depto/muni), con DUI progresivo (todo nullable), documento único
-- parcial, coherencia muni-depto, auditoría, y CIERRA un hueco de seguridad:
-- el GRANT UPDATE amplio sobre profiles (s7_16) permitía a un `authenticated`
-- cambiar su propio `role`/`is_active`/`phone` (escalada). Se restringe por
-- columnas.
--
-- Capas (no se mezclan): profiles = identidad global; patients = ficha local
-- por clínica (conserva su documento local/histórico, NO se toca acá);
-- expediente clínico = citas/consultas/recetas/vitales (sin cambios).
--
-- Privacidad: las columnas nuevas NO se otorgan a `anon` (su grant sigue
-- siendo solo id/full_name/avatar_url, s7_16) → anon nunca ve DUI/DOB.
-- `authenticated` ya tiene SELECT de todas las columnas + policies self/admin/
-- médico-de-su-clínica (s7_16) → el paciente ve lo suyo; el médico lee la
-- identidad del paciente de su clínica (base de Fase 3 read-only) pero NO la
-- edita (no hay policy de UPDATE para el médico; el UPDATE es self-only).
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Columnas de identidad global ────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS document_type   text,
  ADD COLUMN IF NOT EXISTS document_number text,
  ADD COLUMN IF NOT EXISTS date_of_birth   date,
  ADD COLUMN IF NOT EXISTS gender          gender_type,
  ADD COLUMN IF NOT EXISTS department_id   text REFERENCES departments(id),
  ADD COLUMN IF NOT EXISTS municipality_id text REFERENCES municipalities(id);

-- ─── 2. document_type: text con CHECK (no enum duro) ────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_document_type_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_document_type_check
  CHECK (document_type IS NULL OR document_type IN
    ('dui', 'pasaporte', 'carnet_residente', 'partida_nacimiento'));

-- ─── 3. Regla: si hay document_number, debe haber document_type ──
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_document_pair_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_document_pair_check
  CHECK (document_number IS NULL OR document_type IS NOT NULL);

-- ─── 4. Documento único parcial (cuando hay número) ─────────
-- El número se guarda CANÓNICO desde el cliente (validateDocument): DUI →
-- '00000000-0'. El UNIQUE opera sobre (type, número canónico). profiles hoy
-- no tiene documentos → el índice nace sin violaciones (diagnóstico read-only
-- 2026-06-04: 0 duplicados en patients). Un choque al poblar = identidad
-- duplicada → caso de merge (Fase 4), se rechaza con mensaje amable en UI.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_document_unique
  ON profiles (document_type, document_number)
  WHERE document_number IS NOT NULL;

-- ─── 5. Coherencia municipio ⊂ departamento (server-side) ───
CREATE OR REPLACE FUNCTION profiles_location_coherence()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.municipality_id IS NOT NULL THEN
    IF NEW.department_id IS NULL THEN
      RAISE EXCEPTION 'El municipio requiere un departamento' USING ERRCODE = 'P0004';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM municipalities
       WHERE id = NEW.municipality_id AND department_id = NEW.department_id
    ) THEN
      RAISE EXCEPTION 'El municipio no pertenece al departamento indicado' USING ERRCODE = 'P0004';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_location_coherence_trg ON profiles;
CREATE TRIGGER profiles_location_coherence_trg
  BEFORE INSERT OR UPDATE OF department_id, municipality_id ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_location_coherence();

-- ─── 6. Cerrar el GRANT UPDATE amplio → por columnas ────────
-- s7_16 hizo GRANT SELECT, INSERT, UPDATE (todas las columnas). El UPDATE
-- amplio dejaba a un paciente cambiar su propio role/is_active/phone. Lo
-- restringimos a las columnas que el paciente SÍ puede editar de su identidad.
-- (SELECT e INSERT de s7_16 se conservan.)
--   - Excluidos a propósito: role, is_active (privilegios) y phone (base del
--     claim-by-phone; su cambio va por flujo OTP controlado, futuro).
--   - El flujo legacy doctorRegistration (update directo con role='doctor',
--     @deprecated/neutralizado en #53) queda además bloqueado a nivel DB.
REVOKE UPDATE ON profiles FROM authenticated;
GRANT UPDATE (
  full_name, avatar_url, email, updated_at,
  document_type, document_number, date_of_birth, gender,
  department_id, municipality_id
) ON profiles TO authenticated;

-- ─── 7. Auditoría de cambios de identidad global ────────────
CREATE OR REPLACE FUNCTION audit_profiles_identity_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
BEGIN
  IF OLD.full_name       IS DISTINCT FROM NEW.full_name       THEN v_old := v_old || jsonb_build_object('full_name', OLD.full_name);             v_new := v_new || jsonb_build_object('full_name', NEW.full_name); END IF;
  IF OLD.document_type   IS DISTINCT FROM NEW.document_type   THEN v_old := v_old || jsonb_build_object('document_type', OLD.document_type);     v_new := v_new || jsonb_build_object('document_type', NEW.document_type); END IF;
  IF OLD.document_number IS DISTINCT FROM NEW.document_number THEN v_old := v_old || jsonb_build_object('document_number', OLD.document_number); v_new := v_new || jsonb_build_object('document_number', NEW.document_number); END IF;
  IF OLD.date_of_birth   IS DISTINCT FROM NEW.date_of_birth   THEN v_old := v_old || jsonb_build_object('date_of_birth', OLD.date_of_birth);     v_new := v_new || jsonb_build_object('date_of_birth', NEW.date_of_birth); END IF;
  IF OLD.gender          IS DISTINCT FROM NEW.gender          THEN v_old := v_old || jsonb_build_object('gender', OLD.gender);                   v_new := v_new || jsonb_build_object('gender', NEW.gender); END IF;
  IF OLD.department_id   IS DISTINCT FROM NEW.department_id   THEN v_old := v_old || jsonb_build_object('department_id', OLD.department_id);     v_new := v_new || jsonb_build_object('department_id', NEW.department_id); END IF;
  IF OLD.municipality_id IS DISTINCT FROM NEW.municipality_id THEN v_old := v_old || jsonb_build_object('municipality_id', OLD.municipality_id); v_new := v_new || jsonb_build_object('municipality_id', NEW.municipality_id); END IF;

  IF v_new <> '{}'::jsonb THEN
    INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      auth.uid(), 'update'::audit_action, 'profiles', NEW.id,
      v_old, v_new || jsonb_build_object('edited_via', 'profile_identity')
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_profiles_identity ON profiles;
CREATE TRIGGER audit_profiles_identity
  AFTER UPDATE OF full_name, document_type, document_number, date_of_birth, gender, department_id, municipality_id ON profiles
  FOR EACH ROW EXECUTE FUNCTION audit_profiles_identity_fn();
