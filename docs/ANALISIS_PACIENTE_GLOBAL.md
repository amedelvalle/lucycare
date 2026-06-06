# Análisis — Modelo de paciente global

> Diagnóstico + propuesta de evolución del modelo de paciente.
> Snapshot 2026-05-25 (análisis original).
>
> **Estado de implementación (2026-06-04):**
> - **Fase 1 ✅ live** (PR #44, `s7_20`): vinculación retroactiva por phone
>   OTP (`claim_patient_records`) + vista "Mis atenciones".
> - **Fase 2 ✅ live** (PR #87/`s7_32` backend + PR #88 UI): identidad global
>   en `profiles` (DUI/DOB/género/dpto/muni, **DUI progresivo** = nullable),
>   **UNIQUE parcial** `(document_type, document_number)`, **UPDATE
>   column-restricted** (paciente no toca `role`/`is_active`/`phone`),
>   coherencia muni-depto (P0004), audit (`edited_via='profile_identity'`),
>   anon nunca ve DUI/DOB. UI `/paciente/perfil` (teléfono read-only) + banner
>   no bloqueante + prefill con "Usar" por campo (sin guardado automático;
>   conflicto sin auto-elegir) + DUI duplicado con mensaje amable.
>   Diagnóstico read-only previo: 0 duplicados de DUI en `patients`.
> - **Fase 3 ✅ live** (PR #90/`s7_33` backend + PR #91 UI): **Opción B (sync
>   espejo)**. `profiles` canónico; `patients` espejo sincronizado. Guard
>   server-side (P0030) bloquea editar identidad local si `profile_id` set;
>   claim copia global→local (global gana, local-only se conserva); sync ongoing
>   propaga cambios del perfil a fichas vinculadas (sin anular NOT NULL, bypass
>   GUC); UI médico read-only + badge; walk-in sin cambios. `phone` fuera del
>   sync. Smoke OTP 6/6.
> - **Cambio de teléfono por OTP ✅ live** (PR #93/`s7_34` backend + #94 UI
>   paciente + #95 UI médico): trigger `AFTER UPDATE OF phone ON auth.users`
>   sincroniza `profiles.phone` + `patients.phone` vinculados (bypass del guard)
>   + audit; `ChangePhoneModal` reusable. Sesión activa + OTP solo al nuevo;
>   recuperación sin sesión → soporte/LucyAdmin.
> - **Fase 5 ✅ live** (PR #98 diseño + PR #99/`s7_35` backend + PR #100 UI): dedup
>   **preventivo** en creación de paciente/walk-in. RPC `find_patient_match_candidates`
>   (`SECURITY DEFINER`): intra-clínica con detalle, cross-clínica/global solo
>   señal mínima (`weak`/`strong`, **sin PII**), gate `is_clinic_member`/`is_admin`,
>   **advisory** (no bloquea). UI `PatientMatchHints` + `DuplicateDocumentError`.
>   Teléfono normalizado con `normalizePhoneSV` (lookup y submit alineados).
>   **Solo previene/advierte — no fusiona ni sincroniza** (eso es F4).
> - **Fase 4 ⏳ en cola.**
> - **Decisiones DA1-DA4 firmadas** (§ "Decisiones cerradas" abajo) se respetan.

## TL;DR

Hoy LucyCare modela al paciente como **tenant-aware**: cada clínica
tiene su propia row en `patients` con datos personales duplicados. Un
mismo humano puede tener 5+ rows distintas si fue a 5 clínicas. Esto
choca con el modelo "Uber/Airbnb" que querés: una identidad de
paciente, múltiples relaciones con médicos.

La evolución sugerida es en **5 fases incrementales** que no rompen
nada. La Fase 1 (vincular automáticamente rows existentes al
`profile_id` del paciente logueado) es de bajo riesgo y desbloquea la
vista "Mis atenciones" que necesitás. Las fases 3-5 reestructuran el
schema y son más invasivas — quedan para post-piloto.

**Recomendación de orden:** primero **PR-B waitlist** (corto, aislado,
cierra flujo informativo). Luego arrancar Fase 1 del paciente global.
No hay dependencia técnica entre ambos.

## Diagnóstico del modelo actual

### Tabla `patients`

22 rows en producción. Columnas:

| Categoría | Columnas |
|---|---|
| **Identidad personal** | `full_name`, `document_type`, `document_number`, `date_of_birth`, `gender`, `phone`, `email` |
| **Relación clínica** | `clinic_id` (NOT NULL), `patient_type` (privado/seguro), `is_active` |
| **Datos clínicos personales** | `blood_type`, `allergies`, `emergency_contact_*` |
| **Vinculación** | `profile_id` (nullable; seteado solo si el paciente se logueó con OTP) |
| **Misc** | `photo_url`, `notes`, `created_at`, `updated_at` |

### Estado observado en DB

```
total patients        : 22
con profile_id        :  5   ← se logueó con OTP y se vinculó
sin profile_id        : 17   ← walk-ins creados por el médico
profiles con role=patient : 10   ← se autenticaron pero no todos tienen patient row
mismo phone en >1 clínica : sí — phone 50378627694 está en 5 clínicas
```

**El mismo humano ya está duplicado.** Es síntoma del modelo: cada
visita a una clínica distinta crea una row nueva en `patients`.

### Flujos de creación actuales

#### Booking público (`booking.service.ts:150`)

`getOrCreatePatient(profileId, clinicId, ...)`:
1. Busca `patients` con `(profile_id, clinic_id)`.
2. Si no existe, **crea row nueva** con `clinic_id` de esa reserva.

Resultado: el paciente con phone X que reserva en clínica A y después
en clínica B termina con **2 rows separadas** en `patients`. Las
citas/consultas de cada clínica viven contra su row local.

#### Walk-in / panel del médico (`patients.service.ts:257`)

`createBasicPatient(clinicId, name, phone)`:
1. Normaliza phone con `normalizePhoneSV`.
2. Busca duplicado por `(clinic_id, phone)` → si existe, lanza
   `DuplicatePhoneError` (UI ofrece reusar).
3. Si no existe, crea row.

**Dedup solo dentro de la misma clínica**, no cross-clinic.

### Schema relacional actual

```
patients (id, clinic_id, profile_id?, full_name, phone, document, ...)
    ↑
    ├── appointments.patient_id  (citas de la clínica)
    ├── consultations.patient_id (consultas firmadas)
    ├── prescriptions.patient_id (recetas)
    └── vitals (vía appointment_id)
```

Todas las tablas clínicas apuntan a `patients.id`. Esto **es correcto**
desde el punto de vista de aislamiento clínico (el médico solo ve la
historia que él mismo construyó), pero **rompe la identidad global**
del paciente.

### RLS actual (inferida)

- `patients` SELECT: limitado a doctores/asistentes de la `clinic_id`.
- `patients` INSERT/UPDATE: idem.
- Admin de plataforma NO ve patients (regla "admin no toca clínica",
  verificada en el Security Gate).
- El propio paciente **no tiene SELECT directo a `patients`** —
  depende del role. Hoy el paciente solo ve sus **citas** (vía
  `appointments` con `patient_id IN (...)`), no su row en patients.

## Problemas que esto causa

| # | Problema | Síntoma observable |
|---|---|---|
| 1 | Identidad fragmentada | Mismo phone en 5 rows de patients (caso real) |
| 2 | Sin vista "Mis atenciones" para el paciente | El paciente logueado no ve su historial cross-clinic |
| 3 | Datos personales duplicados/inconsistentes | DUI puesto en clínica A puede faltar en clínica B |
| 4 | Detección de duplicados débil | `createBasicPatient` solo dedup dentro de clinic |
| 5 | El paciente no puede actualizar sus datos personales | Solo el médico edita `patients`. El paciente vía OTP no toca esa tabla |
| 6 | Sin auditoría central de cambios personales | Cada clínica modifica su copia; el cambio no se propaga |
| 7 | Modelo no escala a "Uber/Airbnb" | Cada reserva en una clínica nueva crea fragmento |

## Modelo propuesto

### Conceptualización

Tres capas separadas:

#### Capa 1 — Identidad global del paciente

Vive en `profiles` (extendida si hace falta), o en una tabla nueva
`patient_global`. Datos:

- `full_name` (canónico).
- `phone_normalized` (canónico, E.164 sin +).
- `email`.
- `document_type` + `document_number_normalized`.
- `date_of_birth`.
- `gender`.
- `department_id`, `municipality_id` (ubicación del paciente).
- `is_active`.
- Owner: el propio paciente cuando se loguea + admin para
  resolución de duplicados.

**No incluye:** allergies, blood_type, notes, photo, emergency_contact.
Esos son específicos del contexto clínico-médico → quedan en capa 2.

#### Capa 2 — Relación clínica-paciente (lo que hoy se llama `patients`)

Renombrar conceptualmente: pasa a ser la **ficha del paciente en una
clínica específica**. Datos:

- `id`.
- `patient_global_id` (FK a la capa 1, NOT NULL una vez resuelta la
  identidad).
- `clinic_id`.
- `doctor_id` (opcional — la clínica puede tener varios médicos).
- Datos clínico-personales **de esta relación**: `blood_type`,
  `allergies`, `emergency_contact_*`, `notes` (notas del médico sobre
  el paciente), `patient_type` (privado/seguro), `photo_url` (foto
  tomada por el médico en consulta).
- `enrolled_at`, `last_visit_at`.
- `is_active`.

Owner: doctor/asistente de la clínica + admin para fusión.

#### Capa 3 — Historia clínica

Sin cambios estructurales. `appointments`, `consultations`,
`prescriptions`, `vitals` siguen apuntando a `patients.id` (capa 2).
La diferencia es que **ahora hay un patient_global_id detrás** que
permite agrupar.

### Beneficios

| Capa | Beneficio |
|---|---|
| 1 | Identidad única. Paciente actualiza sus datos una vez, vale para todas las clínicas |
| 1 | Detección preventiva de duplicados cross-clinic (search por phone normalizado) |
| 2 | Cada médico mantiene su propia ficha sin perder aislamiento clínico |
| 2 | RLS por clínica intacta. Médico A no ve la ficha que tiene la clínica B del mismo paciente |
| 3 | Sin migración de datos clínicos pesados |
| Cross | Vista "Mis atenciones" del paciente: query simple `WHERE patient_global_id = (mi_id)` con join a appointments |
| Cross | Admin puede fusionar duplicados sin tocar historia clínica |

## Impacto en base de datos

### Opción A — Reusar `profiles` extendido (más simple, menos invasivo)

Agregar columnas a `profiles` que hoy no tiene:
- `document_type`, `document_number_normalized`.
- `date_of_birth`.
- `gender`.
- `department_id`, `municipality_id`.

Identidad global queda en `profiles`. `patients` cambia su semántica
a "ficha clínica por clínica" pero mantiene su estructura. La
columna `patients.profile_id` pasa a ser **NOT NULL** (eventualmente).

**Pros:** mínima migración SQL. Reusa lo existente.
**Contras:** mezcla en `profiles` campos de paciente con campos de
médico/admin/asistente. Schema menos limpio.

### Opción B — Tabla nueva `patient_global` (más limpia)

Crear `patient_global` con todas las columnas de capa 1.
`patients.patient_global_id` reemplaza eventualmente a `patients.profile_id`.

**Pros:** schema limpio. Separación clara de roles.
**Contras:** más migración. Doble identidad (`profiles` para auth,
`patient_global` para datos canónicos del paciente).

### Recomendación

**Opción A**, por estas razones:

1. La estructura de `profiles` ya es la identidad de auth — natural
   que también lleve los datos personales asociados.
2. Para LucyCare en piloto y crecimiento mediano, la complejidad de
   B no se justifica.
3. El paciente walk-in sin `profile_id` (17 de 22 hoy) puede vivir
   en `patients` con `profile_id=null` hasta que reclame su identidad
   por OTP — momento en que se crea profile y se vincula.
4. Si crecemos mucho, migrar de A → B es factible (mover columnas
   de profiles a una tabla nueva). De B → A sería más doloroso.

## Impacto en permisos / RLS

### Identidad global (`profiles` extendido)

| Acción | Quién | Cómo |
|---|---|---|
| SELECT propio | Paciente logueado | `auth.uid() = id` (ya existe) |
| UPDATE propio (datos básicos) | Paciente logueado | `auth.uid() = id` (ya existe) |
| SELECT por médico de su ficha | Doctor/asistente de la clínica donde tiene `patients` | Nueva policy: doctor ve `profiles` de profile_ids en sus patients |
| UPDATE por médico | **NO permitido directamente** | El médico edita `patients` (capa 2), no profiles |
| Resolver duplicado | Admin | `is_admin()` ya existe |

**Regla clave:** una vez que el paciente confirma su identidad
(profile vinculado), el médico **no puede modificar** `profiles.full_name`,
phone, etc. del paciente. Solo puede editar `patients` (datos
clínico-personales). Esto cierra el problema #5 del diagnóstico.

Mientras el patient no tenga profile vinculado (walk-in puro), el
médico SÍ puede editar `patients.full_name` directamente. Lo que se
edita no son datos canónicos todavía.

### Ficha clínica (`patients`)

Sin cambios mayores en RLS. Lo que ya existe sigue:
- Doctor/asistente de la clínica edita su ficha.
- Admin no ve contenido clínico.
- Paciente lee su ficha por SELECT vinculado a `profile_id`.

## Impacto en UI / UX

### Para el paciente

| Pantalla | Hoy | Propuesto |
|---|---|---|
| Booking público | OTP + crea patient | Igual, pero detecta duplicados cross-clinic |
| Mi perfil (`/paciente/perfil`) | **No existe** | Form para nombre, DUI, DOB, dpto/municipio. Banner "completá tu perfil" |
| Mis atenciones (`/paciente/mis-atenciones`) | **No existe** | Lista paginada cross-clinic: fecha, médico, especialidad, servicio, estado |
| Cambiar datos personales | No puede | Edita `profiles` (con confirmación de DUI) |

### Para el médico

| Pantalla | Hoy | Propuesto |
|---|---|---|
| Crear paciente walk-in | `createBasicPatient` con dedup por clinic | Dedup ampliado: avisa "este phone ya tiene perfil en LucyCare, ¿vincular?" |
| Editar paciente (panel) | Edita todo en `patients` | Si el paciente tiene profile: datos personales en **read-only**, solo edita campos clínicos (allergies, blood_type, notes...) |
| Ver historial del paciente | Solo sus citas | Sin cambios (aislamiento clínico) |

### Para LucyAdmin

| Funcionalidad | Hoy | Propuesto |
|---|---|---|
| Lista de pacientes | **No existe en admin** | Nueva sección `/admin/pacientes` con búsqueda por phone/doc |
| Resolver duplicados | Manual SQL | UI: "este phone tiene 3 patients en distintas clínicas, ¿vincular al mismo profile?" |
| Auditar cambios | Audit_log ya existe | Filtros por tabla=patients/profiles |
| Suspender paciente | No existe | `profiles.is_active=false` propaga |

### Reglas de fricción (de tu requisito 4)

- Booking rápido: **solo nombre + phone**. DUI/DOB/dpto/muni
  **opcionales en el booking inicial**. ✅ ya es así hoy.
- "Perfil incompleto" se muestra cuando falten: DUI, DOB, dpto, muni.
  Banner con CTA "Completar perfil" en `/paciente/perfil`.
- Paciente puede ignorar el banner y seguir reservando (no bloqueante).
- En consulta clínica, si el médico necesita DUI o DOB para la receta y
  faltan, se piden ahí (no en cada booking).

## Plan por fases

### Fase 0 — Documentación (este doc) ✅

### Fase 1 — Vinculación retroactiva + vista "Mis atenciones" ✅ LIVE (PR #44, `s7_20`)

Objetivo: empezar a unificar la identidad sin tocar schema.

**Backend:**
- RPC `claim_patient_records(p_phone_normalized)` SECURITY DEFINER:
  - Solo callable por usuario autenticado.
  - Busca todas las `patients` con `phone = p_phone_normalized` AND `profile_id IS NULL`.
  - Si `auth.users.phone` del caller matchea: setea `patients.profile_id = auth.uid()` en todas. Audit log.
  - Idempotente.
- Llamarla automáticamente desde `ensureProfile` en `auth.service.ts`
  apenas el paciente verifica OTP — así se vinculan sus rows
  preexistentes (los 17 walk-ins sin profile_id).

**Frontend:**
- Página `/paciente/mis-atenciones` (paginada, 20 por página).
- Query: `appointments WHERE patient_id IN (SELECT id FROM patients WHERE profile_id = auth.uid())`.
- Muestra: fecha, médico, clínica, especialidad, servicio, estado.

**Riesgo:** bajo. No cambia schema. RLS de `patients` ya permite al
paciente ver sus rows (vía profile_id).

**Tamaño:** 1 PR mediano (1 RPC + 1 página + 1 link en header).

### Fase 2 — Perfil del paciente con datos extendidos ✅ LIVE (PR #87/`s7_32` + PR #88)

> Implementada con ajustes sobre la propuesta original: `document_type` como
> `text`+CHECK (no enum), `gender` reusa el enum `gender_type`, depto/muni son
> `text` (catálogos del Home), **UNIQUE parcial** de documento, **UPDATE
> column-restricted** (cierra escalada de `role`/`is_active`/`phone`), prefill
> con "Usar" por campo. Detalle en CLAUDE.md (§ Paciente Global) y
> `HANDOFF_TOMA_DECISIONES_2.md`.

Objetivo: el paciente puede ver y editar sus datos personales.

**Backend:**
- Migración: agregar `profiles.date_of_birth`, `profiles.gender`,
  `profiles.document_type`, `profiles.document_number_normalized`,
  `profiles.department_id`, `profiles.municipality_id`.
- Trigger de audit (ya existe `audit_profiles_avatar`, ampliarlo o
  agregar uno para los nuevos campos).
- RLS: paciente UPDATE su propio profile en esos campos.

**Frontend:**
- Página `/paciente/perfil` con form editable.
- Banner "Completá tu perfil" si falta DUI/DOB/dpto/muni. CTA al form.

**Riesgo:** medio. Cambia schema (agregar columnas, no remover).
Compatible con código actual.

**Tamaño:** 1 PR mediano.

### Fase 3 — Read-only para médico sobre datos personales del paciente vinculado ✅ LIVE (PR #90/`s7_33` + PR #91)

> Implementada como **Opción B (sync espejo)**, decidida por el owner: además
> del read-only en UI, `patients` se mantiene como espejo de `profiles` (sync
> bidireccional en el sentido global→local) + guard server-side (P0030). Detalle
> en CLAUDE.md (§ Paciente Global) y `HANDOFF_TOMA_DECISIONES_2.md`.

Objetivo: cerrar el problema #5 (médico edita datos personales).

**Backend:**
- RLS o trigger: cuando `patients.profile_id IS NOT NULL`, bloquear
  UPDATE de `patients.full_name`, `document_*`, `date_of_birth` por
  doctores/asistentes. Solo admin puede editar (vía RPC) o el propio
  paciente vía `profiles`.
- Migrar la vista del médico para mostrar `profiles.full_name`,
  `profiles.document_*` cuando hay vinculación, en lugar de los campos
  duplicados en `patients`.

**Frontend:**
- En PacientesPage del panel: si patient tiene profile_id, esos campos
  vienen del profile y se ven read-only con tooltip "datos verificados
  por el paciente".

**Riesgo:** medio-alto. Cambia comportamiento UX para los médicos.
Requiere comunicación.

**Tamaño:** 1 PR mediano + comunicación.

### Fase 4 — Herramienta admin para resolución de duplicados

> **Nota de F3 (a considerar acá):** el sync espejo de Fase 3 puede chocar con
> `UNIQUE(clinic_id, document_type, document_number)` de `patients` si existieran
> **fichas duplicadas del mismo perfil en la misma clínica** con documento
> no-null — al sincronizar ambas al mismo documento canónico. Caso raro (el
> dedup de `createBasicPatient`/`getOrCreatePatient` lo previene) y de **falla
> elegante** (error al guardar el perfil del paciente, sin corrupción). El merge/
> dedup admin de esta fase debe resolver esas fichas duplicadas.

Objetivo: el admin puede fusionar 2 `patients` que son la misma
persona (cross-clinic o intra-clinic).

**Backend:**
- RPC `admin_merge_patients(p_source_id, p_target_id)`:
  - Verifica `is_admin()`.
  - Mueve `appointments`, `consultations`, `prescriptions`, `vitals`
    de source a target.
  - Soft-deactivate source (`is_active=false`).
  - Audit log detallado.

**Frontend:**
- En `/admin/pacientes` (nueva sección): ver duplicados sugeridos por
  phone/document, comparar lado a lado, confirmar fusión.

**Riesgo:** alto. Operación destructiva sobre historia clínica.
Audit log + dry-run obligatorios. Solo admin.

**Tamaño:** 1 PR grande (RPC + audit + UI admin).

### Fase 5 — Dedup preventivo en creación ✅ LIVE (#98 diseño + #99/`s7_35` + #100 UI)

> **✅ Implementada.** Diseño PR #98 · backend RPC `find_patient_match_candidates`
> (`s7_35`) PR #99 · UI `PatientMatchHints` PR #100. Smoke `s7_35` 8/8 + OK visual.
> **F5 es prevención, NO merge ni sync** — fusionar duplicados existentes y copiar
> identidad global→local son Fase 4 / diseño posterior. El diseño abajo se mantuvo
> tal cual al implementar.
>
> **Notas de implementación:**
> - El teléfono se normaliza con `normalizePhoneSV` en el servicio **antes** de la
>   RPC (mismo helper que `createBasicPatient`), para que el lookup preventivo y el
>   dedup del INSERT detecten lo mismo (un input local de 8 dígitos `71234567`
>   matchea el canónico `50371234567`). Sin esto el panel decía "Sin coincidencias"
>   aunque el submit sí detectaba el duplicado.
> - `createBasicPatient` suma un chequeo proactivo de **documento** intra-clínica
>   (`DuplicateDocumentError`, banner amable) que anticipa el `UNIQUE` de la DB.
> - **Pendiente no-bloqueante:** hacer la RPC tolerante a teléfono crudo en SQL
>   (defensa en profundidad, futura migración) — hoy el caller normaliza.

**Objetivo:** reducir la creación de duplicados *de entrada*, ayudando al
médico/asistente a darse cuenta de que la persona que está por crear quizá ya
existe — **sin** revelar datos de otras clínicas y **sin** bloquear el flujo
legítimo.

#### Estado actual (lo que YA hay — punto de partida)

- Único choke point de creación: **`createBasicPatient()`**
  (`src/services/patients.service.ts`). Lo usan `NewPatientModal`
  (`/panel/pacientes`) y `CreateWalkInModal` (Nueva cita) vía
  `createWalkInPatient()`.
- Dedup actual = **solo teléfono, solo intra-clínica, solo activos**
  (`clinic_id = X AND phone = Y AND is_active`). Lanza `DuplicatePhoneError`
  (con flag `multiple` si hay >1). No chequea documento proactivamente; el
  `UNIQUE(clinic_id, document_type, document_number)` (NULLS DISTINCT) solo
  actúa como red final en el INSERT.
- Creación **siempre** con `profile_id = NULL`; la vinculación al profile global
  es **retroactiva** vía `claim_patient_records()` (login OTP, phone match).
- Walk-in tiene además búsqueda manual por **nombre** intra-clínica
  (`searchPatients`).

#### Decisiones de privacidad (cerradas)

1. **Cross-clínica = señal mínima.** Para coincidencias **fuera de la clínica
   actual** NO se revela nombre completo, clínica, médico, historial, teléfono
   de otra ficha, ni documento completo (si el médico no lo ingresó él). Solo un
   aviso genérico, p. ej.:
   - match débil (teléfono): *"Existe una posible coincidencia en LucyCare."*
   - match fuerte (documento ingresado por el médico): *"Este documento ya está
     asociado a una identidad en LucyCare."*
2. **Intra-clínica = detalle permitido.** Para coincidencias dentro de la
   clínica actual SÍ se muestra nombre/teléfono y se ofrece reusar la ficha — el
   médico ya tiene permiso (RLS) sobre esos pacientes. (Es el comportamiento
   actual del `DuplicatePhoneError`, que se conserva y se amplía a documento.)

#### Advertir vs bloquear (cerrado)

- **No bloquear** por coincidencia cross-clínica. Razones: familiares comparten
  teléfono; menores usan el teléfono del responsable; nombres parecidos; DUI
  progresivo (muchas fichas sin documento).
- El sistema **advierte pero permite**:
  - **usar ficha existente** si el match es **intra-clínica**;
  - **crear ficha local nueva** si el match es **cross-clínica** (caso legítimo:
    misma persona, primera vez en esta clínica);
  - **continuar como nuevo** si el médico confirma que no es la misma persona
    (falso positivo).
- **Único bloqueo fuerte** = el constraint real de DB cuando aplique
  (p. ej. documento duplicado dentro de la misma clínica → `UNIQUE`).

#### Señales de coincidencia

| Señal | Alcance del match | Confianza | Uso |
|---|---|---|---|
| Teléfono normalizado | intra + cross-clínica | débil (familiares/oficina) | advertencia; intra → reuso |
| Documento (si ingresado) | intra + cross/global (`profiles`) | fuerte | advertencia; intra → red de DB |
| Nombre | solo intra (búsqueda manual ya existente) | baja | ayuda manual; **no** llave dura |
| Fecha de nacimiento | — | — | **fuera de MVP** (a lo sumo desempate futuro) |

> Fuzzy matching de nombres queda **fuera de MVP** (caro y ruidoso). El nombre
> sigue siendo solo señal secundaria / búsqueda manual.

#### Qué se muestra y qué NO

- **Intra-clínica:** banner con nombre del paciente existente + "Usar este
  paciente" / "Ver paciente" (lo de hoy) + ahora también para documento.
- **Cross-clínica/global:** banner **advisory** sin PII —
  *"Existe una posible coincidencia en LucyCare"* (o el mensaje de documento) +
  botón **"Crear ficha para esta clínica"** + "Son personas distintas / continuar".
- **Nunca** se muestra: nombre, clínica, médico, historial, teléfono o documento
  completo de una ficha que vive en otra clínica.

#### Arquitectura (server-side vs UI)

- **Server-side (autoridad):**
  - El check intra-clínica corre con la sesión del médico (RLS permite ver sus
    pacientes). Se **mantiene** y se **amplía** a documento (hoy solo phone).
  - El check **cross-clínica / profile global** DEBE ser **RPC
    `SECURITY DEFINER`** — el médico/asistente **no tiene RLS** para leer
    pacientes de otras clínicas ni `profiles` globales (hardening `s7_16`). La
    RPC devuelve **solo señal mínima** (existe sí/no, tipo de match débil/fuerte),
    sin PII de otra clínica.
  - El `UNIQUE(clinic, doc)` sigue siendo la red final.
- **UI:** muestra candidatos/avisos y opciones. Es ayuda, **no enforcement**: la
  decisión del médico se respeta.

#### Qué queda FUERA de Fase 5 (explícito)

- **Fusión de duplicados** existentes → Fase 4 (`admin_merge_patients`).
- **Copia de identidad global→local** al crear → diferido a F4 / diseño
  posterior. Motivo: copiar identidad global a una ficha local solo por una
  coincidencia expondría datos globales del paciente a una clínica **antes** de
  una vinculación/confirmación adecuada. F5 = prevención, no merge ni sync nuevo.
- **Vinculación automática `profile_id`** al crear → sigue siendo retroactiva por
  OTP (`claim_patient_records`). F5 no la toca.
- **Fuzzy matching de nombre / fecha de nacimiento.**

#### Riesgos de falsos positivos (resumen)

| Caso | Riesgo | Mitigación |
|---|---|---|
| Familiares con mismo teléfono | alto | teléfono nunca bloquea; segundo factor sube confianza |
| Menores / dependientes (tel. del tutor + apellido) | alto | siempre permitir "son personas distintas" |
| Nombres parecidos | medio | no usar nombre como llave dura; sin fuzzy en MVP |
| Pacientes sin DUI (DUI progresivo) | — | el teléfono sigue siendo la llave práctica |

#### Plan de PRs pequeños

| PR | Alcance | Migración | Riesgo |
|---|---|---|---|
| **PR-0** (este) | Este diseño en el análisis. Docs-only. | — | nulo |
| **PR-1 (backend)** | RPC `find_patient_match_candidates(clinic_id, phone, doc_type, doc_number)` `SECURITY DEFINER`: intra-clínica con detalle (lo que el médico ya puede ver) + cross-clínica/global como **señal mínima** sin PII. Endurecer chequeo de **documento** intra-clínica en `createBasicPatient`. `check-s7_NN.mjs` + smoke. **Sin UI.** | `s7_35` | medio (RLS/privacidad) |
| **PR-2 (UI)** | Componente reusable de candidatos integrado en `NewPatientModal` + `CreateWalkInModal` (lookup al teclear phone/doc; panel "¿es esta persona?"; opciones reusar/crear/continuar según intra vs cross). | — | medio (UX) |

**Riesgo global:** medio. Cambia UX de creación; la mitigación principal es
"advertir, no bloquear" + privacidad estricta cross-clínica.

**Orden vs Fase 4:** hacer **F5 antes que F4** — prevenir nuevos duplicados
reduce la pila que la herramienta de merge (F4) tendrá que limpiar.

## Riesgos transversales

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | Romper queries existentes al cambiar schema | Fases incrementales. Cada PR con preview + smoke amplio. |
| 2 | Falsos positivos al vincular por phone | Vinculación retroactiva (Fase 1) solo activada cuando el caller demuestra control del phone (OTP). |
| 3 | Admin fusiona pacientes equivocados | Confirmación + audit log + capacidad de revertir (Fase 4). |
| 4 | Paciente actualiza phone y rompe vinculaciones | Trigger que detecta cambio de phone y propaga a `patients` linkeados, o re-flow de OTP para confirmar el nuevo phone. |
| 5 | Privacidad: paciente ve un nombre/dato que pensó privado | RLS estricta en `profiles` extendido (ya hecha en s7_16). Verificar que las columnas nuevas también respeten policies. |
| 6 | DUI normalizado distinto entre clínicas | Usar `validateDocument` ya existente (ya normaliza). Centralizar en util compartido. |
| 7 | Caso edge: walk-in con phone que después se loguea con otro phone | Vinculación opcional: el paciente puede manualmente vincular su row vieja desde `/paciente/perfil` si la encuentra. |

## Recomendación de orden vs PR-B waitlist

**Hacer primero PR-B (waitlist real).** Razones:

1. **Independencia técnica:** waitlist no toca `patients` ni `profiles`
   en su esencia. Es una tabla nueva aislada (`waitlist_entries`).
2. **Cierre de flujo comercial:** ya mergeamos PR-A del directorio
   informativo. Sin waitlist real, el botón "Lista de espera" en el
   perfil del médico informativo no persiste — los pacientes
   interesados se pierden. Cerrar PR-B captura demanda real durante
   el piloto, que es input valioso para el modelo de paciente global.
3. **Tamaño:** PR-B waitlist es 1 semana. Fase 1 del paciente global
   es 1 semana. Ambos pueden cerrarse antes del piloto público sin
   conflicto.
4. **Aprendizaje:** los waitlist entries que capturemos en el piloto
   son **futuros pacientes globales** — si ya estamos pensando el
   modelo global, podemos hacer `waitlist_entries.profile_id` opcional
   desde el inicio y conectarlos cuando el waiter se logueé.

**Orden propuesto:**

1. PR-B Directorio: waitlist real (1 semana, alta prioridad para piloto).
2. Análisis paciente global → Fase 1: vinculación retroactiva +
   vista "Mis atenciones" (1 semana, antes del piloto si el tiempo lo
   permite, sino post-piloto temprano).
3. Resto de fases del paciente (2-5): post-piloto, según feedback real.

## Próximos pasos sugeridos

Si aprobás este análisis, los próximos PRs serían:

- **PR siguiente (Directorio PR-B):** `waitlist_entries` tabla + RPC +
  WaitlistModal conectado + dedup idempotente + vista admin.
- **PR siguiente (Paciente Global Fase 1):** RPC `claim_patient_records` +
  invocación automática post-OTP + página `/paciente/mis-atenciones`.

Y dejo flagged para más adelante:
- Fase 2 — perfil del paciente con datos extendidos.
- Fase 3 — read-only de datos personales para médico.
- Fase 4 — admin merge.
- Fase 5 — dedup preventivo en creación.

## Decisiones cerradas (DA1-DA4 firmadas por el owner)

### DA1 — Opción A: extender `profiles` ✅ APROBADO

Identidad global vive en `profiles`. Tabla `patients` actual **sigue
existiendo** como ficha del paciente por clínica/médico (ahí viven
citas, consultas, historia clínica). No hay tabla nueva
`patient_global`.

### DA2 — Vinculación automática solo con coincidencias fuertes ✅ APROBADO

Aclaración del owner: **automática solo cuando hay match fuerte**, es
decir, phone verificado por OTP del paciente == phone de las rows
target. Casos ambiguos (phone parcial, name+DOB similar, document
similar) **NO se fusionan automáticamente** — quedan pendientes para
revisión manual desde admin (Fase 4).

Implementación Fase 1 ajustada:
- `claim_patient_records(p_phone_normalized)` SECURITY DEFINER.
- Verifica `auth.users.phone` del caller == `p_phone_normalized` (OTP-verified).
- Solo entonces vincula `patients` con ese phone donde `profile_id IS NULL`.
- Nunca fusiona ni mueve historia clínica entre patients. Solo setea `profile_id`.

### DA3 — Walk-in editable hasta reclamo ✅ APROBADO

Mientras `patients.profile_id IS NULL`, el médico maneja los datos
libremente (no hay identidad canónica todavía). Cuando el paciente
reclama por OTP y se vincula → los datos personales pasan a ser
canónicos en `profiles` y el médico ya no los puede editar libremente
(Fase 3 implementa este lock).

### DA4 — Mostrar clínica en "Mis atenciones" ✅ APROBADO

La pantalla `/paciente/mis-atenciones` muestra: fecha, médico,
**clínica**, especialidad, servicio, estado. Útil para que el
paciente recuerde dónde fue atendido. Paginada.

### Regla operativa derivada (del owner)

> "El médico puede manejar información clínica y operativa de su
> relación con ese paciente, pero datos globales como DUI, fecha de
> nacimiento, teléfono principal, departamento/municipio deberían
> pertenecer al perfil del paciente o a un flujo controlado."

Implicancia concreta para el schema futuro: cuando lleguemos a Fase
2-3, las columnas `document_*`, `date_of_birth`, `gender`, departamento,
municipio se moverán a `profiles`. Mientras tanto siguen en `patients`
sin cambio. Walk-in con identidad reclamada → el médico ve esos
campos read-only.

> "No quiero una migración agresiva ni fusión automática de pacientes
> todavía. Cualquier deduplicación cross-clinic debe ser conservadora
> y auditable."

Fase 4 (merge admin) y Fase 5 (dedup preventivo) se diseñan con
auditoría obligatoria + reversibilidad como requisitos no negociables.

> "No quiero que este tema retrase el piloto, pero sí quiero que el
> modelo quede bien orientado desde ahora para no crear duplicación
> estructural difícil de corregir después."

Por eso:
- **PR-B Directorio (waitlist) primero** — cierra flujo comercial.
- **Fase 1 Paciente Global después** — bajo riesgo, prepara el modelo
  sin bloquear nada.
- Fases 2-5 quedan post-piloto, según feedback real de los 5 médicos.
