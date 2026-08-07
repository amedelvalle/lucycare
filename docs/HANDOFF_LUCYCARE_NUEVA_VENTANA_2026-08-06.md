# HANDOFF LucyCare — nueva ventana (2026-08-06, frente AUDIT-SEC-P0 en curso)

> **PUNTO DE ENTRADA VIGENTE.** Autocontenido: no asume que la ventana nueva
> conozca ninguna conversación anterior. Reemplaza a
> `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-03.md`, que pasa a **histórico**
> junto con los anteriores. El detalle por PR de frentes cerrados vive en
> `docs/HISTORIAL_FRENTES.md`.
>
> ⚠️ **HAY UN FRENTE ABIERTO: AUDIT-SEC-P0.** No abrir ningún otro.
>
> ⚠️ **La vulnerabilidad de `audit_log` SIGUE ABIERTA en producción.** `s7_71a`
> construyó la cobertura previa; el cierre es `s7_71b`, que **todavía está
> bloqueada**.
>
> 🔄 **Actualizado el 2026-08-06 (segunda revisión).** §7 quedó **completado**
> por el owner y verificado read-only; la corrección del smoke (§8) está
> **implementada** en la rama `claude/audit-sec-p0-s7-71a-smoke-fix`. El
> `smoke_sha256` cambió, así que **el fingerprint anterior está invalidado** y
> hace falta un `--preflight` nuevo (§3, §10).

---

## 1. Reglas operativas VINCULANTES

- **Un solo frente funcional a la vez.** Hoy: AUDIT-SEC-P0.
- **El owner decide; el developer ejecuta instrucciones cerradas.**
- **No abrir rama, PR ni frente nuevo sin autorización explícita del owner.**
- **No mergear** salvo autorización explícita y vigente.
- **No ejecutar SQL. No aplicar migraciones.** El owner aplica el SQL en el
  SQL Editor de Supabase; el dev corre los `check`/`smoke`.
- **`service_role` requiere autorización puntual, limitada y explícita, INCLUSO
  read-only.** Nunca para escribir sin autorización específica.
- **`auth.users`: JAMÁS por SQL.** Toda operación va por la **Supabase Admin
  API** (`auth.admin.createUser`, `deleteUser`, `generateLink`).
- **No modificar** Supabase, Auth Hooks, Vercel, Cloudflare, Turnstile, Twilio,
  Resend ni producción sin autorización expresa.
- **No compartir, imprimir, registrar ni guardar** secretos, tokens,
  contraseñas, OTP, captcha tokens, service keys ni enlaces de autenticación.
- **JAMÁS Katherine (`50372608827`)**, ni siquiera en read-only.
- **Camilo (`50378627694`) solo como demo controlado**: no modificar su
  identidad ni su configuración permanente.
- **El médico QA persistente está PROTEGIDO** (§6). Nunca entra en cleanup.
- **TWILIO-P0 BLOQUEADO.** No configurar Twilio.
- **`s7_71b` BLOQUEADA.** No abrirla hasta cerrar los gates de §4.
- **No usar datos reales para QA.**
- **Todo copy nuevo en tuteo**, no voseo.
- **No afirmar que una prueba fue ejecutada si solo se revisó código.**
- **No inventar** HEAD, estado de PR, deployment, resultados ni configuración.
- **PR que toca DB → migración + `check-s7_NN.mjs` + `_smoke-s7_NN.mjs`.**
- **Validar el instrumento, no solo el fix:** correr la misma medición contra el
  código anterior (A/B) para comprobar que el bug se reproduce.
- **Cierre estándar tras cada merge:** HEAD, PRs, migraciones,
  `main==origin/main`, `git status` vacío, rama borrada local+remoto, 0 PRs
  abiertos, sin residuos.

---

## 2. Estado exacto del repositorio

| Ítem | Valor |
|---|---|
| Repo local | `C:\Users\admic\lucycare` |
| Remoto | `github.com/amedelvalle/lucycare` |
| Dominio productivo | `https://lucycare.app` |
| **HEAD de `main`** | `d11dbbe2352216c9722ab7d6a3d199ff054c5d43` |
| Subject del HEAD | `chore(seguridad): sacar el rollback de s7_71a del namespace de migraciones (#314)` |
| `main == origin/main` | **sí** |
| Árbol | limpio |
| **PRs abiertos** | **0** |

**Últimos PRs mergeados:**

| PR | Qué hizo |
|---|---|
| **#314** | sacó `s7_71a_rollback.sql` de `migrations/` → `docs/rollbacks/` |
| **#313** | `s7_71a` — cobertura server-side de auditoría de `appointments` |
| #312 | docs de continuidad post #311 |
| #311 | cancelación por el paciente — frontend (`s7_70`) |
| #310 | cancelación por el paciente — backend (`s7_70`) |

**Identidad de git vigente:**

| Ámbito | `user.name` | `user.email` |
|---|---|---|
| Local (este repo) | `amedelvalle` | `lucycare.digital@gmail.com` |
| Global (`~/.gitconfig`) | `amedelvalle` | `240200944+amedelvalle@users.noreply.github.com` |

Verificar el subject con `git show -s --format=%s HEAD` antes de push o merge.
**Nunca** usar here-strings de PowerShell (`@'...'@`) dentro de Bash.

---

## 3. Estado de migraciones

**Versionadas y aplicadas hasta `s7_71a`.**

| Archivo | Estado |
|---|---|
| `migrations/s7_71a_audit_appointments_coverage.sql` | **APLICADA** en producción |
| `docs/rollbacks/s7_71a_rollback.sql` | versionada, **NO aplicar** |

**Resultado de la aplicación:** `Success. No rows returned` — salida esperada:
la migración termina en `COMMIT` y no hace `SELECT` final. Confirma que la
transacción commiteó y que el bloque `DO $pre$` de preflight pasó (habría
lanzado `RAISE EXCEPTION 's7_71a PRE: …'` si faltara algo).

