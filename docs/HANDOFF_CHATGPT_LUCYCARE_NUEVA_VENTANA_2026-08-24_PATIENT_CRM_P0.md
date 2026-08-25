# HANDOFF LucyCare — `PATIENT-CRM-P0` (cierre de ventana, 2026-08-25)

> 🟢 **PUNTO DE ENTRADA CANÓNICO Y VIGENTE.** Autosuficiente: no asume que la
> ventana nueva conozca ninguna conversación anterior.
>
> **Estado en una línea:** el **backend está cerrado y verificado en
> producción**; el frontend está **commiteado y pusheado**; el **smoke real del
> Preview está CERRADO en PASS por el owner**; el **PR #349 sigue abierto y
> mergeable, esperando únicamente la decisión de merge**.
>
> ✅ **Sin pendientes operativos.** El hostname temporal del Preview fue
> **REMOVED / RETIRADO por el owner el 2026-08-25** del widget de Cloudflare
> Turnstile, y el hostname productivo `lucycare.app` **permanece autorizado**.
> No queda ningún cambio de configuración vivo del frente. Ver **§K**.
>
> **Este documento no contiene** PII de pacientes, OTPs, contraseñas, tokens,
> `service_role`, claves ni enlaces con credenciales.

---

## A · Baseline, repositorio y PR

| Ítem | Valor |
|---|---|
| Proyecto | **LucyCare** — directorio médico y agenda, El Salvador |
| Repositorio | `github.com/amedelvalle/lucycare` (**público**) |
| Proyecto Supabase | `kvrsfmzlrmmmavillpuj` · nombre **lucycare** · East US (Ohio) · **PostgreSQL 17.6** |
| Frente actual | **`PATIENT-CRM-P0`** |
| Rama | **`claude/patient-crm-p0`** |
| `main` == `origin/main` | **`b9edf91d135c74404711c2b8f9bffebdc0ad497e`** |
| HEAD local == remoto de la rama | **`579b3f6093724014ba93accd237940849484b7e5`** |
| `main..HEAD` | **1 commit** |
| Árbol antes de este paso documental | **limpio** |

> Comprobar siempre los SHA con `git rev-parse main` y `git rev-parse HEAD`, no
> copiarlos de este documento.

### PR

| Ítem | Valor |
|---|---|
| PR | **#349** — https://github.com/amedelvalle/lucycare/pull/349 |
| Estado | **OPEN · MERGEABLE · NO MERGED** |
| Base ← head | `main` ← `claude/patient-crm-p0` |
| Commits | **1** |
| Archivos | **16** (+8 700 / −16) |
| Checks | **Vercel PASS** · *Vercel Preview Comments* PASS · estado combinado **success** |
| Preview | **Ready** |

**No hay GitHub Actions**: el repositorio no tiene `.github/`, así que esos dos
checks de Vercel son los únicos.

### Cómo quedó el historial

La rama había sido publicada antes con un checkpoint **docs-only**,
`cefe0376054f34185d2120060fcdb76a595a0d70`. Se **consolidó localmente** con
`git reset --soft main` + recommit del mismo mensaje, de modo que el frente es
**un solo commit** sobre `main`; el hash del árbol quedó idéntico
(`83c92794f81817b709dce1078eb73e88be2985f7`), o sea que no se reconstruyó nada.

Como eso reescribió el historial publicado, el push se hizo con
**`--force-with-lease` con el SHA explícito** —nunca `--force` desnudo— y
**después** de verificar con `git ls-remote` que el remoto seguía exactamente en
`cefe037…`. `cefe037` ya no es alcanzable desde la rama; su contenido vive dentro
del commit único.

---

## B · Qué es este frente

Un **CRM de pacientes** dentro de LucyAdmin, con función **operativa** y
**comercial**, manteniendo **separación estricta del expediente clínico**.

`/admin/pacientes` era **solo una consola de deduplicación** —título literal
«Pacientes — Fusión de fichas», sin buscador, sin listado, sin métricas—. Ahora
son **tres pestañas**:

1. **Base de pacientes** — nueva. La unidad es la identidad global.
2. **Pendientes de identificar** — nueva. Fichas sin identidad.
3. **Fusión de fichas** — **la que ya existía, intacta**.

### Principios vinculantes

1. La unidad es la **identidad global LucyCare** (`profiles`), no la ficha.
2. **No duplicar PII ni fuentes de verdad.**
3. Las fichas `patients` son **relaciones locales** de esa identidad.
4. Los **walk-ins** se manejan **aparte**.
5. **Búsqueda, filtro, orden y paginación server-side.**
6. **Cero N+1.**
7. Bajo impacto en Supabase.
8. **Sin campañas ni mensajería en P0.**
9. Acceso restringido al nivel administrativo ya autorizado para
   `/admin/pacientes` (**Owner Admin**).
10. **La información clínica nunca se convierte en información comercial.**

> ⚠️ **Los datos que hoy existen en producción son de prueba/QA.** No son una
> base de clientes y **ninguna decisión comercial** sale de sus porcentajes.

---

## C · Backend — estado definitivo

### `s7_76_patient_crm_foundation.sql` — migración 97

**APPLIED / VERIFIED / CLOSED.** No se vuelve a aplicar.

Fundación del CRM: **`patient_crm`** (PK = FK a `profiles`; único estado
persistido, el bloqueo, con trazabilidad de motivo/actor/fecha al bloquear y al
levantar) · **`patient_crm_tags`** · **`patient_crm_followups`** ·
**`patient_crm_notes`**. Todas cuelgan de `profiles`, **ninguna de
`patients(id)`**.

Además: **RLS activa** en las cuatro, **una** policy por tabla
(`SELECT` / `TO authenticated` / `USING (is_admin())`, sin `WITH CHECK`),
`REVOKE` de `PUBLIC` y `anon`, **sin DML de cliente**, **7 índices** —entre ellos
**`idx_patients_profile_id`**, el JOIN central que no existía— y **auditoría por
trigger** (`audit_patient_crm()`, `SECURITY DEFINER`, `search_path` fijo).

POST de aplicación: **39 PASS · 0 FAIL**. Evidencia en
`docs/OWNER_S7_76_APPLY.md`.

### `s7_77_patient_crm_read_rpcs.sql` — migración 98

**APPLIED / VERIFIED / CLOSED.** No se vuelve a aplicar.

Vista canónica + tres helpers privados + cuatro RPCs `SECURITY DEFINER` gateadas
con `is_admin()` (`P0140`).

**Evidencia live final:**

| Paso | Resultado |
|---|---|
| PRE | **29 PASS · 0 FAIL · 2 INFO** |
| Apply | **`Success. No rows returned`** |
| POST catálogo (final) | **57 PASS · 0 FAIL · 3 INFO** |
| POST funcional | **22 PASS · 0 FAIL · 4 INFO** |
| Prueba negativa de `_crm_status_norm(...)` | **`P0147`**, y el mensaje **no repite el valor recibido** |
| `audit_log` · `patient_crm_export` tras el rechazo | **0 filas** |

### Dos correcciones — del INSTRUMENTO, nunca de la migración

El POST de catálogo falló dos veces por defectos **de la consulta de
verificación**, no del SQL aplicado:

1. **`ERROR 42725: operator is not unique: "char" || unknown`.**
   `pg_proc.provolatile` es del tipo interno `"char"`, que no tiene cast
   implícito a `text`: concatenarlo dejaba `||` ambiguo. Corregido con `::text`
   explícito.
2. **Cuatro falsos positivos** (controles 122, 152, 153, 154) por inspeccionar
   **`prosrc` crudo**, que incluye los comentarios de la propia migración — y
   esos comentarios nombran a propósito lo prohibido («ni allergies, ni
   blood_type», «por un `SELECT *`», «aceptar 'xlsx' sería peor que inútil»).
   Corregido con una CTE `ejecutable` que quita comentarios de bloque y de línea.

