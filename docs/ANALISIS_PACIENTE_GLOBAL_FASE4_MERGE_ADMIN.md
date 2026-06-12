# Análisis — Paciente Global Fase 4: merge admin de duplicados (B1)

> Documento de diseño (docs-only, sin código). Diseña la herramienta de
> LucyAdmin para resolver duplicados de pacientes/fichas, bajo el marco de
> ownership ya firmado (#127, D1–D7) y con el hallazgo F4 (claim abortado por
> `UNIQUE` de documento) como insumo principal.
>
> Snapshot de referencia: HEAD `a1e0adf`, migraciones hasta `s7_44`,
> PRs #1–#133. Complementa `docs/ANALISIS_PACIENTE_GLOBAL.md` (Fase 4
> original, esbozo 2026-05-25) y `docs/ANALISIS_PACIENTE_GLOBAL_OWNERSHIP.md`
> (reglas D1–D7). **Decisiones DM1–DM9 CERRADAS por el owner el 2026-06-12
> (§10). La implementación (F4-1+) arranca SOLO con señal explícita del
> owner.**

---

## 1. Resumen ejecutivo

El modelo de Paciente Global (Fases 1–3 y 5) dejó UNA pieza sin construir: la
herramienta para **resolver duplicados que ya existen o que se sigan colando**.
F5 previene duplicados nuevos (advisory); el claim vincula fichas a identidades;
el sync espejo mantiene la coherencia — pero cuando dos filas representan a la
misma persona, hoy no hay forma de unificarlas sin SQL manual.

El costo de esa ausencia dejó de ser teórico: el **hallazgo F4** (reproducido
en el smoke `s7_43`) muestra que una ficha duplicada con documento en la misma
clínica hace que `claim_patient_records` **aborte COMPLETO y en silencio** —
la persona entra a Lucy y no ve ninguna de sus atenciones, de ninguna clínica,
sin mensaje de error (el hook de login es fail-safe).

**Tesis central de este diseño:** bajo el modelo actual, "merge" significa
**dos operaciones distintas** que conviene separar:

1. **Merge de fichas** (`patients`) — dos filas en la **misma clínica** que
   son la misma persona. Mueve historia clínica entre fichas. Es lo que
   resuelve el hallazgo F4. **Alcance recomendado de esta fase.**
2. **Merge de identidades** (`profiles`/`auth.users`) — dos cuentas Lucy que
   son la misma persona (p. ej. cambió de número antes de reclamar). Toca
   credenciales y roles. **Mucho más delicado; se recomienda diferirlo a un
   diseño propio posterior** (§9, F4-D).

El esbozo original de Fase 4 (2026-05-25, pre-identidad-global) hablaba de
fusionar fichas "cross-clinic o intra-clinic". Este diseño lo **corrige**: bajo
el modelo vigente, dos fichas de la misma persona en **clínicas distintas NO
son un duplicado** — son el modelo (una relación clínica por clínica, DA1). Lo
que se unifica cross-clínica es la **identidad** (ambas fichas apuntando al
mismo `profile_id`), nunca la historia clínica entre clínicas.

> **Alcance CERRADO (DM1 ✅, owner 2026-06-12):** esta fase opera SOLO sobre
> fichas locales (`patients`) dentro de la **misma clínica**. Quedan FUERA
> de esta fase: merge de identidades (`profiles`), merge de `auth.users`,
> credenciales, roles, recuperación sin sesión y unión de expedientes
> cross-clínica. Regla central: **cross-clínica no es duplicado de
> expediente** — se resuelve por identidad global, no por fusión de ficha
> clínica (F4-D, diseño propio posterior).

Además, este diseño propone una **mitigación quirúrgica e independiente del
claim** (vincular fila por fila, tolerante a la colisión) para cortar el daño
activo del hallazgo F4 sin esperar a que el merge esté construido (§8/F4-1 —
**DM2 ✅ cerrada**: primer PR real tras este docs-only, a señal del owner).

---

## 2. Mapa de entidades afectadas (verificado contra esquema y migraciones)

### 2.1 Nivel ficha (`patients`) — lo que el merge de fichas mueve o toca

| Tabla | Relación con la ficha | FK / regla | ¿La mueve el merge? |
|---|---|---|---|
| `appointments` | `patient_id` NOT NULL → `patients(id)` ON DELETE RESTRICT | índice `idx_appointments_patient` | ✅ re-point fuente→destino |
| `consultations` | `patient_id` NOT NULL → `patients(id)` ON DELETE RESTRICT | índice `idx_consultations_patient` | ✅ re-point fuente→destino |
| `vitals` | `patient_id` NOT NULL → `patients(id)` RESTRICT **y** `appointment_id` → `appointments` CASCADE | doble FK | ✅ re-point, **consistente con su cita** (mismo UPDATE lógico) |
| `prescriptions` | vía `consultation_id` (CASCADE) | sin FK directa a patients | ➖ viajan solas con su consulta |
| `consultation_diagnoses` | vía `consultation_id` (CASCADE) | ídem | ➖ viajan solas |
| `consultation_family_history` | vía `consultation_id` (CASCADE, `s5_01`) | ídem | ➖ viajan solas |
| `consultation_amendments` | vía `consultation_id` (CASCADE, `s7_29`) | ídem; snapshots JSONB inmutables | ➖ viajan solas (ver riesgo T6) |
| `patient_link_rejections` | `patient_id` → `patients(id)` CASCADE (`s7_43`) + UNIQUE par (patient, profile) | registro histórico | ❌ NO se mueve (queda como historia de la ficha fuente; ver DM8) |
| `audit_log` | `record_id` uuid suelto, **sin FK** | inmutable | ❌ no se toca jamás |
| `waitlist_entries` | por teléfono normalizado, sin FK a patients | — | ❌ fuera de alcance |

