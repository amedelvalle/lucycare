# Análisis — Directorio informativo (modelo comercial)

> Documento de diagnóstico + decisiones + plan. Snapshot 2026-05-25.
> Pre-requisito de los PRs que vienen después de Fase 4 PR-B.

## Contexto y problema

Hoy el home de LucyCare muestra **solo 2 médicos** (Camilo y Gina) sobre 5 publicados. La diferencia: el home exige `is_published=true AND is_operational=true`, y los otros 3 están publicados pero no operativos.

Esto choca con el modelo comercial real: **LucyCare quiere funcionar también como directorio amarillo en esta fase**, mostrando médicos reales aunque no sean clientes de Lucy ni operen agenda con la plataforma. La propuesta de valor es "vienen pacientes desde Lucy → te convertimos en cliente después".

## Decisiones tomadas (alineadas con el owner)

### 1. Médico informativo ≡ médico real NO cliente de Lucy

- Aparece en directorio con datos de contacto (phone + WhatsApp + ubicación).
- Paciente lo encuentra y lo contacta directo (call/WA).
- No tiene booking online ni opera agenda en la plataforma.
- No hay claim de perfil necesariamente.

### 2. Separar visibilidad de operatividad

Cambio del modelo de ejes:

| Eje | Antes (efecto) | Ahora (efecto) |
|---|---|---|
| `is_published` | aparece en directorio **Y** debe ser operativo | aparece en directorio (independiente) |
| `is_operational` | gate para directorio + panel | gate **solo** para panel/agenda |
| `booking_enabled` | reserva online | reserva online (sin cambios) |
| `lucy_status` | funnel comercial | funnel comercial (sin cambios) |

Significado nuevo:

- `is_published=true` → aparece en `/` (home directorio) y en `/doctor/:id`.
- `is_operational=true` → el médico (o su asistente) puede entrar al panel y operar.
- `booking_enabled=true` → además, acepta reservas online (mostrar slots).

### 3. CTA del paciente cuando el médico es informativo

**Lista de espera (waitlist) + notificación cuando active booking.**

El paciente deja nombre + teléfono; cuando el médico active `booking_enabled=true`, recibe notificación por WhatsApp/SMS.

El componente `WaitlistModal` ya existe pero **solo es un placeholder** (no persiste en DB, no notifica). Hay que hacerlo real.

## Estado actual del código

### Lugares que usan `is_operational` para filtrar visibilidad

```
src/services/directory.service.ts:84    .eq('is_operational', true)   ← listDoctors (home)
src/services/directory.service.ts:229   .or('is_operational.eq.true,lucy_status.eq.listed_only')   ← getDoctorDetail
```

`directory.service.ts:84` es el que esconde los 3 médicos publicados no operativos. **Quitar este filtro** es lo central del PR.

`directory.service.ts:229` ya fue aflojado en PR #32 para permitir reclamo en `listed_only`. Con el cambio nuevo, basta con `is_published=true` para abrir el detalle.

Lugares donde **sí** debe seguir usándose `is_operational`:

- `src/services/appointments.service.ts:22-31` — gate para crear citas (chequea que el doctor es operativo).
- `src/services/admin.service.ts:70,124` — solo lectura para mostrar el flag en admin.
- `src/hooks/useClinicContext.ts:73` — el panel del médico/asistente verifica si la clínica está operativa.
- `useClinicContext.doctorIsOperational` consumido por PanelLayout para mostrar "Cuenta suspendida".

Esos no se tocan.

### WaitlistModal — estado actual

Componente existe en `src/pages/doctor-detail/components/WaitlistModal.tsx`. UI completa (form nombre + phone SV), validación, mensaje de éxito.

**Lo que NO hace:**

```ts
// src/pages/doctor-detail/components/WaitlistModal.tsx:87-92
await new Promise(resolve => setTimeout(resolve, 1000));
const fullPhone = `+503${phoneRaw}`;
console.log('Waitlist submission:', { name, phone: fullPhone, doctor: doctorName });
setSubmitted(true);
```

- No persiste en DB.
- No avisa al admin.
- No notifica cuando el médico active booking.

