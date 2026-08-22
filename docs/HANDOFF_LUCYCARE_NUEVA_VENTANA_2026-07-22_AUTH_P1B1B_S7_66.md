# HANDOFF — Nueva ventana (2026-07-22, AUTH-P1B1B etapa A / `s7_66` APLICADA y VERIFICADA)

> 🗂️ **HISTÓRICO — NO ES EL HANDOFF VIGENTE.** La fuente canónica es
> `docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-08-20.md`. Este documento se conserva
> por trazabilidad y **no debe borrarse**.
>
> ---
>
> **PUNTO DE ENTRADA VIGENTE** *(al 2026-07-22)*. Leer este primero.
>
> **CIERRE (estado final real):** `s7_66` está **aplicada en Supabase, verificada
> y con PR abierto** (rama `claude/auth-p1b1b-s7-66`). Las 10 correcciones de §E
> se implementaron; **`create_booking_with_intent` usa `SET search_path =
> pg_catalog, public, pg_temp`** (excepción por el trigger legacy `audit_patients`;
> `validate`/`register` quedan en `''`). Preflight de seguridad del schema
> `public` OK (PUBLIC/anon/authenticated **sin** CREATE). **Verificación: §A1–§A4
> verdes · `check-s7_66 --runtime` 32/32 · `_smoke-s7_66` E2E 34/34 · 0 residuos
> operativos AP66 · 4 auth.users sintéticos borrados y verificados · `audit_log`
> append-only preservado (2 filas, fuera del objetivo de cleanup) · Test Phones
> `503700066 01/02` YA retirados.** `appointments_insert` sigue **INTACTO**
> (additive; el bypass lo cierra `s7_67`). **Siguiente paso: FRONTEND (paso B);
> después `s7_67`.** Las secciones de más abajo describen el proceso original de
> la ventana (§D/§E ya CUMPLIDAS); se conservan como registro histórico.

---

## 0. INSTRUCCIÓN 0 — arranque de la nueva ventana

```text
Continuamos LucyCare en nueva ventana.

1) Sincronizá el repo (SIN descartar los cambios locales de s7_66):
   git fetch origin
   git status --short        # deben aparecer los 5 cambios de s7_66
   git rev-parse HEAD        # 3efeb5737d8c1b27504042c4cdf0b66694aa1800
   git log -1 --oneline

2) Leé en este orden:
   a. docs/HANDOFF_LUCYCARE_NUEVA_VENTANA_2026-07-22_AUTH_P1B1B_S7_66.md  (este)
   b. CLAUDE.md (sección AUTH-P1B1B / s7_66)
   c. migrations/s7_66_booking_intent_transaction.sql  (la implementación viva)
   d. docs/OWNER_S7_66_APPLY.md

3) NO reimplementes s7_66. Continuá sobre los 5 archivos existentes.
4) NO apliques SQL. NO uses service_role. NO ejecutes el smoke.
   NO abras rama/commit/PR. NO configures el Auth Hook.

5) La primera instrucción del owner tras este handoff empieza con:
   "La entrega está bien encaminada, pero todavía no autorizo aplicar s7_66."
   → aplicar las correcciones de la sección E sobre los archivos existentes.
```

---

## A. Estado del repositorio (actualizado al CIERRE)

- **PR de la etapa A:** **abierto** en rama **`claude/auth-p1b1b-s7-66`** (un solo commit),
  con los **7 archivos** del paquete (`migrations/s7_66_booking_intent_transaction.sql`,
  `scripts/check-s7_66.mjs`, `scripts/_smoke-s7_66.mjs`, `docs/OWNER_S7_66_APPLY.md`,
  este handoff, `CLAUDE.md`, `src/types/database.types.ts`). **No mergeado.**
- **Migraciones APLICADAS en Supabase:** hasta **`s7_66`** (aplicada y verificada por el owner).
- **Before User Created Hook (`s7_65`):** **creado pero NO configurado** en el Dashboard (cero impacto).
- **`appointments_insert`:** **INTACTO** (s7_66 es additive; el cierre del bypass es `s7_67`/paso C).
- **Test Phones AP66** `50370006601`/`50370006602`: **ya retirados** de Supabase.

