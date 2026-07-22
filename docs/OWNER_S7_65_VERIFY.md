# OWNER — Verificación de `s7_65` (AUTH-P1B1A)

> Bloques para ejecutar en el **SQL Editor de Supabase**. Cada sección es
> independiente y está rotulada. **Ninguna deja residuos:** las secciones que
> crean datos son transaccionales y terminan en **rollback deliberado**.
>
> **Orden sugerido:** **A** (antes de aplicar) → aplicar `s7_65` → **B** →
> **C** → **D** → **E** → **G**. La sección **F** describe qué esperar.
>
> Reglas respetadas: fixtures **sintéticas** (namespace `503700072xx`,
> marcador `AP1B_FIXTURE`); **jamás Katherine**; el único dato real que se
> lee es el teléfono del médico demo (Camilo) **solo en memoria, nunca
> impreso**, porque un médico sintético exigiría una fila en `profiles` y su
> FK obliga a tocar `auth.users` (prohibido). **No se imprime ningún nombre,
> teléfono ni ID real.**

---

## A. Estado del sistema — ANTES de aplicar

> **Toda esta sección corre SIN errores antes de `s7_65`:** las tablas y
> funciones nuevas todavía no existen, así que los chequeos usan
> `to_regclass` / `to_regprocedure` (devuelven NULL si el objeto falta, no
> lanzan). Sirve para (1) registrar el punto de partida y (2) detectar
> accesos que los grants de la migración **no** podrían restringir.

```sql
-- A0. ATRIBUTOS DE ROL (supabase_auth_admin y service_role): superusuario o
--     BYPASSRLS ⇒ los grants columnarios y las policies NO lo restringen.
SELECT rolname, rolsuper, rolbypassrls, rolinherit, rolcanlogin
FROM pg_roles
WHERE rolname IN ('supabase_auth_admin', 'service_role')
ORDER BY rolname;

-- A0b. MEMBRESÍAS (privilegios HEREDADOS, invisibles en los GRANT directos).
SELECT member.rolname AS rol, r.rolname AS miembro_de, m.admin_option
FROM pg_auth_members m
JOIN pg_roles r      ON r.oid = m.roleid
JOIN pg_roles member ON member.oid = m.member
WHERE member.rolname IN ('supabase_auth_admin', 'service_role')
ORDER BY member.rolname, r.rolname;

-- A0c. PRIVILEGIOS EFECTIVOS (directos + heredados) de AMBOS roles sobre las
--      tablas de evidencia EXISTENTES. has_table_privilege resuelve herencia.
SELECT rol, t.table_name,
       has_table_privilege(rol, 'public.' || t.table_name, 'SELECT') AS sel,
       has_table_privilege(rol, 'public.' || t.table_name, 'INSERT') AS ins,
       has_table_privilege(rol, 'public.' || t.table_name, 'UPDATE') AS upd,
       has_table_privilege(rol, 'public.' || t.table_name, 'DELETE') AS del
FROM (VALUES ('supabase_auth_admin'), ('service_role')) AS roles(rol)
CROSS JOIN (VALUES ('patients'),('profiles'),('doctors'),('clinic_invitations'),
                   ('platform_admin_invitations')) AS t(table_name)
ORDER BY rol, t.table_name;

-- A0d. PRIVILEGIOS EFECTIVOS sobre las TABLAS NUEVAS (tolera que no existan:
--      to_regclass → NULL antes de aplicar → la fila muestra NULL, sin error).
SELECT rol, t.table_name,
       CASE WHEN to_regclass('public.' || t.table_name) IS NULL THEN NULL
            ELSE has_table_privilege(rol, 'public.' || t.table_name, 'SELECT') END AS sel,
       CASE WHEN to_regclass('public.' || t.table_name) IS NULL THEN NULL
            ELSE has_table_privilege(rol, 'public.' || t.table_name, 'INSERT') END AS ins,
       CASE WHEN to_regclass('public.' || t.table_name) IS NULL THEN NULL
            ELSE has_table_privilege(rol, 'public.' || t.table_name, 'UPDATE') END AS upd,
       CASE WHEN to_regclass('public.' || t.table_name) IS NULL THEN NULL
            ELSE has_table_privilege(rol, 'public.' || t.table_name, 'DELETE') END AS del
FROM (VALUES ('supabase_auth_admin'), ('service_role'), ('anon'), ('authenticated')) AS roles(rol)
CROSS JOIN (VALUES ('auth_creation_grants'), ('booking_intents')) AS t(table_name)
ORDER BY t.table_name, rol;

-- A0e. EXECUTE sobre las FUNCIONES nuevas (tolera que no existan:
--      to_regprocedure → NULL antes de aplicar → EXECUTE NULL, sin error).
SELECT roles.rol,
       CASE WHEN to_regprocedure('public.auth_phone_e164(text)') IS NULL THEN NULL
            ELSE has_function_privilege(roles.rol, 'public.auth_phone_e164(text)', 'EXECUTE') END AS auth_phone_e164,
       CASE WHEN to_regprocedure('public.hook_before_user_created(jsonb)') IS NULL THEN NULL
            ELSE has_function_privilege(roles.rol, 'public.hook_before_user_created(jsonb)', 'EXECUTE') END AS hook
FROM (VALUES ('supabase_auth_admin'), ('service_role'), ('anon'), ('authenticated')) AS roles(rol);

-- A1. USAGE del schema public (ambos roles)
SELECT rol, has_schema_privilege(rol, 'public', 'USAGE') AS usage
FROM (VALUES ('supabase_auth_admin'), ('service_role')) AS roles(rol);

-- A2. Privilegios por COLUMNA de supabase_auth_admin (punto de partida)
SELECT table_name, privilege_type, count(*) AS columnas
FROM information_schema.column_privileges
WHERE grantee = 'supabase_auth_admin'
  AND table_schema = 'public'
  AND table_name IN ('patients','profiles','doctors',
                     'clinic_invitations','platform_admin_invitations')
GROUP BY table_name, privilege_type
ORDER BY table_name, privilege_type;

-- A3. Definición REAL del índice de platform_admin_invitations (¿ya sostiene
--     phone_normalized = ? AND status='pending'?). Es la misma consulta de D1,
--     útil también acá para decidir si s7_65 creará el índice o reusará el de s7_44.
SELECT indexname, pg_get_indexdef(c.oid) AS definicion
FROM pg_indexes ix
JOIN pg_class c ON c.relname = ix.indexname
WHERE ix.schemaname = 'public' AND ix.tablename = 'platform_admin_invitations'
ORDER BY indexname;
```

