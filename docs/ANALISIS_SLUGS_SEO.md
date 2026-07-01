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
