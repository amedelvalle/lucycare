# HANDOFF LucyCare — nueva ventana (2026-08-24) · `PATIENT-CRM-P0`

> 🟢 **PUNTO DE ENTRADA CANÓNICO Y VIGENTE.** Autosuficiente: no asume que la
> ventana nueva conozca ninguna conversación anterior.
>
> ✅ **El BACKEND de `PATIENT-CRM-P0` está APLICADO y VERIFICADO** — `s7_76`
> (97) y `s7_77` (98), ambas CLOSED con 0 FAIL. **Lo que sigue abierto es el
> frontend, todavía sin commitear.** Ver la **§R** para el punto exacto de
> reanudación.
>
> **Este documento no contiene** PII de pacientes, OTPs, contraseñas, tokens,
> `service_role`, claves ni enlaces con credenciales.

---

## A · Baseline del proyecto

| Ítem | Valor |
|---|---|
| Proyecto | **LucyCare** — directorio médico y agenda, El Salvador |
| Repositorio | `github.com/amedelvalle/lucycare` (**público**) |
| Proyecto Supabase | `kvrsfmzlrmmmavillpuj` · nombre **lucycare** · East US (Ohio) |
| **Baseline de `main`** | **`b9edf91d135c74404711c2b8f9bffebdc0ad497e`** |
| **Rama de trabajo** | **`claude/patient-crm-p0`** — creada desde ese `main` |
| HEAD de la rama | **`cefe0376054f34185d2120060fcdb76a595a0d70`** — checkpoint **docs-only** del cambio de ventana, un commit por encima del baseline. El trabajo funcional sigue **sin commitear** |
| PRs abiertos al iniciar el frente | **0** |

### Frente anterior — cerrado

**`ADMIN-DOCTOR-SEED-P0` = CLOSED.** PR **#348 mergeado** (squash) el
2026-08-24; su merge commit **es** el baseline `b9edf91`. Rama
`claude/seed-doctor` **borrada** local y remotamente.

De ese frente quedó vigente en producción:

- **96 migraciones aplicadas**, hasta `s7_75_seed_claim_phone_sms_capable.sql`.
- **Edge Function `admin-create-seed-doctor`, `ACTIVE` versión 4.**
- **Cero seeds QA en producción**: la fixture del E2E se creó y se eliminó por
  completo (`admin_seed_operations` = 0, doctors 115, clinics 116).
- `audit_log` de esa QA **conservado** como evidencia — es inmutable desde
  `s7_71b`, no es un residuo.

### Frente hermano, NO tocar acá

> **`TYPES-RECONCILIATION-P0` es OTRO frente.** `src/types/database.types.ts`
> está desactualizado desde mucho antes de este trabajo: regenerarlo agrega **+8
> tablas, +3 vistas y +61 funciones** sin eliminar nada, y `tsc` pasa con 0
> errores — pero es un diff de alcance mucho mayor.
> **En `PATIENT-CRM-P0` NO se toca `database.types.ts`.**

---

## B · Objetivo de `PATIENT-CRM-P0`

Construir dentro de **LucyAdmin** un **CRM de pacientes** con dos funciones:
**operativa** y **comercial**, manteniendo **separación estricta del expediente
clínico**.

### Principios vinculantes

1. La unidad principal es la **identidad global LucyCare** (`profiles`), no la
   ficha local.
2. **No duplicar PII ni fuentes de verdad** existentes.
3. Las fichas `patients` son **relaciones clínicas/operativas** de esa
   identidad.
4. Los **walk-ins no vinculados** se manejan **aparte**.
5. **Paginación y filtros server-side.**
6. **Evitar N+1.**
7. **Bajo impacto en Supabase.**
8. **Sin campañas ni mensajería en P0.**
9. CRM **restringido al nivel administrativo ya autorizado** para
   `/admin/pacientes`.
10. **La información clínica nunca se convierte en información comercial.**

### ⚠️ Naturaleza de los datos actuales

> **Todos los pacientes y fichas que hoy existen en producción son datos de
> prueba/QA.** No representan pacientes reales ni métricas comerciales de
> LucyCare.

Sus cantidades sirven **únicamente** para validar estructura, cardinalidades y
QA. **No** son una base de clientes y **ninguna decisión comercial** se deriva
de sus porcentajes. El diseño se orienta al comportamiento esperado **cuando
ingresen pacientes reales**.

---

## C · Diagnóstico inicial de `/admin/pacientes`

