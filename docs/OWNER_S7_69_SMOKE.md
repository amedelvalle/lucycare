# OWNER — Smoke transaccional de `s7_69` (AUTH-P1D2)

> Ejecutar en el **SQL Editor de Supabase** DESPUÉS de aplicar `s7_69`.
> **Todo en una transacción que termina en `ROLLBACK`: cero filas persistentes.**
> No usa `service_role`. Fixtures sintéticas (`+503 7006 99xx`); jamás números
> reales (Katherine `50372608827`) ni el demo de Camilo.
>
> **Cómo ejecutar:** copiar el bloque completo, desde `BEGIN;` hasta `ROLLBACK;`,
> y correrlo en **una sola ejecución** (no por fragmentos).
>
> **Criterio de paso:** `veredicto_global = "PASS"` y todos los casos con
> `pass: true` en el JSON de salida.

## Historial de correcciones (por qué este diseño)

1. **`ERROR: 42P01: relation "_p1d2_smoke" does not exist`** — la tabla de
   resultados se referenciaba **sin calificar**, y la resolución dependía de que
   `pg_temp` estuviera en el `search_path` efectivo del wrapper del SQL Editor.
2. **`ERROR: 3F000: schema "pg_temp" does not exist`** — al calificar como
   `CREATE TABLE pg_temp.…`, el alias `pg_temp` **solo resuelve una vez que la
   sesión ya materializó su esquema temporal** (lo crea el primer objeto
   temporal); en una sesión fresca, usarlo en el propio `CREATE` falla.

**Diseño final: sin objetos temporales.** Los resultados se acumulan en una
variable `jsonb` dentro de un único bloque `DO`, se publican con
`set_config('p1d2.smoke_results', …, true)` (parámetro **local a la
transacción**, `is_local = true`) y se leen con `current_setting(…, true)`. No
hay `CREATE TEMP TABLE`, ni `pg_temp`, ni dependencia alguna del `search_path`
para guardar resultados, y el `ROLLBACK` revierte tanto las filas sintéticas
como el parámetro local.

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- smoke s7_69 — otp_consent_events + record_otp_consent (AUTH-P1D2)
-- Una sola ejecución. Termina SIEMPRE en ROLLBACK: cero filas persistentes.
-- Sin service_role. Sin objetos temporales. Fixtures sintéticas (+503 7006 99xx).
--
-- SALIDA: un ÚNICO JSON legible con todos los casos y un veredicto global.
-- Los casos de error corren en subtransacciones (BEGIN/EXCEPTION) para que un
-- fallo esperado no aborte el smoke completo.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $smoke$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_fail    int   := 0;
  PHONE  constant text := '+50370069901';   -- sintético SV
  PHONE2 constant text := '+50370069902';   -- sintético SV (teléfono distinto)
  VER    constant text := 'otp-consent-v1';
  HASH   constant text := '86f0dfdf430fd3e100fc7651039b20bf1d127c571e87e07faef22503886c8692';
  RID1   constant uuid := '0d1d2d00-0000-4000-8000-000000000001';
  RID_X  constant uuid := '0d1d2d00-0000-4000-8000-0000000000ff';
  v_n    int;
  v_ok   boolean;
  v_rid  uuid;
  i      int;

  -- Acumula un caso en v_results y lleva la cuenta de fallos.
  PROCEDURE_PLACEHOLDER text := null;  -- (PL/pgSQL no admite subrutinas locales)
