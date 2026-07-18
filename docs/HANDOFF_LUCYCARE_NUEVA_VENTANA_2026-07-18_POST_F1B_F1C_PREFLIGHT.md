# HANDOFF — Nueva ventana (2026-07-18, post F1-b + preflight F1-c)

> **PUNTO DE ENTRADA VIGENTE.** Leer este primero. Reemplaza como handoff
> operativo al `2026-07-14` (que queda histórico, pero su §2 sigue siendo la
> mejor referencia del eje clínico F1–F7 y su §2-bis de SEO/Perf).

---

## 0. INSTRUCCIÓN 0 — arranque de la nueva ventana (copiar tal cual)

```text
Continuamos LucyCare en nueva ventana.

1) Sincronizá el repo:
   git fetch origin && git checkout main && git pull --ff-only origin main
   git log --oneline -5
   git status --short
   gh pr list --state open

2) Leé en este orden:
   a. docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-07-18_POST_F1B_F1C_PREFLIGHT.md  (este)
   b. CLAUDE.md
   c. docs/ANALISIS_CREDENCIALES_MEDICAS.md  (§0-bis primero)

3) Confirmá el estado técnico esperado:
   HEAD 76a9565 (o posterior) · PRs #1–#293 · migraciones hasta s7_62 ·
   main == origin/main · árbol limpio · 0 PRs abiertos · sin preview/servers/
   fixtures/scripts temporales · sin frente funcional abierto.

4) NO abras código. No creés ramas, migraciones ni scripts.

5) PEDIME el resultado del SQL de sincronía de §6 de este handoff.
   Yo (owner) lo ejecuto en el SQL Editor. NO lo ejecutes vos.

6) Con ese resultado, completá el preflight de DB pendiente (§7) —
   requiere autorización EXPLÍCITA de service_role read-only.

7) SOLO DESPUÉS proponé el alcance definitivo de F1-c.
   F1-c1 y F1-c2 (§5) son propuestas preliminares, NO autorizadas.
```

---

## 1. Estado técnico exacto

- **HEAD de `main`:** **`76a9565`**
- **PRs mergeados:** **#1–#293**
- **Migraciones aplicadas en Supabase:** hasta **`s7_62`**
- **`main == origin/main`** ✅ · **árbol limpio** ✅ · **0 PRs abiertos** ✅
- **Sin preview local · sin servers · sin fixtures · sin scripts temporales**
- **Sin frente funcional abierto.**

Últimos commits relevantes:

```
76a9565 docs: cierre de doctor_credentials F1-a y F1-b (#291, #292) (#293)
09bf39c feat(credenciales): cutover de lectores a doctor_credentials — F1-b (s7_62) (#292)
787c8fb feat(credenciales): modelo doctor_credentials — F1-a (s7_61) (#291)
dac7419 docs: consolidación post #286–#289 — s7_60, riesgo residual y prioridad de F1 (#290)
db8cf5e fix(security): hardening de grants sobre doctors — s7_60 (PR-A) (#289)
```

---

## 2. F1-a — CERRADA (PR #291 / `s7_61`)

**Modelo.** Aditiva, sin lectores nuevos.

- **Tabla `doctor_credentials`**: `doctor_id` · `type` (`JVPM`/`NUE`/`OTHER`) ·
  `value` · **`value_normalized` GENERATED** (espejo exacto de la normalización
  de `s7_13`: `upper` + quitar espacios) · `status`
  (`pending`/`verified`/`rejected`) · `is_public` (inerte hasta F4) ·
  `rejection_reason` · `verified_by` / `verified_at` · timestamps.
- **RLS por FILA:** `is_admin() OR doctor_id = get_user_doctor_id()`.
  `anon` **sin acceso**; `authenticated` con SELECT **filtrado por RLS** y **sin
  INSERT/UPDATE/DELETE** (nadie escribe directo); **`directory_editor` no ve
  credenciales**. Ésta es la pieza central: el valor es inalcanzable **por fila**,
  no por columna → no hicieron falta RPCs de lectura ni grants por columna.
- **Índice antifraude parcial:**
  `UNIQUE(type, value_normalized) WHERE type IN ('JVPM','NUE') AND status <> 'rejected'`.
  El `status <> 'rejected'` es **crítico**: sin él, un JVPM ajeno **rechazado**
  bloquearía para siempre al dueño legítimo — el antifraude protegería al fraude.
  *(`doctors` nunca tuvo una restricción así: esto AGREGA una garantía nueva.)*
