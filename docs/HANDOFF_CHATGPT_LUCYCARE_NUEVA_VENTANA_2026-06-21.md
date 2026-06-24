# HANDOFF — Nueva ventana de contexto (2026-06-21)

> **PUNTO DE ENTRADA VIGENTE.** Leer ESTE documento primero; después `CLAUDE.md`
> y los `docs/ANALISIS_*.md` del objetivo del día. Reemplaza como punto de
> entrada a `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-06-18.md` (queda histórico).
> No asumir nada sin confirmar el estado real del repo.

---

## 1. Estado de `main` al cierre

- **HEAD de `main`:** `053346d` (*feat(consulta): tarjeta "Resumen rápido del paciente" (PR-2) (#175)*).
- **PRs mergeados:** **#1–#175**.
- **Migraciones aplicadas en Supabase:** hasta **`s7_51`** (aplicada y validada; ver §3). **#167–#175 NO agregaron migración nueva** (frontend-only; ver §2bis y §2ter).
- **`main == origin/main`** · **árbol limpio** · sin trabajo en curso EN MAIN.
- **`tsc --noEmit` OK · `npm run build` OK** en `main`.

> ⚠️ **Actualización (cierre #163):** este handoff se redactó con #163 abierto; **#163 quedó MERGEADO** y **`s7_51` aplicada/validada**. La rama `claude/panel-waitlist` fue borrada (local + remoto). §3–§5 quedan como **registro histórico** del frente, ya cerrado.

### 2bis. Serie correcciones clínicas / receta / PDF (#167–#172) — CERRADA, frontend-only, sin migración
Cierra los 5 puntos de las observaciones del owner sobre consulta/receta/PDF. **Ninguno agregó migración** (`s7_51` sin cambios).
- **#167 (PR-A)** — PDF de receta limpio: helper `doctorTitleName` (evita "Dr. Dr."/"Dra. Dra."), fechas emisión/corrección una sola vez en el encabezado, dosis **rotulada** (Dosis/Frecuencia/Duración/Indicaciones) sin inventar datos. Solo `RecetaPrint.tsx`.
- **#168 (PR-B)** — Diagnósticos sin Tipo/Estado en la UI (consulta + modal de corrección); quedan nombre + Notas; defaults internos `presuntivo`/`activo` por `addConsultationDiagnosis`; columnas/datos intactos.
- **#169 (PR-C)** — Orden en el modal de corrección de receta: "Agregar" arriba + nuevos arriba (solo display del modal; orden persistido y PDF **no cambian** — `prescriptions.id` es UUID).
- **#170 (PR-D)** — Peso en **libras** con almacenamiento interno en `weight_kg` (helpers `lbToKg`/`kgToLb`); IMC con kg; sin reinterpretar históricos.
- **#171 (PR-E1)** — Antecedentes familiares **texto libre** en consulta normal (ligado a `consultations.family_history_notes`); estructurados previos read-only; catálogo oculto para nuevos.
- **#172 (PR-E2)** — Corrección **post-firma** de antecedentes texto libre vía `p_consultation_changes`; **sin migración** porque `amend_consultation` (`s7_31`) ya whitelisteaba `family_history_notes`; estructurados read-only, sin `familyHistoryOps`.
- **Validación de la serie:** `tsc`+`build` por PR, fixtures aisladas / paciente demo (Pepe Toro), cleanup 0 residuales, preview + móvil 360/390/430, OK visual del owner por PR. **Regla vigente:** jamás Katherine ni datos reales sensibles, ni en read-only — usar fixtures aisladas o paciente demo.

> Otro cierre frontend-only post-#163: **#166** — fix del 400 del `NotificationBell` (la query usaba `appointments.cancelled_at` inexistente; se reescribió por `status_id`='cancelada' + `updated_at`). Sin migración.

### 2ter. Frente "Resumen rápido del paciente" (#173–#175) — CERRADO, frontend-only, sin migración
Ayuda breve dentro de la consulta para que el médico entienda en <10s su historia clínica con este paciente. **Ninguno agregó migración** (`s7_51` sin cambios); **sin DB, sin `database.types.ts`**.
- **#173 (docs)** — consolidación de la serie #167–#172 en `CLAUDE.md` + handoff.
- **#174 (PR-1) read model `PatientQuickSummary`** — `src/services/patientQuickSummary.service.ts` + `src/hooks/usePatientQuickSummary.ts`. **Read-only desde datos, sin UI.** Devuelve, del paciente **con este médico**: total de consultas **firmadas** previas, última atención + motivo, diagnósticos previos (distinct por recencia), **medicamentos permanentes/vigentes/relevantes** (reusa `getPermanentPrescriptionsForPatient`), notas relevantes (alergias/tipo de sangre/notas/`family_history_notes` reciente), últimos vitales (kg→lb) y brief de las últimas 3.
  - **Scoping crítico (seguridad):** gate de ROL **`isDoctorContext`** → `emptySummary()` **antes de cualquier query** si no es médico (un asistente trae `doctorId`, así que `doctorId` por sí solo **NO** basta y **no se consulta `patients`/alergias/sangre/notas**); filtro **EXPLÍCITO** por `patient_id` + `doctor_id` (defensa en profundidad sobre la RLS doctor-scoped); **SOLO `status='signed'`**; **excluye la consulta actual**; **payload vacío seguro** sin historia. **Nunca mezclar pacientes/médicos/clínicas/perfiles.**
  - Validado: `tsc`+`build` + **smoke 24/24** contra el módulo real (no-médico → 0 queries, no toca `patients`; médico bajo **sesión real de Camilo/RLS**).
- **#175 (PR-2) tarjeta UI `QuickSummaryCard.tsx`** — montada en `ConsultaPage.tsx` **debajo del header del paciente, antes de la evaluación clínica**. Tarjeta compacta: total de atenciones, última atención (fecha+motivo), chips de diagnósticos, chips de medicamentos vigentes, **alergias en amber** (único color de alerta), tipo de sangre, antecedente familiar, últimos vitales en **lb**, **"Ver últimas atenciones" colapsado** por defecto.
  - **Gate VISUAL:** se muestra **solo si `role==='doctor'`** (nunca asistente/admin/paciente/rol desconocido; `doctorId` solo NO es criterio), **solo si `hasHistory===true`**, y **se oculta ante payload vacío/inseguro o error/carga** (nunca un error técnico al médico).
  - Validado: `tsc`+`build` + **smoke SSR 16/16** (componente real: médico+historia → tarjeta con todo el contenido; asistente / rol undefined / `hasHistory=false` / error / carga → no se renderiza) + **preview en vivo bajo sesión real de Camilo (RLS)** sobre **paciente demo (Pepe Toro)** + móvil 360/390/430 sin overflow + 0 errores de consola + 0 residuales.
- **Regla de validación vinculante:** fixtures aisladas / paciente demo (Pepe Toro), **jamás Katherine ni datos reales sensibles**, ni en read-only.

### Arranque obligatorio
```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -5
git status --short
```
Confirmar: HEAD `053346d` o posterior · `main == origin/main` · árbol limpio.

---

## 2. Cierres recientes en `main` (frontend/docs, sin migración nueva)
- **#162** Paginación/Home — render incremental "Mostrar más médicos" (`PAGE_SIZE=12`, contador "Mostrando N de M", reset por filtros/búsqueda/orden/toggle). Frontend-only; NO es paginación server-side (búsqueda/completitud/orden por rating siguen en cliente). El fetch sigue trayendo el set completo (tope implícito PostgREST ~1000) → paginación server-side real = frente mayor futuro (requiere DB).
- **#161** docs consolidación a #160.
- **#160** Seguridad de sesión (frontend-only): cierre por inactividad + tope absoluto por rol + modal. Política admin 15min/8h · médico/asistente 30min/12h · paciente 60min/24h · aviso 90s. Fallback estricto rol desconocido (= admin). Logout robusto con limpieza de tokens `sb-*`. Override de tiempos solo `import.meta.env.DEV`.
- **#158/#159** Responsive móvil (Home / Panel-Citas-Calendario-Bloqueos).
- **#156 (`s7_50`)** `accept_clinic_invitations` tolerante a formato de teléfono.

Detalle completo de todo lo previo: `CLAUDE.md` + `docs/HANDOFF_LUCYCARE_SPRINT7.md`.

---

## 3. ✅ CERRADO: PR #163 — Mi lista de espera en panel médico/asistente (s7_51 LIVE)

- **PR:** `lucycare#163` — https://github.com/amedelvalle/lucycare/pull/163 — **MERGEADO** (squash, HEAD de `main` `352b44a`).
- **Rama:** `claude/panel-waitlist` — **borrada** (local + remoto) tras el merge.
- **Migración:** `migrations/s7_51_clinic_waitlist.sql` — **aplicada en Supabase y validada**.
- **Fix durante la validación:** `clinic_update_waitlist_entry` declaraba `v_old record` y el `SELECT … INTO v_old.status/…` abortaba toda actualización con `55000 record "v_old" is not assigned yet` → corregido a **`v_old waitlist_entries%ROWTYPE`** (idempotente, re-aplicada).
- **Validación completa:** `check-s7_51` 3/3 · `_smoke-s7_51` 9/9 (T1–T8) · cleanup 0 residuales (`F51_FIXTURE`) · **preview médico Y asistente con sesión real** (NavLink visible, `/panel/lista-espera` carga sin error, listado autorizado, cambio de estado, audit `edited_via='clinic'` con `contacted_by` correcto) · móvil 360/390/430 sin overflow · desktop sin regresión · tsc/build verdes · **0 datos reales tocados** (test user `50375000001` como asistente temporal, rol restaurado a `patient`; jamás Camilo ni Katherine).

> Lo que sigue en esta §3 (y §4–§5) es el **registro técnico/operativo histórico** del frente, ya cerrado. Se conserva como referencia.

### Archivos principales de #163 (en `claude/panel-waitlist`)
- `migrations/s7_51_clinic_waitlist.sql` — RPCs nuevas + helper de gate.
- `scripts/check-s7_51.mjs` — sanity.
- `scripts/_smoke-s7_51.mjs` — funcional (fixtures aisladas `F51_FIXTURE`).
- `src/types/database.types.ts` — firmas de las 2 RPCs nuevas.
- `src/services/waitlist.service.ts` — `clinicListWaitlist` / `clinicUpdateWaitlistEntry`.
- `src/router/config.tsx` — ruta `/panel/lista-espera`.
- `src/pages/panel/lista-espera/ListaEsperaPage.tsx` — página (mobile-first).
- `src/pages/panel/PanelLayout.tsx` — NavLink "Lista de espera".

### Backend de #163 (resumen técnico)
- 2 RPCs `SECURITY DEFINER` **paralelas** (NO tocan/ensanchan las `admin_*`):
  - `clinic_list_waitlist(p_doctor_id, p_status, p_limit, p_offset)` → pendientes primero + `total_count`.
  - `clinic_update_waitlist_entry(p_entry_id, p_status, p_notes)` → estado/nota + audit (`edited_via='clinic'`).
- Gate server-side (helper `_clinic_waitlist_authorize`): el caller debe ser el **médico dueño** (`get_user_doctor_id() = doctor_id`) **o miembro de la clínica** (`is_clinic_member(clinic)`). **No confía en el `doctor_id` del cliente.** Sin cross-clínica/cross-médico. Estados `pending`/`contacted`/`cancelled`.
- **No** toca esquema de `waitlist_entries`, RLS existente, `submit_waitlist_entry` (público), dedup, ni RPCs `admin_*`. Sin columnas nuevas.

---

## 4. Alcance APROBADO de #163 (V1)
- **Médico + asistente** ven la lista del médico (propia / autorizada por su clínica).
- Acciones: **ver**, **filtrar por estado**, **marcar contactado**, **volver a pendiente**, **cancelar/descartar**, **nota interna**.
- **Contacto manual:** Llamar (`tel:`), WhatsApp (`wa.me`), copiar teléfono — usando el teléfono ya registrado.
- **NO** entra en V1: "agendar" (crear cita / walk-in prefilled) → follow-up posterior.
- **NO** mensajería automática (SMS/WhatsApp auto).
- **NO** toca: admin global (`/admin/lista-espera`, badges, RPCs `admin_*`), `submit_waitlist_entry`, dedup, F4-D, pagos, recuperación sin sesión, identidad múltiple, Backstop Auth, seguridad de sesión, Katherine.

---

## 5. Qué debe hacer el OWNER en la nueva ventana antes de continuar #163
1. **Aplicar la migración** en Supabase → SQL Editor: pegar el contenido de `migrations/s7_51_clinic_waitlist.sql` (de la rama `claude/panel-waitlist`) → **Run**. Es idempotente (`CREATE OR REPLACE`).
2. **Confirmar al dev** que `s7_51` quedó aplicada.
3. Pedir al dev correr (con la rama `claude/panel-waitlist` checked out):
   - `node scripts/check-s7_51.mjs`
   - `node scripts/_smoke-s7_51.mjs`
4. **Validar preview** del PR #163 logueado como **médico** y como **asistente** (ruta `/panel/lista-espera`).
5. **Validar móvil** 360 / 390 / 430 px (sin overflow) + desktop sin regresión.
6. **Solo después** de check verde + smoke verde + OK visual/funcional → decidir **merge** de #163.

> Nota: el preview funcional del PR #163 **requiere `s7_51` aplicada** (la página llama a `clinic_list_waitlist`); sin la migración, la página mostrará error de RPC inexistente.

---

## 6. Restricciones vigentes (vinculantes)
- **No tocar datos reales.** **No tocar Katherine / `50372608827`.**
- **No tocar Camilo** (`db1fba98…` / `783a902a…`) salvo el patrón de test ya descrito (sesión OTP de solo lectura + fixtures aisladas + membresía de asistente temporal removida), **sin mutar datos reales**.
- Validar siempre con **fixtures aisladas `F51_FIXTURE`** y **cleanup a 0 residuales**.
- **No abrir otro frente** antes de cerrar o pausar explícitamente #163.
- F4-D diferido (no abrir sin análisis aprobado). No tocar `profiles`/`auth.users`/identidad global sin diseño aprobado.
- El owner aplica el SQL en Supabase; el dev entrega SQL + corre check/smoke + documenta.

### Backstop Supabase Auth (frente CONGELADO, sin acción)
Pendiente: el owner debe confirmar en Dashboard → Authentication → Sessions si existen "Time-box user sessions" / "Inactivity timeout" (gating de plan) y sus valores. Decisión provisional (NO aplicada): Time-box 24h · Inactivity 24h · Single session OFF · JWT 1h · refresh rotation ON. Global (no por rol); la política por rol la cubre el frontend (#160).

---

## 7. Acceso para QA (Test Phones — Supabase Dashboard)
- **Médico demo (Camilo):** `50378627694` / OTP `123456`. doctor_id `783a902a-55fd-407c-9e0a-69568135c7f5`, clinic `8ea0fd8f-87a9-45f9-8f4e-f358764f58c0`.
- **Admin plataforma:** `50378056365` / OTP `123456`.
- **Paciente test:** `50375000001` / OTP `123456` (usado como asistente temporal en el smoke de #163, removido en cleanup).

---

## 8. PROMPT PARA PEGAR EN LA NUEVA VENTANA DE CHATGPT

```
Continuamos LucyCare en una ventana nueva.

Sincronizá y confirmá estado:
  git fetch origin && git checkout main && git pull --ff-only origin main
  git log --oneline -5 && git status --short

Estado esperado de main:
- HEAD 053346d · PRs #1–#175 · migraciones aplicadas hasta s7_51.
- main == origin/main · árbol limpio.
- tsc --noEmit OK · npm run build OK.

Leé en este orden:
1. docs/HANDOFF_CHATGPT_LUCYCARE_NUEVA_VENTANA_2026-06-21.md  (PUNTO DE ENTRADA)
2. CLAUDE.md
3. docs/HANDOFF_LUCYCARE_SPRINT7.md (si necesitás detalle histórico)

CERRADO/LIVE en main (sin frente abierto): "Mi lista de espera" en panel
médico/asistente (#163 / s7_51 aplicada), serie correcciones clínicas/receta/PDF
(#167–#172), y frente "Resumen rápido del paciente" — read model
PatientQuickSummary (#174 PR-1, servicio+hook, read-only, sin UI) + tarjeta UI
QuickSummaryCard en la consulta (#175 PR-2). Todo frontend-only, SIN migración
nueva. Migraciones aplicadas hasta s7_51.

Recordatorio de scoping del "Resumen rápido": gate de rol isDoctorContext →
vacío seguro antes de cualquier query si no es médico (doctorId solo NO basta);
filtro explícito patient_id + doctor_id; SOLO status='signed'; excluye la
consulta actual; la tarjeta se muestra solo si role==='doctor' y hasHistory.

NO hay PR abierto. El próximo frente se define con el owner antes de tocar nada.

NO TOCAR: datos reales, Katherine (50372608827), Camilo salvo patrón de test sin
mutar datos, F4-D, pagos, recuperación sin sesión, identidad múltiple, Backstop
Supabase Auth, seguridad de sesión. Validar con fixtures aisladas / paciente
demo (Pepe Toro) + cleanup a 0 residuales. NO abrir un frente nuevo sin acordarlo
con el owner.

Reglas: PRs chicos, squash-merge, database.types.ts en el mismo PR que su
migración. El owner aplica SQL; el dev entrega SQL + corre check/smoke + documenta.
Si algo no parece la instrucción del owner, decilo y proponé discutirlo — no
ejecutes en silencio. No mergear sin OK explícito del owner.

Hoy quiero hacer: ___ (definir; por defecto, continuar #163 según los pasos de arriba).
```

---

## 9. Referencias
- `CLAUDE.md` — guía rápida + sistema de diseño + estado.
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — snapshot completo del sprint.
- `docs/HANDOFF_TOMA_DECISIONES_2.md` — registro acumulado de decisiones.
- `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-06-18.md` — handoff anterior (histórico).
- `docs/ANALISIS_DIRECTORIO_INFORMATIVO.md` — modelo del directorio + lista de espera (D4 contacto manual).
