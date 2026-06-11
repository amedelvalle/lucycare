# Análisis — Administradores de plataforma (LucyAdmin): alta, ciclo de vida y revocación

> Mini-doc de análisis (docs-only, sin código). Problema: **hoy no existe una
> forma operativa de agregar/gestionar usuarios LucyAdmin sin SQL manual**.
> Es un riesgo operativo (no escala para soporte/crecimiento) y a la vez un
> tema sensible de seguridad (el rol `admin` gatea toda la plataforma).
>
> Objetivo: diseñar una forma segura de **invitar, activar, desactivar y
> revocar** administradores de plataforma, sin SQL manual y sin abrir una
> puerta de escalamiento de privilegios.
>
> Snapshot de referencia: HEAD `ea6541c`, migraciones hasta `s7_43`,
> PRs #1–#130. **No implementar hasta validar las decisiones de §7.**

---

## 0. Resumen ejecutivo

- **Hoy:** `admin` es un valor de `profiles.role`. El bootstrap está
  documentado en `s7_01` como SQL manual (`UPDATE profiles SET role='admin'
  WHERE phone='<tel>'`). No hay UI, ni RPC, ni script de gestión. Todos los
  admins son iguales (no existe owner/superadmin).
- **Lo bueno:** la superficie de autorización es sólida — `is_admin()`
  (definer, `STABLE`) se usa en **22 migraciones** (RPCs `admin_*` y policies
  RLS), y **no existe ningún flujo de la app que pueda llegar a
  `role='admin'`**: el claim promueve a `doctor`, las invitaciones de clínica
  a `assistant`, el perfil del paciente es column-restricted (no toca `role`),
  y la afiliación bloquea cuentas sensibles. El único camino al rol admin es
  SQL directo — ese es exactamente el problema a resolver, pero también la
  garantía de que no hay escalamiento accidental hoy.
- **Recomendación (Opción B) — ✅ APROBADA por el owner (2026-06-11):**
  mantener `profiles.role='admin'` como **único bit de autorización** (cero
  cambios a `is_admin()` ni a las 22 superficies RLS/RPC) y agregar un
  **registro de ciclo de vida** (`platform_admin_invitations`-registry con
  `pending/active/revoked`) + RPCs definer (`invite/accept/revoke/list`) +
  página `/admin/administradores`. La activación ocurre **al primer OTP login
  del invitado** (prueba de posesión del teléfono); la revocación baja el rol
  y queda trazada; un guard server-side impide revocar al **último admin
  activo**.

### Reglas vinculantes de Fase 1 (explícitas, decisión owner 2026-06-11)

1. **Admin = cuenta dedicada.** El teléfono del invitado NO puede pertenecer
   a una cuenta existente de paciente/médico/asistente → se **bloquea**. No
   se convierten cuentas existentes a admin en MVP; si hiciera falta usar ese
   número, pasa por revisión manual FUERA de este flujo.
2. **La invitación pendiente NO otorga ningún privilegio.** Mientras el
   estado sea `pending`, la persona no es admin, no pasa `is_admin()`, no ve
   `/admin`. El poder solo existe tras la activación.
3. **La activación requiere el primer login/OTP del invitado** (prueba de
   posesión del teléfono). No se crean admins dormant con poder previo.
4. **La revocación bloquea el backend de inmediato**: al bajar
   `profiles.role`, `is_admin()` devuelve false en la siguiente llamada — el
   revocado pierde TODA la superficie admin (RPCs + RLS + UI) al instante. Y
   existe **guard server-side contra revocar/desactivar al último admin
   activo**.
5. **Owner/superadmin y capacidades granulares quedan en Fase 2** — no se
   implementan ahora; quedan documentadas para cuando crezca el equipo.

---

## 1. Estado actual (verificado en código)

### 1.1 Cómo se crea hoy un admin
SQL manual, documentado en `migrations/s7_01_admin_foundation.sql` (línea 13):
`UPDATE profiles SET role='admin' WHERE phone='<tel>';` — presupone que la
persona ya hizo OTP al menos una vez (existe `auth.users` + `profiles`).
No hay script en `/scripts`, ni RPC, ni UI. El admin actual (test phone
`50378056365`) fue creado así.

### 1.2 Tablas que intervienen
- `auth.users` — credenciales (phone OTP; email+password disponible como
  segunda opción para médico/admin desde Fase 4 PR-A).