- **Auditoría REDACTADA:** el trigger elimina `value` y `value_normalized` del
  payload y registra el booleano `value_changed`. El patrón habitual
  (`to_jsonb` de la fila) habría duplicado el JVPM en texto plano dentro de
  `audit_log`. El actor se resuelve con `COALESCE(auth.uid(), doctors.profile_id)`
  y el origen se marca en **`actor_source`** (`session`/`system`), porque
  `auth.uid()` es NULL con `service_role`/SQL Editor.
- **Backfill: 114 credenciales JVPM en `pending`.** A propósito: **nunca existió
  verificación a nivel de credencial**; marcarlas `verified` habría afirmado algo
  que nadie chequeó. **`is_verified` global no se tocó** (siguen desacopladas).
- **Trigger de sincronización** `trg_sync_license_to_credential`
  (`doctors.license_number → doctor_credentials`, dual-write). Se eligió trigger
  y **no** dual-write dentro de la RPC de afiliación porque esa RPC **no es el
  único escritor** (también `import-doctors.mjs` y scripts con `service_role`).
- **La columna antigua `doctors.license_number` SIGUE EXISTIENDO.**

Verificación: `check-s7_61` **5/5** · `_smoke-s7_61` **22/22**.

---

## 3. F1-b — CERRADA (PR #292 / `s7_62`)

**Cutover de lectores.** Panel, receta y claim leen `doctor_credentials`.

- **`claim_doctor_profile`** — cuerpo **verbatim de `s7_13`** salvo la sección 5
  (verificado con diff). Valida contra la credencial **sin devolver nunca el
  valor**; `P0001`–`P0005`, OTP, TOS, roles, vinculación y audit **idénticos**.
- **`sync_license_to_credential`** — mapea **solo** la colisión de
  `doctor_credentials_registry_uniq` al P-code estable **`P0091`** (vía
  `GET STACKED DIAGNOSTICS … CONSTRAINT_NAME`; el item es `CONSTRAINT_NAME`,
  **sin** prefijo `PG_`). Cualquier otro `unique_violation` se **re-lanza intacto**.
- **Frontend (3 archivos):** `getMyDoctorProfile` (panel) y
  `getConsultationContext` (receta) leen el embed
  `doctor_credentials(value, type, status)` y resuelven con el helper compartido
  **`resolveJvpm`**; `mapCreateError` traduce `P0091` a copy claro en la bandeja
  de afiliación. **`RecetaPrint` NO se tocó.**

> ### REGLA VINCULANTE DE LECTURA (panel · receta · claim)
> - **`pending` y `verified` → la credencial SE USA.**
> - **`rejected` → NO se usa y NO cae a la columna** (existe una fila: su estado manda).
> - **Fallback a `doctors.license_number` SOLO si NO existe fila JVPM** — nunca
>   para evadir un estado.

**Validación:**
- `check-s7_62` **2/2**
- `_smoke-s7_62` **E2E 13/13** — R1/R2 (embed + RLS) · **C1a**
  `claim(typed=COLUMNA)`→`P0007` y **C1b** `claim(typed=CREDENCIAL)`→éxito (el
  **desync** que prueba de qué tabla lee) · **J1** `rejected`→`P0006` aunque la
  columna coincida · J2–J5 (regla+datos) · **P1** duplicado→`P0091` / **P2** otra
  constraint→23505 propio.
- **QA visual completo (7/7) en superficies reales** — panel y receta ×
  `pending`/`verified`/`rejected`/fallback, con valores distintos por fuente para
  distinguirlas a simple vista.
- **Cleanup 0 residuos operativos** · Test Phone liberado ·
  `doctor_credentials` en **114** · **auditoría append-only preservada**.

**⚠️ F1-b NO cierra el riesgo residual de `s7_60`.** La columna existe, con
dual-write y fallback activos, y `authenticated` conserva su `SELECT`.

---

## 4. Preflight READ-ONLY de F1-c — hallazgos (análisis de código)

> Hecho **sin** `service_role` y **sin** tocar la DB. Cubre código, migraciones,
> scripts y tipos. **La parte de DB queda pendiente (§6 y §7).**

### 4.1 · Objetos SQL que rompería un DROP directo

