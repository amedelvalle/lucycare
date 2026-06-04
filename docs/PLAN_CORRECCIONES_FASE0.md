# Plan operativo — Correcciones post-firma · Fase 0

> Plan de implementación, derivado de
> `docs/ANALISIS_CORRECCIONES_CONSULTA_FIRMADA.md` y las decisiones
> Q1–Q9 cerradas por el owner (2026-06-03).
> **Snapshot 2026-06-03.**
>
> **Estado (2026-06-04): IMPLEMENTADO para texto + receta.** Etapa A
> (PR #74, `s7_28`) + Etapa B1 (PR #76, `s7_29`) + impresión (PRs #79
> filtro `is_current`, #80 banner "RECETA CORREGIDA" + "Corrección vN",
> #81/`s7_30` distinción texto vs receta) + **UI completa (PR #82): modal
> "Corregir consulta firmada" con Texto + Receta, motivo obligatorio,
> confirmación reforzada para receta, historial de adendas**. ⏳ Único
> pendiente: **B1.5** (diagnósticos / antecedentes familiares estructurados
> / signos vitales) — no bloquea el flujo texto + receta ya live.
>
> Cierra la **deuda técnica #2** (inmutabilidad server-side de consultas
> firmadas) y define el modelo mínimo de adendas/correcciones.

## Principio rector (recordatorio)

Una consulta firmada **no se sobrescribe en silencio**. Toda corrección
posterior es **controlada, trazable, auditada y visible** como adenda.
Ni bloqueo absoluto sin salida, ni edición silenciosa.

---

## 0. Decisiones cerradas (Q1–Q9)

| Q | Decisión |
|---|---|
| Q1 | Corregibles: medicamentos, dosis, frecuencia, duración, indicaciones, diagnóstico, notas clínicas, antecedentes, signos vitales. **NO**: paciente, médico responsable, fecha de consulta, `signed_at`, estado de firma, "des-firmar". |
| Q2 | Receta ya impresa: corregible como **nueva versión**; la anterior queda histórica. |
| Q3 | Motivo libre = **interno**. En receta/paciente solo "Corrección v2 / Receta corregida" + fecha. |
| Q4 | **Sin límite** de correcciones; todas versionadas, fechadas, auditadas. |
| Q5 | Solo el **médico dueño**. LucyAdmin **no** edita contenido clínico. |
| Q6 | **Sin ventana de tiempo**; toda corrección queda fechada/auditada/vinculada a la versión previa. |
| Q7 | Medicamento/dosis/frecuencia/duración → **confirmación reforzada** (advertencia + motivo obligatorio + confirmación explícita + receta marcada). Alertas automáticas = futuro. |
| Q8 | Modelo: `consultation_amendments` + snapshots JSONB antes/después + versionado puntual de recetas + audit + **append-only** (no sobrescritura silenciosa). |
| Q9 | Signos vitales: mismo flujo (motivo + versión previa/nueva + audit). Sin tratamiento especial. |

---

## 1. Alcance de Fase 0

Fase 0 se parte en **dos etapas**, ambas server-side primero:

- **Etapa A — Inmutabilidad + firma vía RPC** (cierra la deuda #2; es la
  parte de seguridad).
- **Etapa B — Modelo mínimo de adendas + RPC de corrección** (abre la
  corrección controlada).

> **Por qué A puede ir primero sin "bloqueo absoluto" para el médico:**
> hoy la UI ya muestra la consulta firmada en **modo lectura** (no se
> puede corregir desde Lucy). La fuga es solo vía **API directa**
> (silenciosa). Entonces la Etapa A **no le quita** capacidad actual al
> médico — solo cierra el hueco server-side. La Etapa B **agrega** la
> corrección controlada (mejora sobre hoy). Igual se recomienda **A y B
> cercanas** para no dejar una ventana larga sin corrección posible.

**Fuera de Fase 0** (fases posteriores del análisis): UX completa de
corrección (modal, historial, diff), impresión de receta corregida,
categorías de motivo, alertas críticas automáticas.

---

## 2. Etapa A — Inmutabilidad server-side + firma vía RPC

### 2.1 Mecanismo recomendado (RLS + RPC `SECURITY DEFINER`)

Patrón ya usado en el proyecto: las RPC `SECURITY DEFINER` (owner
`postgres`, con `BYPASSRLS`) **bypasean RLS**; las escrituras de usuarios
`authenticated` pasan por RLS. Aprovechamos eso:

1. **Endurecer RLS** para que `authenticated` NO pueda UPDATE/DELETE
   contenido clínico de una consulta **firmada**:
   - `consultations` UPDATE: `USING (doctor_id = get_user_doctor_id() AND signed_at IS NULL)` + `WITH CHECK (...)`. (Edición de borrador sigue OK; el firmado queda fuera del alcance de `authenticated`.)
   - `prescriptions` / `consultation_diagnoses` / `consultation_family_history` UPDATE: agregar `AND (parent).signed_at IS NULL` al predicado (hoy NO lo tienen — §1.3 del análisis).
   - DELETE de esos hijos ya tiene `signed_at IS NULL` (se mantiene).
2. **Firma vía RPC** `sign_consultation(p_consultation_id)` (`SECURITY
   DEFINER`):
   - Gate server-side: el actor es el **médico dueño**
     (`doctor_id = get_user_doctor_id()`); asistente bloqueado.
   - `draft → signed` (set `signed_at`, `status='signed'`) solo si estaba
     `draft`.
   - Preserva el sync de la cita a `atendida` (hoy lo hace el trigger
     `sync_appointment_on_sign` de `s6_02` → se mantiene).
   - Reemplaza el `UPDATE` directo del front (que ahora quedaría bloqueado
     por la RLS endurecida, porque la transición la hace la RPC definer).
3. **Correcciones solo vía RPC** (Etapa B): como la RPC es definer,
   bypasea la RLS endurecida → es el **único** camino para tocar un
   firmado.

**Por qué RLS+RPC y no trigger+flag:** menos magia, usa el patrón definer
ya establecido (claim, admin\_\*). (Alternativa con trigger BEFORE
UPDATE/DELETE + flag de sesión `app.amending` queda documentada como
plan B si la RLS resulta incómoda con algún caso.)

### 2.2 Cuidado crítico (deuda #2)

- La **transición de firma** es un UPDATE que pasa `signed_at` NULL→valor.
  Con la firma movida a la **RPC definer**, ese UPDATE bypasea RLS → no
  choca con el `signed_at IS NULL`. **No** poner el guard de forma que
  rompa la firma (error clásico USING vs WITH CHECK). La RPC es la salida
  limpia.
- Verificar que **`saveConsultationDraft`** (edición de borrador) sigue
  funcionando: opera sobre `signed_at IS NULL` → la RLS lo permite.
- **Vitals**: se gatean por `appointment_id` (no por `consultation_id`) y
  no tienen `signed_at`. Su inmutabilidad post-firma se resuelve en la
  Etapa B (la corrección de vitales pasa por la RPC de adenda); en Etapa A
  no hay un `signed_at` directo que chequear. **Decisión menor (R1):** si
  queremos congelar vitales al firmar la consulta de su cita, hay que
  derivar el estado de firma vía la consulta de esa cita (join).

### 2.3 Frontend (mínimo en Etapa A)

- `signConsultation()` → llamar la **RPC** `sign_consultation` en vez del
  `update` directo (el guard client-side de rol queda como UX, pero el
  real es server-side).
- Sin otros cambios de UI en A (la consulta firmada ya es read-only).

---

## 3. Etapa B — Modelo mínimo de adendas + RPC de corrección

### 3.1 Tabla `consultation_amendments` (append-only)

```sql
CREATE TABLE consultation_amendments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES consultations(id),
  version         int  NOT NULL,            -- 2, 3, … (la firma original = v1)
  reason          text NOT NULL,            -- motivo OBLIGATORIO (interno, Q3)
  reason_category text,                     -- opcional (error_dosis, medicamento, typo, …)
  corrected_by    uuid NOT NULL REFERENCES profiles(id),
  corrected_at    timestamptz NOT NULL DEFAULT now(),
  snapshot_before jsonb NOT NULL,           -- consulta + hijos antes
  snapshot_after  jsonb NOT NULL,           -- consulta + hijos después
  created_at      timestamptz NOT NULL DEFAULT now()
);
```
- En `consultations` (o derivado): `amendment_count` / `last_amended_at`
  (para badge "Corregida · vN" sin recontar).
- **Recetas (versionado puntual, Q2):** agregar a `prescriptions`
  `version int DEFAULT 1` + `superseded_by uuid NULL` (o `is_current
  boolean`). Una corrección de receta:
  - marca la receta vigente como reemplazada (`superseded_by`/`is_current=false`),
  - inserta la nueva versión (`version+1`, `is_current=true`),
  - conserva la anterior (histórica).
- RLS de `consultation_amendments`: SELECT para el médico dueño (y
  paciente en el futuro, según reglas de lectura); INSERT/UPDATE solo vía
  RPC (definer).

### 3.2 RPC `amend_consultation(...)`

