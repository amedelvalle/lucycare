-- ============================================================
-- s7_94 · MULTICOUNTRY-GEO-P0 · FUNDACION 3D
-- Cierre transitivo del arbol territorial (closure table)
-- ============================================================
--
-- Migracion 115. Crea public.administrative_unit_closure y la carga desde el
-- arbol vivo de public.administrative_units: una fila por par
-- (ancestro, descendiente), incluida la fila propia de cada unidad.
--
-- Preflight de produccion del 2026-09-14 (Z = 0), aprobado por el owner:
--   320 unidades de SV = 14 / 44 / 262; 0 ciclos, huerfanas, cruces de pais o
--   saltos de nivel; cierre exacto con filas propias = 888
--   (depth 0 = 320, 1 = 306, 2 = 262); huella del cierre
--   af230f5086d871b1cce24e34de4b6cec; huella del catalogo
--   460e807050a0da8bea0891965b1b9fd7; nombres libres.
--
-- ── DECISIONES DEL OWNER (variante N1) ──
--   · filas propias con depth = 0;
--   · country_id, ancestor_level y descendant_level en cada fila, con FK
--     compuestas (unidad, pais, nivel) que garantizan mismo pais y niveles
--     reales, y CHECK que ata depth a los niveles;
--   · UNIQUE aditiva (id, country_id, level) en administrative_units como
--     destino de esas FK;
--   · indices para descendientes (PK) y para el recorrido inverso por
--     descendiente;
--   · F3D es SOLO estructura: sin funciones persistidas, trigger, RPC ni
--     grants de cliente. El filtro solo por pais sigue usando
--     clinics.country_id; el cierre solo entra con filtro territorial;
--   · seguridad bloqueante: RLS habilitada, 0 policies, REVOKE explicito a
--     PUBLIC, anon, authenticated y service_role. Los DEFAULT PRIVILEGES de
--     public conceden ALL a esos roles sobre tablas nuevas: sin el REVOKE la
--     tabla naceria legible y escribible desde el cliente;
--   · toda migracion futura que modifique administrative_units mantiene o
--     reconstruye el cierre y lo verifica en la misma transaccion;
--   · no mueve el HEAD funcional: ningun runtime consume el cierre.
--
-- ── POR QUE UN INDICE UNICO Y NO ALTER TABLE ... ADD CONSTRAINT UNIQUE ──
-- Medido en PostgreSQL: ADD CONSTRAINT UNIQUE toma AccessExclusiveLock sobre
-- administrative_units y bloquearia durante la transaccion las LECTURAS que
-- hace la sincronizacion de s7_92 al escribir clinics. Un indice unico toma
-- ShareLock (bloquea escrituras, no lecturas) y una FK puede apuntar a el:
-- misma garantia de unicidad, sin bloquear lectores.
--
-- ── POR QUE NO HAY FUNCIONES ──
-- Medido en el arnes: cualquier funcion persistida que nombre el catalogo hace
-- abortar el rollback R2 de s7_93 y el rollback de s7_92, cuyas guardas buscan
-- consumidores en prosrc. La carga es un unico INSERT recursivo aqui dentro.
--
-- ── LOCK ──
-- SET LOCAL lock_timeout = 5s y LOCK SHARE ROW EXCLUSIVE sobre
-- administrative_units al inicio del PASO 2: bloquea escrituras al catalogo
-- (hoy no tiene escritores), no lecturas. Si no se obtiene, aborta sin cambios.
-- El DDL dispara la recarga de esquema de PostgREST al COMMIT, inocua: la tabla
-- no tiene privilegios de cliente.
--
-- ── ROLLBACK ──
-- docs/rollbacks/s7_94_rollback.sql. Orden vigente mientras F3E no exista:
-- rollback de s7_94 -> s7_93 R2 -> verificar estado -> rollback de s7_92.
--
-- ── COMO APLICARLA ──
-- BLOQUES AUTONOMOS, cada uno pegado ENTERO en una pestaña nueva:
--   PASO 1 = seccion 0      · guardas PRE · solo lectura
--   PASO 2 = secciones 1-7  · BEGIN -> ... -> POST -> COMMIT
-- Si el PASO 1 lanza excepcion, NO continuar. Ante cualquier error del editor,
-- clasificar primero el estado con el bloque read-only del runbook: el editor
-- puede mostrar un error que no es el de la transaccion.


