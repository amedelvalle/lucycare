# HANDOFF LucyCare — Toma de decisiones 2

> Documento breve de continuidad para nuevas ventanas/contextos de
> LucyCare. Enfocado en **decisiones tomadas, estado actual, PRs
> cerrados y próximos pasos** — no reemplaza al snapshot completo
> (`docs/HANDOFF_LUCYCARE_SPRINT7.md`) ni a los análisis vivos
> (`docs/ANALISIS_*.md`).
>
> **Snapshot 2026-06-04** (eje **Correcciones post-firma cerrado para texto + receta**: PRs #79 filtro `is_current`, #80 marca impresión, #81 distinción texto/receta `s7_30`, #82 UI completa; único pendiente B1.5 no bloqueante. Previo: Afiliación Fase 2 + smoke ✅; fixes PR #61/`s7_24`; análisis pagos SaaS PR #62; fix orden Home PR #63; ubicación estructurada admin PR #64/`s7_25` ✅ live).
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

`main` HEAD esperado: `2a878f1` o posterior, **PRs #1–#82 mergeados**. Migraciones hasta `s7_30` (aplicadas en Supabase). #67 gate clínico (`s7_26`), #70 Mi equipo Fase 1 (`s7_27`), #72 análisis correcciones, #73 plan Fase 0, #74 Etapa A inmutabilidad (`s7_28`), #76 Etapa B1 corrección controlada (`s7_29`), #79 filtro `is_current`, #80 marca impresión, #81 distinción texto/receta (`s7_30`), #82 UI completa.

**Correcciones post-firma — eje cerrado para TEXTO + RECETA (PRs #74, #76, #79, #80, #81, #82):**
- **A (PR #74, `s7_28`):** sin edición silenciosa por API. Firma vía RPC `sign_consultation()` + RLS endurecida (`signed_at IS NULL`). Sync cita→atendida y borradores sin regresión.
- **B1 (PR #76, `s7_29`):** corrección controlada vía RPC `amend_consultation()` (definer + bypass `app.amending`). `consultation_amendments` append-only + **motivo obligatorio** + **snapshots before/after** + **versionado de recetas** (anterior `is_current=false` histórica + **v2** vigente) + **solo médico dueño** + **campos prohibidos rechazados (P0013)** + audit. UPDATE directo de firmada sigue bloqueado; asistente bloqueado.
- **Impresión (PRs #79/#80/#81, `s7_30`):** lecturas/impresión filtran `is_current=true` (no duplican v1+v2, #79); banner "RECETA CORREGIDA · fecha" + "Corrección vN" por medicamento (#80); columna `affects_prescriptions` (#81/`s7_30`) → la marca se dispara **solo** si la corrección tocó receta, no por texto.
- **UI completa (PR #82):** modal "Corregir consulta firmada" con secciones **Texto** + **Receta** (editar/sustituir/agregar/quitar medicamento), **un motivo obligatorio**, **una llamada atómica** a `amend_consultation` (texto + `prescription_ops`), **confirmación reforzada** para receta, mensaje visible "No hay cambios para guardar", historial de adendas. Validado visualmente por el owner.
- **Bugs corregidos en el camino (B1):** bypass del guard `prevent_signed_consultation_edit` vía GUC `app.amending`; cast del enum `duration_unit` en el versionado; `corrected_by = auth.uid()`.
- ⏳ **Único pendiente: B1.5** (extender amend a **diagnósticos / antecedentes familiares estructurados / signos vitales** — el snapshot ya los captura; falta el "apply" + UI). **NO bloquea** el flujo principal texto + receta, que ya está live.

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
- **Error handling en PanelLayout / useClinicContext** — si `useClinicContext` falla (retry agotado), el spinner queda permanente.

### 6.2 Otros backlog
- Vista global `/admin/lista-espera` cross-médicos con filtros.
- Sección "Lista de espera" en panel del médico (RLS ya permite, falta UI).
- Perfil paciente extendido — Paciente Global Fase 2 (DUI, DOB, género, dpto, muni).
- Read-only datos personales para médico cuando el paciente reclamó — Paciente Global Fase 3.
- Merge admin de duplicados — Paciente Global Fase 4.
- Dedup preventivo cross-clinic al crear paciente desde walk-in — Paciente Global Fase 5.
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

### Luego confirmar
- **HEAD final actual:** `2a878f1` (o posterior).
- **PRs mergeados hasta #82.**
- **Migraciones aplicadas hasta `s7_30`** (en Supabase).
- **Árbol limpio.**
- **Cuál será el siguiente frente a trabajar** (ver opciones abajo).

**No codificar nada hasta confirmar ese estado.**

### Estado consolidado al cierre (qué está ✅ y qué ⏳)
- **Infra:** dominio principal `https://lucycare.app`; `lucycare.vercel.app` = fallback temporal (no desactivar). SMTP Resend live.
- **Afiliación médica ✅ end-to-end:** Fase 1 (solicitud pública + bandeja admin) + Fase 2 (LucyAdmin convierte lead aprobado en médico `listed_only`) + smoke (lead→médico→claim→`claimed`). **Decisión cerrada (no reabrir):** el médico creado por afiliación nace `profile.role='patient'` pre-claim y se promueve a `doctor` solo al reclamar.
- **Home/directorio ✅:** PR #63 cerró el bug de "Ordenar por" (se quitó "Más cercanos"); quedan "Disponibilidad/Mejor coincidencia" y "Mejor valorados". Cercanía real = backlog (requiere lat/lng en `clinics` + ubicación del usuario + UX/privacidad).
- **Ubicación estructurada ✅ live (PR #64/`s7_25`):** LucyAdmin > Médicos > Editar edita Depto/Municipio (listas del Home), guarda `clinics.department_id/municipality_id` (filtran el Home); regla **P0004** (publicados/operativos requieren ubicación). Los publicados pendientes ya los completó el owner.
- **Mi equipo ✅ Fase 1:** gate clínico del asistente (PR #67/`s7_26`), límite base 1 titular + 2 asistentes (PR #70/`s7_27`, conteo activos+pendientes, enforcement server-side, bug de `accept_clinic_invitations` corregido). `assistant` = operativo/no clínico (no lee/escribe `vitals` ni `consultation_family_history`; ya estaba bloqueado en consultas/recetas/diagnósticos/firma). ⏳ Fase 2 (expiración/reenvío) + add-ons (dependen de pagos).
- **Correcciones post-firma ✅ cerrado para TEXTO + RECETA:** Etapa A inmutabilidad (PR #74/`s7_28`) + B1 corrección controlada (PR #76/`s7_29`) + impresión (PRs #79 filtro `is_current`, #80 banner "RECETA CORREGIDA" + "Corrección vN", #81/`s7_30` distinción texto vs receta vía `affects_prescriptions`) + **UI completa (PR #82): modal "Corregir consulta firmada" con Texto + Receta, motivo obligatorio, confirmación reforzada para receta, historial de adendas, sin edición silenciosa, receta anterior histórica + vigente imprimible**. ⏳ **Único pendiente: B1.5** (diagnósticos / antecedentes familiares estructurados / signos vitales) — **NO bloquea** el flujo texto + receta ya live.
- **Pagos SaaS ⏳ solo análisis (PR #62):** modelo preliminar $55/mes · $594/año · 1 titular + 2 asistentes · adicional $5/mes. **Stripe = candidato, NO cerrado.** El owner debe validar pasarela viable para El Salvador + IVA + DTE/facturación + Q1–Q11 **antes** de cualquier código de pagos.
- **Paciente Global / DUI ⏳ pendiente prioritario de análisis:** paciente global único + ficha local por clínica/médico (médico/asistente puede crear paciente sin obligar registro previo); DUI como identificador fuerte (probablemente progresivo en MVP); no sobrescribir identidad global sin trazabilidad; analizar dedup/merge/auditoría/maestros-vs-locales. Base: `docs/ANALISIS_PACIENTE_GLOBAL.md` (Fase 1 ✅ live; Fases 2-5 en cola).

### Próximos frentes (backlog, elegir uno)
- **Correcciones firmadas: B1.5** — extender `amend_consultation` a diagnósticos / antecedentes familiares estructurados / signos vitales (cierra completamente el eje clínico; no bloqueante).
- Pasarela de pagos / IVA / DTE / Q1–Q11 (desbloquea add-ons de equipo + suscripción SaaS).
- Paciente Global / DUI (análisis Fase 2+).
- Mi equipo Fase 2 (expiración/reenvío de invitaciones).
- Paciente Global / DUI (análisis).
- PanelLayout/useClinicContext: causa raíz del fallo de primera carga (hoy mitigado con "Reintentar").
- Catálogos personalizados por médico (diagnósticos/medicamentos); paginación del Home; foto/avatar del médico; self-service de recuperación de acceso médico.

---

## REGLA OPERATIVA (owner vs dev)

Las **tareas manuales en LucyAdmin, dashboards o validaciones operativas las hace el owner/usuario**, salvo que se indique explícitamente que las haga el dev. Ejemplos del owner: completar datos desde LucyAdmin, validar opciones visuales en el navegador, probar flujos con OTP, aplicar decisiones comerciales, validar pasarela/IVA/DTE/temas legales.

El **dev** verifica (DB/audit), documenta, audita e **implementa cuando se le indique** — pero **no asume** tareas manuales operativas del owner. (También registrado en la memoria del proyecto: `convention_admin_tasks_owner`.)
