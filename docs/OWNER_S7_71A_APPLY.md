# OWNER — aplicación de `s7_71a` (AUDIT-SEC-P0 · PR 1)

> **Qué es.** Primer PR del frente AUDIT-SEC-P0. Añade la auditoría
> **server-side** de `appointments`, que antes no existía. **No cierra** la
> vulnerabilidad de `audit_log` — eso es `s7_71b`.

---

## 🟢 ESTADO: `s7_71a` CERRADA Y VALIDADA (2026-08-07)

**Decisión del owner.** La migración **`s7_71a` no requiere más pruebas**, y su
**instrumento queda también CERRADO**.

**Corrida final de referencia** — `HEAD ccfa8ec0ecb77daecfb4aec1c520015f749ee506`:

```
inicio                    2026-08-07T03:39:32.450Z
final                     2026-08-07T03:40:09.212Z   (37 s)
EXIT CODE                 0
resultado                 76 OK · 0 fallos · 0 errores de cleanup
RESIDUOS DE FIXTURES      0
CLEANUP MANUAL POSTERIOR  NO
actividad externa         0
```

**Los tres gates cerrados:** `cancel_my_appointment` produce exactamente una
fila · `notes` e `internal_notes` quedan fuera de `audit_log` · cero residuos de
fixtures, sin intervención manual.

**Instrumento:** `primary` borra la regla temporal con 1 fila exacta;
`defensive` reporta `ALREADY_GONE` con 0; los trece counts del cleanup
coincidieron con lo esperado; el inventario de las 16 categorías terminó en 0.

**Checksums y huella utilizados:**

```
migration_sha256 = 1e9ec409cc6cfbe4547067b8fd8f2bca7c58082a5024dec6e84f6052e3047af0
rollback_sha256  = b36f8f757749b36cb622f6bfd637a5bd7893f87c4eff8f041ed1c01f4bd53b5e
smoke_sha256     = 129de64b860dece8f2736c7e00c5ae4552ff2a38ae0b9cebe5ca47a5166ce3cb
ASP0_PREFLIGHT_FINGERPRINT=e02ad689ba2633639d30fdd1d827d0ccc4875e5b0f74c2c1f67b4c0fa79a8c7c
```

Los dos primeros son los mismos desde que se aplicó la migración: **ninguno de
los cuatro PR del instrumento tocó la migración ni su rollback.**

**Estado final del médico QA:** `is_published=true` · `is_operational=true` ·
`booking_enabled=false` · `availability_rules=0` · `appointments=0` ·
`booking_intents=0` · `patients` de su clínica `=0` · sus dos servicios
permanentes intactos.

**`audit_log` 14437–14439:** conservadas e intactas. No son residuos de
fixtures y siguen bajo la decisión de conservación documentada en el handoff.

> ⛔ **NO repetir el smoke ni el preflight.** `s7_71a` está cerrada. Solo con
> una decisión explícita y separada del owner en el futuro.

> ⚠️ **AUDIT-SEC-P0 SIGUE ABIERTO.** La **escritura arbitraria sobre
> `audit_log` continúa en producción** (§4.1 del handoff). Próximo frente
> candidato: **`s7_71b`** (§8 de esta guía), **BLOQUEADA hasta autorización
> separada del owner**.

Lo que sigue de este documento es la referencia operativa e histórica: cómo se
aplicó, cómo se verificó y los cinco defectos del instrumento que se corrigieron
por el camino (§5-bis a §5-quinquies).

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

El smoke de comportamiento (`scripts/_smoke-s7_71a.mjs`) **no se autoejecuta** y
tiene **tres modos**. El flujo obliga a que autorices las identidades antes de
que se escriba nada:

**Paso 1 — preflight (read-only, no escribe ni llama ninguna RPC):**

```bash
ASP0_RUN_ID=<id> node scripts/_smoke-s7_71a.mjs --preflight
```

`<id>`: 4–12 caracteres `[a-z0-9]`. Imprime:

- las **tres identidades exactas** que usaría `--run`;
- la **lista canónica normalizada** de teléfonos prohibidos y su cantidad;
- el **inventario exhaustivo de Auth** (páginas, `perPage` solicitado vs
  servido, `total`, `lastPage`, ids únicos) y si es **demostrablemente completo**;
- el **manifiesto** de la corrida;
- y, solo si todo pasa, la huella:

```
ASP0_PREFLIGHT_FINGERPRINT=<sha256>
```

Si hay colisión, metadata ausente o inconsistente, o el inventario no es
demostrablemente completo, **no emite huella** y `--run` queda bloqueado.

**Paso 2 — revisá y autorizá** las tres identidades y el manifiesto.

**Paso 3 — corrida (escribe):**

```bash
ASP0_RUN_ID=<id> ASP0_SMOKE_AUTHORIZED=1 \
ASP0_PREFLIGHT_FINGERPRINT=<sha256> \
  node scripts/_smoke-s7_71a.mjs --run
```

Antes de la primera escritura reconstruye el manifiesto, compara la huella y
**repite** las comprobaciones de colisión. Aborta si cambió el proyecto, la
migración, una identidad o un catálogo.

**Teléfonos sintéticos** (fijos, consecutivos, dentro del espacio `5037000xxxx`
que ya usa LucyCare, verificados libres en todo el repositorio):

```
50370008800   50370008801   50370008802
```

**No los uses para nada más.** Al ser fijos, dos corridas simultáneas
colisionan — es deliberado: el preflight lo detecta y falla cerrado en vez de
inventar números nuevos en silencio.

### Teléfonos prohibidos — seis categorías

`FORBIDDEN_PHONES` es la **unión normalizada** de seis listas separadas.
**79 entradas crudas → 77 únicas** tras normalizar (se deduplican Camilo, que
está en dos categorías, y `77316374`, que es la forma sin prefijo de
`50377316374`).

| Categoría | Cantidad | Qué es |
|---|---|---|
| `ACTIVE_SUPABASE_TEST_PHONES` | **11** | Test Phones **activos**, verificados por vos en el panel |
| `REAL_OR_DEMO_PHONES` | 2 | Katherine (dato real) y Camilo (cuenta demo) |
| `HISTORICAL_OR_RESERVED_PHONES` | 6 | históricos y reservados — **no** activos |
| `PRIOR_FIXTURE_PHONES` | 54 | fixtures de smokes previos en `5037000xxxx` |
| `DOC_PLACEHOLDER_PHONES` | 5 | placeholders de documentación |
| `QA_PERSISTENT_PHONES` | **1** | `50370008803` — el médico QA **permanente** |

> La categoría `QA_PERSISTENT_PHONES` no impide **leer** al médico QA: la
> guarda `assertNotForbidden` solo se aplica a los teléfonos que la corrida va
> a **crear**. Lo que impide es que ese número acabe convertido en una fixture
> desechable y, con ella, en candidato a `deleteUser`.

**Los 11 activos:**

```
50378627694  50378056365  50378873634  50378590126  50375000001  50375000099
50378626108  50377507479  50377316374  50376193396  50370007201
```

`--preflight` imprime cada categoría por separado con su cantidad, más el total
crudo, el normalizado y cuántas se dedujeron.

> ⚠️ **La lista activa no se deriva del repositorio.** Seis de los once **no
> aparecen en el código**: vienen de *Supabase → Auth → Test Phone Numbers*.
> **Si agregás o quitás un Test Phone en Supabase, hay que actualizar
> `ACTIVE_SUPABASE_TEST_PHONES` en el smoke.** Un grep "limpio" no prueba nada,
> y el código no puede detectar el cambio por sí solo.
>
> El **OTP fijo** asociado a los Test Phones **no se documenta ni se guarda** en
> el repositorio. El check verifica su ausencia en el smoke, en la migración y
> en esta guía.

### Huella del manifiesto

El manifiesto es **completamente plano** —sin objetos anidados— y se serializa
con `stableStringify`, que ordena recursivamente las claves y conserva el orden
de los arrays.

> ⚠️ Nota técnica: **no** se usa `JSON.stringify(obj, Object.keys(obj).sort())`.
> Ese replacer en forma de array filtra por nombre en **todos** los niveles, así
> que las claves de un objeto anidado que no coincidan con las de primer nivel
> se descartan en silencio. Con el manifiesto anidado anterior, los ids de
> estado **quedaban fuera del hash**. Está corregido y cubierto por pruebas.

