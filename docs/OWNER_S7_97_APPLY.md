# s7_97 · F3F — runbook de aplicación

**Frente:** `MULTICOUNTRY-GEO-P0` · **Fase:** F3F (alcance territorial público) · **Migración:** 118
**Archivo:** `migrations/s7_97_geo_f3f_directory_territory_scope.sql`
**Estado:** ⛔ **NOT APPLIED / DO NOT MERGE.** Preparada con autorización del owner (2026-09-17) tras el preflight F3F PRE-0 de producción (Z = 0). **No aplicar sin orden explícita del owner.** Sin consumidor de frontend: F3E-3B no está iniciada.

---

## 1 · Qué hace y qué no

Crea **una sola función de lectura**:

| RPC | Devuelve | Comportamiento |
|---|---|---|
| `public.directory_territory_scope(p_country_iso text, p_unit_id bigint)` | `TABLE (unit_id bigint)` | La unidad pedida **y sus descendientes activos**, con la **cadena activa hasta la raíz**, ordenados por `unit_id`. Solo ids |

**Contrato de entradas inválidas — conjunto vacío, nunca excepción:**
- ISO inexistente, NULL, vacío o en minúsculas (`'sv'`): se compara exacto;
- país sin `directory_enabled`;
- `p_unit_id` NULL o inexistente;
- unidad inactiva, o con algún ancestro inactivo;
- unidad de otro país (`('HN', unidad de SV)` y al revés).

⚠️ **Un scope vacío significa «cero coincidencias», NO «sin filtro».** El consumidor (F3E-3B) debe mostrar 0 resultados. PostgREST ya lo hace: `clinics.territory_unit_id=in.()` responde 200 con 0 filas (medido en producción).

**No devuelve** nombres, niveles, `legacy_id` ni metadata: la navegación sigue siendo `directory_territory_units()` de `s7_96`.

**Cómo se consumirá (F3E-3B, no iniciada):** una llamada a la RPC por unidad elegida, cacheada, y la query actual de `doctors` con `.in('clinics.territory_unit_id', ids)`. Sin N+1, sin joins nuevos por médico, sin abrir tablas GEO, sin recursión en el cliente. En SV el scope máximo son 37 ids (795 caracteres de URL, medido).

**No modifica:** RLS, policies, grants/ACL de tablas, roles, ownership existente, `auth`, el catálogo, el cierre, `clinics`, `doctors`, perfiles, datos ni las RPC de `s7_96`. Tampoco el frontend.

---

## 2 · Seguridad

- **`SECURITY DEFINER` es necesario:** el cierre y el catálogo tienen RLS activa, 0 policies y 0 privilegios de cliente. Leerlos sin abrir grants exige ejecutar como su dueño, `postgres`.
- **Endurecimiento:** `plpgsql`; `STABLE`; `SET search_path = public, pg_temp`; referencias calificadas; sin SQL dinámico; sin `auth.uid()`; solo `countries`, `administrative_units` y `administrative_unit_closure`; sin recursión (usa el cierre de `s7_94`).
- **Privilegios explícitos:** los DEFAULT PRIVILEGES de `public` conceden EXECUTE a `anon`, `authenticated` **y `service_role`** (confirmado en producción por el preflight F3F PRE-0):
  - `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`;
  - `GRANT EXECUTE ... TO anon, authenticated`;
  - el POST exige la ACL exacta `anon=X/postgres,authenticated=X/postgres,postgres=X/postgres` y comprueba que `service_role` recibe 42501.

---

## 3 · Constantes (estructurales; sin datos de clínicas)

| Constante | Valor | Fuente |
|---|---|---|
| Países habilitados · niveles | `SV` · `SV:1,2,3` | preflight F3F PRE-0 |
| Unidades SV activas por nivel \| inactivas | `14\|44\|262\|0` | preflight F3F PRE-0 |
| Huella del catálogo | `460e807050a0da8bea0891965b1b9fd7` | `s7_94` |
| Cierre: filas \| reparto \| huella | `888\|0=320,1=306,2=262\|af230f5086d871b1cce24e34de4b6cec` | `s7_94` |
| Catálogo GEO | 4 tablas `{postgres=arwdDxtm/postgres}`, RLS sí, force no, dueño `postgres`, 0 policies | `s7_96` |
| RPC de `s7_96` | forma, md5 (LF/CRLF) y ACL de sus artefactos | `s7_96` |
| Cuerpo de `s7_97` (md5 LF · CRLF) | `08116cf0c80730e76e2cae4531153989` · `a69870a3a900247ad60d4d9c2730d375` | artefacto |

