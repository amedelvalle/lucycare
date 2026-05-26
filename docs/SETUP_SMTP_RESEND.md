# Setup SMTP externo — Resend para Supabase Auth

> Guía operativa para configurar Resend como proveedor SMTP de Supabase
> Auth, antes del piloto público de LucyCare. **Snapshot 2026-05-26.**
>
> Acompaña a `docs/FASE_4_AUTH_EMAIL.md` (URL config + email templates +
> smoke del flujo de reset) y a `docs/SECURITY_GATE_PILOTO.md` (auditoría
> pre-piloto).
>
> Este PR es **documental y de checklist**, sin código. La integración
> con Resend + Supabase la ejecuta el owner desde los dashboards.

## Estado actual del setup

> Confirmado por el owner el **2026-05-26**: integración operativa
> Resend + Supabase Auth ejecutada y validada con reset por email real.

| Item | Estado |
|---|---|
| Documentación de procedimiento | ✅ creada en este PR |
| Cuenta Resend | ✅ creada |
| Dominio `lucycare.app` verificado en Resend | ✅ verificado |
| Registros DNS (SPF / DKIM / DMARC) en Cloudflare | ✅ configurados |
| API key Resend con `sending access` | ✅ creada (guardada fuera del repo) |
| SMTP custom configurado en Supabase Dashboard | ✅ activo |
| Smoke de reset por email end-to-end | ✅ OK 2026-05-26 (sender `LucyCare`, link abrió, cambio de pass, login con pass nueva) |
| Smoke de capacidad (5 emails seguidos) | ⏳ no ejecutado explícitamente (no bloqueante — rate limit builtin de ~4/h ya no aplica con SMTP externo) |

Detalle de la configuración real en la **sección 8**. El Hallazgo #6
de `docs/SECURITY_GATE_PILOTO.md` queda cerrado para la parte de reset
por email (smoke de capacidad pendiente como verificación opcional).

---

## 1. Objetivo

Reemplazar el SMTP **builtin** de Supabase Auth por un proveedor
externo (**Resend**) antes de abrir LucyCare al piloto público de 5
médicos.

