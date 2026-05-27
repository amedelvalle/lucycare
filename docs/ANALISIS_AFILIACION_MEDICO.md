# Análisis — Solicitar afiliación del médico

> Documento de análisis + decisión. Snapshot 2026-05-26.
> **Estado: borrador para discusión. NO implementar nada hasta cerrar
> las preguntas de la §10.**
>
> Acompaña a `docs/ANALISIS_RECLAMAR_PERFIL.md` (reclamo seguro de
> médicos ya listed_only, ✅ live) y a `docs/ANALISIS_AUTH_MEDICO.md`
> (PRs #39 y #50 ✅ live).

---

## 1. Problema

### 1.1 El caso de uso

Un médico llega a `https://lucycare.app`, quiere aparecer / afiliarse a LucyCare, pero:

- **No existe** en el directorio (no fue importado desde Excel, no está en `doctors`).
- O existe pero **no tenemos `profiles.phone` o `doctors.license_number`** confiables para validar reclamo automático.
- O su teléfono cambió respecto al que importamos.
- O su email no está registrado.

Hoy LucyCare **no captura ese lead** de forma segura. El médico se va o cae a un flujo no diseñado para él.

### 1.2 Estado actual del código (auditado el 2026-05-26)

| Pieza | Estado | Hallazgo |
|---|---|---|
| Botón **"Soy médico"** en home (`/`) | ✅ existe (`home/page.tsx:152`) | Abre `DoctorRegistrationModal` |
| `DoctorRegistrationModal` (6 pasos) | ⚠️ existe pero **inseguro** | Step 0 OTP + 5 pasos de datos: personal, profesional, ubicación, servicios, disponibilidad |
| `registerDoctor()` service | ⚠️ **persiste todo en una transacción** | Crea: profile→doctor (role), clinic, clinic_member owner, doctor con `lucy_status='claimed'` directo, servicios y `availability_rules`. **NO valida identidad** — la licencia se acepta tal cual la tipea |
| Defaults seguros del registro legacy | ✅ aplicados | `is_published=false`, `is_verified=false`, `booking_enabled=false` |
| Tabla de **leads / solicitudes / applications** | ❌ no existe | No hay forma estructurada de capturar "este médico quiere afiliarse" sin crear ya un `doctors` row |
| Admin UI para **crear médico desde cero** | ❌ no existe | `AdminDoctorEditPage` solo edita; no hay "Agregar médico nuevo" |
| Único path bulk de creación | `scripts/import-doctors.mjs` | Solo lo corre el owner desde la CLI |

### 1.3 Riesgos del estado actual

El flujo `DoctorRegistrationModal` actual **tiene los mismos problemas de identidad que el reclamo tenía antes de PR #32**:

- ❌ Cualquiera con un teléfono real puede crear un `doctors` row con nombre y licencia inventados.
- ❌ El registro queda como `lucy_status='claimed'` inmediatamente (cualquier persona se "promueve" a médico claimed).
- ❌ Sin auditoría server-side de la licencia contra ningún registro oficial.
- ❌ Sin rate limit por IP/teléfono.

Está **mitigado parcialmente** porque:
- `is_published=false` → no aparece en directorio público.
- `is_verified=false` → no aparece como verificado.
- `booking_enabled=false` → no acepta reservas.
- Pero el record existe en DB, ocupa nombre + email + phone reales del usuario que se registró, y si admin lo publica sin verificar la identidad, se vuelve real.

Esto **no fue revisado** en el Security Gate del piloto (PR #35) porque la auditoría se enfocó en flujos de pacientes y reclamo. **Es deuda activa.**

## 2. Objetivo comercial

- **Capturar el lead.** Médicos interesados no se deben perder por falta de flujo.
- **Permitir crecimiento del catálogo** sin depender exclusivamente de la importación bulk vía script admin.
- **Mantener el modelo de "directorio curado"**: los médicos en LucyCare aparecen porque LucyAdmin los acepta, no porque se autoinscribieron.
- **Diferenciarse de directorios spam**: la calidad del listado es parte del valor que LucyCare ofrece al paciente.
- **Generar fricción mínima para el médico bona fide** y máxima para suplantadores/spam.
- A futuro: soporte para que un médico legítimo se afilie sin intervención manual (cuando tengamos verificación automática contra fuente oficial — JVPM, RNPN, etc.).

## 3. Diferencia entre "Reclamar perfil" y "Solicitar afiliación"

| Eje | Reclamar perfil (PR #32 / PR #50 ✅) | Solicitar afiliación (este análisis) |
|---|---|---|
| **Punto de partida** | Médico ya existe en `doctors` con `lucy_status='listed_only'` (importado por admin) | Médico **NO existe** en `doctors`, o existe pero sin datos validables |
| **CTA visible** | Card emerald en `/doctor/{id}` "¿Eres este profesional?" | Botón en home "Soy médico, quiero afiliarme" |
| **Validación de identidad** | Match automático server-side: phone OTP-verified == doctors.phone + license tipeada == doctors.license_number (RPC `claim_doctor_profile`) | **No hay match automático posible** — el médico no está en DB. Verificación es **manual por LucyAdmin** |
| **Resultado server-side inmediato** | `lucy_status: listed_only → claimed`. Vincula `profile_id`. NO toca booking/publicación/services/availability | **No crea fila en `doctors`** hasta que admin valide. Solo crea un **lead** (intent + datos de contacto + comprobantes) |
| **Quién decide que es "doctor real"** | LucyAdmin (proceso pre-importación). El reclamo solo verifica que quien dice ser X tiene el teléfono y la licencia de X | LucyAdmin revisa la solicitud, contacta al médico, valida licencia y, si OK, crea manualmente la fila `doctors` con `lucy_status='listed_only'` y comunica al médico para que reclame |
| **Confianza requerida** | Baja: la importación previa ya pasó por la curación de admin. El reclamo solo conecta auth.users existente al doctor existente | Alta: estamos creando una identidad nueva. Admin debe validar antes de crear |
| **Flujo del médico tras el éxito** | Entra a `/panel` y se le muestra "Perfil reclamado / esperando habilitación" | Recibe confirmación "Recibimos tu solicitud, te contactamos". Cuando admin lo aprueba y crea el `doctors` row, recibe un mensaje (email o SMS manual) con instrucciones para reclamar |
| **Reutilización de PR #32 / #50** | Es el mismo PR | Una vez que admin crea el doctor en `listed_only`, **el médico usa el flujo de reclamo existente**. No duplicamos código del claim |
| **Tablas nuevas** | Ninguna | Una nueva: `doctor_affiliation_requests` (lead + estado + comprobantes) |

**Clave conceptual:**
- "Reclamar perfil" = vincular identidad al `doctors` row que **ya creó admin**.
- "Solicitar afiliación" = pedirle a admin que **cree el `doctors` row**.

Son flujos complementarios. La afiliación termina derivando al reclamo.

## 4. Riesgos de seguridad

| Riesgo | Severidad | Mitigación recomendada |
|---|---|---|
| **R1 — Spam de solicitudes** (formularios automatizados, bots) | ⚠ Media | Honeypot field + rate limit por IP en RPC + opcional: hCaptcha / Turnstile cuando el volumen crezca |
| **R2 — Datos falsos** (licencia inventada, nombre falso) | 🚨 Alta | Validación 100% manual por admin antes de crear `doctors`. **Nunca auto-crear.** Pedir comprobantes (foto de credencial JVPM, selfie con credencial) como upload opcional |
| **R3 — Suplantación de médico real** (alguien se hace pasar por un Dr. real para reclamar luego sus citas/pacientes futuros) | 🚨 Alta | Admin verifica contra fuente oficial (registro JVPM en línea si está disponible, contacto telefónico al número público del médico, búsqueda en redes profesionales). Si hay duda → rechazar. Si se aprueba, el flujo de reclamo posterior aún exige match phone+license (PR #32) |
| **R4 — PII expuesta** (los datos del lead incluyen email/phone, no son públicos) | ⚠ Media | Solo admin puede leer `doctor_affiliation_requests`. RLS estricto. No exponer ninguna columna a anon/authenticated/doctor |
| **R5 — Lead enumeration** (atacante usa el formulario para descubrir qué médicos ya están afiliados — ej. "Dr. X ya está registrado, error duplicate") | ⚠ Baja | Mensajes de respuesta genéricos. No revelar si la licencia o el email ya estaban en DB. Siempre responder "Recibimos tu solicitud" |
| **R6 — Lead duplicados** (mismo médico envía 10 solicitudes) | ⚠ Baja | UNIQUE índice deferido por (email_lower, license_normalized). Si llega un duplicado, actualizar el lead existente en vez de crear nuevo |
| **R7 — Lead viejo se vuelve doctor accidentalmente** (admin aprueba lead obsoleto sin verificar que el médico aún quiere afiliarse) | ⚠ Baja | TTL conceptual: leads >30 días sin movimiento se marcan `expired` automáticamente. Admin puede reabrir si quiere |
| **R8 — Vulnerabilidad del DoctorRegistrationModal legacy** | 🚨 Alta | Decidir qué hacer con él (ver §5 y §10 Q1). Hoy mismo permite registros sin verificación con `lucy_status='claimed'` directo |

## 5. UX propuesta

### Opción A — "Solicitar afiliación" puro (recomendado)

**Flujo:**

1. Home → botón visible **"Soy médico, quiero afiliarme"** (reemplaza al actual "Soy médico").
2. Modal nuevo `AffiliationRequestModal` con un solo step:
   - Nombre completo.
   - Email (validación de formato).
   - Teléfono (con código de país, formato libre — no exigimos OTP en este punto).
   - Especialidad (select del catálogo `specialties` o "Otra" + free text).
   - Número de licencia/JVPM (free text).
   - Departamento + municipio (opcionales — selects).
   - Nombre de la clínica/consultorio (opcional, free text).
   - Mensaje libre (opcional, "contanos algo de tu práctica").
   - Comprobante (opcional): upload de imagen de la credencial JVPM o equivalente.
   - Checkbox: "Confirmo que la información es verídica y acepto que LucyCare contacte para validar mi identidad".
3. Submit → `submit_affiliation_request` RPC pública (rate-limited).
4. Pantalla de éxito: "Recibimos tu solicitud. Te contactamos en 2-3 días hábiles."
5. Admin recibe la solicitud en una bandeja nueva `/admin/afiliaciones` (badge con contador en sidebar admin).
6. Admin revisa, contacta al médico (out-of-band), valida.
7. Si aprueba: admin clickea "Aprobar y crear médico" → se crea fila en `doctors` con `lucy_status='listed_only'`, vinculada al lead. Admin manda mensaje al médico (manual por ahora) con el link a `/doctor/{id}` y le explica el flujo de reclamo.
8. El médico abre el link, ve la card "¿Eres este profesional?", reclama vía OTP+license (flujo PR #32 + PR #50, ya existente). Final: tiene `lucy_status='claimed'` y password creada.

**Ventajas:**
- Cero código nuevo de claim — reutiliza PR #32/#50 al 100%.
- LucyAdmin tiene control total de qué entra al catálogo.
- Datos del lead son opcionales lo suficiente como para no bloquear pero piden lo crítico.

**Trade-offs:**
- Médico no tiene cuenta inmediata — depende de validación manual (2-3 días).
- LucyAdmin tiene trabajo recurrente (mitigable con SLA y, en el futuro, alguna automatización de verificación).

### Opción B — Auto-registro con bandeja de aprobación

Mantener `DoctorRegistrationModal` pero:
- Cambiar `lucy_status` default a `'pending_approval'` (estado nuevo).
- No permitir login al panel hasta que admin apruebe.
- Admin aprueba → pasa a `listed_only` (luego claim normal) o directo a `claimed`.

**Trade-offs:** mantiene más código, más complejidad de estados, mismo problema de identidad (datos llenados por el usuario, validados por admin igual). Ahorra un paso para el médico bona fide. **No recomendado.**

### Opción C — Mantener DoctorRegistrationModal sin cambios

**Rechazada.** Tiene los problemas de identidad de §1.3.

### Recomendación

**Opción A.** Más simple, más segura, más alineada con el modelo actual de LucyCare (directorio curado). El paso obligado de **DESACTIVAR el `DoctorRegistrationModal` legacy** es parte del PR.

## 6. Estados posibles del médico/lead

### Lead (tabla nueva `doctor_affiliation_requests`)

```
pending     → recién creado, esperando triage de admin
in_review   → admin lo tomó, está validando
approved    → admin aprobó, ya creó el doctors row vinculado
rejected    → admin descartó (no apto, dato falso, duplicado, etc.)
expired     → sin movimiento >30 días, archivado automáticamente
```

Estados transversales:
- Cada cambio queda en `audit_log` con `edited_via='admin'`.
- `approved` y `rejected` requieren `admin_notes` para trazabilidad.
- `approved` apunta a un `doctor_id` (FK que se setea al crear el doctor).

### Doctor (tabla existente `doctors` — sin cambios al enum `lucy_status`)

```
listed_only            ← admin acaba de crearlo desde la aprobación del lead
claimed                ← médico ejecutó el flujo de reclamo (PR #32 + PR #50)
booking_enabled        ← admin habilitó booking en línea
verified               ← admin marcó como verificado
```

**Importante:** el enum `lucy_status` actual no necesita cambios. La afiliación solo introduce estados en la tabla nueva de leads. El doctor sigue su ciclo de vida idéntico al actual una vez creado.

## 7. Qué valida LucyAdmin

Para cada lead `pending`:

1. **Identidad del médico**: nombre y licencia coinciden con registro oficial (búsqueda manual en JVPM, redes profesionales, contacto directo).
2. **Teléfono y email**: válidos. Idealmente verificación por llamada o email confirmatorio out-of-band.
3. **Especialidad declarada**: razonable, consistente con la licencia.
4. **No duplicado**: el médico no está ya en `doctors` con otra licencia o email.
5. **Clínica declarada**: existe físicamente / es razonable.
6. **Comprobante de credencial** (si lo subieron): coincide con los datos.

Decisión binaria:
- **Aprobar** → admin completa los datos finales en un modal (puede ajustar nombre/especialidad/clínica si tipeó algo distinto), confirma. RPC `admin_approve_affiliation_request` crea el `doctors` row + `clinics` row + `clinic_members` owner. El lead pasa a `approved` con `doctor_id` seteado.
- **Rechazar** → admin escribe nota interna (no se le muestra al médico). Lead pasa a `rejected`. Opcional: enviar email automático al lead con copy neutro ("Por el momento no podemos avanzar. Te avisamos si la situación cambia.").

## 8. Qué NO debe pasar automáticamente

- ❌ **No crear `doctors` row automáticamente** desde el lead. Crear == admin clickeó "Aprobar".
- ❌ **No crear `auth.users` para el lead.** El médico no tiene cuenta hasta que admin apruebe + médico ejecute el flujo de reclamo. (Diferencia clave con el flujo legacy de `registerDoctor` que crea auth.users desde el OTP inicial.)
- ❌ **No autopublicar** (`is_published=false` siempre al crearlo, igual que importación).
- ❌ **No autoverificar** (`is_verified` es GENERATED de `lucy_status='verified'`; admin decide).
- ❌ **No activar booking** (`booking_enabled=false`).
- ❌ **No insertar servicios ni availability_rules** automáticamente. Eso lo configura el médico post-reclamo en `/panel/servicios` y `/panel/disponibilidad`.
- ❌ **No confiar en datos del formulario para mostrar nada público** hasta que admin valide.
- ❌ **No revelar al lead si el email/licencia ya existe en sistema** (response genérica).
- ❌ **No mandar SMS automático** al admin por cada solicitud (ruido). Sí: badge con contador en sidebar admin + email digest opcional.

## 9. MVP recomendado

Scope mínimo para abrir el flujo a producción:

### 9.1 Migración SQL nueva

```
Migración s7_21 (o el próximo número):
  - Tabla doctor_affiliation_requests
      id uuid PK
      created_at, updated_at
      full_name text not null
      email text not null
      phone text not null  (normalizado SV)
      specialty_id uuid null (FK opcional a specialties)
      specialty_other text null  (si eligió "Otra")
      license_number text not null
      department_id uuid null FK
      municipality_id uuid null FK
      address_line text null
      clinic_name text null
      message text null  (mensaje libre del médico)
      credential_url text null  (URL del upload en Storage)
      status enum ('pending','in_review','approved','rejected','expired')
      admin_notes text null  (notas internas, no se muestran al lead)
      doctor_id uuid null FK doctors (seteado al aprobar)
      reviewed_by uuid null FK profiles (admin que tomó decisión)
      reviewed_at timestamptz null
      UNIQUE (lower(email), upper(regexp_replace(license_number,'\s','','g')))
        WHERE status NOT IN ('rejected','expired')

  - Bucket Storage 'affiliation_credentials' (privado, solo admin lee)

  - RPC submit_affiliation_request (público, anon) — rate-limited
  - RPC admin_list_affiliation_requests (admin only)
  - RPC admin_review_affiliation_request (admin only — pasa a in_review)
  - RPC admin_approve_affiliation_request (admin only — crea doctor+clinic+clinic_member)
  - RPC admin_reject_affiliation_request (admin only)

  - RLS: solo service_role + admin pueden leer. Anon solo puede INSERT vía RPC.
  - Triggers de audit_log
```

### 9.2 Frontend

- **Reemplazar** botón "Soy médico" del home por **"Soy médico, quiero afiliarme"**.
- **Eliminar** (o deprecar) `DoctorRegistrationModal` y `registerDoctor.service.ts`. Decisión en §10 Q1.
- **Nuevo** `AffiliationRequestModal` con el form de §5.A.2.
- **Nueva página admin** `/admin/afiliaciones` con tabla paginada de leads + filtros por status + detalle modal con acciones "Aprobar / Rechazar / En revisión".
- **Badge** en sidebar admin con contador de leads `pending`.
- **Sin SMS automático**, sin emails automáticos al lead (en este MVP).

### 9.3 Out of scope para MVP

- Verificación automática contra JVPM.
- Email/SMS automáticos al lead cuando se aprueba/rechaza (admin lo hace manual o vía template guardado).
- Comprobante de credencial obligatorio.
- hCaptcha / Turnstile.
- Notificaciones admin (badge cuenta, pero sin push/email).
- Auto-expiración por TTL (queda como cron post-piloto).
- Bulk approval / merge de leads duplicados.

### 9.4 Tamaño estimado

- Migración SQL + RPCs: medio (~200-300 líneas, 4-5 RPCs nuevas).
- Frontend público (modal + página éxito): chico.
- Admin UI: medio (página listado + modal de detalle/acción).
- Deprecación del flujo legacy: chico (quitar import/botón, mantener archivos por si se reactiva).

**Total estimado: 1 PR mediano de ~5-7 días de implementación**, asumiendo que las decisiones de §10 se cierren primero.

## 10. Preguntas de decisión antes de implementar

Cada pregunta tiene un default sugerido; vos confirmás o cambiás.

### Q1. ¿Qué hacemos con el `DoctorRegistrationModal` legacy?

- **A) Eliminar completamente** (borrar archivos + service + botón en home). Reemplazar 100% por afiliación.
- **B) Deprecar (recomendado)**: ocultar el botón en home pero dejar los archivos por si se quiere reactivar en otro contexto.
- **C) Mantener pero forzar `lucy_status='pending_approval'`**: requiere migración para enum + admin bandeja igual. Más trabajo, menos beneficio.

**Default sugerido:** B (deprecar). Aislar de la UX pública sin perder código por si se reusa después.

### Q2. ¿El upload de credencial es opcional u obligatorio en el MVP?

- **A) Opcional** (más conversion, mayor responsabilidad en admin de pedirla off-line si falta).
- **B) Obligatorio** (mejor evidencia, menos conversion).

