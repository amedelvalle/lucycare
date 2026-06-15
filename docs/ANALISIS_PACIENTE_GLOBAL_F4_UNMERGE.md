# Análisis — Paciente Global Fase 4: Unmerge formal de fichas (reversa del merge)

> Documento de diseño (docs-only, sin código ni SQL). Diseña la reversa formal
> del merge admin de fichas `patients` (`admin_unmerge_patients`), apoyada en el
> `patient_merge_log` que ya nació preparado para esto (`s7_46`).
>
> Snapshot de referencia: HEAD `b2f611e`, migraciones hasta `s7_47`,
> PRs #1–#145. Base técnica: **`s7_46` (merge admin) — LIVE, solo referencia;
> NO se re-aplica ni se copia como migración nueva.** Complementa
> `docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md` (DM1–DM9, donde DM7 dejó
> la reversa formal "prevista desde el inicio").
>
> **Decisiones de diseño cerradas por el owner el 2026-06-15 (§12). La
> implementación (`s7_48`) NO arranca sin señal explícita del owner.**

---

## 1. Objetivo

Deshacer **una** fusión de fichas `patients` previamente ejecutada por
`admin_merge_patients`, devolviendo a la ficha **fuente** exactamente lo que se
le movió (las filas registradas en `moved_ids`) y restaurándola a su estado
previo desde `source_snapshot`, **sin tocar** lo que la ficha **destino**
acumuló después del merge, **sin tocar identidad global** y **sin corromper
historia clínica**.

Es una operación de **corrección** (revertir un merge reciente/erróneo), no un
flujo de uso cotidiano. El `patient_merge_log` ya guarda todo lo necesario para
una reversa precisa; esta fase construye el preflight + la RPC transaccional que
la ejecutan.

## 2. Alcance y no-goals

**Alcance (V1):**
- Revertir el **último** merge no revertido de un par fuente→destino
  intra-clínica, identificado por `p_merge_log_id`.
- Re-apuntar de vuelta (destino→fuente) **solo** las filas de `moved_ids`
  (`appointments`/`consultations`/`vitals`).
- Restaurar la ficha fuente desde `source_snapshot`.
- Marcar el log como revertido (append-only) + audit.

**No-goals (fuera de esta fase):**
- **NO** toca `profiles`, `auth.users`, roles, credenciales ni **identidad
  global** (eso es F4-D, diseño propio).
- **NO** desfusiona identidades; el unmerge solo revierte fichas `patients`.
- **NO** reescribe la ficha destino desde `target_snapshot` (el destino conserva
  su identidad propia + toda la historia post-merge).
- **NO** hard-delete de nada.
- **NO** reversa parcial: V1 es **atómica** (todo o nada).
- **NO** maneja cadenas (A→B→C) ni reversa fuera de orden: bloquea.
- **Sin UI** en el primer PR (la UI es un PR posterior separado).

## 3. Campos de `patient_merge_log` usados en la reversa

| Campo | Uso |
|---|---|
| `moved_ids` `{appointment_ids[], consultation_ids[], vitals_ids[]}` | **Núcleo de la reversa.** Conjunto exacto a devolver destino→fuente. Lo que el destino creó después **no está aquí** → permanece en el destino. |
| `source_snapshot` (`to_jsonb(source)` pre-merge) | Restaura la fuente: `is_active`, `profile_id`, `document_number`, `document_type`, y limpia `merged_into_patient_id`/`merged_at`. |
| `target_snapshot` (pre-merge) | **Solo** auditoría / diff / warnings. El destino **no** se reescribe desde aquí. |
| `moved_counts` | Cifra de control: comparar contra lo realmente devuelto (detectar drift). |
| `source_patient_id` / `target_patient_id` | Identifican el par. |
| `clinic_id` | Clínica original del merge: la fuente y el destino deben seguir en ella. |
| `merged_by` / `reason` / `evidence` / `created_at` | Trazabilidad mostrada en el preflight (incl. warning si el merge es viejo). |
| `unmerged_at` / `unmerged_by` / `unmerge_reason` | **Ya existen, NULL hoy.** El unmerge los **rellena** (append-only). `unmerged_at IS NOT NULL` ⇒ ya revertido (idempotencia). |

**No requiere cambios de esquema en `patient_merge_log`.**

## 4. Diseño de `admin_unmerge_patients_preflight(p_merge_log_id)` (read-only)

Gate `is_admin()` (`P0001`). `SECURITY DEFINER`, `STABLE`. Devuelve **solo
metadatos** (sin contenido clínico). Validaciones:

