-- ═══════════════════════════════════════════════════════════
-- Migración S5-02: Extender enum medication_presentation
-- ═══════════════════════════════════════════════════════════
-- Razón: el catálogo de carga inicial trae presentaciones que no estaban
-- en el enum original (sobre y gel).
--
-- Mapeo aplicado en el seed s5_04:
--   Comprimidos             → tableta
--   Cápsulas                → capsula
--   Vial / Ampolla / Pluma  → inyectable
--   Sobre                   → sobre (NUEVO)
--   Aerosol / Inhalador     → inhalador
--   Jarabe                  → jarabe
--   Gotas                   → gotas
--   Crema                   → crema
--   Gel                     → gel (NUEVO)
--   Frasco                  → otro
--
-- IMPORTANTE: ejecutar ANTES del seed de medicamentos.
-- ═══════════════════════════════════════════════════════════

ALTER TYPE medication_presentation ADD VALUE IF NOT EXISTS 'sobre';
ALTER TYPE medication_presentation ADD VALUE IF NOT EXISTS 'gel';

-- Verificación (opcional):
-- SELECT unnest(enum_range(NULL::medication_presentation));
