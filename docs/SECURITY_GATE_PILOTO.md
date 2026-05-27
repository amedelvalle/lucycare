# Security Gate — Piloto LucyCare

> Auditoría pre-piloto. Snapshot 2026-05-24.
> Cubre rate limit, secretos, autenticación backend, RLS/RPCs/Storage y
> audit_log. Listado de PRs recomendados por severidad.

## TL;DR

**Estado general:** sólido para piloto, con **2 hallazgos bloqueantes** que hay
que cerrar antes del go-live.

| Hallazgo | Severidad | Acción |
|---|---|---|
| #1 — `service_role` JWT hardcoded en repo público | 🚨 Crítico | **Rotar key + PR #36** antes de cualquier exposición real |
| #2 — `profiles` permite SELECT anónimo completo | 🚨 Crítico | **PR #37** antes del piloto público |
| #3 — `reviews` no se escriben en `audit_log` | ⚠ Medio | **Resuelto en este PR** (migración `s7_15`) |
| #4 — Sin rate limit propio en `claim_doctor_profile` | ⚠ Bajo | Doc + PR post-piloto |
| #5 — 12 médicos seed con email placeholder | ⚠ Bajo | Limpieza de datos antes de Fase 4 |
| #6 — SMTP builtin con rate limit ~4 emails/h | ⚠ Medio | **✅ Resuelto** (PR #46 + setup operativo 2026-05-26). Resend con dominio `lucycare.app` verificado, SMTP custom activo en Supabase, smoke de reset por email validado end-to-end. Ver [`docs/SETUP_SMTP_RESEND.md`](SETUP_SMTP_RESEND.md). |
| #7 — Flujo público "Soy médico" creaba doctores `claimed` sin validar identidad | 🚨 Alta | **✅ Resuelto** (PR #53, 2026-05-26). Detectado en auditoría del análisis de afiliación (PR #52). Ver detalle abajo. |
| 17 verificaciones positivas | ✅ OK | — |

---

## A. Rate limit / abuso

### Lo que tenemos cubierto

| Superficie | Cubierto por | Comentario |
|---|---|---|
| `signInWithOtp` (envío SMS) | **Supabase Auth + Twilio** | Supabase: 1 OTP/60s/phone, 30/h/IP por default. Twilio: rate limit del plan. Mensaje friendly en `auth.service.ts:34`. |
| `verifyOtp` | **Supabase Auth** | Token corto, verificación 1-tiro, bloqueo tras N intentos fallidos. |
| `submit_review(token)` | **Token-based, 1-uso, expiración 7d** | El token es uuid v4 (32 chars random). Brute-force inviable. `used_at` y `expires_at` validados server-side ([s6_01](../migrations/s6_01_reviews_reputation.sql)). |
| Booking público (`createBooking`) | RLS de `appointments` | Requiere sesión + ownership por phone. |
| Acciones admin | `is_admin()` gate | Rechazo inmediato; no se llega a la lógica costosa. |

### Lo que NO está cubierto

#### `claim_doctor_profile` — sin rate limit propio

Un atacante autenticado con un teléfono cualquiera puede llamar la RPC repetidamente intentando licencias distintas hasta acertar. **Vector requiere:**

1. Control del teléfono del médico target (porque la RPC valida `auth.users.phone == profile.phone` server-side, ver [s7_13](../migrations/s7_13_secure_claim_doctor_profile.sql) líneas 56-89).
2. La licencia (JVPM) — números cortos, espacio relativamente acotado.

Como (1) ya implica control de la línea telefónica (vector físico fuerte), el ataque es **bajo riesgo para piloto pequeño**. Pero sería razonable:

- Loguear intentos fallidos en `audit_log` con razón (`P0005`/`P0007`).
- Aplicar un cooldown por `auth.uid()` tras N fallos.

→ Recomendado para post-piloto. No bloqueante.

#### Brute force a `accept_clinic_invitations`

Función pública pero validada: requiere `auth.uid()` Y que el phone del profile matchee el `user_phone` tipeado ([s5_07](../migrations/s5_07_clinic_invitations.sql)). Misma lógica que claim — **bajo riesgo**.

