-- ═══════════════════════════════════════════════════════════
-- Migración S7-37: snapshot histórico de catálogo en receta/diagnóstico
-- (Catálogos personalizados — PR-1: integridad histórica)
-- ═══════════════════════════════════════════════════════════
-- Hoy `prescriptions.medication_id` y `consultation_diagnoses.diagnosis_id`
-- son FK al catálogo per-médico y el NOMBRE se resuelve por JOIN al LEER.
-- → Si el médico edita el nombre de un ítem del catálogo, cambia cómo se ve
--   una receta/consulta HISTÓRICA, incluida una consulta FIRMADA (s7_28).
--
-- Decisión (owner): SNAPSHOT de texto en campos SEPARADOS. La receta/dx
-- histórica se muestra/imprime desde el snapshot; el FK se conserva para
-- trazabilidad/búsqueda/usage_count, pero no es la fuente visual histórica.
--
-- Cómo se llena (TODAS las rutas de inserción, sin tocar cada call site):
--   triggers BEFORE INSERT que copian los campos del catálogo por el FK.
--   Cubre: guardado normal de receta/dx Y las RPC de corrección
--   (amend_consultation, s7_31, que insertan versiones nuevas).
--   Las funciones son SECURITY DEFINER para leer el catálogo sin depender
--   del RLS del invocador.
--
-- Inmutabilidad: una vez insertada la línea, el snapshot NO se re-sincroniza
-- (no hay trigger en UPDATE del catálogo) → queda congelado. La inmutabilidad
-- de s7_28 es por RLS (no hay trigger bloqueante), así que el BACKFILL de
-- abajo, corrido como owner de la migración, actualiza filas históricas
-- (incl. firmadas) sin chocar con nada.
--
-- Nunca hard-delete del catálogo (solo is_active=false) → el FK histórico
-- nunca queda colgado; y aunque colgara, el snapshot ya preserva el texto.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Columnas de snapshot ────────────────────────────────
ALTER TABLE prescriptions
  ADD COLUMN IF NOT EXISTS medication_name_snapshot   text,
  ADD COLUMN IF NOT EXISTS active_ingredient_snapshot text,
  ADD COLUMN IF NOT EXISTS concentration_snapshot     text,
  ADD COLUMN IF NOT EXISTS presentation_snapshot      text;

ALTER TABLE consultation_diagnoses
  ADD COLUMN IF NOT EXISTS diagnosis_name_snapshot text;

-- ─── 2. Trigger: llenar snapshot de receta desde el catálogo ──
CREATE OR REPLACE FUNCTION fill_prescription_snapshot()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.medication_id IS NOT NULL THEN
    SELECT m.commercial_name, m.active_ingredient, m.concentration, m.presentation::text
      INTO NEW.medication_name_snapshot, NEW.active_ingredient_snapshot,
           NEW.concentration_snapshot, NEW.presentation_snapshot
      FROM medications m
     WHERE m.id = NEW.medication_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_prescription_snapshot ON prescriptions;
CREATE TRIGGER trg_fill_prescription_snapshot
  BEFORE INSERT ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION fill_prescription_snapshot();

-- ─── 3. Trigger: llenar snapshot de diagnóstico desde el catálogo ──
CREATE OR REPLACE FUNCTION fill_consultation_diagnosis_snapshot()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.diagnosis_id IS NOT NULL THEN
    SELECT d.name INTO NEW.diagnosis_name_snapshot
      FROM diagnoses d
     WHERE d.id = NEW.diagnosis_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_consultation_diagnosis_snapshot ON consultation_diagnoses;
CREATE TRIGGER trg_fill_consultation_diagnosis_snapshot
  BEFORE INSERT ON consultation_diagnoses
  FOR EACH ROW EXECUTE FUNCTION fill_consultation_diagnosis_snapshot();

-- ─── 4. Backfill de datos existentes ────────────────────────
-- Corre como owner de la migración → bypassa el RLS endurecido de s7_28
-- (no hay trigger bloqueante de UPDATE), así que actualiza también filas de
-- consultas firmadas. Solo rellena donde el snapshot está NULL.
UPDATE prescriptions p
   SET medication_name_snapshot   = m.commercial_name,
       active_ingredient_snapshot = m.active_ingredient,
       concentration_snapshot     = m.concentration,
       presentation_snapshot      = m.presentation::text
  FROM medications m
 WHERE m.id = p.medication_id
   AND p.medication_name_snapshot IS NULL;

UPDATE consultation_diagnoses cd
   SET diagnosis_name_snapshot = d.name
  FROM diagnoses d
 WHERE d.id = cd.diagnosis_id
   AND cd.diagnosis_name_snapshot IS NULL;

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_37.mjs + node scripts/_smoke-s7_37.mjs
-- ───────────────────────────────────────────────────────────
