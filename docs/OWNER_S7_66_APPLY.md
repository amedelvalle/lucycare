# OWNER — Aplicación y verificación de `s7_66` (AUTH-P1B1B / A)

> `s7_66` es **additive-only**: crea 3 funciones sobre las tablas inertes de
> `s7_65`. **NO** toca `appointments_insert`, grants de `appointments` ni el
> frontend. El bypass del INSERT directo del paciente lo cierra **`s7_67`**
> (paso C), **después** de desplegar el frontend (paso B). Rollback trivial:
> `DROP FUNCTION` las tres.

## §0 — Fix de `search_path` (causa raíz) y preflight de seguridad

**Causa raíz detectada (smoke E2E):** con la primera versión, `create_booking_with_intent`
usaba `SET search_path = ''`. Al insertar el paciente, dispara el trigger de
auditoría legacy **`audit_patients`** (`s4_02`), que hace `INSERT INTO audit_log …`
**sin calificar el esquema** y **sin fijar su propio `search_path`** → hereda el
del caller. Con `''` el trigger no resuelve `audit_log` y aborta con
**`42P01 relation "audit_log" does not exist`**, bloqueando toda creación de
cita. (register/validate no lo sufren: validate es read-only y register solo
escribe en tablas no auditadas.)

**Fix (solo esta función):** `create_booking_with_intent` pasa a
**`SET search_path = pg_catalog, public, pg_temp`** — el patrón de toda función
escritora del repo (s7_13/s7_20/s7_46/…). `validate_booking_slot` y
`register_booking_intent` **quedan en `''`**.

**Deuda técnica (NO se toca en este frente):** la causa de fondo es que los
triggers de auditoría legacy (`s4_02`: `audit_patients`/`audit_consultations`/
`audit_prescriptions`) dependen del `search_path` del caller. Calificarlos
(`public.audit_log` + `SET search_path` propio) los volvería inmunes y permitiría
`''` en todos lados; es un frente aparte.

**Deuda técnica separada — `audit_profiles_identity` (`s7_32`) + `service_role`:**
el trigger `audit_profiles_identity` (dispara `AFTER UPDATE OF full_name,
document_type, document_number, date_of_birth, gender, department_id,
municipality_id ON profiles`) inserta en `audit_log` con **`user_id = auth.uid()`
sin `COALESCE`**. Bajo `service_role` **no hay JWT → `auth.uid()` = NULL**, y
`audit_log.user_id` es **NOT NULL** → cualquier UPDATE de esas columnas de
`profiles` hecho por un script `service_role` **falla** con
`null value in column "user_id" … violates not-null constraint`. Misma clase que
`audit_patients` (arriba) y que el hallazgo del importador
(`import-doctors.mjs`). **Impacto más amplio que el smoke:** bloquea a cualquier
script `service_role` que actualice esas columnas de `profiles`. **NO se corrige
dentro de AUTH-P1B1B** (requeriría `COALESCE(auth.uid(), …)` + `actor_source`,
como se hizo en `s7_61`). Mitigación en el smoke: la fixture **no toca ninguna
columna auditada de `profiles`** y ancla la pertenencia AP66 por relaciones.

**Preflight de seguridad OBLIGATORIO antes del reapply** — incluir `public` en el
`search_path` es seguro **solo si** ningún rol de aplicación puede crear objetos
en el schema `public` (si pudiera, podría plantar objetos que resuelvan antes de
lo esperado). Ejecutar (read-only) y confirmar:

```sql
-- (a) Privilegio EFECTIVO de CREATE (incluye lo heredado de PUBLIC):
SELECT has_schema_privilege('anon',          'public', 'CREATE') AS anon_create,
       has_schema_privilege('authenticated', 'public', 'CREATE') AS authenticated_create;
-- Esperado: ambos FALSE.

-- (b) ¿Quién tiene CREATE sobre public? (PUBLIC aparece como grantee = 0)
SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS grantee
FROM pg_namespace n
CROSS JOIN LATERAL aclexplode(n.nspacl) acl
LEFT JOIN pg_roles r ON r.oid = acl.grantee
WHERE n.nspname = 'public' AND acl.privilege_type = 'CREATE'
ORDER BY 1;
-- Esperado: NINGÚN 'PUBLIC', 'anon' ni 'authenticated' en la lista
-- (solo el owner del schema / roles de sistema legítimos).
```

