# ANÁLISIS — `PATIENT-CRM-P0`

> 🔍 **Diagnóstico + BLOQUE 1 implementado LOCALMENTE.** Ningún SQL ejecutado,
> ninguna migración aplicada, sin deploy, sin `service_role` de escritura, sin
> cambios en Supabase/Auth/Edge/Vercel y sin tocar `database.types.ts`.
>
> Rama: `claude/patient-crm-p0`, desde `main` en
> `b9edf91d135c74404711c2b8f9bffebdc0ad497e`.
>
> **Este documento no contiene PII de pacientes reales**: todas las cifras son
> agregados, y las consultas de diagnóstico se hicieron sobre identificadores y
> fechas, nunca sobre nombres, teléfonos ni correos.

---

## ⚠️ Naturaleza de los datos actuales — leer antes que cualquier cifra

> **Todos los pacientes y fichas que hoy existen en producción son datos de
> prueba/QA. No representan pacientes reales ni métricas comerciales de
> LucyCare.**

En consecuencia:

- **No son una base de clientes** y no deben leerse como tal.
- **Ninguna decisión comercial se deriva de sus porcentajes.** Cuando este
  documento dice «el 71 % de las fichas no tiene identidad global», describe
  la **forma del dato de QA**, no una realidad de negocio.
- Su único uso legítimo acá es **validar estructura, cardinalidades y QA**: qué
  JOINs existen, qué índices faltan, qué consultas son caras.
- **El diseño se orienta al comportamiento esperado cuando ingresen pacientes
  reales**, no a optimizar para estos 31 registros.

Esto **no modifica D1–D5** ni la arquitectura aprobada: la brecha entre
identidad global y ficha local es **estructural**, existe en el modelo y
seguirá existiendo con pacientes reales — los walk-ins son un flujo legítimo
del producto, no un artefacto de las pruebas.

---

## Decisiones D1–D5 — aprobadas y vinculantes

**D1 · Entidad CRM.** Opción **B**: la identidad global `profiles` es el
paciente del CRM; los `patients` vinculados son fichas/relaciones locales; los
`patients.profile_id IS NULL` van aparte como **«Pendientes de identificar»**.
**Los dos conteos NO se suman** bajo «Pacientes totales».

**D2 · Estados derivados.** Ninguno se persiste. Prioridad de la etiqueta
principal: `bloqueado > en_seguimiento > recurrente > nuevo > activo >
inactivo`. Umbrales: **Nuevo** ≤ 30 días y no recurrente · **Recurrente** ≥ **2**
citas `atendida` · **Activo** cita futura o actividad ≤ 90 días · **Inactivo**
sin cita futura y última actividad > 180 días · **En seguimiento** con follow-up
abierto.

**D3 · Persistencia.** Solo metadata que no exista como fuente de verdad. El
bloqueo lleva **trazabilidad completa**: estado, motivo, actor y fecha, tanto al
bloquear como al **levantar**. Tags, follow-ups y notas se persisten. Sin
duplicar PII.

**D4 · Notas.** Exclusivas de LucyAdmin, **no visibles para el médico**, sin
reutilizar campos clínicos. **La exclusión de columnas clínicas vive en el
backend**, no en la UI.

**D5 · Walk-ins.** Sección propia, read/operación, reutilizando las
herramientas de linking y deduplicación existentes. Sin crear usuarios de Auth,
sin campañas, sin SMS/WhatsApp/correo. No son pacientes comerciales hasta
quedar vinculados.

**Timeline.** `audit_log` **no** se usa como event store general. Las fuentes
de verdad son `profiles`, `patients`, `appointments` y los follow-ups;
`audit_log` complementa eventos administrativos concretos por **allowlist
estricta**, y **nunca** se devuelven `old_data`/`new_data` en bruto al
navegador.

---

## 1. Estado actual de `/admin/pacientes`

### El hallazgo que cambia el encuadre del frente

> ### Hoy `/admin/pacientes` **NO es una lista de pacientes.** Es una consola de deduplicación.

Su título literal es **«Pacientes — Fusión de fichas»** y renderiza exactamente
cuatro secciones: **grupos candidatos** a fusión · **historial de fusiones** ·
**vínculos rechazados** · y los modales de preflight/merge/unmerge.

Medido sobre el código: **6** llamadas a servicios de merge/rechazos y
**0** llamadas a cualquier listado de pacientes. No existe buscador, ni
paginación, ni filtros, ni ficha de paciente, ni una sola métrica.

**Consecuencia:** el CRM no es una evolución de esta pantalla, es una
**pantalla nueva junto a ella**. Lo que ya existe hay que **conservarlo intacto**
—es funcionalidad delicada, con RPCs de preflight, confirmación reforzada por
frase tecleada y reversa formal— y colgarlo de una pestaña.

### Inventario

| Pieza | Ruta | Estado |
|---|---|---|
| Página | `src/pages/admin/AdminPacientesPage.tsx` (52 KB, ~1150 líneas) | consola de fusión |
| Servicio de merge | `src/services/patientMerge.service.ts` | **conservar** |
| Servicio de pacientes | `src/services/patients.service.ts` | del **panel médico**, clinic-scoped |
| Ruta | `src/router/config.tsx` → `pacientes` | dentro de `RequireOwnerAdmin` |
| Guard | `src/router/RequireOwnerAdmin.tsx` | la autoridad real es server-side |

**RPCs que ya existen y hay que respetar:** `admin_list_patient_merge_candidates`
· `admin_merge_patients_preflight` · `admin_merge_patients` ·
`admin_unmerge_patients_preflight` · `admin_unmerge_patients` ·
`admin_list_patient_link_rejections` · `admin_resolve_link_rejection` ·
`find_patient_match_candidates`. Tabla `patient_merge_log`.

⚠️ **`getPatientsList` NO sirve para el CRM.** Es del panel médico: filtra por
`clinic_id` y trae `appointments(start_time)` **embebido y sin límite**, o sea
todas las citas de cada paciente. Reutilizarlo sería importar el antipatrón que
el frente quiere evitar.

⚠️ **No existe ninguna RPC de listado administrativo de pacientes.** Hay que
crearla.

---

## 2. Mapa real de datos y relaciones

### Cadena de identidad

```
auth.users ──1:1── profiles ──1:N── patients ──1:N── appointments
   (Auth)      (identidad      (ficha por       (actividad)
                 global)         clínica)
                                    │
                              clinic_id → clinics ──N:1── doctors
```

`profiles.id` **es** `auth.users.id` (FK con `ON DELETE CASCADE`).
`patients.profile_id` es **nullable**: ahí vive la diferencia entre un paciente
global y una ficha suelta.

### Columnas relevantes

- **`profiles` (15)** — identidad global: `full_name`, `phone`, `email`,
  `document_type/number`, `date_of_birth`, `gender`, `department_id`,
  `municipality_id`, `role`, `is_active`, `created_at`.
- **`patients` (24)** — ficha por clínica. Duplica los datos de contacto y suma
  **campos clínicos**: `blood_type`, `allergies`, `notes`, contacto de
  emergencia. Trae también `link_confirmed_at`, `merged_into_patient_id`,
  `merged_at`.
- **`appointments` (21)** — `patient_id`, `doctor_id`, `clinic_id`,
  `start_time`, `status_id`, `source`, y campos clínicos/comerciales
  (`internal_notes`, `price`, `payment_status`).

### Cardinalidades medidas (2026-08-24)

| Métrica | Valor |
|---|---|
| `profiles` totales | **140** · con `role='patient'`: **25** |
| `profiles` con teléfono / correo / documento | 135 / 113 / **2** |
| **`patients` (fichas)** | **31**, todas activas |
| **fichas con `profile_id`** | **9** |
| **fichas SIN vincular (walk-in)** | **22** |
| `link_confirmed_at` | 4 |
| fichas fusionadas | 0 |
| **perfiles distintos con ≥1 ficha** | **4** |
| distribución fichas por perfil | `{1:2, 2:1, 5:1}` |
| clínicas distintas con fichas | 7 |
| `appointments` | **92** · futuras: **4** |
| citas de fichas **vinculadas** | **29** |
| citas de fichas **sin vincular** | **63** |
| citas por origen | `manual`: 64 · `lucy_directorio`: 28 |
| `patient_link_rejections` | 1 |

### 🔴 La brecha estructural que define el frente

> **Solo 9 de 31 fichas (29 %) tienen identidad global, y esas 9 pertenecen a
> apenas 4 perfiles.** El 71 % restante son walk-ins sin `profile_id`.
> **El 68 % de las citas (63 de 92) pertenecen a fichas sin identidad global.**

El principio 1 dice que la unidad del CRM es la identidad global. Aplicado
literalmente **hoy, el CRM mostraría 4 pacientes y perdería de vista el 71 % de
las fichas y el 68 % de la actividad**. Es la decisión de producto más
importante del frente, y está en la §11.

### Estados de cita disponibles

`programada`(1) · `confirmada`(2) · `en_sala`(3) · **`atendida`(4, final)** ·
`cancelada`(5, final) · `no_asistio`(6, final).

**`atendida` es la señal confiable de atención completada** que el frente pedía
no inventar: existe, es final y tiene `funnel_order`.

### Índices y RLS

- **Índices sobre `patients`:** solo **uno**, funcional:
  `idx_patients_auth_phone ON patients(auth_phone_e164(phone))` (`s7_65`). **No
  hay índice sobre `profile_id`, `clinic_id` ni `full_name`.**
- **RLS medida con `anon`:** `patients`, `appointments` y `patient_merge_log`
  devuelven **0 filas**; `profiles` devuelve 1 fila con las columnas públicas
  (hardening column-level de `s7_16`). La RLS está activa y es correcta.
- **`audit_log`:** 14 051 filas · **556 sobre `patients`** · **68 sobre
  `appointments`**. Es inmutable desde `s7_71b` y **ya cubre lo necesario para
  una timeline administrativa**, sin crear tablas de eventos.

---

## 3. Brechas contra el CRM propuesto

| Necesidad P0 | Hoy | Brecha |
|---|---|---|
| Lista de pacientes | **no existe** | crear pantalla + RPC |
| Buscador nombre/teléfono/correo/ID | no existe | RPC con `ILIKE` + índices |
| Paginación / filtros server-side | no existe | RPC con `limit/offset` y conteo |
| Estado CRM | no existe | **derivable** (§4) |
| Origen | **parcial**: `appointments.source` | derivable de la primera cita |
| Fecha de registro | `profiles.created_at` / `patients.created_at` | directo |
| Última actividad | derivable de `appointments` | agregado |
| Próxima cita | derivable | agregado con filtro de fecha |
| Total de citas | derivable | agregado |
| Médicos/clínicas relacionadas | derivable | agregado con `DISTINCT` |
| Etiquetas | **no existe** | tabla nueva |
| Notas administrativas | **no existe** | tabla nueva |
| Seguimientos | **no existe** | tabla nueva |
| Timeline | **`audit_log` ya sirve** | RPC de lectura |
| Comunicaciones | no existe | fuera de P0 |

---

## 4. Arquitectura P0 recomendada

### Principio rector: **derivar todo lo derivable**

De los seis estados propuestos, **cinco son derivables** de datos que ya existen
y **solo uno necesita persistencia**:

| Estado | Derivación | ¿Persistir? |
|---|---|---|
| **Nuevo** | registrado hace < 30 días y 0 citas atendidas | ❌ derivado |
| **Activo** | ≥1 cita en los últimos 90 días | ❌ derivado |
| **Recurrente** | ≥3 citas `atendida` | ❌ derivado |
| **Inactivo** | sin citas en > 180 días | ❌ derivado |
| **En seguimiento** | tiene un seguimiento CRM abierto | ❌ derivado de la tabla de seguimientos |
| **Bloqueado/restringido** | decisión humana | ✅ **persistir** |

**Persistir estados derivables sería un error caro**: exigiría recalcularlos con
un job o triggers sobre `appointments`, y quedarían desincronizados en cuanto
alguien cancele una cita. Solo `bloqueado` es una decisión que el sistema no
puede inferir.