`amend_consultation(p_consultation_id, p_reason, p_changes jsonb, p_reason_category text DEFAULT NULL)`
(`SECURITY DEFINER`):
1. Gate: actor = médico dueño (`get_user_doctor_id()`); asistente bloqueado.
2. Exige `reason` no vacío.
3. Solo sobre consultas **firmadas** (si está draft, se edita normal).
4. Toma `snapshot_before` (consulta + hijos).
5. Aplica los cambios permitidos (Q1) — **bypasea la RLS endurecida** por
   ser definer. Para recetas, crea **versión nueva** (no pisa la anterior).
6. Toma `snapshot_after`, calcula `version = amendment_count+2`… (o
   `max(version)+1`), inserta la adenda.
7. Escribe `audit_log` con `edited_via='consultation_amendment'` + ref a la
   adenda.
8. Devuelve la adenda creada.

- **Confirmación reforzada (Q7)** para medicamento/dosis/frecuencia/
  duración: se enforce en UX (Etapa siguiente), pero la RPC puede recibir
  un flag `p_critical_confirmed` y exigirlo cuando los cambios tocan
  campos de receta.
- Campos NO corregibles (Q1): la RPC los **ignora/rechaza** (paciente,
  médico, fechas, `signed_at`, estado).

---

## 4. Migraciones / RPCs necesarias (propuesta)

| Migración | Contenido | Etapa |
|---|---|---|
| **`s7_28`** | RLS endurecida (UPDATE de consultations/prescriptions/diagnoses/cfh con `signed_at IS NULL`) + RPC `sign_consultation()` | A |
| **`s7_29`** | Tabla `consultation_amendments` + RLS + versionado de `prescriptions` (`version`, `is_current`/`superseded_by`) + RPC `amend_consultation()` + (opcional) `amend_*` específicas | B |
| `check-s7_28.mjs` / `check-s7_29.mjs` | Verificación (incluye **intento de edición silenciosa que debe quedar bloqueado**) | A / B |

> Numeración tentativa (`s7_28`/`s7_29`); confirmar al implementar.

---

## 5. Smoke plan (al implementar — server-side primero)

**Etapa A:**
- Firmar una consulta de prueba vía la RPC → queda `signed`.
- Como médico dueño (sesión real), intentar `UPDATE` directo de la
  consulta firmada y de una receta firmada → **bloqueado por RLS**.
- Editar un borrador (no firmado) → sigue permitido.
- Asistente → bloqueado (gate `s7_26`, ya validado).
- Verificar que la cita pasó a `atendida` al firmar (sync preservado).

**Etapa B:**
- `amend_consultation` con motivo → crea adenda (before/after), versiona la
  receta, audita; la receta anterior queda histórica.
- `amend_consultation` sin motivo → rechazado.
- Asistente / no-dueño → rechazado.
- Confirmar que la consulta original no se perdió (append-only).

Cleanup de datos de prueba. `vite build` OK. Migración aplicada + check.

---

## 6. Riesgos / decisiones residuales

| # | Tema | Default / a decidir |
|---|---|---|
| R1 | Inmutabilidad de **vitals** al firmar (no tienen `signed_at`) | Derivar de la consulta de la cita en Etapa B; o congelar al firmar (decisión menor) |
| R2 | Romper la firma al endurecer RLS (USING vs WITH CHECK) | Mitigado moviendo la firma a RPC definer; smoke explícito |
| R3 | `snapshot_before/after` JSONB puede divergir del esquema | Acotar a las tablas conocidas; versionar el formato del snapshot |
| R4 | Receta histórica: ¿`is_current` o `superseded_by`? | Definir al implementar (ambos sirven; `is_current` + `version` es simple) |
| R5 | Orden de release A→B | A no regresiona UX (firmado ya read-only); B agrega corrección. Lanzar B poco después de A |

---

## 7. Coordinación con otros docs

- `docs/ANALISIS_CORRECCIONES_CONSULTA_FIRMADA.md` — este plan implementa
  su Opción C + Q1–Q9.
- **Deuda #2** (CLAUDE.md) — la Etapa A la cierra.
- `s7_26` / gate clínico — el actor de firma y corrección es el médico
  dueño (`get_user_doctor_id()`); asistente bloqueado.
- `s6_02` — la RPC de firma preserva el sync cita→`atendida`.
- "Print de receta" (deuda #4) — la impresión de receta corregida
  (marca "Corrección vN + fecha", Q3) se diseña en una fase de UX/impresión
  posterior, junto con la mejora de impresión.

---

**Siguiente paso:** owner revisa/aprueba este plan. Con aprobación, se abre
el PR de **Etapa A** (`s7_28`: RLS endurecida + `sign_consultation`),
luego **Etapa B** (`s7_29`: adendas + `amend_consultation`). No se
implementa nada hasta la aprobación.
