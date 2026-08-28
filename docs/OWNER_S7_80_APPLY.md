# s7_80 · DOCTOR-OWNER-NOTIFICATIONS-P0 — guía de apply y configuración

> ## Estado: **APLICADO Y VALIDADO EN PRODUCCIÓN** (2026-08-28)
>
> `s7_80`, `s7_81` y `s7_82` = **APPLIED / VERIFIED — NO REAPLICAR** (migraciones
> **101**, **102** y **103**). El rollout de esta guía está **ejecutado**; queda
> como registro reproducible, no como lista de tareas pendientes.
>
> | Evidencia | Estado |
> |---|---|
> | Edge Function `notify-owner-doctor-events` | **ACTIVE v1** |
> | Gates de acceso | **200 / 401 / 401 PASS** (+ 405 en `GET`) |
> | `pg_net` | **0.20.0 habilitado** |
> | Vault | **exactamente 1** `DOCTOR_NOTIFICATION_WEBHOOK_SECRET` |
> | Trigger propio | `trg_notify_owner_wakeup` — `AFTER INSERT FOR EACH ROW` |
> | Smoke SQL `BEGIN…ROLLBACK` | **PASS**, 0 residuales, sin HTTP real |
> | **E2E A · afiliación** | **PASS** — correo real enviado y recibido |
> | **E2E B · claim** | **PASS** — `sent`, `attempts=1`, `provider_message_id` |
> | Cola final | **vacía** — sin `failed` ni `needs_reconciliation` |
> | Residuo A | **2 filas inmutables de `audit_log`** (trigger de `s7_21`) |
> | Residuo B | **cero** |
> | Database Webhook del Dashboard | **NO se usa** — ver paso 8 |
>
> **El sistema está EN VIVO:** una afiliación o un claim real dispara un correo
> a `medicos@lucycare.app`.
>
> Baseline de la implementación: rama `claude/doctor-owner-notifications-p0`
> desde `08224048fb1084a7a380378c758062d248fc81c4`.

Avisa por correo al owner cuando (1) un médico completa el formulario de
afiliación y (2) un médico reclama un perfil. Nada más.

```
outbox → Database Webhook (pg_net) → Edge Function → Resend
```

---

## 1 · Qué toca este frente

| Pieza | Archivo |
|---|---|
| Migración | `migrations/s7_80_doctor_owner_notifications.sql` |
| Rollback | `docs/rollbacks/s7_80_rollback.sql` |
| Edge Function | `supabase/functions/notify-owner-doctor-events/index.ts` |
| Lógica pura (testeable) | `supabase/functions/notify-owner-doctor-events/render.ts` |
| Check | `scripts/check-s7_80.mjs` |
| Verificador post-apply | `scripts/_smoke-s7_80.mjs` |

**`src/` no se toca.** Ni un archivo del frontend.

---

## 2 · Orden de despliegue

**Regla que lo gobierna: nada apunta a la Edge Function hasta que la función
existe y está probada.** El riesgo a evitar es una webhook apuntando a una
función inexistente: cada INSERT devolvería 404 y la outbox acumularía en
silencio.

### Paso 1 — Aplicar `s7_80` *(owner: SQL Editor)*

Pegar y ejecutar `migrations/s7_80_doctor_owner_notifications.sql`.

Debe terminar con `s7_80 PRE: OK` y `s7_80 POST: OK`. Verá además este aviso,
**que es lo esperado en este paso**:

```
WARNING: s7_80: pg_net NO está instalada. La outbox encolará correctamente,
pero NADA la drenará hasta habilitar Database Webhooks y crear la webhook.
```

Después, el dev corre:

```bash
node scripts/check-s7_80.mjs
```

**Estado tras el paso 1:** la outbox encola eventos reales y **no se envía ni
un correo**. Cero efecto visible para médicos o pacientes. Totalmente
reversible con el rollback.

> **Consecuencia decidida:** entre este paso y el paso 6 los eventos reales se
> acumulan como `pending`. Cuando la función corra por primera vez, **enviará
> todo el atraso de golpe**. El owner decidió que **se envían, no se suprimen**:
> son eventos de negocio reales. Conviene que la ventana sea corta.

### Paso 2 — API key nueva de Resend *(owner: dashboard de Resend)*

- Crear una API key **nueva**, permisos **`Sending access`** (no full access).
- Nombre sugerido: `edge-owner-notifications`.

> ⚠️ **No reutilizar la key del SMTP de Auth.** Si el owner rotara esa key, se
> caería el recovery por email de **todos** los usuarios. Son dos usos con
> ciclos de vida distintos y deben tener credenciales distintas.

Confirmar que `notificaciones@lucycare.app` puede enviarse: el dominio
`lucycare.app` ya está verificado en Resend con SPF/DKIM/DMARC.

### Paso 3 — Generar el secreto del webhook *(owner)*

Valor aleatorio de al menos 32 bytes. No entra al repositorio, no se pega en
un chat, no se documenta aquí.

### Paso 4 — Cargar los secretos de la función *(owner: Dashboard → Edge Functions → Secrets)*

| Nombre | Contenido |
|---|---|
| `DOCTOR_NOTIFICATION_WEBHOOK_SECRET` | el del paso 3 |
| `RESEND_API_KEY` | la key del paso 2 |
| `DOCTOR_NOTIFICATION_EMAIL` | destinatario; admite varios separados por comas |

`SUPABASE_URL` y `SUPABASE_SECRET_KEYS` los preaprovisiona el runtime: **no se
configuran a mano**.

El remitente **no** es un secreto: está fijo en el código como
`LucyCare <notificaciones@lucycare.app>`, por decisión del owner.

### Paso 5 — Desplegar la Edge Function *(owner)*

**Este comando exacto, con la bandera:**

```bash
npx supabase functions deploy notify-owner-doctor-events --no-verify-jwt
```

`--no-verify-jwt` es **por invocación** y afecta **solo a la función
nombrada**. No hay ningún archivo de configuración que lo aplique de forma
global ni permanente.

**`admin-create-seed-doctor` no se toca ni se redespliega.** Conserva su
verificación de JWT, que su gate `is_admin()` necesita: esa función la invoca
un admin desde el navegador y depende del JWT que viaja en la petición. Este
frente no la nombra en ningún comando.