> ### Hoy `/admin/pacientes` **NO es una lista de pacientes**. Es una consola de deduplicación.

Su título literal es **«Pacientes — Fusión de fichas»**. Medido sobre el código:
**6** llamadas a servicios de merge/rechazos y **0** a cualquier listado de
pacientes. No hay buscador, paginación, filtros, ficha ni métricas.

Contiene: **candidatos de duplicados** · **merge** · **unmerge** · **vínculos
rechazados** · **historial de fusiones**, con preflight, confirmación por frase
tecleada y reversa formal.

> **Esa lógica se conserva íntegra.** El CRM no es una evolución de esa
> pantalla: es una pantalla nueva **junto** a ella.

### Arquitectura UX aprobada — tres pestañas

1. **Base de pacientes** (nueva)
2. **Pendientes de identificar** (nueva)
3. **Fusión de fichas** — conserva la implementación existente

**RPCs y tablas existentes que hay que respetar:**
`admin_list_patient_merge_candidates` · `admin_merge_patients_preflight` ·
`admin_merge_patients` · `admin_unmerge_patients_preflight` ·
`admin_unmerge_patients` · `admin_list_patient_link_rejections` ·
`admin_resolve_link_rejection` · `find_patient_match_candidates` · tabla
`patient_merge_log`.

---

## D · Modelo observado (agregados, sin PII)

| Métrica | Valor |
|---|---|
| `patients` (fichas QA) | **31** |
| fichas **vinculadas** (`profile_id` no nulo) | **9** |
| fichas **sin `profile_id`** (walk-in) | **22** |
| identidades globales distintas con ficha | **4** |
| `profiles` con `role='patient'` | **25** |
| **de esos 25, con CERO fichas** | **22** |
| `role='patient'` que **también es doctor** | **≥ 1** |
| `role='patient'` que **también es `clinic_member`** | **≥ 1** |
| `appointments` | 92 · futuras 4 · `manual` 64 / `lucy_directorio` 28 |

> ### Conclusión: `profiles.role='patient'` NO es por sí solo un discriminador suficiente.

El approve con `reuse_patient` (`s7_42`) crea el médico sobre el profile del
paciente y **no toca `role`**; las identidades técnicas del seed (`s7_73`) nacen
con `role='patient'` porque así las crea `handle_new_user`. Y con `patients`
como raíz, **22 de 25 identidades serían invisibles**.

### Estados de cita disponibles

`programada`(1) · `confirmada`(2) · `en_sala`(3) · **`atendida`(4, final)** ·
`cancelada`(5, final) · `no_asistio`(6, final). **`atendida` es la señal
confiable de atención completada** — existe, no hubo que inventarla.

---

## E · Decisiones D1–D5 — APROBADAS y vinculantes

**D1 · Entidad CRM.** La identidad global `profiles` es el paciente del CRM. Los
`patients` vinculados son fichas/relaciones locales. Los
`patients.profile_id IS NULL` van aparte como **«Pendientes de identificar»**, y
**los dos conteos NO se suman** bajo «Pacientes totales».

**D2 · Estados.** `Nuevo` · `Activo` · `En seguimiento` · `Recurrente` ·
`Inactivo` · `Bloqueado/restringido`.

Umbrales P0: **Nuevo** ≤ 30 días · **Recurrente** ≥ **2** citas `atendida` ·
**Activo** cita futura o actividad ≤ 90 días · **Inactivo** sin cita futura y
> 180 días · **En seguimiento** con follow-up abierto · **Bloqueado**
persistido.

Prioridad visual:
`bloqueado > en_seguimiento > recurrente > nuevo > activo > inactivo`.

> **Los estados derivados NO se persisten.** Persistirlos exigiría un job de
> recálculo y quedarían desincronizados al primer cambio de cita.

**D3 · Persistencia.** Solo metadata CRM **no derivable**: bloqueo · tags ·
follow-ups · notas administrativas. **No duplicar** nombre, teléfono, correo,
citas, médicos ni clínicas. El bloqueo lleva trazabilidad completa —motivo,
actor y fecha— **tanto al bloquear como al levantar**.

**D4 · Notas administrativas.** Solo LucyAdmin. **No visibles al médico.** No
reutilizan campos clínicos.

**D5 · Walk-ins.** Sección separada · sin creación automática de Auth · sin
campañas · sin SMS/WhatsApp/correo · **no son base comercial LucyCare hasta la
vinculación válida**. Se reutilizan las herramientas de linking y deduplicación
existentes.

