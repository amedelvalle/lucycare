# OWNER — Plan de la primera QA real de `admin-create-seed-doctor`

> **NO EJECUTADO.** Este documento es el plan; ninguna de sus acciones se corrió.
> Requiere autorización expresa del owner, paso por paso.
>
> Es la **primera invocación real** de la Edge Function. Todo lo anterior
> (deploy, `s7_73`, `s7_74`, DB smoke) está cerrado; lo único sin validar es el
> camino que atraviesa el runtime Deno y el Admin API.

---

## 1. Orden real de ejecución en la Edge Function

Trazado sobre `supabase/functions/admin-create-seed-doctor/index.ts`.

| # | Etapa | Línea | Escribe |
|---|---|---|---|
| 1 | `Deno.serve` · `OPTIONS` · método ≠ POST | 169-172 | no |
| 2 | `Authorization: Bearer …` (solo el prefijo) | 174-175 | no |
| 3 | `Idempotency-Key` con forma de uuid | 177-178 | no |
| 4 | `req.json()` | 181-183 | no |
| 5 | **`runtimeKey('SUPABASE_PUBLISHABLE_KEYS', …)`** | **195** | no |
| 6 | **`runtimeKey('SUPABASE_SECRET_KEYS', …)`** | **196** | no |
| 7 | `createClient` asAdmin (publishable + JWT) / asService (secret) | 202 / 207 | no |
| 8 | `normalizePayload` + `payloadHash` server-side | 212-213 | no |
| 9 | **`admin_claim_seed_operation(operation_id, payload_hash)`** — aquí corre `is_admin()` | **243** | **sí** (fila en `admin_seed_operations`) |
| 10 | `admin_lookup_seed_user(operation_id)` | 282 | no |
| 11 | **`asService.auth.admin.createUser(...)`** | **290** | **sí** (`auth.users` + `profiles` por `handle_new_user`) |
| 12 | `admin_seed_operation_set_auth_created(...)` | 325 | sí |
| 13 | **`admin_create_seed_doctor(…, p_payload, …)`** — aquí viven **D1/`P0129`**, `profiles`, `clinics`, `doctors`, `doctor_credentials`, `audit_log` | **335** | **sí** |
| 14 | Compensación: `mark_failed` → `deleteUser` → `flag_compensation_failed` | 343-380 | sí |

**El JWT del admin** no se valida en la función: el gateway lo verifica antes del
boot (`verify_jwt=true`), y `is_admin()` se evalúa **en la base**, dentro de la
RPC del paso 9.

### Respuesta inequívoca sobre `P0129`

> ### `P0129` ocurre **DESPUÉS** de `createUser`.

`admin_claim_seed_operation` (paso 9) recibe **solo** `(operation_id,
payload_hash)`: **no ve el payload**, así que no puede evaluar D1. El payload
llega recién a `admin_create_seed_doctor` (paso 13, `p_payload`), que es donde
vive la guarda D1.

**Consecuencia:** un envío con D1 incompleto **crea el `auth.users` técnico**
(paso 11), lo registra (paso 12), falla en el paso 13 con `P0129`, y entonces
dispara la compensación: `mark_failed` → `deleteUser`. Es decir, **crea y borra
una identidad Auth solo para probar el cold boot**.

### Decisión: **QA-1 se elimina**

El probe negativo que había propuesto **no era sin escrituras**. Mi afirmación
anterior —"si responde `P0129` ya demostró el cold boot sin escribir nada"— era
**incorrecta**, y la corrijo acá. Queda fuera del plan.

**¿Existe algún probe realmente no-write con valor?** En teoría dos, ninguno
practicable por la superficie autorizada:

