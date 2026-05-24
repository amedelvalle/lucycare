# Análisis — Flujo "Reclamar perfil"

> Documento de diagnóstico + decisión + rediseño. Snapshot 2026-05-23.
> Aprobado por owner. Estado del código actual: implementado pero con
> riesgos críticos de seguridad. **Bloqueante para abrir al público.**

## 1. Estado actual

### Componentes
- `src/pages/doctor-detail/components/ClaimProfileModal.tsx` (351 líneas).
- `src/services/claimProfile.service.ts` (158 líneas, función `claimDoctorProfile`).
- **CTA**: inline en `BookingCard.tsx` línea ~192 — texto pequeño
  *"¿Eres este profesional? Reclama tu perfil"*. NO es card destacada.

### Flujo actual (4 steps)
1. OTP por teléfono. **Se SALTA si ya hay sesión.**
2. Licencia médica — solo chequea `length >= 4`. No valida contra nada.
3. Servicios + disponibilidad + toggle "Activar agenda online".
4. Éxito.

### Tablas que toca
- `profiles` (role='doctor').
- `doctors` (profile_id, license_number, lucy_status, booking_enabled,
  tos_accepted_at, tos_version).
- `clinic_members` (upsert owner).
- `services` (insert sin dedup).
- `availability_rules` (insert sin dedup).

### NO toca
- `auth.users` (usa sesión existente).
- `audit_log` ← **faltante**.

### Importación previa
Los 100 médicos importados ya tienen `auth.users` (Admin API, sin password).
El reclamo debería **vincular**, no crear.

## 2. Riesgos críticos detectados

### R1 (CRÍTICO) — Cualquiera puede reclamar un `listed_only`
- OTP solo prueba "tengo este teléfono", no que sea del médico listado.
- Licencia no se compara contra `doctors.license_number`.
- **Resultado:** paciente cualquiera puede tomar control de un médico
  importado.
- **Bloqueante absoluto para abrir al público.**

### R2 (CRÍTICO) — Auto-activa booking online
El toggle "Activar agenda online" setea `lucy_status='booking_enabled'`
+ `booking_enabled=true`. Violación directa de la regla de producto:
**reclamar perfil NO debe activar booking**.

### R3 (ALTO) — Escalada de privilegios
`profiles.role = 'doctor'` para quien sea que esté logueado. Un paciente
logueado se promueve a doctor sin verificación.

### R4 (ALTO) — Skip OTP si hay sesión
Usuario logueado entra directo al paso de licencia. Combinado con R1
baja aún más la barrera.

### R5 (MEDIO) — Sin auditoría
Ninguno de los cambios queda en `audit_log`.

### R6 (MEDIO) — TOS aceptado sin mostrarlo
El service escribe `tos_accepted_at` y `tos_version='v1.0'` pero el
modal nunca muestra términos ni casilla "acepto".

### R7 (MEDIO) — Sobrescribe `profile_id`
Reclamar overwritea `doctor.profile_id`. El `auth.users` original
importado queda huérfano. No recuperable sin SQL manual.

### R8 (ALTO) — Inserts sin dedup
Si el doctor reclama, los `services` y `availability_rules` que el seed
ya tenía quedan duplicados con los del modal.

## 3. Decisión de producto

### Qué SÍ debe hacer el reclamo

- Cambiar `lucy_status: 'listed_only' → 'claimed'`.
- Vincular/preservar `auth.users` ↔ `doctors`.
- Marcar `profile.role = 'doctor'` si era `'patient'`.
- Crear `clinic_members` como owner (upsert).
- Escribir `tos_accepted_at` y `tos_version` **después** de mostrar y aceptar términos.
- Audit log.

### Qué NUNCA debe hacer el reclamo (regla explícita aprobada)

- ❌ Marcar `is_verified` — lo decide LucyAdmin via `lucy_status='verified'`.
- ❌ Cambiar `is_published` — sigue como estaba.
- ❌ Cambiar `booking_enabled` — sigue como estaba.
- ❌ Cambiar `is_operational` — sigue como estaba.
- ❌ Insertar `services` — eso se hace en `/panel/servicios` después.
- ❌ Insertar `availability_rules` — eso se hace en `/panel/disponibilidad`.

LucyAdmin mantiene control de: verificación oficial, publicación,
agenda online y operatividad. El médico se autoadministra servicios y
horarios **después** de reclamar y haber sido habilitado por LucyAdmin.

## 4. Validación de identidad (rediseño)

Para reclamar automáticamente:
1. **Match obligatorio** entre el phone del OTP y
   `doctors.profile_id → profiles.phone` del médico listado.
2. **Match obligatorio** entre la licencia tipeada y `doctors.license_number`
   (case-insensitive, sin espacios).

Si cualquiera falla → NO se permite reclamo automático. Se ofrece
"Solicitar revisión manual" (notifica a LucyAdmin con la diferencia +
datos del solicitante).

### Casos cubiertos