### 2.2 Nivel identidad (`profiles`) — lo que un merge de identidades tocaría (F4-D, diferido)

| Tabla | Relación | Nota |
|---|---|---|
| `patients.profile_id` | fichas vinculadas a la identidad | re-point fuente→destino |
| `reviews.patient_profile_id` | NOT NULL → `profiles(id)` | reseñas hechas por la identidad |
| `notifications.recipient_id` | NOT NULL → `profiles(id)` | cola de notificaciones |
| `appointments.created_by` | → `profiles(id)` | autoría histórica — **NO se re-apunta** (es traza) |
| `clinic_members` | UNIQUE(clinic_id, profile_id) | si la identidad fuente fuera médico/asistente → **bloqueo** (ver §7) |
| `auth.users` | id compartido con `profiles.id` | credenciales: NUNCA se fusionan; la cuenta fuente se desactiva, no se borra |
| `profiles` UNIQUE parcial documento (`s7_32`) | dos identidades no pueden compartir DUI | la colisión de DUI entre profiles es justamente el síntoma a resolver |

### 2.3 Constraints y guards que el merge debe atravesar (verificados)

| Pieza | Qué hace | Impacto en el merge |
|---|---|---|
| `UNIQUE(clinic_id, document_type, document_number)` en `patients` | un documento por clínica; **no es parcial** — incluye fichas `is_active=false` | la ficha fuente debe **liberar su documento** (→ NULL, con snapshot en el log) o el conflicto persiste para siempre (§6.4) |
| **No existe** `UNIQUE(clinic_id, profile_id)` en `patients` | un profile puede tener 2+ fichas vinculadas en la misma clínica | el escenario E3 es estructuralmente posible; el merge debe soportarlo |
| `prevent_signed_consultation_edit` (BEFORE UPDATE ON `consultations`, `s7_28`/`s7_29`) | bloquea TODO update de consulta firmada; los triggers corren aun dentro de RPC definer; bypass GUC `app.amending` | el re-point de `patient_id` de una consulta firmada lo dispara → el merge necesita **bypass GUC propio** (`app.merging_patients`), transaction-local, seteado SOLO dentro de la RPC |
| `prevent_linked_patient_identity_edit` (P0030, BEFORE UPDATE ON `patients`, `s7_33`) | bloquea editar identidad de ficha vinculada; bypass GUC `app.syncing_patient_identity` | el merge **no edita identidad** de la ficha destino (la identidad viene del profile); neutralizar el documento de la fuente sí requiere bypass si la fuente está vinculada |
| Triggers de `appointments` (`s6_02` BEFORE UPDATE OF `status_id`; `s6_10` BEFORE UPDATE OF `start_time`) | guards de estado/reagenda | **no se disparan** por re-point de `patient_id` (column-scoped, verificado) |
| Inmutabilidad de `vitals` (`s7_31`) | por RLS (cita con consulta firmada) | RPC definer la atraviesa; el merge no altera contenido, solo `patient_id` |
| Triggers de audit en `patients` (`s4_02`) | auditan UPDATEs | el merge audita doble: trigger + filas explícitas con `edited_via='admin_merge'` |
| Sync espejo `profiles→patients` (`s7_33`) | propaga identidad a TODAS las fichas vinculadas | post-merge el destino queda dentro del sync normal; la fuente desvinculada/neutralizada queda fuera |
| `claim_patient_records` (`s7_43`) | vincula por teléfono `WHERE profile_id IS NULL`; **no filtra `is_active` ni fichas fusionadas** | sin marca de "fusionada", el claim **re-vincularía la cáscara fuente** → el claim debe excluir fichas con `merged_into_patient_id IS NOT NULL` (§6.4) |

---

## 3. Escenarios de duplicidad (taxonomía)