-- ─── 0. Guardas PRE (solo lectura) ──────────────────────────
DO $PRE$
DECLARE
  v_huella_catalogo CONSTANT text := '460e807050a0da8bea0891965b1b9fd7';
  v_huella_cierre   CONSTANT text := 'af230f5086d871b1cce24e34de4b6cec';
  v_n   bigint;
  v_txt text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 's7_94 PRE: aplicar como postgres (current_user=%)', current_user;
  END IF;

  -- No reaplicar: ni la tabla ni el indice unico existen, y los nombres estan libres.
  IF to_regclass('public.administrative_unit_closure') IS NOT NULL
     OR to_regclass('public.au_id_country_level_key') IS NOT NULL THEN
    RAISE EXCEPTION 's7_94 PRE: el cierre o su indice unico ya existen — no reaplicar';
  END IF;
  SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND (c.relname LIKE 'administrative\_unit\_closure%' OR c.relname LIKE 'auc\_%'))
       + (SELECT count(*) FROM pg_constraint WHERE conname LIKE 'auc\_%' OR conname LIKE 'administrative\_unit\_closure%')
       + (SELECT count(*) FROM pg_index i WHERE i.indrelid = 'public.administrative_units'::regclass AND i.indisunique AND i.indnatts = 3
             AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
                   WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::int2[])) = ARRAY['country_id', 'id', 'level'])
    INTO v_n;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 's7_94 PRE: % objetos ocupan los nombres o la unicidad del cierre — no reaplicar', v_n;
  END IF;

  -- Huella del catalogo: exactamente la del preflight.
  SELECT md5(string_agg(u.id || '|' || u.country_id || '|' || coalesce(u.parent_id::text, 'NULL') || '|' || u.level || '|' || u.is_active,
                        E'\n' ORDER BY u.id))
    INTO v_txt FROM public.administrative_units u;
  IF v_txt IS DISTINCT FROM v_huella_catalogo THEN
    RAISE EXCEPTION 's7_94 PRE: la huella del catalogo cambio desde el preflight (%): STOP y repetir preflight', v_txt;
  END IF;

  -- Integridad jerarquica que el cierre presupone.
  SELECT count(*) INTO v_n FROM public.administrative_units h JOIN public.administrative_units p ON p.id = h.parent_id
   WHERE p.country_id <> h.country_id OR p.level <> h.level - 1;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_94 PRE: % unidades con padre de otro pais o de nivel incorrecto', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.administrative_units WHERE (parent_id IS NULL) <> (level = 1);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_94 PRE: % unidades con raiz y nivel incoherentes', v_n; END IF;
  SELECT count(*) INTO v_n FROM (SELECT l.country_id FROM public.country_levels l GROUP BY l.country_id
                                  HAVING min(l.level) <> 1 OR max(l.level) <> count(*)) z;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_94 PRE: % paises con niveles no contiguos', v_n; END IF;

  -- Cierre esperado desde el arbol vivo: 888 filas, reparto y huella del preflight, sin ciclos.
  WITH RECURSIVE subida (descendant_unit_id, ancestor_unit_id, depth, ruta, ciclo) AS (
    SELECT u.id, u.id, 0, ARRAY[u.id], false FROM public.administrative_units u
    UNION ALL
    SELECT s.descendant_unit_id, x.parent_id, s.depth + 1, s.ruta || x.parent_id, x.parent_id = ANY (s.ruta)
      FROM subida s JOIN public.administrative_units x ON x.id = s.ancestor_unit_id
     WHERE x.parent_id IS NOT NULL AND NOT s.ciclo AND s.depth < 64
  )
  SELECT (SELECT count(*) FROM subida WHERE ciclo OR depth = 64)::text || '|'
      || (SELECT count(*) FROM subida WHERE NOT ciclo)::text || '|'
      || (SELECT string_agg(z.depth || '=' || z.n, ',' ORDER BY z.depth)
            FROM (SELECT depth, count(*) AS n FROM subida WHERE NOT ciclo GROUP BY depth) z) || '|'
      || (SELECT md5(string_agg(ancestor_unit_id || '|' || descendant_unit_id || '|' || depth, E'\n'
                                ORDER BY ancestor_unit_id, descendant_unit_id))
            FROM subida WHERE NOT ciclo)
    INTO v_txt;
  IF v_txt IS DISTINCT FROM '0|888|0=320,1=306,2=262|' || v_huella_cierre THEN
    RAISE EXCEPTION 's7_94 PRE: el cierre esperado no es el del preflight (ciclos|filas|reparto|huella = %): STOP', v_txt;
  END IF;

  -- Consumidores: solo la sincronizacion de s7_92; nada nombra un cierre.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
     AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels)\M';
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_94 PRE: % funciones consumen el modelo nuevo: STOP', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~* '(unit_closure|ancestor_unit_id|descendant_unit_id|au_id_country_level_key)';
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_94 PRE: % funciones ya nombran un cierre territorial: STOP', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_trigger WHERE NOT tgisinternal
     AND tgrelid IN ('public.administrative_units'::regclass, 'public.countries'::regclass, 'public.country_levels'::regclass);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_94 PRE: % triggers sobre el catalogo: STOP', v_n; END IF;

  -- s7_92 y s7_93 en pie.
  SELECT string_agg(t.tgname::text || '[' || t.tgenabled::text || ']', ',' ORDER BY t.tgname) INTO v_txt
    FROM pg_trigger t WHERE t.tgrelid = 'public.clinics'::regclass AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync[O],trg_clinics_updated_at[O]' THEN
    RAISE EXCEPTION 's7_94 PRE: triggers de clinics inesperados (%)', v_txt;
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND ((p.proname = '_territory_from_legacy_sv' AND md5(p.prosrc) IN ('b8a0d02700685b5d340c8ab1ebfcec17', 'bdb0723c0257b31fe1aaa2bfc609dd6c'))
           OR (p.proname = '_clinics_territory_sync' AND md5(p.prosrc) IN ('d472f713d7cb54581f0cc7a374c52185', '0cecd35ba759d9fbc84b1f98a82a0202')))) <> 2 THEN
    RAISE EXCEPTION 's7_94 PRE: las funciones de s7_92 no son las aplicadas';
  END IF;

  -- El catalogo sigue cerrado a los clientes.
  IF (SELECT bool_or(has_table_privilege(r.rol, t.tabla, x.priv))
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),
             unnest(ARRAY['public.administrative_units', 'public.countries', 'public.country_levels']) t(tabla),
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)) THEN
    RAISE EXCEPTION 's7_94 PRE: el catalogo tiene privilegios de cliente: STOP';
  END IF;

  RAISE NOTICE 's7_94: guardas PRE OK — catalogo y cierre esperado (888) iguales al preflight, nombres libres, s7_92 en pie';
