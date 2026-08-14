-- ═══════════════════════════════════════════════════════════════════════
-- s7_72 — URL corta de calificación (RATING-URL-P0)
-- ═══════════════════════════════════════════════════════════════════════
-- QUÉ HACE
--   1. Crea el helper `public._review_short_code()`: 20 caracteres
--      Crockford Base32, uniformes, desde el CSPRNG nativo de Postgres.
--   2. Reemplaza SOLO la expresión que genera el token dentro de
--      `public.generate_review_token()`. Todo lo demás del cuerpo y de los
--      atributos de la función se reescribe IDÉNTICO.
--
-- QUÉ **NO** HACE — verificado por PRE/POST y por `scripts/check-s7_72.mjs`
--   · NO toca `submit_review` ni `get_review_link`.
--   · NO cambia el esquema de `review_tokens` (ni columnas, ni índices,
--     ni constraints, ni el UNIQUE de `token`).
--   · NO recrea el trigger (`CREATE OR REPLACE FUNCTION` conserva `tgfoid`).
--   · NO hace backfill: los tokens existentes NO se convierten.
--   · NO modifica los grants de `generate_review_token()`.
--   · NO toca la ruta `/calificar/:token`, el frontend, el middleware,
--     el SEO ni Analytics.
--
-- RETROCOMPATIBILIDAD
--   `submit_review` compara `token = p_token` por igualdad exacta sobre la
--   misma columna `text`. Los enlaces ya emitidos (64 caracteres) siguen
--   siendo canjeables hasta vencer o usarse. Durante un máximo de ~7 días
--   —la vida del token— coexisten ambos formatos. Un enlace antiguo se
--   seguirá viendo largo: solo los tokens generados DESPUÉS de aplicar esta
--   migración tienen la URL corta.
--
-- ENTROPÍA
--   `gen_random_uuid()` usa `pg_strong_random` (CSPRNG nativo, PG >= 13).
--   De cada UUID se descartan los bytes 6 y 8: contienen los bits fijos de
--   version (4) y variant, y contarlos como aleatorios inflaría la entropía
--   declarada. Quedan 14 bytes limpios por UUID.
--   Cada carácter consume un byte y toma `byte % 32`. Como 256 = 8 × 32, el
--   mapeo es uniforme POR CONSTRUCCIÓN: sin módulo bias y sin rejection
--   sampling. 20 caracteres × 5 bits = **100 bits exactos** (2^100 ≈ 1.27e30).
--   El UNIQUE de `review_tokens.token` queda como defensa adicional contra
--   colisiones, no como mecanismo primario.
--
-- NO se usa `random()` (no criptográfico) ni `gen_random_bytes()` (pgcrypto,
-- NO habilitada en este proyecto — fue exactamente la causa del fix `s6_02`).
--
-- ORDEN DE APLICACIÓN: bloque único. Si el PRE no coincide con el snapshot
-- del catálogo, la migración ABORTA sin haber tocado nada.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. PRE — guardas bloqueantes contra el estado real ───────────────
DO $pre$
DECLARE
  p            pg_proc%ROWTYPE;
  v_owner      text;
  v_ret        text;
  v_sp         text;
  v_trg        RECORD;
  v_coltype    text;
