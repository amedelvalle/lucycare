# OWNER — Smoke transaccional de `s7_69` (AUTH-P1D2)

> Ejecutar en el **SQL Editor de Supabase** DESPUÉS de aplicar `s7_69`.
> **Todo en una transacción que termina en `ROLLBACK`: cero filas persistentes.**
> No usa `service_role`. Fixtures sintéticas (`+503 7006 99xx`); jamás números
> reales (Katherine `50372608827`) ni el demo de Camilo.
>
> **Cómo ejecutar:** copiar el bloque completo, desde `BEGIN;` hasta `ROLLBACK;`,
> y correrlo en **una sola ejecución** (no por fragmentos).
>
> **Criterio de paso:** todas las filas de la salida con `pass = true`.
> Verificación posterior (fuera de la transacción):
> `SELECT count(*) FROM public.otp_consent_events WHERE phone_e164 IN (...)` → **0**.

## Nota de robustez — corrección tras `ERROR: 42P01`

La primera versión creaba la tabla de resultados como `CREATE TEMP TABLE
_p1d2_smoke` y la referenciaba **sin calificar** (29 referencias). Eso hace que
la resolución del nombre dependa de que **`pg_temp` esté en el `search_path`
efectivo** del contexto que ejecuta cada sentencia. El SQL Editor de Supabase
ejecuta el SQL a través de su propio wrapper con un `search_path` controlado; si
`pg_temp` no queda incluido, el nombre **no resuelve aunque la tabla exista en la
sesión** → `ERROR: 42P01: relation "_p1d2_smoke" does not exist`.

**Corrección:** todas las referencias van **calificadas como
`pg_temp._p1d2_smoke`**, lo que evita el `search_path` por completo. Además se
eliminó la columna `serial` (creaba una secuencia temporal adicional que también
había que resolver): el orden se fija con un ordinal explícito por caso. El
`BEGIN … ROLLBACK` mantiene una sola sesión, así que la tabla vive durante toda
la ejecución y desaparece con el `ROLLBACK`.

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- smoke s7_69 — otp_consent_events + record_otp_consent (AUTH-P1D2)
-- Una sola ejecución. Termina SIEMPRE en ROLLBACK: cero filas persistentes.
-- Sin service_role. Fixtures sintéticas (+503 7006 99xx).
--
-- SALIDA: UNA sola tabla consolidada (ord · case_name · expected · obtained · pass).
-- Los casos de error corren en SUBTRANSACCIONES (BEGIN/EXCEPTION) para que un
-- fallo esperado no aborte el smoke completo.
--
-- ROBUSTEZ: la tabla de resultados se crea y se referencia SIEMPRE calificada
-- como `pg_temp._p1d2_smoke` (no depende del search_path del editor).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE pg_temp._p1d2_smoke (
  ord       int,
  case_name text,
  expected  text,
  obtained  text,
  pass      boolean
) ON COMMIT DROP;

DO $smoke$
DECLARE
  PHONE  constant text := '+50370069901';   -- sintético SV
  PHONE2 constant text := '+50370069902';   -- sintético SV (teléfono distinto)
  VER    constant text := 'otp-consent-v1';
  HASH   constant text := '86f0dfdf430fd3e100fc7651039b20bf1d127c571e87e07faef22503886c8692';
  RID1   constant uuid := '0d1d2d00-0000-4000-8000-000000000001';
  RID_X  constant uuid := '0d1d2d00-0000-4000-8000-0000000000ff';
  v_n    int;
  v_rid  uuid;
  i      int;