| # | Escenario | Nivel | ¿Lo resuelve esta fase? |
|---|---|---|---|
| **E1** | Misma clínica, dos fichas sin vincular de la misma persona (walk-in duplicado: doble creación, typo de teléfono corregido después) | ficha | ✅ merge de fichas |
| **E2** | Misma clínica, una ficha **vinculada** + una sin vincular con el **mismo documento** → es el **hallazgo F4**: al hacer OTP la persona, el claim intenta copiar su DUI a la segunda ficha y el `UNIQUE` aborta TODO el claim (todas las clínicas), silencioso | ficha | ✅ merge de fichas (+ mitigación del claim, DM2) |
| **E3** | Misma clínica, dos fichas vinculadas al **mismo** profile (no hay UNIQUE que lo impida; race de `getOrCreatePatient` o legado). Es la "nota F3": el sync espejo choca con el `UNIQUE` al propagar el mismo documento a ambas → el paciente no puede guardar su perfil | ficha | ✅ merge de fichas |
| **E4** | Dos identidades Lucy (`profiles` + `auth.users`) de la misma persona — cambió de número antes de reclamar, o usó número viejo/nuevo en clínicas distintas | identidad | ⏳ F4-D (diseño propio posterior, ver §9) |
| **E5** | Fichas de la misma persona en clínicas distintas vinculadas a profiles **distintos** (consecuencia de E4) | identidad | ⏳ se resuelve al fusionar identidades (E4); las fichas NO se fusionan entre clínicas |
| **E6** | Ficha vinculada a la persona **equivocada** (R1/R2: teléfono mal tipeado o compartido) | vínculo | ❌ no es merge — es des-vinculación: B2 ya da el self-service (`reject_patient_link`) y deja cola `pending_review` (bandeja admin: entra en F4-3 como tab de `/admin/pacientes`, o F4-3b si agranda — DM8 ✅) |

**Regla derivada del modelo (vinculante para la herramienta):** dos fichas en
**clínicas distintas nunca se fusionan**. La unidad de fusión de historia
clínica es la clínica. Cross-clínica solo se unifica identidad (E4/E5).

---

## 4. Riesgos

### 4.1 Riesgos clínicos 🔴 (los más graves del proyecto hasta ahora)

- **C1 — Fusionar fichas de dos personas distintas.** El merge mueve
  expediente (consultas firmadas, recetas, vitales, diagnósticos). Si las
  fichas NO eran la misma persona, el expediente del destino queda
  contaminado: alergias, antecedentes y medicación de un tercero aparecen
  como propios → riesgo asistencial directo (decisiones médicas sobre datos
  falsos). **Es el peor error posible de la herramienta.** Mitigación:
  criterios de elegibilidad estrictos (§6.2), dry-run obligatorio,
  confirmación en dos pasos, reversibilidad (§6.5).
- **C2 — Pérdida de contexto del médico.** Tras un merge, el médico ve una
  sola ficha con la historia combinada. Si los duplicados tenían notas
  locales divergentes (alergias en una, notas en otra), la información local
  de la fuente NO viaja automáticamente (DM6) y podría "desaparecer" de la
  vista del médico (la ficha fuente queda inactiva pero existente).
- **C3 — Merge durante atención en curso.** Si la clínica tiene una consulta
  borrador abierta sobre la ficha fuente en el momento del merge, el
  re-point puede sorprender al médico a mitad de consulta. **Cerrado (DM3c,
  2026-06-12): el merge se BLOQUEA** si hay consulta borrador abierta sobre
  la ficha fuente — bloqueo, no advertencia (`P0067`).

### 4.2 Riesgos legales ⚖️

- **L1 — Integridad del expediente.** El expediente clínico es documentación
  sanitaria: la firma es inmutable por diseño (`s7_28..s7_31`). El merge **no
  modifica contenido clínico** — solo re-apunta `patient_id` — pero ese
  re-point altera "de quién" es el expediente. Debe quedar trazado de forma
  completa e inmutable (audit + log de merge), con motivo, autor y timestamp.
- **L2 — Retención.** No hard-delete: la ficha fuente se conserva
  desactivada y marcada. Ningún dato clínico ni administrativo se destruye.
- **L3 — Consentimiento/competencia.** LucyAdmin fusiona por evidencia
  documental (mismo documento/mismo profile) o a pedido del paciente. Para el
  merge de **identidades** (F4-D) la barra es más alta: implica credenciales
  → probablemente exija prueba de posesión (OTP) o protocolo de soporte
  formal (conecta con D7 / recuperación sin sesión). Por eso se difiere.
- **L4 — Privacidad del admin.** Regla vigente: el admin de plataforma **no
  ve contenido clínico**. La herramienta (preflight, UI, respuestas de RPC)
  solo expone **metadatos operativos**: conteos, fechas, clínica, médico,
  estado de vínculo — nunca texto de consultas, diagnósticos ni recetas.

### 4.3 Riesgos técnicos 🔧

- **T1 — Colisión `UNIQUE(clinic, doc)` residual.** Si la fuente conserva su
  `document_number`, el conflicto sobrevive al merge (el UNIQUE no es parcial
  — cubre inactivas). El merge debe **neutralizar el documento de la fuente**
  (→ NULL) con snapshot previo en el log (§6.4).
- **T2 — Re-claim de la cáscara.** `claim_patient_records` matchea por
  teléfono `WHERE profile_id IS NULL` sin filtrar inactivas: una fuente
  desvinculada y desactivada **se re-vincularía** en el próximo login.
  El claim debe excluir fichas fusionadas (§6.4).
