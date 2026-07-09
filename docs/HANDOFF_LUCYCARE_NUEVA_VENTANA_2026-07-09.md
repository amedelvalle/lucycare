# HANDOFF — Nueva ventana de contexto (2026-07-09, post-PR #257)

> **PUNTO DE ENTRADA VIGENTE.** Documento autosuficiente para arrancar una
> ventana nueva sin depender del chat anterior. Leer ESTE primero; luego
> `CLAUDE.md` y los `docs/ANALISIS_*.md` del objetivo del día. Reemplaza como
> punto de entrada al `docs/HANDOFF_CHATGPT_LUCYCARE_NUEVA_VENTANA_2026-07-03_POST_PR220.md`
> (queda histórico). **No asumir nada sin confirmar el estado real del repo.**

## Protocolo de arranque

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -10
gh pr list --state open
```

Producción: **https://lucycare.app** (Vercel auto-deploy desde `main`; Supabase;
DNS en Cloudflare). `gh` CLI autenticado. Shell principal PowerShell; Bash
disponible.

---

## 1. Estado final del repo (2026-07-09)

- **HEAD de `main`:** `da84efa` (*feat(admin): LucyAdmin limitado para
  directory_editor (PR-B frontend) (#263)*).
- **PRs mergeados:** **#1–#263**.
- **Migraciones aplicadas en Supabase:** hasta **`s7_57`** (backend de niveles de
  acceso LucyAdmin; el frontend acotado del `directory_editor` es #263, sin
  migración; ver §4-ter).
- **`main == origin/main`** · **árbol limpio** · **0 PRs abiertos** · sin
  preview local / fixtures / scripts temporales / ZIPs temporales / servers ·
  **sin frente funcional abierto**.
- `tsc --noEmit` OK · `npm run build` OK en `main`.

**Reglas operativas (vinculantes):** un solo frente a la vez; no abrir PR sin
autorización del owner ni mergear sin su OK explícito; cambios chicos y
acotados; docs-only = no tocar código; PR que toca DB → migración +
`check`/`smoke`, **el owner aplica el SQL** y el dev corre los checks; validar
producción tras merge cuando afecte assets públicos/SEO; **datos de validación:
jamás Katherine (`50372608827`) ni datos reales sensibles — usar fixtures
aisladas o el paciente demo (Pepe Toro); Camilo (`50378627694`/OTP `123456`,
doctor demo) solo como demo seguro**. Cierre estándar tras cada merge (HEAD,
PRs, migraciones, `main==origin/main`, `git status` vacío, rama borrada
local+remoto, 0 PRs abiertos, sin residuos).

---

## 2. Analytics de conversión (Fase 3) — CERRADO

Dashboard interno LucyAdmin de conversión del directorio, read-only,
solo agregados, 0 PII.

- **Backend `s7_53` (#245):** RPCs `admin_conversion_summary` +
  `admin_doctor_conversion_ranking` (`SECURITY DEFINER`, `is_admin()`).
- **UI `/admin/analytics` (#247):** KPI cards (reservas por source/estado,
  waitlist, afiliaciones, reclamos, oferta, reseñas) + ranking de médicos +
  filtro de fechas. Bajo `AdminOnlyRoute`.
- Cierres docs #246/#248. Filtros geo son **TEXT** (`department_id`/
  `municipality_id`), `specialty_id` uuid.
- Detalle vivo: `docs/ANALISIS_ANALYTICS_LUCYCARE.md`.

---

## 3. Analytics Farma — CERRADO COMPLETO (diseño + backend + UI)

Capa **estratégica INTERNA** de inteligencia de prescripción por médico,
admin-only, **no divulgable**.

- **PR-0 diseño (#249):** `docs/ANALISIS_ANALYTICS_FARMA.md`.
- **PR-A backend `s7_54` (#250):** 3 RPCs `SECURITY DEFINER STABLE` /
  `is_admin()` de solo lectura: `admin_pharma_summary` +
  `admin_pharma_medication_ranking` + `admin_pharma_doctor_ranking`. **Base
  vinculante:** `prescriptions.is_current=true` + `consultations.status='signed'`
  + fecha `consultations.signed_at` + snapshots históricos (`s7_37`, no depende
  del catálogo actual) + fuente `medications.doctor_id` (NULL=global Base Lucy /
  set=personal). **Umbral de privacidad:** los dos rankings aplican
  `HAVING count(*) >= p_min_count` (default 3). Cierre docs #254.
- **PR-B UI `/admin/analytics/farma` (#255):** pantalla read-only bajo
  `AdminOnlyRoute` + NavLink "Analítica Farma"; KPIs + ranking de medicamentos +
  ranking por médico; **filtro por médico** (`p_doctor_id` ya soportado por las
  RPCs → "Medicamentos de \<médico\>"); filtro de fecha; `min_count` default 1.
  **Permite ver qué medicamentos deja cada médico, sin identificar pacientes.**
  Cierre docs #256.
- **Privacidad (verificada):** solo agregados + datos públicos del médico
  (nombre/especialidad) + catálogo (medicamento/PA/concentración/presentación/
  fuente) + conteos. **Nunca** paciente, `patient_id`, `consultation_id`, receta
  individual, diagnóstico, notas/vitales/antecedentes, `instructions`/
  `alternatives`/`dosage`/`frequency` crudos, ni relación paciente↔medicamento.
- **No existe categoría terapéutica** (V2+ requiere mejorar catálogo);
  principio activo/concentración son texto libre (normalización pendiente).
- Servicios: `src/services/adminPharma.service.ts`; página
  `src/pages/admin/AdminAnalyticsFarmaPage.tsx`.

---

## 4. Fix de doble reserva (`s7_55`) — CERRADO

Bug de producción: dos citas para el mismo médico/fecha/hora.

- **Causa raíz:** los 3 flujos (reserva pública `booking.service`, walk-in
  `walkIn.service`, reschedule `appointments.service`) validaban conflictos
  **solo client-side** (check-then-insert), sin guard atómico en DB; el trigger
  `s6_04` solo valida la ventana de disponibilidad, no el solapamiento →
  **race condition TOCTOU**.
- **Fix backend `s7_55` (#251):** trigger `prevent_appointment_overlap`
  (`BEFORE INSERT OR UPDATE OF doctor_id, start_time, end_time, status_id`,
  `SECURITY DEFINER` + `SET search_path=public`) que rechaza (`RAISE P0090`)
  crear/mover una cita que **solape** con otra **activa** del mismo médico.
  Regla de "activo" = `appointment_statuses.is_final = false`. Atomicidad con
  `pg_advisory_xact_lock(doctor)`. Solapamiento por `tstzrange [start,end) '[)'`.
- **UX `P0090` (#252):** `SLOT_TAKEN_MESSAGE` + `isSlotOverlapError` mapean el
  error a "Ese horario acaba de ocuparse. Por favor elegí otro horario
  disponible." en los 3 flujos. Cierre docs #253.
- **Duplicado real de prod:** resuelto **manualmente por el owner** (canceló una
  de las dos). No tocar ese dato.

---

## 4-bis. Índices de soporte para Analytics/Farma (`s7_56`) — CERRADO (#259)

Cierre del frente **P0 read-only de escalabilidad analítica**. Objetivo:
**soporte preventivo de performance** para los dashboards admin de solo-lectura,
bajo el criterio rector *"la analítica debe **observar** la operación, no
**competir** con ella"*.

- **Diagnóstico (P0 read-only):** verificación contra `pg_indexes` de la **DB
  real** confirmó que las columnas calientes que consumen `s7_53` (conversión) y
  `s7_54` (farma) no tenían índice: `prescriptions` y `audit_log` solo tenían PK;
  `consultations`/`appointments`/`reviews` sin índice sobre las columnas de
  fecha/join analíticas. `waitlist_entries` y `doctor_affiliation_requests` ya
  estaban bien indexadas → **intactas**.
- **Migración `s7_56` (#259) — additive-only** (`migrations/s7_56_analytics_indexes.sql`,
  solo `CREATE INDEX IF NOT EXISTS`, sin lógica/RPC/UI/RLS/`database.types.ts`).
  **7 índices** agregados:
  - `idx_prescriptions_consultation` — JOIN prescriptions→consultations (las 3 RPCs farma).
  - `idx_consultations_signed` — parcial `WHERE status='signed'` (filtro de fecha farma).
  - `idx_audit_claim_self_service` — parcial `WHERE new_data->>'edited_via'='claim_self_service'`
    (la peor query: claims del summary de conversión sobre `audit_log`, la tabla
    de mayor crecimiento).
  - `idx_prescriptions_medication` · `idx_prescriptions_current` (parcial `WHERE is_current`).
  - `idx_appointments_created` · `idx_reviews_created`.
- **`CREATE INDEX` normal** (no `CONCURRENTLY`) por volumen actual bajo.
- **Validación:** **aplicado en Supabase por el owner** + **verificado en DB real**
  con `pg_indexes` (los 7, con predicados parciales correctos) + **smokes verdes
  sin regresión** (`_smoke-s7_53.mjs` **32/32**, `_smoke-s7_54.mjs` **27/27** —
  agregados **idénticos**: los índices no cambian resultados, solo el plan).
- **NO** se creó `check-s7_56.mjs`: una migración solo-índices no tiene
  superficie observable vía supabase-js (`pg_indexes` inaccesible); la
  verificación es la consulta `pg_indexes` + los smokes existentes.
- **Alcance respetado:** `min_count=1` de Farma **intacto**; **sin** refactor de
  claims fuera de `audit_log` (opción B = follow-up separado); **sin** tocar
  código/frontend/RPC/RLS/auth/UI/`database.types.ts`/Analytics V2/materialized
  views/Search Console/SEO/Slugs/Brand-Favicon.
- **Follow-ups (backlog, NO iniciados):** opción B (sacar claims de `audit_log`) ·
  guardias defensivas (rango máximo server-side + `statement_timeout`) ·
  Analytics/Farma V2 (preagregación/materialized views) solo cuando el volumen o
  la latencia medida lo justifiquen. Ver el reporte P0 en el histórico de esta ventana.

---

## 4-ter. Niveles de acceso administrativo LucyAdmin (`s7_57`) — CERRADO (#261, PR-A backend)

Acceso administrativo **por niveles**, aditivo y de mínimo privilegio, **sin
tocar `is_admin()` ni el enum `user_role`**. Primer uso real: **`directory_editor`**
(ayuda administrativa / editor del directorio médico). Solo backend/DB — el
frontend (guard/nav/ficha) queda para **PR-B**.

- **Modelo (3 niveles conceptuales):**
  - `owner_admin` = `profiles.role='admin'` + `is_admin()`. **NO vive en la
    tabla** (superset absoluto; las ~95 superficies admin históricas intactas).
  - `directory_editor` y `operations_admin` = filas en **`lucyadmin_access`**
    (`profile_id` PK · `access_level ∈ {directory_editor, operations_admin}` ·
    `is_active` · `granted_by/at` · `revoked_at` · `notes` · **RLS admin-only**).
  - Niveles anidados por rank (`directory_editor(1) ⊂ operations_admin(2) ⊂
    owner_admin(∞)`); capacidad = `is_admin() OR (fila activa con rank ≥ umbral)`.
- **Funciones (`s7_57`):** `can_access_lucyadmin()`, `can_manage_directory()`,
  `can_manage_doctor_operations()`, `can_manage_lucyadmin_users()` (owner-only),
  `my_lucyadmin_access()` (snapshot para el guard/nav de PR-B) + helpers
  `_lucyadmin_rank` / `_lucyadmin_actor`.
- **Re-gate quirúrgico** `is_admin()`→`can_manage_directory()` de las RPCs de
  datos **públicos** del médico: `admin_update_doctor_clinic`,
  `admin_update_doctor_info`, `admin_set_doctor_published` (verificado: toca solo
  `is_published`), `admin_list_doctor_services`, `admin_create_service`,
  `admin_update_service`, `admin_set_service_active`.
- **RPCs nuevas acotadas:** `directory_list_doctors` + `directory_get_doctor_detail`
  (**sin email/phone de login**) + `directory_update_doctor_name` (**solo
  `profiles.full_name`, jamás `auth.users`**). Audit `edited_via` = actor efectivo.
- **`directory_editor` PUEDE:** ver listado/ficha, corregir nombre visible,
  especialidad, bio, clínica/dirección/depto-muni/teléfono público, servicios
  públicos (crear/editar/activar, **no** hard-delete), publicar/despublicar
  (solo `is_published`).
- **`directory_editor` NO puede** (owner-only, verificado por smoke): `auth.users`,
  email/phone de login, `admin_update_doctor_profile`, roles, `lucy_status`,
  `is_verified` (GENERATED; `admin_set_doctor_verified` fue dropeada en `s7_03`),
  `is_operational`, `booking_enabled`, avatar (RPC + Storage RLS), hard-delete,
  pacientes/merge, consultas, recetas, diagnósticos, lista de espera,
  afiliaciones, administradores, **Analytics**, **Analytics Farma**, pagos,
  ownership clínico.
- **`operations_admin` = DISEÑADO pero INERTE:** hereda directorio (herencia
  limpia) pero **ninguna RPC operativa se le abre** en este PR → **PR-C futuro**
  decidirá su superficie. Analytics/Farma siguen owner-only.
- **Verificado:** `check-s7_57.mjs` **15/15** + `_smoke-s7_57.mjs` **43/43**
  (matriz admin/editor/operations/inactivo/normal + sin fuga de login creds +
  audit por actor + fixtures aisladas, cleanup 0 residuales, jamás Katherine).
  `database.types.ts` actualizado (tabla + 8 firmas).

### Frontend — LucyAdmin limitado (`#263`, PR-B) — CERRADO

