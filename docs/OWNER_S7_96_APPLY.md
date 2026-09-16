# s7_96 · F3E-1 — runbook de aplicación

**Frente:** `MULTICOUNTRY-GEO-P0` · **Fase:** F3E-1 (superficie backend de lectura) · **Migración:** 117
**Archivo:** `migrations/s7_96_geo_foundation_3e1_directory_read_rpcs.sql`
**Estado:** ✅ **APPLIED / VERIFIED en producción (PostgreSQL 17.6, 2026-09-16) · NO REAPLICAR.** Preparada como NOT APPLIED y aplicada después con autorización del owner. PR #380 abierto, sin merge. Evidencia en §12.

---

## 1 · Qué hace y qué no

Crea **solo dos funciones de lectura** del catálogo territorial público habilitado para directorio. No toca datos ni el runtime existente.

| RPC | Devuelve | Comportamiento |
|---|---|---|
| `public.directory_countries()` | `country_id smallint, iso_alpha2 text, country_name text, level smallint, level_label text` | Una fila por (país con `directory_enabled`, nivel). Orden `iso_alpha2, level`. Genérica: no asume tres niveles. **Todo país habilitado es descubrible:** sin filas en `country_levels` aparece una vez con `level` y `level_label` NULL (no se inventan niveles) |
| `public.directory_territory_units(p_country_iso text, p_parent_id bigint DEFAULT NULL)` | `id bigint, name text, level smallint, parent_id bigint` | `p_parent_id` NULL → unidades raíz activas del país. Con padre → hijos activos, solo si el padre es activo y del país. Orden `name, id` |

**Contrato de entradas inválidas — conjunto vacío, nunca excepción:**
- ISO inexistente, NULL o vacío;
- país sin `directory_enabled`;
- ISO en minúsculas: se compara **exacto**, como lo guarda `countries` (`CHECK ^[A-Z]{2}$`). `'sv'` devuelve vacío;
- padre de otro país, inexistente o inactivo.

**No devuelve:** `has_children`, `legacy_id`, `official_code`, fuentes, `booking_enabled` ni el cierre. Tampoco ningún dato de tenant, usuario, clínica, médico, paciente o membresía.

**`country_id`** se entrega para que F3E-2 filtre `clinics.country_id` en runtime. **La identidad externa sigue siendo `iso_alpha2`**: el id numérico no es constante, URL ni configuración.

**No modifica:** RLS, policies, grants/ACL de tablas, roles, ownership existente, `auth`, `clinics`, `doctors`, perfiles, pacientes, membresías ni los datos del catálogo. Tampoco el frontend.

---

## 2 · Seguridad

- **`SECURITY DEFINER` es necesario:** las tablas GEO tienen RLS activa, 0 policies y 0 privilegios de cliente (preflight F3E-1A). Leerlas sin abrir grants de tabla exige ejecutar como su dueño, `postgres`, que las lee porque la RLS no está forzada.
- **Endurecimiento:** `STABLE`; `SET search_path = public, pg_temp`; referencias calificadas; columnas allowlisted; sin SQL dinámico; sin `auth.uid()`; solo `countries`, `country_levels` y `administrative_units`.
- **Privilegios explícitos:** los DEFAULT PRIVILEGES de `public` conceden EXECUTE a `anon`, `authenticated` **y `service_role`** en funciones nuevas (medido en el preflight). No se depende de ellos:
  - `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`;
  - `GRANT EXECUTE ... TO anon, authenticated`;
  - el POST exige la ACL exacta `anon=X/postgres,authenticated=X/postgres,postgres=X/postgres` y comprueba que `service_role` no puede ejecutar.

---

## 3 · Constantes del preflight F3E-1A (2026-09-16, PG 17.6)

| Constante | Valor |
|---|---|
| Huella C2 de `clinics` | md5 `7cef00d1d24a004edbc4678fe6d41948` |
| Clínicas total \| S0 \| S1 \| S2 \| anomalías | `119\|59\|24\|36\|0` |
| Lista atestada de `s7_95` | `36`, sha256 `783399dce61a926b523d637311faeed5fdc22908984cb12fb3fe543b926489e8` |
| Directorio publicados \| visibles D1 | `46\|46\|0` · `43\|43\|0` |
| Países habilitados · niveles | `SV` · `SV:1,2,3` |
| Unidades SV activas por nivel \| inactivas | `14\|44\|262\|0` |
| `clinics` relacl \| RLS \| force · policies | `{postgres=arwdDxtm/postgres,anon=…,authenticated=…,service_role=…}\|true\|false` · md5 `20ad37b9…` |
| Catálogo GEO | las 4 tablas `{postgres=arwdDxtm/postgres}`, RLS sí, force no, dueño `postgres`, 0 policies |
| Cuerpos (md5 LF · CRLF) | `directory_countries` `d3fa8ee9…` · `54aeee13…`; `directory_territory_units` `3083c7c5…` · `243b5124…` |