Campos (manifiesto **v6**): `project_host` · `migration_version` ·
`migration_sha256` · `smoke_sha256` · `run_id` · `specialty_id` ·
`programada_status_id` · `confirmada_status_id` · `cancelada_status_id` ·
`cancel_reason_id` · **`qa_profile_id`** · **`qa_doctor_id`** ·
**`qa_clinic_id`** · **`qa_service_first_visit_id`** ·
**`qa_service_follow_up_id`** · `email_0..2` · `phone_0..2` · estado del
inventario de Auth y de la atestación.

---

## 5-bis. Arquitectura corregida del smoke (post corrida fallida del 2026-08-06)

La única corrida ejecutada falló en la **sección 2** con
`register_booking_intent: Ese horario no está disponible`. **No era un defecto
de `s7_71a`**: era del instrumento. Las fixtures creaban médicos con los
defaults conservadores (`is_published`, `booking_enabled` e `is_operational`
los tres en `false`) y `validate_booking_slot` (`s7_66:105`) los rechaza con
`P009C`. El código de producción se comportó correctamente.

Estas son las seis correcciones.

### 1. El médico QA persistente se RESUELVE, no se hardcodea

La sección de reserva usa el **médico QA permanente** —publicado, operativo y
con dos servicios activos—, que es el único capaz de pasar
`validate_booking_slot`.

Se resuelve exigiendo **exactamente una cadena**:

```
auth.user → profile → doctor → clinic → 2 services
```

Las entradas son **identificadores estables**, nunca UUID: teléfono
`50370008803`, correo `asp0.qa.doctor@lucycare.test`, `full_name` exacto,
`user_metadata.fixture = S7_71_QA_DOCTOR`, nombre exacto de la clínica y los
dos nombres de servicio. `getUserById(profile.id)` verifica correo, teléfono y
metadata contra la Admin API.

Cada eslabón exige **una sola fila**: cero y dos son el mismo fallo, porque en
ambos casos no se puede afirmar sobre qué fila se opera.

> El check verifica que **no exista ningún literal UUID** en el smoke, con la
> única excepción del centinela `00000000-…` de `user_id`.

**Baseline exigido antes de tocar nada** (bloqueante del preflight):
`role='doctor'` · `lucy_status='claimed'` · `is_published=true` ·
`is_operational=true` · **`booking_enabled=false`** · exactamente 2 servicios
con las ramas `is_first_visit` true/false · `availability_rules=0` ·
`appointments=0` · `booking_intents=0` · `availability_overrides=0`.

Los UUID **resueltos** entran al manifiesto y por tanto al fingerprint: si
mañana el médico QA fuera otro, `--run` aborta antes de escribir.

> La identidad QA es **persistente y esperada**: encontrarla **no** es una
> colisión. Las colisiones se siguen buscando solo para las tres identidades
> sintéticas `8800–8802`.

### 2. Secuencia de la reserva

1. releer `booking_enabled` y **abortar si ya es `true`** (estado base corrupto
   u otra corrida en curso);
2. snapshot;
3. crear **una sola** `availability_rule` temporal;
4. capturar su `ruleId` exacto;
5. `slot_duration_min = 30` **explícito** (no se confía en el DEFAULT);
6. activar `booking_enabled`;
7. `register_booking_intent` → capturar `intentId`;
8. `create_booking_with_intent` → capturar `appointmentId`;
9. **restaurar y borrar la regla en el `finally` local**, no al final de la
   corrida: la ventana en que un médico **publicado en producción** acepta
   reservas dura segundos, no toda la corrida. El cleanup global lo repite y
   lo verifica;
10. verificar `booking_enabled=false` y **cero** reglas del médico QA.

**Horario:** un **único literal local** `YYYY-MM-DDTHH:mm:ss`. De ese mismo
literal salen `p_start_local`, `day_of_week`, `start_time` y `end_time`.
Prohibido `toISOString().replace('Z','')`: toma un instante UTC y lo hace pasar
por hora local, y con UTC-6 eso desplaza el slot seis horas, pudiendo cambiar
día, `day_of_week` y fase de la grilla a la vez. El slot es **+3 días, 10:00**,
con la regla cubriendo 10:00–12:00 (fase 0, alineada, sin cruce de medianoche).

### 3. Denylist de objetos permanentes

El `auth.user`, el profile, el médico, la clínica y los **dos servicios** del
médico QA están en denylist. `assertNotPermanent` **lanza** —no filtra en
silencio— antes de cada borrado y antes de cada `deleteUser`, uno por uno.