| # | Objeto | Uso de `doctors.license_number` | Criticidad |
|---|---|---|---|
| 1 | **`admin_approve_and_create_doctor`** (`s7_42`, **vigente**) | `INSERT INTO doctors (…, license_number, …) VALUES (…, v_lead.license_number, …)` | 🔴 **BLOQUEANTE** |
| 2 | **`claim_doctor_profile`** (`s7_62` §5) | lee `d.license_number` como **fallback** | 🟠 alta |
| 3 | **`trg_sync_license_to_credential`** + su función (`s7_62`) | `NEW.license_number`; `AFTER INSERT OR UPDATE OF license_number ON doctors` | 🟠 alta |

*(`s7_22`/`s7_23`/`s7_24` son versiones históricas del approve, superadas por `s7_42`.)*

### 4.2 · Frontend

- `src/services/doctorProfile.service.ts` — `license_number` en el `select`, en
  el tipo, y **`resolveJvpm(…, d.license_number)`** (el `columnFallback`).
- `src/services/consultations.service.ts` — ídem (`select`, tipo, `resolveJvpm`).
- **`resolveJvpm`** conserva el parámetro **`columnFallback`** → es el fallback a
  retirar.
- `src/types/database.types.ts` — 3 líneas de la columna.
- **NO cambian:** `RecetaPrint.tsx` y `PerfilPage.tsx` (reciben el valor **ya
  resuelto**).

### 4.3 · Scripts y tests que dependen de la columna

- **`scripts/import-doctors.mjs`** — **ESCRIBE** `license_number` y lo usa para
  dedup. 🔴 se rompería el importador.
- `scripts/setup-test-doctor-prb.mjs` — lee/escribe la columna.
- `scripts/check-s7_13.mjs` — la lee para elegir un médico de prueba.
- `scripts/_smoke-s7_60.mjs` — prueba grants sobre la columna (T1/T8/T22).
- `scripts/_smoke-s7_61.mjs` / `_smoke-s7_62.mjs` — escriben/leen la columna para
  probar **dual-write** y **fallback** → quedan **obsoletos** tras F1-c.

### 4.4 · Lo que NO es esta columna (no tocar en F1-c)

**`doctor_affiliation_requests.license_number`** es **otra tabla** (la licencia
del *lead*). Por lo tanto **NO se tocan**: `AdminAffiliationsPage`,
`AdminAffiliationDetailModal`, `AffiliationRequestModal`, `affiliation.service`
(payload del lead) ni `claimProfile.service` (la licencia **tipeada** viaja como
argumento).

### 4.5 · Vistas

Revisadas las 6 vistas de `migrations/`: **ninguna referencia `license_number`**,
y sus `SELECT *` son de **`reviews`**, no de `doctors`. ✅
*(No descarta vistas del schema inicial — ver §7.)*

### 4.6 · Fallback: dónde sigue activo

**3 puntos:** `resolveJvpm` en panel, `resolveJvpm` en receta, y la §5 del claim.
Al retirarlo, un médico **sin fila JVPM** quedaría sin licencia en panel/receta y
**no podría reclamar** (`P0006`). En teoría son 0 (backfill 114/114 + trigger
cubre altas) — **lo confirma la query de §6** (`falta_credencial`).

### 4.7 · Dual-write: dependencia crítica

Hoy **las altas por afiliación generan su credencial gracias al trigger**. Si se
dropea el trigger **sin** que el approve RPC escriba la credencial por su cuenta,
**los médicos nuevos nacerían sin credencial**. → **Fija el orden de ejecución.**

### 4.8 · Grants y seguridad

`s7_60` otorgó `GRANT SELECT ON doctors` **a nivel tabla** → por eso
`authenticated` **conserva `SELECT` sobre `license_number`** (el riesgo residual).
Revocar solo esa columna exigiría `REVOKE SELECT` + re-`GRANT` de las otras 19
(el "impuesto" por columna ya identificado).

**Pero al DROPEAR la columna, ese acceso residual desaparece con ella** → **no
hace falta revocar nada.** Ése es el argumento del DROP: elimina el secreto en
vez de administrar permisos sobre él.

**¿`doctor_credentials` cubre las lecturas legítimas?** **Sí** — demostrado por
F1-b (QA 7/7 en panel y receta; el claim valida contra ella). Lo único que hoy da
la columna y no la credencial es el **fallback**, que solo actúa si no hay fila.

