# Análisis — Analytics / medición de tráfico y conversión de LucyCare

> **Estado:** diseño (PR-0 docs-only). **No habilita implementación.** El
> primer PR funcional (Fase 1A) se abre aparte, con su propia autorización.
> HEAD base `42debaf` · PRs #1–#213 · migraciones `s7_52`.
>
> **Objetivo del frente:** saber si el directorio `lucycare.app` tiene éxito
> — tráfico, usuarios, perfiles vistos, búsquedas/filtros, fuentes y embudo
> de conversión (reserva / lista de espera / reclamo / afiliación) — **sin
> capturar jamás datos clínicos ni PII**.

---

## 1. Estado actual (verificado en el repo, 2026-07-01)

- **Cero analytics de cualquier tipo:** no hay `@vercel/analytics`/Speed
  Insights, GA4/`gtag`, Plausible, PostHog, Segment/Mixpanel/Amplitude, ni
  scripts de tracking. `index.html`, `package.json`, `vercel.json` y `src/`
  limpios.
- **Sin tabla propia de eventos/telemetría** en Supabase.
- **Sin banner de cookies/consentimiento.**
- **Datos de conversión que YA existen (verdad de servidor, en DB):**
  `appointments` (reservas creadas/completadas), `waitlist_entries`
  (interés/lista de espera), `doctor_affiliation_requests` (leads "Soy
  médico"), `reviews`. → conversión real ya medible por **consulta**, sin
  tracking de cliente.
- **Search Console** (externo, gratis) **conectable ya** porque
  `sitemap.xml` + `robots.txt` están live (#212).
- **Brecha real:** el **comportamiento en el frontend** (pageviews, clics,
  búsquedas/filtros, fuentes, embudo) **no se mide** — eso requiere una
  herramienta de cliente.

## 2. Decisiones Q1–Q5 (cerradas)

- **Q1 — Herramienta primaria:** **Vercel Web Analytics + Speed Insights**
  (cookieless, integrado con Vercel, bajo riesgo, suficiente para
  tráfico/páginas públicas). **GA4 NO** como primario. Plausible / PostHog EU
  quedan como alternativas **futuras** si Vercel se queda corto para embudos
  o segmentación avanzada.
  - ⚠️ **A confirmar antes de eventos custom:** si el **plan actual de
    Vercel** soporta `track()` (custom events). Si requiere Pro/Enterprise y
    no estamos en ese plan, **Fase 1 se limita a pageviews / Web Analytics /
    Speed Insights**, y los eventos custom quedan para decisión posterior
    (subir plan vs Plausible vs PostHog EU anónimo).
- **Q2 — Alcance inicial:** (1) Vercel Analytics + Speed Insights para
  tráfico/performance público; (2) Search Console como **tarea operativa del
  owner, sin código**; (3) dashboard DB read-only en LucyAdmin **aprobado
  conceptualmente pero NO entra en el primer PR funcional**. No mezclar
  dashboard DB con la instalación de Analytics.
- **Q3 — Política cookieless (obligatoria en Fase 1):** cookieless; **sin
  banner** de cookies; sin herramientas que dependan de cookies/tracking
  invasivo; **sin session replay**; GA4 no primario.
- **Q4 — Identificador de médico:** `doctor_slug` como identificador
  principal en eventos + dimensiones públicas estructuradas (`specialty_id`,
  `department_id`, `municipality_id`, `is_bookable`). La búsqueda se mide
  como `has_query: true/false` + filtros estructurados, **nunca el texto
  digitado**.
- **Q5 — Dashboard de conversión:** sí, en LucyAdmin sobre datos reales de
  DB, pero como **frente posterior**. Separación firme:
  - **Analytics frontend público** = tráfico/comportamiento.
  - **DB / dashboard LucyAdmin** = conversión real de servidor.
  - **No mezclar ambos** en el primer PR funcional.

## 3. Arquitectura por fases

- **Fase 1A — tráfico básico (primer PR funcional, aparte):** `@vercel/
  analytics` + `@vercel/speed-insights`, montados **solo para rutas
  públicas**, excluyendo `/panel`, `/admin`, `/paciente` y flujos clínicos.
  **Sin eventos custom, sin PII, cookieless.**
- **Fase 1B — operativa del owner (sin código):** conectar Google Search
  Console, enviar/validar `sitemap.xml`, monitorear indexación de
  `/doctor/:slug`.
- **Fase 2 — eventos del directorio/perfiles:** eventos §4 (búsqueda/filtros,
  clic en tarjeta, view de perfil, compartir, contacto), **si el plan de
  Vercel soporta custom events**; si no, decidir subir plan / Plausible /
  PostHog EU anónimo.
- **Fase 3 — dashboard de conversión LucyAdmin:** vista read-only sobre
  `appointments`, `waitlist_entries`, `doctor_affiliation_requests`
  (conversión real de servidor), cruzada opcionalmente con los eventos.
- **Fase 4 — dashboards por médico/especialidad/canal:** ranking de
  `/doctor/:slug`, especialidades/ubicaciones con más interés, qué canal
  (orgánico/WhatsApp) convierte mejor.

## 4. Taxonomía inicial de eventos (comportamiento, nunca clínico)

Identificador de médico = **`doctor_slug`** (público, legible, mapea a
especialidad/ubicación).

| Evento | Propiedades permitidas |
|---|---|
| `page_view` (auto) | path (solo rutas públicas), referrer_type |
| `directory_search` | `has_query:bool`, `specialty_id?`, `department_id?`, `municipality_id?`, `booking_only:bool` — **NO el texto** |
| `doctor_card_click` | `doctor_slug`, `specialty_id`, `source:directory\|search` |
| `doctor_profile_view` | `doctor_slug`, `specialty_id`, `municipality_id`, `is_bookable:bool`, `referrer_type` |
| `booking_cta_click` | `doctor_slug` |
| `booking_started` | `doctor_slug`, `service_id` |
| `booking_completed` | `doctor_slug`, `service_id` — **mejor desde la DB (`appointments`)**, no del cliente |
| `waitlist_click` / `waitlist_submitted` | `doctor_slug` |
| `contact_click` | `doctor_slug`, `channel:call\|whatsapp` |
| `share_click` | `doctor_slug`, `method:native\|copy` |
| `claim_profile_click` | `doctor_slug` |
| `affiliation_open` / `affiliation_submitted` | (sin PII del lead) |

**Dimensiones de segmentación (públicas, seguras):** `doctor_slug`,
`specialty_id`, `department_id`/`municipality_id`, `referrer_type`,
`is_bookable`.

## 5. Propiedades permitidas / PROHIBIDAS (vinculante)

**Permitido:** `doctor_slug`, `specialty_id`, `department_id`,
`municipality_id`, `is_bookable`, `has_query:bool`, `booking_only:bool`,
`service_id`, `channel`, `method`, `source`, `referrer_type`, path público.

**PROHIBIDO enviar al proveedor de analytics (nunca):**
- nombre del paciente · teléfono · email · DUI/documento;
- **texto libre de búsqueda** (podría contener el nombre del propio usuario o
  de un tercero) → solo `has_query` + filtros estructurados;
- contenido de formularios libres;
- diagnósticos · recetas · notas clínicas · cualquier dato clínico/sensible;
- licencia/JVPM/NUE · teléfono del médico;
- nombre del médico (redundante con el slug, que ya es público).

**Regla general:** todo evento es de **comportamiento/producto**, jamás
clínico ni PII.

## 6. Política de privacidad / cookieless

- **Cookieless obligatorio** (Fase 1) → **sin banner de consentimiento** y
  menor superficie legal en contexto salud.
- **Cargar analytics SOLO en rutas públicas** (`/`, `/doctor/*`); **nunca**
  en `/panel`, `/admin`, `/paciente` ni en la consulta clínica.
- **Sin session replay** (riesgo de PHI).
- **Sin PII/PHI** en ningún payload (ver §5).
- Verificar que la herramienta **no persista IP cruda**; las cookieless
  anonimizan.
- Acuerdo de tratamiento de datos con el proveedor si en el futuro se usa
  PostHog cloud / GA4 (no en Fase 1).

## 7. Alcance del primer PR funcional (Fase 1A) — SOLO diseño por ahora

**Propuesto, NO implementar aún:**
- Instalar `@vercel/analytics` + `@vercel/speed-insights` (deps → toca
  `package.json`/lockfile; se señala porque los frentes SEO fueron
  dependency-free).
- Montar `<Analytics/>` + `<SpeedInsights/>` **una vez**, **solo para rutas
  públicas**, excluyendo `/panel`, `/admin`, `/paciente` y flujos clínicos.
- **Sin eventos custom** (Fase 2), **sin cookies**, **sin banner**, **sin
  PII**.
- **Fase 1B operativa (owner, sin código):** conectar Search Console + enviar
  sitemap + monitorear indexación de `/doctor/:slug`.

## 8. Riesgos y validaciones (para el PR de Fase 1A)

**Riesgos:**
- PII accidental por texto libre (búsqueda) → no enviarlo.
- Cargar analytics en rutas privadas/clínicas → gate a rutas públicas.
- Cookies inadvertidas → verificar 0 cookies nuevas.
- Dependencia nueva (2 paquetes) → revisar tamaño/impacto de bundle.

**Validaciones antes de mergear el PR funcional:**
- `npx tsc --noEmit` + `npm run build` verdes.
- Preview: beacon de Vercel Analytics presente en una **ruta pública**;
  **0 cookies** nuevas; **0 errores** de consola.
- Confirmar que **no** se carga/emite en `/panel`, `/admin`, `/paciente`.
- Confirmar que **ningún** payload lleva PII ni texto libre.
- OK visual del owner + validación en producción tras merge.

## 9. Qué NO se implementa en este PR (PR-0)

Docs-only. **No** se toca: código funcional · `package.json` · lockfile ·
Vercel config · scripts de analytics · React · middleware · DB · SQL ·
migraciones · `database.types.ts` · rutas privadas · dashboards.

---

# Cierre — Fase 1A LIVE (post-#215)

> HEAD `d41a6dc` · PRs #1–#215 · migraciones `s7_52` · `main == origin/main`.
> **PR #215 fue frontend/deps: sin DB/SQL/migraciones.** Producción validada
> en `https://lucycare.app`.

## Estado de las fases

| Fase / PR | Estado |
|---|---|
| PR-0 — diseño docs-only | ✅ **PR #214** |
| Fase 1A — Vercel Web Analytics + Speed Insights (rutas públicas) | ✅ **PR #215** + producción + validación del owner |

**Pendientes NO iniciados** (requieren autorización explícita):
- **Fase 1B** — Search Console (tarea operativa del owner, sin código).
- **Fase 2** — eventos custom del directorio/perfiles (sujeto a confirmar que
  el plan de Vercel soporta `track()`; si no, decidir Plausible / PostHog EU).
- **Fase 3** — dashboard LucyAdmin read-only sobre conversiones reales en DB
  (`appointments`, `waitlist_entries`, `doctor_affiliation_requests`).
- **Fase 4** — dashboards por médico/especialidad/canal.

## Qué quedó implementado (PR #215)

- Dependencias: `@vercel/analytics` + `@vercel/speed-insights`.
- Componente **`src/components/PublicAnalytics.tsx`**, montado **una sola
  vez** dentro de `App.tsx` (dentro de `BrowserRouter`).
- **Allowlist de rutas públicas** (único, compartido por render y
  `beforeSend`): `/`, `/doctor/*`, `/privacidad`.
- **Exclusión de rutas privadas/sensibles:** `/panel`, `/admin`,
  `/paciente`, `/reset-password`, y rutas con token como `/calificar/:token`.
- **Defensa doble de privacidad:**
  1. **render allowlist** — el componente solo se monta (inyecta scripts) en
     rutas públicas; en el resto devuelve `null`;
  2. **`beforeSend` allowlist (backstop)** — antes de emitir cualquier
     evento revalida el path y **retorna `null`** si no es público (cubre la
     carrera SPA al navegar público→privado). Aplica a Web Analytics **y** a
     Speed Insights.
- `beforeSend` **elimina query/hash** de la URL reportada (solo
  `origin+pathname`); si la URL no parsea → `null`.
- **Sin** eventos custom · **sin** cookies · **sin** PII · **sin** datos
  clínicos · **sin** texto libre de búsqueda · **sin** dashboard DB todavía.

## Validación registrada

**Técnica (dev):**
- Endpoints `/_vercel/insights/script.js` y `/_vercel/speed-insights/script.js`
  → **200** en producción; el bundle productivo ya incluye Analytics/Speed
  Insights (`va.vercel-scripts.com`).
- **SEO/OG de `/doctor/*` intacto**, `/robots.txt` intacto, `/sitemap.xml`
  intacto (35 URLs) — sin regresión.
- En preview: `beforeSend` bloquea el pageview de `/panel` (log *"Page view
  would be ignored by `beforeSend` because null was returned"*); query/hash
  eliminados (un `?secret=…&q=nombrepaciente#frag` de prueba NO se envía);
  0 cookies; `tsc`+`build` verdes.

**Manual del owner (navegador productivo):**
- En página pública, con filtro `vercel` en Network: se observaron
  `script.js`, `view`, `vitals`, respuestas **200**.
- En `/panel` (filtro `vercel`): **sin requests**.
- En `/paciente/mis-atenciones` (filtro `vercel`): **sin requests**.
- Conclusión: Analytics **carga en público y no carga en rutas privadas**.

## Tareas operativas del owner (sin código)
- Habilitar **Web Analytics + Speed Insights** en el dashboard del proyecto
  Vercel para que fluyan los datos.
- **Fase 1B:** conectar Google Search Console + enviar el sitemap.

---

# Cierre — Fase 1B (Search Console) operativa ✅ (2026-07-02)

> HEAD `82d8feb` · PRs #1–#218 · migraciones `s7_52`. Tarea operativa del
> owner (sin código, salvo los 2 archivos de verificación).

- **Google Search Console verificado** por método de **archivo HTML**.
- **Archivos de verificación permanentes** en `public/` (no borrar — Google
  requiere mantenerlos):
  - `public/google3f2e02a3c176b538.html` (PR #217)
  - `public/googlef334c08cb9e5d942.html` (PR #218, verificación por "Prefijo
    de URL")
  - Ambos live en producción (200, `text/html`, contenido exacto, servidos
    como estáticos sin caer en el `index.html` del SPA).
- **Sitemap enviado y procesado** en Search Console:
  - Sitemap: `https://lucycare.app/sitemap.xml`
  - **Estado: Correcto** · Última lectura: **2 jul 2026** · **Páginas
    descubiertas: 35** · Videos: 0.
- **Nota de seguimiento (owner, sin código):** "descubiertas" ≠
  "indexadas"; la indexación real tarda días/semanas. Revisar más adelante
  en Search Console → *Páginas* (indexadas vs no) y *Rendimiento*
  (impresiones/clics).
- **Solicitud de indexación manual (owner, 2026-07-02):** se pidió la
  indexación de al menos un perfil principal desde Search Console
  (Inspección de URL → "Solicitar indexación"); Google respondió *"Se ha
  solicitado la indexación"*. **Esto NO garantiza indexación inmediata**: la
  URL queda en **cola de revisión** de Google. **Recomendación:** **no
  repetir** la solicitud varias veces (no acelera y puede ser
  contraproducente); **monitorear** el estado en Search Console durante los
  próximos días.

**Con esto, Analytics/Search Console Fase 1B queda CERRADA (operativa).**
Pendientes NO iniciados: Fase 2 (eventos custom, sujeto al plan Vercel) ·
Fase 3 (dashboard conversión DB) · Fase 4 (dashboards por médico/
especialidad/canal); y en Slugs+SEO: PR D · Fase 4 (landings).

---

# Fase 2 — PR-0 · Diagnóstico de eventos de comportamiento (diseño, NO implementación)

> **Estado:** diseño docs-only. **No habilita implementación** de eventos.
> Base: HEAD `c7688e8` · PRs #1–#240 · migraciones `s7_52`. Profundiza la
> Fase 2 ya prevista en §3/§4; **no reabre** Q1–Q5 (cerradas). El primer PR
> funcional de Fase 2 requiere su propia autorización **y** el gate operativo
> del plan de Vercel (§F2.5).

## F2.1 — Estado actual de la medición (verificado en el repo)

| Herramienta | Estado real |
|---|---|
| **Vercel Web Analytics** (`@vercel/analytics ^2.0.1`) | ✅ live — pageviews cookieless (Fase 1A) |
| **Vercel Speed Insights** (`@vercel/speed-insights ^2.0.0`) | ✅ live |
| GA / gtag · PostHog · Plausible · Mixpanel · Amplitude · Segment | ❌ ninguno |
| **Eventos custom `track()`** | ❌ **cero** en `src/` — Fase 1A es SOLO pageviews |
| Tabla de eventos propia en DB | ❌ no existe |
| Env de analytics | ❌ solo `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` |
| Search Console + sitemap | ✅ Fase 1B (35 páginas) |

- Implementación viva: `src/components/PublicAnalytics.tsx` (montado 1× en
  `App.tsx`; allowlist `/`·`/privacidad`·`/doctor`·`/doctor/*`; defensa doble
  render + `beforeSend`; recorte de query/hash).
- **Dimensiones seguras ya disponibles client-side** (`src/types/directory.types.ts`):
  `slug`, `specialtyId`, `departmentId`, `municipalityId`, `bookingEnabled`
  (= `is_bookable`), `serviceId`. La búsqueda es texto libre (`filters.search`)
  → **jamás se envía**, solo `has_query`.

## F2.2 — Brecha que cubre Fase 2

- **Conversión DURA ya es medible por DB** (verdad de servidor, sin tracking):
  `appointments`, `waitlist_entries`, `doctor_affiliation_requests`, `reviews`.
- **Lo que la DB NO ve** (brecha de Fase 2): pageviews, clics, búsquedas/
  filtros, fuente de tráfico y **abandono** (intención sin conversión).
- **Regla de diseño:** medir la conversión dura por **DB (Fase 3)** y usar los
  eventos de cliente para **comportamiento/abandono** (sobre todo los
  `*_started`). Los `*_completed`/`*_submitted` son más fiables desde DB.

## F2.3 — Riesgos de privacidad (contexto salud)

1. **Texto libre de búsqueda** (puede traer el nombre del propio usuario o de
   un tercero) → prohibido; solo `has_query:bool`.
2. **Fuga a rutas privadas/clínicas** → eventos solo en superficies públicas;
   el `beforeSend` existente es el backstop.
3. **PII en payloads de conversión** (waitlist/afiliación/claim/booking manejan
   teléfono/email/DUI/nombre) → el evento lleva solo `doctor_slug` +
   dimensiones estructuradas, nunca el contenido del formulario.
4. **URL con query/hash** (`?q=nombre`) → recortada en `beforeSend`.
5. **Cookies / session replay** → banner legal + riesgo PHI → cookieless, sin
   replay (Q3).
6. **Nombre del médico** → redundante con el slug (ya público); no enviarlo.
7. **IP cruda** → mantener proveedor cookieless (Vercel no persiste IP cruda).

## F2.4 — Eventos recomendados (disparo · props · superficie · riesgo)

Identificador de médico = **`doctor_slug`**. Todas las props son enum/id;
**ninguna** admite texto libre. Refina §4 con el punto de disparo real.

| Evento | Cuándo dispara | Props permitidas | Prohibidas | Riesgo |
|---|---|---|---|---|
| `home_view` | **pageview auto** de Vercel en `/` — NO crear custom | (path público, referrer auto) | — | bajo |
| `doctor_profile_view` | pageview auto en `/doctor/*`; custom solo si se quieren dimensiones | `doctor_slug`, `specialty_id`, `municipality_id`, `is_bookable` | nombre, teléfono | bajo |
| `directory_search` | al ejecutar búsqueda/filtro (debounced) | `has_query:bool`, `specialty_id?`, `department_id?`, `municipality_id?`, `booking_only:bool` | **el texto digitado** | medio |
| `filter_used` | cambio de un filtro estructurado | `filter:specialty\|department\|municipality\|booking_only`, `value_id?` | texto libre | bajo |
| `doctor_card_click` | clic en tarjeta / "Reservar cita" / "Ver perfil" del grid | `doctor_slug`, `specialty_id`, `source:directory\|search` | nombre | bajo |
| `booking_cta_click` | clic "Reservar cita"/"Reservar ahora" en el perfil | `doctor_slug` | nombre de servicio libre | bajo |
| `booking_started` | se abre el flujo real (`BookingCard`/`MobileBookingSheet`) con servicio | `doctor_slug`, `service_id` | precio como texto, PII | bajo |
| `booking_completed` | **preferir DB** (`appointments`); si cliente, éxito de `createBooking` | `doctor_slug`, `service_id` | paciente, teléfono | medio |
| `waitlist_started` | se abre `WaitlistModal` | `doctor_slug` | — | bajo |
| `waitlist_submitted` | éxito de `submitWaitlistEntry` | `doctor_slug` | teléfono/nombre del lead | medio |
| `contact_click` | clic Llamar / WhatsApp en el perfil | `doctor_slug`, `channel:call\|whatsapp` | teléfono | bajo |
| `share_clicked` | `handleShare` (perfil) | `doctor_slug`, `method:native\|copy` | URL con query | bajo |
| `doctor_affiliation_started` | abrir `AffiliationRequestModal` ("Soy médico") | *(ninguna PII)* | nombre/tel/email/JVPM del lead | bajo |
| `doctor_affiliation_submitted` | éxito del envío del lead | *(ninguna PII)* | todo el formulario | medio |
| `claim_profile_started` | abrir `ClaimProfileModal` | `doctor_slug` | — | bajo |
| `claim_profile_completed` | éxito del claim (`claim_doctor_profile`) | `doctor_slug` | teléfono/JVPM/OTP | medio |

**Notas:**
- `home_view` y el `doctor_profile_view` básico **ya los da el pageview
  automático** de Vercel → no gastar un evento custom salvo por las dimensiones.
- `*_completed`/`*_submitted` = **más fiables desde DB** (el beacon puede no
  llegar); reservarlos para Fase 3.

## F2.5 — Props permitidas / PROHIBIDAS + gate del plan de Vercel

**Permitido (estructurado/seguro):** `doctor_slug`, `specialty_id`,
`department_id`, `municipality_id`, `is_bookable`, `has_query:bool`,
`booking_only:bool`, `service_id`, `channel`, `method`, `source`,
`referrer_type`, path público. *(Reafirma §5.)*

**PROHIBIDO (nunca al proveedor):** nombre de paciente · teléfono · email ·
DUI/documento · **texto libre de búsqueda** · contenido de formularios ·
diagnósticos/recetas/notas/cualquier dato clínico · JVPM/NUE · teléfono/nombre
del médico. Todo evento es de **comportamiento/producto**, jamás clínico.

**⚠️ Gate operativo (bloqueante, del owner — NO de código):** los **Custom
Events de Vercel Web Analytics requieren plan Pro**. En Hobby, `track()` se
puede llamar pero **los eventos no se ingieren**. **Antes** de abrir el primer
PR funcional de Fase 2, confirmar en el dashboard de Vercel que el plan del
proyecto **ingiere Custom Events**. Si no lo soporta y no se sube a Pro →
decidir **Plausible** (cookieless, EU, plan B más limpio) vs **PostHog EU
anónimo** (embudos avanzados, mayor superficie legal; sin cookies/replay) vs
subir plan. **GA4 descartado** (Q1). **Tabla de eventos propia en Supabase NO
recomendada** ahora (reinventa analytics + añade riesgo PII/DB).

**Recomendación:** si el plan soporta `track()`, seguir con **Vercel** (menor
fricción, mismo proveedor, cookieless). Es coherente con Q1.

## F2.6 — Arquitectura por PRs pequeños (propuesta, NO implementar)

- **PR 2.0 (operativo, sin código):** el owner confirma en Vercel si el plan
  **ingiere Custom Events** (gate de todo lo demás). *(Fase 1A/1B ya cubren el
  "mínimo viable" de pageviews.)*
- **PR 2.1 — helper + eventos de descubrimiento (bajo riesgo):** un único
  helper `trackPublic(event, props)` que (a) valida ruta pública, (b) aplica
  **whitelist de props** y descarta cualquier prop no listada (defensa
  centralizada anti-PII). Cablea `directory_search` (con `has_query` solo),
  `filter_used`, `doctor_card_click`, `doctor_profile_view`, `share_clicked`,
  `contact_click`. Solo `.tsx` públicos + el helper; sin DB, sin PII.
- **PR 2.2 — eventos de intención de conversión:** `booking_cta_click`/
  `booking_started`, `waitlist_started`, `claim_profile_started`,
  `doctor_affiliation_started` (los `*_started` = intención/abandono por
  cliente; los `*_completed`/`*_submitted` se dejan para DB).
- **PR 3 — dashboard de conversión LucyAdmin (Fase 3, frente aparte):**
  read-only sobre `appointments`/`waitlist_entries`/
  `doctor_affiliation_requests` (conversión dura). No mezclar con Analytics de
  cliente; toca lectura de DB → su propia autorización.

Validación por PR funcional: `tsc`+`build` verdes; preview (beacon en ruta
pública, **0 cookies**, **0 errores**, **0 payload con PII/texto**); confirmar
que NO emite en `/panel`·`/admin`·`/paciente`; validación en producción.

## F2.7 — Recomendación del primer PR funcional

1. **Primero el gate (PR 2.0):** confirmar el plan de Vercel. Sin ingesta de
   Custom Events, un PR de `track()` compila y **no hace nada** en producción.
2. **Si el plan lo soporta → primer PR funcional = PR 2.1** (helper
   `trackPublic` + eventos de descubrimiento de menor riesgo): máximo
   aprendizaje (qué se busca/filtra, qué perfiles atraen) con mínimo riesgo de
   privacidad, y deja la protección anti-PII centralizada en el helper.
3. **Si el plan NO lo soporta y no se sube a Pro →** el primer PR funcional se
   posterga hasta decidir Plausible vs PostHog EU vs subir plan.

## F2.8 — Qué NO se implementa en este PR-0 de Fase 2

Docs-only. **No** se toca: código funcional · runtime · `track()` · paquetes/
`package.json`/lockfile · Vercel config · React · middleware · DB · SQL ·
migraciones · `database.types.ts` · rutas privadas · SEO/sitemap/robots/
favicon/OG · branding · performance. **Ningún evento implementado todavía.**

---

# Fase 2 — PR-0B · Alternativas sin Vercel Pro (análisis, decisión de camino)

> **Estado:** análisis docs-only. **Gate operativo RESUELTO (2026-07-04):**
> Vercel básico (Hobby) funciona y muestra tráfico/pageviews/países/
> dispositivos/páginas/rendimiento, pero **los Custom Events (`track()`)
> requieren plan Pro y NO están disponibles**. Base: HEAD `a36d5e9` ·
> PRs #1–#241 · `s7_52`. No reabre Q1–Q5. Decide el camino de medición **sin
> asumir Vercel Pro**. Nada implementado.

## F2B.1 — Qué YA tenemos con Vercel básico (live, gratis, cookieless)

Queda como **fuente de tráfico general** (confirmado en el dashboard + código):
visitantes · páginas vistas · **bounce rate** · **países** · **sistemas
operativos/dispositivos** · **páginas principales** (ranking de tráfico por
`/doctor/:slug`) · **fuente/referrer** a nivel de pageview · **Speed Insights**
(Core Web Vitals). Responde *"¿el directorio atrae tráfico y qué perfiles se
ven más?"* sin costo.

## F2B.2 — Qué NO cubre sin Custom Events

Interacciones dentro de la página (no cambian la URL): búsquedas · filtros ·
clics en tarjetas · clic en "Reservar" (intención) · apertura del modal de
lista de espera · compartir · afiliación iniciada · claim iniciado/completado.
*(El `doctor_profile_view` se ve parcial vía pageview de `/doctor/*`, pero sin
las dimensiones `is_bookable`/`specialty` ni el origen directorio/búsqueda.)*

## F2B.3 — Qué SÍ resolvemos desde DB (conversión dura, US$0, sin PII externa)

Ya en la base, medible por consulta read-only:

| Métrica | Fuente en DB |
|---|---|
| Reservas creadas | `appointments` (`created_at`, `source`) |
| Reservas completadas / no-show / canceladas | `appointments` + `appointment_statuses` |
| Lista de espera enviada | `waitlist_entries` (`created_at`, `status`) |
| Afiliaciones enviadas | `doctor_affiliation_requests` (`status`) |
| Perfiles reclamados | `doctors.lucy_status` (listed_only→claimed) + `tos_accepted_at` + `audit_log` (`edited_via='claim_self_service'`) |
| Reseñas | `reviews` (`score`, `created_at`) |
| Médicos con más conversión | JOIN por `doctor_id` |

**Lo comercialmente crítico** (reservas/leads/reclamos y ranking por médico)
**no necesita eventos de cliente**. Lo único que la DB NO ve es el **abandono**
(quién buscó/clickeó sin convertir) — eso es lo que justificaría (o no) una
herramienta de eventos.

## F2B.4 — Comparación de opciones

| Criterio | Vercel Pro | Plausible | PostHog EU (sin replay/cookies) | Dashboard interno DB |
|---|---|---|---|---|
| Costo operativo | ~US$20/usuario/mes (verificar) | Cloud ~US$9/mes (o self-host gratis) | Free tier (verificar límites/EU) | **US$0** |
| Complejidad | Baja | Baja | Media-alta | Media |
| Privacidad | Alta (cookieless) | Alta (cookieless, EU) | Media (más superficie) | **Máxima** (no sale de LucyAdmin) |
| Cookies/banner | No | No | Config a "no" (disciplina) | No aplica |
| Riesgo PII | Bajo | Bajo | Medio (autocapture) | **Nulo** |
| Dashboard | Muy alto (integrado) | Alto (simple) | Muy alto (embudos) | Medio (propio) |
| Utilidad comercial | Media (comportamiento) | Media | Alta (embudos) | **Alta** (conversión dura + ranking) |
| Gate/bloqueo | pagar Pro | herramienta nueva | herramienta nueva + DPA salud | ninguno |

**Lectura:** Vercel **Pro** pagaría por resolver **solo** el comportamiento,
que **Plausible da más barato** (o gratis self-host) sin atarnos más a Vercel.
**PostHog EU** es el más potente (embudos) pero el de mayor superficie de
privacidad en salud (apagar cookies/replay/autocapture + DPA). El **dashboard
interno DB** tiene la mejor relación valor/costo/riesgo.

## F2B.5 — Decisión de camino (recomendación)

1. **NO pagar Vercel Pro ahora** — el básico ya cubre lo que Pro-sin-eventos
   daría; Custom Events no valen el costo todavía.
2. **Primer paso funcional = dashboard interno de conversiones en LucyAdmin
   (Fase 3), read-only sobre DB** — mayor utilidad comercial, US$0, sin gate,
   sin PII externa; cruza gratis con el ranking de páginas de Vercel.
3. **Plausible = plan B FUTURO** para eventos de comportamiento/abandono, **si**
   tras el dashboard interno todavía faltara entender la interacción previa a
   conversión (cookieless, barato/self-host, EU — más limpio que Vercel Pro).
4. **PostHog EU = diferido** (mayor complejidad + superficie de privacidad;
   solo si se necesitan embudos multi-paso reales).
5. **Vercel Pro = diferido** salvo que más adelante tenga sentido por analytics
   unificado y el costo deje de ser objeción.

**En una línea:** medir primero la **conversión dura** donde ya la tenemos
(**DB**, gratis, sin riesgo); los eventos de comportamiento se agregan después
con **Plausible** solo si el dashboard interno deja preguntas de abandono.

## F2B.6 — Primer PR funcional sugerido (para su propia autorización)

**Fase 3 — Dashboard de conversión en LucyAdmin, read-only sobre DB.** Ruta
admin bajo `AdminOnlyRoute`, métricas agregadas (reservas creadas/completadas/
no-show/canceladas · lista de espera · afiliaciones · reclamos · reseñas ·
ranking de médicos por conversión) + filtro por fechas. Backend = RPC(s)
`SECURITY DEFINER` con gate `is_admin()`, **solo agregación/conteo** (patrón
`admin_list_waitlist` `s7_41`); **sin exponer PII** (números + `doctor_slug`/
nombre público, nunca datos de paciente); datos **no salen a terceros**.

**Este frente toca DB (lectura vía RPC)** → aplica la regla "PR que toca DB =
migración + check/smoke; el owner aplica el SQL, el dev corre los checks", y
**debe arrancar con su propio PR-0 read-only** (mapear columnas/estados reales
de `appointments`/`appointment_statuses`/`waitlist_entries`/
`doctor_affiliation_requests`/`reviews`/claim **antes** de escribir cualquier
RPC/UI). **No abrir DB/RPC/UI sin esa autorización.**

## F2B.7 — Qué NO se implementa en este PR-0B

Docs-only. **No** se toca: código · runtime · `track()` · paquetes/
`package.json`/lockfile · `PublicAnalytics.tsx` · Vercel config · DB · SQL ·
migraciones · `database.types.ts` · rutas privadas · SEO/sitemap/robots/OG/
middleware · branding · performance. **Ninguna medición nueva implementada;
ningún dashboard DB abierto.**

---

# Fase 3 — PR-0 · Dashboard interno de conversiones en LucyAdmin (diseño read-only)

> **Estado:** diseño docs-only. **No autoriza RPC/UI.** Base: HEAD `82f6350` ·
> PRs #1–#242 · `s7_52`. Es el camino elegido en PR-0B (§F2B.5): medir la
> **conversión dura** desde DB, agregada, sin eventos de cliente ni terceros.
> Mapeo verificado contra `src/types/database.types.ts` + servicios.

## F3.1 — Inventario de tablas/columnas útiles (verificado)

| Tabla | Columnas útiles | PII / prohibido exponer |
|---|---|---|
| `appointments` | `created_at`, `doctor_id`, `clinic_id`, `service_id`, **`source`** (enum), `status_id`→`appointment_statuses`, `price`, `payment_status`, `start_time` | `patient_id`, `notes`, `internal_notes` |
| `appointment_statuses` | `name`, `display_name`, **`funnel_order`**, **`is_final`**, **`affects_revenue`** | — (catálogo) |
| `waitlist_entries` | `status` (`pending`/`contacted`/`cancelled`), `created_at`, `doctor_id`, `contacted_at` | `patient_name`, `patient_phone`, `patient_message` |
| `doctor_affiliation_requests` | `status` (`pending`/`in_review`/`approved`/`rejected`/`expired`), `created_at`, `specialty_id`, `department_id`, `municipality_id` | `full_name`, `phone`, `email`, `license_number`, `message` |
| `doctors` | `lucy_status`, `is_published`, `booking_enabled`, `is_verified`, `slug`, `specialty_id`, `clinic_id`, `tos_accepted_at`, `created_at` | `license_number` |
| `clinics` | `department_id`, `municipality_id` (geo vía join) | `phone`, `address_line` |
| `reviews` | `rating`, `created_at`, `is_visible`, `doctor_id` | `patient_profile_id`, `comment` (texto libre) |
| `specialties`/`departments`/`municipalities` | `id`→`name` (etiquetas) | — |

**Hallazgos que condicionan el diseño:**
1. **`appointment_source = manual | lucy_directorio | lucy_seguimiento`** →
   `lucy_directorio` = reserva **desde el directorio** (KPI comercial central).
2. **`waitlist_entries` y `doctor_affiliation_requests` NO están como tablas en
   `database.types.ts`** (solo como firmas de RPC) → el dashboard va **por RPC
   `SECURITY DEFINER`**, no por `select` directo; la regen de tipos solo agrega
   las **firmas** de las RPC nuevas.
3. **`appointment_statuses` es tabla de datos, no enum:** los nombres de estado
   (scheduled/completed/cancelled/no_show…) viven en las **filas** → clasificar
   el embudo **genéricamente** con `is_final`/`affects_revenue`/`funnel_order`;
   el **Paso 0 del PR funcional** debe `SELECT` esas filas para confirmar el set
   real.

## F3.2 — Métricas posibles

Reservas (creadas · por `source` · por clase de estado · por médico/especialidad/
geo) · lista de espera (enviadas · por estado) · afiliaciones (enviadas · por
estado) · reclamos (`tos_accepted_at`/`lucy_status`) · oferta/supply (listed_only/
claimed/publicados/con agenda/verificados) · reseñas (recibidas · rating avg) ·
ranking de médicos · evolución temporal.

## F3.3 — Métricas V1 (aceptadas)

1. reservas creadas en el rango;
2. reservas por `source` (esp. `lucy_directorio`);
3. reservas por clase de estado (completadas/canceladas/no-show/otras) vía flags
   de `appointment_statuses`;
4. lista de espera enviada + por estado;
5. afiliaciones enviadas + por estado;
6. perfiles reclamados (`tos_accepted_at` / `lucy_status != listed_only`);
7. snapshot de oferta: listed_only · claimed · publicados · con agenda ·
   verificados (actual, sin rango);
8. reseñas recibidas + rating promedio;
9. ranking Top-N de médicos por reservas y reservas de directorio.

**FUERA de V1 (aceptado):** ingresos/`price` (LucyCare **no cobra en línea** →
no es revenue real) · series temporales · gráficos · export · embudo por
paciente · filtros avanzados · texto de reseñas/mensajes de waitlist/afiliación ·
cualquier dato clínico/PII.

## F3.4 — Filtros / dimensiones

- **V1:** **rango de fechas** (`created_at`), único filtro.
- **V1.5 (barato, join directo — opcional en el mismo PR):** especialidad +
  departamento/municipio (IDs estructurados ya presentes).
- **V2:** por médico, por estado, `reservable vs listed_only`, granularidad
  temporal.
- Diseñar las RPCs con parámetros **opcionales** desde V1 (`p_specialty_id?`,
  `p_department_id?`…) aunque la UI V1 solo exponga el rango → evita re-migrar.

## F3.5 — Privacidad (vinculante)

- **Solo agregados/conteos.** Ninguna fila individual de paciente sale de la RPC.
- **Nunca exponer:** `patient_id` · nombre/teléfono/email/documento de paciente ·
  `patient_message`/`comment`/`message` (texto libre) · datos clínicos
  (diagnósticos/recetas/notas/vitales) · `license_number`/JVPM/NUE · PII del lead.
- **Permitido:** conteos, tasas, promedios, `doctor_slug`/nombre del médico (ya
  públicos), etiquetas de especialidad/depto/municipio, nombres de estado.
- **Re-identificación por celda chica:** los desgloses no bajan de agregados por
  médico/estado; no se muestra ninguna fila de paciente → sin necesidad de
  k-anonymity en V1. El texto libre nunca entra en un agregado.

## F3.6 — Propuesta de RPCs (`SECURITY DEFINER`, gate `is_admin()`)

Patrón espejo de `admin_list_waitlist` (`s7_41`): definer, `is_admin()`→`P0001`,
anon sin EXECUTE, **solo lectura/agregación**, sin escritura, sin audit.

- **`admin_conversion_summary(p_date_from, p_date_to, p_specialty_id?,
  p_department_id?, p_municipality_id?)`** → **JSON** con secciones: reservas
  (total + por source + por clase de estado), waitlist (total + por estado),
  afiliaciones (total + por estado), reclamos (total), oferta (snapshot),
  reseñas (total + avg). Una llamada = todos los KPIs.
- **`admin_doctor_conversion_ranking(p_date_from, p_date_to, p_limit,
  p_specialty_id?)`** → por médico: `doctor_slug`, nombre, especialidad,
  reservas totales, reservas de directorio, waitlist, reseñas/avg. Ordenado por
  reservas.

**Granularidad:** **2 RPCs** en V1 (summary + ranking); **series temporales = 3ª
RPC en V2** (`admin_conversion_timeseries`). 2 RPCs pequeñas > una gigante
(checks más simples; el ranking pagina aparte). **Requiere:** migración `s7_53`
+ actualizar `database.types.ts` (firmas de las 2 RPCs). **No** crea tablas,
**no** toca RLS existente, **no** toca datos.

## F3.7 — UI

- Ruta **`/admin/analytics`** bajo `AdminOnlyRoute` + `AdminLayout` + NavLink
  "Analítica" (sistema de diseño; cards `bg-white rounded-2xl border p-5`,
  colores semánticos; drawer móvil #130).
- **V1:** selector de **rango de fechas** + grilla de **KPI cards** (reservas +
  source, waitlist, afiliaciones, reclamos, oferta, reseñas) + **tabla de
  ranking Top-N**. Estados carga/vacío/error (sin detalle técnico). Mobile-first.
- **V2:** gráficos de evolución, filtros especialidad/geo/estado, export.

## F3.8 — Validaciones (para el PR funcional)

- **Backend:** `check-s7_53.mjs` (RPCs existen, gate `is_admin`, anon/doctor/
  paciente/asistente **bloqueados** `P0001`, salida solo agregada) +
  `_smoke-s7_53.mjs` con **fixtures aisladas** (conteos cuadran; **0 PII en el
  output**; cleanup **0 residuales**; **jamás Katherine ni datos reales**).
- **Regla del smoke:** afirmar que **ningún campo del payload** contiene nombre/
  teléfono/email/documento/texto libre/clínico.
- **Frontend:** `tsc`+`build` verdes; preview admin real; **médico/asistente/
  paciente/anónimo NO acceden** a `/admin/analytics`; móvil 360/390/430 sin
  overflow; 0 errores de consola.

## F3.9 — Recomendación del primer PR funcional (A/B)

Partir en A/B (patrón F4-3 UI PR A/B, Onboarding PR-1/PR-2):

- **PR-A (backend, primero):** migración `s7_53` con las **2 RPCs** +
  `database.types.ts` + `check`/`smoke`. **Sin UI.** El owner aplica el SQL, el
  dev corre los checks. **Precedido de un Paso 0 read-only** que confirme contra
  la DB: (a) nombres reales de `appointment_statuses` y su clasificación
  (completadas/canceladas/no-show vía `is_final`/`affects_revenue`/
  `funnel_order`); (b) existencia/uso real de `source='lucy_directorio'`; (c)
  disponibilidad real de datos para ranking y agregados.
- **PR-B (UI, después):** `/admin/analytics` read-only consumiendo las RPCs.
  Frontend-only, sin migración.

**Alcance mínimo V1** = las 9 métricas de F3.3 + filtro de fechas. **NO**
ingresos, series temporales, filtros avanzados ni export (todo V2). Cerrar y
validar el backend agregado (donde vive el riesgo de privacidad) **antes** de la
UI.

## F3.10 — Qué NO se implementa en este PR-0

Docs-only. **No** se toca: código · runtime · DB · SQL · migraciones ·
`database.types.ts` · UI · rutas · RPC · Analytics de cliente · `track()` ·
herramientas externas · Vercel config · SEO/sitemap/robots/OG/middleware ·
branding · performance. **Ningún dashboard/RPC/UI abierto.**

---

# Fase 3 — Paso 0 read-only · Resultados contra DB (2026-07-04)

> Diagnóstico ejecutado con un script de **solo lectura** (service_role, patrón
> admin) que seleccionó **únicamente columnas no-PII** y reportó agregados; el
> script se eliminó tras correr (árbol limpio, cero escrituras/fixtures). Base:
> HEAD `bc0c725` · PRs #1–#243 · `s7_52`. **Confirma que el PR-A backend puede
> avanzar** con dos ajustes de fuente. Los conteos son del snapshot del día
> (piloto, volumen bajo) y solo orientan el diseño.

## F3P0.1 — `appointment_statuses` (catálogo real, 6 estados)

| funnel_order | name | display_name | is_final | affects_revenue |
|---|---|---|---|---|
| 1 | `programada` | Programada | false | false |
| 2 | `confirmada` | Confirmada | false | false |
| 3 | `en_sala` | En Sala | false | false |
| 4 | `atendida` | Atendida | **true** | **true** |
| 5 | `cancelada` | Cancelada | true | false |
| 6 | `no_asistio` | No Asistió | true | false |

## F3P0.2 — Clasificación final de estados (para `s7_53`)

| Clase del dashboard | Regla (por flags + name) |
|---|---|
| **Completadas** | `affects_revenue = true` → `atendida` |
| **Canceladas** | `is_final = true AND affects_revenue = false AND name = 'cancelada'` |
| **No-show** | `is_final = true AND affects_revenue = false AND name = 'no_asistio'` |
| **En curso / pendientes** | `is_final = false` → `programada`/`confirmada`/`en_sala` |

Robusto ante estados nuevos: `is_final=false` → "pendientes"; finales se separan
por `affects_revenue` y, para cancelada vs no-show, por `name`.

## F3P0.3 — `appointments.source` (conteos reales)

- **Total: 73.** `manual` **56** · `lucy_directorio` **17** · `lucy_seguimiento`
  **0** (sin filas hoy → tratar como 0, no romper).
- **73/73 con `service_id`** · **5 médicos distintos** · rango `created_at`
  **2026-04-10 → 2026-06-30**.
- Reservas del directorio por estado: `programada` 12 · `atendida` 4 ·
  `confirmada` 1. → **`lucy_directorio` ya tiene datos; el embudo de directorio
  es medible.**

## F3P0.4 — Otros agregados (snapshot del día)

- **`waitlist_entries`:** total **1** (`contacted` 1). *(Volumen bajo, medible.)*
- **`doctor_affiliation_requests`:** total **1** (`approved` 1). *(Volumen bajo.)*
- **`doctors`:** total **114** · `lucy_status` = `listed_only` **113** /
  `verified` **1** · publicados **35** · con agenda **1** · verificados **1** ·
  `slug` 35 · `specialty_id` 114/114 · `clinic_id` 114/114.
- **`reviews`:** total **2** · visibles 2 · **rating promedio 4.65** (sin tocar
  `comment` ni `patient_profile_id`).

## F3P0.5 — Reclamos: `tos_accepted_at` NO sirve → usar `audit_log` (ajuste vinculante)

- **`tos_accepted_at` está en 0 en los 114 médicos** → **NO** es fuente válida
  del métrico de reclamos.
- **`audit_log` SÍ registra reclamos:** `edited_via='claim_self_service'` = **7
  eventos** (audit_log total ~13.241 filas). → **El métrico de reclamos se mide
  desde `audit_log`** filtrando `new_data->>'edited_via' = 'claim_self_service'`
  por `created_at`. *(Caveat: los 7 son mayormente actividad de prueba; el
  mecanismo es correcto y crecerá con médicos reales.)*

## F3P0.6 — Riesgos / notas para `s7_53`

1. **Reclamos = `audit_log`** (`edited_via='claim_self_service'`), no
   `tos_accepted_at`. — ajuste de fuente, no bloqueo.
2. **Volumen bajo** hoy (waitlist/afiliaciones/reviews/claims); reservas (73, 17
   de directorio) ya son dataset real. — no bloquea.
3. **`audit_log` grande (~13k filas)**: filtrar por `created_at` + `edited_via`;
   verificar índice o aceptar el scan (hoy trivial). — nota de performance.
4. **`lucy_seguimiento` = 0**: el desglose por source debe manejar 0 sin romper.
5. **Privacidad sin bloqueo:** todos los agregados salieron seleccionando **solo
   columnas no-PII** → la RPC puede devolver únicamente conteos/promedios, sin
   `patient_id`/nombre/teléfono/email/documento/`comment`/`message`/clínico.

## F3P0.7 — Conclusión

✅ **PR-A backend (`s7_53`) puede avanzar** con: (A) reclamos desde `audit_log`;
(B) resto de V1 sin cambios (reservas + source + clases de estado, waitlist por
estado, afiliaciones por estado, oferta/supply snapshot, reseñas + avg, ranking
Top-N). **`s7_53` debe:** 2 RPCs `SECURITY DEFINER`/`is_admin()` con **solo
agregados y 0 PII**; claims desde `audit_log`; clasificación de estados por
flags+name (F3P0.2); manejar sources/estados ausentes como 0; check/smoke con
fixtures aisladas afirmando **0 PII en el payload**.