> ⚠️ `profiles_id_fkey` es **ON DELETE CASCADE**: borrar el `auth.user` QA
> arrastraría profile y, en cascada, clínica y médico.

Lo **único** que la corrida puede modificar del médico QA es
`doctors.booking_enabled` y su `availability_rule` allowlisted. La regla se
borra **por `ruleId`**, jamás por `doctor_id`.

### 4. `booking_intents`

`created_by` **no existe** en esa tabla — el smoke anterior la usaba y por eso
el conteo fallaba. Ahora se captura el `intentId` exacto y se borra por
**allowlist de id**. `doctor_id`, `phone_e164` y `RUN_STARTED_AT` son
**defensas adicionales** para acotar la ventana de búsqueda, nunca criterio
suficiente para borrar.

**Actividad externa:** cualquier cita o intent del médico QA creado durante la
ventana y **fuera de la allowlist** se reporta y hace fallar la corrida, y
**nunca se borra** — sobre un perfil publicado en producción podría ser una
reserva real.

### 5. Inventario fail-closed

El inventario anterior devolvía `-1` ante un error y el acumulador hacía
`if (n > 0) residuals += n`: un `-1` no sumaba nada y la corrida imprimía
**«CERO residuos»** sobre una tabla que ni siquiera pudo consultar.

Ahora cada lectura produce `{ status: 'OK', count }` o
`{ status: 'ERROR', error }`. Un conteo desconocido:

- se **reporta** con su motivo;
- **impide** declarar cero residuos;
- fuerza **exit ≠ 0**;
- **no** interrumpe el resto del `finally`.

Un `getUserById` que falla tampoco prueba que el usuario se haya eliminado:
solo «not found» cuenta como eliminación.

### 6. Cobertura del check

`check-s7_71a.mjs` ejercita las funciones **puras reales** importadas del
smoke —`qaBaselineChecks`, `buildLocalSlot`, `assertNotPermanent`,
`countResult`, `summarizeInventory`, `partitionExternal`— con entradas
mutadas, además de las aserciones estructurales. **0 fallos** es el gate.

> Defecto encontrado al escribirlo: varios tramos se aislaban con
> `between(codigo, …, '\n}\n')`. Los archivos del repo están en **CRLF**, así
> que ese delimitador no casa nunca y `between` devolvía **el resto del
> archivo** — una aserción negativa sobre ese tramo parecía pasar mientras
> miraba código ajeno. Los tramos ahora se cierran por el **nombre de la
> función siguiente** y se exige que **no estén vacíos**.

---

## 5-ter. Orden de borrado del cleanup (corrección posterior a la corrida)

La corrida del 2026-08-06 **pasó las diez secciones de auditoría** (73 OK,
incluida la sección 2 y el gate de `cancel_my_appointment`) pero **falló el
cleanup** y dejó **seis residuos** en producción, borrados después con una
limpieza controlada. Dos defectos, ambos del instrumento.

### Defecto 1 — el orden era el inverso a la cadena de FKs

```
auth_creation_grants.booking_intent_id   → booking_intents
booking_intents.consumed_appointment_id  → appointments
appointments.patient_id → patients   ·   appointments.service_id → services
patients.profile_id → profiles       ·   profiles.id → auth.users
```

El cleanup borraba de atrás hacia adelante y **funcionaba por accidente**: al
borrar los médicos sintéticos, sus citas se iban por **cascada** y el `DELETE`
explícito de `appointments` nunca tenía que funcionar de verdad.

El médico QA **no se borra jamás**, así que su cita no tuvo cascada que la
arrastrara: sobrevivió y bloqueó en dominó al intent, al servicio, a la ficha
de paciente, al profile y al `auth.user`.

**Regla vinculante ahora:** no depender de **ninguna** cascada. Cada
dependencia se borra explícitamente, **por id exacto**, antes que aquello de lo
que depende. Orden fijado y verificado por el check:

```
1. appointment_patient_cancellations (y dependencias de consulta)
2. auth_creation_grants      ← por grantId
3. booking_intents           ← por intentId
4. appointments              ← por appointmentId
5. patients                  ← por patientId
6. availability_rules · services  ← por id
7. doctors · clinic_members · clinics
8. profiles · auth.users (Admin API)
```

### Defecto 2 — `auth_creation_grants.issued_by` no es un uuid

