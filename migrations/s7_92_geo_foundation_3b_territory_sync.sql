-- ============================================================
-- s7_92 · MULTICOUNTRY-GEO-P0 · FUNDACION 3B · paso 3 de 3
-- Sincronizacion central legacy -> modelo territorial nuevo en clinics
-- ============================================================
--
-- Migracion 113. Instala en la base:
--   · public._territory_from_legacy_sv(text, text)  -- resolver UNICO legacy -> modelo nuevo
--   · public._clinics_territory_sync()              -- funcion del trigger
--   · trg_clinics_territory_sync ON public.clinics  -- BEFORE INSERT OR UPDATE OF las 4 columnas
-- y retira la guarda temporal de F3A (clinics_geo_f3a_temp_null_chk) en la
-- MISMA transaccion, despues de instalar y probar la sincronizacion.
--
-- ── REGLAS (decisiones cerradas del owner) ──
--   · el legacy (department_id / municipality_id) es la UNICA autoridad de escritura;
--   · sin ubicacion legacy -> country_id y territory_unit_id NULL;
--   · solo departamento -> SV + unidad de nivel 1;
--   · departamento + municipio coherentes -> SV + unidad de nivel 3;
--   · NUNCA se deriva nivel 2;
--   · municipio sin departamento -> P0024; municipio inexistente o de otro
--     departamento -> P0025 (misma semantica que s7_91); departamento
--     inexistente -> P0026; puente del catalogo ausente -> P0180;
--   · intento de fijar country_id / territory_unit_id en contradiccion con el
--     legacy -> P0183. «Intento» = valor distinto del anterior en UPDATE, o no
--     NULL en INSERT (E1). Los valores anteriores reenviados junto a un cambio
--     legacy se RECALCULAN, no se rechazan;
--   · los valores del cliente NUNCA son autoridad: aunque coincidan, el trigger
--     asigna siempre los calculados por el resolver (E2);
--   · UPDATE que no cambia ninguna de las 4 columnas: no toca nada (sin backfill);
--   · trigger NORMAL, sin ENABLE ALWAYS (D4);
--   · SV se resuelve por iso_alpha2; las unidades por (country_id, legacy_id). Sin ids fijos.
--
-- ── SEGURIDAD ──
--   · SECURITY DEFINER SOLO en la funcion del trigger: quien escribe clinics
--     (authenticated, service_role) no tiene SELECT sobre administrative_units ni
--     countries, y no debe tenerlo. El resolver es SECURITY INVOKER.
--   · Ambas con SET search_path = public, pg_temp y TODAS las tablas calificadas public.*
--   · Preflight H del 2026-09-13: anon, authenticated y PUBLIC SIN CREATE en public.
--   · Los privilegios por defecto de la plataforma dan EXECUTE en toda funcion nueva
--     a anon, authenticated y service_role: se revoca EXPLICITAMENTE a los cuatro roles.
--   · Cero grants nuevos al catalogo. Grants, policies y RLS de clinics sin cambios.
--
-- ── QUE NO HACE ──
-- Sin backfill: ninguna fila de clinics se lee para escribir ni se escribe (las
-- 95 sin ubicacion y las 23 con ubicacion siguen con geo NULL). Sin F3C. No toca
-- profiles, doctor_affiliation_requests, lectores, directorio, filtros, UI ni SEO.
-- Sin telefonos. Sin ENABLE ALWAYS.
--
-- ── PRUEBAS SIN TOCAR CLINICAS REALES ──
-- Resolver exhaustivo (14 departamentos + 262 municipios, 0 nivel 2) y una TABLA
-- SONDA transaccional con el MISMO trigger: se crea, se prueba (incluido
-- SET LOCAL ROLE authenticated) y se borra antes del COMMIT. Nunca se comitea.
--
-- ── LOCK ──
-- SET LOCAL lock_timeout = 5s. El ACCESS EXCLUSIVE sobre clinics se toma AL FINAL,
-- despues de las pruebas: el directorio solo espera GUARDA -> trigger -> retiro de
-- la guarda -> POST. Si no se obtiene en 5 s, la migracion aborta sin cambios.
--
-- ── COMO APLICARLA ──
-- BLOQUES AUTONOMOS, cada uno pegado ENTERO en una pestaña nueva:
--   PASO 1 = seccion 0      · guardas PRE · solo lectura
--   PASO 2 = secciones 1-9  · BEGIN -> ... -> POST -> COMMIT
-- Si el PASO 1 lanza excepcion, NO continuar.


-- ─── 0. Guardas PRE (solo lectura) ──────────────────────────
DO $PRE$
DECLARE
  v_n   bigint;
  v_txt text;
