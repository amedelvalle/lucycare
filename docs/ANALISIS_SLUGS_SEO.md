# Análisis — Slugs públicos + SEO del directorio LucyCare

> **Estado:** Fase 0 (documental). **Docs-only.** Ningún código,
> ruta, DB, migración, metadata, `robots.txt`, `sitemap.xml` ni Edge
> Function fue tocado en este PR. Este documento cierra las decisiones
> Q1–Q5 y define el plan por fases para PRs futuros.
>
> **Origen:** frente "Slugs + SEO" (PR-0 read-only), decisiones
> aprobadas por el owner. HEAD base `55a26e1` (post-#206),
> migraciones vigentes hasta `s7_51`.

---

## 1. Diagnóstico actual (verificado en código)

### 1.1 Ruta y resolución del médico

- Única ruta pública del médico: **`/doctor/:id`** — `src/router/config.tsx`
  (`path: "/doctor/:id"` → componente `DoctorDetail`).
- **`:id` = UUID de `doctors.id`.** Se resuelve con
  `fetchDoctorDetail(id)` en `src/services/directory.service.ts`:
  `.from('doctors').eq('id', doctorId).eq('is_published', true).single()`.
- **No existe `slug`** en el esquema, ni en el payload, ni en el frontend.
- **No encontrado / no publicado:** `PGRST116` → `null` → la página muestra
  el estado "no encontrado". Un médico **no publicado devuelve `null`
  igual que uno inexistente** (gate `is_published = true` en la query).
  Correcto para privacidad: no se puede alcanzar por link directo un
  perfil despublicado.
- **No hay redirects.** `vercel.json` reescribe **todo** a `/index.html`
  (fallback SPA puro):
  ```json
  { "rewrites": [ { "source": "/(.*)", "destination": "/index.html" } ] }
  ```
- El botón "Compartir" del perfil usa `window.location.href` (la URL
  actual, hoy siempre UUID).

### 1.2 Cómo se enlaza al perfil hoy

- La tarjeta del directorio (`DoctorCard`) y el CTA "Reservar cita"
  navegan a `/doctor/:id` (UUID).
- Los enlaces compartidos (WhatsApp, copiar enlace) contienen el UUID.

---

## 2. Limitaciones de Vite SPA para SEO/OG (el nudo real)

La app es un **Vite SPA client-side puro** (`BrowserRouter`, sin SSR ni
prerender). Estado actual del `<head>` (`index.html`):

- Un solo **`<title>LucyCare</title>` estático**.
- **Sin** `meta description`, **sin** Open Graph, **sin** canonical.
- Favicon `/vite.svg`.
- **No hay `robots.txt` ni `sitemap.xml`** en `public/`.

**Consecuencias:**

1. **Todas las URLs sirven el mismo HTML inicial** con el título genérico.
2. **Google** puede ejecutar JS y eventualmente ver el contenido, pero el
   crawl es más lento/menos confiable y, hasta que corre el JS, todas las
   páginas comparten título/descripción idénticos.
3. **Los crawlers sociales (WhatsApp, Facebook, LinkedIn, Twitter/X) NO
   ejecutan JS.** Por eso **hoy cualquier link de un médico compartido por
   WhatsApp muestra el preview genérico "LucyCare"**, nunca el nombre/foto
   del médico. Este es el problema comercial de fondo.

**Verdad técnica vinculante:** la metadata dinámica por médico
(title/description/Open Graph) para **crawlers** exige que el **HTML de
respuesta ya contenga los tags**. Una solución client-side
(`react-helmet` / `document.title`) **no sirve para WhatsApp/Facebook/
LinkedIn** y es débil para Google. → Requiere **inyección server-side**
(ver §7, Fase 3).

**Importante para gestión de expectativas:** los **slugs arreglan la URL
visual**, pero **NO arreglan por sí solos el preview de WhatsApp**. El
preview/Open Graph se resuelve en **Fase 3**, no en Fase 1.

---

## 3. Modelo de slug aprobado (Q1, Q5)

- **Fuente:** **solo el nombre del médico** (`profiles.full_name`).
  Ejemplo: `/doctor/carlos-chavez-gonzalez`.
  - **No** incluir especialidad ni ciudad en el slug del perfil (razón:
    estabilidad — no debe cambiar si cambia especialidad, sede o
    municipio). Las páginas por especialidad/ubicación son otro frente
    (Fase 4).
- **Dónde se almacena:** columna `slug` en **`doctors`** (es la entidad
  que la ruta resuelve). `UNIQUE`, indexada. *(El nombre vive en
  `profiles` vía JOIN, pero el slug pertenece al doctor porque la ruta
  pública es del doctor.)*
- **Generación:** **server-side** (RPC o trigger), nunca client-side —
  solo el servidor garantiza unicidad atómica. Slugify:
  - minúsculas;
  - **normalizar tildes/ñ** (NFD + strip de diacríticos): "Peña" → `pena`,
    "Chávez" → `chavez`;
  - espacios → guiones;
  - quitar caracteres no alfanuméricos.
- **Colisiones:** sufijo incremental numérico:
  `carlos-chavez`, `carlos-chavez-2`, `carlos-chavez-3`, …
- **Estabilidad (Q5 — crítico para SEO):** el slug se genera **una vez**
  (al publicar/reclamar) y **queda congelado por defecto**. **No** se
  regenera automáticamente si cambia el nombre del médico (regenerar
  rompe links compartidos y el ranking acumulado).
- **Cambio manual por LucyAdmin (futuro):** si un admin cambia el slug:
  - **guardar el slug anterior**;
  - **redirigir** el slug anterior → slug nuevo;
  - **evitar 404**;
  - preservar enlaces compartidos y SEO.
- **Editable:** no editable por el médico en V1; admin-editable opcional
  (con el redirect del punto anterior).

---

## 4. Compatibilidad UUID + slug (sin romper nada) (Q2)

- **El UUID sigue vivo para siempre.** El resolver detecta el formato del
  parámetro:
  - si matchea patrón UUID → busca por `doctors.id`;
  - si no → busca por `doctors.slug`.
  - Un solo `:param` en la ruta, sin duplicar rutas.
- **Links de WhatsApp ya compartidos (UUID):** siguen resolviendo. Tras
  cargar, se puede hacer `history.replace(UUID → slug)` para que la barra
  muestre la URL amigable sin romper el botón "atrás".
- **Cero links rotos:** la resolución por UUID nunca se elimina; el slug
  se suma, no reemplaza.

---

## 5. Estrategia de redirects / canonical

- **URL canónica = la del slug.** La variante UUID debe emitir
  `<link rel="canonical">` apuntando a la slug (una vez exista inyección
  de meta, Fase 3), para que Google no indexe duplicados.
- **Redirect suave UUID → slug:** en cliente vía `history.replace` tras
  resolver (mejora la URL visible sin 301 server-side en V1).
- **Redirect de slug viejo → nuevo:** solo aplica si un admin cambia el
  slug manualmente (§3, Q5); se apoya en el historial de slugs.
- **Robots/canonical honestos:** solo perfiles publicados y completos
  entran al sitemap y son indexables (ver §6 y §8).

---

## 6. Política de indexación (Q3)

**Se permite indexar perfiles `listed_only`** siempre que cumplan
condiciones mínimas:

- `is_published = true`;
- perfil público completo;
- nombre;
- especialidad;
- clínica/sede;
- departamento/municipio o ubicación suficiente;
- sin datos sensibles;
- **metadata honesta**.

**Regla de honestidad de marca:** **no** usar copy de verificación
("Verificado por LucyCare") en la metadata si el médico **no** está
verificado. Un `listed_only` se indexa con descripción neutra (nombre +
especialidad + ubicación), sin afirmar validación.

**No indexar:**

- médicos no publicados;
- perfiles incompletos;
- perfiles sin especialidad;
- perfiles sin información mínima de ubicación;
- perfiles que LucyAdmin decida no indexar en el futuro (flag futura de
  control editorial).

---

## 7. Camino técnico SEO/OG aprobado (Q4)

**Dirección aprobada:** **Edge/Serverless function en Vercel** que
intercepta `/doctor/*`, lee el médico desde Supabase e **inyecta los
`<meta>` (title/description/Open Graph)** en el `index.html` de respuesta,
con cache por médico.

- **No** migrar a Next.js / SSR completo por ahora (reescribiría el shell
  del SPA; sobredimensionado).
- **No** usar solo React Helmet / `document.title` como solución principal
  para OG (WhatsApp/Facebook/LinkedIn no ejecutan JS).

**Comparativa (para memoria):**

| Opción | Qué implica | Veredicto |
|---|---|---|
| **A. Edge function (inyección de meta)** | Intercepta solo `/doctor/*`; no convierte la app a SSR; cache por médico | ✅ **Aprobada** |
| B. Prerender estático (SSG en build) | Genera HTML por médico en build; requiere rebuild al cambiar datos | ⚠️ Plan B; frágil a escala |
| C. SSR completo (Next.js/Remix) | Reescribe el shell de la app | ❌ Sobredimensionado ahora |

---

## 8. Fases recomendadas

Orden aprobado (**URLs amigables primero**, OG después):

- **Fase 0 — docs (este PR).** Decisiones Q1–Q5 + plan. Docs-only.
- **Fase 1 — slug backend** (DB, requiere autorización SQL del owner):
  columna `slug` en `doctors` + generación server-side (RPC/trigger) +
  backfill de publicados + exponer `slug` en el payload de
  `fetchDoctorDetail`/listado. Con `check`/`smoke` + `database.types.ts`
  actualizado en el mismo PR.
- **Fase 2 — routing / compatibilidad UUID + slug** (frontend, depende de
  F1): resolver acepta slug **o** UUID; tarjetas y "Compartir" emiten la
  URL con slug; `history.replace` UUID → slug; base para canonical.
- **Fase 3 — metadata / OG / sitemap / robots / schema** (infra, edge
  function): inyección de `<title>`/`description`/Open Graph por médico;
  `robots.txt`; `sitemap.xml` (solo publicados y completos); JSON-LD
  `Physician`/`MedicalBusiness`. **Aquí se resuelve el preview de
  WhatsApp.** Validación con el debugger de Open Graph de Facebook/
  WhatsApp.
- **Fase 4 — landings comerciales** (contenido/SEO mayor): páginas por
  **especialidad**, por **ubicación** y **especialidad + ubicación**
  (ej. `/cardiologia/san-salvador`), cada una con meta propia y listado.
  Frente grande aparte.

**Nota de secuencia:** si la prioridad #1 pasara a ser el preview de
WhatsApp, el mínimo viable sería **Fase 3, no Fase 1**. El owner aprobó
**URLs amigables primero** (F1 → F2 → F3 → F4).

---

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Romper links existentes | UUID resuelve para siempre; el slug se suma, no reemplaza |
| Slugs duplicados | `UNIQUE` en DB + generación server-side + sufijo `-2` |
| Tildes/ñ | Normalización NFD (Peña→pena, Chávez→chavez) |
| Cambio de nombre | Slug **congelado**; regeneración solo manual, con redirect del slug viejo |
| Médicos no publicados | Query ya gate `is_published`; sitemap y OG **solo** publicados |
| `listed_only` vs `verified` | Indexar `listed_only` solo con completitud + metadata honesta; **sin** copy de verificación si no está verificado |
| Exponer datos no deseados | OG solo nombre/especialidad/municipio; `license_number` ya fuera del payload público (#197); nunca DUI/teléfono en meta |
| Indexar perfiles incompletos | Sitemap e indexación solo si cumple completitud mínima (nombre+especialidad+clínica+ubicación); resto `noindex` |
| Prometer SEO sin SSR | Explícito: OG de WhatsApp requiere **Fase 3 (edge)**; los slugs solos no lo dan |

---

## 10. Qué NO implementar todavía

Este documento **no** habilita implementación. Quedan pendientes de PRs
futuros, cada uno con su propio alcance y autorización:

- **No** crear la columna `slug` ni RPC/trigger de generación (Fase 1, DB).
- **No** tocar rutas ni el resolver del perfil (Fase 2).
- **No** tocar metadata real, `index.html`, canonical (Fase 3).
- **No** crear `robots.txt` (Fase 3).
- **No** crear `sitemap.xml` (Fase 3).
- **No** tocar/crear Edge Functions (Fase 3).
- **No** crear landings de especialidad/ubicación (Fase 4).
- **No** tocar auth, pagos ni credenciales.

---

## 11. Propuesta de PRs futuros

1. **PR Fase 1 — `slug` backend** (`s7_5x`): columna + generación
   server-side + backfill + payload + `database.types.ts` + check/smoke.
   *Requiere autorización SQL del owner; owner aplica la migración, el dev
   corre check/smoke.*
2. **PR Fase 2 — routing UUID/slug** (frontend): resolver dual, emisión de
   URLs con slug en tarjeta/compartir, `history.replace`. *Requiere
   preview + OK visual.*
3. **PR Fase 3 — OG/meta/sitemap/robots/schema** (edge function + assets):
   inyección de meta por médico, `robots.txt`, `sitemap.xml`, JSON-LD.
   *Frente de infraestructura; validación con OG debugger.*
4. **PR Fase 4 — landings comerciales** (frente mayor): páginas por
   especialidad/ubicación con SEO propio.

Cada PR entra **uno a la vez**, con alcance explícito, sin abrir otro
frente hasta el cierre del anterior.

---

# Fase 3 — Metadata dinámica / Open Graph / preview de WhatsApp (diseño)

> **Estado:** diseño (docs-only). Fase 1 (`s7_52`) y Fase 2 (routing
> UUID/slug) están **live y verificadas en producción**. Esta sección
> cierra las decisiones de Fase 3 y define el plan por PRs. **No habilita
> implementación**: PR B (middleware) y siguientes se abren aparte, con su
> propia autorización.

## F3.1 Diagnóstico actual de metadata/OG (verificado)

- **`index.html`**: un solo `<title>LucyCare</title>` estático; **sin**
  meta description, Open Graph, Twitter Card, canonical ni robots. Favicon
  `/vite.svg`.
- **`vercel.json`**: `{ rewrites: [{ source: "/(.*)", destination:
  "/index.html" }] }` — fallback SPA puro.
- **Sin** `robots.txt` ni `sitemap.xml` en `public/`.
- **Sin** `api/`, `middleware.ts` ni funciones serverless/edge: deploy 100%
  estático en Vercel.
- **Assets**: logo `public/lucycare-logo.png` (apaisado ~1200×505). **No
  existe** una imagen OG dedicada 1200×630.
- **Datos del médico accesibles sin auth**: el directorio ya lee médicos
  publicados con el **anon key** (RLS permite `SELECT` de
  `is_published=true`). Una función edge puede hacer el mismo `SELECT` por
  slug.
- Stack: **Vite SPA puro** (React 19 + react-router 7), build `vite build`
  → `out/`. Sin framework SSR.

## F3.2 Problema real de WhatsApp / social previews

WhatsApp/Facebook/LinkedIn/Twitter **no ejecutan JS**. Piden el HTML de
`https://lucycare.app/doctor/:slug` y hoy reciben **siempre el mismo shell**
con `<title>LucyCare</title>` y cero OG → el preview compartido es genérico.
Un `react-helmet` / `document.title` client-side **no lo arregla** (corre en
JS, que el crawler no ejecuta). → **Requiere HTML servido dinámicamente con
la metadata ya inyectada** para las rutas `/doctor/*`.

## F3.3 Decisión: Vercel Routing Middleware (Q1)

**Aprobado:** **Vercel Edge/Routing Middleware** (`middleware.ts` en la
raíz) con `config.matcher = ['/doctor/:slug*']`, que intercepta solo
`/doctor/*`, hace `fetch` del médico a Supabase REST e **inyecta la meta**
en el shell HTML antes de servirlo.

- **Alcance acotado** por `matcher`; el resto del sitio queda igual.
- **No** migra a Next/SSR; mantiene la SPA.
- Inyecta metadata **antes** de servir el HTML (lo que ve el crawler).
- Mejor que prerender estático o SSR completo para este momento.
- **A confirmar empíricamente en PR B** (spike corto): que Vercel aplica un
  `middleware.ts` raíz a este proyecto **Vite estático** (Edge Middleware es
  framework-agnóstico y soportado, pero se valida en el primer deploy de
  preview). **Fallback documentado** si no aplicara: Serverless Function vía
  rewrite `/doctor/(.*)` → `/api/doctor-meta` (mismo efecto, más plomería).

## F3.4 Por qué NO SSR completo

Reescribir el shell a Next.js/Remix es sobredimensionado: el único `<head>`
que necesita ser dinámico es el de `/doctor/:slug`. El resto del sitio
funciona bien como SPA estático. SSR completo agrega complejidad, superficie
de bugs y coste sin beneficio proporcional hoy.

## F3.5 Por qué NO prerender estático (SSG)

Generar HTML por médico en build acopla **contenido ↔ deploy**: con 35+
médicos publicados y cambios frecuentes (altas, ediciones, publicación),
habría que rebuildear/redeployar ante cada cambio de datos. El middleware
resuelve la metadata **en request** con cache CDN, sin rebuilds.

## F3.6 Decisiones Q1–Q7 (cerradas)

- **Q1 — Mecanismo:** Vercel Routing Middleware (§F3.3). Confirmar
  aplicabilidad al proyecto Vite en el PR B.
- **Q2 — `og:image` (V1):** avatar público del médico si existe y es URL
  pública/usable; **fallback temporal** al logo/branding existente. **No**
  bloquear Fase 3 por el asset. **No** generar OG dinámica todavía. Deuda
  documentada: asset OG branded **1200×630** (y, más adelante, imagen
  dinámica por médico).
- **Q3 — Indexación:** ver §F3.10.
- **Q4 — Sitemap/robots:** dentro de Fase 3, **PR C separado** (§F3.14).
- **Q5 — schema.org / JSON-LD:** **diferido a PR D**. El primer PR funcional
  (B) resuelve title/description/OG/Twitter/canonical/robots + fallback
  seguro; sin JSON-LD.
- **Q6 — Asset OG por defecto:** no bloquea; PR B usa fallback con
  logo/branding existente. Deuda: OG branded 1200×630 (directorio), y luego
  posible imagen dinámica por médico.
- **Q7 — Env vars Vercel:** el owner agrega, al llegar el PR funcional, solo
  **URL pública de Supabase + anon key**. **Nunca** service role ni secretos
  administrativos. Respetar RLS; solo lectura de médicos publicados.

## F3.7 Arquitectura propuesta (PR B)

`middleware.ts` (raíz), `config.matcher = ['/doctor/:slug*']`:

1. **Intercepta** solo `/doctor/*` (el resto sigue con el rewrite actual).
2. **Extrae el slug** del path. Si parece UUID resuelve por `id`, si no por
   `slug` (mismo criterio que Fase 2).
3. **Fetch a Supabase REST** con anon key, **solo publicados**
   (`is_published=eq.true`): `select=id,slug,is_verified,lucy_status,
   profiles(full_name,avatar_url),specialties(name),
   clinics(name,municipalities(name),departments(name))`.
4. **Toma el shell HTML** (el `index.html` estático de la propia
   deployment) e **inyecta en el `<head>`** la metadata del médico.
5. **Devuelve** el HTML transformado con cache CDN (§F3.12).
6. **Casos borde:** §F3.11.
7. **Humanos:** reciben el mismo HTML con meta correcta; React hidrata y
   renderiza normal. **Crawlers:** leen la meta ya presente.

Fuente de datos = **anon key** (misma que el cliente; segura + RLS-gated).

## F3.8 Metadata mínima de PR B (por perfil publicado y completo)

```html
<title>{Nombre} — {Especialidad} | LucyCare</title>
<meta name="description" content="Perfil de {Nombre}, {Especialidad} en {Municipio}, {Depto}. {Reservá en línea | Contactá} en LucyCare.">
<link rel="canonical" href="https://lucycare.app/doctor/{slug}">
<meta name="robots" content="index,follow">
<meta property="og:type" content="profile">
<meta property="og:title" content="{Nombre} — {Especialidad}">
<meta property="og:description" content="{descripción honesta}">
<meta property="og:url" content="https://lucycare.app/doctor/{slug}">
<meta property="og:image" content="{avatar_url público | OG por defecto branded}">
<meta property="og:site_name" content="LucyCare">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{Nombre} — {Especialidad}">
<meta name="twitter:description" content="{descripción}">
<meta name="twitter:image" content="{misma og:image}">
```
*(JSON-LD `Physician` NO entra en PR B; se difiere a PR D — Q5.)*

## F3.9 Exclusiones de privacidad (vinculantes)

**Nunca** en la metadata: `license_number`/JVPM/NUE, DUI, teléfono ni email.
Solo datos públicos: nombre, especialidad, municipio/departamento, avatar
público. **No** usar copy de verificación ("Verificado por LucyCare") si
`is_verified=false`. La descripción de reserva solo si `booking_enabled`.

## F3.10 Política de indexación (Q3, confirmada)

**Indexar** (`robots: index,follow`) solo perfiles que cumplan **todo**:
`is_published=true` · slug existente · nombre · especialidad · clínica/sede ·
ubicación suficiente · metadata honesta. Se permite `listed_only` si está
publicado y completo, **sin** copy de verificación.

**No indexar** (`robots: noindex`): no publicados · inexistentes ·
incompletos · sin especialidad · sin ubicación suficiente · perfiles que
LucyAdmin decida excluir a futuro.

## F3.11 Manejo de no publicados / inexistentes

- **Slug inexistente o no publicado** → shell con `robots: noindex` + title
  y description **genéricos** de LucyCare. **Nunca** datos de otro médico. El
  SPA renderiza "Médico no encontrado" para el humano.
- **Perfil publicado pero incompleto** → servir meta básica pero con
  `noindex` (no promover en buscadores un perfil pobre).
- **Supabase caído desde el edge** → degradar a shell genérico (nunca 500);
  el humano sigue viendo la SPA.

## F3.12 Caché propuesto

`Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`: el CDN
cachea el HTML por URL; los cambios de perfil se reflejan en ≤1h. Opción
futura: purga on-demand al editar/publicar un perfil. La navegación interna
del humano es client-side (no toca el edge).

## F3.13 Env vars requeridas (Vercel, PR B)

Solo dos, agregadas por el owner en el proyecto Vercel para el runtime edge
(hoy existen solo como `VITE_*` de build): **URL pública de Supabase** +
**anon key**. **Nunca** service role. Solo lectura de médicos publicados
(RLS).

## F3.14 Plan de PRs (Fase 3)

- **PR A — docs-only** (este): diagnóstico + decisiones Q1–Q7 + arquitectura
  + plan. Sin código.
- **PR B — middleware metadata/OG mínimo** para `/doctor/*` (núcleo,
  **arregla WhatsApp**): `middleware.ts` + inyección + fetch Supabase +
  caching + casos borde + fallback seguro. *Requiere env vars Vercel
  (owner) + validación con el OG debugger de Facebook/WhatsApp. Confirma la
  aplicabilidad del middleware al proyecto Vite.*
- **PR C — `robots.txt` + `sitemap.xml`**: robots estático (Disallow de
  `/panel`, `/admin`, `/paciente`, `/reset-password`; `Sitemap:` apuntando)
  + sitemap dinámico (solo publicados y completos; `lastmod`=`updated_at`).
- **PR D — refinamientos**: JSON-LD `Physician`, canonical hardening, asset
  OG branded 1200×630 (y evaluar OG dinámica por médico).

Uno a la vez, con alcance explícito, sin abrir el siguiente hasta cerrar el
anterior. **Ningún PR de Fase 3 toca DB/SQL/migraciones** (la data ya
existe); PR B/C tocan **infra de deploy** (`middleware.ts` / `vercel.json` /
`public/`), no la app React salvo lo estrictamente necesario.

## F3.15 Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Romper SPA routing / rewrites | Middleware con `matcher` **solo** `/doctor/*`; el resto sigue con el rewrite actual; el humano siempre recibe el shell SPA |
| Middleware no aplicable al Vite estático | Spike en PR B; fallback a Serverless Function vía rewrite |
| Canonical duplicado | El `index.html` hoy no tiene canonical → cero duplicación; inyectar exactamente uno |
| Exponer no publicados | `is_published=eq.true` en el fetch; no encontrado → `noindex` + genérico, sin datos |
| Performance/latencia | Edge solo en `/doctor/*`; CDN `s-maxage`; navegación interna client-side no toca edge |
| Cache viejo | `s-maxage=3600` + `stale-while-revalidate`; purga on-demand futura |
| Supabase caído desde edge | Fallback a shell genérico (nunca 500) |
| Costo/invocaciones | Volumen bajo (solo `/doctor/*` en carga directa/crawler) |
| og:image pobre | Avatar público V1 + fallback branded; OG dinámica = follow-up |
| Env vars mal alcanzadas | Solo URL pública + anon key; nunca service role; RLS |
| Metadata incorrecta/deshonesta | Reglas de §F3.9 vinculantes; validar con OG debugger antes de merge |

## F3.16 Qué NO se implementa todavía

Este documento (PR A) **no** habilita implementación. Pendientes de PRs
futuros con autorización propia:

- **No** crear `middleware.ts` (PR B).
- **No** tocar `vercel.json` / `index.html` / metadata real (PR B).
- **No** crear `robots.txt` / `sitemap.xml` (PR C).
- **No** JSON-LD / canonical hardening / asset OG 1200×630 (PR D).
- **No** OG dinámica por médico (follow-up posterior).
- **No** Fase 4 (landings especialidad/ubicación).
- **No** tocar DB/SQL/migraciones/Supabase writes/auth/pagos/credenciales.
