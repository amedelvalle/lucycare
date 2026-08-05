# OWNER — aplicación de `s7_71a` (AUDIT-SEC-P0 · PR 1)

> **Qué es.** Primer PR del frente AUDIT-SEC-P0. Añade la auditoría
> **server-side** de `appointments`, que hoy no existe. **No cierra todavía**
> la vulnerabilidad de `audit_log` — eso es `s7_71b`, y solo se abre si esta
> validación pasa.

---

## 0. Por qué este PR va primero

El diagnóstico Fase 0 confirmó que `audit_log` acepta INSERT arbitrario:

| Elemento | Estado medido |
|---|---|
| Policy | `audit_log_insert_only` — PERMISSIVE, `roles={public}`, `INSERT`, **`WITH CHECK true`** (única policy) |
| ACL de tabla | `anon` y `authenticated` con `arwdDxtm` (**ALL**) |
| ACL de secuencia | `anon` y `authenticated` con `rwU` → incluye **`setval()`** |
| `user_id` | `NOT NULL` **sin FK** → suplantable |
| `created_at` | `DEFAULT now()` pero **escribible** → antedatable |

Cerrar eso (`REVOKE` + `DROP POLICY`) es trivial. El problema es que los tres
eventos de agenda se auditan **solo desde el cliente**:

- `src/services/appointments.service.ts:342` — cambio de estado
- `src/services/appointments.service.ts:500` — edición / reprogramación
- `src/services/walkIn.service.ts:252` — walk-in

y esas llamadas son *fire-and-forget* (`auditLog.service.ts:29-32` hace
`console.warn` y **no relanza**). Revocar primero **borraría esa auditoría en
silencio**, sin que nadie lo note. Por eso: **primero la cobertura, después el
cierre.**

---

## 1. Qué aplica esta migración

| # | Objeto | Acción |
|---|---|---|
| 1 | `public.audit_appointments_fn()` | crear — `SECURITY DEFINER`, `search_path = pg_catalog, public, pg_temp`, `public.audit_log` calificado |
| 2 | idem | `REVOKE EXECUTE` a `PUBLIC`, `anon`, `authenticated`, `service_role` |
| 3 | trigger `audit_appointments` | crear — `AFTER INSERT OR UPDATE ON public.appointments FOR EACH ROW` |
| 4 | `public.cancel_my_appointment` | `CREATE OR REPLACE` — fija el contexto y elimina su `INSERT` manual en `audit_log` |

**No toca:** privilegios de `audit_log`, la secuencia, la policy,
`_admin_log_doctor_change`, `integrity_epoch`, `src/`, `database.types.ts`,
Supabase, Vercel, Cloudflare, Turnstile ni Auth Hooks.

---

## 2. Estado transitorio esperado — importante

Entre `s7_71a` y `s7_71b` habrá **doble auditoría** en cambio de estado,
edición y walk-in: la del trigger y la del cliente. Es **redundante y no
dañina**, y es justamente lo que permite comparar ambas salidas.

**La cancelación del paciente NO se duplica**: `s7_71a` elimina el `INSERT`
manual de `cancel_my_appointment` en el mismo movimiento en que el trigger
empieza a producir esa fila.

---

## 3. Cómo aplicarla

1. Abrí el **SQL Editor** de Supabase (proyecto de producción).
2. Pegá el contenido íntegro de
   `migrations/s7_71a_audit_appointments_coverage.sql`.
3. Ejecutá.

La migración es **transaccional** (`BEGIN` … `COMMIT`) y abre con un
**preflight que aborta** si el estado real no coincide con lo esperado
(tablas, columnas, `s7_70` aplicada, `auth.uid()`, `auth.jwt()`, estado
`cancelada`). Si algo no cuadra, **no se aplica nada**.

> ⚠️ **No uses tablas temporales** en el SQL Editor: `42P01` por `search_path`
> y `3F000` porque `pg_temp` no resuelve hasta que la sesión materializa su
> esquema temporal. Esta migración no las usa.

---

## 4. Verificación inmediata (read-only)

