# Plan Sprint 7/8 — Admin SaaS (single-tenant MVP, tenant-ready)

> Referencia oficial. Aprobado 2026-05-19. Acompaña a `ESTADO_TECNICO.md`.
> **Admin SaaS = admin PLATAFORMA** (dueño/operador de LucyCare),
> NO admin de clínica. Multi-tenant fuera de scope, pero el diseño
> debe quedar tenant-ready.

---

## 1. Alcance cerrado

Módulo de administración para el **dueño del SaaS**. MVP piloto: ≥5
médicos, sumando más progresivamente. **Single-tenant operativo**: una
sola plataforma LucyCare; varios médicos; pacientes/citas/consultas/
reputación/disponibilidad en el mismo entorno. Ruta raíz `/admin`,
separada del panel clínico, con guard de rol `admin`.

Objetivo doble: operar el negocio (aprobar/moderar) y mostrar tracción
(dashboard para inversores).

## 2. Módulos incluidos / excluidos

### Separación de ejes (decisión 2026-05-19 — NO conflar en `is_verified`)

El admin plataforma controla **3 ejes independientes** del médico:

1. **Operatividad (uso del SaaS)** — NUEVO `doctors.is_operational`
   (bool, default true). `false` → no puede usar panel / agenda /
   atender / firmar; perfil y datos se conservan. Login, route guards
   y booking deben respetarlo. Independiente del directorio.
2. **Directorio (visibilidad pública)** — `is_published` (visible),
   `is_verified` (sello confianza), `lucy_status`. Independientes
   entre sí y de la operatividad.
3. **Booking online** — `booking_enabled`.

Combinaciones válidas: piloto interno (operativo + no publicado);
suspensión por moderación (`is_operational=false` aunque publicado);
despublicado temporal (no publicado pero sigue operativo). Un solo
flag para todo limitaría el crecimiento del SaaS.

**Incluidos (ahora):**
- `/admin` con guard rol `admin` (`profiles.role='admin'` ya existe)
- Gestión de médicos — **ejes separados**: aprobar/verificar
  (`is_verified`), publicar/despublicar (`is_published`),
  `lucy_status`, y habilitar/suspender operación (`is_operational`)
- Moderación de usuarios: suspender/reactivar doctor/paciente/asistente
  (médico: `is_operational`; paciente/asistente: `is_active`)
- Dashboard de tracción: activos (médicos/pacientes/asistentes); citas
  creadas/atendidas por mes; consultas firmadas (volumen, sin contenido);
  reseñas (volumen + score promedio plataforma)
- Reputación admin (UI): `admin_review_traceability` con filtros +
  moderar `is_visible` de reseñas
- Auditoría: explorador de `audit_log` con filtros
- Catálogos globales: especialidades, departamentos, municipios,
  `cancel_reasons`
- Onboarding manual de médico (claim profile sin OTP)

**Excluidos (ahora, explícito):**
- Multi-tenant / organizaciones múltiples / admin de clínica
- Analytics de visitas/tráfico (Vercel Analytics/Plausible → futuro)
- Ingresos vía Stripe (no hay webhook de pagos)
- Facturación DTE (decisión cerrada: diferida)
- Edición de contenido clínico por admin (privacidad: solo volúmenes)

## 3. Roles / RLS admin

- `profiles.role='admin'` ya en el enum. Admin NO es doctor ni paciente.
- Función `is_admin()` SECURITY DEFINER STABLE
  (`role='admin' WHERE id=auth.uid()`), reusable en políticas.
- Lectura amplia: políticas `... OR is_admin()` SELECT en `doctors`,
  `patients`, `appointments`, `audit_log`, `reviews`, catálogos globales.
  **No** abrir `consultations`/`prescriptions` (contenido clínico).
- Escritura acotada: RPCs SECURITY DEFINER específicas
  (`admin_set_doctor_verified`, `admin_set_lucy_status`,
  `admin_suspend_user`, `admin_set_review_visibility`,
  `admin_claim_doctor_profile`). Sin policies de UPDATE amplias.
- Toda acción admin → `audit_log`.
- Bootstrap del primer admin: por SQL manual (documentado).

## 4. Fases (1 PR chico c/u)