**Para qué:** registrar el punto de partida real y detectar accesos que los
grants de la migración **no** podrían restringir.

**⚠️ Condiciones de aviso — reportar ANTES de aplicar `s7_65`:**
- **`rolsuper = true`** o **`rolbypassrls = true`** → el rol lee todo y omite
  RLS: los grants por columna y las policies de esta migración serían
  decorativos (el hook seguiría funcionando, pero el "mínimo privilegio" no
  sería real). **Reportarlo: cambia el modelo de seguridad, no el diseño.**
- **`rolinherit = true` con membresías en A0b** → puede tener privilegios
  heredados más amplios. **No asumir que los grants columnarios los acotan.**
- **A0c con `ins`/`upd`/`del = true`** para `supabase_auth_admin` en cualquier
  tabla → ya puede escribir por herencia; la migración no lo empeora, pero
  **la denegación de escritura de §C fallaría** y hay que decidir qué hacer
  antes de activar el hook.
- **A2 con privilegios amplios preexistentes** → el diseño asume que `s7_65`
  concede el acceso; si ya existía, documentarlo.

**`service_role` (informativo, esperado):** es un rol de servicio con acceso
amplio por diseño de Supabase — sus privilegios en A0c/A0d/A1 pueden ser
`true` y eso **no es un hallazgo**: la migración le concede explícitamente lo
que el backend/smoke necesitan (EXECUTE + CRUD de las dos tablas) para no
depender de esos defaults, no para restringirlo.

---

## B. Privilegios de `supabase_auth_admin` — DESPUÉS de aplicar

