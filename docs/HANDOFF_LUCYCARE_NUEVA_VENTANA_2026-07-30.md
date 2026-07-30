# HANDOFF LucyCare — nueva ventana (2026-07-30, post PR #306)

> **PUNTO DE ENTRADA VIGENTE.** Este documento es autocontenido y reemplaza a los
> handoffs anteriores como referencia principal de continuidad. Los handoffs
> históricos NO se borran: siguen siendo útiles para el detalle de ejes ya
> cerrados (clínico F1–F7, SEO/Perf, credenciales, paciente global).
>
> Trabajo de cierre **documental**. No hay frente funcional abierto.

---

## A. Estado técnico actual

| Ítem | Valor |
|---|---|
| Repo | `C:\Users\admic\lucycare` |
| Remoto | `github.com/amedelvalle/lucycare` |
| HEAD | `7c43adf68639329becf1e41541dbdafec0b5ae20` |
| Subject | `auth: add OTP consent and Turnstile readiness` |
| PRs mergeados | hasta **#306** |
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

## E. QA de producción (validada)

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

### Cloudflare Turnstile
- Widget **creado**, modo **Managed**.
- **Site Key y Secret Key en poder exclusivo del owner**; **no documentadas ni
  compartidas** (ni en el repo ni en handoffs).
- **No configuradas todavía** en Vercel ni en Supabase.
- `VITE_CAPTCHA_ENABLED` **desactivado / no definido**.
- Widget y script **no aparecen en producción**.

### Supabase
- **Phone Auth habilitado.**
- **Email Auth habilitado.**
- **Before User Created Hook ACTIVO.**
- OTP de **6 dígitos**, expiración **300 segundos**.
- **CAPTCHA desactivado.**
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

1. Activación coordinada de Cloudflare Turnstile.
2. Configurar la Site Key en Vercel.
3. Configurar la Secret Key y activar el CAPTCHA en Supabase.
4. Comprobar la suspensión automática del cambio de teléfono.
5. Convertir Twilio a cuenta **Paid**.
6. Crear el **Verify Service**.
7. Cambiar Supabase de Programmable Messaging a **Twilio Verify**.
8. Probar SMS real con un teléfono autorizado.
9. Validar el **rollback efectivo** (cortar OTP real conservando teléfono+
   contraseña, email+contraseña y recuperación por Resend; **sin deshabilitar
   Phone Auth**).
10. Definir la **política definitiva de retención** de `otp_consent_events`.
11. Retirar **Test Phones privilegiados** solo cuando existan accesos
    alternativos verificados.
12. **WhatsApp OTP diferido** (exige Send SMS Hook + Edge Function + plantillas).

---

## J. Secuencia recomendada futura

*(Recomendación, **no** autorización.)*

1. Análisis de activación y rollback.
2. Configurar Turnstile primero en entorno controlado.
3. Validar el CAPTCHA con **todas** las superficies Auth.
4. Confirmar la recuperación por Resend con el CAPTCHA activo.
5. Preparar Twilio Verify.
6. Activar el proveedor real.
7. QA de SMS real.
8. Rollback probado.
9. Retiro gradual de Test Phones.
10. Apertura pública.

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

- HEAD 7c43adf68639329becf1e41541dbdafec0b5ae20 o posterior únicamente si existe un PR docs-only de cierre;
- PRs funcionales mergeados hasta #306;
- migraciones vigentes hasta s7_69;
- main == origin/main;
- árbol limpio;
- 0 PRs abiertos;
- CAPTCHA desactivado;
- Turnstile sin configurar;
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
