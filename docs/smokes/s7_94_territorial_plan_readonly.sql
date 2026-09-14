-- ════════════════════════════════════════════════════════════════════
-- s7_94 · PLAN del filtro TERRITORIAL por el cierre (referencia para F3E)
-- SOLO LECTURA · una sola sentencia EXPLAIN ANALYZE de un SELECT.
-- Valido SOLO con s7_94 aplicada. Pegar ENTERO en una pestaña nueva y ejecutar.
-- Lo que se mide: un join con el cierre por ancestor_unit_id, sin Recursive
-- Union ni CTE Scan. La unidad se elige por dato: el ancestro de nivel 1 con
-- mas clinicas. ⚠️ Con ~23 clinicas con geo el planificador prefiere Seq Scan:
-- es correcto a este tamaño; cuenta la forma del plan.
-- ════════════════════════════════════════════════════════════════════
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT d.id, c.id AS clinic_id
  FROM public.doctors d
  JOIN public.clinics c ON c.id = d.clinic_id
  JOIN public.administrative_unit_closure k ON k.descendant_unit_id = c.territory_unit_id
 WHERE d.is_published
   AND c.country_id = (SELECT co.id FROM public.countries co WHERE co.iso_alpha2 = 'SV')
   AND k.ancestor_unit_id = (SELECT k2.ancestor_unit_id
                               FROM public.clinics c2
                               JOIN public.administrative_unit_closure k2 ON k2.descendant_unit_id = c2.territory_unit_id AND k2.ancestor_level = 1
                              GROUP BY k2.ancestor_unit_id ORDER BY count(*) DESC, k2.ancestor_unit_id LIMIT 1);
