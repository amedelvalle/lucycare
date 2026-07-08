# Análisis — Analytics Farma · Inteligencia de prescripción por médico

> **Estado:** diseño (PR-0 docs-only). **NO habilita implementación.** Base:
> HEAD `69a303f` · PRs #1–#248 · migración `s7_53`. Esquema verificado contra
> `src/types/database.types.ts` + un sondeo agregado read-only contra la DB (ya
> eliminado; sin exponer pacientes). Documento **propio** por sensibilidad y por
> potencial crecimiento como módulo separado.
>
> **Capa estratégica interna:** inteligencia de prescripción por médico, en
> **agregados**, **restringida a LucyAdmin**, **no divulgable**, **sin paciente,
> sin receta individual, sin texto clínico**.

---

## 1. Objetivo

Saber, de forma **agregada e interna**: qué medicamentos se prescriben · qué
médico los prescribe · en qué volumen · de qué presentación/concentración · si
vienen del **catálogo global (Base Lucy)** o del **catálogo personal del
médico** · si parecen **crónicos/permanentes** · qué especialidades concentran
más prescripción. Valor comercial futuro: botiquín, inventario sugerido, compras
por volumen, equivalencias por principio activo, alianzas con farmacias/
laboratorios, líneas de crónicos, oportunidades por especialidad/médico.

**NO** es ver pacientes ni recetas individuales.

## 2. Hallazgos del PR-0 read-only (contra la DB, piloto)

Sondeo agregado (sin PII): **22 recetas** (**19 `is_current`**), **29
consultas** (15 firmadas / 14 borrador), **1 solo médico prescriptor real**
(Camilo). Catálogo `medications`: **1000 filas** (118 global / 882 personal;
122 activas). Poblамiento de columnas de `prescriptions` (de 22): nombre 22/22 ·
principio activo 20/22 · concentración 18/22 · presentación 20/22 · dosage 20 ·
frequency 20 · duration_value 13 · duration_unit 21 · **instructions (texto
libre) 16** · **alternatives (texto libre) 4**. Fuente de las 19 `is_current`:
**9 Base Lucy global · 10 personal del médico · 0 sin resolver**. → **La capa es
construible hoy**; el volumen es de piloto y madura con más médicos activos.

## 3. Tablas reales

| Tabla | Rol | Columnas relevantes |
|---|---|---|
| **`prescriptions`** | Ítem de receta (1 fila = 1 medicamento en 1 consulta). **No hay tabla de "items" aparte.** | `medication_id` (FK→medications, **NOT NULL**), `consultation_id` (FK→consultations), snapshots `medication_name_snapshot`/`active_ingredient_snapshot`/`concentration_snapshot`/`presentation_snapshot`, `dosage` (text), `frequency` (text), `duration_value` (int), `duration_unit` (enum), `instructions` (**texto libre**), `alternatives` (**texto libre**), `is_current` (bool), `version`, `replaces_id`. **NO tiene `created_at` ni `patient_id`.** |
| **`medications`** | Catálogo global + personal | `commercial_name`, `active_ingredient` (text), `concentration` (text), `presentation` (**enum** `medication_presentation`), `doctor_id` (**NULL=global "Base Lucy" / set=personal**), `is_active`, `usage_count`. **Sin categoría terapéutica / ATC.** |
| **`consultations`** | Puente al médico y a la fecha | `id`, `doctor_id`, `clinic_id`, `patient_id` (**PII — nunca proyectar/joinear a `patients`**), `status` (`draft`/`signed`), `signed_at`. |
| **`doctors` / `specialties`** | Dimensiones | `doctors.specialty_id`, `specialties.name`. |

**No existe:** tabla de items separada, categoría terapéutica, ni codificación
normalizada (ATC/RxNorm); `active_ingredient` es texto libre.

## 4. Flujo del dato (receta → medicamento → médico)

`consultations` (una consulta, de un `doctor_id`, sobre un `patient_id`) → **N**
`prescriptions` (cada una `medication_id` → `medications`). Al **INSERT** de la
receta, un trigger (`s7_37`) copia del catálogo los **snapshots** de nombre/
principio activo/concentración/presentación → el histórico queda **inmune a
ediciones del catálogo**. Las correcciones post-firma crean una v2
(`is_current=true`) y dejan la anterior `is_current=false`.

**Agrupar por médico:** `prescriptions` → `consultations.doctor_id` (leyendo
**solo** `doctor_id`/`status`/`signed_at`, **nunca** `patient_id`) →
`doctors.specialty_id`. **La fecha para tendencias sale de
`consultations.signed_at`** (prescriptions no tiene timestamp propio).

## 5. Datos estructurados

- **Presentación** — ENUM `medication_presentation` (tableta/capsula/jarabe/…).
  El dato **mejor estructurado**; snapshot en `presentation_snapshot`.
- **Duración** — `duration_value` (int) + `duration_unit` (enum, incluye
  **`permanente`** → señal de crónico).