> ⛔ **NUNCA ejecutar `supabase config push` en este proyecto.**
>
> Ese comando empuja un `config.toml` local al proyecto enlazado. Como
> **deliberadamente no existe** `supabase/config.toml` en este repositorio, no
> hay nada que empujar — y si alguien lo creara, las secciones que no declarase
> caerían a los **defaults de la CLI** y podrían pisar la configuración remota
> de Auth: **Turnstile, el SMTP de Resend y Twilio**, que están bajo protección
> absoluta y viven solo en el Dashboard.
>
> Se descartó tener un `config.toml` con solo `verify_jwt` justamente por eso:
> un comentario de advertencia dentro del archivo es documentación, no un
> control técnico. La bandera del comando no tiene ese alcance.

**Qué NO significa `--no-verify-jwt`:** no relaja la seguridad de la función.
La llamante es una Database Webhook, no un usuario, y no hay sesión de la que
sacar un JWT. El control de acceso real es **`X-Lucycare-Notify-Secret`**,
comparado en tiempo constante y fail-closed dentro de la función (§3 del paso
8), y además la función **ignora el payload** del webhook, así que ni
invocándola se puede inyectar un evento. El paso 6 comprueba justamente eso:
sin el secreto, **401**.

### Paso 6 — Probar la función ANTES de que algo la apunte *(owner)*

Esta es la **puerta de calidad** de todo el rollout.

```bash
curl -i -X POST "https://kvrsfmzlrmmmavillpuj.supabase.co/functions/v1/notify-owner-doctor-events" -H "X-Lucycare-Notify-Secret: EL_SECRETO_DEL_PASO_3"
```

- Respuesta esperada: `200` con `{"ok":true,"processed":N,...}`.
- Con el secreto mal o ausente: **`401 {"error":"unauthorized"}`**. Comprobar
  también este caso: es el control de acceso entero.

Si había atraso acumulado del paso 1, **aquí es donde llegan esos correos**.

### Paso 7 — Cargar el secreto en Vault *(owner)*

> **El orden importa: Vault ANTES de `s7_82`.** Aplicar la migración con Vault
> vacío dejaría el despertador activo pero sin secreto: cada evento real
> encolaría y emitiría un WARNING sin despertar a nadie. Es un estado seguro
> —la fila queda `pending` y se recupera— pero **no se provoca a propósito en
> producción**. Esa rama ya está cubierta por `check-s7_82` y por el mutation
> test, que es donde corresponde probarla.

**Preflight — antes de cargar nada:**

```sql
SELECT count(*) FROM vault.secrets WHERE name = 'DOCTOR_NOTIFICATION_WEBHOOK_SECRET';
```

Esperado: **`0`**. Si diera `1`, ya existe: no lo dupliques — comprobá que su
valor coincida con el Edge Function secret antes de seguir.

> `vault.secrets` guarda el valor **cifrado**; consultarla por nombre no
> descifra nada. **Nunca uses `vault.decrypted_secrets` para comprobar
> existencia** — descifra el secreto para no mirarlo.


> **Por qué Vault y no un literal en la migración:** el trigger de `s7_82`
> necesita el secreto en tiempo de ejecución. Si estuviera escrito en la
> migración acabaría en el repositorio; si estuviera en los argumentos del
> trigger, quedaría visible en `pg_get_triggerdef()`. Vault lo guarda cifrado y
> la migración solo lo referencia **por nombre**, así que rotarlo no toca ni
> una línea de SQL.

**Vía recomendada — Dashboard:** *Project Settings → Vault → Add new secret*

| Campo | Valor |
|---|---|
| Name | `DOCTOR_NOTIFICATION_WEBHOOK_SECRET` |
| Secret | **el mismo valor** que cargaste como Edge Function secret |
| Description | `Wakeup de la outbox de avisos al owner (s7_82)` |

⚠️ **El nombre debe ser exacto** — el trigger lo busca por esa cadena.

⚠️⚠️ **El valor debe ser IDÉNTICO al del Edge Function secret del mismo
nombre.** Ahora vive en dos sitios con papeles distintos: **Vault** es lo que
el trigger **envía**, el **Edge Function secret** es contra lo que la función
**compara**. Si difieren, cada wakeup recibe un 401 y ningún correo sale.
**Rotarlo obliga a actualizar los dos**, y conviene hacerlo en este orden:
primero el de la función, después el de Vault — al revés, los wakeups fallarían
durante la ventana intermedia.

**Solo por Dashboard. Ni CLI, ni SQL.**

`vault.create_secret(...)` exigiría escribir el valor dentro de una consulta, y
el SQL Editor **guarda el historial**: el secreto quedaría en un snippet.
`supabase secrets` no sirve —es otro almacén, el de la Edge Function— y además
pasaría el valor por `argv`. El formulario del Dashboard no tiene ninguno de
los dos problemas: el valor va del portapapeles al campo por HTTPS y no toca
ninguna shell.

**Pasos exactos:**

1. Copiá el valor **desde tu gestor de contraseñas** — el mismo que cargaste
   como Edge Function secret. No lo regeneres.
2. Dashboard → *Project Settings → Vault → Add new secret*.
3. Pegá el valor en **Secret** *(primero este campo, antes de escribir el
   nombre: así el pegado es lo primero y nada pisa el portapapeles)*.
4. Escribí el **Name** a mano, exacto: `DOCTOR_NOTIFICATION_WEBHOOK_SECRET`.
5. Description: `Wakeup de la outbox de avisos al owner (s7_82)`.
6. Save.

**Comprobación posterior**, que **no descifra nada**:

```sql
SELECT count(*) FROM vault.secrets WHERE name = 'DOCTOR_NOTIFICATION_WEBHOOK_SECRET';
```

Esperado: **`1`**. Ni 0 (no se guardó) ni 2 (duplicado).

**En ningún momento se consulta `decrypted_secret`.** El único que lo descifra
es el trigger, en runtime, y no lo devuelve a nadie.

> **Punto ciego que conviene conocer.** Nada en la base puede comprobar que el
> valor de Vault **coincida** con el Edge Function secret: son dos almacenes
> distintos y el segundo no es consultable desde SQL. Ni el PRE ni el smoke lo
> detectan.
>
> Si no coincidieran, el síntoma es inconfundible y aparece en el E2E: la fila
> queda en `pending`, `net._http_response` muestra **401**, y no llega ningún
> correo. La causa sería casi siempre haber regenerado el secreto para Vault
> en vez de reutilizar el que ya usa la función.

