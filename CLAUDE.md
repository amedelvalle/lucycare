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
```

Luego leé los documentos oficiales:
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — handoff / estado para continuidad
- `docs/ESTADO_TECNICO.md` — ER/BD, matriz de reglas, flujos UI/UX
- `docs/PLAN_SPRINT7_ADMIN.md` — plan oficial Sprint 7/8 Admin SaaS

⚠️ **No mergear branches `claude/*` viejas.** Las fases se integran a
`main` por **squash-merge**: la rama queda en el remoto pero su
contenido YA está en `main`. Re-mergearlas genera conflictos. Tras un
squash-merge, la rama puede borrarse.

## Estado actual del proyecto

- **Fuente de verdad:** `origin/main` en GitHub (github.com/amedelvalle/lucycare).
- **HEAD esperado:** `fd54c26` o posterior. PRs **#1–#21 mergeados**.
- **Sprint 6 — Reputación médica:** ✅ completado (PRs #2–#10).
- **Sprint 7/8 — Admin SaaS:** Fase A ✅ (PR #16), Fase B ✅ (PR #18),
  Fase B2-A ✅ (PR #20). Próximas: B3 servicios, B4 disponibilidad,
  C suspender pacientes/asistentes, D dashboard, E reputación admin,
  F audit log, G catálogos.
- **Importación de médicos:** 100 cargados (hoja `Importar_100`); ~113
  doctores en DB. Demo operativo único: Dr. Camilo Carrillo (`50378627694`).
- **Migraciones aplicadas:** `s4_*`, `s5_01..s5_07`, `s6_01..s6_10`,
  `s7_01..s7_05`. Verificables con `scripts/check-*.mjs`.
- **Pendiente inmediato:** smoke-test de `admin_update_doctor_profile`
  (ver §4 de `docs/HANDOFF_LUCYCARE_SPRINT7.md`).
- **Deploy:** Vercel auto-deploy desde `main`. `gh` CLI autenticado.

## Decisiones cerradas (NO reabrir)

- Backend: Supabase (Postgres + Auth + Edge Functions + Storage)
- Frontend: React 19 + TypeScript + Tailwind + Vite + React Query
- Auth: OTP por SMS con Twilio (sin contraseñas)
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

## Stack técnico verificado

- Imports usan alias `@/` (ej: `@/lib/supabase`)
- Auth usa `supabase.auth.getSession()` en servicios, `getUser()` en algunos hooks
- React Query con refetchInterval 30s para citas y 60s para notificaciones
- Iconos Remix (`ri-*`) en PanelLayout, SVG inline en componentes nuevos
- Color acento del panel: emerald
- Bootstrap defensivo en `main.tsx`: valida sesión contra servidor antes de renderizar; si stale → signOut local
- División territorial El Salvador 2024 cargada: `municipalities.name` = distrito (antiguo municipio), `municipalities.district` = nuevo municipio agrupador (Ahuachapán Norte, La Libertad Sur, etc.)

## Sistema de diseño (Sprint 4 — vinculante)

Establecido al notar inconsistencias acumuladas. **Toda pantalla nueva debe seguir esto. Página de referencia: `/panel/catalogos`.**

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
Hook unificado que devuelve `{ profileId, role, clinicId, doctorId, doctorName }` para doctor o asistente. **Toda página del panel debe usarlo** — NO hacer lookup inline a `from('doctors')`. Integrado en CitasPage, PacientesPage, BloqueosPage, PerfilPage, EquipoPage, ConsultaPage.

- Si `role='doctor'`: busca su row en `doctors`
- Si `role='assistant'`: busca su row activa en `clinic_members`, luego el doctor primario de esa clínica (multi-doctor selector pendiente en S5-07)

### Audit log
- `src/services/auditLog.service.ts` con `logAuditEntry()` — no bloquea si falla
- Schema: `audit_log` action ENUM ('select','insert','update','delete') — siempre minúsculas
- Triggers DB en `audit_consultations`, `audit_patients`, `audit_prescriptions`, `audit_consultation_family_history`, `audit_clinic_invitations` — todos usan `LOWER(TG_OP)::audit_action`

### Notificaciones del panel (S3-01)
- NO usa la tabla `notifications` (esa es para SMS/email salientes vía Twilio, pendiente en S5-08)
- Se derivan de `appointments` en `src/services/panelNotifications.service.ts`:
  - `new_booking`: cita con `source='lucy_directorio'` en últimas 24h
  - `cancellation`: cita con `cancelled_at` en últimas 24h
- Read/unread con timestamp en `localStorage` (`lucycare_panel_notif_seen_at`)

### Catálogos: defer autocomplete hasta 1+ carácter
Los hooks `useDiagnosesSearch`, `useMedicationsSearch`, `useFamilyHistorySearch` solo disparan query con `search.trim().length >= 1` para no malgastar requests al abrir la consulta. Combobox muestra "Empezá a escribir para buscar" hasta que el usuario tipea.

### Cache invalidation al guardar disponibilidad
`DisponibilidadPage` invalida `['doctor-calendar-hours']`, `['availability']`, `['slots']` para que el calendario y el booking público reflejen los cambios inmediato.

### Performance: índices DB
`migrations/s5_05_catalog_indexes.sql` agregó btree compuestos + pg_trgm GIN. Queries de catálogo bajaron ~9x (1400ms → 130ms).

## Schema crítico verificado

- `appointment_statuses`: id, name, display_name, color, is_final, funnel_order
- `audit_log`: id, user_id, action (ENUM), table_name, record_id, old_data jsonb, new_data jsonb, ip_address, created_at
- `appointments`: cancel_reason_id (FK a cancel_reasons, NO cancellation_reason texto), internal_notes, source ('manual'|'lucy_directorio'|'lucy_seguimiento')
- `cancel_reasons`: id, name, category ('paciente'|'medico'|'sistema'), is_active — 10 registros pre-cargados
- `patients`: full_name, phone, email, document_type+document_number, date_of_birth, gender, patient_type, blood_type, allergies, notes, emergency_contact_*, photo_url, is_active, profile_id (nullable)
- `doctors`: bio, consultation_fee, experience_years, languages[], license_number, specialty_id, is_published, is_verified, booking_enabled, lucy_status, education jsonb
- `profiles`: full_name, email, phone, avatar_url, role ('patient'|'doctor'|'assistant'|'admin')
- `clinic_members`: clinic_id, profile_id, role ('owner'|'doctor'|'assistant'), is_active
- `clinic_invitations` (S5-07): clinic_id, phone, display_name, role, invited_by, invited_at, accepted_at, cancelled_at + RPC `accept_clinic_invitations(user_phone)` SECURITY DEFINER
- `consultations`: chief_complaint, history_present_illness, family_history_notes (LEGACY, no UI), physical_exam, internal_analysis, plan, status (draft|signed), started_at, signed_at
- `consultation_diagnoses`: diagnosis_id, diagnosis_type (presuntivo|definitivo|diferencial), diagnosis_status (9 valores: activo|en_estudio|en_tratamiento|controlado|descontrolado|cronico|en_remision|en_observacion|resuelto), notes
- `diagnoses`, `medications`, `family_history_catalog`: catálogos per-doctor con usage_count
- `consultation_family_history`: id, consultation_id, family_history_id, notes
- `prescriptions`: medication_id, dosage, frequency, duration_value, duration_unit (dias|semanas|meses|permanente), instructions, alternatives
- `medication_presentation` enum (13 valores): tableta, capsula, jarabe, inyectable, crema, gotas, suspension, parche, inhalador, supositorio, otro, sobre, gel
- `vitals`: vinculado a appointment_id (no consultation_id) → multi-actor implícito; `weight_kg` (migrado desde `weight_lb`)
- `municipalities`: name (distrito antiguo municipio), district (nuevo municipio agrupador post-2024)
- `notifications` (NO usada por panel todavía): para SMS/email salientes — recipient_id, channel, type, status, scheduled_at

## Estados de cita y transiciones

- programada → confirmada → en_sala → atendida (final)
- cancelada (final con cancel_reason_id), no_asistio (final)
- Validaciones extremas: no marcar 'atendida' con >24h de anticipación; no marcar 'no_asistio' antes de la hora

## Sprints completados

### Sprint 1-2 ✅
Directorio público + booking público con OTP + panel médico básico (disponibilidad, bloqueos)

### Sprint 3 ✅ (`b56543f`)
Panel del médico: calendario 3 vistas, marcar estado + audit log, walk-in, pacientes (lista + perfil + edición), perfil público editable, soporte rol asistente (`useClinicContext`), responsive tablet (sidebar 3 niveles), header notificaciones.

### Sprint 4 ✅ (`d2e98ea`)
MVP de consulta clínica firmable e imprimible. Servicios: consultations, vitals, diagnoses catalog, medications catalog, prescriptions. Página `/panel/consulta/:appointmentId` con auto-create draft, signos vitales con IMC + clasificación OMS + validadores fisiológicos, diagnósticos con catálogo, receta con cargar permanentes, firma inmutable + auto-transición cita a atendida, imprimir receta. Sistema de diseño documentado + Button reusable. Página catálogos admin. Soft-delete pacientes. Migración weight_kg.

### Sprint 5 EN CURSO ~70% (último commit `83cbeb9`, tag `piloto-v1.1`)

✅ Hecho:
| Tarea | Archivos clave |
|---|---|
| S5-04+02 Antecedentes familiares | `family_history_catalog`, `consultation_family_history`, `AntecedentesSection.tsx`, tab en CatalogosPage |
| S5-05 Plan de seguimiento agendable inline | `FollowUpScheduler.tsx`, `useFollowUp.ts`, reutiliza `createWalkInAppointment` |
| S5-03 Estados de diagnóstico expandidos | enum con 9 valores (4 nuevos: en_estudio, controlado, descontrolado, en_remision) |
| S5-06 Mi equipo (invitar asistentes) | `clinic_invitations`, RPC `accept_clinic_invitations`, `EquipoPage.tsx`, `team.service.ts` |
| Datos iniciales | 127 dx + 736 meds cargados para 13 doctores via `scripts/load-catalogs.mjs` |
| 10 pacientes ficticios + 25 citas mayo 2026 | via `scripts/generate-seeds.mjs` |
| Paginación admin catálogos | `<Pagination>` reusable, server-side range + count |
| Optimización queries | índices btree + pg_trgm, defer autocomplete vacío |
| Calendario respeta disponibilidad doctor | `useDoctorCalendarHours` + buffer 1h, sticky header del calendar |
| Fix modal cancelación | usaba columnas inexistentes (`cancellation_reason` etc) → ahora `cancel_reason_id` (FK) + `internal_notes` |
| Fix filtros del directorio | bug del mousedown listener cerrando dropdown antes del onClick |
| Dropdown municipios agrupado por district | Optgroups visuales con nueva división territorial 2024 |

⏳ Pendientes S5:
- **S5-01** Estilo de vida con cálculos (tabaco/IPA, alcohol, METs, sueño, alimentación) — la grande, 1-2 semanas, requiere diseño de schema
- **S5-07** Selector multi-doctor cuando clínica tiene varios médicos — 4h
- **S5-08** Notificaciones SMS reales con Edge Function + Twilio — 1 semana

## Sprint 6 — Admin SaaS (no construido, propuesto)

**Por qué:** módulo aparte para el dueño de la plataforma (no para doctores/asistentes). Necesario para mostrar tracción a inversores y operar el negocio.

**Alcance propuesto:**
- Ruta `/admin` con guard de rol `admin` (enum ya existe en `user_role`)
- Aprobar / verificar médicos (toggle `is_verified`, gestionar `lucy_status`)
- Suspender doctor / paciente / asistente (`is_active=false` global)
- Dashboard de tracción:
  - Visitas (necesita integración con analytics — Vercel Analytics / Plausible)
  - Médicos activos, pacientes activos, asistentes
  - Citas creadas / atendidas por mes
  - Consultas firmadas (volumen, no contenido — privacidad)
  - Ingresos via Stripe webhook (cuando esté)
- Audit log inspeccionable (filtros por usuario, tabla, fecha)
- Gestión de catálogos globales (especialidades, departamentos, municipios, cancel_reasons)
- Onboarding manual de médicos (claim profile, sin OTP)

**Estimación**: 2-3 semanas. Requiere su propio sistema de RLS (admin bypassa muchas cosas).

## Sprint 7+ (más adelante)

- Estructura órdenes de laboratorio con perfiles
- Imágenes/gabinete con drill-down
- Vista `/panel/consultas` global con filtros
- Sección "Borradores pendientes de firmar" en panel home
- Vistas históricas del paciente (laboratorios, archivos PDF subidos al expediente)
- Reportes/estadísticas para el médico (citas/mes, ingresos personales, no-shows)

## Deudas técnicas conocidas (priorizadas)

1. **Asistente puede firmar consulta** — clínico-legal, urgente. La firma debería ser solo del doctor
2. **Sin route guards** en `/panel/perfil`, `/panel/equipo`, `/panel/catalogos` para asistentes (ocultos del sidebar pero URL directa funciona)
3. **Inconsistencia visual** pantallas legacy (PacientesPage, AppointmentDetailPanel, BloqueosPage) — no usan `<Button>` reusable
4. **Sin sistema global de toasts** — errores van a console.error sin feedback al usuario
5. **Print de receta minimalista** — sin logo de clínica, sin QR de verificación
6. **No hay vista `/panel/consultas`** — solo se accede via cita o paciente

## Datos en DB (real + ficticio)

- 13 doctores publicados: 12 dummy + 1 real ("Pepe Toro" — usuario principal de pruebas)
- 14 departments, 262 municipalities con `district` (nueva división 2024)
- 20 especialidades
- 10 cancel_reasons pre-cargadas (categorías: paciente, medico, sistema)
- 127 diagnósticos × 13 doctores = ~1651 filas
- 736 medicamentos × 13 doctores = 9568 filas
- 10 pacientes ficticios + 25 citas mayo 2026 con todos los estados del funnel (para Pepe Toro)

## Migraciones SQL aplicadas

En `/migrations/`. Ya corridas en Supabase (verificar con `scripts/verify-migrations.mjs`):

- `s4_01_vitals_weight_kg.sql` — rename weight_lb → weight_kg
- `s4_02_fix_audit_triggers.sql` — fix `LOWER(TG_OP)` en audit triggers
- `s5_01_family_history_tables.sql` — tablas + RLS + audit trigger
- `s5_02_extend_medication_presentation.sql` — agrega `sobre`, `gel` al enum
- `s5_03_seed_diagnoses.sql` — (referencia, uso real via script)
- `s5_04_seed_medications.sql` — (referencia, uso real via script)
- `s5_05_catalog_indexes.sql` — btree + pg_trgm GIN (perf 9x)
- `s5_06_extend_diagnosis_status.sql` — agrega 4 estados al enum
- `s5_07_clinic_invitations.sql` — tabla + RPC `accept_clinic_invitations` SECURITY DEFINER

## Scripts utilitarios (`/scripts/`)

- `s4-week1-smoke-test.mjs` — smoke test S4
- `verify-migrations.mjs` — verifica todas las migraciones S5
- `check-s5_07.mjs` — verifica clinic_invitations específicamente
- `check-catalogs.mjs` — cuenta diagnósticos/medicamentos por doctor
- `bench-queries.mjs` — mide latencia de queries clave
- `load-catalogs.mjs` — carga programática 127 dx + 736 meds para todos los doctores (idempotente)
- `generate-seeds.mjs` — genera los SQL seeds desde Excel/CSV en `/imports/`
- `analyze-medicamentos.mjs`, `read-medicamentos.mjs` — exploración
- `fix-medications-presentation.mjs` — fix de 16 medicamentos que quedaron como 'otro'

**Todos los scripts tienen el `service_role` key hardcoded** — pueden correr con `node scripts/<nombre>.mjs`. Para mover a producción real, mover a variable de entorno.

## Cómo crear una asistente

**Ahora (S5-06):** desde `/panel/equipo` → "Invitar asistente" → teléfono → la asistente se loguea con OTP y queda activa automáticamente vía RPC `accept_clinic_invitations`.

SMS automático al invitar **no está implementado** (eso es S5-08). Por ahora avisar verbalmente.

## Tags y commits importantes

```
83cbeb9 fix(home): filtros del directorio + dropdown municipios agrupado  ← piloto-v1.1
15e43d7 feat(Sprint 5 wip): antecedentes, equipo, plan inline, ...        ← piloto-v1
d2e98ea feat(Sprint 4): cierre - consulta clínica MVP
07f09d3 chore: limpieza post-Sprint 3
b56543f feat(Sprint 3): cierre - notificaciones, pacientes, perfil
```

Volver a un punto anterior:
```bash
git reset --hard piloto-v1
git push --force-with-lease origin main
```

## Cómo arrancar en un nuevo chat de Claude Code

1. Leer este archivo entero
2. Verificar el branch: `git log --oneline -5`
3. Verificar el estado DB: `node scripts/verify-migrations.mjs`
4. NO asumir nada — leer el código antes de tocarlo
5. Decisión grande sin consultar = problema. Cuestionar suposiciones
6. Seguir el sistema de diseño documentado arriba para toda pantalla nueva

## Documentos fuente (en raíz)

- LucyCare_Schema_DB.docx
- LucyCare_Backlog_Estrategico.docx
- LucyCare_DocTecnico_Completo.docx
- Notas_Sprint3.docx