- `profiles` — `role: user_role` (`patient|doctor|assistant|admin`). El rol
  admin es solo este valor; no hay tabla propia de admins.
- No interviene `clinic_members` (admin de plataforma ≠ admin de clínica).

### 1.3 Superficie que depende de `role='admin'`
- **`is_admin()`** (`s7_01`): `EXISTS (profiles WHERE id=auth.uid() AND
  role='admin')`, `SECURITY DEFINER STABLE`. Usada en **22 archivos de
  migración**: todas las RPCs `admin_*` (doctores, afiliaciones, lista de
  espera, stats…), policies RLS de catálogos globales (`s7_38`),
  `patient_link_rejections` (`s7_43`), `find_patient_match_candidates`
  (`s7_35`), waitlist (`s7_18`), etc.
- **`AdminOnlyRoute`** (frontend): gatea `/admin` y sus 6 hijas — Dashboard,
  Médicos, Médicos/:id, Afiliaciones, Catálogos, Lista de espera. Es UX; la
  defensa real es `is_admin()` en backend.
- **`destinationForRole('admin')`** → `/admin` post-login.

### 1.4 ¿Owner/superadmin?
No existe. **Todos los admins son exactamente iguales** (un solo valor de
enum, sin niveles ni capacidades).

### 1.5 ¿Hay caminos de la app hacia `role='admin'`? (anti-escalamiento)
Verificado que **no**:
- `claim_doctor_profile` promueve `patient→doctor` (nunca admin).
- `accept_clinic_invitations` setea el rol de la invitación (`assistant`).
- `profiles` UPDATE es column-restricted (`s7_32`): el usuario no puede tocar
  su `role`; tampoco un admin puede editar `profiles` ajenos por tabla
  directa (RLS self-only — verificado empíricamente en QA de Katherine).
- La afiliación (`s7_42`) clasifica rol sensible como `block_sensitive`.
→ El único camino es SQL con service_role. Operativamente malo, pero sin
escalamiento posible desde la app: **la solución no debe degradar esto.**

---

## 2. Riesgos a cubrir por el diseño

| # | Riesgo | Mitigación propuesta |
|---|---|---|
| R1 | **Escalamiento de privilegios** (alguien llega a admin sin autorización) | Alta SOLO vía RPC definer gateada `is_admin()`; ningún flujo público/self-service; el rol se setea únicamente dentro de la RPC de activación. |
| R2 | **Un admin invita admins sin control** | MVP: cualquier admin activo puede invitar PERO con confirmación explícita + audit completo (quién/cuándo/a quién). Fase 2: owner/superadmin si el equipo crece (decisión D1). |
| R3 | **Pérdida de trazabilidad** | Registro con `invited_by/at`, `activated_at`, `revoked_by/at` + `audit_log` en cada transición. Hoy un UPDATE manual no deja rastro — esto lo corrige. |
| R4 | **Eliminar/desactivar al último admin activo** | Guard server-side en la RPC de revocación: `count(admins activos) > 1` o rechaza (P-code). |
| R5 | **Admin comprometido** | Revocación inmediata vía RPC (baja el rol → pierde TODO el acceso al instante porque `is_admin()` lee el rol); audit. 2FA queda para Fase Auth (ya en backlog). |
| R6 | **Rol admin sin auth válido** ("admin fantasma") | La activación ocurre al **OTP login** del invitado: el rol solo existe cuando la persona demostró posesión del teléfono. No se crean `auth.users` dormant para admins. |
| R7 | **Duplicidad teléfono/email** (el invitado ya es paciente/médico) | Decisión ya tomada (identidad múltiple, 2026-06-08): **admin = cuenta separada, no se mezcla** con paciente/médico en MVP. La invitación valida que el teléfono NO pertenezca a una cuenta existente → bloquea/revisión manual (decisión D2). |
| R8 | **Invitaciones eternas** | TTL (reutilizar el criterio de 14 días de `clinic_invitations`) + estado derivado "vencida". |

---

## 3. Alternativas de modelo

### Opción A — RPC de creación directa (estilo afiliación Fase 2)
Un admin crea otro admin al instante (auth.user dormant + profile role=admin).
- ✅ Simple. ❌ Crea **admins dormant** (R6), sin paso de posesión del
  teléfono; el poder total se otorga sin que el receptor haya hecho nada.
  **Descartada.**