---

## F · Frontera clínica — regla de seguridad

> **No basta con esconder la información clínica en React. Las RPCs del CRM no
> deben seleccionarla ni transportarla al navegador.**

Prohibido devolver, entre otros: `allergies` · `blood_type` · `patients.notes` ·
`internal_notes` · `reason_id` cuando transporte semántica clínica ·
`cancel_reason_id` · `price` · `payment_status` · `emergency_contact_*` ·
diagnósticos · recetas · consultas · medicamentos · resultados · antecedentes ·
signos vitales · cualquier información asistencial equivalente.

**El check estático protege esta frontera** verificando 16 columnas prohibidas
**sobre el texto de la migración**, no sobre el JSX.

---

## G · Timeline

> **`audit_log` NO es el event store general del CRM.**

Fuentes de verdad prioritarias: `profiles` · `patients` · `appointments` ·
follow-ups CRM. `audit_log` puede aportar **eventos administrativos concretos
mediante allowlist estricta**. **Nunca** devolver `old_data`/`new_data`
completos al frontend.

---

## H · Performance

- Página inicial **25**, máximo UI **50**.
- Búsqueda, filtros y orden **server-side**.
- `LEFT JOIN LATERAL` **sobre la página**, no sobre toda la base.
- **Cero N+1.**
- **`patients(profile_id)` es el JOIN central y HOY NO EXISTE** — el único
  índice de `patients` es funcional, sobre el teléfono (`s7_65`).
- **No reutilizar `getPatientsList`**: es del panel médico, filtra por
  `clinic_id` y trae `appointments(start_time)` **embebido y sin límite**.

---

## I · Implementación actual

> ### ✅ SUPERADO (2026-08-24): **el BACKEND del frente está APLICADO y VERIFICADO.**
>
> | Migración | Estado |
> |---|---|
> | **`s7_76`** · fundación de datos (97) | **APPLIED / PASS / CLOSED** — POST 39 PASS · 0 FAIL |
> | **`s7_77`** · RPCs de lectura (98) | **APPLIED / VERIFIED / CLOSED** — PRE 29 PASS · POST catálogo 57 PASS · POST funcional 22 PASS · 0 FAIL en los tres |
>
> **Ninguna de las dos se vuelve a aplicar.** Detalle y evidencia en
> `docs/OWNER_S7_76_APPLY.md` y `docs/OWNER_S7_77_APPLY.md`.
>
> Verificado en vivo, entre otras cosas: el orden **filtro → conteo →
> paginación** (los seis estados particionan el universo, el total no cambia al
> paginar, el filtro recorre todo el conjunto); la **allowlist cerrada** de
> `p_status`, que rechazó una entrada con forma de PII con **`P0147`** sin
> repetir el valor y **sin escribir en `audit_log`**; la vista canónica de una
> sola columna con `security_invoker = true`; y el **mínimo privilegio** —ni
> `PUBLIC`, ni `anon`, ni `authenticated`, ni `service_role`— sobre la vista y
> los tres helpers privados.
>
> Datos del entorno que quedaron medidos: **PostgreSQL 17.6** · **`pg_trgm` NO
> instalada**, así que los dos índices trigram del buscador no se crearon
> (deuda `CRM-SEARCH-TRGM`, no bloqueante).
>
> ### ⚠️ LO QUE SIGUE ABIERTO ES EL **FRONTEND**.
>
> `PatientsCrmTab.tsx`, `UnlinkedPatientsTab.tsx`, `patientCrm.service.ts`,
> `src/lib/csv.ts` y la modificación de `AdminPacientesPage.tsx` están
> **locales, sin commitear y sin PR**. También `scripts/check-s7_76.mjs`
> (353/353) y `scripts/_qa-crm-paginacion.mjs` (35/35).
>
> El resto de esta sección describe el estado **anterior** al apply y se
> conserva como contexto.

### Nombres exactos, extraídos del código

**Cuatro tablas CRM** (`s7_76`), todas con FK a `profiles`:

- `patient_crm` — **PK = FK** a `profiles(id)`; único estado persistido: el
  bloqueo (`blocked_at`, `blocked_reason`, `blocked_by`, `unblocked_at`,
  `unblocked_reason`, `unblocked_by`)
- `patient_crm_tags`
- `patient_crm_followups`
- `patient_crm_notes`