**Default sugerido:** A (opcional). MVP prioriza captura de lead; admin pide credencial si la duda.

### Q3. ¿Cómo se le comunica al médico el resultado de la revisión?

- **A) Manual por admin** (WhatsApp / email manual, copy + link al perfil ya listed_only para que reclame).
- **B) Email automático** al `approved` con link al `/doctor/{id}` para reclamar.
- **C) Email automático tanto al `approved` como al `rejected`** (template neutro de rechazo).

**Default sugerido:** A (manual) en MVP. Pasar a B/C cuando volumen lo justifique.

### Q4. ¿Soportamos lead "abandonado" (médico empieza el form y no envía)?

- **A) No** (sin tracking de eso).
- **B) Sí** (guardar parcial en localStorage para que pueda continuar después).

**Default sugerido:** A. No agregar complejidad para un caso edge.

### Q5. ¿La aprobación del lead crea automáticamente la `clinics` row o admin la elige?

- **A) Crear automáticamente** con el `clinic_name` del lead (si está vacío, usar "Consultorio Dr. X"). Admin puede editar después.
- **B) Pedirle a admin que elija**: o asocia a una clinic existente (si el médico se afilia a una clínica ya en LucyCare), o crea una nueva.

**Default sugerido:** A en MVP. B es lo correcto a largo plazo (un médico puede afiliarse a una clínica preexistente como asistente o socio), pero agrega complejidad.