```sql
-- 4.1 El trigger existe y está habilitado
SELECT t.tgname,
       CASE t.tgenabled WHEN 'O' THEN 'habilitado' ELSE t.tgenabled::text END AS estado,
       pg_get_triggerdef(t.oid) AS definicion
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal AND n.nspname = 'public'
  AND c.relname = 'appointments' AND t.tgname = 'audit_appointments';
-- esperado: 1 fila, 'habilitado', AFTER INSERT OR UPDATE ... FOR EACH ROW

-- 4.2 La función quedó blindada
SELECT p.proname,
       p.prosecdef                         AS security_definer,
       p.proconfig                         AS search_path,
       pg_get_userbyid(p.proowner)         AS owner,
       COALESCE(p.proacl::text, 'NULL')    AS execute_acl,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_puede,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_puede,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_puede
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'audit_appointments_fn';
-- esperado: security_definer = true
--           search_path      = {"search_path=pg_catalog, public, pg_temp"}
--           owner            = postgres
--           anon/auth/svc_puede = false, false, false

-- 4.3 cancel_my_appointment ya NO escribe audit_log por su cuenta
SELECT (prosrc ILIKE '%INSERT INTO public.audit_log%')  AS tiene_insert_manual,
       (prosrc ILIKE '%app.audit_appointments_context%') AS fija_contexto,
       (prosrc ILIKE '%P0114%' AND prosrc ILIKE '%P0115%'
        AND prosrc ILIKE '%link_confirmed_at%')          AS validaciones_intactas,
       COALESCE(proacl::text, 'NULL')                    AS execute_acl
FROM pg_proc
WHERE oid = to_regprocedure('public.cancel_my_appointment(uuid,text,text)');
-- esperado: false · true · true
--           execute_acl conserva {postgres=X, service_role=X, authenticated=X}

-- 4.4 NADA cambió en los privilegios de audit_log (eso es s7_71b)
SELECT relacl::text AS acl_tabla,
       (SELECT count(*) FROM pg_policies
        WHERE schemaname='public' AND tablename='audit_log') AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relname='audit_log';
-- esperado: acl SIN cambios respecto de la Fase 0 · policies = 1
```

---

## 5. Validación del dev (sin service_role)

```bash
node scripts/check-s7_71a.mjs
```

Verificación **estructural**: sin red, sin Supabase, sin `service_role`, sin
datos. Debe dar **0 fallos**.

El smoke de comportamiento (`scripts/_smoke-s7_71a.mjs`) **no se autoejecuta**:
tiene doble guard (`--run` + `ASP0_SMOKE_AUTHORIZED=1`) y **requiere
autorización puntual tuya**, porque escribe fixtures con `service_role`.

---

## 6. GATE — condición para abrir `s7_71b`

**`s7_71b` no se abre si alguna de estas falla:**

- [ ] `check-s7_71a.mjs` → 0 fallos
- [ ] 4.1 — trigger existe y habilitado
- [ ] 4.2 — `SECURITY DEFINER`, `search_path` fijado, EXECUTE revocado
- [ ] 4.3 — `cancel_my_appointment` sin `INSERT` manual, con contexto, validaciones intactas
- [ ] 4.4 — privilegios de `audit_log` **sin cambios**
- [ ] Smoke autorizado: **una sola fila** por cancelación
- [ ] Smoke autorizado: `notes` e `internal_notes` **ausentes** de la auditoría
- [ ] Smoke autorizado: **cero residuos** de fixtures

---

## 7. Rollback

```
migrations/s7_71a_rollback.sql
```

Quita el trigger y la función, y restaura `cancel_my_appointment` al cuerpo
exacto de `s7_70` (incluido su `INSERT` manual).

**Qué garantiza la ausencia de estados intermedios.** No es el orden de las
sentencias: es el **`BEGIN` … `COMMIT`**. Las tres operaciones viven en una
sola transacción, así que ninguna sesión concurrente puede observar un estado
en el que la RPC ya escriba a mano *y* el trigger siga activo (doble
auditoría), ni uno en el que no escriba ninguno de los dos. Hasta el `COMMIT`,
el resto de la base ve el estado previo completo; después, el posterior
completo.

El orden interno —restaurar la RPC antes de quitar el trigger— es una
precaución **secundaria**, útil solo si alguien ejecutara las sentencias
sueltas fuera de la transacción. **Por sí solo no evitaría la doble
auditoría**: entre las dos sentencias la RPC restaurada y el trigger
coexistirían. La garantía real es la atomicidad.

