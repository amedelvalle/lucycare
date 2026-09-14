-- ════════════════════════════════════════════════════════════════════
-- s7_94 · DERIVA DEL CIERRE · administrative_unit_closure frente al arbol vivo
-- SOLO LECTURA · una sola sentencia SELECT · valido SOLO con s7_94 aplicada.
-- Pegar ENTERO en una pestaña nueva y ejecutar. Generico: no depende de SV.
-- Reutilizable: lo exige toda migracion futura que escriba administrative_units.
-- Z = faltan + sobran + ciclos = 0 es el veredicto.
-- ════════════════════════════════════════════════════════════════════
WITH RECURSIVE
esperado (country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth, ruta, ciclo) AS (
  SELECT u.country_id, u.id, u.level, u.id, u.level, 0, ARRAY[u.id], false FROM public.administrative_units u
  UNION ALL
  SELECT e.country_id, p.id, p.level, e.descendant_unit_id, e.descendant_level, e.depth + 1, e.ruta || p.id, p.id = ANY (e.ruta)
    FROM esperado e JOIN public.administrative_units x ON x.id = e.ancestor_unit_id
                    JOIN public.administrative_units p ON p.id = x.parent_id
   WHERE NOT e.ciclo AND e.depth < 64
),
esp AS MATERIALIZED (
  SELECT country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth FROM esperado WHERE NOT ciclo
),
alm AS MATERIALIZED (
  SELECT country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth FROM public.administrative_unit_closure
),
faltan AS (SELECT * FROM esp EXCEPT SELECT * FROM alm),
sobran AS (SELECT * FROM alm EXCEPT SELECT * FROM esp)
SELECT (SELECT count(*) FROM public.administrative_units)                     AS unidades,
       (SELECT count(*) FROM alm)                                              AS filas_almacenadas,
       (SELECT count(*) FROM esp)                                              AS filas_esperadas,
       (SELECT count(*) FROM faltan)                                           AS faltan,
       (SELECT count(*) FROM sobran)                                           AS sobran,
       (SELECT count(*) FROM esperado WHERE ciclo OR depth = 64)               AS ciclos_o_truncados,
       (SELECT string_agg(z.iso || '=' || z.n, ' ' ORDER BY z.iso)
          FROM (SELECT c.iso_alpha2 AS iso, count(*) AS n FROM alm JOIN public.countries c ON c.id = alm.country_id GROUP BY 1) z) AS filas_por_pais,
       (SELECT count(*) FROM faltan) + (SELECT count(*) FROM sobran) + (SELECT count(*) FROM esperado WHERE ciclo OR depth = 64) AS z;
