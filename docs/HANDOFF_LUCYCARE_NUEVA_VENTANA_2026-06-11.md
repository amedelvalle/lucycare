# HANDOFF — Nueva ventana de contexto (cierre 2026-06-11)

> ⚠️ **SUPERADO (2026-06-15).** El punto de entrada vigente es
> **`docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-06-15.md`** (cierre a #142 / F4-3
> UI PR A read-only). Este documento queda como **histórico** de la ventana
> anterior (cierre a #133/`s7_44`, refrescado al 2026-06-13 hasta #140).

> **Punto de entrada para retomar LucyCare en una conversación nueva.**
> Leer ESTE documento primero; después `CLAUDE.md` y los `docs/ANALISIS_*.md`
> del objetivo del día. No asumir nada sin confirmar el estado real del repo.

---

## 1. Estado final al cierre de esta ventana

> **Actualizado 2026-06-13** (cierres #134 diseño F4, #135/`s7_45` claim
> tolerante, #136 fix reserva móvil, #138/`s7_46` F4-2 backend del merge,
> **#140/`s7_47` F4-3-search RPC de candidatos**). El bloque original de
> cierre de la ventana (a #132/`s7_44`) queda abajo como histórico.

- **HEAD final:** `c4dbc2a` (*feat(paciente): RPC de candidatos a merge (F4-3-search / s7_47) (#140)*) **+ el PR docs-only de este refresh** (verificar con `git log --oneline -6`).
- **PRs mergeados:** #1–#140 (+ el docs-only de refresh).
- **Migraciones aplicadas en Supabase:** hasta **`s7_47`** (verificables con `node scripts/check-s7_NN.mjs`).
- **Árbol limpio · `main` al día con `origin/main` · `tsc --noEmit` OK · `npm run build` OK.**
- **Sin frente de código abierto.** Admins activos de plataforma: 1 (el owner).

### Cierres recientes (2026-06-13)

- **#140 / `s7_47` — F4-3-search: RPC de descubrimiento de candidatos a merge.**
  `admin_list_patient_merge_candidates()` (`SECURITY DEFINER`, `STABLE`, gate
  `is_admin()` → `P0001`; anon sin EXECUTE). **READ-ONLY** (solo SELECT/
  agregación: no merge, no escritura, no audit, no toca datos; verificado por
  snapshot antes/después). Lista **grupos** fusionables **V1 = `same_profile`
  (E3)** por `(clinic_id, profile_id)` con `profile_id IS NOT NULL`, contando
  **solo fichas vivas** (`is_active = true AND merged_into_patient_id IS NULL`)
  y exigiendo **≥2**. Por grupo: clínica/perfil + nombres + `patient_count` +
  `confirmed_links_count` / `unconfirmed_links_count` / `has_unconfirmed_links`
  + `warnings` (**`W_UNCONFIRMED_LINK`** si alguna ficha tiene
  `link_confirmed_at IS NULL` — **ayuda, no bloqueo**). Por ficha: identidad
  mínima (nombre/documento/DOB/género/teléfono/`is_active`/`link_confirmed_at`/
  `created_at`) + `counts` (appointments/consultations/vitals). **NO** devuelve
  contenido clínico; **NO** lista candidatos por teléfono, nombre, walk-ins,
  teléfono compartido, fuzzy ni override; **NO** ejecuta merge; **NO** toca
  identidad global, `profiles` ni `auth.users`. La decide la UI (PR 2), no la
  RPC; el gate de evidencia/elegibilidad real lo aplica el preflight/merge de
  `s7_46`. check 2/2 + smoke 10/10 + tsc + build + OK del owner. **PR 1 de
  F4-3; la UI `/admin/pacientes` es PR 2 (siguiente frente).**

- **#138 / `s7_46` — F4-2: backend del merge admin de fichas (intra-clínica).**
  `admin_merge_patients_preflight` (dry-run, no modifica DB) +
  `admin_merge_patients` (transaccional) + helper interno
  `_patient_merge_eligibility` + tabla `patient_merge_log` (snapshots /
  `moved_ids` / `moved_counts` / reason / actor / evidence; campos
  `unmerge_*` previstos para la reversa formal). **Bypass propio
  `app.merging_patients`** añadido a los dos guards (firma de consulta `s7_29`
  + identidad P0030 `s7_33`) — sus bypass previos intactos. El merge mueve
  `appointments`/`consultations`/`vitals` source→target (incl. **consulta
  firmada** vía bypass), **neutraliza la fuente** (`document_number→NULL`,
  `profile_id→NULL`, `is_active=false`, `merged_into_patient_id`/`merged_at`;
  **teléfono conservado** como traza; **no hard-delete**) y audita
  (`edited_via='admin_merge'`). **V1 = evidencia `same_profile`** (E3): el
  `UNIQUE(clinic,doc)` hace `same_document` inalcanzable intra-clínica
  (soportado en la lógica para legacy; 0 dups hoy). Bloqueos **P0060–P0068**:
  distinta clínica · ya fusionada · source==target · profiles distintos
  (P0065) · dirección inválida (P0064) · evidencia insuficiente/anti-evidencia
  (P0063) · motivo<10 (P0066) · **borrador abierto en la fuente bloquea
  (P0067)** · ficha inactiva (P0068). **Borrador en el target = solo warning**
  (DM3c). El claim ya ignora fichas merged (`s7_45`). **No merge por
  teléfono/nombre, no override, no identidad global, no `auth.users`, no UI,
  no unmerge implementado.** check 6/6 + smoke 19/19 + tsc + build + OK del owner.

- **#134 — Diseño Paciente Global Fase 4 / merge admin (docs-only).** DM1–DM9
  cerradas. Análisis en `docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md`.
  Alcance F4 = merge de **fichas `patients` intra-clínica** (no identidades,
  no `profiles`/`auth.users`, no expedientes cross-clínica). Reglas
  vinculantes: solo LucyAdmin, dry-run + motivo + audit obligatorios, no
  hard-delete, unmerge formal previsto. Fases F4-1 → F4-2 → F4-3 (+F4-3b,
  +F4-D diferida).
- **#135 / `s7_45` — F4-1: claim tolerante fila por fila.**
  `claim_patient_records()` procesa fichas **fila por fila** (subtransacción
  por ficha): una colisión `UNIQUE(clinic, doc)` ya **no aborta el claim
  completo** (cierra el hallazgo F4); las fichas válidas se vinculan, la
  conflictiva queda intacta (sin media-copia). Conflictos **auditados**
  (`claim_skipped_unique`/`claim_skipped_error` + resumen con `skipped[]`);
  el cliente recibe **solo conteos** (`linked_count`/`skipped_count`).
  Columnas **pasivas** `merged_into_patient_id` (FK sin CASCADE + CHECK
  anti self-reference) + `merged_at` (infra F4-2, nada las escribe; el claim
  excluye fichas marcadas). **No hace merge, no toca identidad global ni
  `auth.users`.** check 5/5 + smoke 16/16 + OK del owner.
- **#136 — Fix bug público de reserva móvil (frontend-only).** El CTA móvil
  "Reservar cita" abría un scaffold **mock** (horarios de cliente, servicios
  inventados, `PaymentModal` falso sin crear cita). Ahora abre el **flujo
  real** (`BookingCard`: servicios reales, slots reales, `createBooking`,
  OTP). **Fecha por defecto** (hoy o próxima disponible) en hora **local**
  (no UTC); **error de red → "Reintentar"** distinguido de médico inexistente;
  **splash** en `index.html` contra pantalla blanca en el bootstrap.
  Eliminados `PaymentModal.tsx` y `utils/auth.ts` (mocks sin imports reales).
  Sin DB/SQL/migraciones/RLS; sin tocar reglas de agenda. tsc + build + OK
  visual móvil del owner; fixture de cita de prueba limpiado.

### (Histórico) Estado al cierre original de la ventana

- **HEAD:** `22bef3b` (#132/`s7_44`) + el docs-only de cierre (#133).
- **PRs:** #1–#132. **Migraciones:** hasta `s7_44`.

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
| **Diseño Paciente Global Fase 4 — merge admin** | #134 (docs-only) | DM1–DM9 cerradas. `docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md`. Alcance = fichas intra-clínica; reglas vinculantes (solo LucyAdmin, dry-run/motivo/audit, no hard-delete, unmerge formal). Ver §1 (cierres 2026-06-13). |
| **F4-1 — claim tolerante fila por fila** | #135 / `s7_45` | El claim ya no aborta completo por colisión de DUI; skips auditados; columnas pasivas `merged_into_patient_id`/`merged_at`. check 5/5 + smoke 16/16. Ver §1. |
| **Fix bug reserva móvil pública** | #136 (frontend-only) | CTA móvil pasó de scaffold mock a flujo real (`BookingCard`); fecha por defecto local; "Reintentar" en error; splash; mocks borrados. Ver §1. |
| **F4-2 — backend merge admin de fichas** | #138 / `s7_46` | `patient_merge_log` + `admin_merge_patients_preflight` (dry-run) + `admin_merge_patients` (transaccional) + bypass `app.merging_patients`. V1 = `same_profile`; neutraliza fuente sin hard-delete; bloqueos P0060–P0068. Sin UI/unmerge/identidad global. check 6/6 + smoke 19/19. Ver §1. |
| **F4-3-search — RPC de candidatos** | #140 / `s7_47` | `admin_list_patient_merge_candidates()` read-only, admin-only; lista grupos `same_profile` (E3) por `(clinic_id, profile_id)` con fichas vivas ≥2; identidad mínima + conteos + `W_UNCONFIRMED_LINK`; sin contenido clínico, sin candidatos por teléfono/nombre, sin merge. check 2/2 + smoke 10/10. Ver §1. |

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

> **Actualizado 2026-06-13.** El frente B1/F4 tiene diseño cerrado (#134),
> F4-1 (#135/`s7_45`), **F4-2 backend (#138/`s7_46`) y F4-3-search RPC de
> candidatos (#140/`s7_47`) live**; el siguiente paso del eje es la UI (F4-3).

1. **F4-3 — UI LucyAdmin `/admin/pacientes`** (siguiente frente). Frontend que
   consume **las tres RPCs ya live**: `admin_list_patient_merge_candidates`
   (descubrir grupos, `s7_47`) + `admin_merge_patients_preflight` (comparar) +
   `admin_merge_patients` (fusionar, `s7_46`) + lectura admin de
   `patient_merge_log` (historial). Búsqueda/listado de grupos candidatos,
   comparación lado a lado con metadatos de identidad, confirmación con motivo,
   historial de merges. Frontend-only. **PR separado, primero en modo análisis.**
2. **F4-3b — Bandeja de `patient_link_rejections`** (cola `pending_review` de
   B2) como tab de `/admin/pacientes`; opcional/separable si agranda F4-3.
3. **F4-D — Merge de identidades** (`profiles`/`auth.users`, escenarios
   E4/E5) — diseño propio posterior; conviene junto a recuperación sin sesión.
4. **Unmerge formal** (`admin_unmerge_patients`) — la reversa del merge; el
   `patient_merge_log` ya nace con `source_snapshot`/`moved_ids` + campos
   `unmerge_*` para soportarla. Pendiente de implementar.
5. **Limpieza controlada del teléfono `50372608827`** (registro Katherine, QA
   de `s7_42`) — SOLO cuando el owner lo indique, con **dry-run/inventario
   previo** (auth.user, profile, doctor/clinic/membership, lead, fichas,
   audit) antes de borrar nada.
6. **Katherine:** decidir conservar/corregir o limpiar ese registro. Si se
   conserva: re-guardar el nombre desde la ficha admin y **verificar que
   persista** (el intento anterior NO persistió — posible save silencioso
   fallido; si se repite, investigar como bug de la ficha).
7. **Recuperación de acceso sin sesión** — herramienta/protocolo LucyAdmin
   (D7); detrás del modelo de identidad (se diseña con F4-D).
8. **Identidad múltiple Fase 2** — selector "modo paciente/modo médico" +
   capacidades derivadas + revisar si `claim` deja de sobrescribir el rol.
9. **Paginación del Home** (hoy carga todos los médicos; importa con volumen).
10. **Normalización de teléfono literal en `accept_clinic_invitations`**
    (`+503…` ≠ `503…`; candidato a `normalize_phone_sv`; hallazgo QA #125).
11. **B2.1** — verificación reforzada de "Sí, son mías" (DOB/DUI parcial; para
    teléfonos compartidos/mal digitados).
12. **B2.2** — términos/onboarding del paciente: aceptar que solo puede
    confirmar atenciones propias (documental/legal).
13. (Post-piloto, ya previstos): pagos SaaS/IVA/DTE/Q1–Q11 (requiere
    validación owner), self-service de email, 2FA admins, owner/superadmin
    Fase 2 de admins.

> **Nota:** el hallazgo F4 (claim abortado completo por colisión de DUI) ya
> **no está activo** — `s7_45` (#135) lo mitigó: el claim ahora tolera la
> colisión fila por fila. El merge de F4-2 resolverá el duplicado de fondo.

## 6. Reglas operativas que se mantienen

- **Owner:** tareas manuales (aplicar SQL en Supabase, validaciones visuales en preview, OTP reales, decisiones comerciales/legales). **Dev:** entrega SQL completo para aplicar, corre `check-s7_NN` + `_smoke-s7_NN` tras la aplicación, verifica DB/audit, documenta.
- PRs chicos · server-side primero · smoke+check por migración · **squash-merge** · branches `claude/<8-12 chars>` · preview + OK visual antes de mergear UI · docs-only de cierre por frente.
- Tras cambios de columnas/tablas/RPC: actualizar `database.types.ts` en el mismo PR.
- Test phones: Camilo `50378627694` · admin `50378056365` · paciente `50375000001` · libre p/QA `50375000099` (todos OTP `123456`).
- No exponer contenido clínico al admin de plataforma. No secretos en repo/docs/chat.