### Paso 8 — Aplicar `s7_82` *(owner: SQL Editor)*

Pegar y ejecutar `migrations/s7_82_doctor_notification_wakeup.sql`.

Debe terminar con `s7_82 PRE: OK` y `s7_82 POST: OK`. Después:

```bash
node scripts/check-s7_82.mjs
```

**No se crea ninguna Database Webhook de Supabase.** El esqueleto de esa
integración (`supabase_functions`, `http_request()`, `hooks`, `migrations`) **no
existe en este proyecto** y la UI ya no ofrece aprovisionarlo — devuelve
`3F000: schema "supabase_functions" does not exist`. Reconstruirlo a mano
exigiría crear un rol con `CREATEROLE`, reasignar ownership y alterar funciones
de `supabase_admin`: privilegios que el `postgres` de un proyecto alojado no
tiene, y objetos de plataforma creados a mano que una migración futura de
Supabase podría pisar.

No hace falta: lo único que aporta `supabase_functions.http_request()` es armar
un payload que **nuestra Edge Function descarta**. `s7_82` hace la llamada a
`net.http_post` directamente, con un trigger propio de LucyCare.

**Ventaja lateral:** la configuración del despertador queda **versionada en el
repositorio** en vez de vivir solo en el Dashboard.

**⚠️ Aplicar `s7_82` pone el sistema EN VIVO.** Desde ese momento una afiliación
o un claim real dispara un correo de verdad a `medicos@lucycare.app`.

### Paso 9 — Smoke de `s7_82` *(§4c)*, E2E *(§4b)* y cierre

---

## 3 · Desmontaje

**Orden inverso, sin excepción.**

1. `docs/rollbacks/s7_82_rollback.sql` — corta el despertador. Los eventos
   siguen encolándose sin pérdida; simplemente nadie los drena hasta que se
   invoque la función a mano.
2. Retirar la Edge Function.
3. *(Opcional)* borrar el secreto de Vault y deshabilitar `pg_net`.
4. Solo si hace falta revertir la base: `s7_81_rollback.sql` y después
   `s7_80_rollback.sql`, en ese orden.

El rollback de `s7_80` restaura `claim_doctor_profile` a su definición de s7_64
**antes** de borrar el helper que invoca; al revés, el siguiente claim fallaría
con *"function does not exist"*, rompiendo justo el flujo que este frente
prometía no tocar.

El rollback restaura `claim_doctor_profile` a su definición de s7_64 **antes**
de borrar el helper que invoca; al revés, el siguiente claim fallaría con
*"function does not exist"*, rompiendo justo el flujo que este frente prometía
no tocar.

---

## 4 · Smoke SQL *(owner: SQL Editor, después del paso 1)*

Va **dentro de `BEGIN … ROLLBACK`**, y no es un detalle de estilo: insertar un
lead de prueba dispara también `trg_audit_doctor_affiliation_requests`, y
`audit_log` es **inmutable desde s7_71b**. Un smoke que commitease dejaría
filas de auditoría permanentes de una fixture que ya no existe. El `ROLLBACK`
las revierte. **Residuales garantizados: cero.**

Sin tablas temporales: en el SQL Editor dan `42P01`/`3F000`. Se usa el patrón
vigente de variable + `set_config`/`current_setting`.

### El sujeto del evento de claim

El evento de claim necesita un `doctor_id` y un `profile_id` reales para
satisfacer las FK. El smoke usa el **perfil QA conocido** del proyecto:

> `QA LucyCare — Perfil médico de prueba`
> `ac0ba772-4263-4fb2-a146-dd90033d8c76`

Es el perfil que el owner despublicó en la higiene QA del 2026-08-14
conservando su identidad: `is_published = false`, no aparece en el directorio,
no recibe pacientes. No es Camilo ni ninguna cuenta protegida.

La resolución es **acotada y de doble llave**: búsqueda por clave primaria
*más* comprobación del nombre. No se lista la tabla de médicos, no se ordena
sobre ella y **no se consulta ninguna identidad protegida, ni para
descartarla** — excluir a alguien por teléfono obligaría a escribir en el
script el dato que se quiere proteger.

Si el id dejara de resolver, o resolviera a un médico con otro nombre, el
smoke **aborta** en vez de usar un sujeto equivocado.

**Su ficha solo se lee.** No se modifica ninguna columna suya, y de todos modos
todo se revierte con el `ROLLBACK`.

### El smoke

