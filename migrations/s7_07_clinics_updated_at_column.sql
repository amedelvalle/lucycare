-- ═══════════════════════════════════════════════════════════
-- Migración S7-07: clinics.updated_at — columna faltante (causa raíz)
-- ═══════════════════════════════════════════════════════════
-- BUG raíz (más profundo que s7_06): el schema base define el trigger
-- trg_clinics_updated_at (BEFORE UPDATE ON clinics → update_updated_at(),
-- que hace `NEW.updated_at = now()`), pero la tabla clinics nunca tuvo
-- la columna updated_at. Todas las tablas hermanas (profiles, doctors,
-- patients, appointments, consultations) tienen columna + trigger;
-- clinics quedó con el trigger pero sin la columna.
--
-- Síntoma: cualquier UPDATE sobre clinics falla con
--   record "new" has no field "updated_at"
-- (el trigger BEFORE UPDATE no encuentra el campo en NEW).
--
-- FIX: agregar la columna faltante. Aditivo y no destructivo; alinea
-- clinics con el resto del schema. El trigger trg_clinics_updated_at
-- ya existente pasa a funcionar y mantiene updated_at automáticamente.
--
-- Las filas existentes toman now() (momento de la migración). Aceptable:
-- ~113 clínicas piloto que nunca se habían editado; nada lee el valor
-- histórico de clinics.updated_at.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