**Verificaciones SQL §4.1–§4.4 — las cuatro APROBADAS por el owner:**

| # | Verificado |
|---|---|
| 4.1 | trigger `audit_appointments` existe, `habilitado`, `AFTER INSERT OR UPDATE … FOR EACH ROW`, **sin DELETE** |
| 4.2 | `audit_appointments_fn` es `SECURITY DEFINER`, `search_path = pg_catalog, public, pg_temp`, owner `postgres`, `execute_acl = {postgres=X/postgres}` — EXECUTE revocado para `anon`, `authenticated` y `service_role` |
| 4.3 | `cancel_my_appointment` **sin** `INSERT` manual en `audit_log`, **con** `app.audit_appointments_context`, validaciones intactas, ACL conservada |
| 4.4 | `audit_log` **sin cambios**: ACL `{postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}` y `policies = 1` |

**Checksums vigentes** (normalizados a LF, mismo criterio en todos lados):

```
migration_sha256 = 1e9ec409cc6cfbe4547067b8fd8f2bca7c58082a5024dec6e84f6052e3047af0   ← SIN CAMBIOS
rollback_sha256  = b36f8f757749b36cb622f6bfd637a5bd7893f87c4eff8f041ed1c01f4bd53b5e   ← SIN CAMBIOS
smoke_sha256     = a2d306448507437f74dd1747ebc86d62ba26f33e67075b3df9dc85fa09fabb66   ← NUEVO
                   (anterior: 8ad15087b829860ce593b97d30143771043f99f2f5365fec6da0894d7b764771)
```

> Que `migration_sha256` y `rollback_sha256` no se muevan es la prueba de que
> el PR correctivo **no tocó** la migración aplicada ni su rollback.
> `smoke_sha256` sí cambió —es el propósito del PR— y por eso **el fingerprint
> anterior queda invalidado**: hay que emitir uno nuevo con `--preflight`.

> ⚠️ **PROHIBIDO ejecutar el rollback.** `s7_71a` permanece aplicada. El
> rollback se movió fuera de `migrations/` justamente porque ordenaba
> inmediatamente después de su forward y cualquiera que aplicara «las
> pendientes en orden» habría deshecho la cobertura sin error visible.
>
> El encabezado del forward (línea 58) todavía dice
> `-- REVERSIÓN: migrations/s7_71a_rollback.sql`. Es un comentario **obsoleto y
> deliberado**: corregirlo cambiaría `migration_sha256` e invalidaría el
> fingerprint aprobado. La ruta correcta es `docs/rollbacks/`.

---

## 4. AUDIT-SEC-P0 — el frente abierto

### 4.1 Diagnóstico original de `audit_log` (Fase 0, read-only)

`audit_log` **admite INSERT arbitrario** por `public` / `anon` / `authenticated`:

| Elemento | Estado medido |
|---|---|
| Policy | `audit_log_insert_only` — PERMISSIVE, `roles={public}`, `INSERT`, **`WITH CHECK true`**. Es la **única** policy |
| ACL de tabla | `anon` y `authenticated` con `arwdDxtm` (**ALL**) |
| ACL de `audit_log_id_seq` | `anon` y `authenticated` con `rwU` → incluye **`setval()`** |
| `user_id` | `uuid NOT NULL` **sin FK** → suplantable |
| `created_at` | `DEFAULT now()` pero **escribible** → antedatable |
| `clinic_id` / `metadata` | **no existen** en esta tabla |

Efectivo hoy: `SELECT`, `UPDATE` y `DELETE` bloqueados por **ausencia de
policy**; `INSERT` **abierto**. `TRUNCATE` no está sujeto a RLS y sigue
concedido, aunque no es alcanzable vía PostgREST.

**Severidad ALTA:** cualquiera con la clave `anon` —que es pública, viaja en el
bundle— puede insertar filas de auditoría arbitrarias, atribuidas a cualquier
uuid y fechadas a voluntad, en el registro de un sistema clínico. No es fuga de
datos: es pérdida de **integridad y no-repudio**.

**Hallazgo adicional:** `_admin_log_doctor_change(uuid,text,jsonb,jsonb)` es
`SECURITY DEFINER` **sin gate interno** y con `EXECUTE` para `PUBLIC`. Un
`authenticated` cualquiera puede fabricar auditoría de `doctors`.

### 4.2 Qué resolvió `s7_71a`

Creó la **cobertura server-side de `appointments`, que no existía**. Antes, los
tres eventos de agenda se auditaban **solo desde el cliente**
(`appointments.service.ts:342` y `:500`, `walkIn.service.ts:252`), y esas
llamadas son *fire-and-forget* (`auditLog.service.ts:29-32` hace `console.warn`
y no relanza). Revocar el INSERT sin sustituirlas habría borrado esa auditoría
**en silencio**.

Contenido aplicado: función `audit_appointments_fn()` + `REVOKE EXECUTE` +
trigger `audit_appointments` + `CREATE OR REPLACE cancel_my_appointment` (que
elimina su `INSERT` manual y fija un contexto transaccional validado).

**Estado transitorio actual:** hay **doble auditoría** en cambio de estado,
edición y walk-in (trigger + cliente). Es lo previsto, redundante y no dañino.
La cancelación del paciente **no** se duplica.

### 4.3 Qué debe cerrar `s7_71b` — **BLOQUEADA**

- `REVOKE ALL ON public.audit_log FROM PUBLIC, anon, authenticated`
- `REVOKE` de los privilegios de `audit_log_id_seq` para esos roles
- `DROP POLICY audit_log_insert_only` — **sin crear ninguna policy permisiva nueva**
- `service_role` con **solo** `SELECT, INSERT, DELETE` sobre la tabla y **solo
  `USAGE`** sobre la secuencia (sin `UPDATE`, sin `TRUNCATE`).
  **`DELETE` es obligatorio**: la limpieza de fixtures de todos los smokes depende de él
