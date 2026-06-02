# HANDOFF LucyCare — Toma de decisiones 2

> Documento breve de continuidad para nuevas ventanas/contextos de
> LucyCare. Enfocado en **decisiones tomadas, estado actual, PRs
> cerrados y próximos pasos** — no reemplaza al snapshot completo
> (`docs/HANDOFF_LUCYCARE_SPRINT7.md`) ni a los análisis vivos
> (`docs/ANALISIS_*.md`).
>
> **Snapshot 2026-06-01** (Afiliación Fase 2 + smoke ✅; fixes PR #61/`s7_24`; análisis pagos SaaS PR #62; fix orden Home PR #63; ubicación estructurada admin PR #64/`s7_25` ✅ live).
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

`main` HEAD esperado: `9f6c6bf` o posterior, **PRs #1–#67 mergeados**. Migraciones hasta `s7_26` (aplicadas en Supabase). #62 análisis pagos (doc), #63 fix orden Home, #64 ubicación estructurada admin (`s7_25`, live), #66 análisis Mi equipo, #67 gate clínico del asistente (`s7_26`).

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
- **Mi equipo / invitados del médico** — máximo inicial sugerido **2 asistentes**.
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

Para continuar LucyCare, leer primero:
1. `CLAUDE.md`
2. `docs/HANDOFF_LUCYCARE_SPRINT7.md`
3. `docs/HANDOFF_TOMA_DECISIONES_2.md`
4. `docs/ANALISIS_AFILIACION_MEDICO.md`
5. `docs/PLAN_AFILIACION_MEDICO.md`
6. `docs/ANALISIS_PACIENTE_GLOBAL.md`
7. `docs/SECURITY_GATE_PILOTO.md`

Luego confirmar:
- **HEAD actual** (esperado `9f6c6bf` o posterior).
- **PRs mergeados hasta #59.**
- **Migraciones aplicadas hasta `s7_26`** (`s7_24` vía PR #61; `s7_25` vía PR #64; `s7_26` vía PR #67, aplicadas en Supabase).
- **Smoke end-to-end de afiliación: ✅ COMPLETADO (2026-05-30)** — ver §5.1. Detectó 4 bugs corregidos en PR #61.
- **Ubicación estructurada admin: ✅ live (PR #64, `s7_25`).** Los 5 médicos publicados tienen Depto/Municipio cargados.

**No codificar nada hasta confirmar ese estado.**