**Si cualquier dato cambió desde el preflight, el PRE y la GUARDA abortan sin cambios.** Hay que repetir el preflight y regenerar las constantes con nueva autorización; no se editan a mano.

---

## 4 · Antes de empezar

1. Ejecutar como `postgres` en el SQL Editor de Supabase. El PRE exige `current_user = postgres` y `CREATE` en `public`.
2. Pegar cada bloque **entero en una pestaña nueva** (reglas 1–2 del SQL Editor).
3. **Correr primero el ESTADO:** `docs/smokes/s7_96_state_readonly.sql` → debe decir **`S7_96 NO APLICADA`**.
4. La transacción no bloquea tablas: crea dos funciones. `lock_timeout = 5s` y `REPEATABLE READ` (la GUARDA y el POST ven la misma instantánea de datos).

---

## 5 · Aplicación

| Paso | Bloque | Líneas del archivo | Resultado esperado |
|---|---|---|---|
| **PASO 1 · PRE** (solo lectura) | `DO $PRE$` … `$PRE$;` | 65–243 | `NOTICE s7_96 PRE OK — …` y `Success` |
| **PASO 2 · transacción** | `BEGIN ISOLATION LEVEL REPEATABLE READ;` … `COMMIT;` | 247–783 | `Success`. Los NOTICE `s7_96 GUARDA OK` y `s7_96 POST OK` pueden no mostrarse |
| **ESTADO** | `docs/smokes/s7_96_state_readonly.sql` | entero | `S7_96 APLICADA COMPLETA` |
| **VERIFICACIÓN POST** | `docs/smokes/s7_96_post_verification_readonly.sql` | entero, de `BEGIN READ ONLY;` a `ROLLBACK;` | fila `Z resultado` = **0** (exportar CSV) |

**El POST del PASO 2 aborta toda la transacción** si falla cualquiera de estas comprobaciones:
- forma exacta de ambas funciones (firma, retorno, `STABLE`, DEFINER, `search_path`, dueño, lenguaje) y md5 de los cuerpos;
- ACL exacta; EXECUTE efectivo `anon`/`authenticated` sí, `service_role` no;
- catálogo GEO sin privilegios de cliente;
- instantánea tomada tras la GUARDA idéntica: policies, relaciones y su ACL/RLS, ACL de columnas, funciones (salvo las 2 nuevas; total +2), triggers, default privileges, roles, membresías, esquemas, filas del catálogo GEO y C2 de `clinics`;
- directorio `46|46|0#43|43|0`;
- consumidores: los rollbacks de `s7_92`/`s7_93` ven exactamente las 2 RPC; el de `s7_94` ninguna;
- comportamiento bajo `anon` y `authenticated`: países = catálogo habilitado con LEFT JOIN a los niveles (filas, NULL y orden); el conjunto de países devueltos = todos los habilitados; raíz de SV; hijos del padre con más hijos; los 7 contratos inválidos devuelven 0 filas; lectura directa de las 4 tablas GEO denegada. Bajo `service_role`: EXECUTE denegado.

**Comprobación opcional por la API pública**, solo con autorización del owner: llamar `POST /rest/v1/rpc/directory_countries` y `…/directory_territory_units` con la clave anon. Supabase recarga la caché de esquema de PostgREST tras el DDL.

---

## 6 · Ante cualquier error (regla 4 del SQL Editor)

1. **No reintentar y no ejecutar el rollback.**
2. Correr **solo** `docs/smokes/s7_96_state_readonly.sql` y reportar su salida.

| ESTADO | Significado |
|---|---|
| `S7_96 NO APLICADA` | La transacción abortó entera; nada cambió |
| `S7_96 APLICADA COMPLETA` | El COMMIT ocurrió; seguir con la VERIFICACIÓN POST |
| `MIXTO — …` / `ANOMALIA — …` | No continuar; reportar |