> **`s7_77` no se reaplicó ni se modificó después del apply.** Verificado con
> `cmp` contra el snapshot previo: idéntica byte a byte. El `s7_76` del commit
> conserva su sha256 `f94f33c2…b892fbf24`, el mismo que se entregó para aplicar.

Ambos defectos dejaron **guarda estática** en `check-s7_76`, validada A/B.

---

## D · Modelo canónico de paciente CRM

> ### La unidad del CRM es la IDENTIDAD GLOBAL (`profiles`), no la ficha local `patients`.

`crm_patient_identity` es el **predicado canónico** y devuelve **una sola
columna: `profile_id`**. Dice *quién pertenece*, no describe a nadie: el nombre,
el teléfono y el correo se piden a `profiles` con un `JOIN` explícito dentro de
`_crm_patients_json`, que es el único lugar donde se decide qué viaja al
navegador.

### Exclusiones DURAS — siempre fuera, tengan ficha o no

- cuenta inactiva (`profiles.is_active = false`);
- **Owner Admin** (`profiles.role = 'admin'`);
- **`operations_admin` / `directory_editor`** con `lucyadmin_access` **activo**;
- **identidad técnica del Seed** (`s7_73`).

### Exclusiones BLANDAS — solo si NO hay relación real de paciente

Médico, staff de clínica o dueño de clínica quedan fuera **únicamente si no
tienen ficha `patients` vinculada**.

> **Si un médico o un asistente además tiene ficha de paciente, SÍ pertenece al
> CRM como paciente.** La evidencia fuerte de relación de paciente es la ficha.
> Un médico puede ser paciente de otro médico; el predicado no lo niega.

Motivo por el que `role='patient'` **no alcanza** como criterio: el approve con
`reuse_patient` (`s7_42`) crea el médico sobre el profile del paciente y no toca
`role`; un asistente puede tener `role='patient'`; y las identidades técnicas del
seed nacen con `role='patient'` porque así las crea `handle_new_user`.

### Walk-ins — `patients.profile_id IS NULL`

- viven en la pestaña **«Pendientes de identificar»**, separada;
- **no se suman** a `pacientes_totales`;
- **no son base comercial global** todavía;
- **P0 no crea Auth automáticamente** ni los usa para campañas, SMS, WhatsApp ni
  correo. Se vinculan con las herramientas que ya existen: el reclamo del
  paciente con teléfono verificado, o la fusión de fichas si es un duplicado.

---

## E · Estados CRM — reglas definitivas de P0

### Prioridad implementada

```
Bloqueado → En seguimiento → Recurrente → Nuevo → Activo → Inactivo
```

No está escrita como una lista aparte: **es el orden de evaluación del `CASE`**
de `_crm_estado`, que devuelve la primera coincidencia.

| Estado | Regla |
|---|---|
| **Bloqueado** | estado administrativo explícito vigente (`blocked_at` sin `unblocked_at`) |
| **En seguimiento** | al menos **1** follow-up CRM abierto |
| **Recurrente** | al menos **2** citas con estado **`atendida`** |
| **Nuevo** | identidad LucyCare creada en los **últimos 30 días**, siempre que no haya aplicado una prioridad superior |
| **Activo** | tiene próxima cita, o actividad relevante en los últimos **90 días** |
| **Inactivo** | sin próxima cita y sin actividad relevante por más de **180 días** |

> ### ⚠️ Matiz que sorprende al mirar la tabla: `Nuevo` gana sobre `Activo`.
>
> Una identidad creada recientemente que **ya tiene una próxima cita** se sigue
> mostrando como **`Nuevo`**, salvo que esté bloqueada, en seguimiento o sea
> recurrente.

**Los estados derivados NO se persisten.** Se calculan en cada lectura.
Persistirlos exigiría un job de recálculo y quedarían desincronizados al primer
cambio de cita. El único estado guardado es el **bloqueo**.

