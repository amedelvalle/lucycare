-- ═══════════════════════════════════════════════════════════
-- ROLLBACK de s7_73 — ADMIN-DOCTOR-SEED-P0
-- ═══════════════════════════════════════════════════════════
-- ⚠️ **NO EJECUTAR.** Se versiona por preparación, igual que el resto de
-- `docs/rollbacks/`. Solo se corre con autorización explícita del owner.
--
-- ── CUÁNDO SIRVE ──
-- Revierte `s7_73` mientras NO se haya creado ningún perfil sembrado. Es el
-- escenario del rollout: migración aplicada, algo falla, se quiere volver
-- atrás antes de usarla.
--
-- ── CUÁNDO **NO** SIRVE ──
-- Si ya existen operaciones `completed`, hay médicos/clínicas/profiles y
-- `auth.users` técnicos creados por el flujo. Este archivo **no los toca**:
-- borrar la tabla de operaciones perdería su trazabilidad, y las identidades
-- técnicas solo se eliminan por **Admin API**, jamás por SQL. En ese caso hay
-- que decidir primero qué hacer con los seeds existentes.
-- La guarda de §1 aborta si detecta operaciones registradas.
--
-- ── ORDEN ──
-- Funciones primero (dependen de la tabla), helper después, tabla al final.
-- `admin_create_seed_doctor` referencia `admin_lookup_seed_user`, y ambos al
-- helper del email: se dropean del consumidor hacia la dependencia.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Guarda: no destruir historial ───────────────────────
DO $$
DECLARE
  v_n bigint;
BEGIN
  IF to_regclass('public.admin_seed_operations') IS NULL THEN
    RAISE NOTICE 's7_73 no está aplicada: nada que revertir.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM public.admin_seed_operations;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'ABORTADO: hay % operaciones registradas. Decidir primero qué hacer con los perfiles sembrados y sus identidades técnicas (Admin API, nunca SQL).', v_n;
  END IF;
END $$;

-- ─── 2. Funciones, del consumidor a la dependencia ──────────
DROP FUNCTION IF EXISTS public.admin_create_seed_doctor(uuid, uuid, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.admin_seed_operation_flag_compensation_failed(uuid, uuid);
DROP FUNCTION IF EXISTS public.admin_seed_operation_mark_failed(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.admin_seed_operation_set_auth_created(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.admin_claim_seed_operation(uuid, text);
DROP FUNCTION IF EXISTS public.admin_lookup_seed_user(uuid);

-- ─── 3. Helper privado ──────────────────────────────────────
DROP FUNCTION IF EXISTS public._seed_doctor_email(uuid);

-- ─── 4. Tabla (con su policy e índice) ──────────────────────
DROP POLICY IF EXISTS seedops_select_admin ON public.admin_seed_operations;
DROP INDEX IF EXISTS public.idx_seedops_requested_by;
DROP TABLE IF EXISTS public.admin_seed_operations;

-- ─── 5. POST: no debe quedar nada ───────────────────────────
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_create_seed_doctor(uuid, uuid, text, jsonb, uuid)',
    'public.admin_seed_operation_flag_compensation_failed(uuid, uuid)',
    'public.admin_seed_operation_mark_failed(uuid, text, uuid)',
    'public.admin_seed_operation_set_auth_created(uuid, uuid, uuid)',
    'public.admin_claim_seed_operation(uuid, text)',
    'public.admin_lookup_seed_user(uuid)',
    'public._seed_doctor_email(uuid)'
  ] LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      RAISE EXCEPTION 'POST del rollback falló: % sigue existiendo', v_fn;
    END IF;
  END LOOP;

  IF to_regclass('public.admin_seed_operations') IS NOT NULL THEN
    RAISE EXCEPTION 'POST del rollback falló: la tabla sigue existiendo';
  END IF;
END $$;

COMMIT;

-- ── LO QUE ESTE ROLLBACK NO TOCA (a propósito) ──
--   • `auth.users` — jamás por SQL. Las identidades técnicas se eliminan con
--     Admin API, identificándolas por `app_metadata.lucy_seed_doctor = true`.
--   • `doctors`, `clinics`, `profiles`, `doctor_credentials` — si se creó
--     algún seed, sus filas son datos de producto, no infraestructura.
--   • `audit_log` — inmutable por diseño desde `s7_71b`.