- **T3 — Guard de firma.** `prevent_signed_consultation_edit` bloquea
  cualquier UPDATE de consulta firmada, incluso desde RPC definer. El merge
  necesita bypass GUC **propio y transaction-local** (`app.merging_patients`),
  seteado SOLO dentro de la RPC — nunca reutilizar `app.amending` (semántica
  distinta, auditoría distinta).
- **T4 — Consistencia vitals↔cita.** `vitals` tiene FK doble
  (`patient_id` + `appointment_id`). Re-point parcial dejaría vitales
  apuntando a una ficha y su cita a otra. El merge mueve ambos en la misma
  transacción.
- **T5 — Concurrencia.** Dos merges simultáneos sobre la misma ficha, o un
  merge concurrente con un claim del paciente. Mitigación: `FOR UPDATE` sobre
  ambas fichas al inicio, transacción única, revalidación de elegibilidad
  dentro de la transacción (el preflight NO es autoritativo).
- **T6 — Snapshots históricos apuntando a IDs viejos.** Los snapshots JSONB
  de `consultation_amendments` (`s7_29`) y los `*_snapshot` de catálogo
  (`s7_37`) contienen el `patient_id`/datos de la época. **No se reescriben**
  (son historia). Consecuencia aceptada: un snapshot puede citar el id de la
  ficha fuente; el log de merge permite resolver la cadena.
- **T7 — Idempotencia/re-merge.** Fusionar una ficha ya fusionada, o usar
  como destino una ficha fuente de un merge previo (cadenas A→B→C). Reglas:
  una ficha con `merged_into_patient_id` NO puede ser fuente ni destino de
  nada; el log conserva la cadena completa.
- **T8 — El sync espejo post-merge.** Tras fusionar E3 (dos fichas del mismo
  profile), el sync de `s7_33` vuelve a operar sobre UNA sola ficha por
  clínica → la colisión de la "nota F3" desaparece de raíz. Verificarlo en el
  smoke de la implementación.

---

## 5. Reglas de seguridad (vinculantes para la implementación)

1. **Solo LucyAdmin** (`is_admin()`), vía RPC `SECURITY DEFINER` con gate
   explícito al inicio. El médico **nunca** fusiona (D6 ratificada). Sin
   acceso `anon`; REVOKE a `authenticated` salvo el gate interno (mismo
   patrón que las `admin_*` existentes).
2. **Motivo obligatorio.** `p_reason text` NOT NULL, longitud mínima
   (≥ 10 caracteres), persistido en el log de merge y en `audit_log`. Sin
   motivo no hay merge (mismo principio que `amend_consultation`).
3. **Dry-run obligatorio.** El preflight (read-only) es un paso previo
   forzado por la UI **y** el merge revalida TODO server-side dentro de la
   transacción (el dry-run informa; la RPC de merge es la autoridad). Ver
   §6.3.
4. **Audit en cada transición.** Fila explícita en `audit_log` con
   `edited_via='admin_merge'` (+ las que generen los triggers existentes),
   identificando fuente, destino, conteos movidos, motivo y admin ejecutor.
5. **No hard-delete.** Nada se borra: ni fichas, ni citas, ni consultas, ni
   audit. La fuente queda `is_active=false` + marcada como fusionada.
6. **Reversibilidad.** Log de merge con snapshot completo del estado previo
   (ficha fuente entera + IDs exactos de filas movidas) — suficiente para
   deshacer con precisión vía **unmerge formal** (DM7 ✅ cerrada, §6.5).
7. **Transacción única + locks.** `FOR UPDATE` de fuente y destino; o se
   mueve todo o no se mueve nada.
8. **Sin contenido clínico en la herramienta.** Ni el preflight, ni la RPC,
   ni la UI devuelven texto clínico (L4). Solo metadatos y conteos.
9. **Bypass GUC propio** (`app.merging_patients`), transaction-local,
   seteado y apagado dentro de la RPC. Los guards existentes (`P0030`,
   firma) siguen intactos para todo lo demás.
10. **Códigos de error propios** (serie `P0060`): elegibilidad fallida,
    fichas de clínicas distintas, ficha ya fusionada, destino inválido,
    motivo ausente — cada bloqueo con código y mensaje claro (patrón
    P0010–P0013 / P0050–P0055).

---

## 6. Diseño propuesto — merge de fichas intra-clínica

### 6.1 Semántica de la operación

`admin_merge_patients(p_source_id, p_target_id, p_reason)` — fusiona DOS
fichas de la **misma clínica** que son la **misma persona**:

1. Valida elegibilidad (§6.2) con ambas fichas bajo `FOR UPDATE`.
2. Registra el merge en `patient_merge_log` (snapshot completo previo).
3. Re-apunta `appointments.patient_id`, `consultations.patient_id`,
   `vitals.patient_id` de fuente → destino (bypass GUC activo).
4. Neutraliza la fuente (DM5 ✅): `document_number → NULL` (snapshot ya
   guardado), `profile_id → NULL`, `is_active → false`, marca
   `merged_into_patient_id = target`, `merged_at = now()`. El **teléfono se
   conserva** como traza histórica. **`document_type` NO necesita
   neutralizarse** (respuesta a la consulta de DM5): es NOT NULL con default
   y, con `document_number = NULL`, el `UNIQUE(clinic, doc_type, doc_number)`
   deja de participar (NULLS DISTINCT) sin importar el tipo — se conserva
   como parte de la traza. El mínimo obligatorio (liberar el UNIQUE sin
   perder snapshot) se cumple con `document_number → NULL` + log.
