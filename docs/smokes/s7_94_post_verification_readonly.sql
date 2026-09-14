-- ════════════════════════════════════════════════════════════════════
-- s7_94 · VERIFICACION POST · cierre territorial (F3D)
-- SOLO LECTURA · una sola sentencia SELECT · valido SOLO con s7_94 aplicada.
-- Pegar ENTERO en una pestaña nueva y ejecutar. Z = 0 es el veredicto;
-- las filas (info) son medicion.
-- ════════════════════════════════════════════════════════════════════
WITH RECURSIVE
bajada (country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth, ruta, ciclo) AS (
  SELECT u.country_id, u.id, u.level, u.id, u.level, 0, ARRAY[u.id], false FROM public.administrative_units u
  UNION ALL
  SELECT b.country_id, b.ancestor_unit_id, b.ancestor_level, h.id, h.level, b.depth + 1, b.ruta || h.id, h.id = ANY (b.ruta)
    FROM bajada b JOIN public.administrative_units h ON h.parent_id = b.descendant_unit_id
   WHERE NOT b.ciclo AND b.depth < 64
),
esp AS MATERIALIZED (SELECT country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth FROM bajada WHERE NOT ciclo),
alm AS MATERIALIZED (SELECT country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth FROM public.administrative_unit_closure),
filas AS (
  -- A · forma
  SELECT 10 AS orden, 'A columnas: nombre:tipo:not null' AS clave,
         (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' ORDER BY a.attnum)
            FROM pg_attribute a WHERE a.attrelid = 'public.administrative_unit_closure'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS valor,
         'country_id:smallint:true,ancestor_unit_id:bigint:true,ancestor_level:smallint:true,descendant_unit_id:bigint:true,descendant_level:smallint:true,depth:smallint:true' AS esperado
  UNION ALL SELECT 11, 'A dueño | tipo | persistencia',
         (SELECT pg_get_userbyid(relowner) || '|' || relkind::text || '|' || relpersistence::text FROM pg_class WHERE oid = 'public.administrative_unit_closure'::regclass), 'postgres|r|p'
  UNION ALL SELECT 12, 'A constraints p/f/c',
         (SELECT string_agg(conname || ':' || contype::text, ',' ORDER BY conname) FROM pg_constraint
           WHERE conrelid = 'public.administrative_unit_closure'::regclass AND contype IN ('p', 'u', 'f', 'c', 'x', 't')),
         'administrative_unit_closure_pkey:p,auc_ancestor_fkey:f,auc_depth_levels_chk:c,auc_descendant_fkey:f,auc_self_iff_depth_0_chk:c'
  UNION ALL SELECT 13, 'A FK: columnas -> destino(columnas) : indice : upd del match : validada : diferible',
         (SELECT string_agg(con.conname || '(' ||
                   (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(att, ord)
                      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.att) || ')->' || con.confrelid::regclass::text || '(' ||
                   (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(att, ord)
                      JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.att) || '):' || con.conindid::regclass::text || ':' ||
                   con.confupdtype::text || con.confdeltype::text || con.confmatchtype::text || ':' || con.convalidated || ':' || con.condeferrable, ' ; ' ORDER BY con.conname)
            FROM pg_constraint con WHERE con.conrelid = 'public.administrative_unit_closure'::regclass AND con.contype = 'f'),
         'auc_ancestor_fkey(ancestor_unit_id,country_id,ancestor_level)->administrative_units(id,country_id,level):au_id_country_level_key:aas:true:false ; auc_descendant_fkey(descendant_unit_id,country_id,descendant_level)->administrative_units(id,country_id,level):au_id_country_level_key:aas:true:false'
  UNION ALL SELECT 14, 'A indices: nombre:unico:valido:no parcial:clave+include',
         (SELECT string_agg(c.relname || ':' || i.indisunique || ':' || i.indisvalid || ':' || (i.indpred IS NULL) || ':' ||
                   (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(i.indkey::int2[]) WITH ORDINALITY k(att, ord)
                      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.att WHERE k.ord <= i.indnkeyatts) || '+' ||
                   coalesce((SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(i.indkey::int2[]) WITH ORDINALITY k(att, ord)
                      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.att WHERE k.ord > i.indnkeyatts), ''), ' ; ' ORDER BY c.relname)
            FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
           WHERE i.indrelid IN ('public.administrative_unit_closure'::regclass, 'public.administrative_units'::regclass)
             AND c.relname IN ('administrative_unit_closure_pkey', 'auc_descendant_level_idx', 'au_id_country_level_key')),
         'administrative_unit_closure_pkey:true:true:true:ancestor_unit_id,descendant_unit_id+ ; au_id_country_level_key:true:true:true:id,country_id,level+ ; auc_descendant_level_idx:false:true:true:descendant_unit_id,ancestor_level+ancestor_unit_id'
  UNION ALL SELECT 15, 'A indices totales del cierre', (SELECT count(*)::text FROM pg_index WHERE indrelid = 'public.administrative_unit_closure'::regclass), '2'
  UNION ALL SELECT 16, 'A indices de administrative_units (info)',
         (SELECT string_agg(indexrelid::regclass::text, ', ' ORDER BY indexrelid::regclass::text) FROM pg_index WHERE indrelid = 'public.administrative_units'::regclass), '(info)'

  -- B · contenido
  UNION ALL SELECT 20, 'B filas del cierre', (SELECT count(*)::text FROM alm), '888'
  UNION ALL SELECT 21, 'B reparto por depth', (SELECT string_agg(z.depth || '=' || z.n, ',' ORDER BY z.depth) FROM (SELECT depth, count(*) AS n FROM alm GROUP BY depth) z), '0=320,1=306,2=262'
  UNION ALL SELECT 22, 'B huella del cierre (ancestor|descendant|depth)',
         (SELECT md5(string_agg(ancestor_unit_id || '|' || descendant_unit_id || '|' || depth, E'\n' ORDER BY ancestor_unit_id, descendant_unit_id)) FROM alm),
         'af230f5086d871b1cce24e34de4b6cec'
  UNION ALL SELECT 23, 'B filas propias = unidades',
         ((SELECT count(*) FROM alm WHERE depth = 0 AND ancestor_unit_id = descendant_unit_id) = (SELECT count(*) FROM public.administrative_units))::text, 'true'
  UNION ALL SELECT 24, 'B filas con pais o niveles distintos del catalogo',
         (SELECT count(*)::text FROM alm k JOIN public.administrative_units a ON a.id = k.ancestor_unit_id JOIN public.administrative_units d ON d.id = k.descendant_unit_id
           WHERE a.country_id <> k.country_id OR d.country_id <> k.country_id OR a.level <> k.ancestor_level OR d.level <> k.descendant_level), '0'
  UNION ALL SELECT 25, 'B DERIVA: faltan + sobran frente al arbol vivo (recalculo independiente)',
         ((SELECT count(*) FROM (SELECT * FROM esp EXCEPT SELECT * FROM alm) f) + (SELECT count(*) FROM (SELECT * FROM alm EXCEPT SELECT * FROM esp) s))::text, '0'
  UNION ALL SELECT 26, 'B ciclos o recorridos truncados', (SELECT count(*)::text FROM bajada WHERE ciclo OR depth = 64), '0'
  UNION ALL SELECT 27, 'B filas por pais (info)',
         (SELECT string_agg(z.iso || '=' || z.n, ' ' ORDER BY z.iso) FROM (SELECT c.iso_alpha2 AS iso, count(*) AS n FROM alm JOIN public.countries c ON c.id = alm.country_id GROUP BY 1) z), '(info)'
  UNION ALL SELECT 28, 'B tamaño total del cierre (info)', pg_size_pretty(pg_total_relation_size('public.administrative_unit_closure'::regclass)), '(info)'

  -- C · seguridad
  UNION ALL SELECT 30, 'C relacl | RLS | force',
         (SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity FROM pg_class WHERE oid = 'public.administrative_unit_closure'::regclass),
         '{postgres=arwdDxtm/postgres}|true|false'
  UNION ALL SELECT 31, 'C algun privilegio de tabla de cliente sobre el cierre',
         (SELECT bool_or(has_table_privilege(r.rol, 'public.administrative_unit_closure', x.priv))::text
            FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),
                 unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)), 'false'
  UNION ALL SELECT 32, 'C privilegios de COLUMNA de cliente sobre el cierre',
         (SELECT count(*)::text FROM information_schema.column_privileges
           WHERE table_schema = 'public' AND table_name = 'administrative_unit_closure' AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')), '0'
  UNION ALL SELECT 33, 'C policies sobre el cierre', (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'administrative_unit_closure'), '0'
  UNION ALL SELECT 34, 'C triggers de usuario sobre el cierre', (SELECT count(*)::text FROM pg_trigger WHERE tgrelid = 'public.administrative_unit_closure'::regclass AND NOT tgisinternal), '0'
  UNION ALL SELECT 35, 'C publicaciones que incluyen el cierre',
         coalesce((SELECT string_agg(pubname::text, ',') FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'administrative_unit_closure'), '(ninguna)'), '(ninguna)'
  UNION ALL SELECT 36, 'C catalogo sigue cerrado a clientes',
         (SELECT bool_or(has_table_privilege(r.rol, t.tabla, x.priv))::text
            FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),
                 unnest(ARRAY['public.administrative_units', 'public.countries', 'public.country_levels']) t(tabla),
                 unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)), 'false'
  UNION ALL SELECT 37, 'C relacl del catalogo (info: igual al preflight)',
         (SELECT string_agg(relname || '=' || coalesce(relacl::text, 'NULL'), ' ; ' ORDER BY relname) FROM pg_class
           WHERE oid IN ('public.administrative_units'::regclass, 'public.countries'::regclass, 'public.country_levels'::regclass)), '(info)'

  -- D · nada mas cambio
  UNION ALL SELECT 40, 'D huella del catalogo',
         (SELECT md5(string_agg(u.id || '|' || u.country_id || '|' || coalesce(u.parent_id::text, 'NULL') || '|' || u.level || '|' || u.is_active, E'\n' ORDER BY u.id))
            FROM public.administrative_units u), '460e807050a0da8bea0891965b1b9fd7'
  UNION ALL SELECT 41, 'D huella C2 de clinics (la misma que dejo s7_93)',
         (SELECT md5(coalesce(string_agg(
                   c.id::text || '|' || coalesce(c.department_id, 'NULL') || '|' || coalesce(c.municipality_id, 'NULL') || '|' ||
                   coalesce(c.country_id::text, 'NULL') || '|' || coalesce(c.territory_unit_id::text, 'NULL'),
                   E'\n' ORDER BY c.id), ''))
            FROM public.clinics c), '7c823ad1f5c30fc7a2b5a33fe62c68a7'
  UNION ALL SELECT 42, 'D triggers de clinics',
         (SELECT string_agg(t.tgname::text || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) FROM pg_trigger t
           WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal), 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]'
  UNION ALL SELECT 43, 'D funciones de s7_92 intactas (md5 LF o CRLF)',
         (SELECT (count(*) = 2)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND ((p.proname = '_territory_from_legacy_sv' AND md5(p.prosrc) IN ('b8a0d02700685b5d340c8ab1ebfcec17', 'bdb0723c0257b31fe1aaa2bfc609dd6c'))
               OR (p.proname = '_clinics_territory_sync' AND md5(p.prosrc) IN ('d472f713d7cb54581f0cc7a374c52185', '0cecd35ba759d9fbc84b1f98a82a0202')))), 'true'
  UNION ALL SELECT 44, 'D funciones que nombran el cierre', (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.prosrc ~* '(unit_closure|ancestor_unit_id|descendant_unit_id|au_id_country_level_key)'), '0'
  UNION ALL SELECT 45, 'D triggers de usuario sobre el catalogo',
         (SELECT count(*)::text FROM pg_trigger WHERE NOT tgisinternal
             AND tgrelid IN ('public.administrative_units'::regclass, 'public.countries'::regclass, 'public.country_levels'::regclass)), '0'

  -- E · la cadena de rollbacks sigue siendo ejecutable
  UNION ALL SELECT 50, 'E funciones fuera de s7_92 que harian abortar R2 de s7_93 y el rollback de s7_92',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
             AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
             AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels)\M'), '0'
  UNION ALL SELECT 51, 'E vistas sobre el modelo nuevo o el cierre',
         (SELECT count(*)::text FROM pg_depend d WHERE d.classid = 'pg_rewrite'::regclass
             AND d.refobjid IN ('public.administrative_units'::regclass, 'public.countries'::regclass, 'public.country_levels'::regclass, 'public.administrative_unit_closure'::regclass)), '0'
  UNION ALL SELECT 52, 'E dependientes del indice unico del catalogo (rollback de s7_94)',
         (SELECT string_agg(conrelid::regclass::text || '.' || conname, ', ' ORDER BY conname) FROM pg_constraint WHERE conindid = 'public.au_id_country_level_key'::regclass),
         'administrative_unit_closure.auc_ancestor_fkey, administrative_unit_closure.auc_descendant_fkey'
  UNION ALL SELECT 53, 'E FK que referencian el cierre', (SELECT count(*)::text FROM pg_constraint WHERE contype = 'f' AND confrelid = 'public.administrative_unit_closure'::regclass), '0'
  UNION ALL SELECT 60, 'F current_user', current_user::text, 'postgres'
  UNION ALL SELECT 61, 'F version del servidor (info)', current_setting('server_version'), '(info)'
)
SELECT 's7_94 verificacion' AS seccion, orden, clave, valor, esperado,
       CASE WHEN esperado = '(info)' THEN NULL ELSE (valor IS NOT DISTINCT FROM esperado) END AS ok
FROM (
  SELECT orden, clave, valor, esperado FROM filas
  UNION ALL
  SELECT 999, 'Z veredicto · filas con ok = false', (SELECT count(*) FROM filas WHERE esperado <> '(info)' AND valor IS DISTINCT FROM esperado)::text, '0'
) t
ORDER BY orden;
