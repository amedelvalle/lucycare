# Handoff LucyCare — Sprint 7 (continuidad de contexto)

> Documento para retomar el proyecto en una nueva ventana sin depender
> del chat previo. Snapshot 2026-05-20. Acompaña a `ESTADO_TECNICO.md`
> (ER/BD + reglas) y `PLAN_SPRINT7_ADMIN.md` (plan del sprint).

---

## 1. Estado actual

- **Sprint 6 — Reputación médica:** ✅ completado (PRs #2–#10).
- **Sprint 7/8 — Admin SaaS:**
  - Fase A (cimientos) ✅ PR #16
  - Fase B (gestión de médicos: verificar/publicar/operativo + búsqueda/filtros/paginación) ✅ PR #18
  - Fase B2-A (edición perfil/clínica/info del médico) ✅ PR #20
- **Importación de médicos:** 100 médicos cargados (hoja `Importar_100` del Excel `Listado_medicos_depurado_LucyCare.xlsx`). DB ahora ~113 doctores (13 originales + 100). 9 especialidades nuevas creadas.
- **Demo operativo:** Dr. Camilo Carrillo / "Pepe Toro", teléfono `50378627694`, `lucy_status='verified'`, `is_published=true`, `is_operational=true`. Es el ÚNICO publicado/operativo. Los otros 12 demos quedaron desactivados (no borrados).
- **Migraciones aplicadas en DB:** `s4_*`, `s5_01..s5_07`, `s6_01..s6_10`, `s7_01..s7_05` (todas). Cada `s6_*`/`s7_*` tiene `scripts/check-*.mjs` para verificar.
- **Branch / flujo:** worktree en `.claude/worktrees/…`; un branch+PR por fase desde `main`; squash-merge. `gh` CLI instalado y autenticado (keyring).

### Acceso admin / QA
- **Admin:** profile con teléfono `50378056365`, `role='admin'`.
- **Login sin SMS:** Supabase → Authentication → Phone → "Test phone numbers": `50378627694=123456, 50378056365=123456`. ⚠️ Mantener "Test OTPs Valid Until" en fecha futura (estaba 2026; subir a 2027+).
- Entrar al admin: login con `50378056365`/`123456` → navegar a `/admin` (no hay link en UI pública).

---

## 2. Decisiones de producto vigentes (no reabrir)

- **Admin SaaS = admin de PLATAFORMA** (dueño de LucyCare). NO es admin de clínica.
- **MVP = single-tenant operativo.** Multi-tenant fuera de scope, pero el diseño debe quedar **tenant-ready** (no hardcodear "una sola clínica"; conservar `clinic_id`).
- **Ejes independientes del médico:**
  - `lucy_status` (enum `listed_only|claimed|booking_enabled|verified`) = etapa comercial/onboarding.
  - `is_published` = aparece en el directorio público.
  - `is_operational` = puede operar agenda/citas/consultas/firma.
  - `booking_enabled` = acepta reservas online.
  - `profiles.is_active` = suspensión global de cuenta (paciente/asistente).
- **`is_verified` es DERIVADO** (columna GENERATED) de `lucy_status='verified'`. NO editable a mano. Para "verificar" → poner `lucy_status='verified'`.
- Admin **puede** editar datos públicos/operativos del médico (nombre, contacto, clínica, especialidad, bio).
- Admin **NO puede** editar contenido clínico (consultas, recetas, diagnósticos, notas, historia).
- Importaciones de médicos: defaults seguros (`listed_only`, no publicado, no operativo). Sin SMS/OTP/invitaciones.

---

## 3. Estado técnico del Admin SaaS

- **Ruta:** `/admin` (layout `AdminLayout`), hijos: `/admin` (dashboard), `/admin/medicos` (listado), `/admin/medicos/:id` (edición).
- **Guard:** `src/router/AdminOnlyRoute.tsx` — verifica `role==='admin'` vía `getCurrentAuthUser`; si no, redirige a `/`.
- **`is_admin()`** (SQL, SECURITY DEFINER STABLE) — base para gatear RPCs y futuras RLS.
- **RPCs admin existentes (todas SECURITY DEFINER + gateadas por `is_admin()` + escriben `audit_log`):**
  - `get_platform_stats()` → vista `admin_platform_stats` (conteos agregados, sin PII/clínico).
  - `admin_list_doctors(p_search, p_published, p_operational, p_lucy_status, p_limit, p_offset)` → filtros + paginación server-side + `total_count`.
  - `admin_set_doctor_published`, `admin_set_doctor_operational`, `admin_set_lucy_status`.
  - `admin_get_doctor_detail`, `admin_update_doctor_profile`, `admin_update_doctor_clinic`, `admin_update_doctor_info`.
  - `admin_review_traceability` (vista, de Sprint 6 Fase F) — solo service_role.
- **`admin_update_doctor_profile`** actualiza `auth.users` + `profiles` en la misma transacción (no rompe login). Mantiene `*_confirmed_at` (sin disparar verificación).
- **Dashboard:** `AdminDashboardPage` — tarjetas de métricas (médicos, pacientes, citas, consultas firmadas, reseñas, score).
- **Gestión de médicos:** `AdminDoctorsPage` — tabla con badges (Operativo/Publicado/Verificado), buscador (debounce), filtros (publicado/operativo/lucy_status), paginación (25/pág), acciones (Publicar/Suspender, select lucy_status, Editar).
- **Edición:** `AdminDoctorEditPage` — 3 secciones independientes (Perfil / Clínica / Profesional), cada una con su Guardar.
- **Servicio:** `src/services/admin.service.ts` (todas las llamadas admin).
- **Auditoría:** toda acción admin → `audit_log` con `old_data`/`new_data`.

---

## 4. Smoke-test PENDIENTE (PR #20)

Validar `admin_update_doctor_profile` en runtime (escribe `auth.users`):

1. Login como admin (`50378056365`/`123456`).
2. Ir a `/admin/medicos`.
3. "Editar" en un médico **importado** (no Camilo).
4. Sección **Perfil** → cambiar el teléfono → Guardar.

**Resultado esperado:**
- ✅ "Guardado ✓" → el `UPDATE auth.users` desde la función SECURITY DEFINER funciona. Todo OK.
- ❌ Error `permission denied for table users` → la función no tiene privilegio sobre `auth.users`. **Fix:** hacer la actualización de `auth.users` vía **Supabase Admin API** (`auth.admin.updateUserById`) desde un contexto server/script en lugar de SQL directo, y dejar la RPC tocando solo `profiles`. Es no destructivo (la transacción revierte).

Secciones Clínica y Profesional no tocan `auth` — seguras.

---

## 5. Próximas fases (orden recomendado)

1. Resolver el smoke-test de §4 si falla.
2. **B3 — Servicios del médico** (nombre, duración, precio) editables por admin.
3. **B4 — Disponibilidad/horarios** del médico desde admin (reutilizar lógica de `availability.service` / `slots.service` si es viable).
4. **C — Suspender/reactivar pacientes y asistentes** (`profiles.is_active` / `clinic_members.is_active`).
5. **D — Dashboard de tracción mensual** (citas creadas/atendidas por mes).
6. **E — Reputación admin** (UI sobre `admin_review_traceability` + moderar `is_visible` de reseñas).
7. **F — Explorador de `audit_log`** con filtros.
8. **G — Catálogos globales** + onboarding manual de médico.

Cada fase: 1 PR chico · migración `s7_0X` + `scripts/check-s7_0X.mjs` · `vite build` OK · preview validado · luego merge.

---

## 6. Riesgos y reglas críticas

- **NO exponer contenido clínico** al admin plataforma (consultas/recetas/diagnósticos/historia). Solo volúmenes/metadatos.
- **Toda acción admin se audita** en `audit_log`.
- **No romper login** al editar `phone`/`email`: deben sincronizarse `auth.users` ↔ `profiles`.
- **No borrar médicos demo** con dependencias (citas/consultas/reviews): desactivar, no DELETE.
- **Médicos importados** nacen con defaults seguros: no publicados, no operativos, `listed_only`.
- **Sin publicación** (`is_published=false`) → NO aparecen en directorio público.
- **Sin operación** (`is_operational=false`) → NO reciben citas; el doctor ve "Cuenta suspendida" en el panel.
- **Validar con `vite build` real**, no solo `tsc --noEmit` (un `tsc` limpio dejó pasar un `setStartHour` fantasma que rompió en runtime).
- **Twilio en modo trial:** OTP solo llega a números verificados. Para QA usar test phones en Supabase. **Antes del piloto real hay que upgradear Twilio a cuenta paga** (bloqueante de lanzamiento).
- **Caché del directorio público:** cambios de admin se reflejan en DB al instante, pero la lista pública puede requerir hard refresh / esperar `staleTime` de React Query. Aceptado como UX, no bug.

---

## 7. Archivos clave

**Docs:**
- `docs/ESTADO_TECNICO.md` — ER/BD, matriz de reglas, flujos UI/UX.
- `docs/PLAN_SPRINT7_ADMIN.md` — plan oficial Sprint 7/8.
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — este documento.
- `CLAUDE.md` — contexto histórico del proyecto (sprints previos).

**Migraciones Sprint 7** (`/migrations/`, todas aplicadas):
- `s7_01_admin_foundation.sql` — `is_admin()`, `admin_platform_stats`, `get_platform_stats()`.
- `s7_02_admin_doctors.sql` — `is_operational` + RPCs set + `admin_list_doctors`.
- `s7_03_unify_verified_with_lucy_status.sql` — `is_verified` GENERATED.
- `s7_04_admin_doctors_search_paginate.sql` — `admin_list_doctors` con filtros/paginación.
- `s7_05_admin_edit_doctor.sql` — RPCs de edición (perfil/clínica/info).

**Scripts** (`/scripts/`):
- `import-doctors.mjs` — importador idempotente (`--file --sheet --dry-run|--apply --limit`).
- `_deactivate-demos.mjs` — desactiva demos, preserva Camilo.
- `check-s7_01..05.mjs` — verificadores por migración.
- `verify-migrations.mjs` — verificación general.

**Frontend admin:**
- `src/router/AdminOnlyRoute.tsx`, `src/router/config.tsx` (rutas `/admin*`).
- `src/pages/admin/AdminLayout.tsx`, `AdminDashboardPage.tsx`, `AdminDoctorsPage.tsx`, `AdminDoctorEditPage.tsx`.
- `src/services/admin.service.ts`.

**Otros relevantes:**
- `src/services/appointments.service.ts`, `availability.service.ts`, `slots.service.ts`, `reviews.service.ts`.
- `src/hooks/useClinicContext.ts` (incluye `doctorIsOperational`).
- `vercel.json` (SPA fallback para deep-links).

---

## Cómo retomar en una ventana nueva

1. Leer este handoff + `ESTADO_TECNICO.md` + `PLAN_SPRINT7_ADMIN.md`.
2. `git log --oneline -10` para ver el último estado.
3. Confirmar resultado del smoke-test de §4 con el owner.
4. Continuar por la fase que corresponda en §5.
5. Mantener el flujo: branch por fase → migración + check → `vite build` → preview → merge.