**Índices** (`s7_76`):

- `patient_crm_tags_uniq` *(único, `profile_id` + `lower(btrim(tag))`)*
- `idx_patient_crm_followups_abiertos` *(parcial, `status='abierto'`)*
- `idx_patient_crm_notes_profile`
- **`idx_patients_profile_id`** *(parcial, el JOIN central)*
- `idx_patients_sin_identidad` *(parcial, `profile_id IS NULL`)*
- `idx_appointments_patient_start`
- `idx_appointments_patient_status`
- `idx_profiles_full_name_trgm` y `idx_patients_full_name_trgm`
  *(condicionales: solo si `pg_trgm` está instalada)*

**Auditoría** (`s7_76`): función `audit_patient_crm()` + un trigger por tabla,
nombrado `audit_<tabla>`. Policies: una por tabla, nombrada
`<tabla>_select_admin`.

**Vista, helpers y RPCs** (`s7_77`):

| Objeto | Rol |
|---|---|
| **`crm_patient_identity`** *(VIEW)* | **predicado canónico** de identidad de paciente. `FROM` raíz de todo el CRM |
| `_crm_estado(boolean, int, int, timestamptz, timestamptz, timestamptz, timestamptz)` | umbrales de los estados derivados. **Privada** |
| `_crm_patients_json(text, text, int, int)` | **núcleo compartido** por listado y exportación. **Privada** |
| `admin_list_patients_crm(text, text, int, int)` | listado paginado |
| `admin_list_unlinked_patients(text, int, int)` | «Pendientes de identificar» |
| `admin_patients_crm_stats()` | métricas superiores |
| `admin_export_patients_crm(text, text, text)` | exportación (P5) |

**Códigos de error definidos:** `P0140` (no autorizado) · `P0141` · `P0142` ·
`P0143` · `P0144` · `P0145` · `P0146` (excede el tope de exportación).

---

## J · Seguridad propuesta — leída del SQL local

### Las cuatro tablas

| Aspecto | Valor |
|---|---|
| Owner | el de la migración (`postgres` en el SQL Editor) |
| RLS | **activa** en las cuatro |
| Policies | **exactamente una** por tabla: `<tabla>_select_admin`, `FOR SELECT`, **`TO authenticated`**, `USING (public.is_admin())`, sin `WITH CHECK` |
| GRANT | `SELECT` a `authenticated`, nada más |
| REVOKE | `ALL` de `PUBLIC` y `anon` |
| DML de cliente | **ninguno** |

> La cláusula **`TO authenticated` es explícita**: omitirla equivale a
> `TO PUBLIC` — exactamente el defecto que `s7_74` tuvo que corregir en el
> frente anterior.

### Vista y helpers privados

`crm_patient_identity`, `_crm_estado` y `_crm_patients_json`: **`REVOKE ALL` de
`PUBLIC`, `anon` y `authenticated`**. Solo los alcanzan las RPCs
`SECURITY DEFINER`, que corren como owner.

La vista aplica **`security_invoker = true` condicionalmente**, solo si
`server_version_num >= 150000` (en PostgreSQL 14 la opción no existe y el
`ALTER` abortaría la migración). **La versión live del motor no se pudo
determinar** desde el entorno de trabajo.

### Las RPCs

| Aspecto | Valor |
|---|---|
| Modo | **`SECURITY DEFINER`** |
| Volatilidad | **`STABLE`** las tres de lectura · **`VOLATILE`** la de exportación (escribe auditoría) |
| `search_path` | **`public, pg_catalog`** explícito |
| EXECUTE | solo `authenticated`; `REVOKE` de `PUBLIC` y `anon` |
| Gate | **`is_admin()` como primera instrucción**, error `P0140` |

### Acceso administrativo — fuente autoritativa (`s7_57`)

| Nivel | Dónde vive |
|---|---|
| **`owner_admin`** | **`profiles.role = 'admin'`** — *no* está en la tabla |
| `operations_admin` | `lucyadmin_access` con `is_active = true` |
| `directory_editor` | `lucyadmin_access` con `is_active = true` |

`is_admin()` = `role='admin'` = **Owner Admin**, que es **exactamente** el
criterio de `RequireOwnerAdmin`, el guard que hoy protege `/admin/pacientes`.

> **`RequireOwnerAdmin` y las RPCs deben permanecer alineados. No se desea
> ampliar el acceso** a `operations_admin`, `directory_editor` ni médicos.

