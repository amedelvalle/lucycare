# OWNER — aplicación de `s7_72` (URL corta de calificación)

> **Guía operativa para el owner, en el SQL Editor de Supabase.**
> Tres pasos, en orden. **No saltear el PASO 1.**
>
> El dev **no ejecuta nada** de esto: la regla vigente es que el owner aplica el
> SQL y el dev corre los `check`/`smoke` y dictamina.

| Paso | Qué hace | ¿Modifica la base? |
|---|---|---|
| **1** | Verificación del estado real previo | **NO** — read-only |
| **2** | Aplicación de la migración | **SÍ** |
| **3** | Verificación posterior | **NO** — read-only / `ROLLBACK` |

---

## PASO 1 — READ-ONLY (no modifica nada)

Devuelve una sola fila con el estado del catálogo.

```sql
-- ══ s7_72 · PASO 1 — VERIFICACIÓN READ-ONLY (no modifica nada) ══
WITH g AS (
  SELECT pr.*
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = 'generate_review_token'
    AND pr.prokind = 'f' AND pr.pronargs = 0
),
h AS (
  SELECT pr.*
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = '_review_short_code'
),
t AS (
  SELECT tg.tgenabled, c.relname, pg_get_triggerdef(tg.oid) AS def
  FROM pg_trigger tg
  JOIN pg_class c ON c.oid = tg.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT tg.tgisinternal
    AND tg.tgname = 'trg_generate_review_token'
    AND n.nspname = 'public'
)
SELECT
  (SELECT count(*) FROM g)                                    AS gen_existe,
  (SELECT pg_get_userbyid(proowner) FROM g)                   AS gen_owner,
  (SELECT prosecdef FROM g)                                   AS gen_secdef,
  (SELECT provolatile FROM g)                                 AS gen_volatility,
  (SELECT pg_get_function_result(oid) FROM g)                 AS gen_returns,
  (SELECT array_to_string(proconfig, '|') FROM g)             AS gen_proconfig,
  (SELECT array_to_string(proacl, '|') FROM g)                AS gen_grants,
  (SELECT count(*) FROM h)                                    AS helper_ya_existe,
  (SELECT tgenabled FROM t)                                   AS trg_enabled,
  (SELECT relname FROM t)                                     AS trg_tabla,
  (SELECT def ~* 'AFTER UPDATE OF status_id' FROM t)          AS trg_evento_ok,
  (SELECT format_type(a.atttypid, a.atttypmod)
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'review_tokens'
      AND a.attname = 'token')                                AS token_tipo,
  (SELECT count(*)
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'review_tokens'
      AND a.attnum > 0 AND NOT a.attisdropped)                AS review_tokens_cols,
  (SELECT count(*) FROM review_tokens)                        AS tokens_totales,
  (SELECT count(*) FROM review_tokens WHERE length(token) = 64) AS tokens_64,
  (SELECT count(*) FROM review_tokens WHERE length(token) = 20) AS tokens_20;
```

### Resultado exacto que autoriza continuar

| Columna | Valor requerido |
|---|---|
| `gen_existe` | `1` |
| `gen_owner` | `postgres` |
| `gen_secdef` | `true` |
| `gen_volatility` | `v` |
| `gen_returns` | `trigger` |
| `gen_proconfig` | `search_path=public` |
| `gen_grants` | `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |
| **`helper_ya_existe`** | **`0`** |
| `trg_enabled` | `O` |
| `trg_tabla` | `appointments` |
| `trg_evento_ok` | `true` |
| `token_tipo` | `text` |
| `review_tokens_cols` | `6` |
| `tokens_20` | `0` |

**Si algo difiere, detenerse y reportarlo sin aplicar nada.**
`helper_ya_existe = 0` importa especialmente: un `1` significaría que la
migración ya se aplicó o que existe un helper previo.

---

## PASO 2 — MODIFICA DB

Copiar y pegar **el archivo completo**, de una sola vez:

```
migrations/s7_72_review_token_short_code.sql
```

Va todo dentro de **una transacción explícita** (`BEGIN; … COMMIT;`). Si
cualquier guarda PRE o POST lanza excepción, el rollback es **total**: no queda
el helper a medias, ni la función reemplazada, ni los `REVOKE` aplicados.

**Salida esperada:** dos `NOTICE` y un `COMMIT` correcto.

```
NOTICE:  s7_72 PRE: OK — estado coincide con el snapshot del catálogo
NOTICE:  s7_72 POST: OK — helper creado y acotado, generate_review_token() con
         atributos y grants intactos, trigger intacto, sin backfill
```

Cualquier `RAISE EXCEPTION 's7_72 PRE:` o `s7_72 POST:` = **nada quedó
aplicado**. Reportar el mensaje completo y **no reintentar**.

---

## PASO 3 — VERIFICACIÓN (no modifica nada)

### 3.a — Catálogo y permisos (read-only)