```sql
BEGIN;

DO $smoke$
DECLARE
  -- Sujeto QA conocido. Resolución acotada: PK + nombre, sin listar médicos
  -- ni consultar identidades protegidas.
  v_doc_qa  constant uuid := 'ac0ba772-4263-4fb2-a146-dd90033d8c76';
  v_qa_name constant text := 'QA LucyCare — Perfil médico de prueba';

  v_req    uuid;
  v_req2   uuid;
  v_doc    uuid;
  v_prof   uuid;
  v_n      int;
  v_id     uuid;
  v_lote   jsonb;
  v_ok     int := 0;
  v_fail   int := 0;
BEGIN
  -- ── GUARDA 0: la cola DEBE estar vacía ────────────────────
  -- Bloqueante y lo PRIMERO que corre, antes de escribir una sola fixture.
  -- Si hubiera eventos reales encolados, `notify_owner_claim_batch()` los
  -- mezclaría con los cuatro de la prueba: los conteos exactos dejarían de
  -- significar nada y, peor, las fixtures marcarían como `sending` avisos
  -- reales que nadie enviaría.
  SELECT count(*) INTO v_n FROM doctor_owner_notifications;
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'SMOKE abortado: la cola tiene % fila(s). Vaciala o esperá a que se '
      'entreguen antes de correr el smoke.', v_n;
  END IF;

  -- ── GUARDA 1: sujeto QA conocido, resuelto por PK + nombre ─
  -- Doble llave a propósito: si el id apuntara a otro médico, el nombre no
  -- casaría y el smoke aborta en vez de usar un sujeto equivocado.
  IF v_doc_qa = '783a902a-55fd-407c-9e0a-69568135c7f5'::uuid THEN
    RAISE EXCEPTION 'SMOKE abortado: ese es el médico demo protegido';
  END IF;

  SELECT d.id, d.profile_id INTO v_doc, v_prof
  FROM doctors d
  JOIN profiles p ON p.id = d.profile_id
  WHERE d.id = v_doc_qa AND p.full_name = v_qa_name;

  IF v_doc IS NULL OR v_prof IS NULL THEN
    RAISE EXCEPTION
      'SMOKE abortado: no se resolvió el perfil QA esperado (%). Verificá que '
      'siga existiendo con ese nombre.', v_doc_qa;
  END IF;
  IF v_prof = 'db1fba98-a299-4f25-82f1-7feff01e58fa'::uuid THEN
    RAISE EXCEPTION 'SMOKE abortado: ese perfil es el del médico demo protegido';
  END IF;

  -- ── 1. Afiliación: el trigger encola ──────────────────────
  INSERT INTO doctor_affiliation_requests
    (full_name, phone, phone_normalized, consent_accepted_at, consent_version)
  VALUES ('S780_FIXTURE Uno', '50399000001', '50399000001', now(), 'smoke')
  RETURNING id INTO v_req;

  SELECT count(*) INTO v_n FROM doctor_owner_notifications
   WHERE subject_request_id = v_req AND event_type = 'affiliation_submitted';
  IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 1: el trigger de afiliación no encoló (n=%)', v_n; END IF;

  SELECT count(*) INTO v_n FROM doctor_owner_notifications
   WHERE subject_request_id = v_req AND dedupe_key = v_req::text
     AND status = 'pending' AND attempts = 0
     AND subject_doctor_id IS NULL AND subject_profile_id IS NULL;
  IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 2: forma incorrecta del evento de afiliación'; END IF;

  -- ── 2. Un segundo lead es un segundo evento ───────────────
  INSERT INTO doctor_affiliation_requests
    (full_name, phone, phone_normalized, consent_accepted_at, consent_version)
  VALUES ('S780_FIXTURE Dos', '50399000002', '50399000002', now(), 'smoke')
  RETURNING id INTO v_req2;

  SELECT count(*) INTO v_n FROM doctor_owner_notifications
   WHERE subject_request_id IN (v_req, v_req2);
  IF v_n = 2 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 3: dos leads no dieron dos eventos (n=%)', v_n; END IF;

  -- ── 3. Afiliación: encolar dos veces el MISMO lead no duplica ──
  PERFORM _enqueue_doctor_owner_notification('affiliation_submitted', v_req, NULL, NULL);
  SELECT count(*) INTO v_n FROM doctor_owner_notifications WHERE subject_request_id = v_req;
  IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 4: la afiliación se duplicó (n=%)', v_n; END IF;

  -- ── 4. Claim: cada evento es NUEVO (decisión del owner) ───
  -- Se invoca el helper con los MISMOS argumentos que usa claim_doctor_profile.
  PERFORM _enqueue_doctor_owner_notification('doctor_profile_claimed', NULL, v_doc, v_prof);
  PERFORM _enqueue_doctor_owner_notification('doctor_profile_claimed', NULL, v_doc, v_prof);
  SELECT count(*) INTO v_n FROM doctor_owner_notifications
   WHERE subject_doctor_id = v_doc AND event_type = 'doctor_profile_claimed';
  IF v_n = 2 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 5: el claim se dedujo por doctor_id — debía dar 2 (n=%)', v_n; END IF;

  -- ── 5. La forma de cada evento se hace cumplir ────────────
  BEGIN
    INSERT INTO doctor_owner_notifications (event_type, dedupe_key, subject_request_id)
    VALUES ('doctor_profile_claimed', 'malformado', v_req);
    v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 6: aceptó un evento de claim con forma de afiliación';
  EXCEPTION WHEN check_violation THEN v_ok := v_ok + 1;
  END;

  -- ── 6. Drenado atómico y marcado ──────────────────────────
  -- Conteos EXACTOS, no ">=": la guarda 0 garantiza que los únicos eventos de
  -- la cola son los cuatro que creó esta prueba (2 afiliaciones + 2 claims).
  v_lote := notify_owner_claim_batch(10);
  IF jsonb_array_length(v_lote) = 4 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 7: el lote trajo % filas, esperaba 4', jsonb_array_length(v_lote); END IF;

  SELECT count(*) INTO v_n FROM doctor_owner_notifications
   WHERE status = 'sending' AND attempts = 1
     AND last_attempt_at IS NOT NULL AND first_attempt_at IS NOT NULL;
  IF v_n = 4 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 8: el lote marcó % sending, esperaba 4', v_n; END IF;

  -- Un segundo lote NO devuelve lo ya reclamado (no vencido).
  IF jsonb_array_length(notify_owner_claim_batch(10)) = 0 THEN v_ok := v_ok + 1;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL 9: relote devolvió filas ya reclamadas'; END IF;

  -- ── 7. La allowlist no filtra de más ──────────────────────
  IF NOT (v_lote::text ~ 'license|document|ip_address|user_agent|consent') THEN v_ok := v_ok + 1;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL 10: el lote trae campos no aprobados'; END IF;

  -- El evento de claim no lleva teléfono ni correo.
  IF (SELECT count(*) FROM jsonb_array_elements(v_lote) e
      WHERE e->>'event_type' = 'doctor_profile_claimed'
        AND (e->>'phone' IS NOT NULL OR e->>'email' IS NOT NULL)) = 0
  THEN v_ok := v_ok + 1;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL 11: el claim llevaba teléfono o correo'; END IF;

  -- ── 8. Marcado del resultado ──────────────────────────────
  v_id := (v_lote->0->>'id')::uuid;
  PERFORM notify_owner_mark_result(v_id, 'sent', 'msg_fixture', NULL);
  SELECT count(*) INTO v_n FROM doctor_owner_notifications
   WHERE id = v_id AND status = 'sent' AND sent_at IS NOT NULL
     AND provider_message_id = 'msg_fixture';
  IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 12: no marcó sent'; END IF;

  v_id := (v_lote->1->>'id')::uuid;
  PERFORM notify_owner_mark_result(v_id, 'failed', NULL, 'resend_422');
  SELECT count(*) INTO v_n FROM doctor_owner_notifications
   WHERE id = v_id AND status = 'failed' AND last_error_code = 'resend_422';
  IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 13: no marcó failed'; END IF;

  BEGIN
    PERFORM notify_owner_mark_result(v_id, 'inventado', NULL, NULL);
    v_fail := v_fail + 1; RAISE WARNING 'FAIL 14: aceptó un estado inventado';
  EXCEPTION WHEN sqlstate 'P0150' THEN v_ok := v_ok + 1;
  END;

  -- ── 8d. El claim conserva el enqueue ──────────────────────
  IF (SELECT position('_enqueue_doctor_owner_notification' in prosrc) > 0
        FROM pg_proc WHERE oid = 'public.claim_doctor_profile(uuid, text, text)'::regprocedure)
  THEN v_ok := v_ok + 1;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL 15: el claim no encola'; END IF;

  -- ── 8b. Ventana de idempotencia — DENTRO ──────────────────
  -- Reclamada hace rato, pero con primer intento reciente: debe reintentarse
  -- con el MISMO id, porque Resend todavía reconoce la Idempotency-Key.
  v_id := (v_lote->2->>'id')::uuid;
  UPDATE doctor_owner_notifications
     SET first_attempt_at = now() - interval '2 hours',
         last_attempt_at  = now() - interval '30 minutes'
   WHERE id = v_id;

  IF (SELECT count(*) FROM jsonb_array_elements(notify_owner_claim_batch(10)) e
       WHERE (e->>'id')::uuid = v_id) = 1
  THEN v_ok := v_ok + 1;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL 16: dentro de ventana NO se reintentó'; END IF;

  -- ── 8c. Ventana de idempotencia — FUERA ───────────────────
  -- Primer intento hace 23 h 5 min: Resend ya pudo olvidar la clave, así que
  -- un reintento mandaría un SEGUNDO correo. NO debe reenviarse.
  v_id := (v_lote->3->>'id')::uuid;
  UPDATE doctor_owner_notifications
     SET first_attempt_at = now() - interval '23 hours 5 minutes',
         last_attempt_at  = now() - interval '30 minutes'
   WHERE id = v_id;

  IF (SELECT count(*) FROM jsonb_array_elements(notify_owner_claim_batch(10)) e
       WHERE (e->>'id')::uuid = v_id) = 0
  THEN v_ok := v_ok + 1;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL 17: fuera de ventana SE reenvió'; END IF;

  SELECT count(*) INTO v_n FROM doctor_owner_notifications
   WHERE id = v_id AND status = 'needs_reconciliation'
     AND last_error_code = 'idem_window_expired';
  IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 18: no quedó en needs_reconciliation'; END IF;

  -- Y no vuelve a entrar nunca más.
  IF (SELECT count(*) FROM jsonb_array_elements(notify_owner_claim_batch(10)) e
       WHERE (e->>'id')::uuid = v_id) = 0
  THEN v_ok := v_ok + 1;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL 19: needs_reconciliation volvió al lote'; END IF;

  -- El techo no se puede saltar ni pidiéndolo: LEAST lo recorta a 23 h.
  v_id := (v_lote->3->>'id')::uuid;
  UPDATE doctor_owner_notifications
     SET status = 'sending', last_error_code = NULL,
         first_attempt_at = now() - interval '30 hours',
         last_attempt_at  = now() - interval '30 minutes'
   WHERE id = v_id;
  IF (SELECT count(*) FROM jsonb_array_elements(notify_owner_claim_batch(10, interval '1 minute', interval '48 hours')) e
       WHERE (e->>'id')::uuid = v_id) = 0
  THEN v_ok := v_ok + 1;
  ELSE v_fail := v_fail + 1; RAISE WARNING 'FAIL 20: una ventana de 48 h burló el techo'; END IF;

  RAISE NOTICE 's7_80 SMOKE: % OK, % FAIL', v_ok, v_fail;
  IF v_fail > 0 THEN RAISE EXCEPTION 's7_80 SMOKE con % FAIL', v_fail; END IF;
END $smoke$;

ROLLBACK;
```