---

## 7 · Rollback

`docs/rollbacks/s7_96_rollback.sql` — **NO EJECUTAR SIN ORDEN EXPLÍCITA DEL OWNER.**

- **Qué hace:** `BEGIN REPEATABLE READ` → PREVIA → RETIRO → VERIFICA → `COMMIT`.
- **PREVIA:** exige las 2 funciones con forma, md5 y ACL de `s7_96`, y 0 dependientes (vistas, funciones que las nombren, policies). Si no, se niega sin tocar nada.
- **RETIRO:** `DROP FUNCTION` ensamblado con `format()` (regla 3 del SQL Editor), con RESTRICT.
- **VERIFICA:** 0 funciones; 0 consumidores del modelo territorial; catálogo cerrado; instantánea igual (−2 funciones).

### Cadena de reversión — ORDEN OBLIGATORIO Y BLOQUEANTE

**frontend F3E-2 → s7_96 → s7_95 → s7_94 → s7_93 R2 → verificar → s7_92**

1. **Revertir primero el frontend de F3E-2**, si ya consume las RPC. **Un consumidor de frontend no es detectable desde la base.**
2. Rollback de `s7_96`. Después, el ESTADO debe decir `S7_96 NO APLICADA`.
3. Solo entonces siguen `s7_95` → `s7_94` → `s7_93` R2 → verificar → `s7_92`, con sus propias condiciones.

**Mientras `s7_96` esté aplicada, los rollbacks de `s7_92`, `s7_93` y `s7_95` detectan las 2 RPC como consumidores y se niegan** (medido en el arnés con el rollback real de `s7_95`). El de `s7_94` no las detecta (no usan el cierre). **Los rollbacks históricos no se modifican.**

---

## 8 · Verificadores históricos

- **Fila 46 de `docs/smokes/s7_95_post_verification_readonly.sql`** («consumidores del modelo territorial» = 0): pasará a **2** tras aplicar `s7_96`. Esperado, no es anomalía. Ese bloque describe el estado justo tras `s7_95`.
- `docs/smokes/s7_95_state_readonly.sql` y `docs/smokes/s7_95_territorial_invariant_readonly.sql` no cuentan funciones consumidoras y siguen siendo válidos.
- No se modifica ningún artefacto histórico.

---

## 9 · Validación previa (local, sin producción)

- **`node scripts/check-s7_96.mjs`:** contrato, orden y alcance del PASO 2, PRE = GUARDA, constantes, md5, POST, rollback, bloques read-only, reglas del SQL Editor, artefactos históricos intactos. Incluye **mutaciones con expectativa invertida**.
- **Arnés local (PostgreSQL 18), 86/86.** Usa los archivos reales con las constantes de datos del arnés y aplica como mensaje único.
  - **Aplicación:** PRE, PASO 2, ESTADO y VERIFICACIÓN POST Z = 0; no reaplicable.
  - **Contrato por rol:** `anon`/`authenticated`/`service_role`/rol sin grants; lectura directa denegada.
  - **Fixture HN/GT:** país deshabilitado (no aparece), unidades inactivas, padre inactivo, padre ajeno en ambos sentidos. País habilitado **sin niveles** (GT): aparece una vez con `level`/`level_label` NULL; SV conserva exactamente sus 3 niveles; VERIFICACIÓN POST Z = 0.
  - **Aplicación con GT habilitado sin niveles:** el POST de la migración pasa; la variante con JOIN interno la rechaza el POST («paises descubribles»).
  - **ESTADO:** MIXTO y ANOMALIA; la VERIFICACIÓN POST detecta un grant de tabla.
  - **Cadena de rollback:** el rollback real de `s7_95` se niega con `s7_96` aplicada y completa tras revertir `s7_96`. El rollback de `s7_96` se niega sin aplicar, con vista o función dependiente, con cuerpo cambiado y con ACL cambiada.
  - **13 mutaciones ejecutadas del PASO 2**, todas detectadas por el POST sin dejar funciones ni cambios: REVOKE sin `service_role`, GRANT a PUBLIC, INVOKER, columna extra, sin `directory_enabled`, sin validar país del padre, grant de tabla GEO, policy nueva, VOLATILE, `search_path` sin `pg_temp`, `has_children`, países sin niveles omitidos (JOIN interno), ISO normalizado.
  - **Deriva de datos:** PRE y GUARDA abortan; el PRE exige `postgres`.

