-- ═══════════════════════════════════════════════════════════
-- Migración S6-09: Trazabilidad admin de reputación (Fase F)
-- ═══════════════════════════════════════════════════════════
-- Decisión de producto: en Sprint 6 la trazabilidad es SOLO vía
-- SQL/Supabase (la UI admin completa llega en Sprint 7/8).
--
-- `reviews` tiene RLS bloqueada. El admin opera con service_role,
-- que la bypasea, así que YA puede trazar todo. Esta migración solo
-- agrega una vista de conveniencia que cruza la reseña con paciente,
-- cita y médico — una sola consulta para auditoría interna.
--
-- Seguridad: la vista NO se otorga a anon/authenticated. Sin GRANT,
-- solo roles privilegiados (postgres / service_role en Supabase)
-- pueden leerla. NO se expone públicamente.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW admin_review_traceability AS
SELECT
  r.id                         AS review_id,
  r.submitted_at,
  r.rating,
  r.rating_punctuality,
  r.rating_treatment,
  r.rating_clarity,
  r.rating_listening,
  r.rating_confidence,
  r.rating_satisfaction,
  r.nps,
  r.comment,
  r.is_visible,
  r.appointment_id,
  ap.start_time                AS appointment_start,
  r.doctor_id,
  docp.full_name               AS doctor_name,
  r.patient_profile_id,
  pat.id                       AS patient_id,
  pat.full_name                AS patient_name,
  pat.phone                    AS patient_phone,
  rt.token                     AS review_token,
  rt.used_at                   AS token_used_at,
  rt.expires_at                AS token_expires_at
FROM reviews r
LEFT JOIN appointments ap   ON ap.id = r.appointment_id
LEFT JOIN patients pat      ON pat.id = ap.patient_id
LEFT JOIN doctors doc       ON doc.id = r.doctor_id
LEFT JOIN profiles docp     ON docp.id = doc.profile_id
LEFT JOIN review_tokens rt  ON rt.appointment_id = r.appointment_id
ORDER BY r.submitted_at DESC NULLS LAST;

-- Sin GRANT a anon/authenticated: solo service_role/postgres la leen.
REVOKE ALL ON admin_review_traceability FROM anon, authenticated;

COMMENT ON VIEW admin_review_traceability IS
  'Auditoría interna de reputación (Sprint 6, solo SQL). Cruza review '
  '↔ cita ↔ paciente ↔ médico ↔ token. NO exponer públicamente; la '
  'UI admin se construye en Sprint 7/8.';
