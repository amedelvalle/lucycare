# OWNER — Smoke transaccional de `s7_73` + `s7_74` (ADMIN-DOCTOR-SEED-P0)

> Ejecutar en el **SQL Editor de Supabase**, con `s7_73` y `s7_74` ya aplicadas.
> **Todo en una transacción que termina en `ROLLBACK`: cero filas persistentes.**
> No usa `service_role`. Fixtures sintéticas (`operation_id` con prefijo `5eed…`);
> jamás datos reales, ni Katherine (`50372608827`), ni el demo de Camilo.
>
> **Cómo ejecutar:**
> 1. **BLOQUE 0** — identificar el UUID del admin (solo si hace falta).
> 2. **BLOQUE 1** — pegar el UUID en `v_admin_id` y correr el bloque completo,
>    desde `BEGIN;` hasta `ROLLBACK;`, en **una sola ejecución**.
> 3. **BLOQUE 2** — correr por separado, después.
>
> **Criterio de paso:** `veredicto_global = "PASS"`, todos los casos con
> `pass: true`, y el BLOQUE 2 devolviendo `0`.

---

## Por qué este smoke reemplaza a `_smoke-s7_73.mjs`

**`scripts/_smoke-s7_73.mjs` = NO EJECUTAR.** Usa `supabaseAdmin`, es decir la
secret key sin JWT de usuario. Con esa credencial:

- `auth.uid()` es **NULL** — la secret key no lleva `sub`;
- por lo tanto `is_admin()` —que es
  `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role='admin')`— es
  **false**;
- y la **primera instrucción** de las seis RPCs es
  `IF NOT public.is_admin() THEN RAISE EXCEPTION … P0120`.

Los 18 casos fallarían con `P0120`. Hay además un **segundo bloqueo
independiente**: `requested_by uuid NOT NULL REFERENCES profiles(id)` recibe
`auth.uid()`, que sería NULL → `23502`.

> ⚠️ La cabecera del script `.mjs` afirmaba que `service_role` "bypassa
> `is_admin()` porque `SECURITY DEFINER` corre como owner". **Es incorrecto.**
> `SECURITY DEFINER` cambia los privilegios SQL del cuerpo; **no fabrica un
> `auth.uid()`**. El script quedó convertido en un **fail-fast informativo** que
> no hace ninguna llamada de red y apunta a este documento.

Este smoke SQL resuelve las dos barreras a la vez: `set_config` sobre
`request.jwt.claims` hace que `auth.uid()` sea un admin **real y explícito**, lo
que abre `is_admin()` y da un `requested_by` válido — y el `ROLLBACK` lo revierte
todo.

---

## Qué cubre y qué NO

**Cubre:** el gate `is_admin()` con identidad real · idempotencia del claim ·
`payload_hash` divergente · **lease y ownership (`P0132`) en las CUATRO RPCs
mutadoras** · **lease vencido → `resume`, rotación del token y expulsión del
worker viejo** · transiciones ilegales (`P0123`) · `seed_user_id` inválido
(`P0125`) · datos obligatorios (`P0131`) · preservación del primer `error_code` ·
`+compensation_failed` anexado e idempotente · lectura de una operación fallida
por el claim · privilegios de tabla · la policy corregida por `s7_74`.

**NO cubre:**

| No cubierto | Por qué |
|---|---|
| **Concurrencia real** (dos claims en paralelo) | requiere dos sesiones simultáneas; una transacción no puede competir consigo misma |
| **`admin_create_seed_doctor` camino completo** | exige un `auth.users` técnico real, que solo crea el Admin API. Aquí se prueban **sus guardas**, que fallan antes de tocar `profiles` |
| **Edge Function, Admin API y cold boot de Deno** | fuera del alcance de cualquier smoke SQL; se validan en la QA controlada con sesión real de LucyAdmin |

> **Sobre el lease vencido:** una versión anterior de este documento afirmaba que
> no era comprobable porque `now()` está congelado dentro de la transacción. Eso
> era **incorrecto**: no hace falta adelantar el reloj, basta **retrodatar la
> fixture**. El caso 20 hace `updated_at = now() - interval '121 seconds'`
> **exclusivamente sobre el `operation_id` sintético creado por el propio
> smoke**, y a partir de ahí el camino `resume` queda plenamente ejercitado.

