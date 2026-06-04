# Análisis — Correcciones post-firma de consultas clínicas

> Documento de análisis + propuesta. **Snapshot 2026-06-03.**
> **Estado (2026-06-04): Opción C IMPLEMENTADA COMPLETA — backend + UI para
> los 5 bloques clínicos** (texto, receta, diagnósticos, antecedentes,
> vitales). PRs #74/#76/#79/#80/#81/#82/#84/#85; migraciones
> `s7_28`/`s7_29`/`s7_30`/`s7_31`. Preguntas §10 cerradas por el owner
> (ver `PLAN_CORRECCIONES_FASE0.md` §0). **Eje cerrado, sin pendientes.**
> Este doc queda como referencia de diseño.
>
> Acompaña a:
> - Deuda técnica **#2** (CLAUDE.md): "Inmutabilidad server-side de
>   consultas firmadas" — este doc es su análisis de fondo.
> - `docs/ANALISIS_MI_EQUIPO_INVITADOS.md` / `s7_26` — gate clínico:
>   solo el médico dueño escribe contenido clínico (asistente no).

## Principio rector

> **Una consulta firmada no debe sobrescribirse silenciosamente.**
> Cualquier cambio posterior debe ser **controlado, trazable, auditado y
> visible** como corrección / adenda / rectificación. No buscamos un
> bloqueo absoluto sin salida (el médico se equivoca y debe poder
> corregir), pero tampoco edición silenciosa.

---

## 1. Estado actual

### 1.1 Cómo se firma hoy

`src/services/consultations.service.ts → signConsultation(consultationId)`:
1. **Guard client-side** de rol: lee `profiles.role` y lanza si `!= 'doctor'`. (Bypasseable — corre en el navegador.)
2. `UPDATE consultations SET status='signed', signed_at=now() WHERE id=… AND status='draft'` (con el cliente normal → RLS).
3. Trigger `sync_appointment_on_sign` (`s6_02`) pasa la cita a `atendida`.

No hay RPC dedicada de firma; es un `UPDATE` directo gobernado por RLS.

### 1.2 Tablas que se tocan en una consulta

| Tabla | Contenido | Clave |
|---|---|---|
| `consultations` | motivo, HPI, examen, análisis, plan, `status`, `signed_at` | `id` |
| `prescriptions` | medicamento, dosis, frecuencia, duración, indicaciones | `consultation_id` |
| `consultation_diagnoses` | diagnósticos | `consultation_id` |
| `consultation_family_history` | antecedentes familiares | `consultation_id` |
| `vitals` | signos vitales | `appointment_id` (no `consultation_id`) |

### 1.3 Qué permite hoy el RLS/backend **después** de firmar

Auditado (pg_policies, 2026-06-01). El gate de rol es `doctor_id = get_user_doctor_id()` (médico dueño). **El punto crítico es que los UPDATE NO chequean `signed_at IS NULL`:**

| Tabla | UPDATE post-firma | DELETE post-firma |
|---|---|---|
| `consultations` | ✅ **permitido** (`doctor_id = get_user_doctor_id()`, sin guard de `signed_at`) | — |
| `prescriptions` | ✅ **permitido** (sin guard de `signed_at`) | ❌ bloqueado (`c.signed_at IS NULL`) |
| `consultation_diagnoses` | ✅ **permitido** (sin guard) | ❌ bloqueado (`signed_at IS NULL`) |
| `consultation_family_history` | ✅ **permitido** (sin guard; doctor-scoped tras `s7_26`) | ❌ bloqueado (`signed_at IS NULL`) |
| `vitals` | ✅ **permitido** (doctor-scoped por cita; sin concepto de firma) | — (sin policy DELETE) |

→ **Inconsistencia real:** post-firma **no se puede borrar** una receta/diagnóstico, pero **sí se puede editar** (UPDATE) silenciosamente. La inmutabilidad NO está garantizada server-side.

### 1.4 Qué bloquea hoy SOLO el frontend

- `saveConsultationDraft()` lanza error si `status==='signed'` (**client-side**).
- La pantalla de consulta firmada se muestra en modo lectura.
- `signConsultation` solo actúa si `status='draft'`.
- La ruta `/panel/consulta/:id` está tras `DoctorOnlyRoute` (client-side).

**Todo esto es client-side.** Un médico que pegue a la API directamente
(o un cliente modificado) puede editar una consulta firmada.

### 1.5 Qué pasa hoy si se edita una receta después de firmar