Capa UX sobre `s7_57` (**frontend-only**, sin DB/SQL/migraciones/`database.types.ts`/
backend/`auth.users`): un usuario con `lucyadmin_access` nivel `directory_editor`
usa LucyAdmin de forma acotada.

- **Hook `useLucyAdminAccess`** (consume `my_lucyadmin_access()`) + service
  `directoryEditor.service` (`directory_list_doctors`/`directory_get_doctor_detail`/
  `directory_update_doctor_name`).
- **`AdminOnlyRoute`** ahora permite entrar a **owner O nivel con capacidad**;
  **`RequireOwnerAdmin`** envuelve las secciones owner-only (dashboard, afiliaciones,
  catálogos, lista-espera, pacientes, administradores, analytics, analytics/farma)
  → un nivel acotado se **redirige a `/admin/medicos`**.
- **`AdminLayout`** filtra el nav (editor ve **solo "Médicos"**; badge de afiliaciones
  gateado a owner).
- **`AdminDoctorsPage`/`AdminDoctorEditPage`** = dispatcher por nivel → vistas
  acotadas `DirectoryDoctorsList` / `DirectoryDoctorEdit`. `AdminDoctorServicesSection`
  con prop `canDelete` (editor=false).
- **Comportamiento final:**
  - **Owner/Admin total** (`profiles.role='admin'`): ve **todo** LucyAdmin, sin cambios.
  - **`directory_editor`**: `/admin`→`/admin/medicos`; nav **solo "Médicos"**; rutas
    sensibles **redirigen**; **listado acotado** (sin teléfono/email de login,
    sin lucy_status editable, sin operatividad/lista de espera); **ficha acotada**
    (Nombre visible / Clínica / Información profesional / Servicios) **sin**
    login email/phone, avatar, verificación, `lucy_status`, `is_operational`,
    `booking_enabled`, lista de espera, borrar servicio ni destructivas.
  - **El borde real de seguridad sigue siendo el gate server-side de cada RPC**
    (`s7_57`); esta capa es UX.
