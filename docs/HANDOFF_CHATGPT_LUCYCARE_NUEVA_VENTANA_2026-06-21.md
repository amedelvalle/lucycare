# HANDOFF — Nueva ventana de contexto (2026-06-21)

> **PUNTO DE ENTRADA VIGENTE.** Leer ESTE documento primero; después `CLAUDE.md`
> y los `docs/ANALISIS_*.md` del objetivo del día. Reemplaza como punto de
> entrada a `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-06-18.md` (queda histórico).
> No asumir nada sin confirmar el estado real del repo.

---

## 1. Estado de `main` al cierre

- **HEAD de `main`:** `b5780dd` (*chore(cleanup): eliminar el scaffold anidado lucycare-code/ (dead code) (#204)*).
- **PRs mergeados:** **#1–#204**.
- **Migraciones aplicadas en Supabase:** hasta **`s7_51`** (aplicada y validada; ver §3). **#167–#204 NO agregaron migración nueva** (todos frontend-only o docs-only; ver §2bis–§2quinquies y §2sexies).
- **Frentes recientes #188–#204 (post-#187), todos frontend-only/docs-only, sin migración** — ver **§2sexies**: #190 fix overflow botón "Congreso/Capacitación"; #191 selector de hora propio (selects) en "Nuevo bloqueo"; #192 mapa condicional del perfil; #193 placeholders Depto/Muni del modal "Soy médico"; #196 subir foto desde galería + avatar en perfil público; #197 `license_number` fuera del payload público; #199 copy "Verificado por LucyCare"; #200 branding público emerald (`#3C2285`→emerald/teal); #201 logo local (`public/lucycare-logo.png`); **#202/#203/#204 cleanup de dead code** (`svLocations.ts` · clúster legacy de registro `DoctorRegistrationModal`/`DoctorInterestModal`/`doctorRegistration.service` · scaffold anidado **`lucycare-code/` ELIMINADO**). Docs-only: #188/#189 (cierres) y #194/#195/#198 (diseño de pagos SaaS §14–§17 + análisis credenciales JVPM/NUE → modelo futuro `doctor_credentials`). **Pago ≠ verified ≠ claimed; no mostrar JVPM/NUE; números nunca al payload público.**
- **`main == origin/main`** · **árbol limpio** · sin trabajo en curso EN MAIN.
- **`tsc --noEmit` OK · `npm run build` OK** en `main`.

> ⚠️ **Actualización (cierre #163):** este handoff se redactó con #163 abierto; **#163 quedó MERGEADO** y **`s7_51` aplicada/validada**. La rama `claude/panel-waitlist` fue borrada (local + remoto). §3–§5 quedan como **registro histórico** del frente, ya cerrado.

> ⚠️ **Actualización (post-#212, 2026-07-01):** el estado de §1 (HEAD `b5780dd` / PRs #1–#204 / `s7_51`) quedó desactualizado. **Estado real:** HEAD **`8598bec`** · **PRs #1–#212** · **migraciones hasta `s7_52`** · `main == origin/main`. Frente **"Slugs públicos + SEO del directorio" COMPLETO hasta Fase 3 PR C** (#206 header CTA · #207 docs Fase 0 · **#208/`s7_52`** backend `doctors.slug` · #209 routing UUID/slug · #210 diseño Fase 3 · **#211** middleware metadata/OG · **#212** `robots.txt`+`sitemap.xml`) — **validado en producción `lucycare.app`**. Fuente de verdad del frente: `docs/ANALISIS_SLUGS_SEO.md`. **Decisión vinculante:** la ubicación estructurada NO es requisito para indexar; criterio único `isSitemapEligible` (publicado+slug+nombre+especialidad+clínica) gobierna sitemap y `robots` del perfil, alineados. **Pendiente NO iniciado:** PR D (JSON-LD/canonical hardening/OG 1200×630) · Fase 4 (landings) · Analytics. Lo demás de este handoff sigue vigente como registro.

### 2bis. Serie correcciones clínicas / receta / PDF (#167–#172) — CERRADA, frontend-only, sin migración
Cierra los 5 puntos de las observaciones del owner sobre consulta/receta/PDF. **Ninguno agregó migración** (`s7_51` sin cambios).
- **#167 (PR-A)** — PDF de receta limpio: helper `doctorTitleName` (evita "Dr. Dr."/"Dra. Dra."), fechas emisión/corrección una sola vez en el encabezado, dosis **rotulada** (Dosis/Frecuencia/Duración/Indicaciones) sin inventar datos. Solo `RecetaPrint.tsx`.
- **#168 (PR-B)** — Diagnósticos sin Tipo/Estado en la UI (consulta + modal de corrección); quedan nombre + Notas; defaults internos `presuntivo`/`activo` por `addConsultationDiagnosis`; columnas/datos intactos.
- **#169 (PR-C)** — Orden en el modal de corrección de receta: "Agregar" arriba + nuevos arriba (solo display del modal; orden persistido y PDF **no cambian** — `prescriptions.id` es UUID).
- **#170 (PR-D)** — Peso en **libras** con almacenamiento interno en `weight_kg` (helpers `lbToKg`/`kgToLb`); IMC con kg; sin reinterpretar históricos.
- **#171 (PR-E1)** — Antecedentes familiares **texto libre** en consulta normal (ligado a `consultations.family_history_notes`); estructurados previos read-only; catálogo oculto para nuevos.
- **#172 (PR-E2)** — Corrección **post-firma** de antecedentes texto libre vía `p_consultation_changes`; **sin migración** porque `amend_consultation` (`s7_31`) ya whitelisteaba `family_history_notes`; estructurados read-only, sin `familyHistoryOps`.
- **Validación de la serie:** `tsc`+`build` por PR, fixtures aisladas / paciente demo (Pepe Toro), cleanup 0 residuales, preview + móvil 360/390/430, OK visual del owner por PR. **Regla vigente:** jamás Katherine ni datos reales sensibles, ni en read-only — usar fixtures aisladas o paciente demo.

> Otro cierre frontend-only post-#163: **#166** — fix del 400 del `NotificationBell` (la query usaba `appointments.cancelled_at` inexistente; se reescribió por `status_id`='cancelada' + `updated_at`). Sin migración.

### 2ter. Frente "Resumen rápido del paciente" (#174–#175) — CERRADO, frontend-only, sin migración
Ayuda breve dentro de la consulta para que el médico entienda en <10s su historia clínica con este paciente. **Ninguno agregó migración** (`s7_51` sin cambios); **sin DB, sin `database.types.ts`**. (#173 fue docs-only de cierre de la serie de correcciones #167–#172, **no** parte de este frente; #176 es el docs-only de cierre de este frente.)
- **#174 (PR-1) read model `PatientQuickSummary`** — `src/services/patientQuickSummary.service.ts` + `src/hooks/usePatientQuickSummary.ts`. **Read-only desde datos, sin UI.** Devuelve, del paciente **con este médico**: total de consultas **firmadas** previas, última atención + motivo, diagnósticos previos (distinct por recencia), **medicamentos permanentes/vigentes/relevantes** (reusa `getPermanentPrescriptionsForPatient`), notas relevantes (alergias/tipo de sangre/notas/`family_history_notes` reciente), últimos vitales (kg→lb) y brief de las últimas 3.
  - **Scoping crítico (seguridad):** gate de ROL **`isDoctorContext`** → `emptySummary()` **antes de cualquier query** si no es médico (un asistente trae `doctorId`, así que `doctorId` por sí solo **NO** basta y **no se consulta `patients`/alergias/sangre/notas**); filtro **EXPLÍCITO** por `patient_id` + `doctor_id` (defensa en profundidad sobre la RLS doctor-scoped); **SOLO `status='signed'`**; **excluye la consulta actual**; **payload vacío seguro** sin historia. **Nunca mezclar pacientes/médicos/clínicas/perfiles.**
  - Validado: `tsc`+`build` + **smoke 24/24** contra el módulo real (no-médico → 0 queries, no toca `patients`; médico bajo **sesión real de Camilo/RLS**).
- **#175 (PR-2) tarjeta UI `QuickSummaryCard.tsx`** — montada en `ConsultaPage.tsx` **debajo del header del paciente, antes de la evaluación clínica**. Tarjeta compacta: total de atenciones, última atención (fecha+motivo), chips de diagnósticos, chips de medicamentos vigentes, **alergias en amber** (único color de alerta), tipo de sangre, antecedente familiar, últimos vitales en **lb**, **"Ver últimas atenciones" colapsado** por defecto.
  - **Gate VISUAL:** se muestra **solo si `role==='doctor'`** (nunca asistente/admin/paciente/rol desconocido; `doctorId` solo NO es criterio), **solo si `hasHistory===true`**, y **se oculta ante payload vacío/inseguro o error/carga** (nunca un error técnico al médico).
  - Validado: `tsc`+`build` + **smoke SSR 16/16** (componente real: médico+historia → tarjeta con todo el contenido; asistente / rol undefined / `hasHistory=false` / error / carga → no se renderiza) + **preview en vivo bajo sesión real de Camilo (RLS)** sobre **paciente demo (Pepe Toro)** + móvil 360/390/430 sin overflow + 0 errores de consola + 0 residuales.
- **Regla de validación vinculante:** fixtures aisladas / paciente demo (Pepe Toro), **jamás Katherine ni datos reales sensibles**, ni en read-only.

### 2quater. Frente "Onboarding médico operativo V1" (#177–#178) — CERRADO, frontend-only, sin migración
Ayuda dentro del panel para que un médico **ya operativo** entienda qué le falta para quedar **visible y reservable**. **Alcance V1 = solo Gate 2 (configuración en panel); Gate 1 (reclamo/habilitación por LucyAdmin) queda FUERA de V1.** Ninguno agregó migración (`s7_51` sin cambios); **sin DB, sin `database.types.ts`**.
- **#177 (PR-1) read model `doctorActivation.service.ts` + hook `useDoctorActivation`** — `getDoctorActivation(doctorId, clinicId, isDoctorContext)` → `{ steps, completedCount, total, allDone, clinicStatus }`, read-only, sin UI. **Checklist principal = 5 pasos self-service** (cuentan para el progreso): (1) completar perfil (foto+especialidad), (2) configurar agenda/disponibilidad, (3) agregar servicios, (4) activar reserva en línea (`booking_enabled`), (5) revisar publicación / cómo lo ven los pacientes (`is_published`). `done` por **señal real** (reusa `getMyDoctorProfile`/`getMyAvailabilityRules`/`listDoctorServices` + query read-only de `clinics`).
  - **`clinicStatus` = info NO bloqueante** (`{ label, complete, actionable:false, href:null, message }`): la ubicación de la clínica solo la edita LucyAdmin (`admin_update_doctor_clinic`), así que **no es un paso del médico y NO suma ni resta progreso** (`allDone` depende solo de los 5).
  - **Scoping (igual que el resumen rápido):** gate de rol `isDoctorContext` → vacío seguro **antes de cualquier query** si no es médico (`doctorId` solo NO basta); verdad de la sesión (`getMyDoctorProfile`, RLS doctor-scoped); ids del caller solo como verificación de consistencia (mismatch → vacío sin leer clínica/agenda/servicios); nunca cross-médico/cross-clínica.
  - Validado: `tsc`+`build` + smoke 17/17 (no-médico/asistente → vacío sin queries; clínica incompleta NO bloquea `allDone`; sesión real de Camilo/RLS = 4/5, le falta foto).
- **#178 (PR-2) tarjeta UI `DoctorActivationCard.tsx`** — montada en el dashboard (`/panel`, **arriba de las métricas**). "Primeros pasos para activar tu perfil": progreso "**N de 5 pasos listos**" + barra, lista de los 5 pasos (listo/pendiente por señal real; pendiente → link directo), `clinicStatus` **discreto** (solo el mensaje de soporte si está incompleta; si completa se omite).
  - **Gate VISUAL:** solo `role==='doctor'` (nunca asistente/admin/paciente/null; `doctorId` solo NO es criterio), **se oculta si `allDone`** (V1: no dejar 5/5 fijo), payload vacío, error o carga.
  - **Reemplaza** el banner de "Completá tu perfil con una foto" (la foto es parte del paso "Completá tu perfil") → sin duplicar.
  - Validado: `tsc`+`build` + smoke SSR 13/13 (gates negativos) + preview en vivo bajo sesión real de Camilo (RLS) → 4/5, móvil 360/390/430 sin overflow, 0 errores de consola.
- **Regla de validación vinculante:** fixtures aisladas / paciente demo (Camilo/Pepe Toro), **jamás Katherine ni datos reales sensibles**.

### 2quinquies. Frente "Perfil público / visibilidad comercial" (#180–#184, #187) — CERRADO, frontend-only, sin migración
Mejoras públicas de conversión en directorio/Home + perfil del médico. Ninguno agregó migración (`s7_51` sin cambios); **sin DB, sin `database.types.ts`**.
- **#180 — CTA "Reservar cita" en la tarjeta (`DoctorCard.tsx`):** reservable → "Agenda en línea" + CTA "Reservar cita" (navega a `/doctor/:id`); no reservable → "Ver perfil"; sin copy contradictorio; precio solo si >0 (sin `$0`). Fix: el CTA dependía de `nextAvailableSlot` hardcodeado a `undefined`.
- **#181 — contador honesto del Home:** título neutro "Médicos en Lucy" + conteo discreto "Mostrando X de Y médicos publicados · Z con agenda en línea"; variantes para búsqueda/toggle; sin claims inflados; `PAGE_SIZE=12` y "Mostrar más médicos" intactos.
- **#182 — limpieza copy/footer del Home:** hero honesto; "Acceso Gratuito" → "Búsqueda sin costo"; footer con año dinámico (sin "© 2024"), sin "Website Builder", sin links muertos, Privacidad → `/privacidad`, sin "Síguenos" (grid 4→3).
- **#183 — perfil público móvil más liviano:** en `/doctor/:id` móvil, reservable ya NO muestra el `BookingCard` inline arriba (lidera info/confianza); reserva desde barra fija → `MobileBookingSheet`; desktop conserva `BookingCard` sticky; no reservables conservan contacto/lista de espera (sin barra fija ni promesa); eliminado "Pago seguro • Confirmación inmediata" → "Reserva en línea · el pago se coordina con el médico" (Lucy no cobra en línea).
- **#184 — footer del perfil + "Compartir" funcional:** footer alineado con el Home; "Guardar" eliminado (no se simula); "Compartir" diferenciado por contexto (`matchMedia('(pointer: coarse)')` en el click): móvil/touch + `navigator.share` → share nativo; desktop o móvil sin share → copiar URL + toast "Enlace copiado" (no abre el panel del sistema en desktop); etiqueta desktop "Copiar enlace", ícono discreto en móvil.
- **#187 — card "Reclamar perfil" visible por viewer en perfiles `listed_only`** (`ClaimProfilePromptCard.tsx` + `doctor-detail/page.tsx`): antes se mostraba idéntica a todos (anónimo/paciente/admin) como bloque emerald destacado arriba del fold → ruido/desconfianza para el paciente. Ahora depende del viewer (mismo patrón `getSessionWithTimeout` que `ClaimedProfileNoticeCard`): **dueño logueado** (`auth.uid() === doctor.profileId`) → card completa arriba; **anónimo** → entrada **discreta** (link "¿Eres este profesional? Reclamá tu perfil") al final de la columna, fuera del 1er pantallazo, abre el mismo `ClaimProfileModal`; **otro autenticado no-dueño / mientras resuelve** → nada (sin flash). Gate **explícito** `isListedOnly` (`=== 'LISTED_ONLY'`) → un `lucy_status` faltante/null ya NO hace fail-open. Solo 2 `.tsx`; **sin DB/migraciones/`database.types.ts`/fixtures; no toca reserva/mapa/credenciales/Home/branding/`lucycare-code/`**. Estado "dueño logueado" validado por paridad de código (sin fixture DB). Pendiente de este frente que sigue VIVO: mapa condicional, señales de confianza/credenciales, branding emerald, assets del logo fuera de readdy, próximo-slot-real.
- **Validación del frente:** tsc+build verdes por PR · preview desktop + móvil 360/390/430 sin overflow · 0 errores de consola · 0 residuales · **directorio público / paciente demo (Camilo/Pepe Toro), jamás Katherine ni datos reales sensibles**.
- **Pendientes explícitos (backlog, NO implementado):** mapa condicional; card "Reclamar perfil" en perfiles públicos `listed_only`; señales de confianza / credenciales (decisión de privacidad sobre `license_number`); branding emerald unificado (quitar `#3C2285`); migrar assets del logo fuera de `static.readdy.ai`; próximo-slot-real en la tarjeta. **(Nota: NO existe un duplicado real `src/pages/Home/` — fue un artefacto de filesystem case-insensitive; descartado del backlog por verificación: `git ls-files 'src/pages/Home/'` vacío + `core.ignorecase=true`; el único Home es `src/pages/home/`.)**

### Arranque obligatorio
```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -5
git status --short
```
Confirmar: HEAD `b5780dd` o posterior · `main == origin/main` · árbol limpio.

---

### 2sexies. Frentes #188–#204 (post-#187) — CERRADOS, frontend-only/docs-only, sin migración

> Detalle completo en `CLAUDE.md` (snapshot post-#204). Resumen:
- **#188/#189** docs-only (cierre #187 + reconciliación de referencia de handoff).
- **#190** fix overflow del botón "Congreso/Capacitación" en "Tipo de bloqueo" (`BlockForm.tsx`).
- **#191** selector de hora propio (dos `<select>` hora/minuto cada 5') en "Nuevo bloqueo", reemplaza `<input type="time">`; valor interno sigue `HH:mm`.
- **#192** mapa condicional del perfil público: iframe solo con dirección útil; si no, link "Ver zona aproximada"; sin nada → "Sin ubicación". Sin lat/lng.
- **#193** placeholders Depto/Municipio del modal "Soy médico" (`AffiliationRequestModal`).
- **#196** subir foto **desde galería** (quita `capture="user"`) + avatar/iniciales en el header del perfil público.
- **#197** privacidad: `license_number` (JVPM) **fuera del payload público** (`fetchDoctorDetail`). Admin/claim/afiliación intactos.
- **#199** copy **"Verificado por LucyCare"** en el badge (detalle texto completo; tarjeta compacta + `title`). Solo verificados; sin afirmar JVPM/NUE.
- **#200** branding público emerald (`#3C2285` + `to-purple-50` → emerald/teal) en Home/perfil/LoginModal/ReviewsSection. Color-only.
- **#201** logo local: `public/lucycare-logo.png` + `src/lib/brand.ts` `LUCYCARE_LOGO_SRC` (11 refs en 6 archivos); favicon NO migrado (logo apaisado) → pendiente ícono cuadrado.
- **#202/#203/#204** cleanup de dead code (delete-only): `src/data/svLocations.ts`; clúster legacy de registro (`DoctorRegistrationModal`/`DoctorInterestModal`/`doctorRegistration.service`); **scaffold anidado `lucycare-code/` ELIMINADO** (38 archivos). `AffiliationRequestModal` + fuente DB-backed de ubicación intactos.
- **Docs de diseño (sin código):** **#194/#195** Pagos SaaS (`ANALISIS_PAGOS_SAAS_MEDICOS.md` §14 pricing aprobado $59/$601.80/$6/$61.20 + no-hardcodear + `subscription_plan_prices`; §15 autoservicio; §16 LucyAdmin Billing; §17 separación SaaS vs Billing; bloqueado por validación de pasarela §4.5 + Q1–Q11). **#198** credenciales (`ANALISIS_CREDENCIALES_MEDICAS.md`: solo `license_number`=JVPM, NO existe NUE, `is_verified` global; modelo futuro `doctor_credentials`). **Vinculante: pago ≠ verified ≠ claimed; no mostrar JVPM/NUE; números nunca al payload público.**

**Backlog vivo (post-#204):** favicon/ícono cuadrado · branding interno menor (índigo stat card panel + púrpura `AdminAffiliationDetailModal`) · semánticos "Fusionada"/"Congreso" (decidir) · token de marca · credenciales `doctor_credentials` F1–F5 · próximo-slot-real en la tarjeta · limpieza de ramas locales `claude/*` viejas (solo con OK). **Pagos: solo diseño, bloqueado por pasarela.**

---

## 2. Cierres recientes en `main` (frontend/docs, sin migración nueva)
- **#162** Paginación/Home — render incremental "Mostrar más médicos" (`PAGE_SIZE=12`, contador "Mostrando N de M", reset por filtros/búsqueda/orden/toggle). Frontend-only; NO es paginación server-side (búsqueda/completitud/orden por rating siguen en cliente). El fetch sigue trayendo el set completo (tope implícito PostgREST ~1000) → paginación server-side real = frente mayor futuro (requiere DB).
- **#161** docs consolidación a #160.
- **#160** Seguridad de sesión (frontend-only): cierre por inactividad + tope absoluto por rol + modal. Política admin 15min/8h · médico/asistente 30min/12h · paciente 60min/24h · aviso 90s. Fallback estricto rol desconocido (= admin). Logout robusto con limpieza de tokens `sb-*`. Override de tiempos solo `import.meta.env.DEV`.
- **#158/#159** Responsive móvil (Home / Panel-Citas-Calendario-Bloqueos).
- **#156 (`s7_50`)** `accept_clinic_invitations` tolerante a formato de teléfono.

Detalle completo de todo lo previo: `CLAUDE.md` + `docs/HANDOFF_LUCYCARE_SPRINT7.md`.

---

## 3. ✅ CERRADO: PR #163 — Mi lista de espera en panel médico/asistente (s7_51 LIVE)

- **PR:** `lucycare#163` — https://github.com/amedelvalle/lucycare/pull/163 — **MERGEADO** (squash, HEAD de `main` `352b44a`).
- **Rama:** `claude/panel-waitlist` — **borrada** (local + remoto) tras el merge.
- **Migración:** `migrations/s7_51_clinic_waitlist.sql` — **aplicada en Supabase y validada**.
- **Fix durante la validación:** `clinic_update_waitlist_entry` declaraba `v_old record` y el `SELECT … INTO v_old.status/…` abortaba toda actualización con `55000 record "v_old" is not assigned yet` → corregido a **`v_old waitlist_entries%ROWTYPE`** (idempotente, re-aplicada).
- **Validación completa:** `check-s7_51` 3/3 · `_smoke-s7_51` 9/9 (T1–T8) · cleanup 0 residuales (`F51_FIXTURE`) · **preview médico Y asistente con sesión real** (NavLink visible, `/panel/lista-espera` carga sin error, listado autorizado, cambio de estado, audit `edited_via='clinic'` con `contacted_by` correcto) · móvil 360/390/430 sin overflow · desktop sin regresión · tsc/build verdes · **0 datos reales tocados** (test user `50375000001` como asistente temporal, rol restaurado a `patient`; jamás Camilo ni Katherine).

> Lo que sigue en esta §3 (y §4–§5) es el **registro técnico/operativo histórico** del frente, ya cerrado. Se conserva como referencia.

### Archivos principales de #163 (en `claude/panel-waitlist`)
- `migrations/s7_51_clinic_waitlist.sql` — RPCs nuevas + helper de gate.
- `scripts/check-s7_51.mjs` — sanity.
- `scripts/_smoke-s7_51.mjs` — funcional (fixtures aisladas `F51_FIXTURE`).
- `src/types/database.types.ts` — firmas de las 2 RPCs nuevas.
- `src/services/waitlist.service.ts` — `clinicListWaitlist` / `clinicUpdateWaitlistEntry`.
- `src/router/config.tsx` — ruta `/panel/lista-espera`.
- `src/pages/panel/lista-espera/ListaEsperaPage.tsx` — página (mobile-first).
- `src/pages/panel/PanelLayout.tsx` — NavLink "Lista de espera".

### Backend de #163 (resumen técnico)
- 2 RPCs `SECURITY DEFINER` **paralelas** (NO tocan/ensanchan las `admin_*`):
  - `clinic_list_waitlist(p_doctor_id, p_status, p_limit, p_offset)` → pendientes primero + `total_count`.
  - `clinic_update_waitlist_entry(p_entry_id, p_status, p_notes)` → estado/nota + audit (`edited_via='clinic'`).
- Gate server-side (helper `_clinic_waitlist_authorize`): el caller debe ser el **médico dueño** (`get_user_doctor_id() = doctor_id`) **o miembro de la clínica** (`is_clinic_member(clinic)`). **No confía en el `doctor_id` del cliente.** Sin cross-clínica/cross-médico. Estados `pending`/`contacted`/`cancelled`.
- **No** toca esquema de `waitlist_entries`, RLS existente, `submit_waitlist_entry` (público), dedup, ni RPCs `admin_*`. Sin columnas nuevas.

---

## 4. Alcance APROBADO de #163 (V1)
- **Médico + asistente** ven la lista del médico (propia / autorizada por su clínica).
- Acciones: **ver**, **filtrar por estado**, **marcar contactado**, **volver a pendiente**, **cancelar/descartar**, **nota interna**.
- **Contacto manual:** Llamar (`tel:`), WhatsApp (`wa.me`), copiar teléfono — usando el teléfono ya registrado.
- **NO** entra en V1: "agendar" (crear cita / walk-in prefilled) → follow-up posterior.
- **NO** mensajería automática (SMS/WhatsApp auto).
- **NO** toca: admin global (`/admin/lista-espera`, badges, RPCs `admin_*`), `submit_waitlist_entry`, dedup, F4-D, pagos, recuperación sin sesión, identidad múltiple, Backstop Auth, seguridad de sesión, Katherine.

---

## 5. Qué debe hacer el OWNER en la nueva ventana antes de continuar #163
1. **Aplicar la migración** en Supabase → SQL Editor: pegar el contenido de `migrations/s7_51_clinic_waitlist.sql` (de la rama `claude/panel-waitlist`) → **Run**. Es idempotente (`CREATE OR REPLACE`).
2. **Confirmar al dev** que `s7_51` quedó aplicada.
3. Pedir al dev correr (con la rama `claude/panel-waitlist` checked out):
   - `node scripts/check-s7_51.mjs`
   - `node scripts/_smoke-s7_51.mjs`
4. **Validar preview** del PR #163 logueado como **médico** y como **asistente** (ruta `/panel/lista-espera`).
5. **Validar móvil** 360 / 390 / 430 px (sin overflow) + desktop sin regresión.
6. **Solo después** de check verde + smoke verde + OK visual/funcional → decidir **merge** de #163.

> Nota: el preview funcional del PR #163 **requiere `s7_51` aplicada** (la página llama a `clinic_list_waitlist`); sin la migración, la página mostrará error de RPC inexistente.

---

## 6. Restricciones vigentes (vinculantes)
- **No tocar datos reales.** **No tocar Katherine / `50372608827`.**
- **No tocar Camilo** (`db1fba98…` / `783a902a…`) salvo el patrón de test ya descrito (sesión OTP de solo lectura + fixtures aisladas + membresía de asistente temporal removida), **sin mutar datos reales**.
- Validar siempre con **fixtures aisladas `F51_FIXTURE`** y **cleanup a 0 residuales**.
- **No abrir otro frente** antes de cerrar o pausar explícitamente #163.
- F4-D diferido (no abrir sin análisis aprobado). No tocar `profiles`/`auth.users`/identidad global sin diseño aprobado.
- El owner aplica el SQL en Supabase; el dev entrega SQL + corre check/smoke + documenta.

### Backstop Supabase Auth (frente CONGELADO, sin acción)
Pendiente: el owner debe confirmar en Dashboard → Authentication → Sessions si existen "Time-box user sessions" / "Inactivity timeout" (gating de plan) y sus valores. Decisión provisional (NO aplicada): Time-box 24h · Inactivity 24h · Single session OFF · JWT 1h · refresh rotation ON. Global (no por rol); la política por rol la cubre el frontend (#160).

---

## 7. Acceso para QA (Test Phones — Supabase Dashboard)
- **Médico demo (Camilo):** `50378627694` / OTP `123456`. doctor_id `783a902a-55fd-407c-9e0a-69568135c7f5`, clinic `8ea0fd8f-87a9-45f9-8f4e-f358764f58c0`.
- **Admin plataforma:** `50378056365` / OTP `123456`.
- **Paciente test:** `50375000001` / OTP `123456` (usado como asistente temporal en el smoke de #163, removido en cleanup).

---

## 8. PROMPT PARA PEGAR EN LA NUEVA VENTANA DE CHATGPT

```
Continuamos LucyCare en una ventana nueva.

Sincronizá y confirmá estado:
  git fetch origin && git checkout main && git pull --ff-only origin main
  git log --oneline -5 && git status --short

Estado esperado de main:
- HEAD b5780dd · PRs #1–#204 · migraciones aplicadas hasta s7_51.
- main == origin/main · árbol limpio.
- tsc --noEmit OK · npm run build OK.

Leé en este orden:
1. docs/HANDOFF_CHATGPT_LUCYCARE_NUEVA_VENTANA_2026-06-21.md  (PUNTO DE ENTRADA)
2. CLAUDE.md
3. docs/HANDOFF_LUCYCARE_SPRINT7.md (si necesitás detalle histórico)

CERRADO/LIVE en main (sin frente abierto): "Mi lista de espera" en panel
médico/asistente (#163 / s7_51 aplicada), serie correcciones clínicas/receta/PDF
(#167–#172), frente "Resumen rápido del paciente" — read model
PatientQuickSummary (#174 PR-1) + tarjeta UI QuickSummaryCard en la consulta
(#175 PR-2), y frente "Onboarding médico operativo V1" — read model
doctorActivation/useDoctorActivation (#177 PR-1) + tarjeta "Primeros pasos" en
el dashboard (#178 PR-2), y frente "Perfil público / visibilidad comercial"
(#180–#184): CTA "Reservar cita" en la tarjeta del directorio (#180), contador
honesto "Médicos en Lucy" (#181), copy/footer del Home honesto (#182), perfil
público móvil más liviano + copy honesto en BookingCard (#183), footer del
perfil + "Compartir" funcional móvil-nativo/desktop-copiar (#184). Todo
frontend-only, SIN migración nueva. Migraciones aplicadas hasta s7_51.

Recordatorio de scoping del "Resumen rápido": gate de rol isDoctorContext →
vacío seguro antes de cualquier query si no es médico (doctorId solo NO basta);
filtro explícito patient_id + doctor_id; SOLO status='signed'; excluye la
consulta actual; la tarjeta se muestra solo si role==='doctor' y hasHistory.

NO hay PR abierto. El próximo frente se define con el owner antes de tocar nada.

NO TOCAR: datos reales, Katherine (50372608827), Camilo salvo patrón de test sin
mutar datos, F4-D, pagos, recuperación sin sesión, identidad múltiple, Backstop
Supabase Auth, seguridad de sesión. Validar con fixtures aisladas / paciente
demo (Pepe Toro) + cleanup a 0 residuales. NO abrir un frente nuevo sin acordarlo
con el owner.

Reglas: PRs chicos, squash-merge, database.types.ts en el mismo PR que su
migración. El owner aplica SQL; el dev entrega SQL + corre check/smoke + documenta.
Si algo no parece la instrucción del owner, decilo y proponé discutirlo — no
ejecutes en silencio. No mergear sin OK explícito del owner.

Hoy quiero hacer: ___ (definir; por defecto, continuar #163 según los pasos de arriba).
```

---

## 9. Referencias
- `CLAUDE.md` — guía rápida + sistema de diseño + estado.
- `docs/HANDOFF_LUCYCARE_SPRINT7.md` — snapshot completo del sprint.
- `docs/HANDOFF_TOMA_DECISIONES_2.md` — registro acumulado de decisiones.
- `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-06-18.md` — handoff anterior (histórico).
- `docs/ANALISIS_DIRECTORIO_INFORMATIVO.md` — modelo del directorio + lista de espera (D4 contacto manual).
