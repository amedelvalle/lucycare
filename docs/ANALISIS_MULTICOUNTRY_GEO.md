# MULTICOUNTRY-GEO-P0 — modelo territorial multipaís

> **Estado del frente: EN CURSO.**
> **Fundación 1 = CLOSED / APPLIED / VERIFIED** (PR #365, `s7_87`, migración 108,
> 2026-09-12). **Fundación 2A = CLOSED / APPLIED / VERIFIED** (`s7_88`,
> migración 109, 2026-09-13). **Fundación 3A = CLOSED / APPLIED / VERIFIED**
> (PR #368, `s7_89`, migración 110, 2026-09-13). **F3B paso 1 = APPLIED /
> VERIFIED / CLOSED** (PR #369, `s7_90`, migración 111, 2026-09-13: M2 de
> `CH-16`). **F3B paso 2 = APPLIED / VERIFIED / CLOSED** (PR #370, `s7_91`,
> migración 112, 2026-09-13: ubicación emparejada en la aprobación). **F3B paso 3 =
> CLOSED / APPLIED / VERIFIED** (PR #372, `s7_92`, migración 113, 2026-09-13: sincronización
> central legacy → modelo nuevo y retiro de la guarda F3A). **F3C = CLOSED / APPLIED /
> VERIFIED** (PR #374, `s7_93`, migración 114, 2026-09-14: backfill histórico de las
> 23 clínicas con ubicación legacy). **F3D = APPLIED / VERIFIED** (PR #375, `s7_94`,
> migración 115, 2026-09-15: cierre territorial `administrative_unit_closure`, 888
> filas). **F3E en adelante está diseñado y NO iniciado.** **Ningún lector, directorio
> ni frontend consume el catálogo, el cierre ni las columnas nuevas de `clinics`**; solo
> las escriben la sincronización de `s7_92`, el backfill de `s7_93` y la carga de
> `s7_94`.

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

### ✅ IMPLEMENTADO — Fundación 3A (`s7_89`, migración 110)

```
clinics  (+2 columnas, ninguna existente se toca)
  country_id        smallint NULL  -> countries(id)                       -- filtro nacional directo
  territory_unit_id bigint   NULL                                         -- unidad más específica conocida
  FK (territory_unit_id, country_id) -> administrative_units (id, country_id)
  CHECK clinics_territory_requires_country_chk                            -- PERMANENTE
        territory_unit_id IS NULL OR country_id IS NOT NULL
  CHECK clinics_geo_f3a_temp_null_chk                                     -- TEMPORAL F3A
        country_id IS NULL AND territory_unit_id IS NULL
  índices clinics_country_id_idx, clinics_territory_unit_id_idx
```

**Las columnas existen y no contienen nada**: sin default, sin backfill y con 0
valores en producción. Ningún escritor, lector, función ni vista las usa.

**La FK es compuesta, no simple** como decía el diseño previo: garantiza que la
unidad pertenece **al mismo país** que la clínica. Usa `MATCH SIMPLE`, que no
verifica nada si alguna columna es NULL; por eso el `CHECK` estructural es
**obligatorio y permanente**: si hay unidad, hay país, y entonces la FK sí
comprueba el par.

**🔒 La guarda temporal.** Un precheck read-only midió que `anon` y
`authenticated` tienen `SELECT`, `INSERT` y `UPDATE` **de tabla** sobre `clinics`
(`relacl arwdDxtm`, sin grants por columna), con RLS activa por
`owner_id = auth.uid()`. Las columnas nuevas **heredan** ese privilegio. Sin la
guarda, el propietario de una clínica podría poblarlas desde el cliente antes de
que exista el camino controlado. `clinics_geo_f3a_temp_null_chk` lo impide sea
cual sea el grant o la policy, y deja funcionando todo `INSERT`/`UPDATE` que omita
las columnas —el runtime entero—. **Permanece hasta F3B y solo se retira dentro de
la misma transición que habilite el dual-write controlado.** Lleva un
`COMMENT ON CONSTRAINT` que lo dice en la propia base. No es hardening general:
grants, RLS y policies **no se tocaron**. **Retirada por `s7_92`**, en la misma
transacción que instaló y verificó la sincronización (siguiente bloque).

### ✅ IMPLEMENTADO — F3B paso 3 (`s7_92`, migración 113)

```
public._territory_from_legacy_sv(p_department_id text, p_municipality_id text,
                                 OUT country_id smallint, OUT territory_unit_id bigint)
  plpgsql · STABLE · SECURITY INVOKER · SET search_path = public, pg_temp
  NULL, NULL        -> NULL | NULL
  dept, NULL        -> SV | unidad nivel 1 (legacy_id = dept)
  dept, muni        -> SV | unidad nivel 3 (legacy_id = muni, abuelo nivel 1 = dept)
  NULL, muni        -> P0024      dept inexistente     -> P0026
  muni incoherente  -> P0025      puente ausente       -> P0180     nunca nivel 2

public._clinics_territory_sync()                 -- única SECURITY DEFINER, sin SQL dinámico
  UPDATE sin cambios en las 4 columnas -> RETURN NEW (sin backfill)
  r := resolver(NEW.department_id, NEW.municipality_id)
  intento = no NULL en INSERT | distinto de OLD en UPDATE
  intento distinto de r -> P0183
  NEW.country_id, NEW.territory_unit_id := r        -- siempre

trg_clinics_territory_sync  BEFORE INSERT OR UPDATE OF
  department_id, municipality_id, country_id, territory_unit_id  ON public.clinics
  FOR EACH ROW  · trigger normal (tgenabled = O), sin ENABLE ALWAYS

REVOKE ALL de ambas funciones a PUBLIC, anon, authenticated, service_role
```

- **El legacy es la única autoridad de escritura.** Las columnas nuevas son una
  proyección: el cliente puede enviarlas, pero solo prosperan con el valor
  derivado. Esto sustituye a la guarda de F3A.
- **Primer consumidor del catálogo**, y solo al escribir `clinics`. La función del
  trigger es `SECURITY DEFINER` porque quien escribe `clinics` (`authenticated`,
  `service_role`) no tiene ni debe tener `SELECT` sobre `administrative_units` /
  `countries`. El resolver es INVOKER y no lo ejecuta ningún rol cliente.
- **Sin backfill:** tras aplicar, 118 clínicas y 0 con geo. Las filas se proyectan
  cuando se reescribe su ubicación legacy; el backfill explícito es F3C.

### ✅ IMPLEMENTADO — F3C (`s7_93`, migración 114): estado de los datos

Sin objetos nuevos. Tras el backfill, en producción:

| Clínicas | Legacy | Geo |
|---|---|---|
| 96 | sin ubicación | NULL (C5: sin inferencias ni decisión de país) |
| 23 | departamento + municipio coherentes | SV + unidad de **nivel 3** de su municipio, igual al resolver |
| 0 | solo departamento · incoherentes | — |

**Invariante vigente:** toda clínica cumple `geo = _territory_from_legacy_sv(legacy)`,
con 0 divergencias medidas en la tabla completa. Las nuevas escrituras lo mantienen
por el trigger de `s7_92`.

### ✅ IMPLEMENTADO — F3D (`s7_94`, migración 115): cierre territorial

Sustituye al diseño previo `administrative_unit_paths (ancestor_id, unit_id, depth)`,
que **no se implementó**. Variante **N1** aprobada por el owner.

```
administrative_units  (+1 índice, ninguna columna ni fila se toca)
  UNIQUE INDEX au_id_country_level_key (id, country_id, level)   -- destino de las FK con nivel

administrative_unit_closure                             -- cierre transitivo DERIVADO
  country_id         smallint NOT NULL
  ancestor_unit_id   bigint   NOT NULL
  ancestor_level     smallint NOT NULL
  descendant_unit_id bigint   NOT NULL
  descendant_level   smallint NOT NULL
  depth              smallint NOT NULL
  PK (ancestor_unit_id, descendant_unit_id)                      -- «descendientes de X»
  FK (ancestor_unit_id, country_id, ancestor_level)     -> administrative_units (id, country_id, level)
  FK (descendant_unit_id, country_id, descendant_level) -> administrative_units (id, country_id, level)
  CHECK depth >= 0 AND depth = descendant_level - ancestor_level
  CHECK (depth = 0) = (ancestor_unit_id = descendant_unit_id)    -- fila propia
  INDEX (descendant_unit_id, ancestor_level) INCLUDE (ancestor_unit_id)   -- «ancestro de nivel L de Y»

  RLS habilitada · 0 policies · REVOKE ALL a PUBLIC, anon, authenticated, service_role
```

- **Filas propias:** filtrar por una hoja, o por una unidad a la que apunten clínicas
  directamente, es la misma consulta de un join. Con el árbol de SV: **888 filas** =
  320 (depth 0) + 306 + 262.
- **Mismo país y niveles reales por construcción:** cada fila lleva un único
  `country_id` y ambas FK lo incluyen junto al nivel. Un nivel falso o un `depth`
  incoherente son imposibles, no solo detectables.
- **Por qué los niveles (N1 frente a N0 de 3 columnas):** medido en el arnés a escala
  sintética, N0 cae en una trampa de estimación en agregados por territorio
  (1,6 s frente a 0,37 s recursivo); con `ancestor_level` el planificador acierta
  (0,31 s), y el ancestro de nivel L por fila baja de 1,6 s a 0,62 s.
- **Por qué un índice único y no `ADD CONSTRAINT UNIQUE`:** medido, el constraint toma
  `AccessExclusiveLock` sobre `administrative_units` y bloquearía las lecturas del
  trigger de `s7_92`; el índice toma `ShareLock` y la FK apunta igual a él
  (`conindid`). Condición estática: único, no parcial y exactamente sobre
  `(id, country_id, level)`, las columnas que referencian las FK.
- **Solo estructura:** sin funciones, triggers, RPC ni grants. Medido: **una función
  persistida que nombre el catálogo haría abortar los rollbacks de `s7_93` y `s7_92`**.
- **Límite:** ninguna constraint impide una fila válida pero falsa (otro subárbol con
  país y niveles correctos) ni un reparent del catálogo sin reconstruir. Lo detecta la
  verificación de deriva (§7).

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

✅ **Resuelto el 2026-09-13 con M2 (`s7_90`, §10.d).** Con el precheck de nuevo en
0, la fila legacy se renombró a «San Miguel de Mercedes». Legacy y catálogo nuevo
coinciden ya para `CH-16`, y el puente dejó de cambiar de entidad.

El cero cubre los **datos referenciales vivos**, no menciones históricas en
payloads de `audit_log`. Ese es el alcance correcto: `audit_log` registra lo que
pasó, y reinterpretar `CH-16` no reescribe una traza.

### 6.4 · ✅ PRECONDICIÓN DE FUNDACIÓN 3 — CUMPLIDA (2026-09-13)

> **Cumplida por `s7_90`.** El owner repitió este precheck antes de F3B (**0
> referencias sobre 3 columnas**), y `s7_90` lo repitió **dentro** de su
> transacción con la fila bloqueada `FOR UPDATE` antes de renombrar. Tras M2,
> `CH-16` significa San Miguel de Mercedes **también en el legacy**: una referencia
> nueva ya es correcta y no hay que bloquear el mapeo por ella. La consulta se
> conserva como registro de la medición. El texto siguiente describe la
> precondición tal como se definió.

**F3B debe COMENZAR repitiendo este precheck dinámico**, inmediatamente antes de
cualquier backfill o mapeo de referencias. F3A no mapeó nada y no lo necesitó.

**Mitigación decidida por el owner: M2** (no M1). Si el precheck **continúa con 0
referencias**, corregir de forma **atómica solo la fila legacy** `CH-16`:
`Cancasque` → `San Miguel de Mercedes`, conservando id, departamento y agrupador.
**M2 solo procede con 0 referencias; si aparece cualquiera, STOP y reportar.** No
se ofrece una opción seleccionable que después falle con error cuando el dato de
origen puede corregirse con seguridad.

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

✅ **Estructura IMPLEMENTADA (`s7_94`); consultas 📐 DISEÑADAS para F3E, sin lectores.**

La estrategia es **un puntero por clínica más un cierre transitivo
materializado**. `administrative_unit_closure` contiene, para cada unidad, todos
sus ancestros incluida ella misma: **888 filas** para El Salvador.

```sql
-- médicos por unidad territorial, a CUALQUIER nivel
SELECT d.*
  FROM doctors d
  JOIN clinics c ON c.id = d.clinic_id
  JOIN administrative_unit_closure k ON k.descendant_unit_id = c.territory_unit_id
 WHERE c.country_id = $country
   AND k.ancestor_unit_id = $unit;
```

**Medido en producción (PG 17.6)** con `docs/smokes/s7_94_territorial_plan_readonly.sql`:
sin `Recursive Union` ni `CTE Scan`; `clinics_country_id_idx`, `idx_doctors_clinic` e
Index Only Scan de `administrative_unit_closure_pkey`.

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

### Mantenimiento del cierre, sin trigger ni función persistida

✅ **Vigente desde `s7_94`.** No hay función de rebuild persistida (invalidaría los
rollbacks de `s7_93` y `s7_92`). La recursión ocurre **al cargar el catálogo**, nunca al
consultar:

- **Regla D8:** toda migración que modifique `administrative_units` (una alta, un
  reparent, la carga de otro país) mantiene o reconstruye el cierre **en la misma
  transacción** y lo verifica con z = 0.
- **Verificación versionada y reutilizable:**
  `docs/smokes/s7_94_closure_drift_readonly.sql` compara el cierre almacenado con uno
  recalculado desde el árbol vivo (faltan + sobran + ciclos = z). Genérica, no depende
  de SV. Validada con A/B: detecta reparent sin reconstruir, unidad nueva sin cierre,
  fila falsa que pasa las FK y fila borrada; renombrar o inactivar no es deriva.
- **Inactivar o renombrar** no toca el cierre: `is_active` se filtra en los selectores.
  **Borrar** una unidad con cierre falla por FK: se retira con `is_active`.
- **Cambiar el `level`** de una unidad sin reconstruir falla por las FK con nivel.

Un trigger o RPC de mantenimiento no es indispensable **mientras no exista camino de
escritura**: el DML está revocado a los cuatro roles. Pasaría a serlo con
`GEO-CATALOG-ADMIN/P1`, y entonces habría que reevaluar los rollbacks.

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
| **F3D** | cierre territorial `administrative_unit_closure` (N1, 888 filas) + índice único del catálogo + verificación de deriva versionada | ✅ **APPLIED / VERIFIED** — PR #375, `s7_94` |
| **F3A** | `clinics.country_id` y `territory_unit_id`: nullable, sin datos, con integridad y **guarda temporal NULL** | ✅ **CLOSED / APPLIED / VERIFIED** — PR #368, `s7_89` |
| **F3B · 1** | precheck de `CH-16` + **M2**: corregir el nombre legacy | ✅ **APPLIED / VERIFIED / CLOSED** — PR #369, `s7_90` |
| **F3B · 2** | `s7_91`: emparejar departamento y municipio en `admin_approve_and_create_doctor` | ✅ **APPLIED / VERIFIED / CLOSED** — PR #370, `s7_91` |
| **F3B · 3** | `s7_92`: resolver + trigger de sincronización + retiro de la guarda F3A **en la misma transacción** | ✅ **APPLIED / VERIFIED** — PR #372, `s7_92` |
| **F3C** | backfill histórico de `country_id` / `territory_unit_id` (23 clínicas con legacy; sin teléfonos ni heurísticos) | ✅ **APPLIED / VERIFIED** — PR #374, `s7_93` |
| **F3E–F3F** | resto de F3: lectura por el modelo nuevo y endurecimiento | 📐 diseñadas, **NOT STARTED** |

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

## 10.c · Evidencia de cierre de Fundación 3A

`s7_89` = **APPLIED / VERIFIED / NO REAPLICAR**, aplicada por el owner el
2026-09-13 **antes** del merge de #368, que la incorpora como registro versionado.

**Dos prechecks read-only antes de aplicar.**

1. **Privilegios efectivos de `clinics`.** `anon` y `authenticated` con
   `SELECT`/`INSERT`/`UPDATE` de **tabla**, heredados también por
   `department_id`; `relacl` `arwdDxtm` para `anon`, `authenticated` y
   `service_role`; 0 grants por columna; RLS activa y no forzada; 4 policies
   (`clinics_insert` y `clinics_update` por `owner_id = auth.uid()`,
   `clinics_public_read` y `clinics_select`); 1 trigger (`trg_clinics_updated_at`,
   que no serializa la fila); 0 publicaciones. Veredicto **STOP**, resuelto **sin
   cambiar grants ni RLS**, con la guarda temporal.
2. **Lectores comodín de `clinics`** —consumidores que recibirían las columnas
   nuevas sin pedirlas—. En la app, 0: los 5 lectores nombran columnas. En la
   base, 0 funciones de tipo `clinics`. Un patrón **grueso** marcó 5 cuerpos y 1
   vista; confrontados con sus **definiciones vivas**, los 6 resultaron falsos
   positivos: `SELECT *` sobre otras tablas, un comentario, y `alias.*` sobre CTE
   de columnas explícitas de `patients`. Cuatro cuerpos coincidieron byte a byte
   con el repositorio en CRLF; el quinto es el mismo cuerpo sin 3 líneas de
   comentario.

**Reconciliación del archivo aplicado:** el PASO 1 fue L88–L156 y el PASO 2
L162–L385 del commit `1b29e9b`, sin cambios posteriores; SHA-256 del blob
`004d051db35086b431dd4db6f8e10e50d66b32b9c74163042c06b380fcbd17a7`.

**Verificación read-only en la base: 28/28 PASS, veredicto 0 FAIL.**

| Control | Resultado |
|---|---|
| Columnas | `smallint` / `bigint`, nullable, sin default · **0 clínicas con valores** |
| FK individual y compuesta | definición exacta · validadas · `MATCH SIMPLE` |
| `CHECK` estructural | definición exacta · validado |
| Guarda temporal | definición exacta · **validada** · marcada `TEMPORAL DE FUNDACION 3A` · 4 constraints sobre las columnas nuevas, exactamente los previstos |
| Índices | `btree` · válidos |
| `doctor_booking_ready` | 1 definición · **cuerpo idéntico a `s7_85` por md5** · `STABLE`, `SECURITY DEFINER`, `EXECUTE` de `anon` |
| Legacy | 2 columnas · 14 departamentos · 262 municipios · 7 FK NO ACTION |
| Catálogo | 1 país · 3 niveles · 320 unidades |
| `clinics` | `relacl`, RLS, 4 policies y trigger **idénticos al precheck** |
| Consumidores | 0 funciones mencionan las columnas nuevas · 0 vistas dependen de ellas |
| Residuos del intento fallido del PASO 1 | ninguno |

**Smoke de producción tras el `COMMIT`**, con query string único: `sitemap.xml`
con 46 `<loc>` y 45 médicos, por la ruta de éxito que lee `clinics!inner(...)`, y
el perfil del médico demo con `addressLocality` resuelto. Vercel no expone la
cabecera de caché, así que «fresco» es muy probable, no demostrado.

**Validación estática:** `check-s7_89` **186/186**. **A/B del instrumento:** el
mismo check contra la versión sin guarda da **160/186**, y los 26 FAIL son
exactamente las aserciones de la guarda y sus mutaciones. Regresiones:
`check-s7_88` 123/123, `check-s7_87` 126/126 (reanclado a su propio DDL),
`check-s7_85` 98/98, `check-s7_86` 54/54, `check-admin-doctor-csv` 75/75,
`check-directory-booking-ready` 20/20. `tsc -b` 427 vs 427, `build` y
`git diff --check` PASS.

**Incidente de aplicación, sin efecto.** El primer PASO 1 se ejecutó desde la
línea 1 y falló con `42P01 relation "v_n" does not exist`: el comentario de la
línea 83 contiene `` `DO $PRE$` `` y el SQL Editor lo tomó como apertura de bloque.
Pegado como bloque autónomo en una pestaña nueva, el mismo PRE dio `Success`. De
ahí salen dos reglas vinculantes (§11).

⚠️ **`s7_89` no se modifica** tras aplicarse, incluido ese comentario de L83.

## 10.d · Evidencia de cierre de F3B paso 1 (`s7_90`, M2 de `CH-16`)

`s7_90` = **APPLIED / VERIFIED / CLOSED / NO REAPLICAR**, aplicada por el owner el
2026-09-13 **antes** del merge de #369. **Es una corrección de dato visible, no un
cambio de UI ni de código.**

**Qué cambió:** solo `municipalities.name` de `CH-16`, de «Cancasque» a «San Miguel
de Mercedes». Id, `department_id = 'CH'` y `district = 'Chalatenango Sur'` intactos.

**Preflight read-only antes de aplicar:**
- **`CH-16`:** 0 referencias sobre 3 columnas (`clinics`, `doctor_affiliation_requests`, `profiles`).
- **Clínicas:** 118 — 23 con ubicación y todas coherentes, 95 sin ubicación.
- **Solicitudes de afiliación incoherentes:** 0.
- **Puente legacy → catálogo nuevo:** total, sin huérfanos ni ids solapados.
- **Escritores de `clinics`:** solo los 3 versionados.
- **Estado F3A:** intacto.

**Diseño de la migración:**
- **PRE fuera de la transacción:** exige el valor previo exacto, 1 «Cancasque» y 0 «San Miguel de Mercedes», legacy 14 / 262 / 7 FK, 320 unidades, que el catálogo nuevo ya diga San Miguel de Mercedes bajo Chalatenango Sur / `CH`, y 0 referencias.
- **Guarda dentro de la transacción:** **bloquea `CH-16` con `FOR UPDATE` antes de recontar**. Toda escritura que quiera referenciarla necesita `FOR KEY SHARE` y espera al commit, así que recuento y cambio son atómicos.
- **`UPDATE`:** lleva el valor previo exacto en el `WHERE`.
- **POST:** compara contra huellas md5 locales a la transacción (las otras 261 filas, `departments`, `administrative_units`) y exige 14 / 44 / 262, 0 referencias y la guarda F3A en pie.
- **Descubrimiento de referencias:** idéntico en PRE, guarda, POST y rollback.
- **Nombres:** comparación **exacta**, porque existe un distrito distinto llamado «San José Cancasque».

**Verificación read-only posterior: 17/17 PASS, veredicto Z = 0.** Incluye la
simulación exacta del selector legacy de Chalatenango: ofrece San Miguel de
Mercedes y no Cancasque.

**QA visual en producción: PASS.** En el formulario público «Soy médico», el
selector de Chalatenango muestra San Miguel de Mercedes, ya no muestra Cancasque y
mantiene San José Cancasque como distrito distinto.

**Reconciliación del archivo:** aplicado desde el commit `faa540b`, sin cambios
posteriores. SHA-256 del blob
`3eb229c7596a4308ebc319ba5e85240639de3442f946bcfe04561316f4fb77b9`, confirmado
también en el archivo servido por GitHub en el head del PR. Bloques autónomos
PASO 1 (L53–L150) y PASO 2 (L156–L353) extraídos byte a byte.

**Validación estática:**
- `check-s7_90` **126/126**, con 11 mutaciones invertidas.
- A/B contra una migración sin `FOR UPDATE` y tolerante a referencias: **117/126**, con los 9 FAIL exactamente en esas reglas.
- Regresiones: `check-s7_89` 186, `check-s7_88` 123, `check-s7_87` 126, `check-s7_85` 98, `check-s7_86` 54, `check-directory-booking-ready` 20, `check-admin-doctor-csv` 75.

⚠️ **`s7_90` no se modifica** tras aplicarse.

## 10.e · Evidencia de cierre de F3B paso 2 (`s7_91`, ubicación emparejada)

`s7_91` = **APPLIED / VERIFIED / CLOSED / NO REAPLICAR**, aplicada por el owner el
2026-09-13 **antes** del merge de #370. **Es un cambio funcional de backend,
acotado a la ubicación en `admin_approve_and_create_doctor`**: por decisión del
owner, el merge `6a0173f` **fue el HEAD funcional** hasta #372 (`ecd6366`). Sin UI, sin cambios en
`src/` ni en tipos, sin DDL de tablas.

**Estado medido antes:** la definición vigente era la de `s7_64`, y el md5 del
cuerpo vivo (`73ffe4972c87e3ca580a8e40778d1328`) coincidía byte a byte con
`s7_64` en CRLF (medición del precheck de F3A).

**El cambio:** cuerpo **verbatim de `s7_64` más tres hunks** marcados `(s7_91)`:
1. dos variables con el override territorial crudo;
2. **resolución emparejada**, que sustituye las dos líneas `COALESCE`;
3. **validación del par final** (`P0024` / `P0025`), después de 42501, P0001–P0005 y
   P0010–P0013 y antes de `UPDATE profiles` / `INSERT`.

Firma, retorno, `SECURITY DEFINER`, `search_path`, dueño y privilegios intactos, sin
`GRANT`. Semántica e interpretaciones en §11 (D2).

**Guardas de aplicación:**
- el PRE y la guarda exigieron el cuerpo vivo de `s7_64` por md5;
- el POST exigió el cuerpo de `s7_91` (md5 LF `a249f92a…` / CRLF `d36698a9…`), ACL y
  dueño idénticos, **ninguna otra función de `public` cambiada**, guarda F3A en pie y
  ningún trigger nuevo en `clinics`.

**Verificación read-only posterior: 16/16 PASS, Z = 0.**
- **Función:** cuerpo vivo = `s7_91`; firma, definer, `search_path` y privilegios intactos.
- **Semántica:** sin fallback independiente del municipio, emparejamiento presente,
  validación relacional presente, `P0024` / `P0025` presentes.
- **Fuera de alcance:** F3A intacta, 0 valores nuevos en `clinics`, `CH-16` intacto,
  ninguna función de `s7_92`.

**A/B:**
- **Estructural (`check-s7_91` 114/114):** quitando los tres hunks, la definición es
  **byte a byte** la de `s7_64`, con 11 mutaciones invertidas.
- **Conductual: PREPARADO, NO ACREDITADO.** `docs/smokes/s7_91_ab_smoke.sql`, de solo
  lectura, ejecuta los fragmentos reales de `s7_64` y de `s7_91`, verbatim, sobre 14
  casos, y pasa solo si el actual produce 7 pares incoherentes y el corregido 0. **No
  hay evidencia explícita de su ejecución en la base, así que no se registra como
  PASS.** El cierre se apoya en el A/B estructural (114/114) y en la verificación
  post-aplicación (16/16 PASS, Z = 0).

**Reconciliación del archivo:** aplicado desde el commit `20d33f4`; SHA-256 del blob
`cbaf5676b20b0aa8b9cb062f92e3b7e1c9f3d1a1e53ca93e61123402541ffaab`, confirmado
también en el archivo servido por GitHub en el head del PR. Bloques autónomos PASO 1
(L56–L112) y PASO 2 (L118–L518) extraídos byte a byte.

**Fuera de la migración:** `check-s7_89` se reancló para admitir la redefinición en
`s7_91`. Sigue exigiendo, sobre la última definición, que ningún escritor use las
columnas nuevas; sin `s7_91` falla solo la aserción de control nueva. **187/187.**

⚠️ **`s7_91` no se modifica** tras aplicarse.

---

## 10.f · Evidencia de cierre de F3B paso 3 (`s7_92`, sincronización central)

`s7_92` = **CLOSED / APPLIED / VERIFIED / NO REAPLICAR**, aplicada por el owner el
2026-09-13 **antes** del merge de #372. Cambia comportamiento de backend **solo en
las escrituras sobre `clinics`**, sin UI ni `src/`. **Por decisión del owner, el
merge `ecd6366` es el HEAD funcional vigente** (antes `6a0173f`).

**Preflight read-only A–H: PASS, Z = 0.**
- 118 clínicas (95 sin ubicación + 23 con ubicación), 0 incoherentes, 0 con geo;
- puente 14 / 262 completo, 0 unidades de nivel 2 con `legacy_id`;
- solo `trg_clinics_updated_at`, sin reglas; guarda y CHECK estructural validados;
- ACL, RLS y policies registradas; catálogo sin privilegios de cliente;
- escritores de `clinics` = los 3 conocidos, aprobación = `s7_91`, `CH-16` corregido;
- nombres y códigos `P0026` / `P0180` / `P0183` libres;
- `postgres` dueño, `bypassrls` y miembro de `authenticated`;
- privilegios por defecto que conceden `EXECUTE` a los roles cliente (de ahí el `REVOKE` obligatorio);
- **H:** `anon`, `authenticated` y `PUBLIC` sin `CREATE` en `public`.

**Transacción** (bloques autónomos PASO 1 L66–L177 y PASO 2 L183–L785, blob
`d16360be86e4a3bd63bf98d1f2939eeba54133cc834ef4fa91991a7573c020e9`):
- `lock_timeout = 5s`;
- pruebas del resolver: 14 + 262, errores exactos, privilegio `EXECUTE` en falso y negativos bajo `SET LOCAL ROLE authenticated`;
- sonda `public._s7_92_probe` con el mismo trigger y 41 casos (INSERT, UPDATE, upsert, 4 bajo `authenticated`), borrada antes del lock;
- `LOCK clinics`, GUARDA con huellas, trigger, retiro de la guarda y POST.

**Verificación post en producción: 24 PASS · 4 informativas · Z = 0.**
- **Trigger:** `tgtype = 23`, `tgenabled = O`, exactamente las 4 columnas, solo 2 triggers de usuario.
- **Funciones:** resolver INVOKER / `STABLE`, trigger DEFINER, ambos con `search_path = public, pg_temp`, dueño `postgres` y 0 `EXECUTE` de clientes o `PUBLIC`.
- **Guarda y estructura:** guarda ausente, CHECK + 2 FK validadas, sonda ausente.
- **Datos:** 118 clínicas, 0 con geo, 0 divergencias con lo que deriva su legacy.
- **Seguridad:** ACL, RLS y policies iguales al preflight; catálogo sin privilegios de cliente.
- **Resolver:** 262 → nivel 3, 14 → nivel 1, sin ubicación → NULL, CH-16 → SV.
- **Resto:** `s7_91` y `doctor_booking_ready` intactas.
- **md5 vivos** del resolver (`bdb0723c0257b31fe1aaa2bfc609dd6c`) y del trigger (`0cecd35ba759d9fbc84b1f98a82a0202`): exactamente los md5 CRLF de los cuerpos del artefacto de #372.

**Pruebas previas (no son producción):**
- **Estático:** `check-s7_92` 251/251, con 31 mutaciones invertidas y un modelo JS independiente de los 41 casos. `check-s7_89` (189/189) y `check-s7_91` (116/116), reanclados con allowlists cerradas.
- **Arnés local desechable** (PostgreSQL 18 con roles y privilegios que simulan lo medido):
  - cadena real `s7_87` → `s7_91`; preflight igual a producción salvo los 2 escritores no replicados;
  - comportamiento sobre `clinics` como `authenticated` con RLS 10/10, con control A/B;
  - 18 mutaciones ejecutadas, todas abortan dejando F3A;
  - rollback: se niega con consumidores (E5), revierte con `updated_at` intacto y `s7_92` se reaplica;
  - `lock_timeout`: aborta a los 5 s sin cambios.
  - Las mutaciones destaparon que el negativo conductual de `EXECUTE` del resolver **no discriminaba**: el INVOKER da 42501 igual al leer el catálogo. Se añadió la aserción directa de `has_function_privilege` antes de aplicar.
- **Rendimiento:** ventana con lock ~40 ms y transacción ~245 ms. Es **referencia del entorno desechable, NO SLA de producción**.

### ⚠️ Incidente post-COMMIT del SQL Editor (`42P01`)

Al terminar el PASO 2, el SQL Editor mostró
`ERROR: 42P01: relation "public._s7_92_probe" does not exist`. **No fue un fallo de
la migración.**

| Evidencia | Resultado |
|---|---|
| Bloque read-only de estado | `S7_92 APLICADA COMPLETA`: guarda retirada, trigger y funciones instalados, sonda ausente, 0 geo, sin sesiones abortadas ni locks |
| Verificación post | 24 PASS, Z = 0 |
| `pg_stat_statements` (C2) | cada sentencia de `s7_92` completada **una vez**, del PRE al POST, **`DROP` de la sonda incluido** |
| Event triggers vivos (B) | ninguno resuelve relaciones por nombre: `pgrst_*` hacen `NOTIFY`, `graphql_watch_*` incrementan la versión y los `issue_*` solo actúan sobre extensiones |
| Lógica de la transacción | un error antes del `COMMIT` habría abortado todo y la base seguiría en F3A |

**H2 (event trigger de la plataforma) descartada.** El error vino de fuera de la
transacción, y el A/B en el propio editor identificó el disparador:

| Bloque enviado al editor (solo lectura) | Resultado |
|---|---|
| **C** · consulta sobre `pg_stat_statements` con literales de regex `CREATE TABLE public._s7_92_probe`, `ALTER/DROP TABLE …`, `INSERT INTO …` | **`42P01` sobre `public._s7_92_probe`**, sin referenciar la tabla |
| **C2** · la misma consulta con esos patrones ensamblados en ejecución | **PASS**, mismas filas que C (verificado en el arnés) |
| **T1** · `SELECT 'public._zz_editor_probe_t1'` | **PASS** |
| **T2** · `SELECT 'CREATE TABLE public._zz_editor_probe_t2 (id int)'` | **`42P01` sobre `public._zz_editor_probe_t2`** |
| Bloques A y POST (el nombre sin esquema, sin forma de DDL) | sin error |
| `s7_87` (`CREATE TABLE public.countries …`, tablas que siguen existiendo) | sin error |

**Causa, demostrada experimentalmente:** en Supabase SQL Editor / Studio, el texto
con forma de `CREATE TABLE <nombre>` **puede disparar un `42P01` sobre esa relación
incluso cuando aparece dentro de un literal**. Ocurre si la relación no existe al
terminar, como la sonda, creada y borrada en la misma ejecución, y aunque el servidor
haya completado todo. **No se afirma cuál es la consulta interna que genera Studio**:
no se capturó su `STATEMENT`.

**Límites:**
- **Sentencia literal no capturada:** la consulta interna de Studio no quedó registrada. `pg_stat_statements` no registra sentencias fallidas y no se obtuvo el log de Postgres. El disparador está demostrado por T2 y el par C/C2.
- **Forma demostrada:** `CREATE TABLE`. `ALTER TABLE`, `DROP TABLE` e `INSERT INTO` no se aislaron.
- **Qué hace esa consulta:** se desconoce. Solo consta que falla sobre relaciones inexistentes, y las pruebas se hicieron con nombres inexistentes.

**Reglas que se derivan** (§11): no enviar texto con forma de DDL sobre objetos que
no existirán, y no inferir el estado de una transacción a partir del error del
editor. **`s7_92` no requiere cambios.**

**Fuera de la migración:** `check-s7_89` y `check-s7_91` se reanclaron para admitir
exactamente las dos funciones de `s7_92` y la reutilización de `P0024` / `P0025` con
los mensajes de `s7_91`.

⚠️ **`s7_92` no se modifica** tras aplicarse.

---

## 10.g · Evidencia de cierre de F3C (`s7_93`, backfill histórico)

`s7_93` = **CLOSED / APPLIED / VERIFIED / NO REAPLICAR**, aplicada por el owner el 2026-09-14
**antes** del merge de #374. **Backfill de datos sin consumidores: no mueve el HEAD
funcional** (`ecd6366`).

**Preflight v2 de producción: Z = 0.**

| Medida | Valor |
|---|---|
| Clínicas | 119 = 96 sin ubicación + 0 solo departamento + 23 coherentes + 0 incoherentes |
| Geo previa | 0 ya derivadas, 0 divergencias, 0 anomalías |
| Pendientes | 23, todas de nivel 3 |
| Puente | completo |
| Estructura | triggers en `O`, funciones de `s7_92` intactas |
| Seguridad | ACL, RLS y policies (md5 `20ad37b9…`) |
| Consumidores y publicaciones | 0 · `clinics` en ninguna publicación |

- **`trg_clinics_updated_at`:** usa `update_updated_at()`, compartida con 6 tablas; por eso no se tocó la función.
- **Huella C2:** `63a5e35b49e91f904df565b2d1717475`.
- **Lista C39.5:** 23 entradas `id|department_id|municipality_id`.

**Decisiones del owner (C1–C6):** conservar `updated_at` desactivando solo
`trg_clinics_updated_at` · huella bloqueante sobre los cinco campos relevantes
(los cambios ajenos a geografía no abortan) · rollback **R2 exacto** · STOP ante
incoherencias o divergencias · las 96 sin ubicación sin geo · una sola transacción.

**Transacción** (blob `df00323bd5d09e827f45b8fe4057624fe2dcebac9a40511393cb4ab0454d7593`;
PASO 1 L56–L150 `e5c5871e…`, PASO 2 L156–L367 `a70b872f…`):

1. `lock_timeout 5s` y `LOCK SHARE ROW EXCLUSIVE`, que bloquea escrituras y no lecturas;
2. GUARDA con huella y lista exactas;
3. `DISABLE TRIGGER trg_clinics_updated_at`;
4. un único `UPDATE` sobre esos ids con su legacy listado y geo NULL, valores del resolver vivo y exactamente 23 filas;
5. `ENABLE`;
6. POST;
7. `COMMIT`.

**Verificación post en producción: 19 PASS · 2 informativas · Z = 0.**
- **Triggers:** ambos en `O`.
- **Recuentos:** 119 / 96 sin ubicación y sin geo / 0 sin ubicación con geo / 0 pendientes.
- **Las 23:** legacy intacto, SV, nivel 3 de su municipio e iguales al resolver; 0 geo fuera de la lista.
- **Toda la tabla:** 0 divergencias, 0 de nivel 2.
- **`updated_at`:** 0 de las 23 con `updated_at` posterior al preflight.
- **Estructura y seguridad:** guarda F3A ausente; CHECK y 2 FK; relacl; RLS y policies; catálogo sin privilegios de cliente.
- **Funciones:** `s7_92`, `s7_91` y `s7_85` intactas.
- **Informativas:** huella C2 tras el backfill `7c823ad1f5c30fc7a2b5a33fe62c68a7`; md5 de policies `20ad37b9…`, igual al preflight.

**Pruebas previas (no son producción):**
- **Estático:** `check-s7_93` 133/133, con 30 mutaciones invertidas.
- **Arnés local desechable: 43/43.** Cadena real `s7_87` → `s7_92` con las 23 clínicas de ids y legacy reales; bloques como mensaje Query único.
  - aplicación, con verificación y bloque de estado;
  - STOP con la huella real de producción;
  - deriva C2: `name` no aborta, clínica nueva o cambio de municipio sí;
  - `lock_timeout` a 5 s;
  - rollback R2 byte a byte, bloqueante ante filas cambiadas o consumidores, conservando geo orgánica fuera de la lista;
  - 6 mutaciones ejecutadas.
  - La batería **encontró un defecto real del rollback antes del commit**: comparación de fila contra subconsulta de dos columnas, `42601`.
- **Tiempos del arnés:** LOCK → COMMIT ≈ 120 ms, referencia del entorno desechable, no SLA.

**Revisión informativa de las 12 clínicas `c0000001-…` (read-only):**
- **Existencia:** 12/12 existen y están activas.
- **Owners y médicos:** del rango seed `a0000001-…` de `s7_17`; perfiles inactivos con correo `@lucycare.test`; médicos `listed_only`, 0 operativos, 0 con agenda.
- **Publicado:** el médico de `…0009` figura `is_published = true`.
- **Uso:** 4 clínicas con 1 cita histórica y 1 ficha de paciente; 1 `clinic_member` por clínica.
- **Decisión del owner:** son fixtures históricos, **pero no se excluyen de F3C**. El formato de un id no tiene semántica de negocio y el invariante territorial aplica a toda clínica con legacy válido. Su limpieza es otro frente.

⚠️ **`s7_93` no se modifica** tras aplicarse.

---

## 10.h · Evidencia de F3D (`s7_94`, cierre territorial)

`s7_94` = **APPLIED / VERIFIED / NO REAPLICAR**, aplicada por el owner el 2026-09-15
**antes** del merge de #375. **Estructura derivada sin lectores: no mueve el HEAD
funcional** (`ecd6366`). Cierre formal del PR pendiente del OK del owner.

**Preflight de producción (2026-09-14): Z = 0.**

| Medida | Valor |
|---|---|
| Catálogo | 320 unidades SV = 14 / 44 / 262; 0 ciclos, huérfanas, cruces de país o saltos de nivel (dos recorridos independientes) |
| Cierre esperado | **888** filas con filas propias; depth 0 = 320, 1 = 306, 2 = 262; huella `af230f5086d871b1cce24e34de4b6cec` |
| Huella del catálogo | `460e807050a0da8bea0891965b1b9fd7` (`id\|country_id\|parent_id\|level\|is_active`) |
| Nombres | `administrative_unit_closure*`, `auc_*` y `au_id_country_level_key` libres |
| Seguridad | catálogo sin privilegios de cliente; DEFAULT PRIVILEGES de `public` con ALL para `anon`/`authenticated`/`service_role` sobre tablas nuevas → `REVOKE` bloqueante |
| Consumidores | solo las dos funciones de `s7_92`; 0 vistas, triggers, policies o publicaciones |
| Contexto F3E | 46 médicos publicados = 9 con clínica con país + 37 con clínica sin país |
| B1 | el filtro solo por país usa `clinics.country_id`, sin catálogo ni recursión |

**Artefacto preservado antes de aplicar:** PR #375, commit `839453b`, migración
SHA-256 `802753898b854f6ab493f50cce5560c3f0eb759a132b6242d218b9449b10d933`. PASO 1, PASO
2, ESTADO, VERIFICACIÓN, DERIVA, PLAN y rollback recalculados desde el blob remoto e
idénticos byte a byte a los bloques ejecutados.

**Verificación en producción (PostgreSQL 17.6):**
- **ESTADO:** `S7_94 APLICADA COMPLETA`; 0 sesiones en transacción abortada; ningún lock de otras sesiones sobre el catálogo.
- **VERIFICACIÓN POST: Z = 0.**
  - **Forma:** columnas, dueño `postgres`, 5 constraints, las 2 FK sobre `au_id_country_level_key` (`aas`, validadas, no diferibles), 3 índices con su forma exacta.
  - **Contenido:** 888 filas, reparto 320/306/262, huella `af230f50…`, filas propias = unidades, 0 filas con país o nivel distintos, deriva 0, ciclos 0; 224 kB.
  - **Seguridad:** relacl `{postgres=arwdDxtm/postgres}`, RLS activa sin `FORCE`, 0 privilegios de tabla o columna para clientes, 0 policies, 0 triggers, 0 publicaciones; catálogo sigue cerrado.
  - **Nada más cambió:** huella del catálogo `460e8070…`; huella C2 de `clinics` `7c823ad1…` (la de `s7_93`); triggers de `clinics` en `O`; funciones de `s7_92` intactas; 0 funciones que nombren el cierre.
  - **Rollbacks:** 0 funciones o vistas que invaliden los de `s7_93`/`s7_92`; los únicos dependientes del índice único son las 2 FK del cierre.
- **DERIVA:** 320 unidades; 888 almacenadas = 888 esperadas; faltan 0, sobran 0, ciclos 0; `SV=888`; **z = 0**.
- **PLAN territorial:** sin `Recursive Union` ni `CTE Scan`; `clinics_country_id_idx`, `idx_doctors_clinic` e Index Only Scan de `administrative_unit_closure_pkey`; 6 ms.
- Las salidas de los PASOS 1 y 2 no se archivaron; la aplicación queda acreditada por ESTADO y VERIFICACIÓN.

**PostgreSQL 17.6 acreditado por producción, no por el arnés.** El arnés local era
PostgreSQL 18; la revisión de compatibilidad previa dejó una construcción sin evidencia
en 17 (FK hacia un índice único, permitida por la documentación oficial de 17), que la
aplicación real confirmó.

**Pruebas previas (no son producción):**
- **Estático:** `check-s7_94` 205/205 con 51 mutaciones invertidas; dos debilidades del propio check (una regex de `UPDATE` que nunca casaba y una regla de rollback que no exigía el `RAISE`) se detectaron por las mutaciones y se corrigieron.
- **Arnés local desechable (PG18): 92/92.** Aplicación como mensaje único; no reaplicar; deriva previa del catálogo; `lock_timeout` con escritor concurrente; lectores y trigger de `s7_92` sin espera y sin `AccessExclusiveLock`; 10 mutaciones del PASO 2 abortan sin residuo; rollback y sus 8 negativas; cadena `s7_94 → s7_93 R2 → s7_92`; A/B de los bloques read-only.
- **`search_path`:** el PASO 1 no lo valida; con un `search_path` sin `public`, el POST del PASO 2 aborta sin residuo (medido con el PASO 2 del blob remoto).

**Lecciones de método:**
1. **Las columnas `"char"` del catálogo** (`tgenabled`, `contype`, `relkind`…) no se concatenan sin `::text`: la primera aplicación en el arnés abortó entera, sin residuo.
2. **La sonda también falla.** Siete FAIL de la primera batería eran del instrumento (una huella que incluía la tabla nueva, `min(uuid)` inexistente que nunca llegaba al POST, expectativas mal calculadas), y dos verificaciones intermedias usaron archivos que no existían. Se detectaron porque las aserciones exigían el mensaje o el archivo concreto.
3. **Medir el lock, no suponerlo:** la elección del índice único salió de `pg_locks`.

⚠️ **`s7_94`, su rollback y sus bloques read-only no se modifican** tras aplicarse.

---

## 11 · Deudas y decisiones registradas, ninguna abierta

- 🔓 **`clinics_geo_f3a_temp_null_chk` RETIRADA por `s7_92` (§10.f)** dentro de la
  misma transacción que instaló y verificó la sincronización, como exigía F3A. La
  protección frente a la escritura directa del cliente la da ahora el trigger (`P0183`).
- **Rollbacks de F3, en orden inverso y solo mientras F3E no exista** (confirmado por el
  owner): **rollback de `s7_94` → `s7_93` R2 → verificar estado → rollback de `s7_92`**.
  El rollback de `s7_92` no debe ejecutarse aisladamente. Tras F3E, todos se reevalúan.
  - **`s7_94`** (`docs/rollbacks/s7_94_rollback.sql`): retira el cierre y luego el
    índice único (`RESTRICT`, DDL ensamblado con `format()`). Se niega si `s7_94` no
    está completa, si el catálogo o el cierre cambiaron, o ante cualquier consumidor
    (funciones, vistas, policies, triggers, FK hacia el cierre, otros dependientes del
    índice, privilegios de cliente, publicaciones). Verifica antes del COMMIT que todo
    lo demás quedó idéntico.
  - **`s7_93` · R2** (`docs/rollbacks/s7_93_rollback.sql`): exclusivamente los 23 ids
    de C39.5. Aborta si alguna fila cambió después o si hay consumidores. Conserva
    `updated_at` y la geo de las clínicas fuera de la lista.
  - **`s7_92` (E5):** su validez era **solo antes de F3C/F3E**. **Con F3C aplicada ya
    no es válido por sí solo**, porque vaciaría también la geo del backfill; exige
    revertir antes `s7_93` con R2 y verificar con un bloque read-only que las 23
    volvieron a geo NULL. `docs/rollbacks/s7_92_rollback.sql` se niega si
    encuentra funciones o vistas que usen `country_id`, `territory_unit_id` o el
    catálogo.
- **Decisiones de F3D (owner, 2026-09-14/15):** variante **N1**; filas propias
  `depth = 0`; índice único `au_id_country_level_key` en lugar de `ADD CONSTRAINT
  UNIQUE`; solo estructura, sin funciones, triggers, RPC ni grants de cliente; RLS con
  0 policies y `REVOKE` explícito; el filtro solo por país sigue en `clinics.country_id`
  y el cierre solo entra con filtro territorial; **D8**: toda migración que escriba
  `administrative_units` mantiene y verifica el cierre en la misma transacción; F3D no
  mueve el HEAD funcional.
- **Tipos (owner, 2026-09-15):** `administrative_unit_closure` **no** se añade a
  `src/types/database.types.ts`. F3D es DB-only y sin consumidor runtime; queda para
  F3E / `TYPES-RECONCILIATION-P0`, sin abrir ese frente.
- **Pendiente para F3E, sin resolver:** 46 médicos publicados = **9 con clínica con país
  + 37 con clínica sin país** (preflight F3D). No bloquea F3D, pero **debe resolverse
  antes de activar un directorio filtrado por país**, sin inferir país (C5).
- **`search_path` en `s7_94` (H1):** cuatro comparaciones absolutas dependen de que
  `public` esté en el `search_path` (`::regclass::text`). El PASO 1 no lo valida; el
  POST del PASO 2 aborta sin residuo si falta. Cualquier bloque futuro con el mismo
  patrón hereda la condición.
- **Decisiones de implementación de `s7_93` (C1–C6, owner, 2026-09-14):** C1 conservar
  `updated_at` desactivando solo `trg_clinics_updated_at` · C2 huella bloqueante sobre
  `id|department_id|municipality_id|country_id|territory_unit_id`; si cambia, STOP y
  repetir preflight, sin regenerar constantes sin autorización · C3 rollback R2 exacto
  (R1, vaciar toda la geo, **rechazado**) · C4 STOP ante incoherencias o divergencias ·
  C5 las clínicas sin ubicación permanecen sin geo · C6 una sola transacción.
- **Fixtures seed históricos (§10.g):** 12 clínicas `c0000001-…` con owners y médicos
  del rango seed de `s7_17`. **Incluidas en F3C** por su legacy válido. Su limpieza, y
  la anomalía del médico `…0009` con `is_published = true`, son un **frente aparte, no
  abierto**.
- **Decisiones de implementación de `s7_92` (E1–E5, owner, 2026-09-13):**
  - **E1 · intento.** En UPDATE, un geo igual a OLD reenviado junto a un cambio
    legacy no es contradicción: se recalcula. Una modificación directa del geo que
    contradiga lo derivado aborta. En INSERT, intento = valor no NULL.
  - **E2 · el cliente nunca es autoridad.** Aunque coincida, el trigger asigna
    siempre el resultado del resolver.
  - **E3 · códigos.** `P0024` / `P0025` con la semántica de `s7_91`; `P0026`
    departamento inexistente; `P0180` puente del catálogo ausente; `P0183`
    contradicción.
  - **E4 · lock al final**, con `lock_timeout = 5s`, abortando si no se obtiene.
  - **E5 · rollback** solo antes de F3C/F3E y sin consumidores.
- ✅ **M2 de `CH-16` aplicada (`s7_90`, §10.d).** Procedió porque el precheck
  dinámico siguió en 0.
- 🧭 **Decisiones del owner para el resto de F3B (2026-09-13):**
  - **D1 · rechazar la contradicción ✅ (`s7_92`).** El trigger de `s7_92` deriva `country_id` /
    `territory_unit_id` del legacy y **rechaza con `P0183`** toda escritura que
    intente fijarlas con otro valor. Acepta un valor idéntico al derivado.
  - **D2 · `s7_91` ✅ aplicada (§10.e).** Departamento y municipio emparejados en
    `admin_approve_and_create_doctor`. Antes resolvía cada campo por separado con
    `COALESCE(override, lead)` y, si LucyAdmin cambiaba el departamento y dejaba
    el municipio vacío, recuperaba el municipio del lead, de otro departamento.
    **Interpretaciones confirmadas por el owner:**
    - «el override trae departamento» = valor normalizado con `NULLIF(valor, '')` y
      no NULL, la misma normalización que ya usaba `s7_64` para estos campos;
    - departamento y municipio de override ausentes → par del lead;
    - departamento de override + municipio ausente → municipio NULL;
    - municipio de override sin departamento de override → `P0024`, **nunca** se
      combina con el departamento del lead;
    - **el par final se valida siempre**, también el heredado del lead: municipio
      sin departamento → `P0024`; inexistente o de otro departamento → `P0025`.
      Intencional: una solicitud incoherente se detiene en la aprobación antes de
      crear una clínica inválida.
    - Las validaciones van tras las existentes y la clasificación, y antes de la
      primera escritura, para preservar el orden de errores previo.
    - Sin `btrim`, igual que antes: un valor solo de espacios cuenta como «trae
      valor», pero no puede crear una clínica inválida (`P0025`, o la FK del
      `INSERT` para el departamento).
  - **D3 · tabla sonda transaccional ✅ (`s7_92`, 41 casos).** La prueba de comportamiento del trigger va
    sobre una tabla creada y borrada dentro de la propia transacción, incluido
    `SET LOCAL ROLE authenticated`. **Nunca** `UPDATE` sobre filas reales.
  - **D4 · trigger normal, SIN `ENABLE ALWAYS` ✅ (`tgenabled = O` verificado).** No hay requerimiento medido de
    replicación entrante.
  - **D5 · cerrada.** 0 datos incoherentes medidos.
  - **D6 · tres migraciones secuenciales:** `s7_90` ✅ → `s7_91` ✅ → `s7_92` ✅. En
    `s7_92`, el resolver, el trigger y el **retiro de la guarda F3A van en la misma
    transacción**. El resolver es el único punto de resolución legacy → modelo
    nuevo: SV por `iso_alpha2`, nivel 1 si solo hay departamento, nivel 3 si hay
    municipio coherente, nunca nivel 2. La única `SECURITY DEFINER` es la función
    del trigger, con `search_path` fijo.
- **Las 96 clínicas sin ubicación legacy (de 119) quedan SIN geo y SIN decisión de
  país** (C5 de F3C). F3C no las tocó ni infirió nada. Cualquier tratamiento futuro
  exige decisión explícita del owner: sin teléfonos y **sin asumir** que deban
  quedar NULL para siempre.
- **Deuda de hardening, NO corregida en F3B:** `departments` y `municipalities`
  tienen `INSERT`/`UPDATE`/`DELETE` de tabla para `anon`/`authenticated`, con RLS
  que solo tiene policies `SELECT`. Las escrituras de cliente quedan denegadas y la
  RLS es la única barrera. Sin `REVOKE` ni cambios de RLS por inercia.
- **Requisito para `GEO-CATALOG-ADMIN/P1`:** si edita `legacy_id`, `parent_id` o
  reparenta unidades, deberá revalidar las clínicas cuyo país o unidad derive de
  ellas, o prohibir esas ediciones: el trigger de `s7_92` solo actúa al escribir
  `clinics`.
- **Backfill de país (F3C, aplicado respetándolo): NO usar teléfonos como evidencia de país.** Una clínica
  con ubicación legacy es de SV porque ese catálogo legacy es de SV. Las clínicas
  **sin** ubicación se miden aparte; no se infiere su país por prefijo telefónico.
- **`profiles` y `doctor_affiliation_requests` NO se migran dentro de F3.** Sus
  consumidores legacy se mantienen por compatibilidad (`legacy_id` / adaptador) o
  se separan de los selectores nuevos. No ampliar el frente a esas tablas.
- **SEO fuera de F3.** No se decide todavía si `addressLocality` publica distrito o
  municipio.
- **Migraciones: no usar etiquetas `$…$` dentro de comentarios.** El SQL Editor de
  Supabase puede tomarlas como apertura de un bloque (incidente de `s7_89`, §10.c).
- **SQL manual: entregar bloques autónomos listos para pegar en una pestaña
  nueva**, con primera y última línea explícitas, en lugar de depender de
  seleccionar un rango dentro del archivo completo.
- **SQL Editor: no enviar texto con forma de DDL sobre objetos que no existirán al
  terminar** —tampoco en literales, regex o diagnósticos read-only—. Ese texto puede
  disparar un `42P01` en Studio aunque todo haya ido bien; la consulta interna
  exacta no se conoce (incidente de `s7_92`, §10.f). Esos patrones se **ensamblan en
  tiempo de ejecución** (concatenación,
  `chr()`). Demostrado para `CREATE TABLE`; el resto de formas no se aisló.
- **Un error mostrado por el SQL Editor no prueba que la transacción abortara.**
  Ante cualquier error en un PASO transaccional, correr **primero** un bloque
  read-only de estado que clasifique aplicado / no aplicado / mixto, antes de
  `ROLLBACK`, reintento o conclusión. Para migraciones futuras con objetos de
  prueba creados y borrados en la misma ejecución, la forma de evitar el aviso
  falso (p. ej. DDL de la sonda ensamblado en `EXECUTE`) se decidirá cuando haga
  falta.

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
  tablas nuevas y para las dos columnas y dos relaciones nuevas de `clinics`. `TYPES-RECONCILIATION-P0` sigue siendo un frente aparte, no
  iniciado.