---

## BLOQUE 0 — identificar el admin (read-only, opcional)

```sql
SELECT id, full_name, role
  FROM public.profiles
 WHERE role = 'admin'
 ORDER BY full_name;
```

Elegir el `id` del admin con el que se quiere correr el smoke y pegarlo en
`v_admin_id` del BLOQUE 1. **El smoke NUNCA modifica ese profile**: solo lo lee
para validar que existe y es admin, y usa su `id` como `auth.uid()` y como
`requested_by` de filas que se revierten.

---

## BLOQUE 1 — el smoke

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- smoke s7_73 + s7_74 — ADMIN-DOCTOR-SEED-P0
-- Una sola ejecución. Termina SIEMPRE en ROLLBACK: cero filas persistentes.
-- Sin service_role. Sin objetos temporales (ver OWNER_S7_69_SMOKE.md).
-- SALIDA: un ÚNICO JSON con todos los casos y un veredicto global.
-- Los casos que esperan error corren en subtransacciones BEGIN/EXCEPTION para
-- que un fallo esperado no aborte el smoke completo.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $smoke$
DECLARE
  -- ⬇️⬇️⬇️  REEMPLAZAR por el UUID del admin elegido en el BLOQUE 0.  ⬇️⬇️⬇️
  v_admin_id constant uuid := '00000000-0000-0000-0000-000000000000';
  -- ⬆️⬆️⬆️  Sin esto el smoke aborta de inmediato.                   ⬆️⬆️⬆️

  v_results jsonb := '[]'::jsonb;
  v_fail    int   := 0;
  v_ok      boolean;
  v_got     text;

  v_role    text;
  v_claims  text;
  v_res     jsonb;
  v_uuid    uuid;
  v_n       int;

  -- Fixtures sintéticas. El prefijo 5eed las hace reconocibles de un vistazo.
  OP_A constant uuid := '5eed0073-0000-4000-8000-00000000000a';
  OP_L constant uuid := '5eed0073-0000-4000-8000-00000000000b';
  OP_R constant uuid := '5eed0073-0000-4000-8000-00000000000c';
  FAKE constant uuid := '5eed0073-0000-4000-8000-0000000000ff';

  v_lease_a  uuid;
  v_lease_l  uuid;
  v_lease_r1 uuid;
  v_lease_r2 uuid;
