-- ═══════════════════════════════════════════════════════════
-- Migración S7-38: catálogo global + personal (Catálogos PR-2)
-- ═══════════════════════════════════════════════════════════
-- Hoy `diagnoses`/`medications` son 100% per-médico (`doctor_id` NOT NULL) y el
-- "base" está replicado por médico. Esta migración habilita un catálogo GLOBAL
-- compartido (curado por LucyAdmin) que convive con el personal de cada médico.
--
-- Decisiones (owner, ver docs/ANALISIS_CATALOGOS_PERSONALIZADOS.md):
--   • Global = `doctor_id IS NULL`; personal = `doctor_id = <médico>`.
--   • Lista efectiva del médico = globales (activos, no ocultos) + propios.
--   • Globales: READ-ONLY para médicos; solo LucyAdmin (is_admin) los administra.
--   • Médico escribe SOLO sus propios. Asistente (no-médico): sin escritura.
--   • Ocultar un global = preferencia por médico (tabla doctor_catalog_hidden);
--     solo afecta su vista (el filtrado de ocultos vive en la query/efectiva).
--   • Nunca hard-delete (solo is_active=false). El snapshot de s7_37 ya protege
--     históricos aunque cambie el catálogo.
--
-- NOTA: el RLS base de estas tablas vive en el schema inicial (no en migrations/).
-- Para un estado final determinista, esta migración DROPea TODAS las policies
-- existentes de ambas tablas y recrea el set completo.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Permitir ítems globales (doctor_id NULL) ────────────
ALTER TABLE diagnoses   ALTER COLUMN doctor_id DROP NOT NULL;
ALTER TABLE medications ALTER COLUMN doctor_id DROP NOT NULL;

-- Índice para lecturas de globales.
CREATE INDEX IF NOT EXISTS idx_diagnoses_global
  ON diagnoses(is_active, name) WHERE doctor_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_medications_global
  ON medications(is_active, commercial_name) WHERE doctor_id IS NULL;

-- ─── 2. Tabla de ocultos por médico ─────────────────────────
CREATE TABLE IF NOT EXISTS doctor_catalog_hidden (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id  uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  item_type  text NOT NULL CHECK (item_type IN ('diagnosis','medication')),
  item_id    uuid NOT NULL,          -- ítem GLOBAL ocultado (sin FK: apunta a diagnoses|medications)
  hidden_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, item_type, item_id)
);

ALTER TABLE doctor_catalog_hidden ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dch_select ON doctor_catalog_hidden;
CREATE POLICY dch_select ON doctor_catalog_hidden
  FOR SELECT TO authenticated
  USING (doctor_id = get_user_doctor_id() OR is_admin());

DROP POLICY IF EXISTS dch_insert ON doctor_catalog_hidden;
CREATE POLICY dch_insert ON doctor_catalog_hidden
  FOR INSERT TO authenticated
  WITH CHECK (doctor_id = get_user_doctor_id());

DROP POLICY IF EXISTS dch_delete ON doctor_catalog_hidden;
CREATE POLICY dch_delete ON doctor_catalog_hidden
  FOR DELETE TO authenticated
  USING (doctor_id = get_user_doctor_id());

GRANT SELECT, INSERT, DELETE ON doctor_catalog_hidden TO authenticated;

-- ─── 3. RLS de diagnoses/medications: global∪propios / escritura propios ──
-- Drop determinista de todas las policies actuales de ambas tablas.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename IN ('diagnoses','medications')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE diagnoses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications ENABLE ROW LEVEL SECURITY;

-- diagnoses ──────────────────────────────────────────────────
CREATE POLICY diagnoses_select_own    ON diagnoses FOR SELECT TO authenticated
  USING (doctor_id = get_user_doctor_id());
CREATE POLICY diagnoses_select_global ON diagnoses FOR SELECT TO authenticated
  USING (doctor_id IS NULL);
CREATE POLICY diagnoses_select_admin  ON diagnoses FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY diagnoses_insert_own    ON diagnoses FOR INSERT TO authenticated
  WITH CHECK (doctor_id IS NOT NULL AND doctor_id = get_user_doctor_id());
CREATE POLICY diagnoses_insert_admin  ON diagnoses FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY diagnoses_update_own    ON diagnoses FOR UPDATE TO authenticated
  USING (doctor_id = get_user_doctor_id())
  WITH CHECK (doctor_id = get_user_doctor_id());
CREATE POLICY diagnoses_update_admin  ON diagnoses FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- medications ────────────────────────────────────────────────
CREATE POLICY medications_select_own    ON medications FOR SELECT TO authenticated
  USING (doctor_id = get_user_doctor_id());
CREATE POLICY medications_select_global ON medications FOR SELECT TO authenticated
  USING (doctor_id IS NULL);
CREATE POLICY medications_select_admin  ON medications FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY medications_insert_own    ON medications FOR INSERT TO authenticated
  WITH CHECK (doctor_id IS NOT NULL AND doctor_id = get_user_doctor_id());
CREATE POLICY medications_insert_admin  ON medications FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY medications_update_own    ON medications FOR UPDATE TO authenticated
  USING (doctor_id = get_user_doctor_id())
  WITH CHECK (doctor_id = get_user_doctor_id());
CREATE POLICY medications_update_admin  ON medications FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Nota: sin policy DELETE para authenticated → no hard-delete (solo is_active).

-- ─── 4. Auditoría de catálogos ──────────────────────────────
-- Genérica para ambas tablas. Ignora updates que SOLO tocan usage_count
-- (incremento de uso) para no inundar audit_log.
CREATE OR REPLACE FUNCTION audit_catalog()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(OLD) - 'usage_count') = (to_jsonb(NEW) - 'usage_count') THEN
    RETURN NEW;  -- solo cambió usage_count → no auditar
  END IF;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'),
    LOWER(TG_OP)::audit_action,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_diagnoses ON diagnoses;
CREATE TRIGGER trg_audit_diagnoses
  AFTER INSERT OR UPDATE OR DELETE ON diagnoses
  FOR EACH ROW EXECUTE FUNCTION audit_catalog();

DROP TRIGGER IF EXISTS trg_audit_medications ON medications;
CREATE TRIGGER trg_audit_medications
  AFTER INSERT OR UPDATE OR DELETE ON medications
  FOR EACH ROW EXECUTE FUNCTION audit_catalog();

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_38.mjs + node scripts/_smoke-s7_38.mjs
-- ───────────────────────────────────────────────────────────