Es **texto**, y guarda el nombre de la RPC que lo emitió
(`'register_booking_intent'`). El cleanup borraba `.in('issued_by', ids.users)`:
**cero filas**, reportado como éxito. Y el inventario contaba con el mismo
criterio, devolviendo `0`. El grant sobrevivía **siendo invisible**.

Es exactamente el mismo defecto que `booking_intents.created_by`, en una
columna distinta. Ahora los grants se capturan por **`booking_intent_id`** justo
después de crear el intent, se borran por **`grantId` allowlisted**, y el
inventario los cuenta **dos veces**: por id exacto y por relación
(`booking_intent_id ∈ intentIds`), de modo que un grant que existiera sin haber
sido capturado igual aparece.

Si la captura de grants falla, el inventario registra
`auth_creation_grants (captura fallida)` como **DESCONOCIDO** y la corrida no
puede declarar limpieza.

### Otras garantías añadidas

- Cada `DELETE` reporta **cuántas filas borró** (`.select('id')` sobre el
  builder): un borrado parcial deja de ser indistinguible de uno completo.
- **Todos** los criterios de borrado del cleanup son allowlists de ids
  exactos. Ya no queda ninguno por `doctor_id`, `clinic_id` ni `profile_id`, y
  el check lo verifica sobre el texto real.
- El inventario final cuenta por `grantIds`, `intentIds`, `appointmentIds`,
  `patientIds`, `profileIds`, `memberIds`, `ruleIds`, `serviceIds` y
  `authUserIds`.

> **A/B del instrumento:** el check corrido contra el smoke anterior —el que
> dejó los residuos— produce **27 fallos**, entre ellos «grant ANTES que
> intent» e «intent ANTES que appointment». No es acoplamiento: es
> discriminación real del defecto.

---

## 5-quater. El helper de DELETE no puede asumir la columna `id`

La corrección de §5-ter arregló el **orden**, pero introdujo un defecto nuevo.
Para detectar borrados parciales, el helper hacía `.select('id')` sobre el
builder del `DELETE`, y eso **asume que toda tabla tiene columna `id`**.

**`appointment_patient_cancellations` no la tiene**: su clave es
`appointment_id`. PostgREST rechazó la consulta, el borrado **no se ejecutó** y
la fila superviviente bloqueó por FK a citas, pacientes, servicios, médicos,
clínica, perfiles y usuarios de Auth. **23 residuos en producción**, limpiados
después con una limpieza controlada.

La corrida en la que ocurrió **pasó las diez secciones funcionales** (74 OK):
el fallo fue exclusivamente del cleanup.

### La corrección

**1. `.delete({ count: 'exact' })`** devuelve cuántas filas se borraron **sin
seleccionar ninguna columna**. Validado contra la versión de `supabase-js` del
proyecto durante la limpieza manual de los 23 residuos: los siete borrados
devolvieron el `count` exacto esperado.

**2. `CLEANUP_TARGETS`** declara la columna de filtro REAL de cada tabla, y es
la única fuente de la verdad:

| Tabla | Columna | ¿Tiene `id`? |
|---|---|---|
| `appointment_patient_cancellations` | **`appointment_id`** | **no** |
| el resto (`appointments`, `patients`, `services`, `doctors`, `clinics`, `profiles`, `booking_intents`, `auth_creation_grants`, `availability_rules`, `clinic_members`, `consultations`) | `id` | sí |

`cleanupColumnFor(tabla)` **lanza** si la tabla no está declarada: ninguna se
borra adivinando su columna.

**3. El helper recibe explícitamente** tabla y allowlist; la columna la resuelve
`CLEANUP_TARGETS`. Cuenta **antes** de borrar para poder comparar.

**4. `deleteVerdict()`** —pura y exportada— clasifica el resultado:

| Estado | Cuándo | ¿Éxito? |
|---|---|---|
| `OK` | borradas == existentes | sí |
| `PARTIAL` | borradas < existentes | **no** |
| `UNKNOWN` | `count` no numérico, o no se pudo contar antes | **no** |
| `ERROR` | el `DELETE` falló (p. ej. FK) | **no** |

Comparar contra las filas que **existían** —y no contra el tamaño de la
allowlist— es deliberado: una cascada legítima puede haberse llevado alguna
antes. Ocurrió: al borrar un `auth.user` sintético, su profile, su médico y una
cita cayeron por cascada.

Cualquier estado distinto de `OK` entra en `cleanupErrors` (exit ≠ 0) y el
`finally` continúa con las demás categorías.