1. El log **existe** y **no está revertido** (`unmerged_at IS NULL`).
2. Fuente y destino **existen**.
3. **La fuente sigue exactamente en el estado fusionado esperado hacia el
   destino** (refinamiento del owner):
   - `is_active = false`;
   - `merged_into_patient_id = target_patient_id`;
   - `merged_at IS NOT NULL`;
   - `clinic_id = log.clinic_id`;
   - sin cambios inesperados en campos críticos frente al estado neutralizado
     esperado (la fuente no fue reactivada/editada por fuera).
4. **El destino sigue siendo revertible:**
   - `target.merged_into_patient_id IS NULL` (no fue fusionado hacia un tercero);
   - `target.clinic_id = log.clinic_id`.
5. **Integridad de `moved_ids`:** cada fila registrada **sigue existiendo y sigue
   apuntando al destino**. Si alguna falta o se re-apuntó → bloqueo (impide
   reversa atómica).
6. **Factibilidad de restaurar el documento:** restaurar
   `source_snapshot.document_number` **no** debe violar el
   `UNIQUE(clinic_id, document_type, document_number)` hoy (el destino u otra
   ficha pudo tomar ese documento vía sync). Si colisiona → bloqueo.
7. **Existencia del profile a restaurar:** si `source_snapshot.profile_id` no es
   NULL, ese `profiles.id` **debe existir** hoy. Si no existe → bloqueo
   (refinamiento del owner; ver `P0077` en §6).
8. **Historia nueva en el destino** (informativo, **no bloquea**): conteo de
   filas del destino que **no** están en `moved_ids` (se quedan).

Salida: veredicto `eligible` / `block_code` + explicación, conteos a devolver,
warnings (§7), metadatos del merge. La RPC de unmerge **revalida todo**; el
preflight es informativo.

## 5. Diseño de `admin_unmerge_patients(p_merge_log_id, p_reason)` (transaccional)

`SECURITY DEFINER`. Pasos:

1. `is_admin()` (`P0001`) + **motivo ≥ 10** (`P0076`).
2. Cargar el log; `FOR UPDATE` sobre fuente y destino.
3. **Revalidar toda la elegibilidad server-side** (mismas reglas del §4; el
   preflight no es autoritativo).
4. Activar **bypass GUC propio** `app.unmerging_patients = 'on'`
   (transaction-local) — reconocido por los dos guards (§8).
5. **Devolver destino→fuente** las filas de `moved_ids` que **hoy siguen en el
   destino**: `UPDATE {appointments|consultations|vitals}
   SET patient_id = source WHERE id = ANY(moved_ids.*) AND patient_id = target`.
   (Si la revalidación detectó drift, ya se bloqueó en el paso 3 — nunca se
   ejecuta media reversa.)
6. **Restaurar la fuente** desde `source_snapshot`: `is_active = true`,
   `profile_id` = snapshot, `document_number` = snapshot (ya validado sin
   colisión), `document_type` = snapshot, `merged_into_patient_id = NULL`,
   `merged_at = NULL`, `updated_at = now()`.
7. **Destino intacto** salvo `updated_at` (conserva identidad + historia
   post-merge). **Nunca** se reescribe desde `target_snapshot`.
8. **Rellenar el log** (append-only): `unmerged_at = now()`,
   `unmerged_by = auth.uid()`, `unmerge_reason = p_reason`. Sin borrar ni
   insertar otra fila.
9. **Audit** `edited_via = 'admin_unmerge'` (fila explícita + triggers), con
   fuente, destino, conteos devueltos, motivo, `merge_log_id`, actor.
10. Apagar el GUC. Devolver resumen (conteos devueltos, fuente restaurada,
    `merge_log_id`).

## 6. Códigos de error (serie P0070+)

| Código | Significado | Cubre |
|---|---|---|
| `P0001` | No es admin de plataforma | gate |
| `P0070` | Log inexistente, o fuente/destino ya no existen | existencia |
| `P0071` | Merge ya revertido (`unmerged_at` no NULL) | idempotencia |
| `P0072` | La fuente no está en el estado fusionado esperado hacia el destino (`is_active≠false`, `merged_into≠target`, `merged_at` NULL, `clinic_id≠log`, o cambios inesperados) | estado fuente |
| `P0073` | El destino no es revertible: fusionado hacia un tercero (cadena) o `clinic_id≠log` | estado destino |
| `P0074` | Conflicto de documento al restaurar la fuente (violaría el `UNIQUE`) | restauración |
| `P0075` | `moved_ids` con drift: alguna fila ya no existe o ya no apunta al destino | reversa atómica |
| `P0076` | Motivo < 10 caracteres | motivo obligatorio |
| `P0077` *(propuesto)* | El `profile_id` de `source_snapshot` ya no existe → no se puede restaurar el vínculo previo | restauración / identidad |