**Lo mismo con `origen`:** se deriva de la primera cita
(`lucy_directorio` → LucyCare · `manual` → carga del médico). No hace falta
columna hasta que existan más canales.

### Tablas nuevas mínimas — **tres**, todas colgadas de la identidad global

```
patient_crm            (1:1 con profiles)   -- solo lo NO derivable
patient_crm_tags       (N:M)                -- etiquetas
patient_crm_followups  (1:N)                -- seguimientos y notas
```

`patient_crm.profile_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE`
— **PK = FK**, así que no puede haber dos filas CRM para el mismo paciente, y
un merge de identidades no crea duplicados. **Fila creada bajo demanda**: no se
pre-puebla, la mayoría de pacientes nunca necesitará una.

Contenido: `crm_status_override` (solo `bloqueado`), `blocked_reason`,
`blocked_at`, `blocked_by`, `created_at`, `updated_at`. **Nada más.**

> ⚠️ **Colgar de `profiles`, no de `patients`** es lo que exige el principio 1 —
> pero tiene la consecuencia de la §2: hoy solo alcanzaría a 4 pacientes. Ver §11.

### Consultas: **una RPC agregada, cero N+1**

Una sola RPC `admin_list_patients_crm(p_search, p_status, p_limit, p_offset)`
que devuelve la página **ya agregada**, con los conteos calculados en un
`LATERAL` por fila de la página —25-50 filas—, nunca sobre toda la tabla.

Las métricas superiores van en **una RPC aparte** (`admin_patients_crm_stats`),
cacheada en el cliente con `staleTime` alto: son 6 conteos que no cambian por
segundo.

### Índices propuestos

| Índice | Para |
|---|---|
| `patients(profile_id)` | el JOIN identidad ↔ fichas. **Hoy no existe** |
| `appointments(patient_id, start_time DESC)` | última actividad y próxima cita |
| `appointments(patient_id, status_id)` | conteo de atendidas |
| `profiles` trigram sobre `full_name` | buscador por nombre |
| `patient_crm_followups(profile_id, status)` | estado "en seguimiento" |

### Seguridad

- RLS en las tres tablas nuevas, `USING (is_admin())`, **con cláusula `TO
  authenticated`** — la lección de `s7_74`.
- Sin DML de cliente: todo por RPC `SECURITY DEFINER` con `is_admin()` como
  primera instrucción y `SET search_path` explícito.
- `REVOKE` de `PUBLIC`/`anon`; `GRANT EXECUTE` solo a `authenticated`.
- Auditoría: triggers sobre las tres tablas hacia `audit_log`, con
  `edited_via: 'crm'`.

---

## 5. Propuesta UX

### `/admin/pacientes` con dos pestañas

**Pestaña «Base de pacientes»** (nueva) y **«Fusión de fichas»** (lo actual,
intacto).

**Lista:** 6 indicadores arriba · buscador único · filtros de estado, origen y
período · tabla de 25 con paginación server-side.

Columnas: Paciente · Contacto · Estado CRM (derivado) · Origen · Registro ·
Última actividad · Próxima cita · Citas · Relaciones · Etiquetas.

### Ficha 360 — seis secciones

**Resumen** · **Actividad** (desde `audit_log` + `appointments`) · **Citas** ·
**Relaciones** (médicos y clínicas, y las **fichas locales** de esa identidad,
que es el puente con la consola de fusión) · **Comunicaciones** (marcador vacío,
sin mensajería) · **Administración** (etiquetas, notas, seguimientos, bloqueo).

### 🔴 Deliberadamente FUERA — la frontera clínica

**Nunca** en el CRM: diagnósticos · medicamentos · recetas · antecedentes ·
resultados · notas clínicas · `patients.allergies` · `patients.blood_type` ·
`patients.notes` · `appointments.internal_notes` · `appointments.reason_id` ·
consultas firmadas.

**Regla operativa:** la RPC del CRM **no debe seleccionar esas columnas**. Que no
se muestren en la UI no basta — no deben viajar. Un check estático puede
verificarlo sobre el texto de la migración, igual que se hizo en `s7_73`.

Copy en **tuteo**, sin anglicismos: «Sin actividad reciente», no «inactive».

---

## 6. Impacto en Supabase y performance

**Escrituras:** solo cuando un admin etiqueta, anota o bloquea. Volumen
despreciable.

**Lecturas:** 2 RPCs por carga de lista. Con `LATERAL` sobre 25 filas y los
índices propuestos, cada página toca decenas de filas, no miles.

**Antipatrones evitados:** nada de traer las 31 fichas y agregar en el
navegador · nada de `appointments(...)` embebido sin límite —el error de
`getPatientsList`— · nada de recalcular el histórico en cada render · nada de
materializar estados derivables.

**Escala:** con 31 fichas y 92 citas el costo hoy es trivial. El diseño está
pensado para que siga siéndolo con dos órdenes de magnitud más.

---

## 7. Riesgos de seguridad y privacidad

| Riesgo | Mitigación |
|---|---|
| **Fuga de datos clínicos** al CRM | la RPC no selecciona columnas clínicas; check estático que lo verifique |
| Policy sin `TO` | `TO authenticated` explícito — lección de `s7_74` |
| PII en logs o reportes | prohibido imprimir nombres/teléfonos/correos; las verificaciones usan `IS NOT NULL` |
| Ampliación de rol | P0 se queda en `RequireOwnerAdmin`; **no ampliar sin autorización** |
| Notas administrativas con contenido clínico | advertencia en la UI; es un control de proceso, no técnico |
| Exportación masiva | **fuera de P0** |

---

## 8. Archivos que habría que tocar

**Nuevos:** `src/pages/admin/patients/PatientsCrmTab.tsx` ·
`PatientDetail360.tsx` · componentes de sección ·
`src/services/patientCrm.service.ts` · `migrations/s7_76_*.sql` ·
`scripts/check-s7_76.mjs` · `docs/rollbacks/s7_76_rollback.sql` (con `git add -f`).

**Modificados:** `AdminPacientesPage.tsx` — **solo** para envolver lo actual en
una pestaña. La lógica de fusión no se toca.

**Intocables:** `patientMerge.service.ts` · `patients.service.ts` ·
`database.types.ts` (frente `TYPES-RECONCILIATION-P0`) · todo lo clínico.

---

## 9. Migraciones, tablas y RPCs que propondría

**`s7_76`** — 3 tablas + RLS + grants + 5 índices + auditoría.
**`s7_77`** — RPCs de lectura: `admin_list_patients_crm`,
`admin_patients_crm_stats`, `admin_get_patient_crm_360`,
`admin_get_patient_crm_timeline`.
**Migración futura (TBD)** — RPCs de escritura: etiquetas, notas, seguimientos,
bloqueo.

> ⚠️ **El número NO está reservado.** Este documento decía `s7_78`, pero ese
> identificador lo tomó **`ADMIN-DOCTOR-EXPORT`** el 2026-08-26, que llegó
> primero. No se reservan números para frentes no iniciados: se asigna el
> siguiente libre en el momento de escribir el archivo.

Separadas a propósito: `s7_76` es inerte sin las RPCs, y las de lectura no
pueden romper nada.

---

## 10. Backlog en bloques pequeños

| # | Bloque | Depende de |
|---|---|---|
| **B0** | **Decisión de producto de la §11** | — |
| B1 | `s7_76`: tablas, RLS, índices, auditoría | B0 |
| B2 | `s7_77`: RPCs de lectura | B1 |
| B3 | UI lista + pestañas (sin escritura) | B2 |
| B4 | Ficha 360 read-only | B2 |
| B5 | migración futura (TBD): RPCs de escritura | B1 |
| B6 | UI de administración (etiquetas, notas, seguimientos) | B5 |
| B7 | Timeline desde `audit_log` | B2 |
| B8 | Métricas superiores | B2 |
| B9 | Bloqueo/restricción | B5 |

Cada bloque: PR propio, con `check-*` y preview visual antes de mergear.

---

## 11. 🔴 Decisiones que requieren al owner

### D1 — La más importante: ¿qué es un «paciente» en el CRM?

Los principios dicen «identidad global». Los datos dicen que eso hoy son **4
pacientes**, y deja fuera **22 fichas** y **63 citas**.

| Opción | Cobertura hoy | Costo |
|---|---|---|
| **A. Solo identidad global** | 4 pacientes | fiel al principio, CRM casi vacío |
| **B. Identidad global + fichas sin vincular como «pendientes de identificar»** | 4 + 22 | el CRM sirve desde el día uno y **empuja a vincular**, que es el objetivo de negocio |
| **C. Ficha local como unidad** | 31 | contradice el principio 1 y reintroduce duplicados |

**Recomiendo B.** Mantiene la identidad global como unidad —las fichas sin
vincular se muestran como un grupo aparte, no mezcladas— y convierte la brecha
en una **acción comercial**: «22 fichas sin identidad, vinculalas». Con A, el
CRM nace sin utilidad; con C, se rompe el modelo que costó cinco frentes
construir.

### D2 — ¿Umbrales de los estados derivados?

Propongo: **Nuevo** < 30 días · **Activo** ≤ 90 días · **Inactivo** > 180 días ·
**Recurrente** ≥ 3 atendidas. Son parámetros de negocio, no técnicos.

### D3 — ¿`bloqueado` es la única persistencia de estado?
Es mi recomendación. Cualquier otro estado persistido exigiría un job de
recálculo.

### D4 — ¿Las notas administrativas son visibles para el médico?
Recomiendo **no** en P0: son internas de LucyCare y mezclarlas con el panel
médico abre una discusión de ownership que el frente no necesita.

### D5 — ¿Qué se hace con los 22 walk-ins sin identidad?
¿Se muestran, se ocultan, o se convierten en una bandeja de trabajo? Depende
de D1.

---

## Compatibilidad — verificada

| Sistema | Impacto |
|---|---|
| Duplicados / merge / unmerge | **ninguno** — tablas nuevas, ni una columna tocada |
| Linking de pacientes | **ninguno** — `patient_crm` cuelga de `profiles`, y el `ON DELETE CASCADE` lo mantiene coherente tras un merge |
| Booking | **ninguno** |
| Auth | **ninguno** |
| Panel del médico | **ninguno** — el CRM es admin-only |
| RLS existente | **ninguno** — solo se agregan policies nuevas |
| `database.types.ts` | requerirá regenerarse tras `s7_76`; **coordinar con `TYPES-RECONCILIATION-P0`** |

---

# BLOQUE 1 — DATA FOUNDATION + LISTA · implementado localmente

> **NO aplicado a producción.** Migraciones escritas y verificadas de forma
> estática; ningún SQL ejecutado, ningún deploy, sin `service_role` de
> escritura, sin tocar Auth ni `database.types.ts`.

## Entregable 1-3 · Schema, RLS/GRANT e índices

`migrations/s7_76_patient_crm_foundation.sql` — **cuatro tablas**, todas con
`profile_id` hacia **`profiles`**, nunca hacia `patients`:

| Tabla | Rol | Clave |
|---|---|---|
| `patient_crm` | solo lo NO derivable: el bloqueo | **PK = FK** a `profiles(id)` |
| `patient_crm_tags` | etiquetas comerciales | único por `(profile_id, lower(tag))` |
| `patient_crm_followups` | seguimientos; uno abierto deriva `en_seguimiento` | `status ∈ {abierto, cerrado}` |
| `patient_crm_notes` | notas administrativas, solo LucyAdmin | — |

`patient_crm` tiene **PK = FK**: es imposible tener dos filas CRM del mismo
paciente, y una fusión de fichas no puede duplicarlas porque no toca
`profiles`. La fila se crea **bajo demanda**, no se pre-puebla.

Dos `CHECK` hacen cumplir D3 a nivel de esquema: un bloqueo **sin motivo o sin
actor es imposible**, y **no se puede levantar un bloqueo que nunca existió**
(`unblocked_at >= blocked_at`).