Tras el `ROLLBACK`, confirmar que no quedó nada:

```sql
SELECT count(*) AS fixtures_residuales
FROM doctor_affiliation_requests WHERE full_name LIKE 'S780_FIXTURE%';
```

Debe dar **0**.

### Qué NO cubre este smoke

El **claim completo end-to-end** —OTP real, identidad verificada, licencia
JVPM coincidente— **no se ejercita**: exigiría crear una identidad en
`auth.users`, y la regla vinculante del proyecto es no tocar `auth.users` por
SQL. Lo que sí queda demostrado es que el helper encola con los argumentos
exactos que le pasa `claim_doctor_profile`, y que la RPC los contiene: el A/B
estructural de `check-s7_80.mjs` prueba que el resto del cuerpo es idéntico al
de s7_64.

Es una limitación real y conviene no presentarla como cobertura.

---

## 4b · Smoke E2E — cadena completa *(DISEÑADO, NO EJECUTADO)*

> ⚠️ **Requiere autorización explícita del owner.** Es la única prueba del
> frente que **escribe con COMMIT** y que **manda un correo real**. No puede
> correr antes del paso 8: sin webhook no hay cadena que probar.

El smoke SQL del §4 prueba la base. Este prueba lo que aquel no puede:

```
COMMIT en la outbox → Database Webhook → Edge Function → Resend → bandeja del owner
```

El `COMMIT` es imprescindible y no es un detalle: `pg_net` solo ve filas
**commiteadas**. Un smoke con `ROLLBACK` jamás dispararía la webhook. Por eso
esta prueba no puede ser gratis en residuos, y por eso se diseña para que el
residuo sea el mínimo posible y esté nombrado de antemano.

### Variante A — afiliación *(prueba la cadena entera desde un evento real)*

**Escritura controlada: UNA fila.**

```sql
INSERT INTO doctor_affiliation_requests
  (full_name, phone, phone_normalized, email, consent_accepted_at, consent_version)
VALUES ('S780_E2E_FIXTURE (QA LucyCare)', '50399000080', '50399000080',
        'qa-s780@lucycare.app', now(), 'S780_E2E');
```

Ese `INSERT` arrastra, por triggers ya existentes:

| Efecto | Tabla | Reversible |
|---|---|---|
| 1 fila de lead | `doctor_affiliation_requests` | **sí** |
| 1 fila de aviso | `doctor_owner_notifications` | **sí** (por `ON DELETE CASCADE`) |
| 1 fila de auditoría (`insert`) | `audit_log` | **NO — inmutable** |

**No usa Katherine, no toca a Camilo, no crea ni toca ningún paciente, no
crea identidad en `auth.users`, no consume SMS.** El teléfono `50399000080` no
pertenece a ninguna cuenta ni es Test Phone; existe solo para satisfacer el
`NOT NULL`, y la fila se borra después.

