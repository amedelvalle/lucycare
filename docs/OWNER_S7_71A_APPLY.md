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
exacto de `s7_70` (incluido su `INSERT` manual). **No borra datos**: las filas
de auditoría escritas por el trigger se conservan — son legítimas y
append-only.

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
