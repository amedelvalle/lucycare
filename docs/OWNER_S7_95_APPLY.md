# s7_95 · F3E-0 · M0.5 — runbook de aplicación

**Frente:** `MULTICOUNTRY-GEO-P0` · **Fase:** F3E-0 · **Migración:** 116
**Archivo:** `migrations/s7_95_geo_foundation_3e0_attested_country_backfill.sql`
**Estado:** ✅ **APPLIED / VERIFIED en producción (PostgreSQL 17.6, 2026-09-16) · NO REAPLICAR.** PR #377 sin merge (DO NOT MERGE WITHOUT OWNER OK). Evidencia en §10.

---

## 1 · Qué hace y qué no

Asigna `country_id = SV` a **exactamente 36 clínicas**, las de los 36 médicos publicados del lote técnico `Importar_100` (2026-05-21), manteniendo `territory_unit_id`, `department_id` y `municipality_id` en NULL. El resultado es el estado **S2** (país sin territorio).

| Aspecto | Qué establece s7_95 |
|---|---|
| **Pertenencia al lote** | **Medida** (preflights E y H de producción, 2026-09-15) |
| **País SV** | **Atestación explícita del owner**: la base importada solo contiene médicos de El Salvador. No procede de dirección, teléfono, nombre ni colegiación |
| **Territorio** | **Desconocido**: no se asigna departamento, municipio ni distrito |
| **Runtime** | Al COMMIT, `_clinics_territory_sync()` y los triggers de `clinics` son **los de `s7_92`** (OID, definición, md5 y estado). Sin tablas, funciones, RPC, grants ni policies |
| **`updated_at`** | Preservado |
| **Auditoría** | Una fila de `audit_log` por clínica. Autor: el perfil admin confirmado por el owner (`739cac58-…`). Marca `edited_via = owner_attestation_f3e0`. Claves exactas: `batch, batch_membership, country_id, country_iso, edited_via, evidence, migration, source, territory, territory_unit_id`. Sin datos personales |
| **Caso D** | No entra (`96dffdc8-…`). Se resuelve después cargando su ubicación real en LucyAdmin |

**Estado esperado tras aplicar:**
- **Publicados:** 46 en total, 45 con país y 1 sin país.
- **Visibles (D1):** 43 en total, 42 con país y 1 sin país.
- **El único publicado sin país es el caso D.**

### Riesgo residual aceptado por el owner

- **Qué puede pasar:** un escritor autorizado de la fila puede vaciar `country_id` de una S2 y dejarla en S0. Son el dueño de la clínica por RLS (solo tras reclamar el perfil) o `service_role`.
- **Por qué es aceptable:** es la misma capacidad que ya existe para vaciar la ubicación de una S1.
- **Cómo se detecta:** lo informa `docs/smokes/s7_95_territorial_invariant_readonly.sql` (fila 31–32). No es una anomalía.

---

## 2 · Huellas incrustadas (preflight H)

| Constante | Valor |
|---|---|
| Pares `doctor_id\|clinic_id` (36) | sha256 `68ff3c1509311c975e22b1df77990622a7247a7a1840e9c76ae7833062f7303c` |
| Lista de clínicas (36) | sha256 `783399dce61a926b523d637311faeed5fdc22908984cb12fb3fe543b926489e8` |
| Estado del conjunto (dept, muni, país, unidad, dueño, perfil, `updated_at`) | sha256 `e12195c655220975ce87fabc6c4e8875bfa4ef59427c018a2f26532051819a18` |
| C2 de todas las clínicas | md5 `7c823ad1f5c30fc7a2b5a33fe62c68a7` |
| Ventana del lote (E) | `2026-05-21 13:58:28.852053-06` … `13:59:37.125681-06`, 100 médicos |
| Directorio previo | publicados `46\|9\|37` · visibles `43\|8\|35` |

**Si cualquier dato cambió desde H, el PRE y la GUARDA abortan.** Entonces hay que repetir el preflight H y regenerar las constantes con nueva autorización; no se editan a mano.

