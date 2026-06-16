# Handoff LucyCare — Pre-piloto (post Sprint 7)

> Documento para retomar el proyecto en una nueva ventana sin depender
> del chat previo. **Snapshot 2026-06-05.** Acompaña a `CLAUDE.md`
> (guía rápida + sistema de diseño), `docs/ESTADO_TECNICO.md` (ER/BD)
> y los análisis vivos en `docs/ANALISIS_*.md`.

---

## 1. Estado actual

- **⚠ Punto de entrada actualizado:** para una ventana nueva, leer PRIMERO `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-06-15.md` (el `2026-06-11` queda como histórico). Este archivo sigue como snapshot completo del sprint.
- **HEAD esperado en `main`:** `a7b368d` o posterior. **PRs #1–#149 mergeados.** Migraciones hasta **`s7_48`** (#149 frontend-only). **Sin frente de código abierto; F4 merge/unmerge cerrado de punta a punta. Pendientes F4 (ninguno arrancado): F4-3b bandeja `patient_link_rejections`, F4-D merge de identidades.** **Cierres recientes:** **(#149)** F4 Unmerge — **UI "Deshacer fusión" LIVE**: acción en el historial de `/admin/pacientes` para revertir un merge sobre las RPCs `s7_48`; botón "Deshacer fusión" solo si `unmerged_at IS NULL` (autoridad real = `admin_unmerge_patients_preflight`; si bloquea P0070–P0077 no confirma), badge "Revertida" si ya revertida; modal de 3 pasos (preflight con warnings como info → confirmación reforzada motivo ≥10 + teclear `DESHACER FUSIÓN` con tilde, Escape/X bloqueados → resultado origen reactivado/`merge_log_id`/devuelto); errores P0070–P0077 por `error.code`; tras éxito invalida historial + candidatos; sin contenido clínico/JSON crudo; **frontend-only, sin migración/RLS/backend, `database.types.ts` no tocado** (solo `AdminPacientesPage.tsx` + `patientMerge.service.ts`); validado con fixtures `F43B_FIXTURE` (merge UI → unmerge UI → 0 residuales), desktop + móvil, tsc + build, OK visual del owner, 0 datos reales. **(#147 / `s7_48`)** Unmerge formal — **backend LIVE**: reversa del merge admin sobre `patient_merge_log` — `admin_unmerge_patients_preflight` (dry-run) + `admin_unmerge_patients` (transaccional, `FOR UPDATE`, revalida server-side); devuelve destino→fuente solo las filas de `moved_ids` que siguen en el target, restaura la fuente desde `source_snapshot`, el destino conserva su historia post-merge, rellena `unmerged_*` (append-only) + audit `admin_unmerge`; bypass propio `app.unmerging_patients` en los dos guards (previos intactos); reversa atómica, no hard-delete, no toca `profiles`/`auth.users`/identidad global; el esquema de `patient_merge_log` no cambia; códigos **P0070–P0077** (P0074 conflicto de documento, P0077 profile del snapshot inexistente) + warnings; firmas de las 2 RPCs en `database.types.ts`; **backend-only, sin UI**; check 5/5 + smoke 17/17 (0 residuales, 0 datos reales tocados). **(#144)** F4-3 UI PR B — **merge real en `/admin/pacientes` LIVE**: habilita `admin_merge_patients` (`s7_46`) desde la UI — botón "Fusionar fichas" solo si `preflight.eligible` + **confirmación reforzada** (motivo ≥10 + teclear `FUSIONAR FICHAS`) + vista de éxito (source/target/`merge_log_id`/conteos movidos) + errores **P0060–P0068** por `error.code` (reusa `MERGE_BLOCK_COPY`) + Escape/X bloqueados en submit + invalidación de candidatos/historial; firma de `admin_merge_patients` en `database.types.ts`; dev-script `scripts/_fixtures-merge-ui.mjs` (fixtures E3 `F43B_FIXTURE`, `--apply`/`--clean` con 0 residuales); **frontend-only, sin migración/RLS/backend, sin unmerge (reversa futura sobre `patient_merge_log`), sin contenido clínico/JSON crudo, sin teléfono/nombre como evidencia, sin tocar profiles/auth.users/identidad global**; validado apply→merge→P0061→clean (**0 residuales**) + desktop/móvil + tsc/build + **OK visual del owner**, **0 datos reales tocados**. **(#142)** F4-3 UI PR A — `/admin/pacientes` vista previa **read-only**: ruta + NavLink "Pacientes" + `AdminPacientesPage` + `patientMerge.service.ts`; consume `admin_list_patient_merge_candidates` (grupos `same_profile` + `W_UNCONFIRMED_LINK` + estado vacío) + `admin_merge_patients_preflight` (comparación source/target, evidencia, conteos, P0060–P0068 → copy, intercambiar) + lectura de `patient_merge_log` (historial legible, sin JSON crudo); **NO ejecuta merge, NO botón "Fusionar", NO `admin_merge_patients`, NO contenido clínico, NO F4-3b/unmerge, NO toca profiles/auth.users/identidad global**; frontend-only, sin migración; tsc+build+OK visual; fixtures E3 limpiadas; **decisión A/B** (read-only PR A + destructiva PR B pendiente). **(#140 / `s7_47`)** F4-3-search — RPC read-only `admin_list_patient_merge_candidates()` (admin-only `P0001`, anon sin EXECUTE) que lista **grupos** fusionables V1 `same_profile` por `(clinic_id, profile_id)` con fichas vivas `>=2`; identidad mínima + conteos + `confirmed/unconfirmed_links_count` + `has_unconfirmed_links` + `W_UNCONFIRMED_LINK`; sin contenido clínico, sin candidatos por teléfono/nombre, sin merge, sin escritura, sin tocar identidad global/`profiles`/`auth.users`; check 2/2 + smoke 10/10 (PR 1 de F4-3). **(#138 / `s7_46`)** F4-2 backend del merge admin de fichas intra-clínica: `patient_merge_log` + `admin_merge_patients_preflight` (dry-run) + `admin_merge_patients` (transaccional, revalida server-side) + helper `_patient_merge_eligibility` + bypass propio `app.merging_patients` en los dos guards (firma `s7_29` + identidad P0030 `s7_33`); mueve appointments/consultations/vitals source→target (incl. consulta firmada vía bypass), neutraliza la fuente (sin hard-delete, teléfono conservado), audit `admin_merge`; **V1 = `same_profile`** (same_document inalcanzable intra-clínica por el `UNIQUE(clinic,doc)`; no merge por teléfono/nombre ni override — DM3b); bloqueos P0060–P0068 (borrador en fuente bloquea, en target solo warning); el claim ya ignora fichas merged (`s7_45`); sin UI/unmerge/identidad global/`auth.users`; check 6/6 + smoke 19/19. **(#134)** diseño Paciente Global Fase 4 / merge admin de fichas — **DM1–DM9 cerradas** (`docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md`; alcance = fichas `patients` intra-clínica, no identidades/`profiles`/`auth.users`, no expedientes cross-clínica; reglas: solo LucyAdmin, dry-run + motivo + audit, no hard-delete, unmerge formal previsto; fases F4-1→F4-2→F4-3 +F4-3b +F4-D). **(#135 / `s7_45`)** F4-1 claim tolerante fila por fila: una colisión `UNIQUE(clinic,doc)` ya no aborta el claim completo (cierra el hallazgo F4); fichas válidas se vinculan, la conflictiva queda intacta; skips auditados (`claim_skipped_*` + resumen); cliente solo conteos; columnas pasivas `merged_into_patient_id`/`merged_at` (infra F4-2, el claim las excluye); sin merge, sin tocar identidad global ni `auth.users`, sin hard-delete; check 5/5 + smoke 16/16. **(#136)** fix bug público de reserva móvil (frontend-only): CTA móvil pasó de scaffold mock (horarios de cliente, servicios inventados, `PaymentModal` falso sin crear cita) a flujo real (`BookingCard`: servicios/slots reales, `createBooking`, OTP); fecha por defecto local (no UTC); error de red con "Reintentar"; splash inicial; eliminados `PaymentModal.tsx` + `utils/auth.ts`; fixture limpiado. **Administración de LucyAdmins Fase 1 (#131 análisis + #132/`s7_44`):** ciclo de vida completo sin SQL manual (invitación con cuenta dedicada P0050–P0055 · activación al primer OTP, pending sin privilegios, fill `full_name` · revocación con bloqueo inmediato + guard último admin P0052 · `/admin/administradores` + "Editar nombre" propio · cuenta-cáscara re-invitable / bloqueada si se volvió paciente real); `profiles.role='admin'` único bit, `is_admin()` intacta; smoke 24/24. **Navegación móvil LucyAdmin (#130):** header + hamburguesa + drawer en `AdminLayout`; desktop intacto. **Ownership + B2 (#127/#128/`s7_43`):** regla central vinculante "el médico gestiona una relación clínica local; Lucy gobierna la identidad global" (D1–D7 aprobadas, `docs/ANALISIS_PACIENTE_GLOBAL_OWNERSHIP.md`); B2 live: `link_confirmed_at` + sección "por confirmar" separada de Mis atenciones + confirm/reject por ficha + rechazos `pending_review` que el claim no re-vincula (smoke 14/14); B1 merge admin sigue pendiente con diseño propio. **Identidad múltiple (#124 + #125, frontend-only):** modelo "identidad única + capacidades múltiples" aprobado (`docs/ANALISIS_ONBOARDING_IDENTIDAD_MULTIPLE.md`); Fase 1: `PatientOnlyRoute` permite patient/doctor/assistant (excluye admin/anon), menú + "Ir al panel" + nota azul; fixes destapados: `useDashboard` vía contexto (home roto para asistentes, pre-existente) y `listMyAppointments` con filtro explícito por persona. Fase 2 (selector de contexto) en cola; recuperación sin sesión y merge admin quedan detrás del modelo. Hitos recientes: Correcciones post-firma **EJE COMPLETO** (#74–#85, `s7_28..s7_31`); Paciente Global **Fases 1–3 COMPLETAS** (#87/`s7_32` + #88 + #90/`s7_33` + #91); **Cambio de teléfono por OTP COMPLETO** (#93/`s7_34` + #94 + #95); **Paciente Global Fase 5 (dedup preventivo) COMPLETA** (#98 diseño + #99/`s7_35` + #100 UI); **Mi equipo Fase 2 (ciclo de vida de invitación) COMPLETA** (#102/`s7_36` + #103 UI); **Catálogos personalizados por médico — EJE 100% COMPLETO** (#105–#111, `s7_37`/`s7_38`/`s7_39` + migración de base replicada: Base Lucy 127/736, "Míos" solo lo propio; **+ UI de LucyAdmin para Base Lucy global #114, UI-only sin migración**); **Robustez PanelLayout/useClinicContext (#116, frontend-only):** `getSession()` (no `getUser()`) quita el race de primera carga + timeout/`.catch()`/estado recuperable (sin spinner infinito) + errores tipados con copy específico para estructurales; **RPC F5 tolerante a teléfono crudo (#118/`s7_40`, backend-only):** helper `normalize_phone_sv` + canonicalización en ambos lados (defensa en profundidad; cross sin PII; smoke 11/11); **Lista de espera global cross-médicos (#120/`s7_41`):** `/admin/lista-espera` + RPC `admin_list_waitlist` (join médico/perfil/especialidad/clínica + filtros estado/médico/especialidad/búsqueda/fecha + paginación + `total_count`; reutiliza `admin_update_waitlist_entry`; smoke 10/10); **Afiliación — médico desde paciente existente (#122/`s7_42`):** `_affiliation_classify` + `admin_affiliation_preflight` + `admin_approve_and_create_doctor` reescrita (new/reuse_patient/block; reuse sin nuevo auth.user + fill full_name si vacío, sin tocar phone/email/role; P0010–P0013; no copia email del lead; smoke 12/12); cierres documentales #86/#89/#92/#96/#101/#104/#115/#117/#119/#121.
- **Infra live:** dominio público `https://lucycare.app` (DNS Cloudflare, `www`→apex 308). `lucycare.vercel.app` queda como **fallback temporal** (no desactivar). Previews en `lucycare-git-*.vercel.app`. SMTP externo Resend/Supabase configurado.
- **Migraciones aplicadas hasta `s7_48`** (`s7_30` distinción adenda texto vs receta / PR #81; `s7_31` amend diag/antecedentes/vitales + inmutabilidad `vitals` / PR #84; `s7_32` Paciente Global F2 identidad global en `profiles` / PR #87; `s7_33` Paciente Global F3 sync espejo + guard / PR #90; `s7_34` cambio de teléfono por OTP — trigger sync `auth.users.phone` / PR #93; `s7_35` Paciente Global F5 — RPC `find_patient_match_candidates` dedup preventivo / PR #99; `s7_36` Mi equipo F2 — `expires_at` TTL 14d + `team_seats_used` excluye vencidas + `accept` ignora vencidas + RPC `resend_invitation` / PR #102; `s7_37` Catálogos — snapshot histórico de nombre en receta/diagnóstico / PR #106; `s7_38` Catálogos — global+personal (`doctor_id` nullable) + `doctor_catalog_hidden` + RLS + audit / PR #107; `s7_39` Catálogos — infra de-dup (`catalog_migration_map` + UNIQUE parcial global) / PR #110/#111; `s7_40` Paciente Global F5 — RPC F5 tolerante a teléfono crudo: helper `normalize_phone_sv` (`IMMUTABLE`, sin EXECUTE anon/authenticated) + `find_patient_match_candidates` canonicaliza el teléfono en ambos lados / PR #118; `s7_41` Lista de espera global cross-médicos — RPC `admin_list_waitlist` (`SECURITY DEFINER`, `is_admin()`, join + filtros + paginación + `total_count`) / PR #120; `s7_42` Afiliación médico desde paciente existente — `_affiliation_classify` + `admin_affiliation_preflight` + `admin_approve_and_create_doctor` reescrita (new/reuse_patient/block, P0010–P0013) / PR #122; `s7_43` B2 Confirmación post-claim — `patients.link_confirmed_at` + `patient_link_rejections` (pending_review, RLS admin-only) + RPCs `confirm_patient_link`/`reject_patient_link` (self-gated, P0040) + `claim_patient_records` excluye pares rechazados / PR #128; `s7_44` Administración de LucyAdmins F1 — `platform_admin_invitations` + RPCs invite/accept/revoke/list (cuenta dedicada, activación por OTP, guard último admin P0052, is_admin() intacta) / PR #132; `s7_45` Paciente Global F4 / F4-1 claim tolerante — columnas pasivas `patients.merged_into_patient_id` (FK sin CASCADE + CHECK anti self-reference) + `merged_at` + `claim_patient_records` reescrita fila por fila (subtransacción por ficha; la colisión `UNIQUE(clinic,doc)` no aborta el claim completo; skips `claim_skipped_unique`/`claim_skipped_error` auditados; cliente solo conteos; excluye fichas fusionadas); sin merge / sin tocar identidad-`auth.users` / sin hard-delete / PR #135; `s7_46` Paciente Global F4 / F4-2 backend del merge admin de fichas intra-clínica — tabla `patient_merge_log` (snapshots/`moved_ids`/`moved_counts`/reason/actor/evidence + `unmerge_*` previstos, RLS admin-only) + `admin_merge_patients_preflight` (dry-run) + `admin_merge_patients` (transaccional, `FOR UPDATE`, revalida server-side) + helper `_patient_merge_eligibility` + bypass propio `app.merging_patients` en los dos guards (firma `s7_29` + identidad P0030 `s7_33`); re-point appointments/consultations/vitals source→target + neutralización de la fuente (sin hard-delete, teléfono conservado) + audit `admin_merge`; **V1 = `same_profile`** (same_document inalcanzable intra-clínica por el `UNIQUE(clinic,doc)`); bloqueos P0060–P0068; sin UI/unmerge/identidad global / PR #138; `s7_47` Paciente Global F4 / F4-3-search — RPC read-only `admin_list_patient_merge_candidates()` (`SECURITY DEFINER`, `STABLE`, gate `is_admin()`/`P0001`, anon sin EXECUTE) que lista **grupos** fusionables V1 `same_profile` por `(clinic_id, profile_id)` con fichas vivas (`is_active AND merged_into IS NULL`) `>=2`; por grupo identidad mínima + conteos + `confirmed/unconfirmed_links_count` + `has_unconfirmed_links` + warning `W_UNCONFIRMED_LINK`; sin contenido clínico, sin candidatos por teléfono/nombre, sin merge, sin escritura, sin tocar identidad global/`profiles`/`auth.users` / PR #140; `s7_48` Paciente Global F4 / Unmerge formal — backend de la reversa del merge: bypass propio `app.unmerging_patients` en los dos guards (firma `s7_29` + identidad P0030 `s7_33`, previos intactos) + helper `_patient_unmerge_eligibility` + `admin_unmerge_patients_preflight(p_merge_log_id)` (dry-run) + `admin_unmerge_patients(p_merge_log_id, p_reason)` (transaccional, `FOR UPDATE`, revalida server-side; devuelve `moved_ids` destino→fuente solo las que siguen en el target; restaura la fuente desde `source_snapshot`; rellena `unmerged_at`/`unmerged_by`/`unmerge_reason` append-only; audit `admin_unmerge`); reversa atómica, no hard-delete, no toca `profiles`/`auth.users`/identidad global; el esquema de `patient_merge_log` no cambia; códigos P0070–P0077 / PR #147).
- **Tres frentes recién cerrados (no reabrir):**
  - **Correcciones post-firma — EJE COMPLETO (backend + UI), 5 bloques clínicos:** texto, receta, diagnósticos, antecedentes familiares estructurados y signos vitales. Etapa A inmutabilidad (#74/`s7_28`), B1 corrección controlada vía `amend_consultation()` (#76/`s7_29`), impresión/distinción adenda (#79/#80/#81/`s7_30`), UI texto+receta (#82), backend diag/antecedentes/vitales + inmutabilidad de `vitals` (#84/`s7_31`, smoke OTP 11/11), UI completa en accordion (#85). Motivo obligatorio, snapshots before/after, versionado de recetas, marca "RECETA CORREGIDA" solo si cambia receta.
  - **Paciente Global — Fases 1–3 COMPLETAS:** F1 vinculación retroactiva + "Mis atenciones" (#44/`s7_20`); F2 identidad global en `profiles` (DUI/DOB/género/dpto/muni, DUI progresivo, UNIQUE parcial, UPDATE column-restricted, #87/`s7_32`) + UI `/paciente/perfil` (#88); F3 sync espejo `profiles→patients` + guard server-side P0030 + read-only del médico (#90/`s7_33` + #91); **F5 dedup preventivo** en creación (#98 diseño + #99/`s7_35` RPC `find_patient_match_candidates` + #100 UI `PatientMatchHints`; intra con detalle, cross sin PII, advisory). Smoke OTP 6/6 (F3) + 8/8 (F5). ⏳ Fase 4 (merge admin de duplicados) en cola.
  - **Cambio de teléfono por OTP — COMPLETO:** backend trigger `AFTER UPDATE OF phone ON auth.users` que sincroniza `profiles.phone` + `patients.phone` vinculados + audit `phone_change` (#93/`s7_34`); UI paciente `/paciente/perfil` (#94) + UI médico `/panel/perfil` (#95) con `ChangePhoneModal` reusable. Decisiones: sesión activa + OTP **solo al número nuevo**; Secure phone change OFF; sin re-auth fuerte en MVP; recuperación sin sesión → soporte/LucyAdmin manual.
- **Sprint 7 — Admin SaaS + Robustez:** ✅ completado (PRs #16–#30).
- **Pre-piloto — Bloqueantes cerrados ✅ (PRs #32–#59):**
  - PR #32 Reclamo seguro (s7_13).
  - PR #33 Estabilización supabase-js lock no-op.
  - PR #34 Foto de perfil (s7_14).
  - PR #35 Security Gate audit + trigger reviews (s7_15).
  - PR #36 Rotación service_role + ENV vars (32 scripts).
  - PR #37 RLS hardening de profiles (s7_16, s7_16b).
  - PR #38 Desactivar seed `*.lucycare.test` (s7_17).
  - PR #39 Auth email+password + reset por email (Fase 4 PR-A).
  - PR #40 LoginModal no cierra al click outside.
  - PR #41 Directorio informativo + copy ES.
  - PR #42 Análisis paciente global (doc + decisiones DA1-DA4).
  - PR #43 Lista de espera real + badge admin (s7_18, s7_19).
  - PR #44 Paciente Global Fase 1 (s7_20).
  - PR #46 SMTP externo Resend + reset por email validado (doc + setup operativo 2026-05-26, dominio `lucycare.app` **comprado en Cloudflare**, DNS email — SPF/DKIM/DMARC — gestionado ahí mismo).
  - PR #47 Refresh documental post-Resend (`HANDOFF_TOMA_DECISIONES_2.md` + actualizaciones en CLAUDE.md / HANDOFF).
  - PR #48 Dominio público `lucycare.app` live en Vercel (setup operativo 2026-05-26, DNS en Cloudflare con CNAME flattening en apex, `www` → apex 308, Supabase Site URL actualizado, reset por email validado end-to-end).
  - PR #49 Refresh documental post-#48 — `lucycare.app` como dominio principal en CLAUDE.md / HANDOFFs / FASE_4_AUTH / SETUP_SMTP_RESEND / PLAN_PILOTO.
  - PR #50 Password en flujo de Reclamar perfil (Fase 4 PR-B, step obligatorio post-claim, dos caminos: crear ahora / recibir link por email; copy "Perfil reclamado" diferenciado de "Cuenta suspendida"; sin migración).
  - PR #52 Análisis del flujo "Solicitar afiliación" (`docs/ANALISIS_AFILIACION_MEDICO.md`, 10 secciones + Q1-Q10 pendientes de decisión).
  - PR #53 Mitigación del flujo público "Soy médico" (cierra Hallazgo #7 del Security Gate). Reemplaza el `DoctorRegistrationModal` legacy (auto-creaba doctor `claimed` sin validar identidad) por un `DoctorInterestModal` (mitigación temporal). Cero persistencia en DB. `registerDoctor` service y modal legacy marcados `@deprecated`.
  - PR #54 Refresh documental post-#53 (registra mitigación + Hallazgo #7 en `SECURITY_GATE_PILOTO.md`).
  - PR #55 Plan operativo `docs/PLAN_AFILIACION_MEDICO.md` (Fase 1 + Fase 2).
  - PR #56 **Afiliación Fase 1** (`s7_21`). Tabla `doctor_affiliation_requests` con RLS estricto + `incomplete` GENERATED. RPC pública `submit_affiliation_request` con rate limit 1/IP/24h y UNIQUE phone activo. RPCs admin para triage (in_review/approved/rejected). Frontend: `AffiliationRequestModal` reemplaza al interest legacy. Bandeja `/admin/afiliaciones` con filtros + badge sidebar. Página `/privacidad` MVP. No crea doctor/profile/clinic.
  - PR #57 Refresh documental post-PR #56.
  - PR #58 **Afiliación Fase 2** (`s7_22` + `s7_23`). RPC `admin_approve_and_create_doctor(p_request_id, p_overrides)` que en una transacción crea auth.users dormant + profile (UPSERT defensivo coexiste con trigger `handle_new_user`) + clinic + clinic_member (owner) + doctor en `lucy_status='listed_only'` con flags conservadores en false. Email override aceptado solo si lead no trajo email (regla server-side en s7_23). UI: botón "Crear médico" en `AdminAffiliationDetailModal` con form de overrides + checkbox confirm + pantalla de éxito con doctor_id + link a ficha admin (no perfil público — doctor sigue no publicado). Badge "Datos por completar" reemplazado por "Médico creado" cuando hay doctor_id. Smoke OK hasta ficha admin. **Pendiente**: validar claim end-to-end del médico creado con test phone real del médico.
- **Migraciones aplicadas en DB:** `s4_*`, `s5_01..s5_07`, `s6_01..s6_10`, `s7_01..s7_39` (hasta `s7_30` PR #81; `s7_31` PR #84; `s7_32` PR #87; `s7_33` PR #90; `s7_34` PR #93; `s7_35` PR #99; `s7_36` PR #102; `s7_37` PR #106; `s7_38` PR #107; `s7_39` PR #110/#111). Verificables con `node scripts/check-s7_NN.mjs`.
- **Médicos en producción hoy:** 5 publicados (Camilo + 4 informativos).
  - Camilo: `lucy_status=verified`, agenda en línea real, único con `booking_enabled=true`.
  - Otros 4 (Gina, Abraham, German, Elena): publicados sin agenda en línea, captados por el directorio informativo.
- **Seed legacy:** 12 médicos `*.lucycare.test` desactivados (`is_active=false`) en PR #38.

### Acceso para QA

- **Admin Plataforma:** Test Phone `50378056365` / OTP `123456`. Header → "Panel Admin" → `/admin`.
- **Médico demo:** Test Phone `50378627694` / OTP `123456` (Camilo, ver `docs/CUENTA_DEMO_CAMILO.md`).
- **Paciente test (Fase 1):** Test Phone `50375000001` / OTP `123456`. Hay 3 patients precargados con marker `notes='test_patient_phase1'` para validar la vinculación retroactiva. Cleanup: `node scripts/setup-test-patient.mjs --clean`.
- Login sin SMS real vía Test Phone Numbers en Supabase Dashboard → Authentication → Phone.

### Setup local

Cada máquina necesita una vez:

```
cp .env.local.example .env.local
# completar SUPABASE_URL, SUPABASE_ANON_KEY (sb_publishable_*),
# SUPABASE_SERVICE_ROLE_KEY (sb_secret_*)
```

Scripts admin lo cargan automáticamente vía `scripts/_lib/env.mjs`.

---

## 2. Decisiones de producto vigentes (no reabrir)

### Modelo del médico (4 ejes independientes)
- `lucy_status` — funnel: `listed_only | claimed | booking_enabled | verified`.
- `is_published` — controla solo visibilidad en directorio. **No exige `is_operational`.**
- `is_operational` — gate del panel del médico (puede operar agenda).
- `booking_enabled` — muestra reserva en línea pública.
- `is_verified` — GENERATED de `lucy_status='verified'`. No editable manualmente.

### Directorio informativo (firmado en `docs/ANALISIS_DIRECTORIO_INFORMATIVO.md`)
- D1: completitud mínima para aparecer en directorio = full_name + specialty + clinic.name + address.
- D2: pill "Agenda en línea" / "Sin agenda en línea". Copy ES (sin "booking", "online", "onboarding" en UI pública). Orden: booking_enabled DESC primero.
- D3: waitlist idempotente UNIQUE(doctor_id, phone_normalized).
- D4: notificación manual desde admin (sin SMS auto, sin Edge Functions).

### Modelo de paciente global (firmado en `docs/ANALISIS_PACIENTE_GLOBAL.md`)
- DA1: identidad global en `profiles` extendido. `patients` sigue como ficha por clínica.
- DA2: vinculación retroactiva automática **solo con phone OTP-verified**.
- DA3: walk-in editable libremente hasta reclamo.
- DA4: "Mis atenciones" muestra clínica.
- **Fase 3 — Opción B (sync espejo) cerrada:** `profiles` = verdad canónica; `patients` = espejo sincronizado. Guard server-side (P0030) bloquea editar identidad local si `profile_id` set (los campos locales — sangre/alergias/emergencia/notas/tipo/foto — siguen editables). El claim copia identidad global→local (global gana). Sync ongoing propaga cambios del perfil a las fichas vinculadas. `phone` fuera del sync de identidad (lo maneja el trigger de cambio de teléfono).

### Reclamo de perfil (firmado en `docs/ANALISIS_RECLAMAR_PERFIL.md`)
- Cambia **solo** `lucy_status: listed_only → claimed`.
- **NUNCA** toca `is_verified`, `is_published`, `booking_enabled`, `is_operational`, `services`, `availability_rules`.
- Match dual phone OTP-verified + license case-insensitive sin espacios.
- Audit log con `edited_via='claim_self_service'`.

### Auth (firmado en `docs/ANALISIS_AUTH_MEDICO.md`)
- Paciente: OTP por SMS (default).
- Médico/Admin: OTP **+** email/password (PR #39 ✅).
- Reset por email vía Supabase (PR #39 ✅).
- Activación de password en flujo de Reclamar perfil (PR #50 ✅ — paso obligatorio post-claim).
- **Cambio de teléfono por OTP (PRs #93/#94/#95 ✅):** lo maneja Supabase Auth desde el cliente (`updateUser({phone})` → OTP **solo al número nuevo** → `verifyOtp(type:'phone_change')`, sesión activa, **Secure phone change OFF**). Trigger `s7_34` sincroniza `profiles.phone` + `patients.phone` vinculados + audit. Sin re-auth fuerte en MVP. Recuperación sin sesión → soporte/LucyAdmin manual.
- **Ningún flujo público auto-crea médicos `claimed`** (PR #53 ✅). El antiguo "Soy médico" → form de 6 pasos quedó deprecado. Hoy es CTA "Soy médico, quiero aparecer" → `AffiliationRequestModal` que persiste lead en `doctor_affiliation_requests` (PR #56). LucyAdmin valida en `/admin/afiliaciones`. En Fase 2 (siguiente), aprobar creará el `doctors` row en `listed_only` y el médico entrará al flujo de Reclamar perfil estándar.

### Seguridad (firmado en `docs/SECURITY_GATE_PILOTO.md`)
- `service_role` rotado en PR #36 + invalidado el JWT legacy. Scripts leen `.env.local`.
- RLS hardening de `profiles`: anon solo (id, full_name, avatar_url) de médicos publicados.
- audit_log con coverage: claim, avatar, admin edits, reviews, waitlist, paciente global.
- Modales sensibles no cierran al click outside.
- SMTP transaccional con Resend (dominio `lucycare.app` comprado en Cloudflare, DNS gestionado ahí, SMTP custom en Supabase Auth). Hallazgo #6 del Security Gate ✅ cerrado en PR #46.
- Dominio público `https://lucycare.app` ✅ **live en producción** desde 2026-05-26 (PR #48). DNS en Cloudflare con CNAME en apex (vía CNAME flattening) y CNAME `www`. `www.lucycare.app` redirige 308 a apex. `lucycare.vercel.app` permanece activo como **fallback temporal** (no desactivar; sirve para links viejos en circulación + rollback rápido). Previews siguen vigentes en `lucycare-git-*.vercel.app`.

### Cuenta demo oficial — Camilo
Detallada en `docs/CUENTA_DEMO_CAMILO.md`. NO incluir en limpiezas. Mantenerla activa para validar todos los flujos del médico operativo real.

---

## 3. Stack de features pre-piloto (estado live)

| Feature | Donde vive | Estado |
|---|---|---|
| Reclamar perfil seguro | `/doctor/:id` card emerald + ClaimProfileModal | ✅ live |
| Card post-reclamo owner vs pública | `ClaimedProfileNoticeCard` | ✅ live |
| Foto de perfil médico (self/admin) | `/panel/perfil`, `/admin/medicos/:id`, AvatarUploader | ✅ live |
| Banner "completá con foto" en home panel | `/panel/home` cuando avatar_url null | ✅ live |
| Login email+password + tab Email | `LoginModal` (tab Email) | ✅ live |
| Reset por email | `/reset-password` | ✅ live |
| Directorio informativo | Home muestra publicados aunque no operativos | ✅ live |
| Pill "Agenda en línea / Sin agenda en línea" | `DoctorCard` + detalle | ✅ live |
| Lista de espera real | `WaitlistModal` + tabla `waitlist_entries` | ✅ live |
| Badge "Lista de espera: N" en admin | `/admin/medicos` | ✅ live |
| Sección lista de espera en ficha médica admin | `AdminDoctorWaitlistSection` | ✅ live |
| Paciente Global Fase 1 — vinculación retroactiva | RPC `claim_patient_records` post-OTP | ✅ live |
| "Mis atenciones" cross-clinic | `/paciente/mis-atenciones` | ✅ live |
| Dropdown "Mi cuenta" en header | `PatientAccountMenu` + `PatientHeader` | ✅ live |
| Perfil del paciente (identidad global F2) | `/paciente/perfil` + banner "Completá tu perfil" | ✅ live |
| Identidad read-only del paciente vinculado (F3) | `EditPatientModal` (panel médico) | ✅ live |
| Cambiar teléfono por OTP (paciente y médico) | `ChangePhoneModal` en `/paciente/perfil` + `/panel/perfil` | ✅ live |
| Corregir consulta firmada (5 bloques) | Modal "Corregir consulta firmada" en accordion | ✅ live |
| Receta corregida — versionado + marca de impresión | `is_current` + banner "RECETA CORREGIDA" | ✅ live |
| Dedup preventivo al crear paciente/walk-in (F5) | `PatientMatchHints` en NewPatient + CreateWalkIn | ✅ live |
| Ciclo de vida de invitación de equipo (F2) | `EquipoPage` — vigentes/vencidas, "expira en N días", Reenviar | ✅ live |
| Catálogos global (base Lucy) + personal por médico | `/panel/catalogos` Míos\|Base Lucy + consulta global∪propios | ✅ live |
| Snapshot histórico de catálogo en receta/diagnóstico | `*_snapshot` + impresión/lectura desde snapshot | ✅ live |

---

## 4. Próximas fases (orden recomendado)

### 4.0 Smoke end-to-end de afiliación — ✅ COMPLETADO (2026-05-30)

Validado el claim end-to-end del médico creado vía Fase 2 con test phone médico real (`50375000099` / OTP `123456`). En DB tras el claim: `lucy_status` `listed_only`→`claimed`, `profile.role` `patient`→`doctor`, `tos_accepted_at` seteado, `audit_log` con `edited_via='claim_self_service'`, y sin `verified`/`is_operational`/`booking_enabled`. Password creada. Artefactos limpiados.

**El smoke detectó 4 bugs en Fase 2 → corregidos en PR #61 + migración `s7_24`:**
1. **Raíz:** la RPC dejaba el profile `role='doctor'` pre-claim → el médico entraba al panel y veía "Perfil reclamado" sin reclamar. **Fix:** profile queda `role='patient'` pre-claim; `claim_doctor_profile` lo sube a `'doctor'` al reclamar (igual que los importados).
2. Nombre de clínica con doble "Dr." → fix en fallback.
3. Modal admin "Crear médico" no precargaba Depto/Municipio → `admin_list_affiliation_requests` ahora devuelve los IDs + precarga en el frontend.
4. `PanelLayout` dejaba spinner colgado si `useClinicContext` falla → ahora muestra "Reintentar".

**Aprendizajes operativos (conservar):**
- **NO hacer OTP con el teléfono del médico ANTES de que admin cree el doctor** (Supabase crearía un `auth.user` paciente que choca con el `UNIQUE` de phone en la RPC).
- **"Perfil reclamado" en el panel NO prueba el claim** — la prueba es `lucy_status='claimed'` en DB.
- **`auth.admin.listUsers()` pagina mal** (bug GoTrue, fila corrupta en pág. 2). Para buscar/limpiar por phone, derivar `auth.user.id` desde `profiles.id` y usar `getUserById`/`deleteUser`.

Estado actual del eje afiliación:
- ✅ Análisis (PR #52), mitigación legacy (PR #53), Q1-Q10 cerradas, plan operativo (PR #55), Fase 1 captura+bandeja (PR #56), Fase 2 conversión (PR #58), refresh docs (PR #59), **smoke end-to-end + fixes (PR #61 + `s7_24`)**.
- ✅ PR #61 (fix + `s7_24`), #60 (handoff), #62 (análisis pagos), #63 (fix orden Home), #64 (ubicación estructurada admin + `s7_25`) — todos mergeados. HEAD `ed5721f`.
- ⏳ Pendientes legal/diseño: DUI + TOS médico pre-verificación (`docs/PLAN_AFILIACION_MEDICO.md §11.bis`).

### 4.1 Pre-piloto público (operativo, no código)

1. ✅ **SMTP externo (Resend)** — completado en PR #46 (setup 2026-05-26). Ver `docs/SETUP_SMTP_RESEND.md`.
2. **Smoke 7.3 opcional** — validar capacidad con 5 resets seguidos. No bloqueante: rate limit builtin ya no aplica.
3. **Cleanup test patients Fase 1** cuando termine validación (`node scripts/setup-test-patient.mjs --clean`).

### 4.2 Auth — Fase 4 (estado)

- ✅ **PR-A** (PR #39): login email/password + reset por email.
- ✅ **PR-B** (PR #50): step obligatorio post-claim con dos caminos — "Crear contraseña ahora" (primario, fetch directo a `PUT /auth/v1/user`) o "Recibir link por email" (muestra email del profile + fallback amber).

Fase 2 (self-service de cuenta):
- ✅ **Cambio de teléfono por OTP** (PRs #93/#94/#95, `s7_34`). Ver §2 (Auth) y §1.
- ⏳ Cambio de **email** self-service post-reclamo (override admin ya existe en Afiliación Fase 2).
- ⏳ **Recuperación de acceso sin sesión** (perdió el teléfono, sin email/password) → herramienta LucyAdmin/soporte (complemento del cambio de teléfono; hoy es manual).

Próximas fases (no urgentes para piloto):
- **Fase 3**: 2FA opcional (TOTP).

### 4.3 Paciente Global — Fase 4 (1-3 + 5 ✅ live)

- ✅ **Fase 1** (#44/`s7_20`): vinculación retroactiva por phone OTP + "Mis atenciones".
- ✅ **Fase 2** (#87/`s7_32` + #88): identidad global en `profiles` (DUI/DOB/género/dpto/muni, DUI progresivo, UNIQUE parcial, UPDATE column-restricted) + `/paciente/perfil` + banner + prefill por campo.
- ✅ **Fase 3** (#90/`s7_33` + #91): sync espejo `profiles→patients` + guard server-side P0030 + claim copia global→local + identidad read-only del médico.
- ✅ **Fase 5** (#98 diseño + #99/`s7_35` + #100 UI): dedup **preventivo** en creación. RPC `find_patient_match_candidates` (`SECURITY DEFINER`): intra-clínica con detalle ("Usar este paciente"); cross-clínica/global solo señal mínima (`weak` por teléfono, `strong` por documento, **sin PII**); gate `is_clinic_member`/`is_admin`; **advisory** (no bloquea). `createBasicPatient` con chequeo proactivo de documento (`DuplicateDocumentError`). UI `PatientMatchHints` en `NewPatientModal` + `CreateWalkInModal`. Teléfono normalizado con `normalizePhoneSV`. ✅ **Defensa en profundidad cerrada (#118/`s7_40`):** helper SQL `normalize_phone_sv` (espejo de `normalizePhoneSV`, `IMMUTABLE`, sin EXECUTE anon/authenticated) + la RPC canonicaliza el teléfono en ambos lados → no depende del caller; tolera teléfono crudo/`+503…`/separadores y filas legacy; cross sin PII; smoke 11/11.
- ⏳ **Fase 4**: herramienta admin para fusionar duplicados (`admin_merge_patients` con audit + reversibilidad + dry-run). **Nota:** el sync de F3 puede chocar con `UNIQUE(clinic_id, document_type, document_number)` si hubiera fichas duplicadas del mismo perfil en la misma clínica con documento no-null (caso raro, falla elegante) → considerar en el merge/dedup. (F5 ya previene nuevos duplicados de entrada.)

Detalles en `docs/ANALISIS_PACIENTE_GLOBAL.md`.

### 4.4 Directorio — Follow-ups

- ~~Vista global `/admin/lista-espera` cross-médicos con filtros (médico, fecha, estado).~~ ✅ hecho (#120/`s7_41`): RPC `admin_list_waitlist` + página `/admin/lista-espera` (filtros estado/médico/especialidad/búsqueda/fecha + paginación + `total_count`).
- Sección "Lista de espera" en panel del médico (RLS ya permite, falta UI).
- Rate limit fuerte para tráfico público real (Cloudflare WAF o counter por IP en RPC).
- Notificación automática al activar `booking_enabled` (Edge Function + Twilio).

### 4.5 Admin SaaS restantes

- B4: disponibilidad/horarios desde admin.
- C: suspender/reactivar pacientes y asistentes.
- D: dashboard tracción mensual.
- E: UI sobre `admin_review_traceability` + moderar reseñas.
- F: explorador de `audit_log` con filtros.
- G: ~~catálogos globales~~ → ✅ **hecho (PR #114): `/admin/catalogos` administra la Base Lucy global** (diagnósticos + medicamentos; crear/editar/inactivar/reactivar; dedup amable; sin hard-delete). Queda onboarding manual de médico.

Cada fase: 1 PR chico · migración `s7_NN` (si aplica) + `scripts/check-s7_NN.mjs` · `vite build` OK · preview validado · luego merge.

---

## 5. Riesgos y reglas críticas

- **NO exponer contenido clínico** al admin plataforma. Validado en RLS y Security Gate.
- **Toda acción admin se audita** en `audit_log`. RPCs admin escriben `edited_via='admin'`.
- **No borrar médicos** con dependencias (citas/consultas/reviews): desactivar.
- **Sin `is_published`** → no aparecen en directorio público (pero sí en admin).
- **Sin `is_operational`** → no operan agenda (ven "Cuenta suspendida" en panel). Hoy NO controla visibilidad en directorio.
- **Validar con `vite build` real**, no solo `tsc --noEmit`.
- ~~**SMTP builtin de Supabase tiene rate limit de ~4 emails/h** — bloqueante para piloto público.~~ ✅ Resuelto en PR #46 con Resend (dominio `lucycare.app`).
- **NO commitear `service_role`** ni ningún JWT. Está rotado y el viejo invalidado, pero el repo es público.
- **NO commitear** la API key de Resend ni credenciales SMTP. Viven en Supabase Dashboard + password manager del owner.
- **Branches** con nombres cortos (`claude/<8-12 chars>`) para que Vercel no las trunque.

---

## 6. Archivos clave

**Docs (siempre leer antes de codear según el objetivo del día):**
- `CLAUDE.md` — guía rápida + sistema de diseño + tablero de decisiones.
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — este documento.
- `docs/HANDOFF_TOMA_DECISIONES_2.md` — handoff corto: decisiones cerradas + infra + próximos pasos.
- `docs/ESTADO_TECNICO.md` — ER/BD, matriz de reglas, flujos UI/UX.
- `docs/SECURITY_GATE_PILOTO.md` — auditoría de seguridad pre-piloto.
- `docs/CUENTA_DEMO_CAMILO.md` — cuenta demo oficial.
- `docs/FASE_4_AUTH_EMAIL.md` — guía Supabase URL/email config.
- `docs/SETUP_SMTP_RESEND.md` — Resend como SMTP custom (✅ live desde 2026-05-26).
- `docs/ANALISIS_RECLAMAR_PERFIL.md` — diseño del reclamo (Fase 2 ✅).
- `docs/ANALISIS_AUTH_MEDICO.md` — plan auth (PR-A ✅, PR-B en cola).
- `docs/ANALISIS_DIRECTORIO_INFORMATIVO.md` — modelo comercial directorio.
- `docs/ANALISIS_PACIENTE_GLOBAL.md` — modelo de paciente (Fase 1 ✅).
- `docs/ANALISIS_AFILIACION_MEDICO.md` — análisis del flujo "Solicitar afiliación" (Q1-Q10 ya cerradas).
- `docs/PLAN_AFILIACION_MEDICO.md` — plan operativo Fase 1 + Fase 2.
- `docs/PLAN_PILOTO_5_MEDICOS.md` — checklist piloto.

**Migraciones Sprint 7 + pre-piloto (todas aplicadas):**
- `s7_01_admin_foundation.sql`
- `s7_02_admin_doctors.sql`
- `s7_03_unify_verified_with_lucy_status.sql`
- `s7_04_admin_doctors_search_paginate.sql`
- `s7_05_admin_edit_doctor.sql`
- `s7_06_fix_clinic_update.sql`
- `s7_07_clinics_updated_at_column.sql`
- `s7_08_services_delete_policy.sql`
- `s7_09_block_inactive_service_appointment.sql`
- `s7_10_patient_document_nullable.sql`
- `s7_11_normalize_patient_phone.sql`
- `s7_12_admin_services.sql`
- `s7_13_secure_claim_doctor_profile.sql`
- `s7_14_avatars_bucket_and_audit.sql`
- `s7_15_audit_reviews_trigger.sql`
- `s7_16_profiles_rls_hardening.sql`
- `s7_16b_drop_legacy_profile_policies.sql`
- `s7_17_deactivate_seed_doctors.sql`
- `s7_18_waitlist_entries.sql`
- `s7_19_waitlist_pending_count_by_doctor.sql`
- `s7_20_patient_global_phase1.sql`
- `s7_21_doctor_affiliation_requests.sql` (Afiliación Fase 1)
- `s7_22_admin_approve_and_create_doctor.sql` (Afiliación Fase 2)
- `s7_23_admin_approve_email_override.sql` (email override Fase 2)
- `s7_24_affiliation_fase2_fixes.sql` (fixes post-smoke: role=patient pre-claim, clinic name, dept/muni en list RPC — PR #61)
- `s7_25_admin_doctor_location.sql` (ubicación estructurada Depto/Municipio en ficha admin + regla P0004 — PR #64)
- `s7_26_clinical_rls_assistant_gate.sql` (gate clínico del asistente: cfh + vitals doctor-scoped — PR #67)
- `s7_27_team_seat_limit.sql` (límite de 2 asistentes: team_seat_limit/used + trigger + accept revalida; fix cast enum del accept — PR #70)
- `s7_28_signed_consultation_immutability.sql` (inmutabilidad Etapa A: RPC sign_consultation + RLS endurecida signed_at IS NULL — PR #74)
- `s7_29_consultation_amendments.sql` (corrección controlada Etapa B1: consultation_amendments + versionado recetas + RPC amend_consultation + bypass app.amending — PR #76)
- `s7_30_amendment_affects_prescriptions.sql` (columna `affects_prescriptions`: distingue adenda de texto vs receta para la marca de impresión — PR #81)
- `s7_31_amend_clinical_blocks.sql` (amend extendido a diagnósticos/antecedentes/vitales + inmutabilidad de `vitals` de citas con consulta firmada — PR #84)
- `s7_32_patient_global_phase2_profiles.sql` (Paciente Global F2: identidad global en `profiles` — DUI/DOB/género/dpto/muni + UNIQUE parcial documento + UPDATE column-restricted + coherencia muni-depto P0004 + audit — PR #87)
- `s7_33_patient_global_phase3_sync.sql` (Paciente Global F3: guard BEFORE UPDATE en `patients` P0030 + sync espejo AFTER UPDATE `profiles→patients` + claim copia identidad global→local — PR #90)
- `s7_34_phone_change_sync.sql` (cambio de teléfono por OTP: trigger `AFTER UPDATE OF phone ON auth.users` → sincroniza `profiles.phone` + `patients.phone` vinculados, bypass del guard, audit `phone_change` — PR #93)
- `s7_35_patient_match_candidates.sql` (Paciente Global F5: RPC `find_patient_match_candidates` `SECURITY DEFINER` para dedup preventivo — intra-clínica con detalle, cross-clínica/global solo señal mínima sin PII, gate `is_clinic_member`/`is_admin` P0001 — PR #99)
- `s7_36_invitation_lifecycle.sql` (Mi equipo F2: `invitation_ttl()` 14d + `clinic_invitations.expires_at` + `team_seats_used` excluye vencidas + `accept_clinic_invitations` ignora vencidas + RPC `resend_invitation` titular/revalida cupo/extiende — PR #102)
- `s7_37_clinical_snapshots.sql` (Catálogos: snapshot histórico de nombre en `prescriptions`/`consultation_diagnoses` + triggers BEFORE INSERT + backfill — PR #106)
- `s7_38_global_personal_catalog.sql` (Catálogos: `diagnoses`/`medications.doctor_id` nullable=global + `doctor_catalog_hidden` + RLS reconstruida + `audit_catalog` — PR #107)
- `s7_39_catalog_migration_infra.sql` (Catálogos: `catalog_migration_map` + UNIQUE parcial sobre globales; migración de datos vía `scripts/migrate-catalog-base.mjs --apply` — PR #110/#111)
- `s7_40_normalize_phone_sv.sql` (Paciente Global F5 — helper `normalize_phone_sv` + RPC `find_patient_match_candidates` tolerante a teléfono crudo; checks `check-s7_40.mjs` + `_smoke-s7_40.mjs` — PR #118)
- `s7_41_admin_list_waitlist.sql` (Lista de espera global — RPC `admin_list_waitlist` cross-médicos; checks `check-s7_41.mjs` + `_smoke-s7_41.mjs` 10/10 — PR #120)
- `s7_42_affiliation_existing_user.sql` (Afiliación médico desde paciente existente — `_affiliation_classify` + `admin_affiliation_preflight` + create reescrita; checks `check-s7_42.mjs` + `_smoke-s7_42.mjs` 12/12 — PR #122)
- `s7_43_patient_link_confirm.sql` (B2 Confirmación post-claim — `link_confirmed_at` + `patient_link_rejections` + RPCs confirm/reject + claim sin re-link de rechazados; checks `check-s7_43.mjs` + `_smoke-s7_43.mjs` 14/14 — PR #128)
- `s7_44_platform_admins.sql` (Administración de LucyAdmins F1 — registro de ciclo de vida + 4 RPCs + guard último admin; checks `check-s7_44.mjs` + `_smoke-s7_44.mjs` 24/24 — PR #132)

**Scripts** (`/scripts/`):
- `_lib/env.mjs`, `_lib/supabase-admin.mjs`, `_lib/supabase-anon.mjs` — infra.
- `check-s7_NN.mjs` — verificador por migración.
- `setup-test-patient.mjs` — datos paciente global Fase 1 (--apply --reset --clean).
- `import-doctors.mjs`, `_deactivate-demos.mjs`, `check-patient-documents.mjs`, etc.
- `scripts/README.md` — guía completa de uso.

**Frontend — secciones críticas:**

Public site:
- `src/pages/home/page.tsx` — directorio + filtros + login/register.
- `src/pages/doctor-detail/page.tsx` — detalle + booking + claim.
- `src/pages/doctor-detail/components/{BookingCard, LoginModal, ClaimProfileModal, ClaimProfilePromptCard, ClaimedProfileNoticeCard, WaitlistModal}.tsx`.

Paciente:
- `src/pages/paciente/MisAtencionesPage.tsx`.
- `src/components/{PatientAccountMenu, PatientHeader}.tsx`.
- `src/router/PatientOnlyRoute.tsx`.

Reset password:
- `src/pages/reset-password/ResetPasswordPage.tsx`.

Panel médico:
- `src/pages/panel/perfil/PerfilPage.tsx` (con AvatarUploader).
- Otros bajo `src/pages/panel/*`.

Admin:
- `src/pages/admin/{AdminLayout, AdminDoctorsPage, AdminDoctorEditPage}.tsx`.
- `src/pages/admin/components/{AdminDoctorServicesSection, AdminDoctorWaitlistSection}.tsx`.

Servicios:
- `src/services/{auth, directory, booking, patients, claimProfile, avatar, waitlist, patientHistory, admin, doctorProfile}.service.ts`.
- `src/hooks/useClinicContext.ts`.

Infra:
- `src/lib/{supabase, session, phone, document, errors}.ts`.
- `src/main.tsx` — bootstrap defensivo con timeout.

---

## 7. Cómo retomar en una ventana nueva

```
Continuamos LucyCare.

git fetch origin && git checkout main && git pull --ff-only
git log --oneline -10

Leé en este orden:
1. CLAUDE.md
2. docs/HANDOFF_LUCYCARE_SPRINT7.md
3. [docs/ANALISIS_*.md o docs/FASE_*.md según el objetivo]

Estado: PRs #1–#132 mergeados (HEAD 22bef3b o posterior), migraciones hasta s7_44 (aplicadas en Supabase; #118 = s7_40; #120 = s7_41; #122 = s7_42; #128 = s7_43; #132 = s7_44). **Administración LucyAdmins F1 #131+#132/s7_44 (cuenta dedicada, activación OTP, guard último admin, /admin/administradores). Navegación móvil LucyAdmin #130.** **Identidad múltiple: análisis #124 + Fase 1 #125 (lado paciente abierto a doctor/assistant + fix useDashboard + filtro explícito Mis atenciones).** **Ownership del paciente #127 (D1–D7) + B2 confirmación post-claim #128/s7_43 (por confirmar separado + confirm/reject por ficha + rechazos pending_review sin re-link; smoke 14/14).** SMTP Resend + dominio `lucycare.app` + Fase 4 PR-B ✅. Afiliación Fase 1+2 + smoke ✅ **+ alta de médico desde paciente existente (#122/s7_42)**. Gate clínico asistente ✅ (#67). **Frentes cerrados:** Correcciones post-firma COMPLETO (#74–#85, s7_28..s7_31); Paciente Global Fases 1–3 COMPLETO (#87/#88/#90/#91, s7_32/s7_33); Cambio de teléfono por OTP COMPLETO (#93/#94/#95, s7_34); Paciente Global Fase 5 dedup preventivo COMPLETO (#98/#99/#100, s7_35) **+ RPC tolerante a teléfono crudo (#118/s7_40)**; **Mi equipo Fases 0–2 COMPLETO** (#67/#70/#102/#103, s7_36); **Catálogos personalizados por médico — EJE 100% COMPLETO** (#105–#111 + #114, s7_37/s7_38/s7_39 + migración de base replicada: Base Lucy 127/736, "Míos" solo lo propio; **+ UI de LucyAdmin para Base Lucy global #114 `/admin/catalogos`, UI-only**); **Robustez PanelLayout/useClinicContext COMPLETO (#116, frontend-only):** `getSession()` quita el race + timeout/`.catch()`/estado recuperable + errores tipados; **Lista de espera global cross-médicos COMPLETO (#120/s7_41):** `/admin/lista-espera` + RPC `admin_list_waitlist` (filtros + paginación + total_count); **Afiliación médico desde paciente existente COMPLETO (#122/s7_42):** reuse_patient/block + preflight (no copia email del lead). Análisis pagos SaaS ✅ doc base (#62). Árbol limpio · build OK · tsc --noEmit OK.

Hoy hacemos: ___[siguiente frente a decidir — ninguno arrancado:
  1. Identidad múltiple Fase 2 (selector "modo paciente/modo médico" + capacidades derivadas + revisar claim; diseño en ANALISIS_ONBOARDING_IDENTIDAD_MULTIPLE.md);
  2. Paciente Global Fase 4 / B1 (merge admin de duplicados — grande/delicado, NO arrancar sin diseño propio; marco listo en ANALISIS_PACIENTE_GLOBAL_OWNERSHIP.md; el choque DUI/UNIQUE del claim quedó confirmado empíricamente en el smoke s7_43);
  3. Recuperación de acceso sin sesión (LucyAdmin/soporte — queda DETRÁS del modelo de identidad ya aprobado);
  4. Pasarela de pagos / IVA / DTE / Q1–Q11 (requiere validación del owner antes de código; desbloquea add-ons de asistentes de Mi equipo);
  5. Pendientes acotados (paginación del Home; hallazgo QA: accept_clinic_invitations compara teléfono literal).
]___
```

Eso es todo lo que necesito para entrar en contexto.