---

## K · P1 y P1.1 — evolución del predicado

### El error de diseño original

La primera versión excluía a **cualquiera** con fila en `doctors` o
`clinic_members`. **Eso eliminaba del CRM a personas que simultáneamente pueden
ser pacientes**: un médico puede ser paciente de otro médico; un asistente
también.

### Solución vigente — exclusiones asimétricas

**DURAS — siempre OUT, tengan ficha o no:**

1. profile inactivo (`is_active = false`);
2. acceso administrativo vigente (`role='admin'` **o** `lucyadmin_access` con
   `is_active = true`);
3. identidad seed/técnica.

**BLANDAS — OUT solo si NO hay evidencia real de relación de paciente:**
médico · staff de clínica · dueño de clínica.

**Evidencia fuerte:** `EXISTS patients WHERE patients.profile_id = profile.id`.

### Casos cubiertos

| # | Caso | Resultado |
|---|---|---|
| 1 | patient, 0 fichas | **IN** |
| 2 | patient + ficha | **IN** |
| 3 | doctor puro | **OUT** |
| 4 | **doctor + ficha de paciente** | **IN** |
| 5 | staff puro | **OUT** |
| 6 | **staff + ficha** | **IN** |
| 7 | owner admin | **OUT** |
| 8 | operations_admin | **OUT** |
| 9 | directory_editor | **OUT** |
| 10 | seed | **OUT** |
| 11 | inactive | **OUT** |

Más dos refuerzos: **admin + ficha → OUT** y **seed + ficha → OUT**, porque esas
exclusiones son duras.

> **Instrumento validado A/B:** al convertir la rama del `OR` en un `AND` —el
> error original— los checks cayeron a **166/170** señalando exactamente que la
> relación de paciente había dejado de ser una alternativa. Restaurado, 170/170.

---

## L · P2 — `_crm_estado` · **CLOSED conceptualmente**

**Defecto descubierto:** la función estaba declarada `IMMUTABLE` **y usaba
`now()`**. Es una mentira al planificador: PostgreSQL puede cachear el
resultado, plegarla en tiempo de planificación o usarla en un índice, y devolver
estados congelados.

**Estado actual local:** recibe **`p_ahora timestamptz`** explícito · **no usa
reloj internamente** · quien la llama pasa `now()` · puede permanecer
`IMMUTABLE` legítimamente. El **check estático** y una **guarda POST** validan
la ausencia de `now()`, `current_date`, `current_timestamp`, `clock_timestamp`,
`localtimestamp`, `transaction_timestamp` y `statement_timestamp`, y que
`provolatile = 'i'`.

**P2 = CLOSED conceptualmente. Nada aplicado live.**

---

## M · P3 — canal · **CLOSED conceptualmente**

> **`appointments.source` NO equivale a adquisición comercial.**

Semántica P0: **«Canal 1.ª cita»**. Valores actuales: **Directorio LucyCare**
(`lucy_directorio`) y **Alta del médico** (`manual`).

**`acquisition_source` queda RESERVADO** para evidencia futura demostrable —UTM,
referral, campaña, captura administrativa u otras—, y se agregará como columna
propia, **no reinterpretando este campo**. No se inventan canales tipo Google o
referido.

**P3 = CLOSED conceptualmente.**

---

## N · P4 — rollback · **CLOSED conceptualmente**

`s7_76_rollback.sql` era inicialmente **destructivo**. Ahora es **fail-closed**:

- cuenta las **cuatro** tablas antes de tocar nada;
- si existe metadata CRM real, **ABORTA** indicando cuántas filas hay en cada
  una;
- **no hace `DROP` silencioso** de notas, tags, follow-ups ni bloqueos.

> Esa metadata **no tiene otra fuente de verdad**: no se reconstruye desde
> `profiles`, `patients` ni `appointments`.

Una reversión **posterior a uso real** requerirá backup, migración,
preservación o estrategia `_deprecated`, **decidida explícitamente por el
owner**. Está documentado que **deliberadamente no se automatiza**.

`s7_77_rollback.sql` es **no destructivo para los datos** (solo elimina
funciones y la vista). Ambos son **autosuficientes** y están marcados
**NO EJECUTAR**.

**P4 = CLOSED conceptualmente.**

---

## O · P5 — exportación

**Requisito de producto:** LucyAdmin deberá poder **exportar tablas
administrativas**. En este frente, **solo pacientes**.