**El PRE y la GUARDA no dependen de datos de clínicas ni del directorio**: la función no los lee ni los escribe, y el POST prueba que no cambiaron con la instantánea de la transacción. Si cambia una constante estructural, ambos abortan sin cambios: hay que repetir el preflight y regenerar con nueva autorización.

---

## 4 · Antes de empezar

1. Ejecutar como `postgres` en el SQL Editor de Supabase. El PRE exige `current_user = postgres` y `CREATE` en `public`.
2. Pegar cada bloque **entero en una pestaña nueva** (reglas 1–2 del SQL Editor). Los hashes de cada bloque se reconfirman contra el blob remoto del PR antes de entregarlos.
3. **Correr primero el ESTADO:** `docs/smokes/s7_97_state_readonly.sql` → debe decir **`S7_97 NO APLICADA`**.
4. La transacción no bloquea tablas: crea una función. `lock_timeout = 5s` y `REPEATABLE READ`.

---

## 5 · Aplicación

| Paso | Bloque | Líneas del archivo | Resultado esperado |
|---|---|---|---|
| **PASO 1 · PRE** (solo lectura) | `DO $PRE$` … `$PRE$;` | 59–206 | `NOTICE s7_97 PRE OK — …` y `Success` |
| **PASO 2 · transacción** | `BEGIN ISOLATION LEVEL REPEATABLE READ;` … `COMMIT;` | 210–688 | `Success`. Los NOTICE `s7_97 GUARDA OK` y `s7_97 POST OK` pueden no mostrarse |
| **ESTADO** | `docs/smokes/s7_97_state_readonly.sql` | entero | `S7_97 APLICADA COMPLETA` |
| **VERIFICACIÓN POST** | `docs/smokes/s7_97_post_verification_readonly.sql` | entero, de `BEGIN READ ONLY;` a `ROLLBACK;` | fila `Z resultado` = **0** (exportar CSV) |

**El PRE y la GUARDA abortan** si:
- no es `postgres` o no tiene `CREATE`;
- la función ya existe (NO reaplicar);
- `s7_96` no está aplicada exacta (forma, cuerpo, ACL);
- falta el runtime de `s7_92` o sus triggers no están normales;
- el catálogo GEO no está cerrado;
- hay consumidores del modelo distintos de las 2 RPC de `s7_96`, o **cualquier** lector del cierre;
- cambian países, niveles, unidades, la huella del catálogo o el cierre (filas, reparto, huella) o hay cruces de país.

**El POST del PASO 2 aborta toda la transacción** si falla cualquiera de estas comprobaciones:
- forma exacta (firma, retorno, `STABLE`, DEFINER, `search_path`, dueño, lenguaje) y md5 del cuerpo;
- ACL exacta; EXECUTE efectivo `anon`/`authenticated` sí, `service_role` no;
- catálogo y cierre sin privilegios de cliente;
- instantánea igual: policies, relaciones y su ACL/RLS, ACL de columnas, funciones (salvo la nueva; total +1, las RPC de `s7_96` incluidas), triggers, default privileges, roles, membresías, esquemas, filas del catálogo, **filas del cierre**, C2 de `clinics` y publicación de `doctors`;
- consumidores: `s7_92`/`s7_93` ven exactamente `directory_countries, directory_territory_scope, directory_territory_units`; `s7_94` ve exactamente `directory_territory_scope`; nada usa las RPC de `s7_96`;
- comportamiento bajo `anon` y `authenticated`:
  - departamento grande **37**, departamento pequeño **12**, municipio grande **21**, hoja **1** y San Salvador **25** ids, cada lista igual al árbol calculado por `parent_id` (sin el cierre) y en orden;
  - el scope de San Salvador = lo que alcanza la navegación pública de `s7_96`;
  - los 7 contratos inválidos devuelven 0 filas;
  - lectura directa de las 4 tablas GEO denegada;
