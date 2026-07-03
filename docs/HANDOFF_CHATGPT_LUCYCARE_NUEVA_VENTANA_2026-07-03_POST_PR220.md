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

- **HEAD de `main`:** `72a7fd6` (*fix(branding): favicon de LucyCare … (#220)*).
- **PRs mergeados:** **#1–#220**.
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

**Pendientes NO iniciados:** **PR D** (JSON-LD `Physician` + canonical
hardening + asset OG branded 1200×630) · **Fase 4** (landings por
especialidad/ubicación).

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

## 5. Pendientes generales NO iniciados

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
    `AdminAffiliationDetailModal`, token de marca) — no iniciar sin alcance.
12. **Próximo-slot-real en la tarjeta** — pendiente histórico; no iniciar sin
    alcance.
13. **Limpieza de ramas locales `claude/*` viejas** — opcional, solo con
    **dry-run + autorización expresa**, sin tocar worktrees activos.

---

## 6. Reglas operativas para la nueva ventana (vinculantes)

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
