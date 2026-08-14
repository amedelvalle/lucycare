# HANDOFF LucyCare — nueva ventana (2026-08-12 · actualizado 2026-08-13, post PR #329)

> 🟢 **PUNTO DE ENTRADA CANÓNICO.** Autosuficiente: no asume que la ventana
> nueva conozca ninguna conversación anterior. Reemplaza a
> `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-06.md`, que pasa a **histórico**
> junto con todos los anteriores. El detalle por PR de los frentes cerrados
> vive en `docs/HISTORIAL_FRENTES.md`.
>
> **Actualización 2026-08-14 (post #335) — PILOTO = GO.** Quedaron **CERRADOS**:
> RECOVERY-EMAIL-P0 · ADMIN-JUNIOR · TESTPHONE-CLEANUP-P0 · LEGAL-P0 ·
> **Booking E2E real** (§8) · safeguard de saldo de Twilio (§5) · higiene de
> perfiles QA (§9) · **GO/NO-GO final (§7) = GO, con cero FAIL bloqueantes**.
> **No hay ningún frente funcional abierto** y nada se abre sin instrucción del
> owner. Todas las deudas vigentes son **WARN no bloqueantes** (§10.1).
>
> **Este documento no contiene** OTPs, contraseñas, tokens, `service_role`,
> claves ni enlaces con credenciales. Los teléfonos aparecen **solo como
> identificadores operativos**, nunca junto a su código.

---

## 0. Estado del repositorio

| Ítem | Valor |
|---|---|
| Repo | `github.com/amedelvalle/lucycare` |
| Local | `C:\Users\admic\lucycare` |
| Dominio productivo | `https://lucycare.app` |
| Branch | `main` |
| **Último HEAD funcional** (previo a la reconciliación documental) | **`fa0d6ab140ccb08a51f26825a883453c146cfb97`** (#335) |
| Subject de ese HEAD | `copy(calificar): lenguaje neutral en la pagina de calificacion (#335)` |
| SHA vigente del repo | consultar con `git rev-parse HEAD` — **cambia con cada PR docs-only y no refleja cambio funcional** |
| `main == origin/main` | sí |
| Árbol | limpio |
| PRs abiertos | **0** |
| Migraciones | **93 archivos**, versionadas y aplicadas hasta **`s7_72_review_token_short_code.sql`** |
| Vercel producción | deployment de `fa0d6ab` = **success**, y el dominio **sirve y ejecuta** ese bundle (verificado contra `lucycare.app`, no solo por el estado del deploy). Los PRs docs-only redespliegan el **mismo bundle funcional** |

**Últimos PRs mergeados:** #335 (copy de calificación) · #334 (nombre del paciente
nuevo en Booking) · #333 (cierre documental de LEGAL-P0) · #332 (integración
legal) · #331 (publicación legal) · #330 (cierre documental post-#329).

**Deuda menor de performance, registrada y NO urgente:** el bundle principal
quedó en **~666 kB** porque las dos páginas legales viajan en el chunk inicial,
siguiendo la convención del router de mantener estáticas las rutas públicas/SEO
(`src/router/config.tsx`). El arreglo sería `lazy()` en ambas páginas. **No es
bloqueante; el owner decidió no hacerlo ahora.**

---

## 1. RECOVERY-EMAIL-P0 — ✅ CLOSED (2026-08-13)

> **No hay frente funcional activo.** Esta sección queda como evidencia.
> **No reabrir Auth ni recovery salvo un incidente nuevo con evidencia propia.**

### 1.1 Estado

**CLOSED.** El parche está en producción y quedó confirmado con un recovery
real end-to-end. Resultado del owner:

| Paso | Resultado |
|---|---|
| Recovery por email (`josuediazdelvalle27@gmail.com`) | **PASS** |
| Contraseña establecida | **PASS** |
| Login email + contraseña | **PASS** |
| Sesión creada y estable | **PASS** |

### 1.2 Qué pasó (evidencia de logs de producción, confirmada)

Un usuario pidió recuperar su contraseña y vio *"Tu link de recuperación expiró o
no es válido"*. **El enlace era válido.** La secuencia real:

```
POST /auth/v1/recover                     200   ← emisión correcta
GET  /auth/v1/verify?type=recovery        303   ← token válido, redirect OK
GET  /auth/v1/user                        200   ← la sesión de recovery SÍ se creó
32 × POST /auth/v1/token (refresh_token)  31×200 + 1×429   ← tormenta en 3,4 s
9  × GET /rest/v1/profiles                401   ← a los ~130 ms del 429
```

**Mecanismo demostrado en `auth-js 2.71.1` (código instalado):**

- `lib/fetch.js` — `NETWORK_ERROR_CODES = [502,503,504]`. **429 no está**, así que
  produce `AuthApiError`, **no reintentable**.
- `GoTrueClient.js` `_callRefreshToken` → `if (!isAuthRetryableFetchError(error))
  await this._removeSession()`.
