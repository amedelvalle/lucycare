# OWNER — smoke de `s7_72` (URL corta de calificación)

> **Para el owner, en el SQL Editor de Supabase.** El dev no puede correr este
> smoke: el helper `_review_short_code()` queda **revocado para `service_role`**,
> que es la credencial de los scripts. Esa restricción es deliberada — es
> justamente lo que verifica `scripts/_smoke-s7_72.mjs`.

## Cuándo

**Después** de aplicar `migrations/s7_72_review_token_short_code.sql`.

La migración ya prueba **100 generaciones** en su bloque POST y aborta si algo
falla. Este smoke es la verificación estadística amplia: **10 000 generaciones**,
unicidad y distribución de símbolos.

## Qué NO hace

No crea ni modifica citas, tokens ni reseñas. Todo corre dentro de
`BEGIN … ROLLBACK` y el generador **no escribe**: solo devuelve texto.

> ⚠️ **Sin tablas temporales.** Gotcha vigente del SQL Editor: `42P01` por
> `search_path` y `3F000` porque `pg_temp` no resuelve hasta que la sesión
> materializa su esquema temporal. Este smoke usa CTEs, no `CREATE TEMP`.

## Smoke — ejecutar completo, de una sola vez

```sql
BEGIN;

WITH gen AS (
  SELECT public._review_short_code() AS code
  FROM generate_series(1, 10000)
),
metricas AS (
  SELECT
    count(*)                                                      AS total,
    count(DISTINCT code)                                          AS unicos,
    min(length(code))                                             AS largo_min,
    max(length(code))                                             AS largo_max,
    count(*) FILTER (WHERE code !~ '^[0-9A-HJKMNP-TV-Z]{20}$')    AS fuera_alfabeto
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
    count(*)                    AS simbolos_distintos,
    min(n)                      AS min_freq,
    max(n)                      AS max_freq,
    round(avg(n))               AS media_freq,
    -- 200 000 caracteres / 32 símbolos = 6250 esperado por símbolo.
    -- Tolerancia amplia (±10 %): detecta sesgo real sin fallar por ruido.
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

### Resultado esperado

| Columna | Valor esperado |
|---|---|
| `total` | 10000 |
| `unicos` | **10000** — ninguna repetición |
| `largo_min` / `largo_max` | **20** / **20** |
| `fuera_alfabeto` | **0** |
| `simbolos_distintos` | **32** — los 32 aparecen |
| `media_freq` | ~6250 |
| `desvio_max_pct` | **≤ 10** |
| **`resultado`** | **`PASS`** |

Si `resultado` = `FAIL`, mirá qué columna se salió y reportalo **sin aplicar
nada más**.

> Sobre `desvio_max_pct`: con 200 000 caracteres repartidos en 32 símbolos, la
> desviación estándar por símbolo es ~78 (≈1.2 % de 6250). Un desvío máximo de
> hasta ~5 % es ruido normal; el umbral de 10 % deja margen sin dejar pasar un
> sesgo real, que se manifestaría como un símbolo sistemáticamente al doble o a
> la mitad.

## Verificación complementaria — sin backfill

```sql
SELECT length(token) AS largo, count(*) AS filas
FROM review_tokens
GROUP BY length(token)
ORDER BY largo;
```

**Esperado inmediatamente después de aplicar:** solo `largo = 64`. Los tokens ya
emitidos **no se convierten**. Los de 20 caracteres aparecen recién cuando una
cita nueva pasa a *atendida*.

Baseline medido antes de aplicar (2026-08-14): **15 tokens, todos de 64
caracteres**.