| Caso | Comportamiento esperado |
|---|---|
| Phone + license matchean | ✅ reclamo automático |
| Phone matchea, license no | Bloqueado → "Solicitar revisión manual" |
| License matchea, phone no | Bloqueado → "Solicitar revisión manual" |
| Email ya existe en auth.users | Vincular en vez de duplicar |
| Profile existe sin auth.users | Crear auth.users + vincular |
| Auth.users existe sin doctor vinculado | Vincular |
| Licencia no matchea | Bloqueado |
| Perfil ya reclamado (`lucy_status != 'listed_only'`) | Bloqueado |
| Intento de suplantación | Match dual phone+license lo previene |
| OTP falla/expira | Reintento posible |
| Abandono a mitad | Sin persistencia → estado limpio |

## 5. Rediseño del modal MVP

### Pasos

**Step 1 — Identidad**
- Phone (OTP). El número tipeado se compara contra el del médico **antes
  de enviar SMS**.
- Email confirmado (pre-rellena de `profiles.email`).

**Step 2 — Verificación profesional**
- Licencia/JVPM. Match case-insensitive contra `doctors.license_number`.

**Step 3 — Términos + acceso**
- Texto de términos visible (link al documento) + checkbox obligatorio.
- "Crear contraseña ahora" (recomendado) o "Recibir link por email después".

**Step 4 — Éxito**
- Mensaje: *"Reclamado. Tu perfil aparece igual en el directorio. Para
  activar agenda online o publicación, contactá a Lucy."*

### Lo que se ELIMINA del modal actual
- Configurar servicios.
- Configurar disponibilidad.
- Toggle "Activar agenda online".

### Lo que se MUEVE a otra parte
- **Foto de perfil**: opcional post-reclamo (banner persistente en
  `/panel/home` hasta que la suba).

## 6. CTA visible (rediseño UI)

Reemplazar el inline en `BookingCard` por una **card destacada** en
`doctor-detail/page.tsx`, debajo de la info del médico:

```
┌─────────────────────────────────────────┐
│ 👤  ¿Eres este profesional?              │
│                                          │
│ Reclama tu perfil en LucyCare y         │
│ administra tu información, servicios y  │
│ agenda desde tu panel.                   │
│                                          │
│            [ Reclamar mi perfil ]        │
└─────────────────────────────────────────┘
```

- Solo visible si `doctor.lucyStatus === 'listed_only'`.
- Posición: debajo de la info principal, antes de la sección de booking.
- Mobile-first.

## 7. Plan por fases

### Fase 1 — Diagnóstico ✅
Este documento.

### Fase 2 — Reclamo seguro (PR, ~1 semana)
- Rediseño de `claimDoctorProfile`:
  - Validar match phone + license antes de cualquier cambio.
  - Preservar `profile_id` cuando matchea (no sobrescribir).
  - Escribir `audit_log`.
  - Eliminar inserts de services/availability.
  - Eliminar toggle de booking.
- Rediseño de `ClaimProfileModal`: 3 pasos + términos.
- CTA visible (card en doctor-detail).
- Bandeja básica en admin: lista de reclamos manuales pendientes (opcional MVP).

### Fase 3 — Foto de perfil (PR, ~2-3 días)
- `<AvatarUploader>` con preview, cámara móvil, límites (5 MB, JPG/PNG/WEBP).
- Integración en `PerfilPage` (médico) y `AdminDoctorEditPage` (admin).
- Banner "Completá tu perfil con foto" en `/panel/home`.

### Fase 4 — Acceso robusto (coordinada con `ANALISIS_AUTH_MEDICO.md`)
- PR-A y PR-B de ese análisis. El paso 3 del reclamo (crear contraseña)
  llama a las APIs de `auth.service.ts` agregadas en PR-A.

## 8. Riesgo de duplicación post-fix

Después del rediseño:
- `doctors`: no se duplican (reclamo opera sobre id existente).
- `profiles`: vinculación preserva `profile_id` original.
- `auth.users`: cero huérfanos.
- `services`/`availability_rules`: no se insertan en el reclamo.
- `clinic_members`: upsert con `onConflict` ya correcto.

## 9. Foto de perfil — situación actual

### Schema
- Campo: `profiles.avatar_url TEXT` (nullable).
- Tabla aparte: `doctor_images` (galería de fotos del consultorio).

### Storage
- Bucket: `avatars` en Supabase Storage (público).
- Path: `{userId}/avatar.{ext}`.
- Consumido por `getDoctorDetail` → `doctor.avatar_url` en directorio.
- Subida actual: solo en registro inicial del doctor
  (`doctorRegistration.service.ts`).
- Placeholder: componente `DoctorAvatar.tsx` muestra iniciales si NULL.

### Decisiones aprobadas

- Opcional al reclamar (no bloqueante).
- Banner post-reclamo si no la subió.
- LucyAdmin puede cambiar/remover desde `AdminDoctorEditPage`.
- Formatos: JPG/PNG/WEBP, máx 5 MB.
- Preview antes de guardar.
- Cambio queda en `audit_log` (tabla `profiles`).
- Cámara móvil habilitada (`accept="image/*" capture="user"`).

## 10. Coordinación con otros docs

- `ANALISIS_AUTH_MEDICO.md` — Fase 4 de este doc se integra con PR-A/PR-B
  del análisis de auth.
- `PLAN_PILOTO_5_MEDICOS.md` — onboarding por médico incluye reclamo
  exitoso como hito.