- `_removeSession()` borra la sesión de `localStorage` y emite `SIGNED_OUT`.

Por eso los 401 llegan en milisegundos y `/reset-password` muestra el mensaje
falso: la sesión desapareció, no el enlace.

### 1.3 Descartado con evidencia

- Enlace vencido de origen · prefetch/escáner de Gmail · Redirect URL incorrecta ·
  JWT ≤ 90 s · Email OTP Expiration · plantilla de correo.

**Configuración confirmada en Dashboard (no modificada):** Access token expiry
**3600 s** · Refresh token reuse interval **10 s** · protección contra refresh
tokens comprometidos **activa**.

### 1.4 Qué corrigió el PR #327

`src/hooks/useIdleLogout.ts` — **1 línea funcional**:

```ts
if (event === 'TOKEN_REFRESHED') return;
```

Su listener llamaba `refresh()` ante **cualquier** evento salvo `SIGNED_OUT`,
incluido `TOKEN_REFRESHED`. Ese evento no cambia identidad, rol ni
`last_sign_in_at` —lo único que `refresh()` recalcula—, y cerraba el ciclo:

```
refresh → TOKEN_REFRESHED → refresh() → getSession() → refresh → …
```

**QA A/B local** sobre fixture efímero: sin el cambio, `TOKEN_REFRESHED` produce
3 llamadas nuevas (dos desde `useIdleLogout`); con el cambio, **0**. `tsc`/build
PASS · Vercel PASS · QA del owner de login normal en Preview PASS · producción
`c659cc5` confirmada sirviendo el fix.

> ⚠️ **No se reprodujo el incidente exacto.** Lo demostrado y eliminado es el
> **mecanismo de realimentación**. Con navegador limpio la condición inicial no
> se dispara (`getSession()` solo refresca dentro de los 90 s de margen y un
> token recién emitido está a 3600 s). La precondición sospechada —sesión
> vencida previa en `localStorage`— quedó fuera de alcance por decisión del owner.

### 1.5 QA local ya ejecutada y cerrada

Fixture `RECOVERY_P0_QA` efímero: `createUser` + `generateLink` + `verifyOtp`
recovery → `PASSWORD_RECOVERY` correcto. **Eliminado por Admin API**, `profiles`
de vuelta a **140**, cero residuos, instrumentación revertida por completo.

### 1.6 Cierre

La prueba real se ejecutó y pasó. Al llegar a la UI apareció un problema
**distinto y posterior**: la sesión era correcta pero la navegación lo trataba
como paciente. Eso se diagnosticó y se cerró como **ADMIN-JUNIOR** (§2), no como
un fallo de Auth.

**Si en el futuro reaparece un fallo de recovery:** **NO** pedir ni compartir la
URL completa (puede contener credenciales). Registrar **hora exacta con zona
horaria** y exportar **Auth Logs + API Gateway/Edge Logs** de esa ventana.
**No rediseñar Auth sin evidencia.**

---

## 2. ADMIN-JUNIOR / operations_admin — ✅ CLOSED (2026-08-13, PR #329)

| Campo | Valor |
|---|---|
| `user_id` / `profile_id` | `791e7d0b-8d6d-43db-8a43-95025d81581e` |
| Email | `josuediazdelvalle27@gmail.com` — **añadido y confirmado** por Admin API |
| Teléfono | `50377507479` — **ya NO es Test Phone** (retirado 2026-08-13) |
| `identities` | **`email` + `phone`** |
| `profiles.role` | **`patient`** — correcto, **no se elevó** |
| `lucyadmin_access` | **`operations_admin`**, activo, otorgado 2026-07-10 |
| Vía de acceso | **email + contraseña**. No depende de SMS ni de Test Phones |

**Reglas vinculantes:** **no** convertir a `role='admin'` · **no** ampliar
privilegios · **no** crear un rol nuevo · **no** usar la pantalla de invitación
de Administradores con esta persona (ya existe como `operations_admin` y no debe
elevarse).

**Alcance real de `operations_admin`** (verificado en `s7_57`): los niveles son
anidados por rango — `directory_editor(1) ⊂ operations_admin(2) ⊂ admin` — y
cinco RPCs de datos públicos del médico están gateadas por
`can_manage_directory()` (rango ≥ 1). Es decir: **esta cuenta sí opera** sobre el
directorio. Lo que no tiene caller es `can_manage_doctor_operations()` (rango 2).

### 2.1 El problema real y su cierre (PR #329)

Autenticaba bien pero la UI lo mostraba como paciente. **El backend nunca estuvo
mal:** `AdminOnlyRoute` ya admitía cualquier `lucyadmin_access` activo vía
`my_lucyadmin_access()`, y el acceso directo a `/admin` **fue PASS antes de
tocar código**. Lo que miraba solo `profiles.role` era la **navegación**, y un
`operations_admin` tiene `role='patient'`.

