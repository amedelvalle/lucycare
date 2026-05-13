-- ═══════════════════════════════════════════════════════════
-- Migración S5-06: Extender enum diagnosis_status
-- ═══════════════════════════════════════════════════════════
-- Razón: el enum actual cubre 5 estados pero el flujo clínico real necesita
-- diferenciar matices que afectan tratamiento (controlado vs descontrolado)
-- y seguimiento (en estudio, en remisión).
--
-- Estados actuales:  activo, resuelto, en_tratamiento, cronico, en_observacion
-- Se agregan:        en_estudio, controlado, descontrolado, en_remision
--
-- Orden clínico narrativo en la UI:
--   Activo → En estudio → En tratamiento → Controlado/Descontrolado
--   → Crónico → En remisión → En observación → Resuelto
-- ═══════════════════════════════════════════════════════════

ALTER TYPE diagnosis_status ADD VALUE IF NOT EXISTS 'en_estudio';
ALTER TYPE diagnosis_status ADD VALUE IF NOT EXISTS 'controlado';
ALTER TYPE diagnosis_status ADD VALUE IF NOT EXISTS 'descontrolado';
ALTER TYPE diagnosis_status ADD VALUE IF NOT EXISTS 'en_remision';

-- Verificación (opcional):
-- SELECT unnest(enum_range(NULL::diagnosis_status));