```sql
-- B1. Mismas consultas de A, ahora incluyendo las tablas nuevas
SELECT 'schema_usage' AS chk,
       has_schema_privilege('supabase_auth_admin', 'public', 'USAGE') AS value;

SELECT table_name, privilege_type, count(*) AS columnas
FROM information_schema.column_privileges
WHERE grantee = 'supabase_auth_admin'
  AND table_schema = 'public'
  AND table_name IN ('auth_creation_grants','booking_intents','patients','profiles',
                     'doctors','clinic_invitations','platform_admin_invitations')
GROUP BY table_name, privilege_type
ORDER BY table_name, privilege_type;

SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'supabase_auth_admin'
  AND table_schema = 'public'
  AND table_name IN ('auth_creation_grants','booking_intents','patients','profiles',
                     'doctors','clinic_invitations','platform_admin_invitations')
ORDER BY table_name, privilege_type;

-- B2. EXECUTE de las funciones nuevas. ESPERADO (asimétrico a propósito):
--     · auth_phone_e164          → true para anon, authenticated, service_role
--       y supabase_auth_admin (participa en índices funcionales y CHECKs de
--       tablas operativas: sin EXECUTE, un INSERT/UPDATE fallaría);
--     · hook_before_user_created → true SOLO para supabase_auth_admin.
SELECT roles.rol,
       has_function_privilege(roles.rol, 'public.auth_phone_e164(text)', 'EXECUTE') AS auth_phone_e164,
       has_function_privilege(roles.rol, 'public.hook_before_user_created(jsonb)', 'EXECUTE') AS hook
FROM (VALUES ('supabase_auth_admin'), ('service_role'), ('anon'), ('authenticated')) AS roles(rol);

-- B2b. PRIVILEGIOS EFECTIVOS de service_role sobre las tablas nuevas
--      (esperado: SELECT/INSERT/UPDATE/DELETE = true en ambas).
SELECT t.table_name,
       has_table_privilege('service_role', 'public.' || t.table_name, 'SELECT') AS sel,
       has_table_privilege('service_role', 'public.' || t.table_name, 'INSERT') AS ins,
       has_table_privilege('service_role', 'public.' || t.table_name, 'UPDATE') AS upd,
       has_table_privilege('service_role', 'public.' || t.table_name, 'DELETE') AS del
FROM (VALUES ('auth_creation_grants'), ('booking_intents')) AS t(table_name);

-- B3. Acceso de anon/authenticated a las tablas nuevas (esperado: NINGUNO).
--     Incluye los niveles admin acotados de s7_57: tampoco deben aparecer.
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('auth_creation_grants','booking_intents')
  AND grantee IN ('anon','authenticated','PUBLIC')
ORDER BY table_name, grantee;

-- B3b. Confirmar que directory_editor / operations_admin NO tienen acceso.
--      (Son roles de aplicación implementados como filas en lucyadmin_access,
--       no roles de Postgres; por eso NO deberían aparecer como grantee acá.
--       Esta consulta debe devolver 0 filas.)
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('auth_creation_grants','booking_intents')
  AND grantee IN ('directory_editor','operations_admin');

-- B4. RLS activo + policies existentes en las tablas nuevas
SELECT c.relname, c.relrowsecurity AS rls_activo
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('auth_creation_grants','booking_intents');

SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname LIKE '%auth_hook%'
ORDER BY tablename;
```

**Esperado:** `USAGE=true` · **solo `SELECT`** (por columnas) para
`supabase_auth_admin` en las 6 tablas de evidencia · **cero**
`INSERT/UPDATE/DELETE` · **B2** → `auth_phone_e164` EXECUTE `true` para
`supabase_auth_admin`/`service_role`/`anon`/`authenticated`;
`hook_before_user_created` EXECUTE `true` **solo** para `supabase_auth_admin`
· **B2b** → `service_role` con `SELECT/INSERT/UPDATE/DELETE = true` en ambas
tablas nuevas · **B3** → **0 filas** (anon/authenticated/PUBLIC sin acceso) ·
**B3b** → **0 filas** (directory_editor/operations_admin sin acceso) · **B4**
→ `rls_activo=true` en las dos tablas y 6 policies `…_auth_hook` de `SELECT`
para `supabase_auth_admin`.

**Columnas esperadas en B1** (estrictamente las que el hook consulta):
`auth_creation_grants` 4 (`subject_type`, `subject_normalized`, `expires_at`,
`revoked_at`) · `patients` 1 (`phone`) · `profiles` 2 (`id`, `phone`) ·
`doctors` 1 (`profile_id`) · `clinic_invitations` 4 ·
`platform_admin_invitations` 3. Cualquier columna extra = privilegio de más.

---

## C. Matriz del hook

