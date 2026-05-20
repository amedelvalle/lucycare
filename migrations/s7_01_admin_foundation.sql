-- ═══════════════════════════════════════════════════════════
-- Migración S7-01: Cimientos Admin SaaS (Fase A)
-- ═══════════════════════════════════════════════════════════
-- Admin = admin PLATAFORMA (dueño de LucyCare), no admin clínica.
-- Single-tenant MVP, diseño tenant-ready (sin organization_id aún).
--
--   1. is_admin()  — reusable en políticas RLS futuras (fases B+)
--   2. admin_platform_stats — vista agregada (sin PII, sin contenido
--      clínico: solo conteos/volúmenes)
--   3. get_platform_stats() — RPC SECURITY DEFINER gateada por is_admin()
--
-- Bootstrap del primer admin (manual, documentado):
--   UPDATE profiles SET role='admin' WHERE phone='<tel>';
-- ═══════════════════════════════════════════════════════════

-- ─── 1. is_admin() ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

-- ─── 2. Vista agregada de plataforma (sin PII / sin clínico) ─
CREATE OR REPLACE VIEW admin_platform_stats AS
SELECT
  (SELECT count(*) FROM doctors)                                          AS doctors_total,
  (SELECT count(*) FROM doctors WHERE is_published)                       AS doctors_published,
  (SELECT count(*) FROM doctors WHERE is_verified)                        AS doctors_verified,
  (SELECT count(*) FROM patients)                                         AS patients_total,
  (SELECT count(*) FROM clinic_members
     WHERE role = 'assistant' AND is_active)                              AS assistants_active,
  (SELECT count(*) FROM appointments)                                     AS appointments_total,
  (SELECT count(*) FROM appointments a
     JOIN appointment_statuses s ON s.id = a.status_id
     WHERE s.name = 'atendida')                                           AS appointments_attended,
  (SELECT count(*) FROM consultations WHERE status = 'signed')            AS consultations_signed,
  (SELECT count(*) FROM reviews WHERE is_visible)                         AS reviews_total,
  (SELECT round(avg(rating), 2) FROM reviews WHERE is_visible)            AS reviews_avg_score;

-- Sin GRANT a anon/authenticated: solo service_role / vía RPC.
REVOKE ALL ON admin_platform_stats FROM anon, authenticated;

-- ─── 3. RPC gateada por is_admin() ──────────────────────────
CREATE OR REPLACE FUNCTION get_platform_stats()
RETURNS admin_platform_stats
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result admin_platform_stats;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol admin';
  END IF;

  SELECT * INTO result FROM admin_platform_stats;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_platform_stats() TO authenticated;