**RLS/GRANT** en las cuatro: RLS activa · `REVOKE ALL` de `PUBLIC` y `anon` ·
**una** policy `FOR SELECT **TO authenticated** USING (is_admin())` — la
cláusula `TO` explícita es la lección de `s7_74` · `GRANT SELECT` a
`authenticated`, **sin DML de cliente**. Auditoría por trigger en las cuatro,
marcada `edited_via: 'crm'`.

**Índices** (§Performance del owner):

| Índice | Por qué |
|---|---|
| **`patients(profile_id)`** parcial | el JOIN central del CRM. **Hoy no existe**: el único índice de `patients` es funcional sobre el teléfono (`s7_65`) |
| `patients(created_at DESC) WHERE profile_id IS NULL` | la bandeja de pendientes |
| `appointments(patient_id, start_time DESC)` | última actividad y próxima cita |
| `appointments(patient_id, status_id)` | recurrencia sin escanear todas las citas |
| trigram sobre `full_name` | el buscador — **condicional**: si `pg_trgm` no está instalada se omite con `NOTICE` en vez de fallar la migración |

## Entregable 4-6 · RPCs y métricas

`migrations/s7_77_patient_crm_read_rpcs.sql` — tres RPCs **`STABLE`** (solo
lectura; la guarda POST lo verifica: si alguna quedara `VOLATILE`, alguien le
agregó escritura):

- **`admin_list_patients_crm(search, status, limit, offset)`** — listado global
  paginado. Filtra `profiles.role='patient'`. Buscador por **nombre, teléfono,
  correo e ID**. Agregados con `LEFT JOIN LATERAL` **sobre la página**, nunca
  sobre la tabla.
- **`admin_list_unlinked_patients(search, limit, offset)`** — pendientes de
  identificar. Excluye inactivas y fusionadas.
- **`admin_patients_crm_stats()`** — los seis indicadores + `pendientes_identificar`
  **reportado aparte**.

**Umbrales en un solo lugar:** `_crm_estado(...)`, función privada e
`IMMUTABLE`. Cambiar un umbral no exige tocar tres consultas.

**Métricas, definición exacta:** `pacientes_totales` = perfiles `role='patient'`
· `nuevos_30d` = creados ≤ 30 días · `activos` = con cita futura **o** actividad
≤ 90 días · `con_proxima_cita` = con cita futura no final · `sin_actividad_180d`
= sin cita futura y última > 180 días o nula · `bloqueados` · y
**`pendientes_identificar`**, que **no se suma** a los totales (D1).

## Entregable 7 · Allowlist de columnas

Las RPCs **enumeran a mano cada clave** con `jsonb_build_object`. No hay
`SELECT *`, ni `to_jsonb(fila)`, ni `row_to_json`.

**Sale al frontend:** `profile_id` · `full_name` · `phone` · `email` ·
`created_at` · `crm_status` · `blocked` · `origen` · `fichas` · `clinicas` ·
`medicos` · `citas_total` · `atendidas` · `ultima_actividad` · `proxima_cita` ·
`followups_abiertos` · `tags`.

**NO sale, y el check lo verifica sobre el texto de la migración:** `allergies`
· `blood_type` · `patients.notes` · `internal_notes` · `reason_id` ·
`cancel_reason_id` · `price` · `payment_status` · `emergency_contact_*` ·
diagnósticos · recetas · consultas · medicación · antecedentes · signos vitales.

## Entregable 8-9 · Frontend

`/admin/pacientes` pasa a **tres pestañas**: **Base de pacientes** ·
**Pendientes de identificar** · **Fusión de fichas**.

La consola de fusión **no cambió de lógica**: su componente se renombró a
`MergeFichasTab` y su `<h1>` bajó a párrafo. Nada de su preflight, sus
confirmaciones por frase tecleada ni su reversa se tocó.

`src/services/patientCrm.service.ts` habla **solo con las RPCs**: no consulta
`patients` ni `appointments`, para no saltarse la frontera clínica ni
reintroducir el N+1.

**Tabla principal:** Paciente (con etiquetas) · Contacto · Estado · Origen ·
Registro · Última actividad · Próxima cita · Citas (y atendidas) · Relaciones
(médicos · clínicas). Paginación server-side de **25**, tope **50**.

## Entregable 10 · Checks y plan de QA

**`scripts/check-s7_76.mjs`: 90/90 PASS.** Diez bloques: D1 (la unidad es la
identidad global) · **D4 (frontera clínica — la aserción central, 16 columnas
prohibidas verificadas una por una)** · D2 (estados derivados, umbrales,
prioridad) · D3 (trazabilidad del bloqueo) · seguridad · performance · alcance
aditivo · transacción y guardas · rollbacks · frontend.

`check-s7_73` **236/236**, `check-s7_74` **28/28**, `check-s7_75` **67/67** —
sin regresión. `tsc` **PASS**. `build` **PASS**.

**Plan de QA cuando se autorice aplicar:** aplicar `s7_76` → verificar catálogo
read-only (RLS, policies `TO authenticated`, grants, índices) → aplicar `s7_77`
→ probar las tres RPCs con sesión de admin → verificar en el Preview que la
lista pagina, busca y filtra server-side → **verificar en la pestaña Network
que ninguna respuesta contiene columnas clínicas** → confirmar que la consola
de fusión sigue operando igual.

## Rollbacks

Ambos **autosuficientes** y marcados **NO EJECUTAR**.
`s7_76_rollback.sql` está marcado **DESTRUCTIVO**: elimina las cuatro tablas y
toda la metadata CRM, que **no tiene otra fuente de verdad**. Exige revertir
`s7_77` primero. `s7_77_rollback.sql` es no destructivo para los datos.
`audit_log` se conserva en ambos.

---

# PRE-APPLY REVIEW — P1 a P4 cerrados

## P1 · El universo real de «Pacientes LucyCare»

### El diagnóstico

Medido read-only sobre el esquema, sin PII:

| Verificación | Resultado |
|---|---|
| `profiles` por rol | `doctor` 114 · `patient` 25 · `admin` 1 |
| **`role='patient'` que TIENEN fila en `doctors`** | **1** ← es un médico |
| `role='patient'` que son `clinic_members` | **1** ← staff |
| `role='patient'` con email técnico `.invalid` | 0 hoy, pero **posible por construcción** |
| `role='patient'` desactivados | 0 |
| **pacientes con 0 fichas** | **22 de 25** |

**Dos conclusiones que cambian la RPC:**

**`role='patient'` NO es predicado suficiente.** El approve con `reuse_patient`
(`s7_42`) crea el médico sobre el profile del paciente y **no toca `role`**, así
que hay médicos con `role='patient'`. Y las identidades técnicas del seed
(`s7_73`) nacen con `role='patient'`, porque así las crea `handle_new_user`.

**La raíz no puede ser `patients`.** 22 de 25 identidades tienen cero fichas: con
`patients` como raíz, una cuenta LucyCare que aún no agendó sería **invisible**.

### 1 · El `FROM` raíz

```sql
FROM public.crm_patient_identity
```

Una **vista** que encapsula el predicado. Las tres RPCs la consumen, así que
lista y métricas **no pueden discrepar**; sin ella, el predicado se duplicaría
en tres consultas y divergiría al primer cambio. **Sin grants**: solo la leen
las RPCs `SECURITY DEFINER`, que corren como owner.

### 2 · Predicado exacto

```sql
p.role = 'patient'
AND p.is_active = true
AND NOT EXISTS (SELECT 1 FROM doctors d         WHERE d.profile_id = p.id)
AND NOT EXISTS (SELECT 1 FROM clinic_members cm WHERE cm.profile_id = p.id)
AND NOT EXISTS (SELECT 1 FROM clinics c         WHERE c.owner_id  = p.id)
AND coalesce(p.email, '') NOT LIKE '%@doctor-seed.invalid'
```

### 3 · Paciente con 0 fichas y 0 citas

**Aparece**, y es lo correcto: es una cuenta LucyCare real que todavía no
agendó — precisamente el caso comercial que un CRM debe ver. La arquitectura es
`identidad elegible → LEFT JOIN fichas → LEFT JOIN agregados`, así que sale con
`fichas=0`, `citas_total=0` y estado derivado `nuevo` o `inactivo` según su
antigüedad. Un `INNER JOIN` lo habría ocultado; el check verifica que no lo haya.

### 4 · Un `patient` que adquiere otro rol

`profiles.role` es una sola columna y **no siempre se actualiza**. Por eso el
predicado no confía en él: usa la **evidencia estructural** —tener fila en
`doctors`, ser `clinic_members` o dueño de clínica—. Cuando un paciente se
convierte en médico, deja de aparecer en el CRM **el mismo instante** en que
existe su fila en `doctors`, sin depender de que alguien recuerde cambiar
`role`.

### 5 · Identidades técnicas

Tres exclusiones **redundantes a propósito**: sin fila en `doctors`, sin ser
dueño de clínica, y sin email `@doctor-seed.invalid`. Un seed completo cae por
las tres; un seed que fallara a mitad de camino y dejara un profile huérfano cae
igual por la del email, que es determinístico (RFC 2606).

---

## P2 · `_crm_estado` — era un defecto real

**Firma anterior (incorrecta):**

```sql
_crm_estado(boolean, int, int, timestamptz, timestamptz, timestamptz)
  LANGUAGE sql IMMUTABLE
  ... WHEN p_creado >= now() - interval '30 days' ...
```

Declarada `IMMUTABLE` **y leyendo el reloj**. Es una mentira al planificador:
PostgreSQL puede cachear el resultado, plegar la función en tiempo de
planificación o usarla en un índice, y devolver **estados congelados**. Lo
introduje yo, y el owner lo detectó.

**Firma corregida:**

```sql
_crm_estado(boolean, int, int, timestamptz, timestamptz, timestamptz, p_ahora timestamptz)
  LANGUAGE sql IMMUTABLE
  ... WHEN p_creado >= p_ahora - interval '30 days' ...
```

La fecha de referencia entra como **argumento**; quien llama pasa `now()`. Ahora
la función es genuinamente inmutable —misma entrada, misma salida— y además
comprobable.

**Verificado en dos capas:** el check estático prueba que el cuerpo no contiene
`now()`, `current_date`, `current_timestamp`, `clock_timestamp`,
`localtimestamp`, `transaction_timestamp` ni `statement_timestamp`; y la guarda
POST de la migración lo comprueba **sobre `prosrc` en la base**, además de exigir
`provolatile = 'i'`.

---

## P3 · Canal ≠ adquisición

`appointments.source` solo dice **por dónde entró una reserva**:
`lucy_directorio` (el paciente reservó desde el directorio) o `manual` (el
médico la cargó). **No dice cómo la persona conoció LucyCare.**

Renombrado en las cuatro capas: SQL (`canal_primera_cita`), RPC, tipo del
servicio y encabezado de la tabla («Canal 1.ª cita»), más una nota al pie en la
propia pantalla. Etiquetas: «Directorio LucyCare» y «Alta del médico» — **no**
«Google», «referido» ni «campaña», que serían datos inventados.

**`acquisition_source` queda RESERVADO** para cuando exista evidencia real —UTM,
referral, campaña o captura administrativa— y se agregará como columna propia,
no reinterpretando este campo. El check prueba que el nombre `origen` ya no
existe y que no aparecen canales comerciales inventados.

---

## P4 · Rollback fail-closed

`s7_76_rollback.sql` **cuenta las filas de las cuatro tablas antes de tocar
nada** y **aborta** si hay una sola:

```
ABORTADO: el CRM tiene datos y este rollback NO los destruye.
patient_crm=%, tags=%, followups=%, notas=%.
```

El motivo está escrito en la cabecera: esa metadata **no tiene otra fuente de
verdad** y no se puede reconstruir desde `profiles`, `patients` ni
`appointments`. Un `DROP` sobre tablas con contenido no es una reversión, es una
pérdida.

**Revertir tras uso real no es este archivo.** Exige una estrategia decidida por
el owner —respaldo verificado, migración de la metadata, o renombrar las tablas
a `_deprecated` dejándolas fuera de servicio sin destruirlas— y recién entonces
los `DROP`. Está documentado que **deliberadamente no se automatiza**: un
rollback que borra datos en silencio es peor que no tenerlo.

