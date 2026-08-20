# HANDOFF LucyCare — nueva ventana (2026-08-18)

> 🗂️ **HISTÓRICO / SUPERSEDED (2026-08-20).** Este documento **ya no es la
> fuente canónica**: lo reemplaza
> `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-20.md`. Se conserva como registro
> del estado al 2026-08-18 y **no debe borrarse**. Lo que quedó superado está
> listado en la §9 del handoff vigente: el HEAD y los PRs (hasta #340 aquí, hasta
> #346 hoy), el "próximo candidato" **PASSWORD-ERROR-COPY-P0** y la deuda de
> **`NotificationBell`** —ambos ya CERRADOS— y la cifra del bundle. El resto de
> este documento sigue siendo correcto.
>
> ---
>
> 🟢 **PUNTO DE ENTRADA CANÓNICO Y VIGENTE** *(al 2026-08-18)*. Autosuficiente: no
> asume que la ventana nueva conozca ninguna conversación anterior. Reemplaza a
> `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-12.md`, que pasa a **histórico**
> junto con todos los anteriores. El detalle por PR de los frentes cerrados vive
> en `docs/HISTORIAL_FRENTES.md`.
>
> **Este documento no contiene** OTPs, contraseñas, tokens, `service_role`,
> claves ni enlaces con credenciales. Los teléfonos aparecen **solo como
> identificadores operativos**, nunca junto a su código.

---

## 0. Estado del repositorio y de producción

| Ítem | Valor |
|---|---|
| Repo | `github.com/amedelvalle/lucycare` |
| Local | `C:\Users\admic\lucycare` |
| Dominio productivo | `https://lucycare.app` |
| Branch | `main` |
| **Último HEAD funcional** (previo al handoff documental) | **`4be10118f9e6e6039fea1cbe6fb2e8f4c90270fb`** (#340) |
| Subject de ese HEAD | `copy(legal): la entidad operadora pasa de Valux a Divalux (#340)` |
| **SHA vigente del repo** | consultar con `git rev-parse HEAD` — **cambia con cada PR docs-only y no refleja cambio funcional** |
| `main == origin/main` | sí |
| Árbol | limpio |
| PRs abiertos | **0** al momento del preflight previo a **#341** |
| **Migraciones** | **93 archivos**, versionadas y aplicadas hasta **`s7_72_review_token_short_code.sql`** |
| Vercel producción | deployment de `4be1011` = **success**; contenido verificado contra el dominio. Los PRs docs-only redespliegan el **mismo bundle funcional** |
| **Piloto** | **GO** |
| Frentes funcionales abiertos | **ninguno** |

**Último cambio funcional relevante:** **#340** (renombre de la entidad
operadora, `src/` — copy). Antes: **#338** (`s7_72`, la única migración
reciente) y **#337** (copy del login).

**PRs docs-only recientes**, que mueven el SHA sin alterar estado funcional:
**#336** (reconciliación documental) y **#339** (fix de tooling + docs).

> ⚠️ **Regla de lectura de SHAs:** un PR docs-only cambia el SHA del
> repositorio pero **no** el estado funcional, las migraciones ni la
> configuración. El SHA vigente se consulta siempre con `git rev-parse HEAD`.
>
> ℹ️ **Este handoff se publicó mediante el PR #341, que es 100% docs-only.** Su
> merge **cambia el SHA del repositorio** pero **no altera el estado funcional,
> las migraciones, la DB, la configuración ni producción**. Por eso `4be1011`
> figura arriba como **último HEAD funcional**, no como SHA vigente: al leer
> este documento, el SHA del repo ya será posterior.

---

## 1. Cómo arrancar

```bash
git fetch origin --prune
git checkout main
git pull --ff-only origin main
git log --oneline -10
gh pr list --state open
```

Leer en orden: **1)** `CLAUDE.md` (guía rápida) · **2)** este handoff (fuente
canónica del estado) · **3)** el `docs/ANALISIS_*.md` del eje del día.

**INSTRUCCIÓN 0: no iniciar ningún frente ni cambio sin instrucción del owner.**
Al momento de escribir este handoff **no hay ningún frente funcional abierto**.
El próximo candidato recomendado es **PASSWORD-ERROR-COPY-P0** (§12), que **no
está abierto**.

---

## 2. Reglas operativas VINCULANTES

- **El owner decide; el developer ejecuta instrucciones cerradas.**
- **Un solo frente funcional a la vez.**
- **No mergear sin autorización explícita** del owner, PR por PR.
- **No ejecutar SQL de escritura sin autorización.** El owner aplica el SQL en
  el SQL Editor de Supabase; el dev escribe la migración y corre los
  `check`/`smoke`.