BEGIN
  -- 1.1 La función existe, es una función normal y tiene la firma esperada.
  SELECT * INTO p
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = 'generate_review_token'
    AND pr.prokind = 'f' AND pr.pronargs = 0;

  IF NOT FOUND THEN
    RAISE EXCEPTION 's7_72 PRE: public.generate_review_token() no existe o cambió de firma';
  END IF;

  -- 1.2 Owner.
  v_owner := pg_get_userbyid(p.proowner);
  IF v_owner <> 'postgres' THEN
    RAISE EXCEPTION 's7_72 PRE: owner de generate_review_token() es "%" y se esperaba "postgres"', v_owner;
  END IF;

  -- 1.3 SECURITY DEFINER.
  IF NOT p.prosecdef THEN
    RAISE EXCEPTION 's7_72 PRE: generate_review_token() NO es SECURITY DEFINER';
  END IF;

  -- 1.4 Volatility VOLATILE.
  IF p.provolatile <> 'v' THEN
    RAISE EXCEPTION 's7_72 PRE: volatility de generate_review_token() es "%" y se esperaba "v"', p.provolatile;
  END IF;

  -- 1.5 RETURNS trigger.
  v_ret := pg_get_function_result(p.oid);
  IF v_ret <> 'trigger' THEN
    RAISE EXCEPTION 's7_72 PRE: return de generate_review_token() es "%" y se esperaba "trigger"', v_ret;
  END IF;

  -- 1.6 search_path = public (tolerante al entrecomillado que use el catálogo).
  SELECT c INTO v_sp
  FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS c
  WHERE c LIKE 'search_path=%'
  LIMIT 1;
  IF v_sp IS NULL OR btrim(split_part(v_sp, '=', 2), '"''') <> 'public' THEN
    RAISE EXCEPTION 's7_72 PRE: search_path de generate_review_token() es "%" y se esperaba "public"',
      coalesce(v_sp, '(ninguno)');
  END IF;

  -- 1.7 Trigger: existe, habilitado, sobre appointments, AFTER UPDATE OF status_id.
  SELECT t.tgname, t.tgenabled, c.relname, pg_get_triggerdef(t.oid) AS def
  INTO v_trg
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal
    AND t.tgname = 'trg_generate_review_token'
    AND n.nspname = 'public';

  IF NOT FOUND THEN
    RAISE EXCEPTION 's7_72 PRE: el trigger trg_generate_review_token no existe';
  END IF;
  IF v_trg.tgenabled <> 'O' THEN
    RAISE EXCEPTION 's7_72 PRE: el trigger no está habilitado (tgenabled="%")', v_trg.tgenabled;
  END IF;
  IF v_trg.relname <> 'appointments' THEN
    RAISE EXCEPTION 's7_72 PRE: el trigger está sobre "%" y se esperaba "appointments"', v_trg.relname;
  END IF;
  IF v_trg.def !~* 'AFTER UPDATE OF status_id' OR v_trg.def !~* 'FOR EACH ROW' THEN
    RAISE EXCEPTION 's7_72 PRE: la definición del trigger no es AFTER UPDATE OF status_id FOR EACH ROW: %', v_trg.def;
  END IF;

  -- 1.8 review_tokens.token sigue siendo text.
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_coltype
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'review_tokens'
    AND a.attname = 'token' AND a.attnum > 0 AND NOT a.attisdropped;

  IF v_coltype IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 's7_72 PRE: review_tokens.token es "%" y se esperaba "text"', coalesce(v_coltype, '(ausente)');
  END IF;

  -- 1.9 El UNIQUE de token y el UNIQUE de appointment_id siguen presentes.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'review_tokens' AND con.contype = 'u'
      AND (SELECT array_agg(att.attname ORDER BY att.attname)
           FROM unnest(con.conkey) k
           JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k)
          = ARRAY['token']
  ) THEN
    RAISE EXCEPTION 's7_72 PRE: falta el UNIQUE sobre review_tokens(token)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'review_tokens' AND con.contype = 'u'
      AND (SELECT array_agg(att.attname ORDER BY att.attname)
           FROM unnest(con.conkey) k
           JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k)
          = ARRAY['appointment_id']
  ) THEN
    RAISE EXCEPTION 's7_72 PRE: falta el UNIQUE sobre review_tokens(appointment_id)';
  END IF;

  -- 1.10 Snapshot de los grants ACTUALES, para comparar en el POST.
  --      Patrón vigente del repo: NADA de tablas temporales en el SQL Editor
  --      (42P01 por search_path / 3F000 porque pg_temp no resuelve).
  PERFORM set_config('s7_72.acl_gen', coalesce(array_to_string(p.proacl, '|'), '(null)'), false);
  PERFORM set_config('s7_72.oid_gen', p.oid::text, false);

  RAISE NOTICE 's7_72 PRE: OK — estado coincide con el snapshot del catálogo';