| Probe teórico | Qué probaría | Por qué no sirve |
|---|---|---|
| `Idempotency-Key` malformada → `bad_request` (paso 3) | cold boot y `Deno.serve` | corta **antes** de resolver credenciales, así que no prueba lo que importa; y la UI siempre genera un uuid válido, así que exige una petición manual |
| JWT **no-admin** → `P0120` en el paso 9, antes del INSERT | cold boot + ambas credenciales resueltas + publishable **aceptada por el gateway** + gate `is_admin()` | LucyAdmin está guardada: un no-admin **no llega al modal**. Requeriría manipular un JWT a mano, algo ya descartado |

**Conclusión: no hay probe no-write alcanzable desde la UI.** Se acepta que la
**primera invocación sea directamente la QA controlada exitosa**.

---

## 2. Qué valida esta QA

| Objetivo | Cómo se demuestra |
|---|---|
| **Cold boot real de la Edge** | responde un JSON propio, no un error de plataforma |
| **`SUPABASE_SECRET_KEYS['default']`** | `createUser` funciona ⇒ resuelta **y aceptada por el Admin API** |
| **`SUPABASE_PUBLISHABLE_KEYS['default']`** | las RPCs responden ⇒ resuelta **y aceptada por el gateway** |
| **JWT real de LucyAdmin** | `is_admin()` abre en la base |
| **`auth.admin.createUser`** | existe un `auth.users` con el email determinístico |
| **Creación completa** | `profiles` + `clinics` + `doctors` + `doctor_credentials` + `audit_log` |
| **Invariantes preclaim** | `listed_only` · `booking_enabled=false` · `is_operational=true` · **0 `clinic_members`** |
| **Publicación con D1** | `is_published=true` con nombre + especialidad + clínica + dirección |
| **`claim_ready`** | `true` con teléfono utilizable por Auth **y** JVPM |
| **URL / slug** | `doctors.slug` generado por el trigger de `s7_52` |

**Fuera de alcance:** el Claim del médico, el envío de OTP, carga y concurrencia.

---

## 3. Precondiciones

1. `s7_73` y `s7_74` **aplicadas** — ✅.
2. Edge **`ACTIVE` v2** — ✅.
3. **Superficie — resuelta y verificada (2026-08-23):**
   `https://lucycare-git-claude-seed-doctor-amedelvalles-projects.vercel.app`
   — alias de rama del Preview de Vercel; hay deployment para el HEAD `fb5cdbc`.
   **CORS = PASS**: ese origin encaja en el segundo patrón de la whitelist de la
   Edge, `^https://lucycare-[a-z0-9-]+\.vercel\.app$`, probado contra la
   expresión real del código. No se tocó Vercel, dominios ni CORS.
4. **No hay base de staging:** el Preview escribe en el **Supabase de
   producción**. Por eso el cleanup es parte del plan.
5. Sesión de **LucyAdmin real** en ese Preview.

---

## 4. Fixtures — 100 % sintéticas

| Campo | Valor | Nota |
|---|---|---|
| `full_name` | `QA Seed S7-73 Perfil de Prueba` | evidentemente de prueba; no es una persona |
| `specialty_id` | `9d206032-784d-458e-901f-e30bba7d180d` | **Medicina General** — ya existía en el catálogo. D1 la exige |
| `clinic_name` | `Clínica QA Seed S7-73` | sintética |
| `clinic_address` | `Av. Sintética 73, San Salvador — fixture QA` | sintética; D1 la exige |
| `clinic_phone` | `22220073` | público, fijo evidentemente falso |
| `claim_phone` | **`<<OWNER_CONTROLLED_QA_PHONE>>`** | **lo introduce el owner al ejecutar** |
| `jvpm` | `QA-S773-0001` | QA-0 verifica que no exista |
| `email` | `qa-seed-s773@doctor-seed-qa.invalid` | no resoluble (RFC 2606) |
| `publish` | `true` | invariante P0 |
| `bio`, `consultation_fee`, `experience_years`, `department_id`, `municipality_id` | `null` | **la UI no los expone**: viajan siempre `null` (deuda registrada) |

