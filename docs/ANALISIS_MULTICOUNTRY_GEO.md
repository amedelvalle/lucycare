# MULTICOUNTRY-GEO-P0 — modelo territorial multipaís

> **Estado del frente: EN CURSO.**
> **Fundación 1 = CLOSED / APPLIED / VERIFIED** (PR #365, `s7_87`, migración 108,
> 2026-09-12). **Fundación 2A = CLOSED / APPLIED / VERIFIED** (`s7_88`,
> migración 109, 2026-09-13). La closure table y **Fundación 3** están
> **diseñadas y NO implementadas**. **Ningún runtime lee el catálogo todavía.**

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
3 `Distrito`. **`administrative_units` quedó vacía a propósito** en Fundación 1.
ℹ️ Desde **Fundación 2A** contiene las **320 unidades de El Salvador** — ver §6.

**Privilegios:** RLS habilitada, **cero policies y cero grants** a `anon`,
`authenticated` y `service_role`, sobre las tres tablas **y sobre las dos
secuencias `IDENTITY`** — una secuencia tiene privilegios propios y revocar la
tabla no la alcanza. Ningún runtime las consume todavía; el privilegio llegará
con su primer consumidor.

**Sin unique sobre `official_code`:** no hay códigos cargados y no está
establecido que todo sistema oficial futuro respete la misma regla de unicidad.
**Sigue pendiente**: Fundación 2A cargó `official_code` NULL en las 320 unidades
—el decreto no asigna códigos—, así que no hubo datos reales contra los que
decidirlo. Se evaluará cuando se carguen códigos de una fuente oficial.

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

✅ **IMPLEMENTADO — Fundación 2A** (`s7_88`, migración 109, aplicada y
verificada el 2026-09-13).

| Nivel | Qué es | Filas | Nombres | `legacy_id` |
|---|---|---:|---|---|
| 1 | Departamento | 14 | catálogo candidato | `departments.id` — `'SS'` |
| 2 | Municipio (reforma 2023) | 44 | catálogo candidato | **NULL** — no existe equivalente legacy |
| 3 | Distrito (antiguo municipio) | 262 | catálogo candidato | `municipalities.id` — `'SS-12'` |
| | | **320** | | |

⚠️ **Los nombres NO salen de las tablas legacy**: salen del **catálogo
candidato**, que corrige siete errores que las tablas legacy siguen conteniendo.
Del modelo legacy solo se toma el **`legacy_id`**, como puente.

Los 44 municipios de 2023 **no llevan `legacy_id`**: no tienen contraparte en el
modelo anterior, y un valor inventado sería un puente hacia ninguna parte.

### 6.1 · Cómo se cumplió la precondición: auditorías B1 y B2

La precondición exigía validar nombres y relaciones contra fuente oficial
vigente, porque la consistencia interna de nuestra base no sustituye la autoridad
del catálogo. Se cumplió en dos fases.

**B1 · snapshot de la base = PASS.** Export read-only de las 262 filas de
`municipalities` con su departamento y agrupador. Se obtuvo en cuatro tramos
—el panel del SQL Editor trunca en 100 filas— con columnas autoverificables
(`n`, `total_esperado`) para que un truncamiento fuera visible en el propio dato.
Resultado: 262 filas, 14 departamentos, 44 agrupadores, `legacy_id` únicos, cero
campos vacíos, **cero anomalías de espaciado o caracteres invisibles**, cobertura
`n = 1..262` exacta. SHA-256 del snapshot reconstruido
`416e6fa5bbf130e21c18308d4519e6abbc392e46fd23e4826b43e8b30849ad69`.

**B2 · reconciliación contra la fuente jurídica = PASS.**

| | |
|---|---|
| Norma | **Decreto Legislativo N.° 762** — Ley Especial para la Reestructuración Municipal |
| Emisión y publicación | 13/06/2023 · **Diario Oficial N.° 110, Tomo 439, 14/06/2023** |
| Reforma vigente | **DL 978** de 19/03/2024 · **Diario Oficial N.° 63, Tomo 443, 05/04/2024** — modifica el apartado de San Salvador Centro |
| Ejemplar consultado | texto consolidado de la bóveda de jurisprudencia de la CSJ, `F9625.PDF`, SHA-256 `41c096af17e53e37c87d120f1d509928d65b37c44ea07a008816626d08c96dfa` |
| Vigencia territorial | desde el 01/05/2024 |

El consolidado trae la reforma incorporada y marca con `(1)` exactamente los cinco
distritos de San Salvador Centro que DL 978 redefine. DL 1004 es normativa de
transición y no redistribuye territorio.