| Fase | Contenido |
|---|---|
| A | `is_admin()` + vistas dashboard base + `AdminOnlyRoute` + layout `/admin` + check |
| B | Gestión de médicos (verificar/publicar/`lucy_status`) |
| C | Moderación de usuarios (suspender/reactivar) |
| D | Dashboard de tracción (métricas agregadas) |
| E | Reputación admin (trazabilidad + moderar `is_visible`) |
| F | Explorador de `audit_log` con filtros |
| G | Catálogos globales + onboarding manual de médico |

Cada fase: migración aplicada+verificada (`scripts/check-s7_0X.mjs`),
`vite build` OK, validada en preview, antes de mergear.

## 5. Riesgos técnicos

- RLS admin mal acotada → fuga de datos clínicos. Mitig.: solo
  agregados/metadatos; nunca policies amplias sobre `consultations`.
- Suspensión global puede romper directorio/booking/login si no se
  filtra consistentemente. Mitig.: auditar todos los puntos de lectura.
- `is_admin()` en muchas policies → perf. Mitig.: función STABLE, índices.
- Bootstrap primer admin por SQL → error humano. Mitig.: doc + check.
- Escala del sprint (2-3 sem). Mitig.: fasing por PR independiente.
- Onboarding sin OTP → duplicados/identidad. Mitig.: phone único + claim.
- **Diseño no tenant-ready** → reescritura futura. Mitig.: revisión
  explícita en Fase A (ver §8).

## 6. Criterios de aceptación (globales)

- No-admin: `/admin` redirige; RPCs admin rechazan con error claro.
- Admin verifica/publica un médico → se refleja en el directorio.
- Suspender un usuario lo saca de directorio/booking/login consistente.
- Dashboard cruza correcto contra SQL manual.
- Admin oculta reseña (`is_visible=false`) → fuera del público, trazable.
- Ninguna pantalla admin expone contenido clínico.
- Cada acción admin en `audit_log`.
- Ninguna RPC/vista admin asume tenant único de forma irreversible
  (revisado en code review de Fase A).
- Cada fase: `vite build` OK + migración verificada + preview OK.

## 7. Migraciones / cambios de BD

Todo aditivo, sin destructivo:
- `is_admin()`; reusar `audit_log`.
- RPCs SECURITY DEFINER de acciones admin (fases B/C/E/G).
- Vistas: `admin_platform_stats` (conteos), `admin_appointments_monthly`;
  reusar `admin_review_traceability`.
- Políticas `OR is_admin()` SELECT en tablas listadas en §3.
- **NUEVO `doctors.is_operational`** (bool, default true) — se agrega
  en Fase B/C (no en s7_01). Login/route guards/booking deben
  respetarlo. Eje independiente de `is_published`/`is_verified`.
- Verificar en Fase B/C existencia de `is_active` en `patients` /
  `clinic_members` para suspensión de paciente/asistente.
- s7_01 (Fase A) NO toca los ejes — solo `is_admin()` + stats lectura.
- **No** se agrega `organization_id` (eso es la migración del futuro
  multi-tenant, fuera de scope).

## 8. Consideración arquitectónica — camino futuro multi-tenant

Sprint 7/8 NO implementa multi-tenant, pero **no debe cerrar el camino**:

- No hardcodear "una sola clínica/plataforma" en queries/RPCs/vistas.
  Donde hoy hay `clinic_id`, conservarlo aunque el admin vea todo.
- RPCs/vistas de admin diseñadas **parametrizables por scope** (hoy
  scope = global; mañana scope = `organization_id`), sin reescritura.
- Tablas que en el futuro pertenecerían a una organización:
  `doctors`, `patients`, `appointments`, `clinic_members` (asistentes),
  `availability_rules`, `availability_overrides` (bloqueos), `reviews`,
  `services`, catálogos per-doctor, settings.
- Camino futuro (documentar, no construir): introducir `organizations`
  + `organization_id` (o promover `clinics` a tenant raíz) → RLS por
  tenant → rol "admin clínica" scopeado por organización. El
  `is_admin()` de plataforma sigue como super-rol por encima del tenant.
- "Admin clínica" es etapa futura: NO se diseña ni se nombra ahora para
  no inducir deuda conceptual.
