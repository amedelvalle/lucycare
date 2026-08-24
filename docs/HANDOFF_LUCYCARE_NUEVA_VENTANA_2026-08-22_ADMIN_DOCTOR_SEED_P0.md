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
> 📍 **Estado en una línea (2026-08-23):** **frente FUNCIONALMENTE COMPLETO.**
> Edge Function **`ACTIVE` v4** · **`s7_73`, `s7_74` y `s7_75` APLICADAS** (96
> migraciones) · **DB smoke PASS/CLOSED** · **E2E real PASS/CLOSED** · **cleanup
> A→B→C→D PASS/CLOSED** · **0 seeds persistentes, 0 residuos operativos**,
> auditoría conservada · PR #348 **abierto**. **Lo único pendiente es el cierre
> Git/merge.** Detalle en la **§J**.
>
> **Este documento no contiene** OTPs, contraseñas, tokens, `service_role`,
> claves ni enlaces con credenciales.

---

## A. Estado Git

| Ítem | Valor |
|---|---|
| **PR** | **[#348](https://github.com/amedelvalle/lucycare/pull/348) — OPEN, `MERGEABLE`, NO mergeado** |
| Rama | **`claude/seed-doctor`** |
| **HEAD de la rama** | **`b9906730ee4e82de05981744b6a313b9dc3a841d`** — `s7_75` |
| **`main`** | **`828b021946bf1c7b8ce218bd8dae54ff160a856e`** — sin tocar |
| Migraciones en el repo | **96 archivos** |
| **Migraciones aplicadas en producción** | **96** — hasta `s7_75_seed_claim_phone_sms_capable.sql` |
| **`s7_73`** | ✅ **APPLIED / PASS** (2026-08-23) |
| **`s7_74`** | ✅ **APPLIED / PASS / CLOSED** (2026-08-23) — **no volver a aplicar** |
| **`s7_75`** | ✅ **APPLIED / PASS** (2026-08-23) — **no volver a aplicar** |
| **Edge Function** | ✅ **`ACTIVE`, versión 4** (2026-08-23) — desplegada y **ejercitada en POST real** |
| **DB smoke** | ✅ **PASS / CLOSED** — 33/33. **No repetir** |
| **E2E real (creación)** | ✅ **PASS / CLOSED** — 2026-08-23. **No repetir** |
| **Cleanup A→B→C→D** | ✅ **PASS / CLOSED** |
| Perfiles sembrados persistentes | **ninguno** — la fixture se creó y se eliminó |
| Residuos operativos | **ninguno** · `audit_log` **conservado** como evidencia |
| `_smoke-s7_73.mjs` | ⛔ **DEPRECADO — NO EJECUTAR** (ver §H) |
| Smoke oficial | **`docs/OWNER_S7_73_SMOKE.md`** — SQL, lo corre el owner |
| Plan de QA | **`docs/OWNER_S7_73_QA_PLAN.md`** — ✅ **EJECUTADO / CERRADO** |
| Rollbacks `s7_73` / `s7_74` / `s7_75` | preparados, **NO ejecutados** |

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
- **`claim_ready`** usa **ese mismo criterio**, endurecido por `s7_75` (ver
  abajo). No "el campo vino informado", que daba falso positivo.

> ### Definición vigente de `claim_ready = true`
>
> **Móvil salvadoreño con formato compatible con el flujo OTP/SMS actualmente
> habilitado**, más credencial JVPM presente y no rechazada.
>
> **No significa que el aparato vaya a recibir el mensaje** — eso depende de la
> línea, del operador y del saldo de Twilio. Es una afirmación sobre el
> **formato** y su compatibilidad con el flujo vigente, nada más.
>
> `s7_75` lo hizo cierto: `auth_phone_e164` (`s7_65`) acepta `^503[267]…`, así
> que un **fijo `2XXXXXXX` pasaba** y el perfil nacía publicado con
> `claim_ready = true`, para fallar recién al pedir el código —el Claim envía
> con `verifyOtp({ type: 'sms' })`—. El helper privado
> `_seed_claim_phone_e164` reusa `auth_phone_e164` y le suma
> `^\+503[67][0-9]{7}$`. Las **tres** lecturas del teléfono de claim lo usan,
> incluida la reconstrucción del retry `completed`, así que no pueden divergir.
> **`auth_phone_e164` NO se tocó**: Claim, login y booking quedan igual.

**Errores tipados:** `P0120`–`P0133`. Listados en la cabecera de la migración.
`P0133` mapea a **`invalid_phone`** en la Edge, con copy propio: sin ese mapeo
caía en `internal` y un error corregible por el usuario se presentaba como un
fallo transitorio del sistema.

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

Además: **`seed_user_id` ya no llega al cliente** en ninguna respuesta; el
**smoke oficial es `docs/OWNER_S7_73_SMOKE.md`** —SQL, ejecutado por el owner,
**PASS / CLOSED**— y **`_smoke-s7_73.mjs` quedó DEPRECADO, NO EJECUTAR** (§H); y
los **rollbacks `s7_73` / `s7_74`** están preparados y **NO ejecutados** (ambos
requirieron `git add -f` por la regla `*.sql` del `.gitignore`).

---

## H. Checks — último estado conocido

| Verificación | Estado |
|---|---|
| `node scripts/check-s7_73.mjs` | **236/236 PASS** |
| `node scripts/check-s7_74.mjs` | **28/28 PASS** (instrumento validado A/B) |
| `node scripts/check-s7_75.mjs` | **67/67 PASS** (tres instrumentos validados A/B) |
| **DB smoke `docs/OWNER_S7_73_SMOKE.md`** | ✅ **PASS / CLOSED** — ver abajo |
| **E2E real + cleanup** | ✅ **PASS / CLOSED** — ver abajo |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** — bundle 671,53 kB |
| `git diff --check` | **PASS** |
| Árbol de trabajo | **limpio** |
| Edge Function — **parseo con esbuild** | **PASS** (instrumento validado A/B) |
| Edge Function — **bundling y deploy** | ✅ **PASS** — server-side por Supabase |
| Edge Function — **cold boot / ejecución real** | ✅ **PASS** — POST funcional real (v4) |
| `_smoke-s7_73.mjs` | ⛔ **DEPRECADO — NO EJECUTAR** |

> Los **209** checks son los **198** originales más **11** nuevos sobre el
> invariante de credenciales (EDGE-SECRET-KEY-MIGRATION).

### DB smoke — ✅ PASS / CLOSED (2026-08-23). **No repetir**

Ejecutado por el **owner** en el SQL Editor, según
**`docs/OWNER_S7_73_SMOKE.md`**:

| Resultado | Valor |
|---|---|
| Controles PASS | **33 / 33** |
| `casos_fallidos` | **0** |
| BLOQUE 2 · `filas_residuales` | **0** |
| Seeds persistentes | **0** |
| Llamadas al Admin API | **0** |
| Edge Function | **`ACTIVE` v2, nunca invocada** |

Cubrió: gate `is_admin()` con identidad real · idempotencia del claim ·
`P0122` · **`P0132` en las CUATRO RPCs mutadoras** · **lease vencido →
`resume`, rotación del token y expulsión del worker viejo** · `P0123` ·
`P0125` · `P0131` · preservación del primer `error_code` ·
`+compensation_failed` idempotente · privilegios de tabla · la policy de
`s7_74`. Todo dentro de `BEGIN … ROLLBACK`, con el admin **explícito** y
**jamás modificado**.

**NO cubrió** —y sigue sin cubrirse—: concurrencia real de dos sesiones ·
el camino completo de `admin_create_seed_doctor` (exige `auth.users` por
Admin API) · el cold boot de la Edge.

> ⛔ **`scripts/_smoke-s7_73.mjs` quedó DEPRECADO.** Usaba `service_role` sin
> JWT de usuario: `auth.uid()` es NULL, `is_admin()` es false y las seis RPCs
> cierran en **`P0120`**; además `requested_by` es `NOT NULL` y habría dado
> `23502`. Sus 18 casos **no podían pasar**, y el fallo se habría leído como
> "las RPCs están rotas". El archivo se conserva como **fail-fast informativo**:
> sin imports, sin red, sin credenciales, `exit 1` y puntero al smoke oficial.
> Su cabecera original afirmaba que `SECURITY DEFINER` "bypassa `is_admin()`" —
> **era falso**: cambia los privilegios SQL del cuerpo, no fabrica un
> `auth.uid()`.

### E2E real — ✅ PASS / CLOSED (2026-08-23). **No repetir**

**Primera y única invocación funcional de la Edge Function.** Un solo submit
desde el Preview del PR, con fixture 100 % sintética y `publish=true`. La cadena
completa corrió en **680 ms**:

```
claim → createUser (Admin API) → set_auth_created → create_seed_doctor
```

Con eso quedaron validados **de una sola vez**: **cold boot real de Deno** ·
resolución de **`SUPABASE_SECRET_KEYS['default']`** (probada porque `createUser`
funcionó) · resolución de **`SUPABASE_PUBLISHABLE_KEYS['default']`** (probada
porque las RPCs respondieron) · **JWT real de LucyAdmin** · **Admin API**.

Invariantes preclaim comprobados en la base: `lucy_status='listed_only'` ·
`booking_enabled=false` · `is_operational=true` · `is_published=true` ·
`claim_ready=true` · `profiles.role='patient'` · JVPM en `pending` ·
**0 `clinic_members`** · **0 `appointments`** · `audit_log.user_id` = **el admin
ejecutor, no NULL** —prueba de que la cadena corrió con el JWT real y el trigger
de identidad de `s7_32` pudo escribir—. Identidad técnica verificada por
`getUserById`: email `.invalid` determinístico, baneada, sin teléfono, sin
contraseña, sin PII.

### Cleanup — ✅ PASS / CLOSED

Orden **A → B → C → D**: dry-run de Auth **antes** del SQL · bloque
transaccional fail-closed (`admin_seed_operations → doctor_credentials →
doctors → clinics`) con guardas de ownership y `ROW_COUNT` · `deleteUser`
**después** del `COMMIT` · post-check.

Resultado: **conteos vueltos al baseline exacto** (`admin_seed_operations` 0 ·
doctors 115 · clinics 116 · doctor_credentials 115), fixture inexistente objeto
por objeto, profile técnico cascadeado por la FK, `getUserById` confirmando que
la identidad no existe, y el slug fuera del perfil público y del **sitemap**
(37 URLs).

**`audit_log` se conserva** — inmutable desde `s7_71b`, sobrevive al borrado del
`record_id` al que apunta. **Es la evidencia, no un residuo.**

### Historial del deploy — dos defectos de CORS que costaron dos intentos

La primera QA murió **antes de llegar a la función**: `OPTIONS 200` y aun así
network error, sin POST. La lista `Access-Control-Allow-Headers` enumeraba solo
los headers que el código pone a mano y **omitía los que `supabase-js` agrega
solo**. Se corrigió en dos pasos —`x-client-info` (v3) y `apikey` (v4)— porque
la primera vez el análisis se detuvo en `FunctionsClient` y concluyó, mal, que
`apikey` no se enviaba: lo **inyecta `fetchWithAuth`** (`lib/fetch.js`) en el
`customFetch`, justo antes del fetch real.

**CORS final, los cinco headers efectivos:**

```
apikey, authorization, content-type, idempotency-key, x-client-info
```

> ⚠️ Antes de tocar esa lista hay que revisar qué headers adjunta la versión de
> `supabase-js` en uso — **incluida la capa del `customFetch`**. CORS exige que
> **todos** los headers pedidos estén cubiertos: con uno solo fuera, el
> navegador responde 200 al `OPTIONS` y **igual rechaza el preflight**.

---

## I. Deudas aceptadas — 🟡, NO bloqueantes

- **`database.types.ts` desactualizado desde mucho antes de este frente.**
  Regenerarlo desde el esquema live agrega **+8 tablas, +3 vistas y +61
  funciones**, y **no elimina nada**; `tsc` compila con **0 errores**. La
  mayoría del diff **no** viene de `s7_73`/`s7_74`/`s7_75`, sino de migraciones
  anteriores cuyos tipos nunca se regeneraron. Queda **sin commitear**, a la
  espera de decisión del owner. Nota lateral: la regeneración también incluye
  los helpers **privados** (`_seed_claim_phone_e164`, `_seed_doctor_email`) —
  son solo tipos, se borran al compilar y sus nombres ya están en el repo
  público, pero conviene saberlo.
- **`ClaimProfileModal` admite un fijo para OTP.** Valida solo
  `phoneRaw.length === 8`, así que un `2XXXXXXX` puede intentar el reclamo y
  fallar al recibir el SMS. `s7_75` cerró esa puerta **solo para el seed**;
  el Claim general sigue igual. **Frente separado.**
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

> ### El frente está **FUNCIONALMENTE COMPLETO**. Lo único pendiente es el **cierre Git / merge del PR #348**.

### ✅ Paso 1 — deploy de la Edge Function — COMPLETADO (2026-08-23)

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

### ✅ Paso 2 — `s7_73` aplicada y verificada (2026-08-23)

Aplicada por el owner en el SQL Editor. Verificado read-only: tabla creada · **6
RPCs + helper** existentes y con `anon` denegado (`42501`) · firmas exactas ·
`prosecdef` y `search_path` correctos · **0 filas**.

### ✅ Paso 3 — `s7_74` aplicada · DB smoke PASS (2026-08-23)

El LIVE CATALOG VERIFY destapó que `s7_73` creó la policy **sin cláusula `TO`**,
lo que en PostgreSQL equivale a `TO PUBLIC`. **No hubo exposición** —`anon`
choca antes con el `REVOKE ALL`, y el `USING` exige `is_admin()`—, pero se cerró
por defensa en profundidad con `s7_74` (`ALTER POLICY … TO authenticated`).
**`s7_74` = APPLIED / PASS / CLOSED: no volver a aplicar.**

El **DB smoke** quedó **PASS / CLOSED**: 33/33 controles, `casos_fallidos=0`,
`filas_residuales=0`. Detalle en la **§H**. **No repetir.**

**Todavía NO, y ninguno sin autorización expresa:**

- ❌ **invocar la Edge Function** — sigue sin validarse el cold boot
- ❌ usar el Admin API real
- ❌ crear ningún perfil sembrado
- ❌ ejecutar `_smoke-s7_73.mjs` (deprecado) ni repetir el smoke SQL (cerrado)
- ❌ volver a aplicar `s7_73` o `s7_74`
- ❌ mergear el PR #348
- ❌ reactivar las legacy API keys

### Orden previsto de aquí en adelante

```
✅ Paso 1 · deploy de la Edge Function          COMPLETADO (llegó a ACTIVE v4)
✅ Paso 2 · aplicar s7_73 + verificación         COMPLETADO
✅ Paso 3 · s7_74 + DB smoke                     COMPLETADO (33/33, 0 residuos)
✅ Paso 4 · CORS v3/v4 + UX del teléfono + s7_75 COMPLETADO
✅ Paso 5 · QA REAL de la Edge                   COMPLETADO (PASS)
✅ Paso 6 · cleanup A→B→C→D                      COMPLETADO (0 residuos)
  → regenerar database.types.ts                 ← ver la advertencia de abajo
  → merge #348  ← lo único que falta
```

**`docs/OWNER_S7_73_QA_PLAN.md` quedó EJECUTADO y CERRADO**: fixture sintética,
creación, verificación de invariantes y cleanup completo, todo con la evidencia
registrada.

> ⚠️ **`database.types.ts` — regeneración pendiente de decisión.** El archivo
> versionado quedó **desactualizado mucho antes de este frente**: regenerarlo
> desde el esquema live agrega **8 tablas, 3 vistas y 61 funciones**, casi todas
> ajenas a `s7_73`/`s7_74`/`s7_75` (`waitlist_entries`, `otp_consent_events`,
> `doctor_affiliation_requests`, `is_admin`, `claim_doctor_profile`…). **No
> elimina nada** y **`tsc` pasa con 0 errores**, pero es un diff enorme y de
> alcance mayor al del frente. Se dejó **sin commitear** a la espera de decisión
> del owner. Detalle en la §I.

> **Revertir la función no acompaña al revert del PR:** el despliegue está
> desacoplado de Vercel y de Git. La **v4 desplegada seguiría viva** aunque se
> revirtiera el PR, y las tres migraciones ya están aplicadas. Hoy es
> inofensivo, porque sin la UI mergeada nadie puede invocarla salvo desde el
> Preview con sesión de LucyAdmin.

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
