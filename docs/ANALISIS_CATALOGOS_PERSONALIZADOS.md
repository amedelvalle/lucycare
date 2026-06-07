# Análisis — Catálogos personalizados por médico (diagnósticos y medicamentos)

> Documento de diseño + plan. **Snapshot 2026-06-06** (actualizado 2026-06-07).
>
> **✅ EJE COMPLETO** (PRs #105–#111 + migración de datos):
> - **PR-0** diseño (#105) · **PR-1** snapshot histórico `s7_37` (#106) · **PR-2**
>   modelo global+personal `s7_38` (#107) · **PR-3** UI consulta (#108) · **PR-4**
>   UI admin `/panel/catalogos` (#109) · **PR-5a** infra `s7_39` + dry-run
>   (#110/#111) · **PR-5b** migración de base replicada **aplicada**.
> - **Resultados finales:** Base Lucy = **127 diagnósticos / 736 medicamentos**
>   globales; "Míos" = solo personalizaciones reales (4 dx + 4 med en Camilo);
>   **1650 dx + 9568 med** copias replicadas inactivadas (sin hard-delete);
>   `catalog_migration_map` = **11218 filas**; **FK no reapuntados** (snapshot
>   `s7_37` protege históricos); globales de prueba "(base Lucy)" inactivados.
> - **Pendiente futuro (frente aparte, fuera de este eje):** UI de **LucyAdmin
>   para administrar la Base Lucy global** (crear/editar/inactivar globales +
>   audit + anti-duplicados). Regla: médicos usan/ocultan/clonan, **no editan la
>   base**; globales solo `is_admin` a nivel backend/RLS.
>
> Acompaña a:
> - `docs/HANDOFF_LUCYCARE_SPRINT7.md` — ejes del médico, deudas.
> - `docs/ANALISIS_MI_EQUIPO_INVITADOS.md` — gate clínico del asistente (s7_26).
> - Inmutabilidad de consulta firmada (`s7_28..s7_31`) — el snapshot histórico
>   (§4) es lo que la hace robusta frente a ediciones del catálogo.

---

## 1. Objetivo

Que exista un **catálogo base/global de Lucy** (curado por LucyAdmin) y que cada
médico pueda **crear o adaptar** sus propios diagnósticos/medicamentos **sin
afectar a otros médicos** ni alterar **históricos clínicos** ya emitidos.

---

## 2. Estado actual (qué YA existe)

| Pieza | Detalle |
|---|---|
| Tabla `diagnoses` | **per-médico** (`doctor_id`), `name`, `description`, `is_active`, `usage_count`. Schema base (Sprint 1-2); índices `s5_05`; seed `s5_03`. |
| Tabla `medications` | **per-médico** (`doctor_id`), `commercial_name`, `active_ingredient`, `concentration`, `presentation`, `is_active`, `usage_count`. Seed `s5_04`. |
| Creación inline | `createDiagnosis`/`createMedication` durante la consulta; dedup por nombre exacto case-insensitive (devuelve el existente). |
| Admin | `/panel/catalogos` (`listAll` + `update` + activar/inactivar) — cada médico gestiona el suyo. |
| Uso clínico | `consultation_diagnoses.diagnosis_id` (FK) y `prescriptions.medication_id` (FK). Correcciones vía amend RPC (`s7_29/30/31`). |
| Lectura/impresión | **El nombre se resuelve por JOIN** a `medications`/`diagnoses` en tiempo de lectura. |

**Hechos clave:**
- **No hay catálogo global compartido.** El "base" se sembró **replicado por
  médico** (cross-join `doctors × lista` en `s5_03`/`s5_04`) → ~1651 diagnósticos
  y ~9568 medicamentos = N médicos × M ítems.
- Todo es `doctor_id`-scoped → **un médico no ve ni afecta lo de otro** (el
  aislamiento ya está cumplido).
- El **asistente no participa** (la creación ocurre en el flujo clínico, bloqueado
  por el gate `s7_26`).

---

## 3. Decisiones cerradas (owner, 2026-06-06)

### 3.1 Grandes

1. **Integridad histórica = SNAPSHOT de texto (no solo bloquear rename).**
   - Al usar un diagnóstico/medicamento en consulta/receta, se guarda **también
     el texto** necesario como snapshot (nombre comercial / nombre del dx + datos
     que se imprimen).
   - Históricos (consultas firmadas, recetas impresas) se muestran/imprimen
     **desde el snapshot**, no dependen del nombre actual del catálogo.
   - El **FK al catálogo se mantiene** (trazabilidad, búsqueda, usage_count) pero
     **no es la única fuente visual histórica**.
   - **Backfill** de datos existentes.
   - **Nunca hard-delete**; solo soft-delete/inactivar.
2. **Alcance del catálogo personal = POR MÉDICO** (no por clínica).
   - Global/base curado por LucyAdmin.
   - Personal propio de cada médico.
   - **Lista efectiva del médico = globales Lucy + propios − globales ocultos por
     ese médico.**

### 3.2 Menores

| # | Decisión |
|---|---|
| 1 | **Asistente no crea** diagnósticos ni medicamentos (contenido clínico; solo el médico dueño). |
| 2 | Ítem creado **durante la consulta** → va al **catálogo personal** del médico; **nunca** al global. |
| 3 | Ítems **globales** = **read-only** para médicos; para adaptarlo se **clona** al personal. |
| 4 | **Ocultar globales**: un médico puede ocultar un global que no usa; solo afecta su vista. |
| 5 | Ítems **propios**: editables por el dueño; **soft-delete/inactivar**, no borrar duro. |
| 6 | **Dedup** case-insensitive; evitar duplicar contra propios y, cuando aplique, contra globales visibles. |

---

## 4. Modelo propuesto

### 4.1 Identidad del ítem (global vs personal)

Dos opciones de forma (a definir en PR-2, no bloquea este doc):
- **(A)** `doctor_id NULL` ⇒ global; `doctor_id` seteado ⇒ personal. Mínimo cambio
  de schema; el filtro pasa de `= doctorId` a `(doctor_id = doctorId OR doctor_id
  IS NULL)`.
- **(B)** columna `is_global boolean` + `doctor_id` nullable, equivalente pero más
  explícita.

Recomendación: **(A)** por simplicidad, con índice parcial para globales.

### 4.2 Ocultar globales (override por médico)

Tabla nueva `doctor_catalog_hidden`:
```
doctor_catalog_hidden(
  doctor_id   uuid,
  item_type   text check (item_type in ('diagnosis','medication')),
  item_id     uuid,        -- referencia al ítem GLOBAL
  hidden_at   timestamptz default now(),
  UNIQUE(doctor_id, item_type, item_id)
)
```
La lista efectiva resta estos ítems de los globales para ese médico.

### 4.3 Clonar global → personal (copy-on-write)

"Adaptar" un global = **insertar una copia** en el catálogo personal del médico
(con los campos editados) + opcionalmente **ocultar** el global para ese médico.
El global queda intacto para los demás.

### 4.4 Snapshot histórico (la pieza crítica)

**Columnas nuevas de snapshot** (texto), pobladas al **insertar la línea** y
congeladas:
- `prescriptions`: `medication_name_snapshot` (comercial) + lo que se imprime
  (`active_ingredient_snapshot`, `concentration_snapshot`, `presentation_snapshot`)
  — o un único `medication_label_snapshot` compuesto. (Definir granularidad en
  PR-1; preferible separar para impresión.)
- `consultation_diagnoses`: `diagnosis_name_snapshot`.

Reglas:
- **Todas** las rutas de inserción pueblan el snapshot: el guardado/firma normal
  **y** las RPC de corrección (`amend_consultation`, `s7_29/30/31`) — estas son
  `SECURITY DEFINER` y pueden resolver el nombre desde el catálogo al insertar.
- **Lectura/impresión** usa el snapshot cuando existe; si no (datos viejos
  pre-backfill), cae al JOIN. Tras el backfill, el snapshot siempre existe.
- **Backfill**: copiar el nombre actual del catálogo a las filas históricas
  existentes (una sola pasada).
- Coherente con inmutabilidad (`s7_28`): una vez firmada, el snapshot no cambia
  aunque el catálogo sí.

### 4.5 RLS

- **Lectura** de `diagnoses`/`medications`: globales (`doctor_id IS NULL`,
  activos, no ocultos por el médico) **+** propios del médico. Asistente: igual
  lectura para apoyar (sin escritura).
- **Escritura** (insert/update/inactivar): **solo el médico dueño** sobre sus
  **propios** (`doctor_id = auth.uid()`'s doctor). Globales: **solo LucyAdmin**
  (`is_admin()`), nunca el médico.
- `doctor_catalog_hidden`: cada médico gestiona los suyos.

### 4.6 Auditoría

- Agregar triggers de audit a `diagnoses`/`medications` (hoy probablemente sin
  auditar) — quién creó/editó/inactivó, `edited_via`.
- LucyAdmin sobre globales: audit con `edited_via='admin'`.

### 4.7 Dedup

- Mantener dedup case-insensitive en la creación inline.
- Extender: al crear un personal, no duplicar si ya existe como **propio**
  visible o como **global visible** (no oculto) con el mismo nombre
  (+concentración para medicamentos) → ofrecer usar el existente.

---

## 5. Riesgos y cómo se cubren

| Riesgo | Mitigación |
|---|---|
| Editar nombre altera receta/consulta **firmada** (FK resuelto al leer) | **Snapshot histórico** (§4.4) + impresión desde snapshot. |
| Médicos nuevos sin catálogo (el seed fue cross-join de una vez) | El **global** los cubre automáticamente (sin seed por médico). |
| Base duplicada (~9568 meds) cara de mantener; correcciones no propagan | Mover la base a **global** único (PR-5). |
| Hard-delete rompe FK histórico | Prohibido; solo `is_active=false`. |
| Asistente tocando catálogo clínico | RLS: escritura solo médico dueño. |

---

## 6. Fases (orden acordado — riesgo histórico primero) — TODAS ✅

| Fase | Alcance | Estado |
|---|---|---|
| **PR-0** | Decisiones, modelo y fases. Docs. | ✅ #105 |
| **PR-1 — Integridad histórica** | Columnas snapshot en `prescriptions`/`consultation_diagnoses` + triggers `BEFORE INSERT` (guardado/firma **y** amend RPC) + backfill + lectura/impresión usando snapshot. | ✅ #106 (`s7_37`) |
| **PR-2 — Modelo global + personal** | Global (`doctor_id NULL`) + `doctor_catalog_hidden` + RLS (global∪propios / escritura propios; globales solo admin; sin DELETE) + `audit_catalog`. | ✅ #107 (`s7_38`) |
| **PR-3 — UI consulta** | Selector busca en global∪propios (menos ocultos); "crear nuevo" → personal; etiqueta discreta "Base Lucy". | ✅ #108 |
| **PR-4 — UI administración** | `/panel/catalogos` segmento Míos\|Base Lucy: gestionar propios + globales read-only + ocultar/mostrar + clonar global→personal; guard de rol. | ✅ #109 |
| **PR-5a — Infra/dry-run** | `catalog_migration_map` + UNIQUE parcial global + `migrate-catalog-base.mjs` (dry-run/apply, idempotente). | ✅ #110/#111 (`s7_39`) |
| **PR-5b — Migración de datos** | `--apply`: globales canónicos desde seed + inactivar copias exactas + mapping + cleanup de globales de prueba. | ✅ aplicada |

**Resultado de PR-5b (aplicado):** Base Lucy 127 dx / 736 med · "Míos" 4 dx + 4 med
(personalizaciones reales) · 1650 dx + 9568 med inactivadas (sin hard-delete) ·
`catalog_migration_map` 11218 filas · FK no reapuntados (snapshot protege
históricos) · globales de prueba inactivados.

### Pendiente futuro (frente aparte, NO de este eje)
- **UI de LucyAdmin para administrar la Base Lucy global:** crear/editar/
  inactivar/reactivar diagnósticos y medicamentos globales (`doctor_id IS NULL`)
  + auditoría + anti-duplicados. Médicos no editan la base (solo usan/ocultan/
  clonan); el impacto histórico ya está protegido por el snapshot de `s7_37`.

Cada fase: 1 PR chico, migración `s7_NN` + `check-*.mjs`/smoke si aplica,
`tsc --noEmit` + `vite build` OK, enforcement server-side, preview/validación
visual donde haya UI.

---

## 7. Decisiones de implementación a afinar (no bloquean PR-0)

- **PR-1:** granularidad del snapshot de medicamento (campos separados vs label
  compuesto). Preferencia: separados, para impresión fiel.
- **PR-2:** forma de "global" (A `doctor_id NULL` vs B `is_global`). Preferencia: A.
- **PR-5:** heurística para distinguir "base replicada" de "creado por el médico"
  (p. ej. nombres que coinciden con el seed original vs el resto; o marcar el
  seed). A definir con datos reales antes de migrar.

---

## 8. Coordinación con otros docs

- Inmutabilidad de consulta firmada (`s7_28..s7_31`): el snapshot (§4.4) es el
  complemento natural — congela el texto al firmar.
- Gate clínico del asistente (`s7_26`): refuerza la regla "asistente no crea".
- `CLAUDE.md` → pendiente "Catálogos personalizados por médico" apunta a este doc.

---

## 9. Extensión: UI de LucyAdmin para Base Lucy global — ✅ IMPLEMENTADO (PR #114)

> Análisis hecho 2026-06-07. **✅ Implementado en PR #114** (docs-only de
> cierre aparte). UI-only, sin migración. Validado visualmente por el owner
> + `tsc`/`build` OK. Con esto el **eje Catálogos queda 100% cerrado**.
>
> **Lo entregado (PR #114):** página **`/admin/catalogos`** (gate
> `AdminOnlyRoute`) + NavLink **"Catálogos"** (`ri-book-2-line`) en
> `AdminLayout`. Tabs **Diagnósticos** y **Medicamentos** (Antecedentes
> fuera). Por tab: búsqueda · toggle activos/inactivos · crear · editar ·
> inactivar/reactivar. Servicio `src/services/adminCatalog.service.ts`
> (list/create/update directo sobre las tablas con sesión admin; **sin RPCs
> nuevas**). Dedup proactivo case-insensitive que refleja el UNIQUE `s7_39`
> (diagnósticos por `lower(name)`; medicamentos por el combo
> `commercial_name+active_ingredient+concentration+presentation`) + `23505`
> como red final → `DuplicateCatalogError` con mensaje amable (sugiere
> reactivar si el duplicado está inactivo). `usage_count` oculto. **No
> hard-delete** (solo `is_active`). Candado `.is('doctor_id', null)` en los
> `update` → imposible tocar ítems personales de un médico por id. Todo lo
> creado nace **global** (`doctor_id = null`).

### 9.bis Diseño original (referencia histórica)

**Objetivo:** que LucyAdmin pueda crear/editar/inactivar/reactivar ítems
**globales** (`doctor_id IS NULL`) de Base Lucy desde una UI propia.

**El backend YA está listo (sin migración nueva):**
- **RLS `s7_38`:** `diagnoses_insert_admin`/`diagnoses_update_admin` y
  `medications_insert_admin`/`medications_update_admin` (`WITH CHECK (is_admin())`)
  → LucyAdmin ya puede insertar globales (`doctor_id NULL`) y editar/inactivar
  cualquier global por RLS. Médicos/asistentes siguen bloqueados.
- **Auditoría:** `audit_catalog` (s7_38) ya audita INSERT/UPDATE/DELETE
  (ignora cambios solo de `usage_count`); con sesión admin → `user_id` del admin.
- **Anti-duplicados:** UNIQUE parcial `s7_39` sobre globales ya lo impide.
- **Histórico:** snapshot `s7_37` → editar/renombrar/inactivar un global **no**
  cambia recetas/consultas históricas.

**Diseño propuesto (1 PR, UI-only):**
- **Ubicación:** página **`/admin/catalogos`** + NavLink "Catálogos" en
  `AdminLayout` (`NAV`); ruta en `src/router/config.tsx` gateada por
  `AdminOnlyRoute` (rol `admin`). Patrón espejo de `AdminDoctorsPage` + reusa
  piezas de `/panel/catalogos`.
- **Alcance:** tabs **Diagnósticos** y **Medicamentos** (solo Base Lucy);
  **Antecedentes fuera** (no se hicieron globales). Por tab: búsqueda · toggle
  activos/inactivos · crear · editar · inactivar/reactivar.
- **Servicio:** `adminCatalog.service.ts` con list (globales activos+inactivos,
  paginado, search), create (insert `doctor_id NULL`), update, toggle is_active.
  Operan directo sobre las tablas con la **sesión admin** (RLS `is_admin` lo
  permite); **sin RPCs nuevas**.
- **Dedup:** chequeo proactivo case-insensitive + UNIQUE de DB como red final
  (mapear `23505` a mensaje amable).
- **`usage_count`:** ocultar en la UI admin (es cross-médico, no operativo).
- **Borrado:** **no hard-delete** — solo inactivar/reactivar.
- **Seguridad:** `AdminOnlyRoute` + RLS `is_admin` (defensa real); médicos/
  asistentes no editan globales.
- **Validación:** preview + validación visual del owner antes del merge.
- **PR-0 docs separado:** opcional (este §9 ya documenta el diseño).