Hoy el reset por email (Fase 4 PR-A, PR #39) funciona contra el SMTP
builtin de Supabase, pero ese servicio:

- Está pensado para desarrollo, no para producción.
- Tiene **rate limit duro de ~4 emails/h por proyecto** (Supabase lo
  documenta así).
- No garantiza deliverability ni soporta reputación de dominio propio.
- No expone logs útiles de envío (bounce, complaint, delivered).

Con un piloto de 5 médicos y pacientes reales pidiendo reset de
contraseña, el rate limit es un **cuello de botella seguro**: la
primera ola de "Olvidé mi contraseña" se cae a partir del 5° email.

Resend es el proveedor que adoptamos para el piloto.

## 2. Por qué Resend para el piloto

Criterios usados al elegirlo:

- **Modelo simple:** SMTP relay + API HTTP. Supabase soporta SMTP custom
  nativamente, sin código.
- **Free tier suficiente:** 3.000 emails/mes y 100 emails/día sin costo,
  alcanza para el piloto chico con margen.
- **Deliverability razonable:** SPF + DKIM + DMARC documentados, soporte
  a dominios verificados.
- **Logs y eventos:** dashboard muestra delivered/bounce/complaint con
  detalle. Importante para diagnosticar reset por email que no llega.
- **Configurable como SMTP relay** desde Supabase (no requiere
  integración via API custom; el cambio es solo settings en Supabase
  Auth).
- **Operativamente más simple que SendGrid o Mailgun** para un setup
  pre-piloto.

Decisión cerrada: **Resend para piloto.** Si crecemos, evaluamos
SendGrid/Postmark/SES más adelante. No reabrir esta decisión en este PR.

## 3. Alcance de este PR

**Sí entra:**

- Este documento (`docs/SETUP_SMTP_RESEND.md`).
- Actualización de `docs/SECURITY_GATE_PILOTO.md` cerrando el follow-up
  "SMTP builtin con rate limit ~4/h".
- Después de que el owner ejecute la integración: documentar el estado
  real (fecha, dominio, sender, resultado de smoke).

**No entra:**

- Código frontend.
- Código backend / Edge Functions.
- Migraciones SQL.
- Cambios en `LoginModal`, `ResetPasswordPage`, ni en `auth.service.ts`.
- Cambios al flujo de Reclamar perfil (eso es Fase 4 PR-B, otro PR).
- Cambios al flujo Paciente Global (otro PR).
- API keys ni credenciales reales en el repo.

Si durante el setup se detecta que una URL o copy del template de
Supabase necesita ajuste, se documenta como follow-up en este PR pero
**no** se modifica código sin abrir otro PR.

## 4. Reglas de seguridad

- ❌ **No** guardar la API key de Resend ni credenciales SMTP en el
  repo (ni en código, ni en docs, ni en `.env.example`).
- ❌ **No** documentar el secret completo. Si hace falta referenciar el
  formato, usar un placeholder genérico (ej. `re_xxxxxxxxxxxx`).
- ✅ La API key vive **solo** en Supabase Dashboard → Auth → SMTP
  Settings.
- ✅ Si el owner necesita rotarla, la rota en Resend y la actualiza en
  Supabase. Esa rotación no necesita PR — es operativa.
- ✅ `.env.local` no se toca aquí (Resend no se llama desde scripts ni
  desde frontend de LucyCare; lo usa Supabase server-side).
- ✅ Si en el futuro hay scripts propios que envíen email vía API de
  Resend, esa API key sí va en `.env.local` (igual que
  `SUPABASE_SERVICE_ROLE_KEY` hoy), nunca en el repo.

## 5. Paso a paso de configuración

> El owner ejecuta estos pasos. La doc los describe para que sean
> reproducibles desde otra máquina o por otra persona del equipo.

### 5.1 Cuenta Resend

1. Ir a [resend.com](https://resend.com) → "Sign up".
2. Crear cuenta usando el email operativo del proyecto
   (`admin@grupo-ccm.com` o equivalente que el owner controle).
3. Verificar el email de la cuenta.
4. Confirmar que estás en plan **Free** (alcanza para piloto). Documentar
   en la sección 8 si se elige otro plan.

### 5.2 Verificación de dominio

Resend requiere un dominio verificado para mandar desde
`algo@tudominio.com`. Sin dominio verificado, los envíos van desde
`onboarding@resend.dev`, lo cual no sirve para piloto real.

> ✅ **Decisión tomada en el setup real:** se usa el dominio
> `lucycare.app` (verificado en Resend, DNS en Cloudflare). Las menciones
> a otros nombres (ej. `mail.lucycare.com`) en versiones anteriores de
> este doc eran propuestas — el dominio en uso es `lucycare.app`.

**Opciones (referencia histórica del proceso de decisión):**

| Opción | Cuándo usar |
|---|---|
| Dominio principal (ej. `lucycare.app` — **elegido**) | Si el owner controla DNS y quiere mandar directo desde el dominio raíz |
| Subdominio (ej. `mail.lucycare.app`) | Aísla la reputación del subdominio sin afectar otros usos del dominio principal |
| Sin dominio propio (`onboarding@resend.dev`) | Solo para pruebas internas, **no aceptable para piloto público** |

**Recomendación operativa:** usar **subdominio** (`mail.<dominio>` o
`auth.<dominio>`).

**Pasos en Resend:**

1. Dashboard Resend → Domains → "Add Domain".
2. Ingresar el dominio o subdominio (ej. `mail.lucycare.com`).
3. Resend muestra registros DNS a configurar:
   - **SPF** (TXT) — autoriza a Resend a enviar como ese dominio.
   - **DKIM** (TXT) — firma criptográfica de los emails.
   - **DMARC** (TXT, opcional pero recomendado) — política contra
     spoofing.
4. Agregar esos registros en el DNS del dominio (Cloudflare, Namecheap,
   GoDaddy, Vercel DNS, donde esté).
5. Esperar propagación DNS (5 min a 24 h).
6. En Resend, click "Verify" en el dominio. Debe quedar en estado
   "Verified".

⚠️ Sin "Verified" no avanzar a 5.3. El SMTP autenticará pero los emails
o no llegan o caen a spam.

### 5.3 Credenciales SMTP

Resend ofrece dos formas equivalentes para integrar con Supabase
Auth — **SMTP relay** (recomendado) o **API key vía HTTP** (Supabase
no la usa por default, queda como Plan B).

**SMTP relay (recomendado):**

1. Dashboard Resend → API Keys → "Create API Key".
2. Permisos: **Sending access** (no full access). Restringe la blast
   radius si la key se filtra.
3. Nombre sugerido: `supabase-auth-prod`.
4. Guardar el API key en lugar seguro (1Password / Bitwarden del
   owner). **No** pegarla en chat ni en el repo.
5. Resend documenta los valores SMTP en
   [resend.com/docs/send-with-smtp](https://resend.com/docs/send-with-smtp).
   Los datos típicos son:
   - **Host:** `smtp.resend.com`
   - **Port:** `465` (SSL) o `587` (STARTTLS).
   - **Username:** `resend`
   - **Password:** la API key creada (formato `re_xxxxxxxxxxxx`).

> Si los valores cambian (Resend a veces actualiza host/puerto),
> usar los que muestre el dashboard oficial en el momento del setup, **no
> los de esta doc.**

### 5.4 Sender email

Definir el remitente que verán los pacientes y médicos:

| Campo | Valor sugerido |
|---|---|
| **From name** | `LucyCare` |
| **From email** | `no-reply@mail.lucycare.com` (subdominio verificado en 5.2) o `equipo@mail.lucycare.com` |

**Recomendación operativa:** `no-reply@<subdominio-verificado>`. Es
claro para el destinatario y evita que la gente responda al correo
automático.

Si se necesita un canal de respuesta, usar **Reply-To** (no From)
apuntando a `soporte@lucycare.com` o equivalente. Eso se configura
opcionalmente en el template de Supabase, no en Resend.

⚠️ El sender email **debe** estar bajo el dominio verificado en 5.2.
Si no, Resend rechaza el envío.

### 5.5 SMTP en Supabase Dashboard

Una vez verificado el dominio y obtenida la API key:

1. Supabase Dashboard del proyecto LucyCare → **Project Settings**
   → **Auth** → **SMTP Settings**.
2. Activar "Enable Custom SMTP".
3. Completar:
   - **Sender email:** el de 5.4 (ej. `no-reply@mail.lucycare.com`).
   - **Sender name:** `LucyCare`.
   - **Host:** `smtp.resend.com`.
   - **Port:** `465`.
   - **Username:** `resend`.
   - **Password:** la API key de 5.3.
   - **Minimum interval between emails:** dejar default a menos que
     Supabase lo requiera.
4. Guardar.
5. Supabase ejecuta un **test SMTP** al guardar. Debe pasar. Si falla:
   - Revisar credenciales (typos en password).
   - Revisar que el dominio del sender esté verificado en Resend.
   - Revisar logs de Resend.

### 5.6 URL Configuration

Revisar que `Site URL` y `Redirect URLs` ya estén configurados según
[`docs/FASE_4_AUTH_EMAIL.md`](FASE_4_AUTH_EMAIL.md) sección 1. Si no
están, completarlos ahora.

Valores actuales (post-PR #48 — dominio público `lucycare.app` live):

| Campo | Valor |
|---|---|
| Site URL | `https://lucycare.app` |
| Redirect URLs | `https://lucycare.app/**` |
|  | `https://www.lucycare.app/**` |
|  | `https://lucycare.vercel.app/**` (fallback temporal — no quitar todavía) |
|  | `https://lucycare-git-*.vercel.app/**` (previews) |

Detalle del corte en `docs/SETUP_VERCEL_DOMAIN.md`.

### 5.7 Email Templates

Revisar que el template de **Reset Password** esté en español según
[`docs/FASE_4_AUTH_EMAIL.md`](FASE_4_AUTH_EMAIL.md) sección 2.

Después del cambio de SMTP, los templates **no** se resetean, pero
**verificar** que sigan siendo los esperados (Supabase a veces los
revierte si toca cosas de Auth).

## 6. Datos que sí se documentan y cuáles no

**Se documentan en este repo (este archivo, sección 8):**

- Fecha de configuración.
- Dominio o subdominio verificado.
- Sender email completo.
- Resend plan (Free / Pro).
- Resultado de smoke test (OK / KO + detalle).
- Pendientes operativos si los hay.

**NO se documentan en el repo:**

- API key de Resend (vive en Supabase Dashboard + password manager del
  owner).
- Username/password SMTP completos (idem).
- Credenciales DNS del proveedor.
- Logs internos de Resend con direcciones de usuarios reales.

Si el owner necesita compartir credenciales con otro miembro del
equipo, hacerlo por canal cifrado (1Password compartido, no
Slack/email).

## 7. Checklist de validación

Ejecutar **en orden**. Cada paso debe pasar antes de marcar el
siguiente. Si uno falla, no avanzar.

### 7.1 Setup

- [ ] Cuenta Resend creada (plan documentado en §8).
- [ ] Dominio o subdominio agregado en Resend.
- [ ] Registros SPF + DKIM + DMARC configurados en el DNS del dominio.
- [ ] Dominio en estado **Verified** en Resend.
- [ ] API key creada con permisos *Sending access* (no full access).
- [ ] API key guardada en password manager (no en repo, no en chat).
- [ ] Sender email definido y bajo el dominio verificado.
- [ ] SMTP custom configurado en Supabase Dashboard → Auth → SMTP
      Settings.
- [ ] Test SMTP de Supabase (al guardar) pasó OK.
- [ ] URL Configuration revisada (sección 5.6).
- [ ] Email Template de Reset Password revisado (sección 5.7).

### 7.2 Reset por email — end to end

> Usar un usuario médico real con email accesible. Recomendado:
> Camilo (`carlosmartinezddv@gmail.com`) — ver
> `docs/CUENTA_DEMO_CAMILO.md`.

- [ ] Ir a producción `https://lucycare.app/`.
- [ ] Click "Iniciar sesión" → tab **Email** → "¿Olvidaste tu
      contraseña?".
- [ ] Ingresar el email del médico → "Enviar link".
- [ ] El form muestra "Revisá tu correo" (mensaje genérico).
- [ ] El email llega al inbox **del dominio configurado**, **no** de
      `noreply@mail.app.supabase.io` (eso indicaría que el SMTP custom
      no quedó aplicado).
- [ ] El email muestra el sender configurado en 5.4 (ej.
      `LucyCare <no-reply@lucycare.app>`).
- [ ] El email está en español (template configurado en
      `FASE_4_AUTH_EMAIL.md` §2).
- [ ] Click en el link del correo abre `https://lucycare.app/reset-password`.
- [ ] La página detecta sesión de recovery y muestra form de nueva
      contraseña.
- [ ] Ingresar contraseña ≥ 8 caracteres + confirmación → "Guardar y
      continuar".
- [ ] Redirige a `/panel` (rol doctor) o `/admin` (rol admin) según
      corresponda.
- [ ] Cerrar sesión.
- [ ] Volver a "Iniciar sesión" → tab **Email** → login con email +
      password nueva → entra correctamente.

### 7.3 Capacidad / rate limit

- [ ] Disparar **5 resets seguidos** a 5 emails distintos (o el mismo
      email cada minuto). Los 5 deben llegar — el rate limit builtin
      de Supabase (~4/h) ya no aplica con SMTP externo.
- [ ] Revisar dashboard de Resend → Logs. Los 5 envíos aparecen como
      `delivered`.

### 7.4 Deliverability básica

- [ ] Email no cae en **spam** en Gmail.
- [ ] Email no cae en **spam** en Outlook (si el owner tiene cuenta
      para probar).
- [ ] Resend Logs no muestran `bounced` ni `complained` durante el
      smoke.

## 8. Estado real de configuración

> Completado por el owner tras ejecutar el setup. Confirmado el
> **2026-05-26**. No se registran secretos (API key, password SMTP) —
> viven en Supabase Dashboard y en el password manager del owner.

| Campo | Valor |
|---|---|
| Fecha de configuración | 2026-05-26 |
| Plan Resend | no documentado en repo (revisar dashboard Resend) |
| Dominio verificado | `lucycare.app` |
| DNS | Cloudflare — SPF + DKIM + DMARC configurados |
| Sender name | `LucyCare` (confirmado en smoke: "el correo llegó desde LucyCare") |
| Sender email exacto | no documentado en repo (revisar Supabase → Auth → SMTP Settings) |
| Reply-To configurado | no documentado |
| API key Resend | creada con permisos `Sending access`, guardada en password manager del owner |
| SMTP custom activado en Supabase | ✅ sí |
| Test SMTP al guardar | ✅ OK |
| Smoke 7.2 reset end-to-end | ✅ OK 2026-05-26 — reset enviado, recibido, link abrió, cambio de contraseña OK, login con nueva contraseña OK |
| Smoke 7.3 capacidad 5 emails | ⏳ no ejecutado explícitamente — opcional, no bloqueante |
| Pendientes operativos | (1) monitorear bounce/complaint en dashboard Resend durante el piloto. (2) opcional: smoke 7.3 si se quiere validación formal de capacidad. (3) cuando se decida `Reply-To`, registrarlo aquí. |

## 9. Rollback

Si Resend falla durante el piloto o se descubre un problema operativo
crítico, el plan de retorno al SMTP builtin de Supabase es **trivial y
no requiere PR**:

1. Supabase Dashboard → Auth → SMTP Settings.
2. Desactivar "Enable Custom SMTP".
3. Guardar.
4. Supabase vuelve al SMTP builtin automáticamente.

**Consecuencias del rollback:**

- Vuelve el rate limit de ~4 emails/h. El piloto público queda con
  capacidad limitada hasta que se resuelva el problema con Resend.
- Los usuarios que ya recibieron reset link de Resend no se ven
  afectados (el token PKCE lo valida Supabase, no Resend).
- Los emails que estaban en cola en Resend al momento del rollback no
  se reenvían — eso es responsabilidad de Resend, no de Supabase.

**Mitigaciones temporales sin rollback completo:**

- Resend está caído pero la cuenta existe: pausar emails desde Resend
  no bloquea; lo mejor es rollback.
- DNS del dominio caído: rollback hasta resolver DNS.
- Reputación del dominio quemada (raro en piloto): cambiar a otro
  subdominio (`auth.lucycare.com` en vez de `mail.lucycare.com`),
  reverificar, actualizar sender en Supabase.

Después del rollback, abrir un follow-up para diagnosticar la causa.
No volver a habilitar SMTP custom hasta resolver.

## 10. Responsables operativos

| Acción | Quién |
|---|---|
| Crear cuenta Resend | Owner (`admin@grupo-ccm.com`) |
| Verificar dominio + DNS | Owner |
| Crear/rotar API key Resend | Owner |
| Configurar SMTP en Supabase Dashboard | Owner |
| Ejecutar smoke 7.2 / 7.3 / 7.4 | Owner (con apoyo de Claude para diagnóstico si hace falta) |
| Documentar resultado en §8 + commit + PR | Claude bajo dirección del owner |
| Monitorear deliverability durante piloto | Owner (semanal, vía dashboard Resend) |
| Rotación de API key si se filtra | Owner |
| Rollback de emergencia | Owner |

Claude **no** ejecuta acciones en Resend ni en Supabase Dashboard, ni
maneja secretos. El alcance de Claude en este PR es la documentación.

## 11. Pendientes / follow-ups posteriores

Documentar como follow-up **si aparecen durante el setup**, pero no
ejecutar en este PR:

- Cambio de `Site URL` a dominio propio (`lucycare.com`) cuando se
  compre/migre.
- Configurar **Reply-To** si el equipo quiere ofrecer canal de
  respuesta (`soporte@lucycare.com`).
- Templates de **Confirmation** y **Magic Link** en español (hoy solo
  está priorizado el de Reset Password).
- Monitor automático de bounce/complaint si el volumen sube
  (post-piloto, no urgente).
- Cuando el piloto crezca: revisar plan Resend (Free → Pro) y, si
  hace falta, evaluar SendGrid / Postmark / SES.
- Si Auth de Supabase recibe muchos `confirmation` de signup (cuando
  se active "Confirm email"), ajustar el template de signup también.

## 12. Referencias

- Resend docs: [resend.com/docs](https://resend.com/docs).
- Resend SMTP: [resend.com/docs/send-with-smtp](https://resend.com/docs/send-with-smtp).
- Supabase SMTP custom:
  [supabase.com/docs/guides/auth/auth-smtp](https://supabase.com/docs/guides/auth/auth-smtp).
- `docs/FASE_4_AUTH_EMAIL.md` — URL config + email templates + smoke del
  flujo de reset.
- `docs/SECURITY_GATE_PILOTO.md` — auditoría pre-piloto.
- `docs/CUENTA_DEMO_CAMILO.md` — cuenta demo oficial para smoke.
