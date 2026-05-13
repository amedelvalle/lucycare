-- ═══════════════════════════════════════════════════════════
-- Migración S5-01: Antecedentes familiares estructurados
-- ═══════════════════════════════════════════════════════════
-- Antes: la consulta tenía solo `family_history_notes` (texto libre).
-- Ahora: catálogo per-doctor + asignación a la consulta con notas por item.
-- Mismo patrón que diagnoses/medications.
--
-- IMPORTANTE: ejecutar en Supabase SQL Editor antes de probar S5 antecedentes.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Catálogo per-doctor ─────────────────────────────────
CREATE TABLE family_history_catalog (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id    uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  is_active    boolean NOT NULL DEFAULT true,
  usage_count  integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_family_history_catalog_doctor ON family_history_catalog(doctor_id, is_active);

-- ─── 2. Join consulta ↔ antecedente ─────────────────────────
CREATE TABLE consultation_family_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id     uuid NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  family_history_id   uuid NOT NULL REFERENCES family_history_catalog(id),
  notes               text,
  UNIQUE(consultation_id, family_history_id)
);

CREATE INDEX idx_cfh_consultation ON consultation_family_history(consultation_id);

-- ─── 3. RLS ─────────────────────────────────────────────────
ALTER TABLE family_history_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultation_family_history ENABLE ROW LEVEL SECURITY;

-- Catálogo: el doctor ve y administra el suyo. Los miembros de la clínica
-- (asistentes) pueden leerlo para asignar antecedentes en consulta.
CREATE POLICY family_history_catalog_select ON family_history_catalog
  FOR SELECT USING (
    doctor_id IN (
      SELECT id FROM doctors WHERE profile_id = auth.uid()
    )
    OR is_clinic_member((SELECT clinic_id FROM doctors WHERE id = doctor_id))
  );

CREATE POLICY family_history_catalog_insert ON family_history_catalog
  FOR INSERT WITH CHECK (
    doctor_id IN (SELECT id FROM doctors WHERE profile_id = auth.uid())
    OR is_clinic_member((SELECT clinic_id FROM doctors WHERE id = doctor_id))
  );

CREATE POLICY family_history_catalog_update ON family_history_catalog
  FOR UPDATE USING (
    doctor_id IN (SELECT id FROM doctors WHERE profile_id = auth.uid())
    OR is_clinic_member((SELECT clinic_id FROM doctors WHERE id = doctor_id))
  );

-- Join: acceso vía la consulta (que ya tiene su propio RLS)
CREATE POLICY cfh_select ON consultation_family_history
  FOR SELECT USING (
    consultation_id IN (
      SELECT id FROM consultations
      WHERE doctor_id IN (SELECT id FROM doctors WHERE profile_id = auth.uid())
        OR is_clinic_member(clinic_id)
    )
  );

CREATE POLICY cfh_insert ON consultation_family_history
  FOR INSERT WITH CHECK (
    consultation_id IN (
      SELECT id FROM consultations
      WHERE doctor_id IN (SELECT id FROM doctors WHERE profile_id = auth.uid())
        OR is_clinic_member(clinic_id)
    )
  );

CREATE POLICY cfh_update ON consultation_family_history
  FOR UPDATE USING (
    consultation_id IN (
      SELECT id FROM consultations
      WHERE doctor_id IN (SELECT id FROM doctors WHERE profile_id = auth.uid())
        OR is_clinic_member(clinic_id)
    )
  );

CREATE POLICY cfh_delete ON consultation_family_history
  FOR DELETE USING (
    consultation_id IN (
      SELECT id FROM consultations
      WHERE doctor_id IN (SELECT id FROM doctors WHERE profile_id = auth.uid())
        OR is_clinic_member(clinic_id)
    )
  );

-- ─── 4. Audit trigger en consultation_family_history ─────────
-- (mismo patrón que las demás, con LOWER(TG_OP) para evitar el bug enum)
CREATE OR REPLACE FUNCTION audit_consultation_family_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'),
    LOWER(TG_OP)::audit_action,
    'consultation_family_history',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('DELETE','UPDATE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_cfh
  AFTER INSERT OR UPDATE OR DELETE ON consultation_family_history
  FOR EACH ROW EXECUTE FUNCTION audit_consultation_family_history();