`_crm_estado` recibe **`p_ahora timestamptz`** como argumento y **no lee el
reloj adentro**: por eso puede ser `IMMUTABLE` legítimamente.

---

## F · Orden del listado — comprobado contra el código

**Por defecto: `profiles.created_at DESC`, con desempate estable por ID.**

Es decir, **la identidad LucyCare registrada más recientemente aparece primero**.
**No** es la fecha de creación de la ficha: el `base` del núcleo hace
`JOIN public.profiles p ON p.id = ci.profile_id` y toma `p.created_at`.

El mismo orden aparece en las tres etapas donde importa —`candidatos`, `pagina` y
el `jsonb_agg` final—, siempre como `created_at DESC, id`. El desempate por `id`
es lo que lo hace estable: sin él, dos identidades con idéntico `created_at`
podrían intercambiarse entre páginas y aparecer duplicadas o desaparecer.

**El frontend no reordena las filas.** No hay `.sort()`, `.reverse()` ni
`localeCompare` en la pestaña: pinta lo que devuelve la RPC.

### Orden de operaciones del listado (la corrección central de P0)

```
universo + búsqueda
  → agregados (LATERAL) y estado derivado
    → FILTRO por estado
      → TOTAL del conjunto filtrado
        → PAGINACIÓN
```

La primera versión filtraba **después** de paginar. Rompía tres cosas: el `total`
contaba el universo sin filtrar, una coincidencia en la posición 26 no aparecía
nunca en su propio filtro, y la exportación heredaba el defecto. **No volver a
introducirlo**: hay guardas POST en la migración y checks estáticos que lo
prohíben.

Hay una **ruta rápida** cuando `p_status IS NULL` —ahí el filtro es un no-op y
los `LATERAL` vuelven a tocar 25-50 filas—, pero **vive en la misma consulta**,
como dos `CASE` en los `LIMIT`, no en dos consultas que podrían divergir.

---

## G · Alcance de P0 — CONGELADO

`PATIENT-CRM-P0` queda limitado exactamente a:

- **búsqueda server-side** (nombre, teléfono, correo o ID);
- **filtro por estado** (los seis);
- **paginación 25/50**;
- **exportación CSV del conjunto filtrado**;
- pestaña **«Pendientes de identificar»**;
- **preservación de «Fusión de fichas»**.

> ### No agregar más filtros dentro de P0. Todo lo demás es `PATIENT-CRM-FILTERS-P1`.

---

## H · Exportación

- **CSV UTF-8 con BOM** — el BOM no es decorativo: sin él Excel en Windows rompe
  tildes y eñes. **Compatible con Excel**, se abre con doble clic.
- **Máximo 5000 filas** (`MAX_EXPORT`), con `P0146` si se supera. Subir el tope
  exige rediseñar el mecanismo —streaming o generación asíncrona—, no cambiar la
  constante.
- **Misma identidad, misma consulta y mismos filtros que el listado**: export y
  listado comparten el núcleo `_crm_patients_json`. Una guarda POST lo exige.
- Exporta el **conjunto filtrado completo**, no la página visible. La pantalla
  sigue paginada.
- **Fórmula CSV neutralizada**: toda celda que empiece por `=`, `+`, `-`, `@`,
  tabulador, retorno de carro o salto de línea se antepone con un apóstrofo.
  Entrecomillar no alcanza: Excel evalúa igual.
- **Sin campos clínicos** y **sin notas CRM administrativas** en P0.
- **Auditoría**: actor (`auth.uid()`), fecha, formato, cantidad y contexto **no
  PII** —`con_busqueda` como **booleano** y el filtro de estado ya normalizado—.
  **Nunca el término buscado**, ni nombre, teléfono, correo ni contenido de filas.
- **`p_status` con allowlist cerrada** de seis valores, validada **antes de
  consultar y antes de auditar**; cualquier otra cosa muere con **`P0147`** y el
  mensaje **no repite el valor recibido**.
- **Solo formato `csv`.** El backend rechaza cualquier otro con `P0142`. El
  `.xlsx` real es mejora posterior; `package.json` no se tocó.

