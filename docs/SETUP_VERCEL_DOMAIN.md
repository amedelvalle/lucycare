# Setup dominio público — `lucycare.app` en Vercel

> Guía operativa para que producción de LucyCare quede accesible en
> `https://lucycare.app` (apex) con `www.lucycare.app` opcional.
> **Snapshot 2026-05-26.**
>
> Acompaña a `docs/SETUP_SMTP_RESEND.md` (Resend ya configurado sobre el
> mismo dominio) y a `docs/FASE_4_AUTH_EMAIL.md` (URL Configuration de
> Supabase Auth).
>
> Este PR es **documental y de checklist**, sin código. La
> configuración la ejecuta el owner desde los dashboards de Vercel,
> Cloudflare y Supabase.

---

## 1. Objetivo

Que producción de LucyCare quede accesible en:

- `https://lucycare.app` (dominio principal).
- Opcionalmente `https://www.lucycare.app` redirigiendo a `https://lucycare.app` (o como alias, según lo que Vercel sugiera).

Hoy producción se sirve desde `https://lucycare.vercel.app`. Vercel
sigue siendo el host; lo que cambia es solo el hostname público.

## 2. Alcance

**Sí entra (operativo, no código):**

- Agregar el dominio en Vercel → Settings → Domains.
- Configurar DNS web en Cloudflare (registros A / CNAME que pida Vercel).
- Validar SSL/HTTPS automático de Vercel.
- Actualizar Supabase Auth → URL Configuration con el dominio nuevo
  (Site URL + Redirect URLs).
- Smoke de producción con el dominio nuevo.

**No entra:**

- Cambios en código frontend, backend, scripts o migraciones.
- Cambios en lógica de la app.
- Cambios en la DB de Supabase.
- Cambios en la configuración de Resend ni en sus registros DNS
  (`resend._domainkey`, `send` MX/TXT, `_dmarc`).
- Cambios en los registros DNS existentes que no pida Vercel.
- Mover nameservers del dominio fuera de Cloudflare.
- Tocar previews de Vercel (`lucycare-git-*.vercel.app` siguen
  funcionando como hoy).

Si Vercel pide registros distintos a lo esperado, **detenerse y
reportar antes de modificar más**.

## 3. Estado actual del setup

> Documento creado al momento de abrir el PR. **El setup operativo
> aún NO está ejecutado.** Los valores reales se registran en la
> sección 8 después de que el owner lo haga.