---

## Seguridad — informe completo

### Las cuatro tablas

| Aspecto | Valor |
|---|---|
| Owner | el de la migración (`postgres` en el SQL Editor), igual que el resto del esquema |
| RLS | **activa** en las cuatro |
| Policies | **exactamente una** por tabla: `<tabla>_select_admin`, `FOR SELECT`, **`TO authenticated`**, `USING (public.is_admin())`, sin `WITH CHECK` |
| GRANT | `SELECT` a `authenticated`. **Nada más** |
| REVOKE | `ALL` de `PUBLIC` y de `anon` |
| DML de cliente | **ninguno** — se muta solo por las RPCs de escritura, en una migración futura (TBD) |
| Auditoría | trigger `AFTER INSERT/UPDATE/DELETE` → `audit_log`, marcado `edited_via: 'crm'` |

La cláusula **`TO authenticated` es explícita**: omitirla equivale a `TO PUBLIC`,
que es exactamente el defecto que `s7_74` tuvo que corregir. La guarda POST lo
verifica tabla por tabla.

### La vista y el helper

`crm_patient_identity` y `_crm_estado(...)`: **`REVOKE ALL` de `PUBLIC`, `anon` y
`authenticated`**. Ningún cliente puede leerlas ni ejecutarlas; solo las alcanzan
las RPCs `SECURITY DEFINER`, que corren como owner. La guarda POST lo comprueba.

### Las tres RPCs

| Aspecto | Valor |
|---|---|
| Modo | **`SECURITY DEFINER`** |
| Volatilidad | **`STABLE`** — solo lectura, y la guarda POST lo exige |
| `search_path` | **`public, pg_catalog`** explícito en las tres |
| EXECUTE | **solo `authenticated`**; `REVOKE` de `PUBLIC` y `anon` |
| Gate | **`is_admin()` como primera instrucción**, error `P0140` |

### Qué limita el acceso al nivel administrativo autorizado

**`is_admin()`**, que es `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
AND role = 'admin')` — es decir, **Owner Admin**.

Es **exactamente** el mismo criterio que `RequireOwnerAdmin`, el guard que hoy
protege `/admin/pacientes`. **No se amplía nada**:

- **`operations_admin`** tiene `profiles.role='patient'` (así lo documenta el
  frente ADMIN-JUNIOR), así que `is_admin()` le devuelve `false`. **No entra.**
- **`directory_editor`** tampoco es `role='admin'`. **No entra.**
- El guard del frontend redirige a `/admin/medicos`, pero **el borde real es
  server-side**: aunque alguien llamara la RPC directamente, `is_admin()` la
  rechaza con `P0140`.

> ⚠️ **Punto a vigilar, no problema abierto.** Como `operations_admin` tiene
> `role='patient'`, **aparecería en la lista del CRM como si fuera un paciente**
> si nada más lo excluyera. Hoy queda fuera por evidencia estructural
> (`clinic_members`). Si en el futuro existiera un `operations_admin` sin
> ninguna de esas marcas, habría que excluirlo explícitamente en el predicado.

---

## Checks tras la revisión

`check-s7_76` pasa de **90** a **123**: se suman los bloques **P1** (universo
real, 11 aserciones), **P2** (immutabilidad, 12), **P3** (semántica, 5) y **P4**
(rollback fail-closed, 6).

`check-s7_73` **236/236** · `check-s7_74` **28/28** · `check-s7_75` **67/67** ·
`tsc` **PASS** · `build` **PASS** · `git diff --check` **PASS**.

---

# P1.1 — IDENTIDAD CANÓNICA FINAL

## El error que corrige

Mi predicado anterior excluía a cualquiera con fila en `doctors` o
`clinic_members`. **Eso era incorrecto**: una identidad puede ser más de una
cosa. Un médico puede ser paciente de otro médico; un asistente también. Tener
fila en `doctors` dice qué **además** es esa persona, no que deje de ser
paciente.

## Las exclusiones no son simétricas

**DURAS — siempre fuera, tengan ficha o no:**

1. cuenta desactivada;
2. acceso administrativo LucyAdmin vigente;
3. identidad técnica del seed.

**BLANDAS — fuera solo si NO hay relación real de paciente:**

4. ser médico · 5. ser staff de clínica · 6. ser dueño de clínica.

La **evidencia fuerte** de relación de paciente es `EXISTS patients WHERE
profile_id = p.id`.

## SQL exacto

```sql
CREATE OR REPLACE VIEW public.crm_patient_identity AS
SELECT p.id, p.full_name, p.phone, p.email, p.created_at
FROM public.profiles p
WHERE
  -- DURA 1 · cuentas desactivadas
  p.is_active = true

  -- DURA 2 · acceso administrativo, por su fuente autoritativa
  AND p.role <> 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM public.lucyadmin_access la
    WHERE la.profile_id = p.id AND la.is_active = true
  )

  -- DURA 3 · identidad técnica del seed
  AND NOT EXISTS (
    SELECT 1 FROM public.admin_seed_operations so WHERE so.seed_user_id = p.id
  )
  AND coalesce(p.email, '') NOT LIKE '%@doctor-seed.invalid'

  -- BLANDAS · solo excluyen sin relación de paciente
  AND (
    EXISTS (SELECT 1 FROM public.patients pa WHERE pa.profile_id = p.id)
    OR (
      p.role = 'patient'
      AND NOT EXISTS (SELECT 1 FROM public.doctors d         WHERE d.profile_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.clinic_members cm WHERE cm.profile_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.clinics c         WHERE c.owner_id  = p.id)
    )
  );
```

## Acceso administrativo — fuente autoritativa

Leído de `s7_57`, no inferido:

| Nivel | Dónde vive |
|---|---|
| **`owner_admin`** | **`profiles.role = 'admin'`** — *no* está en la tabla |
| `operations_admin` | `lucyadmin_access` con `is_active = true` |
| `directory_editor` | `lucyadmin_access` con `is_active = true` |

El comentario de la propia tabla lo dice: *«owner_admin NO vive aquí (=
profiles.role=admin). Solo directory_editor / operations_admin»*.

Por eso el predicado usa **las dos** condiciones. **Ya no depende de que un
`operations_admin` sea casualmente `clinic_member`**, que era la fragilidad que
yo mismo había señalado como «punto a vigilar» y que ahora queda cerrada.

## Seeds — qué cubre cada evidencia

| Momento | `admin_seed_operations` | Email `.invalid` |
|---|---|---|
| **Seed completado** | ✅ fila con `seed_user_id` | ✅ |
| **Seed fallido con compensación OK** | — el `auth.user` se borró y el profile cascadeó: no hay a quién excluir | — |
| **Seed fallido con `compensation_failed`** | ✅ fila `failed` con `seed_user_id` | ✅ |
| **Ventana de cleanup** | ❌ **la fila ya se borró** (el orden A→B→C borra `admin_seed_operations` primero) | ✅ **única defensa** |

Por eso **se conservan las dos**. La estructural es más robusta ante un cambio
de email; la del dominio `.invalid` cubre la ventana en que la operación ya no
existe pero el `auth.user` todavía sí.

## La vista

- **Única definición canónica**: la consumen el núcleo compartido —del que
  cuelgan listado y exportación— y las métricas. Una guarda POST verifica que
  ambos la usen: si alguno se la saltara, lista y totales podrían discrepar.
- **Sin acceso para `PUBLIC`, `anon` ni `authenticated`.**
- **`security_invoker = true`** aplicado **condicionalmente**: solo si
  `server_version_num >= 150000`. En PostgreSQL 14 la opción no existe y el
  `ALTER` abortaría la migración entera, así que se emite un `NOTICE` en su
  lugar. **No pude determinar la versión live** desde acá —PostgREST expone su
  propia versión, no la del motor—, así que la migración se adapta sola.
- **Interacción con las RPCs `SECURITY DEFINER`:** dentro de ellas el usuario
  actual **es** el owner, así que `security_invoker` no cambia el
  comportamiento. Lo que aporta es que la vista deja de ser un atajo de
  privilegios si alguien le concediera `SELECT` por error.

## Los once casos

Verificados simbólicamente en el check, sin PII:

| # | Caso | Resultado |
|---|---|---|
| 1 | patient, 0 fichas, sin roles | **IN** |
| 2 | patient + ficha | **IN** |
| 3 | doctor puro | **OUT** |
| 4 | **doctor + ficha de paciente** | **IN** |
| 5 | clinic_member puro | **OUT** |
| 6 | **clinic_member + ficha** | **IN** |
| 7 | owner admin | **OUT** |
| 8 | operations_admin | **OUT** |
| 9 | directory_editor | **OUT** |
| 10 | identidad técnica seed | **OUT** |
| 11 | profile inactivo | **OUT** |

Más dos casos de refuerzo: **un admin no entra ni teniendo ficha**, y **un seed
tampoco** — porque esas exclusiones son duras.

---

# P5 — EXPORTACIÓN

## Dependencia: `xlsx` ya está en el repositorio

`xlsx@^0.18.5` figura en **`devDependencies`** y hoy la usan **siete scripts de
Node** (importadores y catálogos). **No está en el bundle del navegador.**

Llevarla a `dependencies` para el frontend tiene costo: SheetJS pesa alrededor
de 1 MB, y el bundle principal ya está en 671 kB con advertencia de tamaño.
**No la moví**: es una decisión suya.

**Lo implementado en P0 es CSV UTF-8 con BOM**, sin ninguna dependencia nueva.
El BOM no es decorativo: sin él, Excel en Windows abre el archivo con la
codificación local y rompe tildes y eñes. Se abre en Excel con doble clic.

> ### ✅ DECISIÓN DEL OWNER (2026-08-24): **P0 = CSV UTF-8 con BOM, únicamente.**
>
> `xlsx` **no** se mueve a `dependencies`, **no** se importa en el frontend y
> **`package.json` no se toca**. La UI dice **«Exportar CSV»** y aclara que es
> compatible con Excel. El backend acepta **solo** `'csv'` y rechaza cualquier
> otro formato con `P0142`. El **`.xlsx` real queda como mejora posterior**: si
> se hace, el camino ya evaluado es mover `xlsx` a `dependencies` y cargarla con
> `import()` dinámico para que el bundle inicial no crezca.

## Arquitectura

```
UI  →  admin_export_patients_crm(search, status, formato)   [gate is_admin()]
             │
             ├─ _crm_patients_json(...)   ← EL MISMO núcleo que el listado
             │        └─ crm_patient_identity  ← el mismo universo canónico
             │
             ├─ tope MAX_EXPORT = 5000  → P0146 si se supera
             └─ INSERT audit_log        → evidencia sin PII
                        ↓
              el navegador arma el archivo (Blob) y lo descarga
```

**El export no construye una consulta paralela.** Listado y exportación llaman a
`_crm_patients_json`, así que la allowlist de columnas y el predicado de
identidad viven en **un solo lugar**. Una guarda POST verifica que ambos lo
usen: si alguien escribiera una consulta propia para el export, podría ampliar
columnas sin que nadie lo note.

**Exporta el conjunto filtrado completo**, no las 25 filas visibles: pide
`MAX_EXPORT + 1` con `offset 0`, aplicando la misma búsqueda y el mismo filtro
que la pantalla.

## Allowlist del archivo

`ID LucyCare` · `Nombre` · `Teléfono` · `Correo` · `Estado CRM` ·
`Fecha de registro` · `Última actividad` · `Próxima cita` · `Total de citas` ·
`Total de atenciones` · `Médicos relacionados` · `Clínicas relacionadas` ·
`Canal 1.ª cita` · `Etiquetas`.

Es un **subconjunto** de la allowlist del backend: el export puede elegir cuáles
de los campos que ya vienen escribe, **nunca pedir uno nuevo**. Las **notas
administrativas quedan fuera de P0**.

## Prohibición clínica

Es **estructuralmente imposible** que el export incluya datos asistenciales: la
consulta que lo alimenta es la misma del listado, y esa **no recupera** esas
columnas. No es que el Excel las omita — es que nunca salen de la base. El check
verifica las 16 columnas prohibidas sobre el texto de la migración.