El texto se extrajo con un extractor propio de PDF, porque el entorno no tenía
herramientas de PDF. Se autovalidó: devolvió **14 departamentos, 44 municipios y
262 distritos**, cuadrando con el Art. 1 del decreto. Las discrepancias
estructurales se **corroboraron con fuentes independientes**, incluida la cuenta
institucional de la Asamblea Legislativa.

### 6.2 · El catálogo candidato: exactamente 7 correcciones

SHA-256 del candidato:
`63d40d8ab28dc3ea192a5b340625cc10904891eb5a84a0e618b6dcee98934f74`.

| `legacy_id` | Campo | Snapshot | Candidato | Clase |
|---|---|---|---|---|
| `CH-16` | distrito | Cancasque | **San Miguel de Mercedes** | faltante + sobrante |
| `SS-12` | distrito | San Salvador | **San Salvador y Capital de la República** | nombre oficial |
| `LU-09` | distrito | San José | **San José La Fuente** | nombre oficial |
| `SM-07` | distrito | San Antonio | **San Antonio del Mosco** | nombre oficial |
| `CU-06` | municipio | Cuscatlán Norte | **Cuscatlán Sur** | padre |
| `CU-07` | municipio | Cuscatlán Norte | **Cuscatlán Sur** | padre |
| `US-23` | municipio | Usulután Norte | **Usulután Este** | padre |

Ningún `legacy_id` ni `department_id` cambió. Reconciliado de nuevo contra el
decreto, el candidato quedó con **cero faltantes, cero sobrantes, cero nombres
oficiales distintos y cero padres incorrectos**.

**Cuatro diferencias conservadas a propósito**, por decisión del owner, no
bloqueantes:

| `legacy_id` | Cargado | Decreto | Decisión |
|---|---|---|---|
| `SO-01` | **Juayúa** | Juayua | resuelto a favor de la grafía con tilde |
| `CH-27` | San Antonio de la Cruz | de La Cruz | tipográfica no sustantiva |
| `SA-13` | Santiago de la Frontera | de La Frontera | tipográfica no sustantiva |
| `SM-05` | San Luis de la Reina | de La Reina | tipográfica no sustantiva |

Los CSV del snapshot y del candidato **no están versionados** en el repositorio,
por decisión del owner: representan estados de trabajo, no catálogo canónico.
Sus huellas SHA-256 quedan registradas aquí y en la cabecera de `s7_88`.

### 6.3 · `CH-16`: el único puente que cambia de entidad

De las 7 correcciones, **seis conservan la identidad** de la entidad —tres
completan un nombre abreviado y tres corrigen el padre—. **`CH-16` es distinto**:
la base legacy lo cargó como «Cancasque», un distrito que el decreto no reconoce,
y el candidato lo corrige a San Miguel de Mercedes. **El `legacy_id` pasa a
denotar otra entidad.**

Antes de aplicar `s7_88` se midió si algo lo referenciaba. La consulta **descubre
las referencias desde `pg_constraint`** en vez de enumerar tablas a mano —el
fallo que el proyecto ya pagó en #357—.

**Resultado, 2026-09-13:**

| FK | Tabla · columna | Referencias a `CH-16` |
|---|---|---:|
| `fk_clinics_municipality` | `clinics` · `municipality_id` | 0 |
| `doctor_affiliation_requests_municipality_id_fkey` | `doctor_affiliation_requests` · `municipality_id` | 0 |
| `profiles_municipality_id_fkey` | `profiles` · `municipality_id` | 0 |
| | **Total** | **0** |

**Es un cero medido**: se inspeccionaron 3 columnas, que son exactamente las 3 FK
que apuntan a `municipalities.id`, y no apareció ninguna columna municipal sin FK.
Contexto: 23 clínicas con municipio cargado, ninguna en `CH-16`.

**Decisión:** `CH-16` queda documentado como **registro legacy mal rotulado sin
dependencias**, y `legacy_id = 'CH-16'` es un puente válido hacia **San Miguel de
Mercedes**.

El cero cubre los **datos referenciales vivos**, no menciones históricas en
payloads de `audit_log`. Ese es el alcance correcto: `audit_log` registra lo que
pasó, y reinterpretar `CH-16` no reescribe una traza.

### 6.4 · ⛔ PRECONDICIÓN OBLIGATORIA DE FUNDACIÓN 3

**Repetir este precheck inmediatamente antes de cualquier backfill o mapeo de
referencias.** El cero de §6.3 describe el estado del **2026-09-13**. El modelo
legacy sigue operativo y escribible después de Fundación 2A: una clínica podría
registrarse en `CH-16` en cualquier momento. Si eso ocurre, mapear siguiendo el
puente la convertiría en una clínica de San Miguel de Mercedes sin que nadie lo
decida.