Últimos commits de `main`:
```
3efeb57 feat(auth): elegibilidad + Before User Created Hook (inerte) — AUTH-P1B1A (s7_65) (#298)
9d69f2a feat(auth): servicio base telefono verificado + contrasena — AUTH-P1A (#297)
4f954c0 feat(credenciales): retiro logico de doctors.license_number — F1-c1 / PR B (s7_64) (#296)
```

---

## B. Estado de AUTH-P1

- **P1A** ✅ CERRADO — PR #297 (servicio base teléfono+contraseña; `signInWithPhonePassword`, contexto OTP, normalización multipaís `authPhone.ts`, `runPostLoginSideEffects`).
- **P1B1A** ✅ CERRADO — PR #298 / `s7_65` (elegibilidad + Before User Created Hook inerte; `auth_phone_e164` SQL, tablas `auth_creation_grants`/`booking_intents`, hook `SECURITY INVOKER`, permisos mínimos). Doc de verificación: `docs/OWNER_S7_65_VERIFY.md`.
- **P1B1B — etapa A ✅ CERRADA** — `s7_66` (esta ventana): infraestructura RPC de reserva por
  intent **aplicada en Supabase y verificada** (§A1–§A4 verdes · `--runtime` 32/32 · smoke E2E
  34/34 · 0 residuos operativos · `audit_log` append-only preservado). Las 10 correcciones de §E
  se implementaron; el fix de `search_path` (`create` = `pg_catalog, public, pg_temp`) resolvió el
  `42P01` del trigger `audit_patients`. **PR abierto** (rama `claude/auth-p1b1b-s7-66`), no mergeado.
  - **B (frontend)** — **NO iniciado (siguiente paso):** `BookingCard`/`LoginModal`/`booking.service` al camino de intents.
  - **C — `s7_67`** — NO iniciado: `REVOKE INSERT … FROM anon` + `appointments_insert` = solo `is_clinic_member` (cierra el bypass). Solo tras validar B en prod.
- **P1B1C** (rate limit OTP + Send SMS Hook), **P1C** (UI), **P1D** (claim con contraseña), **F1-c2** (DROP de `doctors.license_number`): NO iniciados.
- **Twilio:** sin tocar.

---

## C. Decisiones YA CERRADAS (no reabrir)

1. **Duración:** `end_at = start_at + availability_rules.slot_duration_min` (NO la duración del servicio).
2. **`p_start_local`** es `timestamp without time zone` (naive local).
3. **Conversión explícita** dentro de la RPC: `p_start_local AT TIME ZONE 'America/El_Salvador'` (mismo literal que el trigger `s6_04`). No depender del `TimeZone` de PostgREST. No construir `-06:00` en React.
4. **Teléfono** en `create_booking_with_intent`: SOLO `auth.jwt() ->> 'phone'`, canónico con `auth_phone_e164`, **fail-closed**.
5. **Sin `auth.users`**. **Sin fallback a `profiles.phone`.**
6. **Camino único** mediante intents (paciente no autenticado Y ya autenticado); la RPC toma el teléfono del JWT, no acepta otro del cliente.
7. **Despliegue dividido:** A = `s7_66` (additive) · B = frontend · C = `s7_67` (cierra bypass).
8. **Bypass confirmado:** `appointments_insert` (INSERT, `{public}`) tiene `WITH CHECK = is_clinic_member(clinic_id) OR (patient_id IN (mis patients) AND source='lucy_directorio')` → un paciente autenticado puede insertar cita directo hoy. Grants: `anon`/`authenticated`/`service_role` tienen `GRANT ALL` de tabla sobre `appointments` (legacy schema inicial, como `doctors` pre-`s7_60`); `anon` queda neutralizado por RLS para INSERT.
9. **Reglas superpuestas problemáticas: 0 casos** (query del owner: `pares_superpuestos=0`, `pares_slot_distinto=0`) → la anti-ambigüedad de `validate_booking_slot` es guarda defensiva gratuita.
10. **Claim `phone` del JWT:** el owner confirmó que Supabase lo incluye como claim estándar; la presencia efectiva se verifica en QA runtime (§B del doc del owner / T5 del smoke).
11. **`patients` get-or-create:** NO existe `UNIQUE(profile_id, clinic_id)` → se usa **advisory lock** por `(auth.uid, clinic_id)`, no `ON CONFLICT`.

---

## D. Implementación local actual de `s7_66` (tal como existe AHORA)

Archivo: **`migrations/s7_66_booking_intent_transaction.sql`** (`BEGIN…COMMIT`, additive-only; NO toca `appointments_insert`, grants de `appointments`, ni frontend).