**No hay `COMMIT` intermedio**: el archivo tiene exactamente un `BEGIN` y un
`COMMIT`, y `check-s7_71a.mjs` lo verifica (§12 del check).

**No borra datos**: las filas de auditoría escritas por el trigger se
conservan — son legítimas y append-only. El rollback no contiene ningún
`DELETE` sobre `audit_log`, y el check también lo verifica.

---

## 8. Restricciones de `s7_71b` — documentadas, NO implementadas

Cuando se autorice, `s7_71b` deberá:

1. ejecutarse **dentro de una transacción explícita**;
2. **añadir `integrity_epoch` SIN `DEFAULT`** — en PostgreSQL 11+, un
   `ADD COLUMN ... DEFAULT 'x'` **rellena retroactivamente** las filas
   existentes y marcaría el legado como íntegro; debe ir en **dos sentencias**;
3. **verificar que el legado quedó `NULL`** antes de continuar (snapshot
   dinámico de `count(*)`, nunca un número fijo);
4. cerrar grants de tabla y secuencia + `DROP POLICY audit_log_insert_only`,
   sin crear ninguna policy permisiva nueva;
5. **solo después**, `ALTER COLUMN integrity_epoch SET DEFAULT 's7_71'`;
6. revocar `EXECUTE` de `_admin_log_doctor_change` a `PUBLIC`, `anon`,
   `authenticated` **y `service_role`** (verificado: no tiene llamadores
   directos en `src/` ni en `scripts/`; sus 4 llamadores son RPCs
   `SECURITY DEFINER` con `owner = postgres`);
7. dejar a `service_role` con **`SELECT`, `INSERT`, `DELETE`** sobre la tabla y
   **solo `USAGE`** sobre la secuencia — sin `UPDATE` ni `TRUNCATE`. `DELETE`
   es obligatorio: la limpieza de fixtures de los smokes depende de él;
8. incluir un rollback que restaure las **ACL exactas** medidas:
   - tabla: `{postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}`
   - secuencia: `{postgres=rwU, anon=rwU, authenticated=rwU, service_role=rwU}` (`PUBLIC` sin nada)
   - policy: `audit_log_insert_only` PERMISSIVE / `public` / INSERT / `WITH CHECK true`
   - helper: `{=X/postgres, postgres=X, anon=X, authenticated=X, service_role=X}`
9. desplegar **DB antes que frontend**. El frontend actual sobrevive a la
   ventana intermedia porque sus INSERT de auditoría son *fire-and-forget*.

---

## 9. Frontera histórica — criterio de cierre

A documentar en el handoff cuando se aplique `s7_71b`:

> Hasta `s7_71b`, `audit_log` admitió INSERT arbitrario por `anon` y
> `authenticated`. **Las filas anteriores al corte son legado cuya integridad
> no puede garantizarse retrospectivamente**: no es posible distinguir una
> entrada legítima de una fabricada, ni verificar su autoría o su fecha. Se
> conservan por su valor operativo; **no deben presentarse como evidencia
> autoritativa**. Las posteriores solo pueden originarse en rutas server-side
> autorizadas.
>
> **Esto no es no repudio criptográfico.** No hay firma, encadenamiento de
> hashes ni almacenamiento WORM. `integrity_epoch` es un marcador de época
> puesto por un `DEFAULT` de columna. `service_role` conserva `INSERT` y
> `DELETE` por necesidad operativa. La garantía es *control de acceso*, no
> *inmutabilidad demostrable*.

---

## 10. Brechas declaradas de `s7_71a`

Conocidas y aceptadas; ninguna es un olvido:

| Brecha | Motivo |
|---|---|
| **`DELETE` de citas sin auditar** | Ninguna ruta de producto borra citas; solo los fixtures de smokes. Auditarlo generaría filas que a su vez habría que limpiar |
| **Sin etiqueta `consultation_signed`** | Exigiría modificar `sync_appointment_on_sign` (`s6_02`), fuera de alcance. La cascada queda como `status_change`, que es cierto |
| **Sin etiquetas `patient_merge` / `patient_unmerge`** | Exigiría modificar `admin_merge_patients` y `admin_unmerge_patients`. Quedan como `patient_reassign` |
| **Sin etiqueta `booking_public`** | No hay setter; el trigger registra el valor literal de `source`, que es un dato de la fila y no una inferencia |
| **Merge de N citas → N filas** | Correcto por diseño (cada cita cambió de dueño). Dimensionar antes de los índices de `s7_72` |
| **Pérdida de legibilidad** | El cliente enviaba nombres de estado; el trigger registra `status_id` (uuid). Se resuelve al leer, uniendo con `appointment_statuses` |

