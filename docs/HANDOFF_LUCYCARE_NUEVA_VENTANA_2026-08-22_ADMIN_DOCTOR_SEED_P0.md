# HANDOFF LucyCare — nueva ventana (2026-08-22) · ADMIN-DOCTOR-SEED-P0

> 🟢 **PUNTO DE ENTRADA CANÓNICO Y VIGENTE.** Autosuficiente: no asume que la
> ventana nueva conozca ninguna conversación anterior. Reemplaza a
> `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-20.md`, que pasa a **histórico**
> junto con todos los anteriores.
>
> ⚠️ **Hay UN frente funcional ABIERTO: `ADMIN-DOCTOR-SEED-P0`, en PR #348.**
> Es la diferencia principal con el handoff anterior, que cerraba con cero
> frentes abiertos. El estado general del producto (piloto = GO, Auth, Booking,
> Twilio, Turnstile, Legal, identidades) **no cambió**: sigue descrito en el
> `2026-08-20`, que se conserva por eso.
>
> 📍 **Estado en una línea (2026-08-23):** Edge Function **desplegada y `ACTIVE`
> (v2)** pero **jamás invocada** · **`s7_73` NO aplicada** · **0 perfiles
> sembrados** · PR #348 **abierto, sin mergear**. El **Paso 1 del rollout está
> completado**; la siguiente acción **no está autorizada**. Detalle en la **§J**.
>
> **Este documento no contiene** OTPs, contraseñas, tokens, `service_role`,
> claves ni enlaces con credenciales.

---

## A. Estado Git

| Ítem | Valor |
|---|---|
| **PR** | **[#348](https://github.com/amedelvalle/lucycare/pull/348) — OPEN, `MERGEABLE`, NO mergeado** |
| Rama | **`claude/seed-doctor`** |
| **HEAD de la rama** | **`ee5d08d6c4a8b71596fd0f59c782e22896dbcf6a`** — EDGE-SECRET-KEY-MIGRATION |
| **`main`** | **`828b021946bf1c7b8ce218bd8dae54ff160a856e`** — sin tocar |
| Migraciones en el repo | **94 archivos** |
| **Migraciones aplicadas en producción** | **93** — hasta `s7_72_review_token_short_code.sql` |
| **`s7_73`** | existe en el repo, **NO aplicada** |
| **Edge Function** | **DESPLEGADA — `ACTIVE`, versión 2** (2026-08-23). **Nunca invocada** |
| Perfiles sembrados creados | **ninguno** |
| Escrituras pendientes por Admin API | **ninguna** |
| `_smoke-s7_73.mjs` | implementado, **NO ejecutado** |
| Rollback `docs/rollbacks/s7_73_rollback.sql` | preparado, **NO ejecutado** |

Commits de la rama, del más nuevo al más viejo:

```
ee5d08d  fix(admin): la Edge usa la secret key moderna, no las legacy API keys
1f07e6a  docs: handoff de contexto de ADMIN-DOCTOR-SEED-P0 (PR #348)
b885764  fix(admin): correcciones de la auditoria final
4fddbf3  fix(admin): terminar la operacion antes del borrado compensatorio (TOCTOU)
21bf2b0  fix(admin): rotar la operation_id solo con evidencia de terminalidad
c778b0c  fix(admin): ciclo de vida correcto de la operation_id en el cliente
3d69f46  fix(admin): ownership del lease con lease_token
d08ebbb  fix(admin): payload con whitelist y transiciones verificadas
75c1098  feat(admin): ADMIN-DOCTOR-SEED-P0 — crear perfil medico sembrado
```

> Los commits **docs-only** no alteran nada de lo anterior. **Para el tip exacto,
> consultar Git: `git rev-parse HEAD`.**
>
> **El código desplegado de la Edge Function fue verificado byte a byte contra el
> del PR #348** (`functions download` a un directorio temporal + comparación de
> SHA-256): `033ad2c5…` en ambos lados, **idénticos**. Lo desplegado y lo que el
> PR propone son exactamente lo mismo.

---

## B. Objetivo funcional

**LucyAdmin crea por anticipado un perfil profesional de un médico, puede
publicarlo, y le envía la URL para que el médico lo reclame** con el Claim
existente. Es una herramienta de prospección comercial.

### Invariantes vinculantes