### Las 3 funciones

**`validate_booking_slot(p_doctor_id uuid, p_service_id uuid, p_start_local timestamp without time zone) OUT o_clinic_id uuid, OUT o_start_at timestamptz, OUT o_end_at timestamptz`**
- `LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''`, referencias calificadas.
- Valida: médico `is_published AND booking_enabled AND is_operational` (→ `P009C`); servicio `is_active AND doctor_id=p_doctor_id` (→ `P009D`); `o_start_at := p_start_local AT TIME ZONE 'America/El_Salvador'`; fecha pasada `< now()-2min` (→ `P009E`); **anti-ambigüedad** (dos reglas activas del día que contienen el inicio con distinto `slot_duration_min` → `P0099`); toma `slot_duration_min` de la regla que contiene el inicio (ORDER BY start_time DESC LIMIT 1) o `P0097`; `o_end_at := o_start_at + slot_min`; **contención** completa `[start,end]` en regla activa (→ `P0097`); **alineación** a grilla `mod((v_time - rule.start_time)/60, slot_min)=0` (→ `P0097`); **overrides** bloqueo total (time NULL) o parcial que solapa (→ `P0098`); **pre-check de solape** contra citas `is_final=false` con `tstzrange && '[)'` (→ `P009B`).
- **Permisos:** `REVOKE ALL` de PUBLIC/anon/authenticated (helper interno).

**`register_booking_intent(p_doctor_id uuid, p_service_id uuid, p_start_local timestamp without time zone, p_phone text) RETURNS jsonb` → `{ intent_id, reused }`**
- `SECURITY DEFINER SET search_path=''`.
- `auth_phone_e164(p_phone)` NULL → `P0095`; **advisory lock** `hashtextextended('bkint:'||v_phone,0)`; llama `validate_booking_slot`; **idempotencia**: reusa intent existente SOLO si coinciden `(phone_e164, doctor_id, service_id, start_at, consumed_at IS NULL, expires_at>now())` **Y** existe grant `booking` no-revocado/vigente asociado → devuelve `{intent_id, reused:true}`; tope 3 intents vigentes por teléfono (→ actualmente `P009B`); si no reusa → INSERT `booking_intents` (TTL 15 min) + INSERT `auth_creation_grants(flow='booking', booking_intent_id, expires 15 min, issued_by='register_booking_intent')`.
- **Permisos:** `REVOKE PUBLIC` + `GRANT EXECUTE` a **anon + authenticated**.

**`create_booking_with_intent(p_intent_id uuid, p_patient_name text, p_notes text DEFAULT NULL) RETURNS jsonb` → `{ success, appointment_id }`**
- `SECURITY DEFINER SET search_path=''`.
- `auth.uid()` NULL → `28000`; `v_jwt_phone := auth_phone_e164(auth.jwt()->>'phone')` NULL → `P0095`; `SELECT … FOR UPDATE` del intent (→ `P0092`); consumido → `P0093`; vencido → `P0094`; `v_jwt_phone <> intent.phone_e164` → `P0096`; **revalida** con `validate_booking_slot(doctor, service, intent.start_at AT TIME ZONE 'America/El_Salvador')`; exige `clinic_id/start_at/end_at recalculados == guardados` (→ `P009A`); **advisory lock** `hashtextextended('patient:'||uid||':'||clinic,0)` + get-or-create de `patients` por `(profile_id, clinic_id)`; INSERT `appointments` (status 'programada', source 'lucy_directorio', triggers `s6_03/s6_04/s7_55` disparan); UPDATE intent `consumed_at`/`consumed_appointment_id`; **rollback total** ante excepción.
- **Permisos:** `REVOKE PUBLIC/anon` + `GRANT EXECUTE` a **authenticated**.

### Códigos de error
`P0092` intent inexistente · `P0093` consumido · `P0094` vencido · `P0095` teléfono JWT ausente/inválido · `P0096` teléfono ≠ intent · `P0097` fuera de disponibilidad/no alineado · `P0098` override bloquea · `P0099` disponibilidad ambigua · `P009A` clinic/end_at recalculado ≠ intent · `P009B` slot ocupado (pre-check) / tope de intents · `P009C` médico no reservable · `P009D` servicio inválido · `P009E` fecha pasada · `P0090` solape atómico (trigger `s7_55`).

