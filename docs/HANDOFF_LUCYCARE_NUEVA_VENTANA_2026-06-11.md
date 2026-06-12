# HANDOFF — Nueva ventana de contexto (cierre 2026-06-11)

> **Punto de entrada para retomar LucyCare en una conversación nueva.**
> Leer ESTE documento primero; después `CLAUDE.md` y los `docs/ANALISIS_*.md`
> del objetivo del día. No asumir nada sin confirmar el estado real del repo.

---

## 1. Estado final al cierre de esta ventana

- **HEAD final:** `22bef3b` (*feat(admin): administración de LucyAdmins — Fase 1 (s7_44) (#132)*) **+ el PR docs-only de este handoff** (verificar con `git log --oneline -3`).
- **PRs mergeados:** #1–#132 (+ el docs-only de cierre).
- **Migraciones aplicadas en Supabase:** hasta **`s7_44`** (verificables con `node scripts/check-s7_NN.mjs`).
- **Árbol limpio · `main` al día con `origin/main` · `tsc --noEmit` OK · `npm run build` OK.**
- **Sin frente de código abierto.** Admins activos de plataforma: 1 (el owner).

### Cómo arrancar la nueva ventana (obligatorio)

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -10
git status --short
```

1. Leer este handoff primero, después `CLAUDE.md`.
2. **No asumir código nuevo sin confirmar el estado** (log + status).
3. **No reabrir frentes cerrados salvo bug real.**
4. Confirmar el frente del día con el owner antes de codificar.

---

## 2. Frentes cerrados recientes (NO reabrir salvo bug real)

| Frente | PRs / migración | Resumen |
|---|---|---|
| **Afiliación médica paciente→médico** | #122 / `s7_42` (+docs #123) | `admin_approve_and_create_doctor` clasifica (`_affiliation_classify` + preflight) y ramifica new/reuse_patient/block (P0010–P0013); reuse sin nuevo `auth.user`, fill `full_name` si vacío, sin tocar phone/email/role; no copia email del lead. Smoke 12/12. |
| **Identidad múltiple — análisis + Fase 1** | #124 + #125 (+docs #126) | Modelo "identidad única + capacidades múltiples" (5 decisiones aprobadas). `PatientOnlyRoute` permite patient/doctor/assistant (excluye admin/anon); fixes: `useDashboard` vía `useClinicContext` y `listMyAppointments` con filtro explícito por persona. |
| **Ownership del paciente — análisis** | #127 | Regla central vinculante: *"el médico gestiona una relación clínica local; LucyCare gobierna la identidad global"* (D1–D7 aprobadas). |
| **B2 — Confirmación post-claim** | #128 / `s7_43` (+docs #129) | `link_confirmed_at` + sección "por confirmar" separada de Mis atenciones + confirm/reject POR FICHA + `patient_link_rejections` `pending_review` + claim sin re-link de pares rechazados. Smoke 14/14. |
| **Navegación móvil LucyAdmin** | #130 | `AdminLayout` con header fijo + hamburguesa + drawer en móvil (antes no había NINGUNA navegación bajo 768px). Desktop intacto. Frontend-only. |
| **Análisis administración LucyAdmins** | #131 | `docs/ANALISIS_ADMINISTRADORES_LUCY.md` — Opción B aprobada, D1–D6 + reglas vinculantes. |
| **Administración LucyAdmins — Fase 1** | #132 / `s7_44` | Ver §3. Smoke 24/24 + check 6/6 + OK visual. |

---

## 3. Detalle de `s7_44` (administración de LucyAdmins, live)

- **Tabla `platform_admin_invitations`** = ciclo de vida (`pending → active → revoked`) con trazabilidad completa (`invited_by/at`, `expires_at` TTL 14d, `activated_at/profile`, `revoked_by/at`). RLS admin-only SELECT; escritura SOLO vía RPCs definer.
- **Invitación** (`admin_invite_platform_admin`): cualquier admin activo invita (D1), con audit. **Admin = CUENTA DEDICADA**: bloquea teléfonos de **paciente real / médico / asistente** (`P0050`), admin activo (`P0051`), inválido (`P0055` — backend valida con `normalize_phone_sv` + `^503\d{8}$`, no confía en la UI); pending vigente (`P0053`); **pending vencida se refresca in-place** (re-invitar simple, misma fila).
- **Activación** (`accept_platform_admin_invitation`): SOLO al primer login/OTP del invitado (prueba de posesión; hook fail-safe en `verifyOtp`, mismo enganche que `accept_clinic_invitations`). **La invitación pending NO otorga ningún privilegio.** Al activar, **llena `profiles.full_name` desde el `display_name` de la invitación si está vacío** (los invitados no nacen "Sin nombre").
- **Cuenta-cáscara por invitación vencida:** si el invitado entra con OTP con la invitación ya vencida, su login crea una cuenta `patient` vacía. Esa cuenta **es re-invitable** (el historial del registro — incluido `pending` — documenta que nació del flujo de invitación). **Pero si esa cuenta se volvió PACIENTE REAL** (fichas `patients` vinculadas), **nunca** es elegible ni activable (`P0050` / `blocked_role`, queda pending para revisión manual).
- **Revocación** (`admin_revoke_platform_admin`): baja `role → 'patient'` → **`is_admin()` bloquea el backend DE INMEDIATO**; **guard del último admin activo** (`P0052`, imposible dejar la plataforma sin admin); no toca `auth.users`; traza también a admins bootstrap (inserta fila `revoked`).
- **Listado** (`admin_list_platform_admins`): activos (fuente de verdad = `profiles.role='admin'`) + historial completo.
- **UI `/admin/administradores`**: activos (Revocar con confirm; deshabilitado si es el último), invitar (teléfono sanitizado/validado en UI con la MISMA regla del backend; entrada flexible `7XXXXXXX`/`503…`/`+503…` → se guarda `503XXXXXXXX`), pendientes vigentes/vencidas (Re-invitar), revocados. **"Editar nombre" SOLO sobre la fila propia** (self-update de `full_name` vía RLS `s7_32`, auditado; no toca phone/email/role/auth) — resolvió el bootstrap "Sin nombre".
- **Audit** en cada transición: `platform_admin_invite` / `reinvite` / `activate` / `revoke`.
- **Bootstrap del PRIMER admin** sigue siendo manual/excepcional (`s7_01`); esta herramienta gestiona del segundo en adelante.

## 4. Decisiones vigentes (vinculantes)

- **`profiles.role='admin'` es el ÚNICO bit de autorización.** `is_admin()` y sus ~22 superficies RLS/RPC quedaron INTACTAS — no tocar salvo inevitable.
- **No hay owner/superadmin** ni capacidades granulares en Fase 1 (documentado como Fase 2 si crece el equipo).
- **La invitación pending no otorga privilegios; activación solo tras OTP.**
- **Admin usa cuenta dedicada** (no se convierten cuentas de paciente/médico/asistente; revisión manual fuera del flujo si hiciera falta).
- **Sin self-service público de admin.**
- Regla central de ownership (#127): *"el médico gestiona una relación clínica local; LucyCare gobierna la identidad global del usuario/paciente"*.
- Identidad múltiple (#124): persona = identidad única con capacidades; `profiles.role` = rol primario/default de navegación; admin separado.
- En `reuse_patient` (afiliación) **no se copia el email del lead** (credencial sensible).

## 5. Pendientes vivos (elegir con el owner; ninguno arrancado)

1. **Limpieza controlada del teléfono `50372608827`** (registro Katherine, QA de `s7_42`) — SOLO cuando el owner lo indique, con **dry-run/inventario previo** (auth.user, profile, doctor/clinic/membership, lead, fichas, audit) antes de borrar nada.
2. **Katherine:** decidir conservar/corregir o limpiar ese registro. Si se conserva: re-guardar el nombre desde la ficha admin y **verificar que persista** (el intento anterior NO persistió — posible save silencioso fallido; si se repite, investigar como bug de la ficha).
3. **B1 / Paciente Global Fase 4 — merge admin de duplicados.** Grande y delicado (mueve historia clínica): **NO arrancar sin diseño específico propio.** Marco listo en `docs/ANALISIS_PACIENTE_GLOBAL_OWNERSHIP.md`; insumo: hallazgo F4 (el claim copia el DUI global y `UNIQUE(clinic,doc)` puede abortar el claim completo — reproducido en smoke `s7_43`).
4. **Recuperación de acceso sin sesión** — herramienta/protocolo LucyAdmin (D7); detrás del modelo de identidad.
5. **Identidad múltiple Fase 2** — selector "modo paciente/modo médico" + capacidades derivadas + revisar si `claim` deja de sobrescribir el rol.
6. **Paginación del Home** (hoy carga todos los médicos; importa con volumen).
7. **Normalización de teléfono literal en `accept_clinic_invitations`** (`+503…` ≠ `503…`; candidato a `normalize_phone_sv`; hallazgo QA #125).
8. **B2.1** — verificación reforzada de "Sí, son mías" (DOB/DUI parcial; para teléfonos compartidos/mal digitados).
9. **B2.2** — términos/onboarding del paciente: aceptar que solo puede confirmar atenciones propias (documental/legal).
10. (Post-piloto, ya previstos): pagos SaaS/IVA/DTE/Q1–Q11 (requiere validación owner), self-service de email, 2FA admins, owner/superadmin Fase 2, bandeja admin de `patient_link_rejections` si el piloto la pide.

## 6. Reglas operativas que se mantienen

- **Owner:** tareas manuales (aplicar SQL en Supabase, validaciones visuales en preview, OTP reales, decisiones comerciales/legales). **Dev:** entrega SQL completo para aplicar, corre `check-s7_NN` + `_smoke-s7_NN` tras la aplicación, verifica DB/audit, documenta.
- PRs chicos · server-side primero · smoke+check por migración · **squash-merge** · branches `claude/<8-12 chars>` · preview + OK visual antes de mergear UI · docs-only de cierre por frente.
- Tras cambios de columnas/tablas/RPC: actualizar `database.types.ts` en el mismo PR.
- Test phones: Camilo `50378627694` · admin `50378056365` · paciente `50375000001` · libre p/QA `50375000099` (todos OTP `123456`).
- No exponer contenido clínico al admin de plataforma. No secretos en repo/docs/chat.