- **Jamás se crea una cuenta utilizable "en nombre del médico".**
- El `auth.user` técnico es **email `.invalid`, baneado, sin teléfono, sin
  contraseña, sin confirmar y sin PII**.
- `lucy_status = 'listed_only'`.
- **`booking_enabled = false`** — literal en la RPC, jamás parámetro.
- `is_operational = true` — para que el médico entre al panel tras el Claim
  **sin intervención de LucyAdmin**.
- **Publicación solo si cumple D1** (nombre + especialidad + clínica + dirección).
- **Sin `clinic_members` antes del Claim** — lo crea el Claim para la identidad real.
- **JVPM opcional** para sembrar y publicar; necesario para el Claim automático.
- **Teléfono de claim (privado, `profiles.phone`) separado del teléfono público
  de la clínica (`clinics.phone`)**. Nunca se copian entre sí.
- **El Claim vigente NO se modificó.** Cero cambios en `claim_doctor_profile`.

---

## C. Arquitectura final

```
LucyAdmin (SPA, anon key + JWT del admin)
      │  POST  Idempotency-Key: <operation_id>
      ▼
Edge Function  admin-create-seed-doctor
  1. valida Authorization: Bearer <JWT>            [JWT del admin]
  2. normaliza payload (whitelist) y calcula hash  [server-side]
  3. admin_claim_seed_operation                    [JWT] → is_admin() en la BASE
  4. admin_lookup_seed_user  (recuperación)        [JWT]
  5. auth.admin.createUser   (solo si no existía)  [secret key]
  6. admin_seed_operation_set_auth_created         [JWT]
  7. admin_create_seed_doctor                      [JWT] → profile+clinic+doctor+JVPM+audit
  ✗ compensación: mark_failed → deleteUser         [JWT] → [secret key]
      ▼
{ doctor_id, clinic_id, slug, is_published, claim_ready }
```

**Reparto de credenciales, invariante:**

- **La secret key moderna (`sb_secret_…`) se lee y se usa SOLO dentro de la Edge
  Function**, y **únicamente** en `auth.admin.createUser()` y
  `auth.admin.deleteUser()`.
- **Toda la lógica médica va con el JWT real del admin.** No es cosmético: así
  `auth.uid()` es válido y el trigger `audit_profiles_identity` (`s7_32`) puede
  escribir al actualizar `profiles.full_name`. **Con una credencial
  privilegiada, `auth.uid()` es NULL y ese trigger aborta la fila.**
- El gate `is_admin()` vive **en la base**, no en la función.
- **Ningún SQL escribe `auth.users`.** La migración solo la **lee**, en el lookup.

**Por qué existe la Edge Function:** `public.profiles.id` tiene
`FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE` —verificado en
el catálogo—, así que **un profile sin identidad Auth es imposible**. La fila
técnica se crea por Admin API, que exige una credencial privilegiada, y esa
credencial nunca puede vivir en el frontend. **No existía ningún contexto
servidor de confianza en el proyecto**: es la primera Edge Function y el primer
runtime Deno.

