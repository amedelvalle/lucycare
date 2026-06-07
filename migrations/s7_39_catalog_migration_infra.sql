-- ═══════════════════════════════════════════════════════════
-- Migración S7-39: infraestructura para de-dup de catálogo base (PR-5a)
-- ═══════════════════════════════════════════════════════════
-- Prepara la migración de datos de PR-5b (mover la base replicada per-médico
-- a catálogo global). NO migra datos — solo crea:
--   1. catalog_migration_map: mapeo old_copy → global, para reversibilidad/audit.
--   2. UNIQUE parcial sobre globales: impide crear dos globales canónicos con la
--      misma clave normalizada (idempotencia del script de PR-5b).
--
-- El script scripts/migrate-catalog-base.mjs (--dry-run | --apply) hace el resto.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Tabla de mapeo / reversibilidad ─────────────────────
CREATE TABLE IF NOT EXISTS catalog_migration_map (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type     text NOT NULL CHECK (item_type IN ('diagnosis','medication')),
  old_id        uuid NOT NULL,         -- copia per-médico inactivada
  old_doctor_id uuid,                  -- médico dueño de la copia
  global_id     uuid NOT NULL,         -- global canónico al que mapea
  migrated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_type, old_id)
);

-- Solo service_role (el script). RLS on + sin policies → authenticated no accede.
ALTER TABLE catalog_migration_map ENABLE ROW LEVEL SECURITY;

-- ─── 2. UNIQUE parcial sobre globales (anti-duplicado canónico) ──
-- Diagnósticos globales: único por nombre normalizado (lower).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_diagnoses_global_name
  ON diagnoses (lower(name))
  WHERE doctor_id IS NULL;

-- Medicamentos globales: único por combo normalizado.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_medications_global_combo
  ON medications (
    lower(commercial_name),
    lower(coalesce(active_ingredient, '')),
    lower(coalesce(concentration, '')),
    coalesce(presentation::text, '')
  )
  WHERE doctor_id IS NULL;

-- ───────────────────────────────────────────────────────────
-- PR-5b: node scripts/migrate-catalog-base.mjs --dry-run  (reporte, sin escribir)
--        node scripts/migrate-catalog-base.mjs --apply    (crea globales +
--          inactiva copias exactas + escribe catalog_migration_map + audit)
-- ───────────────────────────────────────────────────────────
