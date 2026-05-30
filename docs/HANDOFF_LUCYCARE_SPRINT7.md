# Handoff LucyCare — Pre-piloto (post Sprint 7)

> Documento para retomar el proyecto en una nueva ventana sin depender
> del chat previo. **Snapshot 2026-05-27.** Acompaña a `CLAUDE.md`
> (guía rápida + sistema de diseño), `docs/ESTADO_TECNICO.md` (ER/BD)
> y los análisis vivos en `docs/ANALISIS_*.md`.

---

## 1. Estado actual

- **HEAD esperado en `main`:** `8ec813c` o posterior. **PRs #1–#59 mergeados.**
- **Infra live:** dominio público `https://lucycare.app` (DNS Cloudflare, `www`→apex 308). `lucycare.vercel.app` queda como **fallback temporal** (no desactivar). Previews en `lucycare-git-*.vercel.app`. SMTP externo Resend/Supabase configurado.
- **Migraciones aplicadas hasta `s7_23`.**
- **Sprint 7 — Admin SaaS + Robustez:** ✅ completado (PRs #16–#30).
- **Pre-piloto — Bloqueantes cerrados ✅ (PRs #32–#59):**
  - PR #32 Reclamo seguro (s7_13).
  - PR #33 Estabilización supabase-js lock no-op.
  - PR #34 Foto de perfil (s7_14).
  - PR #35 Security Gate audit + trigger reviews (s7_15).
  - PR #36 Rotación service_role + ENV vars (32 scripts).
  - PR #37 RLS hardening de profiles (s7_16, s7_16b).
  - PR #38 Desactivar seed `*.lucycare.test` (s7_17).
  - PR #39 Auth email+password + reset por email (Fase 4 PR-A).
  - PR #40 LoginModal no cierra al click outside.
  - PR #41 Directorio informativo + copy ES.
  - PR #42 Análisis paciente global (doc + decisiones DA1-DA4).
  - PR #43 Lista de espera real + badge admin (s7_18, s7_19).
  - PR #44 Paciente Global Fase 1 (s7_20).
  - PR #46 SMTP externo Resend + reset por email validado (doc + setup operativo 2026-05-26, dominio `lucycare.app` **comprado en Cloudflare**, DNS email — SPF/DKIM/DMARC — gestionado ahí mismo).
  - PR #47 Refresh documental post-Resend (`HANDOFF_TOMA_DECISIONES_2.md` + actualizaciones en CLAUDE.md / HANDOFF).
  - PR #48 Dominio público `lucycare.app` live en Vercel (setup operativo 2026-05-26, DNS en Cloudflare con CNAME flattening en apex, `www` → apex 308, Supabase Site URL actualizado, reset por email validado end-to-end).
  - PR #49 Refresh documental post-#48 — `lucycare.app` como dominio principal en CLAUDE.md / HANDOFFs / FASE_4_AUTH / SETUP_SMTP_RESEND / PLAN_PILOTO.
  - PR #50 Password en flujo de Reclamar perfil (Fase 4 PR-B, step obligatorio post-claim, dos caminos: crear ahora / recibir link por email; copy "Perfil reclamado" diferenciado de "Cuenta suspendida"; sin migración).
  - PR #52 Análisis del flujo "Solicitar afiliación" (`docs/ANALISIS_AFILIACION_MEDICO.md`, 10 secciones + Q1-Q10 pendientes de decisión).
  - PR #53 Mitigación del flujo público "Soy médico" (cierra Hallazgo #7 del Security Gate). Reemplaza el `DoctorRegistrationModal` legacy (auto-creaba doctor `claimed` sin validar identidad) por un `DoctorInterestModal` (mitigación temporal). Cero persistencia en DB. `registerDoctor` service y modal legacy marcados `@deprecated`.
  - PR #54 Refresh documental post-#53 (registra mitigación + Hallazgo #7 en `SECURITY_GATE_PILOTO.md`).
  - PR #55 Plan operativo `docs/PLAN_AFILIACION_MEDICO.md` (Fase 1 + Fase 2).
  - PR #56 **Afiliación Fase 1** (`s7_21`). Tabla `doctor_affiliation_requests` con RLS estricto + `incomplete` GENERATED. RPC pública `submit_affiliation_request` con rate limit 1/IP/24h y UNIQUE phone activo. RPCs admin para triage (in_review/approved/rejected). Frontend: `AffiliationRequestModal` reemplaza al interest legacy. Bandeja `/admin/afiliaciones` con filtros + badge sidebar. Página `/privacidad` MVP. No crea doctor/profile/clinic.
  - PR #57 Refresh documental post-PR #56.
  - PR #58 **Afiliación Fase 2** (`s7_22` + `s7_23`). RPC `admin_approve_and_create_doctor(p_request_id, p_overrides)` que en una transacción crea auth.users dormant + profile (UPSERT defensivo coexiste con trigger `handle_new_user`) + clinic + clinic_member (owner) + doctor en `lucy_status='listed_only'` con flags conservadores en false. Email override aceptado solo si lead no trajo email (regla server-side en s7_23). UI: botón "Crear médico" en `AdminAffiliationDetailModal` con form de overrides + checkbox confirm + pantalla de éxito con doctor_id + link a ficha admin (no perfil público — doctor sigue no publicado). Badge "Datos por completar" reemplazado por "Médico creado" cuando hay doctor_id. Smoke OK hasta ficha admin. **Pendiente**: validar claim end-to-end del médico creado con test phone real del médico.
- **Migraciones aplicadas en DB:** `s4_*`, `s5_01..s5_07`, `s6_01..s6_10`, `s7_01..s7_23`.
- **Médicos en producción hoy:** 5 publicados (Camilo + 4 informativos).
  - Camilo: `lucy_status=verified`, agenda en línea real, único con `booking_enabled=true`.
  - Otros 4 (Gina, Abraham, German, Elena): publicados sin agenda en línea, captados por el directorio informativo.
- **Seed legacy:** 12 médicos `*.lucycare.test` desactivados (`is_active=false`) en PR #38.

### Acceso para QA

- **Admin Plataforma:** Test Phone `50378056365` / OTP `123456`. Header → "Panel Admin" → `/admin`.
- **Médico demo:** Test Phone `50378627694` / OTP `123456` (Camilo, ver `docs/CUENTA_DEMO_CAMILO.md`).
- **Paciente test (Fase 1):** Test Phone `50375000001` / OTP `123456`. Hay 3 patients precargados con marker `notes='test_patient_phase1'` para validar la vinculación retroactiva. Cleanup: `node scripts/setup-test-patient.mjs --clean`.
- Login sin SMS real vía Test Phone Numbers en Supabase Dashboard → Authentication → Phone.

### Setup local

Cada máquina necesita una vez:

```
cp .env.local.example .env.local
# completar SUPABASE_URL, SUPABASE_ANON_KEY (sb_publishable_*),
# SUPABASE_SERVICE_ROLE_KEY (sb_secret_*)
```

Scripts admin lo cargan automáticamente vía `scripts/_lib/env.mjs`.

---

## 2. Decisiones de producto vigentes (no reabrir)

### Modelo del médico (4 ejes independientes)
- `lucy_status` — funnel: `listed_only | claimed | booking_enabled | verified`.
- `is_published` — controla solo visibilidad en directorio. **No exige `is_operational`.**
- `is_operational` — gate del panel del médico (puede operar agenda).
- `booking_enabled` — muestra reserva en línea pública.
- `is_verified` — GENERATED de `lucy_status='verified'`. No editable manualmente.

### Directorio informativo (firmado en `docs/ANALISIS_DIRECTORIO_INFORMATIVO.md`)
- D1: completitud mínima para aparecer en directorio = full_name + specialty + clinic.name + address.
- D2: pill "Agenda en línea" / "Sin agenda en línea". Copy ES (sin "booking", "online", "onboarding" en UI pública). Orden: booking_enabled DESC primero.
- D3: waitlist idempotente UNIQUE(doctor_id, phone_normalized).
- D4: notificación manual desde admin (sin SMS auto, sin Edge Functions).

### Modelo de paciente global (firmado en `docs/ANALISIS_PACIENTE_GLOBAL.md`)
- DA1: identidad global en `profiles` extendido. `patients` sigue como ficha por clínica.
- DA2: vinculación retroactiva automática **solo con phone OTP-verified**.
- DA3: walk-in editable libremente hasta reclamo.
- DA4: "Mis atenciones" muestra clínica.

### Reclamo de perfil (firmado en `docs/ANALISIS_RECLAMAR_PERFIL.md`)
- Cambia **solo** `lucy_status: listed_only → claimed`.
- **NUNCA** toca `is_verified`, `is_published`, `booking_enabled`, `is_operational`, `services`, `availability_rules`.
- Match dual phone OTP-verified + license case-insensitive sin espacios.
- Audit log con `edited_via='claim_self_service'`.

### Auth (firmado en `docs/ANALISIS_AUTH_MEDICO.md`)
- Paciente: OTP por SMS (default).
- Médico/Admin: OTP **+** email/password (PR #39 ✅).
- Reset por email vía Supabase (PR #39 ✅).
- Activación de password en flujo de Reclamar perfil (PR #50 ✅ — paso obligatorio post-claim).
- **Ningún flujo público auto-crea médicos `claimed`** (PR #53 ✅). El antiguo "Soy médico" → form de 6 pasos quedó deprecado. Hoy es CTA "Soy médico, quiero aparecer" → `AffiliationRequestModal` que persiste lead en `doctor_affiliation_requests` (PR #56). LucyAdmin valida en `/admin/afiliaciones`. En Fase 2 (siguiente), aprobar creará el `doctors` row en `listed_only` y el médico entrará al flujo de Reclamar perfil estándar.

### Seguridad (firmado en `docs/SECURITY_GATE_PILOTO.md`)
- `service_role` rotado en PR #36 + invalidado el JWT legacy. Scripts leen `.env.local`.
- RLS hardening de `profiles`: anon solo (id, full_name, avatar_url) de médicos publicados.
- audit_log con coverage: claim, avatar, admin edits, reviews, waitlist, paciente global.
- Modales sensibles no cierran al click outside.
- SMTP transaccional con Resend (dominio `lucycare.app` comprado en Cloudflare, DNS gestionado ahí, SMTP custom en Supabase Auth). Hallazgo #6 del Security Gate ✅ cerrado en PR #46.
- Dominio público `https://lucycare.app` ✅ **live en producción** desde 2026-05-26 (PR #48). DNS en Cloudflare con CNAME en apex (vía CNAME flattening) y CNAME `www`. `www.lucycare.app` redirige 308 a apex. `lucycare.vercel.app` permanece activo como **fallback temporal** (no desactivar; sirve para links viejos en circulación + rollback rápido). Previews siguen vigentes en `lucycare-git-*.vercel.app`.

### Cuenta demo oficial — Camilo
Detallada en `docs/CUENTA_DEMO_CAMILO.md`. NO incluir en limpiezas. Mantenerla activa para validar todos los flujos del médico operativo real.

---

## 3. Stack de features pre-piloto (estado live)

| Feature | Donde vive | Estado |
|---|---|---|
| Reclamar perfil seguro | `/doctor/:id` card emerald + ClaimProfileModal | ✅ live |
| Card post-reclamo owner vs pública | `ClaimedProfileNoticeCard` | ✅ live |
| Foto de perfil médico (self/admin) | `/panel/perfil`, `/admin/medicos/:id`, AvatarUploader | ✅ live |
| Banner "completá con foto" en home panel | `/panel/home` cuando avatar_url null | ✅ live |
| Login email+password + tab Email | `LoginModal` (tab Email) | ✅ live |
| Reset por email | `/reset-password` | ✅ live |
| Directorio informativo | Home muestra publicados aunque no operativos | ✅ live |
| Pill "Agenda en línea / Sin agenda en línea" | `DoctorCard` + detalle | ✅ live |
| Lista de espera real | `WaitlistModal` + tabla `waitlist_entries` | ✅ live |
| Badge "Lista de espera: N" en admin | `/admin/medicos` | ✅ live |
| Sección lista de espera en ficha médica admin | `AdminDoctorWaitlistSection` | ✅ live |
| Paciente Global Fase 1 — vinculación retroactiva | RPC `claim_patient_records` post-OTP | ✅ live |
| "Mis atenciones" cross-clinic | `/paciente/mis-atenciones` | ✅ live |
| Dropdown "Mi cuenta" en header | `PatientAccountMenu` + `PatientHeader` | ✅ live |

---

## 4. Próximas fases (orden recomendado)

### 4.0 Próxima prioridad recomendada — SMOKE END-TO-END DE AFILIACIÓN

**No abrir código nuevo hasta completar este smoke operativo.** Valida que el doctor `listed_only` creado vía Fase 2 (PR #58) se puede reclamar correctamente vía el flujo estándar (PR #32 + #50).

**Pasos (en este orden estricto):**
1. Crear lead desde "Soy médico, quiero aparecer" (form público).
2. Admin (`50378056365` / `123456`) → `/admin/afiliaciones` → **aprobar** la solicitud.
3. Admin → **"Crear médico"** → confirmar estado resultante: `listed_only`, no publicado, no operativo, sin agenda.
4. Admin **publica temporalmente** el doctor (`is_published=true` desde ficha admin) para que el perfil público cargue.
5. Médico **reclama perfil** con: teléfono + OTP + licencia/JVPM + aceptación de términos + creación de contraseña.
6. Verificar que termina en "**Perfil reclamado**" y puede entrar al panel (pantalla "Perfil reclamado", NO "Cuenta suspendida").
7. Dev verifica DB: `lucy_status='claimed'`, `tos_accepted_at` seteado, `encrypted_password` seteado si creó password, `audit_log` con `edited_via='claim_self_service'`.
8. **Cleanup** de lead/doctor/clinic/auth.user de smoke.

**⚠️ Advertencias críticas:**
- **NO usar el teléfono test del paciente** (`50375000001`). El teléfono del smoke médico debe ser el mismo que queda guardado al crear el médico desde la solicitud.
- **NO hacer OTP con el teléfono del médico ANTES de que admin cree el doctor.** Supabase crearía un `auth.user` paciente (role=patient) con ese phone y la RPC `admin_approve_and_create_doctor` chocaría con el UNIQUE del phone → bloquea la creación. (Ya pasó una vez con `50375000099`; hubo que limpiar el residual antes del smoke.)
- **Usar un Test Phone médico exclusivo** en Supabase Dashboard → Auth → Phone (ej. `50375000099` / OTP `123456`), distinto del de paciente.
- **No confundir estados:** `listed_only` ≠ `claimed` ≠ `verified`. Crear médico desde afiliación deja `listed_only`; reclamar lo pasa a `claimed`; `verified` lo decide LucyAdmin manualmente.
- **Crear médico desde afiliación NO debe** publicar, verificar, activar agenda ni volver operativo automáticamente.

Estado actual del eje afiliación:
- ✅ Análisis (PR #52), mitigación legacy (PR #53), Q1-Q10 cerradas, plan operativo (PR #55), Fase 1 captura+bandeja (PR #56), Fase 2 conversión (PR #58), refresh docs (PR #59).
- ⏳ Smoke operativo claim end-to-end (este bloque).
- ⏳ Pendientes legal/diseño: DUI + TOS médico pre-verificación (`docs/PLAN_AFILIACION_MEDICO.md §11.bis`).

### 4.1 Pre-piloto público (operativo, no código)

1. ✅ **SMTP externo (Resend)** — completado en PR #46 (setup 2026-05-26). Ver `docs/SETUP_SMTP_RESEND.md`.
2. **Smoke 7.3 opcional** — validar capacidad con 5 resets seguidos. No bloqueante: rate limit builtin ya no aplica.
3. **Cleanup test patients Fase 1** cuando termine validación (`node scripts/setup-test-patient.mjs --clean`).

### 4.2 Auth — Fase 4 (estado)

- ✅ **PR-A** (PR #39): login email/password + reset por email.
- ✅ **PR-B** (PR #50): step obligatorio post-claim con dos caminos — "Crear contraseña ahora" (primario, fetch directo a `PUT /auth/v1/user`) o "Recibir link por email" (muestra email del profile + fallback amber).

Próximas fases (no urgentes para piloto):
- **Fase 2**: self-service de cambio de email/teléfono desde `/panel/cuenta`.
- **Fase 3**: 2FA opcional (TOTP).

### 4.3 Paciente Global — Fases 2-5

- **Fase 2**: extender `profiles` con DUI, DOB, género, dpto, muni. Página `/paciente/perfil` editable. Banner "completá tu perfil" cuando falta.
- **Fase 3**: RLS/trigger que bloquee al médico modificar datos personales del paciente cuando ya está vinculado a un profile.
- **Fase 4**: herramienta admin para fusionar duplicados (`admin_merge_patients` con audit).
- **Fase 5**: dedup preventivo cross-clinic al crear paciente desde walk-in.

Detalles en `docs/ANALISIS_PACIENTE_GLOBAL.md`.

### 4.4 Directorio — Follow-ups

- Vista global `/admin/lista-espera` cross-médicos con filtros (médico, fecha, estado).
- Sección "Lista de espera" en panel del médico (RLS ya permite, falta UI).
- Rate limit fuerte para tráfico público real (Cloudflare WAF o counter por IP en RPC).
- Notificación automática al activar `booking_enabled` (Edge Function + Twilio).

### 4.5 Admin SaaS restantes

- B4: disponibilidad/horarios desde admin.
- C: suspender/reactivar pacientes y asistentes.
- D: dashboard tracción mensual.
- E: UI sobre `admin_review_traceability` + moderar reseñas.
- F: explorador de `audit_log` con filtros.
- G: catálogos globales + onboarding manual de médico.

Cada fase: 1 PR chico · migración `s7_NN` (si aplica) + `scripts/check-s7_NN.mjs` · `vite build` OK · preview validado · luego merge.

---

## 5. Riesgos y reglas críticas

- **NO exponer contenido clínico** al admin plataforma. Validado en RLS y Security Gate.
- **Toda acción admin se audita** en `audit_log`. RPCs admin escriben `edited_via='admin'`.
- **No borrar médicos** con dependencias (citas/consultas/reviews): desactivar.
- **Sin `is_published`** → no aparecen en directorio público (pero sí en admin).
- **Sin `is_operational`** → no operan agenda (ven "Cuenta suspendida" en panel). Hoy NO controla visibilidad en directorio.
- **Validar con `vite build` real**, no solo `tsc --noEmit`.
- ~~**SMTP builtin de Supabase tiene rate limit de ~4 emails/h** — bloqueante para piloto público.~~ ✅ Resuelto en PR #46 con Resend (dominio `lucycare.app`).
- **NO commitear `service_role`** ni ningún JWT. Está rotado y el viejo invalidado, pero el repo es público.
- **NO commitear** la API key de Resend ni credenciales SMTP. Viven en Supabase Dashboard + password manager del owner.
- **Branches** con nombres cortos (`claude/<8-12 chars>`) para que Vercel no las trunque.

---

## 6. Archivos clave

**Docs (siempre leer antes de codear según el objetivo del día):**
- `CLAUDE.md` — guía rápida + sistema de diseño + tablero de decisiones.
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — este documento.
- `docs/HANDOFF_TOMA_DECISIONES_2.md` — handoff corto: decisiones cerradas + infra + próximos pasos.
- `docs/ESTADO_TECNICO.md` — ER/BD, matriz de reglas, flujos UI/UX.
- `docs/SECURITY_GATE_PILOTO.md` — auditoría de seguridad pre-piloto.
- `docs/CUENTA_DEMO_CAMILO.md` — cuenta demo oficial.
- `docs/FASE_4_AUTH_EMAIL.md` — guía Supabase URL/email config.
- `docs/SETUP_SMTP_RESEND.md` — Resend como SMTP custom (✅ live desde 2026-05-26).
- `docs/ANALISIS_RECLAMAR_PERFIL.md` — diseño del reclamo (Fase 2 ✅).
- `docs/ANALISIS_AUTH_MEDICO.md` — plan auth (PR-A ✅, PR-B en cola).
- `docs/ANALISIS_DIRECTORIO_INFORMATIVO.md` — modelo comercial directorio.
- `docs/ANALISIS_PACIENTE_GLOBAL.md` — modelo de paciente (Fase 1 ✅).
- `docs/ANALISIS_AFILIACION_MEDICO.md` — análisis del flujo "Solicitar afiliación" (Q1-Q10 ya cerradas).
- `docs/PLAN_AFILIACION_MEDICO.md` — plan operativo Fase 1 + Fase 2.
- `docs/PLAN_PILOTO_5_MEDICOS.md` — checklist piloto.

**Migraciones Sprint 7 + pre-piloto (todas aplicadas):**
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
- `s7_13_secure_claim_doctor_profile.sql`
- `s7_14_avatars_bucket_and_audit.sql`
- `s7_15_audit_reviews_trigger.sql`
- `s7_16_profiles_rls_hardening.sql`
- `s7_16b_drop_legacy_profile_policies.sql`
- `s7_17_deactivate_seed_doctors.sql`
- `s7_18_waitlist_entries.sql`
- `s7_19_waitlist_pending_count_by_doctor.sql`
- `s7_20_patient_global_phase1.sql`

**Scripts** (`/scripts/`):
- `_lib/env.mjs`, `_lib/supabase-admin.mjs`, `_lib/supabase-anon.mjs` — infra.
- `check-s7_NN.mjs` — verificador por migración.
- `setup-test-patient.mjs` — datos paciente global Fase 1 (--apply --reset --clean).
- `import-doctors.mjs`, `_deactivate-demos.mjs`, `check-patient-documents.mjs`, etc.
- `scripts/README.md` — guía completa de uso.

**Frontend — secciones críticas:**

Public site:
- `src/pages/home/page.tsx` — directorio + filtros + login/register.
- `src/pages/doctor-detail/page.tsx` — detalle + booking + claim.
- `src/pages/doctor-detail/components/{BookingCard, LoginModal, ClaimProfileModal, ClaimProfilePromptCard, ClaimedProfileNoticeCard, WaitlistModal}.tsx`.

Paciente:
- `src/pages/paciente/MisAtencionesPage.tsx`.
- `src/components/{PatientAccountMenu, PatientHeader}.tsx`.
- `src/router/PatientOnlyRoute.tsx`.

Reset password:
- `src/pages/reset-password/ResetPasswordPage.tsx`.

Panel médico:
- `src/pages/panel/perfil/PerfilPage.tsx` (con AvatarUploader).
- Otros bajo `src/pages/panel/*`.

Admin:
- `src/pages/admin/{AdminLayout, AdminDoctorsPage, AdminDoctorEditPage}.tsx`.
- `src/pages/admin/components/{AdminDoctorServicesSection, AdminDoctorWaitlistSection}.tsx`.

Servicios:
- `src/services/{auth, directory, booking, patients, claimProfile, avatar, waitlist, patientHistory, admin, doctorProfile}.service.ts`.
- `src/hooks/useClinicContext.ts`.

Infra:
- `src/lib/{supabase, session, phone, document, errors}.ts`.
- `src/main.tsx` — bootstrap defensivo con timeout.

---

## 7. Cómo retomar en una ventana nueva

```
Continuamos LucyCare.

git fetch origin && git checkout main && git pull --ff-only
git log --oneline -10

Leé en este orden:
1. CLAUDE.md
2. docs/HANDOFF_LUCYCARE_SPRINT7.md
3. [docs/ANALISIS_*.md o docs/FASE_*.md según el objetivo]

Estado: PRs #1–#59 mergeados (HEAD 8ec813c), migraciones hasta s7_23. SMTP Resend + dominio `lucycare.app` + Fase 4 PR-B ✅. Afiliación Fase 1 ✅ (captura) + Fase 2 ✅ (admin convierte lead en doctor `listed_only` con email override). Smoke end-to-end de afiliación: PENDIENTE.

Hoy hacemos: ___[próxima prioridad recomendada:
  - Smoke operativo del claim end-to-end del médico creado vía
    Fase 2 (test phone real del médico, no del paciente);

  otras opciones en cola:
  - Fase 2 Paciente Global perfil extendido (DUI/DOB/dpto/muni);
  - vista global /admin/lista-espera cross-médicos;
  - Fase 3 Paciente Global read-only datos del médico;
  - admin merge de pacientes duplicados;
  - SMS automático al invitar asistente (S5-08);
  - smoke 7.3 opcional capacidad SMTP (5 emails seguidos);
  - etc.
]___
```

Eso es todo lo que necesito para entrar en contexto.
