# OWNER — `s7_71b`: cierre de la escritura arbitraria sobre `audit_log`

> # ⚠️ APPLIED MANUALLY IN PRODUCTION BEFORE THIS PR
>
> **Esta migración YA FUE APLICADA a mano en producción el `2026-08-07`, antes
> de existir este PR.** El PR es de **reconciliación**: versiona lo que ya
> corrió.
>
> ## ⛔ NO volver a ejecutar la migración en producción.
>
> Producción **ya está endurecida** y verificada por catálogo. Re-ejecutarla no
> es destructivo —los `REVOKE` son idempotentes y el `DROP POLICY` lleva
> `IF EXISTS`—, pero el preflight abortaría con
> `s7_71b PRE: se esperaba 1 policy en audit_log, hay 0`, porque el estado base
> que exige ya no existe. No hay ningún motivo para intentarlo.

---

## 0. Identidad del artefacto

| | |
|---|---|
| Archivo | `migrations/s7_71b_audit_log_hardening.sql` |
| **SHA-256 (LF)** | `8fe8ccd6ee24b63e45c01852d10906b56fb098bf23f46aef94dc265a5dce2e37` |
| Tamaño | 4562 bytes (normalizado a LF) · 104 líneas |
| Aplicado | **manualmente en producción el 2026-08-07** |
| Timestamp exacto | **no recuperado** al momento de versionar |

**El archivo versionado es el texto EFECTIVO que se ejecutó, sin retoques.**
`check-s7_71b.mjs` incluye una aserción de checksum: si alguien "mejora" la
migración más adelante, deja de coincidir con lo aplicado y el check falla. Esa
es la garantía de que el repositorio refleja producción.

### Sobre la fecha

> **Aplicado manualmente en producción el 2026-08-07. Timestamp exacto de
> ejecución del SQL Editor no recuperado al momento de versionar.**

Si el timestamp exacto se recupera después, se incorpora aquí. **No se inventa
ni se deriva de la hora de ningún mensaje.**

⚠️ Esa fecha es **únicamente el marcador operativo del cambio de régimen**.
**No sustituye a `integrity_epoch`** —que quedó fuera de alcance por decisión
del owner— **ni es garantía criptográfica ni prueba de integridad histórica**.
Ninguna fila anterior al corte puede presentarse como evidencia infalsificable,
porque hasta ese momento `audit_log` admitía escritura arbitraria.

---

## 1. Qué cierra

El diagnóstico Fase 0 y la Fase A midieron que `audit_log` aceptaba **INSERT
arbitrario** por `anon` y `authenticated`: cualquiera con la clave `anon`
—pública, viaja en el bundle— podía insertar filas de auditoría atribuidas a
cualquier uuid y fechadas a voluntad. No era fuga de datos: era pérdida de
**integridad y no-repudio**.

Además, `anon` y `authenticated` tenían `TRUNCATE`, que **no está sujeto a
RLS**: la policy nunca lo contuvo. Y `_admin_log_doctor_change` era
`SECURITY DEFINER` **sin gate interno** y con `EXECUTE` para `PUBLIC`, así que
cualquier `authenticated` podía fabricar auditoría de `doctors`.

### Estado antes → después

| | Antes (medido en Fase A) | Después (verificado post-apply) |
|---|---|---|
| ACL de `audit_log` | `anon`, `authenticated`, `service_role` = `arwdDxtm` (ALL) | `anon`/`authenticated` **sin nada** · `service_role` = **`SELECT`** |
| ACL de `audit_log_id_seq` | los tres = `rwU` (incluye `setval`) | **solo el owner** |
| Policies | 1 — `audit_log_insert_only`, PERMISSIVE, INSERT, `roles={public}`, `WITH CHECK true` | **0** |
| ACL de `_admin_log_doctor_change` | `PUBLIC` + los tres roles | **`{postgres=X/postgres}`** |

Los tres vectores —`INSERT` de cliente, `TRUNCATE` y el helper invocable— se
cerraron **atómicamente en el `COMMIT`**, porque el SQL corrió como una sola
transacción. No hubo estados intermedios parcialmente endurecidos.

---

## 2. 🔴 Qué comprobó el preflight y qué NO

**Esta distinción es importante y no debe difuminarse.**

### Lo que el preflight aplicado sí comprobó — NUEVE condiciones

**Seis de existencia y estado base:**

1. existe `public.audit_log`;
2. existe `public.audit_log_id_seq`;
3. existe `_admin_log_doctor_change(uuid,text,jsonb,jsonb)`;
4. RLS habilitado en `audit_log`;
5. el owner de la tabla tiene `BYPASSRLS`;
6. hay **exactamente 1** policy en el estado base.

**Y tres guardas SUSTANTIVAS, que son las que protegían la operación:**

7. **cero escritores de `audit_log` `SECURITY INVOKER`** — uno solo habría
   perdido su auditoría al revocar el grant;
8. **cero escritores cuyo owner carezca de `BYPASSRLS`** — con cero policies no
   podrían escribir;