> **A/B quirúrgico:** reintroduciendo **solo** `.select('id')` en el helper
> sobre el smoke corregido, el check dispara **4 fallos** que nombran la
> regresión: «ningún DELETE selecciona columnas para contar», «todos los DELETE
> usan `.delete({ count: 'exact' })`», «ningún DELETE inline usa `.select('id')`»
> y «todo DELETE del cleanup filtra por columna declarada». Además, el check
> comprueba contra `src/types/database.types.ts` que la tabla **realmente** no
> tiene columna `id` — la declaración no se cree a sí misma.

---

## 5-quinquies. Idempotencia de la regla temporal del médico QA

La corrida del 2026-08-07T03:19Z **cumplió los diez criterios de éxito**:
diez secciones funcionales, los tres gates de §4.4, inventario en cero y
ninguna intervención manual. Y aun así salió con **exit 1**.

`deleteQaTempRules()` se invoca **dos veces por diseño**:

1. en el `finally` local de la sección de reserva — la eliminación **real**;
2. al inicio del cleanup global — la **red de seguridad**, por si la corrida
   abortó antes de llegar al `finally` local.

La segunda no encuentra nada, que es exactamente lo correcto. Pero §5-quater
había endurecido la función a `count === 1` **sin contemplar que es
idempotente**, así que la red de seguridad **se denunciaba a sí misma**.

### La corrección

La función recibe ahora un **modo obligatorio**, y el veredicto vive en
`tempRuleDeleteVerdict()` —pura y exportada—:

| Modo | `0` filas | `1` fila | `>1`, `count` desconocido o error |
|---|---|---|---|
| `primary` (eliminación real) | ❌ `MISSING` | ✅ `OK` | ❌ fail-closed |
| `defensive` (red de seguridad) | ✅ `ALREADY_GONE` | ✅ `OK` | ❌ fail-closed |

Que `primary` siga exigiendo exactamente 1 no es ceremonia: si la regla no
estuviera donde debe, sería un **residuo sobre un médico publicado en
producción**.

> ⚠️ **La tolerancia a `0` está confinada a `tempRuleDeleteVerdict` y solo en
> modo `defensive`.** El helper general de DELETE **no** la comparte: para él,
> borrar 0 de N filas existentes sigue siendo `PARTIAL` y sigue fallando
> cerrado. El check verifica ambas cosas —que la tolerancia existe donde debe y
> que **no** se filtró a ninguna otra categoría del cleanup—, y que `ALREADY_GONE`
> aparece **una sola vez** en todo el archivo.

> **A/B quirúrgico:** forzando la red de seguridad de vuelta a `primary`, el
> check dispara «la red de seguridad del cleanup usa el modo `defensive`».
> Durante ese A/B, un `restore` mal anclado llegó a **intercambiar** los dos
> modos, y el check lo detectó en la corrida siguiente — el instrumento
> haciendo su trabajo sobre su propio mantenimiento.

**Nunca** incluye `SUPABASE_SERVICE_ROLE_KEY`, la anon key ni tokens: solo el
*hostname* derivado de `SUPABASE_URL`.

**Dos checksums, no uno.** El manifiesto lleva `migration_sha256` **y**
`smoke_sha256`:

| Campo | Cubre |
|---|---|
| `migration_sha256` | `migrations/s7_71a_audit_appointments_coverage.sql` |
| `smoke_sha256` | `scripts/_smoke-s7_71a.mjs` — el propio script |

Ambos se calculan sobre el contenido **normalizado a LF**, no sobre el binario:
en Windows el checkout deja CRLF y en Linux LF, y hashear el binario daría
huellas distintas para el mismo archivo según la máquina. Los dos usan la misma
función, y se recalculan desde el archivo real en `--preflight` y en `--run`.

> El `smoke_sha256` existe porque la huella protegía la migración pero **no el
> código que la ejercita**: una corrección del flujo podía cambiar el
> comportamiento sin mover la huella. Ahora **cualquier edición del smoke la
> invalida**.

**El HEAD de git se imprime pero NO entra en la huella**: un squash-merge cambia
el SHA aunque el contenido sea idéntico. La vinculación funcional son los dos
checksums.

### Atestación manual del owner — excepción controlada