**Secretos:** ninguno que configurar a mano. El runtime alojado preaprovisiona
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` y `SUPABASE_SECRET_KEYS`.

> ⚠️ **La Edge NO usa las variables legacy `SUPABASE_ANON_KEY` ni
> `SUPABASE_SERVICE_ROLE_KEY`** (EDGE-SECRET-KEY-MIGRATION, 2026-08-23). Este
> proyecto tiene las **legacy API keys deshabilitadas**: esos JWT
> preaprovisionados existen, pero el gateway los **rechaza con 401** —medido—,
> así que leerlos era un **defecto que habría roto la función entera**, no una
> alternativa válida. La versión vigente lee las credenciales del **formato
> nuevo**, que el runtime entrega como **diccionarios JSON indexados por
> nombre**, y toma la entrada **`default`**:
> `SUPABASE_SECRET_KEYS` → `sb_secret_…` (privilegiada, solo Auth Admin API) y
> `SUPABASE_PUBLISHABLE_KEYS` → `sb_publishable_…` (cliente de negocio, que
> además viaja con el JWT del admin). El parseo es **fail closed**: si la
> variable falta, no parsea, no es un diccionario, no trae `default` o el valor
> no tiene el prefijo esperado, la request muere **antes** de construir cliente
> alguno y **ninguna escritura es posible**. **No hay fallback a las legacy.**

---

## D. AUTH-SEED-PROBE — ✅ PASS / CLOSED / **NO REPETIR**

Prueba real y acotada contra el Auth de producción (2026-08-22), autorizada de
forma excepcional, con **una identidad sintética creada y borrada**. Resultados,
todos medidos:

- **`auth.admin.createUser()` NO pasa por `hook_before_user_created`.** El
  camino administrativo no está sujeto al gate fail-closed.
- **No hacen falta `auth_creation_grants`.** El paso de emisión de grant se
  eliminó del diseño.
- El usuario `.invalid`, **sin phone, sin password y baneado**, se creó sin
  problemas.
- **`app_metadata` propia sobrevivió**: GoTrue **fusiona** sus claves
  (`provider`, `providers`) con las nuestras en vez de reemplazarlas.
- **GoTrue creó 1 fila en `auth.identities`** de provider `email` — a diferencia
  del `INSERT` por SQL del approve histórico, que no crea ninguna.
- **`handle_new_user` creó el profile** con `role='patient'` y **`full_name=''`**
  (la metadata se escribe *después* del INSERT), y `email` en NULL.
- **`deleteUser()` funcionó** y cascadeó el profile por la FK.
- **Cero residuos operativos**, verificado sobre `auth.users`, `profiles`,
  grants, `doctors`, `clinics`, `clinic_members` y `patients`.

> ⚠️ **No repetir la prueba.** Sus conclusiones son la base del diseño actual.

---

## E. `s7_73` — qué crea

**Un solo archivo**: `migrations/s7_73_admin_seed_doctor.sql`. Tabla + helper +
6 RPCs, en una transacción con guardas PRE y POST.

### `admin_seed_operations`

| Columna | Rol |
|---|---|
| `operation_id uuid PK` | **es la Idempotency-Key**; el `INSERT` sobre la PK es el cerrojo atómico |
| `requested_by` | sale de `auth.uid()`, nunca del navegador |
| `payload_hash` | hash del payload **normalizado**, calculado server-side |
| **`lease_token uuid`** | **ownership del intento**; se rota en el claim y en cada resume |
| `status` | `started` → `auth_created` → `completed` · `started`/`auth_created` → `failed` |
| `seed_user_id`, `doctor_id`, `clinic_id`, `error_code` | resultado |

**Terminalidad:** `completed` y `failed` **no se reabren nunca**.

> ⚠️ Los `CHECK` de la tabla validan la **forma** de cada estado, **no** la
> legalidad de las transiciones. Eso lo garantizan: (a) `authenticated` **sin
> DML directo** —solo `GRANT SELECT` y una policy de `SELECT` con `is_admin()`—
> y (b) las RPCs, que hacen compare-and-set bajo `FOR UPDATE`.

### Las 6 RPCs

| RPC | Rol |
|---|---|
| `admin_claim_seed_operation(uuid, text)` | reclamo atómico; lease de **120 s**; rota el token en cada resume; para `completed` devuelve el resultado real persistido |
| `admin_lookup_seed_user(uuid)` | recuperación determinista; **no es un buscador**: construye el email desde el `operation_id` y devuelve un UUID o NULL |
| `admin_seed_operation_set_auth_created(uuid, uuid, uuid)` | transición CAS; idempotente solo con el mismo UUID |
| `admin_seed_operation_mark_failed(uuid, text, uuid)` | transición CAS; conserva el primer `error_code` |
| `admin_seed_operation_flag_compensation_failed(uuid, uuid)` | **anota** `+compensation_failed` sobre una operación ya `failed`; no cambia `status` |
| `admin_create_seed_doctor(uuid, uuid, text, jsonb, uuid)` | transacción de negocio completa |

Todas: `SECURITY DEFINER`, `SET search_path` explícito, `REVOKE` de `PUBLIC` y
`anon`, `GRANT EXECUTE` solo a `authenticated`, **`is_admin()` como primera
instrucción**. `service_role` **no** recibe EXECUTE: no lo necesita.

Helper privado `_seed_doctor_email(uuid)` — sin grant para nadie.

### Recovery, concurrencia y duplicados

- **Recovery por email determinístico:** `seed-<operation_id>@doctor-seed.invalid`.
  `.invalid` está reservado por **RFC 2606**: no resoluble, sin MX posible, no
  registrable. **`listUsers` no se usa nunca** — evita la deuda conocida de
  enumeración del padrón.
- **Worker stale:** el lease por `updated_at` dice *cuándo* venció; el
  **`lease_token` dice quién lo tiene**. Rotarlo en el resume expulsa al worker
  viejo: al despertar, su token ya no coincide y **no puede completar, marcar ni
  compensar** (`P0132`).
- **Teléfono de claim duplicado:** `profiles.phone` **no tiene índice único** y
  no se agrega. La carrera se cierra con
  `pg_advisory_xact_lock(hashtextextended('seed_doctor_phone:' || …))` **antes**
  del check autoritativo y **antes** de cualquier escritura. Patrón vigente del
  repo (`s7_66`, `s7_69`).
- **JVPM duplicado:** lo bloquea el índice `doctor_credentials_registry_uniq`
  (`s7_61`); el `23505` se mapea a `duplicate_jvpm`.
- **Validación `auth_phone_e164`:** si se informa teléfono de claim, **debe** ser
  utilizable por Auth. `normalize_phone_sv` tiene una rama `ELSE` que acepta
  cualquier cadena de dígitos, pero el **hook** decide con `auth_phone_e164`, que
  devuelve NULL para lo que no encaje. Sin esta validación, un seed podía nacer
  **publicado e imposible de reclamar, en silencio**. Se rechaza con **`P0133`**.
- **`claim_ready`** usa **ese mismo criterio**: teléfono utilizable por Auth
  **+** JVPM presente. No "el campo vino informado", que daba falso positivo.

**Errores tipados:** `P0120`–`P0133`. Listados en la cabecera de la migración.

---

## F. Idempotencia y compensación

### Ciclo de vida de la `operation_id`

La política vive en **`src/services/seedOperationPolicy.ts`**, módulo **puro**
para poder probarlo tal cual. Es una **allowlist**: el default es **conservar**
la clave.

| Situación | Clave |
|---|---|
| Timeout · error de red · **`internal`** | **misma** |
| `in_progress` · `lease_lost` · `payload_mismatch` · `compensation_failed` | **misma** |
| Códigos previos al claim (`not_authenticated`, `not_admin`, `bad_request`) | **misma** |
| `previously_failed` | **nueva**, en el próximo envío |
| `duplicate_jvpm` · `duplicate_phone` · `d1_incomplete` · `seed_identity_conflict` | **nueva**, en el próximo envío |

**Solo se rota con evidencia inequívoca de terminalidad.** Los cuatro códigos de
dominio **solo se emiten cuando `mark_failed` confirmó** la persistencia; si no
la confirma, degradan a `internal`, que no rota. El `catch` de la UI **no rota**:
solo **anota** que el próximo envío estrenará clave.

### Compensación segura

```
mark_failed CONFIRMADO  →  deleteUser        ← nunca al revés
```

`deleteUser` no conoce el lease: si corriera primero y el arriendo hubiera
rotado, borraría el seed que otro worker está usando. Si `mark_failed` **no** se
confirma —lease perdido, red, respuesta incierta— **no se borra nada**:
**conservar un seed huérfano es preferible a destruir una identidad que pudo ser
retomada**. `lease_lost` retorna **antes** de tocar cualquier cosa.

Si el borrado falla, se anota en la base y queda **diagnosticable**:

| Escenario | `error_code` |
|---|---|
| Falló la creación, cleanup OK | `duplicate_phone` |
| Falló la creación, **cleanup pendiente** | `duplicate_phone+compensation_failed` |

---

## G. Auditoría integral final

Se hizo una **revisión manual completa del código fuente**, no solo de los
checks, cubriendo Auth, RPCs, tabla, idempotencia, compensación, Claim, Booking,
duplicados, payload/privacidad, UI, runtime, migración/rollback e instrumentos.

**Resultado: 0 🔴 de seguridad.** Cinco 🟠 detectados **y ya corregidos**:

| # | Hallazgo | Cómo quedó |
|---|---|---|
| 1 | **Claim phone irreclamable**: `normalize_phone_sv` aceptaba lo que `auth_phone_e164` rechaza → seed publicado e imposible de reclamar, y `claim_ready` mentía | Validación con **la misma función del hook**, `P0133`, antes del lock y de escribir. `claim_ready` usa ese criterio |
| 2 | **Retry `completed` engañoso**: devolvía sin `slug` ni `is_published` → la UI decía "guardado sin publicar" sobre un perfil publicado | El claim reconstruye desde lo **persistido**; la Edge enumera los campos a mano |
| 3 | **JWT implícito**: el token se obtenía y se descartaba | `Authorization: Bearer <token>` explícito en `functions.invoke` |
| 4 | **Casts antes de `is_admin()`**: el `DECLARE` inicializaba `::uuid/::numeric/::int` desde el payload, y PL/pgSQL lo evalúa antes del `BEGIN` → `22P02` antes del gate | Casts movidos al cuerpo, **validados con regex antes de castear**. Verificado en las **seis** RPCs |
| 5 | **Cleanup fallido no diagnosticable**: con el orden seguro, un borrado fallido era indistinguible de uno exitoso | RPC estrecha `flag_compensation_failed`: solo sobre `failed`, mismo lease, **sin** cambiar `status`, anexa preservando el motivo, idempotente |

Además: **`seed_user_id` ya no llega al cliente** en ninguna respuesta;
**`_smoke-s7_73.mjs` está implementado** (18 casos) pero **NO ejecutado**; y el
**rollback `docs/rollbacks/s7_73_rollback.sql`** está preparado y **NO
ejecutado** (requirió `git add -f` por la regla `*.sql` del `.gitignore`).

---

## H. Checks — último estado conocido

| Verificación | Estado |
|---|---|
| `node scripts/check-s7_73.mjs` | **209/209 PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** — bundle 671,53 kB |
| `git diff --check` | **PASS** |
| Árbol de trabajo | **limpio** |
| Edge Function — **parseo con esbuild** | **PASS** (instrumento validado A/B) |
| Edge Function — **bundling y deploy** | ✅ **PASS** — server-side por Supabase |
| Edge Function — **cold boot / ejecución real** | ⚠️ **AÚN NO VALIDADA** |
| `_smoke-s7_73.mjs` | **NO ejecutado** |

> Los **209** checks son los **198** originales más **11** nuevos sobre el
> invariante de credenciales (EDGE-SECRET-KEY-MIGRATION).

### Qué demuestra el deploy, y qué NO

**Sí demuestra** —dos deploys aceptados por Supabase, el segundo con la
corrección de credenciales—: el archivo **bundlea** en el pipeline real, el
import **`jsr:@supabase/supabase-js@2` resuelve** y la función queda registrada
como **`ACTIVE`**. El bundling corrió **server-side** (sin Docker local), que es
el mismo camino que usa la plataforma.

> ⚠️ **Esto NO es "runtime PASS".** Un deploy aceptado dice que el código
> **carga**, no que **corre**. Siguen **sin observarse**: el **cold boot** del
> aislado Deno, la ejecución de `Deno.serve`, la resolución de las variables
> `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` en el runtime real, y
> cualquier comportamiento de la función. **La Edge nunca fue invocada.** Eso
> solo se prueba con `s7_73` aplicada y una llamada autorizada.
>
> El **parseo con esbuild** tampoco es Deno: solo demuestra que el archivo
> parsea tras el type-strip. Su instrumento **sí** fue validado A/B (una copia
> con un error de sintaxis deliberado falla), pero no valida tipos ni APIs de
> Deno.

---

## I. Deudas aceptadas — 🟡, NO bloqueantes

- **Ubicación** (`department_id` / `municipality_id`) todavía **no expuesta por la
  UI del seed**: los perfiles sembrados no aparecerán en los filtros por
  departamento/municipio del Home.
- **Body sin límite explícito** de tamaño en la Edge Function.
- **`requested_by` conserva al creador original** aunque otro admin retome la
  operación tras el lease.
- **Algunos campos de la whitelist de la Edge** (`bio`, `consultation_fee`,
  `experience_years` y los dos de ubicación) **todavía no los usa la UI**.
- **`clinics.owner_id` sigue apuntando al profile técnico después del Claim**, y
  como es `NOT NULL`, **bloquea eliminar ese usuario técnico** más adelante: el
  `DELETE` fallaría por la FK.
- **Acumulación futura de usuarios técnicos**, marcados con
  `app_metadata.lucy_seed_doctor = true` pero no borrables por lo anterior.
- **Primer runtime Deno del proyecto** y **despliegue desacoplado de Vercel**: el
  rollback de la función **no** acompaña al revert del PR.

---

## J. ⭐ PUNTO EXACTO DE REANUDACIÓN

> ### El **Paso 1 (deploy de la Edge Function) está COMPLETADO**. La siguiente acción **NO está autorizada todavía**.

### ✅ Paso 1 — COMPLETADO (2026-08-23)

La Edge Function `admin-create-seed-doctor` está **desplegada y `ACTIVE`**.
Bundling y deploy = **PASS**. Se desplegó **dos veces**:

1. **v1** — validación de bundling. **PASS**, pero destapó un defecto: la
   función leía las variables **legacy** `SUPABASE_SERVICE_ROLE_KEY` y
   `SUPABASE_ANON_KEY`, y este proyecto tiene las **legacy API keys
   deshabilitadas**. Medido: esos JWT reciben **401** del gateway. La función
   habría fallado entera —Admin API **y** RPCs— en la primera invocación.
2. **v2** — EDGE-SECRET-KEY-MIGRATION. Corregido a las credenciales del formato
   nuevo, con parseo **fail closed**. **PASS**, y su código fue verificado
   **byte a byte** contra el del PR #348.

**La función nunca fue invocada**, así que el **cold boot sigue sin validarse**
(ver §H). El defecto de credenciales **no produjo ninguna escritura**: se
detectó antes de que la función llegara al Admin API.

**Todavía NO, y ninguno sin autorización expresa:**

- ❌ aplicar `s7_73`
- ❌ **invocar la Edge Function**
- ❌ ejecutar `_smoke-s7_73.mjs --confirm`
- ❌ usar el Admin API real
- ❌ crear ningún perfil sembrado
- ❌ mergear el PR #348
- ❌ reactivar las legacy API keys

### Orden previsto de aquí en adelante

```
✅ Paso 1 · deploy de la Edge Function          COMPLETADO (ACTIVE v2)
  → aplicar s7_73                               ← siguiente, SIN autorizar
  → checks + smoke autorizado                     (primera invocación real:
                                                   ahí se valida el cold boot)
  → regenerar database.types.ts   (hoy imposible: requiere la migración aplicada)
  → QA controlada en Preview de LucyAdmin
  → merge #348  ← al final, para que la UI no llegue a producción antes que DB y función
