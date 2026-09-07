# DOCTOR-ONBOARDING-READINESS-P0 — referencia del frente

> **CLOSED (2026-09-07).** PRs **#359**, **#360** y **#361** MERGED.
> `main` en **`e8e8c03d588b85cca32c81013befa312d14bef07`** · **107 migraciones**
> (últimas `s7_85` y `s7_86`, ambas **APPLIED / VERIFIED / NO REAPLICAR**).
>
> Este documento es la referencia vigente del frente. El detalle por PR vive en
> `docs/HISTORIAL_FRENTES.md`; el estado global, en `CLAUDE.md`.

El frente responde a una sola pregunta: **¿en qué punto del camino está cada
médico, y a quién le toca el siguiente paso?** Todo se **deriva**: no se agregó
ni una columna de estado, ni un flag, ni una acción de «marcar» onboarding.

---

## 1 · `onboarding_stage` y sus ocho estados

Vive en `public._doctor_onboarding(uuid) → jsonb` (`s7_85`). **La precedencia es
lo que define el estado: gana la primera condición aplicable**, así que cada
médico tiene exactamente una etapa.

| # | Etapa | Se alcanza cuando | Actor |
|---|---|---|---|
| 1 | `not_published` | `is_published = false` | owner |
| 2 | `pending_claim` | publicado, sin reclamar | médico |
| 3 | `pending_activation` | reclamado, `is_operational = false` | owner |
| 4 | `profile_incomplete` | falta algo del perfil mínimo | médico |
| 5 | `services_missing` | sin servicios activos | médico |
| 6 | `availability_missing` | sin horarios activos | médico |
| 7 | `booking_disabled` | `booking_enabled = false` | médico |
| 8 | `complete` | todo lo anterior cumplido | — |

Consecuencia del orden, que conviene tener presente: **`is_operational = false`
implica que la etapa es una de las tres primeras**, porque `activated` se evalúa
tercero. El recíproco no vale — un médico despublicado puede ser operativo.

`next_action` y `actor` salen del **mismo `CASE`**, con las mismas ramas. No son
tres derivaciones independientes que puedan discrepar.

Los códigos son canónicos y viven en la base; **la traducción al español vive en
el frontend** (`ONBOARDING_STAGE_LABEL`, `ONBOARDING_NEXT_ACTION_LABEL`), igual
que con `lucy_status`. LucyAdmin y el CSV usan **los mismos mapas**, de modo que
la pantalla y el archivo no pueden nombrar distinto a la misma etapa.

---

## 2 · Cuatro ejes SEPARADOS — no mezclar

Es la decisión estructural del frente y la fuente de casi todas las confusiones
previas.

| Eje | Qué responde | Dónde vive |
|---|---|---|
| **onboarding** | ¿en qué paso del camino va? | derivado, `_doctor_onboarding` |
| **`booking_ready`** | ¿se le puede reservar **ahora**? | derivado, `doctor_booking_ready` |
| **`is_operational`** | ¿el owner le habilitó el panel? | columna, **manual** |
| **`is_published`** | ¿aparece en el directorio? | columna |

**`complete` y `booking_ready` NO son lo mismo y se muestran por separado
siempre.** Los dos casos que lo demuestran, ambos reales y ambos capturados en
la QA:

- **`complete` + `No listo para reservas`** — cumplió los siete pasos, pero algo
  de la reservabilidad canónica dejó de valer después.
- **`profile_incomplete` + `Listo para reservas`** — le falta la foto y es
  perfectamente reservable.

Combinarlos en un solo indicador habría sido más simple de leer y **falso**.

---

## 3 · Perfil mínimo

Cinco campos, evaluados dentro de `_doctor_onboarding`. El resultado viaja como
`profile_missing`, un array de códigos:

| Código | Origen |
|---|---|
| `foto` | `profiles.avatar_url` no vacío |
| `especialidad` | `doctors.specialty_id IS NOT NULL` |
| `descripcion` | `doctors.bio` no vacío |
| `clinica` | `clinics.name` no vacío |
| `ubicacion` | `clinics.address_line` no vacío |

