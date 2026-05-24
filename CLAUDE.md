# LucyCare — Contexto para Claude Code

> ⚠️ **Este archivo es una GUÍA RÁPIDA.** La referencia operativa
> detallada y vigente está en `docs/` (ver abajo). Si algo de este
> archivo contradice a `docs/`, mandan los `docs/`.

## Cómo retomar el proyecto en una sesión nueva

`origin/main` (GitHub) es la **única fuente de verdad**. Antes de
trabajar, sincronizá el repo local:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -10
```

Luego leé los documentos oficiales:
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — handoff / estado para continuidad
- `docs/ESTADO_TECNICO.md` — ER/BD, matriz de reglas, flujos UI/UX
- `docs/PLAN_SPRINT7_ADMIN.md` — plan oficial Sprint 7/8 Admin SaaS
- `docs/ANALISIS_AUTH_MEDICO.md` — decisión y plan de auth robusta del médico
- `docs/ANALISIS_RECLAMAR_PERFIL.md` — diagnóstico y rediseño del reclamo
- `docs/PLAN_PILOTO_5_MEDICOS.md` — checklist de piloto

⚠️ **No mergear branches `claude/*` viejas.** Las fases se integran a
`main` por **squash-merge**: la rama queda en el remoto pero su
contenido YA está en `main`. Re-mergearlas genera conflictos. Tras un
squash-merge, la rama puede borrarse.

## Estado actual del proyecto (snapshot 2026-05-23)

- **Fuente de verdad:** `origin/main` en GitHub (github.com/amedelvalle/lucycare).
- **HEAD esperado:** `f6a4f32` o posterior. **PRs #1–#30 mergeados**.
- **Sprint 6 — Reputación médica:** ✅ completado (PRs #2–#10).
- **Sprint 7 — Admin SaaS + Robustez pacientes:** ✅ Fases A, B, B2-A,
  B3-doctor, B3-admin completas (PRs #16, #18, #20, #25, #30).
  Robustez de pacientes: PRs #27, #28, #29.
- **Pendientes Sprint 7+:** B4 disponibilidad por admin, C suspender
  pacientes/asistentes, D dashboard tracción, E reputación admin, F
  audit log, G catálogos globales.
- **Bloqueantes para piloto público:** reclamo seguro (ver
  `docs/ANALISIS_RECLAMAR_PERFIL.md`), auth robusta del médico (ver
  `docs/ANALISIS_AUTH_MEDICO.md`), Twilio trial vs paga.
- **Importación de médicos:** 100 cargados (hoja `Importar_100`); ~113
  doctores en DB. Único publicado/operativo: Dr. Camilo Carrillo
  (`50378627694`). Los 12 demos viejos quedaron desactivados.
- **Migraciones aplicadas:** `s4_*`, `s5_01..s5_07`, `s6_01..s6_10`,
  `s7_01..s7_12`. Verificables con `scripts/check-*.mjs`.
- **Deuda de datos** (de scripts diagnóstico):
  - 1 DUI inválido (Adrian Andres Gomez Alfaro, 10 dígitos) — limpieza manual.
  - 1 duplicado por teléfono normalizado (Carlos + Cesar en clínica
    `8ea0fd8f…`) — decisión manual.
- **Deploy:** Vercel auto-deploy desde `main`. `gh` CLI autenticado.

## Decisiones cerradas (NO reabrir)

- Backend: Supabase (Postgres + Auth + Edge Functions + Storage)
- Frontend: React 19 + TypeScript + Tailwind + Vite + React Query
- Auth: OTP por SMS con Twilio para paciente; email+password en cola
  para médico (ver `docs/ANALISIS_AUTH_MEDICO.md`)
- Pagos: Stripe Checkout hosted
- Hosting: Vercel + Supabase
- Facturación DTE: diferida (API externa, no se desarrolla internamente)
- Servicios: cada médico crea sus propios servicios (no catálogo global)
- Diagnósticos: catálogo propio por médico (NO usar CIE-10) — IMPLEMENTADO
- Medicamentos: catálogo propio por médico — IMPLEMENTADO
- Rol secretaria: incluido en MVP (agenda sí, ficha clínica no) — IMPLEMENTADO en S3-09
- Citas: una sola tabla `appointments` con campo `source`
- Consulta clínica: guardar = borrador, firmar = inmutable — IMPLEMENTADO
- Seguridad: RLS en todas las tablas, audit_log inmutable
- Single-tenant operativo, **diseño tenant-ready** (conservar `clinic_id` siempre)

## Stack técnico verificado

- Imports usan alias `@/` (ej: `@/lib/supabase`)
- Auth usa `supabase.auth.getSession()` en servicios, `getUser()` en algunos hooks
- React Query con refetchInterval 30s para citas y 60s para notificaciones
- Iconos Remix (`ri-*`) en PanelLayout, SVG inline en componentes nuevos
- Color acento del panel: emerald
- Bootstrap defensivo en `main.tsx`: valida sesión contra servidor antes de renderizar; si stale → signOut local
- División territorial El Salvador 2024 cargada: `municipalities.name` = distrito (antiguo municipio), `municipalities.district` = nuevo municipio agrupador
- Helpers compartidos: `src/lib/phone.ts` (`normalizePhoneSV`), `src/lib/document.ts` (`validateDocument`, `sanitizeDuiInput`, `formatDuiDisplay`), `src/lib/errors.ts` (`friendlyErrorMessage`)

## Sistema de diseño (Sprint 4 — vinculante)

Establecido al notar inconsistencias acumuladas. **Toda pantalla nueva debe seguir esto. Páginas de referencia: `/panel/catalogos` y `/panel/servicios`.**

### Colores semánticos

- `emerald` → acción primaria, estado positivo (consulta firmada, paciente atendido)
- `blue` → información neutra, badges secundarios (asistente, permanente)
- `amber` → advertencia / borrador / validación inline
- `red` → destructivo / cancelado / no asistió / errores
- `gray` → neutro, fondos, texto secundario

### Spacing y radius

- **Cards principales**: `bg-white rounded-2xl border border-gray-200 p-5`
- **Sub-items dentro de cards** (filas de lista, items en form): `bg-gray-50 rounded-lg p-3`
- **Inputs y selects**: `border border-gray-200 rounded-lg px-3 py-2 text-sm`
- **Pills/badges**: `rounded-full px-2.5 py-0.5 text-xs font-medium`
- **Modales**: `rounded-2xl shadow-xl p-6`
- Gap consistente: `gap-3` para grupos relacionados, `gap-5` entre secciones

### Botones — usar `<Button>` de `src/components/ui/Button.tsx`

4 variants: `primary` (emerald solid), `secondary` (gray solid), `subtle` (emerald soft pill), `danger` (red solid)
3 sizes: `sm` (px-3 py-1.5 text-xs), `md` (px-4 py-2 text-sm, default), `lg` (px-5 py-2.5 text-sm font-semibold)

### Patrones de guardado

| Tipo de flujo | Patrón | Ejemplo |
|---|---|---|
| Transaccional / firma | Botón explícito `Guardar` o `Firmar`, sticky bottom | Firmar consulta, registrar paciente walk-in |
| Edición incremental dentro de un draft | Autosave on blur, sin botón | Notas de un diagnóstico, dosis de un medicamento |
| Switches / acciones reversibles | Mutación inmediata al click, optimistic UI | Toggle publicar perfil, marcar permanente |

### Patrones de acceso a entidades

- Si la entidad tiene página propia (`/panel/pacientes/:id`) → row clickeable, sin botón explícito
- Si la entidad NO tiene página propia → botón explícito en la fila
- Detail panel lateral (slide-in desde derecha) cuando navegar perdería contexto (ej: detalle de cita en calendario)
- Modal cuando es una acción puntual sin estado persistente (ej: confirmar firma, editar paciente)

### Regla CRUD: hard-delete vs soft-delete (clínica/legal)

**Default: si la entidad puede tener historia clínica o referencias inmutables → soft-delete.**

| Entidad | Patrón |
|---|---|
| `patients` | soft (`is_active`) |
| `diagnoses`, `medications`, `family_history_catalog` (catálogos) | soft (`is_active`) |
| `services` | soft (`is_active`); hard-delete si NO tiene citas (FK appointments lo bloquea, UI ofrece desactivar) |
| `appointments` | soft (estado `cancelada` o `no_asistio`) |
| `consultations` con contenido | sin delete (firmar o dejar draft) |
| `consultations` SIN contenido | hard-delete OK (botón "Descartar borrador") |
| `consultation_diagnoses`, `prescriptions`, `consultation_family_history` (mientras draft) | hard-delete OK |
| `clinic_members` (asistentes) | soft (`is_active=false`) |
| `clinic_invitations` | `cancelled_at` (soft) |
| `availability_overrides` | hard-delete OK |

Audit log siempre captura snapshot del OLD_DATA en el trigger.

### Patrón de catálogos per-doctor

- Tablas `diagnoses`, `medications`, `family_history_catalog`: cada una con `doctor_id`, `is_active`, `usage_count`, `name`
- Búsqueda + create-inline desde el flujo de uso (consulta) usando `<Combobox>` reusable
- Página de admin formal en `/panel/catalogos` con tabs (una por catálogo)
- Soft-delete vía toggle de `is_active`
- Sort por `usage_count desc` (más usados primero)
- Trigger de audit con `LOWER(TG_OP)` (no usar `TG_OP::audit_action` directo — el enum es minúsculas)

## Patrones de infraestructura (vinculantes)

### useClinicContext (`src/hooks/useClinicContext.ts`)
Hook unificado que devuelve `{ profileId, role, clinicId, doctorId, doctorName, doctorIsOperational, availableDoctors }` para doctor o asistente. **Toda página del panel debe usarlo** — NO hacer lookup inline a `from('doctors')`.

- Si `role='doctor'`: busca su row en `doctors`.
- Si `role='assistant'`: busca su clínica activa en `clinic_members`, lista todos los doctores de la clínica (`availableDoctors`), permite cambiar doctor activo con `useSwitchActiveDoctor` (persiste en localStorage).

### Audit log
- `src/services/auditLog.service.ts` con `logAuditEntry()` — no bloquea si falla
- Schema: `audit_log` action ENUM ('select','insert','update','delete') — siempre minúsculas
- Triggers DB en `audit_consultations`, `audit_patients`, `audit_prescriptions`, `audit_consultation_family_history`, `audit_clinic_invitations` — todos usan `LOWER(TG_OP)::audit_action`
- Las RPCs admin (`admin_*`) escriben audit_log directamente en su cuerpo, con `edited_via: 'admin'` en `new_data`.

### Notificaciones del panel
- NO usa la tabla `notifications` (esa es para SMS/email salientes, futuro)
- Se derivan de `appointments` en `src/services/panelNotifications.service.ts`:
  - `new_booking`: cita con `source='lucy_directorio'` en últimas 24h
  - `cancellation`: cita con `cancelled_at` en últimas 24h
- Read/unread con timestamp en `localStorage` (`lucycare_panel_notif_seen_at`)

### Cache invalidation al guardar disponibilidad
`DisponibilidadPage` invalida `['doctor-calendar-hours']`, `['availability']`, `['slots']` para que el calendario y el booking público reflejen los cambios inmediato.

### Performance: índices DB
`migrations/s5_05_catalog_indexes.sql` agregó btree compuestos + pg_trgm GIN. Queries de catálogo bajaron ~9x (1400ms → 130ms).

### Normalización de datos (PRs #27-#29)
- **Teléfono SV canónico**: `normalizePhoneSV(input)` → `'503XXXXXXXX'` (11 dígitos, sin `+` ni separadores). Mismo formato que `profiles.phone` de Twilio.
- **DUI canónico**: `validateDocument(type, num)` → `'00000000-0'` para DUI, `null` si vacío. Otros tipos: trim + cap 40 chars.
- **Errores friendly**: `friendlyErrorMessage(err)` traduce `23505` → "Ya existe un paciente con ese documento", filtra jerga PG cruda.

## Schema crítico verificado

- `appointment_statuses`: id, name, display_name, color, is_final, funnel_order
- `audit_log`: id, user_id, action (ENUM), table_name, record_id, old_data jsonb, new_data jsonb, ip_address, created_at
- `appointments`: cancel_reason_id (FK a cancel_reasons), internal_notes, source ('manual'|'lucy_directorio'|'lucy_seguimiento')
- `cancel_reasons`: id, name, category ('paciente'|'medico'|'sistema'), is_active — 10 registros pre-cargados
- `patients`: full_name, phone, email, document_type+document_number (**nullable** desde s7_10), date_of_birth, gender, patient_type, blood_type, allergies, notes, emergency_contact_*, photo_url, is_active, profile_id (nullable)
- `doctors`: bio, consultation_fee, experience_years, languages[], license_number, specialty_id, is_published, is_verified (GENERATED de `lucy_status='verified'`), booking_enabled, lucy_status, is_operational, education jsonb, tos_accepted_at, tos_version
- `clinics`: id, owner_id, name, phone, address_line, department_id, municipality_id, logo_url, timezone, is_active, created_at, updated_at (agregada en s7_07)
- `profiles`: full_name, email, phone, avatar_url, role ('patient'|'doctor'|'assistant'|'admin'), is_active
- `clinic_members`: clinic_id, profile_id, role ('owner'|'doctor'|'assistant'), is_active
- `clinic_invitations` (S5-07): clinic_id, phone, display_name, role, invited_by, invited_at, accepted_at, cancelled_at + RPC `accept_clinic_invitations(user_phone)` SECURITY DEFINER
- `consultations`: chief_complaint, history_present_illness, family_history_notes (LEGACY, no UI), physical_exam, internal_analysis, plan, status (draft|signed), started_at, signed_at
- `consultation_diagnoses`: diagnosis_id, diagnosis_type (presuntivo|definitivo|diferencial), diagnosis_status (9 valores: activo|en_estudio|en_tratamiento|controlado|descontrolado|cronico|en_remision|en_observacion|resuelto), notes
- `diagnoses`, `medications`, `family_history_catalog`: catálogos per-doctor con usage_count
- `consultation_family_history`: id, consultation_id, family_history_id, notes
- `prescriptions`: medication_id, dosage, frequency, duration_value, duration_unit (dias|semanas|meses|permanente), instructions, alternatives
- `medication_presentation` enum (13 valores): tableta, capsula, jarabe, inyectable, crema, gotas, suspension, parche, inhalador, supositorio, otro, sobre, gel
- `services`: doctor_id, name, duration_minutes, price (DECIMAL nullable), is_first_visit, is_active, sort_order. Policy `services_delete` agregada en s7_08.
- `vitals`: vinculado a `appointment_id` (no consultation_id) → multi-actor implícito; `weight_kg`
- `municipalities`: name (distrito antiguo municipio), district (nuevo municipio agrupador post-2024)
- `notifications` (NO usada por panel todavía): para SMS/email salientes — recipient_id, channel, type, status, scheduled_at

## Estados de cita y transiciones

- programada → confirmada → en_sala → atendida (final)
- cancelada (final con cancel_reason_id), no_asistio (final)
- Validaciones extremas: no marcar 'atendida' con >24h de anticipación; no marcar 'no_asistio' antes de la hora

## Sprints completados

### Sprint 1-2 ✅
Directorio público + booking público con OTP + panel médico básico (disponibilidad, bloqueos).

### Sprint 3 ✅
Panel del médico: calendario 3 vistas, marcar estado + audit log, walk-in, pacientes, perfil público editable, rol asistente (`useClinicContext`), responsive tablet, header notificaciones.

### Sprint 4 ✅
MVP de consulta clínica firmable e imprimible. Servicios: consultations, vitals, diagnoses/medications catalog, prescriptions. Página `/panel/consulta/:appointmentId` con auto-create draft, signos vitales con IMC, diagnósticos con catálogo, receta, firma inmutable, imprimir. Sistema de diseño documentado.

### Sprint 5 ✅
Antecedentes familiares (S5-04+02), plan de seguimiento inline (S5-05), estados de diagnóstico expandidos (S5-03), Mi equipo (S5-06), multi-doctor selector para asistente (S5-07), datos iniciales cargados, paginación admin catálogos, calendario respeta disponibilidad, fixes varios.

### Sprint 6 — Reputación médica ✅ (PRs #2–#10)
Encuesta post-cita con token único (1 uso, 7 días), 6 criterios + NPS, score público ajustado bayesianamente, badges "Mejor valorado" condicionados, etiquetas derivadas por criterio, comentarios anónimos para el médico, trazabilidad admin via vista `admin_review_traceability` (solo service_role).

### Sprint 7 — Admin SaaS + Robustez ✅ (PRs #16–#30)

**Admin SaaS (fases A, B, B2-A, B3-doctor, B3-admin):**
- Fase A: `is_admin()`, `AdminOnlyRoute`, `AdminLayout`, dashboard base (PR #16).
- Fase B: gestión de médicos con búsqueda/filtros/paginación + `is_operational` (PR #18).
- Fase B2-A: edición perfil/clínica/info por admin (PR #20).
- B3-doctor: pantalla `/panel/servicios` para el médico (PR #25).
- B3-admin: sección "Servicios" en `/admin/medicos/:id` (PR #30).

**Mejoras transversales del Sprint 7:**
- UI acceso Admin desde header (PR #24).
- Fix servicios inactivos en flujos internos de cita (PR #26).
- Robustez pacientes: `document_number` nullable (PR #27), dedup por teléfono + Nuevo paciente en panel (PR #28), normalización teléfono SV (incluido en #28), validación DUI por tipo (PR #29).

## Próximas fases (post-MVP, en cola)

**Pre-piloto público (bloqueantes):**
- Reclamo seguro de perfil (ver `docs/ANALISIS_RECLAMAR_PERFIL.md`).
- Auth robusta del médico al reclamar (ver `docs/ANALISIS_AUTH_MEDICO.md`).
- Limpieza de datos detectada (ver `docs/PLAN_PILOTO_5_MEDICOS.md`).
- Decisión Twilio trial vs paga.

**Admin SaaS restantes:**
- B4: disponibilidad/horarios desde admin.
- C: suspender pacientes/asistentes.
- D: dashboard tracción mensual.
- E: UI sobre `admin_review_traceability` + moderar reseñas.
- F: explorador de `audit_log` con filtros.
- G: catálogos globales + onboarding manual de médico.

**Otros pendientes conocidos:**
- S5-01 Estilo de vida (tabaco/IPA, alcohol, METs, sueño, alimentación).
- S5-08 SMS automático al invitar asistente (Edge Function + Twilio).
- Vista `/panel/consultas` global.
- Borradores pendientes de firmar en panel home.
- Vistas históricas del paciente (laboratorios, PDFs).
- Reportes/estadísticas para el médico.
- Departamento/Municipio en paciente.
- Extraer modales/diálogos de servicios a `src/components/` (refactor).

## Deudas técnicas conocidas (priorizadas)

1. **Asistente puede firmar consulta** — clínico-legal, urgente.
2. **Sin route guards** en `/panel/perfil`, `/panel/equipo`, `/panel/catalogos`, `/panel/servicios`, `/panel/reputacion` — ya tienen `DoctorOnlyRoute`. (Casi resuelto.)
3. **Inconsistencia visual** pantallas legacy (PacientesPage, AppointmentDetailPanel, BloqueosPage) — no usan `<Button>` reusable.
4. **Sin sistema global de toasts** — `friendlyErrorMessage` ayuda, pero algunos flujos siguen sin feedback.
5. **Print de receta minimalista** — sin logo de clínica, sin QR.
6. **No hay vista `/panel/consultas`** — solo se accede via cita o paciente.
7. **Reclamo de perfil inseguro** (R1-R8 en `docs/ANALISIS_RECLAMAR_PERFIL.md`).
8. **Auth solo OTP** — sin recuperación email para médico.

## Datos en DB (snapshot 2026-05-23)

- ~113 doctores totales; **único publicado/operativo:** Camilo Carrillo. 12 demos viejos desactivados; 100 importados como `listed_only`.
- 14 departments, 262 municipalities con `district` (nueva división 2024).
- 20+ especialidades (varias creadas en la importación).
- 10 cancel_reasons pre-cargadas.
- ~1651 diagnósticos + ~9568 medicamentos en catálogos per-doctor (13 doctores semilla).
- ~21 pacientes con teléfono, ~5 sin documento (NULL).
- ~50 citas (25 ficticias mayo 2026 de Pepe Toro + 25 generadas en pruebas).

## Migraciones SQL aplicadas

Todas corridas en Supabase. Cada `s6_*`/`s7_*` tiene `scripts/check-*.mjs`.

**Sprint 4-5:**
- `s4_01..s4_02`, `s5_01..s5_07`.

**Sprint 6 (reputación):**
- `s6_01_reviews_reputation.sql`
- `s6_02_signed_consultation_appointment_lock.sql`
- `s6_03_block_past_appointments.sql`
- `s6_04_block_outside_availability.sql`
- `s6_05_fix_submit_review_onconflict.sql`
- `s6_06_fix_review_patient_profile.sql`
- `s6_07_rating_precision.sql`
- `s6_08_doctor_review_comments.sql`
- `s6_09_admin_review_traceability.sql`
- `s6_10_block_reschedule_locked_appointments.sql`

**Sprint 7 (admin + robustez):**
- `s7_01_admin_foundation.sql` — `is_admin()`, `admin_platform_stats`, `get_platform_stats()`.
- `s7_02_admin_doctors.sql` — `is_operational` + RPCs set + `admin_list_doctors`.
- `s7_03_unify_verified_with_lucy_status.sql` — `is_verified` GENERATED.
- `s7_04_admin_doctors_search_paginate.sql` — filtros/paginación.
- `s7_05_admin_edit_doctor.sql` — RPCs edición perfil/clínica/info.
- `s7_06_fix_clinic_update.sql` — RPC sin `clinics.updated_at`.
- `s7_07_clinics_updated_at_column.sql` — columna faltante de clinics.
- `s7_08_services_delete_policy.sql` — RLS DELETE para `services`.
- `s7_09_block_inactive_service_appointment.sql` — trigger guard.
- `s7_10_patient_document_nullable.sql` — `patients.document_number` nullable.
- `s7_11_normalize_patient_phone.sql` — backfill `patients.phone` canónico.
- `s7_12_admin_services.sql` — RPCs admin de servicios.

## Scripts utilitarios (`/scripts/`)

- `import-doctors.mjs` — importador idempotente (`--file --sheet --dry-run|--apply`).
- `_deactivate-demos.mjs` — desactiva demos, preserva Camilo.
- `check-s5_07.mjs`, `check-s6_07..10.mjs`, `check-s7_01..12.mjs` — verificadores por migración.
- `check-patient-documents.mjs` — diagnóstico DUIs inválidos / no canónicos.
- `verify-migrations.mjs` — verificación general.
- `load-catalogs.mjs`, `generate-seeds.mjs`, `bench-queries.mjs`, otros.

**Todos los scripts tienen el `service_role` key hardcoded** — pueden correr con `node scripts/<nombre>.mjs`. Para producción real, mover a variable de entorno.

## Cómo crear una asistente

Desde `/panel/equipo` → "Invitar asistente" → teléfono → la asistente se loguea con OTP y queda activa automáticamente vía RPC `accept_clinic_invitations`. SMS automático al invitar **no está implementado** (eso es S5-08).

## Tags y commits importantes

```
f6a4f32 feat(admin): B3-admin — servicios del médico (#30)
2c5fc87 feat(pacientes): validación de DUI por tipo (#29)
e6350e4 feat(pacientes): dedup por teléfono + Nuevo paciente (#28)
45c571e fix(pacientes): document_number nullable (#27)
c806724 fix(citas): servicios inactivos en flujos internos (#26)
265439e feat(panel): B3-doctor — Mis servicios (#25)
117d662 feat(admin): acceso UI al panel Admin (#24)
26f7f7c fix(admin): clinics carecía de updated_at (#23)
8e49be2 docs(CLAUDE.md): actualizar al estado real (#22)
fd54c26 docs: handoff Sprint 7 (#21)
7aa65fd feat(S7 Fase B2-A): admin edita médico (#20)
35dc2ae feat(S7 Fase A): cimientos Admin SaaS (#16)
83cbeb9 fix(home): filtros del directorio  ← piloto-v1.1
15e43d7 feat(Sprint 5 wip)  ← piloto-v1
d2e98ea feat(Sprint 4): consulta clínica MVP
b56543f feat(Sprint 3): cierre
```

Volver a un punto anterior:
```bash
git reset --hard piloto-v1
git push --force-with-lease origin main
```

## Cómo arrancar en un nuevo chat de Claude Code

1. Sincronizar repo + leer este archivo + los docs oficiales (ver arriba).
2. `git log --oneline -10` para ver el último estado.
3. NO asumir nada — leer el código antes de tocarlo.
4. Decisión grande sin consultar = problema. Cuestionar suposiciones.
5. Seguir el sistema de diseño documentado arriba para toda pantalla nueva.
6. Si el objetivo es algo ya analizado (auth, reclamo, piloto), leer el `docs/ANALISIS_*.md` o `docs/PLAN_*.md` correspondiente — **no re-analizar**.

## Documentos fuente (en raíz)

- LucyCare_Schema_DB.docx
- LucyCare_Backlog_Estrategico.docx
- LucyCare_DocTecnico_Completo.docx
- Notas_Sprint3.docx
