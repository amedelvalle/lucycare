-- ═══════════════════════════════════════════════════════════
-- Migración S7-08: policy de DELETE para services (B3-doctor)
-- ═══════════════════════════════════════════════════════════
-- La tabla services tenía policies de SELECT / INSERT / UPDATE pero
-- NO de DELETE → con RLS activo, ningún borrado era posible (ni el
-- del médico dueño). La pantalla "Mis servicios" del panel necesita
-- que el médico pueda eliminar físicamente un servicio que no tenga
-- citas asociadas.
--
-- Esta migración agrega la policy de DELETE acotada al médico dueño,
-- igual que services_insert / services_update (get_user_doctor_id()).
--
-- La integridad la garantiza el FK appointments.service_id →
-- services(id) (NO ACTION): si el servicio tiene citas, el DELETE
-- falla con SQLSTATE 23503 y la UI ofrece desactivarlo
-- (is_active = false) en su lugar.
--
-- Idempotente (DROP POLICY IF EXISTS). Aditivo, no destructivo.
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS services_delete ON services;

CREATE POLICY services_delete ON services
  FOR DELETE
  USING (doctor_id = get_user_doctor_id());