> **⚠️ LIMITACIÓN DEL ENTORNO (verificada 2026-07-22):** el rol del SQL Editor
> de Supabase hosted (`postgres`) **no es miembro de `supabase_auth_admin` ni
> superusuario**, así que `SET ROLE supabase_auth_admin` da
> `42501: permission denied to set role`. Por eso este bloque corre **SIN
> cambio de rol** (como `postgres`). Consecuencias:
>
> - **La LÓGICA del hook se prueba igual** — es `SECURITY INVOKER` y `postgres`
>   lee las mismas tablas, así que las 17 ramas (permitir/rechazar/contrato/
>   read-only) se ejercitan completas.
> - **La SUFICIENCIA DE LECTURA de `supabase_auth_admin`** (que tiene exactamente
>   los reads que el hook necesita) ya quedó probada por **§B**: cada columna
>   que el hook consulta está en los grants columnares (§B1b) y las 6 policies
>   `USING (true)` (§B4) le dan visibilidad de filas. No requiere ejecutar bajo
>   el rol.
> - **La DENEGACIÓN DE ESCRITURA** de `supabase_auth_admin` queda probada por
>   **§B1c** (0 grants de tabla; solo `SELECT` columnar → no puede escribir por
>   construcción). Por eso el sub-test de escritura 3/3 se OMITE acá (como
>   `postgres` sí puede escribir, daría falsos `FAIL`).
> - **La verificación EN VIVO bajo `supabase_auth_admin`** ocurre en la
>   **activación del hook** (paso posterior gated: GoTrue lo ejecuta con ese
>   rol real, con A/B y rollback de 1 clic).
>
> **Una sola ejecución.** Crea fixtures sintéticas → captura conteos → corre
> las 17 llamadas al hook → recomprueba conteos → **termina en
> `RAISE EXCEPTION` (rollback deliberado)**. El `ERROR` final con el resumen
> **es el resultado esperado**, no un fallo.