#### Lectura masiva de directorio

Anon puede `select * from doctors` sin limit. Para piloto de 113 médicos no es un problema. Si crecemos, agregar paginación obligatoria o rate-limit en el endpoint REST.

### Qué cubre / qué no — resumen

| Cubierto | No cubierto |
|---|---|
| OTP SMS (Supabase + Twilio) | Brute force en RPCs custom |
| Encuesta por token | Lectura masiva del directorio |
| Login fallido | Logging de intentos fallidos en `claim` |
| Inserts/updates en tablas (RLS) | — |

**Riesgo real para piloto (5 médicos):** **bajo**. Las superficies reales atacables están auto-limitadas por la cardinalidad chica del piloto y los gates server-side.

**Fix mínimo recomendado antes de piloto:** ninguno bloqueante. Loguear intentos de claim fallidos sería bueno pero queda como follow-up.

---

## B. API keys / secretos

### Frontend (`src/`)

Verificado con `grep` exhaustivo:

```
$ grep -rE 'service_role|TWILIO_AUTH|TwilioApi|sk_live|sk_test|eyJhbGciOi' src/
(0 matches)
```

✅ **Cero secretos en código de frontend.** Solo se referencia `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (públicas por diseño).

### Variables de entorno

- `.env` está en `.gitignore` ([línea 12](../.gitignore)).
- `.env.example` no tiene credenciales reales.
- Producción: variables en Vercel (no expuestas).

### Twilio

- Auth Token de Twilio: **no aparece en el repo**. Está configurado en el dashboard de Supabase (Authentication → Providers → Phone). Vive solo del lado del servidor de Supabase.
- ✅ No leak.

### 🚨 HALLAZGO #1 — `service_role` JWT en scripts del repo público

```
$ git ls-files scripts/ | xargs grep -lE 'eyJhbGciOi.{20,}' | wc -l
32
```

**Detalles:**
- 32 scripts en `/scripts/` tienen el `service_role` JWT **hardcoded**.
- El JWT tiene `role: 'service_role'`, válido hasta `2036-04-03` (3602 días).
- El repo `amedelvalle/lucycare` es **público** en GitHub.
- Con `service_role`, RLS se bypasea por completo. Acceso total a:
  - `patients` (datos de pacientes — PII clínica).
  - `consultations`, `prescriptions`, `vitals` (historia clínica firmada).
  - `auth.users` (puede crear usuarios, cambiar passwords, asignar admin).
  - `audit_log` (puede eliminar evidencia).

**Impacto:** cualquier persona con acceso a internet puede clonar el repo, extraer el JWT y operar como dueño absoluto de la base de datos.

**Mitigación inmediata (owner debe ejecutar):**

1. **Rotar el `service_role` key en Supabase Dashboard** (Settings → API → Reset service_role secret).
2. El JWT viejo queda invalidado automáticamente.
3. Aplicar **PR #36** (ver al final del doc): mover los 32 scripts a leer de `process.env.SUPABASE_SERVICE_ROLE_KEY` cargado desde `.env.local` (ya en gitignore).
4. **Asumir compromiso histórico:** rotar no borra el JWT viejo de la historia git, pero al invalidarlo en Supabase el key ya no sirve aunque alguien lo haya copiado. **Lo crítico es rotar ya.**

**Para piloto:** **OBLIGATORIO antes de exponer datos reales.** Aunque los datos actuales son mayormente de prueba, los emails/phones de los 113 médicos importados son reales y la rotación tiene que pasar antes de que entren pacientes reales.

---

## C. Autenticación y permisos validados en backend

Mapeo acción → gate server-side encontrado.

| Acción | Gate server-side | Evidencia |
|---|---|---|
| Reclamar perfil | `auth.uid()` + phone verificado + match phone/license server-side | [s7_13:42-86](../migrations/s7_13_secure_claim_doctor_profile.sql) |
| Editar perfil médico (self) | RLS `profiles.id = auth.uid()` | Probado en vivo: anon `update` devuelve `[]` sin tocar filas |
| Cambiar servicios (self) | RLS doctor owner | `services.delete` policy [s7_08](../migrations/s7_08_services_delete_policy.sql) |
| Subir/eliminar avatar (médico) | Storage RLS `(storage.foldername(name))[1] = auth.uid()::text` | [s7_14:55-83](../migrations/s7_14_avatars_bucket_and_audit.sql) |
| Acciones LucyAdmin | `IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'` | Todas las `admin_*` RPCs. Verificado en 12+ funciones. |
| Firmar consulta | RLS + lógica de consultas. Sin RPC dedicada, depende del client respetando el flujo. | Ver hallazgo abajo. |
| Cambiar estados de cita | RLS + trigger `guard_appointment_status_change` | [s6_02](../migrations/s6_02_signed_consultation_appointment_lock.sql) |
| Enviar reseña pública | Token único 1-uso, expiración 7d, validado server-side | [s6_01](../migrations/s6_01_reviews_reputation.sql), `submit_review` |
| Aceptar invitación de clínica | `auth.uid()` + phone matchea `profiles.phone` | [s5_07](../migrations/s5_07_clinic_invitations.sql) `accept_clinic_invitations` |
| `get_my_review_comments` | `auth.uid()` + es doctor con `id = profile_id` | [s6_08](../migrations/s6_08_doctor_review_comments.sql) |
| `get_platform_stats` | `is_admin()` | [s7_01](../migrations/s7_01_admin_foundation.sql) |