- **`service_role` requiere autorización explícita, incluso read-only.**
- **No tocar migraciones, configuración, hooks ni producción sin autorización.**
- **`auth.users`: JAMÁS por SQL.** Siempre Supabase Admin API.
- **Jamás Katherine (`50372608827`)**, ni siquiera en read-only.
- **Camilo es perfil demo/QA controlado** — ver §9.
- **No alterar Test Phones incidentalmente.**
- **Turnstile permanece ACTIVO.** No desactivarlo ni reconfigurarlo.
- **No exponer ni documentar** OTPs, contraseñas, tokens, `token_hash`,
  `service_role`, claves ni enlaces con credenciales.
- **Copy en tuteo, nunca voseo.** Copy público en español, sin anglicismos
  ("agenda en línea", no "booking").
- **Máximo rigor en Auth, DB y seguridad.** El frontend visual y reversible
  puede moverse más rápido.
- **Evitar cambios incidentales fuera del alcance autorizado.**
- **No afirmar que una prueba fue ejecutada si solo se revisó código.**
- **Validar el instrumento, no solo el fix:** medir también contra el estado
  anterior (A/B). Un check que solo pasa "después" no prueba nada.
- **PR que toca DB → migración + `check-s7_NN.mjs` + `_smoke-s7_NN.mjs`.**
- **Para cambios de UI:** pedir preview / OK visual del owner antes de mergear.
- **No mezclar** SEO / Analytics / Auth / Clínico / DB en un mismo PR.
- **Cierre estándar tras cada merge:** HEAD, PRs, migraciones,
  `main == origin/main`, `git status` vacío, rama borrada local+remoto, sin
  residuos (previews, servidores, fixtures, scripts temporales).

### Notas de método que ahorran tiempo

- **Smokes SQL:** no usar tablas temporales en el SQL Editor (`42P01` por
  `search_path`; `3F000` porque `pg_temp` no resuelve hasta que la sesión
  materializa su esquema temporal). Patrón vigente: variable + `set_config` /
  `current_setting` dentro de `BEGIN … ROLLBACK`.
- **Migraciones:** envolver en **transacción explícita** (`BEGIN; … COMMIT;`)
  con guardas PRE/POST bloqueantes. El DDL de PostgreSQL es transaccional: si
  una guarda falla, el rollback es total. Esto ya salvó una aplicación fallida
  (`s7_72`, error `42883`).
- **`CREATE OR REPLACE FUNCTION`** conserva owner, grants y el `tgfoid` del
  trigger. Verificar el OID en el POST prueba que se reemplazó y no se recreó.
- **`.gitignore`:** la regla `*.sql` solo exceptúa `!migrations/*.sql`. Todo
  rollback nuevo bajo `docs/rollbacks/` requiere `git add -f` o queda fuera del
  PR en silencio.

---

## 3. Piloto = GO — preparación cerrada

**GO/NO-GO final: 2026-08-14, cero FAIL bloqueantes.** Todas las deudas
vigentes son WARN (§12).