BEGIN
  -- ── 1. Primer registro válido ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE, 'login', VER, HASH, RID1);
    SELECT count(*) INTO v_n FROM public.otp_consent_events WHERE request_id = RID1;
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (1, '1_primer_registro', '1 fila', v_n || ' fila(s)', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (1, '1_primer_registro', '1 fila', 'excepción: ' || SQLSTATE, false);
  END;

  -- ── 2. Mismo request_id + MISMO payload → éxito idempotente, 1 sola fila ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE, 'login', VER, HASH, RID1);
    SELECT count(*) INTO v_n FROM public.otp_consent_events WHERE request_id = RID1;
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (2, '2_idempotente_exacto', 'éxito y 1 fila', 'éxito y ' || v_n || ' fila(s)', v_n = 1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (2, '2_idempotente_exacto', 'éxito y 1 fila', 'excepción: ' || SQLSTATE, false);
  END;

  -- ── 3. Mismo request_id + payload DISTINTO → error genérico, sin fila nueva ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE2, 'login', VER, HASH, RID1);
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (3, '3_rid_reusado_otro_telefono', 'invalid_request', 'NO falló', false);
  EXCEPTION WHEN OTHERS THEN
    SELECT count(*) INTO v_n FROM public.otp_consent_events WHERE request_id = RID1;
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (3, '3_rid_reusado_otro_telefono', 'invalid_request (P0300) y 1 fila',
            SQLSTATE || ' y ' || v_n || ' fila(s)', SQLSTATE = 'P0300' AND v_n = 1);
  END;

  BEGIN
    PERFORM public.record_otp_consent(PHONE, 'booking', VER, HASH, RID1);  -- contexto distinto
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (4, '3b_rid_reusado_otro_contexto', 'invalid_request', 'NO falló', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (4, '3b_rid_reusado_otro_contexto', 'P0300', SQLSTATE, SQLSTATE = 'P0300');
  END;

  BEGIN  -- hash distinto (misma longitud, valor inválido)
    PERFORM public.record_otp_consent(PHONE, 'login', VER, repeat('a', 64), RID1);
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (5, '3c_rid_reusado_otro_hash', 'invalid_request', 'NO falló', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (5, '3c_rid_reusado_otro_hash', 'P0300', SQLSTATE, SQLSTATE = 'P0300');
  END;

  -- ── 4. Diez solicitudes NUEVAS en la ventana → permitidas ──
  --     (ya hay 1 del caso 1 → se agregan 9 para llegar a 10)
  BEGIN
    FOR i IN 2..10 LOOP
      v_rid := ('0d1d2d00-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid;
      PERFORM public.record_otp_consent(PHONE, 'login', VER, HASH, v_rid);
    END LOOP;
    SELECT count(*) INTO v_n FROM public.otp_consent_events WHERE phone_e164 = PHONE;
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (6, '4_diez_permitidas', '10 filas', v_n || ' fila(s)', v_n = 10);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (6, '4_diez_permitidas', '10 filas', 'excepción: ' || SQLSTATE, false);
  END;

  -- ── 5. La solicitud 11 (request_id nuevo) → BLOQUEADA por el límite ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE, 'login', VER, HASH, RID_X);
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (7, '5_onceava_bloqueada', 'too_many_requests', 'NO falló', false);
  EXCEPTION WHEN OTHERS THEN
    SELECT count(*) INTO v_n FROM public.otp_consent_events WHERE phone_e164 = PHONE;
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (7, '5_onceava_bloqueada', 'P0301 y sigue en 10',
            SQLSTATE || ' y ' || v_n, SQLSTATE = 'P0301' AND v_n = 10);
  END;

  -- ── 6. Reintento idempotente EXACTO con el límite alcanzado → permitido ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE, 'login', VER, HASH, RID1);
    SELECT count(*) INTO v_n FROM public.otp_consent_events WHERE phone_e164 = PHONE;
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (8, '6_idempotente_pese_al_limite', 'éxito y sigue en 10',
            'éxito y ' || v_n, v_n = 10);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (8, '6_idempotente_pese_al_limite', 'éxito', 'excepción: ' || SQLSTATE, false);
  END;

  -- ── 7. Entradas inválidas → bloqueadas (teléfono / contexto / versión / hash) ──
  BEGIN
    PERFORM public.record_otp_consent('+50170069901', 'login', VER, HASH, gen_random_uuid());
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (9, '7a_telefono_no_sv', 'P0300', 'NO falló', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (9, '7a_telefono_no_sv', 'P0300', SQLSTATE, SQLSTATE = 'P0300');
  END;

  BEGIN
    PERFORM public.record_otp_consent(PHONE2, 'recovery', VER, HASH, gen_random_uuid());
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (10, '7b_contexto_invalido', 'P0300', 'NO falló', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (10, '7b_contexto_invalido', 'P0300', SQLSTATE, SQLSTATE = 'P0300');
  END;

  BEGIN
    PERFORM public.record_otp_consent(PHONE2, 'login', 'otp-consent-v2', HASH, gen_random_uuid());
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (11, '7c_version_invalida', 'P0300', 'NO falló', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (11, '7c_version_invalida', 'P0300', SQLSTATE, SQLSTATE = 'P0300');
  END;

  BEGIN
    PERFORM public.record_otp_consent(PHONE2, 'login', VER, repeat('b', 64), gen_random_uuid());
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (12, '7d_hash_invalido', 'P0300', 'NO falló', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
    VALUES (12, '7d_hash_invalido', 'P0300', SQLSTATE, SQLSTATE = 'P0300');
  END;

  -- ── 8. anon / authenticated SIN SELECT ni DML directo sobre la tabla ──
  --     (privilegios efectivos; no requiere SET ROLE)
  INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
  SELECT 13, '8_' || rol || '_sin_acceso_directo', 'todo false',
         format('sel=%s ins=%s upd=%s del=%s',
                has_table_privilege(rol, 'public.otp_consent_events', 'SELECT'),
                has_table_privilege(rol, 'public.otp_consent_events', 'INSERT'),
                has_table_privilege(rol, 'public.otp_consent_events', 'UPDATE'),
                has_table_privilege(rol, 'public.otp_consent_events', 'DELETE')),
         NOT has_table_privilege(rol, 'public.otp_consent_events', 'SELECT')
         AND NOT has_table_privilege(rol, 'public.otp_consent_events', 'INSERT')
         AND NOT has_table_privilege(rol, 'public.otp_consent_events', 'UPDATE')
         AND NOT has_table_privilege(rol, 'public.otp_consent_events', 'DELETE')
  FROM (VALUES ('anon'), ('authenticated')) AS r(rol);

  -- ── 9. EXECUTE del RPC según grants (anon y authenticated permitidos) ──
  INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
  SELECT 14, '9_' || rol || '_execute_rpc', 'true',
         has_function_privilege(rol,
           'public.record_otp_consent(text,text,text,text,uuid)', 'EXECUTE')::text,
         has_function_privilege(rol,
           'public.record_otp_consent(text,text,text,text,uuid)', 'EXECUTE')
  FROM (VALUES ('anon'), ('authenticated')) AS r(rol);

  -- ── 10. Recuento previo al ROLLBACK (debe ser 10; el ROLLBACK lo deja en 0) ──
  SELECT count(*) INTO v_n FROM public.otp_consent_events
  WHERE phone_e164 IN (PHONE, PHONE2);
  INSERT INTO pg_temp._p1d2_smoke(ord, case_name, expected, obtained, pass)
  VALUES (15, '10_pre_rollback', '10 filas sintéticas (se revierten)', v_n || ' fila(s)', v_n = 10);
END;
$smoke$;

-- SALIDA ÚNICA consolidada (calificada con pg_temp).
SELECT ord, case_name, expected, obtained, pass
FROM pg_temp._p1d2_smoke
ORDER BY ord;

-- Revierte TODO: las filas sintéticas y la tabla temporal. Cero residuos.
ROLLBACK;
```

## Criterio de paso

Todas las filas con `pass = true`. Verificación posterior (fuera de la
transacción, opcional):

```sql
SELECT count(*) FROM public.otp_consent_events
WHERE phone_e164 IN ('+50370069901','+50370069902');   -- debe ser 0
```