### Hallazgo lateral: firmar consulta

Las consultas se firman por UPDATE sobre `consultations.status='signed'`. No hay un RPC `sign_consultation()` dedicado con validación. Hoy el front (médico panel) es quien debe escribir el status correcto. La RLS de `consultations` debería:

1. Permitir UPDATE solo al doctor dueño (ya verificado: admin no ve consultations).
2. Bloquear UPDATE si `status` ya era `signed` (inmutabilidad). Esto sí está cubierto por trigger `sync_appointment_on_sign` que sincroniza appointments al firmar — implícitamente reconoce la transición.

**Riesgo:** el asistente del médico también podría tener row permissions sobre consultas si no se filtra por role. El CLAUDE.md menciona explícitamente:
> "Asistente puede firmar consulta — clínico-legal, urgente."

Eso es una **deuda técnica vieja, prioridad ALTA**, pero no es scope de este Security Gate. Se documenta en el doc de deudas existente.

### Verificación cruzada de RLS por rol (probado en vivo)

```
Anon (sin login):
  doctors  : 5 (✅ publicados visibles)
  profiles : 120 (🚨 ver hallazgo #2)
  patients : 0 (✅ bloqueado)
  appointments : 0 (✅ bloqueado)
  consultations: 0 (✅ bloqueado)
  audit_log: 0 (✅ bloqueado)

Admin plataforma (+503 7805 6365 logueado, NO service_role):
  profiles  : 120 (✅ es admin)
  patients  : 0 (✅ NO ve clínica — regla "admin no toca clínica")
  consultations: 0 (✅ NO ve clínica)
  audit_log : 0 (⚠ no ve audit_log directo — debería poder, queda pendiente)
```

### Tests de escritura como anon (resultado esperado: bloqueado)

```
update profiles full_name='HACKED'  → 0 rows affected, valor original preservado ✅
update doctors is_published=true    → 0 rows affected, valor original preservado ✅
insert reviews                      → bloqueado por schema (RLS no llega a evaluar)
insert audit_log                    → bloqueado por NOT NULL constraint
```

---

## D. RLS / RPCs / Storage

### RLS por tabla — estado