5. Audita (fila explícita + triggers) y devuelve resumen (conteos movidos).

**El destino no se modifica** salvo `updated_at` (la identidad del destino ya
la gobierna su profile vía sync espejo; los campos locales no se pisan — DM6).

### 6.2 Elegibilidad (✅ CERRADA por DM3/DM4, owner 2026-06-12)

| Regla | Código propuesto |
|---|---|
| Ambas fichas existen y pertenecen a la **misma clínica** | `P0060` si no |
| Ninguna está ya fusionada (`merged_into_patient_id IS NULL`) | `P0061` |
| Fuente ≠ destino | `P0062` |
| **Evidencia fuerte de misma persona** (al menos una, DM3a): mismo `document_number` **normalizado y no vacío**; o mismo `profile_id` no-null (E3). Siempre con dry-run + confirmación LucyAdmin + motivo. **Anti-evidencia:** si nombre, fecha de nacimiento o sexo existen en ambas fichas y muestran conflicto evidente, NO se trata como match aunque la evidencia fuerte coincida — bloqueo y revisión manual. El preflight muestra SIEMPRE la evidencia usada | `P0063` |
| **Teléfono+nombre sin documento = BLOQUEADO en V1** (DM3b): sin merge por "parecido razonable"; queda como revisión manual / backlog de override futuro | `P0063` |
| Si exactamente UNA está vinculada (`profile_id` no-null) → esa es **obligatoriamente el destino** (DM4a: la identidad la gobierna el paciente/Lucy; no se mueve hacia una ficha local no vinculada) | `P0064` |
| Si ambas vinculadas a profiles **distintos** → **bloqueo total** (DM4b: posible conflicto de identidad — E4/E5, va a diseño futuro de identidad/recuperación, no a F4) | `P0065` |
| Si ambas SIN vincular → **LucyAdmin elige el destino** (DM4c); el sistema sugiere (más antigua / más historial / datos más completos) pero la decisión es explícita del admin y queda auditada | — |
| Motivo ≥ 10 caracteres | `P0066` |
| **Sin consulta borrador abierta sobre la ficha fuente** (DM3c: el merge se bloquea, no solo advierte) | `P0067` |

**Regla de precaución — teléfonos compartidos / menores (DM9 ✅, vinculante
también para versiones futuras):** el teléfono compartido **no prueba
identidad**. Nunca se fusiona solo por teléfono cuando los nombres difieren;
especial cuidado con menores, dependientes, familiares y teléfonos del
responsable. La evidencia fuerte es documento o profile (DM3). Con DM3b
bloqueado en V1 este riesgo queda mitigado de entrada; si alguna versión
futura habilita un override, esta regla lo condiciona.

> Nota de implementación (a precisar en F4-2): la definición operativa del
> "conflicto evidente" de DM3a — propuesta: bloqueo duro server-side cuando
> los campos estructurados (DOB/sexo) existen en ambas y difieren; el nombre
> se muestra lado a lado en el preflight para el juicio del admin.

### 6.3 Dry-run: `admin_merge_patients_preflight(p_source_id, p_target_id)`

Read-only, mismo gate `is_admin()`. Devuelve (sin PII clínica):

- Clasificación: elegible / bloqueada (con código y explicación).
- **Evidencia detectada y mostrada** (DM3a): documento igual / profile igual
  / solo teléfono (→ bloqueada en V1, DM3b) / anti-evidencia por conflicto
  de nombre-DOB-sexo.
- Conteos a mover: citas (por estado), consultas (firmadas vs borrador —
  **borrador abierto sobre la fuente = merge BLOQUEADO**, DM3c/`P0067`),
  vitales.
- Estado de vínculo de ambas (vinculada/no, confirmada/no
  `link_confirmed_at`, rechazos previos en `patient_link_rejections`).
- Colisiones: ¿el documento de la fuente sobreviviría? (no — se neutraliza;
  el preflight lo informa), ¿hay tercera ficha con el mismo documento?
- Qué quedará en la fuente tras el merge (cáscara inactiva marcada).

La UI muestra este resultado y exige confirmación explícita + motivo antes de
llamar al merge real. El merge **revalida todo** — el preflight es informativo.

### 6.4 Cambios de soporte (misma migración)

- **Columnas en `patients`:** `merged_into_patient_id uuid REFERENCES
  patients(id)` + `merged_at timestamptz`. Marca de primera clase (no abusar
  de `notes`), consultable e indexable.
- **Tabla `patient_merge_log`:** id, source_id, target_id, clinic_id,
  merged_by (admin), reason, snapshot JSONB de la fuente completa, arrays de
  IDs movidos (`appointment_ids`, `consultation_ids`, `vitals_ids`),
  created_at, y campos de reversa (`unmerged_at`, `unmerged_by`,
  `unmerge_reason`) — **DM7 ✅: el log nace con la reversa formal prevista**.
  RLS admin-only SELECT;
  escritura solo vía RPC definer (mismo patrón `platform_admin_invitations`).
