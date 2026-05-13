-- ═══════════════════════════════════════════════════════════
-- Migración S5-05: Índices para acelerar catálogos
-- ═══════════════════════════════════════════════════════════
-- Síntoma sin estos índices: queries de catálogo tardan 200-1400ms.
-- Con índices: < 50ms.
--
-- Tipos de índices:
--   1. btree compuesto (doctor_id, usage_count DESC, name) → para
--      el patrón "items del doctor X ordenados por más usados".
--   2. pg_trgm GIN para ILIKE %X% → autocomplete y búsqueda en admin
--      no usan btree con prefijo. Trigram permite búsqueda "contains"
--      sub-50ms incluso con miles de filas.
-- ═══════════════════════════════════════════════════════════

-- Habilitar pg_trgm si aún no está
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Diagnoses ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_diagnoses_doctor_usage
  ON diagnoses(doctor_id, is_active, usage_count DESC, name);

CREATE INDEX IF NOT EXISTS idx_diagnoses_name_trgm
  ON diagnoses USING gin (LOWER(name) gin_trgm_ops);

-- ─── Medications ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_medications_doctor_usage
  ON medications(doctor_id, is_active, usage_count DESC, commercial_name);

CREATE INDEX IF NOT EXISTS idx_medications_commercial_trgm
  ON medications USING gin (LOWER(commercial_name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_medications_ingredient_trgm
  ON medications USING gin (LOWER(active_ingredient) gin_trgm_ops);

-- ─── Family history catalog ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_family_history_doctor_usage
  ON family_history_catalog(doctor_id, is_active, usage_count DESC, name);

CREATE INDEX IF NOT EXISTS idx_family_history_name_trgm
  ON family_history_catalog USING gin (LOWER(name) gin_trgm_ops);

-- Refrescar estadísticas para que el planner use los nuevos índices
ANALYZE diagnoses;
ANALYZE medications;
ANALYZE family_history_catalog;

-- Verificación (opcional):
-- EXPLAIN ANALYZE SELECT * FROM medications
--   WHERE doctor_id = '...' AND is_active = true
--   ORDER BY usage_count DESC, commercial_name LIMIT 50;
-- → debería ver "Index Scan using idx_medications_doctor_usage"