## Seguridad

| Requisito | Cómo se cumple |
|---|---|
| Solo el Owner Admin del CRM | `is_admin()` como primera instrucción, `P0140`. Mismo gate que el listado |
| Sin ampliar a otros roles | `operations_admin` y `directory_editor` no son `role='admin'`; los médicos tampoco |
| Evidencia de auditoría | `INSERT` en `audit_log`, inmutable desde `s7_71b` |
| Actor, fecha, tipo, cantidad | `auth.uid()`, `now()`, `formato`, `registros` |
| Contexto **sin PII** | se registra **`con_busqueda: true/false`**, *no el texto buscado* — un admin puede buscar por teléfono o por nombre — más el filtro de estado |
| Sin copia persistida | el archivo se arma en el navegador; nada se sube |
| Sin buckets/storage | ninguno. El check verifica que no aparezcan las palabras |

**La exportación es `VOLATILE` a propósito**, y una guarda POST lo exige:
exportar PII es una **acción**, no una lectura más. Las otras tres RPCs siguen
siendo `STABLE`.

## Performance

| Volumen | Comportamiento |
|---|---|
| **100** | inmediato — una consulta, agregados `LATERAL` sobre 100 filas |
| **1 000** | una consulta; JSON de pocos MB. Aceptable |
| **10 000** | **rechazado** con `P0146`, pidiendo acotar el filtro |

`MAX_EXPORT = 5000` es un tope **técnico**, no de producto: por encima, devolver
todo en una sola respuesta JSON deja de ser razonable. Subirlo exige **rediseñar
el mecanismo** —streaming o generación asíncrona—, no cambiar la constante.

**La pantalla sigue paginada en 25 (tope 50).** Exportar no relaja esa
protección: son dos caminos distintos, con topes distintos y auditoría distinta.

## Pendientes de identificar

**No se mezclan** en el export comercial. Si más adelante se quieren exportar,
será una exportación **operativa separada y explícita**, con su propia
auditoría — no una casilla en esta.

## Deuda registrada

**`ADMIN-DOCTOR-EXPORT`** — aplicar este mismo patrón seguro (núcleo
compartido + allowlist + gate + auditoría sin PII + tope técnico) a la tabla de
médicos. **No se implementa en este frente.**

> ✅ **CERRADO el 2026-08-26** como `ADMIN-DOCTOR-EXPORT-P0`, PR **#351**,
> migración **`s7_78`**. El patrón se aplicó tal cual: núcleo compartido —la RPC
> **reutiliza `admin_list_doctors`** en vez de repetir su predicado—, allowlist
> explícita de 15 columnas, gate `is_admin()`/`P0140`, auditoría sin PII y tope
> técnico de 10 000 con `P0146`. Detalle en `docs/HISTORIAL_FRENTES.md`.

---

## Checks tras P1.1 y P5

`check-s7_76` pasa de **123** a **170**: se suman los bloques de P1.1
(exclusiones duras vs. blandas, fuente autoritativa del acceso, seeds, los once
casos, `security_invoker`) y los de P5 (núcleo compartido, tope, auditoría sin
PII, `VOLATILE`, allowlist del archivo, CSV con BOM, la pantalla sigue paginada).

**Instrumento validado A/B:** al convertir la rama del `OR` en un `AND` —el
error original—, los checks del predicado caen a **166/170** señalando
exactamente que la relación de paciente dejó de ser una alternativa. Restaurado,
vuelve a 170/170.

`check-s7_73` **236/236** · `check-s7_74` **28/28** · `check-s7_75` **67/67** ·
`tsc` **PASS** · `build` **PASS** · `git diff --check` **PASS**.

---

# PRE-APPLY FINAL — F1 a F6

> Revisión y corrección **local**, con `s7_76` y `s7_77` todavía **NOT
> APPLIED**. Nada de esto tocó Supabase, Auth, Edge, Vercel ni producción.
>
> **Rollout preparado —no ejecutado— en `docs/OWNER_S7_76_APPLY.md`:** snapshot
> PRE read-only, la migración `s7_76` y un POST-check **100 % read-only** (solo
> `SELECT`/catálogo, sin `DO`, DDL ni DML). **`s7_77` no se prepara todavía.**

## F1 · Seed exclusion — qué se pudo demostrar y qué no

**La pregunta:** ¿`profiles.email` de una identidad seed contiene realmente el
correo técnico `@doctor-seed.invalid` durante la ventana de cleanup **B→C**,
cuando la fila de `admin_seed_operations` ya se borró pero el `auth.user`
todavía existe?

**Se respondió leyendo código y esquema.** Sin crear ningún seed, sin
`service_role`, sin Auth Admin API y sin imprimir ningún correo.

### La cadena, paso por paso

| # | Paso | Evidencia | Qué queda en `profiles.email` |
|---|---|---|---|
| 1 | La Edge crea la identidad | `supabase/functions/admin-create-seed-doctor/index.ts:189` define `seedEmail = seed-<operation_id>@doctor-seed.invalid`; la línea 313 se lo pasa a `auth.admin.createUser` | — |
| 2 | El trigger copia el correo | `handle_new_user()` hace `INSERT INTO profiles (id, full_name, phone, email, role) VALUES (…, NEW.email, …)` | **`technical_invalid`** |
| 3 | La RPC de negocio actualiza el profile | `admin_create_seed_doctor` §8.7 (`s7_73:652`, vigente en `s7_75:382`): `email = coalesce(v_email, email)`, con `v_email := p_payload->>'email'` | **depende del payload** |
| 4 | El formulario admite ese correo | `AdminCreateSeedDoctorModal.tsx:373` expone un campo `email`; la allowlist de la Edge (`index.ts:149`) lo deja pasar | — |

### Clasificación

| Escenario | `profiles.email` durante B→C |
|---|---|
| Seed creado **sin** correo comercial | **`technical_invalid`** |
| Seed creado **con** correo comercial | **`business_email`** |

> ### Conclusión: la protección B→C por email **no es una garantía**. Es parcial y depende del payload.

**El paso 2 sí es sólido.** `handle_new_user` está en el volcado de esquema del
proyecto y su comportamiento está corroborado por herramientas que corrieron
contra la base real: `_smoke-s7_65.mjs` detecta sus fixtures precisamente por
`profiles.email LIKE '%@…invalid'`, y `check-s7_70` documenta que el setup **no**
escribe `email` porque «lo pone `handle_new_user`». Lo que rompe la cadena no es
el trigger: es el `coalesce` del paso 3.

### Qué se hizo con eso

1. **Se retiró la afirmación de garantía.** El comentario de `s7_77` ya no dice
   que el email «cubre la ventana de cleanup»: dice que
   `admin_seed_operations` es la **defensa estructural** y que el `.invalid` es
   una **defensa parcial**, y nombra el `coalesce(v_email, email)` que la
   limita.
2. **El predicado se conserva.** Cuesta nada y cubre el caso sin correo.
3. **Se agregaron checks** que impiden volver a redactarlo como garantía.

### Alcance real del hueco

Durante B→C el profile técnico ya no tiene `doctors`, `clinics` ni
`clinic_members` —el paso B los borró—, así que las exclusiones blandas tampoco
lo atrapan: con correo comercial entraría al CRM como un paciente `Nuevo` con
cero fichas, y podría salir en una exportación. La ventana es **de minutos**,
la abre el owner deliberadamente durante un cleanup, y la superficie es
**admin-only**.

### Alternativa mínima — propuesta, NO implementada

**El orden de borrado está forzado por las FK y no se puede reordenar:**
`admin_seed_operations` referencia `doctors(id)` y `clinics(id)`, y
`clinics.owner_id` es `NOT NULL` hacia el profile técnico. De ahí que la fila
estructural muera antes que el profile. La ventana es estructural, no un
descuido del runbook.

Tres caminos, de menor a mayor costo:

| Opción | Qué es | Costo | Cobertura |
|---|---|---|---|
| **A · runbook** | Ejecutar C inmediatamente después de B, en la misma sesión, y dejar dicho que durante esa ventana la lista puede mostrar la identidad técnica | cero | procedimental |
| **B · raíz** | Que `admin_create_seed_doctor` **deje de sobrescribir** `profiles.email` con el correo comercial: el correo de contacto del médico no es la identidad técnica del profile | **migración nueva (número TBD)** sobre una RPC ya aplicada, en OTRO frente | completa y barata en tiempo de ejecución |
| **C · audit_log** | Excluir por la fila inmutable que deja el seed (`edited_via = 'admin_create_seed_doctor'`, `new_data->>'seed_user_id'`) | índice de expresión sobre una tabla endurecida; contradice «`audit_log` no es el event store del CRM» | completa, pero cara |

**Recomendación: A ahora, B cuando se reabra el frente del seed.** Ninguna de
las tres se ejecuta en `PATIENT-CRM-P0`.

## F2 · `crm_patient_identity` mínima

**Antes:** `id, full_name, phone, email, created_at`.
**Ahora:** **`profile_id`, y nada más.**

La vista define **pertenencia**, no describe a nadie. `_crm_patients_json` y
`admin_patients_crm_stats` hacen el `JOIN` explícito a `profiles` y arman ahí su
allowlist, que es el único lugar donde se decide qué viaja al navegador.

Se reemplaza con **`DROP VIEW` + `CREATE VIEW`**, no con `CREATE OR REPLACE`:
reemplazar una vista no permite cambiarle las columnas, así que una versión
anterior haría fallar la migración en vez de corregirla.

**Invariantes conservados:** listado, métricas y exportación siguen partiendo de
la misma identidad canónica · sin acceso directo para `PUBLIC`, `anon` ni
`authenticated` · las RPCs siguen siendo la única interfaz · `security_invoker`
sigue aplicándose solo en PostgreSQL 15+.

**Guarda POST nueva:** la migración aborta si la vista no tiene exactamente una
columna llamada `profile_id`. **Check estático nuevo:** falla si alguien
proyecta `full_name`, `phone`, `email`, `created_at`, `role`, `avatar_url` o
`document_number`.

**Corrección de paso:** `con_proxima_cita` se contaba sobre `act` sin cruzar con
el universo canónico, así que podía incluir fichas de identidades excluidas —un
admin con ficha— y superar a `pacientes_totales`. Ahora se cuenta dentro de
`ident`, como el resto.

## F3 · Auditoría de exportación — verificada línea por línea

| Requisito | Estado |
|---|---|
| Gateada por `is_admin()` | ✅ primera instrucción, `P0140`, **antes** del `INSERT` |
| Actor = `auth.uid()` | ✅ nunca un id por parámetro |
| Sin `service_role` | ✅ la RPC corre con el JWT del admin; la secret key no participa |
| Fecha y hora | ✅ `exportado_at: now()` + el `created_at` de `audit_log` |
| Formato | ✅ `formato: p_formato` |
| Cantidad exportada | ✅ `registros: v_n` |
| Filtro no PII | ✅ `filtro_estado`, valor cerrado del enum de estados |
| Búsqueda | ✅ **solo** `con_busqueda: true/false` |
| Texto buscado | ✅ **no se registra** |
| Nombre · teléfono · correo | ✅ **no se registran** |
| Contenido de filas | ✅ **no se registra**: el audit no toca `v_payload` ni `rows` |
| Información clínica | ✅ imposible: no está en el núcleo |
| `VOLATILE` | ✅ y una guarda POST lo exige |
| Un listado normal **no** audita | ✅ hay **un solo** `INSERT INTO audit_log` en toda la migración, dentro del export; las tres RPCs de lectura son `STABLE` |

**Corrección aplicada:** la RPC aceptaba `p_formato IN ('csv','xlsx')`. Con la
decisión P0 —CSV únicamente— eso permitía auditar un formato que nunca se
produce, porque el frontend genera CSV igual. Ahora acepta **solo `'csv'`** y
rechaza el resto con `P0142`.

## F4 · CSV seguro para Excel

**El escape anterior cumplía RFC 4180 y nada más.** Una celda `=1+1` viajaba
tal cual y Excel la ejecutaba: entrecomillar **no** evita eso.

