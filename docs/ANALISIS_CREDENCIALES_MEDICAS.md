# Análisis — Credenciales médicas (JVPM / NUE) como señal de confianza

> Documento de análisis + decisión de diseño. **Cuerpo = snapshot 2026-06-29
> (post-#197, HEAD `7f55f6a`), cuando esto era solo diseño.**
>
> 📌 **LEER §0-bis PRIMERO (2026-07-18): F1-a y F1-b ya están LIVE**
> (#291/`s7_61` y #292/`s7_62`). Ahí está el estado real, cómo quedó
> implementado, la **regla vinculante de lectura** (`pending`/`verified` sí ·
> `rejected` no y sin fallback · fallback solo si no hay fila) y qué falta
> (**F1-c**, la que cierra el riesgo residual). **§0-bis manda** sobre el resto
> del documento donde haya diferencia.
>
> §0 (2026-07-16) queda como nota histórica: explica **por qué F1 subió de
> prioridad**. El cuerpo (§1–§10) sigue siendo válido como diseño de fondo.

---

## 0-bis. ESTADO DE IMPLEMENTACIÓN — 2026-07-18 (post-#292)

> **El modelo de §6 ya NO es solo diseño: F1-a y F1-b están LIVE.**
> Esta sección manda sobre el resto del documento donde haya diferencia.

| Fase | Estado | PR / migración |
|---|---|---|
| **F1-a — modelo** (tabla, RLS, grants, audit redactado, backfill, dual-write) | ✅ **LIVE** | **#291 / `s7_61`** |
| **F1-b — cutover de lectores** (panel · receta · claim) | ✅ **LIVE** | **#292 / `s7_62`** |
| **F1-c — cerrar el residual** (retirar fallback · cortar dual-write · revocar grant · **DROP** de la columna) | ⏳ **NO INICIADA** | — |
| F2 UI LucyAdmin · F3 propuesta del médico · F4 señal pública · F5 reportería | ⏳ no iniciadas | — |

> 🧭 **Frente SEPARADO de producto — "Gestión y validación de credenciales
> profesionales".** **No mezclar con F1-c** (F1-c es infraestructura: retirar una
> columna heredada; esto es producto). Objetivo futuro: **actualización
> autoservicio de JVPM/NUE** por el médico · **propuesta del médico** que queda
> `pending` (no se auto-aprueba) · **validación de formato y duplicados** (el
> índice antifraude ya existe) · **la credencial anterior sigue vigente mientras
> se revisa** (no dejar al médico sin licencia durante la revisión) ·
> **aprobación/rechazo trazable** (`verified_by`/`verified_at`/
> `rejection_reason` + `audit_log`, ya modelados en `s7_61`) · **mínima
> dependencia de soporte** (hoy el cambio de licencia es manual). Se apoya en
> **F2/F3** de este documento — leerlos antes de abrirlo, para no rediseñar lo ya
> decidido.

**Cómo quedó implementado (difiere/precisa lo esbozado en §6):**

- **`doctor_credentials`** con `value` + **`value_normalized` GENERATED** (espejo
  exacto de la normalización de `s7_13`: `upper` + quitar espacios).
- **RLS por FILA** — `is_admin() OR doctor_id = get_user_doctor_id()`. Ésta es la
  pieza central: el valor es inalcanzable **por fila**, no por columna, así que
  **no hicieron falta RPCs de lectura** ni grants por columna (y no queda el
  "impuesto" de otorgar cada columna nueva). `anon` sin acceso; `authenticated`
  con SELECT filtrado por RLS y **sin escritura directa**; `directory_editor`
  **no ve** credenciales.
- **Índice antifraude parcial** `UNIQUE(type, value_normalized) WHERE type IN
  ('JVPM','NUE') AND status <> 'rejected'`. El `status <> 'rejected'` es
  **crítico**: sin él, un JVPM ajeno **rechazado** bloquearía para siempre al
  dueño legítimo — el antifraude protegería al fraude. *(Nota: `doctors` nunca
  tuvo una restricción así; esto **agrega** una garantía que no existía.)*
- **Audit con el `value` REDACTADO** + booleano `value_changed`. El patrón
  habitual (`to_jsonb` de la fila) habría duplicado el secreto en `audit_log`.
  El actor se resuelve con `COALESCE(auth.uid(), doctors.profile_id)` y se marca
  el origen en **`actor_source`** (`session`/`system`), porque `auth.uid()` es
  NULL con `service_role` / en el SQL Editor.
- **Backfill: 114 credenciales JVPM en `pending`.** A propósito: **nunca existió
  verificación a nivel de credencial**; marcarlas `verified` habría afirmado algo
  que nadie chequeó. `is_verified` global **no se tocó** (siguen desacopladas).
- **Dual-write por trigger** (`doctors.license_number → doctor_credentials`), no
  dentro de la RPC de afiliación: esa RPC **no es el único escritor** (también
  scripts con `service_role`), y el trigger los cubre a todos.

### 0-bis.1 · REGLA VINCULANTE de lectura (panel · receta · claim)

> **`pending` y `verified` → la credencial SE USA.**
> **`rejected` → NO se usa y NO cae a la columna** (existe una fila: su estado manda).
> **Fallback a `doctors.license_number` SOLO si NO existe fila JVPM** — nunca
> para evadir un estado.

Implementada en el helper compartido **`resolveJvpm`** (frontend) y en la sección
5 de `claim_doctor_profile` (`rejected` → **`P0006`**, sin comparar contra la
columna). **El fallback es transitorio: F1-c lo retira junto con la columna.**

### 0-bis.2 · Validación

- `check-s7_61` **5/5** · `_smoke-s7_61` **22/22** (incl. reset a `pending` al
  cambiar el valor de una credencial `verified`/`rejected`, y "misma licencia →
  sin churn ni fila de audit").
- `check-s7_62` **2/2** · `_smoke-s7_62` **E2E 13/13** — incluye el **desync**
  que prueba de qué tabla lee el claim (`typed=COLUMNA`→`P0007`,
  `typed=CREDENCIAL`→éxito) y `rejected`→`P0006` aunque la columna coincida.
- **QA visual 7/7 en superficies reales** (panel y receta ×
  `pending`/`verified`/`rejected`/fallback), con valores distintos por fuente
  para distinguirlas a simple vista.
- Cleanup **0 residuos operativos**; **auditoría append-only preservada** (no se
  borra: es inmutable por diseño).

### 0-bis.3 · Lo que sigue abierto

**El riesgo residual de `s7_60` NO está cerrado.** La columna
`doctors.license_number` **sigue existiendo**, con **dual-write y fallback
activos**, y `authenticated` **conserva su `SELECT`**.

Lo cierra **F1-c**, que es una **fase PENDIENTE y NO INICIADA**.

### 0-bis.4 · Preflight de F1-c (2026-07-18) — resultado

**Hecho sin `service_role` y sin tocar la DB** (análisis de código, migraciones,
scripts y tipos). Detalle completo en
`docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-07-18_POST_F1B_F1C_PREFLIGHT.md` §4.

> **VEREDICTO: NO APTO para un F1-c de un solo PR con DROP.**
> Potencialmente apto **en dos etapas**, condicionado al preflight de DB.

**Bloqueante:** **`admin_approve_and_create_doctor` (`s7_42`, vigente) INSERTA
`license_number` en `doctors`** → dropear la columna **rompe la creación de
médicos desde afiliación**, y exige re-emitir sus **430 líneas** (justo el riesgo
que F1-a evitó usando un trigger).

**Siguen dependiendo de la columna:** el **fallback** del claim (`s7_62` §5) y
del frontend (`resolveJvpm`/`columnFallback` en panel y receta) · el **trigger
`trg_sync_license_to_credential`** · `import-doctors.mjs` (**la escribe**) ·
`setup-test-doctor-prb.mjs` · `check-s7_13.mjs` · los smokes `s7_60/61/62` ·
`database.types.ts`.

**Dependencia de orden (crítica):** hoy las altas por afiliación generan su
credencial **gracias al trigger**. Si se corta el dual-write **antes** de que el
approve escriba la credencial por su cuenta, **los médicos nuevos nacerían sin
credencial**.

**NO dependen** (son `doctor_affiliation_requests.license_number`, **otra
tabla**): toda la UI/servicios de afiliación y la licencia **tipeada** del claim.
**Vistas:** ninguna de `migrations/` referencia la columna.

**Grants:** `authenticated` conserva `SELECT` mientras la columna exista — y ese
**acceso residual desaparece SOLO con el DROP** (no hace falta revocar por
columna, ni pagar el "impuesto" de re-otorgar las demás).

**Pendiente antes de decidir alcance:** (a) el **SQL de sincronía** columna ↔
credencial, que ejecuta el **owner** (§6 del handoff; sus valores esperados son
**hipótesis, no confirmados**), y (b) el **preflight de DB** — `pg_depend`,
`pg_views`, triggers/índices/constraints/defaults reales del **schema inicial**
(que no está versionado: `migrations/` arranca en `s4_01`) — requiere
autorización específica de `service_role` read-only.

### 0-bis.5 · Propuesta preliminar — NO autorizada, NO iniciada

> ⚠️ **NO es un alcance aprobado. NO hay autorización** para tocar código, DB,
> grants, triggers ni para eliminar la columna. **No crear ramas, migraciones ni
> código.** El alcance final se decide tras el preflight de DB.

**F1-c1 · retiro lógico (reversible)** — approve escribe la credencial · claim
sin fallback · frontend sin `columnFallback` · actualizar `import-doctors.mjs` ·
cortar el dual-write. La columna queda **viva pero muerta en uso**.

**F1-c2 · DROP físico (irreversible)** — tras observación: verificar sincronía +
dependencias → `DROP COLUMN` → actualizar tipos y scripts de test.

**Por qué dividir:** separa el cambio funcional riesgoso (approve) del acto
irreversible (DROP); si algo falla en F1-c1, la columna sigue ahí como red.
**Antes de cualquier DROP: verificar la sincronía columna ↔ credencial**, para no
dropear con drift.

---

## 0. NOTA DE VIGENCIA — 2026-07-16 (post-#289 / `s7_60`)

> *(Histórica: escrita cuando F1 aún no se había implementado. Su diagnóstico
> sigue siendo correcto; el estado actual está en §0-bis.)*

**Verificado contra HEAD `db8cf5e`: el análisis sigue vigente en todo lo
principal.** Sin cambios en el modelo:

- **No existe `doctor_credentials`** — 0 referencias en `migrations/`, `src/`, `scripts/`.
- **`doctors.license_number` sigue siendo la única credencial** (= JVPM). También
  existe `doctor_affiliation_requests.license_number`, que es **otra tabla** (la
  licencia del *lead*).
- **No existe NUE**, ni `verified_at`, ni `verified_by`, ni `rejection_reason`,
  ni `credential_type`, ni `is_public` — 0 ocurrencias cada uno.
- **`is_verified` sigue siendo GLOBAL y GENERATED** de `lucy_status` (`s7_03`).
- **No hay flujo de verificación por credencial**; `admin_set_doctor_verified` fue
  dropeada en `s7_03` y la única palanca es `admin_set_lucy_status`, owner-only.
- **`claim` ≠ verificación** — explícito en `s7_13:165` (*"NO tocar: is_published,
  booking_enabled, is_operational, is_verified, license_number"*).
- **La agenda NO depende de verificación** — 0 referencias a `is_verified` en
  `booking.service` / `availability.service` / `BookingCard`; la reserva depende
  solo de `booking_enabled`. Los ejes siguen bien separados.

### 0.1 · Lo que cambió: F1 ahora tiene una razón de SEGURIDAD, no solo de modelo

Este documento (§10) recomendaba *"no exponer credenciales hasta tener el
modelo"*, tratando `doctor_credentials` como una **mejora de modelo** sin
urgencia. **Eso cambió.**

El diagnóstico read-only que precedió a este addendum destapó que
**`public.doctors` conservaba el `GRANT ALL` del schema inicial** — la RLS filtra
**filas, no columnas**, así que `anon` podía cosechar el `license_number` de
todos los médicos publicados con la anon key. **`#197` había sacado el campo del
payload de la app, pero eso nunca fue una barrera de seguridad: la app no lo
pedía, cualquiera podía pedirlo.** (Junto con eso aparecieron dos vectores más:
auto-verificación vía `lucy_status`, e inserción de médicos falsos.)

**`s7_60` (#289) cerró lo urgente**, pero **dejó un riesgo residual vivo**:

> **`authenticated` conserva `SELECT (license_number)`.** Los grants de columna
> son **por rol, no por fila** → **cualquier usuario con cuenta puede leer la
> licencia de un médico publicado.**

Y hay un agravante que este documento no contemplaba: **`license_number` no es
solo un identificador profesional — es uno de los DOS factores del claim**
(`s7_13` exige teléfono OTP-verificado **y** licencia tipeada). Como **36 de los
37 médicos publicados están `listed_only`** (sin reclamar), para ellos el factor
licencia queda anulado. *(No habilita el robo por sí solo: el factor teléfono
sigue en pie. Severidad: moderada, no crítica.)*

**Se evaluó y se descartó un parche transitorio (PR-B: revocar la columna + RPC
`my_doctor_license()`).** Razones:

- **Impuesto permanente:** en Postgres no se puede revocar una columna de un
  grant de tabla → habría que re-grantear las otras 19, y **cada columna nueva de
  `doctors` habría que otorgarla o el panel se rompe en silencio**.
- **La RPC simple no sirve para la receta:** devolvería la licencia del *caller*,
  no la del *médico de la consulta*. Coinciden hoy solo por la RLS doctor-scoped
  de `consultations` (`s7_26`) — equivalencia **accidental** que, si un asistente
  accediera, imprimiría la licencia equivocada: **bug de corrección
  clínica/legal, peor que el problema de privacidad**.
- **F1 lo demolería:** el modelo de §6 ya manda que el `value` nunca salga del
  servidor.

**El fondo: `license_number` es un secreto viviendo en una tabla legible por
fila. El arreglo correcto es sacarlo de ahí, no parchear permisos de columna.**
Eso es exactamente lo que hace §6.

**→ Decisión (owner, 2026-07-16): PR-B DIFERIDO; el cierre estructural del riesgo
residual se pliega a F1.** F1 deja de ser opcional-estético y pasa a ser el
vehículo de un arreglo de seguridad pendiente.

### 0.2 · Lo que F1 debe resolver estructuralmente (vinculante)

Además de lo ya diseñado en §6, F1 **debe** cerrar estos puntos:

| # | Requisito |
|---|---|
| 1 | **El valor sensible sale de `doctors`** → tabla propia cuya RLS sea self + admin, no una tabla legible por fila para todo el mundo. |
| 2 | **`license_number` deja de ser consultable por un rol amplio.** Nada de `SELECT` para `authenticated` sobre el valor. |
| 3 | **Acceso seguro para la receta** — scopeado a la **consulta**, no al caller (ver el error del parche descartado). Evaluar snapshot al firmar, como `s7_37` hace con los nombres de medicamento: sería históricamente más fiel (la licencia *al momento de firmar*). |
| 4 | **Acceso seguro para el médico a lo propio** (panel). |
| 5 | **Acceso interno de LucyAdmin** — hoy **no lee** `doctors.license_number` por ninguna vía; si F1 lo necesita, que sea por RPC admin-gated. |
| 6 | **El claim sigue sin exponer el valor** — `s7_13` ya lo compara en una variable interna y nunca lo devuelve; F1 debe conservar esa propiedad. |
| 7 | **Auditoría de verificación** (`verified_by` / `verified_at` / `rejection_reason` + `audit_log`), como ya prevé §6. |
| 8 | **Plan de migración de `doctors.license_number`** → fila `type='JVPM'`, incluido el destino de la columna vieja. |

### 0.3 · Excepción legítima — la receta impresa SÍ muestra el JVPM

**No confundir con exposición pública.** `RecetaPrint.tsx` imprime
`JVPM: {license_number}` en el encabezado, y **debe seguir haciéndolo**: una
receta lleva la licencia del prescriptor por diseño — **identifica a quién
prescribe y la farmacia la necesita**. Es un documento dirigido a un paciente
concreto, no un payload de directorio.

La regla de §5 (*"el número nunca al payload público"*) **sigue intacta**: se
refiere al directorio/perfil público/SEO, donde el número **no viaja** (`#197` +
`s7_60`; el middleware y el JSON-LD `Physician` ni conocen la columna). La receta
es una **excepción deliberada y acotada**, no una fisura.

F1 debe **preservar** esta excepción (ver §0.2 punto 3).

### 0.4 · Superficies reales de `doctors.license_number` (verificado a HEAD `db8cf5e`)

Solo **dos** flujos leen la columna, y ambos son el médico leyendo lo suyo:

| Flujo | Dónde |
|---|---|
| **Panel — perfil propio** | `doctorProfile.service.ts::getMyDoctorProfile` → `PerfilPage` lo muestra en un input **`disabled`** ("Para cambiarla, contacta soporte") |
| **Receta** | `consultations.service.ts::getConsultationContext` → `RecetaPrint` imprime el `JVPM:` |

**No la leen:** el directorio público / perfil público (`#197` + `s7_60`) · el
middleware / JSON-LD (0 referencias) · **LucyAdmin** (solo ve la licencia del
*lead*, vía RPC definer sobre `doctor_affiliation_requests`) · `directory_editor`
(`directory_get_doctor_detail` nunca la expuso) · el claim (la recibe como
argumento y la compara adentro).

**Dato útil para F1:** no existe ningún `select('*')` sobre `doctors`, así que
mover o revocar la columna **no rompe nada implícitamente**.

---
>
> Acompaña a:
> - `docs/ANALISIS_AFILIACION_MEDICO.md` — cómo entra un médico (lead → `listed_only`).
> - `docs/ANALISIS_RECLAMAR_PERFIL.md` — cómo reclama (`listed_only` → `claimed`, valida licencia).
> - `docs/HANDOFF_LUCYCARE_SPRINT7.md` — ejes del médico (`is_published`, `is_operational`, `booking_enabled`, `is_verified`, `lucy_status`).
> - `docs/ANALISIS_PAGOS_SAAS_MEDICOS.md` — separación **pago ≠ verified ≠ claimed** (vinculante).
>
> **Regla central (vinculante):** la **verificación de confianza** la gobierna
> LucyAdmin; **no** depende del pago ni del reclamo; y **mostrar una credencial
> al paciente debe ser veraz** (respaldada por verificación, no por un número crudo).

---

## 1. Estado actual del modelo (HEAD `7f55f6a`)

Campos relevantes en `doctors`:

| Campo | Tipo | Rol hoy |
|---|---|---|
| `license_number` | `text \| null` | **Única credencial.** Funciona como **JVPM / licencia profesional base** (ver §2). Campo genérico de texto, sin validación de formato. |
| `specialty_id` | `uuid \| null` (FK) | Especialidad del médico. **No** acredita nada por sí solo. |
| `is_verified` | `boolean` (**GENERATED** de `lucy_status='verified'`) | **Verificación GLOBAL** del médico por LucyAdmin. **No** dice qué credencial se chequeó, ni quién/cuándo. |
| `lucy_status` | enum `listed_only \| claimed \| booking_enabled \| verified` | Estado del médico. `verified` es decisión de LucyAdmin. |

Además: `doctor_affiliation_requests.license_number` (la licencia que deja el lead en la afiliación).

**Ausencias confirmadas (read-only):**
- **No existe campo NUE** (Número Único de Especialista) — cero referencias en código/migraciones.
- **No existe modelo de credenciales por tipo** ni metadata de verificación por credencial
  (quién verificó, cuándo, qué, si es público, si fue rechazado y por qué).
- No hay subespecialidad ni nada específico de especialista más allá de `specialty_id`.

## 2. Significado actual de `license_number`

**= JVPM / licencia profesional base.** Rotulado así en toda la UI:
- Panel del médico (`PerfilPage`): "**Licencia (JVPM)**", **read-only** (`disabled`, "Para cambiarla, contacta soporte").
- Modal de afiliación (`AffiliationRequestModal`): "**Licencia profesional / JVPM**".
- Migración `s7_21` (afiliación): "License/JVPM recomendada pero no bloqueante".

**Captura / ciclo de vida:**
- Se deja en la **afiliación** (lead, opcional) → al **aprobar** (`admin_approve_and_create_doctor`) se **copia** a `doctors.license_number`.
- Se **valida en el reclamo** (`claim_doctor_profile`, `s7_13`): el médico tipea su licencia y el RPC la compara **server-side** contra `doctors.license_number` (nunca expone el número al cliente).
- Después es ~inmutable desde UI (el médico no la edita; admin-edit no la expone; cambios por soporte).

**Visibilidad hoy:**
- **Público:** **NO viaja** (removido en #197; `fetchDoctors` tampoco lo trae).
- **Admin:** visible en la bandeja de afiliación (lead) para validar — admin-only.
- **Panel del médico:** ve **su propia** licencia (read-only, dato propio autenticado — no es leak).

## 3. Limitaciones del modelo actual

1. **No distingue JVPM vs NUE** — un solo campo genérico; un NUE no tendría dónde ir sin mezclarse.
2. **No permite varias credenciales** por médico (un especialista tiene JVPM **y** NUE).
3. **No tiene estado por credencial** (`pending`/`verified`/`rejected`).
4. **No tiene visibilidad pública por credencial** (mostrar/ocultar, parcial/total).
5. **No tiene auditoría específica** de verificación (quién/cuándo/qué/motivo de rechazo).
6. **`is_verified` es global**, no por credencial → no se puede afirmar "JVPM verificada" o
   "NUE verificado" de forma **veraz** con el modelo actual.

## 4. Riesgos

| # | Riesgo | Nota |
|---|---|---|
| R1 | **Exponer números** (JVPM/NUE) al público | ID profesional crudo, sin valor para el paciente. |
| R2 | **Scraping** | Un número público es cosechable masivamente. |
| R3 | **Suplantación** | Un número expuesto facilita hacerse pasar por el médico. |
| R4 | **Confundir JVPM con NUE** | Modelo de un solo campo genérico. |
| R5 | **Afirmar NUE sin tener NUE** | Hoy no existe NUE; cualquier claim sería falso. |
| R6 | **"Especialista acreditado" basado solo en `specialty_id`** | `specialty_id` no acredita; sería sobrepromesa. |
| R7 | **Confundir `claimed` con `verified`** | Reclamar (tipear licencia) ≠ verificación. |
| R8 | **Confundir pago con verificación** | Pagar la suscripción ≠ `verified` (ver doc de pagos). |
| R9 | **Mostrar credencial no verificada** | Sin estado por credencial, un claim no estaría respaldado. |

## 5. Reglas de visibilidad recomendadas

- **No mostrar números por defecto** (ni completos ni parciales) — solo con decisión explícita posterior.
- Mostrar **señales textuales de confianza solo si están respaldadas** por verificación real.
- **Visibilidad controlada por LucyAdmin** (no automática; nunca derivada del pago ni del claim).
- Una credencial es **pública solo si `status='verified'` E `is_public=true`**.
- Al payload público viaja, a lo sumo, el **estado/etiqueta de confianza**, **nunca el número**.

## 6. Modelo recomendado — tabla futura `doctor_credentials`

> Propuesta de diseño. **NO se implementa en este documento.** Reemplaza la idea de
> columnas sueltas (`jvpm_number`/`nue_number`), que es más rígida (1 JVPM + 1 NUE)
> y no soporta auditoría/estado por credencial.

```
doctor_credentials
  id
  doctor_id            -- FK a doctors (0..N credenciales por médico)
  type                 -- enum: 'JVPM' | 'NUE' | 'OTHER'
  value               -- valor interno de la credencial (NUNCA al payload público)
  status               -- enum: 'pending' | 'verified' | 'rejected'
  is_public            -- bool (default false): mostrar señal pública si verified
  rejection_reason     -- text null (motivo si 'rejected')
  verified_by          -- FK admin que verificó (null si pending)
  verified_at          -- timestamptz null
  created_at / updated_at
  -- audit en audit_log con edited_via distintivo
```

Reglas del modelo:
- **JVPM ≠ NUE.** `type` distingue. **NUE solo para especialistas/subespecialistas**;
  no todos los médicos tienen NUE. Un especialista puede tener **JVPM y NUE**.
- **Estado por credencial** (`pending`/`verified`/`rejected`) — independiente de `is_verified`
  global del médico.
- **`value` (el número) NUNCA viaja al cliente público.** Solo viaja, si acaso, el
  estado/etiqueta ("verificada por LucyCare") cuando `status='verified'` y `is_public=true`.
- **Auditoría:** `verified_by`/`verified_at`/`rejection_reason` + `audit_log`.
- **Relación con `doctors`:** la tabla cuelga de `doctor_id`; `doctors.license_number` actual
  podría **migrarse** a una fila `type='JVPM'` (decisión de la fase de migración, no ahora).
- **Relación con `is_verified`:** se mantienen separados — `is_verified` = trust global del
  médico (LucyAdmin); `doctor_credentials` = credenciales específicas verificadas. Una no
  implica la otra automáticamente (a definir la regla de composición en la fase de diseño).

## 7. Experiencia futura (cuando exista el modelo)

- **LucyAdmin** captura/verifica credenciales (marcar `verified`/`rejected` con motivo + audit).
- El **médico** puede **proponer** una credencial (queda `pending`); LucyAdmin valida.
- El **perfil público** muestra una **señal de confianza, no necesariamente el número**:
  el paciente ve **"Credenciales verificadas por LucyCare"** (o "JVPM verificada" /
  "NUE de especialista verificado") **solo** cuando esa credencial está `verified` + `is_public`.
- Mantiene la separación: **pago ≠ verified ≠ claimed**, y **verificación global ≠ credencial específica**.

## 8. Fases sugeridas (ninguna arranca sin abrir su frente)

| Fase | Qué | Tipo |
|---|---|---|
| F0 | **Diseño** (este documento) | docs-only ✅ |
| F1 | **Modelo / migración** `doctor_credentials` (+ enum tipos/estados, RLS, audit) | migración `s7_NN`/`s8_NN` |
| F2 | **UI LucyAdmin** — capturar / verificar / rechazar / marcar público | frontend + RPCs |
| F3 | **Captura / propuesta por el médico** (estado `pending`) | frontend + RPC |
| F4 | **UI pública** — señal de confianza **sin número** (gated `verified` + `is_public`) | frontend |
| F5 | **Auditoría / reportes** de credenciales | admin/reportería |

> Cada fase = 1 PR chico, con `check-*.mjs`/smoke donde aplique, `tsc`+`build` verdes,
> preview validado, y **el número de la credencial nunca al payload público**.

## 9. Qué puede mostrarse AHORA (con el modelo actual)

- ✅ Badge **"Verificado"** (existente, = `is_verified` / LucyAdmin).
- ✅ copy **"Verificado por LucyCare"** junto al badge — **sin números**.
  *(Ya live desde #199; este documento lo anticipaba como "PR posterior".)*
- ✅ **`JVPM:` en la receta impresa** — excepción legítima y acotada: identifica
  al prescriptor. Ver §0.3.
- ❌ **NO** mostrar todavía: "JVPM verificada", "NUE verificado", número JVPM,
  número NUE, ni "especialista acreditado" basado solo en `specialty_id`.

## 10. Recomendación

> **Actualizada por §0 (2026-07-16).** El punto 3 cambió de peso: F1 ya no es
> "cuando se decida avanzar" — es el vehículo de un arreglo de seguridad
> pendiente (§0.1). El resto sigue igual.

1. **No exponer credenciales** (número ni claim por-tipo) **hasta tener el modelo** (`doctor_credentials`, §6).
2. Mientras tanto, la única señal de confianza **veraz** es el **badge `is_verified`**
   (con copy "Verificado por LucyCare", ya live en #199, sin números).
3. **F1 (modelo/migración) es la prioridad del eje** y debe cumplir §0.2; la UI
   pública (F4) sigue siendo lo último.
4. Mantener vinculante: **pago ≠ verified ≠ claimed**, **verificación global ≠ credencial específica**,
   y **el número nunca viaja al cliente público** — con la excepción explícita y
   acotada de la **receta impresa** (§0.3).