- **Fuente catálogo** — `medications.doctor_id` (NULL=global / set=personal).
- **Médico/especialidad** — `consultations.doctor_id` → `doctors.specialty_id`.
- **Periodo** — `consultations.signed_at`.
- Nombre del medicamento — `medication_name_snapshot` (texto, pero snapshot
  estable; 100% poblado).

## 6. Datos como texto libre (con cautela / a excluir)

- `active_ingredient(_snapshot)` — texto libre → agrupable **con normalización**.
- `concentration(_snapshot)` — texto semi-estructurado ("500mg") → normalización.
- `dosage`, `frequency` — texto semi-libre → **no exhibir crudo**.
- `instructions`, `alternatives` — **texto libre clínico → EXCLUIR** de todo
  output.

## 7. Métricas V1 viables (hoy)

Base de cálculo **vinculante**: `prescriptions.is_current = true` +
`consultations.status = 'signed'`; fecha = `consultations.signed_at`; médico =
`consultations.doctor_id`; medicamento = **snapshots** de `prescriptions`;
catálogo global/personal = `medications.doctor_id`. **Sin borradores, sin
versiones corregidas duplicadas, sin depender del catálogo actual.** Conteos:
`count(*)` (veces prescrito) y `count(DISTINCT consultation_id)` (recetas donde
aparece).

1. Top medicamentos prescritos (nombre snapshot).
2. Top medicamentos **por médico**.
3. Top **presentaciones** (enum — el más limpio).
4. Medicamentos por **especialidad**.
5. **Catálogo global vs personal** (fuente).
6. **Crónicos/permanentes** (`duration_unit = 'permanente'`).
7. **Tendencia por periodo** (vía `signed_at`).
8. Ranking de médicos por volumen (limitado por N=1 hoy).
9. Oportunidades de inventario/botiquín — **derivada** (top medicamento +
   frecuencia); interpretación comercial, no una métrica DB directa.

## 8. Métricas que requieren normalización (V2+)

- Ranking robusto de **principio activo** (texto libre → canónico).
- **Equivalencias por principio activo** (idealmente ATC/RxNorm).
- **Categoría terapéutica** — **no existe columna** → requiere nueva taxonomía.
- Normalización de **concentración/dosis/frecuencia**.
- Duración plena (hoy `duration_value` poblado ~59%).

## 9. Datos prohibidos (nunca exponer ni joinear)

`patient_id`, nombre/teléfono/email/documento/fecha de nacimiento del paciente,
`appointment_id`, **`consultation_id`**, la **receta individual**, diagnóstico,
notas clínicas, signos vitales, antecedentes, `instructions`/`alternatives`
(texto libre), **`dosage`/`frequency` como texto crudo**, y la **relación
paciente ↔ medicamento**.

## 10. Reglas de privacidad (vinculantes)

- **Solo agregados numéricos** + dimensiones seguras (medicamento/principio
  activo/concentración/presentación/médico/especialidad/fuente/periodo).
- **Nunca** leer/proyectar `patient_id` ni joinear a `patients`. El puente
  `prescriptions → consultations` solo aporta `doctor_id`/`status`/`signed_at`.
- **Nunca** exhibir una fila de receta ni texto clínico libre.
- Considerar **umbral de celda mínima** (ocultar desgloses con conteo < k) por
  el bajo volumen actual (riesgo de re-identificación por celda chica; hoy
  además hay **1 solo prescriptor**).

## 11. Riesgos éticos / comerciales

- **Ético/regulatorio:** perfilar prescripción por médico y ligarla a alianzas
  con farmacias/laboratorios roza inducción/conflicto de interés. **No** debe
  usarse para presionar o direccionar prescripción. Interno, agregado, no
  divulgado.
- **Privacidad/salud:** datos de salud; aunque agregados, la relación
  paciente↔medicamento es sensible. Blindar contra re-identificación por celda
  chica. Marco: confidencialidad médica + protección de datos SV.
- **Comercial/consentimiento:** compartir con labs/farmacias el prescribir por
  médico puede vulnerar la confianza/contrato del médico; requeriría política/
  consentimiento explícito (TOS) antes de cualquier uso externo. **Vender o
  divulgar = riesgo reputacional y legal.**

## 12. Acceso (recomendación)

- V1: RPCs `SECURITY DEFINER` + gate **`is_admin()`** (patrón `s7_53`); anon/
  médico/asistente/paciente → `P0001`. **Solo agregados, 0 PII.** REVOKE
  PUBLIC/anon.
- **Futuro:** por la sensibilidad, evaluar un **gate más granular
  (owner/superadmin)** cuando exista — engancha con *Administración de
  LucyAdmins Fase 2* (capacidades granulares). No visible para médicos/
  asistentes/pacientes/público. **No divulgable.**

## 13. Módulo futuro (recomendación)

**Subpantalla/pestaña dedicada** `/admin/analytics/farma`, con **service y RPCs
propios** (`admin_pharma_*`), reusando `AdminOnlyRoute`/`AdminLayout`. Cohesión
con la analítica interna + separación de dominio. **Salvedad:** si a futuro el
acceso debe ser más restringido que el resto de la analítica (owner/superadmin),
promoverlo a **módulo separado** con su propio gate — decisión a tomar al
diseñar PR-A.

