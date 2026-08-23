-- ═══════════════════════════════════════════════════════════
-- ROLLBACK de S7-74 — SEEDOPS-POLICY-HARDENING
-- ═══════════════════════════════════════════════════════════
-- ⚠️ NO EJECUTAR salvo instrucción explícita del owner.
--
-- Devuelve la policy al estado que dejó `s7_73`, es decir `TO PUBLIC`, que
-- es ESTRICTAMENTE MÁS DÉBIL que el estado posterior a `s7_74`.
--
-- Úsese solo si `s7_74` provocara un efecto inesperado sobre la lectura de
-- `admin_seed_operations` por parte de un admin real. No hay motivo previsto
-- para ello: `authenticated` es un superconjunto de los sujetos que podían
-- superar el `USING (is_admin())`, porque `is_admin()` exige un `auth.uid()`
-- con perfil `role='admin'`, y eso implica estar autenticado.
--
-- No revierte nada más: `s7_74` no toca tabla, RPCs, Auth ni datos.
-- ═══════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.admin_seed_operations') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: admin_seed_operations no existe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.admin_seed_operations'::regclass
       AND polname  = 'seedops_select_admin'
  ) THEN
    RAISE EXCEPTION 'PRE fallo: no existe la policy seedops_select_admin';
  END IF;
END $$;

ALTER POLICY seedops_select_admin
  ON public.admin_seed_operations
  TO public;

DO $$
DECLARE
  v_roles oid[];
BEGIN
  SELECT polroles INTO v_roles
    FROM pg_policy
   WHERE polrelid = 'public.admin_seed_operations'::regclass
     AND polname  = 'seedops_select_admin';
  IF v_roles <> ARRAY[0::oid] THEN
    RAISE EXCEPTION 'POST fallo: la policy no volvio a TO public';
  END IF;
END $$;

COMMIT;