**Bug menor heredado:** usa el patrón de "click outside cierra" que ya fixeamos en `LoginModal` (PR #40). Si vamos a tocarlo, conviene aplicar el mismo hardening.

### BookingCard — comportamiento actual cuando no hay agenda

`src/pages/doctor-detail/components/BookingCard.tsx` ya tiene rama `if (!canBook)` que muestra:

- Mensaje "Perfil informativo" para `lucy_status='LISTED_ONLY'`.
- Mensaje "Agenda en configuración" para `lucy_status='CLAIMED'`.
- Botones "Llamar para agendar" + "WhatsApp" + "Unirme a lista de espera".

Eso ya cubre buena parte de lo que necesitamos para el caso informativo. El cambio principal está en el listado del home y en hacer la waitlist real.

## Plan por PRs (orden propuesto)

### PR-A — Refactor filtros del directorio (chico, alto impacto)

**Alcance:**
- `directory.service.ts`: quitar `.eq('is_operational', true)` de `listDoctors`.
- `directory.service.ts:229`: simplificar `getDoctorDetail` para que abra cuando `is_published=true` (sin condición sobre `is_operational` ni `lucy_status`).
- Smoke: home muestra los 5 publicados (no solo 2). Cada perfil abre.

**Sin migración SQL.** Sin cambios en RLS. Sin tocar booking ni panel.

**Riesgo:** mostrar 3 médicos extra en home cuyo perfil **no tiene foto, ni servicios cargados, ni horarios**. Hay que verificar que el detalle se vea aceptable. Si alguno se ve roto, evaluamos enriquecer datos o filtrar por completitud (ej. requerir `full_name + specialty`).

### PR-B — Waitlist real + RLS + admin view

**Alcance backend:**
- Migración `s7_18_waitlist_entries.sql`:
  - Tabla `waitlist_entries (id, doctor_id, patient_name, patient_phone_e164, source='public_directory', status='pending|notified|cancelled', notified_at, created_at)`.
  - RLS: anon INSERT solo (sin SELECT/UPDATE/DELETE); admin SELECT/UPDATE; doctor SELECT solo las suyas.
  - Índice por `doctor_id`.
- RPC `submit_waitlist_entry(doctor_id, name, phone)` SECURITY DEFINER que normaliza phone y hace insert con audit_log.

**Alcance frontend:**
- `WaitlistModal`: conectarlo al RPC. Aplicar hardening UX (sin click-outside-cierra). Mensaje genérico de éxito (sin filtrar si el médico existe).
- (Opcional) En `/admin/medicos/:id`, sección nueva "Lista de espera" con count + lista de entries pendientes.

**Riesgo medio:** definir cómo se notifica al paciente cuando el médico activa `booking_enabled=true`. Opciones:
- Manual: el admin ve la lista en `/admin` y manda WhatsApp uno por uno.
- Automatizado: trigger en `doctors` que cuando `booking_enabled` cambia a `true`, marca las waitlist como `notified` y dispara una Edge Function que envía SMS/WhatsApp (vía Twilio).

Para piloto, **manual está OK**. Automatización después.

### PR-C — Onboarding del médico informativo (opcional, pre-piloto)

**Alcance:**
- Mejora del flujo de reclamo cuando el médico ve "tengo waitlist pendientes": mostrar el contador, generar urgencia para activar booking.
- Métrica admin: "demanda observada por médico" = count de waitlist para los no operativos.

Esto es de growth, no de capacidades base. Puede esperar.

## Decisiones cerradas (D1-D4 confirmadas por el owner)

### D1. Filtro de completitud mínima — CONFIRMADO

Para aparecer en directorio público, el médico debe tener al menos:
- `full_name` no vacío.
- `specialty_id` no nulo.
- `clinic.name` no vacío.
- `clinic.address_line` no vacío.

**No se exige** foto, bio ni servicios. Sin foto se muestra el placeholder de iniciales (`DoctorAvatar`).

Objetivo: publicación informativa amplia evitando perfiles vacíos.

### D2. Distinción visual + copy en español — CONFIRMADO

**Listado del home (`/`):**
- Orden: primero médicos con `booking_enabled=true`, después los informativos.
- Pill discreta en la card:
  - Con reserva activa: **"Agenda en línea"** (verde suave).
  - Informativo: **"Sin agenda en línea"** (gris).

**Detalle (`/doctor/:id`) cuando es informativo:**
> Este médico aún no tiene agenda activa en Lucy. Podés contactarlo por llamada o WhatsApp, o unirte a la lista de espera.

**Vocabulario prohibido en UI pública** (mantener solo internamente en código/DB):
- "Booking" / "Online booking" / "Reserva booking".
- "Médico no operativo" / "no operacional".
- "Onboarding".
- "Waitlist" → siempre "Lista de espera".

**Preferencia regional (El Salvador):** "Agenda en línea" mejor que "Reserva en línea" para citas médicas.

### D3. Idempotencia de waitlist — CONFIRMADO

UNIQUE INDEX `(doctor_id, patient_phone_normalized)`. Segundo intento → no crea fila pero frontend muestra el mismo mensaje "¡Listo!" que la primera vez. Privacidad preservada (no se revela si el phone ya estaba registrado).

### D4. Notificación manual desde admin — CONFIRMADO

**Sin Twilio, sin Edge Functions, sin SMS automático en esta fase.**

El sistema solo:
1. Guarda el interés del paciente.
2. Aplica dedup por médico + phone normalizado.
3. Muestra la demanda en `/admin/medicos/:id`.
4. LucyAdmin contacta manualmente cuando el médico active agenda en línea.

Textos en español en UI pública: "Lista de espera", "Avisarme cuando tenga agenda disponible", "Sin agenda en línea", "Reserva por teléfono".

## Plan de PRs ajustado

- **PR-A** — Refactor filtros + completitud + orden + copy del listado y detalle. Sin migración. Sin waitlist real todavía. Cambia comportamiento del home inmediato.
- **PR-B** — Waitlist real (tabla `waitlist_entries`, RLS, RPC, integración WaitlistModal, vista admin). Notificación queda manual.
- **PR-C** — Métricas / onboarding informativo. Post-piloto.

## Riesgos identificados

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | Médicos informativos sin datos completos se ven feos en home | Filtro de completitud mínima (D1) |
| 2 | Paciente confundido — "encontré al médico pero no puedo reservar" | Card visual clara (D2) + copy en BookingCard ya existente |
| 3 | Waitlist se llena de phones falsos / spam | Rate limit por phone normalizado + audit_log |
| 4 | Médico se entera tarde de la demanda | Métrica visible en admin + opcional notificación push |
| 5 | Anon dumpea waitlist completa | RLS estricto: anon solo INSERT, admin SELECT |

## Resumen ejecutivo

Cambio del modelo:
- `is_published` controla directorio (anteriormente requería operativo).
- `is_operational` queda como gate solo para panel/agenda.

Plan: 2 PRs principales (refactor filtros + waitlist real), 1 opcional (onboarding informativo).

Antes de codear, necesito confirmación de D1-D4. Con eso, el primer PR (refactor filtros) puede salir en el día.