Se comparan con `coalesce(btrim(...), '') <> ''`: una cadena de espacios **no**
cuenta como cargada.

⚠️ **No es la misma regla que D1 del directorio.** D1
(`src/services/directory.service.ts`) gobierna qué se lista públicamente y exige
`full_name` + especialidad + `clinic.name` + `clinic.address`. El perfil mínimo
del onboarding añade **foto** y **descripción**, que D1 no pide. Son criterios
distintos a propósito: uno decide visibilidad, el otro completitud.

**El detalle de `profile_missing` NO va al CSV.** Es diagnóstico de ficha, no
columna de hoja de cálculo; una guarda POST de `s7_86` lo impide.

---

## 4 · Regla de `booking_ready`

`public.doctor_booking_ready(uuid) → boolean` (`s7_85`). **Cinco condiciones,
todas obligatorias:**

```
is_published  AND  is_operational  AND  booking_enabled
AND  EXISTS (servicio activo)
AND  EXISTS (horario activo)
```

Ausencia de médico ⇒ `false`, por `COALESCE`. Es la **única** definición: la usa
`_doctor_onboarding` internamente y la consume el perfil público.

**Consumo público — fail closed.** `src/pages/doctor-detail/page.tsx` hace
`canBook = (bookingReady === true)`. Cualquier otra cosa —`undefined` mientras
carga, `null`, un fallo de red— **cierra** la reserva. Antes de `s7_85` el CTA
dependía de `booking_enabled` a secas, **uno solo de los cinco requisitos**: un
médico con la agenda encendida pero sin horarios ofrecía reservar y no había
nada que reservar.

`doctor_booking_ready` es la única función del frente con `EXECUTE` para `anon`
—la invoca un visitante anónimo—; `_doctor_onboarding` está revocada para los
cuatro roles y solo se alcanza desde funciones `SECURITY DEFINER`.

---

## 5 · Fallback legacy de claim y su corte

El claim canónico es **`doctors.tos_accepted_at IS NOT NULL`**: lo escribe
`claim_doctor_profile` y es evidencia real de que el médico aceptó los términos.

Pero los médicos anteriores al despliegue de esa escritura **no tienen ese
campo**, y sin fallback aparecerían todos como «pendientes de reclamar». La
regla vigente es:

```sql
(d.tos_accepted_at IS NOT NULL
 OR (d.created_at < TIMESTAMPTZ '2026-05-24 00:00:00+00'
     AND d.lucy_status IN ('claimed', 'booking_enabled', 'verified'))) AS claimed
```

Dos decisiones dentro de esas tres líneas:

**Está acotado a una cohorte objetiva.** La versión inicial aceptaba
`lucy_status` sin límite temporal, y `lucy_status` es **editable a mano desde
LucyAdmin**: cualquier médico nuevo podría haber quedado marcado como reclamado
sin haber reclamado nunca. El corte por `created_at` cierra esa puerta.

**El literal es `TIMESTAMPTZ`, no `DATE`.** `doctors.created_at` es
`timestamptz`; comparar contra un `DATE` habría hecho el cast usando la zona
horaria **de la sesión**, y el mismo médico podría caer a un lado u otro del
corte según quién ejecute la consulta. Se verificó además que la ventana
ambigua está **vacía**, así que la corrección no movió a nadie de cohorte.

⚠️ **El tramo anterior al corte es inferencia legacy para efectos de
onboarding.** NO es evidencia canónica de claim ni autorización de nada: no
sustituye a `tos_accepted_at` para ningún propósito legal, de permisos ni de
auditoría.

---

## 6 · `is_operational` sigue siendo un gate MANUAL

Decisión explícita del owner: **no se automatiza**.

`is_operational` es el gate del panel del médico. La aprobación
(`admin_approve_and_create_doctor`) crea al médico con `is_operational = false`,
y **`claim_doctor_profile` no lo toca** — está escrito así en `s7_80`, con
comentario. Es decir: «no operativo» es el **estado de fábrica**, y encenderlo
es un acto deliberado del owner.