> 🔒 **`<<OWNER_CONTROLLED_QA_PHONE>>`.** Es un placeholder deliberado. El número
> **no se hardcodea, no entra a Git, no aparece en logs ni en el reporte de
> cierre.** El owner lo escribe directamente en el formulario al ejecutar la QA.
> **No se envía ningún SMS**: este flujo no dispara OTP. Su único fin es validar
> `claim_ready=true`, y desaparece en el cleanup.

> ⚠️ **`publish=true`** deja el perfil visible en Home y sitemap durante la
> ventana de QA. Se acepta por ser un invariante P0, con **cleanup inmediato**
> tras las comprobaciones y verificación posterior de desaparición (§8).

---

## 5. Pasos

### QA-0 · Preparación read-only

La especialidad ya está resuelta (§4), así que aquí solo queda:

```sql
-- El JVPM de la fixture NO debe existir
SELECT count(*) AS jvpm_existente
  FROM public.doctor_credentials
 WHERE type = 'JVPM' AND btrim(value) = 'QA-S773-0001';

-- Baseline para el cleanup
SELECT
  (SELECT count(*) FROM public.doctors)               AS doctores_antes,
  (SELECT count(*) FROM public.clinics)               AS clinicas_antes,
  (SELECT count(*) FROM public.admin_seed_operations) AS seedops_antes;
```

**PASS:** `jvpm_existente = 0`; baselines anotados.
**FAIL:** `jvpm_existente > 0` → **STOP**, elegir otro JVPM.

> El teléfono no se pre-verifica por SQL para no dejarlo escrito en ninguna
> consulta. La RPC ya lo protege: `P0128` si pertenece a otro médico, `P0133` si
> no es utilizable por Auth. Ambos fallan **antes** de escribir el médico.

### QA-1 · Creación completa (primera invocación real)

Abrir el modal de LucyAdmin en el Preview, completar la fixture (con el teléfono
del owner) y enviar **una sola vez**.

**PASS:** `{ doctor_id, clinic_id, slug, is_published: true, claim_ready: true }`.
**FAIL:** cualquier error → ir a §9.

### QA-2 · Idempotencia

**Sin recargar la página**, reenviar el mismo formulario (la UI conserva la
`Idempotency-Key`).

**PASS:** mismos `doctor_id`, `clinic_id`, `slug`, `is_published`; **no** se crea
un segundo médico.
**FAIL:** un segundo `doctor_id`, o respuesta sin `slug`/`is_published`.

### QA-3 · Verificación en base (read-only)

```sql
-- <DOCTOR_ID> = el devuelto en QA-1
SELECT d.id, d.slug, d.lucy_status, d.is_published, d.is_operational,
       d.booking_enabled, d.is_verified,
       p.full_name, p.email, p.role,
       (p.phone IS NOT NULL) AS tiene_claim_phone,   -- no se imprime el número
       c.name AS clinica, c.address_line, c.phone AS clinic_phone, c.owner_id
  FROM public.doctors d
  JOIN public.profiles p ON p.id = d.profile_id
  JOIN public.clinics  c ON c.id = d.clinic_id
 WHERE d.id = '<DOCTOR_ID>';

SELECT type, value, status FROM public.doctor_credentials
 WHERE doctor_id = '<DOCTOR_ID>';

SELECT count(*) AS miembros FROM public.clinic_members
 WHERE clinic_id = '<CLINIC_ID>';

SELECT status, error_code, seed_user_id, doctor_id, clinic_id
  FROM public.admin_seed_operations WHERE operation_id = '<OPERATION_ID>';

SELECT user_id, action, table_name, record_id
  FROM public.audit_log
 WHERE table_name = 'doctors' AND record_id = '<DOCTOR_ID>';
```

**Criterios PASS — todos obligatorios:**

