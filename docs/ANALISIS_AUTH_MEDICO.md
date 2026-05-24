# Análisis — Autenticación y recuperación de acceso del médico

> Documento de decisión + plan. Snapshot 2026-05-23.
> Aprobado por owner. En cola para implementación post-estabilización.

## 1. Contexto

LucyCare hoy autentica TODO con OTP por SMS (Twilio). Funciona para
pacientes pero es frágil para médicos pagadores:

- Si el médico pierde el teléfono o cambia número → no puede entrar.
- Recuperación depende 100% de LucyAdmin.
- Twilio trial: OTP solo llega a números pre-verificados.

## 2. Datos de base (verificados via diagnóstico)

- **113/113 doctores tienen email válido** en `profiles.email`.
- 109/113 tienen teléfono.
- 100 importados vía `import-doctors.mjs` ya tienen `auth.users`
  (creados con Admin API, **sin password todavía**).

## 3. Decisión de producto

### Por rol

| Rol | Login principal | Recuperación |
|---|---|---|
| Paciente | Phone/OTP (no cambia) | OTP |
| Médico `listed_only` | Phone/OTP | Sin auth robusto. **No se crea contraseña automática.** |
| Médico **claimed o superior** (pagador) | Email + password recomendado; phone/OTP secundario | Reset por email |
| Asistente | Phone/OTP (default) | Phone; opcional email post-piloto |
| Admin Plataforma | Email + password **obligatorio** | Reset por email; 2FA en fase posterior |

### Reglas aprobadas

1. **NO crear contraseñas para los 113 doctores listados** — solo para
   quienes reclamen su perfil.
2. **Email/password se activa en el flujo de reclamo**, no antes. Médico
   `listed_only` no necesita auth robusto porque no opera nada todavía.
3. **Recuperación del médico claimed no debe depender solo de LucyAdmin** —
   el reset por email cubre el caso de pérdida de teléfono.
4. **El admin de plataforma** debe migrar a email/password obligatorio
   antes del piloto público — hoy depende de `50378056365` OTP, igual
   de frágil que el médico.
5. **2FA** queda para fase posterior. Voluntario primero para admin y
   médicos que lo pidan.

## 4. Capacidades de Supabase Auth

Soporta convivencia sin migración:

- Un mismo `auth.users` puede tener phone + email + password simultáneos.
- `signInWithPassword({email, password})` y `signInWithOtp({phone})`
  operan sobre el mismo usuario si coinciden las credenciales.
- `resetPasswordForEmail(email)` → link al email para resetear.
- `updateUser({password})` → setea/cambia password de la sesión activa.
- `updateUser({phone})` → cambia teléfono con re-OTP del nuevo.
- `updateUser({email})` → cambia email con confirmación.

**Sin cambios de schema necesarios.** Es activar capacidades.

## 5. Impacto técnico

### Tablas / campos
- `auth.users`: se setea `encrypted_password` al primer set-password del
  médico. Gestionado por Supabase, sin migración.
- `profiles`: sin cambios (email/phone ya existen).
- `doctors`, `clinic_members`: sin cambios.
- `audit_log`: nuevas filas cuando cambien credenciales.

### Migración necesaria
**Ninguna de schema.** Opcional: una RPC tipo
`admin_send_password_setup(doctor_id)` que dispare email de reset desde
admin — pero incluso eso se puede hacer desde código sin RPC dedicada.

### Servicios / hooks
- `auth.service.ts`: agregar `signInWithEmail(email, password)`,
  `requestPasswordReset(email)`, `setPassword(newPassword)`,
  `changePhone(newPhone)`, `changeEmail(newEmail)`. Mantener OTP existente.
- `LoginModal`: tabs/toggle "Teléfono" / "Email" o `DoctorLoginModal` separado.
- `claimProfile.service.ts`: en el reclamo, ofrecer crear password
  (paso opcional). Ver `ANALISIS_RECLAMAR_PERFIL.md`.

### Pantallas nuevas
- Login email/password (tab o modal).
- "Olvidé mi contraseña" (form email).
- "Crear/restablecer contraseña" (recibe token del email).
- `/panel/cuenta` con cambiar email/teléfono/password (post-piloto).

## 6. Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Duplicidad de auth.users | Baja | `email` tiene UNIQUE en `auth.users` (Supabase) |
| Emails placeholder del Excel | Media | Validar email 1×1 antes del piloto |
| Cambio de phone malicioso (sesión activa) | Alta | Exigir password actual antes de cambiar phone |
| Phishing al reset link | Alta | Dominio verificado + UX education |
| Token de reset interceptado | Baja | Supabase usa tokens 1-uso con expiry. HTTPS |
| Twilio trial bloqueante | Bloqueante actual | Email/password mitiga: médico entra aunque SMS falle |
| Pérdida total (sin email + sin phone) | Bajo (raro) | Soporte manual con verificación de identidad |

## 7. Plan por fases

### Fase 1 — Auth básica del médico (piloto-ready) — 1-2 PRs, ~1 semana

**PR-A — Email/password login + reset (3 días)**
- `auth.service.ts`: nuevos métodos.
- `LoginModal` o `DoctorLoginModal`: tab "Email".
- Página de reset password (recibe token).
- Página "Olvidé mi contraseña".

**PR-B — Activación de contraseña en flujo de reclamo (2 días)**
- Acoplado con el rediseño del reclamo (ver `ANALISIS_RECLAMAR_PERFIL.md`).
- En step "Términos + acceso" del modal de reclamo: "Crear contraseña ahora"
  o "Recibir link por email después".
- **NO se hace bulk** para los 113 — solo el que reclama.

### Fase 2 — Self-service de teléfono y email (post-piloto, ~3 días, 1 PR)

`/panel/cuenta` con:
- Cambiar password.
- Cambiar email (Supabase manda link de confirmación al nuevo).
- Cambiar teléfono (pide password actual + nuevo OTP).
- Email de notificación al cambio sensible.

### Fase 3 — 2FA opcional (later, ~1 semana)

- TOTP (Google Authenticator).
- Recovery codes.
- Voluntario para médicos y admin.

## 8. MVP para piloto de 5 médicos

**Mínimo absolutamente necesario:**
1. PR-A (login email/password + reset).
2. PR-B (activación de password en reclamo).

**NO necesario para piloto:**
- Self-service de cambio de teléfono.
- 2FA.
- Email change flow.
- Migración de 113 médicos a tener password.

**Ventaja colateral del MVP**: si Twilio sigue en trial, email/password
mitiga el bloqueante — los médicos pueden entrar sin SMS aunque Twilio
no expanda. Acelera el go-live.

## 9. Lo que NO se hace

- No se crean contraseñas para los 113 doctores listados.
- No se les envía email de invitación masivo.
- No se obliga a paciente a tener contraseña.
- No se cambia el flujo de asistentes en MVP.
- No se cambia el modelo de `auth.users` ni schema relacionado.

## 10. Coordinación con otros docs

- `ANALISIS_RECLAMAR_PERFIL.md` — Fase 2 del reclamo activa password.
  PR-B de este doc se integra con esa fase.
- `PLAN_PILOTO_5_MEDICOS.md` — checklist incluye verificación 1×1 de
  email antes de enviar invitaciones.
