# OWNER · Aplicación de `s7_83` y despliegue de `send-doctor-welcome-email`

**Frente:** `DOCTOR-WELCOME-EMAIL-P0` · **Migración 104** · PR de `claude/welcome-mail`.

> ⚠️ **Nada de este documento se ha ejecutado todavía.** Es la guía para cuando
> lo autorices. El PR se abrió con el SQL y la función **sin aplicar ni
> desplegar**.

---

## 0 · Qué NO se toca

`s7_80` / `s7_81` / `s7_82` · `notify-owner-doctor-events` · el claim · la
publicación · `trg_set_doctor_slug` · `admin_list_affiliation_requests` · DNS ·
Vercel · Turnstile · Twilio · SMTP de Auth.

**No se crea ningún secreto nuevo.** Se reutiliza la `RESEND_API_KEY`
transaccional que ya existe como secreto del proyecto. **No la del SMTP de
Auth** — rotar aquella tumbaría el recovery por email de todos.

---

## 1 · PRE — antes de aplicar

En el SQL Editor. Debe devolver **`0` en las tres filas**; si alguna trae otra
cosa, **detenerse**.

```sql
SELECT 'columna ya existe' AS control,
       count(*) AS debe_ser_cero
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'doctor_affiliation_requests'
   AND column_name LIKE 'welcome\_%'
UNION ALL
SELECT 'funcion ya existe',
       count(*)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('admin_welcome_email_state', 'admin_welcome_email_claim',
                     'admin_welcome_email_mark', '_welcome_email_claimable')
UNION ALL
SELECT 'constraint ya existe',
       count(*)
  FROM pg_constraint
 WHERE conname LIKE 'dar_welcome\_%';
```

---

## 2 · Aplicar el SQL

Ejecutar el contenido íntegro de `migrations/s7_83_doctor_welcome_email.sql`
en el SQL Editor de Supabase.

Es DDL transaccional: si algo falla, no deja objetos a medias. **No editar el
archivo**: es el registro de lo que se ejecutó.

---

## 3 · POST — verificación

Debe **completar sin excepción**. El SQL Editor no muestra `NOTICE`, así que la
prueba de que no hubo fallos es que **no lance**.

```sql
DO $$
DECLARE v_fail int := 0; v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='doctor_affiliation_requests'
     AND column_name LIKE 'welcome\_%';
  IF v_n <> 5 THEN v_fail := v_fail + 1; RAISE WARNING 'columnas: % (esperaba 5)', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_constraint WHERE conname LIKE 'dar_welcome\_%';
  IF v_n <> 6 THEN v_fail := v_fail + 1; RAISE WARNING 'constraints: % (esperaba 6)', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN
     ('admin_welcome_email_state','admin_welcome_email_claim',
      'admin_welcome_email_mark','_welcome_email_claimable');
  IF v_n <> 4 THEN v_fail := v_fail + 1; RAISE WARNING 'funciones: % (esperaba 4)', v_n; END IF;

  -- Ninguna solicitud existente puede haber quedado en otro estado.
  SELECT count(*) INTO v_n FROM doctor_affiliation_requests
   WHERE welcome_status <> 'not_sent';
  IF v_n <> 0 THEN v_fail := v_fail + 1; RAISE WARNING 'filas no vírgenes: %', v_n; END IF;

  -- anon NO puede ejecutar ninguna de las cuatro.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('admin_welcome_email_state','admin_welcome_email_claim',
                       'admin_welcome_email_mark','_welcome_email_claimable')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_n <> 0 THEN v_fail := v_fail + 1; RAISE WARNING 'anon puede ejecutar: %', v_n; END IF;

  IF v_fail > 0 THEN RAISE EXCEPTION 'POST FALLÓ: % comprobaciones', v_fail; END IF;
END $$;
```

---

## 4 · Desplegar la Edge Function

⚠️ **SIN `--no-verify-jwt`.** Es lo contrario de `notify-owner-doctor-events`:
a ésta la invoca un **navegador con sesión**, y `verify_jwt` por defecto es la
primera de las tres capas de autorización.

```bash
supabase functions deploy send-doctor-welcome-email --project-ref kvrsfmzlrmmmavillpuj
```

**No redesplegar `notify-owner-doctor-events` ni `admin-create-seed-doctor`.**

Después, borrar el residuo que deja la CLI y que no está en `.gitignore`:

```bash
rm -rf supabase/.temp
```

---

## 5 · Comprobar secretos (sin leer valores)

En el Dashboard → Edge Functions → Secrets, confirmar que **existe**
`RESEND_API_KEY`. Los secretos son **por proyecto**, así que la función nueva
lo hereda. **No hay que crear ninguno.**

**No imprimir, copiar ni pegar su valor en ningún sitio.**

---

## 6 · QA E2E con fixture aislada

⚠️ **Ni Camilo ni Katherine.** Fixture propia, marcada, creada desde cero, con
un correo que controles.

### Controles negativos — ninguno debe enviar

Cada uno debe dejar el botón deshabilitado con su motivo:

| Escenario | Motivo esperado |
|---|---|
| Solicitud sin médico creado | `no_doctor` |
| Solicitud con `email` vacío | `no_email` |
| Médico no publicado | `not_published` |
| Médico publicado sin slug | `no_slug` |
| `lucy_status <> 'listed_only'` | `already_claimed` |
| Ya enviada | `already_sent` |

### Control de autorización

Con sesión **`directory_editor`**, las tres RPCs deben responder **`P0160`**.
Es el control que demuestra que el gate no es decorativo: autenticado sí,
autorizado no.

### Positivo

1. Crear solicitud + médico fixture, publicar, dejar en `listed_only`.
2. Pulsar **«Enviar correo de bienvenida»** → llega el correo → estado
   **«Bienvenida enviada»** con fecha.
3. Verificar el remitente: `LucyCare para Médicos <medicos@lucycare.app>` y que
   **responder** al correo llegue al buzón de Workspace.
4. Pulsar de nuevo → el botón ya no está disponible, **no llega un segundo
   correo**.

### Concurrencia

Dos envíos en paralelo sobre la misma solicitud → **exactamente un** correo; el
otro responde `not_sendable`.

### Cleanup

Borrar la fixture y verificar **0 residuales**.

⚠️ **Residuo asumido:** publicar la fixture escribe en `audit_log` vía
`admin_set_doctor_published`, y `audit_log` es **inmutable** desde `s7_71b`.
Esas filas **no se borran**, igual que en `#353`.

---

## 7 · Rollback

Solo ante FAIL explícito. `docs/rollbacks/s7_83_rollback.sql` requiere
`git add -f` por la regla `*.sql` del `.gitignore`.

Revertir es seguro mientras no se haya enviado ningún correo real: elimina las
cuatro funciones y las cinco columnas. **Si ya hubo envíos, borrar las columnas
pierde el registro de a quién se le escribió** — en ese caso, dejar las
columnas y eliminar solo las funciones.
