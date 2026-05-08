-- ═══════════════════════════════════════════════════════════
-- Migración S4-01: vitals.weight_lb → vitals.weight_kg
-- ═══════════════════════════════════════════════════════════
-- Razón: estándar médico internacional usa kg, no lb. La columna
-- `weight_lb` ya existe pero contradice la práctica clínica.
--
-- Estrategia segura:
--   1. Renombra la columna a weight_kg.
--   2. Convierte cualquier valor existente de libras a kg
--      (libras / 2.2046 = kg). Si la tabla está vacía, no-op.
--
-- IMPORTANTE: ejecuta este script ANTES de empezar a usar el
-- panel de consulta clínica (Sprint 4). Después de ejecutar,
-- la app debe usar `weight_kg` (ya actualizado en types).
-- ═══════════════════════════════════════════════════════════

ALTER TABLE vitals RENAME COLUMN weight_lb TO weight_kg;

-- Convertir valores existentes (lb → kg). Solo afecta filas con peso registrado.
UPDATE vitals
SET weight_kg = ROUND((weight_kg / 2.2046)::numeric, 2)
WHERE weight_kg IS NOT NULL;

-- Verificación rápida (opcional, ejecutar manualmente):
-- SELECT id, weight_kg, height_cm, bmi FROM vitals LIMIT 5;