PR #329 — frontend, 4 archivos, +61/−8, **sin migración ni backend**:

- `destinationAfterLogin(role)` en `auth.service.ts` — envuelve a
  `destinationForRole` (que no cambió). Solo cuando el destino por rol es `/`
  consulta **la misma RPC del guard** y devuelve `/admin` si
  `can_access_lucyadmin`. Si la RPC falla, cae al destino por rol: **nunca
  bloquea el login**. Aplicado en `LoginModal` (3 vías) y `ResetPasswordPage`.
- Ítem **"Ir a LucyAdmin"** en `PatientAccountMenu`, visible solo con
  `can_access_lucyadmin`. Lleva a `/admin`; qué sección se ve la siguen
  decidiendo `AdminLayout` y `RequireOwnerAdmin`.

**Ningún privilegio nuevo.** No se tocó `profiles.role`, `lucyadmin_access`,
RLS, RPCs de autorización ni `auth.users`.

### 2.2 QA — todo PASS

Owner en Preview y producción: login email+contraseña · redirect automático ·
`/admin/medicos` · capacidades acotadas de `operations_admin` · "Ir a LucyAdmin"
visible · navegación y logout intactos.

**Home anónimo:** `my_lucyadmin_access()` **no se ejecuta**. Verificado en
producción con la Performance API — el grabador de red del navegador **no
captura las llamadas cross-origin a Supabase** y habría dado un falso PASS; el
instrumento válido sí registró las 6 llamadas reales del Home y **0** a la RPC.

> ⚠️ El incidente de Turnstile durante la QA del Preview fue **hostname no
> autorizado en Cloudflare**, no código del PR.

---

## 3. Test Phones — ✅ TESTPHONE-CLEANUP-P0 CLOSED (2026-08-13)

**Objetivo final alcanzado: exactamente 2 Test Phones.**

| Teléfono | Rol | Estado |
|---|---|---|
| `50378056365` | Camilo QA (médico demo) | **KEEP** |
| `50378626108` | Paciente QA | **KEEP** |
| `50377507479` | operations_admin / Josué | **FUERA (2026-08-13)** |
| `50378627694` | LucyAdmin | **FUERA — nunca reponer** |

El retiro de `50377507479` fue **la única acción** del frente: solo se quitó de
la lista de Test Phone Numbers. **No** se tocó la cuenta, el teléfono de la
identidad, el email, la contraseña, `profiles`, `lucyadmin_access` ni roles. El
login posterior por **email + contraseña** = **PASS**, con acceso
`operations_admin` intacto.

> ⚠️ Desde el retiro, cualquier intento de OTP por teléfono sobre un número
> fuera de la lista consume **SMS real de Twilio Verify**. Ver §5 (Auto Recharge
> pendiente).

Retirados el 2026-08-12 sin tocar identidades ni datos: `50378873634` y
`50378590126` (dos médicos reales importados y publicados), `50375000001`,
`50375000099`, `50377316374`, `50376193396`, `50370007201`, `50370008803`.

> **Retirar un Test Phone NO elimina identidades ni datos.** Es configuración de
> GoTrue; verificado con postflight: `profiles` = 140, identidades y roles
> intactos.

**Los OTP fijos no se documentan en el repositorio.**

---

## 4. LucyAdmin master y Camilo — estado post-swap

**LucyAdmin master**

| Campo | Valor |
|---|---|
| `user_id` | `739cac58-4ad2-4efe-9fbf-91921e208b8f` |
| Teléfono | `50378627694` — **no es Test Phone** |
| Email | `lucycare.digital@gmail.com`, confirmado |
| `profiles.role` | `admin` — **única cuenta con ese rol** |

Validado: recovery por email PASS · login email+contraseña PASS · **OTP SMS real
por Twilio Verify PASS** · acceso a `/admin` PASS.

**Camilo QA**

| Campo | Valor |
|---|---|
| `profile_id` / `auth.users` | `db1fba98-a299-4f25-82f1-7feff01e58fa` |
| `doctor_id` | `783a902a-55fd-407c-9e0a-69568135c7f5` |
| Teléfono | `50378056365` — **Test Phone QA** |
| Estado | `verified`, publicado, acceso médico PASS |

Sus datos asociados quedaron sincronizados por el trigger `s7_34`: `profiles`,
sus 5 fichas `patients` y sus 2 clínicas.

**Estado vigente (2026-08-14):** **publicado, activo, `verified`, operativo y con
Booking habilitado.** El owner **actualizó manualmente sus datos públicos** para
que funcione como perfil demostrativo presentable: su clínica se llama ahora
**"Clinica Camilo"** —antes figuraba como "Pepe", resto del demo; **esa
observación está RESUELTA y no es una deuda activa**— con dirección cargada, 3
servicios activos y horarios disponibles. Es el **único** médico del directorio
con agenda en línea.

> **No modificar su identidad, Auth ni configuración técnica.** Los cambios de
> datos públicos los hace el owner desde LucyAdmin.