Los setters faltantes quedan como trabajo explícito de **`s7_72`**.


---

## 11. Prueba owner-only — `actor_kind = db_direct`

No es alcanzable desde el smoke: `supabase-js` siempre pasa por PostgREST con
un JWT, así que `auth.jwt()` nunca es NULL. Ejecutá este bloque en el **SQL
Editor** (conexión directa, sin JWT).

**Es transaccional y termina en `ROLLBACK`: no persiste nada.** Crea sus
propias fixtures sintéticas, no toca ninguna fila existente, no usa números de
teléfono reales ni la cuenta demo, y no modifica grants, policies ni
configuración.

```sql
BEGIN;

-- Fixtures sintéticas propias. Nada preexistente se toca.
WITH spec AS (SELECT id FROM public.specialties LIMIT 1),
     nuevo_perfil AS (
       INSERT INTO public.profiles (id, full_name, role)
       VALUES (gen_random_uuid(), 'S7_71_DBDIRECT Medico', 'doctor')
       RETURNING id
     ),
     nueva_clinica AS (
       INSERT INTO public.clinics (name, owner_id)
       SELECT 'S7_71_DBDIRECT Clinica', id FROM nuevo_perfil
       RETURNING id, owner_id
     ),
     nuevo_doctor AS (
       INSERT INTO public.doctors (clinic_id, profile_id, specialty_id)
       SELECT c.id, c.owner_id, s.id FROM nueva_clinica c, spec s
       RETURNING id, clinic_id
     ),
     nuevo_paciente AS (
       INSERT INTO public.patients
         (clinic_id, full_name, date_of_birth, gender, is_active)
       SELECT d.clinic_id, 'S7_71_DBDIRECT Paciente', '1990-01-01', 'otro', true
       FROM nuevo_doctor d
       RETURNING id, clinic_id
     )
INSERT INTO public.appointments
  (clinic_id, doctor_id, patient_id, status_id, start_time, end_time, source)
SELECT p.clinic_id, d.id, p.id,
       (SELECT id FROM public.appointment_statuses WHERE name = 'programada'),
       now() + interval '30 days',
       now() + interval '30 days' + interval '30 minutes',
       'manual'
FROM nuevo_doctor d, nuevo_paciente p;

-- El INSERT de arriba YA disparó el trigger sin JWT.
SELECT
  new_data ->> 'actor_kind'  AS actor_kind,     -- esperado: db_direct
  new_data ->> 'change_kind' AS change_kind,    -- esperado: appointment_created
  new_data ->> 'db_executor' AS db_executor,    -- esperado: presente (postgres)
  user_id::text              AS user_id,        -- esperado: 00000000-...-000000000000
  action::text               AS action          -- esperado: insert
FROM public.audit_log
WHERE table_name = 'appointments'
ORDER BY id DESC
LIMIT 1;

ROLLBACK;   -- ⬅️ NADA se persiste: ni fixtures ni auditoría
```

**Esperado:** `actor_kind = 'db_direct'` · `change_kind = 'appointment_created'`
· `db_executor` no nulo · `user_id = '00000000-0000-0000-0000-000000000000'` ·
`action = 'insert'`.

---

## 12. Prueba owner-only — contexto falsificado (`context_rejected`)

Tampoco es alcanzable desde el smoke: fijar `app.audit_appointments_context`
exige `set_config` server-side, que PostgREST no expone — y eso mismo es parte
de la defensa. Este bloque comprueba que **una etiqueta que no coincide con la
transición real se descarta**.

Mismas garantías: transaccional, `ROLLBACK` al final, fixtures propias, sin
tocar datos existentes, sin números reales, sin cambiar grants ni policies.