> **Deuda registrada: `ADMIN-DOCTOR-EXPORT`** — aplicar el mismo patrón seguro a
> la tabla de médicos. **No se implementa en este frente.**

### Estado local actual

- Exportación construida **sobre el mismo núcleo backend que el listado**
  (`_crm_patients_json`) — **no** una consulta paralela.
- Respeta la búsqueda y los filtros vigentes.
- Exporta el **conjunto filtrado completo**, no solo la página visible.
- **`MAX_EXPORT = 5000`**, con `P0146` si se supera.
- **10 000 requiere diseño posterior** (streaming o generación asíncrona); no se
  resuelve subiendo la constante.
- **Walk-ins no se mezclan** en el export comercial.
- **Notas administrativas no se exportan** en P0.
- **Ninguna información clínica puede salir**: la consulta que alimenta el
  archivo es la misma del listado, que no recupera esas columnas.
- La pantalla **sigue paginada** en 25/50: exportar no relaja esa protección.

### Dependencia

**`xlsx@^0.18.5` ya existe en `devDependencies`** y hoy la usan **únicamente
scripts de Node** (importadores y catálogos). **No está en el bundle del
navegador.** **`package.json` NO se modificó.**

La implementación local actual usa **CSV UTF-8 con BOM** (el BOM evita que Excel
en Windows rompa tildes y eñes), sin dependencia nueva.

> ⚠️ **La decisión final del owner sobre mantener P0 solo con CSV, o incorporar
> `xlsx` al frontend, se dará en la siguiente ventana. NO hacer cambios ahora.**
> La propuesta pendiente de decisión era: mover `xlsx` a `dependencies` y
> cargarla con `import()` dinámico, para que el bundle inicial no crezca.

### Auditoría de exportación propuesta

Actor (`auth.uid()`) · fecha · formato · cantidad de registros · filtros **no
PII** · **`con_busqueda` booleano** · **nunca el texto buscado** · **nunca
nombre, teléfono ni correo**.

La RPC de export **puede ser `VOLATILE`** precisamente por esta escritura de
auditoría, y una guarda POST lo exige.

---

## P · Estado de checks