- **`claim_patient_records`:** agregar `AND p.merged_into_patient_id IS NULL`
  a los filtros (cierra T2). Cambio de una línea sobre la versión `s7_43`.
- **Sin tocar `is_admin()` ni RLS existentes** de patients/consultations
  (el merge corre por definer; no se abren superficies nuevas).

### 6.5 Reversibilidad (DM7 ✅ cerrada)

- **Opción mínima (documental):** el log contiene todo lo necesario; deshacer
  es un procedimiento documentado ejecutado como nueva operación auditada.
- **Opción completa (formal):** RPC `admin_unmerge_patients(p_merge_log_id,
  p_reason)` que re-apunta de vuelta los IDs exactos del log, restaura la
  fuente desde el snapshot (incluido su documento, si no colisiona hoy) y
  marca el log como revertido. Solo revierte el **último** merge de esa ficha
  (cadenas se deshacen en orden inverso).

**✅ Decisión del owner (DM7, 2026-06-12): unmerge formal como diseño
objetivo.** El riesgo C1 (fusionar personas distintas) es lo bastante grave
como para que la reversa no dependa de un procedimiento manual bajo presión.
Criterios vinculantes:

- toda fusión deja log suficiente para revertir;
- motivo obligatorio + actor admin obligatorio;
- snapshots before/after;
- operación trazable de punta a punta;
- no hard-delete;
- rollback controlado mediante RPC.

La RPC `admin_unmerge_patients` puede aterrizar en una fase posterior si
agranda demasiado el primer PR de backend (F4-2), pero **el diseño del merge y
de su log nace con la reversibilidad formal prevista** — nada de lo que el
merge escriba puede imposibilitar el unmerge.

---

## 7. Límites de LucyAdmin (qué puede y qué NO puede hacer)

**Puede:**

- Buscar pacientes por teléfono/documento y ver **metadatos** de fichas
  (clínica, médico, conteos, fechas, estado de vínculo) para diagnosticar
  duplicados.
- Ejecutar preflight (dry-run) de cualquier par de fichas de una clínica.
- Fusionar fichas duplicadas **intra-clínica** con evidencia fuerte +
  motivo + confirmación.
- Deshacer un merge (si DM7 aprueba la RPC formal), con motivo y audit.
- Ver el historial de merges (`patient_merge_log`) y el audit asociado.

**NO puede:**

- Ver contenido clínico (texto de consultas, diagnósticos, recetas, vitales)
  — ni en el preflight ni en ninguna pantalla de esta herramienta (L4).
- Fusionar fichas de **clínicas distintas** (no es merge — es identidad).
- Fusionar fichas vinculadas a **profiles distintos** (`P0065` — requiere
  primero resolver la identidad, F4-D).
- Fusionar identidades (`profiles`/`auth.users`) en esta fase.
- Editar identidad global, credenciales ni contenido clínico "de paso" — el
  merge re-apunta y neutraliza, no edita.
- Hard-delete de nada.
- Tocar fichas no involucradas (la RPC opera exactamente sobre el par
  fuente/destino validado).

---

## 8. Mitigación quirúrgica del claim (DM2 — ✅ APROBADA, cerrada 2026-06-12)

Mientras el merge se diseña/construye, el hallazgo F4 sigue activo: **cada
login de un paciente con ficha duplicada-con-DUI pierde TODAS sus
vinculaciones en silencio**.

Propuesta (PR chico, independiente del merge, migración propia):

- `claim_patient_records` deja de vincular con un único UPDATE multi-fila y
  pasa a un **LOOP fila por fila** con `BEGIN/EXCEPTION WHEN unique_violation`:
  la ficha que colisiona **se salta** (y se registra en el resultado/audit
  como `skipped_unique_conflict`), las demás se vinculan normal.
- Resultado: la persona recupera sus atenciones de las demás clínicas/fichas;
  la ficha conflictiva queda visible como pendiente (y es justo el caso que
  el merge resolverá después).
- Sin cambio de firma ni de semántica para el caller; el hook fail-safe del
  login sigue igual.

No reabre B2 ni F3 — es hardening del mismo claim que `s7_43` ya reescribió,
contra un bug real reproducido.

**✅ Decisión del owner (2026-06-12): aprobado como primer PR real** después
de este docs-only. PR muy acotado, con migración propia + check + smoke.
Condiciones vinculantes:

- el claim vincula **fila por fila**; una colisión NO aborta el resto;
- las fichas que no se pudieron vincular **se registran y se devuelven** en el
  resultado y en audit (`skipped_unique_conflict`) — **el fallo no se esconde**;
- **NO hace merge** — ni automático ni implícito: solo tolera la colisión y la
  reporta; resolver el duplicado sigue siendo potestad del merge admin (F4-2+);
- no toca identidades, no resuelve duplicados, sin UI grande.

