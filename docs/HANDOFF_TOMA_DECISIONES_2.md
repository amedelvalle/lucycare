# HANDOFF LucyCare — Toma de decisiones 2

> Documento breve de continuidad para nuevas ventanas/contextos de
> LucyCare. Enfocado en **decisiones tomadas, estado actual, PRs
> cerrados y próximos pasos** — no reemplaza al snapshot completo
> (`docs/HANDOFF_LUCYCARE_SPRINT7.md`) ni a los análisis vivos
> (`docs/ANALISIS_*.md`).
>
> **Snapshot 2026-05-26.**
>
> Objetivo: permitir retomar el proyecto sin reanalizar decisiones ya
> tomadas.

---

## 1. Estado actual consolidado

- **PR #43** ✅ mergeado — lista de espera real + badge admin (`s7_18`, `s7_19`).
- **PR #44** ✅ mergeado — Paciente Global Fase 1 (`s7_20`).
- **PR #45** ✅ mergeado — refresh docs post-PR #44.
- **PR #46** ✅ mergeado — SMTP externo Resend + Supabase Auth SMTP custom validado end-to-end.
- **PR #47** — refresh documental post-Resend (incluye este archivo).

`main` HEAD esperado tras PR #47: snapshot 2026-05-26, PRs #1–#47.

## 2. Infraestructura actual

| Capa | Proveedor | Estado |
|---|---|---|
| Repositorio y PRs | GitHub (`github.com/amedelvalle/lucycare`) | ✅ activo, repo público |
| Deploy producción / previews | Vercel (auto-deploy desde `main`) | ✅ activo en `lucycare.vercel.app`. Dominio personalizado **pendiente** |
| DB / Auth / RLS / RPCs / Storage | Supabase | ✅ activo |
| Auth SMTP transaccional | Supabase Auth → SMTP custom → Resend | ✅ activo desde 2026-05-26 |
| Dominio | `lucycare.app` | ✅ **comprado en Cloudflare** (2026-05-26 o antes), DNS gestionado en Cloudflare |
| DNS email (SPF / DKIM / DMARC) | Cloudflare | ✅ configurado para Resend |
| Envío de correos transaccionales | Resend (dominio `lucycare.app`) | ✅ verificado + smoke OK |

**Notas:**

- Producción **aún se sirve desde `lucycare.vercel.app`**. El cambio a `https://lucycare.app` es el siguiente paso operativo (PR de Vercel domain).
- Resend usa el dominio `lucycare.app` para el sender; ese setup es independiente del dominio público de la app y no se debe tocar al configurar Vercel.

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

### Reglas operativas que se mantienen

- **No guardar secretos** (API keys, SMTP password, service_role, credenciales de Vercel/Cloudflare/Resend/Supabase) en repo, docs, commits, ni chat.
- **No afirmar todavía que producción vive en `lucycare.app`** hasta que el dominio público quede configurado en Vercel.
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

### 5.1 Configurar dominio público en Vercel

- Agregar `lucycare.app` como dominio principal de producción.
- Decidir si `www.lucycare.app` redirige a apex o es alias.
- Registros DNS web en Cloudflare (solo los que pida Vercel — **no tocar** los registros de email de Resend).
- Validar SSL/HTTPS.
- Actualizar Supabase Auth → URL Configuration **después** de que SSL esté OK:
  - Site URL: `https://lucycare.app`.
  - Redirect URLs: `https://lucycare.app/**`, mantener wildcard de previews Vercel.
- Smoke de producción con el dominio nuevo (directorio, perfil público, login, reset).

PR separado, con `docs/SETUP_VERCEL_DOMAIN.md` siguiendo el patrón de `docs/SETUP_SMTP_RESEND.md`.

### 5.2 Auth Fase 4 PR-B

- Integrar email+password dentro del flujo de **Reclamar perfil**.
- Después del match phone+license, ofrecer al médico:
  - Opción A: "Recibir link por email para crear contraseña" (manda reset link al `profile.email`).
  - Opción B: "Crear contraseña ahora" (médico ya logueado vía OTP, password directo).
- Detalle en `docs/ANALISIS_AUTH_MEDICO.md` Fase 1 PR-B.

Orden recomendado: **primero 5.1 (Vercel), luego 5.2 (PR-B)**. PR-B toca templates/UX donde el dominio importa.

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