---

## 3 · Antes de empezar

1. Hacerlo en un momento de poco tráfico.
   - **Durante la transacción** (milisegundos con 36 filas) las escrituras a `clinics` y `doctors` esperan.
   - **Si ya hay un escritor abierto**, la migración espera como máximo 5 s y aborta sin cambios.
   - **Las lecturas** (directorio, perfiles) no se bloquean.
2. Ejecutar como `postgres` en el SQL Editor de Supabase.
3. Pegar cada bloque **entero en una pestaña nueva** (reglas 1–2 del SQL Editor).
4. **Correr primero el ESTADO:** `docs/smokes/s7_95_state_readonly.sql` → debe decir **`S7_95 NO APLICADA`**.

---

## 4 · Aplicación

| Paso | Bloque | Líneas del archivo | Resultado esperado |
|---|---|---|---|
| **PASO 1 · PRE** (solo lectura) | `DO $PRE$` … `END $PRE$;` | 72–302 | `NOTICE s7_95 PRE OK — …` y `Success` |
| **PASO 2 · transacción** | `BEGIN;` … `COMMIT;` | 306–758 | `Success`. Los NOTICE `s7_95 GUARDA OK` y `s7_95 POST OK — 36 clinicas en S2 SV, …, directorio 46\|45\|1#43\|42\|1` pueden no mostrarse en el editor |
| **ESTADO** | `docs/smokes/s7_95_state_readonly.sql` | entero | `S7_95 APLICADA COMPLETA` |
| **VERIFICACIÓN POST** | `docs/smokes/s7_95_post_verification_readonly.sql` | entero | fila `Z resultado` = **0** (exportar CSV) |
| **INVARIANTE v2** | `docs/smokes/s7_95_territorial_invariant_readonly.sql` | entero | fila `Z resultado` = **0**; fila 33 (gate F3E-2) = solo el caso D |

**Si el PASO 1 lanza excepción, NO seguir.** Reportar el mensaje: dice qué cambió desde H.

---

## 5 · Ante cualquier error (regla 4 del SQL Editor)

**No reintentar, no hacer `ROLLBACK` a mano, no concluir nada.** Correr **primero** el ESTADO:

| ESTADO | Significado | Acción |
|---|---|---|
| `OPERACION INVALIDA — s7_95 sigue aplicada … y el runtime de s7_92 no existe` | se ejecutó el rollback de `s7_92` sin revertir antes s7_95 (ver §6) | **no continuar**; reportar de inmediato. No intentar «completar» la cadena |
| `S7_95 NO APLICADA` | la transacción abortó entera; triggers en `[O]` | reportar el error; no reintentar sin revisar la causa |
| `S7_95 APLICADA COMPLETA` | se comiteó aunque el editor mostrara un error (incidente tipo `s7_92`) | correr VERIFICACIÓN POST e INVARIANTE y reportar |
| `ANOMALIA — triggers de clinics no normales` | un trigger quedó desactivado | **no continuar**; reportar de inmediato |
| `MIXTO` / otra `ANOMALIA` | no encaja en ningún estado conocido | **no continuar**; reportar |

---

## 6 · Rollback

**Archivo:** `docs/rollbacks/s7_95_rollback.sql`. ⛔ **Solo con orden explícita del owner.**

- **Transacción:** pegar entero; es una sola transacción. La sincronización de `s7_92` sigue **activa** y solo se desactiva `trg_clinics_updated_at`, para restaurar `updated_at`.
- **Se niega si:**
  - alguna de las 36 ya no está en S2 SV;
  - cambió su estado respecto de H (dueño, médico, `updated_at`, legacy);
  - existe un consumidor del modelo territorial;
  - la auditoría neta no es 36.
- **Auditoría:** es append-only. Las 36 filas de aplicación **no se borran**; se añaden 36 de reversión. Tras revertir, s7_95 podría volver a aplicarse (la guarda compara la auditoría neta).
- **Comprobación:** después correr el ESTADO → `S7_95 REVERTIDA`.