| Verificación | Resultado |
|---|---|
| **`check-s7_76`** | **170/170 PASS** |
| `check-s7_73` | **236/236 PASS** |
| `check-s7_74` | **28/28 PASS** |
| `check-s7_75` | **67/67 PASS** |
| `tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |
| `git diff --check` | **PASS** |

Confirmado además:

- **`database.types.ts` intacto**;
- **`package.json` intacto**;
- **0 migraciones anteriores modificadas**;
- **0 PII en la documentación**;
- **sin SQL live · sin deploy · sin Auth · sin Edge · sin merge**.

---

## Q · 🔴 PUNTOS TODAVÍA NO RESUELTOS

> **NO resolverlos por iniciativa propia. Están documentados como próximos
> pasos; la instrucción exacta llegará del owner.**

### F1 · Seed exclusion

Falta **demostrar** si `profiles.email` de una identidad seed contiene realmente
el correo técnico `@doctor-seed.invalid` **durante la ventana de cleanup B→C**
—cuando la fila de `admin_seed_operations` ya se borró pero el `auth.user`
todavía existe—.

Debe verificarse **sin imprimir PII ni el correo completo**.

### F2 · Vista mínima

Falta revisar que **`crm_patient_identity` exponga únicamente lo indispensable**
—preferentemente `profile_id`— y no PII innecesaria.

**Estado actual:** la vista expone `id, full_name, phone, email, created_at`.

### Export audit

Falta **confirmación final** de: `auth.uid()` como actor · cero texto buscado ·
cero PII · únicamente filtros no sensibles y cantidad.

### CSV / XLSX

Falta **recibir la decisión final del owner**, que llegará en la siguiente
instrucción.

---

## R · ⭐ PUNTO EXACTO DE REANUDACIÓN

> ### El BACKEND de `PATIENT-CRM-P0` está **APLICADO, VERIFICADO y CERRADO**.
>
> `s7_76` (97) y `s7_77` (98) están en producción, con PRE, POST de catálogo y
> POST funcional en **0 FAIL**. **Ninguna se vuelve a aplicar.**
>
> ### Lo que sigue abierto es el **FRONTEND**, y sigue **sin commitear**.

Archivos locales del frente, ninguno en Git todavía:

| Archivo | Qué es |
|---|---|
| `src/pages/admin/components/PatientsCrmTab.tsx` | pestaña «Base de pacientes» |
| `src/pages/admin/components/UnlinkedPatientsTab.tsx` | pestaña «Pendientes de identificar» |
| `src/services/patientCrm.service.ts` | servicio de lectura + export CSV |
| `src/lib/csv.ts` | serializador CSV seguro para Excel |
| `src/pages/admin/AdminPacientesPage.tsx` | **modificado**: contenedor de tres pestañas |
| `scripts/check-s7_76.mjs` | verificación estática, **353/353** |
| `scripts/_qa-crm-paginacion.mjs` | QA de regresión del filtro, **35/35** |
| `migrations/s7_76_*.sql` · `migrations/s7_77_*.sql` | las dos migraciones, ya aplicadas |
| `docs/OWNER_S7_76_APPLY.md` · `docs/OWNER_S7_77_APPLY.md` | evidencia de los dos rollouts |
| `docs/rollbacks/s7_76_rollback.sql` · `s7_77_rollback.sql` | **NO EJECUTAR**; ignorados por `.gitignore`, requieren `git add -f` |

**La siguiente instrucción del owner decidirá qué hacer con ese frontend:**
validación visual, commit, PR, o ajustes previos. **Nada se commitea, se mergea
ni se despliega sin esa instrucción.**

### Deuda registrada en el camino

- **`CRM-SEARCH-TRGM`** — `pg_trgm` no está instalada, así que los dos índices
  trigram del buscador no se crearon. No bloqueante al volumen actual; instalar
  una extensión es decisión del owner y va por migración propia.
- **`ADMIN-DOCTOR-EXPORT`** — aplicar el mismo patrón seguro de exportación a la
  tabla de médicos.
- **F1 · ventana B→C del seed** — el email `.invalid` es defensa **parcial**;
  la alternativa de raíz vive en el frente del seed, no acá.

### Estado esperado del árbol

Es **esperado y deliberado** que el working tree esté *dirty*: la
implementación local de P0 permanece **sin commitear**. Solo se commiteó
documentación.

---

## Salvaguardas permanentes del proyecto

- **No aplicar SQL, migrar, desplegar, tocar configuración ni producción sin
  autorización explícita** del owner, paso por paso. **El owner aplica el SQL**
  en el SQL Editor de Supabase; el dev corre los `check`/`smoke`.
- **`auth.users`: JAMÁS por SQL.** Siempre Admin API.
- **`service_role` / secret key requieren autorización explícita, incluso
  read-only.**
- **No tocar** Test Phones, Twilio, Turnstile ni `hook_before_user_created`.
- **No reactivar las legacy API keys** (el JWT `service_role` legacy estuvo en
  el historial público del repositorio).
- **No modificar identidades protegidas**: el médico demo Camilo, LucyAdmin y
  `operations_admin`. **Jamás Katherine.** Los teléfonos concretos están en
  `CLAUDE.md`; no se repiten acá para no propagarlos.
- **No usar datos reales de pacientes para QA**, ni en read-only.
- **Copy en tuteo, nunca voseo.** Español, sin anglicismos.
- **Un solo frente funcional a la vez.**
- **No inventar QA ni resultados.** No afirmar que una prueba corrió si solo se
  leyó el código.
- **Validar el instrumento, no solo el fix:** correr la misma medición contra el
  código anterior (A/B). Un test que solo pasa "después" no prueba nada.

---

## Documentación relacionada

| Documento | Rol |
|---|---|
| `CLAUDE.md` | Guía rápida. Si contradice a `docs/`, mandan los `docs/` |
| **Este handoff** | **Fuente canónica del estado**, con el frente abierto |
| **`docs/ANALISIS_PATIENT_CRM.md`** | **Análisis completo de `PATIENT-CRM-P0`**: diagnóstico, D1–D5, arquitectura, UX, P1–P5 y backlog por bloques |
| `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-22_ADMIN_DOCTOR_SEED_P0.md` | **Histórico.** Frente anterior, cerrado |
| `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-20.md` | **Histórico.** Mejor descripción del **estado general del producto**: piloto = GO, Auth, Booking, Twilio, Legal, identidades, SEO |
| `docs/HISTORIAL_FRENTES.md` | Detalle por PR de los frentes cerrados |
| `docs/rollbacks/s7_76_rollback.sql` · `s7_77_rollback.sql` | **NO EJECUTAR** |