**Puente `50370007202`:** usado durante el swap, **libre nuevamente**. No es Test
Phone y no debe serlo.

> ⚠️ `phone_confirmed_at` **se hereda** al cambiar el teléfono por Admin API:
> **no es prueba de posesión**. La posesión solo la demuestra un SMS real
> recibido.

---

## 5. Seguridad y Twilio

**AUDIT-SEC-P0 = CLOSED.** `audit_log` sin policies, `anon`/`authenticated` sin
privilegios, `service_role` solo `SELECT`, `_admin_log_doctor_change` cerrado.
El histórico anterior al corte son trazas operativas observadas, **no** evidencia
infalsificable.

**TWILIO-P0 = CLOSED / VALIDATED FOR PILOT.**

- Cuenta **Paid** · **Verify Service "LucyCare"** · **SMS only** · OTP **6 dígitos**
- **Fraud Guard activo** · **Geo Permissions: solo El Salvador**
- Supabase usa **Twilio Verify** · **Turnstile ACTIVO** · **Before User Created
  Hook ACTIVO**
- OTP real de LucyAdmin probado end-to-end

### 5.1 Safeguard de saldo — ✅ CLOSED (2026-08-14)

> ⚠️ **Estado reportado y verificado por el owner en la consola de Twilio.** No es
> medible desde el repositorio: el entorno no tiene credenciales de Twilio.

| Ítem | Estado |
|---|---|
| Cuenta | **Paid**, Twilio Verify operativo |
| Saldo | recargado a **~US$50** para el piloto |
| Balance notification | **US$25** |
| **Auto Recharge** | **OFF — decisión deliberada del piloto, no una deuda** |
| Costo observado | **~US$0.349** por verificación exitosa de un solo SMS (US$0.05 Verify + US$0.299 SMS El Salvador) |

**Vigilancia de saldo = tarea operativa viva durante el piloto.** Sin saldo no
hay OTP, y el OTP es el **único** camino de alta de pacientes nuevos: el login
genérico tiene `shouldCreateUser=false` por decisión congelada. Una caída por
saldo es **silenciosa** para el owner —el paciente solo ve "no pudimos enviarte
un código"— así que conviene que la alerta llegue a un correo mirado a diario.

**Reevaluar Auto Recharge** si el consumo mensual crece de forma sostenida o si
entran usuarios sin supervisión; en ese caso, con límite mensual y tope por
recarga.

**Modelo de consumo (derivado del código):** un paciente consume SMS **una sola
vez**, al crear su cuenta — la contraseña es obligatoria tras el OTP, y sus
reservas siguientes entran por `signInWithPhonePassword` sin costo. El gasto
escala con **pacientes nuevos**, no con reservas. Reenvíos de código y reclamos
de perfil médico también consumen.

**TESTPHONE-SEC-P0 = CLOSED.** El incidente: `50378056365` era simultáneamente
teléfono público de soporte, credencial de LucyAdmin y Test Phone con código
fijo. El **PR #326** lo retiró de las 6 superficies públicas; el swap posterior
separó definitivamente **LucyAdmin → `50378627694`** (real, no Test Phone) y
**Camilo QA → `50378056365`** (Test Phone).

**Canal público temporal: `lucycare.digital@gmail.com`.** **No usar
`hola@lucycare.app`** como canal operativo mientras no exista.

---

### 5.2 RATING-URL-P0 — ✅ APLICADA Y VERIFICADA (2026-08-14, `s7_72` / PR #338)

La URL de calificación que recibe el paciente pasó de **64 caracteres
hexadecimales** a **20 caracteres Crockford Base32**:

```
antes:  /calificar/42b8edecf723481bb784b6943836c7a4f2bb3d058ca04918bc40b873eedd7c03
ahora:  /calificar/K7M4QP2XR9TBNHF3VJCD
```

**`s7_72` es la migración 93** y está **aplicada en producción**. Crea el helper
`public._review_short_code()` —20 caracteres, **100 bits exactos**, desde
`gen_random_uuid()`/`pg_strong_random`, descartando los bytes 6 y 8 de cada UUID
(bits fijos de version/variant) y mapeando con `byte % 32`, uniforme **por
construcción** porque 256 = 8 × 32— y reemplaza **solo la expresión del token**
dentro de `generate_review_token()`.

**Compatibilidad:** los enlaces de 64 caracteres ya emitidos **siguen
funcionando** hasta usarse o vencer (7 días). `submit_review` **no se tocó** y
sigue comparando `token = p_token` por igualdad exacta sobre la misma columna.
**Sin backfill:** los tokens existentes no se convirtieron.

**Sin cambios** en `submit_review`, `get_review_link`, el esquema o los índices
de `review_tokens`, el trigger, la ruta `/calificar/:token`, el frontend, el
middleware, el SEO ni Analytics.