### Cadena de reversión — ORDEN OBLIGATORIO Y BLOQUEANTE

**s7_95 → s7_94 → s7_93 R2 → verificar → s7_92**

Vale antes de cualquier fase posterior (F3E-1 en adelante reevalúa toda la cadena).

⛔ **Hallazgo bloqueante, medido en el arnés:** el rollback histórico de `s7_92` **no se niega** si s7_95 sigue aplicada.
- **Qué hace:** si se ejecuta fuera de orden, vacía **toda** la geo (las 36 S2 y las 23 de `s7_93`) y retira la función y el trigger de sincronización.
- **No detecta S2 ni la auditoría de s7_95.**
- **No se modifica retrospectivamente:** es un artefacto histórico (decisión del owner).

**Consecuencias:**
- **Operación inválida:** cualquier intento de ejecutar el rollback de `s7_94`, `s7_93` R2 o `s7_92` mientras el ESTADO de s7_95 no sea `S7_95 REVERTIDA` o `S7_95 NO APLICADA`.
- **Qué hacer antes de cada paso de la cadena:** correr el ESTADO de s7_95 y confirmar `S7_95 REVERTIDA`.
- **Si ya ocurrió:**
  - el ESTADO lo declara `OPERACION INVALIDA — …`;
  - el invariante v2 lo marca en su sección 0, con Z > 0.
  - Ambos bloques se diseñaron para clasificar **sin llamar a funciones de `s7_92`**: derivan la coherencia S1 del catálogo con las mismas reglas del resolver, y en el arnés esa derivación es idéntica al resolver en los 276 pares legacy válidos.
- **Cadena en orden:** completa sin errores en el arnés (s7_95 OK → s7_94 OK → s7_93 R2 OK → s7_92 OK).

---

## 7 · Verificadores históricos

**Se diseñaron antes de S2 y NO describen el invariante vigente.** No se modifican:
- los POST ya ejecutados de `s7_92` y `s7_93` y sus verificaciones de producción: contarían las 36 como divergencias o como «sin ubicación con geo»;
- la fila 41 de `docs/smokes/s7_94_post_verification_readonly.sql`: su C2 `7c823ad1…` cambia a propósito.

**El invariante vigente es el v2**, en `docs/smokes/s7_95_territorial_invariant_readonly.sql`:
- **Estados válidos:** S0, S1 coherente, o S2 solo para las clínicas con auditoría neta de s7_95 = 1.
- **Anomalías:** S2 fuera de la lista, S1 incoherente, territorio o municipio sin departamento, atestada con país ≠ SV.
- **Informativo:** S2→S1 es una mejora legítima; S2→S0 es el riesgo residual.

---

## 8 · Validación previa (local, sin producción)

| Instrumento | Resultado |
|---|---|
| `node scripts/check-s7_95.mjs` | **PASS**, con mutaciones de expectativa invertida |
| Arnés de runtime (PostgreSQL **18**, archivos reales con constantes sustituidas) | **62 ok · 0 FAIL**: derivación S1 = resolver (276 pares), aplicación como mensaje único, ESTADO/POST/invariante Z = 0, 27 casos de seguridad, rollback exacto y negativas, 11 mutaciones de runtime y 8 de datos, `search_path` sin `public`, locks y concurrencia, OPERACION INVALIDA fuera de orden, cadena en orden |
| Regresión `check-s7_87` … `check-s7_94` | todos PASS |

**s7_95 NO está probada en PostgreSQL 17.** La ejecución en 17.6 solo quedará acreditada al aplicarla en producción.

## 9 · Revisión de compatibilidad con PostgreSQL 17.6 (estática, no es prueba)