### Otros archivos
- **`src/types/database.types.ts`** (`M`, +29): 3 firmas nuevas al final del bloque `Functions` (antes de `Enums`). `tsc`+`build` verdes.
- **`scripts/check-s7_66.mjs`** (estructural, sin service_role): register ejecutable por anon + `P0095` en teléfono inválido; create denegado a anon / ejecutable por authenticated; validate no ejecutable por anon ni authenticated; no-regresión de tablas `s7_65`.
- **`scripts/_smoke-s7_66.mjs`** (E2E, **NO ejecutado**; requiere service_role + Test Phone `50370006601`): preflight de inventario AP66 + T1–T10 (intent+derivados, idempotencia, `P0095`, rechazos de validación, cita+consumo, `P0093`, `P0094`, `P0096`, patients sin duplicar, slot ocupado) + cleanup por ID/teléfono/correo/marker + audit_log intacto. **100% sintético, namespace `AP66_FIXTURE`, teléfonos `503700066xx`; jamás Camilo/Katherine.**
- **`docs/OWNER_S7_66_APPLY.md`**: orden A/B/C, aplicación, §A verificación estructural (firmas/EXECUTE/search_path/appointments_insert intacto), §B QA runtime del claim `phone` (consola del navegador + smoke), §C comportamiento, tabla de P-codes con copy, rollback (`DROP FUNCTION` ×3).

### Validaciones (estado FINAL)
`tsc --noEmit` ✅ · `npm run build` ✅ · `node --check` de ambos scripts ✅ ·
`node scripts/check-s7_66.mjs` (estático) **27/27** ✅. **`s7_66` APLICADA y
verificada:** §A1–§A4 verdes · `check-s7_66 --runtime` **32/32** · `_smoke-s7_66`
E2E **34/34** · 0 residuos operativos AP66 · `audit_log` append-only preservado ·
Test Phones retirados. *(Las descripciones de §D de más abajo reflejan el diseño
original de la ventana; las firmas/permisos finales son: `create` con
`search_path = pg_catalog, public, pg_temp`, `validate`/`register` con `''`.)*

### REPORTE COMPLETO DE LA IMPLEMENTACIÓN (entregado en esta ventana)
Los 10 puntos de la entrega: (1) 5 archivos listados; (2) SQL completo additive; (3) firmas+permisos (validate interno; register anon+auth; create auth-only; las 3 DEFINER search_path=''); (4) matriz del check; (5) diseño del smoke AP66; (6) P-codes `P0092`–`P009E`+`P0090`; (7) orden A→B→C; (8) riesgos (secuenciación, DEFINER inserta appointments, claim phone runtime, round-trip TZ); (9) rollback DROP×3; (10) `git status`. `tsc`/`build`/`node --check` verdes; nada aplicado/ejecutado/commiteado.

---

## E. AJUSTES PENDIENTES antes de aplicar `s7_66` (la nueva ventana los implementa sobre los archivos existentes)

> El owner los enumeró; **la primera instrucción de la nueva ventana pide
> aplicarlos.** NO están hechos todavía.

