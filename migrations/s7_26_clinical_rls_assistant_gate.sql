-- ═══════════════════════════════════════════════════════════
-- Migración S7-26: gate clínico del rol asistente (Fase 0)
-- ═══════════════════════════════════════════════════════════
-- Cierra las fugas clínicas detectadas en el diagnóstico de la deuda #1.
--
-- Contexto (RLS auditado el 2026-06-01):
--   • consultations / prescriptions / consultation_diagnoses YA estaban
--     bien: se gatean con `doctor_id = get_user_doctor_id()`, que es NULL
--     para un asistente (no tiene fila en `doctors`) → asistente bloqueado
--     de leer/crear/editar/FIRMAR. No se tocan acá.
--   • consultation_family_history y vitals usaban `is_clinic_member(...)`,
--     que devuelve true para CUALQUIER miembro activo (incluido
--     'assistant') → un asistente podía leer y escribir antecedentes
--     familiares y signos vitales. ESA es la fuga.
--
-- Decisión del owner (2026-06-01): el rol `assistant` es
-- administrativo/no-clínico. Bloqueo TOTAL (lectura + escritura) de
-- consultation_family_history y vitals para asistentes; quedan
-- doctor-scoped igual que el resto del contenido clínico. Si en el
-- futuro se necesita enfermería que registre signos vitales, será un
-- rol nuevo y explícito, no una ampliación de `assistant`.
--
-- Patrón aplicado (mismo que consultation_diagnoses):
--   escritura/lectura permitida solo si la consulta/cita pertenece al
--   médico actual (`doctor_id = get_user_doctor_id()`).
--
-- NO incluye (follow-up aparte): inmutabilidad por RLS de consultas
-- firmadas (los UPDATE de consultations/prescriptions/diagnoses no
-- chequean signed_at IS NULL). Es un tema distinto del gate de
-- asistente y tocar el UPDATE de consultations mal hecho rompería la
-- propia transición de firma → se analiza por separado.
--
-- Solo RLS (DROP POLICY + CREATE POLICY). Idempotente. Sin cambios de
-- esquema. service_role sigue bypaseando RLS (scripts admin).
-- ═══════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- (A) consultation_family_history → doctor-scoped (quita is_clinic_member)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS cfh_select ON consultation_family_history;
CREATE POLICY cfh_select ON consultation_family_history
  FOR SELECT USING (
    consultation_id IN (
      SELECT c.id FROM consultations c WHERE c.doctor_id = get_user_doctor_id()
    )
  );

DROP POLICY IF EXISTS cfh_insert ON consultation_family_history;
CREATE POLICY cfh_insert ON consultation_family_history
  FOR INSERT WITH CHECK (
    consultation_id IN (
      SELECT c.id FROM consultations c WHERE c.doctor_id = get_user_doctor_id()
    )
  );

DROP POLICY IF EXISTS cfh_update ON consultation_family_history;
CREATE POLICY cfh_update ON consultation_family_history
  FOR UPDATE USING (
    consultation_id IN (
      SELECT c.id FROM consultations c WHERE c.doctor_id = get_user_doctor_id()
    )
  );

DROP POLICY IF EXISTS cfh_delete ON consultation_family_history;
CREATE POLICY cfh_delete ON consultation_family_history
  FOR DELETE USING (
    consultation_id IN (
      SELECT c.id FROM consultations c
      WHERE c.doctor_id = get_user_doctor_id() AND c.signed_at IS NULL
    )
  );

-- ─────────────────────────────────────────────────────────────
-- (B) vitals → doctor-scoped (quita is_clinic_member)
--     vitals se gatea por la cita: solo el médico dueño de la cita.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS vitals_select ON vitals;
CREATE POLICY vitals_select ON vitals
  FOR SELECT USING (
    appointment_id IN (
      SELECT a.id FROM appointments a WHERE a.doctor_id = get_user_doctor_id()
    )
  );

DROP POLICY IF EXISTS vitals_insert ON vitals;
CREATE POLICY vitals_insert ON vitals
  FOR INSERT WITH CHECK (
    appointment_id IN (
      SELECT a.id FROM appointments a WHERE a.doctor_id = get_user_doctor_id()
    )
  );

DROP POLICY IF EXISTS vitals_update ON vitals;
CREATE POLICY vitals_update ON vitals
  FOR UPDATE USING (
    appointment_id IN (
      SELECT a.id FROM appointments a WHERE a.doctor_id = get_user_doctor_id()
    )
  );