```sql
DO $$
DECLARE
  v_admin_prof  uuid;
  v_clinic      uuid;
  v_doctor_phone text;          -- Camilo (demo) — SOLO en memoria, nunca impreso
  v_r  jsonb;
  results text := '';
  fails  int := 0;
  n_grants_before int; n_patients_before int; n_ci_before int; n_pai_before int;
  n_grants_after  int; n_patients_after  int; n_ci_after  int; n_pai_after  int;
BEGIN
  -- ── 1. FIXTURES SINTÉTICAS ──
  SELECT id INTO v_admin_prof FROM public.profiles WHERE role = 'admin' LIMIT 1;

  -- Clínica sintética propia (no una real: evita el límite de asientos de s7_27)
  INSERT INTO public.clinics (name, owner_id, is_active)
  VALUES ('AP1B_FIXTURE Clinica', v_admin_prof, true)
  RETURNING id INTO v_clinic;

  -- Paciente sintético (no toca auth.users: profile_id queda NULL)
  INSERT INTO public.patients (clinic_id, full_name, phone, date_of_birth, gender, notes)
  VALUES (v_clinic, 'AP1B_FIXTURE Paciente', '50370007202', '1990-01-15', 'otro', 'AP1B_FIXTURE');

  -- Invitación de asistente vigente (con '+' a propósito: el hook normaliza)
  INSERT INTO public.clinic_invitations (clinic_id, phone, role, invited_by)
  VALUES (v_clinic, '+50370007203', 'assistant', v_admin_prof);

  -- Invitación de administrador pending vigente (canónico en dígitos)
  INSERT INTO public.platform_admin_invitations (phone_normalized, display_name, status, invited_by)
  VALUES ('50370007204', 'AP1B_FIXTURE Admin', 'pending', v_admin_prof);

  -- Grants: phone vigente · email vigente · phone VENCIDO · phone REVOCADO
  INSERT INTO public.auth_creation_grants (subject_type, subject_normalized, flow, expires_at, issued_by)
  VALUES ('phone', '+50370007205', 'authorized', now() + interval '10 minutes', 'AP1B_FIXTURE');
  INSERT INTO public.auth_creation_grants (subject_type, subject_normalized, flow, expires_at, issued_by)
  VALUES ('email', 'ap1b-ok@ap1bfixture.invalid', 'authorized', now() + interval '10 minutes', 'AP1B_FIXTURE');
  INSERT INTO public.auth_creation_grants (subject_type, subject_normalized, flow, created_at, expires_at, issued_by)
  VALUES ('phone', '+50370007206', 'authorized', now() - interval '2 hours', now() - interval '1 hour', 'AP1B_FIXTURE');
  INSERT INTO public.auth_creation_grants (subject_type, subject_normalized, flow, expires_at, revoked_at, issued_by)
  VALUES ('phone', '+50370007207', 'authorized', now() + interval '10 minutes', now(), 'AP1B_FIXTURE');

  -- Rama MÉDICO: no puede ser sintética (profiles.id → FK a auth.users).
  -- Se lee el teléfono del médico demo (Camilo) SOLO en memoria.
  SELECT pr.phone INTO v_doctor_phone
  FROM public.doctors d
  JOIN public.profiles pr ON pr.id = d.profile_id
  WHERE pr.phone = '50378627694'
  LIMIT 1;

  -- ── 2. CONTEOS ANTES ──
  SELECT count(*) INTO n_grants_before   FROM public.auth_creation_grants;
  SELECT count(*) INTO n_patients_before FROM public.patients;
  SELECT count(*) INTO n_ci_before       FROM public.clinic_invitations;
  SELECT count(*) INTO n_pai_before      FROM public.platform_admin_invitations;

  -- ══ 3. LLAMADAS AL HOOK (sin SET ROLE — no disponible en el SQL Editor;
  --        ver la nota de la sección. La lógica se prueba igual: SECURITY
  --        INVOKER lee las mismas tablas). ══

  -- 3.1 paciente registrado → PERMITE
  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'phone', '50370007202', 'app_metadata', jsonb_build_object('provider','phone'))));
  IF v_r = '{}'::jsonb THEN results := results || E'\n  OK  paciente registrado -> permite';
  ELSE fails := fails + 1; results := results || E'\n  FAIL paciente registrado (rechazado)'; END IF;

  -- 3.2 médico → PERMITE
  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'phone', v_doctor_phone, 'app_metadata', jsonb_build_object('provider','phone'))));
  IF v_r = '{}'::jsonb THEN results := results || E'\n  OK  medico -> permite';
  ELSE fails := fails + 1; results := results || E'\n  FAIL medico (rechazado)'; END IF;

  -- 3.3 asistente invitado → PERMITE
  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'phone', '50370007203', 'app_metadata', jsonb_build_object('provider','phone'))));
  IF v_r = '{}'::jsonb THEN results := results || E'\n  OK  asistente invitado -> permite';
  ELSE fails := fails + 1; results := results || E'\n  FAIL asistente invitado'; END IF;

  -- 3.4 admin invitado → PERMITE
  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'phone', '+50370007204', 'app_metadata', jsonb_build_object('provider','phone'))));
  IF v_r = '{}'::jsonb THEN results := results || E'\n  OK  admin invitado -> permite';
  ELSE fails := fails + 1; results := results || E'\n  FAIL admin invitado'; END IF;

  -- 3.5 grant phone vigente → PERMITE
  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'phone', '50370007205', 'app_metadata', jsonb_build_object('provider','phone'))));
  IF v_r = '{}'::jsonb THEN results := results || E'\n  OK  grant phone vigente -> permite';
  ELSE fails := fails + 1; results := results || E'\n  FAIL grant phone vigente'; END IF;

  -- 3.6 grant email vigente → PERMITE (mayúsculas: se normaliza)
  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'email', 'AP1B-OK@ap1bfixture.invalid', 'app_metadata', jsonb_build_object('provider','email'))));
  IF v_r = '{}'::jsonb THEN results := results || E'\n  OK  grant email vigente -> permite';
  ELSE fails := fails + 1; results := results || E'\n  FAIL grant email vigente'; END IF;

  -- 3.7 teléfono desconocido → RECHAZA
  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'phone', '+50370007299', 'app_metadata', jsonb_build_object('provider','phone'))));
  IF v_r ? 'error' THEN results := results || E'\n  OK  telefono desconocido -> rechaza';
  ELSE fails := fails + 1; results := results || E'\n  FAIL telefono desconocido (PERMITIO)'; END IF;

  -- 3.8 email sin grant → RECHAZA
  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'email', 'nadie@ap1bfixture.invalid', 'app_metadata', jsonb_build_object('provider','email'))));
  IF v_r ? 'error' THEN results := results || E'\n  OK  email sin grant -> rechaza';
  ELSE fails := fails + 1; results := results || E'\n  FAIL email sin grant (PERMITIO)'; END IF;

  -- 3.9 provider phone con SOLO grant de email → RECHAZA (sin cruce)
  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'phone', '+50370007208', 'email', 'ap1b-ok@ap1bfixture.invalid',
           'app_metadata', jsonb_build_object('provider','phone'))));
  IF v_r ? 'error' THEN results := results || E'\n  OK  provider phone + grant email -> rechaza';
  ELSE fails := fails + 1; results := results || E'\n  FAIL cruce email->phone (PERMITIO)'; END IF;

  -- 3.10 provider email con SOLO grant de phone → RECHAZA (sin cruce)
  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'email', 'otro@ap1bfixture.invalid', 'phone', '50370007205',
           'app_metadata', jsonb_build_object('provider','email'))));
  IF v_r ? 'error' THEN results := results || E'\n  OK  provider email + grant phone -> rechaza';
  ELSE fails := fails + 1; results := results || E'\n  FAIL cruce phone->email (PERMITIO)'; END IF;

  -- 3.11 provider desconocido / ausente / inconsistente → RECHAZA
  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'phone', '50370007205', 'app_metadata', jsonb_build_object('provider','sso'))));
  IF v_r ? 'error' THEN results := results || E'\n  OK  provider desconocido -> rechaza';
  ELSE fails := fails + 1; results := results || E'\n  FAIL provider desconocido (PERMITIO)'; END IF;

  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'phone', '50370007205')));
  IF v_r ? 'error' THEN results := results || E'\n  OK  provider ausente -> rechaza';
  ELSE fails := fails + 1; results := results || E'\n  FAIL provider ausente (PERMITIO)'; END IF;

  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'app_metadata', jsonb_build_object('provider','phone'))));
  IF v_r ? 'error' THEN results := results || E'\n  OK  provider phone SIN phone -> rechaza';
  ELSE fails := fails + 1; results := results || E'\n  FAIL inconsistente (PERMITIO)'; END IF;

  -- 3.12 grant vencido / revocado → RECHAZA
  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'phone', '+50370007206', 'app_metadata', jsonb_build_object('provider','phone'))));
  IF v_r ? 'error' THEN results := results || E'\n  OK  grant vencido -> rechaza';
  ELSE fails := fails + 1; results := results || E'\n  FAIL grant vencido (PERMITIO)'; END IF;

  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'phone', '+50370007207', 'app_metadata', jsonb_build_object('provider','phone'))));
  IF v_r ? 'error' THEN results := results || E'\n  OK  grant revocado -> rechaza';
  ELSE fails := fails + 1; results := results || E'\n  FAIL grant revocado (PERMITIO)'; END IF;

  -- 3.13 mensaje EXACTO del contrato de rechazo
  v_r := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
           'phone', '+50370007299', 'app_metadata', jsonb_build_object('provider','phone'))));
  IF v_r = jsonb_build_object('error', jsonb_build_object('http_code', 400,
       'message', 'No pudimos procesar la solicitud. Verifica tus datos o contáctanos.'))
  THEN results := results || E'\n  OK  contrato de rechazo exacto';
  ELSE fails := fails + 1; results := results || E'\n  FAIL contrato de rechazo distinto'; END IF;

  -- ── 4. CONTEOS DESPUÉS: el hook es read-only ──
  SELECT count(*) INTO n_grants_after   FROM public.auth_creation_grants;
  SELECT count(*) INTO n_patients_after FROM public.patients;
  SELECT count(*) INTO n_ci_after       FROM public.clinic_invitations;
  SELECT count(*) INTO n_pai_after      FROM public.platform_admin_invitations;
  IF n_grants_after = n_grants_before AND n_patients_after = n_patients_before
     AND n_ci_after = n_ci_before AND n_pai_after = n_pai_before
  THEN results := results || E'\n  OK  hook read-only (conteos identicos)';
  ELSE fails := fails + 1; results := results || E'\n  FAIL el hook modifico tablas'; END IF;

  -- ── 6. ROLLBACK DELIBERADO con el resumen ──
  RAISE EXCEPTION E'MATRIZ s7_65 (TODO REVERTIDO) — fails=%:%', fails, results;
END $$;
```

