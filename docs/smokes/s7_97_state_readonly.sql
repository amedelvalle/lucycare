-- ════════════════════════════════════════════════════════════════════
-- s7_97 · ESTADO · clasifica aplicada / no aplicada / mixta / anomalia
-- SOLO LECTURA · UNA sola sentencia SELECT · NO lee auth.users · sin datos personales.
-- Correr PRIMERO ante cualquier error del SQL Editor en el PASO 2 o en el rollback,
-- antes de reintentar o de concluir nada: un error mostrado no prueba que la
-- transaccion abortara.
-- No llama a la RPC: clasifica por catalogo (pg_proc, ACL, privilegios).
-- Primera linea de la sentencia: WITH · ultima: ORDER BY orden;
-- ════════════════════════════════════════════════════════════════════
WITH
f AS MATERIALIZED (
  SELECT p.oid, p.proname, n.nspname,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || pg_get_function_result(p.oid)
           || ' vol=' || p.provolatile::text || ' def=' || p.prosecdef || ' lang=' || l.lanname
           || ' cfg=' || coalesce(p.proconfig::text, '') || ' owner=' || pg_get_userbyid(p.proowner)
           || ' args=' || pg_get_function_arguments(p.oid) AS forma,
         md5(p.prosrc) AS md5_cuerpo,
         (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a) AS acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
   WHERE p.proname = 'directory_territory_scope'
),
m AS (
  SELECT
    (SELECT count(*) FROM f) AS n_funciones,
    (SELECT count(*) FROM f
      WHERE f.nspname = 'public' AND f.acl = 'anon=X/postgres,authenticated=X/postgres,postgres=X/postgres'
        AND f.forma = 'directory_territory_scope(p_country_iso text, p_unit_id bigint) TABLE(unit_id bigint) vol=s def=true lang=plpgsql cfg={"search_path=public, pg_temp"} owner=postgres args=p_country_iso text, p_unit_id bigint'
        AND f.md5_cuerpo IN ('08116cf0c80730e76e2cae4531153989', 'a69870a3a900247ad60d4d9c2730d375')) AS n_exactas,
    (SELECT count(*) FROM pg_proc WHERE proname IN ('directory_countries', 'directory_territory_units')) AS n_rpc_96,
    (SELECT bool_or(has_table_privilege(r.rol, t.tbl, x.priv))
       FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),
            unnest(ARRAY['public.countries', 'public.country_levels', 'public.administrative_units', 'public.administrative_unit_closure']) t(tbl),
            unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)) AS catalogo_abierto,
    (SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
        AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels)\M') AS consumidores_s92_s93,
    (SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND p.prosrc ~* '(administrative_unit_closure|au_id_country_level_key|auc_descendant_level_idx|ancestor_unit_id|descendant_unit_id)') AS lectores_cierre,
    (SELECT count(*) FROM pg_depend d JOIN f ON d.refobjid = f.oid WHERE d.refclassid = 'pg_proc'::regclass AND d.deptype <> 'i') AS dependientes_rpc
)
SELECT 1 AS orden, 'ESTADO' AS clave,
       CASE
         WHEN m.catalogo_abierto
           THEN 'ANOMALIA — un rol cliente tiene privilegios sobre el catalogo GEO (s7_97 no los concede): NO continuar, reportar'
         WHEN m.n_funciones = 0 AND m.lectores_cierre = '' AND m.consumidores_s92_s93 = 'directory_countries,directory_territory_units'
           THEN 'S7_97 NO APLICADA'
         WHEN m.n_funciones = 0
           THEN 'ANOMALIA — sin la RPC de s7_97 pero con lectores del cierre (' || m.lectores_cierre || ') o consumidores del modelo inesperados (' || m.consumidores_s92_s93 || '): NO continuar, reportar'
         WHEN m.n_funciones = 1 AND m.n_exactas = 1 AND m.n_rpc_96 = 2 AND m.lectores_cierre = 'directory_territory_scope'
              AND m.consumidores_s92_s93 = 'directory_countries,directory_territory_scope,directory_territory_units'
           THEN 'S7_97 APLICADA COMPLETA'
         WHEN m.n_funciones = 1 AND m.n_exactas = 1
           THEN 'S7_97 APLICADA — con consumidores o prerequisitos distintos (s7_96: ' || m.n_rpc_96 || ' RPC; cierre: ' || m.lectores_cierre || '; modelo: ' || m.consumidores_s92_s93 || '): reportar'
         ELSE 'MIXTO — ' || m.n_funciones || ' funciones directory_territory_scope, ' || m.n_exactas || ' exactas: NO continuar, reportar'
       END AS valor
  FROM m
UNION ALL SELECT 2, 'funciones directory_territory_scope · exactas (firma, retorno, cuerpo, DEFINER, STABLE, search_path, dueño, ACL)', n_funciones || ' · ' || n_exactas FROM m
UNION ALL SELECT 3, 'forma y ACL', coalesce((SELECT string_agg(nspname || '.' || forma || ' acl=' || coalesce(acl, 'NULL') || ' md5=' || md5_cuerpo, E'\n' ORDER BY proname) FROM f), '(ninguna)')
UNION ALL SELECT 4, 'RPC de s7_96 presentes (prerequisito)', n_rpc_96::text FROM m
UNION ALL SELECT 5, 'catalogo GEO con privilegios de cliente', catalogo_abierto::text FROM m
UNION ALL SELECT 6, 'funciones que detecta el rollback de s7_94 (lectores del cierre)', CASE WHEN lectores_cierre = '' THEN '(ninguna)' ELSE lectores_cierre END FROM m
UNION ALL SELECT 7, 'funciones que detectan los rollbacks de s7_92/s7_93', CASE WHEN consumidores_s92_s93 = '' THEN '(ninguna)' ELSE consumidores_s92_s93 END FROM m
UNION ALL SELECT 8, 'objetos que dependen de la RPC (pg_depend)', dependientes_rpc::text FROM m
UNION ALL SELECT 9, 'orden de reversion', 'frontend F3E-3B -> s7_97 -> frontend F3E-2 -> s7_96 -> s7_95 -> s7_94 -> s7_93 R2 -> verificar -> s7_92'
UNION ALL SELECT 10, 'current_user', current_user::text
ORDER BY orden;