---

## I · Frontera clínica — REGLA VINCULANTE

> **El CRM administrativo no debe exponer ni usar como información
> CRM/comercial:** diagnósticos · recetas · resultados · alergias · tipo de
> sangre · medicamentos · consultas · signos vitales · historias · notas
> clínicas · razón clínica · `patients.notes` · ni ningún dato clínico
> equivalente.

**La exclusión está protegida en el BACKEND.** No depende de esconder campos en
la interfaz: las RPCs **enumeran a mano cada columna** que devuelven —sin
`SELECT *`, sin `row_to_json`, sin `to_jsonb` de fila entera— y ninguna es
asistencial. Verificado en vivo sobre la fuente **ejecutable** de las funciones,
y protegido por check estático sobre el texto de la migración.

---

## J · QA local del frontend — PASS

Hecha con un **harness temporal** que montaba los componentes reales con la
caché de React Query pre-cargada y las queries deshabilitadas: **datos
sintéticos y cero llamadas de red**. El harness se **borró** al terminar; 0
residuos verificados.

| Pestaña | Resultado |
|---|---|
| **Base de pacientes** | **PASS** |
| **Pendientes de identificar** | **PASS** |
| **Fusión de fichas** | **protegida por diff**: no se modificó ninguna de sus RPCs de merge, unmerge, preflight ni rechazos |

### Dos defectos encontrados y corregidos antes del commit

1. **Un correo largo comprimía la columna Paciente** —se quedaba con 439 px
   contra 112 px del nombre— y **las píldoras de estado se partían en dos
   líneas**.
2. **Faltaba el selector 25/50**: ambas pestañas tenían la página fija en 25 y
   `CRM_PAGE_SIZE_MAX` era un export muerto.

**Correcciones aplicadas:** `whitespace-nowrap` en las píldoras · mínimo de ancho
en la columna Paciente · Contacto y Clínica truncados con `title` · **selector
25/50 en ambas pestañas**.

### Observación menor aceptada, NO corregir en P0

«Fusión de fichas» conserva `max-w-5xl` mientras las pestañas nuevas usan
`max-w-6xl`, así que el ancho salta un poco al cambiar de pestaña. **No se toca**
para no alterar el layout histórico.

### Checks finales locales

| Check | Resultado |
|---|---|
| `node scripts/check-s7_76.mjs` | **353/353** |
| `node scripts/_qa-crm-paginacion.mjs` | **35/35** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** (bundle principal 671,53 kB, sin cambio) |
| `git diff --check` | **PASS** |

---

## K · QA real en el Preview — ✅ PASS

**Preview del PR #349:**
`lucycare-git-claude-patient-crm-p0-amedelvalles-projects.vercel.app` — **Ready**.

### Cerrado por el owner el 2026-08-25

El owner completó la revisión visual y funcional del Preview y la declaró
correcta. **`Smoke real Preview = PASS`.**

| Verificación reportada por el owner | Resultado |
|---|---|
| `/admin/pacientes` carga correctamente | **PASS** |
| «Base de pacientes» funciona | **PASS** |
| Búsqueda | **PASS** |
| Filtro por estados | **PASS** |
| Selector **25/50** | **PASS** |
| «Pendientes de identificar» funciona y **permanece separado del universo global** | **PASS** |
| «Fusión de fichas» abre correctamente | **PASS** |
| Comportamiento visual general | **ACEPTADO** |

> ### Alcance exacto de este PASS
>
> Es **lo que el owner reportó, ni más ni menos**. No se ejecutaron pruebas
> adicionales ni se infiere ningún resultado que el owner no haya declarado.
> Durante el smoke **no se pulsó «Exportar CSV»** —la única acción de la pantalla
> que escribe— ni se ejecutó merge, unmerge o resolución de rechazos:
> **ninguna escritura**.

Contexto observado antes del cierre: login de Owner Admin funciona tras autorizar
el hostname del Preview, y el universo CRM era de **24 identidades** en ese
momento.