**Total mayor que 0 → detenerse y decidir caso por caso antes de mapear.**

```sql
-- READ-ONLY. Una sola sentencia: seleccionarla entera y ejecutar.
-- Es la consulta EXACTA que produjo el cero del 2026-09-13.
WITH refs_fk AS (
  -- Toda FK que apunte a municipalities.id, descubierta, no enumerada.
  SELECT con.conname                AS fk,
         src_ns.nspname             AS esquema,
         src.relname                AS tabla,
         a_src.attname              AS columna
    FROM pg_constraint con
    JOIN pg_class     src    ON src.oid = con.conrelid
    JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
    JOIN pg_class     tgt    ON tgt.oid = con.confrelid
    JOIN unnest(con.conkey, con.confkey) AS k(src_att, tgt_att) ON true
    JOIN pg_attribute a_src  ON a_src.attrelid = con.conrelid  AND a_src.attnum = k.src_att
    JOIN pg_attribute a_tgt  ON a_tgt.attrelid = con.confrelid AND a_tgt.attnum = k.tgt_att
   WHERE con.contype = 'f'
     AND tgt.relname = 'municipalities'
     AND a_tgt.attname = 'id'
),
refs_sin_fk AS (
  -- Columnas que huelen a municipio y NO están cubiertas por ninguna FK.
  SELECT '(sin FK)'::name        AS fk,
         c.table_schema::name    AS esquema,
         c.table_name::name      AS tabla,
         c.column_name::name     AS columna
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.column_name ILIKE '%municipality%'
     AND c.table_name <> 'municipalities'
     AND NOT EXISTS (SELECT 1 FROM refs_fk f
                      WHERE f.esquema = c.table_schema
                        AND f.tabla   = c.table_name
                        AND f.columna = c.column_name)
),
todas AS (
  SELECT * FROM refs_fk UNION ALL SELECT * FROM refs_sin_fk
),
conteos AS (
  SELECT t.fk, t.esquema, t.tabla, t.columna,
         (xpath('/row/c/text()',
                query_to_xml(format('SELECT count(*) AS c FROM %I.%I WHERE %I = %L',
                                    t.esquema, t.tabla, t.columna, 'CH-16'),
                             false, true, '')))[1]::text::bigint AS referencias
    FROM todas t
)
SELECT * FROM (
  -- Detalle por FK / columna.
  SELECT 1 AS orden,
         c.fk::text                                  AS fk_o_nota,
         (c.esquema || '.' || c.tabla)::text         AS tabla,
         c.columna::text                             AS columna,
         c.referencias
    FROM conteos c

  UNION ALL

  -- Total agregado.
  SELECT 2, '── TOTAL DE REFERENCIAS A CH-16 ──', '', '', sum(c.referencias)
    FROM conteos c

  UNION ALL

  -- Cuántas columnas se inspeccionaron: si esto diera 0, la sonda no midió nada.
  SELECT 3, '── columnas inspeccionadas ──', '', '', count(*)::bigint
    FROM conteos c

  UNION ALL

  -- Contexto: qué nombre tiene HOY ese id en el catálogo legacy.
  SELECT 4, '── nombre legacy actual de CH-16 ──',
         coalesce(m.name, '(el id no existe)')::text,
         coalesce(m.department_id, '')::text,
         NULL::bigint
    FROM (SELECT 1) AS u
    LEFT JOIN public.municipalities m ON m.id = 'CH-16'

  UNION ALL

  -- Contexto: volumen total de referencias territoriales, para dimensionar.
  SELECT 5, '── clinics con municipio cargado (contexto) ──', '', '',
         count(*)::bigint
    FROM public.clinics WHERE municipality_id IS NOT NULL
) s
 ORDER BY s.orden, s.referencias DESC NULLS LAST, s.tabla;
```

⚠️ Si `columnas inspeccionadas` diera **0**, la sonda no midió nada y el total
sería un falso limpio: tratarlo como fallo, no como cero.

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
| **F2A** | carga del catálogo de SV 14 → 44 → 262 en `administrative_units` | ✅ **CLOSED / APPLIED / VERIFIED** — `s7_88` |
| — | closure table `administrative_unit_paths` + rebuild/verify | 📐 diseñada, no implementada |
| **F3** | `clinics.country_id` y `territory_unit_id`, nullable y con backfill | 📐 diseñada · ⛔ **exige repetir el precheck de `CH-16` (§6.4)** |

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

## 10.b · Evidencia de cierre de Fundación 2A