**Verificación (owner):**

1. El correo llega a `DOCTOR_NOTIFICATION_EMAIL`, remitente
   `LucyCare <notificaciones@lucycare.app>`, asunto
   *«LucyCare · Nueva solicitud de afiliación»*.
2. El cuerpo trae nombre, especialidad *(no indicado)*, teléfono, correo y
   fecha en `DD/MM/YYYY HH:mm` — **sin `T`, sin microsegundos, sin offset**.
3. El enlace es `https://lucycare.app/admin/afiliaciones` y abre.
4. En la base:

```sql
SELECT status, attempts, first_attempt_at, sent_at, provider_message_id
FROM doctor_owner_notifications
WHERE subject_request_id = (SELECT id FROM doctor_affiliation_requests
                            WHERE full_name LIKE 'S780_E2E_FIXTURE%');
```
   Esperado: `sent`, `attempts = 1`, `provider_message_id` presente.
5. En Resend: un envío `delivered`, **uno solo**.

**Limpieza:**

```sql
DELETE FROM doctor_affiliation_requests WHERE full_name LIKE 'S780_E2E_FIXTURE%';
```

El `ON DELETE CASCADE` se lleva la fila de la outbox. Comprobar después:

```sql
SELECT
  (SELECT count(*) FROM doctor_affiliation_requests WHERE full_name LIKE 'S780_E2E_FIXTURE%') AS leads,
  (SELECT count(*) FROM doctor_owner_notifications
     WHERE subject_request_id NOT IN (SELECT id FROM doctor_affiliation_requests)) AS avisos_huerfanos;
```

Ambos deben dar **0**.

**Residuo aceptado, y es exactamente esto:**

- **2 filas en `audit_log`** — una del `INSERT` y otra del `DELETE`, ambas del
  trigger `trg_audit_doctor_affiliation_requests` de `s7_21`. `audit_log` es
  inmutable desde `s7_71b`: **no se pueden borrar y no se intentará**. No
  contienen PII —solo `status`, booleanos `has_email`/`has_license` y
  `consent_version`— y su `record_id` apunta a una fila que ya no existe.
- **1 correo** en la bandeja del owner y **1 registro** en los logs de Resend.
  Es la evidencia de la prueba, no un residuo indeseado.

No hay forma de bajar de ahí: el trigger de auditoría es de la tabla, no de
este frente, y desactivarlo para la prueba sería peor que la traza que deja.

### Variante B — claim *(prueba el correo de claim sin identidad ni SMS)*

**Escritura controlada: UNA fila, y no arrastra nada.**

```sql
-- Sujeto QA conocido, el mismo del smoke. Su ficha SOLO SE LEE: no se modifica
-- ninguna columna del médico ni de su perfil.
--
-- Doble llave (PK + nombre): si el id apuntara a otro médico, no inserta nada
-- y el RETURNING viene vacío, en vez de mandar un correo sobre quien no toca.
INSERT INTO doctor_owner_notifications
  (event_type, dedupe_key, subject_doctor_id, subject_profile_id)
SELECT 'doctor_profile_claimed', gen_random_uuid()::text, d.id, d.profile_id
FROM doctors d
JOIN profiles p ON p.id = d.profile_id
WHERE d.id = 'ac0ba772-4263-4fb2-a146-dd90033d8c76'
  AND p.full_name = 'QA LucyCare — Perfil médico de prueba'
RETURNING id;
```

`doctor_owner_notifications` **no tiene trigger de auditoría**, así que este
`INSERT` no escribe en `audit_log`.

**Limpieza:** `DELETE FROM doctor_owner_notifications WHERE id = '<el id>';`
→ **residuo permanente en base: CERO.** Solo quedan el correo y el log de
Resend.

**Verificación:** asunto *«LucyCare · Perfil médico reclamado»*, con nombre,
especialidad, estado y enlace a `https://lucycare.app/admin/medicos/<id>` —
que debe abrir la ficha real. Y comprobar que **no aparece ni teléfono ni
correo**: la allowlist los excluye para este evento.

**Elección de `<DOCTOR_QA>`:** cualquier médico que el owner designe como QA.
**No Camilo** (cuenta demo protegida) y **no Katherine**. Sirve incluso un
médico `listed_only` sin publicar, porque solo se leen `id`, `profile_id`,
nombre y especialidad.

### Por qué NO se propone un claim end-to-end real

Un claim de verdad exigiría una identidad en `auth.users` con teléfono
confirmado que **coincida** con el del médico, más una credencial JVPM que
coincida con lo tecleado. Eso implica:

- crear identidad en `auth.users` — solo por Admin API, nunca por SQL; y
- un OTP: los **dos** Test Phones existentes no sirven (uno es Camilo,
  protegido; el otro es un paciente QA), así que **consumiría un SMS real** de
  Twilio Verify.

Y no compraría casi nada: **desde la outbox en adelante la cadena es idéntica
para los dos eventos** —mismo trigger de webhook, misma función, mismo
proveedor—; lo único que difiere es el punto de encolado. Que
`claim_doctor_profile` encola está demostrado por otras tres vías: la guarda
POST sobre `prosrc`, el A/B estructural contra `s7_64`, y el caso 4 del smoke
SQL, que invoca el helper con los argumentos exactos de la RPC.

**Recomendación: A + B, y no el claim real.** Si aun así se quisiera, es un
frente aparte con su propia autorización, su Test Phone temporal y su
limpieza por Admin API.

### Orden y diagnóstico

Correr **A**, verificar, limpiar; luego **B**, verificar, limpiar. Nunca las
dos a la vez: con dos correos simultáneos se pierde la trazabilidad de cuál
disparó qué.

Si el correo no llega, mirar en este orden — cada escalón descarta el anterior:

| Dónde | Qué dice |
|---|---|
| `status` de la fila | `pending` ⇒ la webhook no llegó a disparar |
| `net._http_response` | hubo petición HTTP y con qué código *(TTL corto)* |
| Logs de la Edge Function | `401` ⇒ secreto mal configurado en la webhook |
| `last_error_code` | `resend_*` ⇒ el proveedor rechazó |
| Logs de Resend | `delivered` / `bounced` / `complained` |

---

## 4c · Smoke de `s7_82` — el despertador, sin HTTP real

Va **dentro de `BEGIN … ROLLBACK`**, y aquí eso hace algo más que limpiar:
**garantiza que no salga ni una petición**.