**`src/lib/csv.ts`** es ahora la **única** función de serialización, sin
dependencias nuevas:

1. **Neutraliza** toda celda que empiece por `=`, `+`, `-`, `@`, **tabulador
   (`0x09`), retorno de carro (`0x0D`) o salto de línea (`0x0A`)**,
   anteponiendo un apóstrofo —la marca de «esto es texto» que Excel y
   LibreOffice respetan—. Los tres controles cuentan porque Excel los descarta
   como blanco inicial y evalúa lo que viene detrás: `\n=1+1` es tan ejecutable
   como `=1+1`.
2. **Escapa** según RFC 4180: comillas dobladas, campo entrecomillado si
   contiene comilla, coma o salto de línea.
3. **Conserva UTF-8 con BOM** y separa filas con CRLF.

**El orden importa:** primero se neutraliza, después se construye la celda, para
que el apóstrofo quede **dentro** del campo entrecomillado.

Encabezados y datos pasan por la misma función. `patientCrm.service.ts` ya no
escapa nada por su cuenta.

### Verificación de comportamiento, no de texto

El check **ejecuta** el serializador —`src/lib/csv.ts` no importa nada, así que
se evalúa con el esbuild que el proyecto ya trae— y comprueba la salida con
entradas sintéticas, sin PII:

| Entrada | Salida | Efecto en Excel |
|---|---|---|
| `=1+1` | `'=1+1` | texto |
| `+SUM(A1:A2)` | `'+SUM(A1:A2)` | texto |
| `-1+2` | `'-1+2` | texto |
| `@SUM(A1:A2)` | `'@SUM(A1:A2)` | texto |
| tabulador inicial | apóstrofo delante | texto |
| `\n=1+1` (LF inicial) | `"'\n=1+1"` — apóstrofo delante y campo entrecomillado | texto, **una sola celda** |
| `texto con coma, acá` | entrecomillado | una sola columna |
| `texto con "comillas"` | comillas dobladas | literal |
| texto con salto de línea | entrecomillado | una sola celda |
| `José Muñoz` | intacto | tildes y eñe correctas |

Además se **vuelve a parsear** el archivo con un lector RFC 4180 y se comprueba
que ninguna fila se desalinee, que el contenido se conserve salvo el apóstrofo y
que **ninguna celda del archivo pueda iniciar fórmula**.

**Efecto colateral deseado:** un teléfono `+503…` también queda neutralizado.
Sin protección, Excel lo evaluaba como número y le comía el `+`.

## F5 · Allowlist exportable — fijada en el check

**Backend (`_crm_patients_json`), 17 claves exactas:** `profile_id` ·
`full_name` · `phone` · `email` · `created_at` · `crm_status` · `blocked` ·
`canal_primera_cita` · `fichas` · `clinicas` · `medicos` · `citas_total` ·
`atendidas` · `ultima_actividad` · `proxima_cita` · `followups_abiertos` ·
`tags`. El check compara el conjunto **en las dos direcciones**: falla si falta
una y falla si aparece una de más.

**Archivo, 14 columnas administrativas:** ID LucyCare · Nombre · Teléfono ·
Correo · Estado CRM · Fecha de registro · Última actividad · Próxima cita ·
Total de citas · Total de atenciones · Médicos relacionados · Clínicas
relacionadas · Canal 1.ª cita · Etiquetas.

**Fuera de P0:** notas administrativas, `allergies`, `blood_type`,
`patients.notes`, `internal_notes`, `reason_id`/`cancel_reason_id`,
diagnósticos, medicamentos, recetas, consultas, resultados, antecedentes y todo
contenido asistencial. **La protección es de backend**: el núcleo enumera cada
clave a mano y el export no puede pedir una que el listado no traiga. Que React
no pinte la columna no cuenta como control.

## F6 · Corrección documental

El handoff decía que el HEAD de la rama era igual al baseline. Ya no: existe el
checkpoint docs-only `cefe037` del cambio de ventana. El baseline de `main`
sigue siendo `b9edf91`. La fila del handoff quedó corregida, **sin commit
documental aislado**.

## Checks tras F1–F6

`check-s7_76` pasa de **170** a **261**. Los 91 nuevos cubren: el alcance real
del email técnico (F1), la vista mínima y sus dos consumidores (F2), la
auditoría de exportación campo por campo (F3), el **comportamiento** del
serializador CSV con entradas sintéticas y el re-parseo del archivo (F4), y la
allowlist comparada en las dos direcciones (F5).

**Instrumento validado A/B en F4:** con el escape anterior —RFC 4180 sin
neutralización— los mismos checks caen a **248/261**, y los 13 que fallan son
exactamente los de fórmula: las cuatro entradas peligrosas, el tabulador y el
LF —dos aserciones cada uno—, el teléfono con `+` y la aserción de que ninguna
celda del archivo puede iniciar fórmula. Con el serializador nuevo, **261/261**.

---

# ROLLOUT — `s7_76` APLICADA (2026-08-24)

**`s7_76` = APPLIED / PASS / CLOSED.** Es la **migración 97** del proyecto. No
se vuelve a aplicar. Evidencia completa en `docs/OWNER_S7_76_APPLY.md`.

| Paso | Resultado |
|---|---|
| PRE | `tablas_crm_ya_existentes = 0` · `is_admin_existe = true` |
| Migración | `COMMIT` correcto, sin excepción |
| POST | **39 PASS · 0 FAIL · 8 INFO** |

**Deltas contra el PRE, exactos:** `patients` 4 → 6 índices · `appointments`
6 → 8 · `profiles` 3 → 3 · **0 columnas** y **0 policies** nuevas en las tres
tablas preexistentes.

## Dos incógnitas cerradas

**`server_version_num = 170006` → PostgreSQL 17.6.** Venía sin determinar desde
dos frentes. **`s7_77` aplicará `security_invoker = true`** a
`crm_patient_identity`: la rama del `ELSE` con el `RAISE NOTICE` no se va a
ejecutar.

**`pg_trgm` NO está instalada.** Los dos índices trigram del buscador **no se
crearon**, exactamente como preveía el diseño condicional. El `ILIKE` del
buscador cae en scan secuencial.

> **Deuda registrada — `CRM-SEARCH-TRGM`.** No bloqueante: al volumen actual
> —25 identidades, 31 fichas— el scan es irrelevante. Cuando el padrón crezca,
> el arreglo es habilitar la extensión y crear los dos índices; el SQL ya está
> escrito en `s7_76` y es idempotente. **Instalar una extensión es decisión del
> owner y va por migración propia.**

## Observación abierta — `service_role`

Medido: **`DELETE,INSERT,SELECT,UPDATE`** sobre las cuatro tablas del CRM, por
los privilegios por defecto de Supabase en el esquema `public`. Es el mismo
comportamiento del resto del proyecto —la excepción deliberada es `audit_log`,
endurecida en `s7_71b`— y **no es una vía de acceso desde el navegador**: la
secret key vive solo dentro de la Edge Function y las legacy API keys están
deshabilitadas.

**Nada se cambió.** Endurecerlo sería un `REVOKE` por tabla y entraría por una
migración nueva, nunca editando `s7_76`, que ya está aplicada.

## Rollout de `s7_77` — PREPARADO, no ejecutado

**`s7_77` = NOT APPLIED.** El documento de aplicación es
`docs/OWNER_S7_77_APPLY.md`, con el mismo formato que el de `s7_76` y **todo el
SQL en línea** —ningún paso pide abrir un archivo del repositorio—:

| Paso | Qué es | Controles |
|---|---|---|
| 1 | **PRE** read-only: `s7_76` consistente, baseline CRM = 0, vista y funciones aún inexistentes, sin sobrecargas, PG15+, RLS/policies intactas, prerrequisitos de la migración | **28** |
| 2 | La migración, de `BEGIN;` a `COMMIT;` | — |
| 3 | **POST de catálogo** read-only: vista, helpers, RPCs, allowlist, frontera clínica y seguridad | **45** |
| 4 | **POST funcional** read-only, sin PII: el núcleo responde, paginación, universo y exclusiones | **18** |

**El PASO 4 va aparte a propósito.** Invoca `_crm_patients_json` —`STABLE`, sin
gate, así que corre desde el SQL Editor—, y una excepción ahí abortaría la
consulta entera: separadas, un problema funcional no borra el diagnóstico de
catálogo. **La exportación no se prueba en vivo**: escribe la fila de
auditoría, así que invocarla no sería read-only; su validación es estructural.

**Ninguna RPC pública se invoca en los POST.** Las cuatro gatean con
`is_admin()`, y en el SQL Editor `auth.uid()` es nulo: llamarlas lanzaría
`P0140` y abortaría todo.

---

# S7_77 · CORRECCIÓN PRE-APPLY (2026-08-24)

**`s7_76` = APPLIED / CLOSED · `s7_77` = NOT APPLIED.** Cuatro correcciones
bloqueantes antes del primer apply.

## 1 · El filtro por estado se aplicaba DESPUÉS de paginar — BUG REAL

La primera versión hacía `base → LIMIT/OFFSET → agregados → filtrar el JSON`.
Rompía tres cosas a la vez:

| Síntoma | Causa |
|---|---|
| `total` mentía | contaba el universo **sin filtrar** |
| coincidencias invisibles | una fila `recurrente` en la posición 26 del orden general se descartaba **antes** de que se supiera su estado; no aparecía nunca en el filtro `recurrente` |
| exportación mutilada | recorría las primeras N filas sin filtrar y recién ahí filtraba |

### Orden vigente

```
universo + búsqueda
   → agregados (LATERAL) y estado derivado
      → FILTRO por estado
         → TOTAL del conjunto filtrado
            → PAGINACIÓN
```

Implementado como cinco CTE encadenadas —`base` → `candidatos` → `enriquecida`
→ `calificada` → `filtrada` → `pagina`— dentro de **una sola consulta**.

**Ruta rápida, misma semántica.** Cuando `p_status IS NULL` el filtro es un
no-op, así que recortar antes de agregar da exactamente el mismo resultado: el
`LIMIT` de `candidatos` lleva un `CASE` que aplica la página cuando no hay
filtro y `NULL` —sin límite— cuando lo hay, y el `LIMIT` de `pagina` hace lo
inverso. Las dos rutas **no son dos consultas**: son la misma, con dos `CASE`.

**Costo asumido:** con filtro, los `LATERAL` recorren todo el universo elegible
en vez de una página. Al volumen actual es despreciable; si algún día pesa, se
resuelve con una vista materializada de estados — **no** volviendo a filtrar
después de paginar.

## 2 · Allowlist cerrada de `p_status`

`_crm_status_norm(text)` normaliza con `btrim` + `lower` y acepta **solo** los
seis estados de D2, o NULL/vacío. Todo lo demás muere con **`P0147`** —el
siguiente código libre después de `P0146`—.

**Tres propiedades que importan:**

1. **Se valida antes de consultar y antes de auditar.** Las dos RPCs que
   reciben `p_status` llaman al validador inmediatamente después del gate; el
   núcleo lo vuelve a llamar porque no confía en su llamador.
2. **El mensaje de error no repite el valor recibido.** Si lo hiciera, un
   `p_status` con datos personales acabaría en el texto de la excepción y de ahí
   en los logs.
3. **El audit guarda `v_status`** —el valor normalizado o NULL—, nunca lo que
   llegó del navegador.

Probado con entradas sintéticas: `Juan 7123-4567`,
`recurrente; DROP TABLE patients`, `activo OR 1=1`, `Recurrentes`, `../etc` →
todas `P0147`, y ninguna llega a la fila de auditoría.

## 3 · El control 221 del POST funcional no probaba nada

Comparaba `crm_patient_identity.profile_id` con `patients.id`: entidades
distintas, resultado vacío por construcción. Sustituido por tres controles con
contenido real:

- **230** — el universo coincide con un **recomputo independiente** del
  predicado directamente sobre `profiles`. Eso demuestra que el universo es
  exactamente un subconjunto de identidades globales, así que ninguna ficha sin
  `profile_id` puede estar dentro.