| Verificación | Esperado |
|---|---|
| `lucy_status` | **`listed_only`** |
| `booking_enabled` | **`false`** |
| `is_operational` | **`true`** |
| `is_published` | **`true`** |
| `is_verified` | `false` |
| `slug` | no vacío |
| `profiles.role` | **`patient`** (correcto pre-claim) |
| `tiene_claim_phone` | **`true`** — el número **no se imprime** |
| `clinics.phone` | `22220073`, distinto del de claim |
| `clinics.owner_id` | el profile técnico |
| `doctor_credentials` | 1 fila, `JVPM`, `status='pending'` |
| **`clinic_members`** | **0 filas** |
| `admin_seed_operations` | `status='completed'`, `error_code` nulo |
| `audit_log.user_id` | **uuid del admin real**, no nulo |

**Anotar `seed_user_id`**: sale de esta consulta y es imprescindible para el
cleanup (la Edge **no lo devuelve** al cliente, por diseño).

### QA-4 · Identidad técnica

Dashboard → Authentication → Users → buscar
`seed-<OPERATION_ID>@doctor-seed.invalid`.

**PASS:** existe · **baneada** · **sin teléfono** · **sin contraseña** · **no
confirmada** · `app_metadata.lucy_seed_doctor = true`.

### QA-5 · Superficie pública

Abrir `https://lucycare.app/doctor/<slug>`.

**PASS:** renderiza, muestra **"Sin agenda en línea"**, **no ofrece reservar**.

---

## 6. Evidencia a registrar

`operation_id` · `doctor_id` · `clinic_id` · `seed_user_id` · `slug` · las
respuestas JSON de QA-1 y QA-2 · las salidas de QA-3 · capturas de QA-4 y QA-5.

**Nunca** se registra el `claim_phone`.

**Registros creados:** 1 `auth.users` · 1 `profiles` · 1 `clinics` · 1 `doctors`
· 1 `doctor_credentials` · 1 `admin_seed_operations` · 1 `audit_log`.

---

## 7. Cleanup — orden operativo **A → B → C → D**

> **El orden es vinculante.** La verificación de la identidad Auth va **antes**
> del SQL, para no borrar filas de negocio si resulta que el `seed_user_id`
> capturado no es la fixture. Y el borrado del usuario va **después** del
> `COMMIT`, porque `clinics.owner_id` es `NOT NULL` hacia el profile técnico.

### A · Dry-run de Auth — **antes** del SQL, no borra nada

```bash
node scripts/_qa-s7_73-cleanup-user.mjs \
  --project-ref kvrsfmzlrmmmavillpuj \
  --operation-id <OPERATION_ID> \
  --seed-user-id <SEED_USER_ID>
```

Sin `--confirm`. Confirma, sin tocar nada:

| # | Guarda |
|---|---|
| 0 | **proyecto Supabase correcto** — el ref de `SUPABASE_URL` coincide con `--project-ref` |
| — | **credencial = secret key moderna** `sb_secret_…`; **el valor no se imprime** |
| 1 | el `id` coincide con `--seed-user-id` |
| 2 | `email = seed-<operation_id>@doctor-seed.invalid` |
| 3 | `app_metadata.lucy_seed_doctor = true` |
| 4 | `app_metadata.seed_operation_id` exacto |
| 5 | usuario **baneado** (`banned_until` futuro) |
| 6 | **`phone` NULL** |

Localiza con **`getUserById`** — nunca `listUsers`, nunca SQL sobre `auth.users`.
**No lee `SUPABASE_SERVICE_ROLE_KEY`**: exige `SUPABASE_SECRET_KEY` y aborta si
falta, si trae un JWT legacy (`eyJ…`) o si no tiene el prefijo `sb_secret_`.

**Si cualquier guarda falla: STOP.** No se continúa al paso B.

### B · Cleanup SQL — solo tras un dry-run PASS

Reemplazar los cuatro placeholders por los IDs capturados. **Un solo bloque, una
sola ejecución.** Cualquier guarda que no coincida aborta la transacción entera
y **no borra nada**.