END
$pre$;


-- ─── 2. Helper: 20 caracteres Crockford Base32, uniformes ────────────
-- SECURITY INVOKER explícito. `generate_review_token()` es SECURITY DEFINER
-- con owner postgres, así que lo invoca bajo el contexto de postgres —dueño
-- del helper— y por eso los REVOKE de abajo no le quitan la capacidad.
CREATE OR REPLACE FUNCTION public._review_short_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO 'pg_catalog'
AS $fn$
DECLARE
  -- Crockford Base32: sin I, L, O ni U. Al no existir esas letras, los
  -- dígitos 0 y 1 dejan de ser ambiguos al dictar el código por teléfono.
  c_alfabeto constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  c_largo    constant int  := 20;
  v_out      text  := '';
  v_raw      bytea;
  v_i        int;
BEGIN
  WHILE length(v_out) < c_largo LOOP
    -- 16 bytes por UUID. `decode`/`get_byte` son core: no requieren pgcrypto.
    v_raw := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    FOR v_i IN 0..15 LOOP
      -- Bytes 6 y 8: contienen los bits fijos de version y variant.
      CONTINUE WHEN v_i = 6 OR v_i = 8;
      EXIT WHEN length(v_out) >= c_largo;
      -- 256 % 32 = 0  ⇒  uniforme por construcción, sin módulo bias.
      v_out := v_out || substr(c_alfabeto, (get_byte(v_raw, v_i) % 32) + 1, 1);
    END LOOP;
  END LOOP;

  RETURN v_out;
END
$fn$;

COMMENT ON FUNCTION public._review_short_code() IS
  'RATING-URL-P0 (s7_72). Devuelve 20 caracteres Crockford Base32 (100 bits) '
  'desde gen_random_uuid()/pg_strong_random, descartando los bytes 6 y 8 de '
  'cada UUID (bits fijos de version/variant). Uso interno: lo invoca '
  'generate_review_token() bajo su contexto SECURITY DEFINER. NO expuesto a '
  'PUBLIC/anon/authenticated/service_role.';

-- El helper NO debe quedar disponible como RPC para clientes.
REVOKE ALL ON FUNCTION public._review_short_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._review_short_code() FROM anon;
REVOKE ALL ON FUNCTION public._review_short_code() FROM authenticated;
REVOKE ALL ON FUNCTION public._review_short_code() FROM service_role;


-- ─── 3. generate_review_token(): mismo todo, salvo la expresión del token ──
-- Se reescribe COMPLETA y de forma idéntica al estado vigente confirmado en
-- el catálogo (firma, RETURNS trigger, plpgsql, VOLATILE, SECURITY DEFINER,
-- SET search_path TO 'public'). `CREATE OR REPLACE` conserva owner y grants,
-- y conserva el `tgfoid` del trigger: por eso el trigger NO se recrea.
CREATE OR REPLACE FUNCTION public.generate_review_token()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  atendida_id uuid;
BEGIN
  SELECT id INTO atendida_id
  FROM appointment_statuses
  WHERE name = 'atendida'
  LIMIT 1;

  IF atendida_id IS NULL THEN
    RETURN NEW; -- no existe el estado; no bloquear la transición
  END IF;

  IF NEW.status_id = atendida_id
     AND (OLD.status_id IS DISTINCT FROM NEW.status_id) THEN
    INSERT INTO review_tokens (appointment_id, token, expires_at)
    VALUES (
      NEW.id,
      -- ÚNICO cambio funcional de esta migración: antes eran dos UUID
      -- concatenados (64 caracteres). Los tokens ya emitidos NO se tocan.
      public._review_short_code(),
      now() + interval '7 days'
    )
    ON CONFLICT (appointment_id) DO NOTHING;
  END IF;

  RETURN NEW;