- **Validado:** `tsc`+`build` verdes + preview owner y `directory_editor`
  (redirecciones, nav filtrado, ficha acotada, móvil 375 sin overflow, consola 0
  errores). Sesión de editor vía grant temporal a un test phone (**revocado, 0
  residuales**); ficha de Camilo (demo) read-only; **jamás Katherine, sin datos
  reales modificados**. 11 archivos, todos `src/`.

### Pendiente NO iniciado (operativo)

- **`operations_admin`** sigue **diseñado pero INERTE** (sin RPCs ni pantallas
  operativas abiertas) → **PR-C futuro** decidirá su superficie.
- **Otorgar acceso a la persona real** (el teléfono ya guardado en Supabase):
  **Test Phone OTP fijo + `INSERT` manual del owner en `lucyadmin_access`**
  (`access_level='directory_editor'`, `is_active=true`). **NO iniciado — solo
  cuando el owner lo autorice.** No toca `auth.users`.

---

## 5. Brand/Favicon — CORREGIDO EN PRODUCCIÓN (#257)

**Causa raíz del ícono genérico (globo) de Google:** `/favicon.ico`,
`/apple-touch-icon.png` y `/site.webmanifest` **no existían como archivos** → el
rewrite SPA de Vercel devolvía el HTML del shell (no imagen). Solo existía
`favicon.svg`.