```

> **Revertir la función no acompaña al revert del PR:** el despliegue está
> desacoplado de Vercel y de Git. Hoy existe una v2 desplegada aunque `s7_73`
> **no** esté aplicada; es inofensivo, porque sin las RPCs la función no puede
> pasar del primer paso y **nunca alcanza el Admin API**.

---

## K. Salvaguardas permanentes

- **`auth.users`: JAMÁS por SQL.** Siempre Admin API.
- **La credencial privilegiada nunca fuera del perímetro autorizado** — la
  secret key moderna vive solo dentro de la Edge Function, y solo alimenta
  `createUser`/`deleteUser`.
- **No reactivar las legacy API keys.** Están deshabilitadas y así deben
  quedarse: el JWT `service_role` legacy estuvo en el historial público del
  repositorio y volvería a ser válido si se reactivaran.
- **No mergear, migrar, desplegar, tocar configuración ni producción sin
  autorización explícita** del owner, paso por paso.
- **No tocar** Test Phones, Twilio, Turnstile ni `hook_before_user_created`.
- **No modificar identidades protegidas**: Camilo (`50378056365`), LucyAdmin,
  `operations_admin`, el médico QA despublicado. **Jamás Katherine
  (`50372608827`)**.
- **No usar datos reales de pacientes para QA**, ni en read-only.
- **Copy en tuteo, nunca voseo.** Español, sin anglicismos.
- **Un solo frente funcional a la vez** — hoy, este.
- **No inventar QA ni resultados.** No afirmar que una prueba corrió si solo se
  leyó el código.

---

## Documentación relacionada

| Documento | Rol |
|---|---|
| `CLAUDE.md` | Guía rápida. Si contradice a `docs/`, mandan los `docs/` |
| **Este handoff** | **Fuente canónica del estado**, con el frente abierto |
| `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-20.md` | **Histórico.** Sigue siendo la mejor descripción del **estado general del producto** (piloto, Auth, Booking, Twilio, Legal, identidades, backlog) |
| `docs/HISTORIAL_FRENTES.md` | Detalle por PR de los frentes **cerrados**. #348 no está ahí: sigue abierto |
| `docs/rollbacks/s7_73_rollback.sql` | **NO ejecutar** |