---

## 10 · Compatibilidad con PostgreSQL 17.6 (revisión estática, no es prueba)

- Solo sintaxis disponible desde PG 12:
  - `RETURNS TABLE`, `#variable_conflict use_column`, `RETURN QUERY`;
  - `WITH ORDINALITY`, `jsonb_build_object`, `has_function_privilege`, `pg_get_function_result`;
  - `BEGIN ISOLATION LEVEL REPEATABLE READ`, `SET LOCAL ROLE` dentro de `DO`.
- `pg_auth_members.admin_option` existe en 17.
- Los planes de las consultas de los cuerpos se midieron en producción en el preflight F3E-1A: `au_country_level_active_idx`, `au_parent_active_idx` y `country_levels_pkey`, todas por debajo de 0,2 ms.
- **La compatibilidad quedará acreditada solo por la ejecución en producción.**

---

## 11 · Límites de fase

- **F3E-1 (esto):** solo las 2 RPC. Sin frontend. No mueve el HEAD funcional mientras nadie las consuma; sí mueve el inicio de la cadena de rollback.
- **F3E-2 (no iniciada):** consumo en runtime y filtro `clinics.country_id`.
- **F3E-3 (no iniciada):** UX y selector móvil.
- **`/{iso2}`:** OPEN / NOT APPROVED. No forma parte implícita de F3E-3.

---

## 12 · Aplicación en producción (2026-09-16) — APPLIED / VERIFIED

**Cómo se aplicó:** por bloques separados y byte-exactos, cada uno en una pestaña nueva, con los hashes
reconfirmados contra el blob remoto de PR #380 (`403b3bf`):

| Bloque | SHA-256 | Resultado |
|---|---|---|
| PASO 1 · PRE | `8c9799a592bcb6f2c3192df474792c974f08aa9e627291fa1d734faac838a578` | OK |
| PASO 2 · transacción | `dc34d217b664390309b71cc28a2b3da2a402aca13e997dd3171f5c6c1d788fcf` | COMMIT |
| ESTADO | `084e6dbad5e5961a537c09638bf0ea2ba61c625f8ea5eb245485c545a4856a64` | `S7_96 APLICADA COMPLETA` |
| VERIFICACIÓN POST | `3bdce63c2a15f8eba8baf9aed660ff65835c4edc1b397ea9b74337a1d3f2f3e7` | `Z = 0` |

**Evidencia:**

- **ESTADO:** `S7_96 APLICADA COMPLETA`; 2 funciones `directory_*`, las 2 exactas (firma, retorno,
  `STABLE`, `SECURITY DEFINER`, `search_path`, dueño `postgres`, cuerpo por md5).
- **VERIFICACIÓN POST Z = 0.** ACL exacta `anon=X/postgres,authenticated=X/postgres,postgres=X/postgres`
  en ambas; EXECUTE efectivo `anon` y `authenticated` sí, **`service_role` no** (42501).
- **Seguridad intacta:** catálogo GEO cerrado (4 tablas `{postgres=arwdDxtm/postgres}`, RLS, 0
  policies; lectura directa 42501 para `anon` y `authenticated`); `clinics` relacl, RLS y
  policies (`20ad37b9`) iguales. El PASO 2 comparó además la instantánea completa (policies,
  ACL/RLS, roles, membresías, esquemas, default privileges, triggers): solo +2 funciones.
- **Contrato:** `directory_countries()` = SV niveles 1 Departamento · 2 Municipio · 3 Distrito;
  países descubribles = todos los habilitados (`SV`); raíz de SV 14 unidades; hijos del padre
  con más hijos 20; los 7 contratos inválidos devuelven 0 filas.
- **Consumidores:** los rollbacks de `s7_92`/`s7_93` detectan exactamente las 2 RPC; el de
  `s7_94`, ninguna; el de `s7_95` cuenta 2; 0 objetos dependen de las RPC.
- **Datos sin cambios:** huella C2 de `clinics` `7cef00d1d24a004edbc4678fe6d41948`; clínicas
  `119|59|24|36|0`; directorio `46|46|0#43|43|0`.
- **PostgreSQL 17.6 acreditado por producción** (el arnés era PG18).

- Los cuerpos vivos casan con la variante CRLF del md5 (`54aeee13…` y `243b5124…`): el editor los
  recibió con saltos CRLF. Ambas variantes estaban previstas en el POST y en el ESTADO.