El frente **no cambió** `is_operational`, `admin_set_doctor_operational`, el
claim, los permisos ni una sola regla server-side. Lo único que se tocó es cómo
se **nombra** y cuándo el botón está disponible.

**Botón en el listado.** Antes del claim se muestra **deshabilitado**, con
«El médico debe reclamar su perfil primero.». Habilitar a alguien que aún no
reclamó adelanta un paso sin efecto observable —su cuenta nace dormida— y lo
deja entrando al panel sin revisión intermedia. Es una guarda **de cliente**:
`admin_set_doctor_operational` sigue aceptando la llamada, deliberadamente.

---

## 7 · Copy final del eje operativo

| Condición | Etiqueta |
|---|---|
| `is_operational = true` | **Operativo** |
| `false` + **no** reclamado | **No habilitado** |
| `false` + reclamado | **No operativo** |
| Filtro del listado | **Operativo / No operativo** |
| Botón, no operativo | **Habilitar** (deshabilitado antes del claim) |
| Botón, operativo | **Suspender** |

**Se retiraron `Suspendido` y `Reactivar`.** El motivo no es estético: la
columna **no guarda historia**, y `audit_log` quedó sin lectura para
`authenticated` desde `s7_71b`. Con los datos disponibles **no se puede
demostrar que hubo una activación previa en ningún caso**, así que ambas
palabras afirmaban algo indemostrable — y sobre un médico recién creado eran
directamente falsas: parecía sancionado quien solo estaba esperando.

El corte por `claimed` sí es demostrable: quien nunca reclamó nunca tuvo panel,
luego no pudo ser suspendido de operar.

La resolución vive en `operationalLabel()` + `resolveClaimed()`
(`src/services/admin.service.ts`). `resolveClaimed` usa el onboarding cuando ya
llegó y `lucy_status` de la propia fila mientras tanto: así la etiqueta **no
parpadea** entre las dos formas y **no dispara ninguna consulta**.

---

## 8 · CSV de médicos — 20 columnas

`s7_86` lleva el export de 17 a **20 columnas**, añadiendo al final:

| Columna | Origen |
|---|---|
| `Onboarding` | `stage`, traducida |
| `Próxima acción` | `next_action`, traducida (`none` → celda vacía) |
| `Listo para reservas` | `booking_ready` → `Sí` / `No` |

Una etapa desconocida **se escribe cruda** en vez de dejar la celda vacía: un
hueco silencioso ocultaría una etapa nueva sin traducir.

Sin cambios en filtros, paginación, `MAX_EXPORT = 10000`, `P0140`/`P0142`/
`P0146`, gate `is_admin()`, grants de los cuatro roles, orden dentro de
`jsonb_agg` ni el bloque de auditoría — verificado por **A/B byte a byte** contra
`s7_79` en `check-s7_86`.

---

## 9 · Rendimiento de `s7_86` y su criterio

**El riesgo real:** las tres columnas salen del mismo `jsonb`. Escribirlas como
tres llamadas escalares habría dado **tres evaluaciones por médico** —
PostgreSQL **no** elimina subexpresiones comunes entre llamadas a función, y
`STABLE` no lo cambia.

**La solución:** la función va en el `FROM`, no en la lista de selección.

```sql
LEFT JOIN LATERAL public._doctor_onboarding(d.id) AS onb(payload) ON true
```

Eso produce un **`Function Scan`**: se evalúa una vez por fila externa, y las
tres claves leen una columna ya materializada. No puede colapsar por *inlining*
porque PostgreSQL se niega a inlinear funciones SQL `SECURITY DEFINER` o con
cláusula `SET`, y `_doctor_onboarding` es ambas — de ahí la guarda PRE que
verifica que conserve las dos propiedades.

**`LEFT JOIN ... ON true` y no `CROSS JOIN LATERAL`:** si la función no
devolviera fila, un `CROSS JOIN` **borraría al médico del CSV en silencio**. Un
export que pierde filas sin avisar es justo lo que `P0146` existe para evitar.