- **Vía la UI de Lucy:** bloqueado (lectura / `saveConsultationDraft` lanza).
- **Vía API directa (token del médico dueño):** el RLS lo **permite**
  (UPDATE sin guard de `signed_at`) → **sobrescritura silenciosa**. Queda
  en `audit_log` (hay triggers de audit en `prescriptions`/`consultations`/
  etc.) como un `update` genérico con old/new, **pero sin motivo, sin
  versión, sin marca de "corrección"** y sin ser visible para el médico
  como adenda. La receta impresa cambiaría sin rastro de que hubo
  rectificación.

---

## 2. Riesgo actual

| Riesgo | Severidad | Detalle |
|---|---|---|
| **Legal** | 🚨 Alta | Un documento clínico firmado editable sin trazabilidad de rectificación. En auditoría/legal, "firmado" debe implicar inmutable o con adenda formal. Hoy la firma no es vinculante a nivel datos. |
| **Operativo** | ⚠ Media | Si endurecemos a bloqueo absoluto sin salida, el médico que se equivocó (dosis, medicamento) no tiene cómo corregir → trabaja por fuera de Lucy o no usa la firma. |
| **Clínico** | 🚨 Alta | Receta impresa con error (dosis/medicamento) sin mecanismo de corrección rastreable → riesgo para el paciente. |
| **Auditoría** | 🚨 Alta | Hoy `audit_log` guarda old/new genérico, pero **no** una versión anterior consultable como tal, ni motivo, ni quién/por qué. Reconstruir "qué decía la receta original" depende de leer audit_log crudo. |
| **Inconsistencia** | ⚠ Media | UPDATE permitido pero DELETE bloqueado post-firma → comportamiento incoherente. |

---

## 3. Opciones de diseño

| Opción | Pro | Contra |
|---|---|---|
| **A. Bloqueo absoluto post-firma** | Máxima inmutabilidad; simple a nivel datos | Poco realista: errores reales no se pueden corregir → el médico evita firmar o sale de Lucy |
| **B. Edición directa permitida** | Fácil para el médico | Alto riesgo legal/clínico/auditoría; es ~lo de hoy (silencioso) |
| **C. Corrección controlada / adenda / versión nueva** ⭐ | Equilibrio: el médico corrige, pero todo queda trazado (motivo, versiones, autor, fecha, audit) | Más complejidad técnica (versionado + RPC + RLS + UX + impresión) |

**Recomendación: Opción C.** Es el estándar en sistemas clínicos
(historia clínica = append-only con adendas/rectificaciones, nunca
sobrescritura). Equilibra el principio rector con la realidad operativa.

---

## 4. Flujo propuesto para corrección (Opción C)

```
1. Médico abre una consulta FIRMADA → modo lectura.
2. Botón "Corregir consulta firmada".
3. Advertencia: "Esta consulta ya fue firmada. Los cambios quedarán
   registrados como una corrección visible y auditada."
4. Motivo OBLIGATORIO (texto; quizá categoría: error de dosis / medicamento
   equivocado / typo / dato clínico, etc.).
5. El médico edita solo los campos permitidos (§6).
6. Al confirmar (vía RPC dedicada, NO update directo), el sistema persiste
   atómicamente:
     • snapshot de la versión ANTERIOR (before),
     • la versión NUEVA (after),
     • motivo,
     • fecha/hora (corrected_at),
     • médico responsable (corrected_by),
     • número de versión / adenda (v2, v3, …),
     • entrada en audit_log con edited_via='consultation_amendment'.
7. La consulta queda firmada con una adenda; el original se conserva.
```

Reglas:
- **Solo el médico dueño** (`doctor_id = get_user_doctor_id()`); nunca el asistente (gate `s7_26`).
- Cada corrección es una **adenda nueva** (append-only); no se pierde nada.
- La corrección **re-firma** la adenda (queda firmada por el mismo médico, con su timestamp).

---

## 5. Recetas (análisis específico)

Las recetas son el caso más sensible (se imprimen y van al paciente/farmacia).

- **¿Qué pasa si ya se imprimió?** No se puede "des-imprimir". La receta
  física vieja existe. → La corrección debe **emitir una receta nueva
  marcada como corrección**, y el médico debe poder reimprimir la versión
  vigente. La impresión debe dejar claro que reemplaza a una anterior.
- **Impresión de la receta corregida** debe mostrar:
  - **"Corrección" / "Versión 2"** (o "Receta rectificada").
  - **Fecha de corrección**.
  - Referencia a la receta original (id/fecha) y, según decisión,
    **motivo** (Q3 — ¿se muestra al paciente?).
- **Conservar la receta anterior como histórica:** sí. La versión previa
  queda guardada (no se borra) y marcada como "reemplazada por vN".
- Idealmente la receta corregida lleva una marca inequívoca (sello/aviso)
  para la farmacia: "esta receta corrige/anula la del [fecha]".
