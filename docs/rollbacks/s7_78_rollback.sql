-- ============================================================
-- ROLLBACK de s7_78 · ADMIN-DOCTOR-EXPORT
-- ============================================================
--
-- s7_78 solo AÑADE una función: no altera tablas, no cambia ninguna definición
-- previa y no migra datos. Por eso el rollback es simplemente eliminarla, y no
-- hay nada que "restaurar" a un estado anterior.
--
-- ⚠️ `admin_list_doctors` NO se toca acá. s7_78 la invoca, pero no la modificó:
-- eliminar el export la deja exactamente como estaba.
--
-- ⚠️ Las filas de `audit_log` con `table_name='admin_doctor_export'` NO se
-- borran. `audit_log` es inmutable desde s7_71b y esas filas son evidencia de
-- exportaciones que REALMENTE ocurrieron: borrarlas sería falsificar el
-- historial, no revertir una migración.
--
-- Consecuencia esperada tras aplicarlo: el botón «Exportar CSV» de
-- /admin/medicos deja de funcionar y muestra el error genérico. Si el frontend
-- sigue desplegado, conviene revertir también ese despliegue.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.admin_export_doctors(text, boolean, boolean, lucy_status, text);

-- ─── Verificación del rollback ──────────────────────────────
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_export_doctors';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'rollback s7_78: admin_export_doctors sigue existiendo';
  END IF;

  -- El listado tiene que seguir intacto: es lo que usa la pantalla.
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_list_doctors';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'rollback s7_78: admin_list_doctors quedó en % definiciones, esperaba 1', v_n;
  END IF;

  RAISE NOTICE 'rollback s7_78: OK — export eliminado, listado intacto, auditoría preservada';
END $$;

COMMIT;