### Medición en producción (2026-09-07, universo real)

| | Candidato | Control (3 llamadas) |
|---|---|---|
| `Function Scan on _doctor_onboarding` | **`loops=117`** | **no aparece** |
| Execution Time | **60,357 ms** | 191,198 ms |
| Buffers | 3 069 (todos `shared hit`) | 7 581 |

117 médicos → **117 evaluaciones**: una por médico. Relación de tiempo
**3,17×**, la predicha.

La relación de **buffers** es 2,47×, no 3×; no está explicada con certeza —la
hipótesis es que el `Function Scan` materializa su salida y eso carga
contabilidad extra al lado del candidato— y **no cambia la conclusión**. Queda
anotado como observación, no como confirmación.

### Criterio de rendimiento vigente

**`loops` = número de médicos.** Si una medición futura diera `3 × N`, el diseño
dejó de cumplir y hay que parar. La guarda POST de `s7_86` lo hace cumplir en el
código: cuenta las apariciones de `_doctor_onboarding` en el cuerpo ejecutable y
**exige exactamente 1**.

**Coste y techo.** ~0,5 ms por médico. Con 117 (el **1,17 %** del tope de
10 000) son 60 ms. En el tope serían **~5 s**: perceptible, pero el export es una
acción explícita con estado de carga, guarda anti-doble-clic y manejo de error.
Registrado, no optimizado.

**Cero N+1 y una sola petición.** El coste vive dentro de
`admin_export_doctors`, que solo se invoca al pulsar «Exportar CSV». El frontend
hace **una** llamada RPC para el export completo, invariante con el número de
filas, y **nunca** pide onboarding por médico. El listado normal no se amplió:
`admin_list_doctors` quedó intacta.

---

## 10 · La regresión de #359 y su corrección en #360

**Lo que pasó.** `s7_85` introdujo `doctor_booking_ready` y el perfil público
pasó a consumirlo. El helper quedó escrito así:

```ts
const rpc = supabase.rpc as unknown as (…)   // ❌
await rpc('doctor_booking_ready', { p_doctor_id: doctorId })
```

`supabase.rpc` es un **método**. Extraerlo a una variable y llamarlo suelto deja
`this` en `undefined` y lanza
`Cannot read properties of undefined (reading 'rest')` **antes de emitir la
petición**. React Query capturaba el error, `bookingReady` quedaba `undefined`,
y `canBook === true` caía en fail closed.

**El efecto: la reserva en línea quedó caída en TODOS los perfiles públicos.**
El fail-closed funcionó exactamente como se diseñó; lo que falló fue la llamada.

**Cómo se detectó.** En producción, el resource timing de
`/doctor/dr-camilo-carrillo` listaba la consulta de detalle y la de
calificaciones, y **ninguna llamada** a `/rpc/doctor_booking_ready`. La petición
nunca salía.