### Turnstile — hostname temporal REMOVED / RETIRADO

Para autenticarse en el Preview fue necesario **autorizar temporalmente el
hostname exacto del Preview** en Cloudflare Turnstile. **No** se autorizó
`vercel.app` de forma genérica.

El retiro lo **ejecutó el owner** en el dashboard de Cloudflare el **2026-08-25**,
al terminar el smoke. No era ejecutable desde el repositorio —sin `wrangler`, sin
token de API de Cloudflare, sin conector; el repo solo referencia
`VITE_TURNSTILE_SITE_KEY` como variable de build, nunca credenciales de gestión—,
así que se hizo por la vía correcta: la convención vigente es que **las tareas de
dashboard las ejecuta el owner**.

> ### ✅ REMOVED / RETIRADO por el owner el 2026-08-25
>
> Hostname retirado del widget:
> `lucycare-git-claude-patient-crm-p0-amedelvalles-projects.vercel.app`
>
> **Confirmado por el owner:** el hostname productivo de LucyCare
> (`lucycare.app`) **permanece autorizado**. No se modificó ninguna otra
> configuración de Cloudflare/Turnstile: ni la Site Key, ni la Secret Key, ni el
> modo del widget, ni el enforcement en Supabase.
>
> Era el **único cambio de configuración vivo del frente**. Con esto,
> `PATIENT-CRM-P0` **no deja residuos de configuración** y su cierre
> administrativo está completo.
>
> **Consecuencia esperada:** el Preview del PR ya no puede autenticarse. Es
> correcto — el smoke terminó. Volver a probarlo exigiría autorizar el hostname
> de nuevo, y eso requiere autorización explícita del owner.

---

## L · PR #349 — reglas hasta el merge

- PR **abierto y mergeable**. **NO MERGE todavía.**
- **El backend YA está aplicado: no ejecutar `s7_76` ni `s7_77` durante el review
  ni con el merge.** Entran al PR como registro versionado.
- **El repositorio no tiene ningún automatismo que las ejecute.** Verificado
  read-only: sin `.github/`, `vercel.json` solo con rewrites y cabeceras de
  caché, `build` = `vite build` sin `postinstall`, y **sin `supabase/migrations/`**
  (la CLI no tendría nada que aplicar aunque alguien la corriera).
- El **Preview** puede desplegarse automáticamente por Vercel, pero **no es
  producción**.
- La **Edge Function del seed (`ACTIVE` v4) no se despliega por este PR**: su
  despliegue está desacoplado de Git.
- **No tocar Cloudflare/Turnstile.** El hostname temporal del Preview ya fue
  **retirado por el owner** (§K); no queda nada pendiente ahí.
- **No alterar el PR** salvo decisión explícita del owner.

---

## M · Deuda y frentes futuros — NO iniciar

### `PATIENT-CRM-FILTERS-P1` — registrado, no iniciado

Alcance aprobado conceptualmente:

- fecha de registro **desde/hasta**;
- **última actividad**;
- **con/sin próxima cita** y **rango** de próxima cita;
- **canal de primera cita**;
- **médico relacionado**;
- **clínica relacionada**;
- **con ficha / sin ficha**;
- más adelante: **tags** y **seguimientos abiertos**;
- **selector de orden**: registro reciente · última actividad · próxima cita ·
  nombre A–Z.

> ### Regla obligatoria de P1
>
> **Filtros, conteo, paginación y exportación deben usar la MISMA lógica
> server-side.** El CSV debe respetar **exactamente** los filtros activos.
> **Nunca implementar filtros únicamente en el navegador.** Es la lección que ya
> costó una corrección en P0.

### `QA-PATIENT-DATA-CLEANUP-P0` — registrado, NO iniciado

Registrado el **2026-08-25**. **No ejecutar ninguna limpieza ahora.**

**Objetivo futuro:** inventariar y eliminar de forma controlada los pacientes,
fichas, citas y relaciones **QA ficticias** acumuladas, **antes** de empezar a
medir pacientes reales sobre el CRM. Mientras existan, las métricas de
«Base de pacientes» mezclan universo real y universo de prueba.

