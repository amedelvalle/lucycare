# HANDOFF — Nueva ventana de contexto (2026-07-13, post-PR #270)

> **PUNTO DE ENTRADA VIGENTE.** Leer este primero. Reemplaza como handoff
> operativo al `2026-07-09` (que queda histórico). El detalle histórico
> completo sigue en `CLAUDE.md`.

---

## 1. Estado técnico final (2026-07-13, tras cerrar #270)

- **HEAD de `main`:** `9bab47b` (*fix(panel): distinguir sesión vencida de
  problema de conexión (sin loop de Reintentar) (#270)*).
- **PRs mergeados:** **#1–#270**.
- **Migraciones aplicadas en Supabase:** hasta **`s7_57`** (niveles de acceso
  LucyAdmin `directory_editor`; el resto de PRs recientes son frontend/docs sin
  migración).
- **`main == origin/main`** ✅ · **árbol limpio** (`git status --short` vacío) ·
  **0 PRs abiertos** · **sin preview local** · **sin servers** · **sin fixtures** ·
  **sin scripts temporales** · **sin ZIPs temporales** · **sin frente funcional
  abierto**.
- `tsc --noEmit` y `npm run build` verdes en `main`.

---

## 2. Frentes recientes cerrados

### PR #263–#264 — Editor de directorio (`directory_editor`) frontend + docs
Ver `CLAUDE.md` §HEAD y §4-ter del handoff `2026-07-09`. Backend `s7_57` (#261) +
frontend limitado (#263) + docs (#262/#264). LucyAdmin acotado para
`directory_editor`; owner conserva todo; `operations_admin` diseñado pero inerte.

### PR #266–#267 — SEO Brand + copy comercial del Home
- `og-meta.mjs` (+ smoke). JSON-LD `Organization` + `WebSite` (`areaServed=El
  Salvador`), Home `/` en el sitemap, y title comercial del Home
  (`LucyCare El Salvador — Encuentra al médico perfecto para ti`). Sin DB/backend.
  Validado en prod.

### PR #268 — Rediseño visual de la receta impresa/PDF
- **Frontend-only.** `RecetaPrint.tsx` + `src/index.css`.
- Receta con **formato limpio tipo tarjeta**: **franja teal** superior,
  **encabezado médico + fecha**, **bloque gris del paciente**, **tabla de
  medicamentos** (Medicamento/Dosis/Frecuencia/Duración) con **indicaciones/
  alternativas en fila ancha** secundaria.
- **Footer/firma + datos duplicados del médico ELIMINADOS** (nombre y JVPM ya
  viven una sola vez en el encabezado). **Receta corregida preservada** (banner +
  fecha de corrección + "Corrección vN"). `index.css`: fuente sans +
  `print-color-adjust: exact` (scoped a `.print-receta`).
- **Sin** DB/backend/lógica clínica/firma/correcciones/versionado.

### PR #269 — Fix: campos de receta se borraban al editar
- **Frontend-only.** `src/pages/panel/consulta/PrescriptionsSection.tsx`.
- Corrige el **race de re-sync**: `flush()` (onBlur) bajaba `dirty=false` y el
  `useEffect` re-sembraba el `form` desde un `p` todavía viejo (refetch async) →
  **dosis/frecuencia/duración/unidad/indicaciones/alternativas se borraban** al
  cambiar de campo.
- Fix: el estado local se **siembra solo cuando cambia realmente `p.id`** (vía
  `useRef`); ya no se rehidrata desde props tras cada guardado.
- **No tocó** receta impresa, DB, backend, firma, correcciones ni versionado.

### PR #270 — Manejo de error de sesión/cuenta ("No pudimos cargar tu cuenta")
- **Frontend-only.** `src/services/auth.service.ts` + `src/pages/panel/PanelLayout.tsx`.
- **Diferencia sesión no recuperable vs problema temporal de conexión:**
  `loadPanelUser()` clasifica el fallo de `getSession()` (`isAuthError` →
  `SessionExpiredError`; red/timeout → recuperable).
- **Sesión vencida** → *"Tu sesión venció / Por seguridad, necesitás ingresar
  nuevamente"* + **"Ingresar nuevamente"** (limpieza dura + redirect), **sin
  loop de Reintentar**. **Conexión temporal** → copy de conexión + **Reintentar**.
- **Salida robusta** (`hardLocalSignOut`: `signOut({scope:'local'})` best-effort +
  borrar `sb-*` + `lc_last_activity`) que **no depende de que `signOut()`
  resuelva** (rompe el loop; patrón de `useIdleLogout`).
- **No tocó** DB/`auth.users`/config de Supabase/roles/lógica clínica/SEO/
  Analytics/Search Console.
- **Nota:** en supabase-js 2.57.4 los casos de sesión inválida/corrupta **ya
  redirigen limpio a home** (no llegan a la pantalla de error); el loop del owner
  era el path **red/timeout**. El path exacto de throw/timeout **no es forzable
  desde el browser** (supabase-js usa su propia referencia de `fetch`); las
  pantallas de error quedaron verificadas por código+build y el escape robusto
  validado en vivo.

---

## 3. Pendientes vivos (separados, SIN acción automática)

1. **Auditoría read-only de integridad de formularios clínicos** (patrón form
   local + dirty + flush + refetch en otros formularios de la consulta).
2. **`duration_value` vacío → persistir como `null`** (hoy queda `undefined` y no
   se limpia; requiere tocar el service de prescriptions).
3. **Race extremo de flushes concurrentes** a velocidad no-humana (~60 ms) →
   posible **optimistic update / serialización** de mutaciones.
4. **Prueba de login real de `operations_admin`** — el acceso ya está **activo en
   DB** para la persona (`lucyadmin_access`, `access_level='operations_admin'`).
   Falta que la persona ingrese con su OTP; si el SMS no llega vía Twilio → plan B:
   configurar el número como **Test Phone / OTP fijo** en Supabase Auth.
5. **Search Console / request indexing** (tras los PRs de SEO Brand; owner-only,
   manual).
6. **`Physician` JSON-LD + OG branded 1200×630** (Slugs PR D).
7. **`/calificar/*` `noindex`** (follow-up menor).
8. **Auditoría/revisión de sesión/Auth** si vuelve a aparecer la pantalla de
   "cuenta no cargada" (para capturar el error real y afinar la clasificación).

---

## 4. Reglas operativas vigentes (vinculantes)

- **Un solo frente a la vez.**
- **No abrir PR sin autorización** del owner; **no mergear sin su OK explícito**.
- **No tocar DB/SQL/migraciones/`auth.users`** sin autorización; el owner aplica
  el SQL y el dev corre los checks.
- **Datos de validación:** **jamás Katherine (`50372608827`)** ni datos reales
  sensibles (ni en read-only). Usar **fixtures controladas** o el paciente demo
  (**Pepe Toro**); **Camilo (`50378627694`/OTP `123456`)** solo como demo seguro
  cuando sea estrictamente necesario. Toda fixture debe limpiarse con **0
  residuales**.
- **No mezclar** SEO/Analytics/Auth/Clínico/DB en un mismo PR (frentes separados).
- **PR que toca DB → migración + check/smoke.**
- **Para cambios de UI:** pedir **preview / OK visual** del owner antes de mergear.
- **Cierre estándar tras cada merge:** HEAD, PRs, migraciones, `main==origin/main`,
  `git status` vacío, rama borrada local+remoto, 0 PRs abiertos, sin residuos
  (preview/servers/fixtures/scripts/ZIPs).
- Ramas cortas `claude/<8-12 chars>`, **squash-merge** + borrar rama.

---

## 5. Prompt para arrancar la nueva ventana del dev

```text
Continuamos LucyCare en nueva ventana.

Primero confirmá estado:

git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -10
git status --short
gh pr list --state open

Leé en este orden:

1. CLAUDE.md
2. docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-07-13.md
3. docs/HANDOFF_TOMA_DECISIONES_2.md
4. cualquier handoff vigente que CLAUDE.md indique

Estado esperado:
- HEAD: 9bab47b
- PRs mergeados hasta #270
- migraciones hasta s7_57
- main == origin/main
- árbol limpio
- 0 PRs abiertos
- sin frente abierto

No codifiques todavía.

Primero confirmá estado y quedá a la espera de la próxima instrucción del owner.
```