### 4.9 · Matriz de riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Approve RPC rota → no se pueden crear médicos | Alta si se dropea sin tocarla | 🔴 crítico | Re-emitir `s7_42` **antes** del DROP |
| Médicos nuevos sin credencial al cortar el trigger | Alta | 🔴 crítico | El approve debe escribir la credencial **antes** de dropear el trigger |
| Médico sin fila JVPM pierde licencia y no puede reclamar | Baja | 🟠 alto | Query §6 (`falta_credencial = 0`) |
| Drift columna ↔ credencial al dropear | Baja | 🟠 alto | Verificar sincronía **inmediatamente antes** |
| `import-doctors.mjs` roto | Media | 🟡 medio | Actualizarlo en el retiro lógico |
| Objeto del schema inicial desconocido | Baja | 🟠 alto | Preflight de §7 |
| Regresión al re-emitir las 430 líneas de `s7_42` | Media | 🔴 crítico | PR aparte, diff acotado, smoke de afiliación |

### 4.10 · Veredicto

**NO APTO para un F1-c de un solo PR con DROP.**
**Potencialmente apto en dos etapas**, condicionado al resultado de §6 y §7.

El bloqueante es `admin_approve_and_create_doctor`: **exige re-emitir las 430
líneas de `s7_42`** — exactamente el riesgo que se evitó en F1-a usando un
trigger. Ahora es inevitable, y merece su propio PR con validación, no ir pegado
a un `DROP` irreversible.

---

## 5. Propuesta PRELIMINAR — NO autorizada, NO iniciada

> ⚠️ **Esto NO es un alcance aprobado.** Es la dirección prevista.
> **NO hay autorización** para tocar código, DB, grants, triggers ni para
> eliminar la columna. **No crear ramas, migraciones ni código.**
> El alcance final se decide **después** de §6 y §7.

**F1-c1 · Retiro lógico (sin DROP, reversible) — a validar, no a ejecutar**
1. re-emitir `admin_approve_and_create_doctor` para que **escriba la credencial
   directamente** (deja de depender del trigger);
2. re-emitir `claim_doctor_profile` **sin fallback**;
3. retirar el fallback del frontend (`resolveJvpm` pierde `columnFallback`);
4. actualizar `scripts/import-doctors.mjs`;
5. **cortar el dual-write** (drop del trigger).
   → La columna queda **viva pero muerta en uso**. Reversible.

**F1-c2 · DROP físico (irreversible) — a validar, no a ejecutar**
Tras un período de observación: verificar sincronía + preflight de dependencias
→ `DROP COLUMN doctors.license_number` → actualizar tipos y scripts de test.
**El grant residual se va solo con la columna.**

**Por qué dividir:** separa el cambio funcional riesgoso (approve) del acto
irreversible (DROP); si algo falla en F1-c1, la columna sigue ahí como red.

---

## 6. SQL PENDIENTE DEL OWNER — sincronía columna ↔ credencial

> **Primer paso de la nueva ventana.** Read-only, solo conteos, **ningún JVPM
> sale**. **Lo ejecuta el OWNER** en el SQL Editor; el dev **no** lo ejecuta.

```sql
with col as (
  select id, nullif(btrim(license_number),'') as lic from doctors
), cred as (
  select doctor_id, value, status,
         upper(regexp_replace(coalesce(value,''),'\s','','g')) as norm
  from doctor_credentials where type = 'JVPM'
)
select
  (select count(*) from doctors)                                          as medicos_total,
  (select count(*) from col where lic is not null)                        as con_columna,
  (select count(*) from cred)                                             as con_credencial_jvpm,
  (select count(*) from col c join cred r on r.doctor_id = c.id
     where upper(regexp_replace(coalesce(c.lic,''),'\s','','g')) <> r.norm) as valores_distintos,
  (select count(*) from col c left join cred r on r.doctor_id = c.id
     where c.lic is not null and r.doctor_id is null)                     as falta_credencial,
  (select count(*) from cred r left join col c on c.id = r.doctor_id
     where c.id is null or c.lic is null)                                 as falta_columna,
  (select count(*) from cred where status = 'rejected')                   as rechazadas,
  (select count(*) from cred where status = 'verified')                   as verificadas,
  (select count(*) from cred where status = 'pending')                    as pendientes,
  (select count(*) from (select doctor_id from cred group by doctor_id having count(*)>1) x) as duplicados;
```

**Valores esperados si todo está sano — ⚠️ HIPÓTESIS, NO CONFIRMADO:**