- **232** — hay walk-ins que probar (si fueran 0, el siguiente no diría nada).
- **233** — **el total del listado NO suma los walk-ins**:
  `total <> universo + walkins`.

## 4 · Mínimo privilegio antes del primer apply

La vista y los tres helpers privados nacen sin acceso para **`service_role`**,
además de `PUBLIC`, `anon` y `authenticated`. Alcanzarlos permitiría saltarse el
gate `is_admin()`, y no los llama nadie salvo las RPCs `SECURITY DEFINER`, que
corren como owner.

**No se extendió** a las RPCs públicas ni a `s7_76`: ahí `service_role` sigue
como estaba, y el gate `is_admin()` sigue aplicando.

Guardas POST nuevas: `PUBLIC = NO · anon = NO · authenticated = NO ·
service_role = NO` para los tres helpers y la vista.

## QA de regresión

**`scripts/_qa-crm-paginacion.mjs` — 35/35.** En esta máquina no hay PostgreSQL
—ni servidor, ni contenedor, ni driver— y ejecutar SQL contra Supabase está
prohibido, así que el script **no ejecuta la función**: modela las dos
canalizaciones sobre 27 identidades sintéticas sin PII, con las coincidencias
colocadas a propósito en las posiciones 3, 26 y 27.

Prueba la **especificación** y sirve de A/B. Que el SQL la implemente se verifica
por otras dos vías: las aserciones **estructurales** de `check-s7_76` sobre el
texto de la migración y de sus guardas POST, y el **POST funcional en vivo**
después del apply.

| Con la canalización corregida | Con la defectuosa |
|---|---|
| `total` = 3 (el conjunto filtrado) | `total` = 27 (el universo) |
| las tres coincidencias en la página 1 | solo 1 de 3 |
| página 2 = la restante | una fila distinta, ajena al filtro |
| export = las 3 | pierde coincidencias en cuanto el universo supera el tope |

## Checks

`check-s7_76` pasa de **261** a **313**. Los 52 nuevos cubren el orden
filtro → conteo → paginación, la allowlist cerrada de `p_status`, y el mínimo
privilegio de vista y helpers.

**Instrumento validado A/B:** con la versión anterior de `s7_77` —el filtro
después de paginar, sin allowlist y sin el hardening— los mismos checks caen a
**277/313**, con 36 fallos que señalan exactamente las cuatro correcciones.
Restaurada, **313/313**.

`tsc` **PASS** · build **PASS** (671,53 kB, sin cambio) · `git diff --check`
**PASS**.

## Defecto de empaquetado corregido

El primer intento de insertar el SQL en `docs/OWNER_S7_77_APPLY.md` usó
`String.replace`, que interpreta `$$` en el reemplazo como un escape y convertía
**cada `$$` del SQL en `$`** dentro del documento. El bloque no habría parseado.
Se rehízo por *splice* de arrays y se verificó con `diff` que el SQL del
documento es **idéntico** a la migración. `docs/OWNER_S7_76_APPLY.md` no estaba
afectado —usa concatenación— y se reverificó igual.

## Correcciones de cierre (previas al apply)

Tres ajustes puntuales, sin tocar la semántica aprobada
`universo/búsqueda → estado → filtro → total → paginación`, ni `P0147`, ni el
hardening de `service_role`, ni CSV, ni las allowlists.

1. **Tuteo en `P0146`.** El mensaje decía *«Afiná la búsqueda o el filtro»*.
   Ahora dice **«Afina»**. Se agregaron **10 checks** que barren los mensajes de
   todas las `RAISE EXCEPTION` de `s7_76` y `s7_77` buscando nueve formas de
   voseo: si alguien reintroduce una, el check falla.

2. **Control POST 120.** Su columna `obtenido` mostraba la diferencia bruta de
   longitud de una cadena —un número sin significado para quien lee el
   informe—. Ahora muestra **cuántos elementos tiene la lista `NOT IN (…)`** del
   validador, que es exactamente el número que se compara contra `esperado = 6`.
   El `PASS` sigue exigiendo las dos cosas: seis elementos **y** que sean
   exactamente los seis estados aprobados.

3. **Control POST 137.** Igual: mostraba caracteres eliminados en vez de
   ocurrencias. Ahora `obtenido` es **cuántas veces se invoca el helper de
   estados** en el núcleo, que debe ser `1`.

**Rechecks:** `check-s7_76` **323/323** (era 313) · `_qa-crm-paginacion`
**35/35** · `tsc` **PASS** · build **PASS** (671,53 kB) · `git diff --check`
**PASS**.

**A/B del check de tuteo:** al reintroducir «Afiná», los checks caen a
**321/323** y los dos que fallan nombran el mensaje exacto. Restaurado,
323/323.

**Fidelidad del paquete:** el bloque `BEGIN`→`COMMIT` de
`docs/OWNER_S7_77_APPLY.md` es **idéntico byte a byte** a la migración —878
líneas, 40 740 bytes, verificado con `cmp`—, con los 22 `$$` intactos y sin una
sola línea que no sea SQL.

## `s7_77` APLICADA (2026-08-24) — verificación POST pendiente

**La migración 98 entró sin excepción** (`Success. No rows returned`). **No se
vuelve a aplicar.**

**El PASO 3 falló por un defecto del instrumento, no de la migración:**

```
ERROR 42725: operator is not unique: "char" || unknown
```

`pg_proc.provolatile` es del tipo interno **`"char"`**, que no tiene cast
implícito a `text`. Al concatenarlo, PostgreSQL no puede elegir entre los
candidatos de `||` y aborta la consulta entera. Afectaba a **tres** expresiones
del POST de catálogo —las que arman los `obtenido` de los controles 112, 114 y
115—, todas de **representación**, ninguna de las condiciones `PASS`.

**Corregido con `::text` explícito.** Revisé además **todas** las
concatenaciones de los tres bloques read-only —PRE, POST catálogo y POST
funcional—: las demás usan `text`, `name` o valores ya casteados, y las
comparaciones (`provolatile = 'i'`, `relkind = 'r'`) resuelven solas y no
necesitan cast.

**Guarda nueva contra la próxima:** `check-s7_76` recorre los dos documentos del
owner y falla si alguna de **14 columnas de catálogo tipo `"char"`**
—`provolatile`, `relkind`, `prokind`, `contype`, `confdeltype`, `tgenabled`,
`typtype`…— aparece en una línea con `||` sin `::text`. Validada A/B: al quitar
un cast, el check cae a 324/325 y nombra la línea exacta.

**Rechecks:** `check-s7_76` **325/325** · `_qa-crm-paginacion` **35/35** · `tsc`
**PASS** · build **PASS** · `git diff --check` **PASS**. El bloque
`BEGIN`→`COMMIT` del documento sigue **idéntico byte a byte** a la migración.

**Pendiente:** correr PASO 3 corregido, PASO 4 y PASO 5.

## POST de catálogo · falsos positivos por leer `prosrc` crudo

Primera corrida del PASO 3 tras el apply: **53 PASS / 4 FAIL / 3 INFO**. Los
cuatro FAIL eran **del instrumento**, no de la migración.

**Causa común:** los controles semánticos buscaban tokens en `pg_proc.prosrc`
**crudo**, que incluye los comentarios de la propia migración. Y esos
comentarios nombran a propósito lo que está prohibido.

| Control | Por qué fallaba |
|---|---|
| **152** | el comentario dice *«ni allergies, ni blood_type, ni notes»* |
| **153** | el comentario dice *«ninguna columna clínica puede colarse por un `SELECT *`»* |
| **154** | el comentario dice *«Aceptar 'xlsx' acá sería peor que inútil»* |
| **122** | además, el `LIKE '%p_status%USING%'` casaba con **todo el cuerpo**: `p_status` aparece al principio y `USING` al final, aunque el `RAISE` no interpole nada |

### La corrección

**CTE `ejecutable`**: `prosrc` con los comentarios de bloque y de línea
eliminados. Todos los controles semánticos —y el núcleo, y el reloj de
`_crm_estado`, y `is_admin()`— pasan a leer de ahí.

**122** ahora aísla el `RAISE EXCEPTION` con `substring(src from
'RAISE EXCEPTION[^;]*;')` y exige tres cosas sobre **ese statement**: el literal
`Filtro de estado no válido`, el `P0147`, y que **no nombre `p_status`, no
concatene y no use el marcador `%`** — o sea, que nada de lo recibido pueda
acabar en el mensaje.

**154** pasa a **verificación positiva**: aísla el bloque
`IF coalesce(p_formato …) … END IF;` y comprueba que exige `<> 'csv'` y que
lanza `P0142`. Se eliminó el criterio *«la palabra xlsx no aparece»*, que era
justamente el que rompía.

**152 y 153** mantienen la allowlist y el criterio; solo cambian de fuente.

### A/B local, con los cuerpos reales

`check-s7_76` extrae los **cuerpos reales** de las siete funciones desde la
migración —lo mismo que guarda `prosrc`—, aplica la **misma** normalización que
la CTE, y corre los cuatro predicados. Resultado:

- con `prosrc` **crudo**, 152 y 153 encuentran coincidencias → reproduce el FAIL;
- con la fuente **ejecutable**, cero → predice el PASS;
- `xlsx` existe en el cuerpo del export **solo dentro de un comentario**;
- el `RAISE` aislado cumple las tres condiciones del 122.

Y la contraprueba, sobre fragmentos sintéticos: **comentar** `allergies`,
`SELECT *` o `xlsx` no dispara nada; **ponerlos en código ejecutable** sí
dispara. El instrumento distingue comentario de código.

Una anécdota que vale como advertencia: el primer check que escribí para
verificar el 154 falló *por el mismo motivo* —leía la palabra `xlsx` de mi
propio comentario explicativo—. Ahora busca el predicado, no la palabra.

**Rechecks:** `check-s7_76` **353/353** (era 325) · `_qa-crm-paginacion`
**35/35** · `tsc` **PASS** · build **PASS** · `git diff --check` **PASS**.
`migrations/s7_77` **sin un solo byte de cambio** desde el apply.

---

# `s7_77` = APPLIED / VERIFIED / CLOSED (2026-08-24)

**Migración 98 aplicada y verificada en vivo.** Con esto el **backend completo
de `PATIENT-CRM-P0` está en producción**: `s7_76` (fundación) y `s7_77` (RPCs de
lectura).

| Paso | Resultado |
|---|---|
| PRE | **29 PASS · 0 FAIL · 2 INFO** |
| Apply | `Success. No rows returned` |
| POST catálogo (final) | **57 PASS · 0 FAIL · 3 INFO** |
| POST funcional | **22 PASS · 0 FAIL · 4 INFO** |
| Prueba negativa del filtro de estado | **`P0147`**, sin repetir el valor enviado |
| `audit_log` · `patient_crm_export` tras el rechazo | **0 filas** |

## Qué quedó demostrado en vivo

**La corrección central —`filtro → conteo → paginación`— funciona.** El POST
funcional midió que los seis estados **particionan** el universo (la suma de los
totales filtrados iguala el total sin filtro), que toda fila devuelta por un
filtro tiene ese estado, que el total **no cambia** al pasar de página, que la
página 2 no repite filas de la página 1, y que un filtro recorre **todo** el
conjunto y no solo la primera página.

**La allowlist cerrada de `p_status` funciona y no filtra nada.** La entrada
sintética con forma de PII fue rechazada con `P0147`, el mensaje **no repitió el
valor**, y `audit_log` quedó en **0 filas** de exportación: el rechazo ocurre
antes de consultar y antes de auditar, exactamente como se diseñó.

**El resto de los invariantes:** vista de una sola columna con
`security_invoker = true` e inaccesible para `PUBLIC`, `anon`, `authenticated` y
`service_role`; los tres helpers privados igual; las cuatro RPCs
`SECURITY DEFINER` gateadas con `is_admin()`; `STABLE` las de lectura y
`VOLATILE` solo la exportación; frontera clínica sin una sola columna
asistencial; export solo `csv` con tope 5000; walk-ins fuera del universo y sin
sumarse al total.

