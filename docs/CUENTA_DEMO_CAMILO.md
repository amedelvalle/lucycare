# Cuenta demo oficial — Dr. Camilo Carrillo / Pepe Toro

> Cuenta médico real (no seed) utilizada para validar flujos end-to-end
> en preview y producción. **NO se debe descartar, desactivar ni borrar
> nunca en limpiezas de seed.**

## Identidad

| Campo | Valor |
|---|---|
| `profile_id` | `db1fba98-a299-4f25-82f1-7feff01e58fa` |
| `doctor_id` | `783a902a-55fd-407c-9e0a-69568135c7f5` |
| `clinic_id` | `8ea0fd8f-87a9-45f9-8f4e-f358764f58c0` |
| Nombre | Dr. Camilo Carrillo |
| Phone (login) | `50378627694` (Test Phone en Supabase OTP `123456`) |
| Email | `carlosmartine@gmail.com` (real, controlado) |
| Especialidad | Medicina General |
| Licencia | `1023` |

## Estado vigente en DB

| Campo | Valor |
|---|---|
| `profiles.is_active` | `true` |
| `profiles.role` | `doctor` |
| `doctors.lucy_status` | `verified` |
| `doctors.is_published` | `true` |
| `doctors.is_operational` | `true` |
| `doctors.booking_enabled` | `true` |
| `doctors.is_verified` | `true` (GENERATED de `lucy_status='verified'`) |
| `clinic_members` | 1 row, role=`owner`, active=true |
| Servicios activos | 3 |
| Availability rules | 6 |
| Historial real | ~50 appointments, ~15 consultations |

## Flujos que valida

- Login OTP del médico (`+503 7862 7694 / 123456`).
- Panel home, calendario, citas, pacientes.
- Edición de perfil propio y foto de avatar (`/panel/perfil`).
- Catálogos per-doctor (diagnoses, medications, family_history).
- Creación y firma de consultas.
- Receta + print.
- Servicios y disponibilidad.
- Reputación (recibir reseñas).
- Futura recuperación por email (Fase 4 — Supabase enviará el reset link a `carlosmartine@gmail.com`).

## Reglas

1. **No incluir en limpiezas de seed.** Las limpiezas filtran por
   `email LIKE '%@lucycare.test'` o por UUID en rango `a0000001-*`.
   Camilo cumple **ninguno** de los dos criterios (email real, UUID
   propio). La migración `s7_17` lo verifica explícitamente.
2. **No cambiar `lucy_status` a `listed_only`** para "limpieza visual".
3. **No despublicar** sin coordinación: producción lo muestra en el directorio.
4. **No modificar email** si se planea probar Fase 4 — el reset password
   irá a `carlosmartine@gmail.com`.

## Pendientes opcionales (no bloqueantes)

- Subir avatar real desde `/panel/perfil` para tener un perfil completo
  visible en directorio. Hoy `profiles.avatar_url IS NULL` y se ve con
  iniciales (`DoctorAvatar`).

## Referencia rápida de Test Phones en Supabase

| Phone | OTP | Uso |
|---|---|---|
| `50378627694` | `123456` | Camilo (médico demo) |
| `50378056365` | `123456` | Admin de plataforma |

Configurados en Supabase Dashboard → Authentication → Phone → Test phone numbers.
Mantener "Test OTPs Valid Until" en fecha futura.