BEGIN
  -- F3A en pie: guarda y CHECK estructural validados, columnas vacias.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'clinics_geo_f3a_temp_null_chk'
                    AND conrelid = 'public.clinics'::regclass AND convalidated) THEN
    RAISE EXCEPTION 's7_92 PRE: la guarda temporal de F3A no esta en pie — no reaplicar';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'clinics_territory_requires_country_chk'
                    AND conrelid = 'public.clinics'::regclass AND convalidated) THEN
    RAISE EXCEPTION 's7_92 PRE: falta el CHECK estructural de F3A';
  END IF;
  SELECT count(*) INTO v_n FROM public.clinics WHERE country_id IS NOT NULL OR territory_unit_id IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_92 PRE: % clinicas con columnas territoriales nuevas', v_n; END IF;

  -- Datos legacy validos: con el trigger, re-guardar una fila invalida fallaria.
  SELECT count(*) INTO v_n
    FROM public.clinics c LEFT JOIN public.municipalities m ON m.id = c.municipality_id
   WHERE c.municipality_id IS NOT NULL
     AND (c.department_id IS NULL OR m.department_id IS DISTINCT FROM c.department_id);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_92 PRE: % clinicas con par legacy incoherente', v_n; END IF;
  SELECT count(*) INTO v_n
    FROM public.clinics c
   WHERE c.department_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.id = c.department_id);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_92 PRE: % clinicas con departamento inexistente', v_n; END IF;

  -- Puente completo y sin nivel 2.
  IF (SELECT count(*) FROM public.countries WHERE iso_alpha2 = 'SV') <> 1 THEN
    RAISE EXCEPTION 's7_92 PRE: el pais SV no esta configurado exactamente una vez';
  END IF;
  SELECT count(*) INTO v_n FROM public.departments d
   WHERE NOT EXISTS (SELECT 1 FROM public.administrative_units u JOIN public.countries c ON c.id = u.country_id
                      WHERE c.iso_alpha2 = 'SV' AND u.level = 1 AND u.legacy_id = d.id);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_92 PRE: % departamentos sin unidad de nivel 1', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.municipalities m
   WHERE NOT EXISTS (
     SELECT 1 FROM public.administrative_units u3
       JOIN public.administrative_units u2 ON u2.id = u3.parent_id
       JOIN public.administrative_units u1 ON u1.id = u2.parent_id
       JOIN public.countries c ON c.id = u3.country_id
      WHERE c.iso_alpha2 = 'SV' AND u3.level = 3 AND u3.legacy_id = m.id
        AND u1.level = 1 AND u1.legacy_id = m.department_id);
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_92 PRE: % municipios sin unidad de nivel 3 bajo su departamento', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.administrative_units WHERE level = 2 AND legacy_id IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_92 PRE: % unidades de nivel 2 con legacy_id', v_n; END IF;

  -- clinics: solo el trigger de updated_at, sin reglas.
  SELECT coalesce(string_agg(tgname::text, ',' ORDER BY tgname), '') INTO v_txt
    FROM pg_trigger WHERE tgrelid = 'public.clinics'::regclass AND NOT tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_updated_at' THEN
    RAISE EXCEPTION 's7_92 PRE: triggers inesperados en clinics (%)', v_txt;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class = 'public.clinics'::regclass) THEN
    RAISE EXCEPTION 's7_92 PRE: clinics tiene reglas';
  END IF;

  -- Secuencia de F3B: s7_90 y s7_91 aplicadas.
  IF NOT EXISTS (SELECT 1 FROM public.municipalities WHERE id = 'CH-16' AND name = 'San Miguel de Mercedes') THEN
    RAISE EXCEPTION 's7_92 PRE: s7_90 no esta aplicada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'admin_approve_and_create_doctor'
                    AND md5(p.prosrc) IN ('a249f92a4b7d3388ee49a11f56edb4b3', 'd36698a985b73a457b87bfa12b23cb75')) THEN
    RAISE EXCEPTION 's7_92 PRE: s7_91 no esta aplicada';
  END IF;

  -- Nombres y codigos libres.
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('_territory_from_legacy_sv', '_clinics_territory_sync'))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_clinics_territory_sync')
     OR EXISTS (SELECT 1 FROM pg_class WHERE relname = '_s7_92_probe') THEN
    RAISE EXCEPTION 's7_92 PRE: ya existen objetos de s7_92 — no reaplicar';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE prosrc ~ 'P0026|P0180|P0183') THEN
    RAISE EXCEPTION 's7_92 PRE: P0026/P0180/P0183 ya se usan en alguna funcion';
  END IF;

  -- Roles y esquema: requisitos del SECURITY DEFINER y de la sonda.
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 's7_92 PRE: aplicar como postgres (current_user=%)', current_user;
  END IF;
  IF (SELECT count(DISTINCT relowner) FROM pg_class
       WHERE oid IN ('public.clinics'::regclass, 'public.administrative_units'::regclass,
                     'public.countries'::regclass, 'public.municipalities'::regclass,
                     'public.departments'::regclass)) <> 1
     OR (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.clinics'::regclass) <> 'postgres' THEN
    RAISE EXCEPTION 's7_92 PRE: las tablas implicadas no son todas de postgres';
  END IF;
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'postgres') THEN
    RAISE EXCEPTION 's7_92 PRE: postgres sin bypassrls';
  END IF;
  IF NOT pg_has_role(current_user, 'authenticated', 'MEMBER') THEN
    RAISE EXCEPTION 's7_92 PRE: postgres no es miembro de authenticated (la sonda lo necesita)';
  END IF;
  IF has_schema_privilege('anon', 'public', 'CREATE')
     OR has_schema_privilege('authenticated', 'public', 'CREATE')
     OR EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a
                 WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE') THEN
    RAISE EXCEPTION 's7_92 PRE: un rol cliente puede crear objetos en public — STOP';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(rol),
                           unnest(ARRAY['public.administrative_units', 'public.countries']) AS t(tabla)
              WHERE has_table_privilege(r.rol, t.tabla, 'SELECT')) THEN
    RAISE EXCEPTION 's7_92 PRE: un rol cliente tiene SELECT sobre el catalogo nuevo';
  END IF;

  RAISE NOTICE 's7_92: guardas PRE OK — F3A en pie, legacy valido, puente completo, nombres libres, sin CREATE de cliente en public';
END $PRE$;


-- ═══════════════════════════════════════════════════════════
-- PASO 2 · EL CAMBIO — secciones 1 a 9, en UNA transaccion
-- ═══════════════════════════════════════════════════════════
BEGIN;

SET LOCAL lock_timeout = '5s';


