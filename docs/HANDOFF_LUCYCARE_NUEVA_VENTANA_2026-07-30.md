# HANDOFF LucyCare — nueva ventana (2026-07-30, post PR #306)

> **PUNTO DE ENTRADA VIGENTE.** Este documento es autocontenido y reemplaza a los
> handoffs anteriores como referencia principal de continuidad. Los handoffs
> históricos NO se borran: siguen siendo útiles para el detalle de ejes ya
> cerrados (clínico F1–F7, SEO/Perf, credenciales, paciente global).
>
> Trabajo de cierre **documental**. No hay frente funcional abierto.
>
> ⚠️ **ACTUALIZADO 2026-07-31 (post PR #308).** Este documento se emitió cuando el
> CAPTCHA estaba **desactivado**. Tras el cierre de **PILOTO-P0**, Turnstile está
> **ACTIVO en producción** y el cambio de teléfono quedó **suspendido**. Las
> secciones A, E, F e I se corrigieron en consecuencia; **§M** documenta el frente
> completo. Donde el texto histórico hable de "CAPTCHA desactivado", manda §M.

---

## A. Estado técnico actual

| Ítem | Valor |
|---|---|
| Repo | `C:\Users\admic\lucycare` |
| Remoto | `github.com/amedelvalle/lucycare` |
| HEAD | `45ec573a1168f9319f0a67028438728b031e338a` |
| Subject | `fix(auth): CAPTCHA en el login post-contraseña y en el reset del claim (#308)` |
| PRs mergeados | hasta **#308** |
| Migraciones aplicadas | hasta **`s7_69`** |
| `main == origin/main` | sí |
| Árbol | limpio (sin untracked, sin fixtures ni scripts temporales) |
| PRs abiertos | **0** |
| Producción | desplegada y validada |
| Dominio productivo | `https://lucycare.app` |

> Nota operativa: existen ~26 ramas locales `claude/*` **antiguas** (frentes ya
> squash-mergeados). Su limpieza requiere **autorización expresa del owner** y no
> se hizo aquí. Tampoco se tocó el stash viejo `stash@{0}: WIP on claude/admin-fase-a`.

---

## B. Cierre del eje Auth reciente

### PR #304 — el login genérico no crea usuarios
- El contexto `login` de OTP pasa a `shouldCreateUser: false`.
- La creación de cuentas queda **solo** en contextos autorizados
  (`booking`, `claim`, `activation`).
- Un teléfono sin cuenta recibe un mensaje guía y **no** se crea
  `auth.users` / `profiles` / `patients`, sin revelar de más si existe.

### PR #305 — contraseña obligatoria y acceso por teléfono
- Primera activación por **OTP**.
- **Contraseña obligatoria** antes de completar el acceso o la reserva.
- Ingresos posteriores por **teléfono + contraseña** (`signInWithPhonePassword`).
- La verificación del OTP para el setup de contraseña usa un **cliente Supabase
  transitorio** (`persistSession/autoRefreshToken/detectSessionInUrl = false`):
  no toca la sesión del cliente principal ni corre side-effects; el token vive
  solo en memoria. Recién tras guardar la contraseña se hace el login real
  (sesión persistente + side-effects) y solo entonces se crea la cita.
- **Recuperación por email** vía Resend (`/reset-password`) intacta.
- **"Mis atenciones" se actualiza de inmediato** tras reservar (invalidación de
  la query canónica + `refetchOnMount: 'always'`), sin logout ni reingreso.

### PR #306 / `s7_69` — consentimiento OTP + preparación de Turnstile
- **Consentimiento OTP** con evidencia persistente (ver §C).
- **Cloudflare Turnstile preparado pero DESACTIVADO** por bandera.
- Registro **append-only** del consentimiento (`otp_consent_events`).
- **RPC endurecida** `record_otp_consent` (ver §D).
- **Idempotencia estricta por `request_id`**: un id existente solo es reintento
  válido si coinciden teléfono, contexto, versión y hash; cualquier diferencia
  → `invalid_request`, sin insertar.
- **Límite: 10 solicitudes por teléfono cada 10 minutos** (`P0301`).
- **Advisory lock transaccional por teléfono** (`pg_advisory_xact_lock`
  derivado del teléfono): serializa el mismo número, no bloquea números
  distintos; el conteo y la inserción ocurren bajo el lock (límite atómico).
- **Cambio de teléfono disponible mientras el CAPTCHA está apagado**, y
  **suspendido automáticamente al activar el CAPTCHA**
  (`PHONE_CHANGE_SUSPENDED = CAPTCHA_ENABLED`), porque
  `updateUser({ phone })` no admite `captchaToken`.

---

## C. Consentimiento OTP final

- **Versión:** `otp-consent-v1`
- **Texto canónico y visible** (una sola cadena, dos oraciones separadas por un
  espacio):

  `Te enviaremos un código por SMS para verificar tu número. Al continuar, aceptas nuestra Política de Privacidad.`

- **SHA-256 (UTF-8 exacto):**
  `86f0dfdf430fd3e100fc7651039b20bf1d127c571e87e07faef22503886c8692`

> Regla vinculante: **el hash corresponde exactamente al texto que el usuario
> ve**. No hay texto legal oculto ni contenido de la Política dentro del hash.
> La Política puede ampliar información, pero eso no forma parte de este aviso.
> Cambiar el copy visible obliga a cambiar el hash (y, si cambia la política,
> a emitir `otp-consent-v2`).

**Presentación visible**
- Primera oración como **texto principal**.
- Segunda oración como **texto discreto** (secundario).
- **"Política de Privacidad" enlaza a `/privacidad`** (ruta canónica existente).
- **Sin checkbox**, **sin modal legal**, **sin mención de cargos del operador**
  en la interfaz.
- La acción de solicitar el código constituye el consentimiento.
- Se muestra en: **login por código**, **reserva (booking)**, **reclamo de
  perfil médico** y **reenvío del código**.

**Orden de envío (vinculante)**
1. aviso visible;
2. Turnstile válido **cuando el CAPTCHA esté activo**;
3. `record_otp_consent`;
4. confirmación del registro (éxito o idempotencia válida);
5. `signInWithOtp`;
6. reset del token de Turnstile (en `finally`).

> **Si falla el registro, NO se envía OTP** (ni en el primer envío ni en el
> reenvío): sin evidencia no hay SMS. El usuario recibe un mensaje genérico.

---

## D. Estado validado de `s7_69`

**Aplicada por el owner** (SQL Editor). Objetos:

- Tabla `public.otp_consent_events` (append-only): `id`, `phone_e164`,
  `context`, `consent_version`, `consent_text_hash`, `request_id`, `created_at`.
  - CHECKs: teléfono `^\+503[0-9]{8}$` · contexto `IN ('login','booking','claim')`
    · versión y hash exactos.
  - `UNIQUE(request_id)` (idempotencia) + índice `(phone_e164, created_at DESC)`.
- **RLS habilitado**, **0 policies**.
- **Sin `SELECT` ni DML directo** para `anon` ni `authenticated`.
- **RPC `record_otp_consent` ejecutable por `anon` y `authenticated`**
  (el consentimiento es pre-auth), **`SECURITY DEFINER`**,
  **`search_path` fijo** (`pg_catalog, public, pg_temp`).
- **Errores genéricos** (`invalid_request` / `too_many_requests`): no revelan si
  falló idempotencia, límite o validación, ni qué campo difiere.
- **No guarda** OTP, captcha token, IP completa, user-agent ni secretos.
- **Sin purga automática.**
- **`service_role` conserva acceso administrativo.**

**Validaciones**

| Verificación | Resultado |
|---|---|
| `check-s7_69` | **94/94** |
| `check-auth-p1d2` | **78/78** |
| `check-auth-p1a-phone` | verde |
| `check-auth-p1b2a-login-gating` | verde |
| `check-auth-p1c1-phone-password` | verde |
| `check-mis-atenciones-refresh` | verde |
| `check-s7_65` (consulta la DB) | verde — **sin regresión de Auth** |
| Smoke transaccional (`docs/OWNER_S7_69_SMOKE.md`) | **PASS 16/16** |
| `postsmoke_pass` | **true** |
| `filas_smoke` | **0** |
| `filas_totales` al cierre | **0** |

> El smoke corre en `BEGIN … ROLLBACK`, **sin objetos temporales**: acumula
> resultados en una variable `jsonb` y los publica con
> `set_config('p1d2.smoke_results', …, true)`, leídos con `current_setting`.
> Este diseño evita dos fallos reales del SQL Editor de Supabase:
> `42P01` (nombre temporal sin calificar, dependiente del `search_path`) y
> `3F000` (`pg_temp` no resuelve hasta que la sesión materializa su esquema
> temporal). **No usar tablas temporales en smokes de este proyecto.**

---

## E. QA de producción (validada — estado del 2026-07-30, CAPTCHA aún apagado)

> Vigencia: esta sección refleja la QA **previa** a la activación. La QA con
> CAPTCHA activo está en **§M**.

- Home carga.
- Perfil de Camilo carga.
- Login muestra el aviso (SMS + privacidad).
- Reserva anónima muestra el aviso.
- Reclamo de perfil muestra el aviso.
- `/privacidad` funciona (enlace del aviso).
- **No aparece Turnstile** (ni widget, ni iframe, ni el script en el bundle).
- **Cambio de teléfono sigue disponible** (el bloque de suspensión no se compila
  con el CAPTCHA apagado).
- **Login posterior con teléfono y contraseña fue probado por el owner.**
- Consola **sin errores rojos relevantes**.

---

## F. Estado de servicios externos

### Cloudflare Turnstile — **ACTIVO** (actualizado 2026-07-31)
- Widget **creado**, modo **Managed**.
- **Site Key: PÚBLICA por diseño** — viaja en el bundle del frontend
  (`VITE_TURNSTILE_SITE_KEY`). No es un secreto; aun así **no se transcribe en el
  repo ni en los handoffs**: se configura en Vercel.
- **Secret Key: SENSIBLE** — se valida server-side en Supabase. **Nunca toca el
  repo, el frontend ni los handoffs, y NO se documenta.** En poder exclusivo del
  owner.
- **Configuradas**: Site Key en Vercel, Secret Key en Supabase.
- `VITE_CAPTCHA_ENABLED` **activo**.
- Widget **visible en producción** en las 5 superficies (login por teléfono,
  reserva, reclamo, login por email, recuperación por email) más el paso de
  creación de contraseña (`set_password`).
- **No desactivar ni reconfigurar** sin orden expresa del owner. Ver el orden
  vinculante en **§M**.

### Supabase
- **Phone Auth habilitado.**
- **Email Auth habilitado.**
- **Before User Created Hook ACTIVO.**
- OTP de **6 dígitos**, expiración **300 segundos**.
- **CAPTCHA ACTIVO** (actualizado 2026-07-31; antes desactivado).
- **`s7_69` aplicada.**
- **Resend SMTP configurado y validado.**

### Resend — QA E2E aprobada
- Correo recibido · llegó a **bandeja de entrada** · enlace correcto ·
  contraseña cambiada · **login posterior exitoso**.

### Twilio
- Cuenta **Trial**.
- Proveedor actual de Supabase: **Twilio Programmable Messaging**.
- **Twilio Verify disponible en el desplegable, pero NO seleccionado.**
- **Verify Service NO creado.**
- **No se cambió configuración.**
- **No se envió SMS real** durante el cierre de PR #306.

---

## G. Invariantes de seguridad (mantener)

1. El **login genérico no crea usuarios**.
2. **Booking y claim** crean únicamente mediante **autorización server-side**.
3. **Before User Created Hook activo.**
4. Primera activación por **OTP + contraseña obligatoria**.
5. Accesos posteriores por **teléfono + contraseña**.
6. **Email + contraseña** intacto.
7. **Recuperación por Resend** intacta.
8. **La cita se crea solo después de la sesión principal.**
9. **Nunca revelar si un teléfono existe.**
10. **Nunca registrar** OTP, captcha token, contraseñas ni secretos.
11. **No usar `service_role`** sin autorización puntual del owner.
12. **No tocar `auth.users` por SQL.**
13. **El owner aplica el SQL manualmente**; el dev escribe la migración y corre
    los checks.

---

## H. QA y teléfonos de prueba

| Teléfono | Rol | Reglas |
|---|---|---|
| `50378627694` | **Camilo** — médico oficial de prueba | OTP fijo `123456`. **No modificar identidad ni configuración permanente.** |
| `50378626108` | **Paciente QA permanente** | Contraseña configurada (**no se documenta**). OTP fijo disponible **solo para QA autorizada**. Creado en la validación de booking autorizado. |
| `50372608827` | **Katherine** | **NUNCA usar**, ni en read-only. |
| `50376193396` | Teléfono **limpio** | Control negativo; sin cuenta. |

> Cualquier otro teléfono de prueba debe confirmarse contra la fuente vigente
> antes de usarlo; **no inventar estados**. Los Test Phones se configuran en
> Supabase Dashboard → Authentication → Phone.

---

## I. Pendientes vivos

**No hay frente abierto.** Pendientes próximos, **no autorizados todavía**:

1. ~~Activación coordinada de Cloudflare Turnstile.~~ ✅ **HECHO** (2026-07-31, §M).
2. ~~Configurar la Site Key en Vercel.~~ ✅ **HECHO**.
3. ~~Configurar la Secret Key y activar el CAPTCHA en Supabase.~~ ✅ **HECHO**.
4. ~~Comprobar la suspensión automática del cambio de teléfono.~~ ✅ **HECHO** (QA-12).
5. Convertir Twilio a cuenta **Paid**.
6. Crear el **Verify Service**.
7. Cambiar Supabase de Programmable Messaging a **Twilio Verify**.
8. Probar SMS real con un teléfono autorizado.
9. Validar el **rollback efectivo del envío de OTP real** (cortar envíos nuevos
   conservando teléfono+contraseña, email+contraseña y recuperación por Resend;
   **sin deshabilitar Phone Auth**, porque eso rompería el login por teléfono).
   **Distinto del rollback del CAPTCHA, que ya está validado (§M).** La palanca
   propuesta —poner en **0** el rate limit de SMS de Supabase Auth— **NO está
   comprobada**: no afirmarla como validada hasta ejercerla contra la
   configuración real.
10. Definir la **política definitiva de retención** de `otp_consent_events`.
11. Retirar **Test Phones privilegiados** solo cuando existan accesos
    alternativos verificados.
12. **WhatsApp OTP diferido** (exige Send SMS Hook + Edge Function + plantillas).

---

## J. Secuencia recomendada futura

*(Recomendación, **no** autorización.)*

1. ~~Análisis de activación y rollback.~~ ✅ **HECHO** (§M).
2. ~~Configurar Turnstile.~~ ✅ **HECHO**.
3. ~~Validar el CAPTCHA con **todas** las superficies Auth.~~ ✅ **HECHO** (matriz §M.4).
4. ~~Confirmar la recuperación por Resend con el CAPTCHA activo.~~ ✅ **HECHO** (QA-09/QA-11).
5. ~~Rollback del CAPTCHA probado.~~ ✅ **HECHO** (§M.4).
6. Preparar Twilio Verify.
7. Activar el proveedor real.
8. QA de SMS real.
9. Rollback del **envío de OTP** probado (distinto del anterior; ver §I.9).
10. Retiro gradual de Test Phones.
11. Apertura pública.

---

## K. Decisiones editoriales

- **Mantener tuteo en el copy nuevo** de LucyCare productivo.
- Existe **voseo heredado** en algunas superficies, especialmente en el flujo de
  **claim**.
- **No corregirlo en este PR.**
- Queda registrado como **deuda editorial separada**.

---

## L. INSTRUCCIÓN 0 para la nueva ventana del developer

```text
INSTRUCCIÓN 0 — CONTINUIDAD LUCYCARE POST PR #306

Continuamos LucyCare desde el estado consolidado posterior a PR #306.

Antes de responder o modificar archivos:

1. Lee completo:
   - CLAUDE.md
   - docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-07-30.md

2. Ejecuta:
   git fetch origin
   git checkout main
   git pull --ff-only origin main
   git status --short
   git rev-parse HEAD
   gh pr list --state open

Estado esperado:

- HEAD 45ec573a1168f9319f0a67028438728b031e338a o posterior únicamente si existe un PR docs-only de cierre;
- PRs funcionales mergeados hasta #308;
- migraciones vigentes hasta s7_69;
- main == origin/main;
- árbol limpio;
- 0 PRs abiertos;
- CAPTCHA ACTIVO en produccion (Turnstile configurado en Vercel y Supabase);
- cambio de telefono SUSPENDIDO mientras el flag este activo;
- Twilio Verify sin configurar;
- sin frente funcional abierto.

Reglas:

- no asumir autorizaciones;
- un solo frente a la vez;
- no abrir rama o PR sin autorización del owner;
- no mergear sin autorización;
- no ejecutar SQL;
- no usar service_role;
- no tocar auth.users;
- no desactivar ni reconfigurar Turnstile/CAPTCHA;
- no configurar Vercel, Supabase, Cloudflare, Twilio o Resend;
- no revelar secretos;
- no usar Katherine;
- no modificar Camilo;
- analizar primero y entregar un plan corto;
- esperar que el owner seleccione el siguiente frente.

Primera respuesta esperada:

1. estado recuperado;
2. HEAD y repo confirmados;
3. último frente cerrado;
4. pendientes principales;
5. confirmación de que no iniciarás trabajo sin autorización.
```

---

## M. PILOTO-P0 — Turnstile: cierre del frente (2026-07-31, PR #308)

> **Añadido tras la emisión de este handoff.** Donde el texto anterior diga
> "CAPTCHA desactivado", manda esta sección.

### M.1 Qué encontró el preflight

Preflight **read-only** de todas las superficies Auth, previo a activar el
CAPTCHA. Punto de partida verificado contra los tipos instalados de
`@supabase/auth-js`: los endpoints de GoTrue **protegidos** por el CAPTCHA son
los que aceptan `captchaToken` — `signUp`, `signInWithPassword`,
`signInWithOtp`, `resend`, `resetPasswordForEmail`, SSO/OAuth/anon. **NO** están
protegidos `verifyOtp` (su `captchaToken` está marcado `@deprecated`) ni
`PUT /auth/v1/user` (`updateUser`, incluidos password y recovery). `UserAttributes`
**no tiene** `captchaToken`: por eso `updateUser({ phone })` obliga a suspender el
cambio de teléfono en vez de protegerlo.

De 18 superficies revisadas, 16 estaban correctamente cableadas. **Dos no**, y
ambas eran **invisibles con el CAPTCHA apagado**:

- **GAP-1 — bloqueante.** En `LoginModal`, paso `set_password`: tras guardar la
  contraseña obligatoria, el login principal (`signInWithPhonePassword` →
  `signInWithPassword`) viajaba **sin token**. El token del envío del OTP es de un
  solo uso y ya se había consumido y limpiado. Con CAPTCHA activo: el usuario nuevo
  quedaba con **la contraseña cambiada y sin sesión**, y en **booking la cita nunca
  se creaba** con el `booking_intent` ya registrado. Rompía la ruta de conversión
  principal del piloto.
- **GAP-2 — alto, falla silenciosa.** En `ClaimProfileModal`, opción "Recibir link
  por email": `requestPasswordReset` → `resetPasswordForEmail` **sin token**. Como
  esa función siempre responde éxito por anti-enumeración, la pantalla de éxito
  aparecía y **el correo nunca salía**.

### M.2 El fix (PR #308, squash `45ec573`)

**Frontend-only. 3 archivos, +78/-3. Sin DB, SQL, migración ni configuración.**

| Archivo | Cambio |
|---|---|
| `src/pages/doctor-detail/components/LoginModal.tsx` | widget + guard + token fresco en `set_password` |
| `src/pages/doctor-detail/components/ClaimProfileModal.tsx` | widget + guard + token en el envío del link |
| `scripts/check-auth-p1d2.mjs` | 11 aserciones de regresión sobre ambas rutas |

Reglas aplicadas, **vinculantes** para quien toque estos flujos:

- El guard corre **antes de guardar la contraseña** (GAP-1) y **antes de mostrar
  éxito** (GAP-2). Fallar después dejaría, respectivamente, una contraseña
  cambiada sin sesión, o una pantalla de éxito mintiendo.
- **Nunca se reutiliza el token del envío del OTP**: es de un solo uso. Cada paso
  que llama a un endpoint protegido monta su propio widget y exige token fresco.
- `resetCaptcha()` en el `finally` de toda acción que consume token.
- **Se conservó la arquitectura de #305**: OTP con cliente transitorio → guardar
  contraseña → login principal por teléfono+contraseña → recién ahí la cita.
  Decisión explícita del owner: **no** usar `setSession` ni promover la sesión
  transitoria al cliente principal.
- La **anti-enumeración** del claim queda intacta: no se revela si el correo existe.

Validación: `check-auth-p1d2` **90/90** (antes 78/78) · `npx tsc --noEmit` limpio ·
`npm run build` verde · `git diff --check` limpio.

### M.3 Orden VINCULANTE al activar o desactivar el CAPTCHA

El frontend debe estar enviando tokens **antes** de que Supabase los exija.

- **Frontend ON + Supabase OFF** = inofensivo (GoTrue ignora el token).
- **Supabase ON + frontend OFF** = **caída total de Auth**.

Por eso: para **activar**, primero `VITE_CAPTCHA_ENABLED` + Site Key en Vercel y
deploy, después la Secret Key y el enforcement en Supabase. Para **desactivar**,
exactamente al revés: **apagar el enforcement en Supabase primero**, y recién
después quitar el flag y redeployar.

Efecto colateral esperado: `PHONE_CHANGE_SUSPENDED = CAPTCHA_ENABLED`, así que el
cambio de teléfono se suspende **desde el deploy del flag**, aunque Supabase
todavía no esté enforzando.

Verificación objetiva del estado apagado: con el flag off, Vite elimina por
dead-code el `SCRIPT_SRC` de Turnstile y **`challenges.cloudflare.com` no aparece
en ningún chunk** del build.

### M.4 Matriz final de QA (ejecutada por el owner en producción)

| ID | Caso | Resultado |
|---|---|---|
| QA-01 | Login → "Usar un código" con challenge | ✅ |
| QA-02 | Booking **anónimo** → código → cita creada | ✅ (12/08/2026 13:30) |
| QA-03 | Reenvío exige challenge **nuevo** | ✅ |
| QA-04 | Claim: widget en el envío de OTP | ✅ visible |
| QA-05 | Verificar el código **sin** captcha | ✅ |
| QA-06 | Login teléfono + contraseña | ✅ |
| QA-07 | **Primera activación completa** (OTP → contraseña → 2.º challenge → sesión → cita) | ✅ en login **y** en booking |
| QA-08 | Login email + contraseña | ✅ (dentro del rollback) |
| QA-09 | "¿Olvidaste tu contraseña?" desde login | ✅ correo recibido |
| QA-10 | Claim → "Recibir link por email" | ⚠️ **riesgo aceptado** (M.5) |
| QA-11 | Link de Resend → nueva contraseña | ✅ |
| QA-12 | Cambio de teléfono **suspendido** | ✅ |
| QA-13 | Consentimiento OTP registrado antes del envío | ✅ |
| QA-14 | Sesión previa a la activación sigue viva | ✅ (dentro del rollback) |
| QA-15 | Fail-closed sin Site Key | N/A en producción — cubierto por la prueba conductual de `check-auth-p1d2` |
| QA-16 | Turnstile bloqueado por red/adblocker | ⚠️ **riesgo aceptado** (M.5) |
| QA-17 | Móvil (~360–390 px) en login, recuperación y reclamo | ✅ sin overflow, usable |

**Rollback del CAPTCHA validado en producción** siguiendo M.3: enforcement
apagado en Supabase → login teléfono+contraseña OK · login email+contraseña OK ·
recuperación por Resend OK · sesión previa viva → enforcement reactivado → login
final con Turnstile OK. **Sin tocar `VITE_CAPTCHA_ENABLED` ni redeployar.**

Nota de método: durante esta QA se ejecutó a propósito el flujo OTP de primera
activación, así que **`otp_consent_events` creció, y ese incremento es correcto**.
No usar "sin incremento" como criterio de limpieza.

### M.5 Riesgos aceptados por el owner (registrados, no resueltos)

- **QA-10 — riesgo residual aceptado.** El flujo "Recibir link por email" de
  `ClaimProfileModal` **no fue ejecutado en runtime**, porque requeriría reclamar un
  perfil (irreversible: `lucy_status → claimed`, `tos_accepted_at`, audit) o
  fabricar un médico fixture; ninguna de las dos se autorizó. Su **wiring quedó
  verificado estáticamente** (`check-auth-p1d2`) y el servicio subyacente
  `requestPasswordReset` fue **validado E2E desde `LoginModal`** (misma función,
  mismo endpoint de GoTrue), **pero el recorrido específico del claim permanece sin
  prueba runtime**. Atenúan el impacto —sin cerrarlo— que la opción **primaria** de
  ese paso ("Crear contraseña ahora") no usa esta ruta, y que un médico sin correo
  puede entrar por "¿Olvidaste tu contraseña?" desde el login (QA-09).
- **QA-16 — Turnstile bloqueado por red o adblocker.** Se acepta la cobertura
  estructural: sin token el envío queda **fail-closed**. No se ejecutó prueba
  manual bloqueando Cloudflare en producción.
- **QA-17 a 430 px.** Verificado en un ancho real de ~360–390 px. No se repitió a
  430 px: viewport más amplio y componente compartido.
- **Expiración del token mientras se escribe la contraseña.** Los tokens de
  Turnstile duran ~5 minutos; si el usuario tarda más, el widget limpia el token y
  al enviar verá "Completa la verificación de seguridad". Fail-closed y recuperable.
- **Copy técnico de GoTrue.** Un rechazo por captcha en `sendOtp` cae al
  `error.message` crudo (texto en inglés). No bloqueante.

### M.6 Observación UX no bloqueante

En móvil el widget de Turnstile **es funcional y no desborda**, pero tiene
bastante protagonismo visual y ocupa altura en pantallas donde el usuario ya venía
haciendo scroll. Mejora cosmética futura; **no abrir PR por esto**.

### M.7 Backlog abierto por este frente (ninguno bloquea el piloto)

1. **Entregabilidad de correo — SPF/DKIM/DMARC + plantilla.** Gmail marcó el correo
   de recuperación con una advertencia de "posible mensaje peligroso". El correo
   **llegó** y el flujo funcionó, pero la advertencia aparece justo en el paso de
   recuperar la cuenta. Frente propio: registros DNS en Cloudflare + plantilla de
   Supabase/Resend.
2. **Correo verificado del paciente como canal secundario de recuperación.** Hoy el
   paciente depende exclusivamente del teléfono, y el cambio de teléfono está
   **suspendido** mientras el CAPTCHA esté activo.
3. **Razón genérica "Otro motivo" en `cancel_reasons`.** El catálogo no la tiene y
   el modal **exige** elegir una razón antes de confirmar → un caso no contemplado
   obliga a elegir una categoría inexacta, lo que **contamina el dato de
   cancelaciones** que consume `admin_conversion_summary` (`s7_53`). El campo libre
   "Detalle adicional" es opcional y no sustituye la razón.
4. **Revisión de `cancel_reasons` como tabla legacy.** **No está versionada en
   `migrations/`** (viene del esquema inicial, igual que los grants que destapó
   `s7_60`): revisar schema, grants y policies reales antes de tocarla, y entrar
   **por migración versionada, nunca por SQL ad hoc**.
5. **UX del widget móvil** (M.6).

### M.8 Estado operativo resultante

- **Turnstile ACTIVO** en Vercel y Supabase. Claves en poder del owner, **no
  documentadas**.
- **Cambio de teléfono SUSPENDIDO** mientras el flag esté activo: **durante el
  piloto no hay camino self-service** para cambiar de número (la recuperación es
  manual, por soporte).
- **PILOTO-P0 cerrado funcionalmente.** Lo que sigue (Twilio Paid, Verify Service,
  SMS real, rollback del envío de OTP, retención de `otp_consent_events`, retiro de
  Test Phones) vive en **§I** y **no está autorizado**.