| Métrica | Esperado |
|---|---|
| `medicos_total` | 114 |
| `con_columna` | 114 |
| `con_credencial_jvpm` | 114 |
| `valores_distintos` | **0** |
| `falta_credencial` | **0** |
| `falta_columna` | **0** |
| `duplicados` | **0** |
| `rechazadas` | **0** |

> **NO tratar estos valores como confirmados hasta que el owner ejecute la
> consulta y entregue los resultados.** Cualquier desvío (sobre todo
> `valores_distintos > 0` o `falta_credencial > 0`) **cambia el alcance de F1-c**.

---

## 7. Dependencias de DB TODAVÍA NO VERIFICADAS

Requieren **autorización específica de `service_role` read-only**. No se
ejecutaron:

- **`pg_depend`** — objetos que dependen de la columna;
- **`pg_views`** — vistas fuera de `migrations/` que la referencien;
- **triggers reales** sobre `doctors` (el schema inicial no está versionado:
  `migrations/` arranca en `s4_01`);
- **índices** sobre `license_number`;
- **constraints** (CHECK/UNIQUE/FK) que la involucren;
- **defaults** de la columna;
- cualquier **objeto del schema inicial** que dependa de `license_number`.

**Por qué importa:** `doctors` se creó **fuera** de `migrations/` (lo mismo que
destapó el `GRANT ALL` de `s7_60`). El análisis de código **no puede** ver esos
objetos.

---

## 8. Frente SEPARADO de producto — "Gestión y validación de credenciales profesionales"

> **No mezclar con F1-c.** F1-c es infraestructura (retirar una columna
> heredada); esto es **producto**.

**Objetivo futuro:**
- **actualización autoservicio** de JVPM/NUE por el propio médico;
- **propuesta del médico** → queda `pending` (no se auto-aprueba);
- **validación de formato y duplicados** (el índice antifraude ya existe);
- **la credencial anterior sigue vigente mientras se revisa** (no dejar al médico
  sin licencia durante la revisión);
- **aprobación/rechazo trazable** (`verified_by`/`verified_at`/`rejection_reason`
  + `audit_log`, ya modelados en `s7_61`);
- **mínima dependencia de soporte** (hoy el cambio de licencia es manual).

Se apoya en F2/F3 de `docs/ANALISIS_CREDENCIALES_MEDICAS.md` (UI LucyAdmin para
verificar/rechazar; propuesta del médico). **Al abrir ese frente, leer ese
documento primero para no rediseñar lo ya decidido.**

---

## 9. Reglas operativas vigentes (VINCULANTES)

- **Un solo frente a la vez.**
- **No abrir PR sin autorización** del owner; **no mergear sin su OK explícito**.
- **No tocar DB/SQL/migraciones/`auth.users`** sin autorización. **El owner
  aplica el SQL**; el dev corre `check`/`smoke`.
- **`service_role` requiere autorización explícita, INCLUSO read-only.**
- **Datos de validación:** **jamás Katherine (`50372608827`)** ni datos reales
  sensibles. **Camilo (`50378627694`) solo como demo controlado.**
- **Fixtures:** propias, creadas desde cero, **marcadas**, **limpiadas** con
  **verificación de 0 residuales por ID exacto** + verificación complementaria
  por teléfono. **La auditoría (`audit_log`) NO se borra: es append-only por
  diseño** — "0 residuales" significa **0 residuos OPERATIVOS**.
- **PR que toca DB → migración + `check-s7_NN.mjs` + `_smoke-s7_NN.mjs`.**
- **Para cambios de UI:** pedir **preview / OK visual** del owner antes de mergear.
- **No mezclar** SEO / Analytics / Auth / Clínico / DB en un mismo PR.
- **Cierre estándar tras cada merge:** HEAD, PRs, migraciones,
  `main == origin/main`, `git status` vacío, rama borrada local+remoto, 0 PRs
  abiertos, sin residuos.
- **Validar el instrumento, no solo el fix:** correr la misma medición contra el
  estado **anterior** para comprobar que el problema se reproduce (A/B).

### Aprendizajes de método (de este eje)

> ⚠️ **Cómo leer esta sección.** Los ítems están clasificados en tres
> categorías, para **no convertir un incidente puntual en una regla universal**:
>
> - **[COMPORTAMIENTO]** — comportamiento **confirmado del sistema actual**
>   (este esquema, esta implementación). Puede cambiar si cambia el esquema.
> - **[RECOMENDACIÓN]** — práctica operativa que conviene seguir; no es una
>   restricción del sistema.
> - **[LIMITACIÓN OBSERVADA]** — lo que **se observó durante estas pruebas**, en
>   este contexto concreto. **No generalizar** más allá de lo verificado.

