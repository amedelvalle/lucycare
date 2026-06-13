# HANDOFF LucyCare — Toma de decisiones 2

> Documento breve de continuidad para nuevas ventanas/contextos de
> LucyCare. Enfocado en **decisiones tomadas, estado actual, PRs
> cerrados y próximos pasos** — no reemplaza al snapshot completo
> (`docs/HANDOFF_LUCYCARE_SPRINT7.md`) ni a los análisis vivos
> (`docs/ANALISIS_*.md`).
>
> **Snapshot 2026-06-07** (ejes recién cerrados: **(1) Correcciones post-firma COMPLETO** — 5 bloques clínicos, PRs #74–#85, `s7_28..s7_31`; **(2) Paciente Global Fases 1–3 COMPLETAS** — identidad global (#87/`s7_32`) + UI `/paciente/perfil` (#88) + sync espejo + guard (#90/`s7_33`) + UI médico read-only (#91); **(3) Cambio de teléfono por OTP COMPLETO** — trigger de sync (#93/`s7_34`) + UI paciente (#94) + UI médico (#95); **(4) Paciente Global Fase 5 — dedup preventivo COMPLETO** (#98/#99/`s7_35`/#100); **(5) Mi equipo Fase 2 — ciclo de vida de invitación COMPLETO** (#102/`s7_36` + #103); **(6) Catálogos personalizados por médico — EJE 100% COMPLETO** — global+personal, snapshot histórico, ocultar/clonar, base replicada migrada (#105–#111, `s7_37`/`s7_38`/`s7_39`) + **UI de LucyAdmin para administrar la Base Lucy global (#114, UI-only, sin migración)**; **(7) Pendiente acotado — robustez PanelLayout/useClinicContext CERRADO (#116)**: `getSession()` en vez de `getUser()` (quita el race de primera carga) + timeout 8s/`.catch()`/estado recuperable (sin spinner infinito) + errores tipados con copy específico para estructurales; **(8) Pendiente acotado — RPC F5 tolerante a teléfono crudo CERRADO (#118/`s7_40`)**: helper `normalize_phone_sv` (espejo de `normalizePhoneSV`, `IMMUTABLE`, sin EXECUTE anon/authenticated) + `find_patient_match_candidates` canonicaliza el teléfono en ambos lados (defensa en profundidad; firma/salida idénticas; cross sin PII; smoke 11/11); **(9) Pendiente acotado — Lista de espera global cross-médicos CERRADO (#120/`s7_41`)**: página `/admin/lista-espera` + RPC `admin_list_waitlist` (`SECURITY DEFINER`, `is_admin()`) con join médico/perfil/especialidad/clínica + filtros (estado/médico/especialidad/búsqueda/fecha) + paginación + `total_count`; reutiliza `admin_update_waitlist_entry`; smoke 10/10; **(10) Afiliación — médico desde paciente existente CERRADO (#122/`s7_42`)**: `admin_approve_and_create_doctor` ya no crashea con `users_phone_key`; clasifica (`_affiliation_classify` + `admin_affiliation_preflight`) y ramifica new/reuse_patient/block (P0010–P0013); reuse sin nuevo `auth.user`, fill `full_name` si vacío, **sin tocar phone/email/role** (no copia email del lead); UI con banner+confirmación+link; smoke 12/12; **(11) Identidad múltiple — análisis (#124) + Fase 1 (#125) CERRADOS**: modelo "identidad única + capacidades múltiples" firmado (5 decisiones aprobadas, `docs/ANALISIS_ONBOARDING_IDENTIDAD_MULTIPLE.md`); Fase 1 frontend-only: `PatientOnlyRoute` permite patient/doctor/assistant (excluye admin/anon) → médico/asistente acceden a su lado paciente con menú/"Ir al panel"/nota azul; + 2 fixes destapados: `useDashboard` vía `useClinicContext` (home del panel reventaba para asistentes, bug pre-existente) y `listMyAppointments` con filtro explícito por persona (médico/asistente veían las citas de su clínica como propias). Previo: Afiliación Fase 2 + smoke ✅; análisis pagos SaaS PR #62; ubicación estructurada admin PR #64/`s7_25` ✅ live).
>
> Objetivo: permitir retomar el proyecto sin reanalizar decisiones ya
> tomadas.

---

## 1. Estado actual consolidado

- **PR #43** ✅ mergeado — lista de espera real + badge admin (`s7_18`, `s7_19`).
- **PR #44** ✅ mergeado — Paciente Global Fase 1 (`s7_20`).
- **PR #45** ✅ mergeado — refresh docs post-PR #44.
- **PR #46** ✅ mergeado — SMTP externo Resend + Supabase Auth SMTP custom validado end-to-end.
- **PR #47** ✅ mergeado — refresh documental post-Resend (incluye este archivo).
- **PR #48** ✅ mergeado — dominio público `lucycare.app` live en Vercel + Cloudflare DNS + Supabase Site URL + reset email validado end-to-end.
- **PR #49** ✅ mergeado — refresh documental post-#48 (CLAUDE.md / HANDOFFs / FASE_4_AUTH / SETUP_SMTP_RESEND / PLAN_PILOTO actualizados a `lucycare.app` con `vercel.app` como fallback).
- **PR #50** ✅ mergeado — Fase 4 PR-B: password en flujo de Reclamar perfil. Step obligatorio post-claim con dos caminos (crear ahora / recibir link por email). Sin migración. Incluye fix de copy "Perfil reclamado" diferenciado de "Cuenta suspendida" en `PanelLayout` + guard contra flash al cargar el contexto.
- **PR #51** ✅ mergeado — refresh documental post-#50.
- **PR #52** ✅ mergeado — análisis del flujo "Solicitar afiliación". 10 secciones, hallazgo R8 documentado (auto-registro inseguro en home).
- **PR #53** ✅ mergeado — mitigación inmediata del hallazgo R8. Sin persistencia en DB.
- **PR #54** ✅ mergeado — refresh documental post-#53 (Hallazgo #7 cerrado en Security Gate).
- **PR #55** ✅ mergeado — plan operativo `docs/PLAN_AFILIACION_MEDICO.md` (Fase 1 + Fase 2).
- **PR #56** ✅ mergeado — **Afiliación Fase 1** (`s7_21`). Tabla `doctor_affiliation_requests` + RPCs anon/admin + bandeja admin con triage. Validación de Lectura A (mínimo name+phone+LOPD). Smoke completo OK. No crea doctor/profile/clinic.
- **PR #57** ✅ mergeado — refresh documental post-#56.
- **PR #58** ✅ mergeado — **Afiliación Fase 2** (`s7_22` + `s7_23`). RPC `admin_approve_and_create_doctor` que en una transacción crea auth.users dormant + profile (UPSERT defensivo) + clinic + clinic_member + doctor en `listed_only`. Email override aceptado solo si lead no trajo email (regla server-side). UI: botón "Crear médico" + form overrides + checkbox confirm + pantalla éxito con link a ficha admin (no perfil público — doctor sigue no publicado). Badge "Datos por completar" → "Médico creado" cuando hay doctor_id. Smoke OK hasta ficha admin; claim end-to-end del médico creado pendiente de smoke operativo con test phone real del médico.
- **PR #59** ✅ mergeado — refresh documental post-#58 (CLAUDE.md + HANDOFFs a PRs #1–#58 / migraciones s7_23).

> ⚠ **Punto de entrada actualizado:** para retomar en una ventana nueva, leer
> PRIMERO `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-06-11.md` (estado final,
> frentes cerrados, decisiones vigentes, pendientes vivos). Este archivo sigue
> siendo el registro acumulado de decisiones.

`main` HEAD esperado: `43bd0e9` o posterior (+ el PR documental de refresh 2026-06-13), **PRs #1–#136 mergeados**. Migraciones hasta `s7_45` (aplicadas en Supabase; **#118 = `s7_40`**, **#120 = `s7_41`**, **#122 = `s7_42`**, **#128 = `s7_43`**, **#132 = `s7_44`**, **#135 = `s7_45`**). **Cierres recientes (2026-06-13):** **(#134)** diseño Paciente Global Fase 4 / merge admin de fichas — **DM1–DM9 cerradas** (`docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md`); alcance = fichas `patients` intra-clínica (no identidades/`profiles`/`auth.users`, no expedientes cross-clínica); reglas vinculantes (solo LucyAdmin, dry-run + motivo + audit, no hard-delete, unmerge formal previsto); fases F4-1→F4-2→F4-3 (+F4-3b, +F4-D). **(#135 / `s7_45`)** F4-1 claim tolerante fila por fila: `claim_patient_records()` procesa fichas fila por fila (subtransacción por ficha) → una colisión `UNIQUE(clinic,doc)` ya no aborta el claim completo (cierra el hallazgo F4); fichas válidas se vinculan, la conflictiva queda intacta; skips auditados (`claim_skipped_*` + resumen); cliente solo conteos; columnas pasivas `merged_into_patient_id`/`merged_at` (infra F4-2, el claim las excluye); **sin merge, sin tocar identidad global ni `auth.users`, sin hard-delete**; check 5/5 + smoke 16/16. **(#136)** fix bug público de reserva móvil (frontend-only): CTA móvil pasó de scaffold mock (horarios de cliente, servicios inventados, `PaymentModal` falso sin crear cita) a flujo real (`BookingCard`: servicios/slots reales, `createBooking`, OTP); fecha por defecto local (no UTC); error de red con "Reintentar"; splash inicial; eliminados `PaymentModal.tsx` + `utils/auth.ts`; fixture de cita de prueba limpiado. **Administración de LucyAdmins Fase 1 (#131 análisis + #132/`s7_44` implementación):** ciclo de vida sin SQL manual — invitación (cuenta dedicada, P0050–P0055), activación al primer OTP (pending sin privilegios; fill `full_name`), revocación (bloqueo inmediato vía `is_admin()`, guard último admin P0052), `/admin/administradores` (+ "Editar nombre" propio), cuenta-cáscara por invitación vencida re-invitable / bloqueada si se volvió paciente real; `profiles.role='admin'` sigue siendo el único bit y `is_admin()` quedó intacta; smoke 24/24. **Navegación móvil LucyAdmin (#130):** header + hamburguesa + drawer en `AdminLayout` (antes sin nav alguna bajo 768px); desktop intacto. **Identidad múltiple: análisis #124 (modelo aprobado) + Fase 1 #125 (frontend-only: lado paciente abierto a doctor/assistant + fix useDashboard + fix filtro Mis atenciones).** **Ownership del paciente: análisis #127 (D1–D7 aprobadas; regla central "el médico gestiona una relación clínica local; Lucy gobierna la identidad global") + B2 confirmación post-claim #128/`s7_43` (sección "por confirmar" separada de Mis atenciones; confirm/reject por ficha; rechazo persistente `pending_review`; el claim no re-vincula pares rechazados; smoke 14/14).** **Robustez PanelLayout/useClinicContext (#116):** `getSession()` (no `getUser()`) + timeout/`.catch()`/estado recuperable + errores tipados. **RPC F5 tolerante a teléfono crudo (#118/`s7_40`):** helper `normalize_phone_sv` + canonicalización en ambos lados; sin frontend. **Lista de espera global cross-médicos (#120/`s7_41`):** `/admin/lista-espera` + RPC `admin_list_waitlist` (join + filtros + paginación + `total_count`). **Afiliación — médico desde paciente existente (#122/`s7_42`):** `_affiliation_classify` + `admin_affiliation_preflight` + `admin_approve_and_create_doctor` reescrita (new/reuse_patient/block; reuse sin nuevo auth.user, fill full_name si vacío, sin tocar phone/email/role; P0010–P0013). Correcciones: #74–#85 (`s7_28..s7_31`). Paciente Global F2 #87 (`s7_32`) + #88, F3 #90 (`s7_33`) + #91. **Cambio de teléfono por OTP: #93 (`s7_34`) trigger de sync + #94 UI paciente + #95 UI médico (`ChangePhoneModal`).** **Paciente Global F5 (dedup preventivo): #98 diseño + #99 (`s7_35`) RPC `find_patient_match_candidates` + #100 UI `PatientMatchHints`.** **Mi equipo F2 (ciclo de vida de invitación): #102 (`s7_36`) backend + #103 UI `EquipoPage`.** **Catálogos personalizados COMPLETO: #105 diseño + #106 (`s7_37`) snapshot + #107 (`s7_38`) global+personal/RLS + #108 UI consulta + #109 UI admin + #110/#111 (`s7_39`) infra + migración de datos aplicada (Base Lucy 127/736, "Míos" solo lo propio, 11218 filas en `catalog_migration_map`).**

**Correcciones post-firma — EJE COMPLETO (backend + UI), 5 bloques clínicos (PRs #74, #76, #79, #80, #81, #82, #84, #85):**
- **A (PR #74, `s7_28`):** sin edición silenciosa por API. Firma vía RPC `sign_consultation()` + RLS endurecida (`signed_at IS NULL`). Sync cita→atendida y borradores sin regresión.
- **B1 (PR #76, `s7_29`):** corrección controlada vía RPC `amend_consultation()` (definer + bypass `app.amending`). `consultation_amendments` append-only + **motivo obligatorio** + **snapshots before/after** + **versionado de recetas** (anterior `is_current=false` histórica + **v2** vigente) + **solo médico dueño** + **campos prohibidos rechazados (P0013)** + audit. UPDATE directo de firmada sigue bloqueado; asistente bloqueado.
- **Impresión (PRs #79/#80/#81, `s7_30`):** lecturas/impresión filtran `is_current=true` (no duplican v1+v2, #79); banner "RECETA CORREGIDA · fecha" + "Corrección vN" por medicamento (#80); columna `affects_prescriptions` (#81/`s7_30`) → la marca se dispara **solo** si la corrección tocó receta, no por texto.
- **UI texto + receta (PR #82):** modal "Corregir consulta firmada" con secciones **Texto** + **Receta**, **un motivo obligatorio**, **una llamada atómica** a `amend_consultation`, confirmación reforzada para receta, historial de adendas.
- **B1.5-a backend (PR #84, `s7_31`):** `amend_consultation` extendida con `p_diagnosis_ops` / `p_family_history_ops` / `p_vitals_changes` (corrección **in-place** de diagnósticos/antecedentes/vitales, trazada por el snapshot que ya los captura) + **cierre del hueco de inmutabilidad de `vitals`** (RLS rechaza editar vitales de cita con consulta firmada). `affects_prescriptions` sigue dependiendo solo de receta → corregir estos bloques no marca "RECETA CORREGIDA". **Smoke OTP 11/11** (sesión de médico real, fixtures aisladas + cleanup).
- **B1.5-b UI (PR #85):** modal en **accordion** con las 5 secciones (texto, vitales, antecedentes, diagnósticos, receta), badges "modificado", **"Cambiar diagnóstico"**, IMC en vivo, **resumen unificado** de cambios (reemplaza el reforzado solo-receta; la advertencia "RECETA CORREGIDA" solo si cambia receta). Incluye **fix del dropdown del `Combobox`** (portal `fixed`, ya no lo recorta el modal/accordion — beneficia los 4 usos) e **impresión de receta en 2 columnas** para 3+ medicamentos (A4 vertical, sin 2ª página innecesaria). Validado visualmente por el owner.
- **Bugs corregidos en el camino (B1):** bypass del guard `prevent_signed_consultation_edit` vía GUC `app.amending`; cast del enum `duration_unit` en el versionado; `corrected_by = auth.uid()`.
- ✅ **Eje CERRADO** — backend + UI para los 5 bloques. No quedan pendientes del eje.

**Mi equipo Fase 1 (PR #70, `s7_27`) — activo:** límite base 1 titular + **2 asistentes** (`team_seat_limit()`=2 fijo). Conteo = activos + invitaciones pendientes. Enforcement **server-side validado**: trigger BEFORE INSERT en `clinic_invitations` (P0001) + revalidación en `accept_clinic_invitations`. UI con contador `n/2`. El smoke corrigió un **bug pre-existente** del accept (cast `clinic_member_role::user_role` → `::text::user_role`; nunca había funcionado por falta de asistentes). **Usuarios adicionales → fase de pagos/add-ons** (`team_seat_limit()` engancha con `subscriptions`).

**Gate clínico del asistente (PR #67, `s7_26`) — cerrado:** el diagnóstico RLS mostró que la "deuda #1" estaba mal redactada — consultas/recetas/diagnósticos/**firma** ya estaban bloqueados para asistentes (`get_user_doctor_id()`=NULL). La fuga real era `consultation_family_history` + `vitals` (usaban `is_clinic_member`); `s7_26` las dejó doctor-scoped. Validado con smoke empírico. **Follow-up separado:** inmutabilidad RLS de consultas firmadas (no es del asistente).

## 2. Infraestructura actual

| Capa | Proveedor | Estado |
|---|---|---|
| Repositorio y PRs | GitHub (`github.com/amedelvalle/lucycare`) | ✅ activo, repo público |
| Deploy producción | Vercel (auto-deploy desde `main`) | ✅ **`https://lucycare.app`** (apex) + `www.lucycare.app` (redirect 308 a apex) |
| Previews por PR | Vercel | ✅ `lucycare-git-*.vercel.app` siguen vigentes |
| URL fallback temporal | Vercel (`lucycare.vercel.app`) | ✅ activo — **no desactivar** (links viejos en circulación + rollback) |
| DB / Auth / RLS / RPCs / Storage | Supabase | ✅ activo. Auth Site URL = `https://lucycare.app` |
| Auth SMTP transaccional | Supabase Auth → SMTP custom → Resend | ✅ activo desde 2026-05-26 |
| Dominio | `lucycare.app` | ✅ comprado en Cloudflare, DNS gestionado en Cloudflare |
| DNS web (apex + www) | Cloudflare | ✅ CNAME `@` → `…vercel-dns-017.com`, CNAME `www` → `cname.vercel-dns.com`, ambos DNS only |
| DNS email (SPF / DKIM / DMARC) | Cloudflare | ✅ configurado para Resend, **no tocar** |
| Envío de correos transaccionales | Resend (dominio `lucycare.app`) | ✅ verificado + smoke OK |

**Notas:**

- **Dominio público principal:** `https://lucycare.app`. `www.lucycare.app` redirige 308 a apex.
- **`lucycare.vercel.app` queda como fallback temporal**, no se desactiva. Sirve para reset links viejos aún válidos + rollback rápido.
- **Previews de Vercel** (`lucycare-git-*.vercel.app`) siguen vigentes para PRs.
- Resend usa el dominio `lucycare.app` para el sender; ese setup es **independiente** del dominio público web. Los registros DNS de email (`resend._domainkey`, `send` MX/TXT, `_dmarc`) son distintos de los registros web y no se deben tocar.

## 3. Decisiones cerradas recientes (no reabrir)

### Paciente Global Fase 1 (PR #44)

- Vinculación retroactiva automática **solo con phone OTP-verified** (DA2).
- Identidad global vive en `profiles` extendido (DA1). `patients` sigue como ficha por clínica.
- Walk-in editable libremente hasta que el paciente reclame (DA3).
- "Mis atenciones" muestra clínica (DA4) y **solo datos operativos**, sin contenido clínico profundo.
- Header del paciente con dropdown "Mi cuenta" (`PatientAccountMenu` + `PatientHeader`).

### Lista de espera (PR #43)

- Tabla `waitlist_entries` con `UNIQUE (doctor_id, phone_normalized)` — idempotente.
- Badge "Lista de espera: N" en admin sobre `/admin/medicos`.
- Notificación al activar `booking_enabled` queda **manual** desde admin (sin SMS auto, sin Edge Function por ahora).

### SMTP externo / Resend (PR #46)

- Proveedor: **Resend** con dominio `lucycare.app`.
- API key creada con permisos **`Sending access`** (no full access). Vive en Supabase Dashboard + password manager del owner — **no** en el repo.
- DNS de email en Cloudflare (SPF + DKIM + DMARC).
- Smoke real validado el 2026-05-26: reset email recibido desde `LucyCare`, link abrió `/reset-password`, cambio de contraseña OK, login con contraseña nueva OK.
- Hallazgo #6 del Security Gate cerrado.

### Afiliación de médicos nuevos (PRs #52 + #53 + #55 + #56)

- **Regla cerrada (no reabrir):** ningún flujo público debe crear médicos `claimed` automáticamente. La identidad del médico se valida por LucyAdmin antes de existir en `doctors`.
- **Decisiones Q1-Q10 cerradas** (PR #55, plan operativo). Lectura A confirmada: mínimo absoluto del form = name + phone + LOPD; license/email/especialidad son recomendados pero no bloqueantes; lead sin esos campos entra con `incomplete=true`.
- **Fase 1 ✅ live (PR #56):** `AffiliationRequestModal` en home reemplaza al `DoctorInterestModal` legacy. Persiste leads en `doctor_affiliation_requests` (`s7_21`) con RLS estricto, UNIQUE phone activo, rate limit 1/IP/24h. Bandeja `/admin/afiliaciones` con triage (in_review / approved / rejected). Página `/privacidad` MVP. Sin auto-creación de doctores.
- **Fase 2 ✅ live (PR #58):** RPC `admin_approve_and_create_doctor(p_request_id, p_overrides)` en `s7_22` + `s7_23`. Crea en una transacción: auth.users dormant (sin password, sin confirmar) + profile (UPSERT defensivo coexiste con trigger `handle_new_user`) + clinic + clinic_member (owner) + doctor en `lucy_status='listed_only'` con todos los flags conservadores en false. Email override solo si lead no trajo email. UI: botón "Crear médico" en `AdminAffiliationDetailModal` con form overrides + checkbox de confirmación obligatorio + pantalla éxito con `doctor_id` y link a ficha admin. Smoke OK hasta ficha admin.
- **Archivos legacy:** `DoctorRegistrationModal`, `registerDoctor` service y `DoctorInterestModal` quedan `@deprecated`. **Prohibido importarlos desde código nuevo.**
- **Fix post-smoke (PR #61 + `s7_24`):** el smoke end-to-end (2026-05-30) reveló que la RPC dejaba el profile `role='doctor'` pre-claim → el médico entraba al panel antes de reclamar. Corregido: profile queda `role='patient'` pre-claim y `claim_doctor_profile` lo sube a `'doctor'`. Mismo PR: nombre de clínica sin doble "Dr.", precarga Depto/Municipio en el modal admin, y retry en `PanelLayout`. **Claim end-to-end ✅ validado** (ver §5.1).
- **Pendientes legal/diseño** (post-piloto, `docs/PLAN_AFILIACION_MEDICO.md §11.bis`): DUI/documento del médico, aceptación formal de TOS médico pre-verificación, verificación cruzada con fuente oficial (JVPM).

### Auth Fase 4 PR-B — password en Reclamar perfil (PR #50)

- Step obligatorio "Contraseña" tras un claim exitoso. Sin botón "Lo hago después", sin X visible durante el step, sin Esc, sin click-outside-closes.
- Dos opciones:
  - **Primaria:** "Crear contraseña ahora" → `PUT /auth/v1/user` con fetch directo (no usa wrapper de supabase-js para evitar hang). Timeout 8s, errores mapeados (401 sesión expiró, 422 password débil, etc.).
  - **Secundaria:** "Recibir link por email" → muestra el email del profile, fallback amber si no hay. Usa `requestPasswordReset`.
- Banner success diferenciado por outcome (emerald `password_set` / blue `email_sent`).
- Copy de PanelLayout diferencia "Perfil reclamado" (listed_only/claimed + !is_operational) de "Cuenta suspendida" (booking_enabled/verified + !is_operational).
- Guard contra flash del panel al hacer login post-claim (espera tanto `user` como `ctx` antes de renderizar).
- Sin migración. Sin tocar templates de email, paciente, lista de espera ni dominio.

### Reglas operativas que se mantienen

- **No guardar secretos** (API keys, SMTP password, service_role, credenciales de Vercel/Cloudflare/Resend/Supabase) en repo, docs, commits, ni chat.
- **No desactivar `lucycare.vercel.app`** — queda como fallback temporal hasta que se decida quitarlo en una limpieza diferida (ver `docs/SETUP_VERCEL_DOMAIN.md` §5.6).
- **Squash-merge** para integrar branches `claude/*`. Tras el merge, la rama puede borrarse.

## 4. Seguridad

- `service_role` rotado en PR #36 e invalidado el JWT legacy. Scripts admin leen `.env.local`.
- RLS endurecido en `profiles` (PR #37) — anon solo ve `(id, full_name, avatar_url)` de médicos publicados.
- `audit_log` con coverage amplio (claim, avatar, admin edits, reviews, waitlist, paciente global).
- Modales sensibles (LoginModal, ClaimProfileModal) no cierran al click outside.
- SMTP builtin de Supabase y su rate limit de ~4 emails/h **ya no son cuello de botella** — Resend está activo.
- Secrets viven en dashboards (Supabase, Resend, Cloudflare, Vercel) y en password manager del owner. No en GitHub.

**Pendiente conocido:** rate limit fuerte para flujos públicos (Cloudflare WAF o counter por IP en RPCs sensibles tipo `claim_doctor_profile`, `waitlist`). No bloqueante para piloto chico.

## 5. Pendientes inmediatos

### 5.1 SMOKE END-TO-END DE AFILIACIÓN — ✅ COMPLETADO (2026-05-30)

Validado el claim end-to-end del médico creado vía Fase 2 con test phone médico real (`50375000099` / OTP `123456`). Resultado en DB tras el claim: `lucy_status` pasó `listed_only` → `claimed`, `profile.role` `patient` → `doctor`, `tos_accepted_at` seteado, `audit_log` con `edited_via='claim_self_service'`, y siguió sin `verified` / `is_operational` / `booking_enabled`. Password creada (confirmación visual del modal). Artefactos limpiados de la DB.

**El smoke detectó 4 bugs en Fase 2 → corregidos en PR #61 + migración `s7_24`:**
1. **Raíz:** la RPC dejaba el profile con `role='doctor'` pre-claim → el médico entraba al panel y veía "Perfil reclamado" sin haber reclamado. **Fix:** profile queda `role='patient'` pre-claim; `claim_doctor_profile` lo sube a `'doctor'` al reclamar.
2. Nombre de clínica con doble "Dr." → fix en fallback.
3. Modal admin "Crear médico" no precargaba Depto/Municipio (la persistencia ya andaba; faltaba que `admin_list_affiliation_requests` devolviera los IDs) → fix `s7_24` + frontend.
4. `PanelLayout` dejaba spinner colgado si `useClinicContext` falla → ahora muestra "Reintentar".

**Aprendizajes operativos (conservar):**
- **NO hacer OTP con el teléfono del médico ANTES de que admin cree el doctor** (Supabase crearía un `auth.user` paciente que choca con el `UNIQUE` de phone en la RPC).
- **"Perfil reclamado" en el panel NO prueba el claim** — la prueba es `lucy_status='claimed'` en DB.
- **`auth.admin.listUsers()` pagina mal** (bug GoTrue, fila corrupta en pág. 2). Para buscar/limpiar por phone, derivar el `auth.user.id` desde `profiles.id` (id compartido) y usar `getUserById`/`deleteUser`.

**Estado:** PR #61 (fix + `s7_24`) ✅ mergeado, `s7_24` aplicada. Todos los PRs de la ventana (#60–#64) mergeados; HEAD `ed5721f`.

### 5.2 Limpiezas operativas diferidas (no bloqueantes)

- **`lucycare.vercel.app` como fallback:** mantenerlo activo al menos hasta que se haya rotado todo el ciclo de reset links viejos. En algún momento opcional, configurarlo como redirect 301 a `lucycare.app` desde Vercel — ver `docs/SETUP_VERCEL_DOMAIN.md` §5.6.
- **Redirect URLs en Supabase:** quitar `https://lucycare.vercel.app/**` cuando no haya links viejos circulando. No urgente.
- **Cleanup test patients Fase 1:** `node scripts/setup-test-patient.mjs --clean` cuando termine la validación.
- **Smoke 7.3 opcional (SMTP):** 5 resets seguidos para confirmar que el rate limit builtin ya no aplica.

## 6. Backlog posterior

### 6.1 Pendientes prioritarios a conservar (revisar tras el smoke de afiliación)
- **Paciente Global / DUI:** DUI obligatorio o progresivo + identidad única del paciente (`docs/ANALISIS_PACIENTE_GLOBAL.md` Fase 2+).
- ~~**Ubicación estructurada Departamento/Municipio** en admin médico~~ → ✅ **hecho** (PR #64, `s7_25`): ficha admin edita Depto/Municipio con listas del Home, guarda IDs en `clinics`, obligatorios para publicados/operativos (P0004). Los 5 publicados ya cargados.
- ~~**Filtro "Ordenar por" del Home NO funciona**~~ → ✅ **hecho** (PR #63): se quitó la opción muerta "Más cercanos"; quedan "Disponibilidad/Mejor coincidencia" y "Mejor valorados". Geo real (lat/lng + ubicación del usuario) queda como backlog futuro.
- **Paginación / carga dinámica del Home** cuando haya muchos médicos (hoy carga todos).
- ~~**Mi equipo / invitados del médico** — máximo 2 asistentes~~ → ✅ **hecho (PR #70, `s7_27`)**: límite base 2 activo (server-side). Fase 2 (expiración/reenvío) + add-on de adicionales (pagos) siguen en cola.
- **Catálogos personalizados por médico** para diagnósticos y medicamentos.
- **Flujo legal/comercial de DUI médico, términos y aceptación formal** pre-verificación (`docs/PLAN_AFILIACION_MEDICO.md §11.bis`).
- **Manejo de email en afiliación/onboarding médico** (override ya existe en Fase 2; falta self-service de cambio post-reclamo).
- ~~**Error handling en PanelLayout / useClinicContext**~~ → ✅ **cerrado (PR #116).** Causa raíz = race de sesión (`getUser()` de red vs token hidratándose); ahora `useClinicContext` lee con `getSession()`. `PanelLayout` ya no queda en spinner permanente (timeout 8s + `.catch()` + estado recuperable). Errores tipados (`auth`/`no_clinic`/`no_doctor`/`role`/`unknown`): transitorios → Reintentar; estructurales → copy específico + Cerrar sesión, sin mensaje engañoso de conexión. Frontend-only.

### 6.2 Otros backlog
- ~~Vista global `/admin/lista-espera` cross-médicos con filtros.~~ ✅ hecho (#120/`s7_41`): RPC `admin_list_waitlist` + página `/admin/lista-espera` (filtros estado/médico/especialidad/búsqueda/fecha + paginación + `total_count`). Smoke 10/10.
- ~~**Afiliación médica — soportar creación de médico `listed_only` cuando el teléfono ya pertenece a un paciente existente.**~~ → ✅ **HECHO (#122/`s7_42`).** `admin_approve_and_create_doctor` ya no crashea con `users_phone_key`: helper `_affiliation_classify` (usa `normalize_phone_sv`) + RPC lectura `admin_affiliation_preflight` + create reescrita (firma idéntica) que re-clasifica en la transacción. Casos: **`new`** crea auth.user dormant; **`reuse_patient`** reusa el profile del paciente (sin nuevo auth.user, `full_name` solo si vacío, **sin tocar phone/email/role**, solo con `confirm_reuse` → si no, `P0013`); **bloqueos** `P0010` (médico existente, con link), `P0011` (rol sensible/membresía o `auth.user` sin profile), `P0012` (identidad ambigua por email). UI: banner por clasificación + confirmación + link. Audit `reused_existing_user`. **Decisión cerrada: en reuse NO se copia el email del lead** (credencial sensible; se completa/valida en el reclamo, que sigue exigiendo OTP+licencia/JVPM+TOS). El médico nace `listed_only`/no publicado/no operativo/no verified. smoke 12/12. Aprendizaje: registros creados ANTES del fix sobre un paciente sin nombre quedan "(sin nombre)" → corrección puntual desde la ficha admin (caso Katherine).
- Sección "Lista de espera" en panel del médico (RLS ya permite, falta UI).
- Perfil paciente extendido — Paciente Global Fase 2 (DUI, DOB, género, dpto, muni).
- ~~Read-only datos personales para médico cuando el paciente reclamó — Paciente Global Fase 3.~~ ✅ hecho (#90/`s7_33` + #91).
- Merge admin de duplicados — Paciente Global Fase 4.
- ~~Dedup preventivo cross-clinic al crear paciente desde walk-in — Paciente Global Fase 5.~~ ✅ hecho (#98/#99/#100, `s7_35`).
- Templates de email en español (Confirmation, Magic Link además del Reset ya hecho).
- SMS automático al invitar asistente (S5-08).
- Admin SaaS restantes: B4 (disponibilidad desde admin), C (suspender pacientes/asistentes), D (dashboard tracción), E (moderar reseñas), F (explorador audit_log), G (catálogos globales).
- Notificación automática al activar `booking_enabled` (Edge Function + Twilio).

## 7. Reglas para próximas ventanas

1. **Sincronizar `main` antes de tocar nada** (`git fetch && git checkout main && git pull --ff-only`) y mirar `git log --oneline -10`.
2. **No codificar antes** de confirmar el estado de `main` y los PRs abiertos.
3. **No mezclar** configuración de dominio Vercel con Fase 4 PR-B (son PRs distintos).
4. **No tocar los registros DNS de email** de Resend al configurar el dominio web — son registros separados, viven en la misma zona pero distintos hostnames (`resend._domainkey`, `send` MX/TXT, `_dmarc`).
5. **No incluir secretos** en código, docs, commits ni descripción de PRs.
6. **PRs pequeños y testeables**, branches con nombre corto (`claude/<8-12 chars>`) para que Vercel no las trunque.
7. Si un docs afirma un estado ("ya configurado", "live", "verificado"), confirmar contra el dashboard real antes de mergear.

---

## 8. Referencias

- `CLAUDE.md` — guía rápida + sistema de diseño + tablero de decisiones.
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — snapshot completo de Sprint 7 + pre-piloto.
- `docs/SETUP_SMTP_RESEND.md` — guía operativa + checklist Resend (✅ live).
- `docs/FASE_4_AUTH_EMAIL.md` — guía Supabase URL/email config.
- `docs/SECURITY_GATE_PILOTO.md` — auditoría pre-piloto (Hallazgo #6 cerrado en PR #46).
- `docs/ANALISIS_AUTH_MEDICO.md` — plan Fase 4 PR-B (próximo después del dominio).
- `docs/ANALISIS_PACIENTE_GLOBAL.md` — modelo de paciente global.
- `docs/ANALISIS_DIRECTORIO_INFORMATIVO.md` — modelo comercial directorio.
- `docs/ANALISIS_RECLAMAR_PERFIL.md` — diseño del reclamo.
- `docs/ANALISIS_AFILIACION_MEDICO.md` — análisis del flujo "Solicitar afiliación" (Q1-Q10 cerradas).
- `docs/PLAN_AFILIACION_MEDICO.md` — plan operativo Fase 1 + Fase 2 + §11.bis pendientes legales/diseño.
- `docs/CUENTA_DEMO_CAMILO.md` — cuenta demo oficial.

---

## INSTRUCCIÓN PARA NUEVA VENTANA DE CONTEXTO

> Handoff de cierre 2026-06-03. Esta sección es el **punto de entrada**
> para retomar LucyCare en una conversación nueva sin reconstruir contexto.

### Leer primero (en este orden)
1. `CLAUDE.md`
2. `docs/HANDOFF_LUCYCARE_SPRINT7.md`
3. `docs/HANDOFF_TOMA_DECISIONES_2.md`
4. `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md`
5. `docs/ANALISIS_MI_EQUIPO_INVITADOS.md`
6. `docs/ANALISIS_CORRECCIONES_CONSULTA_FIRMADA.md`
7. `docs/PLAN_CORRECCIONES_FASE0.md`
8. `docs/ANALISIS_PACIENTE_GLOBAL.md`

### Próximo arranque recomendado (nueva ventana)
1. **Sincronizar repo:** `git fetch origin && git checkout main && git pull --ff-only`.
2. **Confirmar HEAD final:** `43bd0e9` o posterior (+ el PR documental de refresh 2026-06-13). **Leer primero `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-06-11.md`.**
3. **Confirmar PRs mergeados hasta #136** (+ el PR documental de refresh).
4. **Confirmar migraciones hasta `s7_45`** (aplicadas en Supabase). **#118 = `s7_40`**; **#120 = `s7_41`**; **#122 = `s7_42`** (re-aplicada completa tras 2 ajustes); **#128 = `s7_43`**; **#132 = `s7_44`**; **#135 = `s7_45`** (F4-1 claim tolerante: columnas pasivas `merged_into_patient_id`/`merged_at` + claim fila por fila).
5. **Confirmar frentes cerrados:**
   - ✅ **Correcciones post-firma** COMPLETO (texto, receta, diagnósticos, antecedentes, vitales).
   - ✅ **Paciente Global Fases 1–3** COMPLETO (identidad global, perfil paciente, sync espejo + read-only del médico).
   - ✅ **Cambio de teléfono por OTP** COMPLETO (backend `s7_34` + UI paciente + UI médico).
   - ✅ **Paciente Global Fase 5 (dedup preventivo)** COMPLETO (diseño #98 + backend `s7_35` #99 + UI #100).
   - ✅ **Mi equipo Fase 2 (ciclo de vida de invitación)** COMPLETO (backend `s7_36` #102 + UI #103).
   - ✅ **Catálogos personalizados por médico — EJE 100% COMPLETO** (global+personal, snapshot histórico, ocultar/clonar, base replicada migrada — #105–#111, `s7_37`/`s7_38`/`s7_39`; **+ UI de LucyAdmin para administrar Base Lucy global #114, UI-only**).
   - ✅ **Pendiente acotado — robustez PanelLayout/useClinicContext** CERRADO (#116, frontend-only): `getSession()` (no `getUser()`) quita el race de primera carga; timeout 8s + `.catch()` + estado recuperable (sin spinner infinito); errores tipados (`auth`/`no_clinic`/`no_doctor`/`role`/`unknown`) con copy específico para estructurales.
   - ✅ **Pendiente acotado — RPC F5 tolerante a teléfono crudo** CERRADO (#118/`s7_40`, backend-only): helper `normalize_phone_sv` (espejo de `normalizePhoneSV`, `IMMUTABLE`, sin EXECUTE anon/authenticated) + `find_patient_match_candidates` canonicaliza el teléfono en ambos lados; firma/salida idénticas; cross sin PII; smoke 11/11.
6. **Árbol limpio · build OK · `tsc --noEmit` OK.**
7. **Siguiente frente: elegir uno del backlog** (ya NO hay frente recomendado pre-cargado — LucyAdmin Base Lucy cerrado en #114, robustez del panel en #116, RPC F5 tolerante en #118). Ver "Próximos frentes" abajo. **No codificar hasta confirmar el frente y el estado.**

### Estado consolidado al cierre (qué está ✅ y qué ⏳)
- **Infra:** dominio principal `https://lucycare.app`; `lucycare.vercel.app` = fallback temporal (no desactivar). SMTP Resend live.
- **Afiliación médica ✅ end-to-end:** Fase 1 (solicitud pública + bandeja admin) + Fase 2 (LucyAdmin convierte lead aprobado en médico `listed_only`) + smoke (lead→médico→claim→`claimed`). **Decisión cerrada (no reabrir):** el médico creado por afiliación nace `profile.role='patient'` pre-claim y se promueve a `doctor` solo al reclamar.
- **Home/directorio ✅:** PR #63 cerró el bug de "Ordenar por" (se quitó "Más cercanos"); quedan "Disponibilidad/Mejor coincidencia" y "Mejor valorados". Cercanía real = backlog (requiere lat/lng en `clinics` + ubicación del usuario + UX/privacidad).
- **Ubicación estructurada ✅ live (PR #64/`s7_25`):** LucyAdmin > Médicos > Editar edita Depto/Municipio (listas del Home), guarda `clinics.department_id/municipality_id` (filtran el Home); regla **P0004** (publicados/operativos requieren ubicación). Los publicados pendientes ya los completó el owner.
- **Mi equipo ✅ Fases 0–2:** **F0** gate clínico del asistente (PR #67/`s7_26`); **F1** límite base 1 titular + 2 asistentes (PR #70/`s7_27`, conteo activos+pendientes, enforcement server-side); **F2** ciclo de vida de invitación (PR #102/`s7_36` backend + #103 UI): `expires_at` TTL 14d, "vencida" derivada, vencidas no consumen cupo ni se aceptan, RPC `resend_invitation` (titular, revalida cupo si vencida, extiende la misma fila), UI vigentes/vencidas + Reenviar + badge "Vencida". `assistant` = operativo/no clínico. ⏳ **Pendiente:** add-ons / asistentes adicionales + integración con planes (dependen de pagos); permisos finos del asistente (si se decide).
- **Correcciones post-firma ✅ EJE COMPLETO (backend + UI, 5 bloques):** texto, receta, **diagnósticos, antecedentes familiares estructurados, signos vitales**. Etapa A inmutabilidad (PR #74/`s7_28`) + B1 (PR #76/`s7_29`) + impresión/distinción (PRs #79/#80/#81/`s7_30`) + UI texto+receta (PR #82) + **backend diag/antecedentes/vitales + inmutabilidad de `vitals` (PR #84/`s7_31`, smoke OTP 11/11)** + **UI completa en accordion (PR #85)**. Garantizado: motivo obligatorio, snapshots before/after, auditoría, inmutabilidad server-side, versionado de recetas (anterior histórica + vigente imprimible), marca "RECETA CORREGIDA" **solo cuando cambia receta**. Sin pendientes del eje.
- **Pagos SaaS ⏳ solo análisis (PR #62):** modelo preliminar $55/mes · $594/año · 1 titular + 2 asistentes · adicional $5/mes. **Stripe = candidato, NO cerrado.** El owner debe validar pasarela viable para El Salvador + IVA + DTE/facturación + Q1–Q11 **antes** de cualquier código de pagos.
- **Paciente Global ✅ Fase 2 COMPLETA (DUI progresivo):** Fase 1 (vinculación retroactiva + "Mis atenciones", #44/`s7_20`) + **Fase 2 backend (#87/`s7_32`):** identidad global en `profiles` (DUI/DOB/género/dpto/muni, todo nullable), **UNIQUE parcial** de documento, **UPDATE column-restricted** (paciente no toca `role`/`is_active`/`phone`), coherencia muni-depto (P0004), audit, anon nunca ve DUI/DOB. **Fase 2 UI (#88):** `/paciente/perfil` (form + teléfono read-only), **banner no bloqueante** en "Mis atenciones", **prefill con "Usar" por campo** desde fichas locales (sin guardado automático; conflicto sin auto-elegir), DUI duplicado → mensaje amable. **Fase 3 COMPLETA (#90/`s7_33` + #91):** Opción B sync espejo — `profiles` canónico, `patients` espejo sincronizado; **guard server-side** (P0030) bloquea editar identidad local si `profile_id` set (locales editables); **claim** copia global→local (global gana, local-only se conserva); **sync ongoing** propaga cambios del perfil a las fichas vinculadas (sin anular NOT NULL, bypass GUC); UI médico muestra identidad **read-only** + badge; walk-in sin cambios. Smoke OTP 6/6. **Fase 5 COMPLETA (dedup preventivo) (#98 diseño + #99/`s7_35` backend + #100 UI):** RPC `find_patient_match_candidates` (`SECURITY DEFINER`) — intra-clínica con detalle ("Usar este paciente"), cross-clínica/global solo señal mínima (`weak` por teléfono, `strong` por documento, **sin PII**), gate `is_clinic_member`/`is_admin` (`P0001`), **advisory** (no bloquea); `createBasicPatient` con chequeo proactivo de documento (`DuplicateDocumentError`); UI `PatientMatchHints` en `NewPatientModal` + `CreateWalkInModal`; teléfono normalizado con `normalizePhoneSV` (lookup y submit alineados). Smoke 8/8 + OK visual. ✅ **Defensa en profundidad cerrada (#118/`s7_40`):** la RPC canonicaliza el teléfono internamente (helper `normalize_phone_sv`, espejo de `normalizePhoneSV`, aplicado a input y filas) → ya no depende de que el caller normalice; tolera `71234567`/`+503…`/separadores y filas legacy; sin EXECUTE anon/authenticated; smoke 11/11. ⏳ **Pendiente:** Fase 4 (merge admin de duplicados). **Nota para Fase 4:** el sync puede chocar con `UNIQUE(clinic_id, document_type, document_number)` si hubiera fichas duplicadas del mismo perfil en la misma clínica con documento no-null (caso raro, falla elegante) → considerar en merge/dedup. Base: `docs/ANALISIS_PACIENTE_GLOBAL.md`.
- **Cambio de teléfono por OTP ✅ COMPLETO:** backend `s7_34` (#93, trigger `AFTER UPDATE OF phone ON auth.users` → sincroniza `profiles.phone` + `patients.phone` vinculados, bypass del guard de `s7_33`, audit `phone_change`) + UI paciente `/paciente/perfil` (#94) + UI médico `/panel/perfil` (#95), ambos con `ChangePhoneModal` reusable (2 pasos: nuevo número → OTP **solo al nuevo** → confirmar). Decisiones: sesión activa + OTP al nuevo (no se exige al anterior); **Secure phone change OFF**; sin re-auth fuerte en MVP. **Recuperación sin sesión → soporte/LucyAdmin manual.** Mejoras no-MVP: notificación al canal anterior, re-auth reforzada, herramienta formal de recuperación.
- **Catálogos personalizados por médico ✅ EJE 100% COMPLETO (#105–#111 + #114, `s7_37`/`s7_38`/`s7_39` + migración de datos):** modelo **global (base Lucy, `doctor_id IS NULL`, read-only para médicos) + personal por médico**. Snapshot histórico (editar catálogo no altera históricos firmados). UI consulta (global∪propios + "Base Lucy"/"crear propio") + admin del médico `/panel/catalogos` (segmento Míos|Base Lucy, ocultar/clonar, guard de rol). **De-dup de la base replicada aplicada:** Base Lucy **127 dx / 736 med**; "Míos" solo personalizaciones reales (4 dx + 4 med); **1650 dx + 9568 med inactivadas** (sin hard-delete); `catalog_migration_map` 11218 filas; **FK no reapuntados** (snapshot protege históricos); globales de prueba inactivados. **Regla:** médicos usan/ocultan/clonan; **no editan la base**; globales solo `is_admin` (backend/RLS). ✅ **Cerrado el último cabo — UI de LucyAdmin para administrar la Base Lucy global (#114, UI-only, sin migración):** página `/admin/catalogos` (gate `AdminOnlyRoute`) + NavLink "Catálogos" en `AdminLayout`; tabs Diagnósticos + Medicamentos; crear/editar/inactivar/reactivar globales; búsqueda; activos/inactivos; dedup amable (`DuplicateCatalogError` + `23505`, refleja el UNIQUE `s7_39`); `usage_count` oculto; sin hard-delete; candado `.is('doctor_id', null)` en updates. Backend YA listo (RLS `s7_38` `is_admin` + `audit_catalog` + UNIQUE `s7_39` + snapshot `s7_37`). Validado visualmente por el owner.

### Próximos frentes (backlog, elegir uno — ninguno arrancado)
- ~~**LucyAdmin: administrar Base Lucy global**~~ → ✅ **HECHO (PR #114, UI-only, sin migración).** `/admin/catalogos` + NavLink "Catálogos" (`AdminOnlyRoute`); tabs Diagnósticos + Medicamentos; crear/editar/inactivar/reactivar globales; búsqueda; activos/inactivos; dedup amable (`DuplicateCatalogError`/`23505`); `usage_count` oculto; no hard-delete; candado `.is('doctor_id', null)` en updates. Backend ya estaba listo (`s7_37`/`s7_38`/`s7_39`). **Cerró el último cabo del eje Catálogos.**
- **Paciente Global Fase 4** — merge admin de duplicados. **Diseño cerrado (#134, DM1–DM9)** en `docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md`; **F4-1 (claim tolerante) ✅ live (#135/`s7_45`)**. **Próximo: F4-2** = backend `admin_merge_patients` + `admin_merge_patients_preflight` + `patient_merge_log` (dry-run + audit + motivo obligatorio + unmerge formal previsto; columnas `merged_into_patient_id`/`merged_at` ya existen pasivas). Luego F4-3 (UI `/admin/pacientes`, +F4-3b bandeja `patient_link_rejections`). F4-D (identidades) diferida. (Frente grande/delicado: mueve historial clínico, solo LucyAdmin, intra-clínica.)
- **Pasarela de pagos / IVA / DTE / Q1–Q11** — desbloquea add-ons de equipo + suscripción SaaS. Requiere validación del owner (pasarela viable SV) antes de código.
- **Recuperación de acceso sin sesión** (perdió el teléfono, sin email/password) → herramienta LucyAdmin/soporte (complemento del cambio de teléfono).
- **Pendientes acotados:** paginación del Home. (~~causa raíz PanelLayout/useClinicContext~~ ✅ cerrada en #116; ~~RPC F5 tolerante a teléfono crudo~~ ✅ cerrada en #118/`s7_40`; ~~vista global `/admin/lista-espera`~~ ✅ cerrada en #120/`s7_41`; ~~Afiliación médico desde paciente existente~~ ✅ cerrada en #122/`s7_42`.) **Identidad múltiple Fase 2** (selector de contexto + capacidades derivadas) en cola — diseño en `docs/ANALISIS_ONBOARDING_IDENTIDAD_MULTIPLE.md`; recuperación sin sesión y merge admin (Paciente Global F4) quedan **detrás** de ese modelo. **Hallazgos QA Fase 1 (backlog):** `accept_clinic_invitations` compara teléfono literal (candidato a `normalize_phone_sv`); **⚠ operativo:** la corrección del nombre de Katherine NO persistió en DB (rehacer desde la ficha admin y verificar; posible save silenciosamente fallido). **Ownership/B2 (cerrado #128/`s7_43`; pendientes futuros decididos 2026-06-11):** (a) verificación reforzada de "Sí, son mías" (dato adicional tipo DOB/DUI parcial — para teléfonos compartidos/mal digitados; MVP basta confirmación+rechazo+audit); (b) términos/onboarding del paciente: aceptar que solo puede confirmar atenciones propias; (c) hallazgo F4 confirmado empíricamente: el claim copia el DUI global y el `UNIQUE(clinic,doc)` puede abortar el claim completo si hay ficha duplicada en la misma clínica (ya anotado para Fase 4, ahora con repro).

---

## REGLA OPERATIVA (owner vs dev)

Las **tareas manuales en LucyAdmin, dashboards o validaciones operativas las hace el owner/usuario**, salvo que se indique explícitamente que las haga el dev. Ejemplos del owner: completar datos desde LucyAdmin, validar opciones visuales en el navegador, probar flujos con OTP, aplicar decisiones comerciales, validar pasarela/IVA/DTE/temas legales.

El **dev** verifica (DB/audit), documenta, audita e **implementa cuando se le indique** — pero **no asume** tareas manuales operativas del owner. (También registrado en la memoria del proyecto: `convention_admin_tasks_owner`.)
