-- ═══════════════════════════════════════════════════════════
-- Migración S7-10: patients.document_number nullable
-- ═══════════════════════════════════════════════════════════
-- Los pacientes walk-in y los creados por el booking público no
-- tienen documento al momento de crearse. El código insertaba el
-- placeholder document_number='PENDIENTE' para todos, lo que chocaba
-- contra UNIQUE(clinic_id, document_type, document_number): solo se
-- podía crear UN paciente sin documento por clínica; el segundo
-- fallaba con "duplicate key value violates unique constraint".
--
-- FIX: permitir document_number NULL. Postgres trata los NULL como
-- distintos en el índice UNIQUE (NULLS DISTINCT, default), así que
-- varios pacientes sin documento conviven sin colisión, y el UNIQUE
-- sigue protegiendo los documentos reales.
--
-- Backfill: los placeholders 'PENDIENTE' existentes pasan a NULL.
-- Aditivo y no destructivo (relaja una constraint NOT NULL).
-- ═══════════════════════════════════════════════════════════

ALTER TABLE patients ALTER COLUMN document_number DROP NOT NULL;

UPDATE patients SET document_number = NULL WHERE document_number = 'PENDIENTE';