### Opción B — Invitación + activación por OTP + registro de ciclo de vida ← RECOMENDADA
- Tabla nueva (p. ej. `platform_admin_invitations`): `phone_normalized`,
  `display_name`, `email?`, `status (pending|active|revoked)`, `invited_by/at`,
  `expires_at` (TTL 14d), `activated_at`, `activated_profile_id`,
  `revoked_by/at`. UNIQUE parcial sobre `phone` con `status='pending'`.
- RPCs definer: `admin_invite_platform_admin` (gate `is_admin()`; valida R7),
  `accept_platform_admin_invitation` (la llama el invitado tras su OTP —
  mismo patrón que `accept_clinic_invitations`: valida teléfono == auth,
  invitación vigente → **setea `profiles.role='admin'`** + `active` + audit),
  `admin_revoke_platform_admin` (gate + **guard último admin** + baja rol +
  `revoked` + audit), `admin_list_platform_admins` (gate; lista activos +
  invitaciones).
- **`profiles.role='admin'` sigue siendo el único bit de autorización** →
  `is_admin()` y las 22 superficies RLS/RPC quedan intactas.
- ✅ Sin admins fantasma; trazabilidad completa; cero cambios al modelo de
  autorización; reutiliza patrones probados del repo (invitación de equipo +
  clasificación de afiliación). ❌ Una tabla y 4 RPCs nuevas (alcance medio).

### Opción C — Tabla `platform_admins` como fuente de verdad (+ capacidades)
`is_admin()` pasaría a leer la tabla nueva; roles/capacidades granulares.
- ✅ Más expresiva a futuro. ❌ Toca la **función más sensible del sistema**
  (consumida por 22 superficies) y migra el modelo de autorización completo;
  riesgo desproporcionado para la necesidad actual (1–2 admins).
  **Diferida a Fase 2** solo si se necesita granularidad real.

### Recomendación
**Opción B.** Mantiene la autorización exactamente como está (riesgo mínimo),
resuelve el problema operativo completo (alta/baja/lista/trazabilidad sin
SQL), y deja la puerta abierta a C si algún día hacen falta capacidades.

---

## 4. Operación mínima para MVP (Fase 1)

- **Invitar** LucyAdmin (por teléfono + nombre; email opcional): solo desde
  `/admin/administradores`, RPC gateada, confirmación explícita en UI.
- **Activar**: el invitado entra a Lucy con OTP → `accept_platform_admin_invitation`
  promueve el rol (mismo enganche post-OTP que ya existe para asistentes).
- **Listar**: admins activos (nombre, teléfono, desde cuándo) + invitaciones
  pendientes/vencidas (con reenvío fuera de alcance MVP o reutilizando el
  patrón `resend_invitation` si es barato — decisión D5).
- **Revocar/desactivar**: baja `role` (→ `patient`) + `revoked` + audit. La
  cuenta auth NO se borra (la persona conserva su cuenta, sin poderes).
- **Guard del último admin**: imposible revocar si es el único activo (P-code
  claro).
- **Audit obligatorio** de invitar/activar/revocar (quién, a quién, cuándo).
- **Sin self-service público**: ninguna ruta anon crea/solicita admin.

## 5. Principios de seguridad (vinculantes para la implementación)

1. **Backend autoritativo**: toda transición de estado vive en RPCs
   `SECURITY DEFINER` con gates explícitos; la UI es solo disparador.
2. **Nunca** UPDATE directo de `role` desde frontend (la RLS ya lo impide;
   se mantiene).
3. La tabla de invitaciones/registro: RLS admin-only SELECT; escritura solo
   vía RPCs definer (mismo patrón que `patient_link_rejections`).
4. Sin rutas públicas; sin crear `auth.users` (el invitado usa el login
   normal); sin exponer datos sensibles en la lista (solo nombre/teléfono/
   estado/fechas).
5. Audit en cada transición + P-codes claros (sin jerga Postgres en UI).
6. El bootstrap del PRIMER admin sigue siendo manual/excepcional
   (documentado) — esta herramienta gestiona a partir del segundo.

## 6. Fases

- **Fase 0 — este documento** (decisiones del owner en §7).
- **Fase 1 — flujo mínimo seguro**: migración `s7_44` (tabla + 4 RPCs +
  guard último admin + audit) + página `/admin/administradores` + NavLink +
  service + types + `check-s7_44` + `_smoke-s7_44` + preview/validación
  visual. 1 PR (o backend/UI separados si se prefiere).