- `REVOKE EXECUTE` de `_admin_log_doctor_change` para `PUBLIC`, `anon`,
  `authenticated` **y `service_role`** (verificado: **no tiene llamadores
  directos** en `src/` ni `scripts/`; sus 4 llamadores son RPCs `SECURITY
  DEFINER` con owner `postgres`)
- `ALTER TABLE audit_log ADD COLUMN integrity_epoch text` **SIN DEFAULT**, y
  **solo después** `SET DEFAULT 's7_71'`.
  ⚠️ En PostgreSQL 11+, un `ADD COLUMN … DEFAULT 'x'` **rellena
  retroactivamente** las filas existentes y marcaría el legado como íntegro
- Eliminar `src/services/auditLog.service.ts` y sus 3 llamadas
- **Orden obligatorio: DB → validación → frontend**

### 4.4 Gates pendientes ANTES de abrir `s7_71b`

- [x] `check-s7_71a.mjs` → 599 OK, 0 fallos
- [x] `--preflight` con huella emitida
- [x] Identidades sintéticas autorizadas
- [x] §4.1 — trigger existe y habilitado
- [x] §4.2 — `SECURITY DEFINER`, `search_path`, EXECUTE revocado
- [x] §4.3 — `cancel_my_appointment` correcta
- [x] §4.4 — `audit_log` sin cambios
- [x] Instrumento corregido (§8) — `check-s7_71a.mjs` en **849 OK, 0 fallos**
- [x] `--preflight` v6 emitido y aceptado
- [x] **Smoke: exactamente una fila por `cancel_my_appointment`** — §5-bis, 6.1
- [x] **Smoke: `notes` e `internal_notes` ausentes de la auditoría** — 1.8, 1.9, 6.8
- [ ] **Smoke: cero residuos de fixtures** — 🔴 la corrida dejó 6 residuos
      (limpiados a mano). Requiere el PR correctivo del cleanup y una corrida
      nueva que termine con el inventario en cero **por sí misma**

**Dos de los tres gates quedan cerrados.** El tercero exige repetir la corrida
con el cleanup corregido. Ver §5-bis y `docs/OWNER_S7_71A_APPLY.md` §5-ter.

---

## 5-ter. Tercera corrida (2026-08-07T02:37:03Z) — auditoría ✅, cleanup 🔴

Sobre `HEAD 51e2dbb`, huella `33c71f58…`. **74 OK**, exit 1.

Las diez secciones funcionales volvieron a pasar, incluidas las nuevas `2.11`
(grants capturados por `booking_intent_id`) y el gate de `cancel_my_appointment`
con exactamente una fila. El orden de borrado de §5-ter de la guía funcionó:
**grants e intents se eliminaron correctamente**.

**Falló por un defecto nuevo, introducido en el PR #317:** el helper contaba
las filas borradas con `.select('id')`, y
`appointment_patient_cancellations` **no tiene columna `id`**. El borrado no se
ejecutó y la fila superviviente bloqueó por FK a todo lo demás: **23 residuos**.

### Limpieza de los 23 residuos — 2026-08-07T02:44Z

Identificación read-only encadenada desde objetos con pertenencia demostrable
(marca `S7_71_FIXTURE`, `RUN_ID` en el nombre de la clínica, teléfonos
`8800–8802`); **nada se identificó por `doctor_id` ni `clinic_id`**. Allowlist
validada como disjunta de los objetos permanentes. Borrado en el orden
autorizado, con **count exacto** en cada paso:

```
cancelaciones 1 · citas 11 · pacientes 3 · servicios 2 · médicos 1 · clínicas 1
auth.users 2 (Admin API) → profiles 2 por cascada
grants, intents, reglas y membresías: 0 (ya estaban)
```

Verificación final: **las 16 categorías en 0** y el médico QA intacto
(publicado, operativo, `booking_enabled=false`, 0 reglas, 0 citas, 0 intents,
0 pacientes en su clínica, sus dos servicios sin cambios).

### DECISIÓN DEL OWNER sobre `audit_log` 14437–14439

**Tomada el 2026-08-06 (hora local de El Salvador) · 2026-08-07 UTC.**

Tras la limpieza quedaron **3 filas** en `audit_log` —`id` **14437, 14438,
14439**, `action=delete`, `table_name=patients`, `user_id` = centinela— con
timestamp posterior al `cleanupAuditLog` del smoke. Son las **trazas esperadas**
que generó la limpieza administrativa manual de los tres `patients` sintéticos.

- **No son residuos de fixtures** de la corrida.
- **No deben eliminarse** como parte del cleanup actual **ni de futuras
  corridas** del smoke.
- **No deben incluirse en el conteo de residuos de fixtures** de futuras
  corridas. (Mecánicamente tampoco pueden alcanzarlas: `cleanupAuditLog` borra
  solo por la allowlist de UUID de *su propia* corrida, y estos `record_id` no
  pertenecen a ninguna. Pero la regla es vinculante por decisión, no por esa
  mecánica.)
- **Se conservan por ahora**, salvo que exista posteriormente una decisión
  explícita y separada sobre retención o depuración de `audit_log`.
- La corrida del **2026-08-07 UTC** quedó, después de la limpieza manual, con
  **residuos de fixtures = 0**.

> ⚠️ **Matiz que corrige una redacción anterior de este handoff.** Mientras la
> vulnerabilidad de escritura de `audit_log` siga abierta —es decir, hasta
> `s7_71b`— estas filas se documentan como **trazas operativas observadas**, no
> como evidencia independiente e infalsificable. Cualquiera con la clave `anon`
> puede insertar filas arbitrarias en esa tabla (§4.1), así que su valor
> probatorio es limitado por construcción y no debe presentarse de otro modo.

---

## 5-bis. Segunda corrida (2026-08-06T20:41:59Z) — auditoría ✅, cleanup 🔴

Ejecutada sobre `HEAD bb36364` con la huella v6, autorizada y única.

```
inicio    : 2026-08-06T20:41:59.685Z
final     : 2026-08-06T20:42:35.522Z   (36 s)
exit code : 1
resultado : 73 OK, 2 fallos (ambos del cleanup), 6 errores de cleanup
```