### Q6. ¿Mostramos al médico que su solicitud está "en revisión" si vuelve al sitio?

- **A) No** (cero state visible — admin se encarga).
- **B) Sí**, con un input de email/teléfono que devuelve el estado de su solicitud actual (sin login).

**Default sugerido:** A. B abre vector de enumeración (atacante prueba emails para ver cuáles tienen solicitud).

### Q7. ¿Rate limit?

- **A) Sin rate limit** (confiamos en volumen bajo del piloto).
- **B) UNIQUE + rate limit por IP** (1 solicitud cada 24h por IP).
- **C) UNIQUE + Cloudflare WAF** (cuando se active proxy de Cloudflare).

**Default sugerido:** B en MVP. C cuando se habilite proxy de Cloudflare (follow-up de `SETUP_VERCEL_DOMAIN.md` §5.6).

### Q8. ¿Pedimos consentimiento explícito de datos (LOPD / privacidad SV)?

- **A) Checkbox simple** "acepto que LucyCare contacte para validar mi identidad".
- **B) Checkbox + link a política de privacidad** (documento separado).

**Default sugerido:** B. Bajo costo, mayor protección legal.

### Q9. ¿`/admin/afiliaciones` tiene permiso solo del admin de plataforma, o también algún rol intermedio?

- **A) Solo `is_admin()`** (mismo gate que el resto del admin).
- **B) Rol nuevo "reviewer"** (operador que puede aprobar/rechazar pero no editar el resto).

