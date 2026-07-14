# HANDOFF — Nueva ventana de contexto (2026-07-14, post-PR #277)

> **PUNTO DE ENTRADA VIGENTE.** Leer este primero. Reemplaza como handoff
> operativo al `2026-07-13` (que queda histórico). El detalle histórico
> completo sigue en `CLAUDE.md`.

---

## 1. Estado técnico final (2026-07-14, tras cerrar #277)

- **HEAD de `main`:** `7233a47` (*fix(consulta): la corrección post-firma ya
  puede borrar duración/dosis de la receta (F6 / s7_58) (#277)*).
- **PRs mergeados:** **#1–#277**.
- **Migraciones aplicadas en Supabase:** hasta **`s7_58`**
  (`amend_consultation` con semántica de presencia de clave — ver §3).
  **`s7_58` fue aplicada manualmente por el owner en el SQL Editor y verificada
  con `node scripts/check-s7_58.mjs` (verde).**
- **`main == origin/main`** ✅ · **árbol limpio** · **0 PRs abiertos** ·
  **sin preview local** · **sin servers** · **sin fixtures** ·
  **sin frente funcional abierto**.
- `tsc --noEmit` y `npm run build` verdes en `main`.

---

## 2. Eje clínico F1–F6 — CERRADO (#272–#277)

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
  (es F7). **Sin backfill** de históricos.

---

## 3. REGLA TÉCNICA VINCULANTE — semántica de `amend_consultation`

Para **toda** corrección clínica post-firma (y para cualquier cambio futuro de la
RPC, **empezando por F7**):

| Payload | Efecto |
|---|---|
| **clave ausente** | **conservar** el valor anterior |
| **clave presente con `null` o `''`** | **limpiar** → guardar `NULL` |
| **clave presente con valor** | **actualizar** |

- Implementación: `CASE WHEN v_op ? 'campo' THEN NULLIF(...) ELSE v_old.campo END`.
  **NO usar `COALESCE(NULLIF(...), viejo)`**, que decide por el valor y hace
  imposible borrar.
- Este patrón ya era el de **vitales, notas de diagnóstico y antecedentes**;
  `s7_58` alineó la receta, que era la excepción.
- **Regla clínica server-side:** `duration_unit = 'permanente'` ⇒
  `duration_value = NULL` **siempre**, sin depender de que el cliente la limpie
  (aplica a `replace` y a `add`).
- **El frontend debe expresar la intención:** mandar la clave con `null` cuando
  el médico borró el campo. **Omitir la clave significa "no tocar"**, no "borrar".

---

## 4. Pendientes vivos (separados, SIN acción automática)

1. **F7 — alternativas terapéuticas corregibles.** Hoy `alternatives`:
   - en `replace` **se conserva** (`v_old.alternatives`) pero **no es editable**;
   - en `add` **ni siquiera está en el `INSERT`** → un medicamento agregado en una
     corrección **nunca puede tener alternativas**;
   - **la receta impresa SÍ las muestra** → si el médico escribió unas
     alternativas equivocadas y firmó, **no tiene forma de corregirlas**.
   - **Requiere SQL/migración + UI + RPC.** Debe seguir la regla de §3.
2. **F8 — optimistic updates / refactor estructural.** El repo tiene **cero**
   optimistic updates (`onMutate`): toda mutación es `invalidate → refetch`, que
   es la precondición estructural de la familia de bugs F1–F5. Más delicado, **no
   urgente**.
3. **Search Console / SEO operativo** — sigue separado. **No mezclar con clínica.**
4. **OG branded 1200×630 + JSON-LD `Physician`** (Slugs PR D) — futuro, no mezclar.
5. **Perf P2** (code-splitting del JS ~305 KB gzip) · branding interno menor ·
   credenciales `doctor_credentials` · Pagos SaaS (solo diseño, bloqueado por
   pasarela).

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
- HEAD: 7233a47
- PRs mergeados hasta #277
- migraciones hasta s7_58 (aplicada y verificada en Supabase)
- main == origin/main
- árbol limpio
- 0 PRs abiertos
- sin frente abierto

No codifiques todavía.

Primero confirmá estado y quedá a la espera de la próxima instrucción del owner.
```