> **Nota (a confirmar):** el owner pidió validar que el `profile` del snapshot
> exista antes de restaurar. Como es conceptualmente distinto del conflicto de
> documento (`P0074`), propongo asignarle un código propio **`P0077`** en vez de
> mezclarlo. Si el owner prefiere, se pliega bajo `P0074` ("restauración
> inviable") y la serie queda P0070–P0076. Pendiente de confirmar.

## 7. Warnings (informativos, NO bloquean)

- **`W_TARGET_NEW_HISTORY`** — el destino tiene filas posteriores al merge que
  **no** están en `moved_ids` (se conservan en el destino). Conteo a mostrar.
- **`W_OLD_MERGE`** — el merge es "viejo" (heurística de fecha, p. ej. > N días):
  se muestra como advertencia, **sin** bloquear por fecha (decisión 5).
- **`W_REMERGE_RISK`** — al revertir se reconstituye el estado E3 (dos fichas del
  mismo profile en la clínica) y el sync `s7_33` volverá a operar sobre ambas;
  recordatorio de que el unmerge es para revertir un merge reciente/erróneo.

## 8. Reglas de seguridad (vinculantes)

1. **admin-only** (`is_admin()`, `P0001`); RPCs `SECURITY DEFINER`, sin `anon`;
   `REVOKE` a `authenticated` salvo el gate interno (patrón `admin_*`).
2. **Dry-run obligatorio:** la UI fuerza el preflight; la RPC revalida todo
   (el preflight nunca es autoritativo).
3. **Motivo obligatorio** ≥ 10 (`P0076`), persistido en `unmerge_reason` + audit.
4. **Confirmación reforzada** (UI posterior): teclear `DESHACER FUSIÓN` (espejo
   de `FUSIONAR FICHAS`).
5. **Reversa atómica** (todo o nada). Sin reversa parcial en V1.
6. **No hard-delete:** la fuente se reactiva; nada del destino se borra.
7. **Log append-only:** solo rellenar `unmerged_at`/`unmerged_by`/
   `unmerge_reason`; nunca borrar ni reescribir los hechos del merge.
8. **Audit** en la reversa (`edited_via='admin_unmerge'`).
9. **No tocar `auth.users`, `profiles`, roles, credenciales ni identidad
   global.** El unmerge escribe **solo** en `patients` (+ sus
   `appointments`/`consultations`/`vitals`). Restaurar `source.profile_id` es
   re-vincular una **ficha local** (`patients.profile_id`), no modifica el
   profile global.
10. **Bypass GUC propio `app.unmerging_patients`** (transaction-local, seteado y
    apagado dentro de la RPC), añadido a los dos guards — **sin** reutilizar
    `app.merging_patients` (semántica y auditoría distintas):
    - `prevent_signed_consultation_edit` (`s7_29`): el re-point de una consulta
      **firmada** de vuelta lo dispara.
    - `prevent_linked_patient_identity_edit` (`P0030`, `s7_33`): reactivar/
      relinkear la fuente cambia campos de identidad local.
    Los bypass previos (`app.amending`, `app.merging_patients`,
    `app.syncing_patient_identity`) quedan **intactos**.
11. **No desfusionar identidades globales** (F4-D, fuera de alcance).

## 9. Plan de `s7_48` (backend-only)

Migración **`s7_48`** (la siguiente libre; `s7_46`/`s7_47` ya aplicadas, no se
tocan):
- `CREATE OR REPLACE` de los dos guards añadiéndoles el bypass
  `app.unmerging_patients` (una línea cada uno; el resto idéntico).
- Helper interno read-only de elegibilidad de unmerge (espejo del patrón
  `_patient_merge_eligibility`: lo comparten preflight y RPC → misma lógica, sin
  drift).
- `admin_unmerge_patients_preflight(p_merge_log_id)` (dry-run).
- `admin_unmerge_patients(p_merge_log_id, p_reason)` (transaccional).
- Relleno de `unmerge_*` + audit `admin_unmerge`.
- `REVOKE`/`GRANT` (patrón `admin_*`: sin anon, `authenticated` solo por el gate
  interno).
- **`database.types.ts`** actualizado en el mismo PR (firmas de las 2 RPCs).
- **Sin UI.** No toca `patient_merge_log` (esquema), `profiles`, `auth.users`.

## 10. Plan de check / smoke / fixtures

- **`check-s7_48.mjs`** — estructura: las 2 RPCs existen, gate admin (`P0001`),
  guards reconocen `app.unmerging_patients`, log con `unmerge_*` presente.
- **`_smoke-s7_48.mjs`** — OTP con admin real + `service_role` para fixtures.
  Casos:
  1. merge → unmerge feliz: reversa **exacta** (filas devueltas a la fuente,
     fuente restaurada desde snapshot, log con `unmerge_*`, audit
     `admin_unmerge`).
  2. **idempotencia:** re-unmerge → `P0071`.
  3. **historia nueva en el destino se conserva** (crear una consulta en el
     destino tras el merge; el unmerge no la toca).
  4. **`moved_id` faltante/re-apuntado → `P0075`** (reversa bloqueada, no
     parcial).
  5. **conflicto de documento → `P0074`**.
  6. **cadena / destino fusionado a un tercero → `P0073`**.
  7. **fuente reactivada/fuera de estado → `P0072`**.
  8. **consulta firmada** devuelta a la fuente sin violar el guard (bypass OK).
  9. *(si se confirma `P0077`)* profile del snapshot inexistente → bloqueo.
- **Fixtures aisladas:** dev-script con marcador propio (p. ej. `F48_FIXTURE`),
  `--apply`/`--clean`, **verificación de 0 residuales**, **nunca** datos reales,
  **jamás** Camilo (`db1fba98…`) ni Katherine (`50372608827`). Profile/clínica/
  doctor throwaway, como en `_fixtures-merge-ui.mjs`.

## 11. UI posterior (PR separado)

PR aparte, frontend-only, sobre `/admin/pacientes`:
- En el **historial de fusiones**, acción **"Deshacer fusión"** por fila (solo si
  `unmerged_at IS NULL`).
- **Dry-run visible** (resultado del preflight: qué se devuelve, qué se conserva
  en el destino, warnings) + **motivo obligatorio** + **confirmación reforzada**
  (teclear `DESHACER FUSIÓN`).
- Manejo de éxito/errores `P0070–P0077` por `error.code` (copy ES, patrón
  `MERGE_BLOCK_COPY`), invalidación de candidatos + historial.
- **Sin contenido clínico, sin JSON crudo.** Validación **solo con fixtures**.
- Cadencia espejo de F4-2 → F4-3: `s7_48` backend+smoke primero, UI después.

## 12. Decisiones cerradas por el owner (2026-06-15)

1. **Conflicto de documento:** V1 **bloquea** (`P0074`); **no** restaura con
   `document_number = NULL`.
2. **Historia nueva en el destino:** **no** bloquea; se muestra como
   warning/informativo (`W_TARGET_NEW_HISTORY`). Lo que **sí** bloquea es que una
   fila de `moved_ids` ya no exista o no apunte al destino (`P0075`).
3. **Reversa atómica** (todo o nada). Sin reversa parcial por ahora.
4. **GUC propio `app.unmerging_patients`** (no reutilizar `app.merging_patients`).
5. **Sin límite temporal** para revertir; un merge viejo puede aparecer como
   warning (`W_OLD_MERGE`), **no** bloquea por fecha.

**Refinamientos del owner incorporados:** validar que la fuente siga
exactamente en estado fusionado hacia el destino (is_active=false /
merged_into=target / merged_at no NULL / misma clinic_id / sin cambios
inesperados); validar existencia del `profile_id` del snapshot antes de
restaurar; no reescribir el destino desde `target_snapshot`; bloquear si el
destino fue fusionado hacia un tercero; bloquear si fuente o destino ya no están
en la clínica original del log; no tocar `profiles`/`auth.users`/roles/
credenciales/identidad global; no hard-delete; log append-only.

**Pendiente único de confirmar:** si el "profile del snapshot ya no existe" usa
código propio `P0077` (propuesto) o se pliega bajo `P0074` (§6).

## 13. Relación con otros docs

- `docs/ANALISIS_PACIENTE_GLOBAL_FASE4_MERGE_ADMIN.md` — DM1–DM9 (DM7 dejó la
  reversa formal prevista; este doc la diseña).
- `docs/ANALISIS_PACIENTE_GLOBAL_OWNERSHIP.md` — marco D1–D7 (la identidad la
  gobierna Lucy; el unmerge no la toca).
- `s7_46` (LIVE) — base técnica de referencia: `patient_merge_log`,
  `_patient_merge_eligibility`, `admin_merge_patients(_preflight)`, bypass
  `app.merging_patients`. **No se re-aplica ni se copia.**