## Dos defectos del instrumento, ninguno de la migración

1. **`42725`** — `pg_proc.provolatile` es del tipo interno `"char"`, sin cast
   implícito a `text`: concatenarlo dejaba `||` ambiguo y mataba la consulta
   entera. Corregido con `::text` en las tres expresiones afectadas.
2. **Cuatro falsos positivos** (122, 152, 153, 154) por analizar `prosrc`
   **crudo**, que incluye los comentarios de la migración — y esos comentarios
   nombran a propósito lo prohibido. Corregido con la CTE `ejecutable`, más un
   `122` que aísla el `RAISE` y un `154` que verifica positivamente el bloque
   del formato.

Ambos dejaron **guarda estática** en `check-s7_76`, validada A/B.

## Estado del frente

**Backend: cerrado.** **Frontend: abierto** — `PatientsCrmTab`,
`UnlinkedPatientsTab`, `patientCrm.service.ts`, `lib/csv.ts` y la modificación
de `AdminPacientesPage` siguen **locales, sin commitear y sin PR**. Nada se
commitea ni se despliega sin instrucción del owner.

---

## Nota sobre la numeración de migraciones (2026-08-26)

Este documento reservaba `s7_78` para dos cosas distintas: las **RPCs de
escritura** del CRM y el **fix del correo del seed**. Ninguno de los dos
frentes se inició, y el identificador lo tomó **`ADMIN-DOCTOR-EXPORT`**, que
llegó primero. Las referencias de arriba pasaron a **«migración futura (TBD)»**
sin asignarles otro número: **no se reservan identificadores para frentes no
iniciados**, porque una reserva que nadie consume solo produce huecos y
colisiones.

**Dos menciones a `s7_78` quedan DELIBERADAMENTE sin corregir**, y no son un
olvido:

- `migrations/s7_76_patient_crm_foundation.sql` (líneas 41 y 177);
- `docs/OWNER_S7_76_APPLY.md` (línea 258), dentro del SQL reproducido en línea.

Ese archivo de migración **ya se aplicó en producción** y su contenido es el
registro de lo que se ejecutó; su guía reproduce ese mismo SQL. Editarlos
rompería la correspondencia entre el repositorio y lo aplicado —incluida la
huella sha256 que se documentó al aplicarlo— a cambio de corregir un
comentario. **El registro histórico manda sobre la prolijidad.**

---

# CIERRE DE VENTANA (2026-08-25) — commit, PR y smoke cerrado

## Historial y PR

El frente quedó en **un solo commit** sobre `main`:
**`579b3f6093724014ba93accd237940849484b7e5`**, 16 archivos, +8 700 / −16.

Antes había un checkpoint docs-only, `cefe037…`, ya publicado en el remoto. Se
consolidó con `git reset --soft main` + recommit del mismo mensaje: el **hash del
árbol quedó idéntico** (`83c92794…`), así que no se reconstruyó nada. Como eso
reescribía historial publicado, el push fue **`--force-with-lease` con el SHA
explícito**, y solo después de verificar con `git ls-remote` que el remoto seguía
exactamente donde se esperaba.

**PR [#349](https://github.com/amedelvalle/lucycare/pull/349)** — **MERGED** por
**squash and merge** el 2026-08-25. Cerró con **2 commits** (`579b3f6` funcional +
`feaab7c` documental), 16 archivos y checks de Vercel en PASS; `main` quedó en
**`38fa67c18efbf760c1a8a18d7beccb58b75b81b3`**. Los dos rollbacks entraron con
`git add -f` y están tracked.

**No hay automatismo que reaplique las migraciones**: el repositorio no tiene
`.github/`, `vercel.json` solo define rewrites y cabeceras, `build` es
`vite build` sin `postinstall`, y no existe `supabase/migrations/`.

## Smoke real sobre el Preview — ✅ PASS (2026-08-25)

El owner completó la revisión visual y funcional del Preview y la declaró
correcta. **`Smoke real Preview = PASS`**, cerrado por el owner.

Validado y reportado por él: `/admin/pacientes` carga correctamente ·
«Base de pacientes» funciona · **búsqueda** funciona · **filtro por estados**
funciona · **selector 25/50** funciona · «Pendientes de identificar» funciona y
**permanece separado del universo global** · «Fusión de fichas» abre
correctamente · **comportamiento visual general aceptado**.

**Ese es el alcance exacto del PASS.** No se ejecutaron pruebas adicionales ni se
infiere ningún resultado que el owner no haya declarado. Durante el smoke no se
pulsó «Exportar CSV» —la única acción de la pantalla que escribe, y que generaría
una fila de auditoría—, no se ejecutó merge/unmerge/rechazos y **no hubo ninguna
escritura**. Contexto observado antes del cierre: el universo CRM era de **24
identidades**.

### Turnstile — hostname temporal REMOVED / RETIRADO

Para autenticarse en el Preview hubo que **autorizar temporalmente ese hostname
exacto en Cloudflare Turnstile**. No se autorizó `vercel.app` de forma genérica.

**REMOVED / RETIRADO por el owner el 2026-08-25.** Al terminar el smoke, el owner
retiró del widget el hostname
`lucycare-git-claude-patient-crm-p0-amedelvalles-projects.vercel.app` y **confirmó
que el hostname productivo `lucycare.app` permanece autorizado**. No se modificó
ninguna otra configuración de Cloudflare/Turnstile: ni Site Key, ni Secret Key, ni
modo del widget, ni el enforcement en Supabase.

No era ejecutable desde el repositorio —sin `wrangler`, sin token de API, sin
conector; el repo solo referencia `VITE_TURNSTILE_SITE_KEY` como variable de
build, nunca credenciales de gestión—, así que lo hizo el owner en el dashboard,
como manda la convención vigente.

Era el **único cambio de configuración vivo del frente**: `PATIENT-CRM-P0`
**no deja residuos de configuración**. Consecuencia esperada y correcta: el
Preview del PR ya no puede autenticarse.

## Decisión de producto que cierra el alcance

`PATIENT-CRM-P0` queda congelado en **búsqueda · filtro por estado · paginación
25/50 · exportación CSV del conjunto filtrado**, más la pestaña de pendientes y
la preservación de la consola de fusión. Todo lo demás —los ocho filtros nuevos,
tags, seguimientos abiertos y el selector de orden— es **`PATIENT-CRM-FILTERS-P1`**,
registrado y **no iniciado**, con la regla vinculante de que filtros, conteo,
paginación y exportación usen la misma lógica server-side y de que el CSV respete
exactamente los filtros activos.

Confirmado contra el código aplicado, sin cambiar nada: el orden por defecto es
`profiles.created_at DESC` con desempate por ID —la identidad LucyCare más
reciente primero, **no** la fecha de la ficha—, `Nuevo` son 30 días salvo
prioridad superior, y la prioridad es el orden de evaluación del `CASE` de
`_crm_estado`. **`Nuevo` gana sobre `Activo`**: una identidad recién creada con
próxima cita se muestra como `Nuevo`.

## Deuda de copy detectada durante el smoke — PREEXISTENTE, fuera de este PR

En el Preview se observó `Ingresá con tu email`, que es **voseo** y contradice la
regla de tuteo del proyecto. Verificación read-only, `main` contra el HEAD del
PR #349:

- vive en `src/pages/doctor-detail/components/LoginModal.tsx:804` y **existe
  idéntico en `origin/main`**, en la misma línea;
- el blob del archivo es **el mismo** en ambos lados: `bf4f1cd5…`;
- **el PR #349 no toca ese archivo** — sus 16 archivos no lo incluyen;
- entró en `5c09a4a` (2026-05-25), *"feat(auth): email + password + reset por
  email (Fase 4 PR-A) (#39)"*.

**Conclusión: deuda preexistente de tuteo. NO la introdujo `PATIENT-CRM-P0` y no
es bloqueante del PR #349.** No se corrige dentro de este frente —sería mezclar
un frente de copy con uno de CRM—. Queda registrada como **`COPY-TUTEO-LOGIN`**,
con alcance a definir: el mismo `LoginModal` arrastra además `Revisá tu correo` y
`Ingresá tu email y… un link` (este último con el anglicismo `link`), y el voseo
se repite en `ChangePhoneModal`, `WaitlistModal`, `AffiliationRequestModal`,
`BookingCard`, `PanelLayout` y varias páginas del panel.

## `QA-PATIENT-DATA-CLEANUP-P0` — frente futuro, registrado y NO iniciado

Registrado el **2026-08-25**. **No se ejecuta ninguna limpieza ahora.**

**Objetivo:** inventariar y eliminar de forma controlada pacientes, fichas, citas
y relaciones **QA ficticias** antes de empezar a medir pacientes reales sobre el
CRM. Mientras existan, «Base de pacientes» mezcla universo real y de prueba —el
universo observado de 24 identidades incluye datos de QA.

**Reglas vinculantes:**

1. **PRE de inventario antes de borrar.** Enumerar y clasificar primero.
2. **No asumir que toda identidad es eliminable** — puede haber ficticias con
   dependencias reales, o mixtas.
3. **No tocar `auth.users` mediante SQL.** Siempre Admin API.
4. **Preservar la evidencia de auditoría cuando corresponda** — `audit_log` es
   inmutable desde `s7_71b`; sus filas no son residuos.
5. **Mantener, si se decide, un número mínimo de fixtures QA claramente
   identificados**, con marca explícita.
6. **POST de residuos después de cualquier limpieza**, con verificación de cero
   residuales sobre lo declarado eliminable.

**No bloquea** el merge de `PATIENT-CRM-P0` y **no se abre** sin instrucción
explícita del owner.

## Estado final del frente — CLOSED

```
PATIENT-CRM-P0 ........... CLOSED

s7_76 / migración 97 ..... APPLIED / VERIFIED / CLOSED
s7_77 / migración 98 ..... APPLIED / VERIFIED / CLOSED
Backend .................. CLOSED
QA local ................. PASS
Smoke real Preview ....... PASS      (owner, 2026-08-25)
Smoke producción (auth) .. PASS      (owner, 2026-08-25)
Consola en el smoke ...... SIN ERRORES
PR #349 .................. MERGED    (squash and merge)
main ..................... 38fa67c18efbf760c1a8a18d7beccb58b75b81b3
Vercel Production ........ PASS / desplegado
Turnstile temporal ....... REMOVED   (retirado por el owner, 2026-08-25)
lucycare.app en Turnstile  AUTORIZADO (intacto)
Frontend del CRM ......... EN PRODUCCIÓN
```

El smoke de producción del owner: «Base, búsqueda, 6 estados, 25/50, Pendientes
y Fusión OK. Consola sin errores.» **Fue read-only**: no se pulsó «Exportar
CSV», no se ejecutó merge/unmerge/rechazos y **no hubo ninguna escritura**.

**`PATIENT-CRM-P0` está CERRADO**, sin pendientes operativos ni residuos de
configuración.

### Decisiones de producto vigentes

- Orden por defecto `profiles.created_at DESC` con **desempate estable por ID**.
- **`Nuevo`** = identidad creada en los **últimos 30 días**, salvo prioridad
  superior.
- Prioridad `Bloqueado → En seguimiento → Recurrente → Nuevo → Activo →
  Inactivo`.
- **P0 congelado**: búsqueda · estado · **25/50** · **CSV** del conjunto
  filtrado.
- **Walk-ins separados**: viven en «Pendientes de identificar» como fichas **sin
  identidad global vinculada** y **no se suman** al universo del CRM.

Frentes **registrados y no implementados**, ninguno abierto sin instrucción del
owner: `COPY-TUTEO-LOGIN` · `PATIENT-CRM-FILTERS-P1` ·
`QA-PATIENT-DATA-CLEANUP-P0` · `CRM-SEARCH-TRGM` · `TYPES-RECONCILIATION-P0`.

**`ADMIN-DOCTOR-EXPORT` ya NO está en esa lista:** se cerró el 2026-08-26 como
`ADMIN-DOCTOR-EXPORT-P0` (PR #351, `s7_78`), reutilizando este mismo patrón.