| Construcción usada | Disponible desde | Nota |
|---|---|---|
| `sha256(bytea)`, `convert_to`, `encode(…, 'hex')` | 11 | — |
| `extract(epoch FROM timestamptz)` devuelve `numeric` | 14 | mismo tipo en 17 y 18. **Las huellas del estado (`e12195c6…`) y C2 se calcularon con estas mismas expresiones en la producción 17.6 (preflight H)**, así que la guarda compara contra valores producidos por 17.6 |
| CTE `AS MATERIALIZED` | 12 | — |
| `to_regprocedure(text)`, `pg_get_triggerdef`, `pg_get_serial_sequence`, `has_sequence_privilege(name, text, text)` | ≤ 9.x | `pg_get_triggerdef` imprime `EXECUTE FUNCTION` desde 11; el patrón admite el nombre con o sin esquema |
| `jsonb_build_object`, `jsonb_object_keys`, `->`, `->>`, `?` | 9.5 | — |
| `count(*) FILTER (…)`, `IS DISTINCT FROM`, `string_to_array`, `split_part`, `array_to_string` | ≤ 9.4 | — |
| `LOCK TABLE … SHARE ROW EXCLUSIVE`, `ALTER TABLE … DISABLE/ENABLE TRIGGER` | antiguas | en 17 `DISABLE TRIGGER` pide `SHARE ROW EXCLUSIVE` (documentado; medido solo en 18). **En 17.6 ya se ejecutó con éxito en `s7_93`** |
| PL/pgSQL: `INTO STRICT`, `GET DIAGNOSTICS ROW_COUNT`, `CONSTANT`, `set_config`/`current_setting` locales | antiguas | ya usadas en `s7_92`–`s7_94` aplicadas en 17.6 |
| `pg_policies`, `pg_trigger.tgenabled`, `pg_class.relforcerowsecurity`, `pg_roles.rolbypassrls` | ≤ 9.5 | — |

No se usa nada introducido en PostgreSQL 18: sin `uuidv7`, columnas generadas virtuales, `OLD`/`NEW` en `RETURNING` ni cambios de `COPY`/`EXPLAIN`.

## 10 · Aplicación en producción (2026-09-16) — APPLIED / VERIFIED

**Resultado:** `s7_95` quedó aplicada completa y verificada. **PostgreSQL 17.6 acreditado por
producción.**

| Bloque | Resultado |
|---|---|
| ESTADO | `S7_95 APLICADA COMPLETA` · lista 36 en S2 SV · 0 S1 · 0 S0 · auditoría 36 / 0 (neto 36) · runtime de `s7_92` presente · triggers `[O]` · 0 S2 fuera de la lista |
| VERIFICACIÓN POST | **Z = 0** · huellas `e12195c6…` y C2 `7c823ad1…` reconstruidas · 36 auditorías válidas · runtime, seguridad y escritores intactos · publicados `46\|45\|1` · visibles `43\|42\|1` · único sin país: caso D `96dffdc8-0764-4adb-a4eb-3a7a198cf51d` |
| INVARIANTE v2 | **Z = 0** · operación válida · lista atestada 36 (`783399dc…`) · 0 anomalías · S0 · S1 · S2 = 60 · 23 · 36 |

**Nueva huella C2 de `clinics`:** `ce972bd098a01c277a101c81875ab3e1`.

### Incidente operativo

- **Qué pasó:** el PASO 2 quedó comiteado a las **14:41:42 UTC**. Un PASO 1 ejecutado después
  abortó con `s7_95 PRE: el conjunto vivo no coincide con la lista (sobran|faltan = 0|36)`,
  sin escribir nada.
- **Diagnóstico read-only:** el predicado que vaciaba el conjunto era `country_id IS NULL`
  (las 36 ya estaban en S2 SV con su auditoría). Era la guarda contra la reaplicación.
- **Confirmación:** ESTADO, VERIFICACIÓN POST e INVARIANTE confirmaron la aplicación completa.
- **Regla que sale de aquí:** ante cualquier error del PRE o del PASO 2, correr primero el
  ESTADO (§5) antes de concluir que la migración no está aplicada.

**Gate restante antes de F3E-2:** el caso D, por LucyAdmin con su ubicación real.
