# HANDOFF LucyCare — nueva ventana (2026-08-20)

> 🟢 **PUNTO DE ENTRADA CANÓNICO Y VIGENTE.** Autosuficiente: no asume que la
> ventana nueva conozca ninguna conversación anterior. Reemplaza a
> `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-18.md`, que pasa a **histórico**
> junto con todos los anteriores. El detalle por PR de los frentes cerrados vive
> en `docs/HISTORIAL_FRENTES.md`.
>
> **Este documento no contiene** OTPs, contraseñas, tokens, `token_hash`,
> `service_role`, claves ni enlaces con credenciales. Los teléfonos aparecen
> **solo como identificadores operativos**, nunca junto a su código.

---

## 0. Estado del repositorio y de producción

| Ítem | Valor |
|---|---|
| Repo | `github.com/amedelvalle/lucycare` |
| Local | `C:\Users\admic\lucycare` |
| Dominio productivo | `https://lucycare.app` |
| Branch | `main` |
| **Último HEAD funcional confirmado** | **`159d3b235b631d12873ee492e184c813458d89bf`** — PR **#346** |
| Subject de ese commit | `copy(claim): CLAIM-COPY-HYGIENE-P0 — "enlace" y sin anglicismo en el reclamo (#346)` |
| **Tip vigente de `main`** | **consultar Git** (`git rev-parse HEAD`) — ver la nota de abajo |
| `main == origin/main` | sí, al momento de escribir este handoff |
| Árbol | limpio |
| PRs abiertos | **0**, al momento de escribir este handoff |
| **Migraciones** | **93 archivos**, versionadas y aplicadas hasta **`s7_72_review_token_short_code.sql`** |
| Vercel producción | deployment de `159d3b2` (#346) = **success**, verificado contra el dominio |
| **Piloto** | **GO** |
| Frentes funcionales abiertos | **ninguno** |

**Desde el handoff `2026-08-18` se cerraron 4 frentes funcionales mediante
5 PRs (#342–#346). Ninguno tocó DB, migraciones ni configuración.**

> ⚠️ **`159d3b2` es el último HEAD funcional confirmado, NO el tip eterno del
> repositorio.** Los commits posteriores **exclusivamente documentales no
> modifican este baseline funcional**: mueven el SHA de `main` pero no alteran el
> estado funcional, las migraciones, la DB, la configuración ni producción.
>
> **Para el tip exacto vigente de `main`, consultar Git:** `git rev-parse HEAD`.
> Si ese SHA es posterior a `159d3b2`, verificar qué lo movió: si son PRs
> docs-only, este handoff sigue describiendo el estado funcional correcto; si hay
> un PR **funcional** posterior, este documento quedó desactualizado y hay que
> reconciliarlo.
>
> ℹ️ **Este handoff se publica mediante un PR 100 % docs-only**, así que al leerlo
> el tip de `main` ya será posterior a `159d3b2`. Eso es esperado y no cambia
> nada de lo descrito acá.

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
Al momento de escribir este handoff **no hay ningún frente funcional abierto** y
**no hay un "próximo candidato" comprometido**: el backlog de §6 está clasificado
pero **cerrado a la espera de instrucción**.

---

## 2. Reglas operativas VINCULANTES

- **El owner decide; el developer ejecuta instrucciones cerradas.**
- **Un solo frente funcional a la vez.**
- **No mergear sin autorización explícita** del owner, PR por PR.
- **No ejecutar SQL de escritura sin autorización.** El owner aplica el SQL en el
  SQL Editor de Supabase; el dev escribe la migración y corre los `check`/`smoke`.
- **`service_role` requiere autorización explícita, incluso read-only.**
- **No tocar migraciones, hooks, configuración ni producción sin autorización.**
  Esto incluye **Supabase, Vercel, Cloudflare y Twilio**.
- **`auth.users`: JAMÁS por SQL.** Siempre Supabase Admin API.
- **No usar datos reales de pacientes para QA**, ni siquiera en read-only.
- **No tocar identidades protegidas** (§4). **Jamás Katherine (`50372608827`)**.
- **Camilo es perfil demo/QA controlado** y solo se usa bajo las reglas de §4.1.
- **No alterar Test Phones incidentalmente.**
- **Turnstile permanece ACTIVO.** No desactivarlo ni reconfigurarlo (§3.3).
- **No exponer ni documentar** OTPs, contraseñas, tokens, `token_hash`,
  `service_role`, claves ni enlaces con credenciales.
- **Copy en tuteo, nunca voseo** — regla editorial permanente. Copy público en
  español, sin anglicismos ("agenda en línea", no "booking"; "enlace", no "link").
- **Cambios pequeños y reversibles.** Máximo rigor en Auth, DB y seguridad; el
  frontend visual y reversible puede moverse más rápido.
- **Evitar cambios incidentales fuera del alcance autorizado.**
- **No inventar QA ni resultados.** No afirmar que una prueba fue ejecutada si
  solo se revisó código.
- **Validar el instrumento, no solo el fix:** medir también contra el estado
  anterior (A/B). Un check que solo pasa "después" no prueba nada.
- **PR que toca DB → migración + `check-s7_NN.mjs` + `_smoke-s7_NN.mjs`.**
- **Para cambios de UI:** pedir preview / OK visual del owner antes de mergear.
- **No mezclar** SEO / Analytics / Auth / Clínico / DB en un mismo PR.
- **Cierre estándar tras cada merge:** HEAD, PRs, migraciones,
  `main == origin/main`, `git status` vacío, rama borrada local+remoto, sin
  residuos (previews, servidores, fixtures, scripts o clones temporales).

### Notas de método que ahorran tiempo

- **Smokes SQL:** no usar tablas temporales en el SQL Editor (`42P01` por
  `search_path`; `3F000` porque `pg_temp` no resuelve hasta que la sesión
  materializa su esquema temporal). Patrón vigente: variable + `set_config` /
  `current_setting` dentro de `BEGIN … ROLLBACK`.
- **Migraciones:** envolver en **transacción explícita** (`BEGIN; … COMMIT;`) con
  guardas PRE/POST bloqueantes. El DDL de PostgreSQL es transaccional: si una
  guarda falla, el rollback es total. Ya salvó una aplicación fallida (`s7_72`,
  error `42883`).
- **`CREATE OR REPLACE FUNCTION`** conserva owner, grants y el `tgfoid` del
  trigger. Verificar el OID en el POST prueba que se reemplazó y no se recreó.
- **`.gitignore`:** la regla `*.sql` solo exceptúa `!migrations/*.sql`. Todo
  rollback nuevo bajo `docs/rollbacks/` requiere `git add -f` o queda fuera del
  PR en silencio.
- **Detección de voseo:** el `\b` de JavaScript **no** trata las vocales
  acentuadas como caracteres de palabra, así que `\bProbá\b` nunca casa y una
  aserción así queda **vacua**. Hay que tokenizar y comparar palabras completas.
  Además, una lista cerrada de verbos deja pasar **pronombres** (*"si **sos**"*)
  e **imperativos con enclítico** (*contactanos*, *Verificala*, *escribinos*).
- **QA de frontend sin sesión:** para superficies que exigen login se usa un
  **harness local con datos mockeados** (alias de Vite sustituyendo el hook de
  datos), nunca cuentas reales. El harness se borra al terminar.

---

## 3. Estado funcional vigente

### 3.1 Piloto = GO

**GO/NO-GO final: 2026-08-14, cero FAIL bloqueantes.** Matriz del GO, toda PASS:
producción desplegada · Home/directorio · perfil y Booking de Camilo · Auth/login
con contraseña · recuperación por email · OTP real con Twilio Verify · Turnstile ·
**Booking E2E real** · "Mis atenciones" · panel médico y notificaciones · Legal ·
higiene de perfiles QA · safeguard de saldo de Twilio.

**Nada de lo cerrado entre el 2026-08-18 y hoy cambió esa evaluación:** los cuatro
frentes fueron copy, accesibilidad y tooling de verificación.

**Riesgos a vigilar durante el piloto:**

- **El SMS es el único camino de alta de pacientes.** Si Twilio falla se cae la
  adquisición completa y el usuario solo ve "no pudimos enviarte un código". La
  alerta de saldo cubre el saldo, no una caída del proveedor.
- **El E2E validó un caso, no una distribución:** un teléfono, un médico, un
  horario, sin concurrencia. Apropiado para un piloto controlado de 5 médicos;
  **no es certificación de escala.**

### 3.2 Booking E2E real — ✅ PASS (2026-08-14). **NO REPETIR**

Validada **en producción** la cadena completa, con **un único SMS real**:

```
booking_intent → auth_creation_grant → consentimiento OTP → Turnstile →
Twilio Verify (SMS real) → Before User Created Hook → auth.user →
contraseña obligatoria → login → patient → appointment → intent consumido
```

**La ruta del grant quedó demostrada por descarte:** en el instante de la
creación, las otras cuatro ramas de `hook_before_user_created` (`patients`,
`doctors`, `clinic_invitations`, `platform_admin_invitations`) estaban **vacías**
para ese teléfono.

Cleanup en el orden que imponen las FKs, identidad **solo por Admin API**, con
denylist previa de identidades protegidas: **cero residuos operativos**.
`otp_consent_events` y `audit_log` **se preservaron como evidencia**; el segundo
es además imborrable (tras `s7_71b`, `service_role` solo tiene `SELECT`).

**Ventana operativa:** el intent y el grant tienen **TTL de 15 minutos**, que debe
cubrir recibir el SMS, escribir el código, **crear la contraseña** y completar la
reserva. En el E2E real se usó 1 min 37 s.

### 3.3 Auth / Login / Turnstile

| Ítem | Estado |
|---|---|
| Login genérico | **`shouldCreateUser=false`** — decisión de producto **congelada** |
| Signup genérico | **DESHABILITADO** — ningún flujo público crea cuentas fuera de la reserva |
| Booking | **`shouldCreateUser=true`** + `auth_creation_grant` |
| Before User Created Hook | **ACTIVO** (`s7_65`) |
| **Turnstile** | **ACTIVO** en producción y configurado en Preview |
| Twilio Verify | **ACTIVO** (§3.4) |
| Login por teléfono + contraseña | vigente; **no consume SMS** |
| Recuperación por email | validada end-to-end |

Un paciente nuevo crea su acceso **únicamente desde el flujo de reserva**. La
contraseña es **obligatoria** tras el OTP: por eso consume SMS **una sola vez en
su vida** y sus reservas siguientes entran por `signInWithPhonePassword`.

Copy vigente cuando el login genérico apunta a un teléfono sin cuenta (GoTrue
responde `otp_disabled` y **no envía SMS**):

> *"¿Primera vez en LucyCare? Reserva una cita para crear tu acceso. Si ya tienes
> cuenta, verifica tu número e inténtalo de nuevo."*

Vive en `NO_ACCOUNT_LOGIN_MESSAGE` (`src/services/auth.service.ts`) y conserva el
criterio **anti-enumeración**.

> ⚠️ **Trampa conocida al hacer QA de Auth:** entrar por "Iniciar sesión" del
> header es el flujo **genérico** y nunca enviará SMS a un número sin cuenta. Para
> probar el alta hay que entrar **por la reserva**, con servicio, fecha y horario
> ya seleccionados.

**Orden VINCULANTE al tocar el CAPTCHA:** el frontend debe estar enviando tokens
**antes** de que Supabase los exija. Frontend ON + Supabase OFF = inofensivo
(GoTrue ignora el token). **Supabase ON + frontend OFF = caída total de Auth.**
Para desactivar, el orden es el inverso: apagar el enforcement en Supabase
primero, y recién después quitar `VITE_CAPTCHA_ENABLED` y redeployar.

Consecuencia vigente: el **cambio de teléfono sigue SUSPENDIDO**
(`PHONE_CHANGE_SUSPENDED = CAPTCHA_ENABLED`, porque `updateUser({phone})` no
admite `captchaToken`).

### 3.4 Twilio — estado vigente

> ⚠️ Reportado y verificado **por el owner en la consola**. No es medible desde el
> repositorio: el entorno no tiene credenciales de Twilio.

| Ítem | Estado |
|---|---|
| Cuenta | **Paid** |
| Verify Service "LucyCare" | activo · **SMS only** · OTP 6 dígitos |
| **Fraud Guard** | activo |
| **Geo Permissions** | **solo El Salvador** |
| Saldo | recargado para el piloto (~US$50 al cierre del GO) |
| **Balance notification** | **US$25** |
| **Auto Recharge** | **OFF — decisión deliberada del piloto, no una deuda** |
| Costo observado | **~US$0.349** por verificación exitosa (US$0.05 Verify + US$0.299 SMS El Salvador) |

**Safeguard de saldo = CLOSED (2026-08-14).** Lo que queda es **operativo y vivo:
vigilar saldo y disponibilidad del proveedor durante el piloto.** Sin saldo no hay
OTP, y el OTP es el único camino de alta. El fallo es **silencioso** para el owner:
el paciente solo ve "no pudimos enviarte un código".

**Modelo de consumo (derivado del código):** el gasto escala con **pacientes
nuevos**, no con reservas. También consumen los reenvíos de código y los reclamos
de perfil médico. Los Test Phones **no** consumen.

**Prohibiciones:** no revertir de Twilio Verify a Programmable Messaging, ni
reconfigurar el Verify Service, Geo Permissions, Fraud Guard, canales o
credenciales, **sin autorización explícita del owner**.

### 3.5 Calificaciones — URL corta (`s7_72`)

La URL que recibe el paciente pasó de **64 caracteres hexadecimales** a
**20 caracteres Crockford Base32**: `/calificar/GMNSKTKWPKYK2KACEJFW`.

**`s7_72` es la migración 93 y está aplicada en producción.** Crea el helper
`public._review_short_code()` y reemplaza **solo la expresión del token** dentro de
`generate_review_token()`.

| Propiedad | Valor |
|---|---|
| Longitud / alfabeto | 20 caracteres · Crockford Base32 (sin I, L, O, U) |
| Entropía | **100 bits exactos** |
| Fuente | `gen_random_uuid()` → `pg_strong_random` |
| Uniformidad | `byte % 32`, por construcción: sin módulo bias |
| Uso / expiración | **único** (`used_at`) · **7 días** |

**Los enlaces de 64 caracteres ya emitidos siguen funcionando** hasta usarse o
vencer. **Sin backfill.** `submit_review`, el esquema e índices de `review_tokens`,
el trigger, la ruta `/calificar/:token`, el frontend y el middleware **no se
tocaron**. El helper queda **sin EXECUTE** para `PUBLIC`, `anon`, `authenticated`
ni `service_role`.

Copy vigente de `/calificar/:token`: *"Tu opinión es confidencial y completar la
calificación toma menos de un minuto."* · *"¿Recomendarías a este médico a un
familiar o amigo?"* · *"LucyCare · Calificación de la atención"*.

Guías: `docs/OWNER_S7_72_APPLY.md` y `docs/OWNER_S7_72_SMOKE.md`.

### 3.6 Legal — vigente

- **`/terminos`** y **`/privacidad`** publicados con los documentos definitivos del
  owner (**Versión 1.0 · julio de 2026**), reproducidos sin resumir.
- **`TOS_VERSION = 'tos-2026-08-13'`** para las aceptaciones **nuevas** del claim.
  El identificador es **técnico y NO se imprime en la UI**.
- **Línea legal discreta** bajo el CTA de `BookingCard`: *"Al reservar, aceptas los
  Términos y Condiciones y reconoces la Política de Privacidad"*.
  `MobileBookingSheet` reutiliza `BookingCard`.
- **Entidad operadora: `Divalux`**, y donde corresponda la razón social completa,
  **`Divalux, S.A. de C.V.`** Verificado en producción: **`Valux` vigente = 0**.
  **No volver a presentar Valux como entidad vigente.** El trámite societario es
  del owner y queda fuera del frente técnico.

**Reglas vigentes:** las aceptaciones históricas `v1.0` **no se reinterpretan ni se
migran** (se firmaron contra un documento no publicado) · el `CONSENT_VERSION` de
`AffiliationRequestModal` **es otra cosa** (consentimiento LOPD del lead, `s7_21`) ·
`otp_consent_events` **no** se usa como evidencia legal del booking · **PR 3 /
evidencia explícita del paciente en DB = DIFERIDO**, no bloquea el piloto.

### 3.7 Seguridad

**AUDIT-SEC-P0 = CLOSED.** `audit_log` sin policies, `anon`/`authenticated` sin
privilegios, **`service_role` solo `SELECT`**, `_admin_log_doctor_change` cerrado,
escritor de frontend eliminado.

> ⚠️ **El histórico anterior al corte NO es evidencia infalsificable.** Hasta
> `s7_71b`, `audit_log` admitía escritura arbitraria: esas filas son trazas
> operativas observadas, no prueba de no-repudio.

**RLS** en todas las tablas. `service_role` solo en scripts admin vía `.env.local`,
**nunca en frontend**. `profiles` con RLS column-level (anon solo ve `id`,
`full_name`, `avatar_url` de publicados).

**Canal público temporal: `lucycare.digital@gmail.com`.** No usar
`hola@lucycare.app` mientras no exista.

### 3.8 Directorio — regla D1

**Un médico puede tener `is_published=true` y aun así no aparecer en el Home.** El
filtro de **completitud mínima D1** (`src/services/directory.service.ts`) exige
`full_name` + especialidad + `clinic.name` + `clinic.address`.

Caso conocido y **esperado**: al cierre del GO había **36** publicados en la base y
**35** en el Home. El excluido es **Dr. Abraham Alfredo Amaya Mendoza**
(`fe7f4f9c-1ffd-4af6-954d-41c9cdc9aa02`), cuya clínica no tiene dirección. La RLS
**no oculta a nadie**. Matiz intencional: **D1 gobierna el listado, no el sitemap**
— `isSitemapEligible` no exige ubicación, así que ese perfil sí está indexado.

### 3.9 SEO / Analytics

Google Search Console verificado y sitemap (`lucycare.app/sitemap.xml`) enviado y
procesado. Los archivos de verificación (`public/google3f2e02a3c176b538.html`,
`public/googlef334c08cb9e5d942.html`) son **permanentes: no borrar**.

Analytics: `@vercel/analytics` + Speed Insights, **cookieless**, con allowlist
`/` · `/doctor/*` · `/privacidad` · `/terminos` y `beforeSend` como backstop.
**Jamás PII ni texto libre de búsqueda.**

---

## 4. Identidades — protegidas y de QA

### 4.1 Camilo — perfil demo/QA controlado

| Campo | Valor |
|---|---|
| `profile_id` / `auth.users` | `db1fba98-a299-4f25-82f1-7feff01e58fa` |
| `doctor_id` | `783a902a-55fd-407c-9e0a-69568135c7f5` |
| `clinic_id` | `8ea0fd8f-87a9-45f9-8f4e-f358764f58c0` |
| Teléfono | `50378056365` — **Test Phone QA** |
| Email | `carlosmartinezddv@gmail.com` |
| Slug público | `dr-camilo-carrillo` |

**Publicado, activo, `verified`, operativo y con Booking habilitado.** Es el
**único médico del directorio con agenda en línea**. Clínica "Clinica Camilo" con
dirección cargada y 3 servicios de 30 minutos.

> **No modificar su identidad, Auth ni configuración técnica sin autorización.**
> Los cambios de datos públicos los hace el owner desde LucyAdmin.

**Cuidado operativo:** al ser el único bookable, ocupar su agenda con datos de
prueba **bloquea reservas reales**.

### 4.2 Médico QA persistente — despublicado

| Campo | Valor |
|---|---|
| `profile_id` / `auth.users` | `b5865737-1c7b-4fd1-bd70-b9e5befd87ed` |
| `doctor_id` | `ac0ba772-4263-4fb2-a146-dd90033d8c76` |
| `clinic_id` | `8b24611d-6b7d-4f2c-bbf5-ec53f5c4bded` |
| Teléfono | `50370008803` (ya **no** es Test Phone) |

**`is_published = false` desde 2026-08-14.** Salió del directorio y del sitemap; la
URL directa responde `noindex,follow` sin exponer datos. La identidad **se conserva
íntegra**. Es el destino natural para QA que necesite comportamiento real de base
sin afectar la conversión. **No borrar ni modificar sin autorización expresa.**

### 4.3 LucyAdmin master

`user_id` `739cac58-4ad2-4efe-9fbf-91921e208b8f` · teléfono `50378627694` (**no** es
Test Phone) · email `lucycare.digital@gmail.com` · `profiles.role = admin`, **única
cuenta con ese rol**.

### 4.4 `operations_admin` (Josué)

`user_id` `791e7d0b-8d6d-43db-8a43-95025d81581e` · email
`josuediazdelvalle27@gmail.com` · teléfono `50377507479` (**ya NO** es Test Phone) ·
`profiles.role = patient` (**correcto, no se eleva**) · `lucyadmin_access =
operations_admin` · entra por **email + contraseña**, no depende de SMS.

Niveles anidados por rango (`s7_57`): `directory_editor(1) ⊂ operations_admin(2) ⊂
admin`. Aterriza en `/admin/medicos`, su única sección. **No** convertirlo a
`role='admin'`, **no** ampliar privilegios.

### 4.5 Test Phones — exactamente 2

| Teléfono | Rol | Estado |
|---|---|---|
| `50378056365` | Camilo QA | **KEEP** |
| `50378626108` | Paciente QA | **KEEP** |

**Los OTP fijos no se documentan en el repositorio.** Retirar un Test Phone no
elimina identidades ni datos: es configuración de GoTrue.

> ⚠️ Un número fuera de la lista que intente OTP por teléfono consume **SMS real de
> Twilio Verify**.

### 4.6 Katherine

**`50372608827` — JAMÁS usar**, ni siquiera en read-only.

---

## 5. Frentes cerrados desde el handoff 2026-08-18

**4 frentes funcionales, 5 PRs (#342–#346).** Ninguno tocó DB, RPC, migraciones,
Supabase, Twilio, Turnstile ni configuración.

### 5.1 PASSWORD-ERROR-COPY-P0 — CLOSED (#342 → `1672783`, #343 → `6c8aca8`)

> **#343 NO es un frente separado:** es el ajuste post-cierre del mismo frente,
> abierto tras revisar #342 ya mergeado. Contarlo aparte inflaría el conteo.

**#342 — el frente.** `setPasswordFromRecovery` devolvía `error.message` **crudo de
GoTrue**, así que `/reset-password` podía mostrar inglés al usuario final (caso
observado: `New password should be different from the old password.`).

- **`src/lib/passwordErrors.ts` (nuevo) es la fuente única del copy de error de
  contraseña.** Prioridad de clasificación: **`error.code` → HTTP status →
  `error.message` solo como fallback de clasificación**. El texto del proveedor se
  lee para decidir, **nunca se muestra**.
- **`same_password` quedó separado de `weak_password`:** antes `setPasswordWithFetch`
  colapsaba **todo 422** en "requisitos mínimos", así que una contraseña repetida se
  reportaba como débil.
- **Ningún mensaje crudo del proveedor puede llegar a UI por los dos caminos
  modificados** (`setPasswordFromRecovery` y `setPasswordWithFetch`): todos sus
  `return` de error son literales en español o el helper, que solo puede devolver
  una de cinco constantes.
- **`/reset-password` quedó en español y tuteo**, y **`link` → `enlace`** en toda la
  página.

**#343 — ajuste post-merge.** El A/B del check derivaba su baseline del merge-base
con `main`, que **después del merge ya contiene el fix**. Se ancló al SHA fijo
**`48ec3b0`** (commit previo a #342, parte permanente del historial de `main`), con
aserción de que es ancestro de HEAD. **En CI un A/B omitido ya no puede pasar por
PASS:** con `CI` seteada y sin historial suficiente el check **falla explícitamente**
(`actions/checkout` con `fetch-depth: 0`); en local avisa y lo omite. **El script
nunca hace fetch por su cuenta.** Incluyó además `Tu link de recuperación…` →
`Tu enlace de recuperación…`.

Instrumento: `scripts/check-password-error-copy.mjs` → **40/40 PASS**, con A/B que
reproduce el bug contra `48ec3b0`.

### 5.2 NOTIFICATION-BELL-A11Y-P0 — CLOSED (#344 → `d98fb95`)

Un archivo, `src/components/NotificationBell.tsx`. **Sin cambios de datos, backend,
queries, contadores ni lógica de leído/no leído.**

- **`Escape` cierra** el panel y **devuelve el foco** a la campana.
- **Fin del foco huérfano:** al cerrar por click fuera con el foco dentro del panel,
  el foco vuelve al botón — **solo en ese caso**; si el usuario clickeó otro
  control, ese control lo conserva.
- **`aria-expanded` + `aria-controls`** en el botón, con `id` en el panel.
- **Contador accesible:** *"Notificaciones (2 sin leer)"*; el badge visual pasa a
  `aria-hidden` para no duplicarlo.
- **`useId()` para el `id` del panel.** `PanelLayout` monta el componente **dos
  veces** (header móvil + barra desktop); un id fijo podía duplicarse en el DOM y
  dejar `aria-controls` apuntando a un panel ajeno. Verificado forzando ambos
  paneles abiertos: ids distintos, cero duplicados, cada `aria-controls` apunta al
  panel hermano de su botón, y la instancia oculta (`display:none`) **no recibe
  foco** ni por `Tab` ni por `.focus()`.
- **Deliberadamente NO se agregó `role="menu"`/`aria-haspopup`** — obligaría a
  navegación por flechas, `Home`/`End` y roving tabindex que el componente no
  implementa — **ni focus trap**, que contradice el patrón de un popover no modal
  sin overlay.

**Límite de la validación:** el instrumento despacha eventos de teclado sintéticos,
que **no** disparan la acción por defecto de un `<button>`, así que la activación
con `Enter`/`Espacio` **no pudo ejercitarse**; se verificó que nada la intercepta y
que el PR no la modifica.

### 5.3 CLAIM-COPY-TUTEO-P0 — CLOSED (#345 → `2a969a8`)

**28 sustituciones de copy** en `ClaimProfileModal.tsx` (26) y
`ClaimProfilePromptCard.tsx` (2). Diff **simétrico 28/28**: sin lógica, JSX ni
estilos.

Cubre `ERROR_COPY`, los mensajes de los handlers de sesión y el JSX de los pasos
`otp`, `license`, `password` y `success`. El CTA de entrada dice ahora **"Reclama tu
perfil"** en sus dos variantes.

Tres formas que un barrido por terminación `á/é/í` **no** detecta y que sí se
corrigieron: el pronombre *"Si **sos** el profesional"* y los imperativos con
enclítico *contactanos* (×3), *Verificala* y *escribinos*.

### 5.4 CLAIM-COPY-HYGIENE-P0 — CLOSED (#346 → `159d3b2`)

Un archivo, `ClaimProfileModal.tsx`. Diff **simétrico 10/10**, sin lógica ni
migraciones.

- **7 × `link` → `enlace`**, alineado con la decisión de #343 para
  `/reset-password`: título y descripción de "Recibir enlace por email",
  destinatario, vigencia de 1 hora, botón de envío, aviso del paso `success` y el
  error de conexión.
- **2 × `onboarding` → "configuración inicial"**, redactadas leyendo la oración
  completa: *"después de una breve configuración inicial"* (`license`) y *"hacemos
  una configuración inicial breve"* (`success`).

**No se tocaron los comentarios técnicos** donde `link` es terminología interna.

---

## 6. Backlog y deudas — ninguna bloquea el piloto

### 🔴 Bloqueantes

**Ninguno.**

### 🟢 Cerrado — no reabrir sin incidente nuevo con evidencia propia

Booking E2E real · Twilio Verify + safeguard de saldo · higiene de perfiles QA ·
LEGAL-P0 y entidad Divalux · RATING-URL-P0 (`s7_72`) · AUDIT-SEC-P0 ·
RECOVERY-EMAIL-P0 · ADMIN-JUNIOR · TESTPHONE-CLEANUP-P0 · LOGIN-FIRST-TIME-COPY-P0 ·
CALIFICACIÓN-COPY-P0 · **PASSWORD-ERROR-COPY-P0** · **NOTIFICATION-BELL-A11Y-P0** ·
**CLAIM-COPY-TUTEO-P0** · **CLAIM-COPY-HYGIENE-P0**.

### 🟠 Pendientes conocidos — registrados, NO abrir sin instrucción

**`NotificationBell`**

- `handleToggle` programa `setTimeout(markAllAsRead, 800)` **sin cleanup**: el timer
  dispara aunque el componente se desmonte antes.
- `PanelLayout` monta **dos instancias** → **dos suscripciones paralelas** de
  `usePanelNotifications`. Solo una es visible; la oculta está bajo `display:none` y
  no es focusable.

**Accesibilidad**

- `PatientAccountMenu` usa `role="menu"` **sin** el patrón completo (flechas,
  `Home`/`End`, roving tabindex). Inconsistencia preexistente; **no se replicó** en
  `NotificationBell`.

**Copy — voseo todavía detectado en otras superficies** (no bloqueante):
`ClaimedProfileNoticeCard` · `AffiliationRequestModal` · `WaitlistModal` ·
`MisAtencionesPage` · `CorrectConsultationModal` · `patientProfile.service` ·
`platformAdmins.service` · el **fallback global de `src/lib/errors.ts`** ·
`auth.service.ts:645` (*"…**podés** solicitar restablecerla"*, de
`signInWithPassword`).

**Deuda menor de copy:** un comentario técnico de `ClaimProfileModal` todavía cita
la etiqueta *"Recibir link"*, aunque la UI ahora dice *"Recibir enlace"*.

**Performance**

- Posible `lazy()` futuro de `/terminos` y `/privacidad`: hoy viajan en el chunk
  inicial por la convención del router de mantener estáticas las rutas públicas/SEO.
- Bundle principal **~671,5 kB raw** (~190,6 kB gzip) en la medición del
  2026-08-20. **No bloqueante**; el owner decidió no hacerlo ahora.

**Admin / Auth tooling**

- Admin API `listUsers` **no enumera todo el padrón**: falla con `Database error
  finding users` en la cola del listado y `?filter=` **no busca por teléfono**
  (devuelve 0 para números que sí existen → **falsos limpios**). **No afecta el
  runtime de Auth**, solo scripts de administración. Para buscar un teléfono, usar la
  búsqueda del Dashboard.

**Otros registrados**

- Entregabilidad de correo (SPF/DKIM/DMARC + plantilla de Supabase/Resend).
- `cancel_reasons`: tabla legacy no versionada en `migrations/`; falta la razón
  genérica "Otro motivo".
- UX del widget de Turnstile en móvil — cosmético.
- Tres funciones `_func` huérfanas (`audit_consultations_func`,
  `audit_patients_func`, `audit_prescriptions_func`): `SECURITY DEFINER`, no
  versionadas, sin trigger asociado. Código muerto; **no** son vector.
- Debt de `search_path`: ocho funciones escritoras de `audit_log` sin
  `SET search_path`. Heredan el del caller; documentado en `s7_66`.

**SEO — frente comercial permanente**

- Seguimiento de Google Search Console (clics, impresiones, CTR, posición media).
- El perfil QA estuvo indexable antes de despublicarse; ya sirve `noindex,follow` y
  saldrá del índice al próximo rastreo. "Eliminación de URLs" lo acelera.

**Piloto — operativo**

- **Monitoreo del saldo y de la disponibilidad de Twilio** (§3.4).
- **PILOT-OPS**: protocolo operativo que se abre **cuando se inscriba el primer
  médico** del piloto.

### 🔵 Diferidos con precondiciones

| Frente | Nota |
|---|---|
| **F1-c2 · DROP de `doctors.license_number`** | **irreversible**. No abrir sin: sincronía fresca, respaldo, preflight con `service_role` y autorización del owner. F1-c1 (retiro lógico) ya está cerrado. **No tocar ahora.** |
| **BILLING-P0** | **PAUSADO**, fuera del piloto y **no bloqueante**. Arquitectura definida en `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md`, **única fuente canónica** de pagos/suscripción/facturación. Proveedor **no elegido**. |
| **PR 3 — evidencia legal del paciente** | diferido (§3.6) |
| **Identidad múltiple Fase 2** | selector "modo paciente / modo médico" |
| **AGENDA-DENSITY-QA-P0** | analizado y **NO ejecutado**: llenar la agenda de Camilo bloquearía reservas reales y dejaría trazas imborrables en `audit_log`. No es un frente abierto. |

---

## 7. Piloto operativo

- **El owner está reclutando médicos para el piloto.** Ese proceso **no es razón
  para frenar el desarrollo**.
- **Cuando se inscriba el primer médico** se abrirá y ejecutará **PILOT-OPS**.
- **Mientras tanto pueden avanzarse frentes pequeños, reversibles y no
  bloqueantes**, siempre con autorización del owner y uno a la vez.
- **No inventar médicos participantes ni resultados del piloto.** A la fecha de este
  handoff **no hay resultados de piloto que reportar**.
- **Objetivo comercial:** LucyCare listo para lanzamiento en El Salvador **a más
  tardar el 2 de octubre de 2026**, sin expansión regional en este ciclo.

---

## 8. Documentación vigente

| Documento | Rol |
|---|---|
| `CLAUDE.md` | Guía rápida. Si contradice a `docs/`, mandan los `docs/` |
| **Este handoff (`2026-08-20`)** | **Fuente canónica del estado** |
| `docs/HISTORIAL_FRENTES.md` | Detalle por PR de los frentes cerrados |
| `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md` | **Única fuente canónica de BILLING** |
| `docs/OWNER_S7_72_APPLY.md` · `docs/OWNER_S7_72_SMOKE.md` | Aplicación y verificación de `s7_72` |
| `docs/OWNER_S7_71A_APPLY.md` · `docs/OWNER_S7_71B_APPLY.md` | AUDIT-SEC-P0 |
| `docs/ESTADO_TECNICO.md` | ER/BD, matriz de reglas, flujos UI/UX (**snapshot 2026-05-19**) |
| `docs/CUENTA_DEMO_CAMILO.md` | Reglas de la cuenta demo |
| `docs/ANALISIS_*.md` | Un eje cada uno; **no re-analizar** lo ya firmado |
| `docs/rollbacks/` | **NO ejecutar** |
| `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-18.md` y anteriores | **Históricos**, menor precedencia. **No borrar** |

---

## 9. Qué quedó superado del handoff 2026-08-18

Reconciliación explícita, para que nadie copie datos vencidos:

| Afirmación del `2026-08-18` | Estado hoy |
|---|---|
| "Último HEAD funcional `4be1011` (#340)" | **Superado**: `159d3b2` (#346) |
| "PRs funcionales mergeados hasta #340" | **Superado**: hasta **#346** |
| §12 "Próximo candidato recomendado: **PASSWORD-ERROR-COPY-P0** — NO está abierto" | **Superado**: **CLOSED** (#342/#343) |
| §12 WARN "`NotificationBell` — Escape y retorno de foco" | **Superado**: **CLOSED** (#344) |
| §12 WARN "Bundle inicial ~666 kB" | **Actualizado**: ~**671,5 kB** raw en la medición del 2026-08-20 |
| "Este handoff (`2026-08-18`) = fuente canónica" | **Superado por este documento** |

**Todo lo demás del `2026-08-18` sigue vigente** y está reproducido arriba: piloto
en GO, Booking E2E, Twilio, Turnstile, Test Phones, identidades protegidas, Legal y
Divalux, `s7_72`, regla D1, SEO y las reglas operativas.

**Las 93 migraciones no cambiaron:** los cuatro frentes cerrados desde entonces
fueron frontend y tooling de verificación.