| Item | Estado |
|---|---|
| Documentación de procedimiento | ✅ creada en este PR |
| `lucycare.app` comprado en Cloudflare | ✅ confirmado (registrado en PR #47) |
| DNS de email (Resend: SPF / DKIM / DMARC) en Cloudflare | ✅ ya configurado, **no tocar** |
| Dominio agregado en Vercel → Settings → Domains | ⏳ pendiente |
| Registros DNS web (A / CNAME) en Cloudflare | ⏳ pendiente |
| SSL/HTTPS validado por Vercel | ⏳ pendiente |
| Supabase Auth → URL Configuration actualizado | ⏳ pendiente |
| Smoke de producción (directorio + perfil + login + reset) | ⏳ pendiente |

Cuando todos esos ítems pasen a ✅, completar la sección 8 con los
valores reales antes del merge.

## 4. Reglas de seguridad

- ❌ **No** guardar credenciales de Vercel, Cloudflare, ni Supabase en
  el repo (ni en código, ni en docs, ni en `.env.example`).
- ❌ **No** tocar los registros DNS de Resend en Cloudflare. Conviven
  en la misma zona pero apuntan a hostnames distintos:
  - `resend._domainkey.lucycare.app` (TXT — DKIM).
  - `send.lucycare.app` (MX + TXT — sender de Resend).
  - `_dmarc.lucycare.app` (TXT — DMARC).
- ❌ **No** mover nameservers fuera de Cloudflare. Cloudflare debe
  seguir siendo authoritative DNS.
- ❌ **No** desactivar previews de Vercel.
- ❌ **No** cambiar el dominio configurado en Resend.
- ✅ Si Vercel sugiere wildcards o redirects que no estaban previstos,
  detenerse y consultarme antes de aplicarlos.
- ✅ Las credenciales (tokens de API de Vercel/Cloudflare si fueran
  necesarias para automatización) viven en password manager del owner,
  no en el repo.

## 5. Paso a paso de configuración

> El owner ejecuta estos pasos. La doc los describe para que sean
> reproducibles desde otra máquina o por otra persona del equipo.

### 5.1 Vercel — agregar el dominio

1. Vercel Dashboard → proyecto **LucyCare** → **Settings** → **Domains**.
2. Click **Add Domain**.
3. Ingresar `lucycare.app` → Add.
4. Vercel pregunta si querés agregar `www.lucycare.app` también. Aceptar.
5. Vercel muestra qué registros DNS espera:
   - **Apex** (`lucycare.app`) → normalmente un **A record** a la IP de Vercel (suele ser `76.76.21.21`, **confirmar con el valor exacto que muestre Vercel en el momento**).
   - **`www`** → normalmente un **CNAME** a `cname.vercel-dns.com`.

   ⚠️ Vercel a veces cambia estos valores. **Usar los que muestre el
   dashboard, no los de este doc.**

6. Definir `lucycare.app` como **Production Domain** (no solo
   "Redirect"). Si Vercel marca a `www.lucycare.app` como principal por
   default, cambiarlo: queremos apex como canónico y `www` como redirect
   opcional a apex.

### 5.2 Cloudflare — DNS web

1. Cloudflare Dashboard → zona `lucycare.app` → **DNS** → **Records**.
2. **Antes de tocar nada**, verificar que existen y dejarlos intactos:
   - `resend._domainkey` (TXT).
   - `send` MX (`feedback-smtp.us-east-1.amazonses.com` o el host que
     muestre Resend).
   - `send` TXT (SPF de Amazon SES vía Resend).
   - `_dmarc` (TXT).
3. **Agregar únicamente** los registros que pide Vercel en 5.1:
   - **A record** para `@` (apex) → IP que mostró Vercel.
   - **CNAME** para `www` → `cname.vercel-dns.com`.
4. **Proxy status (nube naranja / DNS only):**
   - **Recomendado al inicio:** dejar los registros de Vercel en **DNS
     only** (nube gris). Esto evita conflictos con la validación SSL
     automática de Vercel.
   - Una vez que SSL esté verde en Vercel y el smoke funcione, **se
     puede** activar proxy (nube naranja) si querés Cloudflare delante
     para WAF/cache. **No es necesario para piloto.**
5. Guardar.
6. Esperar propagación (1 min a 1 h dentro de Cloudflare; algunos
   resolvers externos pueden tardar más).

### 5.3 Vercel — validar SSL

1. Volver a Vercel → Settings → Domains.
2. Vercel detecta los registros DNS y emite certificado SSL automático
   (Let's Encrypt vía Vercel).
3. Esperar a que cada dominio (`lucycare.app` y `www.lucycare.app`)
   muestre **Valid Configuration** en verde + **SSL certificate
   active**.
4. Si Vercel marca error de SSL durante minutos:
   - Verificar que los registros A/CNAME estén en **DNS only** (no
     proxied) en Cloudflare.
   - Verificar que apuntan a los valores exactos que Vercel pide.
   - No reintentar manualmente más de 2-3 veces — Vercel reintenta solo.
5. Confirmar que `https://lucycare.app` y `https://www.lucycare.app`
   abren producción.

### 5.4 Supabase — actualizar URL Configuration

> **Hacer este paso DESPUÉS de que SSL esté verde y el dominio
> funcione**, no antes. Si lo hacés antes, los emails de reset apuntan
> a un dominio que aún no responde.

1. Supabase Dashboard → proyecto LucyCare → **Authentication** →
   **URL Configuration**.
2. Cambiar:
   - **Site URL:** `https://lucycare.app`.
3. **Redirect URLs** (lista). Asegurar que contenga:
   - `https://lucycare.app/**`
   - `https://www.lucycare.app/**` (si se decide soportar www).
   - `https://lucycare-git-*.vercel.app/**` (preservar previews).
   - `https://lucycare.vercel.app/**` (preservar URL antigua durante
     período de transición — opcional, ver §5.6 para cuándo quitarla).
4. Guardar.

Efecto:

- A partir de este momento, todos los emails de Auth nuevos
  (reset password, magic link, confirmation) usan `https://lucycare.app`
  como destino del link.
- Los reset links ya enviados (en inbox de usuarios) y aún no usados
  siguen apuntando a `https://lucycare.vercel.app/reset-password` —
  durante 1h hasta que expiren. Mientras `lucycare.vercel.app` siga
  funcionando (Vercel lo mantiene), esos links siguen siendo válidos.

### 5.5 Smoke de producción

> Validar antes de comunicarle a los pacientes el dominio nuevo.

1. **Abrir `https://lucycare.app`** desde un browser limpio (ventana
   incógnito recomendado para evitar caches).
2. La home debe cargar y mostrar el directorio.
3. **Buscar médicos** — el filtro de directorio funciona.
4. **Abrir un perfil público** (ej. Camilo) — carga datos + foto + pill
   "Agenda en línea".
5. **Login paciente con OTP** (Test Phone `50375000001` / `123456`) —
   completa el flow, "Mi cuenta" aparece en el header.
6. **Login médico con email + password** — si el médico tiene password
   creada (Camilo en QA), tab Email → funciona.
7. **Reset por email end-to-end con el dominio nuevo**:
   - Modal Login → tab Email → "¿Olvidaste tu contraseña?".
   - Pedir reset al email del médico de prueba.
   - El email debe llegar con link a `https://lucycare.app/reset-password`,
     no a `lucycare.vercel.app`.
   - Click → abre `/reset-password` en el dominio nuevo.
   - Definir nueva contraseña → redirige a `/panel`.
   - Cerrar sesión → login con la nueva contraseña → entra.
8. **Reserva pública** (booking) — el flow con OTP funciona end-to-end.
9. **`https://www.lucycare.app`** redirige o sirve igual que apex,
   según lo que se configuró en Vercel.

### 5.6 Limpieza post-validación (opcional, días después)

Cuando estés tranquilo de que el dominio nuevo funciona y nadie está
pidiendo soporte por links viejos, podés:

- Quitar `https://lucycare.vercel.app/**` de Redirect URLs de Supabase
  (cuando estés seguro de que ningún usuario tiene reset links viejos
  flotando — esperar al menos 24h post-corte).
- Configurar `lucycare.vercel.app` como redirect a `lucycare.app` desde
  Vercel (Settings → Domains → editar el dominio default).
- Considerar activar proxy de Cloudflare (nube naranja) si querés WAF.

**No** son acciones bloqueantes ni se hacen en este PR.

## 6. Datos que sí se documentan y cuáles no

**Se documentan en este repo (este archivo, sección 8):**

- Fecha de configuración.
- IP exacta del A record que Vercel pidió.
- Nombre del CNAME que Vercel pidió (probablemente `cname.vercel-dns.com`).
- Estado del proxy de Cloudflare (DNS only / Proxied) al cierre del
  setup.
- Estado de SSL al cierre.
- Resultado del smoke 5.5.
- Pendientes operativos si los hay.

**NO se documentan en el repo:**

- Tokens de API de Vercel ni de Cloudflare.
- Credenciales de admin del dashboard.
- API key de Resend (ya documentado en `SETUP_SMTP_RESEND.md` que no va).

## 7. Checklist de validación

Ejecutar **en orden**. Cada paso debe pasar antes de marcar el
siguiente.

### 7.1 Setup

- [ ] Dominio `lucycare.app` agregado en Vercel → Settings → Domains.
- [ ] `www.lucycare.app` agregado (si aplica).
- [ ] `lucycare.app` definido como **Production Domain** principal.
- [ ] Vercel mostró los registros DNS esperados (A + CNAME).
- [ ] Cloudflare: registros de Resend (`resend._domainkey`, `send` MX,
      `send` TXT, `_dmarc`) verificados como intactos.
- [ ] Cloudflare: A record para apex agregado, **DNS only**, valor
      exacto pedido por Vercel.
- [ ] Cloudflare: CNAME `www` agregado, **DNS only**, valor exacto
      pedido por Vercel.
- [ ] Vercel: ambos dominios muestran **Valid Configuration** + SSL
      verde.

### 7.2 Supabase Auth

- [ ] **Sólo después** de que SSL esté verde:
- [ ] Site URL cambiado a `https://lucycare.app`.
- [ ] Redirect URLs contiene `https://lucycare.app/**`.
- [ ] Redirect URLs contiene `https://www.lucycare.app/**` (si aplica).
- [ ] Redirect URLs conserva el wildcard de previews
      `https://lucycare-git-*.vercel.app/**`.
- [ ] Redirect URLs conserva temporalmente `https://lucycare.vercel.app/**`
      (limpieza opcional en §5.6 días después).

### 7.3 Smoke producción

- [ ] `https://lucycare.app` carga la home en ventana incógnito.
- [ ] Búsqueda de médicos funciona.
- [ ] Perfil público abre OK con foto + pill "Agenda en línea".
- [ ] Login paciente con OTP (Test Phone) funciona, "Mi cuenta"
      aparece en header.
- [ ] Login médico con email+password funciona (si hay password creada).
- [ ] Reset por email: link llega apuntando a `https://lucycare.app/reset-password`,
      no a `lucycare.vercel.app`.
- [ ] Reset password completo: link abre, nueva contraseña guarda,
      redirige a `/panel`, login con nueva contraseña OK.
- [ ] Booking público OTP end-to-end OK.
- [ ] `https://www.lucycare.app` se comporta como esperado (redirect o
      alias, lo que se haya configurado).

### 7.4 Verificaciones cruzadas

- [ ] DNS de Resend siguen intactos (verificar visualmente en Cloudflare
      tras los cambios).
- [ ] Envío de email desde Resend sigue funcionando (un reset post-corte
      llega).
- [ ] `lucycare.vercel.app` sigue funcionando (Vercel lo mantiene como
      dominio default).

## 8. Estado real de configuración

> El owner completa esta sección **después** de ejecutar el setup,
> dentro del mismo PR antes del merge.

| Campo | Valor |
|---|---|
| Fecha de configuración | _pendiente_ |
| Production Domain definido en Vercel | _pendiente_ (esperado: `lucycare.app`) |
| `www` configurado | _pendiente_ (sí / no; redirect / alias) |
| A record apex en Cloudflare | _pendiente_ (IP exacta pedida por Vercel) |
| CNAME www en Cloudflare | _pendiente_ (esperado: `cname.vercel-dns.com`) |
| Proxy de Cloudflare al cierre del setup | _pendiente_ (DNS only / Proxied) |
| SSL en Vercel | _pendiente_ (verde / problema) |
| Supabase Site URL | _pendiente_ (esperado: `https://lucycare.app`) |
| Supabase Redirect URLs | _pendiente_ (listar los valores efectivos al cierre) |
| Smoke 7.3 producción | _pendiente_ (OK / KO + fecha) |
| Pendientes operativos | _pendiente_ |

## 9. Rollback

Si algo falla durante el corte y necesitás volver a `lucycare.vercel.app`
en minutos:

1. **Supabase Auth → URL Configuration:**
   - Site URL: revertir a `https://lucycare.vercel.app`.
   - Redirect URLs: dejar `https://lucycare.app/**` (no daña) +
     `https://lucycare.vercel.app/**` primero.
2. **Vercel → Settings → Domains:**
   - Cambiar el Production Domain de vuelta a `lucycare.vercel.app`.
   - **No** borrar `lucycare.app` — solo despriorizarlo.
3. **Cloudflare:** no hace falta tocar nada. Los registros A/CNAME para
   Vercel pueden quedarse (no estorban).

Consecuencias del rollback:

- Producción vuelve a `lucycare.vercel.app` en minutos (sin tocar DNS).
- Los reset links nuevos vuelven a apuntar a `vercel.app`.
- Los reset links ya enviados con dominio nuevo siguen funcionando si
  `lucycare.app` resuelve a Vercel; si no, fallan hasta que se arregle.

Después del rollback: diagnosticar qué falló (SSL, DNS, Supabase URL)
y reabrir el corte cuando esté solucionado.

## 10. Responsables operativos

| Acción | Quién |
|---|---|
| Agregar dominio en Vercel | Owner |
| Configurar DNS web en Cloudflare | Owner |
| Verificar SSL en Vercel | Owner |
| Actualizar Supabase Auth URL Configuration | Owner |
| Ejecutar smoke 7.3 | Owner (con apoyo de Claude para diagnóstico si falla algo) |
| Documentar resultado en §8 + commit + PR | Claude bajo dirección del owner |
| Monitor post-corte (24-48h) | Owner |
| Rollback de emergencia | Owner |

Claude **no** ejecuta acciones en Vercel, Cloudflare, ni Supabase
Dashboard, ni maneja secretos. El alcance de Claude en este PR es la
documentación.

## 11. Pendientes / follow-ups posteriores

Documentar como follow-up **si aparecen durante el setup**, pero no
ejecutar en este PR:

- **Refresh de docs que referencian `lucycare.vercel.app`** una vez que
  el corte esté firme. Hoy tienen referencias:
  - `docs/FASE_4_AUTH_EMAIL.md` (sección 1 — URL Configuration).
  - `docs/SETUP_SMTP_RESEND.md` (sección 5.6).
  - `docs/SECURITY_GATE_PILOTO.md` (sección 7.2 smoke).
  - `docs/PLAN_PILOTO_5_MEDICOS.md`.
  - `CLAUDE.md` (nota explícita actual: "producción aún en `lucycare.vercel.app`").
  - `docs/HANDOFF_LUCYCARE_SPRINT7.md`.
  - `docs/HANDOFF_TOMA_DECISIONES_2.md`.

  Estos docs se actualizan en un mini PR documental aparte (similar al
  PR #47), después de validar el corte en producción.

- **Considerar activar proxy de Cloudflare** (nube naranja) para
  habilitar WAF y cache. No bloqueante. Post-piloto.

- **Configurar redirect 301** de `lucycare.vercel.app` → `lucycare.app`
  desde Vercel cuando esté tranquilo el corte (§5.6).

- **Limpieza de Redirect URLs** en Supabase: quitar
  `lucycare.vercel.app/**` cuando ya no haya links viejos flotando.

- **`Reply-To` en email templates** si el equipo decide ofrecer canal
  de respuesta (`soporte@lucycare.app`). Es independiente del dominio
  web.

## 12. Referencias

- Vercel — Configuring a custom domain: [vercel.com/docs/projects/domains](https://vercel.com/docs/projects/domains).
- Cloudflare DNS records: [developers.cloudflare.com/dns](https://developers.cloudflare.com/dns/).
- Supabase Auth — URL Configuration:
  [supabase.com/docs/guides/auth/concepts/redirect-urls](https://supabase.com/docs/guides/auth/concepts/redirect-urls).
- `docs/SETUP_SMTP_RESEND.md` — Resend SMTP (✅ live).
- `docs/FASE_4_AUTH_EMAIL.md` — Supabase URL/email config para reset
  por email.
- `docs/HANDOFF_TOMA_DECISIONES_2.md` — handoff corto, pendientes
  inmediatos.
