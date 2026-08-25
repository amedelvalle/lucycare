-- ═══════════════════════════════════════════════════════════
-- ROLLBACK de S7-76 — PATIENT-CRM-P0 fundación
-- ═══════════════════════════════════════════════════════════
-- ⚠️ NO EJECUTAR salvo instrucción explícita del owner.
--
-- ── FAIL-CLOSED: SE NIEGA A BORRAR DATOS ──
-- Este rollback SOLO procede si las cuatro tablas del CRM están VACÍAS. Si
-- existe una sola fila —un bloqueo, una etiqueta, un seguimiento o una nota—
-- ABORTA sin borrar nada.
--
-- El motivo es que esa metadata NO TIENE OTRA FUENTE DE VERDAD. Un `DROP`
-- sobre tablas con contenido no es una reversión: es una pérdida. Y a
-- diferencia de una migración de esquema, no hay forma de reconstruirla desde
-- `profiles`, `patients` ni `appointments`.
--
-- ── SI YA HUBO USO REAL ──
-- Revertir después de que el CRM se usó **no es este archivo**. Requiere una
-- estrategia de conservación explícita, decidida por el owner, del tipo:
--   1. exportar las cuatro tablas a un respaldo verificado;
--   2. o migrar la metadata al modelo que la reemplace;
--   3. o renombrar las tablas (`ALTER TABLE ... RENAME TO ..._deprecated`) y
--      dejarlas fuera de servicio sin destruirlas;
-- y recién entonces, con el respaldo comprobado, ejecutar los `DROP`.
-- Ese camino se diseña en su momento; deliberadamente NO se automatiza acá,
-- porque un rollback que borra datos silenciosamente es peor que no tenerlo.
--
-- AUTOSUFICIENTE: se copia entero al SQL Editor y se ejecuta de una vez.
--
-- Ejecutar ANTES el rollback de s7_77 si esa migración está aplicada: sus
-- RPCs y su vista leen estas tablas.
--
-- `profiles`, `patients` y `appointments` NO fueron modificadas por s7_76 y no
-- se tocan. Los índices que s7_76 creó sobre ellas SÍ se eliminan, porque los
-- creó esta migración. `audit_log` se conserva: es inmutable y es la evidencia.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 0. Guardas PRE — la parte que importa ──────────────────
DO $$
DECLARE
  v_crm       bigint;
  v_tags      bigint;
  v_followups bigint;
  v_notes     bigint;
  v_total     bigint;
BEGIN
  IF to_regclass('public.patient_crm') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: s7_76 no parece aplicada';
  END IF;
  IF to_regprocedure('public.admin_list_patients_crm(text,text,int,int)') IS NOT NULL
     OR to_regclass('public.crm_patient_identity') IS NOT NULL THEN
    RAISE EXCEPTION 'PRE fallo: s7_77 sigue aplicada — revertirla primero';
  END IF;

  SELECT count(*) INTO v_crm       FROM public.patient_crm;
  SELECT count(*) INTO v_tags      FROM public.patient_crm_tags;
  SELECT count(*) INTO v_followups FROM public.patient_crm_followups;
  SELECT count(*) INTO v_notes     FROM public.patient_crm_notes;
  v_total := v_crm + v_tags + v_followups + v_notes;

  IF v_total > 0 THEN
    RAISE EXCEPTION
      'ABORTADO: el CRM tiene datos y este rollback NO los destruye. '
      'patient_crm=%, tags=%, followups=%, notas=%. '
      'Revertir después de uso real exige una estrategia de conservación '
      '(respaldo verificado, migración o renombrado de tablas) decidida por el '
      'owner. Ver la cabecera de este archivo.',
      v_crm, v_tags, v_followups, v_notes;
  END IF;

  RAISE NOTICE 'PRE ok: las cuatro tablas del CRM están vacías, la reversión no pierde nada';
END $$;

-- ─── 1. Triggers de auditoría ───────────────────────────────
DROP TRIGGER IF EXISTS audit_patient_crm_notes     ON public.patient_crm_notes;
DROP TRIGGER IF EXISTS audit_patient_crm_followups ON public.patient_crm_followups;
DROP TRIGGER IF EXISTS audit_patient_crm_tags      ON public.patient_crm_tags;
DROP TRIGGER IF EXISTS audit_patient_crm           ON public.patient_crm;

-- ─── 2. Tablas (verificadas vacías arriba) ──────────────────
DROP TABLE IF EXISTS public.patient_crm_notes;
DROP TABLE IF EXISTS public.patient_crm_followups;
DROP TABLE IF EXISTS public.patient_crm_tags;
DROP TABLE IF EXISTS public.patient_crm;

DROP FUNCTION IF EXISTS public.audit_patient_crm();

-- ─── 3. Índices creados por s7_76 sobre tablas preexistentes ─
DROP INDEX IF EXISTS public.idx_patients_profile_id;
DROP INDEX IF EXISTS public.idx_patients_sin_identidad;
DROP INDEX IF EXISTS public.idx_appointments_patient_start;
DROP INDEX IF EXISTS public.idx_appointments_patient_status;
DROP INDEX IF EXISTS public.idx_profiles_full_name_trgm;
DROP INDEX IF EXISTS public.idx_patients_full_name_trgm;

-- ─── 4. Guardas POST ────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.patient_crm') IS NOT NULL
     OR to_regclass('public.patient_crm_tags') IS NOT NULL
     OR to_regclass('public.patient_crm_followups') IS NOT NULL
     OR to_regclass('public.patient_crm_notes') IS NOT NULL THEN
    RAISE EXCEPTION 'POST fallo: alguna tabla del CRM sigue existiendo';
  END IF;
  IF to_regprocedure('public.audit_patient_crm()') IS NOT NULL THEN
    RAISE EXCEPTION 'POST fallo: la función de auditoría sigue existiendo';
  END IF;
  -- Las tablas de negocio siguen intactas.
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.patients') IS NULL
     OR to_regclass('public.appointments') IS NULL THEN
    RAISE EXCEPTION 'POST fallo: se perdió una tabla preexistente (!!)';
  END IF;
END $$;

COMMIT;