- bajo `service_role`: EXECUTE denegado;
- consumo: publicados en el scope de San Salvador = publicados por legacy `SS`; ninguna clínica sin territorio dentro de un scope; toda clínica con territorio dentro del scope de su departamento.

---

## 6 · Ante cualquier error (regla 4 del SQL Editor)

1. **No reintentar y no ejecutar el rollback.**
2. Correr **solo** `docs/smokes/s7_97_state_readonly.sql` y reportar su salida.

| ESTADO | Significado |
|---|---|
| `S7_97 NO APLICADA` | La transacción abortó entera; nada cambió |
| `S7_97 APLICADA COMPLETA` | El COMMIT ocurrió; seguir con la VERIFICACIÓN POST |
| `S7_97 APLICADA — …` / `MIXTO — …` / `ANOMALIA — …` | No continuar; reportar |

---

## 7 · Rollback

`docs/rollbacks/s7_97_rollback.sql` — **NO EJECUTAR SIN ORDEN EXPLÍCITA DEL OWNER.**

- **Qué hace:** `BEGIN REPEATABLE READ` → PREVIA → RETIRO → VERIFICA → `COMMIT`.
- **PREVIA:** exige la función con forma, md5 y ACL de `s7_97`, y 0 dependientes (vistas, funciones que la nombren, policies). Si no, se niega sin tocar nada.
- **RETIRO:** `REVOKE ALL` y `DROP FUNCTION`, ambos ensamblados con `format()` (regla 3 del SQL Editor), con RESTRICT.
- **VERIFICA:** 0 funciones; el cierre vuelve a no tener lectores; el modelo solo con las 2 RPC de `s7_96`; catálogo cerrado; instantánea igual (−1 función).
- **No toca** el cierre, el catálogo, las RPC de `s7_96` ni datos.

### Cadena de reversión — ORDEN OBLIGATORIO Y BLOQUEANTE

**frontend F3E-3B → s7_97 → frontend F3E-2 → s7_96 → s7_95 → s7_94 → s7_93 R2 → verificar → s7_92**

1. **Revertir primero el frontend de F3E-3B** (cuando exista). **Un consumidor de frontend no es detectable desde la base.**
2. Rollback de `s7_97`. Después, el ESTADO debe decir `S7_97 NO APLICADA`.
3. Solo entonces sigue la cadena vigente: frontend F3E-2 → `s7_96` → `s7_95` → `s7_94` → `s7_93` R2 → verificar → `s7_92`.

**Mientras `s7_97` esté aplicada, los rollbacks previos se niegan** (medido en el arnés con los archivos reales):
- `s7_96`: su PREVIA pasa (la nueva función no nombra sus RPC), pero su **VERIFICA** detecta que quedan consumidores del modelo territorial y **aborta la transacción sin cambios**;
- `s7_95`: se niega por consumidores del modelo;
- `s7_94`: se niega porque hay funciones que usan el cierre;
- `s7_92`/`s7_93`: su predicado de consumidores la detecta.

**Los rollbacks históricos no se modifican.**

---

## 8 · Verificadores históricos

- **`docs/smokes/s7_96_post_verification_readonly.sql`** pasará a fallar en dos filas tras aplicar `s7_97`, **esperado, no es anomalía**: «funciones que detectan los rollbacks de s7_92/s7_93» (verá 3 en vez de 2) y «funciones que detecta el rollback de s7_94» (verá 1 en vez de 0). Ese bloque describe el estado justo tras `s7_96`.
- **`docs/smokes/s7_96_state_readonly.sql`** dirá `S7_96 APLICADA — con consumidores adicionales del modelo (…)`, también esperado.
- No se modifica ningún artefacto histórico.

---

## 9 · Validación previa (local, sin producción)

