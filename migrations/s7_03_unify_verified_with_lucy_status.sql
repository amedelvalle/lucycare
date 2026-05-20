-- ═══════════════════════════════════════════════════════════
-- Migración S7-03: is_verified derivado de lucy_status='verified'
-- ═══════════════════════════════════════════════════════════
-- Decisión 2026-05-20: una sola fuente de verdad para "verificado".
--
-- Semántica final:
--   lucy_status (enum): etapa comercial/onboarding del médico
--     listed_only | claimed | booking_enabled | verified
--   is_verified (DERIVADO): = (lucy_status='verified')
--   is_published: aparece en directorio público (independiente)
--   is_operational: puede operar panel/agenda/atender/firmar (indep.)
--
-- Admin solo edita lucy_status. is_verified se actualiza solo.
-- No más estados contradictorios.
-- ═══════════════════════════════════════════════════════════

-- 1. Backfill seguro: preservar verificaciones históricas en lucy_status
--    (médicos con is_verified=true pero lucy_status<>'verified' suben a 'verified').
UPDATE doctors
SET lucy_status = 'verified'::lucy_status, updated_at = now()
WHERE is_verified = true AND lucy_status <> 'verified';

-- 2. Reemplazar la columna por GENERATED ALWAYS (no editable manualmente)
ALTER TABLE doctors DROP COLUMN is_verified;
ALTER TABLE doctors
  ADD COLUMN is_verified boolean
  GENERATED ALWAYS AS (lucy_status = 'verified') STORED;

-- 3. Eliminar la RPC que editaba is_verified directamente (obsoleta).
DROP FUNCTION IF EXISTS admin_set_doctor_verified(uuid, boolean);

-- 4. Refrescar admin_list_doctors para incluir is_verified (ahora derivado)
--    La función ya hacía SELECT d.is_verified — sigue funcionando porque
--    la columna existe (solo cambió a generada).