1. **REVOKE explícito a `service_role` y roles no autorizados** en las 3 funciones (hoy solo se revoca PUBLIC/anon/authenticated donde corresponde; falta decidir/ejecutar el REVOKE a `service_role` para no depender de defaults, coherente con el patrón que se aplicó al hook en `s7_65`).
2. **Ambigüedad por duración Y fase/origen de grilla:** hoy `validate_booking_slot` detecta ambigüedad por `slot_duration_min` distinto; falta cubrir el caso de **fase/origen de grilla distinto** (dos reglas con mismo slot pero distinto `start_time` base → grillas desalineadas entre sí).
3. **Errores públicos genéricos en `register_booking_intent`:** hoy propaga P-codes específicos (`P009C/P009D/P009E/P0097/P0098`) que **revelan** existencia/estado del médico a un caller anónimo → deben devolverse **genéricos** al cliente (sin enumeración), conservando el detalle solo interno.
4. **Tope de intents contando SOLO grants vigentes:** hoy el tope de 3 cuenta `booking_intents` vigentes; debe contar solo los que tienen **grant `booking` vigente/no-revocado** (coherente con la idempotencia).
5. **Mapeo completo de `patients` y `appointments`:** revisar que el INSERT de `patients` (document_type/gender/patient_type/date_of_birth placeholder) y el de `appointments` reproduzcan **exactamente** los campos del `createBooking`/`getOrCreatePatient` vigentes (p. ej. `payment_status`, `link_confirmed_at`, `notes`), sin omisiones.
6. **Validación y límites de `p_patient_name` y `p_notes`:** longitud máxima, trim, y rechazo/normalización de vacío (hoy solo `nullif(btrim(...))` en notes; falta política de nombre).
7. **Ampliación del check** (`check-s7_66.mjs`): agregar verificación de EXECUTE por rol (incluido service_role) y de `search_path` vacío por análisis estático del SQL, además de las denegaciones runtime.
8. **Smoke con DOS Test Phones obligatorios:** hoy T8 (teléfono ≠ intent) se omite si el 2º Test Phone no está; el owner lo quiere **obligatorio** (paciente `50370006601` + otro `50370006602`).
9. **Prueba concurrente real:** agregar al smoke una prueba de concurrencia (dos `create_booking_with_intent`/dos `register` del mismo slot en paralelo) que demuestre que el advisory lock + `s7_55` serializan y solo una gana.
10. **Verificación directa de eliminación de `auth.users` sintéticos:** el cleanup del smoke borra `auth.users` con `deleteUser`; agregar una **verificación posterior explícita** de que ya no existen (sin afirmar consulta a `auth.users` si no se puede; usar la señal por `profiles`/correo como en `s7_65`).

---

## F. Restricciones operativas VIGENTES (post-cierre de la etapa A)

- **El owner aplica el SQL** en el SQL Editor; el dev corre `check`/`smoke`.
- **`service_role` solo con autorización puntual** (incluso read-only).
- **No configurar el Auth Hook** (Before User Created sigue inerte).
- **No tocar `appointments_insert`** todavía (eso es `s7_67`/paso C).
- **No iniciar frontend (paso B) ni `s7_67`** sin instrucción.
- **No tocar B1C, Twilio, P1C, P1D ni F1-c2.**
- **Fixtures: jamás Camilo (`50378627694`) ni Katherine (`50372608827`).** Namespace propio `AP66_FIXTURE` / `503700066xx`.
- **No mergear el PR sin autorización explícita.**
- **Un solo frente a la vez.**
- **Deuda técnica (frente aparte, NO en P1B1B):** los triggers de auditoría legacy
  (`audit_patients` s4_02, `audit_profiles_identity` s7_32) usan `auth.uid()` sin
  `COALESCE` y/o dependen del `search_path` del caller → chocan con `service_role`
  y con `search_path=''` en tablas auditadas. Sanearlos (`COALESCE`+`actor_source`+
  calificación) permitiría uniformar `search_path=''`.

---

## G. Próxima acción exacta (post-cierre)

La etapa A (`s7_66`) está **cerrada, verificada y con PR abierto**
(`claude/auth-p1b1b-s7-66`, no mergeado). El **siguiente frente**, con autorización
aparte, es el **paso B (frontend)**: llevar `BookingCard`/`LoginModal`/
`booking.service` al camino de intents (`register_booking_intent` pre-OTP →
`create_booking_with_intent` post-OTP), mapeando los P-codes a copy (ver
`docs/OWNER_S7_66_APPLY.md`). **Después** el paso C (`s7_67`) cierra el bypass de
`appointments_insert`. Nada de esto se inicia sin instrucción del owner.

---

## Referencias rápidas
- Migración viva: `migrations/s7_66_booking_intent_transaction.sql`
- Doc del owner: `docs/OWNER_S7_66_APPLY.md`
- Check: `scripts/check-s7_66.mjs` · Smoke: `scripts/_smoke-s7_66.mjs`
- Tipos: `src/types/database.types.ts` (bloque `Functions`)
- Contexto AUTH-P1 en memoria: `~/.claude/.../memory/auth_p1_estado.md`
- Handoff previo (P1B1A): `docs/OWNER_S7_65_VERIFY.md` + PR #298
- Triggers de agenda (defensa final, NO tocar): `s6_03` (pasado), `s6_04` (disponibilidad+TZ), `s7_55` (solape atómico P0090)
- Flujo actual de reserva (a reemplazar en paso B): `src/services/booking.service.ts` (`createBooking`, `getOrCreatePatient`), `src/pages/doctor-detail/components/BookingCard.tsx`