`net.http_post` **encola**, no abre socket. El worker de `pg_net` **solo ve
filas COMMITEADAS**, así que mientras la transacción esté abierta nada se
envía, y con el `ROLLBACK` el encolado desaparece junto con las fixtures. **No
llega a salir ninguna petición HTTP.**

Eso permite probar el despertador de verdad —que dispara, que arma la
petición— sin tocar Resend ni la bandeja de nadie.

**Se corre con Vault YA cargado** (paso 7 hecho): comprueba que el despertador
encola de verdad la petición.

El bloque detecta si el secreto está o no y ajusta lo que espera, pero eso es
defensa —para que informe con claridad en vez de fallar de forma confusa— **no
una invitación a correrlo con Vault vacío**. La rama «falta el secreto» se
verifica en `check-s7_82` y en el mutation test, no provocándola en
producción.

```sql
BEGIN;

DO $smoke82$
DECLARE
  v_doc_qa  constant uuid := 'ac0ba772-4263-4fb2-a146-dd90033d8c76';
  v_qa_name constant text := 'QA LucyCare — Perfil médico de prueba';
  v_url     constant text := 'https://kvrsfmzlrmmmavillpuj.supabase.co/functions/v1/notify-owner-doctor-events';
  v_doc     uuid;
  v_prof    uuid;
  v_req     uuid;
  v_n       int;
  v_q0      int := 0;
  v_q1      int := 0;
  v_q2      int := 0;
  v_hay_secreto boolean;
  v_hay_cola    boolean := to_regclass('net.http_request_queue') IS NOT NULL;
  v_ok      int := 0;
  v_fail    int := 0;
BEGIN
  -- ── GUARDA 0: la cola de avisos debe estar vacía ──────────
  SELECT count(*) INTO v_n FROM doctor_owner_notifications;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'SMOKE abortado: la cola tiene % fila(s)', v_n;
  END IF;

  -- ── GUARDA 1: exactamente un trigger en la outbox ─────────
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'public.doctor_owner_notifications'::regclass AND NOT tgisinternal;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'SMOKE abortado: la outbox tiene % trigger(s), esperaba 1', v_n;
  END IF;

  -- ── GUARDA 2: sujeto QA conocido (PK + nombre) ────────────
  SELECT d.id, d.profile_id INTO v_doc, v_prof
  FROM doctors d JOIN profiles p ON p.id = d.profile_id
  WHERE d.id = v_doc_qa AND p.full_name = v_qa_name;
  IF v_doc IS NULL OR v_prof IS NULL THEN
    RAISE EXCEPTION 'SMOKE abortado: no se resolvió el perfil QA esperado';
  END IF;

  -- `vault.secrets`, NO `vault.decrypted_secrets`: comprobar existencia no
  -- requiere descifrar. El único que descifra es el trigger, en runtime.
  SELECT count(*) > 0 INTO v_hay_secreto
  FROM vault.secrets WHERE name = 'DOCTOR_NOTIFICATION_WEBHOOK_SECRET';
  RAISE NOTICE 's7_82 SMOKE: secreto en Vault = %, cola pg_net legible = %',
               v_hay_secreto, v_hay_cola;

  IF v_hay_cola THEN
    EXECUTE 'SELECT count(*) FROM net.http_request_queue WHERE url = $1'
      INTO v_q0 USING v_url;
  END IF;

  -- ── 1. Claim: el INSERT SOBREVIVE al wakeup ───────────────
  -- Es la propiedad que manda sobre todas las demás.
  PERFORM _enqueue_doctor_owner_notification('doctor_profile_claimed', NULL, v_doc, v_prof);
  SELECT count(*) INTO v_n FROM doctor_owner_notifications;
  IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 1: el INSERT no sobrevivió al wakeup (n=%)', v_n; END IF;

  -- 2. Y quedó en pending, listo para drenar
  SELECT count(*) INTO v_n FROM doctor_owner_notifications
   WHERE status = 'pending' AND attempts = 0 AND subject_doctor_id = v_doc;
  IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 2: la fila no quedó pending'; END IF;

  -- ── 3. Afiliación: el otro camino, también sobrevive ──────
  INSERT INTO doctor_affiliation_requests
    (full_name, phone, phone_normalized, consent_accepted_at, consent_version)
  VALUES ('S782_FIXTURE Uno', '50399000082', '50399000082', now(), 'smoke')
  RETURNING id INTO v_req;

  SELECT count(*) INTO v_n FROM doctor_owner_notifications
   WHERE subject_request_id = v_req;
  IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 3: la afiliación no encoló con el wakeup activo'; END IF;

  SELECT count(*) INTO v_n FROM doctor_owner_notifications;
  IF v_n = 2 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 4: se esperaban 2 avisos, hay %', v_n; END IF;

  -- ── 4. El wakeup encoló (o no) según haya secreto ─────────
  IF v_hay_cola THEN
    EXECUTE 'SELECT count(*) FROM net.http_request_queue WHERE url = $1'
      INTO v_q1 USING v_url;

    IF v_hay_secreto THEN
      IF (v_q1 - v_q0) = 2 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
        RAISE WARNING 'FAIL 5: con secreto se esperaban 2 wakeups encolados, hubo %', v_q1 - v_q0; END IF;
    ELSE
      IF (v_q1 - v_q0) = 0 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
        RAISE WARNING 'FAIL 5: sin secreto NO debía encolarse nada, hubo %', v_q1 - v_q0; END IF;
      RAISE NOTICE 's7_82 SMOKE: rama "falta el secreto" ejercitada — el INSERT sobrevivió igual';
    END IF;
  ELSE
    v_ok := v_ok + 1;
    RAISE NOTICE 's7_82 SMOKE: net.http_request_queue no legible — se omite el conteo de wakeups';
  END IF;

  -- ── 5. Un UPDATE NO despierta (evitaría un bucle) ─────────
  IF v_hay_cola THEN
    UPDATE doctor_owner_notifications SET updated_at = now() WHERE subject_request_id = v_req;
    EXECUTE 'SELECT count(*) FROM net.http_request_queue WHERE url = $1'
      INTO v_q2 USING v_url;
    IF v_q2 = v_q1 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
      RAISE WARNING 'FAIL 6: un UPDATE disparó el wakeup (delta %)', v_q2 - v_q1; END IF;
  ELSE
    v_ok := v_ok + 1;
  END IF;

  -- ── 6. El drenado sigue funcionando con el trigger puesto ─
  SELECT jsonb_array_length(notify_owner_claim_batch(10)) INTO v_n;
  IF v_n = 2 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
    RAISE WARNING 'FAIL 7: el lote trajo % filas, esperaba 2', v_n; END IF;

  -- ── 7. Y reclamar NO vuelve a despertar ───────────────────
  IF v_hay_cola THEN
    EXECUTE 'SELECT count(*) FROM net.http_request_queue WHERE url = $1'
      INTO v_q2 USING v_url;
    IF v_q2 = v_q1 THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1;
      RAISE WARNING 'FAIL 8: el drenado disparó wakeups nuevos (delta %)', v_q2 - v_q1; END IF;
  ELSE
    v_ok := v_ok + 1;
  END IF;

  RAISE NOTICE 's7_82 SMOKE: % OK, % FAIL', v_ok, v_fail;
  IF v_fail > 0 THEN RAISE EXCEPTION 's7_82 SMOKE con % FAIL', v_fail; END IF;
END $smoke82$;

ROLLBACK;
```