**No se arranca todavía** — DM1–DM9 ya están cerradas (2026-06-12); falta
únicamente la **señal explícita del owner** para arrancar este PR.

---

## 9. Propuesta por fases

| Fase | Contenido | Tipo | Riesgo |
|---|---|---|---|
| **F4-0** | Este diseño + decisiones DM1–DM9 validadas | docs-only | nulo |
| **F4-1** | Mitigación del claim (fila por fila tolerante, §8) — **✅ aprobada (DM2): primer PR real tras este docs-only.** DM1–DM9 cerradas; no arranca hasta la señal explícita del owner | migración chica + check + smoke | bajo |
| **F4-2** | Backend del merge: columnas `merged_into_patient_id`/`merged_at` + tabla `patient_merge_log` (**con reversibilidad formal de nacimiento — DM7 ✅**) + RPC `admin_merge_patients_preflight` + RPC `admin_merge_patients` + exclusión de fusionadas en el claim. `admin_unmerge_patients` acá, o en F4-2b si agranda demasiado el PR | migración + check + smoke OTP completo | medio-alto |
| **F4-3** | UI LucyAdmin: sección `/admin/pacientes` — búsqueda por teléfono/documento, detección de pares candidatos (mismo doc / mismo profile / mismo teléfono intra-clínica), comparación lado a lado (metadatos), preflight visual, confirmación con motivo, historial de merges. **Incluye la bandeja de `patient_link_rejections` como sección/tab separada (DM8 ✅); si agranda demasiado el PR, se separa como subfase F4-3b.** La bandeja NO bloquea F4-1 ni F4-2 | frontend-only | medio |
| **F4-D** | **Merge de identidades** (`profiles`/`auth.users`, escenarios E4/E5): diseño propio posterior. Hereda de este doc: §2.2, L3 (prueba de posesión / protocolo soporte), bloqueo de roles sensibles (si la identidad fuente es médico/asistente/admin → revisión manual, patrón `P0011`). Conecta con D7 (recuperación sin sesión) — probablemente convenga diseñarlos juntos | docs-only primero | alto |

Cada fase = PR chico, server-side primero, smoke+check por migración,
squash-merge, preview + OK visual para la UI — las reglas operativas de
siempre.

**Qué NO entra en ninguna fase de F4:** fusión de historia clínica entre
clínicas; edición de contenido clínico; herramienta self-service de merge
para médicos o pacientes; automatización (merge sin humano) — la detección
puede ser automática, la fusión siempre es decisión explícita de LucyAdmin.

---

## 10. Decisiones DM1–DM9 — ✅ CERRADAS por el owner (2026-06-12)

> Las 9 decisiones quedaron aprobadas formalmente. **La implementación
> (F4-1+) arranca SOLO con señal explícita del owner.**

- **DM1 — Alcance de F4. ✅ APROBADA.** F4 se limita a **merge de fichas
  `patients` intra-clínica**. Quedan FUERA de esta fase: merge de
  identidades (`profiles`), merge de `auth.users`, credenciales, roles,
  recuperación sin sesión y unión de expedientes cross-clínica. Regla
  central: cross-clínica **no es duplicado de expediente** — se resuelve por
  identidad global, no por fusión de ficha clínica (F4-D, diseño propio
  posterior).
- **DM2 — Mitigación del claim (§8). ✅ APROBADA.** Primer PR real
  recomendado tras el docs-only: claim tolerante **fila por fila**; una
  colisión NO aborta todo el claim; **reporta/registra las fichas no
  vinculadas** (el fallo no se esconde); **no hace merge automático**; no
  resuelve duplicados; no toca identidades; **migración propia + check +
  smoke**. **No arrancar hasta señal explícita del owner.**
- **DM3 — Evidencia mínima para fusionar. ✅ APROBADA.**
  **(a)** Documento igual o profile igual = evidencia fuerte de misma
  persona, siempre con dry-run + confirmación LucyAdmin + motivo
  obligatorio. Condiciones: documento **normalizado y no vacío**; NO se
  trata como match si hay **conflicto evidente de nombre/fecha/sexo** cuando
  esos datos existen; el **preflight muestra la evidencia usada**.
  **(b)** Teléfono+nombre sin documento = **BLOQUEADO en V1** (sin merge por
  "parecido razonable"; revisión manual / backlog de override futuro).
  **(c)** Consulta borrador abierta sobre la ficha fuente = **el merge se
  BLOQUEA** (no solo advertencia) — riesgo de merge a mitad de atención
  clínica.
- **DM4 — Regla de dirección. ✅ APROBADA.**
  **(a)** Si exactamente una ficha está vinculada a `profile_id` → esa es
  **obligatoriamente el destino** (la identidad la gobierna el
  paciente/LucyCare; no se mueve hacia una ficha local no vinculada).
  **(b)** Ambas vinculadas a profiles distintos → **bloqueo total** (posible
  conflicto de identidad — va a diseño futuro de identidad/recuperación, no
  a F4).
  **(c)** Ambas sin vincular → **LucyAdmin elige el destino**; el sistema
  puede sugerir (más antigua / más historial / datos más completos), pero la
  decisión es **explícita del admin y auditada**.