**Verificación (owner en el SQL Editor + dev):** PRE 16/16 · aplicación en
**una transacción explícita** con COMMIT · POST de catálogo y permisos 15/15 ·
**10 000 generaciones, 10 000 únicas**, los 32 símbolos presentes y desvío
máximo 2.82 % (~2.2σ: uniforme) · sin backfill (15 tokens siguen en 64
caracteres) · `_smoke-s7_72.mjs` **5/5**.

**El helper está acotado:** ACL `postgres=X/postgres` — sin EXECUTE para
`PUBLIC`, `anon`, `authenticated` ni `service_role`, confirmado desde el
catálogo y desde `service_role`, que recibe `42501`. Los grants de
`generate_review_token()` quedaron **byte a byte** como antes.

> ⚠️ **Aprendizaje operativo:** el primer intento de aplicar falló con `42883`
> (`name[] = text[]`: faltaba castear `attname::text` en las guardas UNIQUE).
> La transacción explícita hizo su trabajo — **rollback total, nada quedó a
> medias**. Es la razón por la que las guardas PRE van dentro del `BEGIN`.

Guía operativa completa en `docs/OWNER_S7_72_APPLY.md` (los tres pasos, con sus
valores esperados) y `docs/OWNER_S7_72_SMOKE.md`.

---

## 6. LEGAL-P0 — ✅ CLOSED (2026-08-13, PRs #331 y #332)

Cerrado en dos PRs, ambos **sin migración, sin backend y sin fricción nueva**
(ni checkbox, ni modal, ni consentimiento adicional).

### 6.1 PR #331 — publicación

- **`/terminos` existe.** Antes, `ClaimProfileModal` enlazaba a esa ruta y caía
  en `NotFound` mientras la aceptación **sí** se registraba. Eso quedó cerrado.
- **`/privacidad`** reemplazó el texto provisional del MVP y perdió el descargo
  "versión inicial / será revisado por asesoría legal".
- Ambos son los **documentos definitivos del owner** (**Versión 1.0 · última
  actualización julio de 2026 · entrada en vigor julio de 2026**), reproducidos
  sin resumir ni parafrasear. Fidelidad verificada por conteo contra la fuente:
  Términos 24 secciones / 149 viñetas; Privacidad 19 secciones / 7 subsecciones /
  187 viñetas.
- `/terminos` entró al allowlist de `PublicAnalytics`, por paridad con
  `/privacidad`.

### 6.2 PR #332 — integración

- **`TOS_VERSION = 'tos-2026-08-13'`** en `ClaimProfileModal` para las
  aceptaciones **nuevas**. Fluye por el camino que ya existía hasta
  `claim_doctor_profile`; `claimProfile.service.ts`, su fallback `?? 'v1.0'`, la
  RPC y `doctors.tos_version` **no se tocaron**.
- **El identificador es técnico y NO se imprime en la UI.** El médico lee:
  *"Al reclamar este perfil confirmas que eres el profesional y aceptas nuestros
  Términos y Condiciones."* — tuteo, nombre publicado del documento, enlace a
  `/terminos`.
- **Línea legal discreta en `BookingCard`**, bajo el CTA: *"Al reservar, aceptas
  los Términos y Condiciones y reconoces la Política de Privacidad."* Enlaces a
  `/terminos` y `/privacidad` con `target="_blank"` — abren en pestaña nueva para
  no perder el servicio y el horario ya seleccionados.
- **`MobileBookingSheet` reutiliza `BookingCard`:** móvil cubierto sin una segunda
  implementación. Validado en producción a 375×812.
- **El flujo de reserva no cambió:** el diff de `BookingCard` no elimina ni una
  línea; `handleBooking`, `completeBooking`, `registerBookingIntent` y
  `createBookingWithIntent` quedaron intactos.

### 6.3 Reglas que siguen vigentes

- **Las aceptaciones históricas `v1.0` NO se reinterpretan ni se migran:** se
  firmaron contra un documento que no estaba publicado.
- **`CONSENT_VERSION` de `AffiliationRequestModal` queda en `v1.0`** y es otra
  cosa: versiona el **consentimiento LOPD** del lead
  (`doctor_affiliation_requests.consent_version`, `s7_21`), no la Política de
  Privacidad. Verificado en código antes de decidirlo.
- **`otp_consent_events` no se usó** para nada de este frente. **No modificar
  `otp-consent-v1`** ni su hash.
- **Tuteo** en todo copy nuevo.

### 6.4 PR 3 — evidencia explícita del paciente: DIFERIDO

Registrar en DB la versión aceptada por el paciente al reservar quedó **fuera de
alcance por decisión del owner**: no se agregan columnas a `appointments` ni se
toca `create_booking_with_intent`. **No bloquea el piloto.** Si alguna vez se
retoma, el análisis previo descartó `booking_intents` como soporte (TTL de 15
minutos, `service_role` únicamente, se consume, y existe antes de que haya
usuario).

---