- **Decisión de producto (Q):** ¿la corrección de receta genera un
  documento nuevo independiente, o una v2 ligada? Propuesta: **v2 ligada**
  al original, ambas conservadas, la vigente es la última.

---

## 6. Alcance de campos corregibles

| Campo | Corregible | Nota |
|---|---|---|
| Medicamento | Sí | crítico → mayor control (confirmación reforzada) |
| Dosis / frecuencia / duración | Sí | crítico → mayor control |
| Indicaciones | Sí | |
| Diagnóstico | Sí | |
| Notas clínicas (HPI, examen, plan…) | Sí | |
| Antecedentes familiares | Sí | |
| Signos vitales | ⚠ a decidir | son medición puntual; ¿se "corrige" o se anota una observación? (Q) |
| Archivos / documentos adjuntos | ⚠ a decidir | versionado de adjuntos es otro eje; quizá solo agregar, no reemplazar |

**Mayor control / no permitir sin más:**
- Cambiar el **paciente** o el **médico** de la consulta → **no permitido**
  (sería otra consulta).
- Cambiar `signed_at` original, fecha de la consulta → **no**.
- "Des-firmar" para volver a draft → **no** (rompe el principio).

---

## 7. Modelo técnico posible

Dos enfoques, de menor a mayor complejidad:

### 7.1 Enfoque A — Adenda con snapshots (recomendado MVP)

Tabla nueva **`consultation_amendments`** (append-only):
```
id, consultation_id, version int, reason text, reason_category text?,
corrected_by uuid, corrected_at timestamptz,
snapshot_before jsonb,  -- estado de la consulta + hijos antes
snapshot_after  jsonb,  -- estado después
created_at
```
- La consulta firmada conserva su fila; se le agregan
  `amended_at`, `amendment_count` (o se derivan de la tabla).
- Cada corrección inserta una fila de adenda con before/after.
- Para **recetas**: o bien el snapshot JSONB captura las recetas, o se
  agrega `prescriptions.version` + `prescriptions.superseded_by` para
  versionar la receta vigente conservando la anterior.
- **Pro:** trazabilidad completa, simple de consultar, append-only.
- **Contra:** los snapshots JSONB pueden divergir del esquema vivo si no
  se cuida.

### 7.2 Enfoque B — Versionado completo de filas

`prescription_versions`, `consultation_versions`, etc. — cada corrección
crea filas nuevas versionadas; la vigente es la de mayor versión.
- **Pro:** consultas históricas exactas por versión.
- **Contra:** más tablas, joins, complejidad; sobredimensionado para el MVP.

### 7.3 Campos / mecanismos transversales

- `corrected_at`, `corrected_by`, `correction_reason`, `version` /
  `amendment_count` donde aplique.
- **Append-only** en lugar de UPDATE directo para el contenido sensible
  (recetas) → la versión anterior nunca se pisa.
- `audit_log` extendido con `edited_via='consultation_amendment'` +
  referencia a la adenda.

**Recomendación:** Enfoque A (adenda + snapshots) + versionado puntual de
**recetas** (lo más sensible para impresión). El resto del contenido
clínico se corrige guardando snapshot before/after en la adenda.

---

## 8. RLS / backend (evitar edición silenciosa)

Hoy el RLS permite UPDATE de firmados (§1.3). Propuesta:

1. **Firma vía RPC** `sign_consultation(consultation_id)` (`SECURITY DEFINER`,
   gate de rol server-side) en lugar del UPDATE directo → centraliza la
   transición y permite congelar.