| Frente | Estado | Evidencia resumida |
|---|---|---|
| **RECOVERY-EMAIL-P0** | CLOSED | recovery real por email PASS end-to-end. El fix fue #327: `useIdleLogout` dejó de reaccionar a `TOKEN_REFRESHED`, que realimentaba `refresh() → getSession()` y podía agotar el rate limit de Auth (el `429` **no es reintentable** para auth-js, que borra la sesión y hace que `/reset-password` muestre falsamente "link expirado"). **No reabrir salvo incidente nuevo con evidencia propia.** |
| **ADMIN-JUNIOR** | CLOSED (#329) | el backend ya soportaba `operations_admin`; fallaba **solo la navegación**. `destinationAfterLogin()` consulta la misma RPC del guard (`my_lucyadmin_access`) e ítem "Ir a LucyAdmin" en `PatientAccountMenu`. La RPC **no corre para anónimos**. |
| **TESTPHONE-CLEANUP-P0** | CLOSED | `50377507479` retirado de Test Phones; login posterior por email+contraseña PASS. Quedan **exactamente 2** Test Phones. |
| **LEGAL-P0** | CLOSED (#331/#332/#333) | ver §8 |
| **Booking E2E real** | **PASS** | ver §5 |
| **Nombre del paciente nuevo** | CLOSED (#334) | ver §5.3 |
| **Safeguard de saldo Twilio** | CLOSED | ver §6 |
| **Higiene de perfiles QA** | CLOSED | único perfil QA público despublicado; ver §9 |
| **CALIFICACIÓN-COPY-P0** | CLOSED (#335) | ver §7.1 |
| **LOGIN-FIRST-TIME-COPY-P0** | CLOSED (#337) | ver §4 |
| **RATING-URL-P0** | CLOSED (#338/#339, `s7_72`) | ver §7.2 |
| **LEGAL-ENTITY-RENAME-P0** | CLOSED (#340) | ver §8.2 |

**Matriz del GO (2026-08-14):** producción desplegada · Home/directorio ·
perfil y Booking de Camilo · Auth/login con contraseña · recuperación por email
· OTP real con Twilio Verify · Turnstile · Booking E2E real · "Mis atenciones"
· panel médico y notificaciones · Legal · perfiles QA públicos · safeguard de
saldo. **Todo PASS.**

### 3.1 Riesgos a vigilar durante el piloto

- **El SMS es el único camino de alta de pacientes.** Si Twilio falla, se cae la
  adquisición completa y el usuario solo ve "no pudimos enviarte un código". La
  alerta de saldo cubre el saldo, no una caída del proveedor.
- **El E2E validó un caso, no una distribución:** un teléfono, un médico, un
  horario, sin concurrencia. Apropiado para un piloto controlado de 5 médicos;
  **no es certificación de escala.**

---

## 4. Auth / Login — estado vigente

| Ítem | Estado |
|---|---|
| Login genérico | **`shouldCreateUser=false`** — decisión de producto **congelada** |
| Signup genérico | **DESHABILITADO** — ningún flujo público crea cuentas fuera de la reserva |
| Booking | **`shouldCreateUser=true`** + `auth_creation_grant` |
| Before User Created Hook | **ACTIVO** (`s7_65`) |
| Turnstile | **ACTIVO** en producción y configurado en Preview |
| Twilio Verify | **ACTIVO** (§6) |
| Login por teléfono + contraseña | vigente; **no consume SMS** |
| Recuperación por email | validada end-to-end |

**Un paciente nuevo crea su acceso únicamente desde el flujo de reserva**, donde
existen `booking_intent` y `auth_creation_grant`. La contraseña es **obligatoria**
tras el OTP: por eso un paciente consume SMS **una sola vez en su vida** y sus
reservas siguientes entran por `signInWithPhonePassword`, sin costo.

### 4.1 Copy vigente cuando el login no puede continuar (#337)

Cuando el login genérico apunta a un teléfono sin cuenta, GoTrue responde
`otp_disabled` ("Signups not allowed for otp") y **no envía ningún SMS**. El
mensaje visible es:

> **"¿Primera vez en LucyCare? Reserva una cita para crear tu acceso. Si ya
> tienes cuenta, verifica tu número e inténtalo de nuevo."**

Vive en `NO_ACCOUNT_LOGIN_MESSAGE` (`src/services/auth.service.ts`). Conserva el
criterio **anti-enumeración**: no afirma que el número no exista ni confirma si
hay identidad; sirve igual para "primera vez" y para "número mal tipeado".

**PR #337 = MERGED.** Una sola cadena; `shouldCreateUser=false` intacto,
verificado con `scripts/check-auth-p1b2a-login-gating.mjs` → **15/15 PASS**.

> ⚠️ **Trampa conocida al hacer QA de Auth:** entrar por "Iniciar sesión" del
> header es el flujo **genérico** y nunca enviará SMS a un número sin cuenta.
> Para probar el alta hay que entrar **por la reserva**, con servicio, fecha y
> horario ya seleccionados.

### 4.2 Orden VINCULANTE al tocar el CAPTCHA

El frontend debe estar enviando tokens **antes** de que Supabase los exija.
Frontend ON + Supabase OFF = inofensivo (GoTrue ignora el token).
**Supabase ON + frontend OFF = caída total de Auth.** Para desactivar, el orden
es el inverso: apagar el enforcement en Supabase primero, y recién después
quitar `VITE_CAPTCHA_ENABLED` y redeployar.

Consecuencia vigente: el **cambio de teléfono sigue SUSPENDIDO**
(`PHONE_CHANGE_SUSPENDED = CAPTCHA_ENABLED`, porque `updateUser({phone})` no
admite `captchaToken`).

---

## 5. Booking E2E real — ✅ PASS (2026-08-14). **NO REPETIR**

Validada **en producción** la cadena completa, con **un único SMS real**:

```
booking_intent → auth_creation_grant → consentimiento OTP → Turnstile →
Twilio Verify (SMS real) → Before User Created Hook → auth.user →
contraseña obligatoria → login → patient → appointment → intent consumido
```

### 5.1 La ruta del grant, demostrada por descarte

En el instante exacto de la creación del `auth.user`, de las cinco ramas que
`hook_before_user_created` puede usar, **solo el grant estaba disponible**: las
otras cuatro (`patients`, `doctors`, `clinic_invitations`,
`platform_admin_invitations`) estaban **vacías** para ese teléfono. Es prueba
por descarte, no inferencia. La identidad se verificó **nueva** por timestamps.

### 5.2 Cleanup y evidencia

Cleanup en el orden que imponen las FKs — `auth_creation_grants` →
`booking_intents` → `appointments` → `patients` → identidad **solo por Admin
API** — con denylist previa de identidades protegidas. **Cero residuos
operativos** verificados.

**Preservados como evidencia:** `otp_consent_events` y `audit_log`. Este último
es además **imborrable**: tras `s7_71b`, `service_role` solo tiene `SELECT`.

> "Cero residuos" = cero **objetos funcionales** de fixture. Las filas de
> auditoría y consentimiento son **trazas esperadas** y se conservan.

**Ventana operativa:** el intent y el grant tienen **TTL de 15 minutos**. Ese
reloj debe cubrir recibir el SMS, escribir el código, **crear la contraseña** y
completar la reserva. En el E2E real se usó 1 min 37 s.

### 5.3 Hallazgo que produjo el E2E → corregido en #334

El paciente creado por OTP nacía con `profiles.full_name` vacío y la reserva
caía al fallback `|| user.phone`: **la ficha en la clínica del médico quedaba
con el número de teléfono como nombre**. Corregido en `BookingCard`, sin
migración ni backend:

- Se pide **"Nombre completo"** *solo* cuando el perfil no lo tiene
  (obligatorio, `trim`, máximo 150 = tope `P009I` de la RPC).
- Se guarda **primero** con `updateMyProfile()`; **solo si eso pasa** se llama a
  `createBookingWithIntent`. Si el guardado falla, **no se crea la cita** y el
  horario sigue vigente.
- Persistirlo en `profiles.full_name` es lo que **evita volver a preguntarlo**:
  `AuthUser.name` sale de esa columna.
- **Protecciones:** el paso se descarta si cambian servicio, fecha u horario, y
  un **guard de concurrencia** impide reservar con un intent obsoleto si la
  selección cambia mientras `updateMyProfile` está en vuelo.

---

## 6. Twilio — estado vigente

> ⚠️ Reportado y verificado **por el owner en la consola**. No es medible desde
> el repositorio: el entorno no tiene credenciales de Twilio.

| Ítem | Estado |
|---|---|
| Cuenta | **Paid** |
| Verify Service "LucyCare" | activo · **SMS only** · OTP 6 dígitos |
| **Fraud Guard** | activo |
| **Geo Permissions** | **solo El Salvador** |
| Saldo | recargado para el piloto (~US$50 al cierre del GO) |
| **Balance notification** | **US$25** |
| **Auto Recharge** | **OFF — decisión deliberada del piloto, no una deuda** |
| Costo observado | **~US$0.349** por verificación exitosa de un solo SMS (US$0.05 Verify + US$0.299 SMS El Salvador) |

**Única tarea operativa viva del piloto: vigilar saldo y disponibilidad del
proveedor.** Sin saldo no hay OTP, y el OTP es el único camino de alta de
pacientes nuevos. El fallo es **silencioso** para el owner: el paciente solo ve
"no pudimos enviarte un código".

**Modelo de consumo (derivado del código):** el gasto escala con **pacientes
nuevos**, no con reservas. También consumen los reenvíos de código y los
reclamos de perfil médico. Los Test Phones no consumen.

**Prohibiciones:** no revertir de Twilio Verify a Programmable Messaging, ni
reconfigurar el Verify Service, Geo Permissions, Fraud Guard, canales o
credenciales, **sin autorización explícita del owner**.

---

## 7. Calificaciones

### 7.1 Copy vigente (#335)

La página `/calificar/:token` conserva el diseño aprobado. Copy vigente:

- Subtítulo: *"Tu opinión es confidencial y completar la calificación toma menos
  de un minuto."*
- NPS: *"¿Recomendarías a este médico a un familiar o amigo?"*
- Footer: *"LucyCare · Calificación de la atención"*

Título *"¿Cómo fue tu atención?"*, estrellas, escalas, NPS 0–10, comentario
opcional y CTA "Enviar calificación" **sin cambios**.

### 7.2 URL corta — RATING-URL-P0 CLOSED (`s7_72`, #338 + #339)

La URL que recibe el paciente pasó de **64 caracteres hexadecimales** a
**20 caracteres Crockford Base32**:

```
antes:  /calificar/42b8edecf723481bb784b6943836c7a4f2bb3d058ca04918bc40b873eedd7c03
ahora:  /calificar/GMNSKTKWPKYK2KACEJFW
```

**`s7_72` es la migración 93 y está aplicada en producción.** Crea el helper
`public._review_short_code()` y reemplaza **solo la expresión del token** dentro
de `generate_review_token()`.

| Propiedad | Valor |
|---|---|
| Longitud | 20 caracteres |
| Alfabeto | Crockford Base32 `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (sin I, L, O, U) |
| Entropía | **100 bits exactos** (20 × 5) |
| Fuente | `gen_random_uuid()` → `pg_strong_random` (CSPRNG nativo) |
| Uniformidad | `byte % 32`, **por construcción** (256 = 8 × 32): sin módulo bias ni rejection sampling. Se descartan los bytes 6 y 8 de cada UUID (bits fijos de version/variant) |
| Uso | **único** (`used_at`) |
| Expiración | **7 días** |

**Compatibilidad:** los enlaces de **64 caracteres ya emitidos siguen
funcionando** hasta usarse o vencer. `submit_review` **no se tocó** y sigue
comparando `token = p_token` por igualdad exacta. **Sin backfill.**

**Sin cambios** en `submit_review`, `get_review_link`, el esquema o índices de
`review_tokens`, el trigger, la ruta `/calificar/:token`, el frontend, el
middleware, el SEO ni Analytics.

**El helper está acotado:** ACL `postgres=X/postgres` — **sin EXECUTE** para
`PUBLIC`, `anon`, `authenticated` ni `service_role`. Los grants de
`generate_review_token()` quedaron **byte a byte** como antes.

**Verificación:** PRE 16/16 · aplicación en transacción explícita con COMMIT ·
POST de catálogo y permisos 15/15 · **10 000 generaciones, 10 000 únicas**, 32
símbolos presentes, desvío máximo 2.82 % (~2.2σ: uniforme) · sin backfill ·
**`check-s7_72` 81/81 PASS** · **`_smoke-s7_72` 5/5 PASS**.

Guía operativa: `docs/OWNER_S7_72_APPLY.md` (tres pasos con valores esperados) y
`docs/OWNER_S7_72_SMOKE.md`.

> ⚠️ **Aprendizaje:** el primer intento de aplicar falló con `42883`
> (`name[] = text[]`: faltaba `attname::text` en las guardas UNIQUE). La
> transacción explícita hizo su trabajo — **rollback total, nada quedó a
> medias**.

---

## 8. Legal

### 8.1 Documentos publicados — LEGAL-P0 CLOSED (#331/#332/#333)

- **`/terminos`** y **`/privacidad`** publicados con los documentos definitivos
  del owner (**Versión 1.0 · última actualización julio de 2026 · entrada en
  vigor julio de 2026**), reproducidos sin resumir ni parafrasear.
- **`TOS_VERSION = 'tos-2026-08-13'`** para las aceptaciones **nuevas** del
  claim. El identificador es **técnico y NO se imprime en la UI**.
- **Línea legal discreta** bajo el CTA de `BookingCard`: *"Al reservar, aceptas
  los Términos y Condiciones y reconoces la Política de Privacidad"*, con
  enlaces a ambos documentos en pestaña nueva. `MobileBookingSheet` reutiliza
  `BookingCard`: móvil cubierto sin segunda implementación.

**Reglas vigentes:**

- **Las aceptaciones históricas `v1.0` NO se reinterpretan ni se migran:** se
  firmaron contra un documento que no estaba publicado.
- **`CONSENT_VERSION` de `AffiliationRequestModal` queda en `v1.0` y es otra
  cosa:** versiona el **consentimiento LOPD** del lead
  (`doctor_affiliation_requests.consent_version`, `s7_21`), no la Política de
  Privacidad. Verificado en código.
- **`otp_consent_events` no se usa para evidencia legal del booking**, y
  `otp-consent-v1` no se modifica.
- **PR 3 / evidencia explícita del paciente en DB = DIFERIDO** por decisión del
  owner: sin columnas en `appointments` ni cambios en
  `create_booking_with_intent`. **No bloquea el piloto.** Si se retoma,
  `booking_intents` **no sirve** como soporte probatorio (TTL 15 min,
  `service_role` only, se consume, existe antes de que haya usuario).

### 8.2 Entidad operadora: **Divalux** — LEGAL-ENTITY-RENAME-P0 CLOSED (#340)

**Decisión vigente del owner:** la entidad responsable/operadora de LucyCare es
**Divalux**, y donde corresponda la razón social completa, **Divalux, S.A. de
C.V.**

Se modificaron **5 referencias user-facing** (3 en `/terminos`, 2 en
`/privacidad`). Verificado en producción: **`Valux` vigente = 0** ·
**`Luxvalle` = 0** · `Divalux` = las 5 referencias legales.

**No se modificó** `TOS_VERSION`, aceptaciones históricas, DB, RPC, migraciones,
lógica ni configuración. La marca **LucyCare** no cambia.

> **No volver a presentar Valux como entidad vigente.** El trámite societario de
> Divalux es responsabilidad del owner y queda **fuera del frente técnico**.

---

## 9. Identidades — protegidas y de QA

### 9.1 Camilo — perfil demo/QA controlado

| Campo | Valor |
|---|---|
| `profile_id` / `auth.users` | `db1fba98-a299-4f25-82f1-7feff01e58fa` |
| `doctor_id` | `783a902a-55fd-407c-9e0a-69568135c7f5` |
| `clinic_id` | `8ea0fd8f-87a9-45f9-8f4e-f358764f58c0` |
| Teléfono | `50378056365` — **Test Phone QA** |
| Email | `carlosmartinezddv@gmail.com` |
| Slug público | `dr-camilo-carrillo` |

**Estado vigente: publicado, activo, `verified`, operativo y con Booking
habilitado.** Es el **único médico del directorio con agenda en línea**.

El owner **actualizó manualmente sus datos públicos** para que funcione como
perfil demostrativo presentable: clínica **"Clinica Camilo"** con dirección
cargada, 3 servicios activos de **30 minutos** cada uno (Consulta general $30,
Consulta de seguimiento $50, Atencion holistica $40) y horarios disponibles.
La antigua observación sobre la clínica llamada "Pepe" está **RESUELTA** y **no
es una deuda activa**.

> **No modificar su identidad, Auth ni configuración técnica sin autorización.**
> Los cambios de datos públicos los hace el owner desde LucyAdmin.

**Cuidado operativo:** al ser el único bookable, ocupar su agenda con datos de
prueba **bloquea reservas reales**.

### 9.2 Médico QA persistente — despublicado

| Campo | Valor |
|---|---|
| `profile_id` / `auth.users` | `b5865737-1c7b-4fd1-bd70-b9e5befd87ed` |
| `doctor_id` | `ac0ba772-4263-4fb2-a146-dd90033d8c76` |
| `clinic_id` | `8b24611d-6b7d-4f2c-bbf5-ec53f5c4bded` |
| Teléfono | `50370008803` (ya **no** es Test Phone) |
| Email | `asp0.qa.doctor@lucycare.test` |

**`is_published = false` desde 2026-08-14.** Salió de Home/directorio y del
sitemap; la URL directa responde `noindex,follow` **sin exponer datos**. La
identidad **se conserva íntegra**: solo cambió ese flag.

**Identidad protegida: no borrar ni modificar sin autorización expresa.**
Al estar despublicado y no ser reservable, es el destino natural para QA que
necesite comportamiento real de base sin afectar la conversión.

### 9.3 LucyAdmin master

| Campo | Valor |
|---|---|
| `user_id` | `739cac58-4ad2-4efe-9fbf-91921e208b8f` |
| Teléfono | `50378627694` — **no es Test Phone** |
| Email | `lucycare.digital@gmail.com`, confirmado |
| `profiles.role` | `admin` — **única cuenta con ese rol** |

### 9.4 `operations_admin` (Josué)

| Campo | Valor |
|---|---|
| `user_id` / `profile_id` | `791e7d0b-8d6d-43db-8a43-95025d81581e` |
| Email | `josuediazdelvalle27@gmail.com` |
| Teléfono | `50377507479` — **ya NO es Test Phone** |
| `profiles.role` | **`patient`** — correcto, **no se eleva** |
| `lucyadmin_access` | **`operations_admin`**, activo |
| Vía de acceso | **email + contraseña**; no depende de SMS |

Niveles anidados por rango (`s7_57`): `directory_editor(1) ⊂
operations_admin(2) ⊂ admin`. Aterriza en `/admin/medicos`, su única sección.
**No** convertir a `role='admin'`, **no** ampliar privilegios, **no** usar la
pantalla de invitación de Administradores con esta persona.

### 9.5 Test Phones — exactamente 2

| Teléfono | Rol | Estado |
|---|---|---|
| `50378056365` | Camilo QA | **KEEP** |
| `50378626108` | Paciente QA | **KEEP** |

**Los OTP fijos no se documentan en el repositorio.** Retirar un Test Phone no
elimina identidades ni datos: es configuración de GoTrue.

> ⚠️ Un número fuera de la lista que intente OTP por teléfono consume **SMS real
> de Twilio Verify**.

### 9.6 Katherine

**`50372608827` — JAMÁS usar**, ni siquiera en read-only.

---

## 10. Directorio — regla D1

**Un médico puede tener `is_published=true` y aun así no aparecer en el Home.**
El filtro de **completitud mínima D1** (`src/services/directory.service.ts`)
exige cuatro campos: `full_name` + especialidad + `clinic.name` +
`clinic.address`.

**Caso conocido y esperado:** al cierre del GO había **36** publicados en la
base y **35** en el Home. El excluido es **Dr. Abraham Alfredo Amaya Mendoza**
(`fe7f4f9c-1ffd-4af6-954d-41c9cdc9aa02`), cuya clínica **no tiene dirección**.
Verificado también con el cliente `anon`: **la RLS no oculta a nadie**.

**Matiz intencional:** D1 gobierna el **listado**, no el sitemap.
`isSitemapEligible` **no exige ubicación**, así que ese perfil sí está indexado
y es alcanzable por enlace directo. Para incorporarlo al directorio basta
cargarle la dirección desde LucyAdmin. **No se modifica en este ciclo.**

---

## 11. SEO / Search Console — frente comercial permanente

Google Search Console está verificado y el sitemap (`lucycare.app/sitemap.xml`)
enviado y procesado. Los archivos de verificación
(`public/google3f2e02a3c176b538.html`, `public/googlef334c08cb9e5d942.html`) son
**permanentes: no borrar**.

Es un **frente comercial permanente**, no un frente técnico puntual. Métricas a
seguir: clics · impresiones · CTR · posición media · consultas · páginas ·
países · dispositivos · evolución temporal. El export previo de Search Console
sirve como línea base.

**Seguimiento pendiente, no bloqueante:** el perfil QA estuvo publicado e
indexable antes de despublicarse; ya sirve `noindex,follow` y saldrá del índice
al próximo rastreo. "Eliminación de URLs" en Search Console lo acelera.

Analytics: `@vercel/analytics` + Speed Insights, **cookieless**, con allowlist
`/` · `/doctor/*` · `/privacidad` · `/terminos` y `beforeSend` como backstop.
**Jamás PII ni texto libre de búsqueda.**

---

## 12. Pendientes — ninguno bloquea el piloto

### 🔴 Bloqueantes

**Ninguno.**

### 🟡 Próximo candidato recomendado

**`PASSWORD-ERROR-COPY-P0`** — traducir al español los mensajes crudos de
Supabase relacionados con contraseña, que todavía pueden aparecer en inglés.
Caso observado: `New password should be different from the old password.` →
copy aprobado: **"La nueva contraseña debe ser diferente de la contraseña
anterior."** Revisar creación, cambio y recuperación. Tuteo.

> **NO está abierto.** Requiere instrucción expresa del owner.

### 🟠 WARN — registrados, sin resolver

| Deuda | Nota |
|---|---|
| **`NotificationBell`** | cerrar el popover con Escape y devolver el foco al botón (a11y). Quedó explícitamente fuera de #311 |
| **Bundle inicial ~666 kB** | las dos páginas legales viajan en el chunk inicial por la convención del router (rutas públicas/SEO estáticas). El arreglo sería `lazy()` en ambas; **el owner decidió no hacerlo ahora** |
| **Admin API `listUsers`** | `Database error finding users` persistente en la cola del listado (~15 de ~140 usuarios ilegibles) y `?filter=` **no busca por teléfono** (devuelve 0 para números que sí existen → **falsos limpios**). No afecta el runtime de Auth, solo scripts de administración. Para buscar un teléfono, usar la búsqueda del Dashboard |
| **Seguimiento SEO / Search Console** | §11 |
| **Entregabilidad de correo** | SPF/DKIM/DMARC + plantilla de Supabase/Resend |
| **`cancel_reasons`** | tabla legacy no versionada en `migrations/`; falta razón genérica "Otro motivo" |
| **UX del widget de Turnstile en móvil** | cosmético |
| **Tres funciones `_func` huérfanas** | `audit_consultations_func`, `audit_patients_func`, `audit_prescriptions_func`: `SECURITY DEFINER`, no versionadas, sin trigger asociado. Código muerto; no son vector |
| **Debt de `search_path`** | ocho funciones escritoras de `audit_log` sin `SET search_path`. Heredan el del caller; documentado en `s7_66` |

### 🔵 Post-piloto / diferidos con precondiciones

| Frente | Nota |
|---|---|
| **PILOT-OPS-P0** | preparación operativa del piloto; se abre con el primer médico inscrito (§13) |
| **F1-c2 · DROP de `doctors.license_number`** | **irreversible**. No abrir sin: sincronía fresca, respaldo, preflight con `service_role` y autorización del owner. F1-c1 (retiro lógico) ya está cerrado |
| **BILLING-P0** | **PAUSADO**, fuera del piloto y **no bloqueante**. Arquitectura definida en `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md`, **única fuente canónica** de pagos/suscripción/facturación. Proveedor **no elegido** |
| **PR 3 — evidencia legal del paciente** | diferido (§8.1) |
| **Identidad múltiple Fase 2** | selector "modo paciente / modo médico" |

### AGENDA-DENSITY-QA-P0 — analizado y **NO ejecutado**

Se evaluó poblar la agenda de Camilo con 20 pacientes y 20 citas sintéticas para
QA de densidad. **Se decidió NO hacerlo.** Razón principal: Camilo es el único
médico bookable del directorio, así que llenar su agenda **bloquea reservas
reales**; además, cada fila crearía trazas **imborrables** en `audit_log`.

**No se creó ningún paciente ni cita, no hubo SQL y no quedaron residuos.**
Alternativas recomendadas si se retoma: harness local con datos mockeados
(precedente del repo, riesgo cero) o, si hace falta comportamiento real de base,
usar el **médico QA persistente despublicado** (§9.2).

**No es un frente abierto.**

---

## 13. Piloto operativo

- **El owner está reclutando médicos para el piloto.** Ese proceso **no es razón
  para frenar el desarrollo**.
- **Cuando se inscriba el primer médico** se abrirá y ejecutará el protocolo
  operativo correspondiente (**PILOT-OPS-P0**).
- **Mientras tanto pueden avanzarse frentes pequeños, reversibles y no
  bloqueantes**, siempre con autorización del owner y uno a la vez.
- **No inventar médicos participantes ni resultados del piloto.** A la fecha de
  este handoff no hay resultados de piloto que reportar.

---

## 14. Documentación vigente

| Documento | Rol |
|---|---|
| `CLAUDE.md` | Guía rápida. Si contradice a `docs/`, mandan los `docs/` |
| **`docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-20.md`** | **Fuente canónica del estado** (reemplazó a este documento) |
| Este handoff (`2026-08-18`) | **Histórico** — ver el banner del encabezado |
| `docs/HISTORIAL_FRENTES.md` | Detalle por PR de los frentes cerrados |
| `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md` | **Única fuente canónica de BILLING** |
| `docs/OWNER_S7_72_APPLY.md` · `docs/OWNER_S7_72_SMOKE.md` | Aplicación y verificación de `s7_72` |
| `docs/OWNER_S7_71A_APPLY.md` · `docs/OWNER_S7_71B_APPLY.md` | AUDIT-SEC-P0 |
| `docs/ESTADO_TECNICO.md` | ER/BD, matriz de reglas, flujos UI/UX |
| `docs/ANALISIS_*.md` | Un eje cada uno; **no re-analizar** lo ya firmado |
| `docs/rollbacks/` | **NO ejecutar** |
| `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-12.md` y anteriores | **Históricos**, menor precedencia. **No borrar** |

---

## 15. Seguridad — estado consolidado

**AUDIT-SEC-P0 = CLOSED.** `audit_log` sin policies, `anon`/`authenticated` sin
privilegios, **`service_role` solo `SELECT`**, `_admin_log_doctor_change`
cerrado, escritor de frontend eliminado.

> ⚠️ **El histórico anterior al corte NO es evidencia infalsificable.** Hasta
> `s7_71b`, `audit_log` admitía escritura arbitraria: esas filas son trazas
> operativas observadas, no prueba de no-repudio.

**RLS** en todas las tablas. `service_role` solo en scripts admin vía
`.env.local`, **nunca en frontend**. `profiles` con RLS column-level (anon solo
ve `id`, `full_name`, `avatar_url` de publicados).

**Canal público temporal: `lucycare.digital@gmail.com`.** No usar
`hola@lucycare.app` mientras no exista.
