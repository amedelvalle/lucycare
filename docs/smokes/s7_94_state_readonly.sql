-- ════════════════════════════════════════════════════════════════════
-- s7_94 · ESTADO · clasifica APLICADA COMPLETA / NO APLICADA / MIXTO
-- SOLO LECTURA · una sola sentencia SELECT · valido en cualquier estado.
-- Pegar ENTERO en una pestaña nueva y ejecutar. Correrlo SIEMPRE antes de
-- cualquier reintento, ROLLBACK o conclusion tras un error del editor.
-- ════════════════════════════════════════════════════════════════════
WITH
e AS (
  SELECT to_regclass('public.administrative_unit_closure') AS t,
         to_regclass('public.au_id_country_level_key')     AS i
),
m AS (
  SELECT e.t IS NOT NULL AS hay_tabla,
         e.i IS NOT NULL AS hay_indice,
         CASE WHEN e.t IS NULL THEN NULL
              ELSE (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.administrative_unit_closure', false, true, '')))[1]::text END AS filas,
         CASE WHEN e.t IS NULL THEN NULL
              ELSE (xpath('/row/h/text()', query_to_xml(
                'SELECT md5(string_agg(ancestor_unit_id || ''|'' || descendant_unit_id || ''|'' || depth, E''\n'' ORDER BY ancestor_unit_id, descendant_unit_id)) AS h FROM public.administrative_unit_closure',
                false, true, '')))[1]::text END AS huella,
         (SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity FROM pg_class WHERE oid = e.t) AS seguridad,
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'administrative_unit_closure') AS policies,
         (SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint WHERE conrelid = e.t AND contype IN ('p', 'f', 'c')) AS constraints,
         (SELECT count(*) FROM pg_constraint WHERE conindid = e.i AND contype = 'f') AS fk_al_indice
    FROM e
),
filas AS (
  SELECT 10 AS orden, 'tabla public.administrative_unit_closure existe' AS clave, (SELECT hay_tabla::text FROM m) AS valor
  UNION ALL SELECT 11, 'indice unico public.au_id_country_level_key existe', (SELECT hay_indice::text FROM m)
  UNION ALL SELECT 12, 'filas del cierre (esperado 888)', (SELECT coalesce(filas, '-') FROM m)
  UNION ALL SELECT 13, 'huella del cierre (esperado af230f5086d871b1cce24e34de4b6cec)', (SELECT coalesce(huella, '-') FROM m)
  UNION ALL SELECT 14, 'relacl | RLS | force (esperado {postgres=arwdDxtm/postgres}|true|false)', (SELECT coalesce(seguridad, '-') FROM m)
  UNION ALL SELECT 15, 'policies sobre el cierre (esperado 0)', (SELECT policies::text FROM m)
  UNION ALL SELECT 16, 'constraints p/f/c del cierre', (SELECT coalesce(constraints, '-') FROM m)
  UNION ALL SELECT 17, 'FK que usan el indice unico (esperado 2)', (SELECT fk_al_indice::text FROM m)
  UNION ALL SELECT 18, 'huella del catalogo (esperado 460e807050a0da8bea0891965b1b9fd7)',
         (SELECT md5(string_agg(u.id || '|' || u.country_id || '|' || coalesce(u.parent_id::text, 'NULL') || '|' || u.level || '|' || u.is_active, E'\n' ORDER BY u.id))
            FROM public.administrative_units u)
  UNION ALL SELECT 19, 'triggers de clinics (esperado trg_clinics_territory_sync[O],trg_clinics_updated_at[O])',
         (SELECT string_agg(t.tgname::text || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) FROM pg_trigger t
           WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal)
  UNION ALL SELECT 20, 'sesiones en transaccion abortada (info)',
         (SELECT count(*)::text FROM pg_stat_activity WHERE state = 'idle in transaction (aborted)')
  UNION ALL SELECT 21, 'locks de OTRAS sesiones sobre administrative_units (info)',
         (SELECT coalesce(string_agg(l.pid || ':' || l.mode || ':' || l.granted, ', ' ORDER BY l.pid), '(ninguno)') FROM pg_locks l
           WHERE l.relation = 'public.administrative_units'::regclass AND l.pid <> pg_backend_pid())
  UNION ALL SELECT 99, 'ESTADO',
         (SELECT CASE
                   WHEN hay_tabla AND hay_indice AND filas = '888' AND huella = 'af230f5086d871b1cce24e34de4b6cec'
                        AND seguridad = '{postgres=arwdDxtm/postgres}|true|false' AND policies = 0 AND fk_al_indice = 2
                        AND constraints = 'administrative_unit_closure_pkey,auc_ancestor_fkey,auc_depth_levels_chk,auc_descendant_fkey,auc_self_iff_depth_0_chk'
                     THEN 'S7_94 APLICADA COMPLETA'
                   WHEN NOT hay_tabla AND NOT hay_indice THEN 'S7_94 NO APLICADA'
                   ELSE 'MIXTO: STOP, no reintentar ni revertir, compartir esta salida'
                 END FROM m)
)
SELECT orden, clave, valor FROM filas ORDER BY orden;