END $PRE$;


-- ═══════════════════════════════════════════════════════════
-- PASO 2 · EL CIERRE — secciones 1 a 7, en UNA transaccion
-- ═══════════════════════════════════════════════════════════
BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 1. Lock: bloquea escrituras al catalogo, no lecturas ────
LOCK TABLE public.administrative_units IN SHARE ROW EXCLUSIVE MODE;


-- ─── 2. GUARDA bajo lock: huellas del preflight y del estado previo ─
DO $GUARDA$
DECLARE
  v_huella_catalogo CONSTANT text := '460e807050a0da8bea0891965b1b9fd7';
  v_txt text;
BEGIN
  SELECT md5(string_agg(u.id || '|' || u.country_id || '|' || coalesce(u.parent_id::text, 'NULL') || '|' || u.level || '|' || u.is_active,
                        E'\n' ORDER BY u.id))
    INTO v_txt FROM public.administrative_units u;
  IF v_txt IS DISTINCT FROM v_huella_catalogo THEN
    RAISE EXCEPTION 's7_94 GUARDA: la huella del catalogo cambio (%): STOP y repetir preflight', v_txt;
  END IF;
  IF to_regclass('public.administrative_unit_closure') IS NOT NULL
     OR to_regclass('public.au_id_country_level_key') IS NOT NULL THEN
    RAISE EXCEPTION 's7_94 GUARDA: el cierre o su indice unico ya existen — no reaplicar';
  END IF;

  -- Huellas para el POST: nada fuera de los tres objetos nuevos puede cambiar.
  PERFORM set_config('s7_94.catalogo_filas',
    (SELECT md5(string_agg(to_jsonb(u)::text, E'\n' ORDER BY u.id)) FROM public.administrative_units u), true);
  PERFORM set_config('s7_94.clinics_filas',
    (SELECT md5(coalesce(string_agg(to_jsonb(c)::text, E'\n' ORDER BY c.id), '')) FROM public.clinics c), true);
  PERFORM set_config('s7_94.funciones',
    (SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                           || md5(p.prosrc) || coalesce(p.proacl::text, ''), ','
                           ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'), true);
  PERFORM set_config('s7_94.acl_catalogo',
    (SELECT string_agg(relname || '=' || coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity, ';' ORDER BY relname)
       FROM pg_class WHERE oid IN ('public.administrative_units'::regclass, 'public.countries'::regclass, 'public.country_levels'::regclass)), true);
  PERFORM set_config('s7_94.policies',
    (SELECT md5(coalesce(string_agg(tablename || ':' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
                                    ';' ORDER BY tablename, policyname), ''))
       FROM pg_policies WHERE schemaname = 'public'), true);
  PERFORM set_config('s7_94.constraints',
    (SELECT md5(string_agg(con.conrelid::regclass::text || ':' || con.conname || ':' || con.contype::text, ',' ORDER BY con.conrelid::regclass::text, con.conname))
       FROM pg_constraint con WHERE con.connamespace = 'public'::regnamespace), true);
  PERFORM set_config('s7_94.indices',
    (SELECT md5(string_agg(c.relname, ',' ORDER BY c.relname))
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'i'), true);
  PERFORM set_config('s7_94.triggers',
    (SELECT md5(coalesce(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text, ',' ORDER BY t.tgrelid::regclass::text, t.tgname), ''))
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal), true);

  RAISE NOTICE 's7_94 GUARDA: catalogo bloqueado para escritura, huella igual al preflight';
END $GUARDA$;


-- ─── 3. UNIQUE aditiva del catalogo: destino de las FK con nivel ─
CREATE UNIQUE INDEX au_id_country_level_key
  ON public.administrative_units (id, country_id, level);

COMMENT ON INDEX public.au_id_country_level_key IS
  'Destino de las FK con nivel de administrative_unit_closure (s7_94). No se retira sin retirar antes el cierre.';


-- ─── 4. El cierre y su indice inverso ────────────────────────
CREATE TABLE public.administrative_unit_closure (
  country_id         smallint NOT NULL,
  ancestor_unit_id   bigint   NOT NULL,
  ancestor_level     smallint NOT NULL,
  descendant_unit_id bigint   NOT NULL,
  descendant_level   smallint NOT NULL,
  depth              smallint NOT NULL,
  CONSTRAINT administrative_unit_closure_pkey PRIMARY KEY (ancestor_unit_id, descendant_unit_id),
  CONSTRAINT auc_ancestor_fkey
    FOREIGN KEY (ancestor_unit_id, country_id, ancestor_level)
    REFERENCES public.administrative_units (id, country_id, level),
  CONSTRAINT auc_descendant_fkey
    FOREIGN KEY (descendant_unit_id, country_id, descendant_level)
    REFERENCES public.administrative_units (id, country_id, level),
  CONSTRAINT auc_depth_levels_chk CHECK (depth >= 0 AND depth = descendant_level - ancestor_level),
  CONSTRAINT auc_self_iff_depth_0_chk CHECK ((depth = 0) = (ancestor_unit_id = descendant_unit_id))
);

CREATE INDEX auc_descendant_level_idx
  ON public.administrative_unit_closure (descendant_unit_id, ancestor_level) INCLUDE (ancestor_unit_id);

COMMENT ON TABLE public.administrative_unit_closure IS
  'Cierre transitivo DERIVADO de administrative_units (s7_94): una fila por par ancestro/descendiente, '
  'incluida la fila propia (depth 0). Toda escritura al catalogo debe mantenerlo o reconstruirlo y '
  'verificarlo en la misma transaccion. Sin privilegios de cliente: el primer lector se decide en F3E.';


-- ─── 5. Carga desde el arbol vivo: exactamente 888 filas ─────
DO $CARGA$
DECLARE
  v_n bigint;
BEGIN
  INSERT INTO public.administrative_unit_closure
    (country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth)
  WITH RECURSIVE s (country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth) AS (
    SELECT u.country_id, u.id, u.level, u.id, u.level, 0 FROM public.administrative_units u
    UNION ALL
    SELECT s.country_id, p.id, p.level, s.descendant_unit_id, s.descendant_level, s.depth + 1
      FROM s JOIN public.administrative_units x ON x.id = s.ancestor_unit_id
             JOIN public.administrative_units p ON p.id = x.parent_id
     WHERE s.depth < 64
  )
  SELECT country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth FROM s;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 888 THEN
    RAISE EXCEPTION 's7_94 CARGA: se insertaron % filas, se esperaban exactamente 888', v_n;
  END IF;
  RAISE NOTICE 's7_94 CARGA: 888 filas desde el arbol vivo';
END $CARGA$;


-- ─── 6. Seguridad: RLS sin policies y sin privilegios de cliente ─
ALTER TABLE public.administrative_unit_closure ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.administrative_unit_closure FROM PUBLIC, anon, authenticated, service_role;

ANALYZE public.administrative_unit_closure;


-- ─── 7. Guardas POST — DENTRO de la transaccion ──────────────
DO $POST$
DECLARE
  v_huella_catalogo CONSTANT text := '460e807050a0da8bea0891965b1b9fd7';
  v_huella_cierre   CONSTANT text := 'af230f5086d871b1cce24e34de4b6cec';
  v_n     bigint;
  v_txt   text;
  v_con   text;
  v_a     bigint;
  v_b     bigint;
BEGIN
  -- ── 7.1 Forma de la tabla ──
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' ORDER BY a.attnum) INTO v_txt
    FROM pg_attribute a WHERE a.attrelid = 'public.administrative_unit_closure'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_txt IS DISTINCT FROM 'country_id:smallint:true,ancestor_unit_id:bigint:true,ancestor_level:smallint:true,'
                            'descendant_unit_id:bigint:true,descendant_level:smallint:true,depth:smallint:true' THEN
    RAISE EXCEPTION 's7_94 POST: columnas inesperadas (%)', v_txt;
  END IF;
  IF (SELECT pg_get_userbyid(relowner) || '|' || relkind::text || '|' || relpersistence::text FROM pg_class
       WHERE oid = 'public.administrative_unit_closure'::regclass) IS DISTINCT FROM 'postgres|r|p' THEN
    RAISE EXCEPTION 's7_94 POST: dueño, tipo o persistencia inesperados';
  END IF;

  -- ── 7.2 Constraints estructurales ──
  SELECT string_agg(conname || ':' || contype::text, ',' ORDER BY conname) INTO v_txt
    FROM pg_constraint WHERE conrelid = 'public.administrative_unit_closure'::regclass AND contype IN ('p', 'u', 'f', 'c', 'x', 't');
  IF v_txt IS DISTINCT FROM 'administrative_unit_closure_pkey:p,auc_ancestor_fkey:f,auc_depth_levels_chk:c,auc_descendant_fkey:f,auc_self_iff_depth_0_chk:c' THEN
    RAISE EXCEPTION 's7_94 POST: constraints inesperadas (%)', v_txt;
  END IF;
  SELECT string_agg(
           con.conname || '(' ||
           (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(att, ord)
              JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.att) || ')->' ||
           coalesce(con.confrelid::regclass::text, '-') || '(' ||
           coalesce((SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(att, ord)
              JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.att), '-') || ')' ||
           ':' || coalesce(con.conindid::regclass::text, '-') || ':' || con.confupdtype::text || con.confdeltype::text || con.confmatchtype::text ||
           ':' || con.convalidated || ':' || con.condeferrable,
           ' ; ' ORDER BY con.conname) INTO v_txt
    FROM pg_constraint con
   WHERE con.conrelid = 'public.administrative_unit_closure'::regclass AND con.contype IN ('p', 'f');
  IF v_txt IS DISTINCT FROM
       'administrative_unit_closure_pkey(ancestor_unit_id,descendant_unit_id)->-(-):administrative_unit_closure_pkey:   :true:false ; '
       'auc_ancestor_fkey(ancestor_unit_id,country_id,ancestor_level)->administrative_units(id,country_id,level):au_id_country_level_key:aas:true:false ; '
       'auc_descendant_fkey(descendant_unit_id,country_id,descendant_level)->administrative_units(id,country_id,level):au_id_country_level_key:aas:true:false' THEN
    RAISE EXCEPTION 's7_94 POST: PK o FK con forma inesperada (%)', v_txt;
  END IF;

  -- ── 7.3 Indices ──
  SELECT string_agg(
           c.relname || ':' || i.indisunique || ':' || i.indisvalid || ':' || (i.indpred IS NULL) || ':' ||
           (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(i.indkey::int2[]) WITH ORDINALITY k(att, ord)
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.att WHERE k.ord <= i.indnkeyatts) || '+' ||
           coalesce((SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(i.indkey::int2[]) WITH ORDINALITY k(att, ord)
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.att WHERE k.ord > i.indnkeyatts), ''),
           ' ; ' ORDER BY c.relname) INTO v_txt
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid IN ('public.administrative_unit_closure'::regclass, 'public.administrative_units'::regclass)
     AND c.relname IN ('administrative_unit_closure_pkey', 'auc_descendant_level_idx', 'au_id_country_level_key');
  IF v_txt IS DISTINCT FROM
       'administrative_unit_closure_pkey:true:true:true:ancestor_unit_id,descendant_unit_id+ ; '
       'au_id_country_level_key:true:true:true:id,country_id,level+ ; '
       'auc_descendant_level_idx:false:true:true:descendant_unit_id,ancestor_level+ancestor_unit_id' THEN
    RAISE EXCEPTION 's7_94 POST: indices con forma inesperada (%)', v_txt;
  END IF;
  SELECT count(*) INTO v_n FROM pg_index WHERE indrelid = 'public.administrative_unit_closure'::regclass;
  IF v_n <> 2 THEN RAISE EXCEPTION 's7_94 POST: el cierre tiene % indices, se esperaban 2', v_n; END IF;
  IF (SELECT indrelid FROM pg_index WHERE indexrelid = 'public.au_id_country_level_key'::regclass) <> 'public.administrative_units'::regclass THEN
    RAISE EXCEPTION 's7_94 POST: au_id_country_level_key no esta sobre administrative_units';
  END IF;

  -- ── 7.4 Contenido: 888 filas, reparto, huella y filas propias ──
  SELECT count(*) INTO v_n FROM public.administrative_unit_closure;
  IF v_n <> 888 THEN RAISE EXCEPTION 's7_94 POST: el cierre tiene % filas, se esperaban 888', v_n; END IF;
  SELECT string_agg(z.depth || '=' || z.n, ',' ORDER BY z.depth) INTO v_txt
    FROM (SELECT depth, count(*) AS n FROM public.administrative_unit_closure GROUP BY depth) z;
  IF v_txt IS DISTINCT FROM '0=320,1=306,2=262' THEN RAISE EXCEPTION 's7_94 POST: reparto por depth inesperado (%)', v_txt; END IF;
  SELECT md5(string_agg(ancestor_unit_id || '|' || descendant_unit_id || '|' || depth, E'\n' ORDER BY ancestor_unit_id, descendant_unit_id))
    INTO v_txt FROM public.administrative_unit_closure;
  IF v_txt IS DISTINCT FROM v_huella_cierre THEN RAISE EXCEPTION 's7_94 POST: la huella del cierre no es la del preflight (%)', v_txt; END IF;
  SELECT count(*) INTO v_n FROM public.administrative_unit_closure k
    JOIN public.administrative_units u ON u.id = k.descendant_unit_id
   WHERE k.depth = 0 AND k.ancestor_unit_id = k.descendant_unit_id;
  IF v_n <> (SELECT count(*) FROM public.administrative_units) THEN
    RAISE EXCEPTION 's7_94 POST: % filas propias para % unidades', v_n, (SELECT count(*) FROM public.administrative_units);
  END IF;
  SELECT count(*) INTO v_n FROM public.administrative_unit_closure k
    JOIN public.administrative_units a ON a.id = k.ancestor_unit_id
    JOIN public.administrative_units d ON d.id = k.descendant_unit_id
   WHERE a.country_id <> k.country_id OR d.country_id <> k.country_id
      OR a.level <> k.ancestor_level OR d.level <> k.descendant_level;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_94 POST: % filas con pais o niveles distintos de los del catalogo', v_n; END IF;

  -- ── 7.5 Deriva: diferencia simetrica contra un recalculo INDEPENDIENTE (hacia abajo) ──
  WITH RECURSIVE bajada (country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth, ruta, ciclo) AS (
    SELECT u.country_id, u.id, u.level, u.id, u.level, 0, ARRAY[u.id], false FROM public.administrative_units u
    UNION ALL
    SELECT b.country_id, b.ancestor_unit_id, b.ancestor_level, h.id, h.level, b.depth + 1, b.ruta || h.id, h.id = ANY (b.ruta)
      FROM bajada b JOIN public.administrative_units h ON h.parent_id = b.descendant_unit_id
     WHERE NOT b.ciclo AND b.depth < 64
  ),
  esp AS (SELECT country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth FROM bajada WHERE NOT ciclo),
  alm AS (SELECT country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth FROM public.administrative_unit_closure)
  SELECT (SELECT count(*) FROM (SELECT * FROM esp EXCEPT SELECT * FROM alm) f)
       + (SELECT count(*) FROM (SELECT * FROM alm EXCEPT SELECT * FROM esp) s)
       + (SELECT count(*) FROM bajada WHERE ciclo)
    INTO v_n;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_94 POST: deriva del cierre frente al arbol vivo (Z = %)', v_n; END IF;

  -- ── 7.6 Sondas de comportamiento (cada una revertida en su subtransaccion) ──
  -- Hermanos del mismo padre con depth 0: solo viola la fila propia.
  SELECT min(h.id), max(h.id) INTO v_a, v_b FROM public.administrative_units h
   WHERE h.parent_id = (SELECT min(parent_id) FROM public.administrative_units WHERE level = 2);
  v_con := NULL;
  BEGIN
    INSERT INTO public.administrative_unit_closure
      SELECT x.country_id, x.id, x.level, y.id, y.level, 0 FROM public.administrative_units x, public.administrative_units y WHERE x.id = v_a AND y.id = v_b;
    RAISE EXCEPTION 's7_94 sonda aceptada';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
  END;
  IF v_con IS DISTINCT FROM 'auc_self_iff_depth_0_chk' THEN RAISE EXCEPTION 's7_94 POST: sonda fila propia rechazada por % en vez de auc_self_iff_depth_0_chk', coalesce(v_con, '(nada)'); END IF;

  -- Raiz y hoja de OTRA rama: pares que no existen en el cierre.
  SELECT r.id, h.id INTO v_a, v_b
    FROM public.administrative_units r, public.administrative_units h
   WHERE r.level = 1 AND h.level = 3 AND r.country_id = h.country_id
     AND NOT EXISTS (SELECT 1 FROM public.administrative_unit_closure k WHERE k.ancestor_unit_id = r.id AND k.descendant_unit_id = h.id)
   ORDER BY r.id, h.id LIMIT 1;
  -- depth incoherente con los niveles: solo viola auc_depth_levels_chk.
  v_con := NULL;
  BEGIN
    INSERT INTO public.administrative_unit_closure
      SELECT x.country_id, x.id, x.level, y.id, y.level, 1 FROM public.administrative_units x, public.administrative_units y WHERE x.id = v_a AND y.id = v_b;
    RAISE EXCEPTION 's7_94 sonda aceptada';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
  END;
  IF v_con IS DISTINCT FROM 'auc_depth_levels_chk' THEN RAISE EXCEPTION 's7_94 POST: sonda depth rechazada por % en vez de auc_depth_levels_chk', coalesce(v_con, '(nada)'); END IF;
  -- nivel del ancestro falso (coherente con depth): solo viola auc_ancestor_fkey.
  v_con := NULL;
  BEGIN
    INSERT INTO public.administrative_unit_closure
      SELECT x.country_id, x.id, x.level + 1, y.id, y.level, y.level - x.level - 1 FROM public.administrative_units x, public.administrative_units y WHERE x.id = v_a AND y.id = v_b;
    RAISE EXCEPTION 's7_94 sonda aceptada';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
  END;
  IF v_con IS DISTINCT FROM 'auc_ancestor_fkey' THEN RAISE EXCEPTION 's7_94 POST: sonda nivel de ancestro rechazada por % en vez de auc_ancestor_fkey', coalesce(v_con, '(nada)'); END IF;
  -- nivel del descendiente falso (coherente con depth): solo viola auc_descendant_fkey.
  v_con := NULL;
  BEGIN
    INSERT INTO public.administrative_unit_closure
      SELECT x.country_id, x.id, x.level, y.id, y.level - 1, y.level - x.level - 1 FROM public.administrative_units x, public.administrative_units y WHERE x.id = v_a AND y.id = v_b;
    RAISE EXCEPTION 's7_94 sonda aceptada';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
  END;
  IF v_con IS DISTINCT FROM 'auc_descendant_fkey' THEN RAISE EXCEPTION 's7_94 POST: sonda nivel de descendiente rechazada por % en vez de auc_descendant_fkey', coalesce(v_con, '(nada)'); END IF;
  -- par duplicado: viola la PK.
  v_con := NULL;
  BEGIN
    INSERT INTO public.administrative_unit_closure
      SELECT country_id, ancestor_unit_id, ancestor_level, descendant_unit_id, descendant_level, depth
        FROM public.administrative_unit_closure ORDER BY ancestor_unit_id, descendant_unit_id LIMIT 1;
    RAISE EXCEPTION 's7_94 sonda aceptada';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
  END;
  IF v_con IS DISTINCT FROM 'administrative_unit_closure_pkey' THEN RAISE EXCEPTION 's7_94 POST: sonda par duplicado rechazada por % en vez de la PK', coalesce(v_con, '(nada)'); END IF;
  -- Las sondas no dejaron nada.
  SELECT md5(string_agg(ancestor_unit_id || '|' || descendant_unit_id || '|' || depth, E'\n' ORDER BY ancestor_unit_id, descendant_unit_id))
    INTO v_txt FROM public.administrative_unit_closure;
  IF v_txt IS DISTINCT FROM v_huella_cierre OR (SELECT count(*) FROM public.administrative_unit_closure) <> 888 THEN
    RAISE EXCEPTION 's7_94 POST: las sondas dejaron residuos en el cierre';
  END IF;

  -- ── 7.7 Seguridad del cierre ──
  SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity INTO v_txt
    FROM pg_class WHERE oid = 'public.administrative_unit_closure'::regclass;
  IF v_txt IS DISTINCT FROM '{postgres=arwdDxtm/postgres}|true|false' THEN
    RAISE EXCEPTION 's7_94 POST: privilegios o RLS del cierre inesperados (%)', v_txt;
  END IF;
  IF (SELECT bool_or(has_table_privilege(r.rol, 'public.administrative_unit_closure', x.priv))
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol),
             unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) x(priv)) THEN
    RAISE EXCEPTION 's7_94 POST: un rol cliente tiene privilegios sobre el cierre';
  END IF;
  SELECT count(*) INTO v_n FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'administrative_unit_closure' AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC');
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_94 POST: % privilegios de columna de cliente sobre el cierre', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'administrative_unit_closure';
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_94 POST: % policies sobre el cierre', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_trigger WHERE tgrelid = 'public.administrative_unit_closure'::regclass AND NOT tgisinternal;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_94 POST: % triggers de usuario sobre el cierre', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'administrative_unit_closure';
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_94 POST: el cierre esta en % publicaciones', v_n; END IF;

  -- ── 7.8 Nada mas cambio ──
  SELECT md5(string_agg(u.id || '|' || u.country_id || '|' || coalesce(u.parent_id::text, 'NULL') || '|' || u.level || '|' || u.is_active,
                        E'\n' ORDER BY u.id))
    INTO v_txt FROM public.administrative_units u;
  IF v_txt IS DISTINCT FROM v_huella_catalogo THEN RAISE EXCEPTION 's7_94 POST: cambio la huella del catalogo'; END IF;
  IF (SELECT md5(string_agg(to_jsonb(u)::text, E'\n' ORDER BY u.id)) FROM public.administrative_units u) IS DISTINCT FROM current_setting('s7_94.catalogo_filas') THEN
    RAISE EXCEPTION 's7_94 POST: cambio alguna fila del catalogo';
  END IF;
  IF (SELECT md5(coalesce(string_agg(to_jsonb(c)::text, E'\n' ORDER BY c.id), '')) FROM public.clinics c) IS DISTINCT FROM current_setting('s7_94.clinics_filas') THEN
    RAISE EXCEPTION 's7_94 POST: cambio alguna fila de clinics';
  END IF;
  IF (SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                            || md5(p.prosrc) || coalesce(p.proacl::text, ''), ','
                            ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)))
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') IS DISTINCT FROM current_setting('s7_94.funciones') THEN
    RAISE EXCEPTION 's7_94 POST: cambio o se creo alguna funcion de public';
  END IF;
  IF (SELECT string_agg(relname || '=' || coalesce(relacl::text, 'NULL') || '|' || relrowsecurity || '|' || relforcerowsecurity, ';' ORDER BY relname)
        FROM pg_class WHERE oid IN ('public.administrative_units'::regclass, 'public.countries'::regclass, 'public.country_levels'::regclass))
     IS DISTINCT FROM current_setting('s7_94.acl_catalogo') THEN
    RAISE EXCEPTION 's7_94 POST: cambiaron los privilegios o la RLS del catalogo';
  END IF;
  IF (SELECT md5(coalesce(string_agg(tablename || ':' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
                                     ';' ORDER BY tablename, policyname), ''))
        FROM pg_policies WHERE schemaname = 'public') IS DISTINCT FROM current_setting('s7_94.policies') THEN
    RAISE EXCEPTION 's7_94 POST: cambio alguna policy de public';
  END IF;
  IF (SELECT md5(string_agg(con.conrelid::regclass::text || ':' || con.conname || ':' || con.contype::text, ',' ORDER BY con.conrelid::regclass::text, con.conname))
        FROM pg_constraint con WHERE con.connamespace = 'public'::regnamespace
         AND con.conrelid <> 'public.administrative_unit_closure'::regclass) IS DISTINCT FROM current_setting('s7_94.constraints') THEN
    RAISE EXCEPTION 's7_94 POST: cambio alguna constraint fuera del cierre';
  END IF;
  IF (SELECT md5(string_agg(c.relname, ',' ORDER BY c.relname))
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'i'
         AND c.relname NOT IN ('administrative_unit_closure_pkey', 'auc_descendant_level_idx', 'au_id_country_level_key')) IS DISTINCT FROM current_setting('s7_94.indices') THEN
    RAISE EXCEPTION 's7_94 POST: cambio algun indice fuera de los tres nuevos';
  END IF;
  IF (SELECT md5(coalesce(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text, ',' ORDER BY t.tgrelid::regclass::text, t.tgname), ''))
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT t.tgisinternal) IS DISTINCT FROM current_setting('s7_94.triggers') THEN
    RAISE EXCEPTION 's7_94 POST: cambio algun trigger de public';
  END IF;

  -- ── 7.9 Los rollbacks de s7_93 y s7_92 siguen siendo ejecutables ──
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
     AND p.prosrc ~ '\m(country_id|territory_unit_id|administrative_units|country_levels)\M';
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_94 POST: % funciones invalidarian los rollbacks de s7_93 y s7_92', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_depend d
   WHERE d.classid = 'pg_rewrite'::regclass
     AND d.refobjid IN ('public.administrative_units'::regclass, 'public.countries'::regclass,
                        'public.country_levels'::regclass, 'public.administrative_unit_closure'::regclass);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_94 POST: % dependencias de vistas sobre el modelo nuevo', v_n; END IF;

  RAISE NOTICE 's7_94: guardas POST OK — 888 filas iguales al preflight, sin deriva, constraints y sondas OK, sin acceso cliente, nada mas cambio';
END $POST$;


COMMIT;
-- ═══════════════════════════════════════════════════════════
-- FIN DEL PASO 2.
-- Todo corre DENTRO de la transaccion: si cualquier guarda lanza, se revierte
-- entero y no queda ni el cierre ni el indice unico del catalogo.
-- ═══════════════════════════════════════════════════════════
