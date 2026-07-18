# HANDOFF — Nueva ventana de contexto (2026-07-14, post-PR #277)

> **PUNTO DE ENTRADA VIGENTE.** Leer este primero. Reemplaza como handoff
> operativo al `2026-07-13` (que queda histórico). El detalle histórico
> completo sigue en `CLAUDE.md`.
>
> ⚠️ **El cuerpo de este documento es un snapshot de 2026-07-14 (HEAD `2a02aaf`,
> PRs hasta #284, migraciones hasta `s7_59`). NO refleja el estado actual.**
> El estado vigente está en el **§0 (addendum)** justo abajo y en `CLAUDE.md`.
> Lo de abajo sigue siendo válido como *detalle* del eje clínico F1–F7 y de
> SEO/Perf; solo está desactualizado en el snapshot de §1 y en los pendientes
> de §4.

---

## 0. ADDENDUM — estado vigente (2026-07-18, post-PR #292)

- **HEAD de `main`:** **`09bf39c`** · **PRs mergeados: #1–#292** ·
  **migraciones aplicadas hasta `s7_62`** · `main == origin/main` · árbol
  limpio · **0 PRs abiertos** · sin preview · sin servers · sin fixtures ·
  **sin frente activo**.

### 0.0 · 🔑 `doctor_credentials` — F1-a y F1-b CERRADAS (#291, #292)

Es el cierre estructural (en curso) del riesgo residual de `s7_60` (§0.2). **El
problema de fondo:** `doctors.license_number` es un **secreto viviendo en una
tabla legible por fila** — la RLS de `doctors` filtra **filas, no columnas**, así
que cualquier grant de columna se filtra a todo el rol. El arreglo correcto no
es parchear permisos: es **mover el secreto** a una tabla cuyas **filas** solo ve
su dueño y el owner admin.

**F1-a · #291 / `s7_61` — MODELO (aditiva, sin lectores).**
- Enums `credential_type` (`JVPM`/`NUE`/`OTHER`) + `credential_status`
  (`pending`/`verified`/`rejected`); tabla **`doctor_credentials`** con
  `value_normalized` GENERATED (espejo exacto de la normalización de `s7_13`).
- **RLS por fila:** `is_admin() OR doctor_id = get_user_doctor_id()`.
  `anon` **sin acceso**; `authenticated` con SELECT filtrado por RLS y **sin
  INSERT/UPDATE/DELETE** (nadie escribe directo). `directory_editor` **no ve**
  credenciales.
- **Índice antifraude parcial:** `UNIQUE(type, value_normalized) WHERE type IN
  ('JVPM','NUE') AND status <> 'rejected'`. El `status <> 'rejected'` es
  **crítico**: sin él, un JVPM ajeno **rechazado** bloquearía para siempre al
  dueño legítimo — el antifraude terminaría protegiendo al fraude.
- **Audit con el `value` REDACTADO** (+ booleano `value_changed`): el patrón
  habitual habría metido el JVPM en texto plano en `audit_log`.
- **Backfill de 114** credenciales JVPM en **`pending`** (nunca existió
  verificación por credencial; `is_verified` global es otra cosa y no se toca).
- **Trigger de sync** `doctors.license_number → doctor_credentials` (dual-write).
  Se eligió trigger y **no** dual-write dentro de la RPC de afiliación porque esa
  RPC **no es el único escritor** (también `import-doctors.mjs` y scripts con
  `service_role`), y re-emitir `s7_42` (430 líneas) arriesgaba regresión a cambio
  de **menos** cobertura. Precedente: `sync_phone_to_identity` (`s7_34`).
- **Fix durante la aplicación:** `audit_log.user_id` es NOT NULL y `auth.uid()`
  es NULL en el SQL Editor / con `service_role` → el audit atribuye al **sujeto**
  (`COALESCE(auth.uid(), doctors.profile_id)`) y marca el origen en
  **`actor_source`** (`session`/`system`), para no fingir una acción humana. Sin
  eso, `s7_61` habría roto `import-doctors.mjs`.
- Verificación: `check-s7_61` **5/5** + `_smoke-s7_61` **22/22**.

**F1-b · #292 / `s7_62` — CUTOVER DE LECTORES.**
- Dos `CREATE OR REPLACE` (mismas firmas, retrocompatibles):
  **`claim_doctor_profile`** — cuerpo **verbatim de `s7_13`** salvo la sección 5
  (verificado con diff; `s7_13` es su único `CREATE OR REPLACE` en
  `migrations/`). Valida contra la credencial **sin devolver nunca el valor**;
  `P0001`–`P0005`, OTP, TOS, roles y audit **idénticos**.
  **`sync_license_to_credential`** — mapea **solo** la colisión de
  `doctor_credentials_registry_uniq` al P-code estable **`P0091`** (vía
  `GET STACKED DIAGNOSTICS … CONSTRAINT_NAME` — el item es `CONSTRAINT_NAME`,
  **sin** prefijo `PG_`); **cualquier otro `unique_violation` se re-lanza intacto**.
- **Frontend (3 archivos):** `getMyDoctorProfile` (panel) y
  `getConsultationContext` (receta) leen el embed
  `doctor_credentials(value, type, status)` y resuelven con el helper compartido
  **`resolveJvpm`**; `mapCreateError` traduce `P0091` a copy claro en la bandeja
  de afiliación. **`RecetaPrint` NO se tocó.**

> **REGLA VINCULANTE DE LECTURA (panel · receta · claim):**
> **`pending` y `verified` → la credencial SE USA.**
> **`rejected` → NO se usa y NO cae a la columna** (existe una fila: su estado manda).
> **Fallback a `doctors.license_number` SOLO si NO existe fila JVPM** — nunca
> para evadir un estado.

- **Validación:** `check-s7_62` **2/2** · `_smoke-s7_62` **E2E 13/13** (R1/R2
  embed+RLS · **C1a** `claim(typed=COLUMNA)`→`P0007` y **C1b**
  `claim(typed=CREDENCIAL)`→éxito — el **desync** que prueba de qué tabla lee ·
  **J1** `rejected`→`P0006` aunque la columna coincida · J2–J5 regla+datos ·
  **P1** duplicado→`P0091` / **P2** otra constraint→23505 propio) · **QA visual
  7/7 en superficies reales** (panel y receta × `pending`/`verified`/`rejected`/
  fallback, con valores distintos por fuente para distinguirlas a simple vista) ·
  cleanup **0 residuos operativos**, Test Phone liberado, `doctor_credentials` en
  **114**, **auditoría append-only preservada**.

**⚠️ F1-b NO cierra el riesgo residual.** La columna `doctors.license_number`
**sigue existiendo**, con **dual-write y fallback activos**, y `authenticated`
**conserva su `SELECT`**. Eso lo cierra **F1-c** (§0.4).

### 0.1 · 🔒 SEGURIDAD — `s7_60`, hardening de grants sobre `doctors` (#289)

**El frente más importante desde este handoff.** Nació de un diagnóstico
read-only de `doctor_credentials`: al revisar quién puede leer la credencial
apareció que **`public.doctors` conservaba el `GRANT ALL` del schema inicial**
(Sprint 1-2, anterior a `migrations/`, que arranca en `s4_01`). `profiles`
recibió esta misma cirugía en `s7_16` durante el pre-piloto; **`doctors` nunca
la recibió**, y el Security Gate (#35) no lo cazó.

**Tres vectores, confirmados en la DB real por el owner y reproducidos por el
smoke (13/25 antes de aplicar):**

1. **Fuga de credenciales.** `anon` tenía `SELECT` sobre **todas** las
   columnas, incluida `license_number`. **La RLS filtra FILAS, no COLUMNAS** —
   `doctors_select_public` deja ver a cualquier publicado. Con la anon key
   (pública por diseño, embebida en el bundle):
   `GET /rest/v1/doctors?select=license_number&is_published=eq.true` → el JVPM
   de **todos** los publicados. *(Ojo con los números: la tabla tiene **37**
   filas con `is_published=true`; el directorio muestra **35** porque sus
   `!inner` de `profiles`/`clinics` descartan 2. Una query cruda a `doctors` no
   pasa por esos joins → devolvía 37.)* **El fix de #197 sacó el campo del payload de la app;
   eso nunca fue una barrera de seguridad: la app no lo pide, pero cualquiera
   puede pedirlo.**
2. **Auto-verificación.** `authenticated` tenía `UPDATE` sobre todas las
   columnas, y `doctors_update` es `USING (profile_id = auth.uid())` con
   `WITH CHECK` **nulo** (hereda el `USING`). Como **`is_verified` es GENERATED
   de `lucy_status`** (`s7_03`), un médico podía
   `PATCH {"lucy_status":"verified"}` sobre su propia fila y quedar con el badge
   **"Verificado por LucyCare" sin que LucyAdmin interviniera**. También
   reescribir su `license_number` y auto-habilitar `is_operational`.
3. **Médico falso.** `doctors_insert` es `WITH CHECK (profile_id = auth.uid())`
   y un INSERT solo exige `clinic_id` + `profile_id` (el `clinic_id` sale del
   directorio público) → cualquier autenticado **sin fila de `doctors`, o sea
   cualquier paciente**, podía insertarse como médico verificado y publicado.
   Existe `UNIQUE(profile_id)`: **acota** el vector a pacientes, no lo cierra.

**El fix = cirugía de GRANTS, no de producto** (patrón de `s7_16`):

| Rol | Después de `s7_60` |
|---|---|
| `anon` | `SELECT` de **16 columnas públicas**. Fuera: `license_number`, `is_operational`, `tos_accepted_at`, `tos_version`. **Sin INSERT ni UPDATE.** |
| `authenticated` | `SELECT` completo (sin cambios) + `UPDATE` de **8 columnas**: `bio`, `specialty_id`, `experience_years`, `consultation_fee`, `languages`, `is_published`, `booking_enabled`, `updated_at`. **Sin INSERT.** |

**La lista salió de leer el código, no de suponer:** `specialty_id` **se
incluye** (PerfilPage lo manda en cada guardado; revocarlo rompía "Guardar") y
`education` **se excluye** (nadie lo escribe en todo el repo). Las 16 de `anon`
incluyen columnas que no van en ningún `select` pero **requieren privilegio
igual** por aparecer en `WHERE`/`ORDER BY`/`JOIN`: `is_published` (filtro),
`created_at` (`.order()`), `updated_at` (`<lastmod>` del sitemap), `clinic_id`
(FK del embed `clinics!inner`).

**NO tocó:** RLS/policies (filtran filas y están correctas) · `is_verified` ·
`lucy_status` · el claim · las RPCs admin (`SECURITY DEFINER` → corren como
owner, **ajenas a estos grants**) · datos · esquema · `src/`.

**Verificación — A/B del mismo instrumento:** `check-s7_60` **2/6 → 6/6** y
`_smoke-s7_60` **13/25 → 25/25**. **Los scripts no usan `service_role`:**
prueban comportamiento con la anon key + sesión de médico real, y **todas las
pruebas filtran por un UUID inexistente** — el privilegio de columna se evalúa
al planificar, **antes** de filtrar filas, así que `42501` vs. cero-filas
distingue los dos estados **sin leer ni modificar un dato real**. Ningún JVPM
cruzó la red; cero fixtures que limpiar. Prod validada sin regresión.

### 0.2 · ⚠️ Riesgo residual VIVO — PR-B diferido (no abrir sin instrucción)

**`authenticated` conserva `SELECT (license_number)`.** Los grants de columna
son **por rol, no por fila**, y la RLS deja ver las filas de los publicados →
**cualquier usuario con cuenta puede leer la licencia de un médico publicado**.
`s7_60` bajó el público de *"cualquiera en internet"* a *"cualquiera con
cuenta"*; **no lo cerró**.

**Severidad medida: moderada, no crítica.**
- `license_number` **no es solo un número de registro: es uno de los DOS
  factores del claim** — `s7_13` exige teléfono OTP-verificado que coincida
  (`P0005`) **y** licencia tipeada que coincida (`P0007`).
- **36 de los 37 médicos publicados están `listed_only`** (sin reclamar; solo
  Camilo está `verified`) → para esos 36 el factor licencia queda anulado.
- **Pero NO habilita el robo de perfil por sí solo:** el factor teléfono sigue
  en pie, y controlar el teléfono real del médico es la parte difícil.

**Decisión (post-#289, análisis read-only): PR-B NO se implementa como parche
de grants/RPC. Es una decisión tomada, no un pendiente abierto.** Razones:

- **(a) Impuesto permanente.** En Postgres **no se puede revocar una columna de
  un grant de tabla** (sería un no-op silencioso), así que habría que
  `REVOKE SELECT` de tabla y re-`GRANT` las otras 19 columnas → **cada columna
  nueva de `doctors` hay que otorgarla o el panel se rompe en silencio**. No es
  hipotético: `s7_52` agregó `slug`.
- **(b) La RPC simple no alcanza para la receta.** `my_doctor_license()`
  devolvería la licencia del **caller**, pero la receta necesita la del **médico
  de la consulta**. Coinciden hoy **solo** porque la RLS de `consultations` es
  doctor-scoped (`s7_26`) — equivalencia **accidental**. Si un asistente
  accediera, la receta imprimiría la licencia equivocada: **bug de corrección
  clínica/legal, peor que el problema de privacidad que se quiere arreglar**.
- **(c) F1 lo demolería.** El diseño de `doctor_credentials` ya manda que el
  `value` nunca salga del servidor.

**El fondo: `license_number` es un secreto viviendo en una tabla legible por
fila. El arreglo correcto es sacarlo de ahí, no parchear permisos de columna.**
→ **el cierre estructural se pliega a `doctor_credentials` F1** (ver
`docs/ANALISIS_CREDENCIALES_MEDICAS.md` §0).

**Reabrir PR-B como parche solo si** F1 no arranca en un plazo razonable **o**
aparece un reporte real de scraping / abuso de claim. En ese caso: RPC scopeada
a la **consulta**, no al caller.

### 0.3 · Frentes menores cerrados (#286–#288)

- **#286 — limpieza de dependencias muertas (delete-only).** `recharts@3.2.0` y
  `@stripe/react-stripe-js@4.0.2` fuera: 0 imports en `src`/`scripts`/config, y
  en el lockfile su único dependiente era la raíz. Los dashboards de analytics
  son KPI cards + tablas, **sin librería de gráficos**. `@stripe/stripe-js` no
  estaba en `package.json` (entraba como *peer*) y se fue sola. **46 entradas
  del lockfile** (~11 MB). También sale `VITE_STRIPE_PUBLISHABLE_KEY` de
  `.env.example` (ningún archivo del repo la lee). **A/B: el bundle
  post-remoción es byte-idéntico** (mismos 46 chunks, mismos hashes, entry
  180.29 KB gzip) → prueba que **nunca entraban al bundle**; el ahorro es de
  instalación, **no de bundle**.
- **#287 — receta corregida sobria, apta para impresión en grises.** El bloque
  "RECETA CORREGIDA" (teal + 14px bold MAYÚSCULAS) leía como alerta y
  **comunicaba con color** en un documento que se imprime en B/N: en grises el
  `teal-50` colapsa contra el papel (**luminancia 0.957**). → borde `gray-300`
  1px, fondo blanco, 12px semi-bold. Franja teal y label "Receta médica"
  **conservados** (marca de la hoja, no comunicación de corrección).
- **#288 — receta corregida MINIMAL.** La hoja acumulaba **seis señales de lo
  mismo**, incluido `· Corrección v2` **pegado al nombre del medicamento** — el
  peor lugar para sembrar una duda: quien lee la receta está leyendo **qué
  tomar**. Ahora: **UNA fecha** (la de la corrección, la vigente) + una línea
  gris de 11px "Receta corregida". El rótulo pasa a **`FECHA`** *solo* si hubo
  corrección. **La receta normal no cambió** (HTML byte-idéntico, mismo
  `sha256`). **La fecha de emisión original ya no se imprime en recetas
  corregidas** — decisión explícita del owner; el historial vive en
  `consultation_amendments` / `prescriptions.version` / `audit_log`.

### 0.4 · Pendientes vivos — reemplaza a §4

**`doctor_credentials` F1-c — SIGUIENTE FASE, NO INICIADA. No abrir sin
instrucción.** F1-a (#291) y F1-b (#292) están cerradas (§0.0). **F1-c es la que
CIERRA el riesgo residual de §0.2:**

1. retirar el **fallback** de los lectores (panel y receta);
2. re-emitir el **claim** sin fallback;
3. **cortar el dual-write** (drop de `trg_sync_license_to_credential`);
4. **revocar `SELECT (license_number)` a `authenticated`**;
5. **DROPEAR `doctors.license_number`**;
6. actualizar los scripts que la leen: `import-doctors.mjs`,
   `check-s7_13/21/22`, `setup-test-doctor-prb`.

Con la columna fuera, **no queda secreto que proteger en `doctors`** — y sin el
"impuesto" de grants por columna. **Antes de F1-c conviene verificar la sincronía
columna ↔ credencial**, para no dropear con drift.

Después de F1-c: **F2** (UI LucyAdmin para verificar/rechazar) · **F3**
(propuesta del médico) · **F4** (señal pública **sin número**) · **F5**
(reportería). Ver `docs/ANALISIS_CREDENCIALES_MEDICAS.md` §0.

Sigue vigente el resto de §4 **menos** el punto 2 (dependencias muertas — hecho
en #286): Search Console operativo (owner, manual) · Perf segundo paso opcional
(`manualChunks`) · branding interno menor · Pagos SaaS (solo diseño, bloqueado
por pasarela). **F8 sigue DIFERIDO conscientemente** (§4-bis, sin cambios).

---

---

## 1. Estado técnico final (2026-07-14, tras cerrar #284)

- **HEAD de `main`:** `2a02aaf` (*perf(bundle): code-splitting por rutas —
  bundle inicial 313→180 KB gzip (Perf P2) (#284)*).
- **PRs mergeados:** **#1–#284**.
- **Migraciones aplicadas en Supabase:** hasta **`s7_59`**
  (`amend_consultation` con semántica de presencia de clave, ahora también para
  `alternatives` — ver §2·F7 y §3). **`s7_58` y `s7_59` fueron aplicadas
  manualmente por el owner en el SQL Editor y verificadas con
  `node scripts/check-s7_5N.mjs` (verde). Los frentes recientes #282–#284 son
  frontend/docs, sin migración.**
- **`main == origin/main`** ✅ · **árbol limpio** · **0 PRs abiertos** ·
  **sin preview local** · **sin servers** · **sin fixtures** ·
  **sin frente funcional abierto**.
- `tsc --noEmit` y `npm run build` verdes en `main`.

---

## 2. Eje clínico F1–F7 — CERRADO (#272–#279)

Serie de correcciones sobre la consulta clínica, nacidas de una **auditoría
read-only de integridad de formularios** (post-#269). Todas validadas en preview
con la cuenta demo (Camilo) y verificadas contra la DB real.

### F1 · PR #272 — `duration_value` vacío persiste como `NULL` (receta en borrador)
- **Frontend/service.** `PrescriptionsSection.tsx` + `prescriptions.service.ts`.
- Al borrar la duración de un medicamento, `flush()` enviaba `undefined`; las
  claves `undefined` **desaparecen al serializar el UPDATE**, así que la columna
  no se tocaba: la DB conservaba la duración vieja y **la receta impresa la
  seguía mostrando** aunque el campo se viera vacío.
- Fix: la intención de borrar viaja como **`null` explícito**
  (`PrescriptionInput.duration_value: number | null`).
  `undefined` = no tocar · `null` = borrar · número = guardar.

### F2 · PR #273 — No se firma con guardados clínicos pendientes o fallidos
- **Frontend.** `useConsultation.ts` + `ConsultaPage.tsx` +
  `PrescriptionsSection.tsx` + `DiagnosesSection.tsx`.
- Receta / diagnósticos / antecedentes autoguardan en `onBlur` con `mutate()`
  (sin `onError`). Si la firma les ganaba la carrera, la consulta quedaba
  firmada y el UPDATE posterior rebotaba contra la inmutabilidad (`s7_28`):
  **el último campo editado se perdía en silencio**.
- Las 9 mutaciones de escritura clínica comparten `mutationKey`
  (`consultationKeys.clinicalWrite(consultationId)`). El hook
  **`useClinicalWrites`** expone `isPending` / `hasFailed` (render) e
  **`isBlockedNow()`** (lectura **síncrona** del cache de mutaciones).
- **La firma se bloquea en DOS casos:** guardado **en vuelo** y guardado
  **fallido sin resolver** (ese cambio no llegó a la DB). Botón deshabilitado,
  **el modal no se abre** y `handleSign` no arranca.
- **Por qué el guard imperativo:** con el guard basado solo en estado de render
  el modal **sí se abría** — medido: el `blur` (mousedown) dispara el guardado y
  el `click` (mouseup) corre **~130 ms antes** de que React re-renderice el botón.
- **Salida ante fallo** (para no dejar al médico atrapado): botón **"Reintentar"**
  en el aviso de la sección, o corregir el campo. Cualquier guardado exitoso
  **de esa fila** limpia su error (`clearFailedClinicalWrite`, limpieza **por
  fila**, no global: un fallo pendiente de otra fila sigue bloqueando).

### F3 · PR #274 — Notas de diagnóstico/antecedentes no revierten por refetch viejo
- **Frontend.** `DiagnosesSection.tsx` + `AntecedentesSection.tsx`.
- Mismo race que se corrigió en receta (#269): el `useEffect` rehidrataba desde
  props tras cada guardado. Al hacer blur, `dirty` bajaba a `false` y el efecto
  re-sembraba desde `cd.notes` **todavía viejo** → la nota **volvía al valor
  anterior** en pantalla pese a haberse guardado bien.
- **Medido (A/B con el mismo instrumento, muestreo cada 25 ms):** sin el fix la
  nota revertía y recién mostraba la nueva a los **~2.5 s** (cuando volvía el
  refetch); con el fix, **0 transiciones**.
- Fix: patrón **`boundIdRef`** — sembrar el estado local **solo cuando la fila
  pasa a representar otro registro** (cambia `cd.id` / `cfh.id`).
- **`AntecedenteRow` queda como fix LATENTE:** hoy `ConsultaPage` monta esa
  sección siempre con `readOnly` (los antecedentes nuevos son texto libre desde
  el #171), así que el camino de edición está **inerte**.

### F4 · PR #275 — El texto clínico no se pierde durante "Guardar borrador"
- **Frontend.** `ConsultaPage.tsx` (único archivo).
- Si el médico presionaba "Guardar borrador" y **seguía escribiendo**, el refetch
  (nuevo `updated_at`) rehidrataba el formulario con la versión del servidor y
  **borraba lo tipeado después del click** — texto clínico que **nunca se
  persistió**. **Medido:** a los **631 ms** el campo volvía al texto previo.
- Fix: **`seededConsultationRef`** (qué consulta está sembrada) +
  **`hasLocalEditsRef`** (hay texto local que el servidor no confirmó). El efecto
  de siembra **no pisa el form** mientras haya edición local. El flag se apaga
  tras un guardado exitoso **solo si el form no cambió mientras guardábamos**
  (`sameText` contra el snapshot enviado) — eso preserva la rehidratación tras
  una **corrección post-firma**, único motivo por el que el efecto observa
  `updated_at`.
- **Cambiar de consulta SIEMPRE resiembra** (la ruta es la misma y el componente
  **no se desmonta**, los refs persisten) → no se arrastra texto entre consultas.
- En consulta firmada los campos están `disabled` ⇒ `setField` nunca corre ⇒
  `hasLocalEditsRef` es `false` ⇒ el modo lectura se comporta igual que antes.

### F5 · PR #276 — Vitales: sin filas vacías ni upserts innecesarios
- **Frontend.** `ConsultaPage.tsx` (único archivo; **`vitals.service.ts` NO se tocó**).
- "Guardar borrador" llamaba **siempre** a `upsertVitals` con el objeto completo,
  aunque el médico no hubiera tocado ni un signo vital:
  - **sin fila previa** → creaba una fila de `vitals` **enteramente en `NULL`**. Y
    como el resumen del paciente toma la fila **más reciente**
    (`order by recorded_at desc limit 1`, cross-citas), esa fila vacía **ganaba**
    y "Últimos vitales" mostraba **`—`**: **le ocultaba al médico la última
    medición real del paciente**;
  - **con fila previa** → reescribía `recorded_at`/`recorded_by` en cada guardado
    de texto → la "Última captura" mentía;
  - habilitaba un **pisado stale** (mismo médico en dos pestañas).
- **Regla del gate (vinculante):** guardar vitales **solo si el formulario
  difiere del snapshot sembrado** (`vitalsSnapshotRef`). **NO** vale la regla
  "hay fila o hay valores" — con fila existente y vitales sin tocar, esa regla
  seguiría reescribiendo `recorded_at`.

| Caso | `upsertVitals` |
|---|---|
| Sin fila + vacíos + no tocados | **NO se llama** → no se crea fila vacía |
| Sin fila + el médico carga vitales | Sí → crea fila |
| Fila existente + no toca vitales | **NO se llama** → `recorded_at`/`recorded_by`/valores intactos |
| Fila existente + cambia valores | Sí |
| Fila existente + **borra todos** los campos | Sí → quedan en `NULL` (acción explícita) |

- **Bonus:** la siembra depende de `appointmentId` → **ya no se arrastran vitales**
  entre consultas (antes, una cita **sin** fila conservaba en pantalla los de la
  consulta anterior).
- **Asistente y vitales (verificado, no asumido):** desde **`s7_26`** el rol
  `assistant` **NO puede leer ni escribir `vitals`** (gate doctor-scoped). El
  riesgo de "pisar la captura de la asistente" **no aplica**. Tampoco existe
  política **`vitals_delete`**: la app **no puede borrar** filas de vitales.

### Limpieza manual post-F5 (datos heredados, ejecutada por el owner)
- **Inventario read-only:** **7 filas `vitals` completamente vacías** (los 9
  campos clínicos en `NULL`), todas de mayo 2026, todas del entorno demo de
  Camilo; 5 eran la fila más reciente de su paciente y **1 paciente tenía una
  medición real oculta**.
- **Ejecutado por el owner en el SQL Editor de Supabase** (la app no puede
  borrarlas: no hay política `DELETE`). Criterio con **doble candado**:
  `id IN (<los 7 ids del inventario>)` **Y** los 9 campos clínicos en `NULL`,
  con `RETURNING id`.
- **Verificación posterior (read-only):** **0 filas vacías** · las **12 filas con
  valores reales intactas** · **0 pacientes con vitales reales ocultos** · las 7
  consultas asociadas intactas (**6 firmadas conservan `signed_at`**, ninguna
  alterada) · panel sin errores de consola · el resumen del paciente demo vuelve
  a mostrar los vitales reales.
- ⚠️ **Nota de proceso:** el SQL Editor corre **cada ejecución en su propia
  sesión**. Un `BEGIN; DELETE …;` ejecutado por separado del `COMMIT` **hace
  rollback automático** (el primer intento no borró nada). Para borrados
  manuales: ejecutar la sentencia **en una sola corrida**.

### F6 · PR #277 / `s7_58` — La corrección post-firma ya puede BORRAR de verdad
- **SQL + frontend.** `migrations/s7_58_amend_prescription_nulls.sql`,
  `scripts/check-s7_58.mjs`, `scripts/_smoke-s7_58.mjs`,
  `src/pages/panel/consulta/CorrectConsultationModal.tsx`.
- **El bug:** el bloque de receta de `amend_consultation` decidía por el **valor**
  y no por la **presencia de la clave**
  (`COALESCE(NULLIF(v_op->>'duration_value',''), v_old.duration_value)`), y el
  modal **omitía** `duration_value` al vaciarlo. Resultado: el médico borraba la
  duración → se creaba la adenda, se versionaba la receta (**v2**), se marcaba
  **"RECETA CORREGIDA"** y se imprimía **"Corrección v2"**… y **la duración vieja
  sobrevivía**. **El sistema afirmaba haber corregido algo que no corrigió, con
  sello de corrección.** Además `dosage`/`frequency`/`instructions` quedaban como
  `''`, y con `null` la función vieja **restauraba el valor anterior**.
- **El fix (ver §3):** presencia de clave + regla server-side de `permanente`.
- **Verificación:** `check-s7_58` verde + **`_smoke-s7_58` 28/28**. El **mismo
  smoke, contra la RPC vieja, daba 8 fallas** reproduciendo el bug exacto. Más
  validación UI en preview sobre una **fixture propia firmada**.
- **Intacto:** gates (`P0011`/`P0012`/`P0013`/`42501`), versionado
  (`is_current`/`replaces_id`/`version`), snapshots before/after,
  `consultation_amendments`, `affects_prescriptions`, `audit_log`, y los bloques
  de diagnósticos, antecedentes y vitales. **`alternatives` se conserva intacta**
  (era F7, ahora cerrado). **Sin backfill** de históricos.

### F7 · PR #279 / `s7_59` — Alternativas terapéuticas corregibles post-firma
- **SQL + frontend.** `migrations/s7_59_amend_prescription_alternatives.sql`,
  `scripts/check-s7_59.mjs`, `scripts/_smoke-s7_59.mjs`,
  `src/pages/panel/consulta/CorrectConsultationModal.tsx`,
  `src/services/consultations.service.ts` (tipos de las ops).
- **El bug:** `alternatives` era el último campo de receta que la corrección no
  podía tocar — en `replace` se arrastraba tal cual (`v_old.alternatives`, no
  editable) y en `add` **ni figuraba en el `INSERT`** (un medicamento agregado en
  una corrección **nunca** podía tener alternativas). Y `RecetaPrint` **sí las
  imprime** → unas alternativas equivocadas en una receta firmada quedaban
  impresas para siempre, sin forma de corregirlas.
- **El fix (dos puntos exactos, todo lo demás idéntico a `s7_58`):**
  - `replace`: `v_old.alternatives` → `CASE WHEN v_op ? 'alternatives' …` — la
    **misma regla vinculante** de §3 (ausente = conservar · `null`/`''` = limpiar
    · valor = actualizar);
  - `add`: se agrega la columna `alternatives` al `INSERT` (sin valor → `NULL`).
  - Frontend: campo "Opciones alternativas" en el editor de receta del modal
    (existentes y nuevos); se siembra con el valor actual y la clave viaja
    **siempre** (`null` al borrarla).
- **`RecetaPrint` NO se tocó** — ya sabía imprimir alternativas.
- **Verificación:** `check-s7_59` verde + **`_smoke-s7_59` 27/27** (el mismo smoke
  daba **4 fallas** de `alternatives` contra la RPC vieja `s7_58`, e **incluye la
  no regresión de F6**: duración/nulls/`permanente` siguen). Más validación UI en
  preview sobre **fixture propia firmada** (modificar → borrar → agregar con
  alternativas; v1/v2 históricas, v3 vigente con `alternatives=null`).
- **Intacto (idéntico a `s7_58`):** gates, versionado, snapshots,
  `consultation_amendments`, `affects_prescriptions`, `audit_log`, diagnósticos,
  antecedentes, vitales, y **toda la semántica de nulls / `permanente` de F6**.
  **Sin backfill.**

**→ Con F7 el eje clínico F1–F7 queda CERRADO.** La corrección post-firma de
receta ya puede corregir fielmente **todos** sus campos (dosis, frecuencia,
duración, unidad, indicaciones, alternativas), borrarlos de verdad (`NULL`) y
asignar alternativas a medicamentos agregados en la corrección — con versionado,
snapshots, adendas, `audit_log` y gates intactos. **F8 (optimistic updates /
refactor estructural) queda DIFERIDO conscientemente — ver §4-bis. No queda
pendiente clínico activo.**

---

## 2-bis. Frentes NO clínicos cerrados (SEO + Perf, #282–#284)

Todos frontend-only (o asset), **sin migración**. La lógica SEO pura vive en
`og-meta.mjs` y la ejerce `middleware.ts` (Vercel Edge); se testea con
`scripts/_smoke-og-meta.mjs`.

### PR #282 — SEO PR-D1: JSON-LD `Physician` + `noindex /calificar/*`
- **`Physician` JSON-LD** en perfiles `/doctor/*` **publicados e indexables**
  (`isSitemapEligible`). Solo campos seguros del objeto normalizado: `@type`,
  `name`, `url`=canonical, `medicalSpecialty`, `image` (avatar), `worksFor`
  (clínica), `address` (localidad/región, `addressCountry=SV`, **sin street**),
  `areaServed`. **NUNCA** JVPM/NUE/DUI/teléfono/email ni
  `aggregateRating`/`review`/`priceRange`/`openingHours`. Escape de `<`.
  **No se emite** en genérico/no-publicado/noindex.
- **`/calificar/*` → `noindex,follow`** vía middleware (matcher +=
  `/calificar/:path*`, `buildNoindexRoute`). `robots.txt` NO se tocó; no entra al
  sitemap; no toca el flujo de la encuesta ni los tokens.
- El Home mantiene su `@graph` **Organization + WebSite** (solo del Home).
  Slug inexistente sigue `noindex` sin datos. Verificado en prod.

### PR #283 — SEO PR-D2: OG cover branded 1200×630
- Asset **`public/lucycare-og.png`** (1200×630, PNG, ~15 KB). Variante A: fondo
  morado `#3C2285`, isotipo menta (reusado de `favicon.svg`), wordmark
  "LucyCare", tagline "Encuentra al médico perfecto para ti", "EL SALVADOR"
  discreto. Generado con SVG + `sharp` transitorio (sin tocar `package.json`).
- **Separación deliberada** en `og-meta.mjs`: `OG_COVER_PATH = /lucycare-og.png`
  (og:image del Home, del genérico/noindex y **fallback** de perfil sin avatar)
  vs `ORG_LOGO_PATH = /lucycare-logo.png` (`Organization.logo` del JSON-LD —
  schema espera un logo, no un banner). **No se mezclan.** Perfil **con avatar**
  sigue usando el avatar del médico. Verificado en prod.

### PR #284 — Perf P2: route-level code-splitting
- El bundle era **1 chunk de 1.243 MB / 313 KB gzip**; el visitante público
  descargaba panel/admin/paciente/consulta sin usarlos.
- `config.tsx`: las páginas de `/panel/*` (incl. `ConsultaPage`), `/admin/*`,
  `/paciente/*`, `/calificar` y `/reset-password` pasan a
  `lazy(() => import(...))`. **Estáticas:** Home, `/doctor/*`, `/privacidad`,
  `NotFound`. **Guards estáticos** (corren ANTES de resolver el lazy → la auth no
  depende del import). `App.tsx`: `<Suspense>` con fallback de marca.
- **Resultado (build): 1 → 46 chunks; entry inicial 623 KB / 180 KB gzip
  (−42%).** Home/doctor-detail siguen en el entry (SEO intacto). **Verificado en
  prod por Network:** `/calificar` trae `CalificarPage-*.js` y `/panel` trae
  `PanelLayout-*.js` como chunks separados del entry.
- **NO** incluyó `manualChunks`/vendor splitting (el warning de Vite ">500 kB"
  sobre el entry es esperado; bajarlo más = segundo paso de Perf). **NO** limpió
  `recharts`/`@stripe` muertos (frente aparte).

---

## 3. REGLA TÉCNICA VINCULANTE — semántica de `amend_consultation`

Para **toda** corrección clínica post-firma (y para cualquier cambio futuro de la
RPC). Ya aplica a **todos** los campos de receta (`s7_58` = dosis/frecuencia/
duración/unidad/indicaciones · `s7_59` = alternativas), además de vitales,
diagnósticos y antecedentes:

| Payload | Efecto |
|---|---|
| **clave ausente** | **conservar** el valor anterior |
| **clave presente con `null` o `''`** | **limpiar** → guardar `NULL` |
| **clave presente con valor** | **actualizar** |

- Implementación: `CASE WHEN v_op ? 'campo' THEN NULLIF(...) ELSE v_old.campo END`.
  **NO usar `COALESCE(NULLIF(...), viejo)`**, que decide por el valor y hace
  imposible borrar.
- Este patrón ya era el de **vitales, notas de diagnóstico y antecedentes**;
  `s7_58` alineó la receta (que era la excepción) y `s7_59` cerró el último campo
  que faltaba, `alternatives`.
- **Regla clínica server-side:** `duration_unit = 'permanente'` ⇒
  `duration_value = NULL` **siempre**, sin depender de que el cliente la limpie
  (aplica a `replace` y a `add`).
- **El frontend debe expresar la intención:** mandar la clave con `null` cuando
  el médico borró el campo. **Omitir la clave significa "no tocar"**, no "borrar".

---

## 4. Pendientes vivos (separados, SIN acción automática)

> **EJE CLÍNICO CERRADO.** F1–F7 cerrados (#272–#279). **F8 DIFERIDO
> conscientemente** (ver §4-bis). **No queda pendiente clínico activo** — los
> siguientes frentes deben ser **no clínicos**, salvo que aparezca un bug real.

> **SEO PR-D (JSON-LD `Physician` + `noindex /calificar` + OG branded 1200×630)
> CERRADO en #282–#283. Perf P2 (route-level code-splitting) CERRADO en #284.**
> Ver §2-bis.

1. **Search Console / SEO operativo** (owner, manual) — el dominio está
   verificado y el sitemap enviado; Home y Camilo ya fueron a cola de indexación.
   Al recrawlear, Google recoge el `Physician` JSON-LD nuevo. Sigue separado, **no
   mezclar con clínica.**
2. **Limpieza de dependencias muertas** — `recharts` (6.8 MB en disco) y
   `@stripe/react-stripe-js` están en `dependencies` pero **no se importan en
   `src`**. Frente delete-only aparte (toca `package.json`/lock → requiere OK).
3. **Perf — segundo paso (opcional):** vendor splitting con `manualChunks`
   (separar React/supabase/react-query del entry de 623 KB). Reduce el warning de
   Vite ">500 kB"; retorno menor que el de #284.
4. **Branding interno menor** (índigo del panel, púrpura del modal admin) ·
   credenciales `doctor_credentials` · Pagos SaaS (solo diseño, bloqueado por
   pasarela).

---

## 4-bis. F8 — optimistic updates / refactor estructural: DIFERIDO conscientemente

**Decisión (post-#280, análisis read-only):** NO se implementa ahora. **No es un
pendiente abierto: es una decisión tomada.** No reabrir por inercia.

**Por qué se difiere:**
- El repo tiene **cero `onMutate` en todo `src`** — toda mutación clínica es
  `invalidate → refetch`. Eso *era* la precondición estructural de la familia de
  bugs F1–F5.
- Pero **F1–F7 ya instalaron protecciones locales suficientes**, sección por
  sección: receta (guards + `dirty` + `null`-intent), diagnósticos (`boundIdRef`),
  antecedentes (`boundIdRef`, latente), texto clínico (`seededConsultationRef` +
  `hasLocalEditsRef`), vitales (`vitalsSnapshotRef`), firma (gate de clinical
  writes), correcciones post-firma (RPC atómica con trazabilidad).
- **No queda ningún bug clínico visible ni reproducible por flujo humano normal.**
  El único riesgo residual es una **carrera extrema/no humana** (~60 ms entre
  blur y una segunda mutación de la misma fila), hipotética, ya mitigada por
  `boundIdRef`.
- Los **optimistic updates mal hechos introducen su propia clase de bugs**
  (rollback de `onError` que no restaura idéntico → cache clínico corrupto).
  Cambiaría bugs conocidos y cerrados por una superficie nueva y más sutil en el
  eje más delicado. **Alto riesgo, bajo retorno** — refactor por estética técnica,
  que el criterio de producto no autoriza.

**Solo se reabre si:** aparece un **reporte real** de pérdida/reversión por
concurrencia, **o** crece el volumen de datos por consulta y el refetch empieza a
degradar UX/performance (hoy ~2–5 ítems por consulta, imperceptible).

**Si se reabre en el futuro (estrategia vinculante):**
- **NUNCA global.** Un `onMutate` sobre las 5 tablas clínicas a la vez es el peor
  escenario.
- **Un PR por sección**, empezando por **`useUpdatePrescription`**.
- **No tocar las 5 secciones clínicas a la vez.**
- Validar el **rollback** de `onMutate` / `onError` / `onSettled` (que el cache
  vuelva idéntico ante un fallo forzado).
- Probar con **fixture de borrador** (el update de receta en borrador no crea
  adendas), **no** consulta firmada, salvo necesidad.
- **Sin DB/SQL/migración** — es puramente cache de React Query en el cliente.

---

## 5. Reglas operativas vigentes (VINCULANTES)

- **Un solo frente a la vez.**
- **No abrir PR sin autorización** del owner; **no mergear sin su OK explícito**.
- **No tocar DB/SQL/migraciones/`auth.users`** sin autorización. **El owner aplica
  el SQL** en el SQL Editor y el dev corre los checks/smokes.
- **`service_role` requiere autorización explícita del owner, INCLUSO en modo
  read-only.** Si una tarea lo necesita (p. ej. un inventario global que la RLS
  no permite leer), **plantearlo y esperar el OK** antes de ejecutar.
- **Datos de validación:** **jamás Katherine (`50372608827`)** ni datos reales
  sensibles (ni en read-only). **Camilo (`50378627694` / OTP `123456`) solo como
  demo controlado.**
- **Fixtures:** **propias, creadas desde cero, marcadas** (p. ej. `F6_FIXTURE`),
  **limpiadas al final** con **verificación de 0 residuales**. Si la prueba crea
  algo **irreversible** (p. ej. una **adenda** de corrección post-firma), **NO
  usar el paciente demo** — crear paciente/cita/consulta propios.
- **PR que toca DB → migración + `check-s7_NN.mjs` + `_smoke-s7_NN.mjs`.**
- **Para cambios de UI:** pedir **preview / OK visual** del owner antes de mergear.
- **No mezclar** SEO/Analytics/Auth/Clínico/DB en un mismo PR.
- **No tocar el stash viejo** `stash@{0}: WIP on claude/admin-fase-a` (ni borrar,
  ni aplicar, ni inspeccionar) **salvo autorización explícita**.
- **Cierre estándar tras cada merge:** HEAD, PRs, migraciones, `main==origin/main`,
  `git status` vacío, rama borrada local+remoto, 0 PRs abiertos, sin residuos
  (preview/servers/fixtures/scripts/ZIPs).
- Ramas cortas `claude/<8-12 chars>`, **squash-merge** + borrar rama.

### Aprendizajes de método (de esta serie)

- **Validar el instrumento, no solo el fix.** En F3, F4 y F6 se hizo un **A/B
  real**: correr la misma medición contra el código/RPC **anterior** para
  comprobar que el bug se reproduce. Un test que solo pasa "después" no prueba nada.
- **`supabase-js` mantiene su propia referencia de `fetch`:** parchear
  `window.fetch` desde el navegador **NO** intercepta sus requests (confirmado en
  F2 y ya anotado en #270). Para forzar un fallo real, provocar un **error genuino
  del servidor** (p. ej. valor fuera del rango de `int4`, o un carácter NUL en un
  `text`).
- **Los eventos sintéticos de foco/blur no disparan React** si el documento no
  tiene foco: usar **clics de mouse reales** para ejercitar `onBlur`.

---

## 6. Prompt para arrancar la nueva ventana del dev

```text
Continuamos LucyCare en nueva ventana.

Primero confirmá estado:

git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -10
git status --short
gh pr list --state open

Leé en este orden:

1. CLAUDE.md
2. docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-07-14.md
3. docs/HANDOFF_TOMA_DECISIONES_2.md (si necesitás contexto histórico)

Estado esperado:
- HEAD: 2a02aaf
- PRs mergeados hasta #284
- migraciones hasta s7_59 (aplicada y verificada en Supabase)
- main == origin/main
- árbol limpio
- 0 PRs abiertos
- sin frente abierto

No codifiques todavía.

Primero confirmá estado y quedá a la espera de la próxima instrucción del owner.
```