- **`node scripts/check-s7_97.mjs`:** contrato, orden y alcance del PASO 2, PRE = GUARDA, constantes, md5, POST, rollback, bloques read-only, reglas del SQL Editor y artefactos históricos intactos. Incluye **mutaciones con expectativa invertida**.
- **Reanclajes:** `check-s7_96` (el total de migraciones deja de ser 117; su posición sigue fijada) y `check-s7_89` (allowlist cerrada: la nueva RPC como lectora del modelo, y los 4 archivos de F3E-2 como consumidores **solo de país** del frontend). ⚠️ El segundo corrige una **omisión de F3E-2**: `check-s7_89` daba 189/190 en `main` desde #382 porque no se ejecutó al validar ese PR.
- **Arnés local (PostgreSQL 18), 83/83.** Archivos reales aplicados como mensaje único sobre una base con `s7_95` y `s7_96` reales:
  - **Aplicación:** PRE, PASO 2, ESTADO y VERIFICACIÓN POST Z = 0; no reaplicable.
  - **Verificadores históricos (medido):** con `s7_97` aplicada, el ESTADO de `s7_96` dice «S7_96 APLICADA — con consumidores adicionales del modelo (directory_countries,directory_territory_scope,directory_territory_units)» y su VERIFICACIÓN POST falla exactamente en las 2 filas de consumidores (§8).
  - **Contrato por rol:** `anon`/`authenticated` 37 · 12 · 21 · 1 · 25; incluye la propia unidad; orden; solo `unit_id`; 7 contratos inválidos vacíos; lectura directa de las 4 tablas denegada; `service_role` y rol sin grants denegados.
  - **Consumo:** San Salvador por scope = legacy; S2 fuera de todo scope; publicados sin filtro intactos.
  - **Planes** genérico (como plpgsql) y personalizado: sin `Recursive Union`, sin `CTE Scan`, 0 Seq Scan del cierre.
  - **Fixture:** hoja inactiva, municipio intermedio inactivo, departamento inactivo, SV deshabilitado, HN habilitado y país cruzado en ambos sentidos.
  - **Cadena de rollback real:** `s7_96`, `s7_95` y `s7_94` se niegan con `s7_97` aplicada; tras el rollback de `s7_97`, los de `s7_96` y `s7_95` completan. El rollback de `s7_97` se niega sin aplicar, con vista o función dependiente, con cuerpo cambiado y con ACL cambiada.
  - **ESTADO:** ANOMALIA con grant sobre el cierre y MIXTO con ACL alterada; la VERIFICACIÓN POST detecta el grant.
  - **13 mutaciones ejecutadas del PASO 2**, todas detectadas por el POST sin dejar nada: REVOKE sin `service_role`, GRANT a PUBLIC, GRANT a `service_role`, INVOKER, VOLATILE, `search_path` sin `pg_temp`, columna extra, sin `directory_enabled`, sin validar el país de la unidad, sin cadena activa, grant de tabla GEO, policy nueva, ISO normalizado.
  - **Deriva:** catálogo cambiado, cierre desincronizado, `s7_96` con ACL cambiada, otro lector del cierre, cierre abierto, `s7_96` ausente y usuario distinto de `postgres`: PRE y GUARDA abortan.

---

## 10 · Compatibilidad con PostgreSQL 17.6 (revisión estática, no es prueba)

- Solo sintaxis disponible desde PG 12: `RETURNS TABLE`, `#variable_conflict use_column`, `RETURN QUERY`, `WITH ORDINALITY`, `CROSS JOIN LATERAL`, `jsonb_path_query`, `has_function_privilege`, `BEGIN ISOLATION LEVEL REPEATABLE READ`, `SET LOCAL ROLE` dentro de `DO`.
- La consulta del cuerpo se midió en producción en el preflight F3F PRE-0 (PG 17.6): 0,091–0,480 ms, sin `Recursive Union`, sin `CTE Scan`, 0 Seq Scan del cierre, con `administrative_unit_closure_pkey`, `auc_descendant_level_idx`, `administrative_units_pkey` y `au_id_country_level_key`.
- **La compatibilidad quedará acreditada solo por la ejecución en producción.**

---

## 11 · Límites de fase

- **F3F (esto) = NOT APPLIED / DO NOT MERGE:** solo la RPC. Sin frontend. No cambia comportamiento observable mientras no haya consumidor.
- **F3E-3B (no iniciada):** control «Ubicación» progresivo que consumirá esta RPC.
- **F3E-3A (ON HOLD):** país, precedencia y persistencia, antes de habilitar un segundo país.
- **`/{iso2}`:** OPEN / NOT APPROVED.
