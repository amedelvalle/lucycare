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

Luego leé los documentos oficiales según el objetivo del día:

**Continuidad / base (siempre):**
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — handoff actualizado, snapshot vigente.
- `docs/HANDOFF_TOMA_DECISIONES_2.md` — handoff corto de decisiones + estado de infra + próximos pasos.
- `docs/ESTADO_TECNICO.md` — ER/BD, matriz de reglas, flujos UI/UX.

**Análisis vivos (cada uno cubre un eje):**
- `docs/SECURITY_GATE_PILOTO.md` — auditoría pre-piloto + hallazgos cerrados.
- `docs/ANALISIS_RECLAMAR_PERFIL.md` — diseño del reclamo (Fase 2 ✅ live).
- `docs/ANALISIS_AUTH_MEDICO.md` — plan auth email+password (PR-A ✅ live, PR-B en cola).
- `docs/ANALISIS_DIRECTORIO_INFORMATIVO.md` — modelo comercial del directorio.
- `docs/ANALISIS_PACIENTE_GLOBAL.md` — modelo de identidad de paciente (Fase 1 ✅ live).
- `docs/FASE_4_AUTH_EMAIL.md` — guía operativa Supabase URL/email config.
- `docs/SETUP_SMTP_RESEND.md` — Resend como SMTP custom de Supabase Auth (✅ live desde 2026-05-26, dominio `lucycare.app`).
- `docs/CUENTA_DEMO_CAMILO.md` — credenciales y reglas de la cuenta demo oficial.

**Planes:**
- `docs/PLAN_SPRINT7_ADMIN.md` — plan original Sprint 7 (cerrado en mayo).
- `docs/PLAN_PILOTO_5_MEDICOS.md` — checklist de piloto.

⚠️ **No mergear branches `claude/*` viejas.** Las fases se integran a
`main` por **squash-merge**: la rama queda en el remoto pero su
contenido YA está en `main`. Re-mergearlas genera conflictos. Tras un
squash-merge, la rama puede borrarse.

## Estado actual del proyecto (snapshot 2026-06-04)