**Las diez secciones funcionales pasaron enteras**, incluida la sección 2, que
en la corrida anterior ni siquiera arrancaba:

| § | Sección | Resultado |
|---|---|---|
| 0 / 0-bis | verificación previa + fixtures | ✅ |
| 1 | walk-in | ✅ 9/9 |
| **2** | **`create_booking_with_intent`** | ✅ **10/10** |
| 3–5 | estado · reprogramación · doctor/servicio/precio/motivo | ✅ 19/19 |
| **6** | **`cancel_my_appointment`** | ✅ **8/8** |
| 7 | merge/unmerge | ✅ 7/7 |
| 8 | firma | ⏭️ excluida |
| 9 / 10 | update irrelevante · `service_role` | ✅ 4/4 |
| 11-12 | `db_direct` · contexto rechazado | ⏭️ owner-only |

Datos clave: la cita se creó en `2026-08-09T10:00:00-06:00`, **exactamente** el
literal local construido — sin el desfase de seis horas del bug anterior.
`booking_enabled` hizo `false → true → false` y la regla temporal se borró por
su `ruleId`. Actividad externa: **cero**.

### Los seis residuos y su limpieza

El cleanup falló por orden inverso a la cadena de FKs y por
`auth_creation_grants.issued_by` (ver `docs/OWNER_S7_71A_APPLY.md` §5-ter).
Residuos:

```
appointment         0483cf7a-57ef-4623-87c0-5d7c2608b9f3
booking_intent      86e631c6-1723-422c-a119-a6c369022613
patient             d11a7a22-e90b-408c-9424-df22a345c8fb
profile/auth.user   8ec65dc8-ebc5-48f5-9c21-8d5f163c0fcf
auth_creation_grant cea64c6d-6dd5-4298-ab31-f7e9e01e999b   ← invisible al inventario
```

**Limpieza controlada ejecutada el 2026-08-06T20:49:02Z** con autorización
puntual del owner: verificación read-only de toda la cadena (21 comprobaciones)
→ puerta → borrado en orden, cada `DELETE` afectando **exactamente 1 fila** →
`deleteUser` por Admin API → el profile desapareció por cascada. **Cero
residuos verificado**, `audit_log` no se tocó (ya estaba en cero) y el médico QA
quedó intacto: publicado, operativo, `booking_enabled=false`, 0 reglas, 0 citas,
0 intents, 0 pacientes y sus dos servicios sin cambios.

---

## 5. Smoke de `s7_71a` — primera corrida, FALLIDA

**Una sola corrida, autorizada, en producción.**

```
inicio    : 2026-08-06T15:33:14Z
final     : 2026-08-06T15:33:33Z   (19 s)
exit code : 1
resultado : 21 OK, 2 fallos, 2 errores de cleanup
```

### Secciones

| § | Sección | Resultado |
|---|---|---|
| 0 | Verificación previa (huella + colisiones) | ✅ 9/9 |
| 0-bis | Fixtures sintéticas | ✅ |
| **1** | **Creación manual (walk-in)** | ✅ **9/9** |
| **2** | **`create_booking_with_intent`** | 🔴 **FALLÓ** |
| 3–7, 9, 10 | estado, reprogramación, doctor/servicio/precio/motivo, `cancel_my_appointment`, merge/unmerge, update irrelevante, `service_role` | ⏸️ **no alcanzadas** |
| 8 | Firma de consulta | ⏸️ excluida por diseño |

**Lo único demostrado del trigger es la sección 1**, y pasó completa: 1 fila
exacta, `action=insert`, `change_kind=appointment_created`, `source` literal
`manual`, `old_data` nulo, `actor_kind=service_role`, `db_executor` presente, y
**ni la nota libre ni la interna aparecen en la auditoría**.

### Causa exacta del fallo

```
register_booking_intent: Ese horario no está disponible. Elegí otro.
```

`validate_booking_slot` (`s7_66:105`) exige
`is_published AND booking_enabled AND is_operational`. Las fixtures creaban
médicos con los **defaults conservadores** (los tres `false`). **Defecto del
instrumento, no de `s7_71a`**: el código de producción rechazó correctamente una
reserva sobre un médico no operativo.

`validate_booking_slot` exige **nueve** condiciones, no tres:
1. los tres booleanos (`P009C`) · 2. servicio activo del mismo médico (`P009D`) ·
3. no en el pasado (`P009E`) · 4. **una sola** grilla de disponibilidad
(`P0099`) · 5. `slot_duration_min` resoluble (`P0097`) · 6. la regla cubre
inicio **y** fin · 7. el horario encaja en la **fase** de la grilla · 8. no
bloqueado · 9. sin cita solapada (`P009B`).
Y `create_booking_with_intent` añade: `auth.uid()` no nulo (`28000`) y teléfono
válido en la sesión (`P0095`).

### Dos defectos más del instrumento

1. **`booking_intents.created_by` no existe.** Columnas reales: `clinic_id`,
   `consumed_appointment_id`, `consumed_at`, `created_at`, `doctor_id`,
   `end_at`, `expires_at`, `id`, `phone_e164`, `service_id`, `start_at`.
2. **El inventario interpretaba un error de conteo como cero.** Imprimió
   `booking_intents  -1` y aun así declaró `CERO residuos (0)`, porque el código
   hace `if (n > 0) residuals += n`. Declaró limpia una tabla que no pudo
   verificar.

### Cleanup y residuos — **cero, confirmado**

El `finally` completó todos los intentos: citas, `auth_creation_grants`, reglas,
servicios, pacientes, médicos, membresías, clínicas, perfiles y **3 `auth.users`
eliminados por Admin API** (`getUserById` → 0 encontrados).

`audit_log`: 5 filas sobre 3 `record_id`, **todos dentro de la allowlist** → sin
abort, sin tocar auditoría legítima.