-- ─── 1. Huellas iniciales ────────────────────────────────────
DO $INICIO$
BEGIN
  PERFORM set_config('s7_92.otras_funciones',
    (SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                           || md5(p.prosrc) || coalesce(p.proacl::text, ''), ','
                           ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'), true);
  PERFORM set_config('s7_92.acl_catalogo',
    (SELECT string_agg(c.relname || '=' || coalesce(c.relacl::text, 'NULL'), ';' ORDER BY c.relname)
       FROM pg_class c
      WHERE c.oid IN ('public.administrative_units'::regclass, 'public.countries'::regclass,
                      'public.country_levels'::regclass)), true);
END $INICIO$;


-- ─── 2. Resolver unico legacy -> modelo nuevo ────────────────
CREATE FUNCTION public._territory_from_legacy_sv(
  p_department_id   text,
  p_municipality_id text,
  OUT country_id        smallint,
  OUT territory_unit_id bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_sv   smallint;
  v_unit bigint;
BEGIN
  -- Sin ubicacion legacy: sin pais ni unidad.
  IF p_department_id IS NULL AND p_municipality_id IS NULL THEN
    RETURN;
  END IF;

  IF p_department_id IS NULL THEN
    RAISE EXCEPTION 'El municipio no puede quedar sin departamento' USING ERRCODE = 'P0024';
  END IF;

  PERFORM 1 FROM public.departments d WHERE d.id = p_department_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El departamento no existe' USING ERRCODE = 'P0026';
  END IF;

  SELECT c.id INTO v_sv FROM public.countries c WHERE c.iso_alpha2 = 'SV';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Catalogo territorial incompleto: pais no configurado' USING ERRCODE = 'P0180';
  END IF;

  IF p_municipality_id IS NULL THEN
    -- Solo departamento: unidad de nivel 1.
    SELECT u.id INTO v_unit
      FROM public.administrative_units u
     WHERE u.country_id = v_sv AND u.legacy_id = p_department_id AND u.level = 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Catalogo territorial incompleto: departamento sin unidad' USING ERRCODE = 'P0180';
    END IF;
  ELSE
    PERFORM 1 FROM public.municipalities m
     WHERE m.id = p_municipality_id AND m.department_id = p_department_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El municipio no existe o no pertenece al departamento indicado' USING ERRCODE = 'P0025';
    END IF;
    -- Departamento + municipio: unidad de nivel 3 cuyo abuelo de nivel 1 es ese departamento.
    SELECT u3.id INTO v_unit
      FROM public.administrative_units u3
      JOIN public.administrative_units u2 ON u2.id = u3.parent_id
      JOIN public.administrative_units u1 ON u1.id = u2.parent_id
     WHERE u3.country_id = v_sv AND u3.legacy_id = p_municipality_id AND u3.level = 3
       AND u1.level = 1 AND u1.legacy_id = p_department_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Catalogo territorial incompleto: municipio sin unidad' USING ERRCODE = 'P0180';
    END IF;
  END IF;

  country_id        := v_sv;
  territory_unit_id := v_unit;
END;
$fn$;

REVOKE ALL ON FUNCTION public._territory_from_legacy_sv(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._territory_from_legacy_sv(text, text) FROM anon;
REVOKE ALL ON FUNCTION public._territory_from_legacy_sv(text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public._territory_from_legacy_sv(text, text) FROM service_role;

COMMENT ON FUNCTION public._territory_from_legacy_sv(text, text) IS
  'Resolver UNICO legacy -> modelo territorial nuevo (s7_92). Sin ubicacion -> NULL; '
  'solo departamento -> SV + nivel 1; departamento + municipio -> SV + nivel 3; nunca nivel 2. '
  'P0024 municipio sin departamento, P0025 municipio inexistente o de otro departamento, '
  'P0026 departamento inexistente, P0180 catalogo incompleto. SECURITY INVOKER, sin EXECUTE de clientes.';


-- ─── 3. Funcion del trigger ──────────────────────────────────
CREATE FUNCTION public._clinics_territory_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r              record;
  v_fija_pais    boolean;
  v_fija_unidad  boolean;
BEGIN
  -- UPDATE que no cambia ninguna de las 4 columnas: no se toca nada (sin backfill).
  IF TG_OP = 'UPDATE' THEN
    IF NEW.department_id     IS NOT DISTINCT FROM OLD.department_id
       AND NEW.municipality_id   IS NOT DISTINCT FROM OLD.municipality_id
       AND NEW.country_id        IS NOT DISTINCT FROM OLD.country_id
       AND NEW.territory_unit_id IS NOT DISTINCT FROM OLD.territory_unit_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- El legacy manda: derivar (los errores del legacy salen antes que la contradiccion).
  SELECT t.country_id, t.territory_unit_id INTO r
    FROM public._territory_from_legacy_sv(NEW.department_id, NEW.municipality_id) AS t;

  -- Intento explicito sobre las columnas nuevas: no NULL en INSERT; distinto del anterior en UPDATE.
  IF TG_OP = 'INSERT' THEN
    v_fija_pais   := NEW.country_id IS NOT NULL;
    v_fija_unidad := NEW.territory_unit_id IS NOT NULL;
  ELSE
    v_fija_pais   := NEW.country_id IS DISTINCT FROM OLD.country_id;
    v_fija_unidad := NEW.territory_unit_id IS DISTINCT FROM OLD.territory_unit_id;
  END IF;

  IF (v_fija_pais AND NEW.country_id IS DISTINCT FROM r.country_id)
     OR (v_fija_unidad AND NEW.territory_unit_id IS DISTINCT FROM r.territory_unit_id) THEN
    RAISE EXCEPTION 'Las columnas territoriales se derivan de la ubicacion legacy y no admiten otro valor'
      USING ERRCODE = 'P0183';
  END IF;

  -- El valor del cliente nunca es autoridad: se asigna SIEMPRE el calculado.
  NEW.country_id        := r.country_id;
  NEW.territory_unit_id := r.territory_unit_id;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public._clinics_territory_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._clinics_territory_sync() FROM anon;
REVOKE ALL ON FUNCTION public._clinics_territory_sync() FROM authenticated;
REVOKE ALL ON FUNCTION public._clinics_territory_sync() FROM service_role;

COMMENT ON FUNCTION public._clinics_territory_sync() IS
  'Trigger de sincronizacion de clinics (s7_92): deriva country_id / territory_unit_id del legacy y '
  'rechaza con P0183 cualquier intento contradictorio. Unica SECURITY DEFINER del frente; '
  'search_path fijo, sin EXECUTE de clientes.';


-- ─── 4. Pruebas A: resolver puro, exhaustivo, sin escrituras ─
DO $RESOLVER$
DECLARE
  v_sv      smallint;
  v_d2      text;
  v_m2      text;
  r         record;
  d         record;
  m         record;
  c         record;
  v_nivel   smallint;
  v_legacy  text;
  v_abuelo  text;
  v_n1      int := 0;
  v_n3      int := 0;
  v_nivel2  int := 0;
  v_estado  text;
  v_fallos  text := '';
BEGIN
  SELECT co.id INTO v_sv FROM public.countries co WHERE co.iso_alpha2 = 'SV';
  SELECT dd.id INTO v_d2 FROM public.departments dd
   WHERE dd.id <> 'CH' AND EXISTS (SELECT 1 FROM public.municipalities mm WHERE mm.department_id = dd.id)
   ORDER BY dd.id LIMIT 1;
  SELECT mm.id INTO v_m2 FROM public.municipalities mm WHERE mm.department_id = v_d2 ORDER BY mm.id LIMIT 1;

  -- Los 14 departamentos solos -> nivel 1 con su legacy_id.
  FOR d IN SELECT dd.id FROM public.departments dd ORDER BY dd.id LOOP
    SELECT t.country_id, t.territory_unit_id INTO r FROM public._territory_from_legacy_sv(d.id, NULL) AS t;
    SELECT u.level, u.legacy_id INTO v_nivel, v_legacy FROM public.administrative_units u WHERE u.id = r.territory_unit_id;
    IF r.country_id IS DISTINCT FROM v_sv OR v_nivel IS DISTINCT FROM 1 OR v_legacy IS DISTINCT FROM d.id THEN
      v_fallos := v_fallos || format(' [departamento %s]', d.id);
    END IF;
    IF v_nivel = 2 THEN v_nivel2 := v_nivel2 + 1; END IF;
    v_n1 := v_n1 + 1;
  END LOOP;

  -- Los 262 pares legacy -> nivel 3 con su legacy_id y el abuelo correcto.
  FOR m IN SELECT mm.id, mm.department_id FROM public.municipalities mm ORDER BY mm.id LOOP
    SELECT t.country_id, t.territory_unit_id INTO r FROM public._territory_from_legacy_sv(m.department_id, m.id) AS t;
    SELECT u3.level, u3.legacy_id, u1.legacy_id INTO v_nivel, v_legacy, v_abuelo
      FROM public.administrative_units u3
      JOIN public.administrative_units u2 ON u2.id = u3.parent_id
      JOIN public.administrative_units u1 ON u1.id = u2.parent_id
     WHERE u3.id = r.territory_unit_id;
    IF r.country_id IS DISTINCT FROM v_sv OR v_nivel IS DISTINCT FROM 3
       OR v_legacy IS DISTINCT FROM m.id OR v_abuelo IS DISTINCT FROM m.department_id THEN
      v_fallos := v_fallos || format(' [municipio %s]', m.id);
    END IF;
    IF v_nivel = 2 THEN v_nivel2 := v_nivel2 + 1; END IF;
    v_n3 := v_n3 + 1;
  END LOOP;

  IF v_n1 <> 14 OR v_n3 <> 262 OR v_nivel2 <> 0 THEN
    v_fallos := v_fallos || format(' [resoluciones: nivel1=%s nivel3=%s nivel2=%s]', v_n1, v_n3, v_nivel2);
  END IF;

  -- Sin ubicacion -> NULL, NULL.
  SELECT t.country_id, t.territory_unit_id INTO r FROM public._territory_from_legacy_sv(NULL, NULL) AS t;
  IF r.country_id IS NOT NULL OR r.territory_unit_id IS NOT NULL THEN
    v_fallos := v_fallos || ' [sin ubicacion no dio NULL]';
  END IF;

  -- Errores exactos.
  FOR c IN SELECT * FROM (VALUES
      ('P0024', NULL::text, 'CH-16'::text),
      ('P0025', 'CH',       v_m2),
      ('P0025', 'CH',       'XX-99'),
      ('P0026', 'ZZ',       NULL::text)
    ) AS t(esperado, dep, mun)
  LOOP
    BEGIN
      PERFORM public._territory_from_legacy_sv(c.dep, c.mun);
      v_estado := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_estado := SQLSTATE;
    END;
    IF v_estado IS DISTINCT FROM c.esperado THEN
      v_fallos := v_fallos || format(' [error (%s,%s): %s, esperaba %s]', c.dep, c.mun, v_estado, c.esperado);
    END IF;
  END LOOP;

  -- Negativos de privilegio: authenticated no ejecuta el resolver ni lee el catalogo.
  -- El privilegio se exige directamente: el negativo conductual daria 42501 igual
  -- si EXECUTE siguiera concedido, porque el resolver es INVOKER y fallaria al leer el catalogo.
  IF has_function_privilege('authenticated', 'public._territory_from_legacy_sv(text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._territory_from_legacy_sv(text, text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public._territory_from_legacy_sv(text, text)', 'EXECUTE') THEN
    v_fallos := v_fallos || ' [un rol cliente conserva EXECUTE sobre el resolver]';
  END IF;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public._territory_from_legacy_sv('CH', 'CH-16');
    v_estado := 'OK';
  EXCEPTION WHEN OTHERS THEN
    v_estado := SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF v_estado IS DISTINCT FROM '42501' THEN
    v_fallos := v_fallos || format(' [authenticated ejecuto el resolver: %s]', v_estado);
  END IF;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM 1 FROM public.administrative_units LIMIT 1;
    v_estado := 'OK';
  EXCEPTION WHEN OTHERS THEN
    v_estado := SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF v_estado IS DISTINCT FROM '42501' THEN
    v_fallos := v_fallos || format(' [authenticated leyo administrative_units: %s]', v_estado);
  END IF;

  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 's7_92 RESOLVER: el rol no volvio a postgres (%)', current_user;
  END IF;
  IF v_fallos <> '' THEN
    RAISE EXCEPTION 's7_92 RESOLVER FAIL:%', v_fallos;
  END IF;
  RAISE NOTICE 's7_92 RESOLVER: 14 nivel 1 + 262 nivel 3, 0 nivel 2, errores exactos, authenticated sin acceso';
END $RESOLVER$;


-- ─── 5. Pruebas B: TABLA SONDA transaccional con el MISMO trigger ─
CREATE TABLE public._s7_92_probe (
  id                integer PRIMARY KEY,
  nota              text,
  department_id     text,
  municipality_id   text,
  country_id        smallint,
  territory_unit_id bigint
);
-- Sonda efimera: sin RLS explicita (por si la plataforma la activa sola) y solo authenticated.
ALTER TABLE public._s7_92_probe DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._s7_92_probe FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public._s7_92_probe TO authenticated;

-- Filas «historicas»: ubicacion legacy y geo NULL, insertadas ANTES del trigger.
INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES
  (1, 'CH', 'CH-16'), (2, 'CH', 'CH-16'), (3, 'CH', 'CH-16'),
  (4, NULL, NULL),    (5, 'CH', 'CH-16'), (6, 'CH', 'CH-16');

CREATE TRIGGER trg_s7_92_probe_sync
  BEFORE INSERT OR UPDATE OF department_id, municipality_id, country_id, territory_unit_id
  ON public._s7_92_probe
  FOR EACH ROW EXECUTE FUNCTION public._clinics_territory_sync();

DO $SONDA$
DECLARE
  v_sv     smallint;
  v_d2     text;
  v_m2     text;
  v_u_ch   bigint;
  v_u_ch16 bigint;
  v_u_n2   bigint;
  v_u_m2   bigint;
  v_casos  jsonb;
  c        jsonb;
  v_obt    text;
  v_n      int := 0;
  v_fallos text := '';
  e_ch16   text;
  e_ch     text;
  e_m2     text;
BEGIN
  SELECT co.id INTO v_sv FROM public.countries co WHERE co.iso_alpha2 = 'SV';
  SELECT dd.id INTO v_d2 FROM public.departments dd
   WHERE dd.id <> 'CH' AND EXISTS (SELECT 1 FROM public.municipalities mm WHERE mm.department_id = dd.id)
   ORDER BY dd.id LIMIT 1;
  SELECT mm.id INTO v_m2 FROM public.municipalities mm WHERE mm.department_id = v_d2 ORDER BY mm.id LIMIT 1;
  SELECT u.id INTO v_u_ch   FROM public.administrative_units u WHERE u.country_id = v_sv AND u.legacy_id = 'CH';
  SELECT u.id, u.parent_id INTO v_u_ch16, v_u_n2 FROM public.administrative_units u WHERE u.country_id = v_sv AND u.legacy_id = 'CH-16';
  SELECT u.id INTO v_u_m2   FROM public.administrative_units u WHERE u.country_id = v_sv AND u.legacy_id = v_m2;
  IF v_sv IS NULL OR v_d2 IS NULL OR v_m2 IS NULL OR v_u_ch IS NULL OR v_u_ch16 IS NULL OR v_u_n2 IS NULL OR v_u_m2 IS NULL THEN
    RAISE EXCEPTION 's7_92 SONDA: datos de prueba no disponibles';
  END IF;
  e_ch16 := format('%s|%s', v_sv, v_u_ch16);
  e_ch   := format('%s|%s', v_sv, v_u_ch);
  e_m2   := format('%s|%s', v_sv, v_u_m2);

  -- [etiqueta, rol, fila, sentencia, esperado]
  v_casos := jsonb_build_array(
    -- INSERT
    jsonb_build_array('I1 sin ubicacion', 'postgres', 101, 'INSERT INTO public._s7_92_probe (id) VALUES (101)', 'NULL|NULL'),
    jsonb_build_array('I2 solo departamento', 'postgres', 102, format('INSERT INTO public._s7_92_probe (id, department_id) VALUES (102, %L)', 'CH'), e_ch),
    jsonb_build_array('I3 departamento + municipio', 'postgres', 103, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (103, %L, %L)', 'CH', 'CH-16'), e_ch16),
    jsonb_build_array('I4 geo coincidente', 'postgres', 104, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id, country_id, territory_unit_id) VALUES (104, %L, %L, %s, %s)', 'CH', 'CH-16', v_sv, v_u_ch16), e_ch16),
    jsonb_build_array('I5 geo contradictoria', 'postgres', 105, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id, country_id, territory_unit_id) VALUES (105, %L, %L, %s, %s)', 'CH', 'CH-16', v_sv, v_u_ch), 'ERROR:P0183'),
    jsonb_build_array('I6 pais sin ubicacion', 'postgres', 106, format('INSERT INTO public._s7_92_probe (id, country_id) VALUES (106, %s)', v_sv), 'ERROR:P0183'),
    jsonb_build_array('I7 municipio sin departamento', 'postgres', 107, format('INSERT INTO public._s7_92_probe (id, municipality_id) VALUES (107, %L)', 'CH-16'), 'ERROR:P0024'),
    jsonb_build_array('I8 par incoherente', 'postgres', 108, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (108, %L, %L)', 'CH', v_m2), 'ERROR:P0025'),
    jsonb_build_array('I9 departamento inexistente', 'postgres', 109, format('INSERT INTO public._s7_92_probe (id, department_id) VALUES (109, %L)', 'ZZ'), 'ERROR:P0026'),
    jsonb_build_array('I10 unidad de nivel 2', 'postgres', 110, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id, country_id, territory_unit_id) VALUES (110, %L, %L, %s, %s)', 'CH', 'CH-16', v_sv, v_u_n2), 'ERROR:P0183'),
    -- filas derivadas para los UPDATE
    jsonb_build_array('S derivada 201', 'postgres', 201, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (201, %L, %L)', 'CH', 'CH-16'), e_ch16),
    jsonb_build_array('S derivada 202', 'postgres', 202, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (202, %L, %L)', 'CH', 'CH-16'), e_ch16),
    jsonb_build_array('S derivada 203', 'postgres', 203, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (203, %L, %L)', 'CH', 'CH-16'), e_ch16),
    jsonb_build_array('S derivada 204', 'postgres', 204, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (204, %L, %L)', 'CH', 'CH-16'), e_ch16),
    jsonb_build_array('S derivada 205', 'postgres', 205, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (205, %L, %L)', 'CH', 'CH-16'), e_ch16),
    jsonb_build_array('S derivada 206', 'postgres', 206, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (206, %L, %L)', 'CH', 'CH-16'), e_ch16),
    jsonb_build_array('S derivada 207', 'postgres', 207, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (207, %L, %L)', 'CH', 'CH-16'), e_ch16),
    jsonb_build_array('S derivada 208', 'postgres', 208, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (208, %L, %L)', 'CH', 'CH-16'), e_ch16),
    jsonb_build_array('S derivada 209', 'postgres', 209, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (209, %L, %L)', 'CH', 'CH-16'), e_ch16),
    jsonb_build_array('S derivada 210', 'postgres', 210, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (210, %L, %L)', 'CH', 'CH-16'), e_ch16),
    jsonb_build_array('S derivada 211', 'postgres', 211, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (211, %L, %L)', 'CH', 'CH-16'), e_ch16),
    -- UPDATE
    jsonb_build_array('U1 solo legacy', 'postgres', 201, format('UPDATE public._s7_92_probe SET department_id = %L, municipality_id = %L WHERE id = 201', v_d2, v_m2), e_m2),
    jsonb_build_array('U2 solo geo coincidente en fila historica', 'postgres', 1, format('UPDATE public._s7_92_probe SET country_id = %s, territory_unit_id = %s WHERE id = 1', v_sv, v_u_ch16), e_ch16),
    jsonb_build_array('U3 solo geo contradictoria en fila historica', 'postgres', 2, format('UPDATE public._s7_92_probe SET country_id = %s, territory_unit_id = %s WHERE id = 2', v_sv, v_u_ch), 'ERROR:P0183'),
    jsonb_build_array('U4 geo a NULL en fila derivada', 'postgres', 202, 'UPDATE public._s7_92_probe SET territory_unit_id = NULL WHERE id = 202', 'ERROR:P0183'),
    jsonb_build_array('U5 legacy + geo coincidente', 'postgres', 203, format('UPDATE public._s7_92_probe SET department_id = %L, municipality_id = %L, country_id = %s, territory_unit_id = %s WHERE id = 203', v_d2, v_m2, v_sv, v_u_m2), e_m2),
    jsonb_build_array('U6 legacy + geo contradictoria', 'postgres', 204, format('UPDATE public._s7_92_probe SET department_id = %L, municipality_id = %L, territory_unit_id = %s WHERE id = 204', v_d2, v_m2, v_u_ch), 'ERROR:P0183'),
    jsonb_build_array('U7 legacy + geo anterior reenviado', 'postgres', 205, format('UPDATE public._s7_92_probe SET department_id = %L, municipality_id = %L, country_id = %s, territory_unit_id = %s WHERE id = 205', v_d2, v_m2, v_sv, v_u_ch16), e_m2),
    jsonb_build_array('U8 cambio de departamento con municipio anterior', 'postgres', 206, format('UPDATE public._s7_92_probe SET department_id = %L WHERE id = 206', v_d2), 'ERROR:P0025'),
    jsonb_build_array('U9 municipio sin departamento', 'postgres', 207, 'UPDATE public._s7_92_probe SET department_id = NULL WHERE id = 207', 'ERROR:P0024'),
    jsonb_build_array('U10 par legacy incoherente', 'postgres', 208, format('UPDATE public._s7_92_probe SET municipality_id = %L WHERE id = 208', v_m2), 'ERROR:P0025'),
    jsonb_build_array('U11 re-guardar misma ubicacion en fila historica', 'postgres', 3, 'UPDATE public._s7_92_probe SET department_id = department_id, municipality_id = municipality_id WHERE id = 3', 'NULL|NULL'),
    jsonb_build_array('U12 columna ajena', 'postgres', 210, 'UPDATE public._s7_92_probe SET nota = ''x'' WHERE id = 210', e_ch16),
    jsonb_build_array('U13 vaciar ubicacion', 'postgres', 209, 'UPDATE public._s7_92_probe SET department_id = NULL, municipality_id = NULL WHERE id = 209', 'NULL|NULL'),
    jsonb_build_array('U14 upsert contradictorio', 'postgres', 211, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (211, %L, %L) ON CONFLICT (id) DO UPDATE SET territory_unit_id = %s', 'CH', 'CH-16', v_u_ch), 'ERROR:P0183'),
    jsonb_build_array('U15 pais en fila historica sin ubicacion', 'postgres', 4, format('UPDATE public._s7_92_probe SET country_id = %s WHERE id = 4', v_sv), 'ERROR:P0183'),
    jsonb_build_array('U16 cambio legacy en fila historica (dual-write)', 'postgres', 5, 'UPDATE public._s7_92_probe SET municipality_id = NULL WHERE id = 5', e_ch),
    -- mismo comportamiento bajo authenticated
    jsonb_build_array('R1 insert coherente', 'authenticated', 301, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id) VALUES (301, %L, %L)', 'CH', 'CH-16'), e_ch16),
    jsonb_build_array('R2 insert contradictorio', 'authenticated', 302, format('INSERT INTO public._s7_92_probe (id, department_id, municipality_id, territory_unit_id) VALUES (302, %L, %L, %s)', 'CH', 'CH-16', v_u_ch), 'ERROR:P0183'),
    jsonb_build_array('R3 geo contradictoria en fila historica', 'authenticated', 6, format('UPDATE public._s7_92_probe SET territory_unit_id = %s WHERE id = 6', v_u_ch), 'ERROR:P0183'),
    jsonb_build_array('R4 cambio de departamento con municipio anterior', 'authenticated', 301, format('UPDATE public._s7_92_probe SET department_id = %L WHERE id = 301', v_d2), 'ERROR:P0025')
  );

  FOR c IN SELECT value FROM jsonb_array_elements(v_casos) LOOP
    v_n := v_n + 1;
    BEGIN
      IF c->>1 = 'authenticated' THEN
        EXECUTE 'SET LOCAL ROLE authenticated';
      END IF;
      EXECUTE c->>3;
      SELECT coalesce(p.country_id::text, 'NULL') || '|' || coalesce(p.territory_unit_id::text, 'NULL')
        INTO v_obt FROM public._s7_92_probe p WHERE p.id = (c->>2)::int;
      EXECUTE 'RESET ROLE';
    EXCEPTION WHEN OTHERS THEN
      v_obt := 'ERROR:' || SQLSTATE;
    END;
    EXECUTE 'RESET ROLE';
    IF v_obt IS DISTINCT FROM c->>4 THEN
      v_fallos := v_fallos || format(' [%s: obtuvo %s, esperaba %s]', c->>0, v_obt, c->>4);
    END IF;
  END LOOP;

  -- Nivel 2 nunca derivado en ninguna fila resultante.
  IF EXISTS (SELECT 1 FROM public._s7_92_probe p JOIN public.administrative_units u ON u.id = p.territory_unit_id
              WHERE u.level NOT IN (1, 3)) THEN
    v_fallos := v_fallos || ' [la sonda contiene una unidad de nivel distinto de 1 o 3]';
  END IF;
  IF v_n <> 41 THEN
    v_fallos := v_fallos || format(' [se ejecutaron %s casos, esperaba 41]', v_n);
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 's7_92 SONDA: el rol no volvio a postgres (%)', current_user;
  END IF;
  IF v_fallos <> '' THEN
    RAISE EXCEPTION 's7_92 SONDA FAIL:%', v_fallos;
  END IF;
  RAISE NOTICE 's7_92 SONDA: 41 casos OK (INSERT, UPDATE, upsert, authenticated), 0 nivel 2';
END $SONDA$;

DROP TABLE public._s7_92_probe;


-- ─── 6. LOCK de clinics (desde aqui hasta el COMMIT: milisegundos) ─
LOCK TABLE public.clinics IN ACCESS EXCLUSIVE MODE;


-- ─── 7. GUARDA: huellas de clinics bajo el lock ──────────────
DO $GUARDA$
DECLARE
  v_n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint con
                  WHERE con.conname = 'clinics_geo_f3a_temp_null_chk' AND con.contype = 'c'
                    AND con.conrelid = 'public.clinics'::regclass AND con.convalidated
                    AND lower(regexp_replace(pg_get_constraintdef(con.oid), '[()[:space:]]', '', 'g'))
                        = 'checkcountry_idisnullandterritory_unit_idisnull') THEN
    RAISE EXCEPTION 's7_92 GUARDA: la guarda temporal de F3A no esta en pie o no es la esperada';
  END IF;
  SELECT count(*) INTO v_n FROM public.clinics WHERE country_id IS NOT NULL OR territory_unit_id IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_92 GUARDA: % clinicas con geo', v_n; END IF;
  IF (SELECT coalesce(string_agg(tgname::text, ',' ORDER BY tgname), '') FROM pg_trigger
       WHERE tgrelid = 'public.clinics'::regclass AND NOT tgisinternal) IS DISTINCT FROM 'trg_clinics_updated_at' THEN
    RAISE EXCEPTION 's7_92 GUARDA: triggers inesperados en clinics';
  END IF;

  PERFORM set_config('s7_92.clinics_filas',
    (SELECT md5(coalesce(string_agg(c::text, E'\n' ORDER BY c.id), '')) FROM public.clinics c), true);
  PERFORM set_config('s7_92.clinics_acl',
    (SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity::text || '|' || relforcerowsecurity::text
       FROM pg_class WHERE oid = 'public.clinics'::regclass), true);
  PERFORM set_config('s7_92.clinics_policies',
    (SELECT coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
                                ';' ORDER BY policyname), '')
       FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics'), true);
  RAISE NOTICE 's7_92 GUARDA: clinics bloqueada, huellas tomadas';
END $GUARDA$;


-- ─── 8. Trigger sobre clinics + retiro de la guarda F3A ──────
CREATE TRIGGER trg_clinics_territory_sync
  BEFORE INSERT OR UPDATE OF department_id, municipality_id, country_id, territory_unit_id
  ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public._clinics_territory_sync();

COMMENT ON TRIGGER trg_clinics_territory_sync ON public.clinics IS
  'Sincronizacion legacy -> modelo territorial nuevo (s7_92). El legacy es la autoridad; '
  'rechaza con P0183 cualquier country_id / territory_unit_id contradictorio. Trigger normal.';

ALTER TABLE public.clinics DROP CONSTRAINT clinics_geo_f3a_temp_null_chk;


-- ─── 9. Guardas POST — DENTRO de la transaccion ──────────────
DO $POST$
DECLARE
  v_n   bigint;
  v_txt text;
  r     record;
BEGIN
  -- Trigger: BEFORE ROW INSERT + UPDATE OF exactamente las 4 columnas, normal, con la funcion correcta.
  SELECT t.tgtype, t.tgenabled::text AS habilitado, t.tgfoid::regprocedure::text AS funcion,
         (SELECT string_agg(a.attname::text, ',' ORDER BY a.attname)
            FROM pg_attribute a
           WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr)) AS columnas
    INTO r
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.clinics'::regclass AND t.tgname = 'trg_clinics_territory_sync';
  IF NOT FOUND THEN RAISE EXCEPTION 's7_92 POST: falta trg_clinics_territory_sync'; END IF;
  IF r.tgtype <> 23 THEN
    RAISE EXCEPTION 's7_92 POST: tipo de trigger inesperado (tgtype=%, esperado 23 = ROW|BEFORE|INSERT|UPDATE)', r.tgtype;
  END IF;
  IF r.habilitado <> 'O' THEN
    RAISE EXCEPTION 's7_92 POST: el trigger debe ser normal (tgenabled=%)', r.habilitado;
  END IF;
  IF r.columnas IS DISTINCT FROM 'country_id,department_id,municipality_id,territory_unit_id' THEN
    RAISE EXCEPTION 's7_92 POST: columnas del UPDATE OF inesperadas (%)', r.columnas;
  END IF;
  IF r.funcion NOT IN ('_clinics_territory_sync()', 'public._clinics_territory_sync()') THEN
    RAISE EXCEPTION 's7_92 POST: funcion del trigger inesperada (%)', r.funcion;
  END IF;
  SELECT string_agg(tgname::text, ',' ORDER BY tgname) INTO v_txt
    FROM pg_trigger WHERE tgrelid = 'public.clinics'::regclass AND NOT tgisinternal;
  IF v_txt IS DISTINCT FROM 'trg_clinics_territory_sync,trg_clinics_updated_at' THEN
    RAISE EXCEPTION 's7_92 POST: triggers de clinics inesperados (%)', v_txt;
  END IF;

  -- Funciones: definer solo en el trigger, search_path fijo, dueño postgres, sin EXECUTE de clientes.
  FOR r IN
    SELECT p.oid, p.proname, p.prosecdef, p.provolatile::text AS vol, pg_get_userbyid(p.proowner) AS dueno,
           lower(replace(coalesce(array_to_string(p.proconfig, ','), ''), ' ', '')) AS config
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('_territory_from_legacy_sv', '_clinics_territory_sync')
  LOOP
    IF r.config IS DISTINCT FROM 'search_path=public,pg_temp' OR r.dueno <> 'postgres' THEN
      RAISE EXCEPTION 's7_92 POST: % con search_path o dueño inesperados (%, %)', r.proname, r.config, r.dueno;
    END IF;
    IF (r.proname = '_clinics_territory_sync') IS DISTINCT FROM r.prosecdef THEN
      RAISE EXCEPTION 's7_92 POST: SECURITY DEFINER debe estar SOLO en la funcion del trigger (%)', r.proname;
    END IF;
    IF r.proname = '_territory_from_legacy_sv' AND r.vol <> 's' THEN
      RAISE EXCEPTION 's7_92 POST: el resolver debe ser STABLE';
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', r.oid, 'EXECUTE')
       OR has_function_privilege('service_role', r.oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc pp, aclexplode(pp.proacl) a
                   WHERE pp.oid = r.oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 's7_92 POST: % conserva EXECUTE para algun rol cliente o PUBLIC', r.proname;
    END IF;
    v_n := coalesce(v_n, 0) + 1;
  END LOOP;
  IF coalesce(v_n, 0) <> 2 THEN RAISE EXCEPTION 's7_92 POST: esperaba 2 funciones, hay %', coalesce(v_n, 0); END IF;

  -- Guarda F3A retirada; CHECK estructural y FKs geo en pie.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinics_geo_f3a_temp_null_chk') THEN
    RAISE EXCEPTION 's7_92 POST: la guarda temporal de F3A sigue en pie';
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.clinics'::regclass AND convalidated
     AND conname IN ('clinics_territory_requires_country_chk', 'clinics_country_fkey', 'clinics_territory_unit_country_fkey');
  IF v_n <> 3 THEN RAISE EXCEPTION 's7_92 POST: CHECK estructural o FKs geo ausentes (%)', v_n; END IF;

  -- Sin backfill: ninguna fila de clinics cambio.
  SELECT md5(coalesce(string_agg(c::text, E'\n' ORDER BY c.id), '')) INTO v_txt FROM public.clinics c;
  IF v_txt IS DISTINCT FROM current_setting('s7_92.clinics_filas') THEN
    RAISE EXCEPTION 's7_92 POST: cambio alguna fila de clinics';
  END IF;
  SELECT count(*) INTO v_n FROM public.clinics WHERE country_id IS NOT NULL OR territory_unit_id IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 's7_92 POST: % clinicas con geo (sin backfill)', v_n; END IF;

  -- Privilegios, RLS y policies de clinics; privilegios del catalogo.
  SELECT coalesce(relacl::text, 'NULL') || '|' || relrowsecurity::text || '|' || relforcerowsecurity::text INTO v_txt
    FROM pg_class WHERE oid = 'public.clinics'::regclass;
  IF v_txt IS DISTINCT FROM current_setting('s7_92.clinics_acl') THEN
    RAISE EXCEPTION 's7_92 POST: cambiaron los privilegios o la RLS de clinics';
  END IF;
  SELECT coalesce(string_agg(policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''),
                             ';' ORDER BY policyname), '') INTO v_txt
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clinics';
  IF v_txt IS DISTINCT FROM current_setting('s7_92.clinics_policies') THEN
    RAISE EXCEPTION 's7_92 POST: cambiaron las policies de clinics';
  END IF;
  SELECT string_agg(c.relname || '=' || coalesce(c.relacl::text, 'NULL'), ';' ORDER BY c.relname) INTO v_txt
    FROM pg_class c
   WHERE c.oid IN ('public.administrative_units'::regclass, 'public.countries'::regclass,
                   'public.country_levels'::regclass);
  IF v_txt IS DISTINCT FROM current_setting('s7_92.acl_catalogo') THEN
    RAISE EXCEPTION 's7_92 POST: cambiaron los privilegios del catalogo territorial';
  END IF;

  -- Ninguna otra funcion de public cambio.
  SELECT md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                        || md5(p.prosrc) || coalesce(p.proacl::text, ''), ','
                        ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname NOT IN ('_territory_from_legacy_sv', '_clinics_territory_sync');
  IF v_txt IS DISTINCT FROM current_setting('s7_92.otras_funciones') THEN
    RAISE EXCEPTION 's7_92 POST: cambio alguna otra funcion de public';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'admin_approve_and_create_doctor'
                    AND md5(p.prosrc) IN ('a249f92a4b7d3388ee49a11f56edb4b3', 'd36698a985b73a457b87bfa12b23cb75')) THEN
    RAISE EXCEPTION 's7_92 POST: admin_approve_and_create_doctor ya no es la de s7_91';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'doctor_booking_ready'
                    AND md5(p.prosrc) IN ('901a951f179018d53979c421c0728f3c', 'fe96306a162b95754fe224a6fcd24ba8')) THEN
    RAISE EXCEPTION 's7_92 POST: doctor_booking_ready cambio';
  END IF;

  -- La sonda no sobrevive.
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = '_s7_92_probe') THEN
    RAISE EXCEPTION 's7_92 POST: la tabla sonda sigue existiendo';
  END IF;

  RAISE NOTICE 's7_92: guardas POST OK — trigger normal instalado, guarda F3A retirada, 0 filas de clinics tocadas, privilegios intactos';
END $POST$;


COMMIT;
-- ═══════════════════════════════════════════════════════════
-- FIN DEL PASO 2.
-- Todo corre DENTRO de la transaccion: si cualquier prueba o guarda lanza, se
-- revierte entero y la guarda temporal de F3A sigue en pie.
-- ═══════════════════════════════════════════════════════════