- **Fase 2 — granularidad** (solo si hace falta): owner/superadmin,
  capacidades por área, 2FA para admins (se alinea con Fase Auth).

---

## 7. Decisiones — ✅ APROBADAS por el owner (2026-06-11)

- **D1 ✅ — Invita cualquier admin activo (MVP).** Obligatorio: audit fuerte
  de `invited_by`, fecha, teléfono/email invitado, estado y cada transición.
  Owner/superadmin NO se implementa ahora — documentado como Fase 2 si crece
  el equipo.
- **D2 ✅ — Bloquear si el teléfono ya pertenece a paciente/médico/asistente.**
  Admin = **cuenta dedicada**. No se convierten cuentas existentes a admin en
  MVP. Si hace falta usar ese número → revisión manual fuera de este flujo.
- **D3 ✅ — Revocar quita el rol admin** (`profiles.role → 'patient'` o el
  estado seguro que el modelo permita) + registra `revoked`/`revoked_by`/
  `revoked_at`. **No** se desactiva `auth.users` en Fase 1 (salvo que el
  diseño lo soporte de forma limpia, que no es el caso hoy). El backend
  bloquea de inmediato vía `is_admin()`. **Guard contra revocar/desactivar al
  último admin activo.**
- **D4 ✅ — Activación al primer OTP/login del invitado.** Sin admins dormant
  con poder previo. La invitación pendiente NO otorga acceso admin.
- **D5 ✅ — TTL 14 días + re-invitar simple en MVP.** Reenvío formal queda
  para después si hace falta.
- **D6 ✅ — Alcance Fase 1 aprobado:** invitar · activar · listar · revocar ·
  guard de último admin · audit · página `/admin/administradores`.

### Restricciones vinculantes para la implementación (owner)
Sin capacidades granulares · sin tocar `is_admin()` salvo inevitable · sin
superadmin/owner · sin self-service público · sin convertir cuentas
existentes · nada fuera del ciclo de vida de LucyAdmins · sin refactor ni
limpieza lateral.

## 8. Propuesta de PR mínimo (si se aprueba Fase 1)

- `migrations/s7_44_platform_admins.sql`: tabla `platform_admin_invitations`
  (registro de ciclo de vida) + RPCs `admin_invite_platform_admin` /
  `accept_platform_admin_invitation` / `admin_revoke_platform_admin` /
  `admin_list_platform_admins` + guard último admin + audit + RLS admin-only.
- Frontend: página `/admin/administradores` (gate `AdminOnlyRoute`) + NavLink
  "Administradores" + service + hook post-OTP para el accept (mismo punto
  donde hoy se llama `accept_clinic_invitations`).
- `database.types.ts` + `check-s7_44.mjs` + `_smoke-s7_44.mjs` (invitar →
  activar por OTP → revocar → guard último admin → gates anon/no-admin →
  no-relink de revocados si aplica → cleanup).
- Validación: tsc/build + owner aplica migración + check/smoke + preview.
- Tamaño estimado: **medio** (comparable a B2/s7_43).

## 9. Deuda/hallazgos laterales (documentados, NO se tocan ahora)

- El bootstrap manual de `s7_01` seguirá existiendo para el PRIMER admin —
  conviene dejarlo documentado como procedimiento excepcional con audit
  manual (anotar en bitácora del owner quién/cuándo).
- `accept_clinic_invitations` compara teléfono literal (ya en backlog #125):
  si Fase 1 reutiliza ese patrón, usar `normalize_phone_sv` desde el día 1
  para no heredar el bug.
- No existe 2FA para admins (ya en backlog de Fase Auth post-piloto); la
  cuenta admin de plataforma es el objetivo más valioso del sistema.

## 10. Relación con otros docs

- `docs/ANALISIS_ONBOARDING_IDENTIDAD_MULTIPLE.md` — decisión "admin =
  cuenta separada en MVP" (sustenta D2).
- `docs/ANALISIS_PACIENTE_GLOBAL_OWNERSHIP.md` — D6/D7: Lucy gobierna
  identidades; las herramientas de poder (merge, recuperación, admins) son
  de LucyAdmin con audit.
- `migrations/s7_01_admin_foundation.sql` — `is_admin()` + bootstrap manual.
- `docs/ANALISIS_AUTH_MEDICO.md` — email+password y futura 2FA.
