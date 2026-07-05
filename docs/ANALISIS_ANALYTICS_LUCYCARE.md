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