---

## D. `EXPLAIN` e indexabilidad

> En tablas pequeñas el planner **normal** puede elegir seq scan: eso **no es
> fallo**. Lo que se exige es la **indexabilidad** (D2) y que el índice real
> de `platform_admin_invitations` sostenga la expresión del hook (D1).

```sql
-- D1. Índices REALES de platform_admin_invitations (definición completa)
SELECT indexname, pg_get_indexdef(i.indexrelid) AS definicion
FROM pg_indexes ix
JOIN pg_class c   ON c.relname = ix.indexname
JOIN pg_index i   ON i.indexrelid = c.oid
WHERE ix.schemaname = 'public' AND ix.tablename = 'platform_admin_invitations';
```

**Confirmar en la salida** que existe un índice cuya **expresión** es la
columna `phone_normalized` y cuyo **predicado** es `WHERE status = 'pending'`
— exactamente la forma que usa el hook
(`pai.phone_normalized = ltrim(v_phone,'+') AND pai.status = 'pending'`).

**Esto NO se difiere:** `s7_65` incluye un bloque `DO` que inspecciona
`pg_index` y, **solo si ningún índice sostiene ese predicado**, crea
`idx_pai_phone_normalized_pending`. Al aplicar, la migración emite un
`NOTICE` diciendo cuál de los dos caminos tomó:

- *"índice existente sostiene …"* → el de `s7_44`
  (`platform_admin_invitations_pending_uniq`) ya sirve; no se crea nada;
- *"creado idx_pai_phone_normalized_pending"* → no había uno adecuado y la
  migración lo creó.