- **Fuente de verdad:** `origin/main` en GitHub (github.com/amedelvalle/lucycare).
- **HEAD esperado:** `2a878f1` o posterior. **PRs #1–#82 mergeados** (#67 gate clínico asistente + `s7_26`, #70 Mi equipo Fase 1 + `s7_27`, #72 análisis correcciones post-firma, #73 plan correcciones Fase 0, #74 inmutabilidad consultas firmadas Etapa A + `s7_28`, #76 corrección controlada Etapa B1 + `s7_29`, **#79 filtro `is_current` en lecturas/impresión de recetas**, **#80 marca de impresión "RECETA CORREGIDA"**, **#81 distinción adenda texto vs receta + `s7_30`**, **#82 UI de corrección de consulta firmada — texto + receta**).
- **Sprint 6 — Reputación médica:** ✅ completado (PRs #2–#10).
- **Sprint 7 — Admin SaaS + Robustez pacientes:** ✅ Fases A, B, B2-A, B3-doctor, B3-admin (PRs hasta #30).
- **Pre-piloto (PRs #32–#58):** ✅ reclamo seguro, foto perfil, auth email+password (PR-A y PR-B), Security Gate (5 hallazgos cerrados), directorio informativo, lista de espera real, Paciente Global Fase 1, SMTP externo Resend, dominio público `lucycare.app`, password en flujo de Reclamar perfil, mitigación del flujo público "Soy médico", Afiliación médica Fase 1 (captura de leads + bandeja admin), **Afiliación Fase 2 (admin convierte lead aprobado en doctor `listed_only` con email override)**.
- **Migraciones aplicadas:** `s4_*`, `s5_01..s5_07`, `s6_01..s6_10`, `s7_01..s7_30` (`s7_26` = gate clínico asistente / PR #67; `s7_27` = límite de asistentes / PR #70; `s7_28` = inmutabilidad consultas firmadas Etapa A / PR #74; `s7_29` = corrección controlada Etapa B1 / PR #76; `s7_30` = distinción adenda texto vs receta — `affects_prescriptions` / PR #81). Verificables con `node scripts/check-s7_NN.mjs`.
- **Mi equipo Fase 1 — límite de asistentes (PR #70, `s7_27`) — activo:** plan base = 1 titular + **2 asistentes** (`team_seat_limit()`=2 fijo). El conteo incluye **asistentes activos + invitaciones pendientes**. Enforcement **server-side validado**: trigger `BEFORE INSERT` en `clinic_invitations` (`P0001`) + revalidación en `accept_clinic_invitations`. UI `/panel/equipo` con contador `n/2` + botón deshabilitado al límite. El smoke destapó y **corrigió un bug pre-existente** en `accept_clinic_invitations` (cast `clinic_member_role::user_role` imposible → ahora `::text::user_role`; el accept nunca había funcionado por falta de asistentes). **Usuarios adicionales → fase de pagos/add-ons** (`team_seat_limit()` es el punto de enganche con `subscriptions`).
- **Ubicación estructurada del médico (PR #64, `s7_25`) — live en producción:** LucyAdmin > Médicos > Editar > Clínica edita Departamento/Municipio con las listas jerárquicas del Home, guarda IDs en `clinics.department_id/municipality_id` (lo que filtra el directorio). Municipio depende del departamento; **obligatorios para médicos publicados/operativos** (enforcement server-side `P0004` + UI). Los 5 médicos publicados ya tienen ubicación estructurada.
- **Importación de médicos:** 100 cargados + 12 seed `*.lucycare.test` (desactivados en PR #38).
- **Médicos en producción hoy:** 5 publicados, 1 con `booking_enabled=true` (Camilo). Los otros 4 son "informativos" (sin agenda en línea).
- **Deploy:** Vercel auto-deploy desde `main`. `gh` CLI autenticado.
- **Service role:** rotado en PR #36. Scripts admin leen de `.env.local` (ENV vars), `service_role` no está en el repo.
- **Dominio público:** `https://lucycare.app` ✅ live en producción desde 2026-05-26 (PR #48). DNS gestionado en Cloudflare. `www.lucycare.app` redirige 308 a apex. `lucycare.vercel.app` permanece activo como **fallback temporal** (no desactivar). Previews siguen en `lucycare-git-*.vercel.app`.
- **SMTP transaccional:** Resend con dominio `lucycare.app` (verificado en Resend, DNS email — SPF/DKIM/DMARC — en Cloudflare), SMTP custom activo en Supabase Auth (PR #46). El rate limit builtin de ~4 emails/h ya no aplica.

## Decisiones cerradas (NO reabrir)

### Stack
- Backend: Supabase (Postgres + Auth + Edge Functions + Storage).
- Frontend: React 19 + TypeScript + Tailwind + Vite + React Query.
- Pagos: Stripe Checkout hosted.
- Hosting: Vercel + Supabase.
- Facturación DTE: diferida (API externa, no se desarrolla internamente).

### Modelo de datos / dominio
- Citas: una sola tabla `appointments` con campo `source`.
- Consulta clínica: guardar = borrador, firmar = inmutable.
- Servicios, diagnósticos, medicamentos: catálogos per-doctor (no globales, no CIE-10).
- Rol secretaria/asistente: incluido (agenda sí, ficha clínica no).
- Single-tenant operativo, **diseño tenant-ready** (conservar `clinic_id` siempre).
- **Modelo de paciente global (firmado en `docs/ANALISIS_PACIENTE_GLOBAL.md`):**
  - DA1: identidad global vive en `profiles` extendido. `patients` sigue como ficha por clínica.
  - DA2: vinculación retroactiva automática **solo** con phone OTP-verified.
  - DA3: walk-in editable libremente hasta reclamo.
  - DA4: "Mis atenciones" muestra la clínica.

### Auth
- OTP por SMS con Twilio para todos (paciente, médico, asistente, admin).
- Email + password como **segunda opción** para médico/admin (PR #39 ✅).
- Reset de password por email (PR #39 ✅).
- Activación de password dentro del flujo de Reclamar perfil (PR #50 ✅ — paso obligatorio post-claim con dos caminos: crear ahora / recibir link por email).
- **Ningún flujo público crea médicos `claimed` automáticamente** (PR #53 cerró esa puerta). Quien quiera afiliarse llena el formulario `/admin/afiliaciones` (PR #56 Fase 1) → LucyAdmin valida → en Fase 2 crea el `doctors` row como `listed_only` → médico hace el reclamo estándar (PR #32 + PR #50).
- **Afiliación Fase 1** (PR #56): captura de leads en `doctor_affiliation_requests` con bandeja admin para triage.
- **Afiliación Fase 2** (PR #58 + migraciones s7_22 y s7_23): RPC `admin_approve_and_create_doctor(p_request_id, p_overrides)` que en una transacción crea `auth.users` dormant + `profile` + `clinics` + `clinic_members` (owner) + `doctors` en `lucy_status='listed_only'` con flags conservadores (`is_published=false`, `is_operational=false`, `booking_enabled=false`). Email override solo aceptado si el lead no trajo email (regla server-side en s7_23). UI: botón "Crear médico" en `AdminAffiliationDetailModal` con form de overrides + pantalla éxito con link a ficha admin (no perfil público — el doctor no está publicado). El médico creado entra al flujo de Reclamar perfil estándar (PR #32 + #50) sin código nuevo del lado del médico.

### Ejes del médico (independientes)
- `lucy_status` enum: `listed_only | claimed | booking_enabled | verified`.
- `is_published`: aparece en directorio.
- `is_operational`: gate del panel (operar agenda).
- `booking_enabled`: muestra reserva en línea.
- `is_verified`: GENERATED de `lucy_status='verified'`. No editable a mano.
- **Regla clave del PR #41:** `is_published` ya **NO** exige `is_operational` para directorio. Solo controla visibilidad. Esto habilita médicos informativos.

### Directorio informativo (firmado en `docs/ANALISIS_DIRECTORIO_INFORMATIVO.md`)
- D1: completitud mínima — full_name + specialty + clinic.name + address.
- D2: pill "Agenda en línea" / "Sin agenda en línea". Copy ES (sin "booking", "online", "onboarding" en UI pública).
- D3: waitlist idempotente con UNIQUE(doctor_id, phone_norm).
- D4: notificación manual desde admin (sin SMS auto, sin Edge Functions).

### Seguridad
- RLS en todas las tablas, audit_log inmutable.
- `service_role` solo en scripts admin via `.env.local` (NO en frontend).
- `profiles` con RLS columna-level (anon solo (id, full_name, avatar_url) de publicados).
- Modales sensibles (LoginModal, ClaimProfileModal, WaitlistModal) NO cierran al click outside.

## Stack técnico verificado

- Imports usan alias `@/` (ej: `@/lib/supabase`).
- Auth usa `supabase.auth.getSession()` con timeout duro en `src/lib/session.ts` (a prueba del lock interno de supabase-js).
- React Query: `refetchInterval 30s` para citas, `60s` para notificaciones, `staleTime` variable.
- Iconos Remix (`ri-*`) en PanelLayout, SVG inline en componentes nuevos.
- Color acento del panel: emerald.
- Cliente Supabase con **lock no-op** (`src/lib/supabase.ts`) — evita pantallas blancas por locks huérfanos de navigator.locks.
- Bootstrap defensivo en `main.tsx`: valida sesión con timeout 3s antes de renderizar (PR #33).
- División territorial El Salvador 2024 cargada: `municipalities.name` = distrito (antiguo municipio), `municipalities.district` = nuevo municipio agrupador.
- Helpers compartidos:
  - `src/lib/phone.ts` — `normalizePhoneSV`.
  - `src/lib/document.ts` — `validateDocument`, `sanitizeDuiInput`, `formatDuiDisplay`.
  - `src/lib/errors.ts` — `friendlyErrorMessage`.
  - `src/lib/session.ts` — `getSessionWithTimeout` con `Promise.race`.

## Sistema de diseño (Sprint 4 — vinculante)

Establecido al notar inconsistencias acumuladas. **Toda pantalla nueva debe seguir esto. Páginas de referencia: `/panel/catalogos` y `/panel/servicios`.**

### Colores semánticos

- `emerald` → acción primaria, estado positivo (consulta firmada, paciente atendido).
- `blue` → información neutra, badges secundarios (asistente, permanente).
- `amber` → advertencia / borrador / validación inline.
- `red` → destructivo / cancelado / no asistió / errores.
- `gray` → neutro, fondos, texto secundario.

### Spacing y radius

- **Cards principales**: `bg-white rounded-2xl border border-gray-200 p-5`.
- **Sub-items dentro de cards** (filas de lista, items en form): `bg-gray-50 rounded-lg p-3`.
- **Inputs y selects**: `border border-gray-200 rounded-lg px-3 py-2 text-sm`.
- **Pills/badges**: `rounded-full px-2.5 py-0.5 text-xs font-medium`.
- **Modales**: `rounded-2xl shadow-xl p-6`.
- Gap consistente: `gap-3` para grupos relacionados, `gap-5` entre secciones.

### Botones — usar `<Button>` de `src/components/ui/Button.tsx`

4 variants: `primary` (emerald solid), `secondary` (gray solid), `subtle` (emerald soft pill), `danger` (red solid).
3 sizes: `sm`, `md`, `lg`.

### Copy en español (vinculante en UI pública)

- "Agenda en línea" (NO "online booking" / "agenda online").
- "Sin agenda en línea" (NO "no operativo" / "booking disabled").
- "Lista de espera" (NO "waitlist").
- "Reserva en línea" (NO "online booking").

### Patrones de modal

- **NO cerrar al click outside** en modales con form (LoginModal, ClaimProfileModal, WaitlistModal).
- Cerrar solo por: botón X, Escape, o éxito.
- Botón X disabled durante loading.
- `useEffect` con listeners siempre **antes** de cualquier `return null` por estado.

## Patrones de infraestructura (vinculantes)

### Cliente Supabase
- `src/lib/supabase.ts` con `lock: noopLock` (PR #33).
- NUNCA exponer `service_role` en frontend.
- Scripts admin: `import { supabaseAdmin } from './_lib/supabase-admin.mjs'` (lee de `.env.local`).

### useClinicContext (`src/hooks/useClinicContext.ts`)
Hook unificado que devuelve `{ profileId, role, clinicId, doctorId, doctorName, doctorIsOperational, availableDoctors }` para doctor o asistente. **Toda página del panel debe usarlo** — NO hacer lookup inline a `from('doctors')`.

### Audit log
- `src/services/auditLog.service.ts` con `logAuditEntry()` — no bloquea si falla.
- Schema: `audit_log` action ENUM ('select','insert','update','delete') — siempre minúsculas.
- Triggers de audit en: `consultations`, `patients`, `prescriptions`, `consultation_family_history`, `clinic_invitations`, `profiles.avatar_url`, `reviews` (s7_15), `waitlist_entries` (s7_18).
- Las RPCs admin (`admin_*`) escriben audit_log directamente en su cuerpo, con `edited_via: 'admin'` en `new_data`.
- RPCs especiales (claim, waitlist, paciente global) auditan con `edited_via` distintivo.

### Notificaciones del panel
- NO usa la tabla `notifications` (esa es para SMS/email salientes, futuro).
- Se derivan de `appointments` en `src/services/panelNotifications.service.ts`.
- Read/unread con timestamp en `localStorage`.

### Cuenta demo oficial — Dr. Camilo Carrillo / Pepe Toro

Detallada en `docs/CUENTA_DEMO_CAMILO.md`. NO incluir en limpiezas de seed.

| Campo | Valor |
|---|---|
| `profile_id` | `db1fba98-a299-4f25-82f1-7feff01e58fa` |
| `doctor_id` | `783a902a-55fd-407c-9e0a-69568135c7f5` |
| Phone (Test Phone) | `50378627694` / OTP `123456` |
| Email | `carlosmartinezddv@gmail.com` |

Estado: `lucy_status='verified'`, `is_published=true`, `is_operational=true`, `booking_enabled=true`. Con servicios, availability, ~50 appointments, ~15 consultations.

### Test Phones configurados

| Phone | OTP | Uso |
|---|---|---|
| `50378627694` | `123456` | Camilo (médico demo) |
| `50378056365` | `123456` | Admin de plataforma |
| `50375000001` | `123456` | Paciente test Fase 1 (con 3 patients precargados, marker `notes='test_patient_phase1'`) |

## Sprints completados

### Sprint 1-2 ✅
Directorio público + booking público con OTP + panel médico básico (disponibilidad, bloqueos).

### Sprint 3 ✅
Panel del médico: calendario 3 vistas, marcar estado + audit log, walk-in, pacientes, perfil público editable, rol asistente.

### Sprint 4 ✅
MVP de consulta clínica firmable e imprimible. Sistema de diseño documentado.

### Sprint 5 ✅
Antecedentes familiares, plan de seguimiento inline, estados de diagnóstico expandidos, Mi equipo, multi-doctor selector para asistente, paginación admin catálogos.

### Sprint 6 — Reputación médica ✅ (PRs #2–#10)
Encuesta post-cita con token único, NPS, score público ajustado bayesianamente, badges, comentarios anónimos, trazabilidad admin.

### Sprint 7 — Admin SaaS + Robustez ✅ (PRs #16–#30)
Admin SaaS completo (dashboard, listado, edición perfil/clínica/info/servicios). Robustez pacientes (document_number nullable, dedup teléfono, normalización SV, validación DUI).

### Pre-piloto — Bloqueantes cerrados ✅ (PRs #32–#58)
- **Reclamo seguro** (PR #32, s7_13).
- **Estabilización supabase-js lock** (PR #33).
- **Foto de perfil** (PR #34, s7_14).
- **Security Gate audit + trigger reviews** (PR #35, s7_15).
- **Rotar service_role + ENV vars** (PR #36).
- **RLS hardening profiles** (PR #37, s7_16, s7_16b).
- **Desactivar seed *.lucycare.test** (PR #38, s7_17).
- **Auth email + password + reset por email** (PR #39, Fase 4 PR-A).
- **LoginModal no cierra al click outside** (PR #40).
- **Directorio informativo + copy ES** (PR #41).
- **Análisis paciente global + decisiones** (PR #42).
- **Lista de espera real + badge admin** (PR #43, s7_18, s7_19).
- **Paciente Global Fase 1** (PR #44, s7_20).
- **SMTP externo Resend + reset por email validado** (PR #46, doc + setup operativo 2026-05-26, dominio `lucycare.app`).
- **Dominio público `lucycare.app` live en Vercel** (PR #48, setup operativo 2026-05-26, DNS en Cloudflare, www→apex 308, Supabase Site URL + reset email validados).
- **Password en flujo de Reclamar perfil** (PR #50, Fase 4 PR-B — step obligatorio post-claim, dos caminos: crear ahora / recibir link por email; copy "Perfil reclamado" diferenciado de "Cuenta suspendida"; sin migración).
- **Análisis del flujo "Solicitar afiliación"** (PR #52, `docs/ANALISIS_AFILIACION_MEDICO.md` — 10 secciones, 10 preguntas de decisión pendientes Q1-Q10).
- **Mitigación del flujo público "Soy médico"** (PR #53, Hallazgo #7 del Security Gate). El `DoctorRegistrationModal` legacy + `registerDoctor` service creaban automáticamente profile/clinic/clinic_member/doctor con `lucy_status='claimed'` directo, sin validación de identidad. **Neutralizado**: el botón abrió `DoctorInterestModal` (WhatsApp-only) como mitigación temporal. Sin persistencia en DB. Archivos legacy marcados `@deprecated`.
- **Afiliación Fase 1 — captura de leads + bandeja admin** (PR #56, `s7_21`). Reemplaza al `DoctorInterestModal` por `AffiliationRequestModal` con formulario completo. Persiste leads en `doctor_affiliation_requests` con RLS estricto, rate limit 1/IP/24h, UNIQUE phone activo. Bandeja `/admin/afiliaciones` con triage (in_review / approved / rejected) + badge en sidebar. No crea doctor/profile/clinic todavía.
- **Afiliación Fase 2 — convertir lead aprobado en doctor `listed_only`** (PR #58, `s7_22` + `s7_23`). RPC `admin_approve_and_create_doctor` crea auth.users dormant + profile + clinic + doctor en una transacción. Email override aceptado solo si lead no trajo email. UI: botón "Crear médico" en modal admin + pantalla éxito con link a ficha admin. **Claim end-to-end validado ✅ (2026-05-30, smoke con test phone médico real).** El smoke detectó 4 bugs corregidos en PR #61 + `s7_24` (el principal: el profile debe quedar `role='patient'` pre-claim, no `'doctor'`). Ver "Smoke end-to-end de afiliación" abajo.

## Próximas fases (en cola)

### Smoke end-to-end de afiliación — ✅ COMPLETADO (2026-05-30)

Validado el claim end-to-end del médico creado vía Fase 2, con test phone
médico real (`50375000099` / OTP `123456`). Resultado en DB: el doctor pasó
de `listed_only` → `claimed`, `tos_accepted_at` seteado, `audit_log` con
`edited_via='claim_self_service'`, y siguió sin `verified` / `is_operational`
/ `booking_enabled`. El claim pasó por el modal correcto y el password se
creó (confirmación visual del step "Contraseña creada").

**El smoke encontró 4 bugs en Fase 2; corregidos en PR #61 + migración `s7_24`:**
1. **Raíz — "Perfil reclamado" falso para `listed_only`.** La RPC `admin_approve_and_create_doctor` dejaba el profile con `role='doctor'` **antes** del reclamo; como ese profile coincide con el `auth.user` que el médico reusa al hacer OTP, entraba al panel pre-claim y veía "Perfil reclamado" sin haber corrido `claim_doctor_profile`. **Fix (`s7_24`):** el profile queda `role='patient'` pre-claim (igual que el login de un importado); `claim_doctor_profile` lo sube a `'doctor'` al reclamar. Un médico `listed_only` ya **no** entra al panel pre-claim.
2. **Nombre de clínica "Consultorio Dr. Dr. X"** cuando el nombre ya traía "Dr."/"Dra." → fix en el fallback.
3. **Modal admin "Crear médico" no precargaba Departamento/Municipio** (la persistencia server-side ya funcionaba; faltaba que `admin_list_affiliation_requests` devolviera los IDs). Fix en `s7_24` + frontend.
4. **Panel requería refresh** si `useClinicContext` fallaba → `PanelLayout` ahora muestra "Reintentar" en vez de spinner colgado.

**Aprendizajes operativos del smoke (conservar):**
- **NO hacer OTP con el teléfono del médico ANTES de que admin cree el doctor.** Supabase crearía un `auth.user` paciente que choca con el `UNIQUE` de phone en la RPC.
- **`listed_only` ≠ `claimed` ≠ `verified`.** Crear desde afiliación deja `listed_only`; reclamar → `claimed`; `verified` lo decide LucyAdmin.
- **"Perfil reclamado" en el panel NO prueba el claim** (con el copy viejo aparecía también para `listed_only`). La prueba es `lucy_status='claimed'` en DB.
- **`auth.admin.listUsers()` pagina mal** en este proyecto (bug GoTrue por fila corrupta en página 2). Para buscar/limpiar por phone, derivar el `auth.user.id` desde `profiles.id` (id compartido) y usar `getUserById`/`deleteUser`.

PR #61 (fix + `s7_24`) ✅ mergeado (commit `b2decba`). Después: opciones en cola (no bloqueantes para piloto) — ver "Pendientes prioritarios a conservar" más abajo.

### Pre-piloto público (operativo, no código)
1. **Smoke 7.3 opcional** — validar capacidad enviando 5 resets seguidos (no bloqueante, el rate limit builtin ya no aplica con SMTP externo).
2. **Cleanup test patients Fase 1** cuando termine la validación (`node scripts/setup-test-patient.mjs --clean`).

### Fase 4 — Auth robusta del médico
- ✅ **PR-A** (PR #39): login email/password + reset por email.
- ✅ **PR-B** (PR #50): password en flujo de Reclamar perfil.
- Próximo (post-piloto): Fase 2 self-service de cambio de email/teléfono. Fase 3 2FA opcional. Ver `docs/ANALISIS_AUTH_MEDICO.md`.

### Paciente Global (post Fase 1)
- **Fase 2**: perfil paciente extendido con DUI, DOB, género, dpto, muni.
- **Fase 3**: read-only datos personales para médico cuando paciente reclamó identidad.
- **Fase 4**: herramienta admin para fusionar duplicados.
- **Fase 5**: dedup preventivo cross-clinic al crear paciente.

### Directorio (follow-ups)
- Vista global `/admin/lista-espera` cross-médicos con filtros.
- Sección "Lista de espera" en panel del médico (RLS ya permite, falta UI).
- Rate limit fuerte para tráfico público real (Cloudflare o counter por IP).
- Notificación automática al activar `booking_enabled` (Edge Function + Twilio).

### Admin SaaS restantes (post-piloto)
- B4: disponibilidad/horarios desde admin.
- C: suspender pacientes/asistentes.
- D: dashboard tracción mensual.
- E: UI sobre `admin_review_traceability` + moderar reseñas.
- F: explorador de `audit_log` con filtros.
- G: catálogos globales + onboarding manual de médico.

### Pendientes prioritarios a conservar (snapshot 2026-05-27)
Backlog vivo de prioridad alta a revisar tras el smoke de afiliación:
- **Paciente Global / DUI**: DUI obligatorio o progresivo + identidad única del paciente (continúa `docs/ANALISIS_PACIENTE_GLOBAL.md` Fase 2+).
- **Ubicación estructurada Departamento/Municipio** en admin médico — ✅ corregido (PR #64, `s7_25`): la ficha admin (Editar médico > Clínica) edita Depto/Municipio con las mismas listas jerárquicas del Home, guarda IDs en `clinics.department_id/municipality_id` (lo que filtra el Home), municipio depende del departamento, y son obligatorios para publicados/operativos (enforcement server-side P0004 + UI). Sin lat/lng.
- **Filtro "Ordenar por" del Home** — ✅ corregido: la opción muerta "Más cercanos" se removió (no había lat/lng ni geolocalización; caía al orden default). Quedan "Disponibilidad/Mejor coincidencia" (orden server: booking_enabled→verified→created_at) y "Mejor valorados" (score ajustado), ambas funcionales. **Backlog:** reintroducir "Más cercanos" cuando exista lat/lng en `clinics` + ubicación del usuario + UX de permisos de geolocalización (no proxy por municipio — no es cercanía real).
- **Paginación / carga dinámica del Home** cuando haya muchos médicos (hoy carga todos).
- ~~**Mi equipo / invitados del médico** — máximo inicial **2 asistentes**~~ → ✅ **hecho (PR #70, `s7_27`)**: límite base 2 activo, conteo activos+pendientes, enforcement server-side (trigger + accept revalida), UI con contador `n/2`. Usuarios adicionales = add-on, pendiente de la fase de pagos. Fase 2 del análisis (expiración/reenvío de invitaciones) sigue en cola.
- **Catálogos personalizados por médico** para diagnósticos y medicamentos.
- **Flujo legal/comercial de DUI médico, términos y aceptación formal** pre-verificación (`docs/PLAN_AFILIACION_MEDICO.md §11.bis`).
- **Manejo de email en afiliación/onboarding médico** (override ya existe en Fase 2; falta self-service de cambio post-reclamo, Fase Auth post-piloto).
- **Error handling en PanelLayout / useClinicContext** — mitigado en PR #61: ahora muestra "Reintentar" en vez de spinner colgado si `useClinicContext` falla. Queda como follow-up entender la causa raíz del fallo de primera carga (posible race de sesión).

### Otros pendientes conocidos
- S5-01 Estilo de vida (tabaco, alcohol, METs, sueño, alimentación).
- S5-08 SMS automático al invitar asistente.
- Vista `/panel/consultas` global.
- Borradores pendientes de firmar en panel home.
- Vistas históricas del paciente (laboratorios, PDFs).
- Reportes/estadísticas para el médico.
- Extraer modales/diálogos legacy a `src/components/` (refactor).

## Deudas técnicas conocidas (priorizadas)

1. ~~**Asistente puede firmar consulta**~~ → ✅ **cerrado / reformulado (PR #67, `s7_26`).** El diagnóstico RLS (2026-06-01) mostró que la premisa era **inexacta**: `consultations`/`prescriptions`/`consultation_diagnoses` (y la **firma**) ya estaban bloqueadas para asistentes vía `doctor_id = get_user_doctor_id()` (= NULL para asistente). La fuga real estaba en **`consultation_family_history` y `vitals`** (usaban `is_clinic_member()`, true para cualquier miembro) → cerradas en `s7_26` (doctor-scoped). Validado con smoke empírico (asistente no lee ni escribe; médico dueño sin regresión).
2. **Inmutabilidad + corrección controlada de consultas firmadas** — ✅ **eje funcionalmente cerrado para texto clínico + receta/medicamentos.** Etapa A (PR #74, `s7_28`): edición silenciosa por API cerrada (firma vía RPC `sign_consultation()` + RLS endurecida `signed_at IS NULL`). Etapa B1 (PR #76, `s7_29`): corrección controlada — `consultation_amendments` append-only, **motivo obligatorio**, snapshots before/after (JSONB), **versionado de recetas** (anterior `is_current=false` histórica + v2 vigente), **solo médico dueño**, campos prohibidos rechazados (`P0013`), audit, vía RPC `amend_consultation()` (definer + bypass `app.amending`). PR #79: lecturas/impresión de recetas filtran `is_current=true` (no duplican v1+v2). PR #80: marca de impresión "RECETA CORREGIDA · fecha" + "Corrección vN" por medicamento. PR #81 (`s7_30`): columna `affects_prescriptions` → la marca se dispara **solo** si la corrección tocó receta (no por texto). PR #82: **UI completa** — modal "Corregir consulta firmada" con secciones Texto + Receta (editar/sustituir/agregar/quitar medicamento), motivo obligatorio, **confirmación reforzada** para receta, historial de adendas. UPDATE directo sigue bloqueado; asistente también. ⏳ **Único pendiente: B1.5** (extender `amend_consultation` a **diagnósticos / antecedentes familiares estructurados / signos vitales** — el snapshot ya los captura; falta el "apply" + UI). **B1.5 NO bloquea** el flujo principal texto + receta, que ya está live. Análisis `docs/ANALISIS_CORRECCIONES_CONSULTA_FIRMADA.md` + plan `docs/PLAN_CORRECCIONES_FASE0.md`.
3. **Inconsistencia visual** pantallas legacy (PacientesPage, AppointmentDetailPanel, BloqueosPage) — no usan `<Button>` reusable.
3. **Sin sistema global de toasts** — `friendlyErrorMessage` ayuda, pero algunos flujos siguen sin feedback.
4. **Print de receta minimalista** — sin logo de clínica, sin QR.
5. **No hay vista `/panel/consultas`** — solo se accede via cita o paciente.
6. **WaitlistModal** todavía tiene el patrón legacy de click-outside-cierra; no es bloqueante (ya tiene UX correcta), pero por consistencia con LoginModal valdría hardening idéntico cuando se toque.

## Datos en DB (snapshot 2026-05-27)

- ~113 doctores totales. 5 publicados (4 informativos + 1 con agenda en línea).
- 12 seed `*.lucycare.test` desactivados (`is_active=false`).
- 14 departments, 262 municipalities con `district` (división 2024).
- 20+ especialidades.
- 10 cancel_reasons pre-cargadas.
- ~1651 diagnósticos + ~9568 medicamentos en catálogos per-doctor.
- ~22 pacientes en `patients`. Mismo phone puede aparecer en N clínicas (modelo legacy tenant-aware, en proceso de evolución a global — Fase 1 lo vincula vía profile_id).
- ~54 appointments, ~15 consultations.
- waitlist_entries: tabla activa.

## Migraciones SQL aplicadas

Todas corridas en Supabase. Cada `s6_*`/`s7_*` con `check-*.mjs` cuando aplica.

**Sprint 4-5:** `s4_01..s4_02`, `s5_01..s5_07`.

**Sprint 6 (reputación):** `s6_01..s6_10`.

**Sprint 7 (admin + robustez):**
- `s7_01` admin foundation.
- `s7_02` admin doctors.
- `s7_03` is_verified GENERATED.
- `s7_04` admin search/paginate.
- `s7_05` admin edit doctor.
- `s7_06` fix clinic update.
- `s7_07` clinics updated_at.
- `s7_08` services delete policy.
- `s7_09` block inactive service.
- `s7_10` patient document nullable.
- `s7_11` normalize patient phone.
- `s7_12` admin services RPCs.

**Pre-piloto (PRs #32+):**
- `s7_13` reclamo seguro — RPC `claim_doctor_profile`.
- `s7_14` foto de perfil — bucket avatars + RLS + RPC admin + trigger audit.
- `s7_15` audit log trigger para reviews.
- `s7_16` + `s7_16b` RLS hardening de profiles (column-level + drop policies legacy).
- `s7_17` desactivación seed `*.lucycare.test`.
- `s7_18` waitlist_entries — tabla + RPC público + RPCs admin + triggers audit.
- `s7_19` bulk count waitlist por doctor.
- `s7_20` Paciente Global Fase 1 — RPC `claim_patient_records` + policies SELECT-self.

## Scripts utilitarios (`/scripts/`)

**Setup** (cada máquina, una vez):
- Copiar `.env.local.example` → `.env.local` con `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Los scripts leen de ahí automáticamente vía `scripts/_lib/env.mjs`.

**Helpers compartidos:**
- `scripts/_lib/env.mjs` — carga `.env.local`.
- `scripts/_lib/supabase-admin.mjs` — cliente service_role.
- `scripts/_lib/supabase-anon.mjs` — cliente anon.

**Comandos típicos:**
- `node scripts/check-s7_NN.mjs` — verifica una migración (NN del 13 al 20).
- `node scripts/import-doctors.mjs --file ... --apply` — importador idempotente.
- `node scripts/_deactivate-demos.mjs` — desactiva demos, preserva Camilo.
- `node scripts/setup-test-patient.mjs --apply|--reset|--clean` — datos de prueba paciente global.
- `node scripts/check-patient-documents.mjs` — diagnóstico DUIs.

`scripts/README.md` tiene la guía completa.

## Cómo crear una asistente

Desde `/panel/equipo` → "Invitar asistente" → teléfono → la asistente se loguea con OTP y queda activa automáticamente vía RPC `accept_clinic_invitations`. SMS automático al invitar **no está implementado** (S5-08, en backlog).

## Tags y commits importantes

```
2a878f1 feat(consulta): corrección de consulta firmada — texto + receta (B2, Opción A) (#82)
c3bba6d feat(receta): distinguir adenda de texto vs receta para la marca de impresión (B3.1 / s7_30) (#81)
596aaf1 feat(receta): marca de impresión para receta corregida (PR-3 / B3) (#80)
432ef91 fix(receta): filtrar is_current=true en lecturas/impresión de recetas (PR-1) (#79)
5775212 docs: handoff de cierre — contexto consolidado para nueva ventana (#78)
611acf8 docs: refresh post-#76 — Etapa B1 corrección controlada de consultas firmadas (#77)
da5bbab feat(clinico): correcciones post-firma — Etapa B/B1 (adendas + amend_consultation) (#76)
cc71e0b feat(clinico): inmutabilidad server-side de consultas firmadas (Etapa A) (#74)
0abaf23 feat(equipo): límite de 2 asistentes incluidos (Mi equipo Fase 1) (#70)
9f6c6bf feat(security): gate clínico del rol asistente — RLS doctor-scoped (Fase 0) (#67)
1a2cc28 docs: análisis de Mi equipo / invitados del médico (#66)
ed5721f feat(admin): ubicación estructurada (Depto/Municipio) en la ficha del médico (#64)
685f0ec fix(directorio): quitar opción muerta "Más cercanos" del orden del Home (#63)
c87e189 docs: análisis de pagos SaaS autoservicio (suscripción del médico) (#62)
cda1556 docs: handoff de ventana — Afiliación Fase 2 + smoke end-to-end completado (#60)
b2decba fix(afiliacion): Fase 2 — role=patient pre-claim + precarga ubicación + panel copy (#61)
8ec813c docs: refresh post-PR #58 — Afiliación Fase 2 live (#59)
f427ed3 feat(afiliacion): Fase 2 — convertir lead aprobado en doctor listed_only (#58)
c69ea91 docs: refresh post-PR #56 — Afiliación Fase 1 live (#57)
6046d6c feat(afiliacion): Fase 1 — captura de leads + bandeja admin (#56)
269131e docs: plan operativo del flujo Solicitar afiliación médica (#55)
1bd9774 docs: refresh post-PR #53 — mitigación flujo "Soy médico" (#54)
f7fa227 fix(security): neutralizar flujo "Soy médico" — reemplaza por captura de interés (#53)
e1db56c docs: análisis del flujo "Solicitar afiliación" del médico (#52)
e66be15 docs: refresh post-PR #50 — Fase 4 PR-B completada (#51)
a2b1f96 feat(auth): password en flujo de Reclamar perfil (Fase 4 PR-B) (#50)
813c2a2 docs: refresh post-PR #48 — lucycare.app como dominio público principal (#49)
d61ae3f chore(infra): configurar dominio público lucycare.app (#48)
518b84e docs(project): registrar SMTP externo Resend como configurado (#47)
f7797a5 docs(auth): documentar setup SMTP externo con Resend (#46)
b303270 docs: refresh CLAUDE.md + HANDOFF post-PR #44 (#45)
4c4fef1 feat(paciente): Paciente Global Fase 1 — vinculación retroactiva + Mis atenciones (#44)
2d4c94a feat(directorio): lista de espera real + badge admin (#43)
4225687 docs: análisis del modelo de paciente global + decisiones (#42)
106f5f0 feat(directorio): modelo informativo + copy ES (#41)
7bcc0dd fix(login-modal): no cerrar al click fuera del modal (UX) (#40)
5c09a4a feat(auth): email + password + reset por email (Fase 4 PR-A) (#39)
5438c9b chore(seed): desactivar médicos seed *.lucycare.test (#38)
ea7a3cc feat(security): RLS hardening de profiles (#37)
721e7e4 chore(security): mover service_role + anon a ENV vars (#36)
254ea94 docs(security): Security Gate piloto + audit_log para reviews (#35)
8075853 feat(perfil): foto de perfil opcional post-reclamo (#34)
babde41 fix(supabase): deshabilitar lock global del cliente (no-op) (#33)
b4702b3 feat(reclamo): flujo seguro de "Reclamar perfil" (Fase 2) (#32)
3e28eff docs: snapshot post-PR #30 + análisis para auth/reclamo + plan piloto (#31)
f6a4f32 feat(admin): B3-admin — administración de servicios del médico (#30)
```

Volver a un punto anterior:
```bash
git reset --hard piloto-v1
git push --force-with-lease origin main
```

## Cómo arrancar en un nuevo chat de Claude Code

1. Sincronizar repo + leer este archivo + los docs oficiales del objetivo de hoy.
2. `git log --oneline -10` para ver el último estado.
3. NO asumir nada — leer el código antes de tocarlo.
4. Decisión grande sin consultar = problema. Cuestionar suposiciones.
5. Seguir el sistema de diseño documentado arriba para toda pantalla nueva.
6. Si el objetivo es algo ya analizado (auth, reclamo, paciente global, directorio), leer el `docs/ANALISIS_*.md` correspondiente — **no re-analizar**.
7. Mantener branches con nombres cortos (`claude/<8-12 chars>`) para que Vercel no las trunque.

## Plantilla para arrancar una sesión nueva

```
Continuamos LucyCare.

git fetch origin && git checkout main && git pull --ff-only
git log --oneline -10

Leé en este orden:
1. CLAUDE.md
2. docs/HANDOFF_LUCYCARE_SPRINT7.md
3. [docs/ANALISIS_*.md o docs/FASE_*.md según objetivo de hoy]

Estado: PRs #1–#77 mergeados (HEAD 611acf8), migraciones hasta s7_29 (aplicadas en Supabase). SMTP Resend + dominio `lucycare.app` + Fase 4 PR-B ✅. Afiliación Fase 1+2 + smoke ✅. Ubicación estructurada admin ✅ (PR #64). Gate clínico asistente ✅ (PR #67). Mi equipo Fase 1 límite 2 asistentes ✅ (PR #70). Correcciones post-firma: análisis (#72) + plan (#73) + **Etapa A inmutabilidad ✅ (#74, `s7_28`) + Etapa B1 corrección controlada ✅ (#76, `s7_29`)** → ⏳ B1.5 (diag/antecedentes/vitales), B2 (UI), B3 (impresión receta corregida). Análisis pagos SaaS ✅ doc base (PR #62).

Hoy hacemos: ___[opciones en cola (smoke afiliación ya cerrado):
                   - análisis de pagos SaaS autoservicio;
                   - vista global /admin/lista-espera cross-médicos;
                   - Paciente Global Fase 2 (DUI/DOB/dpto/muni);
                   - DUI + TOS del médico pre-verificación (PLAN_AFILIACION §11.bis);
                   - ubicación estructurada Depto/Muni en ficha admin del médico;
                   - Admin SaaS B4 (disponibilidad desde admin);
                   - smoke 7.3 opcional capacidad SMTP;
                   - etc.]___
```

## Documentos fuente originales (en raíz)

- `LucyCare_Schema_DB.docx`
- `LucyCare_Backlog_Estrategico.docx`
- `LucyCare_DocTecnico_Completo.docx`
- `Notas_Sprint3.docx`