Verificación read-only posterior para cerrar el hueco de `booking_intents`:
`0` con los teléfonos sintéticos, `0` creados desde el inicio de la corrida,
`0` en `auth_creation_grants`. **Cero residuos verificado, no inferido.**

### Correcciones obligatorias antes de repetirlo

Ver §8. **Cualquier cambio en `_smoke-s7_71a.mjs` invalida `smoke_sha256` y el
fingerprint, y obliga a repetir el preflight** — que a su vez volverá a requerir
la atestación manual del owner (§8, nota sobre `listUsers`).

---

## 6. Médico QA persistente

### 6.1 Decisión del owner

El owner **autorizó expresamente** conservar un médico sintético **publicado en
producción durante la etapa de QA**, para probar directorio, búsqueda, página
pública, sitemap, metadata, booking, agenda, panel médico, cancelaciones y
auditoría. **Debe despublicarse obligatoriamente antes del lanzamiento
comercial** (§9).

Se descartó ocultarlo con `specialty_id = NULL` porque el perfil debe servir
para probar también directorio, sitemap y metadata.

### 6.2 Identidad sintética

| Campo | Valor |
|---|---|
| Email | `asp0.qa.doctor@lucycare.test` |
| Teléfono | `50370008803` — **Test Phone permanente confirmado** |
| `user_metadata.fixture` | `S7_71_QA_DOCTOR` |
| Nombre | `QA LucyCare — Perfil médico de prueba` |
| Clínica | `QA LucyCare — Clínica de prueba` |
| Dirección | `Entorno de prueba — No es una ubicación física` |
| Especialidad | `9d206032-784d-458e-901f-e30bba7d180d` — Medicina General |
| Departamento / Municipio | `LI` / `LI-21` — La Libertad / Santa Tecla |
| Licencia sintética | `QA-S771-0806` (tipo `JVPM`) |
| Consentimiento / TOS | `v1.0` / `v1.0` |

> El **OTP del Test Phone NO se documenta** en el repositorio, por regla
> vigente. Está en la configuración de Supabase Auth.

### 6.3 IDs definitivos

| Objeto | UUID |
|---|---|
| `auth.users` = `profiles` | `b5865737-1c7b-4fd1-bd70-b9e5befd87ed` |
| `doctor_affiliation_requests` | `4cc25c0b-7fed-4a0d-9e53-8ff3ab6ef0a9` |
| `doctors` | `ac0ba772-4263-4fb2-a146-dd90033d8c76` |
| `clinics` | `8b24611d-6b7d-4f2c-bbf5-ec53f5c4bded` |
| `doctor_credentials` (JVPM) | `30d3d2ab-83d5-45b8-9fdf-fb6d285e07b5` |

### 6.4 Cómo se provisionó (opción A — vías del producto)

Sin mecanismo nuevo, sin `UPDATE` directo de `role`, sin impersonación por SQL:

1. **Dev** — `auth.admin.createUser` (Admin API) con `email_confirm` y
   `phone_confirm` → `handle_new_user` creó `profiles` con
   `id = auth.users.id`, `role='patient'`, `full_name=''`, `phone` correcto y
   **`email = null`** (la función ignora `user_metadata` y no copia el correo).
2. **Dev** — `submit_affiliation_request` como `anon` → lead `pending`.
3. **Owner (LucyAdmin)** — aprobó el lead, corrió `admin_affiliation_preflight`
   (clasificó `reuse_patient`) y `admin_approve_and_create_doctor` con
   `confirm_reuse`, que completó `full_name` (**solo porque estaba vacío**) y
   creó clínica + `clinic_members` owner + doctor `listed_only`, más la
   credencial JVPM.
4. **Dev** — sesión del usuario QA por `generateLink` + `verifyOtp` (**sin SMS
   ni correo**) y `claim_doctor_profile`.

### 6.5 Estado ANTES del claim

```
profiles.role   = patient
doctors         : lucy_status=listed_only · is_published=false ·
                  is_operational=false · booking_enabled=false ·
                  slug=null · tos_accepted_at=null · tos_version=null
clinic_members  : owner, is_active=true
services=0 · availability_rules=0 · appointments=0
```

### 6.6 Resultado EXACTO después del claim — **verificado**

```
inicio : 2026-08-06T16:57:31Z
final  : 2026-08-06T16:57:51Z
respuesta: {"success":true,"doctor_id":"ac0ba772-…","lucy_status":"claimed"}
```

| Comprobación | Resultado |
|---|---|
| `profiles.role` | ✅ **`doctor`** |
| `doctors.profile_id` | ✅ `b5865737-…` sin cambios |
| `lucy_status` | ✅ `claimed` |
| `tos_accepted_at` | ✅ `2026-08-06T10:57:33.435179-06:00` |
| `tos_version` | ✅ `v1.0` |
| `clinic_members` owner activo | ✅ |
| `is_published` / `is_operational` / `booking_enabled` | ✅ `false` / `false` / `false` |
| `services` / `availability_rules` / `appointments` | ✅ 0 / 0 / 0 |
| `patients` vinculados al profile QA | ✅ 0 |
| `slug` | `null` — lo asignará el trigger al publicar |
| `profiles.email` | `null` — **no se modificó** |

El claim entró por el **camino directo** (`doctor.profile_id == auth.uid()`), no
por la rama de migración de perfiles legacy. **El bloqueante de
`profiles.role` quedó resuelto por la vía del producto.** El médico QA ya puede
entrar al panel (`useClinicContext` exige `role === 'doctor'`).

> El claim es de **un solo uso**: un segundo intento falla con «Este perfil ya
> fue reclamado». No reintentar.

### 6.7 Objetos permanentes protegidos — DENYLIST

**Nunca borrar, nunca incluir en cleanup:**