```sql
BEGIN;

-- Fixtures sintéticas propias.
WITH spec AS (SELECT id FROM public.specialties LIMIT 1),
     nuevo_perfil AS (
       INSERT INTO public.profiles (id, full_name, role)
       VALUES (gen_random_uuid(), 'S7_71_CTX Medico', 'doctor')
       RETURNING id
     ),
     nueva_clinica AS (
       INSERT INTO public.clinics (name, owner_id)
       SELECT 'S7_71_CTX Clinica', id FROM nuevo_perfil
       RETURNING id, owner_id
     ),
     nuevo_doctor AS (
       INSERT INTO public.doctors (clinic_id, profile_id, specialty_id)
       SELECT c.id, c.owner_id, s.id FROM nueva_clinica c, spec s
       RETURNING id, clinic_id
     ),
     nuevo_paciente AS (
       INSERT INTO public.patients
         (clinic_id, full_name, date_of_birth, gender, is_active)
       SELECT d.clinic_id, 'S7_71_CTX Paciente', '1990-01-01', 'otro', true
       FROM nuevo_doctor d
       RETURNING id, clinic_id
     )
INSERT INTO public.appointments
  (clinic_id, doctor_id, patient_id, status_id, start_time, end_time, source, price)
SELECT p.clinic_id, d.id, p.id,
       (SELECT id FROM public.appointment_statuses WHERE name = 'programada'),
       now() + interval '31 days',
       now() + interval '31 days' + interval '30 minutes',
       'manual', 10
FROM nuevo_doctor d, nuevo_paciente p;

-- Etiqueta de cancelación por el paciente…
SELECT set_config(
  'app.audit_appointments_context',
  '{"edited_via":"patient_self_cancel","reason":"no_puedo_asistir"}',
  true
);

-- …pero la transición real es un cambio de PRECIO, no una cancelación.
UPDATE public.appointments
SET price = 99
WHERE id = (
  SELECT id FROM public.appointments
  WHERE source = 'manual' AND price = 10
  ORDER BY created_at DESC LIMIT 1
);

SELECT
  new_data ->> 'change_kind'      AS change_kind,       -- appointment_update
  new_data ->> 'edited_via'       AS edited_via,        -- NULL (descartado)
  new_data ->> 'reason'           AS reason,            -- NULL (descartado)
  new_data ->> 'context_rejected' AS context_rejected   -- true
FROM public.audit_log
WHERE table_name = 'appointments' AND action = 'update'
ORDER BY id DESC
LIMIT 1;

ROLLBACK;   -- ⬅️ NADA se persiste
```

**Esperado:** `change_kind = 'appointment_update'` (la transición real, no la
etiqueta) · `edited_via` **NULL** · `reason` **NULL** · `context_rejected =
'true'`.

> Si `edited_via` volviera `'patient_self_cancel'`, la validación contra
> `OLD`/`NEW` no está funcionando y **el gate de §6 falla**.

---

## 13. Prueba owner-only — firma de consulta (`sync_appointment_on_sign`)

La firma de una consulta es **irreversible en el sentido de producto**: crea
evidencia clínica que no debería borrarse. Por eso esta ruta **no se ejecuta en
la corrida productiva del smoke** (queda tras `--include-sign`, solo para local
o staging) y se prueba acá dentro de una única transacción con `ROLLBACK`.

**Reversibilidad verificada por lectura de código (read-only):**

| Comprobación | Resultado |
|---|---|
| ¿`s7_28` bloquea el `DELETE` de consultas firmadas? | **No.** Restringe `UPDATE` vía policies (`consultations_update`, `prescriptions_update`, `consultation_diagnoses_update`, `cfh_update`) y los `INSERT` asociados. No hay policy de `DELETE`. |
| ¿Hay trigger que impida limpiarlas? | **No.** El único trigger sobre `consultations` es `trg_sync_appointment_on_sign` (`s6_02:91`), `AFTER UPDATE OF status`, que no bloquea nada. |
| ¿`service_role` puede borrarlas? | **Sí.** `rolbypassrls = true` (medido en el preflight de la secuencia). |
| Tablas dependientes que genera la firma | `consultation_amendments`, `prescriptions`, `consultation_diagnoses`, `consultation_family_history`. El cleanup del smoke las borra antes que la consulta. |
| Precedente en el repo | `_smoke-s7_58:310-318` ya borra una consulta firmada con `service_role`, en ese mismo orden. |

Es decir: **sí sería técnicamente reversible**. Aun así se elige el `ROLLBACK`,
porque no dejar rastro es preferible a borrarlo después.