`auth.admin.listUsers` falla en `page=3` con `perPage=50` en este proyecto
(`Database error finding users`), tras dos páginas sanas y con metadata
coherente: `total=139`, `lastPage=3`. Sin ese tramo **no se puede demostrar por
API** que las identidades candidatas estén libres.

El comportamiento **por defecto sigue siendo fail-closed**: sin inventario
demostrable, el preflight aborta con exit 1 y no emite huella.

La excepción exige las **tres variables simultáneamente**, con valores exactos:

```bash
ASP0_OWNER_AUTH_ATTESTED=1
ASP0_OWNER_AUTH_ATTESTED_DATE=2026-08-06
ASP0_OWNER_AUTH_ATTESTED_RUN_ID=s771a0805a
```

**Alcance estricto.** Solo aplica al `RUN_ID` `s771a0805a` y a las seis
identidades autorizadas. El hash canónico de esas seis se recalcula en cada
corrida y debe coincidir con el atestado: cambiar un correo, un teléfono o el
`RUN_ID` **invalida la atestación**. No se puede reutilizar.

**No equivale a un inventario completo.** El manifiesto lo registra tal cual:

```
auth_inventory_complete       = false
auth_verification_mode        = owner_manual_exact_search
auth_users_inspected          = 100
auth_total_announced          = 139
auth_failed_page              = 3
owner_attested_no_collisions  = true
owner_attested_date           = 2026-08-06
owner_attested_identities_sha256 = <sha256 de las seis>
```

Los ocho campos **forman parte de la huella**: si el modo de verificación
cambia, la huella cambia.

**Cualquier colisión real prevalece sobre la atestación.** Con atestación válida
se siguen ejecutando —y cualquier fallo aborta igual— la búsqueda de colisiones
sobre los usuarios que sí se recuperaron, las lecturas en `profiles`,
`patients`, `clinics`, `services`, `doctors`, `clinic_members`, `appointments`,
`booking_intents` y `auth_creation_grants`, la validación de catálogos y la de
checksums, proyecto e identidades.

`--run` exige **la misma atestación** además del fingerprint aprobado.

> La atestación registra que el owner verificó a mano en *Authentication →
> Users* la ausencia exacta de las seis identidades el **2026-08-06**. Es
> evidencia humana trazable, no una demostración por API. Queda anotada en el
> manifiesto para que cualquiera que lea la huella sepa bajo qué régimen se
> aprobó la corrida.

---

## 6. GATE — condición para abrir `s7_71b`

**`s7_71b` no se abre si alguna de estas falla:**

- [ ] `check-s7_71a.mjs` → 0 fallos
- [ ] 4.1 — trigger existe y habilitado
- [ ] 4.2 — `SECURITY DEFINER`, `search_path` fijado, EXECUTE revocado
- [ ] 4.3 — `cancel_my_appointment` sin `INSERT` manual, con contexto, validaciones intactas
- [ ] 4.4 — privilegios de `audit_log` **sin cambios**
- [ ] `--preflight` con inventario de Auth **demostrablemente completo** y huella emitida
- [ ] Identidades sintéticas del preflight **autorizadas por vos**
- [ ] Smoke autorizado: **una sola fila** por cancelación
- [ ] Smoke autorizado: `notes` e `internal_notes` **ausentes** de la auditoría
- [ ] Smoke autorizado: **cero residuos** de fixtures

---

## 7. Rollback

```
docs/rollbacks/s7_71a_rollback.sql
```

> ⚠️ **Vive FUERA de `migrations/` a propósito.** Dentro de ese directorio
> ordenaba inmediatamente después de su forward
> (`s7_71a_audit_appointments_coverage.sql` → `s7_71a_rollback.sql`) y cumplía
> el mismo patrón de nombre `s7_*`, así que cualquiera que aplicara "las
> pendientes en orden" —o una automatización futura que filtrara por ese
> patrón— habría ejecutado la cobertura y acto seguido la habría deshecho, sin
> error visible: ambas terminan en `COMMIT`. **Este archivo no debe aplicarse
> nunca en secuencia; solo a mano y a propósito.**
>
> Nota: el encabezado de la migración forward todavía lo referencia por su
> ruta anterior (`migrations/s7_71a_rollback.sql`). Es un comentario obsoleto
> y **deliberado**: corregirlo cambiaría el `migration_sha256` e invalidaría
> el fingerprint ya aprobado. La ruta correcta es la de arriba.

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
