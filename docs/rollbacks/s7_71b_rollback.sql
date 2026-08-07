-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK DE s7_71b — audit_log hardening
-- ═══════════════════════════════════════════════════════════════════
--
-- ⛔ SOLO EMERGENCIA. EJECUTARLO REABRE LA VULNERABILIDAD.
--
-- Devuelve `audit_log` al estado EXACTO medido en la Fase A de AUDIT-SEC-P0,
-- es decir: cualquiera con la clave `anon` —que es pública y viaja en el
-- bundle— vuelve a poder insertar filas de auditoría arbitrarias, atribuidas a
-- cualquier uuid y fechadas a voluntad, en el registro de un sistema clínico.
-- También reabre `TRUNCATE` (que NO está sujeto a RLS) y la invocación directa
-- de `_admin_log_doctor_change`.
--
-- NO ES UNA REVERSIÓN DE DATOS: el forward no borra ni modifica ninguna fila.
-- Solo revierte privilegios y la policy.
--
-- ── POR QUÉ VIVE FUERA DE migrations/ ──
-- Igual que `s7_71a_rollback.sql`: dentro del namespace de migraciones
-- ordenaría inmediatamente después de su forward, y quien aplicara «las
-- pendientes en orden» desharía el cierre sin ningún error visible.
--
-- ── ESTADO QUE RESTAURA (medido en Fase A, 2026-08-07) ──
--   audit_log ACL          : anon/authenticated/service_role = arwdDxtm (ALL)
--   audit_log_id_seq ACL   : anon/authenticated/service_role = rwU
--   policy                 : audit_log_insert_only, PERMISSIVE, INSERT,
--                            roles={public}, WITH CHECK true
--   _admin_log_doctor_change: EXECUTE para PUBLIC + los tres roles
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Privilegios de tabla (ALL = arwdDxtm)
GRANT ALL ON TABLE public.audit_log TO anon;
GRANT ALL ON TABLE public.audit_log TO authenticated;
GRANT ALL ON TABLE public.audit_log TO service_role;

-- 2. Privilegios de secuencia (ALL = rwU)
GRANT ALL ON SEQUENCE public.audit_log_id_seq TO anon;
GRANT ALL ON SEQUENCE public.audit_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.audit_log_id_seq TO service_role;

-- 3. La policy permisiva que permitía el INSERT arbitrario
CREATE POLICY audit_log_insert_only ON public.audit_log
  AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);

-- 4. El helper vuelve a ser superficie invocable
GRANT EXECUTE ON FUNCTION public._admin_log_doctor_change(uuid,text,jsonb,jsonb) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public._admin_log_doctor_change(uuid,text,jsonb,jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public._admin_log_doctor_change(uuid,text,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public._admin_log_doctor_change(uuid,text,jsonb,jsonb) TO service_role;

COMMIT;

-- Fuera de la transacción: refrescar el caché de esquema de PostgREST
NOTIFY pgrst, 'reload schema';