| Tabla | RLS habilitada | Lectura anon | Escritura anon | Notas |
|---|---|---|---|---|
| `doctors` | ✅ | filtrado a `is_published` | bloqueado | Directorio. OK. |
| `profiles` | ✅ | **toda la tabla** 🚨 | bloqueado | **Hallazgo #2.** |
| `patients` | ✅ | bloqueado | bloqueado | Solo doctor/asistente de la clínica. OK. |
| `appointments` | ✅ | bloqueado | bloqueado | OK. |
| `consultations` | ✅ | bloqueado | bloqueado | OK. |
| `prescriptions` | ✅ | bloqueado | bloqueado | OK. |
| `vitals` | ✅ | bloqueado | bloqueado | OK. |
| `reviews` | ✅ | 1 visible (públicas) | bloqueado | OK. |
| `services` | ✅ | activos visibles | bloqueado | OK. |
| `availability_rules` | ✅ | visible | bloqueado | OK directorio. |
| `clinics` | ✅ | visible | bloqueado | OK directorio. |
| `clinic_members` | ✅ | bloqueado | bloqueado | OK. |
| `audit_log` | ✅ | bloqueado | bloqueado | OK. |
| `diagnoses` | ✅ | bloqueado | bloqueado | Catálogos per-doctor. OK. |
| `medications` | ✅ | bloqueado | bloqueado | OK. |

### RPCs SECURITY DEFINER — gate verificado

| RPC | Gate |
|---|---|
| `is_admin()` | self-check sobre profile actual |
| `get_platform_stats()` | `is_admin()` |
| `admin_list_doctors/get_doctor_detail/update_*/set_*` (12 RPCs) | todas con `IF NOT is_admin() THEN RAISE EXCEPTION` |
| `admin_*_service` (5 RPCs) | `is_admin()` |
| `admin_update_doctor_avatar` | `is_admin()` |
| `claim_doctor_profile` | `auth.uid()` + phone confirmado + match phone/license |
| `submit_review` | token único 1-uso |
| `get_review_link` | público (genera link a partir de appointment) |
| `get_my_review_comments` | `auth.uid()` + ownership de `doctors.profile_id` |
| `accept_clinic_invitations` | `auth.uid()` + phone match en profiles |
| `generate_review_token` | trigger interno |

### Storage `avatars` — policies verificadas en vivo

```
✅ SELECT anon       → permitido (bucket público)
✅ INSERT owner self → permitido (carpeta {auth.uid()}/)
✅ UPDATE owner self → permitido
✅ DELETE owner self → permitido
✅ Admin a cualquier carpeta → permitido (verificado en vivo subiendo a otra carpeta)
❌ Anon write       → bloqueado
❌ Otro user write a carpeta ajena → bloqueado por RLS
```

### 🚨 HALLAZGO #2 — `profiles` permite SELECT anónimo completo

Anon (sin login) puede ejecutar:

```sql
select id, full_name, email, phone, role from profiles
```

Y obtiene **120 filas** con:
- 1 admin (email + phone del owner).
- 113 doctores (emails + phones).
- 6 pacientes (emails + phones — PII).

**Vector de ataque:**
1. Cualquiera ejecuta `node script.js` con la anon key del bundle → dump completo.
2. Phishing dirigido al admin (email + phone conocidos).
3. Spam masivo / OTP fishing contra 113 médicos.
4. Exposición de pacientes — **violación de privacidad de datos médicos**.

**Por qué pasa:** la migración inicial de `profiles` (anterior a Sprint 7) probablemente dejó la policy de SELECT abierta para que el directorio público pueda hacer JOIN con `profiles` y obtener `full_name` y `avatar_url` del médico. La policy es demasiado amplia.