```sql
BEGIN;

DO $cleanup$
DECLARE
  OP  constant uuid := '<<OPERATION_ID>>';
  SU  constant uuid := '<<SEED_USER_ID>>';
  DOC constant uuid := '<<DOCTOR_ID>>';
  CLI constant uuid := '<<CLINIC_ID>>';
  NOMBRE constant text := 'QA Seed S7-73 Perfil de Prueba';
  v_n int;
BEGIN
  -- G1. La operación es la de la QA y apunta a estos ids.
  SELECT count(*) INTO v_n FROM public.admin_seed_operations
   WHERE operation_id = OP AND status = 'completed'
     AND seed_user_id = SU AND doctor_id = DOC AND clinic_id = CLI;
  IF v_n <> 1 THEN RAISE EXCEPTION 'G1 falló: la operación no coincide (% filas)', v_n; END IF;

  -- G2. El médico es el de la fixture, por nombre Y por profile técnico.
  SELECT count(*) INTO v_n FROM public.doctors d
    JOIN public.profiles p ON p.id = d.profile_id
   WHERE d.id = DOC AND d.profile_id = SU
     AND p.full_name = NOMBRE AND d.lucy_status = 'listed_only';
  IF v_n <> 1 THEN RAISE EXCEPTION 'G2 falló: el doctor no es la fixture (% filas)', v_n; END IF;

  -- G3. La clínica pertenece al profile técnico.
  SELECT count(*) INTO v_n FROM public.clinics
   WHERE id = CLI AND owner_id = SU;
  IF v_n <> 1 THEN RAISE EXCEPTION 'G3 falló: la clínica no es la fixture (% filas)', v_n; END IF;

  -- G4. Sin miembros: nada humano colgando de esta clínica.
  SELECT count(*) INTO v_n FROM public.clinic_members WHERE clinic_id = CLI;
  IF v_n <> 0 THEN RAISE EXCEPTION 'G4 falló: la clínica tiene % miembros', v_n; END IF;

  -- G5. Sin citas ni pacientes: si los hubiera, NO es una fixture limpia.
  SELECT count(*) INTO v_n FROM public.appointments WHERE doctor_id = DOC;
  IF v_n <> 0 THEN RAISE EXCEPTION 'G5 falló: el doctor tiene % citas', v_n; END IF;

  -- ── Borrado, en orden de FK ──
  DELETE FROM public.admin_seed_operations WHERE operation_id = OP;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'D1 falló: % filas en admin_seed_operations', v_n; END IF;

  DELETE FROM public.doctor_credentials WHERE doctor_id = DOC;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'D2 falló: % filas en doctor_credentials', v_n; END IF;

  DELETE FROM public.doctors WHERE id = DOC;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'D3 falló: % filas en doctors', v_n; END IF;

  DELETE FROM public.clinics WHERE id = CLI;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'D4 falló: % filas en clinics', v_n; END IF;

  -- POST. El profile técnico sigue vivo: lo elimina el Admin API por cascada.
  SELECT count(*) INTO v_n FROM public.profiles WHERE id = SU;
  IF v_n <> 1 THEN RAISE EXCEPTION 'POST falló: el profile técnico no está (%)' , v_n; END IF;
END $cleanup$;

COMMIT;
```

> ⚠️ **El orden no es negociable.** `admin_seed_operations` referencia
> `doctors.id` y `clinics.id`; `doctor_credentials` referencia `doctors.id`; y
> `clinics.owner_id` es `NOT NULL` hacia el profile técnico. Intentar borrar el
> usuario antes que la clínica falla por FK — es la deuda de la §I del handoff
> vuelta operativa.
>
> ⚠️ **`audit_log` NO se borra.** Es inmutable desde `s7_71b` y se conserva como
> evidencia, igual que en el Booking E2E. **No es un residuo.**

### C · Borrado del `auth.user` — **después** del `COMMIT`

El **mismo** script, ahora con `--confirm`:

```bash
node scripts/_qa-s7_73-cleanup-user.mjs \
  --project-ref kvrsfmzlrmmmavillpuj \
  --operation-id <OPERATION_ID> \
  --seed-user-id <SEED_USER_ID> \
  --confirm
```