**Reglas vinculantes del frente:**

- **PRE de inventario antes de borrar nada.** Primero se enumera y se clasifica;
  recién después se decide qué se elimina.
- **No asumir que toda identidad es eliminable.** Puede haber identidades
  ficticias con dependencias reales, o mixtas.
- **No tocar `auth.users` mediante SQL.** Siempre Admin API — regla vigente del
  proyecto, sin excepción para este frente.
- **Preservar la evidencia de auditoría cuando corresponda.** `audit_log` es
  inmutable desde `s7_71b`: sus filas no son residuos.
- **Mantener, si se decide, un número mínimo de fixtures QA claramente
  identificados** — con marca explícita, no adivinables por nombre.
- **POST de residuos después de cualquier limpieza**, con verificación de cero
  residuales sobre lo que se declaró eliminable.

> Este frente **no bloquea** el merge de `PATIENT-CRM-P0` y **no se abre** sin
> instrucción explícita del owner.

### Otras deudas ya registradas

- **`CRM-SEARCH-TRGM`** — `pg_trgm` **no está instalada**, así que los dos
  índices trigram del buscador no se crearon y el `ILIKE` cae en scan. **No
  bloqueante** al volumen actual. Instalar una extensión es decisión del owner y
  va por migración propia.
- **`ADMIN-DOCTOR-EXPORT`** — aplicar el mismo patrón seguro de exportación
  (núcleo compartido + allowlist + gate + auditoría sin PII + tope) a la tabla de
  médicos.
- **Ventana efímera B→C del Seed** — cuando el seed técnico recibió un correo
  comercial, el predicado del `.invalid` no lo reconoce. El email es defensa
  **parcial**, no garantía; la defensa estructural es `admin_seed_operations`
  mientras su fila exista. La corrección de raíz vive en el frente del seed, no
  acá.
- **`TYPES-RECONCILIATION-P0`** — `src/types/database.types.ts` sigue
  desactualizado. **Otro frente**; no se toca desde `PATIENT-CRM-P0`.