```
auth.users / profiles : b5865737-1c7b-4fd1-bd70-b9e5befd87ed
clinics               : 8b24611d-6b7d-4f2c-bbf5-ec53f5c4bded
doctors               : ac0ba772-4263-4fb2-a146-dd90033d8c76
doctor_credentials    : 30d3d2ab-83d5-45b8-9fdf-fb6d285e07b5
clinic_members        : (clinic_id de arriba)
services (consulta)   : 3682d9fd-3d7e-4b03-bd10-d52fb1b75baa
services (control)    : 38f8f112-49ed-4052-8c9a-517f82503b30
```

> El smoke corregido construye esta denylist **resolviéndola**, no copiándola:
> `buildPermanentIds()` la deriva de la resolución por atributos estables, y
> `assertNotPermanent()` **lanza** antes de cada borrado y de cada
> `deleteUser`. La lista de arriba es la referencia humana, no la fuente.

⚠️ **`profiles_id_fkey` es `ON DELETE CASCADE`**: borrar el `auth.user` QA
arrastraría el profile y, en cascada, probablemente clínica y médico. El
`deleteUser` sobre ese UUID debe estar **prohibido por aserción explícita**.

El teléfono `50370008803` queda **reservado** a esta identidad: nunca fixture
desechable, nunca paciente de corrida, nunca en cleanup.

---

## 7. Estado administrativo — ✅ COMPLETADO (2026-08-06)

El owner ejecutó los tres pasos desde LucyAdmin. **Verificado read-only** con
`service_role` el 2026-08-06 (dos corridas: la primera detectó `is_first_visit`
incorrecto en el servicio de consulta; el owner lo corrigió y la segunda dio
17/17).

- [x] **Dos servicios creados** con `admin_create_service`
- [x] **Operativo**: `admin_set_doctor_operational(true)`
- [x] **Publicado**: `admin_set_doctor_published(true)` → slug asignado y
      **congelado** por `trg_set_doctor_slug`

| Servicio | `service_id` | Duración | Precio | Activo | `is_first_visit` |
|---|---|---|---|---|---|
| `QA — No reservar (consulta)` | `3682d9fd-3d7e-4b03-bd10-d52fb1b75baa` | 30 | 0 | sí | **`true`** |
| `QA — No reservar (control)` | `38f8f112-49ed-4052-8c9a-517f82503b30` | 30 | 0 | sí | `false` |

**Estado verificado del médico QA:**

```
profiles.role       = doctor
lucy_status         = claimed
is_published        = true
is_operational      = true
booking_enabled     = false      ← invariante sostenido
slug                = qa-lucycare-perfil-medico-de-prueba
availability_rules  = 0
appointments        = 0
booking_intents     = 0
patients (clínica y profile QA) = 0
profiles.email      = null       ← no se modificó
```

**Visibilidad pública confirmada** (cliente anon + página real): el slug
resuelve, el perfil aparece en el directorio, anon lee `booking_enabled=false`,
la pill dice «Sin agenda en línea» y **no hay widget de reserva** — en su lugar
el bloque informativo con *Llamar · WhatsApp · Lista de espera*.

> Las tres RPCs están gateadas por `is_admin()`. Con `service_role`
> `auth.uid()` es NULL y **fallan**: por eso las ejecutó el owner desde la UI.
> Verificado en el código: `admin_set_doctor_published` (redefinida en
> `s7_57:290`, gate `can_manage_directory()`) toca **solo** `is_published`;
> `admin_set_doctor_operational` **solo** `is_operational`; `admin_create_service`
> **solo** `services`. Ninguna toca `booking_enabled`, que además **no tiene
> RPC admin**: desde LucyAdmin es inalcanzable.

**Dos consecuencias registradas para el checklist de §9:**

1. El teléfono `50370008803` quedó **públicamente visible** en el perfil, con
   botones activos de *Llamar* y *WhatsApp*.
2. El perfil ya es **elegible para el `sitemap.xml`** (publicado + con slug es
   exactamente el criterio de `middleware.ts:104`). Fecha de publicación:
   **2026-08-06**.

---

## 8. Corrección del smoke — ✅ IMPLEMENTADA

Implementada en la rama `claude/audit-sec-p0-s7-71a-smoke-fix`. La descripción
operativa completa está en `docs/OWNER_S7_71A_APPLY.md` §5-bis. Decisiones que
la gobernaron (todas cumplidas):

**Resolución del médico QA por identificadores estables** — email, teléfono,
`full_name`, `metadata.fixture` y los nombres exactos de clínica y servicios.
**No hardcodear UUIDs.** El `--preflight` los resuelve y **exige unicidad**.

**UUIDs resueltos → manifiesto y fingerprint.** `--run` los vuelve a resolver y
**aborta** si difieren del fingerprint aprobado.

**Secuencia de la corrida:**
1. releer `booking_enabled`; **abortar si ya es `true`** (estado base corrupto u
   otra corrida en curso)
2. snapshot
3. crear **una única** `availability_rule` temporal para el slot exacto, con
   `slot_duration_min = 30` **explícito** (`integer NOT NULL DEFAULT 30`)
4. activar `booking_enabled`
5. `register_booking_intent` → capturar `intent_id`
6. `create_booking_with_intent` → capturar `appointment_id`
7. **restaurar el snapshot en el `finally`, ANTES del cleanup**
8. borrar la regla temporal **por `ruleId` allowlisted**
9. confirmar restore y cleanup

**Horario local:** prohibido `toISOString().replace('Z','')`. Construir un único
literal `YYYY-MM-DDTHH:mm:ss` y derivar de **ese mismo literal** `p_start_local`,
`day_of_week`, `start_time` y `end_time`. Sin conversión intermedia a UTC.

**`booking_intents`:** eliminar `created_by`; allowlist explícita de
`intent_id`; `doctor_id`, `phone_e164` y `RUN_STARTED_AT` **solo como defensas
adicionales**, nunca criterio suficiente.

**Actividad externa:** cualquier `appointment` o `booking_intent` del médico QA
creado durante la ventana y **fuera de la allowlist** se **reporta y hace
fallar**, y **nunca se borra automáticamente** — podría ser una reserva real.