Tras el `ROLLBACK`, confirmar que no quedó nada **y que no se encoló ninguna
petición**:

```sql
SELECT
  (SELECT count(*) FROM doctor_affiliation_requests WHERE full_name LIKE 'S782_FIXTURE%') AS fixtures,
  (SELECT count(*) FROM doctor_owner_notifications)                                       AS avisos,
  (SELECT count(*) FROM net.http_request_queue
    WHERE url = 'https://kvrsfmzlrmmmavillpuj.supabase.co/functions/v1/notify-owner-doctor-events') AS wakeups_pendientes;
```

Los tres en **0**. El tercero es el que demuestra que **el smoke no mandó
ningún HTTP**: el encolado existió dentro de la transacción y murió con ella.

> Como en el smoke de `s7_80`, el `INSERT` de la fixture de afiliación dispara
> también el trigger de auditoría de `s7_21`. El `ROLLBACK` revierte esa fila
> de `audit_log` igual que todo lo demás — por eso el smoke no puede commitear.

---

## 5 · Cómo se observa el sistema

La distinción que sostiene el diseño:

> **Evento de negocio ocurrido = existe la fila.**
> **Correo enviado = esa fila llegó a `status = 'sent'`.**
> Son dos hechos separados y la tabla los separa físicamente.

```sql
SELECT status, count(*), max(occurred_at) AS ultimo
FROM doctor_owner_notifications GROUP BY status ORDER BY status;
```

| Señal | Cómo se ve |
|---|---|
| encolado | `status='pending'` |
| en curso | `status='sending'`, con `attempts`, `first_attempt_at` y `last_attempt_at` |
| entregado | `status='sent'`, con `sent_at` y `provider_message_id` |
| fallido | `status='failed'`, con `last_error_code` (código corto, **nunca** el cuerpo del error del proveedor, que puede traer direcciones) |
| **a reconciliar** | `status='needs_reconciliation'`, `last_error_code='idem_window_expired'` |

### Ventana de idempotencia — la regla que evita duplicados

Resend conserva la `Idempotency-Key` **24 horas**. Dentro de ese plazo, un
reintento con la misma clave devuelve el mensaje original; pasado el plazo, la
clave caduca y **el mismo reintento mandaría un segundo correo de verdad**.

Por eso la recuperación automática de `sending` está acotada a **23 h desde el
primer intento**, con una hora de margen:

| Caso | Qué pasa |
|---|---|
| `first_attempt_at` < 23 h | **Reintento** con el mismo `outbox.id` y la misma clave. Seguro |
| `first_attempt_at` ≥ 23 h | **No se reenvía.** Pasa a `needs_reconciliation` con `idem_window_expired` |

El techo se aplica con `LEAST`, no con `COALESCE`: **ningún llamador puede
pedir una ventana mayor**, ni por error ni a propósito. El smoke lo comprueba
pidiendo 48 h y verificando que no sirve de nada.

`first_attempt_at` se fija **una sola vez** y nunca se reescribe. Si se
actualizara en cada intento, la ventana se extendería indefinidamente y el
mecanismo entero quedaría anulado.

**Cómo resolver una fila a reconciliar** *(manual, deliberadamente)*:

1. Buscar en los logs de Resend si el mensaje de esa `Idempotency-Key` salió.
2. Si salió → `SELECT notify_owner_mark_result('<id>', 'sent', '<id_de_resend>', NULL);`
3. Si no salió → decidir si el aviso sigue teniendo valor. Si lo tiene, la vía
   es encolar un evento **nuevo**; no se resucita el viejo, porque su clave ya
   no protege de nada.

El criterio es explícito: **se prefiere un aviso en duda a un aviso
duplicado.** Un duplicado erosiona la confianza en el canal; una fila marcada
para revisión es visible y accionable.

> **Nota sobre `failed`:** es terminal y no se reintenta. Un 500 transitorio de
> Resend deja el aviso sin enviar. Es deliberado — reintentar `failed`
> reabriría la misma pregunta de ventana— y queda visible en la consulta de
> arriba. Si se quisiera reintentar, lo correcto es un frente P1 con su propia
> política, no un parche aquí.

`net._http_response` sirve para distinguir *"la webhook nunca llegó"* de
*"llegó y la función falló"*, pero tiene TTL corto: es diagnóstico inmediato,
no registro.

### Limitación asumida

`pg_net` entrega **at-most-once**: si se pierde un despertar, no hay reintento
propio. Está mitigado porque la función **drena la cola entera**, así que
cualquier evento posterior arrastra lo pendiente. El hueco real es una fila
pendiente sin ningún evento posterior; a este volumen podrían ser días.
Mientras tanto, invocar la función a mano (paso 6) drena todo. Un barredor
periódico es candidato natural a P1 — **no entra en P0** para no añadir
`pg_cron`.

---

## 6 · Lo que este frente NO hace

- No toca `src/`, Auth, Twilio, Turnstile ni la RLS de otras tablas.
- No escribe en `audit_log`: es inmutable y esto es estado operativo mutable.
- No modifica `admin_list_doctors` ni `admin_export_doctors`.
- No añade el deep-link `?request=` a la bandeja de afiliaciones — fuera de P0.
- No manda nada al médico: el único destinatario es el owner.