Vuelve a evaluar las mismas guardas antes de borrar. `deleteUser` cascadea el
profile por la FK `profiles.id → auth.users(id)`, y el script confirma con
`getUserById` que la identidad ya no existe.

---

## 8. D · POST-check — verificación de cero residuos

```sql
SELECT
  (SELECT count(*) FROM public.doctors               WHERE id = '<<DOCTOR_ID>>')            AS doctor,
  (SELECT count(*) FROM public.clinics               WHERE id = '<<CLINIC_ID>>')            AS clinica,
  (SELECT count(*) FROM public.doctor_credentials    WHERE doctor_id = '<<DOCTOR_ID>>')     AS credencial,
  (SELECT count(*) FROM public.admin_seed_operations WHERE operation_id = '<<OPERATION_ID>>') AS operacion,
  (SELECT count(*) FROM public.profiles              WHERE id = '<<SEED_USER_ID>>')         AS profile;
```

Y las dos comprobaciones que el SQL anterior no cubre:

```sql
SELECT
  (SELECT count(*) FROM public.clinic_members WHERE clinic_id = '<<CLINIC_ID>>') AS miembros,
  (SELECT count(*) FROM public.appointments   WHERE doctor_id = '<<DOCTOR_ID>>') AS citas;
```

**PASS — todo lo siguiente:**

| Verificación | Esperado |
|---|---|
| `operacion` · `doctor` · `clinica` · `credencial` | **0** cada uno |
| **`profile` técnico** | **0** — cascadeado por `deleteUser` |
| `miembros` (`clinic_members`) | **0** |
| `citas` (`appointments`) | **0** |
| **`getUserById(seed_user_id)`** | **identidad inexistente** — lo confirma el propio script en el paso C |
| `https://lucycare.app/doctor/<slug>` | **ya no devuelve el perfil** |
| Home / directorio | el perfil **no aparece** |
| `https://lucycare.app/sitemap.xml` | el slug **no aparece** — sujeto solo al comportamiento normal de caché/CDN, que no es un residuo |
| Conteos globales de QA-0 | **vueltos al baseline** |
| `audit_log` | **conservado** — evidencia, no residuo |

> Ninguna de estas verificaciones consulta `auth.users` por SQL: la identidad se
> comprueba exclusivamente por `getUserById`.

---

## 9. Si algo falla

- **Error de plataforma** (no un JSON tipado) → falló el cold boot. **STOP**,
  recoger el log de la función, reportar. No reintentar en bucle.
- **`internal` + `detail:"key_config"`** → una credencial del runtime no se
  resolvió. **STOP y reportar**: es el fail-closed funcionando.
- **Falla en el paso 13** (`P0128`, `P0129`, `P0130`, `P0133`…) → la Edge
  compensa sola: `mark_failed` → `deleteUser`. Revisar
  `admin_seed_operations.error_code`: si trae **`+compensation_failed`**, quedó
  un `auth.users` huérfano; borrarlo con el script de §7, que ya exige las seis
  guardas.
- **`compensation_failed` en la respuesta** → mismo caso anterior.
- **Cualquier estado inesperado** → **STOP y reportar antes de tocar nada.**

---

## 10. Decisiones pendientes del owner

Ninguna de instrumento: **especialidad y Preview quedaron resueltos y
verificados** sin intervención suya.

Queda **una sola entrada humana**: el **`<<OWNER_CONTROLLED_QA_PHONE>>`**, que el
owner escribe directamente en el formulario al ejecutar la QA. No se documenta,
no entra a Git, no aparece en logs ni en el reporte de cierre.

Y **una precondición de entorno** antes del cleanup: agregar
`SUPABASE_SECRET_KEY=<la secret key moderna>` a `.env.local`. El script de
cleanup **no acepta `SUPABASE_SERVICE_ROLE_KEY`** —ese nombre arrastra la
semántica de las legacy API keys, deshabilitadas en este proyecto— y aborta si
falta su variable propia. No hay fallback.