**Inventario fail-closed:** conteos `{status:'OK'|'ERROR', count}`, **nunca
`-1`**. Tabla no verificable = fallo. **Nunca imprimir «cero residuos» con
conteos desconocidos.** El `finally` intenta todas las limpiezas; el exit es
**≠ 0** ante residuos, conteo desconocido, tabla no consultable, error de
borrado, usuario Auth no eliminado, **restore fallido** o actividad externa.

**Añadido al implementarla, no previsto en el diseño original:**

- La restauración de `booking_enabled` corre en el **`finally` local** de la
  sección de reserva, no solo en el cleanup global. Con el médico QA
  **publicado en producción**, dejar la reserva abierta durante el resto de la
  corrida es una ventana real de exposición; ahora dura segundos y el cleanup
  la re-verifica.
- El baseline comprueba también **`availability_overrides = 0`**: un override
  de bloqueo haría fallar la reserva por `P0098` y el diagnóstico apuntaría al
  trigger en vez de al instrumento.
- El teléfono QA entra en `FORBIDDEN_PHONES` (categoría propia
  `QA_PERSISTENT_PHONES`) para que **nunca** pueda convertirse en fixture
  desechable.
- **Defecto encontrado en el propio check:** varios tramos se aislaban con
  `between(codigo, …, '\n}\n')`. Los archivos están en **CRLF**, así que ese
  delimitador no casa nunca y `between` devolvía el resto del archivo: una
  aserción negativa sobre ese tramo pasaba mientras miraba código ajeno. Los
  tramos se cierran ahora por el nombre de la función siguiente, y se exige que
  no estén vacíos.

> ⚠️ **`auth.admin.listUsers` falla en `page=3` con `perPage=50`**
> (`Database error finding users`), tras dos páginas sanas y con metadata
> coherente (`total=139`, `lastPage=3`). **Lo único demostrado es eso**: no está
> probado que las filas 101–139 sean irrecuperables ni que haya una fila
> corrupta. Por diseño fail-closed, el preflight aborta salvo **atestación
> manual del owner**, que exige simultáneamente
> `ASP0_OWNER_AUTH_ATTESTED=1`, `ASP0_OWNER_AUTH_ATTESTED_DATE` y
> `ASP0_OWNER_AUTH_ATTESTED_RUN_ID`, más coincidencia del hash de las
> identidades. **Cada preflight nuevo volverá a requerirla.**

---

## 9. Checklist BLOQUEANTE antes del lanzamiento comercial (≤ 2026-10-02)

- [ ] `doctors.booking_enabled = false`
- [ ] `doctors.is_published = false`
- [ ] `doctors.is_operational = false`
- [ ] `availability_rules` del médico QA: **0 filas**
- [ ] Ausente del **directorio** y de la **búsqueda** en `lucycare.app`
- [ ] Ausente de `lucycare.app/sitemap.xml`
- [ ] `/doctor/<slug>` no resuelve o devuelve `noindex`
- [ ] Revisión en **Google Search Console** + `site:lucycare.app`; solicitar
      retirada si llegó a indexarse
- [ ] Sin citas, pacientes ni intents residuales del médico QA
- [ ] **Decidir**: conservar despublicado o eliminar por Admin API

**Mejora posterior registrada:** bandera explícita `doctors.is_qa_fixture` para
excluir el perfil de sitemap, JSON-LD e indexación **sin despublicarlo**.

---

## 10. Próximo paso exacto

### ✅ Hecho — OWNER, desde LucyAdmin

§7 completado y verificado: dos servicios, operativo, publicado, slug
congelado, invariantes sostenidos.

### ✅ Hecho — DEV: PR correctivo del smoke

Rama `claude/audit-sec-p0-s7-71a-smoke-fix` sobre `a2aa77a`. Alcance exacto:
`scripts/_smoke-s7_71a.mjs`, `scripts/check-s7_71a.mjs`,
`docs/OWNER_S7_71A_APPLY.md` y este handoff. **No** toca la migración, el
rollback, `src/`, tipos ni configuración.

Las seis correcciones —resolución del médico QA por atributos estables,
reserva contra el médico QA con snapshot y restauración, denylist de objetos
permanentes, `booking_intents` sin `created_by`, inventario fail-closed y
cobertura del check— están descritas en `docs/OWNER_S7_71A_APPLY.md` §5-bis.

### ✅ Hecho — DEV: nuevo `--preflight` (read-only, autorizado)

Ejecutado el **2026-08-06** sobre `HEAD ad3c67a`, con la atestación manual
vigente del owner (`s771a0805a` / `2026-08-06`) aplicada **solo** a las tres
identidades sintéticas `8800–8802`. Resultado: **54 OK, 0 fallos · exit 0 ·
VEREDICTO APTO**. Nada se escribió.

```
ASP0_PREFLIGHT_FINGERPRINT=b064680380bff7eff3db6b3c215f9b6748416ca27524837d7282d9dbbf5361bb
```

- Manifiesto **v6**, con los cinco UUID del médico QA **resueltos** por
  atributos estables (no hardcodeados) y el `slug` confirmado.
- Baseline del médico QA: **19/19**, incluido `booking_enabled = false`.
- Colisiones: **ninguna**, ni en Auth ni en tablas. La identidad QA se
  reconoció como **persistente y esperada**, no como colisión.
- Inventario de Auth: **sigue incompleto** — `listUsers(page=3)` falla con
  `Database error finding users` tras dos páginas sanas (`total=140`,
  `lastPage=3`, 100 ids recogidos). El total subió de 139 a 140 por el propio
  `auth.user` del médico QA. La atestación del owner cubre el hueco **solo**
  para esas seis identidades; el manifiesto lo registra como
  `auth_inventory_complete: false`.

### ✅ Hecho — DEV: corrida del smoke y limpieza de sus residuos

Ver §5-bis: auditoría **73 OK**, dos de los tres gates cerrados, seis residuos
limpiados con autorización puntual y **cero residuos verificado**.

### ⏳ En curso — DEV: PR correctivo del CLEANUP

