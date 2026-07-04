# HANDOFF — Nueva ventana de contexto (2026-07-03, post-PR #220)

> **PUNTO DE ENTRADA VIGENTE.** Documento autosuficiente para cargar una
> ventana nueva. Leer ESTE primero; luego `CLAUDE.md` y los
> `docs/ANALISIS_*.md` del objetivo del día. Reemplaza como punto de entrada
> a `docs/HANDOFF_CHATGPT_LUCYCARE_NUEVA_VENTANA_2026-06-21.md` (queda
> histórico). **No asumir nada sin confirmar el estado real del repo.**

## Protocolo de arranque

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -10
```

Producción: **https://lucycare.app** (Vercel auto-deploy desde `main`;
Supabase; DNS en Cloudflare). `gh` CLI autenticado.

---

## 1. Estado técnico actual (2026-07-03)

- **HEAD de `main`:** `ae4c820` (*style(branding): avatar fallback del médico
  hacia la paleta oficial (DoctorAvatar) … (#235)*).
- **PRs mergeados:** **#1–#235** (incluye #222 PR-1 + #224 Perf PR-1 + #226/#227
  SEO Home OG + #229 PR-2a + #231 PR-2b-1 + #233 PR-2b-2 + **#235 DoctorAvatar**;
  #221/#223/#225/#228/#230/#232/#234 docs-only). **Rebrand público 100% COMPLETO.**
- **Migraciones aplicadas en Supabase:** hasta **`s7_52`** (última = slugs
  Fase 1, `doctors.slug`; ver `docs/ANALISIS_SLUGS_SEO.md`).
- **`main == origin/main`** · **árbol limpio** · **0 PRs abiertos** · sin
  preview local / fixtures / scripts temporales / servers · **sin frente
  abierto**.
- `tsc --noEmit` OK · `npm run build` OK en `main`.

---

## 2. Slugs + SEO — CERRADO hasta PR C

**PRs:** #207 (docs Fase 0) · **#208** backend slugs / migración **`s7_52`**
· #209 routing UUID/slug · #210 diseño metadata/OG · **#211** middleware
metadata/Open Graph · **#212** `robots.txt` + `sitemap.xml` dinámico · #213
docs cierre post-PR C. **Detalle vivo: `docs/ANALISIS_SLUGS_SEO.md`.**

**Estado funcional (validado en producción):**
- `/doctor/:slug` (y `/doctor/:uuid`) sirve **metadata dinámica** vía
  `middleware.ts` (Vercel Edge): `<title>` · `description` · `robots` ·
  `canonical` · Open Graph · Twitter Card. Lógica pura en `og-meta.mjs`.
- **UUID canonicaliza al slug** (canonical + og:url apuntan al slug).
- **Slug inexistente / médico no publicado** → shell genérico `noindex,follow`
  **sin fuga** de datos (`og:title=LucyCare`).
- **`/sitemap.xml`** (producción): **35 URLs públicas**, `<loc>` por slug,
  **0 UUIDs**, **0 rutas privadas**, **0 no publicados**; cache éxito
  `s-maxage=3600` / degradado `300`.
- **`/robots.txt`**: `Allow: /`; `Disallow: /panel /admin /paciente
  /reset-password`; `Sitemap: https://lucycare.app/sitemap.xml`; no bloquea
  `/doctor/*`.
- **Criterio único `isSitemapEligible`** (nombre+especialidad+clínica;
  **ubicación estructurada OPCIONAL**) gobierna sitemap **y** el `robots` del
  perfil, alineados. `listed_only` indexable con metadata honesta; **sin copy
  de verificación si no está verificado**.
