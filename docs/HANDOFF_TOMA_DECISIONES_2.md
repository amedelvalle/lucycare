# HANDOFF LucyCare — Toma de decisiones 2

> Documento breve de continuidad para nuevas ventanas/contextos de
> LucyCare. Enfocado en **decisiones tomadas, estado actual, PRs
> cerrados y próximos pasos** — no reemplaza al snapshot completo
> (`docs/HANDOFF_LUCYCARE_SPRINT7.md`) ni a los análisis vivos
> (`docs/ANALISIS_*.md`).
>
> **Snapshot 2026-05-27** (post-PR #56 — Afiliación Fase 1 live).
>
> Objetivo: permitir retomar el proyecto sin reanalizar decisiones ya
> tomadas.

---

## 1. Estado actual consolidado

- **PR #43** ✅ mergeado — lista de espera real + badge admin (`s7_18`, `s7_19`).
- **PR #44** ✅ mergeado — Paciente Global Fase 1 (`s7_20`).
- **PR #45** ✅ mergeado — refresh docs post-PR #44.
- **PR #46** ✅ mergeado — SMTP externo Resend + Supabase Auth SMTP custom validado end-to-end.
- **PR #47** ✅ mergeado — refresh documental post-Resend (incluye este archivo).
- **PR #48** ✅ mergeado — dominio público `lucycare.app` live en Vercel + Cloudflare DNS + Supabase Site URL + reset email validado end-to-end.
- **PR #49** ✅ mergeado — refresh documental post-#48 (CLAUDE.md / HANDOFFs / FASE_4_AUTH / SETUP_SMTP_RESEND / PLAN_PILOTO actualizados a `lucycare.app` con `vercel.app` como fallback).
- **PR #50** ✅ mergeado — Fase 4 PR-B: password en flujo de Reclamar perfil. Step obligatorio post-claim con dos caminos (crear ahora / recibir link por email). Sin migración. Incluye fix de copy "Perfil reclamado" diferenciado de "Cuenta suspendida" en `PanelLayout` + guard contra flash al cargar el contexto.
- **PR #51** ✅ mergeado — refresh documental post-#50.
- **PR #52** ✅ mergeado — análisis del flujo "Solicitar afiliación". 10 secciones, hallazgo R8 documentado (auto-registro inseguro en home).
- **PR #53** ✅ mergeado — mitigación inmediata del hallazgo R8. Sin persistencia en DB.
- **PR #54** ✅ mergeado — refresh documental post-#53 (Hallazgo #7 cerrado en Security Gate).
- **PR #55** ✅ mergeado — plan operativo `docs/PLAN_AFILIACION_MEDICO.md` (Fase 1 + Fase 2).
- **PR #56** ✅ mergeado — **Afiliación Fase 1** (`s7_21`). Tabla `doctor_affiliation_requests` + RPCs anon/admin + bandeja admin con triage. Validación de Lectura A (mínimo name+phone+LOPD). Smoke completo OK (check-s7_21 16/16, smoke admin OK). NO crea doctor/profile/clinic; conversión queda para Fase 2.

`main` HEAD esperado tras PR #56: `6046d6c` o posterior, snapshot 2026-05-27, PRs #1–#56.

## 2. Infraestructura actual

| Capa | Proveedor | Estado |
|---|---|---|
| Repositorio y PRs | GitHub (`github.com/amedelvalle/lucycare`) | ✅ activo, repo público |
| Deploy producción | Vercel (auto-deploy desde `main`) | ✅ **`https://lucycare.app`** (apex) + `www.lucycare.app` (redirect 308 a apex) |
| Previews por PR | Vercel | ✅ `lucycare-git-*.vercel.app` siguen vigentes |
| URL fallback temporal | Vercel (`lucycare.vercel.app`) | ✅ activo — **no desactivar** (links viejos en circulación + rollback) |
| DB / Auth / RLS / RPCs / Storage | Supabase | ✅ activo. Auth Site URL = `https://lucycare.app` |
| Auth SMTP transaccional | Supabase Auth → SMTP custom → Resend | ✅ activo desde 2026-05-26 |
| Dominio | `lucycare.app` | ✅ comprado en Cloudflare, DNS gestionado en Cloudflare |
| DNS web (apex + www) | Cloudflare | ✅ CNAME `@` → `…vercel-dns-017.com`, CNAME `www` → `cname.vercel-dns.com`, ambos DNS only |
| DNS email (SPF / DKIM / DMARC) | Cloudflare | ✅ configurado para Resend, **no tocar** |
| Envío de correos transaccionales | Resend (dominio `lucycare.app`) | ✅ verificado + smoke OK |

**Notas:**

- **Dominio público principal:** `https://lucycare.app`. `www.lucycare.app` redirige 308 a apex.
- **`lucycare.vercel.app` queda como fallback temporal**, no se desactiva. Sirve para reset links viejos aún válidos + rollback rápido.
- **Previews de Vercel** (`lucycare-git-*.vercel.app`) siguen vigentes para PRs.
- Resend usa el dominio `lucycare.app` para el sender; ese setup es **independiente** del dominio público web. Los registros DNS de email (`resend._domainkey`, `send` MX/TXT, `_dmarc`) son distintos de los registros web y no se deben tocar.

## 3. Decisiones cerradas recientes (no reabrir)

### Paciente Global Fase 1 (PR #44)

- Vinculación retroactiva automática **solo con phone OTP-verified** (DA2).
- Identidad global vive en `profiles` extendido (DA1). `patients` sigue como ficha por clínica.
- Walk-in editable libremente hasta que el paciente reclame (DA3).
- "Mis atenciones" muestra clínica (DA4) y **solo datos operativos**, sin contenido clínico profundo.
- Header del paciente con dropdown "Mi cuenta" (`PatientAccountMenu` + `PatientHeader`).

### Lista de espera (PR #43)

- Tabla `waitlist_entries` con `UNIQUE (doctor_id, phone_normalized)` — idempotente.
- Badge "Lista de espera: N" en admin sobre `/admin/medicos`.
- Notificación al activar `booking_enabled` queda **manual** desde admin (sin SMS auto, sin Edge Function por ahora).

### SMTP externo / Resend (PR #46)

- Proveedor: **Resend** con dominio `lucycare.app`.
- API key creada con permisos **`Sending access`** (no full access). Vive en Supabase Dashboard + password manager del owner — **no** en el repo.
- DNS de email en Cloudflare (SPF + DKIM + DMARC).
- Smoke real validado el 2026-05-26: reset email recibido desde `LucyCare`, link abrió `/reset-password`, cambio de contraseña OK, login con contraseña nueva OK.
- Hallazgo #6 del Security Gate cerrado.

### Afiliación de médicos nuevos (PRs #52 + #53 + #55 + #56)

- **Regla cerrada (no reabrir):** ningún flujo público debe crear médicos `claimed` automáticamente. La identidad del médico se valida por LucyAdmin antes de existir en `doctors`.
- **Decisiones Q1-Q10 cerradas** (PR #55, plan operativo). Lectura A confirmada: mínimo absoluto del form = name + phone + LOPD; license/email/especialidad son recomendados pero no bloqueantes; lead sin esos campos entra con `incomplete=true`.
- **Fase 1 ✅ live (PR #56):** `AffiliationRequestModal` en home reemplaza al `DoctorInterestModal` legacy. Persiste leads en `doctor_affiliation_requests` (`s7_21`) con RLS estricto, UNIQUE phone activo, rate limit 1/IP/24h. Bandeja `/admin/afiliaciones` con triage (in_review / approved / rejected). Página `/privacidad` MVP. Sin auto-creación de doctores.
- **Archivos legacy:** `DoctorRegistrationModal`, `registerDoctor` service y `DoctorInterestModal` quedan `@deprecated`. **Prohibido importarlos desde código nuevo.**
- **Fase 2 pendiente:** RPC `admin_approve_and_create_doctor` que en una transacción crea profile huérfano + clinic + doctor en `listed_only`. Botón "Aprobar y crear médico" en `AdminAffiliationDetailModal`. Médico aprobado entra al flujo de Reclamar perfil existente. Plan completo en `docs/PLAN_AFILIACION_MEDICO.md` §9.

### Auth Fase 4 PR-B — password en Reclamar perfil (PR #50)

- Step obligatorio "Contraseña" tras un claim exitoso. Sin botón "Lo hago después", sin X visible durante el step, sin Esc, sin click-outside-closes.
- Dos opciones:
  - **Primaria:** "Crear contraseña ahora" → `PUT /auth/v1/user` con fetch directo (no usa wrapper de supabase-js para evitar hang). Timeout 8s, errores mapeados (401 sesión expiró, 422 password débil, etc.).
  - **Secundaria:** "Recibir link por email" → muestra el email del profile, fallback amber si no hay. Usa `requestPasswordReset`.
- Banner success diferenciado por outcome (emerald `password_set` / blue `email_sent`).
- Copy de PanelLayout diferencia "Perfil reclamado" (listed_only/claimed + !is_operational) de "Cuenta suspendida" (booking_enabled/verified + !is_operational).
- Guard contra flash del panel al hacer login post-claim (espera tanto `user` como `ctx` antes de renderizar).
- Sin migración. Sin tocar templates de email, paciente, lista de espera ni dominio.

### Reglas operativas que se mantienen

- **No guardar secretos** (API keys, SMTP password, service_role, credenciales de Vercel/Cloudflare/Resend/Supabase) en repo, docs, commits, ni chat.
- **No desactivar `lucycare.vercel.app`** — queda como fallback temporal hasta que se decida quitarlo en una limpieza diferida (ver `docs/SETUP_VERCEL_DOMAIN.md` §5.6).
- **Squash-merge** para integrar branches `claude/*`. Tras el merge, la rama puede borrarse.

## 4. Seguridad

- `service_role` rotado en PR #36 e invalidado el JWT legacy. Scripts admin leen `.env.local`.
- RLS endurecido en `profiles` (PR #37) — anon solo ve `(id, full_name, avatar_url)` de médicos publicados.
- `audit_log` con coverage amplio (claim, avatar, admin edits, reviews, waitlist, paciente global).
- Modales sensibles (LoginModal, ClaimProfileModal) no cierran al click outside.
- SMTP builtin de Supabase y su rate limit de ~4 emails/h **ya no son cuello de botella** — Resend está activo.
- Secrets viven en dashboards (Supabase, Resend, Cloudflare, Vercel) y en password manager del owner. No en GitHub.

**Pendiente conocido:** rate limit fuerte para flujos públicos (Cloudflare WAF o counter por IP en RPCs sensibles tipo `claim_doctor_profile`, `waitlist`). No bloqueante para piloto chico.

## 5. Pendientes inmediatos

### 5.1 Afiliación Fase 2 (próxima prioridad)

Fase 1 ya está live (PR #56). Próximo paso: convertir un lead aprobado en un `doctors` row real.

Plan detallado en `docs/PLAN_AFILIACION_MEDICO.md` §9. Resumen:
- RPC `admin_approve_and_create_doctor(p_request_id, p_overrides)` que en una transacción atómica:
  - Crea `profiles` huérfano (sin auth.users; mismo patrón que `import-doctors.mjs`).
  - Crea `clinics` con nombre del lead o override.
  - Crea `doctors` con `lucy_status='listed_only'`, `is_published=false`, `is_operational=false`, `booking_enabled=false`.
  - Vincula `doctor_id` + `clinic_id` en el lead.
- UI: botón "Aprobar y crear médico" en `AdminAffiliationDetailModal` (visible cuando status=in_review o approved sin doctor_id). Modal de confirmación con form pre-rellenado para que admin pueda ajustar nombre/especialidad/clínica.
- Audit log con `edited_via='admin'`.
- Comunicación al médico sigue manual (Q3).
- Cero código nuevo del lado del médico: una vez creado en `listed_only`, entra al flujo de Reclamar perfil + Fase 4 PR-B ya existentes.

Tamaño estimado: 2-3 días (1 migración corta o solo CREATE FUNCTION + UI chica en admin).

### 5.2 Limpiezas operativas diferidas (no bloqueantes)

- **`lucycare.vercel.app` como fallback:** mantenerlo activo al menos hasta que se haya rotado todo el ciclo de reset links viejos. En algún momento opcional, configurarlo como redirect 301 a `lucycare.app` desde Vercel — ver `docs/SETUP_VERCEL_DOMAIN.md` §5.6.
- **Redirect URLs en Supabase:** quitar `https://lucycare.vercel.app/**` cuando no haya links viejos circulando. No urgente.
- **Cleanup test patients Fase 1:** `node scripts/setup-test-patient.mjs --clean` cuando termine la validación.
- **Smoke 7.3 opcional (SMTP):** 5 resets seguidos para confirmar que el rate limit builtin ya no aplica.

## 6. Backlog posterior

- Vista global `/admin/lista-espera` cross-médicos con filtros.
- Sección "Lista de espera" en panel del médico (RLS ya permite, falta UI).
- Perfil paciente extendido — Paciente Global Fase 2 (DUI, DOB, género, dpto, muni).
- Read-only datos personales para médico cuando el paciente reclamó — Paciente Global Fase 3.
- Merge admin de duplicados — Paciente Global Fase 4.
- Dedup preventivo cross-clinic al crear paciente desde walk-in — Paciente Global Fase 5.
- Templates de email en español (Confirmation, Magic Link además del Reset ya hecho).
- SMS automático al invitar asistente (S5-08).
- Admin SaaS restantes: B4 (disponibilidad desde admin), C (suspender pacientes/asistentes), D (dashboard tracción), E (moderar reseñas), F (explorador audit_log), G (catálogos globales).
- Notificación automática al activar `booking_enabled` (Edge Function + Twilio).

## 7. Reglas para próximas ventanas

1. **Sincronizar `main` antes de tocar nada** (`git fetch && git checkout main && git pull --ff-only`) y mirar `git log --oneline -10`.
2. **No codificar antes** de confirmar el estado de `main` y los PRs abiertos.
3. **No mezclar** configuración de dominio Vercel con Fase 4 PR-B (son PRs distintos).
4. **No tocar los registros DNS de email** de Resend al configurar el dominio web — son registros separados, viven en la misma zona pero distintos hostnames (`resend._domainkey`, `send` MX/TXT, `_dmarc`).
5. **No incluir secretos** en código, docs, commits ni descripción de PRs.
6. **PRs pequeños y testeables**, branches con nombre corto (`claude/<8-12 chars>`) para que Vercel no las trunque.
7. Si un docs afirma un estado ("ya configurado", "live", "verificado"), confirmar contra el dashboard real antes de mergear.

---

## 8. Referencias

- `CLAUDE.md` — guía rápida + sistema de diseño + tablero de decisiones.
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — snapshot completo de Sprint 7 + pre-piloto.
- `docs/SETUP_SMTP_RESEND.md` — guía operativa + checklist Resend (✅ live).
- `docs/FASE_4_AUTH_EMAIL.md` — guía Supabase URL/email config.
- `docs/SECURITY_GATE_PILOTO.md` — auditoría pre-piloto (Hallazgo #6 cerrado en PR #46).
- `docs/ANALISIS_AUTH_MEDICO.md` — plan Fase 4 PR-B (próximo después del dominio).
- `docs/ANALISIS_PACIENTE_GLOBAL.md` — modelo de paciente global.
- `docs/ANALISIS_DIRECTORIO_INFORMATIVO.md` — modelo comercial directorio.
- `docs/ANALISIS_RECLAMAR_PERFIL.md` — diseño del reclamo.
- `docs/CUENTA_DEMO_CAMILO.md` — cuenta demo oficial.