## 7. GO/NO-GO del piloto — ✅ CERRADO (2026-08-14): **GO**

**Cero FAIL bloqueantes.** Matriz final:

| Área | Estado |
|---|---|
| Repo / main / PRs / migraciones | **PASS** — último HEAD funcional `fa0d6ab` (#335) · 0 PRs abiertos al momento del GO · 92 migraciones hasta `s7_71b` *(al momento del GO; hoy son 93, ver §5.2)* |
| Producción desplegada | **PASS** |
| Home / directorio | **PASS** |
| Perfil público y Booking de Camilo | **PASS** |
| Auth / login con contraseña | **PASS** |
| Recuperación por email | **PASS** |
| OTP real / Twilio Verify | **PASS** |
| Turnstile | **PASS** |
| **Booking E2E real** | **PASS** (§8) |
| "Mis atenciones" | **PASS** |
| Panel médico / notificaciones | **PASS** |
| Legal | **PASS** (§6) |
| Perfiles QA públicos | **PASS** (§9) |
| Safeguard de saldo Twilio | **PASS** (§5.1) |

Checklist previo, todo cerrado: recovery real de Josué (§1) · retiro del Test
Phone de `operations_admin` (§2, §3) · LEGAL-P0 (§6) · Booking E2E real (§8) ·
safeguard de saldo (§5.1) · higiene de perfiles QA (§9).

### 7.1 Aclaración del directorio — comportamiento esperado, NO un hallazgo

**36** médicos con `is_published=true` en la base, **35** visibles en el Home. El
excluido es **Dr. Abraham Alfredo Amaya Mendoza**
(`fe7f4f9c-1ffd-4af6-954d-41c9cdc9aa02`): su **clínica no tiene dirección**, y lo
filtra la regla **D1 de completitud mínima** —`full_name` + especialidad +
`clinic.name` + `clinic.address`— en `src/services/directory.service.ts`.
Verificado también con el cliente `anon`: **la RLS no oculta a nadie**, ambos
clientes ven los mismos 36.

Matiz **intencional**: D1 gobierna el **listado**, no el sitemap.
`isSitemapEligible` **no exige ubicación**, así que ese perfil sí está indexado y
es alcanzable por enlace directo, pero no aparece en el directorio propio. Para
incorporarlo basta **cargarle la dirección de la clínica desde LucyAdmin**, sin
tocar código. **No se modificó en este ciclo.**

### 7.2 Riesgos a vigilar durante el piloto (no bloqueantes)

- **El SMS es el único camino de alta.** Si Twilio falla se cae la adquisición
  completa, y el usuario solo ve "no pudimos enviarte un código". La alerta de
  US$25 cubre el saldo, no una caída del proveedor.
- **El E2E validó un caso, no una distribución:** un teléfono, un médico, un
  horario, sin concurrencia. Apropiado para un piloto controlado de 5 médicos;
  **no es una certificación de escala.**

**Billing automático NO bloquea el piloto. BILLING-P0 = PAUSED**, arquitectura
definida y persistida en `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md`, que es la
**única fuente canónica** de pagos/suscripción/facturación.

---

## 8. Booking E2E real — ✅ EJECUTADO Y PASS (2026-08-14). **NO REPETIR**

Quedó validada **en producción** la cadena completa:

```
booking_intent → auth_creation_grant → consentimiento OTP → Turnstile →
Twilio Verify (SMS real) → Before User Created Hook → auth.user →
contraseña obligatoria → login → patient → appointment → intent consumido
```

### 8.1 La ruta del grant, demostrada por descarte

Es lo que el frente existía para probar. En el instante exacto de la creación del
`auth.user`, de las cinco ramas que `hook_before_user_created` puede usar
(`s7_65`), **solo el grant estaba disponible**:

| Rama del hook | Estado en ese instante |
|---|---|
| **`auth_creation_grants`** | ✅ **vigente** — emitido ~1 s antes por `register_booking_intent` |
| `patients` | ❌ 0 — el paciente se creó **después**, al completar la reserva |
| `doctors` | ❌ 0 |
| `clinic_invitations` | ❌ 0 |
| `platform_admin_invitations` | ❌ 0 |

**Ninguna otra rama podía autorizar.** Es prueba por descarte, no inferencia.

### 8.2 Ejecución y decisiones que se apartaron del diseño congelado

Autorizadas expresamente por el owner en el momento:

- **Médico destino: Camilo** (override puntual; el diseño original decía "nunca
  Camilo"). Solo como receptor de la reserva; **su identidad, perfil, clínica,
  servicios, disponibilidad y configuración no se tocaron**. La reserva creó
  `patients` y `appointments` **dentro de su clínica** —inherente a elegirlo— y
  ambos se eliminaron en el cleanup.
- **Sin ensayo previo** con Test Phone.
- **Un único SMS real**, desde un teléfono del owner que **no** era Test Phone.
- Del pedido de código a la cita: **1 min 37 s**, holgado dentro del TTL de 15
  minutos del intent y del grant.

> ⚠️ **Aprendizaje: el preflight del teléfono es obligatorio.** Un intento previo
> con otro número falló porque se entró por el **login genérico** (`context='login'`,
> `shouldCreateUser=false`): GoTrue rechazó con `otp_disabled` **sin enviar SMS**.
> No fue una falla de Twilio ni del hook. El E2E debe entrar **por la reserva**,
> con servicio, fecha y horario ya seleccionados.

### 8.3 Cleanup y evidencia

Cleanup en el orden que imponen las FKs —`auth_creation_grants` →
`booking_intents` → `appointments` → `patients` → identidad **solo por Admin
API**— con denylist previa de las identidades protegidas. **Cero residuos
operativos** verificados en las seis superficies.

**Preservados como evidencia:** `otp_consent_events` (1 fila) y `audit_log` (fila
del INSERT del appointment). `audit_log` es además **imborrable**: tras `s7_71b`,
`service_role` solo tiene `SELECT`.

> "Cero residuos" = cero **objetos funcionales** de fixture. Las filas de
> `otp_consent_events` y `audit_log` son **trazas esperadas** y se conservan.

### 8.4 Hallazgo que produjo el E2E → corregido en PR #334

El paciente creado por OTP nacía con `profiles.full_name` vacío, y la reserva
caía al fallback `|| user.phone`: **la ficha en la clínica del médico quedaba con
el número de teléfono como nombre**. Corregido en **#334**, solo `BookingCard`:

- Se pide **"Nombre completo"** *únicamente* cuando el perfil no lo tiene —
  obligatorio, `trim`, máximo 150 (tope `P009I` de la RPC).
- Se guarda **primero** con `updateMyProfile()`; **solo si eso pasa** se llama a
  `createBookingWithIntent` con ese nombre. Si el guardado falla, **no se crea la
  cita** y el horario sigue vigente para reintentar.
- Persistirlo en `profiles.full_name` es lo que **evita volver a preguntarlo**:
  `AuthUser.name` sale de esa columna.
- **Protecciones añadidas:** el paso se descarta si cambian servicio, fecha u
  horario (el intent anterior queda obsoleto), y un **guard de concurrencia**
  impide reservar con un intent obsoleto si la selección cambia mientras
  `updateMyProfile` está en vuelo.
- **Sin migración, sin backend nuevo.** La RPC sigue sin sobrescribir la ficha de
  un paciente existente. `MobileBookingSheet` reutiliza `BookingCard`: móvil
  cubierto sin segunda implementación.

---

## 9. Identidades protegidas — NO tocar

**Médico QA persistente**

| Campo | Valor |
|---|---|
| `profile_id` / `auth.users` | `b5865737-1c7b-4fd1-bd70-b9e5befd87ed` |
| `doctor_id` | `ac0ba772-4263-4fb2-a146-dd90033d8c76` |
| `clinic_id` | `8b24611d-6b7d-4f2c-bbf5-ec53f5c4bded` |
| Email | `asp0.qa.doctor@lucycare.test` |
| Teléfono | `50370008803` |
| `user_metadata.fixture` | `S7_71_QA_DOCTOR` |

**Identidad protegida: no borrar ni modificar sin autorización expresa.** Ya
**no** necesita estar en Test Phones.

**✅ HIGIENE QA = CLOSED (2026-08-14): fue DESPUBLICADO.** El owner puso
`is_published=false` desde LucyAdmin. Verificado después:

- **Salió del Home/directorio** y del **sitemap** (37 URLs, sin la suya).
- La **URL directa** responde `noindex,follow` y **no expone ningún dato** del
  perfil — ni el nombre ni la clínica aparecen en el HTML servido. Sigue
  devolviendo HTTP 200 porque es una SPA: eso es lo esperado, no un fallo.
- **`is_published` fue el ÚNICO campo que cambió.** `lucy_status=claimed`,
  `is_verified=false`, `booking_enabled=false`, `is_operational=true` y el slug
  quedaron intactos; médico, profile, clínica y `auth.user` **se conservan**.
- **0 otros perfiles QA publicados** — barrido de los 36 publicados contra
  `qa|test|fixture|demo|prueba|dummy|seed|sample|ejemplo|.test` en nombre, email,
  clínica y slug.

> Seguimiento no bloqueante: estuvo publicado e indexable, así que puede seguir
> en el índice de Google hasta el próximo rastreo. El `noindex` lo resuelve solo;
> "Eliminación de URLs" en Search Console lo acelera.

**Katherine `50372608827`:** **JAMÁS usar**, ni siquiera en read-only.

**Identidad no relacionada, registrada y sin tocar:** `50370007201` pertenece a
un `auth.user` de paciente creado por el flujo real de reserva el 2026-08-02
(`fa5ffa42-…`). Se retiró de Test Phones; **la identidad y su ficha se conservan**.

---

## 10. Reglas operativas VINCULANTES

- **El owner decide; el developer ejecuta instrucciones cerradas.**
- **Un solo frente funcional a la vez.**
- **No mergear, ejecutar SQL, usar `service_role`, tocar hooks, configuración ni
  producción sin autorización** puntual y explícita.
- **`auth.users`: JAMÁS por SQL.** Siempre Supabase Admin API.
- **No usar datos reales para QA.** Fixtures propias, marcadas y limpiadas, con
  verificación de cero residuales.
- **Nunca Katherine (`50372608827`).** **Camilo solo como QA/demo controlado.**
- **No modificar identidades protegidas** sin autorización expresa.
- **Turnstile permanece ACTIVO.** No desactivarlo ni reconfigurarlo.
- **No alterar Test Phones incidentalmente.**
- **No revertir de Twilio Verify a Programmable Messaging**, ni reconfigurar el
  Verify Service, Geo Permissions, Fraud Guard, canales o credenciales, **sin
  autorización explícita del owner**.
- **No compartir ni documentar** OTPs, contraseñas, tokens, `token_hash`,
  `service_role`, claves ni enlaces con credenciales.
- **No afirmar que una prueba fue ejecutada si solo se revisó código.**
- **Validar el instrumento, no solo el fix:** medir también contra el código
  anterior (A/B). Un test que solo pasa "después" no prueba nada.
- **Cambios mínimos y reversibles.** Máximo rigor en Auth, DB y seguridad.
- **No mezclar frentes** en un mismo PR. **Tuteo** en copy nuevo.
- Instrucciones al dev: breves y ejecutables. Evitar microgestión y código
  excesivo.
- **Cierre estándar tras cada merge:** HEAD, PRs, migraciones, `main==origin/main`,
  `git status` vacío, rama borrada local+remoto, sin residuos ni servidores.

---

## 10.1 Deudas vigentes — todas WARN, ninguna bloqueante

Se documentan **sin resolver**. Ninguna se abre sin instrucción del owner y
**ninguna debe reclasificarse como bloqueante**.

| Deuda | Nota |
|---|---|
| **Mensajes de contraseña de Supabase en inglés** | se muestran crudos al usuario; copy aprobado en el backlog de `CLAUDE.md` (1) |
| **`NotificationBell` — Escape, foco, a11y** | quedó explícitamente fuera de #311 |
| **Admin API `listUsers`** | `Database error finding users` persistente en la cola (~15 de ~140 usuarios ilegibles); `?filter=` **no** busca por teléfono y produce **falsos limpios**. No afecta el runtime de Auth, solo scripts de administración. Para buscar un teléfono, usar la búsqueda del Dashboard |
| **Bundle inicial ~666 kB** | las dos páginas legales viajan en el chunk inicial por la convención del router (rutas públicas/SEO estáticas). El arreglo sería `lazy()` en ambas; **el owner decidió no hacerlo ahora** |
| **F1-c2 · DROP de `doctors.license_number`** | irreversible, con precondiciones propias (sincronía fresca, respaldo, preflight, autorización). **No tocar** |
| **Seguimiento SEO / Search Console** | la URL del perfil QA despublicado sale del índice al próximo rastreo |
| **BILLING-P0** | **PAUSADO**, fuera del piloto, arquitectura definida en `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md` |
| **Auto Recharge de Twilio OFF** | **decisión deliberada del piloto**, no una deuda. Reevaluar si crece el consumo (§5.1) |

---

## 11. Documentación vigente

| Documento | Rol |
|---|---|
| `CLAUDE.md` | Guía rápida. Si contradice a `docs/`, mandan los `docs/` |
| **Este handoff** | **Fuente canónica del estado** |
| `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md` | **Única fuente canónica de BILLING** |
| `docs/HISTORIAL_FRENTES.md` | Detalle por PR de los frentes cerrados |
| `docs/OWNER_S7_71A_APPLY.md` · `docs/OWNER_S7_71B_APPLY.md` | Aplicación y verificación de AUDIT-SEC-P0 |
| `docs/rollbacks/` | **NO ejecutar** |
| Handoffs anteriores (`2026-08-06` y previos) | **Históricos**, menor precedencia |

---

## 12. Cómo arrancar

```bash
git fetch origin --prune
git checkout main
git pull --ff-only origin main
git log --oneline -5
gh pr list --state open
```

Leer en orden: **1)** `CLAUDE.md` · **2)** este handoff.

**INSTRUCCIÓN 0: no iniciar ningún frente ni cambio sin instrucción del owner.**
**No hay ningún frente funcional abierto** (post-#335) y el **piloto quedó en GO**
(§7). **No reabrir** Auth/recovery salvo un incidente nuevo con evidencia propia ·
**no repetir el Booking E2E** (§8) · LEGAL-P0 cerrado en #331/#332/#333 (§6).
Las deudas de §10.1 son **WARN** y no se abren sin instrucción.