**Fix correcto (PR #37):**
- Restringir SELECT a:
  - El propio profile (`auth.uid() = id`).
  - Profiles vinculados a `doctors.is_published=true` (solo columnas no-sensibles: `full_name`, `avatar_url`).
  - Si `is_admin()`.
- Para que el directorio siga funcionando, agregar columnas `full_name` y `avatar_url` directamente a `doctors` o a una vista pública, evitando el join a `profiles` desde anon.

**Riesgo de implementación:** romper queries del directorio. Requiere smoke completo.

**Para piloto:** **OBLIGATORIO antes de exponer la URL pública a pacientes reales.** Hoy mismo cualquiera puede dumpear todos los emails/phones.

---

## E. Auditoría — coverage de `audit_log`

Snapshot actual (207 entries):

```
appointments.insert       : 22
appointments.update       : 14
clinic_invitations.insert : 4
clinic_invitations.update : 3
clinics.update            : 2
consultation_family_history.insert/update : 1/1
consultations.delete      : 2
consultations.insert      : 17
consultations.update      : 29
doctors.update            : 41 ← incluye claim, lucy_status, published, operational
patients.insert           : 22
patients.update           : 29
prescriptions.insert      : 2
prescriptions.update      : 8
profiles.update           : 4
services.insert/update/delete : 2/3/1
```

Coverage explícito de acciones críticas:
- ✅ claim de perfil → `doctors.update` con `edited_via='claim_self_service'`.
- ✅ Cambios de avatar (self-service y admin) → `profiles.update` con `edited_via='trigger'|'admin'`.
- ✅ Cambios admin de perfil/clínica/info/servicios → `*.update` con `edited_via='admin'`.
- ✅ Reputación traceability → vista `admin_review_traceability` (s6_09).
- ✅ Cambios relevantes de médico (lucy_status, published, operational, verified) → `doctors.update`.

### Hallazgo #3 — Reviews no escriben `audit_log` — RESUELTO en este PR

`submit_review` no insertaba en `audit_log` ni había trigger en la tabla `reviews`. Las reseñas SÍ tenían `submitted_at` en su propia tabla, pero no se veían en el log unificado.

**Fix incluido aquí:** migración [`s7_15_audit_reviews_trigger.sql`](../migrations/s7_15_audit_reviews_trigger.sql) — trigger AFTER INSERT/UPDATE en `reviews`. Como `submit_review` es público (token-based, sin `auth.uid()`), el trigger cae al `patient_profile_id` de la review como actor.

---

## Hallazgos secundarios

### Hallazgo #4 — Sin rate limit propio en `claim_doctor_profile`

Detalle en sección A. Bajo riesgo para piloto chico (requiere control del teléfono). Loguear intentos fallidos en `audit_log` sería el fix mínimo.

### Hallazgo #5 — 12 médicos seed con email placeholder

```sql
select email from profiles where role='doctor' and email like '%@lucycare.test' limit 3;
-- carlos.mendoza@lucycare.test
-- maria.lopez@lucycare.test
-- roberto.sanchez@lucycare.test
```

Son los seed iniciales con UUIDs `a0000001-*`. Si llegamos a Fase 4 (email+password), mandar reset link a `*.lucycare.test` rebota o termina en buzón inexistente. **Antes de Fase 4:** validar que están `is_active=false` o limpiarlos.

### Hallazgo #6 — SMTP builtin de Supabase con rate limit ~4 emails/h

El reset por email (Fase 4 PR-A, PR #39) está live contra el SMTP **builtin** de Supabase. Ese servicio es para desarrollo: documentado por Supabase con rate limit de ~4 emails/h por proyecto, sin deliverability garantizada, sin logs útiles de envío.

**Vector / impacto:**
- En piloto público con 5 médicos + pacientes reales pidiendo reset, la primera ola supera el rate limit y los emails siguientes se caen silenciosamente.
- No es un vulnerabilidad de seguridad en sí, pero **bloquea el flujo de recuperación de contraseña** durante el piloto, lo cual fuerza al usuario a contactar soporte y degrada la experiencia.
- Sin logs claros de bounce/delivered, debuggear "no me llegó el reset" es a ciegas.

**Fix:** configurar **Resend** como SMTP custom en Supabase Auth.

**Estado (cerrado 2026-05-26):**
- ✅ Procedimiento documentado en [`docs/SETUP_SMTP_RESEND.md`](SETUP_SMTP_RESEND.md) (PR #46).
- ✅ Configuración real ejecutada: dominio `lucycare.app` verificado en Resend, DNS en Cloudflare (SPF/DKIM/DMARC), API key con `Sending access` creada, SMTP custom activo en Supabase Auth.
- ✅ Smoke real de reset por email con SMTP externo: enviado, recibido desde `LucyCare`, link abrió en `/reset-password`, cambio de contraseña OK, login con nueva contraseña OK.

Smoke opcional pendiente (no bloqueante): capacidad 5 emails seguidos (sección 7.3 del setup doc). El rate limit builtin de ~4/h **ya no aplica** con SMTP externo activo.

**Para piloto:** ✅ Listo. Reset por email puede exponerse a usuarios reales.

### Hallazgo #7 — Flujo público "Soy médico" creaba doctores sin validar identidad

**Detectado en la auditoría previa al análisis de afiliación** (PR #52, 2026-05-26). No estaba cubierto en la revisión original del Security Gate (PR #35) porque la auditoría se enfocó en flujos de pacientes y reclamo, no en el `DoctorRegistrationModal` legacy del home.

**Vector / impacto:**

El botón "Soy médico" en home (`src/pages/home/page.tsx:152`) abría `DoctorRegistrationModal` (form de 6 pasos: OTP + datos personales + profesional + ubicación + servicios + disponibilidad). El submit llamaba a `registerDoctor()` que en una sola transacción persistía:

- `profiles` con `role='doctor'`.
- `clinics` con la información tipeada.
- `clinic_members` como `owner`.
- `doctors` con **`lucy_status='claimed'` directo** (sin pasar por `listed_only`), `is_published=false`, `is_verified=false`, `booking_enabled=false`.
- `services` (los que el usuario eligió).
- `availability_rules` (los días/horas tipeados).

**Sin validación de identidad en ningún paso:** la licencia/JVPM se aceptaba tal cual. Cualquiera con un OTP de teléfono real podía crear un `doctors` row con nombre y licencia inventados. Mitigado parcialmente solo por `is_published=false` (no aparecía en directorio público), pero el record existía en DB y si admin lo publicaba sin verificar la identidad, se volvía real. Vector de fraude / suplantación documentado.

**Fix (PR #53):**

- **Frontend**: el botón "Soy médico" ahora abre `DoctorInterestModal` — modal informativo sin form, sin backend, sin persistencia en DB. Único CTA: WhatsApp con mensaje prefillado.
- **Archivos legacy** (`DoctorRegistrationModal.tsx`, `doctorRegistration.service.ts`) **marcados `@deprecated`** en repo. No se importan desde código activo. Verificado con grep y con build (bundle bajó 18 KB por tree-shaking).
- **Evidencia post-smoke**: script de diagnóstico cruzado verificó que tras el smoke del flujo nuevo, **NO se crearon filas** en `doctors`, `profiles` (role=doctor), `clinics`, `clinic_members`, `services` ni `availability_rules`.

**Recomendación pendiente:**

Diseñar e implementar el flujo formal de **"Solicitar afiliación médica"** (`docs/ANALISIS_AFILIACION_MEDICO.md`):
- Lead en tabla nueva `doctor_affiliation_requests`.
- Bandeja `/admin/afiliaciones` con triage manual de LucyAdmin.
- RPC `admin_approve_affiliation_request` que crea el `doctors` row en `listed_only`.
- Médico aprobado entra al flujo de Reclamar perfil existente (PR #32 + PR #50).

**Para piloto:** ✅ La mitigación de PR #53 es suficiente. El piloto de 5 médicos se cubre con `scripts/import-doctors.mjs` (creación curada por admin); el flujo formal de afiliación se implementa post-piloto cuando se quiera escalar.

### Otros observados (no acción inmediata)

- **Audit_log no visible para admin desde panel** — el admin no puede consultar `audit_log` directamente vía PostgREST (probado en vivo, devuelve 0 filas). Eso es por RLS estricto. Si querés vista de auditoría en `/admin`, hace falta una RPC `admin_get_audit_log` con paginación. Fase post-piloto.
- **Bucket `avatars` es público** — decisión explícita para perf (sin signed URLs). Riesgo aceptado: cualquiera con la URL puede mostrar la imagen. Path no es enumerable salvo que tengas el `profile_id`, que sí es accesible vía hallazgo #2. **Después del fix #2 esto deja de ser tema.**

---

## PRs recomendados

### 🚨 Antes del piloto (OBLIGATORIOS)

#### PR #36 — Rotar service_role y mover scripts a ENV var

**Alcance:**
1. Owner rota el `service_role` key en Supabase Dashboard.
2. Refactorizar los 32 scripts en `/scripts/` para que lean `process.env.SUPABASE_SERVICE_ROLE_KEY`.
3. Crear `.env.local.example` documentando las vars necesarias.
4. `.env.local` ya está en `.gitignore` desde antes; no se commitea.
5. Actualizar README de scripts.

**Tamaño estimado:** medio. Es repetitivo (32 archivos), no complejo.

#### PR #37 — RLS hardening de `profiles`

**Alcance:**
1. Reescribir SELECT policies de `profiles`:
   - `auth.uid() = id` (self).
   - `is_admin()` (admin ve todo).
   - `EXISTS (SELECT 1 FROM doctors d WHERE d.profile_id = profiles.id AND d.is_published = true)` — pero **restringido a columnas no-sensibles**.
2. Verificar/migrar el flujo del directorio público: que el join doctors→profiles siga funcionando o, alternativamente, materializar `full_name` y `avatar_url` también en `doctors` para evitar el join desde anon.
3. Smoke exhaustivo (home, perfil médico, login OTP).

**Tamaño estimado:** medio. Es delicado porque puede romper el directorio. Requiere preview + smoke completo antes de mergear.

### ⚠ Post-piloto (recomendados, no bloqueantes)

#### ~~PR #38~~ — Audit log para reviews (~~separado~~ **INCLUIDO EN ESTE PR**, migración `s7_15`)

#### PR #39 — Logging de intentos fallidos en claim

Loguear `audit_log` con `claimed_via='rejected_<P0xxx>'` en cada path de error de `claim_doctor_profile`. Detecta brute force.

#### PR #40 — Limpieza de seed `*.lucycare.test`

Antes de Fase 4 (email+password): asegurar que los 12 seed están desactivados o limpiar emails placeholder.

### Sin acción ahora

- Vista admin de `audit_log` (RPC paginada).
- Rate limit por RPC (depende del plan de Supabase / Cloudflare delante).

---

## Lo que ya está OK (no hace falta tocar)

1. RLS en tablas clínicas (`patients`, `consultations`, `prescriptions`, `vitals`) — verificado en vivo.
2. RPCs admin con gate `is_admin()` — 12+ funciones revisadas.
3. RPC `claim_doctor_profile` con validación dual phone + license.
4. Storage `avatars` con policies owner + admin verificadas en vivo.
5. Bootstrap defensivo con timeout en `main.tsx`.
6. Lock no-op de supabase-js (sin pantallas blancas).
7. Frontend sin secretos embebidos.
8. Twilio Auth Token solo en Supabase Dashboard.
9. `audit_log` con coverage amplio para acciones críticas.
10. Trigger `audit_profiles_avatar` que captura cualquier cambio de foto.
11. Token único + expiración + 1-uso en `submit_review`.
12. Trigger `guard_appointment_status_change` bloquea transiciones inválidas.
13. Trigger `block_inactive_service_appointment` bloquea booking con servicios inactivos.
14. Trigger `block_past_appointment` y `block_outside_availability`.
15. Bloqueo de reschedule en consultas firmadas (`block_reschedule_locked_appointment`).
16. `is_verified` GENERATED — no editable manualmente (s7_03).
17. Admin de plataforma NO ve contenido clínico (verificado).

---

## Conclusión

LucyCare tiene una base de seguridad **bien construida** para una plataforma temprana: RLS sólido, RPCs gateadas, audit log con buen coverage, y autenticación validada server-side en los flujos críticos. Las decisiones de producto (admin no toca clínica, claim no activa booking, `is_verified` GENERATED) están reflejadas correctamente a nivel DB.

Los dos hallazgos críticos son **operacionales**, no de diseño:

1. El `service_role` filtrado en el repo público fue una decisión de comodidad para scripts (CLAUDE.md lo documenta como deuda conocida) que se volvió crítica al exponer el repo.
2. La policy SELECT de `profiles` quedó demasiado amplia desde el inicio para que el directorio funcione; nunca se restringió.

Ambos se resuelven con dos PRs acotados (#36 y #37) antes del piloto. Con eso cerrado, LucyCare queda listo para abrir a 5 médicos reales y empezar a recibir pacientes.

Después de esos dos PRs y la limpieza de emails seed, se puede arrancar **Fase 4 PR-A** (email + password login + reset) con tranquilidad.