- **DM5 — Neutralización de la ficha fuente. ✅ APROBADA.** Neutralizada, no
  borrada: `document_number → NULL` + `profile_id → NULL` +
  `is_active = false` + `merged_into_patient_id` + `merged_at` + **snapshot
  previo completo en el log**; el **teléfono se conserva** como traza
  histórica; el **claim excluye fichas merged**; **no hard-delete**.
  `document_type` se conserva — no hace falta neutralizarlo: con
  `document_number = NULL` el UNIQUE (NULLS DISTINCT) deja de participar
  (§6.1); el mínimo obligatorio (liberar el UNIQUE sin perder snapshot) se
  cumple.
- **DM6 — Datos locales de la fuente. ✅ APROBADA.** V1 **NO copia** datos
  locales sueltos al destino: ni alergias, ni tipo de sangre, ni contacto de
  emergencia, ni notas, ni campos administrativos locales (menos magia,
  menos riesgo de contaminar el destino). La **historia clínica referenciada
  por tablas dependientes SÍ se mueve** según el diseño del merge (§6.1);
  los campos locales quedan **preservados en el log** y se revisan
  manualmente si hace falta.
- **DM7 — Reversa. ✅ APROBADA.** El diseño nace con **unmerge formal** como
  objetivo: log suficiente para revertir + **actor obligatorio** + **motivo
  obligatorio** + **snapshots before/after** + **no hard-delete** +
  **trazabilidad completa** + **rollback por RPC**. La RPC de unmerge puede
  diferirse si agranda demasiado F4-2, pero el diseño la deja **prevista
  desde el inicio** (§6.5).
- **DM8 — Bandeja de `patient_link_rejections`. ✅ APROBADA con alcance
  controlado.** Conceptualmente se absorbe en `/admin/pacientes` (misma
  categoría: salud de vínculos del paciente), idealmente como **sección/tab
  separada** dentro de F4-3. **No bloquea F4-1 ni F4-2.** Si agranda
  demasiado F4-3, entra como **subfase F4-3b**. Definición de fases
  ratificada: F4-1 = claim tolerante; F4-2 = backend merge + dry-run + log;
  F4-3 = UI `/admin/pacientes`.
- **DM9 — Teléfonos compartidos / menores. ✅ APROBADA.** Regla explícita de
  precaución (vinculante también para versiones futuras con override):
  **nunca fusionar solo por teléfono cuando los nombres difieren**; especial
  cuidado con menores, dependientes, familiares y teléfonos del responsable;
  el **teléfono compartido no prueba identidad**; la evidencia fuerte sigue
  siendo **documento/profile** (DM3). Con DM3(b) bloqueado en V1 el riesgo
  queda mitigado desde el inicio; la regla queda documentada en §6.2.

---

## 11. Dudas / supuestos no verificados

1. **Volumen real de candidatos a merge** en producción: no medido en esta
   pasada (sería una query read-only de diagnóstico: pares intra-clínica con
   mismo documento o mismo teléfono). El preflight de F4-2 lo vuelve
   trivial; si se quiere dimensionar antes, es un script chico (a pedido).
2. **Triggers del schema base sobre `patients`/`appointments`** anteriores a
   `s4_02`: el inventario de esta pasada cubrió las migraciones `s4_*..s7_*`
   y el schema base; en la implementación, el smoke debe confirmar que ningún
   trigger no inventariado bloquea el re-point (patrón ya usado en `s7_43`).
3. **`getOrCreatePatient` (booking)** se asumió como única fuente del
   escenario E3 (race). No se auditó su código en esta pasada; no cambia el
   diseño (E3 se maneja igual exista o no el race).
4. **Snapshots `consultation_amendments`** citan `patient_id` viejo tras un
   merge (T6): se asume aceptable como historia + log de merge para resolver
   la cadena. Si el owner prefiere anotarlos, sería un campo informativo
   adicional, nunca reescritura.

---

## 12. Relación con otros docs

- `docs/ANALISIS_PACIENTE_GLOBAL_OWNERSHIP.md` — marco D1–D7 (D6: merge solo
  LucyAdmin, dry-run/audit/criterios estrictos). Este doc ES el "diseño
  específico propio" que B1 exigía.
- `docs/ANALISIS_PACIENTE_GLOBAL.md` — Fases 1–5; el esbozo original de F4
  queda **superado por este diseño** (en particular: no hay merge
  cross-clínica de fichas).
- `docs/ANALISIS_ONBOARDING_IDENTIDAD_MULTIPLE.md` — identidad única; F4-D
  (merge de identidades) deberá ser coherente con ese modelo.
- Migraciones citadas: `s7_10` (documento nullable), `s7_20` (claim F1),
  `s7_28`/`s7_29` (inmutabilidad + bypass `app.amending`), `s7_31` (vitals),
  `s7_32` (identidad global + UNIQUE parcial), `s7_33` (guard P0030 + sync +
  copia en claim), `s7_35`/`s7_40` (F5 dedup preventivo), `s7_43` (B2 +
  claim vigente).