**La corrección (#360):** una palabra — `supabase.rpc.bind(supabase)`.

### Lección: no extraer métodos del cliente Supabase sin conservar `this`

**Regla vigente: nunca desligar un método del cliente Supabase.** Si hace falta
tipar la llamada, se liga con `.bind(supabase)`; llamarlo suelto lo rompe. Es la
única ocurrencia que hubo del patrón — las otras 74 llamadas RPC de `src/` ya
eran ligadas.

**Por qué no lo vio nada.** Es un error de **runtime**: `tsc` y `build` pasan sin
inmutarse, y no existía una sola prueba que ejercitara ese helper.

**La lección de método, más incómoda.** Yo había reportado haber validado la ruta
de fallo «uuid inválido → `22P02` → throw». Observé *un* throw y se lo atribuí a
la RPC; era el `TypeError`. Es exactamente la regla que el proyecto ya tenía
escrita: **si el control también "pasa", el defecto está en la sonda.**

**La cobertura que faltaba** existe ahora:
`scripts/check-directory-booking-ready.mjs` transpila el servicio real y lo
**ejecuta** contra un `fetch` instrumentado —instalado antes del import, porque
postgrest-js resuelve el `fetch` al construir el cliente—. Afirma que la
petición **sale de verdad**, que el patrón desligado lanza y emite **0**
peticiones, y que `false`, `true`, `null` y un error del proveedor resuelven como
deben. Validado A/B: **20/20** con el fix, **5 FAIL** contra el código mutado.

---

## 11 · QA y estado final

**Producción (2026-09-07), deployment `6300527694` · ref `e8e8c03` · success.**

| Verificación | Resultado |
|---|---|
| Harold → etapa | `Pendiente de reclamar` |
| Harold → reservabilidad | no reservable, sin CTA público |
| Camilo → etapa | `Completo` |
| Camilo → reservabilidad | `Listo para reservas`, CTA restaurado |
| `doctor_booking_ready` en producción | emitida y funcionando |
| CSV real descargado de LucyAdmin | **117 médicos · 20 columnas** |
| Harold en el CSV | `Pendiente de reclamar` · `El médico debe reclamar su perfil` · `No` |
| Camilo en el CSV | `Completo` · próxima acción vacía · `Sí` |
| Peticiones del export | **una sola** |
| Degradación del módulo | **ninguna detectada** |

**Checks:** `check-s7_86` 54/54 · `check-admin-doctor-csv` 75/75 ·
`check-s7_85` 98/98 · `check-directory-booking-ready` 20/20 ·
`check-s7_83` 113/113 · `check-s7_84` 40/40 · `check-crm-csv-fechas` 33/33 ·
`_qa-crm-paginacion` 35/35 · `build` PASS · `git diff --check` PASS ·
`tsc -b` 427 diagnósticos con **0 atribuibles**.

⚠️ **`npx tsc --noEmit` no es una validación válida en este repositorio** y no
debe volver a reportarse como PASS: el `tsconfig.json` es *solution-style* con
`"files": []`, así que comprueba cero archivos y siempre sale 0. El typecheck
real es **`tsc -b`**.

---

## Pendientes REGISTRADOS — ninguno abierto

**No abrir sin instrucción del owner.**

- **`ONBOARDING-FOLLOWUP-P1`** — seguimiento y comunicación según etapa de
  onboarding, aprovechando la automatización asistida que ya existe para el
  correo de bienvenida (#357). Es el frente natural que sigue.
- **`ADMIN-DOCTOR-DETAIL-TABS-P1`** — evaluar reorganizar la ficha del médico en
  pestañas **si** la densidad de información sigue creciendo. Hoy no hace falta.
- **Redundancia interna de `_doctor_onboarding`** — `doctor_booking_ready`, que
  se llama desde dentro, **relee** `doctors`, `services` y `availability_rules`
  que el CTE ya consultó: 3 de las ~9 lecturas por evaluación están duplicadas.
  Es preexistente de `s7_85`, no lo introdujo el CSV. **Optimización futura solo
  si una medición lo justifica**; hoy no lo justifica.
- **Historial insuficiente para distinguir «nunca habilitado» de una suspensión
  real** — un médico **reclamado** y no operativo es indistinguible de uno
  suspendido con las columnas actuales, y `audit_log` no es legible desde
  LucyAdmin. **Por eso el copy es neutral** (`No operativo`). Resolverlo exigiría
  leer historia o persistir estado nuevo; ninguna de las dos está en alcance.

## Limitación de evidencia del cierre

**No es un frente abierto ni un requisito pendiente.** Es el alcance exacto de
lo que se verificó, anotado para que nadie lo cite de más.

Las etapas `not_published`, `services_missing`, `availability_missing` y
`booking_disabled` **no se ejercitaron con datos reales**: hacerlo exigía mutar
producción solo por QA, y el owner decidió no hacerlo. Están cubiertas por el
check estático y por el harness de UI, así que **no deben describirse como
«probadas en producción»**. El frente está **CLOSED** y esto no exige trabajo
futuro.