```sql
-- ══ s7_72 · PASO 3.a — CATÁLOGO Y PERMISOS (read-only) ══
WITH h AS (
  SELECT pr.*
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = '_review_short_code'
    AND pr.prokind = 'f' AND pr.pronargs = 0
),
g AS (
  SELECT pr.*
  FROM pg_proc pr
  JOIN pg_namespace n ON n.oid = pr.pronamespace
  WHERE n.nspname = 'public' AND pr.proname = 'generate_review_token'
    AND pr.prokind = 'f' AND pr.pronargs = 0
)
SELECT
  (SELECT count(*) FROM h)                                      AS helper_existe,
  (SELECT pg_get_userbyid(proowner) FROM h)                     AS helper_owner,
  (SELECT prosecdef FROM h)                                     AS helper_secdef,
  (SELECT provolatile FROM h)                                   AS helper_volatility,
  (SELECT array_to_string(proconfig, '|') FROM h)               AS helper_proconfig,
  (SELECT array_to_string(proacl, '|') FROM h)                  AS helper_acl,
  (SELECT count(*) FROM h, LATERAL aclexplode(h.proacl) a
    WHERE a.grantee = 0)                                        AS helper_public_execute,
  (SELECT has_function_privilege('anon', oid, 'EXECUTE') FROM h)          AS helper_anon,
  (SELECT has_function_privilege('authenticated', oid, 'EXECUTE') FROM h) AS helper_authenticated,
  (SELECT has_function_privilege('service_role', oid, 'EXECUTE') FROM h)  AS helper_service_role,
  (SELECT array_to_string(proacl, '|') FROM g)                  AS gen_grants_post,
  (SELECT array_to_string(proconfig, '|') FROM g)               AS gen_proconfig_post,
  (SELECT prosecdef FROM g)                                     AS gen_secdef_post,
  (SELECT tg.tgenabled FROM pg_trigger tg
    WHERE NOT tg.tgisinternal
      AND tg.tgname = 'trg_generate_review_token')              AS trg_enabled_post,
  current_setting('s7_72.acl_gen', true)                        AS guc_residual;
```

**Esperado:**

| Columna | Valor |
|---|---|
| `helper_existe` | `1` |
| `helper_owner` | `postgres` |
| `helper_secdef` | **`false`** (INVOKER) |
| `helper_volatility` | `v` |
| `helper_proconfig` | `search_path=pg_catalog` |
| **`helper_public_execute`** | **`0`** |
| `helper_anon` / `helper_authenticated` / `helper_service_role` | **`false`** en los tres |
| `gen_grants_post` | **idéntico** al `gen_grants` del PASO 1 |
| `gen_proconfig_post` | `search_path=public` |
| `gen_secdef_post` | `true` |
| `trg_enabled_post` | `O` |
| `guc_residual` | **vacío o `NULL`** — los `set_config` eran transaction-local |

### 3.b — Generación: 10 000 códigos (no escribe nada)

```sql
-- ══ s7_72 · PASO 3.b — GENERACIÓN, 10 000 CÓDIGOS (no escribe nada) ══
BEGIN;

WITH gen AS (
  SELECT public._review_short_code() AS code
  FROM generate_series(1, 10000)
),
metricas AS (
  SELECT
    count(*)                                                   AS total,
    count(DISTINCT code)                                       AS unicos,
    min(length(code))                                          AS largo_min,
    max(length(code))                                          AS largo_max,
    count(*) FILTER (WHERE code !~ '^[0-9A-HJKMNP-TV-Z]{20}$') AS fuera_alfabeto
  FROM gen
),
simbolos AS (
  SELECT substr(code, i, 1) AS s
  FROM gen, generate_series(1, 20) AS i
),
frecuencia AS (
  SELECT s, count(*) AS n FROM simbolos GROUP BY s
),
distribucion AS (
  SELECT
    count(*)      AS simbolos_distintos,
    min(n)        AS min_freq,
    max(n)        AS max_freq,
    round(avg(n)) AS media_freq,
    -- 200 000 caracteres / 32 símbolos = 6250 esperado por símbolo.
    round(100.0 * max(abs(n - 6250.0)) / 6250.0, 2) AS desvio_max_pct
  FROM frecuencia
)
SELECT
  m.total, m.unicos, m.largo_min, m.largo_max, m.fuera_alfabeto,
  d.simbolos_distintos, d.min_freq, d.max_freq, d.media_freq, d.desvio_max_pct,
  CASE
    WHEN m.total = 10000
     AND m.unicos = 10000
     AND m.largo_min = 20 AND m.largo_max = 20
     AND m.fuera_alfabeto = 0
     AND d.simbolos_distintos = 32
     AND d.desvio_max_pct <= 10
    THEN 'PASS'
    ELSE 'FAIL'
  END AS resultado
FROM metricas m, distribucion d;

ROLLBACK;
```

**Esperado:** `resultado = PASS` · `unicos = 10000` · `largo_min = largo_max = 20`
· `fuera_alfabeto = 0` · `simbolos_distintos = 32` · `media_freq ≈ 6250` ·
`desvio_max_pct ≤ 10`.

> Con 200 000 caracteres en 32 símbolos, la desviación estándar por símbolo es
> ~78 (≈1.2 %). Hasta ~5 % es ruido normal; el umbral de 10 % deja margen sin
> dejar pasar un sesgo real.

### 3.c — Sin backfill (read-only)

```sql
-- ══ s7_72 · PASO 3.c — SIN BACKFILL (read-only) ══
SELECT length(token) AS largo, count(*) AS filas
FROM review_tokens
GROUP BY length(token)
ORDER BY largo;
```

**Esperado inmediatamente después de aplicar:** solo `largo = 64`.
Baseline medido el 2026-08-14: **15 tokens, todos de 64 caracteres**.
Los de 20 aparecen recién cuando una cita nueva pase a *atendida*.

---

## Qué devolver al dev

| Paso | Qué mandar |
|---|---|
| **1** | La fila completa, con sus 17 columnas |
| **2** | Los dos `NOTICE` y si terminó en `COMMIT`. Si falló, el mensaje de excepción **completo** |
| **3.a** | La fila completa, con sus 15 columnas |
| **3.b** | La fila del `SELECT`, incluida la columna `resultado` |
| **3.c** | La tabla `largo / filas` |

**No hace falta mandar ningún token real**: el paso 3.c devuelve solo longitudes
y conteos.

Si el PASO 2 falla, **no reintentar**: reportar la excepción y el resultado del
PASO 1 antes de tocar nada.
