-- ============================================================
-- ROLLBACK de s7_86 · vuelve el export al estado de s7_79
-- ============================================================
--
-- Deshace EXACTAMENTE lo que s7_86 introdujo: el LEFT JOIN LATERAL y las tres
-- claves de onboarding. El resultado es el cuerpo de `s7_79`, verbatim.
--
-- NO borra `admin_export_doctors` ni `_doctor_onboarding`: es un
-- `CREATE OR REPLACE` al cuerpo anterior. Reemplazar es reversible; DROP no.
--
-- Para revertir, reaplicar `migrations/s7_79_admin_doctor_export_slug.sql`
-- completo. Ese archivo ya contiene la funcion en su forma previa, junto con
-- sus grants y sus guardas POST — reproducirlo aca a mano seria una segunda
-- copia que puede divergir del original.
--
-- Despues de reaplicar s7_79, verificar con este bloque que el onboarding
-- salio del export y que nada mas cambio.

DO $$
DECLARE
  v_oid oid;
  v_src text;
  v_n   int;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_export_doctors';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'rollback s7_86: admin_export_doctors no existe';
  END IF;

  SELECT regexp_replace(regexp_replace(prosrc, '/\*.*?\*/', '', 'gs'),
                        '--[^\n]*', '', 'g')
    INTO v_src FROM pg_proc WHERE oid = v_oid;

  IF v_src LIKE '%_doctor_onboarding%' THEN
    RAISE EXCEPTION 'rollback s7_86: el export sigue llamando a _doctor_onboarding';
  END IF;
  IF v_src LIKE '%onb_stage%' OR v_src LIKE '%onb_next_action%'
     OR v_src LIKE '%booking_ready%' THEN
    RAISE EXCEPTION 'rollback s7_86: quedan claves de onboarding en la allowlist';
  END IF;

  -- Lo de s7_79 debe seguir en pie: el rollback no puede llevarse el slug.
  IF v_src !~ '''slug'',\s*d\.slug' THEN
    RAISE EXCEPTION 'rollback s7_86: se perdio el slug de s7_79';
  END IF;
  IF v_src NOT LIKE '%P0140%' OR v_src NOT LIKE '%P0146%'
     OR v_src NOT LIKE '%admin_list_doctors%' THEN
    RAISE EXCEPTION 'rollback s7_86: el cuerpo no es el de s7_79';
  END IF;

  -- `_doctor_onboarding` sobrevive: la usan admin_doctors_onboarding y
  -- admin_list_doctors_by_onboarding, que este rollback NO toca.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_doctor_onboarding';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'rollback s7_86: _doctor_onboarding no debe eliminarse (la usa el listado)';
  END IF;

  RAISE NOTICE 'rollback s7_86: OK — export de vuelta en s7_79, onboarding intacto';
END $$;