D1 es la **verificación independiente** de ese resultado: si tras aplicar no
aparece ningún índice con esa forma, **reportarlo antes de activar el hook**.

```sql
-- D2. Indexabilidad de cada rama (seq scan deshabilitado).
--     Buscar "Index Scan"/"Index Only Scan"/"Bitmap Index Scan" + nombre.
BEGIN;
SET LOCAL enable_seqscan = off;

EXPLAIN (ANALYZE, BUFFERS)
  SELECT 1 FROM public.patients pt
  WHERE public.auth_phone_e164(pt.phone) = '+50370007299';

EXPLAIN (ANALYZE, BUFFERS)
  SELECT 1 FROM public.profiles pr
  WHERE public.auth_phone_e164(pr.phone) = '+50370007299';

EXPLAIN (ANALYZE, BUFFERS)
  SELECT 1 FROM public.clinic_invitations ci
  WHERE ci.accepted_at IS NULL AND ci.cancelled_at IS NULL
    AND ci.expires_at > now()
    AND public.auth_phone_e164(ci.phone) = '+50370007299';

EXPLAIN (ANALYZE, BUFFERS)
  SELECT 1 FROM public.platform_admin_invitations pai
  WHERE pai.status = 'pending' AND pai.expires_at > now()
    AND pai.phone_normalized = '50370007299';

EXPLAIN (ANALYZE, BUFFERS)
  SELECT 1 FROM public.auth_creation_grants g
  WHERE g.subject_type = 'phone' AND g.subject_normalized = '+50370007299'
    AND g.revoked_at IS NULL AND g.expires_at > now();

ROLLBACK;
```

```sql
-- D3. Plan NORMAL (referencia, sin forzar): mismas 5 consultas sin el
--     SET enable_seqscan. Se documenta el plan elegido; no se exige índice.
```

---

## E. Medición de tiempo del hook

> Sin `SET ROLE` (no disponible en el SQL Editor — ver §C). El tiempo del
> hook lo domina el trabajo de las consultas, no el rol que lo ejecuta; medir
> como `postgres` es una cota representativa (si acaso, `postgres` no es más
> rápido que `supabase_auth_admin` para estos SELECT).

```sql
DO $$
DECLARE t0 timestamptz; t1 timestamptz; v jsonb;
BEGIN
  t0 := clock_timestamp();
  FOR i IN 1..20 LOOP
    -- Peor caso: teléfono inexistente → recorre TODAS las ramas
    v := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
      'phone', '+50370007299', 'app_metadata', jsonb_build_object('provider','phone'))));
  END LOOP;
  t1 := clock_timestamp();
  RAISE NOTICE 'hook x20 (peor caso): % ms total | % ms promedio',
    round(extract(epoch FROM (t1 - t0)) * 1000),
    round(extract(epoch FROM (t1 - t0)) * 1000 / 20, 2);
END $$;
```

**Criterio:** el promedio debe quedar **holgadamente por debajo de 2 s**
(se espera orden de milisegundos). Si superara ~100 ms, revisar D2 antes de
activar el hook.

---

## F. Resultado esperado y rollback deliberado

| Sección | Resultado esperado |
|---|---|
| **A** | Punto de partida registrado (si ya hay privilegios amplios → avisar) |
| **B** | `USAGE=true` · `supabase_auth_admin` solo `SELECT` por columnas, cero escritura · `auth_phone_e164` EXECUTE para los 4 roles / hook solo auth_admin · `service_role` con CRUD en ambas tablas (B2b) · `anon`/`authenticated`/`directory_editor`/`operations_admin` sin acceso a las tablas nuevas (B3/B3b = 0 filas) · RLS activo + 6 policies `…_auth_hook` |
| **C** | `ERROR: MATRIZ s7_65 (TODO REVERTIDO) — fails=0:` seguido de **17 líneas `OK`** (sin `SET ROLE` — ver la nota de §C; el sub-test de escritura se cubre por §B1c). **El `ERROR` es el diseño** (rollback deliberado): garantiza que ninguna fixture sobreviva. `fails > 0` → **no activar el hook** y reportar. |
| **D** | D1: índice con expresión `phone_normalized` y predicado `status='pending'`. D2: todas las ramas con acceso por índice al forzar. D3: informativo |
| **E** | Promedio muy por debajo de 2 s |
| **G** | `mismatches = 0` sobre 35 casos |

**Nada de esto activa el hook.** La configuración en el Dashboard es un paso
posterior y separado (tras AUTH-P1B1B).

---

## G. Paridad frontend ↔ SQL del normalizador