**Regla de decisión:** si (a) da TRUE para `anon` o `authenticated`, **o** (b)
lista `PUBLIC`/`anon`/`authenticated`, **DETENER el reapply**: no se considera
seguro incluir `public` en el `search_path`. En ese caso, primero
`REVOKE CREATE ON SCHEMA public FROM PUBLIC;` (y de anon/authenticated) —
o resolver la deuda técnica calificando los triggers de auditoría.

## Orden del frente AUTH-P1B1B

1. **A — `s7_66`** (esta): infraestructura RPC, additive.
2. **B — frontend**: `BookingCard`/`LoginModal`/`booking.service` pasan al camino de intents.
3. **C — `s7_67`**: `REVOKE INSERT … FROM anon` + `appointments_insert` = solo `is_clinic_member` (cierra el bypass). **Solo tras validar B en producción.**

## Aplicación

Ejecutar `migrations/s7_66_booking_intent_transaction.sql` completo en el SQL Editor. Esperado: `Success. No rows returned` (termina en `COMMIT`).

## A. Verificación estructural (post-aplicación)

```sql
-- A1. Las 3 funciones existen con la firma correcta
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('validate_booking_slot','register_booking_intent','create_booking_with_intent')
ORDER BY p.proname;
-- Esperado: las 3, prosecdef = true.

-- A2. EXECUTE por rol (matriz completa). Esperado:
--   validate_booking_slot        → todos false (helper interno)
--   register_booking_intent      → anon=true, authenticated=true; resto false
--   create_booking_with_intent   → authenticated=true; resto false
-- directory_editor / operations_admin NO son roles de Postgres (son
-- access_level en lucyadmin_access) → role_exists=false y las columnas quedan
-- NULL ("no hay tal grantee"): correcto, no tienen EXECUTE directo. El CASE
-- evita el error "role does not exist" de has_function_privilege.
SELECT r.rol,
       pr.rolname IS NOT NULL AS role_exists,
       CASE WHEN pr.rolname IS NULL THEN NULL ELSE has_function_privilege(r.rol, 'public.validate_booking_slot(uuid,uuid,timestamp without time zone)', 'EXECUTE') END AS validate,
       CASE WHEN pr.rolname IS NULL THEN NULL ELSE has_function_privilege(r.rol, 'public.register_booking_intent(uuid,uuid,timestamp without time zone,text)', 'EXECUTE') END AS register,
       CASE WHEN pr.rolname IS NULL THEN NULL ELSE has_function_privilege(r.rol, 'public.create_booking_with_intent(uuid,text,text)', 'EXECUTE') END AS create_
FROM (VALUES ('anon'),('authenticated'),('service_role'),('supabase_auth_admin'),('directory_editor'),('operations_admin')) AS r(rol)
LEFT JOIN pg_roles pr ON pr.rolname = r.rol
ORDER BY r.rol;
-- service_role y supabase_auth_admin: ahora false en las 3 (REVOKE explícito,
-- sin GRANT) — ya no es "no importa": es un invariante verificable.

-- A3. search_path POR FUNCIÓN (NO uniforme, a propósito)
SELECT proname, proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
  AND proname IN ('validate_booking_slot','register_booking_intent','create_booking_with_intent');
-- Esperado:
--   validate_booking_slot        → proconfig = {"search_path="}            (vacío)
--   register_booking_intent       → proconfig = {"search_path="}            (vacío)
--   create_booking_with_intent    → proconfig = {"search_path=pg_catalog, public, pg_temp"}
-- (create es la excepción necesaria por el trigger audit_patients — ver §0.)

-- A4. appointments_insert NO cambió (s7_66 es additive)
SELECT policyname, cmd, with_check
FROM pg_policies WHERE schemaname='public' AND tablename='appointments' AND policyname='appointments_insert';
-- Esperado: with_check aún contiene la rama del paciente (source='lucy_directorio').
-- s7_66 NO la toca; la cierra s7_67.
```