Rama `claude/audit-sec-p0-s7-71a-cleanup-fix` sobre `bb36364`. Corrige el orden
de borrado y la captura de `auth_creation_grants`
(`docs/OWNER_S7_71A_APPLY.md` §5-ter).

**Checksums vigentes en esa rama:**

```
migration_sha256 = 1e9ec409cc6cfbe4547067b8fd8f2bca7c58082a5024dec6e84f6052e3047af0   ← SIN CAMBIOS
rollback_sha256  = b36f8f757749b36cb622f6bfd637a5bd7893f87c4eff8f041ed1c01f4bd53b5e   ← SIN CAMBIOS
smoke_sha256     = 565848cff5762e40502cab72c092e417b628669294a85a3b10fe2725771197b8   ← NUEVO
                   (anterior: a2d306448507437f74dd1747ebc86d62ba26f33e67075b3df9dc85fa09fabb66)
```

**Preflight nuevo** (read-only, autorizado, 2026-08-06): **54 OK, 0 fallos,
exit 0, VEREDICTO APTO**. Misma atestación manual, limitada a `8800–8802`; el
médico QA `8803` se resolvió como identidad **persistente esperada**, no como
colisión. Baseline QA **19/19**. La huella v6 anterior queda **invalidada**:

```
ASP0_PREFLIGHT_FINGERPRINT=33c71f583d46d429ce0669df9e916f4728ede98dfb5ce99086ba01ce9cf44988
```

### ⏳ En curso — PR del helper de DELETE (`count: 'exact'`)

Rama `claude/audit-sec-p0-s7-71a-cleanup-count-fix` sobre `51e2dbb`
(`docs/OWNER_S7_71A_APPLY.md` §5-quater).

```
migration_sha256 = 1e9ec409cc6cfbe4547067b8fd8f2bca7c58082a5024dec6e84f6052e3047af0   ← SIN CAMBIOS
rollback_sha256  = b36f8f757749b36cb622f6bfd637a5bd7893f87c4eff8f041ed1c01f4bd53b5e   ← SIN CAMBIOS
smoke_sha256     = 93c684347681a6dc11fbdbebbba01922030794757a09afa581d4b9958786c963   ← NUEVO
ASP0_PREFLIGHT_FINGERPRINT=eb6369dba4f599b7a40d2e5c06d792d28947e3c6ae9cded828dd1d1b711b4bce
```

Preflight read-only autorizado: **54 OK, 0 fallos, APTO**. Baseline QA 19/19.

### Siguiente — con autorización explícita del owner

1. Mergear el PR del helper de DELETE.
2. Corrida `--run` nueva con la huella nueva.
3. Cerrar el gate que falta: **cero residuos por sí misma**.
4. **Solo entonces**, diseñar `s7_71b`.

### Autorizaciones pendientes

- Mergear el PR correctivo del cleanup
- Ejecutar `--run` de nuevo
- Abrir `s7_71b`
- Documentar en `CLAUDE.md` el checklist bloqueante de §9

### Lo que NO debe ejecutarse

- ❌ El rollback de `s7_71a`
- ❌ `s7_71b`
- ❌ TWILIO-P0
- ❌ El smoke o el preflight sin autorización puntual
- ❌ SQL sobre `auth.users`
- ❌ Borrar el médico QA, su clínica, su credencial o su `auth.user`
- ❌ Cualquier otro frente

---

## 11. Evidencia — qué está verificado y qué no

**Verificado en producción por el owner:** aplicación de `s7_71a` · §4.1–§4.4 ·
la fase administrativa del médico QA · ACL y policies de `audit_log` y de la
secuencia · `rolbypassrls` · FKs de `profiles` · `handle_new_user` ·
`slot_duration_min integer NOT NULL DEFAULT 30`.

**Verificado por el dev con `service_role` read-only:** estado del médico QA
antes y después del claim · cero residuos del smoke · catálogo de ubicación
(`LI` / `LI-21`) · colisiones de la identidad QA.

**Ejecutado por el dev con autorización puntual:** creación del `auth.user` QA
(Admin API) · `submit_affiliation_request` (anon) · sesión QA
(`generateLink` + `verifyOtp`) · `claim_doctor_profile` · la única corrida del
smoke.

**NO verificado — inferencias del repositorio, no medidas en producción:**
definiciones reales de `claim_doctor_profile`, `submit_affiliation_request`,
`admin_affiliation_preflight`, `admin_approve_and_create_doctor`,
`admin_update_doctor_info`, `admin_update_doctor_clinic`,
`admin_set_doctor_published`, `admin_set_doctor_operational` y
`admin_create_service` · triggers reales de `profiles` ·
`audit_profiles_identity_fn` real · ausencia de efectos externos
(`pg_net`, `http`, `NOTIFY`, `pg_cron`, webhooks): **cero coincidencias en
migraciones**, pero podrían existir objetos no versionados.

**Pendiente y no probado:** el comportamiento del trigger en cambio de estado,
reprogramación, cancelación, merge/unmerge, update irrelevante y `service_role`.
**Solo la sección 1 (walk-in) está demostrada.**

**Este documento no contiene** secretos, tokens, `service_role`, OTP ni claves.

---

## 12. Cómo arrancar en una ventana nueva

```bash
git fetch origin --prune
git checkout main
git pull --ff-only origin main
git log --oneline -10
```

Leer, en este orden:

1. `CLAUDE.md` (guía rápida; si contradice a `docs/`, mandan los `docs/`)
2. **Este handoff** — fuente canónica del estado
3. `docs/OWNER_S7_71A_APPLY.md` — aplicación, verificación, gate y bloques
   owner-only (`db_direct`, `context_rejected`, firma de consulta)
4. `docs/HISTORIAL_FRENTES.md` — detalle por PR de frentes cerrados

**INSTRUCCIÓN 0:** no iniciar ningún frente sin instrucción del owner. El frente
abierto es **AUDIT-SEC-P0** y el próximo paso está en §10.
