-- ═══════════════════════════════════════════════════════════
-- ROLLBACK de S7-77 — PATIENT-CRM-P0 RPCs de lectura
-- ═══════════════════════════════════════════════════════════
-- ⚠️ NO EJECUTAR salvo instrucción explícita del owner.
--
-- AUTOSUFICIENTE: se copia entero al SQL Editor y se ejecuta de una vez.
--
-- NO destructivo para los datos: estas funciones son de SOLO LECTURA, así que
-- eliminarlas no borra ninguna fila. La UI del CRM deja de listar; la
-- metadata sigue en las tablas de s7_76.
-- ═══════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.admin_list_patients_crm(text,text,int,int)') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: s7_77 no parece aplicada';
  END IF;
END $$;

-- Orden: primero los wrappers públicos, después el núcleo y la vista de la que
-- dependen. Al revés, el DROP fallaría por dependencia.
DROP FUNCTION IF EXISTS public.admin_list_patients_crm(text,text,int,int);
DROP FUNCTION IF EXISTS public.admin_export_patients_crm(text,text,text);
DROP FUNCTION IF EXISTS public.admin_list_unlinked_patients(text,int,int);
DROP FUNCTION IF EXISTS public.admin_patients_crm_stats();
DROP FUNCTION IF EXISTS public._crm_patients_json(text,text,int,int);
DROP FUNCTION IF EXISTS public._crm_estado(boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz);
DROP FUNCTION IF EXISTS public._crm_status_norm(text);
DROP VIEW IF EXISTS public.crm_patient_identity;

DO $$
BEGIN
  IF to_regprocedure('public.admin_list_patients_crm(text,text,int,int)') IS NOT NULL
     OR to_regprocedure('public.admin_export_patients_crm(text,text,text)') IS NOT NULL
     OR to_regprocedure('public.admin_list_unlinked_patients(text,int,int)') IS NOT NULL
     OR to_regprocedure('public.admin_patients_crm_stats()') IS NOT NULL
     OR to_regprocedure('public._crm_patients_json(text,text,int,int)') IS NOT NULL
     OR to_regprocedure('public._crm_estado(boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz)') IS NOT NULL
     OR to_regprocedure('public._crm_status_norm(text)') IS NOT NULL
     OR to_regclass('public.crm_patient_identity') IS NOT NULL THEN
    RAISE EXCEPTION 'POST fallo: alguna RPC o la vista siguen existiendo';
  END IF;
  -- Las tablas de s7_76 NO se tocan.
  IF to_regclass('public.patient_crm') IS NULL THEN
    RAISE EXCEPTION 'POST fallo: se perdió la fundación de s7_76 (!!)';
  END IF;
END $$;

COMMIT;