2. **Inmutabilidad server-side:** bloquear UPDATE/DELETE directos sobre
   `consultations` y sus hijos cuando la consulta está firmada
   (`signed_at IS NOT NULL`), vía **trigger** y/o ajuste de RLS.
   - ⚠ **Cuidado (deuda #2):** la transición de firma es un UPDATE que
     pasa `signed_at` de NULL→valor. Si se mete `signed_at IS NULL` mal en
     RLS/trigger se rompe la propia firma (hay que distinguir USING sobre
     la fila vieja vs WITH CHECK sobre la nueva, o canalizar la firma por
     la RPC y bloquear el resto).
3. **Correcciones solo vía RPC dedicada** `amend_consultation(...)` /
   `amend_prescription(...)` (`SECURITY DEFINER`) que:
   - valida que el actor es el **médico dueño**,
   - exige **motivo**,
   - escribe la adenda (snapshot before/after) + versión,
   - aplica el cambio,
   - audita.
   El trigger de inmutabilidad permite la escritura solo cuando viene de
   la RPC (p. ej. flag de sesión `set_config('app.amending',…)` que el
   trigger chequea), bloqueando UPDATE directo.
4. **Gate de rol:** reutiliza `get_user_doctor_id()` (asistente = NULL =
   bloqueado, consistente con `s7_26`).

---

## 9. UX

- **Consulta firmada = modo lectura** con sello "Firmada el [fecha]" + (si
  hubo correcciones) badge "Corregida · vN".
- Botón **"Corregir consulta firmada"** (solo médico dueño).
- Modal de corrección: advertencia + **motivo obligatorio** + edición de
  campos permitidos + confirmación reforzada para medicamento/dosis.
- **Historial de correcciones**: lista de adendas (vN, fecha, médico,
  motivo) con posibilidad de ver el **diff** (antes/después) de cada una.
- **Diferencia visual** entre versión original y corregida.
- **Impresión**: botón "Imprimir receta vigente" (marca "Corrección/vN +
  fecha"); opción de ver/imprimir versiones históricas marcadas como
  "reemplazada".

---

## 10. Preguntas de decisión (cerrar con owner)

| Q | Pregunta | Default sugerido |
|---|---|---|
| Q1 | ¿Qué campos se pueden corregir? | Todos los clínicos (§6); NO paciente/médico/fechas/des-firma |
| Q2 | ¿Se puede corregir una receta ya impresa? | Sí, emitiendo v2 marcada como corrección; la anterior queda histórica |
| Q3 | ¿Se muestra el motivo de corrección al paciente (en la receta)? | Mostrar "Corrección vN + fecha"; el motivo libre **interno** por default (a confirmar) |
| Q4 | ¿Cuántas correcciones se permiten? | Sin límite duro, pero todas versionadas y auditadas |
| Q5 | ¿Quién puede corregir? | Solo el **médico dueño**. LucyAdmin **no** edita contenido clínico (regla Security Gate). ¿Caso excepcional admin con doble control? (a decidir) |
| Q6 | ¿Se permite corregir después de X días? | Sin ventana de tiempo en MVP; toda corrección queda fechada. (¿límite legal SV?) |
| Q7 | ¿Corrección crítica de medicamento (dosis peligrosa)? | Confirmación reforzada + marca destacada en la receta + (futuro) alerta |
| Q8 | ¿Adenda con snapshots (7.1) o versionado completo (7.2)? | 7.1 + versionado puntual de recetas |
| Q9 | ¿Signos vitales se "corrigen" o se anota observación? | A decidir (medición puntual) |

---

## 11. Fases de implementación (después de cerrar §10)

> Ninguna fase arranca hasta cerrar §10. **No se implementa nada en este doc.**

- **Fase 0 — Inmutabilidad server-side (deuda #2):** firma vía RPC
  `sign_consultation()` + trigger/RLS que bloquea UPDATE/DELETE directos
  sobre consultas firmadas y sus hijos. **Prerequisito** — sin esto, no
  tiene sentido el resto (la edición silenciosa seguiría abierta).
- **Fase 1 — Modelo de adendas:** tabla `consultation_amendments` +
  versionado de recetas + RPC `amend_consultation()` (motivo obligatorio,
  snapshot before/after, gate médico dueño, audit).
- **Fase 2 — UX de corrección:** modo lectura + botón "Corregir" + modal
  con motivo + historial de adendas + diff.
- **Fase 3 — Impresión de receta corregida:** marca "Corrección/vN +
  fecha", versión vigente vs histórica.
- **Fase 4 — Refinamientos:** categorías de motivo, confirmación reforzada
  para medicamentos, alertas de corrección crítica.

Cada fase: 1 PR chico, migración `s7_NN`/`s8_NN` + `check-*.mjs`, smoke
(incluyendo intento de edición silenciosa que debe quedar bloqueado),
`vite build` OK, merge. Enforcement server-side primero; la UI refleja.

---

## 12. Coordinación con otros docs

- **Deuda técnica #2** (CLAUDE.md) — este doc es su análisis; la Fase 0 la
  cierra.
- `s7_26` / gate clínico — el actor de corrección es el médico dueño
  (`get_user_doctor_id()`); el asistente nunca corrige.
- `s6_02` (firma → cita atendida) — la RPC de firma debe preservar ese
  sync de la cita.
- `docs/ANALISIS_PACIENTE_GLOBAL.md` — si el paciente reclama identidad, la
  visibilidad de adendas/recetas corregidas debe respetar las reglas de
  lectura del paciente (futuro).
- "Print de receta" (deuda conocida #4) — la impresión corregida se diseña
  junto con la mejora de impresión.

---

**Siguiente paso:** owner responde §10. Con eso, **arrancar por la Fase 0
(inmutabilidad server-side / deuda #2)** antes de construir el flujo de
adendas.