## B. QA runtime del claim `phone` del JWT (con una sesión telefónica real)

> Es la verificación que quedó pendiente del preflight: confirmar que
> `auth.jwt() ->> 'phone'` trae el teléfono en una sesión creada por OTP.
> **No se puede hacer desde el SQL Editor** (corre sin JWT de usuario). Dos
> vías; con cualquiera basta:

**Vía 1 — consola del navegador** (con una sesión de paciente ya iniciada en `lucycare.app`, sin exponer el token):
```js
// Decodifica el payload del JWT de la sesión actual (NO imprime el token):
const { data } = await window.supabase.auth.getSession();
const payload = JSON.parse(atob(data.session.access_token.split('.')[1]));
console.log('claim phone:', payload.phone);   // esperado: el teléfono en dígitos (p.ej. 50378627694)
```
Esperado: `payload.phone` presente y no vacío. Si fuera `undefined`, avisar **antes** del paso B del frontend (la decisión de "solo JWT phone" debería reabrirse).

**Vía 2 — el smoke `_smoke-s7_66.mjs`** ya lo prueba de punta a punta: `create_booking_with_intent` lee `auth.jwt()->>'phone'`, lo canonicaliza y lo compara con el intent. Si T5 pasa, el claim existe y funciona. (Requiere autorización separada de `service_role` + Test Phone `50370006601`.)

## C. Verificación de comportamiento (opcional, en el SQL Editor)

No se puede llamar el hook de reserva como un paciente desde el editor (no hay
JWT), pero sí se puede sanity-check `validate_booking_slot` como `postgres`
contra una fixture propia y **revertir**:

```sql
DO $$
DECLARE r record;
BEGIN
  -- (crear fixtures sintéticas AP66 acá si se desea, llamar
  --  public.validate_booking_slot(...) y hacer RAISE del resultado)
  RAISE EXCEPTION 'C: verificación manual — revertir';
END $$;
```
(La matriz completa —incluida la de rechazos P0092–P009E— vive en
`_smoke-s7_66.mjs`, que es el instrumento oficial.)

## Códigos de error (tabla definitiva; para el frontend en el paso B)

**register_booking_intent (anon, pre-OTP) — SOLO devuelve códigos públicos:**

| P-code | Significado | Copy sugerido |
|---|---|---|
| `P0095` | teléfono inválido | "El número de teléfono no es válido." |
| `P009F` | horario no disponible (genérico) | `SLOT_TAKEN_MESSAGE` / disponibilidad — **agrupa** médico no reservable, servicio inválido, fecha pasada, fuera de grilla, override, grilla ambigua y slot ocupado, sin enumerar al médico |
| `P009G` | demasiadas solicitudes vigentes | "Tenés varias reservas en curso. Esperá unos minutos." |

**create_booking_with_intent (authenticated, post-OTP) — códigos específicos:**

| P-code | Significado | Copy sugerido |
|---|---|---|
| `P0092` | intent inexistente | "No encontramos tu reserva. Empezá de nuevo." |
| `P0093` | intent ya consumido | "Esta reserva ya se completó." |
| `P0094` | intent vencido | "La reserva expiró. Elegí el horario otra vez." |
| `P0095` | teléfono JWT ausente/inválido | genérico de sesión |
| `P0096` | teléfono ≠ intent | "El teléfono de tu sesión no coincide." |
| `P0097` | fuera de disponibilidad / no alineado | `OUTSIDE_AVAILABILITY_MESSAGE` |
| `P0098` | bloqueado por override | mismo mensaje de disponibilidad |
| `P0099` | grilla de disponibilidad ambigua | mensaje de disponibilidad |
| `P009A` | clinic/end_at recalculado ≠ intent | "La reserva ya no es válida." |
| `P009B` | slot ocupado (pre-check) | `SLOT_TAKEN_MESSAGE` |
| `P009C` | médico no reservable | "Este médico no acepta reservas en línea." |
| `P009D` | servicio inválido | "El servicio no es válido." |
| `P009E` | fecha pasada | `PAST_APPOINTMENT_MESSAGE` |
| `P009H` | nombre de paciente requerido | "Ingresá el nombre del paciente." |
| `P009I` | nombre demasiado largo (>150) | "El nombre es demasiado largo." |
| `P009J` | notas demasiado largas (>2000) | "Las notas son demasiado largas." |
| `P0090` | solape atómico (trigger `s7_55`) | `SLOT_TAKEN_MESSAGE` |