**Default sugerido:** A. Roles intermedios son complejidad post-piloto.

### Q10. ¿Cuándo se debería abrir este PR?

- **A) Antes del piloto público** (parte del Sprint 7 / pre-piloto).
- **B) Después del piloto** (los 5 médicos del piloto se importan manualmente, el flujo de afiliación se abre cuando se quiera crecer el catálogo).

**Default sugerido:** B. El piloto se cierra primero, luego abrimos afiliación para escalar. **Salvo** que ya estés recibiendo solicitudes de médicos que no podemos atender — en ese caso A.

---

## 11. Coordinación con otros docs

- `docs/ANALISIS_RECLAMAR_PERFIL.md` — el flujo de afiliación termina derivando al de reclamo. Sin cambios en ese doc.
- `docs/ANALISIS_AUTH_MEDICO.md` — el médico aprobado entra al flujo PR #50 (password en reclamo). Sin cambios en ese doc.
- `docs/SECURITY_GATE_PILOTO.md` — agregar hallazgo nuevo (R8 de §4 acá) sobre `DoctorRegistrationModal` legacy y su mitigación con la decisión de Q1.
- `docs/PLAN_PILOTO_5_MEDICOS.md` — los 5 médicos del piloto se importan via `scripts/import-doctors.mjs`, no usan este flujo nuevo.

---

## 12. Lo que este análisis NO decide

- Plan exacto de implementación (RPCs, RLS, schema final). Se cierra cuando vos respondas §10.
- Diseño visual del modal y página admin.
- Copy exacto de cada mensaje (responses, emails, banners).
- Decisión de keep/remove de cualquier campo del lead (especialidades, departamentos opcionales, etc.).

Estas se cierran en el doc de plan del PR concreto, **no acá**.

---

**Siguiente paso:** owner responde §10 (preguntas Q1-Q10). Con esas respuestas armo el plan operativo del PR (`docs/PLAN_AFILIACION_PR-A.md` o similar) y abrimos branch para implementar.