BEGIN
  -- ══════════════════════════════════════════════════════════════════
  -- HARNESS. Sin esto, todo lo demás no significa nada: se aborta con
  -- excepción en vez de reportar decenas de falsos negativos.
  -- ══════════════════════════════════════════════════════════════════

  -- H0. El placeholder fue reemplazado
  v_ok := (v_admin_id <> '00000000-0000-0000-0000-000000000000'::uuid);
  v_results := v_results || jsonb_build_object(
    'orden', 0, 'caso', 'H0_admin_id_explicito', 'esperado', 'uuid real pegado por el owner',
    'obtenido', v_admin_id::text, 'pass', v_ok, 'detalle', 'nada de admin arbitrario');
  IF NOT v_ok THEN
    RAISE EXCEPTION 'HARNESS: hay que reemplazar v_admin_id por el UUID del admin (BLOQUE 0)';
  END IF;

  -- H1. El profile existe y es admin  (SOLO LECTURA: jamás se modifica)
  SELECT role INTO v_role FROM public.profiles WHERE id = v_admin_id;
  v_ok  := (v_role = 'admin');
  v_got := coalesce('role=' || v_role, 'profile inexistente');
  v_results := v_results || jsonb_build_object(
    'orden', 0, 'caso', 'H1_profile_es_admin', 'esperado', 'existe y role=admin',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'guarda bloqueante');
  IF NOT v_ok THEN
    RAISE EXCEPTION 'HARNESS: % no es un profile admin (%)', v_admin_id, v_got;
  END IF;

  -- Claims de sesión, LOCALES a la transacción.
  v_claims := json_build_object('sub', v_admin_id::text, 'role', 'authenticated')::text;
  PERFORM set_config('request.jwt.claims',    v_claims,          true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text,  true);

  -- H2. auth.uid() refleja al admin
  v_ok  := (auth.uid() = v_admin_id);
  v_got := coalesce(auth.uid()::text, 'NULL');
  v_results := v_results || jsonb_build_object(
    'orden', 0, 'caso', 'H2_auth_uid_es_el_admin', 'esperado', 'auth.uid() = v_admin_id',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'valida el harness de claims');
  IF NOT v_ok THEN
    RAISE EXCEPTION 'HARNESS: auth.uid() no refleja al admin (obtenido: %)', v_got;
  END IF;

  -- H3. is_admin() abre
  v_ok := public.is_admin();
  v_results := v_results || jsonb_build_object(
    'orden', 0, 'caso', 'H3_is_admin_true', 'esperado', 'true',
    'obtenido', v_ok::text, 'pass', v_ok, 'detalle', 'sin esto todo daría P0120');
  IF NOT v_ok THEN
    RAISE EXCEPTION 'HARNESS: is_admin() es false pese al claim';
  END IF;

  -- H4. s7_74 aplicada: la policy apunta a authenticated
  SELECT count(*) INTO v_n
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'admin_seed_operations'
     AND policyname = 'seedops_select_admin'
     AND cmd = 'SELECT'
     AND roles::text = '{authenticated}'
     AND coalesce(qual, '') LIKE '%is_admin()%'
     AND with_check IS NULL;
  v_ok := (v_n = 1);
  v_results := v_results || jsonb_build_object(
    'orden', 0, 'caso', 'H4_policy_s7_74', 'esperado', 'SELECT/{authenticated}/is_admin()/sin WITH CHECK',
    'obtenido', v_n || ' policy coincidente', 'pass', v_ok, 'detalle', 's7_74 aplicada');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 1. claim inicial ══
  BEGIN
    v_res := public.admin_claim_seed_operation(OP_A, 'hash-a');
    v_lease_a := (v_res ->> 'lease_token')::uuid;
    v_ok  := (v_res ->> 'action' = 'claimed') AND v_lease_a IS NOT NULL;
    v_got := v_res::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_got := 'excepción ' || SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 1, 'caso', '1_claim_inicial', 'esperado', 'action=claimed + lease_token',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'el INSERT sobre la PK es el cerrojo');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 2. retry con el mismo payload, lease fresco ══
  BEGIN
    v_res := public.admin_claim_seed_operation(OP_A, 'hash-a');
    v_ok  := (v_res ->> 'action' = 'in_progress');
    v_got := v_res::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_got := 'excepción ' || SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 2, 'caso', '2_retry_en_lease', 'esperado', 'action=in_progress',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'idempotencia dentro del arriendo');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 3. misma operation_id, payload distinto → P0122 ══
  BEGIN
    v_res := public.admin_claim_seed_operation(OP_A, 'hash-DISTINTO');
    v_ok := false; v_got := 'sin error: ' || v_res::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0122'); v_got := SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 3, 'caso', '3_payload_divergente', 'esperado', 'P0122',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'el hash se calcula server-side');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 4. claim sin datos obligatorios → P0131 (no llega a insertar) ══
  BEGIN
    v_res := public.admin_claim_seed_operation(FAKE, '   ');
    v_ok := false; v_got := 'sin error: ' || v_res::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0131'); v_got := SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 4, 'caso', '4_payload_hash_vacio', 'esperado', 'P0131',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'guarda de datos obligatorios');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 5. lookup sin auth.user técnico → NULL ══
  BEGIN
    v_uuid := public.admin_lookup_seed_user(OP_A);
    v_ok   := (v_uuid IS NULL);
    v_got  := coalesce(v_uuid::text, 'NULL');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_got := 'excepción ' || SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 5, 'caso', '5_lookup_sin_identidad', 'esperado', 'NULL',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'no enumera auth.users');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 6. LEASE 1/4 · set_auth_created con lease ajeno → P0132 ══
  BEGIN
    PERFORM public.admin_seed_operation_set_auth_created(OP_A, FAKE, FAKE);
    v_ok := false; v_got := 'sin error';
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0132'); v_got := SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 6, 'caso', '6_lease_set_auth_created', 'esperado', 'P0132',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'ownership se evalúa ANTES que el estado');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 7. set_auth_created con un uuid que no es el seed → P0125 ══
  BEGIN
    PERFORM public.admin_seed_operation_set_auth_created(OP_A, FAKE, v_lease_a);
    v_ok := false; v_got := 'sin error';
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0125'); v_got := SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 7, 'caso', '7_set_auth_uuid_ajeno', 'esperado', 'P0125',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'el uuid debe ser el seed de ESTA operación');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 8. LEASE 2/4 · mark_failed con lease ajeno → P0132 ══
  BEGIN
    PERFORM public.admin_seed_operation_mark_failed(OP_A, 'x', FAKE);
    v_ok := false; v_got := 'sin error';
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0132'); v_got := SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 8, 'caso', '8_lease_mark_failed', 'esperado', 'P0132',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'un worker viejo no puede marcar');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 9. mark_failed marca la operación ══
  BEGIN
    v_res := public.admin_seed_operation_mark_failed(OP_A, 'duplicate_phone', v_lease_a);
    v_ok  := (v_res ->> 'action' = 'failed');
    v_got := v_res::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_got := 'excepción ' || SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 9, 'caso', '9_mark_failed', 'esperado', 'action=failed',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'persistencia confirmada');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 10. mark_failed idempotente: conserva el PRIMER error_code ══
  BEGIN
    v_res := public.admin_seed_operation_mark_failed(OP_A, 'otro_motivo', v_lease_a);
    v_ok  := (v_res ->> 'error_code' = 'duplicate_phone');
    v_got := v_res::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_got := 'excepción ' || SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 10, 'caso', '10_mark_failed_idempotente', 'esperado', 'error_code=duplicate_phone',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'el primer motivo no se pisa');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 11. el claim sobre una operación fallida la reporta ══
  BEGIN
    v_res := public.admin_claim_seed_operation(OP_A, 'hash-a');
    v_ok  := (v_res ->> 'action' = 'failed')
             AND (v_res ->> 'error_code' = 'duplicate_phone');
    v_got := v_res::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_got := 'excepción ' || SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 11, 'caso', '11_claim_sobre_failed', 'esperado', 'action=failed + error_code',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'terminal: no se reabre');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 12. flag_compensation_failed anexa preservando el motivo ══
  BEGIN
    v_res := public.admin_seed_operation_flag_compensation_failed(OP_A, v_lease_a);
    v_ok  := (v_res ->> 'error_code' = 'duplicate_phone+compensation_failed');
    v_got := v_res::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_got := 'excepción ' || SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 12, 'caso', '12_flag_anexa', 'esperado', 'duplicate_phone+compensation_failed',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'cleanup fallido queda diagnosticable');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 13. flag idempotente ══
  BEGIN
    v_res := public.admin_seed_operation_flag_compensation_failed(OP_A, v_lease_a);
    v_ok  := (v_res ->> 'action' = 'already_flagged');
    v_got := v_res::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_got := 'excepción ' || SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 13, 'caso', '13_flag_idempotente', 'esperado', 'action=already_flagged',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'no duplica la marca');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 14. LEASE 3/4 · flag con lease ajeno → P0132 ══
  BEGIN
    PERFORM public.admin_seed_operation_flag_compensation_failed(OP_A, FAKE);
    v_ok := false; v_got := 'sin error';
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0132'); v_got := SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 14, 'caso', '14_lease_flag_compensation', 'esperado', 'P0132',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'ownership también acá');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 15. segunda operación en 'started' para las guardas de estado ══
  BEGIN
    v_res := public.admin_claim_seed_operation(OP_L, 'hash-l');
    v_lease_l := (v_res ->> 'lease_token')::uuid;
    v_ok  := (v_res ->> 'action' = 'claimed');
    v_got := v_res::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_got := 'excepción ' || SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 15, 'caso', '15_segunda_operacion', 'esperado', 'action=claimed',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'base para las guardas de estado');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 16. flag sobre 'started' → P0123 ══
  BEGIN
    PERFORM public.admin_seed_operation_flag_compensation_failed(OP_L, v_lease_l);
    v_ok := false; v_got := 'sin error';
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0123'); v_got := SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 16, 'caso', '16_flag_sobre_started', 'esperado', 'P0123',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'solo se anota sobre failed');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 17. LEASE 4/4 · create_seed_doctor con lease ajeno → P0132 ══
  BEGIN
    PERFORM public.admin_create_seed_doctor(OP_L, FAKE, 'hash-l', '{}'::jsonb, FAKE);
    v_ok := false; v_got := 'sin error';
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0132'); v_got := SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 17, 'caso', '17_lease_create_seed_doctor', 'esperado', 'P0132',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'ownership precede al estado');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 18. create_seed_doctor sobre estado != auth_created → P0123 ══
  BEGIN
    PERFORM public.admin_create_seed_doctor(OP_L, FAKE, 'hash-l', '{}'::jsonb, v_lease_l);
    v_ok := false; v_got := 'sin error';
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0123'); v_got := SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 18, 'caso', '18_create_estado_ilegal', 'esperado', 'P0123',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'falla ANTES de tocar profiles');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══════════════════════════════════════════════════════════════════
  -- LEASE VENCIDO → resume, rotación del token y expulsión del viejo.
  -- ══════════════════════════════════════════════════════════════════

  -- ══ 19. tercera operación ══
  BEGIN
    v_res := public.admin_claim_seed_operation(OP_R, 'hash-r');
    v_lease_r1 := (v_res ->> 'lease_token')::uuid;
    v_ok  := (v_res ->> 'action' = 'claimed') AND v_lease_r1 IS NOT NULL;
    v_got := v_res::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_got := 'excepción ' || SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 19, 'caso', '19_tercera_operacion', 'esperado', 'action=claimed',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'fixture del lease vencido');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 20. PREPARACIÓN DE FIXTURE: retrodatar updated_at 121 s ══
  -- No es un camino de producción: es preparación de estado, restringida al
  -- operation_id SINTÉTICO que creó este mismo smoke, dentro de la transacción
  -- que termina en ROLLBACK. Posible sólo porque el SQL Editor corre como
  -- owner de la tabla; ningún cliente puede hacer este UPDATE (authenticated
  -- no tiene UPDATE y anon no tiene nada).
  -- Guarda: la fila debe existir, ser nuestra fixture y estar en 'started'.
  BEGIN
    SELECT count(*) INTO v_n
      FROM public.admin_seed_operations
     WHERE operation_id = OP_R
       AND requested_by = v_admin_id
       AND status = 'started';
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'la fixture OP_R no está en el estado esperado (% filas)', v_n;
    END IF;

    UPDATE public.admin_seed_operations
       SET updated_at = now() - interval '121 seconds'
     WHERE operation_id = OP_R;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    v_ok  := (v_n = 1);
    v_got := v_n || ' fila retrodatada';
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_got := 'excepción ' || SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 20, 'caso', '20_fixture_lease_vencido', 'esperado', 'exactamente 1 fila sintética',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'preparación de estado, solo sobre OP_R');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 21. el claim retoma la operación abandonada → resume ══
  BEGIN
    v_res := public.admin_claim_seed_operation(OP_R, 'hash-r');
    v_lease_r2 := (v_res ->> 'lease_token')::uuid;
    v_ok  := (v_res ->> 'action' = 'resume') AND v_lease_r2 IS NOT NULL;
    v_got := v_res::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_got := 'excepción ' || SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 21, 'caso', '21_resume_por_lease_vencido', 'esperado', 'action=resume + lease_token',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'el arriendo venció: otro worker entra');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 22. el token ROTÓ ══
  v_ok  := (v_lease_r2 IS NOT NULL) AND (v_lease_r2 <> v_lease_r1);
  v_got := 'rotó: ' || (v_lease_r2 IS DISTINCT FROM v_lease_r1)::text;
  v_results := v_results || jsonb_build_object(
    'orden', 22, 'caso', '22_token_rotado', 'esperado', 'lease nuevo != lease viejo',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'rotar es lo que expulsa al worker viejo');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 23. el worker VIEJO ya no puede mutar → P0132 ══
  BEGIN
    PERFORM public.admin_seed_operation_mark_failed(OP_R, 'zombie', v_lease_r1);
    v_ok := false; v_got := 'sin error: el worker viejo mutó (!!)';
  EXCEPTION WHEN OTHERS THEN
    v_ok := (SQLSTATE = 'P0132'); v_got := SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 23, 'caso', '23_worker_viejo_expulsado', 'esperado', 'P0132',
    'obtenido', v_got, 'pass', v_ok,
    'detalle', 'un worker congelado que despierta no puede compensar ni marcar');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 24. el worker NUEVO sí puede ══
  BEGIN
    v_res := public.admin_seed_operation_mark_failed(OP_R, 'internal', v_lease_r2);
    v_ok  := (v_res ->> 'action' = 'failed');
    v_got := v_res::text;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_got := 'excepción ' || SQLSTATE;
  END;
  v_results := v_results || jsonb_build_object(
    'orden', 24, 'caso', '24_worker_nuevo_manda', 'esperado', 'action=failed',
    'obtenido', v_got, 'pass', v_ok, 'detalle', 'el token vigente sí muta');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 25. privilegios: authenticated sin DML directo ══
  v_ok := has_table_privilege('authenticated', 'public.admin_seed_operations', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.admin_seed_operations', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.admin_seed_operations', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.admin_seed_operations', 'DELETE');
  v_results := v_results || jsonb_build_object(
    'orden', 25, 'caso', '25_authenticated_sin_dml', 'esperado', 'SELECT sí, DML no',
    'obtenido', v_ok::text, 'pass', v_ok, 'detalle', 'las transiciones solo por RPC');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 26. privilegios: anon sin nada ══
  v_ok := NOT has_table_privilege('anon', 'public.admin_seed_operations', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.admin_seed_operations', 'INSERT')
      AND NOT has_table_privilege('anon', 'public.admin_seed_operations', 'UPDATE')
      AND NOT has_table_privilege('anon', 'public.admin_seed_operations', 'DELETE');
  v_results := v_results || jsonb_build_object(
    'orden', 26, 'caso', '26_anon_sin_acceso', 'esperado', 'sin ningún privilegio',
    'obtenido', v_ok::text, 'pass', v_ok, 'detalle', 'primera barrera, antes de la policy');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 27. el profile del admin NO fue tocado ══
  SELECT count(*) INTO v_n
    FROM public.profiles
   WHERE id = v_admin_id AND role = 'admin';
  v_ok := (v_n = 1);
  v_results := v_results || jsonb_build_object(
    'orden', 27, 'caso', '27_admin_intacto', 'esperado', 'sigue existiendo y sigue siendo admin',
    'obtenido', v_n || ' fila', 'pass', v_ok, 'detalle', 'el smoke nunca lo modifica');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ 28. cero residuos DENTRO de la transacción ══
  DELETE FROM public.admin_seed_operations
   WHERE operation_id IN (OP_A, OP_L, OP_R, FAKE);
  SELECT count(*) INTO v_n
    FROM public.admin_seed_operations
   WHERE operation_id IN (OP_A, OP_L, OP_R, FAKE);
  v_ok := (v_n = 0);
  v_results := v_results || jsonb_build_object(
    'orden', 28, 'caso', '28_cero_residuos', 'esperado', '0 fixtures',
    'obtenido', v_n || ' fila(s)', 'pass', v_ok,
    'detalle', 'el ROLLBACK final lo garantiza igual');
  IF NOT v_ok THEN v_fail := v_fail + 1; END IF;

  -- ══ Publicación de resultados (parámetro LOCAL a la transacción) ══
  PERFORM set_config('seed73.smoke_results',
    jsonb_build_object(
      'veredicto_global', CASE WHEN v_fail = 0 THEN 'PASS' ELSE 'FAIL' END,
      'casos_fallidos',   v_fail,
      'admin_utilizado',  v_admin_id,
      'casos',            v_results
    )::text, true);
END $smoke$;

SELECT jsonb_pretty(current_setting('seed73.smoke_results', true)::jsonb) AS smoke_results;

ROLLBACK;
```

## BLOQUE 2 — confirmación de cero residuos, **después** del `ROLLBACK`

```sql
SELECT count(*) AS filas_residuales
  FROM public.admin_seed_operations;
```

**Esperado: `0`.**

---

## Resultado esperado del BLOQUE 1

`veredicto_global = "PASS"`, `casos_fallidos = 0`, y los **33 casos** con
`pass: true` (5 de harness + 28 numerados).

| # | Caso | Esperado |
|---|---|---|
| H0 | `v_admin_id` explícito | uuid pegado por el owner |
| H1 | el profile existe y es admin | `role=admin` |
| H2 | `auth.uid()` es el admin | uuid del admin |
| H3 | `is_admin()` | `true` |
| H4 | policy de `s7_74` | 1 coincidencia |
| 1 | claim inicial | `action=claimed` + `lease_token` |
| 2 | retry en el lease | `action=in_progress` |
| 3 | payload divergente | `P0122` |
| 4 | `payload_hash` vacío | `P0131` |
| 5 | lookup sin identidad | `NULL` |
| **6** | **lease 1/4 — `set_auth_created`** | **`P0132`** |
| 7 | `set_auth_created` uuid ajeno | `P0125` |
| **8** | **lease 2/4 — `mark_failed`** | **`P0132`** |
| 9 | `mark_failed` | `action=failed` |
| 10 | `mark_failed` idempotente | `error_code=duplicate_phone` |
| 11 | claim sobre `failed` | `action=failed` + `error_code` |
| 12 | flag anexa | `duplicate_phone+compensation_failed` |
| 13 | flag idempotente | `action=already_flagged` |
| **14** | **lease 3/4 — `flag_compensation_failed`** | **`P0132`** |
| 15 | segunda operación | `action=claimed` |
| 16 | flag sobre `started` | `P0123` |
| **17** | **lease 4/4 — `create_seed_doctor`** | **`P0132`** |
| 18 | `create_seed_doctor` estado ilegal | `P0123` |
| 19 | tercera operación | `action=claimed` |
| 20 | fixture retrodatada 121 s | 1 fila |
| 21 | `resume` por lease vencido | `action=resume` + `lease_token` |
| 22 | el token rotó | nuevo ≠ viejo |
| 23 | worker viejo expulsado | `P0132` |
| 24 | worker nuevo manda | `action=failed` |
| 25 | `authenticated` sin DML | `true` |
| 26 | `anon` sin acceso | `true` |
| 27 | admin intacto | 1 fila, sigue admin |
| 28 | cero residuos | `0 fila(s)` |

## Cobertura del lease guard — las CUATRO mutadoras

Verificado en `s7_73`: `P0132` aparece **una vez en cada una** de las cuatro RPCs
que mutan estado, y en las cuatro **antes** de evaluar el estado.

| RPC | Caso |
|---|---|
| `admin_seed_operation_set_auth_created` | 6 |
| `admin_seed_operation_mark_failed` | 8 · 23 |
| `admin_seed_operation_flag_compensation_failed` | 14 |
| `admin_create_seed_doctor` | 17 |

> ℹ️ La cabecera de `migrations/s7_73_admin_seed_doctor.sql` dice *"las tres RPCs
> que mutan"*. Son **cuatro**. Es una imprecisión de comentario en una migración
> **ya aplicada**, así que no se toca; queda anotada acá.

## Notas de seguridad

- **Cero escrituras persistentes.** Todo vive dentro de `BEGIN … ROLLBACK`, y el
  caso 28 además borra las fixtures antes del `ROLLBACK`. El parámetro
  `seed73.smoke_results` es `is_local = true`: también se revierte.
- **El único `UPDATE` directo es el caso 20**, restringido por `WHERE
  operation_id = OP_R` — una fixture creada por el propio smoke, verificada antes
  como suya (`requested_by = v_admin_id`, `status='started'`) y con
  `ROW_COUNT = 1` comprobado después. Nunca toca una operación ajena.
- **El profile del admin no se modifica jamás:** solo se lee. El caso 27 lo
  verifica explícitamente.
- **No toca `auth.users`.** Ninguna RPC ejercida lo escribe;
  `admin_lookup_seed_user` solo lo lee.
- **No usa `service_role`**, ni el Admin API, ni la Edge Function.
- **No crea ningún perfil sembrado:** `admin_create_seed_doctor` solo se ejercita
  en sus guardas, que fallan antes de tocar `profiles`, `doctors` o `clinics`.