- **`COPY-TUTEO-LOGIN`** — **deuda PREEXISTENTE de tuteo**, verificada
  read-only el 2026-08-25. `Ingresá con tu email`
  (`src/pages/doctor-detail/components/LoginModal.tsx:804`) es **voseo** y
  existe **idéntico en `main`**: el blob del archivo es el mismo en `main` y en
  el HEAD del PR (`bf4f1cd5…`), y **el PR #349 no toca ese archivo**. Entró en
  `5c09a4a` (2026-05-25, PR #39). **No la introdujo este frente y no se corrige
  dentro de él.** Alcanza también a `Revisá tu correo`, `Podés`, `Elegí`,
  `Seleccioná`, `Confirmá`, `Escribí` y otras, repartidas por `LoginModal`,
  `ChangePhoneModal`, `WaitlistModal`, `AffiliationRequestModal`, `BookingCard`,
  `PanelLayout` y varias páginas del panel. Los frentes de copy ya cerrados
  (#342/#343, #345, #346) cubrieron el reclamo, `/reset-password` y los errores
  de contraseña, **no** el login público.

---

## N · Reglas operativas que la ventana nueva hereda

- **Un solo frente funcional a la vez.**
- **No SQL de escritura sin orden del owner.** El owner aplica el SQL en el SQL
  Editor; el dev corre los `check`/`smoke`.
- **No nuevas migraciones sin autorización.**
- **No merge sin autorización.**
- **No tocar producción, configuración, hooks ni secretos sin autorización.**
- **`auth.users`: JAMÁS por SQL.** Siempre Admin API.
- **`service_role` requiere autorización explícita, incluso read-only.**
- **No reactivar las legacy API keys.**
- **No tocar** Test Phones, Twilio, Turnstile ni `hook_before_user_created`. El
  hostname temporal de la §K **ya fue retirado**: no queda excepción vigente.
- **No modificar identidades protegidas**: Camilo, LucyAdmin, `operations_admin`.
  **Jamás Katherine.**
- **No usar datos reales de pacientes para QA**, ni en read-only.
- **No inventar QA ni resultados.** No afirmar que una prueba corrió si solo se
  leyó el código.
- **Validar el instrumento, no solo el fix** (A/B contra el código anterior).
- **Copy en tuteo, nunca voseo.** Español, sin anglicismos.
- **Cambios pequeños y reversibles.**
- **No reabrir `s7_76` ni `s7_77`.**
- **No alterar el PR #349** salvo decisión explícita del owner.

---

## O · ⭐ ESTADO EXACTO AL ENTREGAR ESTE HANDOFF

```
PATIENT-CRM-P0

  Backend .................. CLOSED
  QA local del frontend .... PASS
  Commit ................... DONE      579b3f6…
  Push ..................... DONE      --force-with-lease
  PR #349 .................. OPEN / MERGEABLE
  Vercel Preview ........... READY
  Smoke real del Preview ... PASS      cerrado por el owner, 2026-08-25
  Turnstile temporal ....... REMOVED   retirado por el owner, 2026-08-25
  Merge .................... PENDIENTE DE AUTORIZACIÓN DEL OWNER
  Producción frontend ...... NO TODAVÍA

  Próximo paso: decisión de merge del PR #349.
```

**El frente está listo para la decisión de merge.** No quedan pruebas pendientes
del Preview **ni pendientes operativos**: el hostname temporal de Turnstile fue
**REMOVED / RETIRADO por el owner el 2026-08-25**, con `lucycare.app` confirmado
como autorizado.

**Lo único que falta es la autorización de merge del owner.** El frontend **no
está en producción** y no lo estará hasta ese merge.

### Frentes registrados y NO implementados

Ninguno se abre sin instrucción explícita del owner:

| Frente | Estado |
|---|---|
| `COPY-TUTEO-LOGIN` | registrado · no iniciado — deuda **preexistente**, no la introdujo este PR |
| `PATIENT-CRM-FILTERS-P1` | registrado · no iniciado — alcance cerrado por el owner |
| `QA-PATIENT-DATA-CLEANUP-P0` | registrado · no iniciado |
| `CRM-SEARCH-TRGM` | registrado · no iniciado — `pg_trgm` no instalada, no bloqueante |
| `ADMIN-DOCTOR-EXPORT` | registrado · no iniciado |
| `TYPES-RECONCILIATION-P0` | registrado · no iniciado — frente aparte |

---

## Documentación relacionada

| Documento | Rol |
|---|---|
| **Este handoff** | **Fuente canónica del estado del frente** |
| `docs/ANALISIS_PATIENT_CRM.md` | Análisis completo: diagnóstico, D1–D5, arquitectura, UX, P1–P5, F1–F6, las correcciones del filtro y del instrumento POST |
| `docs/OWNER_S7_76_APPLY.md` | Rollout de `s7_76`: PRE, SQL en línea y POST read-only. **Aplicada** |
| `docs/OWNER_S7_77_APPLY.md` | Rollout de `s7_77`: PRE, SQL en línea, POST de catálogo, POST funcional y prueba negativa. **Aplicada** |
| `CLAUDE.md` | Guía rápida. Si contradice a `docs/`, mandan los `docs/` |
| `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-22_ADMIN_DOCTOR_SEED_P0.md` | **Histórico.** Frente anterior, cerrado con PR #348 |
| `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-20.md` | **Histórico.** Mejor descripción del **estado general del producto**: piloto = GO, Auth, Booking, Twilio, Legal, identidades, SEO |
| `docs/HISTORIAL_FRENTES.md` | Detalle por PR de los frentes cerrados |
| `docs/rollbacks/s7_76_rollback.sql` · `s7_77_rollback.sql` | **NO EJECUTAR.** El de `s7_76` es fail-closed: aborta si hay metadata CRM real |