> Los 35 casos provienen de la **fuente única** `scripts/_lib/auth-phone-cases.mjs`
> (la misma matriz que valida el frontend en `check-auth-p1a-phone.mjs`); la
> columna `esperado` es el resultado **pineado** del contrato, ya verificado
> contra `toAuthPhone`. Este bloque agrega el resultado **SQL** de cada caso.
> El check `check-s7_65.mjs` verifica que esta tabla no divergió de la fuente.
>
> Se ejecuta acá (y no desde la app) porque `auth_phone_e164` **no es
> invocable** por `anon`/`authenticated` (decisión de la corrección 1).

```sql
WITH casos(n, entrada, esperado) AS (
  VALUES
    (1, '+50378627694', '+50378627694'),
    (2, '50378627694', '+50378627694'),
    (3, '78627694', '+50378627694'),
    (4, '61234567', '+50361234567'),
    (5, '22601234', '+50322601234'),
    (6, '12345678', NULL),
    (7, '50312345678', NULL),
    (8, '+50312345678', NULL),
    (9, '91234567', NULL),
    (10, '+50391234567', NULL),
    (11, '+50255551234', '+50255551234'),
    (12, '50255551234', '+50255551234'),
    (13, '+50295551234', NULL),
    (14, '+50499887766', '+50499887766'),
    (15, '50499887766', '+50499887766'),
    (16, '+525512345678', '+525512345678'),
    (17, '525512345678', '+525512345678'),
    (18, '+521512345678', NULL),
    (19, '+52551234567', NULL),
    (20, '+14155550100', '+14155550100'),
    (21, '14155550100', '+14155550100'),
    (22, '+11234567890', NULL),
    (23, '+503 7862-7694', '+50378627694'),
    (24, '(503) 7862 7694', '+50378627694'),
    (25, '2260-1234', '+50322601234'),
    (26, '+5037862769', NULL),
    (27, '+503786276941', NULL),
    (28, '5037862769412', NULL),
    (29, '+9791234567', NULL),
    (30, '78627694x', NULL),
    (31, '', NULL),
    (32, '   ', NULL),
    (33, NULL, NULL),
    (34, '+503 7 8 6 2 - 7 6 9 4                    ', NULL),
    (35, '+5037862769470000000000000000000000', NULL)
), evaluado AS (
  SELECT n, entrada, esperado, public.auth_phone_e164(entrada) AS sql_result
  FROM casos
)
SELECT
  count(*)                                                   AS casos_totales,
  count(*) FILTER (WHERE sql_result IS DISTINCT FROM esperado) AS mismatches
FROM evaluado;

-- Detalle SOLO de las divergencias (esperado: 0 filas)
WITH casos(n, entrada, esperado) AS (
  VALUES
    (1, '+50378627694', '+50378627694'), (2, '50378627694', '+50378627694'),
    (3, '78627694', '+50378627694'), (4, '61234567', '+50361234567'),
    (5, '22601234', '+50322601234'), (6, '12345678', NULL),
    (7, '50312345678', NULL), (8, '+50312345678', NULL),
    (9, '91234567', NULL), (10, '+50391234567', NULL),
    (11, '+50255551234', '+50255551234'), (12, '50255551234', '+50255551234'),
    (13, '+50295551234', NULL), (14, '+50499887766', '+50499887766'),
    (15, '50499887766', '+50499887766'), (16, '+525512345678', '+525512345678'),
    (17, '525512345678', '+525512345678'), (18, '+521512345678', NULL),
    (19, '+52551234567', NULL), (20, '+14155550100', '+14155550100'),
    (21, '14155550100', '+14155550100'), (22, '+11234567890', NULL),
    (23, '+503 7862-7694', '+50378627694'), (24, '(503) 7862 7694', '+50378627694'),
    (25, '2260-1234', '+50322601234'), (26, '+5037862769', NULL),
    (27, '+503786276941', NULL), (28, '5037862769412', NULL),
    (29, '+9791234567', NULL), (30, '78627694x', NULL),
    (31, '', NULL), (32, '   ', NULL), (33, NULL, NULL),
    (34, '+503 7 8 6 2 - 7 6 9 4                    ', NULL),
    (35, '+5037862769470000000000000000000000', NULL)
)
SELECT n, entrada, esperado, public.auth_phone_e164(entrada) AS sql_result
FROM casos
WHERE public.auth_phone_e164(entrada) IS DISTINCT FROM esperado
ORDER BY n;
```

**Esperado:** `casos_totales = 35`, `mismatches = 0`, y **0 filas** en el
detalle. Cualquier divergencia implica que el SQL y el frontend normalizan
distinto → **no activar el hook** hasta alinearlos.
