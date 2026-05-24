# Handoff LucyCare — Sprint 7 (continuidad de contexto)

> Documento para retomar el proyecto en una nueva ventana sin depender
> del chat previo. **Snapshot 2026-05-23.** Acompaña a `ESTADO_TECNICO.md`
> (ER/BD + reglas), `PLAN_SPRINT7_ADMIN.md` (plan del sprint) y los
> análisis nuevos: `ANALISIS_AUTH_MEDICO.md`, `ANALISIS_RECLAMAR_PERFIL.md`,
> `PLAN_PILOTO_5_MEDICOS.md`.

---

## 1. Estado actual

- **HEAD esperado en `main`:** `f6a4f32` o posterior. **PRs #1–#30 mergeados.**
- **Sprint 6 — Reputación médica:** ✅ completado (PRs #2–#10).
- **Sprint 7 — Admin SaaS + Robustez pacientes:** ✅ Fases A, B, B2-A,
  B3-doctor, B3-admin (PRs #16, #18, #20, #25, #30).
  - PRs hotfix/transversales: #23 (clinics.updated_at), #24 (UI acceso admin),
    #26 (servicios inactivos en flujos internos), #27 (document nullable),
    #28 (dedup teléfono + Nuevo paciente + normalización), #29 (DUI validation).
- **Pendientes Sprint 7+:** B4 disponibilidad, C suspender pacientes/asistentes,
  D dashboard, E reputación admin, F audit log, G catálogos globales.
- **Migraciones aplicadas en DB:** `s4_*`, `s5_01..s5_07`, `s6_01..s6_10`,
  `s7_01..s7_12` (todas).
- **Importación:** 100 médicos cargados; ~113 en DB. Único publicado/operativo:
  Dr. Camilo Carrillo / "Pepe Toro" (`50378627694`).
- **Branch flow:** un branch+PR por fase desde `main`; squash-merge.

### Acceso admin / QA
- **Admin Plataforma:** profile con teléfono `50378056365`, `role='admin'`.
- **Login sin SMS:** Supabase → Authentication → Phone → Test phone numbers:
  `50378627694=123456, 50378056365=123456`. Mantener "Test OTPs Valid Until"
  en fecha futura (vencimiento manual cada año).
- Entrar al admin: login con `50378056365`/`123456` → header muestra botón
  "Panel Admin" (PR #24) → `/admin`.

---

## 2. Decisiones de producto vigentes (no reabrir)

- **Admin SaaS = admin de PLATAFORMA** (dueño de LucyCare). NO es admin de clínica.
- **MVP = single-tenant operativo.** Multi-tenant fuera de scope, pero el diseño
  debe quedar **tenant-ready** (no hardcodear "una sola clínica"; conservar `clinic_id`).
- **Ejes independientes del médico:**
  - `lucy_status` (enum `listed_only|claimed|booking_enabled|verified`).
  - `is_published` = directorio público.
  - `is_operational` = puede operar panel/agenda.
  - `booking_enabled` = acepta reservas online.
- **`is_verified` es DERIVADO** (GENERATED) de `lucy_status='verified'`. NO editable a mano.
- **Reclamar perfil**: solo pasa `lucy_status` de `listed_only` → `claimed`. NUNCA
  toca `verified`, `published`, `operational`, `booking_enabled` ni inserta servicios.
  Ver `ANALISIS_RECLAMAR_PERFIL.md`.
- **Auth del médico**: paciente sigue con OTP; médico tendrá email+password
  cuando reclame perfil (no antes). Ver `ANALISIS_AUTH_MEDICO.md`.
- Admin **puede** editar datos públicos/operativos del médico (perfil, clínica,
  info profesional, servicios). **NO puede** editar contenido clínico.
- Importaciones: defaults seguros (`listed_only`, no publicado, no operativo).

---

## 3. Estado técnico del Admin SaaS

- **Ruta:** `/admin` (`AdminLayout`), hijos: `/admin` (dashboard), `/admin/medicos`
  (listado), `/admin/medicos/:id` (edición).
- **Guard:** `src/router/AdminOnlyRoute.tsx`.
- **`is_admin()`** SQL SECURITY DEFINER STABLE.
- **RPCs admin existentes** (todas SECURITY DEFINER + gateadas + audit_log):
  - `get_platform_stats()`.
  - `admin_list_doctors(...)`, `admin_set_doctor_published/operational/lucy_status`.
  - `admin_get_doctor_detail`, `admin_update_doctor_profile/clinic/info`.
  - `admin_list_doctor_services`, `admin_create_service`, `admin_update_service`,
    `admin_set_service_active`, `admin_delete_service` (s7_12).
- **`AdminDoctorEditPage`** — 4 secciones: Perfil, Clínica, Profesional, Servicios.
- **`AdminDashboardPage`** — tarjetas de métricas.
- **Auditoría:** toda acción admin → `audit_log` con `edited_via: 'admin'`.

---

## 4. Próximas fases (orden recomendado)

**Pre-piloto público (bloqueantes):**
1. **Reclamo seguro** — ver `ANALISIS_RECLAMAR_PERFIL.md`. Fase 2.
2. **Auth robusta del médico** — ver `ANALISIS_AUTH_MEDICO.md`. PR-A + PR-B.
3. **Limpieza de datos** — ver `PLAN_PILOTO_5_MEDICOS.md`.
4. **Twilio trial vs paga** — decisión + setup de test phones si trial.

**Admin SaaS restantes (post-piloto o paralelo):**
5. **B4 — Disponibilidad/horarios** del médico desde admin.
6. **C — Suspender/reactivar pacientes y asistentes** (`profiles.is_active` /
   `clinic_members.is_active`).
7. **D — Dashboard de tracción mensual** (citas creadas/atendidas por mes).
8. **E — Reputación admin** (UI sobre `admin_review_traceability`).
9. **F — Explorador de `audit_log`** con filtros.
10. **G — Catálogos globales** + onboarding manual de médico.

Cada fase: 1 PR chico · migración `s7_0X` (si aplica) + `scripts/check-s7_0X.mjs`
· `vite build` OK · preview validado · luego merge.

---

## 5. Riesgos y reglas críticas

- **NO exponer contenido clínico** al admin plataforma.
- **Toda acción admin se audita** en `audit_log`.
- **No romper login** al editar `phone`/`email` del médico: sincronizan
  `auth.users` ↔ `profiles` en la misma transacción (s7_05).
- **No borrar médicos** con dependencias (citas/consultas/reviews): desactivar.
- **Sin `is_published`** → no aparecen en directorio público.
- **Sin `is_operational`** → no reciben citas; ven "Cuenta suspendida".
- **Validar con `vite build` real**, no solo `tsc --noEmit`.
- **Twilio trial:** bloqueante para piloto público real. Email+password mitiga
  parcialmente (PR-A del análisis de auth).
- **Caché del directorio público:** cambios admin se reflejan en DB al
  instante; lista pública puede tardar `staleTime` (5 min) o pedir hard refresh.

---

## 6. Archivos clave

**Docs (siempre leer antes de codear):**
- `CLAUDE.md` — contexto histórico y vinculante del proyecto.
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — este documento.
- `docs/ESTADO_TECNICO.md` — ER/BD, matriz de reglas, flujos UI/UX.
- `docs/PLAN_SPRINT7_ADMIN.md` — plan oficial.
- `docs/ANALISIS_AUTH_MEDICO.md` — decisión y plan auth robusta.
- `docs/ANALISIS_RECLAMAR_PERFIL.md` — diagnóstico y rediseño de reclamo.
- `docs/PLAN_PILOTO_5_MEDICOS.md` — checklist de piloto.

**Migraciones Sprint 7** (`/migrations/`, todas aplicadas):
- `s7_01_admin_foundation.sql`
- `s7_02_admin_doctors.sql`
- `s7_03_unify_verified_with_lucy_status.sql`
- `s7_04_admin_doctors_search_paginate.sql`
- `s7_05_admin_edit_doctor.sql`
- `s7_06_fix_clinic_update.sql`
- `s7_07_clinics_updated_at_column.sql`
- `s7_08_services_delete_policy.sql`
- `s7_09_block_inactive_service_appointment.sql`
- `s7_10_patient_document_nullable.sql`
- `s7_11_normalize_patient_phone.sql`
- `s7_12_admin_services.sql`

**Scripts** (`/scripts/`):
- `import-doctors.mjs`, `_deactivate-demos.mjs`.
- `check-s7_01..12.mjs`, `check-patient-documents.mjs`.
- `verify-migrations.mjs`.

**Frontend admin:**
- `src/router/AdminOnlyRoute.tsx`, `src/router/config.tsx`.
- `src/pages/admin/AdminLayout.tsx`, `AdminDashboardPage.tsx`, `AdminDoctorsPage.tsx`,
  `AdminDoctorEditPage.tsx`, `components/AdminDoctorServicesSection.tsx`.
- `src/services/admin.service.ts`.

**Helpers compartidos (`src/lib/`):**
- `phone.ts` — `normalizePhoneSV`.
- `document.ts` — `validateDocument`, `sanitizeDuiInput`, `formatDuiDisplay`.
- `errors.ts` — `friendlyErrorMessage`.

**Otros relevantes:**
- `src/services/appointments.service.ts`, `availability.service.ts`,
  `slots.service.ts`, `reviews.service.ts`, `services.service.ts`,
  `patients.service.ts` (con `DuplicatePhoneError` + `createBasicPatient`).
- `src/hooks/useClinicContext.ts` (con `doctorIsOperational`).
- `vercel.json` (SPA fallback).

---

## Cómo retomar en una ventana nueva

```
Continuamos LucyCare.

git fetch origin && git checkout main && git pull --ff-only
git log --oneline -5

Leé:
- CLAUDE.md
- docs/HANDOFF_LUCYCARE_SPRINT7.md
- docs/<doc específico para el objetivo de hoy>

Estado: PRs hasta #30 mergeados, migraciones hasta s7_12.
Hoy: <objetivo específico>
```

Eso es todo lo que necesito para entrar en contexto.