9. **cero llamadores `SECURITY INVOKER` de `_admin_log_doctor_change`** —
   protege el paso 5, el `REVOKE EXECUTE`.

Las tres abortan con `RAISE EXCEPTION` y, por estar dentro de la transacción,
habrían impedido cualquier cambio. **No son cosméticas: son el mecanismo por el
que la migración se negaba a aplicarse sobre un esquema que no cumpliera sus
premisas.**

Sus sondas llevan además dos guardas de forma, `prokind='f'` y la barrera
`OFFSET 0`, necesarias porque `pg_get_functiondef()` **lanza error sobre
agregados** (`42809: "array_agg" is an aggregate function`). Sin ellas, el
primer intento de aplicar la migración falló — y ese fallo **no produjo
cambios**, porque ocurrió dentro del bloque `DO`, que es de solo lectura, y
antes de cualquier sentencia DDL.

### Lo que el preflight NO comprobó — verificado por catálogo, fuera de la migración

Las guardas 7–9 comprobaron **ausencia de casos malos** (`count = 0`). No
comprobaron **cardinalidad ni identidad**. Eso se hizo con consultas read-only
en la **Fase A** y en la **verificación post-apply**, fuera del SQL ejecutado:

- **exactamente 43 escritores** de `audit_log` en el catálogo real —el
  preflight solo sabía que ninguno era `INVOKER`, no cuántos había—;
- **43/43 `SECURITY DEFINER`** y **43/43 con owner `postgres`**, nominalmente
  identificados. Es la premisa que sostiene todo el diseño;
- que la policy fuera **exactamente** `audit_log_insert_only`, PERMISSIVE,
  `INSERT`, `roles={public}`, `WITH CHECK true` — el preflight solo contó que
  hubiera una;
- el **ACL baseline completo** de tabla y secuencia;
- **`FORCE RLS = false`**;
- **exactamente dos** llamadores de `_admin_log_doctor_change`, con nombre:
  `admin_set_doctor_operational` y `admin_set_lucy_status`, ambos
  `SECURITY DEFINER`/`postgres`. El preflight solo sabía que ninguno era
  `INVOKER`. Que sean `DEFINER` con owner `postgres` es lo que demuestra que
  revocar el `EXECUTE` directo no los rompe: la llamada anidada usa los
  privilegios del owner de la función en ejecución, no los del rol original;
- el **estado final efectivo** de grants, policies, helper y secuencia.

**Requisitos de preflight más estrictos se definieron DESPUÉS del apply.** No
se incorporaron a la migración —que debe conservar el texto aplicado— sino a
`check-s7_71b.mjs` y a este documento.

---

## 3. Verificación post-apply

Read-only, una sola sentencia. Resultado obtenido el 2026-08-07: **las cinco en
`ok = true`**.

```sql
SELECT 'policies'::text AS chk, count(*)::text AS valor, (count(*)=0)::text AS ok
FROM pg_policies WHERE schemaname='public' AND tablename='audit_log'
UNION ALL
SELECT 'grants_cliente', coalesce(string_agg(grantee||':'||privilege_type,', '),'(ninguno)'),
       (count(*)=0)::text
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='audit_log'
  AND grantee IN ('anon','authenticated','PUBLIC')
UNION ALL
SELECT 'grants_service_role', coalesce(string_agg(privilege_type,', '),'(ninguno)'),
       (count(*)=1 AND bool_and(privilege_type='SELECT'))::text
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='audit_log' AND grantee='service_role'
UNION ALL
SELECT 'acl_secuencia', coalesce(relacl::text,'(solo owner)'),
       (relacl IS NULL OR relacl::text NOT LIKE '%anon%')::text
FROM pg_class WHERE oid='public.audit_log_id_seq'::regclass
UNION ALL
SELECT 'acl_helper', coalesce(proacl::text,'(null)'),
       (proacl::text='{postgres=X/postgres}')::text
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='_admin_log_doctor_change';
```

### Lo que esa verificación NO demuestra — y cómo se cerró

La verificación de catálogo demuestra que la **superficie está cerrada**. **No
demuestra que los escritores legítimos sigan auditando** — eso solo se prueba
con una escritura real.

## 3-bis. ✅ Prueba QA de continuidad post-hardening: **PASS** (2026-08-07)

```
RUTA HELPER POST-HARDENING = DEMOSTRADA
```

Ejecutada sobre el **médico QA sintético persistente**
(`ac0ba772-4263-4fb2-a146-dd90033d8c76`), con las dos acciones hechas por el
owner desde LucyAdmin. Sin SQL, sin `service_role` para escribir, y sin tocar
identidad, credenciales, publicación, booking, servicios ni disponibilidad.

| id | cuándo | old_data → new_data |
|---|---|---|
| **14494** | `2026-08-07T11:41:11-06:00` | `{"is_operational": true}` → `{"is_operational": false}` |
| **14495** | `2026-08-07T13:21:46-06:00` | `{"is_operational": false}` → `{"is_operational": true}` |

Ambas `action=update`, `table_name=doctors`, `record_id` del médico QA, y el
mismo actor: `user_id 739cac58-…` con `profiles.role = admin`.