- **Fuente:** **isotipo oficial** cuadrado (`isotipo con margen.svg`, marca mint
  `#00e4cb`), **NO** el logo horizontal.
- **Assets nuevos:** `public/favicon.ico` (ICO 16/32/48) · `public/apple-touch-icon.png`
  (180) · `public/icon-192.png` · `public/icon-512.png` · `public/site.webmanifest`
  (LucyCare, icons 192/512, theme/background `#3C2285`, display standalone).
  Marca compuesta sobre **tile morado `#3C2285`** (= theme-color) para
  legibilidad en tamaños chicos; margen conservado; canvas cuadrado.
- **Modificados:** `public/favicon.svg` (actualizado al mismo isotipo para
  consistencia SVG↔raster, ya que los navegadores modernos prefieren el SVG) +
  `index.html` (links `.ico`/svg/apple-touch/manifest; `theme-color` intacto).
- **Rasterizado** con `sharp` transitorio (`--no-save`; `package.json`/lock
  intactos; node_modules gitignored, no commiteado).
- **Validado en prod `lucycare.app`:** `/favicon.ico` 200 `image/vnd.microsoft.icon`
  · `/favicon.svg` 200 `image/svg+xml` · `/apple-touch-icon.png`·`/icon-192.png`·
  `/icon-512.png` 200 `image/png` · `/site.webmanifest` 200 `application/manifest+json`;
  Home `/` y `/doctor/dr-camilo-carrillo` 200; `robots.txt` + `sitemap.xml` (36
  URLs) intactos; el HTML del Home referencia los 4 assets.
