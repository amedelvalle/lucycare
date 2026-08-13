# HANDOFF LucyCare — nueva ventana (2026-08-12 · actualizado 2026-08-13, post PR #329)

> 🟢 **PUNTO DE ENTRADA CANÓNICO.** Autosuficiente: no asume que la ventana
> nueva conozca ninguna conversación anterior. Reemplaza a
> `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-06.md`, que pasa a **histórico**
> junto con todos los anteriores. El detalle por PR de los frentes cerrados
> vive en `docs/HISTORIAL_FRENTES.md`.
>
> **Actualización 2026-08-13 (post #329):** RECOVERY-EMAIL-P0, ADMIN-JUNIOR y
> TESTPHONE-CLEANUP-P0 quedaron **CERRADOS**. **No hay frente funcional activo.**
> El siguiente pendiente es **LEGAL-P0** (§6), que **no se abre sin instrucción
> del owner**.
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
| **HEAD** | **`fcf07053043d455c9f6ec4e1b445c968b609fad8`** |
| Subject | `fix(nav): operations_admin llega a LucyAdmin desde login y Mi cuenta (#329)` |
| `main == origin/main` | sí |
| Árbol | limpio |
| PRs abiertos | **0** |
| Migraciones | **92 archivos**, versionadas y aplicadas hasta **`s7_71b`** — sin cambios |
| Vercel producción | deployment de `fcf0705` = **success**, y el dominio **sirve y ejecuta** ese bundle (verificado contra `lucycare.app`, no solo por el estado del deploy) |

**Últimos PRs mergeados:** #329 (navegación de `operations_admin`) · #328
(handoff canónico) · #327 (fix de Auth) · #326 (retiro del teléfono admin de
superficies públicas) · #325 (cierre TWILIO-P0) · #324 (BILLING canónico).

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

**Pendiente operativo antes de abrir a usuarios reales:** asegurar **saldo,
alerta de saldo bajo o procedimiento de recarga** de Twilio. Sin saldo no hay
OTP, y sin OTP no hay acceso.

**TESTPHONE-SEC-P0 = CLOSED.** El incidente: `50378056365` era simultáneamente
teléfono público de soporte, credencial de LucyAdmin y Test Phone con código
fijo. El **PR #326** lo retiró de las 6 superficies públicas; el swap posterior
separó definitivamente **LucyAdmin → `50378627694`** (real, no Test Phone) y
**Camilo QA → `50378056365`** (Test Phone).

**Canal público temporal: `lucycare.digital@gmail.com`.** **No usar
`hola@lucycare.app`** como canal operativo mientras no exista.

---

## 6. LEGAL-P0 — SIGUIENTE FRENTE PENDIENTE

Ya **no está bloqueado** (RECOVERY-EMAIL-P0 cerró el 2026-08-13), pero **no se
abre sin instrucción expresa del owner**.

Pendiente ya definido:

- **Crear `/terminos`.** Hoy `ClaimProfileModal` enlaza a `/terminos`, que **no
  existe** en el router → cae en `NotFound`. Y sin embargo la aceptación **sí se
  registra** (`doctors.tos_accepted_at` + `tos_version='v1.0'`).
- `/privacidad` **sí existe**.
- **No reinterpretar** las aceptaciones históricas `v1.0`: se firmaron contra un
  documento no publicado. La próxima versión debe tener **identificador nuevo y
  fecha de vigencia**.
- El paciente que reserva debe **aceptar Términos y reconocer Privacidad**.
- La evidencia legal del booking va **separada** de `otp_consent_events`.
- **No modificar `otp-consent-v1`** ni su hash.
- **Tuteo** en todo copy nuevo.

---

## 7. Pilot readiness — pendientes antes del GO con pacientes reales

1. ~~Cerrar el recovery real de Josué (§1)~~ — **✅ hecho 2026-08-13.**
2. ~~Retirar el Test Phone de `operations_admin` (§2, §3)~~ — **✅ hecho 2026-08-13.**
3. Cerrar **LEGAL-P0**: `/terminos` + aceptación del paciente (§6). **← siguiente**
4. **Booking E2E real controlado** — diseño congelado, ver §8.
5. Safeguard de saldo/recarga de Twilio (§5).
6. Higiene final de perfiles QA no publicables (§9).

**Billing automático NO bloquea el piloto. BILLING-P0 = PAUSED**, arquitectura
definida y persistida en `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md`, que es la
**única fuente canónica** de pagos/suscripción/facturación.

---

## 8. Booking E2E real — diseño congelado, NO ejecutado

Falta validar la combinación `booking → auth_creation_grant →
shouldCreateUser=true → Before User Created Hook → Turnstile → consentimiento →
Twilio Verify real → auth.users/profile → appointment`. La lógica se validó con
Test Phones y Twilio Verify se validó por separado; **falta la combinación**.

Reglas del diseño: médico **fixture efímero propio** (nunca Camilo, nunca el
médico QA persistente) · **un único SMS** · ventana mínima · nombre inequívoco de
QA · denylist antes del cleanup · `auth.users` **solo por Admin API** · cleanup
ordenado por la cadena de FKs · `otp_consent_events` y `audit_log` **preservados**.

> "Cero residuos" = cero **objetos funcionales** de fixture. Las filas de
> `audit_log` generadas legítimamente por la creación y el cleanup son **trazas
> esperadas** y se conservan.

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
**no** necesita estar en Test Phones. Sigue **publicado** en producción y
**debe despublicarse antes del lanzamiento comercial**.

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
**No hay frente funcional activo** (post-#329). El siguiente pendiente es
**LEGAL-P0** (§6) y **no se abre sin instrucción expresa**. **No reabrir
Auth/recovery salvo un incidente nuevo con evidencia propia.**