## 14. Decisión: NO implementar backend todavía

**No** se abre backend `s7_54`, **no** se crean RPCs, **no** se crea UI, **no**
se mezcla en el `/admin/analytics` actual sin diseño aprobado, **no** se hace
dashboard Farma. Este documento es **solo diseño**. El siguiente frente (con
autorización explícita) sería **PR-A backend** (`s7_54`, RPCs `admin_pharma_*`
agregadas) precedido de su propio Paso 0 read-only si hiciera falta.

---

# PR-A backend LIVE (post-#250 / `s7_54`)

> **HEAD `b07acc3` · PRs #1–#253 · migración `s7_54` APLICADA en Supabase ·
> `main == origin/main`.** Backend de inteligencia de prescripción **live y
> validado** (check verde + smoke 27/27). **UI Farma NO iniciada.**

## FA.1 — Qué quedó implementado (PR #250, backend-only)

Migración **`migrations/s7_54_admin_pharma_analytics.sql`** con **tres RPCs
`SECURITY DEFINER STABLE`** de SOLO LECTURA, gate `is_admin()` (→ **P0001** para
anon/médico/asistente/paciente), `SET search_path = public`, `REVOKE`
PUBLIC/anon + `GRANT EXECUTE` a `authenticated`. **Solo agregados;** no escriben,
no crean tablas, no tocan RLS ni datos. Firmas en `database.types.ts`.

- **`admin_pharma_summary(p_date_from, p_date_to, p_doctor_id?, p_specialty_id?)
  → jsonb`**: total recetas · medicamentos únicos · médicos prescriptores ·
  consultas firmadas con meds · `by_source` global/personal · permanentes
  (`duration_unit='permanente'`).
- **`admin_pharma_medication_ranking(p_date_from, p_date_to, p_doctor_id?,
  p_specialty_id?, p_limit, p_min_count)`**: por medicamento — snapshots
  nombre/PA/concentración/presentación + `is_global` + `times_prescribed` +
  `consultations_count` + `distinct_doctors`.
- **`admin_pharma_doctor_ranking(p_date_from, p_date_to, p_specialty_id?,
  p_limit, p_min_count)`**: por médico — nombre público/especialidad + total /
  únicos / global / personal / permanentes.

## FA.2 — Lógica base (vinculante, tal como se implementó)

`prescriptions.is_current = true` + `consultations.status = 'signed'`; fecha =
`consultations.signed_at`; médico = `consultations.doctor_id`; medicamento =
**snapshots** históricos de `prescriptions` (`s7_37`, **no depende del catálogo
actual**); fuente global/personal = `medications.doctor_id` (NULL = Base Lucy).
Sin borradores, sin versiones corregidas (`is_current=false`).

## FA.3 — Umbral de privacidad

Los **dos rankings** aplican `HAVING count(*) >= p_min_count` (**default 3**) →
no listan combinaciones (medicamento / médico) con volumen < 3 (celda mínima).
El **summary NO se umbraliza** (totales generales, no una combinación
específica).

## FA.4 — Privacidad (verificada)

Salida **solo agregados/conteos**: nunca `patient_id`, nombre/teléfono/email/
documento/DOB de paciente, `appointment_id`, `consultation_id`, la **receta
individual**, diagnóstico, notas clínicas, `instructions`, `alternatives`,
`dosage`/`frequency` crudos, ni la **relación paciente↔medicamento**. Solo IDs
técnicos (`medication_id`/`doctor_id`), datos públicos del médico (nombre/
especialidad) y snapshots de catálogo (no PII de paciente).

## FA.5 — Verificación (contra la DB aplicada)

- **`node scripts/check-s7_54.mjs`** ✅ — las 3 RPCs existen y rechazan a
  no-admin (P0001).
- **`node scripts/_smoke-s7_54.mjs`** ✅ **27/27** — conteos generales · ranking
  de medicamentos + umbral (min_count) · ranking por médico · global vs personal
  · `permanente` · exclusión de borradores · exclusión de `is_current=false` ·
  fecha vía `signed_at` · filtros doctor/especialidad · **0 PII** · no-admin
  bloqueado · **cleanup 0 residuales**. Fixtures aisladas (médico fixture propio
  + ventana 2099); jamás Camilo/Katherine/datos reales.

## FA.6 — Pendiente NO iniciado

- **UI Farma** — subpantalla/módulo `/admin/analytics/farma` (bajo
  `AdminOnlyRoute`) read-only que consuma estas 3 RPCs. **No iniciada; no abrir
  sin autorización.** Recordar la salvedad de acceso: hoy `is_admin()`; evaluar
  gate más granular (owner/superadmin) a futuro por sensibilidad.
- Normalización de principio activo / equivalencias / categoría terapéutica
  (V2+, requiere mejorar catálogo — no existe categoría terapéutica).