- **NO tocó:** `lucycare-logo.png` · OG 1200×630 · SEO/slugs/middleware/sitemap/
  robots · SQL/DB/backend/auth.
- **Nota operativa:** Google recrawlea el favicon en su propio ciclo (días/
  semanas); el globo puede tardar en actualizarse aunque prod ya esté correcto.
- **Nota (búsquedas de marca, 2026-07-09):** el owner buscó "Lucy" en Google y
  vio dominios **parecidos** (`lucy-app.com`, `lucy-care.com`) que **NO son
  `lucycare.app`**; el globo de esos resultados **NO prueba que #257 haya
  fallado** (es de otros dominios). `lucycare.app` ya sirve favicon/manifest
  reales en prod (validado); falta que Google **recrawlee** (días/semanas).
  **Pendiente futuro SEPARADO (no código, no iniciar sin instrucción):** Google
  Search Console — indexación de `lucycare.app`, descubrimiento de la marca
  "LucyCare", `site:lucycare.app`, posible reindexación (sin spamear), y
  visibilidad frente a los dominios parecidos. Search Console + tiempo +
  autoridad, no un bug de favicon.

---

## 6. Criterio estratégico para analítica escalable (backlog, NO frente abierto)

> **La analítica debe observar la operación, no competir con la operación.**