BEGIN
  -- ── 1. Primer registro válido ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE, 'login', VER, HASH, RID1);
    SELECT count(*) INTO v_n FROM public.otp_consent_events WHERE request_id = RID1;
    v_ok := (v_n = 1);
    v_results := v_results || jsonb_build_object(
      'orden', 1, 'caso', '1_primer_registro', 'esperado', '1 fila',
      'obtenido', v_n || ' fila(s)', 'pass', v_ok,
      'detalle', 'registro inicial aceptado');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_results := v_results || jsonb_build_object(
      'orden', 1, 'caso', '1_primer_registro', 'esperado', '1 fila',
      'obtenido', 'excepción ' || SQLSTATE, 'pass', false,
      'detalle', 'no debía fallar');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 2. Mismo request_id + MISMO payload → éxito idempotente, 1 sola fila ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE, 'login', VER, HASH, RID1);
    SELECT count(*) INTO v_n FROM public.otp_consent_events WHERE request_id = RID1;
    v_ok := (v_n = 1);
    v_results := v_results || jsonb_build_object(
      'orden', 2, 'caso', '2_idempotente_exacto', 'esperado', 'éxito y 1 sola fila',
      'obtenido', 'éxito y ' || v_n || ' fila(s)', 'pass', v_ok,
      'detalle', 'reintento exacto no duplica');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_results := v_results || jsonb_build_object(
      'orden', 2, 'caso', '2_idempotente_exacto', 'esperado', 'éxito y 1 sola fila',
      'obtenido', 'excepción ' || SQLSTATE, 'pass', false,
      'detalle', 'el reintento exacto no debía fallar');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 3. Mismo request_id + TELÉFONO distinto → rechazo genérico ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE2, 'login', VER, HASH, RID1);
    v_ok := false;
    v_results := v_results || jsonb_build_object(
      'orden', 3, 'caso', '3_rid_reusado_otro_telefono', 'esperado', 'rechazo genérico',
      'obtenido', 'NO falló', 'pass', false, 'detalle', 'aceptó un request_id reusado');
  EXCEPTION WHEN OTHERS THEN
    SELECT count(*) INTO v_n FROM public.otp_consent_events WHERE request_id = RID1;
    v_ok := (SQLSTATE = 'P0300' AND v_n = 1);
    v_results := v_results || jsonb_build_object(
      'orden', 3, 'caso', '3_rid_reusado_otro_telefono', 'esperado', 'rechazo genérico y 1 fila',
      'obtenido', SQLSTATE || ' y ' || v_n || ' fila(s)', 'pass', v_ok,
      'detalle', 'error genérico, sin fila nueva');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 3b. Mismo request_id + CONTEXTO distinto → rechazo genérico ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE, 'booking', VER, HASH, RID1);
    v_ok := false;
    v_results := v_results || jsonb_build_object(
      'orden', 4, 'caso', '3b_rid_reusado_otro_contexto', 'esperado', 'rechazo genérico',
      'obtenido', 'NO falló', 'pass', false, 'detalle', 'aceptó contexto distinto');
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0300');
    v_results := v_results || jsonb_build_object(
      'orden', 4, 'caso', '3b_rid_reusado_otro_contexto', 'esperado', 'rechazo genérico',
      'obtenido', SQLSTATE, 'pass', v_ok, 'detalle', 'error genérico');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 3c. Mismo request_id + HASH distinto → rechazo genérico ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE, 'login', VER, repeat('a', 64), RID1);
    v_ok := false;
    v_results := v_results || jsonb_build_object(
      'orden', 5, 'caso', '3c_rid_reusado_otro_hash', 'esperado', 'rechazo genérico',
      'obtenido', 'NO falló', 'pass', false, 'detalle', 'aceptó hash distinto');
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0300');
    v_results := v_results || jsonb_build_object(
      'orden', 5, 'caso', '3c_rid_reusado_otro_hash', 'esperado', 'rechazo genérico',
      'obtenido', SQLSTATE, 'pass', v_ok, 'detalle', 'error genérico');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 4. Diez solicitudes NUEVAS en la ventana → permitidas ──
  --     (ya hay 1 del caso 1 → se agregan 9 para llegar a 10)
  BEGIN
    FOR i IN 2..10 LOOP
      v_rid := ('0d1d2d00-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid;
      PERFORM public.record_otp_consent(PHONE, 'login', VER, HASH, v_rid);
    END LOOP;
    SELECT count(*) INTO v_n FROM public.otp_consent_events WHERE phone_e164 = PHONE;
    v_ok := (v_n = 10);
    v_results := v_results || jsonb_build_object(
      'orden', 6, 'caso', '4_diez_permitidas', 'esperado', '10 filas',
      'obtenido', v_n || ' fila(s)', 'pass', v_ok,
      'detalle', 'el límite permite 10 en la ventana');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_results := v_results || jsonb_build_object(
      'orden', 6, 'caso', '4_diez_permitidas', 'esperado', '10 filas',
      'obtenido', 'excepción ' || SQLSTATE, 'pass', false,
      'detalle', 'no debía bloquear antes de 10');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 5. La solicitud 11 (request_id nuevo) → BLOQUEADA por el límite ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE, 'login', VER, HASH, RID_X);
    v_ok := false;
    v_results := v_results || jsonb_build_object(
      'orden', 7, 'caso', '5_onceava_bloqueada', 'esperado', 'bloqueo por límite',
      'obtenido', 'NO falló', 'pass', false, 'detalle', 'permitió la solicitud 11');
  EXCEPTION WHEN OTHERS THEN
    SELECT count(*) INTO v_n FROM public.otp_consent_events WHERE phone_e164 = PHONE;
    v_ok := (SQLSTATE = 'P0301' AND v_n = 10);
    v_results := v_results || jsonb_build_object(
      'orden', 7, 'caso', '5_onceava_bloqueada', 'esperado', 'bloqueo y sigue en 10',
      'obtenido', SQLSTATE || ' y ' || v_n || ' fila(s)', 'pass', v_ok,
      'detalle', 'límite aplicado, sin fila nueva');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 6. Reintento idempotente EXACTO con el límite alcanzado → permitido ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE, 'login', VER, HASH, RID1);
    SELECT count(*) INTO v_n FROM public.otp_consent_events WHERE phone_e164 = PHONE;
    v_ok := (v_n = 10);
    v_results := v_results || jsonb_build_object(
      'orden', 8, 'caso', '6_idempotente_pese_al_limite', 'esperado', 'éxito y sigue en 10',
      'obtenido', 'éxito y ' || v_n || ' fila(s)', 'pass', v_ok,
      'detalle', 'el reintento exacto no consume límite');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
    v_results := v_results || jsonb_build_object(
      'orden', 8, 'caso', '6_idempotente_pese_al_limite', 'esperado', 'éxito',
      'obtenido', 'excepción ' || SQLSTATE, 'pass', false,
      'detalle', 'el reintento exacto no debía bloquearse');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 7a. Teléfono no salvadoreño → bloqueado ──
  BEGIN
    PERFORM public.record_otp_consent('+50170069901', 'login', VER, HASH, gen_random_uuid());
    v_ok := false;
    v_results := v_results || jsonb_build_object(
      'orden', 9, 'caso', '7a_telefono_no_sv', 'esperado', 'rechazo genérico',
      'obtenido', 'NO falló', 'pass', false, 'detalle', 'aceptó teléfono no SV');
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0300');
    v_results := v_results || jsonb_build_object(
      'orden', 9, 'caso', '7a_telefono_no_sv', 'esperado', 'rechazo genérico',
      'obtenido', SQLSTATE, 'pass', v_ok, 'detalle', 'error genérico');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 7b. Contexto inválido → bloqueado ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE2, 'recovery', VER, HASH, gen_random_uuid());
    v_ok := false;
    v_results := v_results || jsonb_build_object(
      'orden', 10, 'caso', '7b_contexto_invalido', 'esperado', 'rechazo genérico',
      'obtenido', 'NO falló', 'pass', false, 'detalle', 'aceptó contexto fuera de la lista');
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0300');
    v_results := v_results || jsonb_build_object(
      'orden', 10, 'caso', '7b_contexto_invalido', 'esperado', 'rechazo genérico',
      'obtenido', SQLSTATE, 'pass', v_ok, 'detalle', 'error genérico');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 7c. Versión inválida → bloqueada ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE2, 'login', 'otp-consent-v2', HASH, gen_random_uuid());
    v_ok := false;
    v_results := v_results || jsonb_build_object(
      'orden', 11, 'caso', '7c_version_invalida', 'esperado', 'rechazo genérico',
      'obtenido', 'NO falló', 'pass', false, 'detalle', 'aceptó versión distinta');
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0300');
    v_results := v_results || jsonb_build_object(
      'orden', 11, 'caso', '7c_version_invalida', 'esperado', 'rechazo genérico',
      'obtenido', SQLSTATE, 'pass', v_ok, 'detalle', 'error genérico');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 7d. Hash inválido → bloqueado ──
  BEGIN
    PERFORM public.record_otp_consent(PHONE2, 'login', VER, repeat('b', 64), gen_random_uuid());
    v_ok := false;
    v_results := v_results || jsonb_build_object(
      'orden', 12, 'caso', '7d_hash_invalido', 'esperado', 'rechazo genérico',
      'obtenido', 'NO falló', 'pass', false, 'detalle', 'aceptó hash distinto');
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0300');
    v_results := v_results || jsonb_build_object(
      'orden', 12, 'caso', '7d_hash_invalido', 'esperado', 'rechazo genérico',
      'obtenido', SQLSTATE, 'pass', v_ok, 'detalle', 'error genérico');
  END;
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 8. anon SIN SELECT ni DML directo sobre la tabla ──
  v_ok := NOT has_table_privilege('anon', 'public.otp_consent_events', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.otp_consent_events', 'INSERT')
      AND NOT has_table_privilege('anon', 'public.otp_consent_events', 'UPDATE')
      AND NOT has_table_privilege('anon', 'public.otp_consent_events', 'DELETE');
  v_results := v_results || jsonb_build_object(
    'orden', 13, 'caso', '8_anon_sin_acceso_directo', 'esperado', 'sin SELECT/INSERT/UPDATE/DELETE',
    'obtenido', format('sel=%s ins=%s upd=%s del=%s',
      has_table_privilege('anon', 'public.otp_consent_events', 'SELECT'),
      has_table_privilege('anon', 'public.otp_consent_events', 'INSERT'),
      has_table_privilege('anon', 'public.otp_consent_events', 'UPDATE'),
      has_table_privilege('anon', 'public.otp_consent_events', 'DELETE')),
    'pass', v_ok, 'detalle', 'la tabla solo se escribe vía RPC definer');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 9. authenticated SIN SELECT ni DML directo sobre la tabla ──
  v_ok := NOT has_table_privilege('authenticated', 'public.otp_consent_events', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.otp_consent_events', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.otp_consent_events', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.otp_consent_events', 'DELETE');
  v_results := v_results || jsonb_build_object(
    'orden', 14, 'caso', '9_authenticated_sin_acceso_directo', 'esperado', 'sin SELECT/INSERT/UPDATE/DELETE',
    'obtenido', format('sel=%s ins=%s upd=%s del=%s',
      has_table_privilege('authenticated', 'public.otp_consent_events', 'SELECT'),
      has_table_privilege('authenticated', 'public.otp_consent_events', 'INSERT'),
      has_table_privilege('authenticated', 'public.otp_consent_events', 'UPDATE'),
      has_table_privilege('authenticated', 'public.otp_consent_events', 'DELETE')),
    'pass', v_ok, 'detalle', 'la tabla solo se escribe vía RPC definer');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 10. EXECUTE de la RPC según grants (anon y authenticated permitidos) ──
  v_ok := has_function_privilege('anon',
            'public.record_otp_consent(text,text,text,text,uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated',
            'public.record_otp_consent(text,text,text,text,uuid)', 'EXECUTE');
  v_results := v_results || jsonb_build_object(
    'orden', 15, 'caso', '10_execute_rpc_segun_grants', 'esperado', 'anon y authenticated con EXECUTE',
    'obtenido', format('anon=%s authenticated=%s',
      has_function_privilege('anon', 'public.record_otp_consent(text,text,text,text,uuid)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.record_otp_consent(text,text,text,text,uuid)', 'EXECUTE')),
    'pass', v_ok, 'detalle', 'el consentimiento es pre-auth');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── 11. Conteo de filas creadas DENTRO de la transacción (se revierten) ──
  SELECT count(*) INTO v_n FROM public.otp_consent_events
  WHERE phone_e164 IN (PHONE, PHONE2);
  v_ok := (v_n = 10);
  v_results := v_results || jsonb_build_object(
    'orden', 16, 'caso', '11_filas_en_transaccion', 'esperado', '10 filas sintéticas',
    'obtenido', v_n || ' fila(s)', 'pass', v_ok,
    'detalle', 'el ROLLBACK final las revierte');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ── Publicación de resultados como parámetro LOCAL a la transacción ──
  PERFORM set_config(
    'p1d2.smoke_results',
    jsonb_build_object(
      'casos', v_results,
      'total', jsonb_array_length(v_results),
      'fallidos', v_fail,
      'veredicto_global', CASE WHEN v_fail = 0 THEN 'PASS' ELSE 'FAIL' END
    )::text,
    true
  );
END
$smoke$;

-- SALIDA ÚNICA: un solo JSON legible con todos los casos y el veredicto global.
SELECT jsonb_pretty(current_setting('p1d2.smoke_results', true)::jsonb) AS smoke_results;

-- Revierte TODO: las filas sintéticas y el parámetro local. Cero residuos.
ROLLBACK;
```

## Criterio de paso

`veredicto_global = "PASS"`, `fallidos = 0` y todos los casos con `pass: true`.
Verificación posterior (fuera de la transacción, opcional):

```sql
SELECT count(*) FROM public.otp_consent_events
WHERE phone_e164 IN ('+50370069901','+50370069902');   -- debe ser 0
```