`s7_88` = **APPLIED / VERIFIED / NO REAPLICAR**, aplicada por el owner el
2026-09-13 **antes** de su PR, que la incorpora solo como registro versionado.
PASO 1 (PRE) y PASO 2 (transacción completa) terminaron sin error.

**Reconciliación del archivo aplicado con el repositorio:** el archivo no cambió
desde el commit enviado a aplicar, y su SHA-256 en git
(`afce37bcd31d00a164b355e871b72fef5e61c01670d12fe88e46c1f397d004e0`) es el mismo
que imprimió el generador al producir esa versión.

**Verificación real en la base: 24/24 PASS**, con controles read-only
independientes del owner:

| Control | Resultado |
|---|---|
| País SV único | 1 |
| Unidades de SV | **320** |
| Nivel 1 / 2 / 3 | **14 / 44 / 262** |
| Unidades de otros países | 0 |
| Raíces o padres inválidos | 0 |
| Enlaces padre incorrectos o cross-country | 0 |
| `legacy_id` por nivel | **14 / 0 / 262** |
| Correspondencia con `departments` y `municipalities` | **completa y biyectiva** |
| `official_code` no NULL | 0 |
| `official_source_date` incorrecta | 0 |
| Fuente con DL 762 + DL 978 | 320 de 320 |
| Unidades inactivas | 0 |
| Discrepancias con las 7 correcciones B2 | **0** |
| Legacy `departments` / `municipalities` | 14 / 262 |
| Grants `anon` / `authenticated` sobre `administrative_units` | 0 |
| Policies sobre `administrative_units` | 0 |

Las **7 FK legacy** y **`doctor_booking_ready`** no figuran en esa lista, pero
quedaron verificados por las guardas POST de `s7_88`, que corren **dentro** de la
transacción, entre su `BEGIN` y su `COMMIT`. Como el PASO 2 comiteó, se cumplieron
en el momento del commit.

**Validación estática:** `check-s7_88` **123/123**, con nueve tests de mutación de
expectativa invertida que demuestran que las guardas detectan una lista
corrompida. Regresiones `check-s7_87` 126/126, `check-s7_85` 98/98,
`check-s7_86` 54/54, `check-admin-doctor-csv` 75/75,
`check-directory-booking-ready` 20/20.

⚠️ **`s7_88` no se modifica** tras aplicarse.

---

## 11 · Deudas y decisiones registradas, ninguna abierta

- **El catálogo territorial es DATA-DRIVEN.** La lista de 320 unidades vive
  **únicamente** como seed dentro de `s7_88`. **Ningún frontend ni lógica de
  negocio puede hardcodear países, departamentos, municipios ni distritos.**
  `administrative_units` será la fuente operativa. Hoy **ningún runtime la lee**:
  la tabla no tiene grants ni policies, y conectarla es Fundación 3.
- ⛔ **`GEO-CATALOG-ADMIN/P1` = DIFERIDO, NO abierto.** Mantenimiento controlado
  del catálogo desde LucyAdmin. **Deberá operar por IDs internos, NUNCA por
  nombres.** `s7_88` resolvió padres por nombre **solo porque la unicidad se midió
  sobre ese catálogo concreto** (14 de 14 departamentos, 44 de 44 municipios; los
  distritos **no** son únicos). Es una propiedad del dato cargado, no una garantía
  del modelo: en cuanto exista edición, dos unidades podrían compartir nombre y la
  resolución por nombre dejaría de ser determinista.

  Lo que el modelo **ya** le deja preparado, sin haber añadido nada del módulo:
  `is_active` para retirar sin borrar · PK opaca con `legacy_id` y
  `official_code` como metadato, para renombrar o recodificar sin tocar claves ·
  `country_levels` para que los rótulos sean dato · FK `(country_id, level)` que
  impide crear una unidad en un nivel no declarado · FK compuesta
  `(parent_id, country_id)` que impide reparentar entre países · `CHECK` raíz ⇔
  nivel 1 que impide huérfanas · `official_source` / `official_source_date` para
  registrar la procedencia de cada edición · **cero grants**, así que no existe
  ninguna vía de escritura accidental.

  Lo que P1 **tendrá que añadir**: RPCs de escritura con gate `is_admin()`,
  mantenimiento de la closure table al mover un nodo, y traza de auditoría.
- ⚠️ **`official_source_date` no es una fecha de la unidad.** En las 320 filas vale
  **2024-04-05**: la fecha de la **última reforma incorporada al texto
  consolidado** (publicación del DL 978). Los 14 departamentos son anteriores por
  décadas, los 44 municipios nacen con el DL 762 de 2023 y los 262 distritos son
  los municipios previos reclasificados. **No usarla como antigüedad, fecha de alta
  ni clave de orden.**
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