Aunque LucyCare esté en MVP, pensar el crecimiento (**1.000+ médicos**
recetando/agendando/usando el sistema). Para **Analytics V2, Farma V2, exports o
dashboards futuros**, criterio vinculante:

- **No descargar data cruda masiva al frontend.** No bajar recetas individuales,
  pacientes ni texto clínico libre para análisis en cliente.
- **Agregación server-side** siempre (RPCs `SECURITY DEFINER`/`is_admin()`, como
  `s7_53`/`s7_54`), con **filtros de fecha**, **límites y paginación**.
- **Evitar queries que escaneen tablas completas** sin necesidad.
- **No meter analítica pesada en pantallas operativas del médico.** Separar
  analítica de los flujos críticos: agenda · consulta · receta · login · reserva
  · panel médico.
- Si el volumen crece, evaluar: **índices** · **vistas materializadas** ·
  **tablas preagregadas** · **jobs programados** · **cache** · **límites
  defensivos** · **timeouts** · **monitoreo de performance**.

*(Criterio/backlog. NO abrir Analytics V2 todavía.)*

---

## 7. Pendientes vivos (NO iniciar sin instrucción explícita del owner)

1. **Análisis de escalabilidad de módulos analíticos** (aplicar el criterio §6).
2. **Analytics V2 / Farma V2** — solo DESPUÉS del análisis de escalabilidad.
   (Farma V2: filtros geo/especialidad en UI, export, gráficos, top-medicamento
   por médico con min-cell, normalización de PA/equivalencias/categoría
   terapéutica.) (Analytics V2: eventos custom de comportamiento — bloqueado por
   plan Vercel; alternativa Plausible/PostHog EU. Ver `docs/ANALISIS_ANALYTICS_LUCYCARE.md`.)
3. **Slugs+SEO PR D:** JSON-LD `Physician` + canonical hardening + **OG branded
   1200×630** (reemplazaría `lucycare-logo.png` como `og:image`). Ver
   `docs/ANALISIS_SLUGS_SEO.md`.
4. **Branding interno menor** (stat card índigo del panel + botón púrpura de
   `AdminAffiliationDetailModal` + token de marca).
5. **Perf P2** — code-splitting del JS (~305 KB gzip en un chunk); Perf menor
   (lazy avatares, evaluar Pacifico).
6. **Favicon follow-up menor (opcional):** aún no hay `favicon.png` "maskable"
   dedicado; el manifest usa icons 192/512 estándar (suficiente).
7. **Indexación de marca (operativo, Search Console, no código):** monitorear
   Coverage (indexadas vs descubiertas) y Performance; el dominio es nuevo y la
   aparición en Google depende de tiempo/autoridad. Incluye: recrawl del favicon
   de #257, búsqueda exacta `site:lucycare.app`, descubrimiento de "LucyCare",
   posible reindexación (sin spamear), y visibilidad frente a dominios parecidos
   (`lucy-app.com`/`lucy-care.com`) — ver §5.
8. Otros pendientes históricos listados en `CLAUDE.md` (F4-D identidades
   diferido; credenciales `doctor_credentials`; recuperación sin sesión; etc.).

---

## 8. Cuentas y test phones (referencia)

| Uso | Phone | OTP |
|---|---|---|
| Camilo (médico demo) | `50378627694` | `123456` |
| Admin de plataforma | `50378056365` | `123456` |
| Paciente test | `50375000001` | `123456` |

Camilo: `profile_id=db1fba98-a299-4f25-82f1-7feff01e58fa`,
`doctor_id=783a902a-55fd-407c-9e0a-69568135c7f5`, slug `dr-camilo-carrillo`.
Ver `docs/CUENTA_DEMO_CAMILO.md`. **Jamás usar Katherine (`50372608827`) ni
datos reales sensibles en validación.**

---

**La nueva ventana puede arrancar SOLO desde este handoff** (+ `CLAUDE.md` para
el detalle histórico), sin depender del chat anterior.