END
$fn$;


-- ─── 4. POST — verificación bloqueante del resultado ─────────────────
DO $post$
DECLARE
  h            pg_proc%ROWTYPE;
  g            pg_proc%ROWTYPE;
  v_owner      text;
  v_sp         text;
  v_acl_antes  text;
  v_acl_ahora  text;
  v_trg        RECORD;
  v_code       text;
  v_i          int;
  v_vistos     text[] := ARRAY[]::text[];
BEGIN
  -- 4.1 Helper: existe con la firma esperada.
  SELECT * INTO h
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = '_review_short_code'
    AND pr.prokind = 'f' AND pr.pronargs = 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 's7_72 POST: _review_short_code() no existe';
  END IF;

  -- 4.2 Helper: owner postgres.
  v_owner := pg_get_userbyid(h.proowner);
  IF v_owner <> 'postgres' THEN
    RAISE EXCEPTION 's7_72 POST: owner del helper es "%" y se esperaba "postgres"', v_owner;
  END IF;

  -- 4.3 Helper: SECURITY INVOKER.
  IF h.prosecdef THEN
    RAISE EXCEPTION 's7_72 POST: el helper quedó SECURITY DEFINER y debe ser INVOKER';
  END IF;

  -- 4.4 Helper: VOLATILE.
  IF h.provolatile <> 'v' THEN
    RAISE EXCEPTION 's7_72 POST: volatility del helper es "%" y se esperaba "v"', h.provolatile;
  END IF;

  -- 4.5 Helper: search_path = pg_catalog.
  SELECT c INTO v_sp
  FROM unnest(coalesce(h.proconfig, ARRAY[]::text[])) AS c
  WHERE c LIKE 'search_path=%' LIMIT 1;
  IF v_sp IS NULL OR btrim(split_part(v_sp, '=', 2), '"''') <> 'pg_catalog' THEN
    RAISE EXCEPTION 's7_72 POST: search_path del helper es "%" y se esperaba "pg_catalog"',
      coalesce(v_sp, '(ninguno)');
  END IF;

  -- 4.6 Helper: sin EXECUTE para PUBLIC / anon / authenticated / service_role.
  IF has_function_privilege('public', h.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 's7_72 POST: el helper es ejecutable por PUBLIC';
  END IF;
  IF has_function_privilege('anon', h.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 's7_72 POST: el helper es ejecutable por anon';
  END IF;
  IF has_function_privilege('authenticated', h.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 's7_72 POST: el helper es ejecutable por authenticated';
  END IF;
  IF has_function_privilege('service_role', h.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 's7_72 POST: el helper es ejecutable por service_role';
  END IF;

  -- 4.7 generate_review_token(): atributos conservados.
  SELECT * INTO g
  FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = 'generate_review_token'
    AND pr.prokind = 'f' AND pr.pronargs = 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 's7_72 POST: generate_review_token() desapareció';
  END IF;
  IF g.oid::text <> current_setting('s7_72.oid_gen', true) THEN
    RAISE EXCEPTION 's7_72 POST: el OID de generate_review_token() cambió (se recreó en vez de reemplazarse)';
  END IF;
  IF pg_get_userbyid(g.proowner) <> 'postgres' THEN
    RAISE EXCEPTION 's7_72 POST: cambió el owner de generate_review_token()';
  END IF;
  IF NOT g.prosecdef THEN
    RAISE EXCEPTION 's7_72 POST: generate_review_token() dejó de ser SECURITY DEFINER';
  END IF;
  IF g.provolatile <> 'v' THEN
    RAISE EXCEPTION 's7_72 POST: cambió la volatility de generate_review_token()';
  END IF;
  IF pg_get_function_result(g.oid) <> 'trigger' THEN
    RAISE EXCEPTION 's7_72 POST: cambió el tipo de retorno de generate_review_token()';
  END IF;

  SELECT c INTO v_sp
  FROM unnest(coalesce(g.proconfig, ARRAY[]::text[])) AS c
  WHERE c LIKE 'search_path=%' LIMIT 1;
  IF v_sp IS NULL OR btrim(split_part(v_sp, '=', 2), '"''') <> 'public' THEN
    RAISE EXCEPTION 's7_72 POST: search_path de generate_review_token() ya no es public (es "%")',
      coalesce(v_sp, '(ninguno)');
  END IF;

  -- 4.8 Grants de generate_review_token() SIN CAMBIOS.
  v_acl_antes := current_setting('s7_72.acl_gen', true);
  v_acl_ahora := coalesce(array_to_string(g.proacl, '|'), '(null)');
  IF v_acl_antes IS NULL THEN
    RAISE EXCEPTION 's7_72 POST: no hay snapshot de grants del PRE';
  END IF;
  IF v_acl_ahora <> v_acl_antes THEN
    RAISE EXCEPTION 's7_72 POST: cambiaron los grants de generate_review_token(). Antes="%" Ahora="%"',
      v_acl_antes, v_acl_ahora;
  END IF;

  -- 4.9 Trigger: mismo nombre, tabla, evento y habilitado.
  SELECT t.tgname, t.tgenabled, c.relname, pg_get_triggerdef(t.oid) AS def
  INTO v_trg
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND t.tgname = 'trg_generate_review_token' AND n.nspname = 'public';
  IF NOT FOUND OR v_trg.tgenabled <> 'O' OR v_trg.relname <> 'appointments'
     OR v_trg.def !~* 'AFTER UPDATE OF status_id' THEN
    RAISE EXCEPTION 's7_72 POST: el trigger cambió o quedó deshabilitado';
  END IF;

  -- 4.10 submit_review NO fue modificada por esta migración.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
    WHERE n.nspname = 'public' AND pr.proname = 'submit_review'
  ) THEN
    RAISE EXCEPTION 's7_72 POST: submit_review no existe';
  END IF;
  IF (SELECT pg_get_functiondef(pr.oid)
      FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
      WHERE n.nspname = 'public' AND pr.proname = 'submit_review'
      LIMIT 1) !~ 'token\s*=\s*p_token' THEN
    RAISE EXCEPTION 's7_72 POST: submit_review ya no compara token = p_token por igualdad exacta';
  END IF;

  -- 4.11 Esquema de review_tokens intacto: la columna sigue siendo text y el
  --      esquema no ganó ni perdió columnas respecto de las seis esperadas.
  IF (SELECT count(*) FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'review_tokens'
        AND a.attnum > 0 AND NOT a.attisdropped) <> 6 THEN
    RAISE EXCEPTION 's7_72 POST: review_tokens cambió de esquema (se esperaban 6 columnas)';
  END IF;

  -- 4.12 Sanity del generador, en caliente y bloqueante: 100 códigos con el
  --      formato exacto y todos distintos. NO escribe nada.
  FOR v_i IN 1..100 LOOP
    v_code := public._review_short_code();
    IF length(v_code) <> 20 THEN
      RAISE EXCEPTION 's7_72 POST: el helper devolvió % caracteres y se esperaban 20', length(v_code);
    END IF;
    IF v_code !~ '^[0-9A-HJKMNP-TV-Z]{20}$' THEN
      RAISE EXCEPTION 's7_72 POST: el helper devolvió caracteres fuera del alfabeto Crockford: %', v_code;
    END IF;
    IF v_code = ANY(v_vistos) THEN
      RAISE EXCEPTION 's7_72 POST: el helper repitió un código en 100 generaciones';
    END IF;
    v_vistos := v_vistos || v_code;
  END LOOP;

  RAISE NOTICE 's7_72 POST: OK — helper creado y acotado, generate_review_token() con atributos y grants intactos, trigger intacto, sin backfill';
END
$post$;