Mismas garantías que §11 y §12: transaccional, `ROLLBACK` final, fixtures
sintéticas propias, sin tocar datos existentes, sin números reales, sin
modificar grants, policies ni configuración.

```sql
BEGIN;

-- Fixtures sintéticas propias.
WITH spec AS (SELECT id FROM public.specialties LIMIT 1),
     nuevo_perfil AS (
       INSERT INTO public.profiles (id, full_name, role)
       VALUES (gen_random_uuid(), 'S7_71_SIGN Medico', 'doctor')
       RETURNING id
     ),
     nueva_clinica AS (
       INSERT INTO public.clinics (name, owner_id)
       SELECT 'S7_71_SIGN Clinica', id FROM nuevo_perfil
       RETURNING id, owner_id
     ),
     nuevo_doctor AS (
       INSERT INTO public.doctors (clinic_id, profile_id, specialty_id)
       SELECT c.id, c.owner_id, s.id FROM nueva_clinica c, spec s
       RETURNING id, clinic_id, profile_id
     ),
     nuevo_paciente AS (
       INSERT INTO public.patients
         (clinic_id, full_name, date_of_birth, gender, is_active)
       SELECT d.clinic_id, 'S7_71_SIGN Paciente', '1990-01-01', 'otro', true
       FROM nuevo_doctor d
       RETURNING id, clinic_id
     ),
     nueva_cita AS (
       INSERT INTO public.appointments
         (clinic_id, doctor_id, patient_id, status_id, start_time, end_time, source)
       SELECT p.clinic_id, d.id, p.id,
              (SELECT id FROM public.appointment_statuses WHERE name = 'confirmada'),
              now() + interval '32 days',
              now() + interval '32 days' + interval '30 minutes',
              'manual'
       FROM nuevo_doctor d, nuevo_paciente p
       RETURNING id, clinic_id, doctor_id, patient_id
     )
INSERT INTO public.consultations
  (appointment_id, clinic_id, doctor_id, patient_id, status, started_at, chief_complaint)
SELECT a.id, a.clinic_id, a.doctor_id, a.patient_id, 'draft', now(), 'S7_71_SIGN'
FROM nueva_cita a;

-- FIRMA: dispara trg_sync_appointment_on_sign (s6_02), que actualiza
-- appointments.status_id → 'atendida' en cascada, y esa cascada dispara
-- audit_appointments (s7_71a).
UPDATE public.consultations
SET status = 'signed', signed_at = now()
WHERE chief_complaint = 'S7_71_SIGN' AND status = 'draft';

-- Verificación: la cita quedó 'atendida' y la cascada dejó auditoría.
SELECT
  (SELECT s.name FROM public.appointment_statuses s
    WHERE s.id = a.status_id)              AS estado_cita,      -- atendida
  al.action::text                          AS action,           -- update
  al.new_data ->> 'change_kind'            AS change_kind,      -- status_change
  al.new_data ->> 'actor_kind'             AS actor_kind,       -- db_direct
  al.new_data ->> 'edited_via'             AS edited_via,       -- NULL
  (al.new_data ? 'notes')                  AS filtro_notes,     -- false
  (al.new_data ? 'internal_notes')         AS filtro_internas   -- false
FROM public.appointments a
JOIN public.consultations c ON c.appointment_id = a.id
LEFT JOIN LATERAL (
  SELECT * FROM public.audit_log
  WHERE table_name = 'appointments' AND record_id = a.id
  ORDER BY id DESC LIMIT 1
) al ON true
WHERE c.chief_complaint = 'S7_71_SIGN';

ROLLBACK;   -- ⬅️ NADA se persiste: ni consulta firmada, ni cita, ni auditoría
```

**Esperado:** `estado_cita = 'atendida'` · `action = 'update'` ·
`change_kind = 'status_change'` · `actor_kind = 'db_direct'` (se ejecuta desde
el SQL Editor, sin JWT) · `edited_via` **NULL** — no se inventa la etiqueta
`consultation_signed`, cuyo setter queda para `s7_72` · `filtro_notes` y
`filtro_internas` **false**.

> **La corrida productiva del smoke NO cubre la firma.** Si querés cubrirla ahí,
> hay que correrlo con `--include-sign` en local o staging, nunca en producción.