**[COMPORTAMIENTO — confirmado en el sistema actual]**

- **`audit_log.user_id` es `NOT NULL` en la implementación vigente**, y
  `auth.uid()` devuelve NULL cuando se escribe con `service_role` o desde el SQL
  Editor (no hay sesión). En consecuencia, **en este esquema**, un trigger de
  audit que use `auth.uid()` pelado falla con `23502` en esos contextos. *(Es una
  característica del diseño actual de `audit_log`, no una ley de Postgres ni de
  Supabase: si `user_id` pasara a ser nullable, esto dejaría de aplicar.)*
- **`GET STACKED DIAGNOSTICS`**: el item correcto es **`CONSTRAINT_NAME`**, sin
  prefijo `PG_` (ese lo llevan `PG_EXCEPTION_DETAIL` / `_HINT` / `_CONTEXT`).
  *(Esto sí es de Postgres, no del proyecto.)*
- **`signInWithOtp` crea el `auth.user` ANTES de `verifyOtp`** (con
  `shouldCreateUser` por defecto): un OTP que falla deja el usuario creado.
- **Guards de agenda vigentes:** `s6_03` bloquea citas en fechas pasadas y
  `s6_04` exige que la cita caiga dentro de la disponibilidad del médico.

**[RECOMENDACIÓN — práctica operativa]**

- **Un trigger de audit nuevo conviene que tenga fallback de actor**
  (`COALESCE(auth.uid(), <sujeto>)`) y que **marque el origen** (p. ej.
  `actor_source: 'session' | 'system'`), para no atribuir a una persona algo que
  hizo un proceso. Mientras `audit_log.user_id` siga siendo `NOT NULL`, además
  evita romper los scripts que escriben con `service_role`.
- **Nunca silenciar errores en un cleanup.** Un `.catch(() => {})` produce falsos
  "limpio": en este eje dejó una cuenta cáscara sin aviso. Verificar el `error`
  de cada borrado y reportarlo.
- **Distinguir "no existe" de "la llamada falló".** `getUserById` devuelve error
  en ambos casos; si no se separan, un fallo de red se lee como "borrado".
- **Verificar el cleanup por ID exacto**, y usar la verificación **por teléfono
  (u otra clave natural) como COMPLEMENTARIA, no como sustituto**: un recurso
  creado fuera del registro de la corrida solo se detecta por la segunda.
- **Registrar el ID del usuario creado por OTP ANTES de `verifyOtp`**, para que
  el cleanup lo alcance aunque el OTP falle.
- **Fixtures de cita:** crearlas **futuras** y con su `availability_rules`, por
  los guards de arriba.

**[LIMITACIÓN OBSERVADA — durante estas pruebas]**

- **Actualizar `profiles.full_name` con `service_role` falló en este esquema.**
  El trigger `audit_profiles_identity` (`s7_32`) es
  `AFTER UPDATE OF full_name, …` y audita con `auth.uid()`; sin sesión, ese
  `auth.uid()` es NULL y el INSERT en `audit_log` viola el `NOT NULL` de
  `user_id` → `23502`, y el UPDATE se aborta.
  **No es que `service_role` no pueda actualizar `full_name`**: `service_role`
  tiene privilegios de sobra. Es la **combinación** trigger de auditoría +
  ausencia de sesión + `user_id NOT NULL` la que lo impide **en la
  implementación actual**. Se esquivó creando el profile por INSERT (que no
  dispara ese trigger) en vez de actualizarlo. Si se necesitara hacerlo, las
  salidas serían corregir ese trigger (fallback de actor, como el de
  `doctor_credentials`) o establecer un contexto de sesión.
- **`auth.admin.listUsers()` falló con "Database error finding users"** en varias
  páginas de este proyecto (bug ya anotado en `CLAUDE.md`). El workaround usado
  fue derivar el `auth.user` desde `profiles.id` con `getUserById`. **Eso deja un
  hueco conocido:** un `auth.user` **huérfano** (sin `profile`) con un teléfono
  dado **no es detectable** por esa vía — la red de seguridad real fue que
  `createUser` falla si el teléfono ya existe.
- **El Test Phone debe configurarse con el prefijo de país** (`503…`): sin él,
  `verifyOtp` rechazó el código estático y `signInWithOtp` intentó envío real.