> **Nota:** `P009B/P009C/P009D/P009E/P0097/P0098/P0099` son **internos** de
> `validate_booking_slot`. En `register_booking_intent` se colapsan en `P009F`
> (público). En `create_booking_with_intent` (caller autenticado) sí pueden
> surgir específicos, porque ahí no hay enumeración anónima que proteger.

## Cleanup del smoke — orden correcto (referencia)

El `finally` de `_smoke-s7_66.mjs` limpia respetando las FKs, es **tolerante a
fallos** (continúa aunque una eliminación falle, registra cada error, hace 2ª
pasada) y **exige sweep final en 0** de residuos operativos (devuelve fallo si
queda cualquiera). **Orden real** (cadena de FKs):

1. **auth_creation_grants** — `grant.booking_intent_id → booking_intents`
2. **booking_intents** — `intent.consumed_appointment_id → appointments`
3. **appointments** — `appointment.patient_id/service_id/doctor_id → …`
4. **patients**
5. **availability_overrides**
6. **availability_rules**
7. **services**
8. **doctors**
9. **clinic_members**
10. **clinics**
11. `deleteUser` (Admin Auth API) → el `profile` cae **por cascada** al no quedar
    la clínica que lo referenciaba (`clinics.owner_id`); borrado manual solo si
    persiste y **sin relaciones externas**
12. verificación: `profiles = 0` (por **ID exacto**) y `getUserById` → not found

**Cadena de FKs (por qué ese orden):** `auth_creation_grants.booking_intent_id`
bloquea el intent → `booking_intents.consumed_appointment_id` (RESTRICT, s7_65)
bloquea la cita **cuando el intent fue consumido** → la cita bloquea
patient/service/doctor/clinic. Un orden con `appointments` antes que
`booking_intents` **falla** en cuanto un intent queda consumido (caso real desde
que T5 crea y consume). El anclaje de residuos es **relacional** (auth.user +
correo `@ap66fixture.invalid` + clínica/servicio con marker de NOMBRE + FKs), NO
por marker en `profiles.full_name`/`email` (el profile sintético no lo lleva).

**Fixture de intent vencido (T7):** debe respetar los CHECK de `booking_intents`
—`expires_at < now()`, `expires_at > created_at` y **`expires_at <= created_at +
interval '15 minutes'`** (`booking_intents_ttl_max`)—. Ventana usada: `created =
now−10 min`, `expires = now−1 min` (9 min). El INSERT chequea error y exige
`data.id` no nulo (falla como error de SETUP, nunca por leer `id` de `null`).

**`audit_log` está FUERA del objetivo de 0 residuos (append-only).** Como T5 crea
un `patient` REAL, `audit_patients` (`s4_02`, con `COALESCE` del `user_id`) deja
filas append-only de la fixture (insert; y delete al borrar el patient en el
cleanup). **No se borran.** El smoke reporta el **conteo** de filas de `audit_log`
asociadas a los IDs sintéticos creados (por `record_id`), sin eliminar nada. No
se afirma "audit_log intacto" a secas: se indica si la corrida generó registros
sintéticos y cuántos.

## Rollback

`s7_66` solo agrega funciones. Para revertir:
```sql
DROP FUNCTION IF EXISTS public.create_booking_with_intent(uuid, text, text);
DROP FUNCTION IF EXISTS public.register_booking_intent(uuid, uuid, timestamp without time zone, text);
DROP FUNCTION IF EXISTS public.validate_booking_slot(uuid, uuid, timestamp without time zone);
```
Las tablas de `s7_65` vuelven a quedar inertes. El frontend (que aún usa
`createBooking` directo hasta el paso B) no depende de estas funciones.