- **Env del middleware:** lee `SUPABASE_URL`/`SUPABASE_ANON_KEY` con fallback
  a `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (públicas, RLS). **Nunca
  service role.** En producción no aparece `X-Robots-Tag: noindex` (era solo
  de previews).

**Home `/` — preview social (#226 SEO Home OG + #227 copy):** antes el Home
servía solo `<title>LucyCare</title>` (sin OG/Twitter/description/canonical) →
preview pobre al compartir la URL directa. Ahora sirve metadata propia vía el
**mismo middleware** (rama para `/`, `matcher += '/'`), con `buildHomeMeta` en
`og-meta.mjs`. **Decisión: middleware, NO estático en `index.html`** —
`injectMeta` inserta (no reemplaza) los `og:*`, así que meterlos en el shell
duplicaría los tags en cada `/doctor/*`. En prod: `<title>` **"LucyCare —
Encuentra al médico perfecto para ti"**, description **"Busca por especialidad,
ubicación y disponibilidad. Reserva en línea con LucyCare."** (tuteo, alineado
al `<h1>`), canonical/og:url `https://lucycare.app/`, `robots index,follow`,
`og:type=website`, `og:site_name=LucyCare`, `og:image=https://lucycare.app/lucycare-logo.png`,
Twitter `summary_large_image` (+ title/description/image); **sin duplicados**
de `<title>`/canonical/`og:title`/`twitter:card` y `/doctor/*` **sin
regresión** (`og:type=profile`). Smoke `_smoke-og-meta.mjs` T18/T18b (21/21).
**Operativa (compartir):** usar la **URL directa** `https://lucycare.app/`,
**NO** enlaces `share.google/…` (wrapper externo de Google/Chrome, ajeno al
código de LucyCare); si el preview sale viejo es **caché** → refrescar con el
**Facebook Sharing Debugger** o esperar.

**Pendientes NO iniciados:** **PR D** (JSON-LD `Physician` + canonical
hardening + asset OG branded **1200×630** — reemplazaría también el
`lucycare-logo.png` 1200×505 temporal como `og:image` del Home) · **Fase 4**
(landings por especialidad/ubicación).

---

## 3. Analytics / Search Console

**PRs:** #214 (Analytics PR-0 docs) · **#215** Vercel Analytics + Speed
Insights funcional · #216 docs cierre Fase 1A · **#217** 1er archivo Google
· **#218** 2do archivo Google · #219 cierre operativo Fase 1B. **Detalle
vivo: `docs/ANALISIS_ANALYTICS_LUCYCARE.md`.**

**Estado funcional (Fase 1A ✅ live + prod):**
- `@vercel/analytics` + `@vercel/speed-insights` instalados; componente
  `src/components/PublicAnalytics.tsx` montado **una vez** en `App.tsx`.
- **Solo en allowlist pública:** `/` · `/doctor/*` · `/privacidad`.
- **Excluido:** `/panel` · `/admin` · `/paciente` · `/reset-password` ·
  `/calificar` (token) · toda ruta privada/con token.
- **Defensa doble:** (1) render solo en allowlist; (2) `beforeSend` retorna
  `null` fuera de rutas públicas + **strip de query/hash**. Aplica a Web
  Analytics **y** Speed Insights.
- **Cookieless** · **sin banner** · **sin eventos custom** · **sin PII** ·
  **sin datos clínicos** · **sin dashboard DB todavía**.
- Operativo del owner: confirmar en el dashboard de Vercel que Web Analytics
  y Speed Insights estén "Enabled".

**Search Console (Fase 1B ✅ operativa):**
- Verificado por **archivo HTML**. Archivos **permanentes** en `public/` (NO
  borrar): `google3f2e02a3c176b538.html` (#217) · `googlef334c08cb9e5d942.html`
  (#218). En producción sirven el string exacto (sin inyección; la del
  preview era `vercel.live/feedback`, solo de previews).
- **Sitemap enviado y procesado:** `https://lucycare.app/sitemap.xml` →
  Estado **Correcto** · última lectura **2 jul 2026** · **35 páginas
  descubiertas** · 0 videos.
- **Indexación manual** solicitada para ≥1 perfil principal → Google:
  *"Se ha solicitado la indexación"*. **NO garantiza indexación inmediata**
  (cola de revisión); monitorear los próximos días. **No repetir** la
  solicitud.

**Pendiente importante:** antes de abrir **Analytics Fase 2**, **Slugs+SEO
PR D** u otro frente fuerte de SEO/Analytics, **revisar primero** los datos
iniciales en Google Search Console, Vercel Analytics y Speed Insights.

---

## 4. Favicon / branding web (PR #220)

**Antes:** `index.html` apuntaba a `/vite.svg`, que **no existía** en el
repo → en producción el rewrite servía el HTML de la SPA (no un SVG) → el
navegador mostraba el favicon genérico (roto).

**PR #220 (hotfix mínimo, 2 archivos):**
- Agrega **`public/favicon.svg`** — isotipo oficial de LucyCare (**destello
  de 4 puntas + 4 puntos en menta `#8AE4CB`** sobre **tile morado `#3C2285`**;
  el tile da legibilidad a 16/32px y coherencia con `theme-color`).
- `index.html`: `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
  (reemplaza el `/vite.svg` roto) + `<meta name="theme-color" content="#3C2285">`.
- **Validado en producción:** `/favicon.svg` 200 `image/svg+xml` · `index.html`
  ya NO referencia `/vite.svg` · `theme-color` presente · `robots.txt` y
  `sitemap.xml` (35 URLs) intactos · archivos Google con contenido exacto.
- **No tocó:** React · rutas · middleware · DB · SQL · migraciones ·
  Analytics · sitemap · robots · Search Console · OG dinámico · JSON-LD.

**Pendiente menor (follow-up, NO iniciar sin instrucción):** cuando exista
un **export raster confiable** del isotipo oficial → `apple-touch-icon.png`
(180×180) · `icon-192.png` · `icon-512.png` · `site.webmanifest`. El
`favicon.svg` ya cubre navegadores modernos.

---

## 5. Branding público — REBRAND 100% COMPLETO: PR-1 Home (#222) + PR-2a doctor-detail (#229) + PR-2b-1 modales simples (#231) + PR-2b-2 modales auth/claim (#233) + DoctorAvatar (#235) · CERRADO

**PR:** **#222** (`style(branding): Home público hacia la paleta oficial
LucyCare (Branding PR-1)`). **#221** fue docs-only (cierre de ventana
post-#220). Ambos mergeados a `main`.

**Decisión de marca (vinculante):** el público migra hacia la **paleta oficial
LucyCare** — **morado `#3C2285` + menta `#8AE4CB` + gris `#EDEDED`** —, pero
**por fases pequeñas**. **NO** es un rebrand global de un solo PR. Esto revisa,
de forma parcial y controlada, el criterio emerald/teal heredado de **#200**.

**Estado funcional (validado en prod `lucycare.app`):**
- **Tokens de marca** en `tailwind.config.ts`: se agregan `brand.mint`
  (`#8AE4CB`) y `brand.gray` (`#EDEDED`); se conservan `brand.purple`
  (`#3C2285`) y `brand.purple.dark` (`#2d1a64`).
- **Morado `#3C2285` = CTAs primarios / jerarquía:** "Reservar cita"
  (`DoctorCard`), "Mostrar más médicos", "Reintentar", "Limpiar filtros",
  "Mi panel"/"Panel Admin", título del hero, tarjeta-toggle "Solo médicos con
  agenda en línea" (gradiente morado), knob del toggle, focus del selector de
  orden, **iconos de los filtros** (la menta es demasiado clara sobre blanco →
  se prioriza contraste sobre la guía de "íconos menta").
- **Menta `#8AE4CB` = acento suave:** badges "Verificado" / "Agenda en línea" /
  "Mejor valorado" (menta 30% + texto morado, contraste ~11:1 AA), fondo del
  hero (gradiente menta muy suave → blanco), borde de tarjeta reservable, fila
  "Agenda en línea", hovers de opciones de los dropdowns.
- **Gris `#EDEDED` = footer / superficies neutras** (`brand.gray`).
- **"Soy médico, quiero aparecer" → CTA secundario** (fondo blanco, texto y
  borde morado, hover menta suave): on-brand y visible, **sin competir** con la
  acción principal del paciente.
- **Alcance:** solo 4 archivos — `tailwind.config.ts` + `src/pages/home/page.tsx`
  + `src/pages/home/components/SearchSection.tsx` + `.../DoctorCard.tsx`.
- **Validación:** `npm run build` verde (CSS `index-ChTVc9N0.css`); preview
  desktop + móvil **360/390/430** sin overflow horizontal; contraste AA de CTAs
  y del badge "Verificado"; prod: Home 200, tokens en el CSS, y **`/favicon.svg`
  (200 `image/svg+xml`) · `/robots.txt` · `/sitemap.xml` (35 URLs) · archivos
  Google — INTACTOS**.

**NO tocó (fuera de alcance de este PR):** doctor-detail · `AffiliationRequestModal`
· modales públicos (`ClaimProfileModal` / `LoginModal` / `WaitlistModal`) · panel ·
admin · paciente · DB/SQL/migraciones/`database.types.ts` · Analytics · SEO
dinámico / middleware / OG / JSON-LD · sitemap · robots · archivos Google · favicon.

### Branding PR-2a — perfil público visible `/doctor/*` (#229) · CERRADO

**PR:** **#229** (`style(branding): perfil público del médico hacia la paleta
oficial (Branding PR-2a)`). Continuación de PR-1, acotada al **perfil visible
del médico** (NO modales). **Solo color; sin lógica; SIN migración.** Reusa los
tokens `brand.*` de PR-1 (sin tocar `tailwind.config.ts`).

**Edición por intención (NO replace global de emerald):**
- **Morado** = CTAs/interacción/acento: "Reservar cita"/"Reservar ahora",
  "Llamar para agendar", "Reclamar mi perfil", "Reintentar"/"Volver al inicio",
  servicio/slot **seleccionados**, focus de inputs, spinners, iconos de sección
  (check/graduación/mapa/teléfono), links, barra de rating.
- **Menta** = acento suave / confianza / **éxito**: badges "Verificado por
  LucyCare" / "Agenda en línea" / "Mejor valorado" (menta 30% + texto morado,
  AA ~11:1), chips de reseñas, superficie/borde de `ClaimProfilePromptCard`, y
  el estado de éxito **"¡Cita agendada!"** (menta suave + texto morado).
- **Gris** = footer (`bg-brand-gray`).
- **Conservados por decisión del owner:** verde de **WhatsApp** (`bg-green-500`,
  color de canal), **blue/info** (user-info del BookingCard), red (errores),
  amber (avisos), yellow (estrellas), gris neutro.

**Alcance:** 4 archivos — `doctor-detail/page.tsx` +
`components/{BookingCard,ClaimProfilePromptCard,ReviewsSection}.tsx`.
**Validado en prod:** `/doctor/dr-camilo-carrillo` 200 con badges menta+morado,
CTAs morados, WhatsApp verde, **metadata/OG del doctor intacta** (`og:type=profile`,
sin duplicados); Home `/` · `/robots.txt` · `/sitemap.xml` (35 URLs) ·
`/favicon.svg` · archivos Google **INTACTOS**.

**NO tocó:** modales (`ClaimProfileModal`/`LoginModal`/`WaitlistModal`),
`DoctorAvatar.tsx`, Home, panel, admin, paciente, DB/SQL/migraciones, Analytics,
SEO runtime/middleware/OG/JSON-LD, sitemap, robots, favicon, archivos Google.

### Branding PR-2b-1 — modales públicos simples (#231) · CERRADO

**PR:** **#231** (`style(branding): modales simples públicos hacia la paleta
oficial (Branding PR-2b-1)`). Primera mitad de PR-2b (decisión: partir en 2 por
la sensibilidad de los modales auth/claim), acotada a los modales **sin
auth/claim**: `WaitlistModal` (doctor-detail) + `AffiliationRequestModal` (home).
**Solo color; sin lógica; SIN migración.** Reusa los tokens `brand.*`.

- **Morado** = CTAs (enviar/confirmar), focus de inputs (`border`/`ring`), links
  de acento (política de privacidad), accent del checkbox, icono de éxito.
- **Menta** = estado de éxito (círculo de check `bg-brand-mint/30` + icono morado).
- **Conservados:** red (errores/validación), gris/neutros. *(No hay
  amber/blue/green en estos dos modales.)*

**Alcance:** 2 archivos — `doctor-detail/components/WaitlistModal.tsx` +
`home/components/AffiliationRequestModal.tsx`. **Validado:** `npm run build`
verde; preview en vivo de ambos modales (AffiliationRequestModal desde "Soy
médico", WaitlistModal desde un médico no reservable) — acentos morados, éxito
menta, `*` requeridos en rojo, móvil 360 sin overflow, 0 errores de consola;
**NO se enviaron formularios** (evitar datos reales); **prod OK** (Home 200,
`/doctor/dr-camilo-carrillo` 200, tokens en el CSS, metadata/OG del Home y
doctor **intactas**, `/robots.txt`·`/sitemap.xml` 35 URLs·`/favicon.svg`·
archivos Google **intactos**).

### Branding PR-2b-2 — modales auth/claim (#233) · CERRADO

**PR:** **#233** (`style(branding): modales auth/claim hacia la paleta oficial
(Branding PR-2b-2)`). Segunda mitad de PR-2b, acotada a los modales de
**auth/claim**: `LoginModal` + `ClaimProfileModal`. **SOLO color/className.**
**NO toca** auth/OTP/login/claim/password/validaciones/estados/timers/Supabase/
RPCs/navegación/roles; **sin cambiar copy/labels.** Reusa los tokens `brand.*`.

- **Morado** = CTAs (Continuar/Verificar/Ingresar/Enviar/Reclamar/Guardar/
  "Contactar a Lucy"), **tabs activas** (Teléfono/Email), **step-indicator del
  claim** (barra + número), focus de inputs, links ("Reenviar código"/"¿Olvidaste
  tu contraseña?"/Términos), accent del checkbox, iconos, borde de la
  tarjeta-opción "Crear contraseña ahora".
- **Menta** = estados de éxito: círculos de check (OTP enviado / reset enviado /
  "¡Perfil reclamado!"), caja **"Contraseña creada"** (menta suave + texto
  morado), fondo/hover de la tarjeta-opción.
- **Conservados:** red (errores/validación), amber (avisos: "Mínimo N
  caracteres", "No encontramos un correo registrado"), blue (info: "Revisá tu
  correo"), gris/neutros. *(El CTA "Contactar a Lucy" enlaza a WhatsApp pero
  usaba `bg-emerald-700` —botón morado con ícono, no el patrón verde de canal
  `bg-green-500`— → morado como CTA.)*

**Alcance:** 2 archivos — `doctor-detail/components/{LoginModal,ClaimProfileModal}.tsx`.
**Validado:** `npm run build` verde; preview en vivo de ambos modales (LoginModal
desde "Iniciar sesión", ClaimProfileModal desde la entrada de reclamo de un
perfil `listed_only`) — tab/step-indicator/CTAs morados, focus morado, éxito
menta, semánticos intactos; desktop + móvil 360/390/430 sin overflow; 0 errores
de consola; **NO se enviaron formularios** (sin OTP/SMS/datos reales); **prod OK**
(Home 200, `/doctor/dr-camilo-carrillo` 200, tokens en el CSS, metadata/OG del
Home y doctor **intactas**, `/robots.txt`·`/sitemap.xml` 35 URLs·`/favicon.svg`·
archivos Google **intactos**).

---

### ✅ Rebrand público principal — COMPLETO por fases

El acercamiento del público a la paleta oficial LucyCare (morado `#3C2285` +
menta `#8AE4CB` + gris `#EDEDED`) queda **completo** en sus superficies
principales, por fases pequeñas:
1. **#222 — Home público:** tokens de marca + Home alineado a morado/menta/gris
   + "Soy médico" secundario + CTAs principales morados.
2. **#229 — Perfil visible `/doctor/*`:** badges/acento/éxito en menta, CTAs
   morados, **WhatsApp verde** y **blue/info** conservados.
3. **#231 — Modales públicos simples:** `WaitlistModal` + `AffiliationRequestModal`.
4. **#233 — Modales auth/claim:** `LoginModal` + `ClaimProfileModal`.
5. **#235 — Avatar compartido:** `src/components/DoctorAvatar.tsx` — fallback de
   iniciales (sin foto) `bg-emerald-100 text-emerald-700` → **`bg-brand-mint/30
   text-brand-purple`** (menta suave + iniciales moradas). Visual-only, 1 línea;
   branch `<img>` byte-idéntico (avatares con foto intactos). Componente
   compartido → aplica a Home + doctor-detail. Validado en prod. **Con esto el
   rebrand público queda 100% en sus superficies principales.**

**Pendientes NO iniciados (no abrir sin instrucción explícita):**
- **Branding menor** — splash verde `#047857` de `index.html` + branding interno
  panel/admin.
- **OG branded 1200×630** — dentro de Slugs PR D (§2).
- **Perf P2** (code-splitting del JS) · **Perf menor** (lazy avatares, evaluar
  Pacifico) — §6.

---

## 6. Performance del Home — Perf PR-1 (#224) · CERRADO

**PR:** **#224** (`perf(home): quitar Font Awesome no usado + cache immutable de
/assets/* (Perf PR-1)`). Precedido de un **Paso 0 read-only** (diagnóstico) que
**exoneró a #222 / Branding PR-1** como causa de lentitud: el delta de bundle
post-#222 fue **~0.19 KB gzip combinado**; la percepción venía de factores
**pre-existentes** (re-descarga tras cada deploy + `max-age=0` en assets
hasheados + JS monolítico + CSS de terceros render-blocking + Font Awesome sin
uso).

**Dos cambios de bajo riesgo (sin tocar código de la app):**
- **`index.html`** — se elimina el `<link>` render-blocking a **Font Awesome
  6.4.0** (`all.min.css`, ~18.75 KB + webfonts). Confirmado **0 usos** en todo
  el repo (`fa-`, `FontAwesome`, `all.min.css`, sin dependencia npm). Los
  iconos son **RemixIcon** (`ri-*`, 196 usos), **intacto**. **Google
  Fonts/Pacifico y los `preconnect` intactos.**
- **`vercel.json`** — bloque `headers` que sirve **solo `/assets/(.*)`**
  (bundles hasheados de Vite) con
  `Cache-Control: public, max-age=31536000, immutable`. Antes heredaban el
  default `max-age=0, must-revalidate` (el navegador revalidaba ~305 KB de JS
  en cada visita). **El `index.html` NO recibe long-cache** (sigue
  `max-age=0, must-revalidate` para tomar nuevos deploys al instante). El
  **rewrite SPA queda igual**.

**Validado en producción `lucycare.app`:** `/` 200 · HTML **sin Font Awesome**
· **RemixIcon** presente · `/assets/*.js` y `/assets/*.css` con
`Cache-Control: public, max-age=31536000, immutable` · `index.html` **sin**
immutable (`max-age=0, must-revalidate`) · `/favicon.svg` · `/robots.txt` ·
`/sitemap.xml` (35 URLs) · archivos Google — **INTACTOS**.

**NO tocó:** React · Home (código) · Tailwind · DB/SQL/migraciones/`database.types.ts`
· Analytics · SEO dinámico / middleware / OG / JSON-LD · sitemap · robots ·
favicon · archivos Google.

**Pendiente NO iniciado (no abrir sin instrucción explícita):**
- **Perf P2** — code-splitting del JS monolítico (~305 KB gzip en un solo
  chunk; Vite advierte "chunk > 500 KB"). Mejora LCP/TBT; esfuerzo mayor.
- **Perf menor** — `loading="lazy"` + dimensiones en avatares; evaluar quitar
  **Pacifico** si no se usa/no aporta.

---

## 7. Pendientes generales NO iniciados

1. **Revisar datos iniciales** de Search Console + Vercel Analytics + Speed
   Insights **antes** de abrir nuevos frentes SEO/Analytics.
2. **Analytics Fase 2** — eventos custom públicos, sin PII (sujeto a que el
   plan de Vercel soporte `track()`; si no, Plausible / PostHog EU anónimo).
3. **Analytics Fase 3** — dashboard LucyAdmin read-only de conversiones DB
   (`appointments`, `waitlist_entries`, `doctor_affiliation_requests`).
4. **Analytics Fase 4** — dashboards/BI por médico/especialidad/canal.
5. **Slugs+SEO PR D** — JSON-LD `Physician` + canonical hardening + OG
   branded 1200×630.
6. **Slugs+SEO Fase 4** — landings por especialidad/ubicación.
7. **Favicon follow-up** — PNG (apple-touch/192/512) + `site.webmanifest`.
8. **Seguridad de sesión / inactividad** — pendiente histórico; no abrir sin
   instrucción.
9. **Recuperación de acceso sin sesión** — diferido.
10. **Credenciales / señales de confianza / claim profile** (`doctor_credentials`
    F1–F5) — backlog, cuidando privacidad (nunca mostrar JVPM/NUE; número
    nunca al payload público).
11. **Branding interno menor** (stat card índigo del panel, botón púrpura de
    `AdminAffiliationDetailModal`, **splash verde `#047857` de `index.html`**
    —quedó fuera de Perf PR-1 #224—, token de marca) — no iniciar sin alcance.
    *(El rebrand público principal quedó 100% COMPLETO con #235 — ver §5; solo
    resta este branding interno + splash.)*
12. **Próximo-slot-real en la tarjeta** — pendiente histórico; no iniciar sin
    alcance.
13. **Limpieza de ramas locales `claude/*` viejas** — opcional, solo con
    **dry-run + autorización expresa**, sin tocar worktrees activos.
14. **Perf P2 — code-splitting del JS monolítico** (~305 KB gzip en un solo
    chunk; Vite advierte "chunk > 500 KB") — mejora LCP/TBT; esfuerzo mayor;
    **no abrir sin instrucción** (ver §6).
15. **Perf menor** — `loading="lazy"` + dimensiones en avatares; evaluar quitar
    **Pacifico** si no se usa/no aporta — no iniciar sin alcance.

---

## 8. Reglas operativas para la nueva ventana (vinculantes)

- **Un solo frente abierto a la vez.** No abrir otro hasta cerrar
  formalmente el anterior.
- **No abrir PR sin autorización** del owner. **No mergear sin su OK
  explícito.**
- **Cambios pequeños y acotados.** Si es **docs-only**, no tocar código.
- Si el PR **toca DB** → debe traer **migración + `check`/`smoke` + validación
  clara**; el **owner aplica el SQL**, el dev corre los checks.
- **No tocar `auth.users`** salvo autorización expresa (fixtures aislados de
  smoke son la excepción, con cleanup 0 residuales).
- **No exponer PII ni datos clínicos** en ningún lado.
- **No mezclar** Analytics, SEO, branding y DB en un mismo PR.
- **Mantener permanentes** los 2 archivos Google (`public/google*.html`).
- **Mantener `robots.txt` y `sitemap.xml` intactos** salvo PR SEO autorizado.
- **Privacidad de Analytics:** sin cookies, sin PII, sin rutas privadas.
- **Validar producción** cuando el cambio afecte assets públicos, SEO o
  metadata.
- **Datos de validación:** jamás Katherine (`50372608827`) ni datos reales
  sensibles; usar fixtures aisladas o paciente demo (Pepe Toro). Camilo
  (`50378627694` / OTP `123456`, doctor demo) solo como demo público seguro.
- **Cierre estándar tras cada merge:** sincronizar `main`, reportar HEAD,
  confirmar PRs/migraciones/`main==origin/main`/`git status` vacío/rama
  borrada local+remoto/0 PRs abiertos/sin residuos, y no abrir otro frente.

---

## Cuentas y test phones (referencia)

| Uso | Phone | OTP |
|---|---|---|
| Camilo (médico demo) | `50378627694` | `123456` |
| Admin de plataforma | `50378056365` | `123456` |
| Paciente test | `50375000001` | `123456` |

Camilo: `profile_id=db1fba98-a299-4f25-82f1-7feff01e58fa`,
`doctor_id=783a902a-55fd-407c-9e0a-69568135c7f5`, slug `dr-camilo-carrillo`.
Ver `docs/CUENTA_DEMO_CAMILO.md`.