**Por qué prueba que las escribió `_admin_log_doctor_change`:**

1. **Sin clave `edited_via`** — su firma. Los escritores de
   `table_name='doctors'` redefinidos en `s7_57` sí la añaden.
2. **`new_data` con una sola clave, `is_operational`** — campo que solo escribe
   `admin_set_doctor_operational`.
3. **`user_id` no es el centinela `00000000-…`** — `auth.uid()` viajó desde la
   sesión de LucyAdmin a través de la función `SECURITY DEFINER`.

Eso responde la duda de fondo del paso 5: **revocar el `EXECUTE` directo del
helper no rompió su invocación anidada.** La llamada usa los privilegios del
owner de la función en ejecución, no los del rol original.

**Actividad colateral:**

- filas totales nuevas relevantes desde la última fila preexistente (`14439`): **2**
- filas de la prueba: **2**
- filas adicionales / colaterales: **0**

**Estado final del médico QA: restaurado e idéntico al previo.**

> **Las filas `14494` y `14495` se conservan permanentemente. Sin cleanup.** Son
> las primeras generadas bajo el régimen cerrado y quedan bajo la misma regla de
> conservación que `14437–14439`.

### Alcance de la prueba

Prueba **una** ruta: la del helper, que era la que quedaba en duda. **No prueba**
los otros 42 escritores ni los triggers de `appointments`, `patients` o
`consultations`; para esos, la evidencia será la actividad normal del sistema.

Y **no es una prueba de integridad**: mientras el histórico anterior al corte
siga sin ser atestable, estas dos filas son **trazas operativas observadas**,
igual que las `14437–14439`.

---

## 4. Rollback

`docs/rollbacks/s7_71b_rollback.sql` — **fuera de `migrations/`**, igual que el
de `s7_71a`: dentro del namespace ordenaría inmediatamente después de su
forward, y quien aplicara «las pendientes en orden» desharía el cierre sin
ningún error visible.

> ⛔ **Ejecutarlo REABRE la vulnerabilidad por completo.** Solo emergencia.
> No revierte datos: el forward no borra ni modifica ninguna fila.

---

## 5. Frontend retirado

`src/services/auditLog.service.ts` **eliminado**, junto con sus tres call sites:

| Archivo | Flujo | Lo cubre ahora |
|---|---|---|
| `appointments.service.ts` | cambio de estado / cancelación | `audit_appointments` → `status_change` |
| `appointments.service.ts` | edición de cita | → `reschedule` / `appointment_update` / `mixed` |
| `walkIn.service.ts` | creación walk-in | → `appointment_created` |

**Pérdida de auditoría: ninguna.** Los tres eventos ya los cubría el trigger de
`s7_71a`, demostrado en las cuatro corridas de su smoke.

Y se cierra además una **fuga**: dos de los tres escribían texto libre clínico
dentro de `audit_log` —`internal_notes` uno y `notes` el otro—, justo lo que la
whitelist del trigger excluye a propósito. Esa vía ya no existe.

---

## 6. Fuera de alcance

Documentado aquí para que no se confunda con omisión:

- **Las tres funciones `_func` huérfanas** (`audit_consultations_func`,
  `audit_patients_func`, `audit_prescriptions_func`): `SECURITY DEFINER`,
  owner `postgres`, **no versionadas** y **no enganchadas a ningún trigger**.
  Código muerto. No son vector —devuelven `trigger` y PostgreSQL rechaza su
  invocación directa— y no se tocan aquí.
- **El debt de `search_path`**: ocho funciones escritoras sin `SET search_path`
  (`audit_clinic_invitations`, `audit_consultation_family_history`,
  `audit_consultations`, `audit_consultations_func`, `audit_patients`,
  `audit_patients_func`, `audit_prescriptions`, `audit_prescriptions_func`).
  Heredan el del caller. Ya lo documentó `s7_66`. **Frente aparte.**
- **`FORCE ROW LEVEL SECURITY`**: se deja en `false` por decisión.
  ⚠️ **No activarlo "por hardening".** Hoy sería inocuo porque `postgres` tiene
  `BYPASSRLS`, pero con cero policies dejaría sin auditar a cualquier escritor
  cuyo owner no lo tuviera. Cambio sin beneficio y con modo de fallo real.
- **`integrity_epoch`**: fuera por decisión del owner. La frontera queda
  **documental**, no consultable por SQL: no se puede distinguir por columna una
  fila anterior de una posterior al cierre.
- **Superficie de las RPC `admin_*`**: varias tienen `EXECUTE` para PUBLIC, así
  que `anon` puede invocarlas. Sus gates `is_admin()` las protegen, pero es
  superficie innecesaria. Otro frente.

---

## 7. Consecuencia operativa

Con `service_role` reducido a `SELECT`, **ningún script puede borrar filas de
`audit_log`**. En particular, el `cleanupAuditLog` del smoke de `s7_71a` queda
inoperable — coherente con que ese smoke esté cerrado y no deba repetirse.

**Desde `s7_71b`, cualquier limpieza de `audit_log` exige autorización separada
y la ejecuta el owner por SQL.**
