# MULTICOUNTRY-GEO-P0 — modelo territorial multipaís

> **Estado del frente: EN CURSO.** Fundación 1 = **CLOSED / APPLIED / VERIFIED**
> (PR #365, `s7_87`, migración 108, 2026-09-12). Fundaciones 2 y 3 **diseñadas y
> NO implementadas**.

> ⚠️ **Cómo leer este documento.** Cada bloque lleva su estado real:
>
> | Marca | Significado |
> |---|---|
> | ✅ **IMPLEMENTADO** | existe en la base y está verificado |
> | 📐 **DISEÑADO** | decidido, **sin una línea de SQL ni de código** |
> | ⛔ **PRECONDICIÓN** | bloquea el siguiente paso |
>
> Nada marcado 📐 debe citarse como si existiera.

---

## 1 · El problema

LucyCare nació para El Salvador y el objetivo es operar en más países, el
siguiente Honduras. El requisito del owner es doble y las dos mitades tiran en
direcciones opuestas: **soportar cambios de nombres, códigos y divisiones
administrativas, y países con jerarquías territoriales distintas, sin trasladar
esa flexibilidad a consultas lentas ni a una UX compleja.**

El modelo previo era `departments` (14 filas) → `municipalities` (262), con
`clinics`, `profiles` y `doctor_affiliation_requests` apuntando a ambos.

---

## 2 · Las tres opciones y por qué se eligió B

| | **A · Extensión legacy** | **B · Jerarquía genérica** | **C · Híbrido permanente** |
|---|---|---|---|
| Complejidad | 🟢 mínima | 🟡 media, patrón estándar | 🔴 A + B + pegamento |
| Integridad | 🟡 incompleta | 🟢 un modelo, un lugar | 🟡 dos verdades |
| Rendimiento | 🟢 óptimo | 🟢 equivalente | 🟢 equivalente |
| Extensibilidad | 🔴 una tabla por forma nueva | 🟢 cualquier profundidad | 🟡 solo países nuevos |
| Mantenimiento | 🟡 crece por escalón | 🟢 constante | 🔴 permanentemente doble |

**A quedó descartada por no cumplir el requisito**, y la evidencia decisiva es
que **ya no alcanzaba para El Salvador**: la reforma territorial de 2023 añadió
un nivel intermedio, y el esquema de dos tablas lo absorbió aplanándolo en la
columna de texto `municipalities.district`. No es dato muerto —
`src/pages/home/components/SearchSection.tsx` agrupa el desplegable por ella,
con un bucket `'Otros'` para los nulos—. El síntoma estaba en producción antes
de pensar en Honduras.

**C quedó descartada como arquitectura permanente.** Un híbrido se justifica
cuando migrar lo legacy es demasiado grande o arriesgado; aquí lo legacy son
**276 filas de catálogo y 29 filas referenciándolas**. La maquinaria de
coexistencia cuesta más que la migración que aplaza. La coexistencia temporal
**sí** está permitida, pero solo como estrategia de transición.

**B quedó seleccionada como arquitectura objetivo.**

---

## 3 · Mediciones que respaldan el diseño

Todas read-only, ejecutadas por el owner en la base real.

| | |
|---|---|
| Departamentos | **14**, `id` de 2 caracteres |
| Municipios legacy | **262**, y **14/14** grupos cumplen `id LIKE department_id \|\| '-%'` |
| Filas dependientes | 23 clínicas + 2 perfiles + 4 solicitudes = **29** |
| FK territoriales | **7**, todas `ON UPDATE NO ACTION` |
| `district` | **0 nulos, 0 vacíos**, y `count(DISTINCT (department_id, district))` = **44** |

⚠️ **Los IDs actuales NO son códigos ISO 3166-2.** La Paz es `'LP'` (ISO: `PA`) y
La Unión es `'LU'` (ISO: `UN`); coinciden con ISO en 12 de 14 por casualidad.
Eso descartó el relato de «renombrar solo añade el prefijo del país»: llegar a
ISO real exigiría **reasignar la identidad de dos departamentos**.

⚠️ **Ningún código depende del formato de esos IDs.** Cero parsing en frontend,
cero en SQL, cero `CHECK` de formato, y la coherencia municipio↔departamento se
valida **relacionalmente** (`s7_32:66`, `s7_25:73,81`), no partiendo cadenas.
Por eso los IDs territoriales legacy se conservan como **claves internas
opacas** y no se renombran.

---

## 4 · Identidad: PK internas opacas, códigos oficiales como metadato

Regla vinculante del modelo: **la identidad interna no es nunca un código
externo.**

- Las PK son `IDENTITY` y no significan nada fuera de la base.
- `iso_alpha2` es **metadato externo** con `UNIQUE`: si ISO reasignara un
  código, se actualiza esa columna y ninguna FK se entera. Lleva `CHECK` de
  formato porque debe casar **verbatim** con `x-vercel-ip-country`.
- `official_code`, `official_source` y `official_source_date` son **metadato
  anulable**, nunca identidad. Nacen `NULL`: registrar la ausencia es más
  honesto que inventarla.
- `legacy_id` guardará los IDs salvadorenos actuales (`'SS'`, `'SS-12'`) como
  **puente de migración**. No es identidad y nada lo parsea.
- **Fecha y versión no se mezclan.** El campo es `official_source_date date`.
  Si algún catálogo trae una versión textual real, se añadirá
  `official_version text` aparte.
- ⚠️ **Ningún consumidor debe depender del valor numérico de `countries.id`.**
  Un país se resuelve **siempre** por `iso_alpha2`. La semilla de
  `country_levels` es el primer ejemplo y lo hace así.

---

## 5 · Esquema

### ✅ IMPLEMENTADO — Fundación 1 (`s7_87`, migración 108)

```
countries
  id                smallint  PK IDENTITY      -- interno, opaco
  iso_alpha2        text      NOT NULL UNIQUE  -- metadato externo
  name              text      NOT NULL
  directory_enabled boolean   NOT NULL DEFAULT false
  booking_enabled   boolean   NOT NULL DEFAULT false

country_levels                                  -- labels por país, sin hardcodes
  country_id        smallint  NOT NULL -> countries(id)
  level             smallint  NOT NULL
  label_singular    text      NOT NULL
  label_plural      text      NOT NULL
  PK (country_id, level)

administrative_units                            -- creada y VACÍA
  id                   bigint    PK IDENTITY
  country_id           smallint  NOT NULL
  parent_id            bigint    NULL
  level                smallint  NOT NULL
  name                 text      NOT NULL
  legacy_id            text      NULL
  official_code        text      NULL
  official_source      text      NULL
  official_source_date date      NULL
  is_active            boolean   NOT NULL DEFAULT true

  FK (country_id, level) -> country_levels     -- toda unidad tiene etiqueta
  UNIQUE (id, country_id)
  FK (parent_id, country_id) -> administrative_units (id, country_id)
  CHECK ((parent_id IS NULL) = (level = 1))    -- raíz ⇔ nivel 1
  UNIQUE parcial (country_id, legacy_id) WHERE legacy_id IS NOT NULL
```

La FK compuesta del padre usa `MATCH SIMPLE` —el default de PostgreSQL—, que no
verifica cuando alguna columna es `NULL`: así una raíz pasa sin necesidad de
excepción, y cuando hay padre se exige que comparta país.

**Semilla:** solo El Salvador, con niveles 1 `Departamento`, 2 `Municipio`,
3 `Distrito`. **`administrative_units` quedó vacía a propósito.**

**Privilegios:** RLS habilitada, **cero policies y cero grants** a `anon`,
`authenticated` y `service_role`, sobre las tres tablas **y sobre las dos
secuencias `IDENTITY`** — una secuencia tiene privilegios propios y revocar la
tabla no la alcanza. Ningún runtime las consume todavía; el privilegio llegará
con su primer consumidor.

**Sin unique sobre `official_code`:** no hay códigos cargados y no está
establecido que todo sistema oficial futuro respete la misma regla de unicidad.
Se evalúa en Fundación 2, contra datos reales.

### 📐 DISEÑADO, NO IMPLEMENTADO — el resto del modelo

```
clinics  (+2 columnas, ninguna existente se toca)
  country_id        smallint  -> countries(id)          -- filtro nacional directo
  territory_unit_id bigint    -> administrative_units(id) -- unidad más específica conocida

administrative_unit_paths                               -- closure table
  ancestor_id bigint, unit_id bigint, depth smallint
  PK (ancestor_id, unit_id)
```

`territory_unit_id` podrá apuntar a **cualquier nivel válido**, no
necesariamente a una hoja: una clínica puede conocer su departamento y no su
distrito.

`clinics.country_id` será un **filtro nacional directo y barato**: columna
propia indexada, nunca derivada. El motivo es que `clinics.department_id` es
nullable y está mayoritariamente vacío —23 clínicas con ubicación cargada—, así
que derivar el país dejaría sin país a la mayoría del padrón, y el país decide
en qué directorio nacional aparece un médico.

Los `department_id` / `municipality_id` legacy **no se retiran durante la
fundación**.

---

## 6 · El Salvador vigente: 14 → 44 → 262

📐 **DISEÑADO, NO IMPLEMENTADO.**

| Nivel | Qué es | Filas | Origen |
|---|---|---:|---|
| 1 | Departamento | 14 | migración desde `departments`, `legacy_id` = `'SS'` |
| 2 | Municipio (reforma 2023) | 44 | **nuevas**, derivadas de `(department_id, district)` |
| 3 | Distrito (antiguo municipio) | 262 | migración desde `municipalities`, `legacy_id` = `'SS-12'` |

Los 262 registros legacy **no representan por sí solos los tres niveles**: lo
que traen es la pertenencia, en `district`. Los IDs actuales se conservan en
`legacy_id`, sin renombrar nada.

⛔ **PRECONDICIÓN BLOQUEANTE de Fundación 2.** Los resultados
`262 / 0 nulos / 0 vacíos / 44 grupos / 14 departamentos` demuestran
**consistencia interna de nuestros datos, NO autoridad oficial**. Antes de crear
unidades canónicas hay que validar contra una **fuente oficial vigente y
fechada** el catálogo completo: los 14 departamentos, los 44 municipios, los 262
distritos, **sus nombres** y las relaciones
departamento → municipio → distrito. La fuente INE localizada durante el
análisis está **fechada en 1974** y no sirve como catálogo productivo actual.

---

## 7 · Hot path: cómo se busca sin recursión

📐 **DISEÑADO, NO IMPLEMENTADO.**

La estrategia es **un puntero por clínica más un cierre transitivo
materializado**. `administrative_unit_paths` contendrá, para cada unidad, todos
sus ancestros incluida ella misma — del orden de 900 filas para El Salvador.

```sql
-- médicos por unidad territorial, a CUALQUIER nivel
SELECT d.*
  FROM doctors d
  JOIN clinics c ON c.id = d.clinic_id
  JOIN administrative_unit_paths p ON p.unit_id = c.territory_unit_id
 WHERE c.country_id = $country
   AND p.ancestor_id = $unit;
```

Un join indexado. Sin recursión, sin N+1, sin recorrer ancestros por tarjeta, y
funciona igual si el filtro es departamento, municipio o distrito — o provincia,
cantón o corregimiento en otro país.

**El cierre solo se une cuando el usuario filtra por territorio.** El directorio
sin filtro territorial no lo toca: **cero joins adicionales** respecto de hoy. Y
el país nunca pasa por el cierre — es una comparación de `smallint` sobre
columna propia indexada.

### Consultas territoriales, acotadas por país o por padre

```sql
-- países habilitados                       (~5 filas)
SELECT id, name, iso_alpha2 FROM countries WHERE directory_enabled;

-- primer nivel del país                    (14 filas — nunca el catálogo global)
SELECT id, name FROM administrative_units
 WHERE country_id = $1 AND level = 1 AND is_active ORDER BY name;

-- hijos de la unidad seleccionada          (4 a 33 filas)
SELECT id, name FROM administrative_units
 WHERE parent_id = $1 AND is_active ORDER BY name;
```

### Mantenimiento del cierre, sin trigger permanente

Se reconstruye con una **función explícita dentro del proceso controlado de
catálogo**, más una función de verificación que compara el cierre almacenado
contra uno recalculado y exige diferencia simétrica cero. La recursión ocurre
**al cargar el catálogo**, nunca al consultar.

Un trigger permanente no es indispensable **mientras no exista camino de
escritura**: el DML está revocado a los cuatro roles, y los catálogos legacy no
han tenido un solo writer en toda la historia del repositorio. Pasaría a ser
indispensable el día que LucyAdmin gane una UI para editar unidades
territoriales.

---

## 8 · Invariantes vinculantes

### Rendimiento y UX

- **Sin N+1.**
- **Sin recursión por médico** en el directorio.
- **Country scope server-side**: nunca se descargan médicos de otros países.
- **Nunca se descargan catálogos territoriales globales** — toda consulta va
  acotada por país o por padre.
- Las consultas territoriales deben ser **pequeñas e indexables**.
- **Preservar la rapidez del directorio y la UX actual.** El cambio de país
  debe seguir siendo inmediato para el usuario.
- **Priorizar cambios aditivos, medibles y reversibles.**
- **No sobrearquitectura por anticipación**: se implementa la variante más
  simple que evite rediseñar otra vez, no la más abstracta.

### Ejes que no se mezclan

⚠️ **`doctor_booking_ready` es INDEPENDIENTE del gate nacional.** Sus **cinco
condiciones** (`is_published` ∧ `is_operational` ∧ `booking_enabled` ∧ servicio
activo ∧ horario activo) **no se tocan**. `countries.booking_enabled` es un eje
separado, y la reservabilidad pública será *readiness del médico* ∧ *país
habilitado*, combinada **fuera** de esa función. No mezclar los dos ejes nunca.

`countries.directory_enabled` y `countries.booking_enabled` también son
independientes entre sí: un país puede tener directorio informativo mucho antes
de admitir reservas.

---

## 9 · Secuencia de fundaciones

| | Alcance | Estado |
|---|---|---|
| **F1** | tablas genéricas nuevas, cero cambios a legacy o consumidores | ✅ **CLOSED / APPLIED / VERIFIED** — PR #365, `s7_87` |
| **F2** | catálogo y mapeo de SV 14 → 44 → 262 | 📐 diseñada · ⛔ bloqueada por la validación oficial del §6 |
| **F3** | `clinics.country_id` y `territory_unit_id`, nullable y con backfill | 📐 diseñada |

El cutover final y el retiro del legacy **no están planificados**. Los
consumidores se cortarán uno por uno, y el retiro se decidirá solo después de
**medir cero dependencias**.

### Transición: shadow y aditiva

`departments` y `municipalities` **permanecen intactas** durante la migración.
`administrative_units` se pobla **desde** ellas y funciona como proyección: no
hay dual-write porque **los catálogos legacy no tienen ningún writer** en el
repositorio —verificado en migraciones, `scripts/` y `src/`—.

La coexistencia es **temporal y solo estrategia de migración**; B sigue siendo
el modelo objetivo.

---

## 10 · Evidencia de cierre de Fundación 1

`s7_87` = **APPLIED / VERIFIED / NO REAPLICAR**, aplicada por el owner el
2026-09-12 **antes** del merge de #365, que la incorpora solo como registro
versionado.

**Verificación read-only en la base: 24/24 PASS.** Las tres tablas con su forma
exacta (5 / 4 / 10 columnas), las PK `IDENTITY` con su tipo, la semilla de SV
con ambos flags, los tres niveles colgando del id **real** del país,
`administrative_units` **vacía**, las 6 constraints clave, la FK del padre
compuesta de 2 columnas, los 3 índices, cero unique sobre `official_code`, RLS
en las tres, cero policies, cero privilegios de cliente sobre tablas **y**
secuencias, y el legacy intacto: **14 departamentos / 262 registros / 7 FK /
`clinics` sin columnas nuevas / `doctor_booking_ready` en pie**.

**Validación estática:** `check-s7_87` **126/126**, con tests de mutación de
expectativa invertida sobre las nueve guardas de aditividad. Regresiones
`check-s7_85` 98/98, `check-s7_86` 54/54, `check-admin-doctor-csv` 75/75,
`check-directory-booking-ready` 20/20. `tsc -b` 427 vs 427 de baseline, `build`
y `git diff --check` PASS.

**Atomicidad:** el paso modificador corre como
`BEGIN → DDL/semilla/permisos → POST → COMMIT`. Las guardas POST van **dentro**
de la transacción, así que una verificación fallida aborta y revierte la
fundación entera. Rollback atómico en `docs/rollbacks/s7_87_rollback.sql`, con
`COMMIT` solo después de que su autoverificación pase.

⚠️ **`s7_87` no se modifica**, incluido un comentario residual de la línea 120
que dice «secciones 1 a 4» cuando el POST es la 5. Una migración aplicada es el
registro de lo que se ejecutó. La cabecera «COMO APLICARLA» sí es correcta.

ℹ️ **Nota histórica.** Existe `claude/s7_87-geo` (`30649f7`): **prototipo local
descartado, nunca aplicado, nunca mergeado, no canónico.** El único `s7_87`
válido es el aplicado y mergeado mediante **#365**.

---

## 11 · Deudas y decisiones registradas, ninguna abierta

- **Labels territoriales:** `country_levels` existe para que la UI no hardcodee
  «Departamento». **No asumir que todos los países llaman igual a sus
  divisiones** y no crear dependencias nuevas a esos rótulos.
- **`doctors.country_id` NO entra y no queda abierto en P0.** La ubicación
  pertenece a la clínica; no reabrir sin un cambio explícito del modelo
  médico↔clínica.
- **`municipalities.country_id` NO existe y no debe existir:** el país del
  municipio se deriva por `department_id`.
- **Bloqueadores telefónicos, fuera de alcance y sin tocar:** el `CHECK`
  `'^\+503[0-9]{8}'` de `s7_69` y el `'^503[0-9]{8}'` de `s7_18` impiden
  registrar teléfonos de otro país. Es el obstáculo más duro para operar
  Honduras y es un frente aparte.
- **SEO y ubicación hardcodeadas, fuera de alcance:** `'El Salvador'` en
  `src/pages/doctor-detail/page.tsx`, y `addressCountry: 'SV'` con
  `areaServed` en `og-meta.mjs`.
- **Detección de país (P0), decidida y no implementada:** URL o selección
  explícita → preferencia guardada → GeoIP (`x-vercel-ip-country`) → fallback
  SV. **Sin prefijo telefónico** como señal. La disponibilidad de esa cabecera
  está **documentada, no medida**.
- **Routing candidato, no implementado:** `/` = SV, `/hn` = HN,
  `/doctor/:slug` intacto.
- **`src/lib/authPhone.ts`** ya advierte que su array de países duplica la lista
  de prefijos y que debería consumir una fuente única. Cuando `countries` tenga
  consumidores, será un candidato natural — **no resolverlo por duplicado**.
- **Tipos:** `src/types/database.types.ts` se actualizó **a mano** para las tres
  tablas nuevas. `TYPES-RECONCILIATION-P0` sigue siendo un frente aparte, no
  iniciado.
