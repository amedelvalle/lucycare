# OWNER — aplicación de `s7_77` (PATIENT-CRM-P0 · RPCs de lectura)

> ## ✅ `s7_77` = **APPLIED / VERIFIED / CLOSED** (2026-08-24)
>
> Migración **98**. **No volver a aplicarla.** Evidencia live completa:
>
> | Paso | Resultado |
> |---|---|
> | PRE | **29 PASS · 0 FAIL · 2 INFO** |
> | Apply | `Success. No rows returned` — sin excepción |
> | POST catálogo (final) | **57 PASS · 0 FAIL · 3 INFO** |
> | POST funcional | **22 PASS · 0 FAIL · 4 INFO** |
> | Prueba negativa del filtro | **`P0147`** correcto, y el mensaje **no repite el valor enviado** |
> | `audit_log` · `patient_crm_export` tras el rechazo | **0 filas** |
>
> El POST de catálogo necesitó **dos correcciones del instrumento**, ninguna de
> la migración: primero un `42725` por concatenar `pg_proc.provolatile` —tipo
> interno `"char"`— sin `::text`; después cuatro falsos positivos por analizar
> `prosrc` **crudo**, que incluye los comentarios de la propia migración. Ambas
> quedaron corregidas, con guardas estáticas que impiden la reincidencia.
>
> **`s7_76` y `s7_77` = APPLIED / CLOSED.** Lo que sigue abierto en
> `PATIENT-CRM-P0` es el **frontend**: local, sin commitear y sin PR.

> ### ⚠️ Todo el SQL está EN LÍNEA en este documento.
>
> No hay que abrir ningún archivo del repositorio. Recordatorio del incidente
> anterior: `scripts/check-s7_76.mjs` es **JavaScript** y nunca va al SQL Editor.

---

## Qué cambió respecto del paquete anterior

Cuatro correcciones **bloqueantes**, todas hechas antes de aplicar nada.

### 1 · El filtro por estado se aplicaba DESPUÉS de paginar

La versión anterior hacía `base → LIMIT/OFFSET → agregados → filtrar`. Eso
rompía tres cosas a la vez:

- `total` contaba el universo **sin filtrar**, así que el paginador mentía;
- una coincidencia que caía en la posición 26 del orden general **no aparecía
  nunca** en su propio filtro: el recorte la había descartado antes de que se
  supiera su estado;
- la exportación heredaba el defecto — recorría las primeras N filas sin
  filtrar y recién ahí filtraba.

**Orden vigente:** `universo + búsqueda → agregados y estado derivado → FILTRO
→ TOTAL del conjunto filtrado → PAGINACIÓN`.

Hay una **ruta rápida** cuando `p_status IS NULL`: ahí el filtro es un no-op, así
que recortar antes de agregar da exactamente el mismo resultado y los `LATERAL`
vuelven a tocar 25-50 filas. **Las dos rutas viven en la misma consulta** —un
`CASE` en el `LIMIT`—, no en dos consultas que podrían divergir.

### 2 · `p_status` ahora tiene allowlist cerrada server-side

`_crm_status_norm(text)` normaliza (`btrim` + `lower`) y acepta **solo**
`nuevo`, `activo`, `en_seguimiento`, `recurrente`, `inactivo`, `bloqueado`, o
NULL/vacío. Cualquier otra cosa muere con **`P0147`** —el siguiente código libre
después de `P0146`— **antes de consultar y antes de auditar**. El mensaje de
error **no repite el valor recibido**, para que un `p_status` con datos
personales no termine en los logs. El audit del export guarda **el valor
normalizado o NULL**, nunca lo que llegó.

### 3 · El control 221 del POST funcional no probaba nada

Comparaba `crm_patient_identity.profile_id` con `patients.id` — entidades
distintas. Reemplazado por una prueba real: el universo se **recomputa de forma
independiente** sobre `profiles`, y se verifica que el total del listado **no
suma** los walk-ins.

### 4 · Mínimo privilegio antes del primer apply

Como `s7_77` todavía no está aplicada, la vista y los tres helpers privados
nacen ya sin acceso para **`service_role`** —además de `PUBLIC`, `anon` y
`authenticated`—. Las RPCs públicas siguen siendo `SECURITY DEFINER`, así que
funcionan igual: corren como owner. **No se tocó `s7_76` ni las RPCs públicas.**

---

## Qué hace `s7_77`

Solo **lectura**. No crea ni modifica una sola fila de negocio.

| Crea | Detalle |
|---|---|
| 1 vista | `crm_patient_identity` — predicado canónico. **Una sola columna: `profile_id`** |
| 3 helpers privados | `_crm_estado(...)` `IMMUTABLE` · `_crm_status_norm(text)` `IMMUTABLE` · `_crm_patients_json(...)` `STABLE` |
| 4 RPCs públicas | `admin_list_patients_crm` · `admin_list_unlinked_patients` · `admin_patients_crm_stats` · `admin_export_patients_crm` |
| Gate | `is_admin()` como primera instrucción en las cuatro, error `P0140` |
| Grants | `EXECUTE` a `authenticated` en las 4 RPCs. Vista y helpers: **sin acceso para ningún rol**, `service_role` incluido |

**Qué NO toca:** ninguna tabla, policy ni grant de `s7_76`; ni `profiles`,
`patients`, `appointments`, `auth.users`, Auth, Booking, el panel del médico ni
el merge/unmerge de fichas.

**El motor ya está medido: PostgreSQL 17.6.** La vista recibirá
`security_invoker = true`.

---

## PASO 1 — PRE read-only

Solo `SELECT` y catálogo. Sin `DO`, sin DDL, sin DML.

```sql
-- ══ s7_77 · PASO 1 — PRE (100% read-only) ══
WITH crm(t) AS (
  VALUES ('patient_crm'), ('patient_crm_tags'),
         ('patient_crm_followups'), ('patient_crm_notes')
),
nuevos(f) AS (
  VALUES ('_crm_estado'), ('_crm_status_norm'), ('_crm_patients_json'),
         ('admin_list_patients_crm'), ('admin_list_unlinked_patients'),
         ('admin_patients_crm_stats'), ('admin_export_patients_crm')
),
cols AS (
  SELECT c.relname AS t, string_agg(a.attname, ',' ORDER BY a.attnum) AS lista
  FROM pg_class c
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN (SELECT t FROM crm)
  GROUP BY c.relname
)
-- ── A. s7_76 presente y consistente ─────────────────────────
SELECT  1 AS n, 'A · las cuatro tablas de s7_76 existen' AS control, '4' AS esperado,
        (SELECT count(*)::text FROM pg_class
          WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
            AND relname IN (SELECT t FROM crm)) AS obtenido,
        CASE WHEN (SELECT count(*) FROM pg_class
                    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
                      AND relname IN (SELECT t FROM crm)) = 4
             THEN 'PASS' ELSE 'FAIL' END AS resultado
UNION ALL SELECT 2, 'A · columnas de patient_crm sin cambios',
  'profile_id,blocked_at,blocked_reason,blocked_by,unblocked_at,unblocked_reason,unblocked_by,created_at,updated_at',
  (SELECT lista FROM cols WHERE t = 'patient_crm'),
  CASE WHEN (SELECT lista FROM cols WHERE t = 'patient_crm') =
    'profile_id,blocked_at,blocked_reason,blocked_by,unblocked_at,unblocked_reason,unblocked_by,created_at,updated_at'
    THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 3, 'A · columnas de patient_crm_followups sin cambios',
  'id,profile_id,title,detail,due_at,status,created_at,created_by,resolved_at,resolved_by,resolution',
  (SELECT lista FROM cols WHERE t = 'patient_crm_followups'),
  CASE WHEN (SELECT lista FROM cols WHERE t = 'patient_crm_followups') =
    'id,profile_id,title,detail,due_at,status,created_at,created_by,resolved_at,resolved_by,resolution'
    THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 4, 'A · los 7 CHECK de s7_76 siguen', '7',
  (SELECT count(*)::text FROM pg_constraint
    WHERE contype = 'c' AND conname IN (
      'patient_crm_block_coherente','patient_crm_unblock_coherente',
      'patient_crm_tags_no_vacia','patient_crm_followups_status_chk',
      'patient_crm_followups_titulo','patient_crm_followups_cierre',
      'patient_crm_notes_body')),
  CASE WHEN (SELECT count(*) FROM pg_constraint
    WHERE contype = 'c' AND conname IN (
      'patient_crm_block_coherente','patient_crm_unblock_coherente',
      'patient_crm_tags_no_vacia','patient_crm_followups_status_chk',
      'patient_crm_followups_titulo','patient_crm_followups_cierre',
      'patient_crm_notes_body')) = 7 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 5, 'A · los 7 índices de s7_76 siguen', '7',
  (SELECT count(*)::text FROM pg_class
    WHERE relkind = 'i' AND relnamespace = 'public'::regnamespace
      AND relname IN ('patient_crm_tags_uniq','idx_patient_crm_followups_abiertos',
                      'idx_patient_crm_notes_profile','idx_patients_profile_id',
                      'idx_patients_sin_identidad','idx_appointments_patient_start',
                      'idx_appointments_patient_status')),
  CASE WHEN (SELECT count(*) FROM pg_class
    WHERE relkind = 'i' AND relnamespace = 'public'::regnamespace
      AND relname IN ('patient_crm_tags_uniq','idx_patient_crm_followups_abiertos',
                      'idx_patient_crm_notes_profile','idx_patients_profile_id',
                      'idx_patients_sin_identidad','idx_appointments_patient_start',
                      'idx_appointments_patient_status')) = 7 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 6, 'A · auditoría de s7_76 intacta (función + 4 triggers)', 'true/4',
  (SELECT (to_regprocedure('public.audit_patient_crm()') IS NOT NULL)::text || '/' ||
          (SELECT count(*)::text FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
            WHERE NOT tg.tgisinternal AND c.relname IN (SELECT t FROM crm)
              AND tg.tgname = 'audit_' || c.relname)),
  CASE WHEN to_regprocedure('public.audit_patient_crm()') IS NOT NULL
        AND (SELECT count(*) FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
              WHERE NOT tg.tgisinternal AND c.relname IN (SELECT t FROM crm)
                AND tg.tgname = 'audit_' || c.relname) = 4
  THEN 'PASS' ELSE 'FAIL' END

-- ── B. Baseline de filas CRM ────────────────────────────────
UNION ALL SELECT 10, 'B · patient_crm vacía', '0',
  (SELECT count(*)::text FROM public.patient_crm),
  CASE WHEN (SELECT count(*) FROM public.patient_crm) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 11, 'B · patient_crm_tags vacía', '0',
  (SELECT count(*)::text FROM public.patient_crm_tags),
  CASE WHEN (SELECT count(*) FROM public.patient_crm_tags) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 12, 'B · patient_crm_followups vacía', '0',
  (SELECT count(*)::text FROM public.patient_crm_followups),
  CASE WHEN (SELECT count(*) FROM public.patient_crm_followups) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 13, 'B · patient_crm_notes vacía', '0',
  (SELECT count(*)::text FROM public.patient_crm_notes),
  CASE WHEN (SELECT count(*) FROM public.patient_crm_notes) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 14, 'B · aún no hay exportaciones auditadas', '0',
  (SELECT count(*)::text FROM public.audit_log WHERE table_name = 'patient_crm_export'),
  CASE WHEN (SELECT count(*) FROM public.audit_log
              WHERE table_name = 'patient_crm_export') = 0 THEN 'PASS' ELSE 'FAIL' END

-- ── C. s7_77 todavía NO aplicada ────────────────────────────
UNION ALL SELECT 20, 'C · crm_patient_identity NO existe todavía', 'true',
  (to_regclass('public.crm_patient_identity') IS NULL)::text,
  CASE WHEN to_regclass('public.crm_patient_identity') IS NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 21, 'C · tampoco existe un tipo con ese nombre', '0',
  (SELECT count(*)::text FROM pg_type
    WHERE typnamespace = 'public'::regnamespace AND typname = 'crm_patient_identity'),
  CASE WHEN (SELECT count(*) FROM pg_type
    WHERE typnamespace = 'public'::regnamespace AND typname = 'crm_patient_identity') = 0
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 22, 'C · ninguna de las 7 funciones de s7_77 existe (ni sobrecargada)', '0',
  (SELECT count(*)::text FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname IN (SELECT f FROM nuevos)),
  CASE WHEN (SELECT count(*) FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname IN (SELECT f FROM nuevos)) = 0
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 23, 'C · si alguna existiera, cuál (diagnóstico)', '(ninguna)',
  (SELECT coalesce(string_agg(DISTINCT proname, ','), '(ninguna)') FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname IN (SELECT f FROM nuevos)),
  'INFO'
UNION ALL SELECT 24, 'C · P0147 es un código libre en el proyecto', '(sin uso previo)',
  'P0147', 'INFO'

-- ── D. Motor ────────────────────────────────────────────────
UNION ALL SELECT 30, 'D · server_version_num soporta security_invoker (PG15+)', '>= 150000',
  current_setting('server_version_num'),
  CASE WHEN current_setting('server_version_num')::int >= 150000
  THEN 'PASS' ELSE 'FAIL' END

-- ── E. RLS y policies de s7_76 intactas ─────────────────────
UNION ALL SELECT 40, 'E · RLS sigue activa en las cuatro', '4',
  (SELECT count(*)::text FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN (SELECT t FROM crm) AND relrowsecurity),
  CASE WHEN (SELECT count(*) FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN (SELECT t FROM crm) AND relrowsecurity) = 4 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 41, 'E · siguen siendo 4 policies, SELECT / TO authenticated / is_admin()', '4',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (SELECT t FROM crm)
      AND policyname = tablename || '_select_admin'
      AND cmd = 'SELECT' AND roles::text = '{authenticated}'
      AND coalesce(qual, '') LIKE '%is_admin()%' AND with_check IS NULL),
  CASE WHEN (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (SELECT t FROM crm)
      AND policyname = tablename || '_select_admin'
      AND cmd = 'SELECT' AND roles::text = '{authenticated}'
      AND coalesce(qual, '') LIKE '%is_admin()%' AND with_check IS NULL) = 4
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 42, 'E · anon sigue sin nada sobre las cuatro', '0',
  (SELECT count(*)::text FROM crm, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p
    WHERE has_table_privilege('anon', 'public.' || t, p)),
  CASE WHEN (SELECT count(*) FROM crm, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p
    WHERE has_table_privilege('anon', 'public.' || t, p)) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 43, 'E · authenticated sigue solo con SELECT', '0',
  (SELECT count(*)::text FROM crm,
     unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
    WHERE has_table_privilege('authenticated', 'public.' || t, p)),
  CASE WHEN (SELECT count(*) FROM crm,
     unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
    WHERE has_table_privilege('authenticated', 'public.' || t, p)) = 0 THEN 'PASS' ELSE 'FAIL' END

-- ── F. Prerrequisitos que s7_77 necesita para no abortar ────
UNION ALL SELECT 50, 'F · is_admin() existe', 'true',
  (to_regprocedure('public.is_admin()') IS NOT NULL)::text,
  CASE WHEN to_regprocedure('public.is_admin()') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 51, 'F · is_admin() NO mira lucyadmin_access (sigue siendo Owner Admin)', 'false',
  (SELECT coalesce(bool_or(prosrc ILIKE '%lucyadmin_access%'), false)::text FROM pg_proc
    WHERE oid = to_regprocedure('public.is_admin()')),
  CASE WHEN (SELECT coalesce(bool_or(prosrc ILIKE '%lucyadmin_access%'), false) FROM pg_proc
    WHERE oid = to_regprocedure('public.is_admin()')) = false THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 52, 'F · existe el estado de cita "atendida"', 'true',
  (SELECT EXISTS (SELECT 1 FROM public.appointment_statuses WHERE name = 'atendida')::text),
  CASE WHEN EXISTS (SELECT 1 FROM public.appointment_statuses WHERE name = 'atendida')
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 53, 'F · appointment_statuses tiene is_final', 'true',
  (SELECT EXISTS (SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.appointment_statuses'::regclass
       AND attname = 'is_final' AND attnum > 0 AND NOT attisdropped)::text),
  CASE WHEN EXISTS (SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.appointment_statuses'::regclass
       AND attname = 'is_final' AND attnum > 0 AND NOT attisdropped)
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 54, 'F · las 6 relaciones que lee la vista existen', '6',
  (SELECT count(*)::text FROM unnest(ARRAY['public.profiles','public.lucyadmin_access',
     'public.admin_seed_operations','public.patients','public.doctors',
     'public.clinic_members']) AS r WHERE to_regclass(r) IS NOT NULL),
  CASE WHEN (SELECT count(*) FROM unnest(ARRAY['public.profiles','public.lucyadmin_access',
     'public.admin_seed_operations','public.patients','public.doctors',
     'public.clinic_members']) AS r WHERE to_regclass(r) IS NOT NULL) = 6
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 55, 'F · profiles tiene is_active, role y email', '3',
  (SELECT count(*)::text FROM pg_attribute
    WHERE attrelid = 'public.profiles'::regclass AND attnum > 0 AND NOT attisdropped
      AND attname IN ('is_active','role','email')),
  CASE WHEN (SELECT count(*) FROM pg_attribute
    WHERE attrelid = 'public.profiles'::regclass AND attnum > 0 AND NOT attisdropped
      AND attname IN ('is_active','role','email')) = 3 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 56, 'F · patients tiene merged_into_patient_id e is_active', '2',
  (SELECT count(*)::text FROM pg_attribute
    WHERE attrelid = 'public.patients'::regclass AND attnum > 0 AND NOT attisdropped
      AND attname IN ('merged_into_patient_id','is_active')),
  CASE WHEN (SELECT count(*) FROM pg_attribute
    WHERE attrelid = 'public.patients'::regclass AND attnum > 0 AND NOT attisdropped
      AND attname IN ('merged_into_patient_id','is_active')) = 2 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 57, 'F · audit_log existe y el enum acepta select', 'true',
  (SELECT (to_regclass('public.audit_log') IS NOT NULL
           AND EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid
                        WHERE ty.typname = 'audit_action' AND e.enumlabel = 'select'))::text),
  CASE WHEN to_regclass('public.audit_log') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid
                     WHERE ty.typname = 'audit_action' AND e.enumlabel = 'select')
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 58, 'F · auth.uid() existe (actor de la auditoría de export)', 'true',
  (to_regprocedure('auth.uid()') IS NOT NULL)::text,
  CASE WHEN to_regprocedure('auth.uid()') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 59, 'F · el rol service_role existe (la migración le revoca)', 'true',
  (SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')::text),
  CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
  THEN 'PASS' ELSE 'FAIL' END
ORDER BY 1;
```

**Lo que autoriza continuar:** todo `PASS`; los controles **23** y **24** son
diagnósticos y el 23 debe decir `(ninguna)`.

---

## PASO 2 — MODIFICA DB

> ### ⚠️ El SQL está completo acá abajo. No abrir ningún archivo.
>
> En el repositorio hay **dos** archivos con `s7_77`/`s7_76` en el nombre: las
> migraciones `.sql` y `scripts/check-s7_76.mjs`, que es **JavaScript** y corre
> con `node`. Pegar el segundo produce `ERROR 42601: syntax error at or near
> "fs"`. **El SQL de abajo es la fuente única para este paso.**

Ejecutar el bloque completo, de una sola vez. Va entero dentro de **una
transacción explícita** (`BEGIN; … COMMIT;`) con guardas **PRE** y **POST**
propias. Si cualquiera lanza excepción, el rollback es **total**.

```sql
BEGIN;

-- ─── 0. Guardas PRE ─────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.patient_crm') IS NULL
     OR to_regclass('public.patient_crm_followups') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: falta la fundación de s7_76';
  END IF;
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: is_admin() no existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.appointment_statuses WHERE name = 'atendida') THEN
    RAISE EXCEPTION 'PRE fallo: no existe el estado de cita "atendida"';
  END IF;
END $$;

-- ─── 1. QUIÉN ES UN PACIENTE LUCYCARE — el FROM raíz ────────
-- La raíz del CRM es la IDENTIDAD GLOBAL, no la ficha. Si la raíz fuera
-- `patients`, una cuenta LucyCare que todavía no agendó nunca —ni tiene ficha
-- local— sería INVISIBLE para el CRM. Medido en el esquema actual: 22 de 25
-- identidades de paciente tienen CERO fichas.
--
-- ⚠️ `role = 'patient'` NO alcanza como predicado. Medido:
--   · Un profile con `role='patient'` puede tener fila en `doctors`: el
--     approve con `reuse_patient` (s7_42) crea el médico sobre el profile del
--     paciente y NO toca `role`. Hoy hay 1 caso.
--   · Un profile con `role='patient'` puede ser `clinic_members` (asistente).
--     Hoy hay 1 caso.
--   · Las identidades TÉCNICAS del seed (s7_73) nacen con `role='patient'`
--     porque `handle_new_user` las crea así.
--
-- Por eso la elegibilidad se define UNA sola vez, acá, y las tres RPCs la
-- consumen. Sin esta vista, el predicado se duplicaría en tres consultas y
-- divergiría al primer cambio.
-- ⚠️ P1.1 · UNA IDENTIDAD PUEDE SER MÁS DE UNA COSA.
-- «Tiene fila en doctors» NO implica «no es paciente». Un médico puede ser
-- además paciente de otro médico, y un asistente también. La evidencia FUERTE
-- de relación de paciente es tener una ficha `patients` vinculada.
--
-- Por eso hay dos clases de exclusión, y NO son simétricas:
--
--   DURAS (siempre fuera, tengan ficha o no):
--     · cuenta desactivada
--     · acceso administrativo LucyAdmin vigente
--     · identidad técnica del seed
--
--   BLANDAS (fuera solo si NO hay relación de paciente):
--     · ser médico
--     · ser staff de clínica
--     · ser dueño de clínica
-- ⚠️ F2 · LA VISTA DEVUELVE UNA SOLA COLUMNA: `profile_id`.
-- Su trabajo es decir QUIÉN pertenece al universo del CRM, no describirlo. Si
-- expusiera nombre, teléfono o correo sería un segundo lugar por donde sale
-- PII, y encima invisible: quien mirara la RPC no vería la fuente. Las
-- columnas de presentación se piden a `profiles` con un JOIN explícito, en la
-- allowlist de `_crm_patients_json`, que es el único lugar donde se decide qué
-- viaja al navegador.
--
-- Se usa DROP + CREATE, no CREATE OR REPLACE: reemplazar una vista no permite
-- cambiarle las columnas, así que una versión anterior con más columnas haría
-- fallar la migración en vez de corregirla.
DROP VIEW IF EXISTS public.crm_patient_identity;

CREATE VIEW public.crm_patient_identity AS
SELECT p.id AS profile_id
FROM public.profiles p
WHERE
  -- ── DURA 1 · cuentas desactivadas: no son base comercial ──
  p.is_active = true

  -- ── DURA 2 · acceso administrativo, por su fuente AUTORITATIVA ──
  -- `owner_admin` NO vive en `lucyadmin_access`: es `profiles.role='admin'`
  -- (así lo documenta s7_57). Los otros dos niveles sí viven en la tabla, y
  -- solo cuentan si el acceso está VIGENTE (`is_active`).
  -- No se depende de que un `operations_admin` sea casualmente `clinic_member`.
  AND p.role <> 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM public.lucyadmin_access la
    WHERE la.profile_id = p.id AND la.is_active = true
  )

  -- ── DURA 3 · identidad TÉCNICA del seed (s7_73) ──
  -- Dos evidencias, con COBERTURAS DISTINTAS. Conviene ser exacto, porque una
  -- de ellas se creyó más fuerte de lo que es (F1):
  --
  --   · `admin_seed_operations.seed_user_id` — DEFENSA ESTRUCTURAL. Cubre el
  --     100% de los seeds mientras la fila exista, sin depender del email.
  --
  --   · el email determinístico `@doctor-seed.invalid` (RFC 2606) — DEFENSA
  --     PARCIAL. La Edge Function crea el `auth.user` con ese correo y
  --     `handle_new_user` lo copia a `profiles.email`; PERO el paso 8.7 de
  --     `admin_create_seed_doctor` hace `email = coalesce(v_email, email)`, así
  --     que si el admin cargó un correo comercial en el formulario, el profile
  --     técnico deja de tener el `.invalid` y este predicado NO lo reconoce.
  --
  -- Consecuencia medida: durante la VENTANA DE CLEANUP B→C —la fila de
  -- `admin_seed_operations` ya se borró y el `auth.user` todavía existe— la
  -- cobertura es COMPLETA solo si el seed se creó SIN correo comercial. Con
  -- correo, esa ventana queda descubierta. No se documenta como garantía.
  -- Ver `docs/ANALISIS_PATIENT_CRM.md` §F1 para la evidencia y la alternativa.
  AND NOT EXISTS (
    SELECT 1 FROM public.admin_seed_operations so WHERE so.seed_user_id = p.id
  )
  AND coalesce(p.email, '') NOT LIKE '%@doctor-seed.invalid'

  -- ── BLANDAS · solo excluyen si NO hay relación real de paciente ──
  AND (
    EXISTS (SELECT 1 FROM public.patients pa WHERE pa.profile_id = p.id)
    OR (
      p.role = 'patient'
      AND NOT EXISTS (SELECT 1 FROM public.doctors d        WHERE d.profile_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.clinic_members cm WHERE cm.profile_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.clinics c         WHERE c.owner_id  = p.id)
    )
  );

COMMENT ON VIEW public.crm_patient_identity IS
  'PATIENT-CRM-P0. Predicado CANÓNICO de identidad global de paciente LucyCare. Devuelve UNA sola columna, profile_id: dice quién pertenece al universo del CRM, no lo describe — el nombre, el teléfono y el correo se piden a profiles con un JOIN explícito dentro de _crm_patients_json. Exclusiones DURAS: cuenta desactivada, acceso administrativo LucyAdmin vigente (profiles.role=admin o lucyadmin_access activo) e identidad técnica del seed. Exclusiones BLANDAS (solo sin ficha patients): médico, staff y dueño de clínica — un médico que además es paciente SÍ entra. Es el FROM raíz de todas las lecturas del CRM.';

-- Sin grants: solo la leen las RPCs SECURITY DEFINER, que corren como owner.
REVOKE ALL ON public.crm_patient_identity FROM PUBLIC;
REVOKE ALL ON public.crm_patient_identity FROM anon;
REVOKE ALL ON public.crm_patient_identity FROM authenticated;
REVOKE ALL ON public.crm_patient_identity FROM service_role;

-- Defensa adicional: con `security_invoker`, la vista evalúa los permisos de
-- las tablas subyacentes contra el usuario ACTUAL en vez de contra su dueño.
-- Dentro de las RPCs `SECURITY DEFINER` el usuario actual ES el owner, así que
-- el comportamiento no cambia; lo que cambia es que la vista deja de ser un
-- posible atajo de privilegios si alguien le concediera SELECT por error.
-- Requiere PostgreSQL 15+: en versiones anteriores la opción no existe y el
-- `ALTER` fallaría, así que se aplica solo si el servidor la soporta.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW public.crm_patient_identity SET (security_invoker = true)';
    RAISE NOTICE 's7_77: crm_patient_identity con security_invoker = true';
  ELSE
    RAISE NOTICE 's7_77: PostgreSQL % no soporta security_invoker; la vista queda con los permisos de su dueño (sigue sin grants para clientes)',
      current_setting('server_version');
  END IF;
END $$;

-- ─── 2. Umbrales, en un solo lugar ──────────────────────────
-- ⚠️ `p_ahora` se pasa como ARGUMENTO, no se lee con `now()` adentro.
-- Una función IMMUTABLE que consulta el reloj es una mentira al planificador:
-- PostgreSQL puede cachear su resultado, plegarla en tiempo de planificación o
-- usarla en un índice, y devolvería estados congelados. Con la fecha de
-- referencia explícita, la función es genuinamente inmutable y además
-- comprobable: la misma entrada da siempre la misma salida.
CREATE OR REPLACE FUNCTION public._crm_estado(
  p_bloqueado        boolean,
  p_followups_open   int,
  p_atendidas        int,
  p_creado           timestamptz,
  p_proxima_cita     timestamptz,
  p_ultima_actividad timestamptz,
  p_ahora            timestamptz
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_bloqueado                                       THEN 'bloqueado'
    WHEN coalesce(p_followups_open, 0) > 0                 THEN 'en_seguimiento'
    WHEN coalesce(p_atendidas, 0) >= 2                     THEN 'recurrente'
    WHEN p_creado >= p_ahora - interval '30 days'           THEN 'nuevo'
    WHEN p_proxima_cita IS NOT NULL                        THEN 'activo'
    WHEN p_ultima_actividad >= p_ahora - interval '90 days' THEN 'activo'
    WHEN p_ultima_actividad IS NULL
      OR p_ultima_actividad < p_ahora - interval '180 days' THEN 'inactivo'
    ELSE 'activo'
  END;
$$;

REVOKE ALL ON FUNCTION public._crm_estado(boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._crm_estado(boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public._crm_estado(boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz) FROM authenticated;
REVOKE ALL ON FUNCTION public._crm_estado(boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz) FROM service_role;

-- ─── 3. ALLOWLIST CERRADA DEL FILTRO POR ESTADO ─────────────
-- `p_status` llega del navegador. Los estados son un conjunto CERRADO (D2), así
-- que se validan server-side ANTES de consultar y ANTES de auditar: un valor
-- arbitrario —o PII pegada por error en el buscador de estado— no debe llegar
-- ni a la consulta ni a `audit_log`.
--
-- ⚠️ El mensaje de error NO interpola el valor recibido. Si lo hiciera, un
-- `p_status` con datos personales terminaría en el texto de la excepción y de
-- ahí en los logs. Se rechaza sin repetir lo que llegó.
CREATE OR REPLACE FUNCTION public._crm_status_norm(p_status text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  v text;
BEGIN
  v := nullif(btrim(lower(coalesce(p_status, ''))), '');
  IF v IS NULL THEN
    RETURN NULL;
  END IF;
  IF v NOT IN ('nuevo', 'activo', 'en_seguimiento', 'recurrente',
               'inactivo', 'bloqueado') THEN
    RAISE EXCEPTION 'Filtro de estado no válido' USING ERRCODE = 'P0147';
  END IF;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public._crm_status_norm(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._crm_status_norm(text) FROM anon;
REVOKE ALL ON FUNCTION public._crm_status_norm(text) FROM authenticated;
REVOKE ALL ON FUNCTION public._crm_status_norm(text) FROM service_role;

-- ─── 4. NÚCLEO COMPARTIDO — una sola allowlist ──────────────
-- P5: la exportación NO construye una consulta paralela. Listado y export
-- llaman a ESTA función, así que la allowlist de columnas y el predicado de
-- identidad viven en un único lugar y no pueden divergir. Si mañana alguien
-- agregara una columna clínica acá, la agregaría a los dos caminos a la vez —
-- y el check estático lo bloquearía antes.
--
-- ═══ ORDEN DE OPERACIONES — LA PARTE QUE IMPORTA ═══
--
--   universo + búsqueda  →  agregados y estado derivado  →  FILTRO por estado
--   →  TOTAL del conjunto filtrado  →  PAGINACIÓN
--
-- La versión anterior filtraba DESPUÉS de paginar, y eso estaba mal de tres
-- maneras a la vez:
--   · `total` contaba el universo sin filtrar, así que el paginador mentía;
--   · un `recurrente` que caía en la posición 26 del orden general no aparecía
--     NUNCA en el filtro `recurrente`, porque el recorte ya lo había dejado
--     fuera antes de saber su estado;
--   · la exportación heredaba el mismo defecto: recorría las primeras N filas
--     sin filtrar y recién ahí filtraba, en vez de exportar el conjunto
--     filtrado completo.
--
-- El estado es DERIVADO (D2): no se puede filtrar por él sin haberlo calculado,
-- y no se puede calcular sin los agregados. Por eso, cuando hay filtro, los
-- agregados se calculan sobre todo el universo elegible y no sobre una página.
--
-- ⚠️ RUTA RÁPIDA, con la MISMA semántica. Cuando `p_status IS NULL` el filtro
-- es un no-op: recortar antes de agregar da EXACTAMENTE el mismo resultado que
-- recortar después, así que ahí sí se pagina primero y los `LATERAL` vuelven a
-- tocar solo 25-50 filas. Las dos rutas viven en la MISMA consulta —un `CASE`
-- en el `LIMIT`—, no en dos consultas que podrían divergir.
--
-- Costo asumido: con filtro por estado se enriquece todo el universo elegible.
-- Al volumen actual es despreciable. Si algún día pesa, se resuelve con una
-- vista materializada de estados, no volviendo a filtrar después de paginar.
--
-- Privada: sin gate propio (lo ponen los wrappers públicos) y sin grants.
CREATE OR REPLACE FUNCTION public._crm_patients_json(
  p_search text,
  p_status text,
  p_limit  int,
  p_offset int
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_limit  int;
  v_offset int;
  v_q      text;
  v_status text;
  v_total  bigint;
  v_rows   jsonb;
BEGIN
  v_limit  := greatest(coalesce(p_limit, 25), 1);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_q      := nullif(btrim(coalesce(p_search, '')), '');
  -- Defensa en profundidad: los wrappers públicos ya validaron, pero el núcleo
  -- no confía en su llamador. Normaliza o lanza P0147.
  v_status := public._crm_status_norm(p_status);

  -- FROM raíz: la IDENTIDAD GLOBAL elegible (ver la vista de arriba), NUNCA
  -- `patients`. Un paciente con 0 fichas y 0 citas SÍ aparece: es una cuenta
  -- LucyCare real que todavía no agendó, y el CRM existe justamente para eso.
  -- Las fichas sin `profile_id` NO entran acá; van a la bandeja de
  -- "Pendientes de identificar" (D1/D5), y sus conteos NO se suman.
  --
  -- F2 · la vista dice QUIÉNES son; `profiles` dice CÓMO se llaman. El JOIN es
  -- explícito y las columnas se nombran una a una: acá se ve, en una sola
  -- pantalla, todo lo que puede salir del sistema.
  WITH base AS (
    SELECT p.id, p.full_name, p.phone, p.email, p.created_at
    FROM public.crm_patient_identity ci
    JOIN public.profiles p ON p.id = ci.profile_id
    WHERE (v_q IS NULL
           OR p.full_name ILIKE '%' || v_q || '%'
           OR p.phone     ILIKE '%' || v_q || '%'
           OR p.email     ILIKE '%' || v_q || '%'
           OR p.id::text = v_q)
  ),
  -- PASO 1 · qué filas hay que enriquecer.
  --   sin filtro  → solo la página (LATERAL sobre 25-50 filas)
  --   con filtro  → todo el universo elegible, porque el estado es derivado y
  --                 hace falta calcularlo para poder filtrar por él
  -- `LIMIT NULL` en PostgreSQL significa "sin límite".
  candidatos AS (
    SELECT b.*
    FROM base b
    ORDER BY b.created_at DESC, b.id
    LIMIT  CASE WHEN v_status IS NULL THEN v_limit  ELSE NULL END
    OFFSET CASE WHEN v_status IS NULL THEN v_offset ELSE 0    END
  ),
  -- PASO 2 · agregados por paciente, con LATERAL.
  enriquecida AS (
    SELECT
      q.id, q.full_name, q.phone, q.email, q.created_at,
      crm.blocked_at, crm.unblocked_at, crm.blocked_reason,
      ag.fichas, ag.clinicas, ag.medicos, ag.citas_total,
      ag.atendidas, ag.ultima_actividad, ag.proxima_cita, ag.canal_primera_cita,
      fu.abiertos,
      tg.tags
    FROM candidatos q
    LEFT JOIN public.patient_crm crm ON crm.profile_id = q.id
    LEFT JOIN LATERAL (
      SELECT
        count(DISTINCT pa.id)                                        AS fichas,
        count(DISTINCT pa.clinic_id)                                 AS clinicas,
        count(DISTINCT ap.doctor_id)                                 AS medicos,
        count(ap.id)                                                 AS citas_total,
        count(ap.id) FILTER (WHERE st.name = 'atendida')             AS atendidas,
        max(ap.start_time) FILTER (WHERE ap.start_time <= now())     AS ultima_actividad,
        min(ap.start_time) FILTER (WHERE ap.start_time >  now()
                                     AND st.is_final = false)        AS proxima_cita,
        -- Canal de la PRIMERA CITA. NO es origen de adquisición: solo dice por
        -- dónde entró esa reserva. Ver la nota de semántica en la cabecera.
        (array_agg(ap.source ORDER BY ap.start_time))[1]::text       AS canal_primera_cita
      FROM public.patients pa
      LEFT JOIN public.appointments ap ON ap.patient_id = pa.id
      LEFT JOIN public.appointment_statuses st ON st.id = ap.status_id
      WHERE pa.profile_id = q.id
    ) ag ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS abiertos
      FROM public.patient_crm_followups f
      WHERE f.profile_id = q.id AND f.status = 'abierto'
    ) fu ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(t.tag ORDER BY t.tag) AS tags
      FROM public.patient_crm_tags t
      WHERE t.profile_id = q.id
    ) tg ON true
  ),
  -- PASO 3 · el estado derivado, calculado UNA sola vez por fila.
  calificada AS (
    SELECT e.*,
           public._crm_estado(
             (e.blocked_at IS NOT NULL AND e.unblocked_at IS NULL),
             e.abiertos, e.atendidas::int,
             e.created_at, e.proxima_cita, e.ultima_actividad,
             now()) AS crm_status
    FROM enriquecida e
  ),
  -- PASO 4 · FILTRO. Antes de contar y antes de paginar.
  filtrada AS (
    SELECT c.* FROM calificada c
    WHERE v_status IS NULL OR c.crm_status = v_status
  ),
  -- PASO 5 · PAGINACIÓN, sobre el conjunto ya filtrado.
  -- Sin filtro la página ya se recortó en `candidatos`, así que acá no se
  -- vuelve a recortar: el resultado es idéntico por ambas rutas.
  pagina AS (
    SELECT f.* FROM filtrada f
    ORDER BY f.created_at DESC, f.id
    LIMIT  CASE WHEN v_status IS NULL THEN NULL ELSE v_limit  END
    OFFSET CASE WHEN v_status IS NULL THEN 0    ELSE v_offset END
  )
  -- ⚠️ ALLOWLIST EXPLÍCITA. Cada clave se nombra a mano: ninguna columna
  -- clínica puede colarse por un `SELECT *`.
  SELECT
    -- TOTAL DEL CONJUNTO FILTRADO. Sin filtro, `filtrada` contiene solo la
    -- página, así que el total sale de `base`; con filtro, de `filtrada`.
    -- Las dos ramas devuelven el mismo número: el tamaño del conjunto que el
    -- usuario está paginando.
    CASE WHEN v_status IS NULL
         THEN (SELECT count(*) FROM base)
         ELSE (SELECT count(*) FROM filtrada) END,
    coalesce(jsonb_agg(jsonb_build_object(
      'profile_id',       pg.id,
      'full_name',        pg.full_name,
      'phone',            pg.phone,
      'email',            pg.email,
      'created_at',       pg.created_at,
      'crm_status',       pg.crm_status,
      'blocked',          (pg.blocked_at IS NOT NULL AND pg.unblocked_at IS NULL),
      -- ⚠️ CANAL DE LA PRIMERA CITA, no origen de adquisición. Dice por dónde
      -- entró esa reserva; no dice cómo la persona conoció LucyCare.
      'canal_primera_cita', CASE pg.canal_primera_cita
                            WHEN 'lucy_directorio' THEN 'Directorio LucyCare'
                            WHEN 'manual'          THEN 'Alta del médico'
                            ELSE NULL END,
      'fichas',           coalesce(pg.fichas, 0),
      'clinicas',         coalesce(pg.clinicas, 0),
      'medicos',          coalesce(pg.medicos, 0),
      'citas_total',      coalesce(pg.citas_total, 0),
      'atendidas',        coalesce(pg.atendidas, 0),
      'ultima_actividad', pg.ultima_actividad,
      'proxima_cita',     pg.proxima_cita,
      'followups_abiertos', coalesce(pg.abiertos, 0),
      'tags',             coalesce(to_jsonb(pg.tags), '[]'::jsonb)
    ) ORDER BY pg.created_at DESC, pg.id), '[]'::jsonb)
  INTO v_total, v_rows
  FROM pagina pg;

  RETURN jsonb_build_object(
    'total',  v_total,
    'limit',  v_limit,
    'offset', v_offset,
    'rows',   v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public._crm_patients_json(text,text,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._crm_patients_json(text,text,int,int) FROM anon;
REVOKE ALL ON FUNCTION public._crm_patients_json(text,text,int,int) FROM authenticated;
REVOKE ALL ON FUNCTION public._crm_patients_json(text,text,int,int) FROM service_role;

-- ─── 5. Listado paginado — wrapper delgado ──────────────────
CREATE OR REPLACE FUNCTION public.admin_list_patients_crm(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit  int  DEFAULT 25,
  p_offset int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0140';
  END IF;
  -- Allowlist cerrada, ANTES de consultar. Un valor arbitrario se rechaza acá
  -- con P0147 y nunca llega al núcleo.
  v_status := public._crm_status_norm(p_status);
  -- Tope duro de la PANTALLA: 25 o 50, jamás "todos". Exportar tiene su
  -- propio tope, mucho mayor, y su propia auditoría.
  RETURN public._crm_patients_json(
    p_search, v_status,
    least(greatest(coalesce(p_limit, 25), 1), 50),
    p_offset);
END;
$$;

-- ─── 6. Exportación (P5) ────────────────────────────────────
-- Exporta el CONJUNTO FILTRADO COMPLETO, no la página visible. Reusa el mismo
-- núcleo, así que hereda el universo canónico, la búsqueda, el filtro, el
-- orden y la allowlist.
--
-- ⚠️ NO es STABLE: escribe la fila de auditoría. Exportar PII es una ACCIÓN
-- administrativa, no una lectura más, y queda registrada como tal.
--
-- ⚠️ El audit NO copia PII: guarda el actor, el momento, el formato, cuántos
-- registros salieron, si había búsqueda (booleano, NO el texto — un admin puede
-- buscar por teléfono o por nombre) y qué filtro de estado se aplicó.
CREATE OR REPLACE FUNCTION public.admin_export_patients_crm(
  p_search  text DEFAULT NULL,
  p_status  text DEFAULT NULL,
  p_formato text DEFAULT 'csv'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public, pg_catalog
AS $$
DECLARE
  -- Tope técnico. Por encima de esto, exportar en una sola respuesta JSON deja
  -- de ser razonable: se propone acotar el filtro. Subirlo exige rediseñar el
  -- mecanismo (streaming o generación asíncrona), no cambiar esta constante.
  MAX_EXPORT constant int := 5000;
  v_payload jsonb;
  v_total   bigint;
  v_n       int;
  v_status  text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0140';
  END IF;
  -- ⚠️ ORDEN: validar ANTES de consultar y ANTES de auditar. Lo que se registra
  -- en `audit_log` es SIEMPRE el valor normalizado o NULL, nunca lo que llegó.
  -- Un `p_status` arbitrario —o con datos personales pegados por error— muere
  -- acá con P0147, sin tocar la base y sin dejar rastro en la auditoría.
  v_status := public._crm_status_norm(p_status);
  -- P0 exporta CSV y NADA MÁS (decisión del owner). Aceptar 'xlsx' acá sería
  -- peor que inútil: el frontend genera CSV igual, así que la auditoría
  -- guardaría un formato que nunca se produjo. Cuando exista el .xlsx real, se
  -- amplía esta lista en la misma migración que lo implemente.
  IF coalesce(p_formato, '') <> 'csv' THEN
    RAISE EXCEPTION 'Formato de exportación no soportado' USING ERRCODE = 'P0142';
  END IF;

  -- Se pide UNA fila más que el tope para distinguir "justo el tope" de
  -- "se pasó", sin contar dos veces.
  v_payload := public._crm_patients_json(p_search, v_status, MAX_EXPORT + 1, 0);
  v_total   := (v_payload->>'total')::bigint;
  v_n       := jsonb_array_length(v_payload->'rows');

  IF v_n > MAX_EXPORT THEN
    RAISE EXCEPTION
      'La exportación supera el límite de % registros (hay %). Afina la búsqueda o el filtro.',
      MAX_EXPORT, v_total
      USING ERRCODE = 'P0146';
  END IF;

  -- Evidencia de la acción. `audit_log` es inmutable desde s7_71b.
  INSERT INTO public.audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'select'::public.audit_action, 'patient_crm_export', NULL, NULL,
    jsonb_build_object(
      'edited_via',    'crm',
      'accion',        'export_base_pacientes',
      'formato',       p_formato,
      'registros',     v_n,
      -- Contexto SIN PII: si hubo búsqueda, no QUÉ se buscó.
      'con_busqueda',  (nullif(btrim(coalesce(p_search, '')), '') IS NOT NULL),
      -- Estado ya NORMALIZADO y validado contra la allowlist cerrada: o uno de
      -- los seis, o NULL. Nunca texto libre del cliente.
      'filtro_estado', v_status,
      'exportado_at',  now()
    )
  );

  RETURN v_payload || jsonb_build_object('exportado', true, 'formato', p_formato);
END;
$$;

-- ─── 7. Pendientes de identificar (D5) ──────────────────────
-- Fichas locales SIN identidad global. Se muestran APARTE y su conteo NUNCA
-- se suma al de pacientes: no son pacientes comerciales todavía.
CREATE OR REPLACE FUNCTION public.admin_list_unlinked_patients(
  p_search text DEFAULT NULL,
  p_limit  int  DEFAULT 25,
  p_offset int  DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_limit int; v_offset int; v_q text; v_total bigint; v_rows jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0140';
  END IF;

  v_limit  := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_q      := nullif(btrim(coalesce(p_search, '')), '');

  WITH base AS (
    SELECT pa.id, pa.full_name, pa.phone, pa.email, pa.clinic_id, pa.created_at
    FROM public.patients pa
    WHERE pa.profile_id IS NULL
      AND pa.is_active = true
      AND pa.merged_into_patient_id IS NULL
      AND (v_q IS NULL
           OR pa.full_name ILIKE '%' || v_q || '%'
           OR pa.phone     ILIKE '%' || v_q || '%'
           OR pa.email     ILIKE '%' || v_q || '%'
           OR pa.id::text = v_q)
  ),
  pagina AS (
    SELECT b.* FROM base b ORDER BY b.created_at DESC, b.id
    LIMIT v_limit OFFSET v_offset
  )
  -- ⚠️ ALLOWLIST: ni allergies, ni blood_type, ni notes, ni contacto de
  -- emergencia. Solo lo necesario para identificar y vincular.
  SELECT
    (SELECT count(*) FROM base),
    coalesce(jsonb_agg(jsonb_build_object(
      'patient_id', pg.id,
      'full_name',  pg.full_name,
      'phone',      pg.phone,
      'email',      pg.email,
      'clinic_id',  pg.clinic_id,
      'clinic_name', c.name,
      'created_at', pg.created_at,
      'citas_total', coalesce(ag.citas, 0),
      'ultima_actividad', ag.ultima
    ) ORDER BY pg.created_at DESC, pg.id), '[]'::jsonb)
  INTO v_total, v_rows
  FROM pagina pg
  LEFT JOIN public.clinics c ON c.id = pg.clinic_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS citas, max(start_time) AS ultima
    FROM public.appointments a WHERE a.patient_id = pg.id
  ) ag ON true;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit,
                            'offset', v_offset, 'rows', v_rows);
END;
$$;

-- ─── 8. Métricas superiores ─────────────────────────────────
-- Consulta aparte: son conteos que no cambian por segundo, así que la UI los
-- cachea con staleTime alto en vez de recalcularlos con cada tecla del
-- buscador.
CREATE OR REPLACE FUNCTION public.admin_patients_crm_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'P0140';
  END IF;

  -- Mismo predicado canónico que el listado: los totales y la lista no pueden
  -- discrepar. Por eso ambos leen la MISMA vista.
  WITH ident AS (
    SELECT ci.profile_id AS id, p.created_at,
           (crm.blocked_at IS NOT NULL AND crm.unblocked_at IS NULL) AS bloqueado
    FROM public.crm_patient_identity ci
    JOIN public.profiles p ON p.id = ci.profile_id
    LEFT JOIN public.patient_crm crm ON crm.profile_id = ci.profile_id
  ),
  act AS (
    SELECT pa.profile_id,
           max(ap.start_time) FILTER (WHERE ap.start_time <= now()) AS ultima,
           min(ap.start_time) FILTER (WHERE ap.start_time >  now()
                                       AND st.is_final = false)     AS proxima
    FROM public.patients pa
    JOIN public.appointments ap ON ap.patient_id = pa.id
    LEFT JOIN public.appointment_statuses st ON st.id = ap.status_id
    WHERE pa.profile_id IS NOT NULL
    GROUP BY pa.profile_id
  )
  SELECT jsonb_build_object(
    'pacientes_totales',   (SELECT count(*) FROM ident),
    'nuevos_30d',          (SELECT count(*) FROM ident WHERE created_at >= now() - interval '30 days'),
    'activos',             (SELECT count(*) FROM ident i JOIN act a ON a.profile_id = i.id
                             WHERE a.proxima IS NOT NULL OR a.ultima >= now() - interval '90 days'),
    -- ⚠️ Se cuenta DENTRO del universo canónico, igual que las demás. `act`
    -- sola incluiría fichas de identidades excluidas —un admin con ficha, por
    -- ejemplo— y esta métrica podría superar a `pacientes_totales`.
    'con_proxima_cita',    (SELECT count(*) FROM ident i JOIN act a ON a.profile_id = i.id
                             WHERE a.proxima IS NOT NULL),
    'sin_actividad_180d',  (SELECT count(*) FROM ident i LEFT JOIN act a ON a.profile_id = i.id
                             WHERE a.proxima IS NULL
                               AND (a.ultima IS NULL OR a.ultima < now() - interval '180 days')),
    'bloqueados',          (SELECT count(*) FROM ident WHERE bloqueado),
    -- Se reporta APARTE y NO se suma a `pacientes_totales` (D1).
    'pendientes_identificar', (SELECT count(*) FROM public.patients
                                WHERE profile_id IS NULL AND is_active = true
                                  AND merged_into_patient_id IS NULL)
  ) INTO v;

  RETURN v;
END;
$$;

-- ─── 9. Grants ──────────────────────────────────────────────
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.admin_list_patients_crm(text,text,int,int)',
    'public.admin_list_unlinked_patients(text,int,int)',
    'public.admin_patients_crm_stats()',
    'public.admin_export_patients_crm(text,text,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

-- ─── 10. Guardas POST ───────────────────────────────────────
DO $$
DECLARE
  fn text;
  v_oid oid;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.admin_list_patients_crm(text,text,int,int)',
    'public.admin_list_unlinked_patients(text,int,int)',
    'public.admin_patients_crm_stats()'
  ] LOOP
    v_oid := to_regprocedure(fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'POST fallo: no se creó %', fn;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
      RAISE EXCEPTION 'POST fallo: % no es SECURITY DEFINER', fn;
    END IF;
    IF (SELECT array_to_string(proconfig, ', ') FROM pg_proc WHERE oid = v_oid)
       IS DISTINCT FROM 'search_path=public, pg_catalog' THEN
      RAISE EXCEPTION 'POST fallo: search_path inesperado en %', fn;
    END IF;
    -- STABLE: son de solo lectura. Si alguna quedara VOLATILE, alguien le
    -- agregó escritura.
    IF (SELECT provolatile FROM pg_proc WHERE oid = v_oid) <> 's' THEN
      RAISE EXCEPTION 'POST fallo: % debería ser STABLE (solo lectura)', fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'POST fallo: authenticated no puede ejecutar %', fn;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'POST fallo: anon puede ejecutar %', fn;
    END IF;
  END LOOP;

  -- El helper de estados queda PRIVADO, y con la firma de SIETE argumentos:
  -- la de seis leía el reloj adentro siendo IMMUTABLE.
  v_oid := to_regprocedure('public._crm_estado(boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POST fallo: _crm_estado no tiene la firma con p_ahora';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE')
  OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POST fallo: _crm_estado quedó accesible';
  END IF;
  -- IMMUTABLE de verdad: sin esto, el planificador podría cachear o plegar un
  -- resultado que depende del tiempo.
  IF (SELECT provolatile FROM pg_proc WHERE oid = v_oid) <> 'i' THEN
    RAISE EXCEPTION 'POST fallo: _crm_estado debería ser IMMUTABLE';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = v_oid) ~* '\m(now\(\)|current_date|current_timestamp|clock_timestamp|localtimestamp|transaction_timestamp|statement_timestamp)' THEN
    RAISE EXCEPTION 'POST fallo: _crm_estado es IMMUTABLE pero lee el reloj';
  END IF;

  -- El núcleo compartido es PRIVADO: si un cliente pudiera llamarlo, se
  -- saltaría el gate `is_admin()` de los wrappers.
  v_oid := to_regprocedure('public._crm_patients_json(text,text,int,int)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POST fallo: falta el núcleo _crm_patients_json';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE')
  OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POST fallo: _crm_patients_json quedó accesible sin gate';
  END IF;

  -- El validador del filtro existe, es privado y NO repite el valor recibido.
  v_oid := to_regprocedure('public._crm_status_norm(text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POST fallo: falta _crm_status_norm';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = v_oid) NOT LIKE '%P0147%' THEN
    RAISE EXCEPTION 'POST fallo: _crm_status_norm no rechaza con P0147';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = v_oid) LIKE '%RAISE EXCEPTION%%%p_status%' THEN
    RAISE EXCEPTION 'POST fallo: el error de estado repite el valor recibido';
  END IF;

  -- ═══ MÍNIMO PRIVILEGIO EN LOS OBJETOS PRIVADOS ═══
  -- La vista y los tres helpers no los llama NADIE salvo las RPCs
  -- SECURITY DEFINER, que corren como owner. Ningún rol de Supabase —tampoco
  -- `service_role`— debe poder alcanzarlos: hacerlo saltaría el gate
  -- `is_admin()`. Los grants por defecto del esquema `public` sí incluyen a
  -- `service_role`, así que la migración los revoca explícitamente.
  FOREACH fn IN ARRAY ARRAY[
    'public._crm_estado(boolean,int,int,timestamptz,timestamptz,timestamptz,timestamptz)',
    'public._crm_patients_json(text,text,int,int)',
    'public._crm_status_norm(text)'
  ] LOOP
    v_oid := to_regprocedure(fn);
    IF has_function_privilege('service_role', v_oid, 'EXECUTE')
    OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
    OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'POST fallo: % sigue alcanzable por un rol de cliente', fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                WHERE p.oid = v_oid AND a.grantee = 0) THEN
      RAISE EXCEPTION 'POST fallo: % conserva EXECUTE para PUBLIC', fn;
    END IF;
  END LOOP;

  IF has_table_privilege('service_role', 'public.crm_patient_identity', 'SELECT') THEN
    RAISE EXCEPTION 'POST fallo: service_role puede leer la vista canónica';
  END IF;

  -- La exportación: gateada, auditada y VOLATILE a propósito.
  v_oid := to_regprocedure('public.admin_export_patients_crm(text,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POST fallo: falta admin_export_patients_crm';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'POST fallo: la exportación no es SECURITY DEFINER';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = v_oid) <> 'v' THEN
    RAISE EXCEPTION 'POST fallo: la exportación debe ser VOLATILE (escribe auditoría)';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
  OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POST fallo: EXECUTE incorrecto en la exportación';
  END IF;
  -- Listado y exportación comparten el MISMO núcleo: si alguno construyera su
  -- propia consulta, podría ampliar las columnas sin que nadie lo note.
  IF (SELECT count(*) FROM pg_proc
       WHERE oid IN (to_regprocedure('public.admin_list_patients_crm(text,text,int,int)'),
                     to_regprocedure('public.admin_export_patients_crm(text,text,text)'))
         AND prosrc LIKE '%_crm_patients_json%') <> 2 THEN
    RAISE EXCEPTION 'POST fallo: listado y exportación no comparten el núcleo';
  END IF;

  -- La vista canónica existe y NO es accesible por ningún rol de cliente.
  IF to_regclass('public.crm_patient_identity') IS NULL THEN
    RAISE EXCEPTION 'POST fallo: falta la vista crm_patient_identity';
  END IF;
  IF has_table_privilege('authenticated', 'public.crm_patient_identity', 'SELECT')
  OR has_table_privilege('anon', 'public.crm_patient_identity', 'SELECT') THEN
    RAISE EXCEPTION 'POST fallo: crm_patient_identity quedó legible por un cliente';
  END IF;

  -- F2 · MÍNIMA POR CONSTRUCCIÓN. La vista define pertenencia; no describe a
  -- nadie. Una columna, y que sea `profile_id`: si alguien le agrega nombre,
  -- teléfono o correo, la migración no se aplica.
  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.crm_patient_identity'::regclass
         AND attnum > 0 AND NOT attisdropped) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_attribute
       WHERE attrelid = 'public.crm_patient_identity'::regclass
         AND attnum > 0 AND NOT attisdropped AND attname = 'profile_id') THEN
    RAISE EXCEPTION 'POST fallo: crm_patient_identity debe exponer SOLO profile_id';
  END IF;

  -- Todo lo que lista pacientes lee la MISMA definición de identidad: el
  -- núcleo compartido (del que cuelgan listado y exportación) y las métricas.
  -- Si alguno se saltara la vista, la lista y los totales podrían discrepar.
  IF (SELECT count(*) FROM pg_proc
       WHERE oid IN (to_regprocedure('public._crm_patients_json(text,text,int,int)'),
                     to_regprocedure('public.admin_patients_crm_stats()'))
         AND prosrc LIKE '%crm_patient_identity%') <> 2 THEN
    RAISE EXCEPTION 'POST fallo: alguna consulta no usa el predicado canónico';
  END IF;

  -- ═══ ORDEN DE OPERACIONES: filtro → conteo → paginación ═══
  -- Es la corrección central de esta versión. Se verifica sobre el TEXTO de la
  -- función porque el defecto anterior era estructural: el filtro estaba
  -- después del recorte.
  DECLARE
    v_src text := (SELECT prosrc FROM pg_proc
                    WHERE oid = to_regprocedure('public._crm_patients_json(text,text,int,int)'));
  BEGIN
    IF position('filtrada' in v_src) = 0 OR position('calificada' in v_src) = 0 THEN
      RAISE EXCEPTION 'POST fallo: falta la etapa de filtrado previa a la paginación';
    END IF;
    -- El filtro por estado tiene que aparecer ANTES de la página final.
    IF position('WHERE v_status IS NULL OR' in v_src) = 0
       OR position('WHERE v_status IS NULL OR' in v_src) > position('pagina AS (' in v_src) THEN
      RAISE EXCEPTION 'POST fallo: el filtro por estado no precede a la paginación';
    END IF;
    -- El total sale del conjunto FILTRADO cuando hay filtro.
    IF position('ELSE (SELECT count(*) FROM filtrada) END' in v_src) = 0 THEN
      RAISE EXCEPTION 'POST fallo: el total no se calcula sobre el conjunto filtrado';
    END IF;
    -- Y el defecto viejo —filtrar el JSON ya paginado— no puede volver.
    IF v_src LIKE '%jsonb_array_elements(v_rows)%' THEN
      RAISE EXCEPTION 'POST fallo: se volvió a filtrar DESPUÉS de paginar';
    END IF;
  END;
END $$;

COMMIT;
```

**Salida esperada:** `COMMIT` correcto y un `NOTICE`:

```
NOTICE:  s7_77: crm_patient_identity con security_invoker = true
```

**No debe aparecer** el `NOTICE` alternativo que menciona una versión sin
soporte: el motor es 17.6.

Cualquier `RAISE EXCEPTION 'PRE fallo:` o `'POST fallo:` significa que **nada
quedó aplicado**. Reportar el mensaje completo y **no reintentar**.

---

## PASO 3 — POST-check de catálogo (100 % read-only)

Solo `SELECT` y catálogo. Sin `DO`, sin DDL, sin DML. **No invoca ninguna
función del CRM**: las cuatro RPCs gatean con `is_admin()`, y en el SQL Editor
`auth.uid()` es nulo, así que llamarlas lanzaría `P0140` y abortaría todo.

```sql
-- ══ s7_77 · PASO 3 — POST-CHECK DE CATÁLOGO (100% read-only) ══
--
-- ⚠️ FUENTE NORMALIZADA. Los controles semánticos NO pueden mirar `prosrc`
-- crudo: `prosrc` incluye los comentarios de la migración, y esos comentarios
-- nombran a propósito lo que está prohibido —«ni allergies, ni blood_type»,
-- «por un SELECT *», «aceptar 'xlsx' sería peor que inútil»—. Buscar tokens ahí
-- da FALSOS POSITIVOS. Por eso todo lo semántico lee `ejecutable`, que es
-- `prosrc` con los comentarios de bloque y de línea ya eliminados.
WITH rpc(f, args) AS (
  VALUES ('admin_list_patients_crm',      'text,text,integer,integer'),
         ('admin_list_unlinked_patients', 'text,integer,integer'),
         ('admin_patients_crm_stats',     ''),
         ('admin_export_patients_crm',    'text,text,text')
),
lectura(f) AS (
  VALUES ('admin_list_patients_crm'), ('admin_list_unlinked_patients'),
         ('admin_patients_crm_stats')
),
privadas(f, args) AS (
  VALUES ('_crm_estado', 'boolean,integer,integer,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone'),
         ('_crm_status_norm', 'text'),
         ('_crm_patients_json', 'text,text,integer,integer')
),
todas(f) AS (
  VALUES ('_crm_estado'), ('_crm_status_norm'), ('_crm_patients_json'),
         ('admin_list_patients_crm'), ('admin_list_unlinked_patients'),
         ('admin_patients_crm_stats'), ('admin_export_patients_crm')
),
fuente AS (
  SELECT p.proname, p.prosrc, p.oid
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (SELECT f FROM todas)
),
-- FUENTE EJECUTABLE: sin comentarios de bloque y sin comentarios de línea.
-- Es lo único contra lo que tiene sentido buscar prohibiciones.
ejecutable AS (
  SELECT proname,
         regexp_replace(
           regexp_replace(prosrc, '/\*[\s\S]*?\*/', ' ', 'g'),
           '--[^\n]*', ' ', 'g') AS src
  FROM fuente
),
nucleo AS (
  SELECT src FROM ejecutable WHERE proname = '_crm_patients_json'
),
-- El statement de error de `_crm_status_norm`, aislado: es lo que se ejecuta
-- cuando llega un estado inválido, y lo único que puede filtrar el valor.
raise_norm AS (
  SELECT coalesce(substring(src from 'RAISE EXCEPTION[^;]*;'), '') AS stmt
  FROM ejecutable WHERE proname = '_crm_status_norm'
),
-- El bloque completo que decide el formato de exportación, aislado.
fmt AS (
  SELECT coalesce(substring(src from 'IF coalesce\(p_formato[\s\S]*?END IF;'), '') AS blk
  FROM ejecutable WHERE proname = 'admin_export_patients_crm'
),
esperados(e) AS (
  VALUES ('nuevo'), ('activo'), ('en_seguimiento'),
         ('recurrente'), ('inactivo'), ('bloqueado')
),
listaestados AS (
  -- El texto que va dentro del `NOT IN (...)` del validador: es la allowlist
  -- literal, y contarla es contar los estados permitidos.
  SELECT coalesce(substring(src from 'NOT IN \(([^)]*)\)'), '') AS lista
  FROM ejecutable WHERE proname = '_crm_status_norm'
),
vdef AS (
  SELECT CASE WHEN to_regclass('public.crm_patient_identity') IS NULL THEN ''
              ELSE pg_get_viewdef('public.crm_patient_identity'::regclass) END AS d
),
prohibidas(c) AS (
  VALUES ('allergies'), ('blood_type'), ('internal_notes'), ('cancel_reason_id'),
         ('payment_status'), ('emergency_contact'), ('diagnos'), ('prescription'),
         ('medication'), ('consultation'), ('vitals'), ('family_history')
)
-- ── A. Vista canónica ───────────────────────────────────────
SELECT 100 AS n, 'A · crm_patient_identity existe y es una VISTA' AS control,
       'v' AS esperado,
       (SELECT relkind::text FROM pg_class
         WHERE relnamespace = 'public'::regnamespace
           AND relname = 'crm_patient_identity') AS obtenido,
       CASE WHEN (SELECT relkind FROM pg_class
                   WHERE relnamespace = 'public'::regnamespace
                     AND relname = 'crm_patient_identity') = 'v'
            THEN 'PASS' ELSE 'FAIL' END AS resultado
UNION ALL SELECT 101, 'A · expone EXACTAMENTE una columna, profile_id', 'profile_id',
  (SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_attribute a
    WHERE a.attrelid = 'public.crm_patient_identity'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped),
  CASE WHEN (SELECT string_agg(a.attname, ',' ORDER BY a.attnum) FROM pg_attribute a
    WHERE a.attrelid = 'public.crm_patient_identity'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped) = 'profile_id'
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 102, 'A · security_invoker = true', 'true',
  (SELECT coalesce(array_to_string(reloptions, ','), '(sin reloptions)') FROM pg_class
    WHERE oid = 'public.crm_patient_identity'::regclass),
  CASE WHEN (SELECT coalesce(array_to_string(reloptions, ','), '') FROM pg_class
    WHERE oid = 'public.crm_patient_identity'::regclass) LIKE '%security_invoker=true%'
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 103, 'A · PUBLIC sin privilegios sobre la vista', '0',
  (SELECT count(*)::text FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid = 'public.crm_patient_identity'::regclass AND a.grantee = 0),
  CASE WHEN (SELECT count(*) FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid = 'public.crm_patient_identity'::regclass AND a.grantee = 0) = 0
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 104, 'A · anon / authenticated / service_role NO pueden leer la vista',
  'false/false/false',
  (SELECT has_table_privilege('anon', 'public.crm_patient_identity', 'SELECT')::text
       || '/' || has_table_privilege('authenticated', 'public.crm_patient_identity', 'SELECT')::text
       || '/' || has_table_privilege('service_role', 'public.crm_patient_identity', 'SELECT')::text),
  CASE WHEN NOT has_table_privilege('anon', 'public.crm_patient_identity', 'SELECT')
        AND NOT has_table_privilege('authenticated', 'public.crm_patient_identity', 'SELECT')
        AND NOT has_table_privilege('service_role', 'public.crm_patient_identity', 'SELECT')
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 105, 'A · predicado canónico vigente: las 3 exclusiones DURAS', 'true',
  (SELECT (d LIKE '%is_active%' AND d LIKE '%lucyadmin_access%'
           AND d LIKE '%admin_seed_operations%' AND d LIKE '%doctor-seed.invalid%'
           AND d LIKE '%''admin''%')::text FROM vdef),
  CASE WHEN (SELECT d LIKE '%is_active%' AND d LIKE '%lucyadmin_access%'
           AND d LIKE '%admin_seed_operations%' AND d LIKE '%doctor-seed.invalid%'
           AND d LIKE '%''admin''%' FROM vdef) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 106, 'A · exclusiones BLANDAS: doctors, clinic_members y clinics', 'true',
  (SELECT (d LIKE '%doctors%' AND d LIKE '%clinic_members%' AND d LIKE '%clinics%')::text
     FROM vdef),
  CASE WHEN (SELECT d LIKE '%doctors%' AND d LIKE '%clinic_members%' AND d LIKE '%clinics%'
     FROM vdef) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 107, 'A · el predicado contempla la ficha como ALTERNATIVA (hay un OR)', 'true',
  (SELECT (d LIKE '%patients%' AND d ILIKE '% OR %')::text FROM vdef),
  CASE WHEN (SELECT d LIKE '%patients%' AND d ILIKE '% OR %' FROM vdef)
  THEN 'PASS' ELSE 'FAIL' END

-- ── B. Helpers privados ─────────────────────────────────────
UNION ALL SELECT 110, 'B · los 3 helpers existen con la firma exacta', '3',
  (SELECT count(*)::text FROM privadas
    WHERE to_regprocedure('public.' || f || '(' || args || ')') IS NOT NULL),
  CASE WHEN (SELECT count(*) FROM privadas
    WHERE to_regprocedure('public.' || f || '(' || args || ')') IS NOT NULL) = 3
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 111, 'B · ninguno quedó sobrecargado', '3',
  (SELECT count(*)::text FROM fuente WHERE proname IN (SELECT f FROM privadas)),
  CASE WHEN (SELECT count(*) FROM fuente WHERE proname IN (SELECT f FROM privadas)) = 3
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 112, 'B · _crm_estado es IMMUTABLE y NO lee el reloj', 'i/false',
  -- ⚠️ `provolatile` es del tipo interno "char": no tiene cast implícito a
  -- text, así que `||` sería ambiguo (42725). Se castea siempre explícitamente.
  -- El reloj se busca en la fuente EJECUTABLE: los comentarios de la migración
  -- mencionan `now()` a propósito, al explicar por qué no debe estar.
  (SELECT p.provolatile::text || '/' ||
          (e.src ~* '\m(now\(\)|current_date|current_timestamp|clock_timestamp|localtimestamp|transaction_timestamp|statement_timestamp)')::text
     FROM pg_proc p JOIN ejecutable e ON e.proname = p.proname
    WHERE p.proname = '_crm_estado' AND p.pronamespace = 'public'::regnamespace),
  CASE WHEN (SELECT p.provolatile = 'i'
          AND NOT (e.src ~* '\m(now\(\)|current_date|current_timestamp|clock_timestamp|localtimestamp|transaction_timestamp|statement_timestamp)')
     FROM pg_proc p JOIN ejecutable e ON e.proname = p.proname
    WHERE p.proname = '_crm_estado' AND p.pronamespace = 'public'::regnamespace)
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 113, 'B · _crm_estado: INVOKER y search_path fijo',
  'false / search_path=pg_catalog',
  (SELECT prosecdef::text || ' / ' || coalesce(array_to_string(proconfig, ', '), '(sin proconfig)')
     FROM pg_proc WHERE proname = '_crm_estado' AND pronamespace = 'public'::regnamespace),
  CASE WHEN (SELECT NOT prosecdef AND array_to_string(proconfig, ', ') = 'search_path=pg_catalog'
     FROM pg_proc WHERE proname = '_crm_estado' AND pronamespace = 'public'::regnamespace)
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 114, 'B · _crm_status_norm: IMMUTABLE, INVOKER y search_path fijo',
  'i / false / search_path=pg_catalog',
  (SELECT provolatile::text || ' / ' || prosecdef::text || ' / ' || coalesce(array_to_string(proconfig, ', '), '(sin proconfig)')
     FROM pg_proc WHERE proname = '_crm_status_norm' AND pronamespace = 'public'::regnamespace),
  CASE WHEN (SELECT provolatile = 'i' AND NOT prosecdef
          AND array_to_string(proconfig, ', ') = 'search_path=pg_catalog'
     FROM pg_proc WHERE proname = '_crm_status_norm' AND pronamespace = 'public'::regnamespace)
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 115, 'B · _crm_patients_json: STABLE, INVOKER y search_path fijo',
  's / false / search_path=public, pg_catalog',
  (SELECT provolatile::text || ' / ' || prosecdef::text || ' / ' || coalesce(array_to_string(proconfig, ', '), '(sin proconfig)')
     FROM pg_proc WHERE proname = '_crm_patients_json' AND pronamespace = 'public'::regnamespace),
  CASE WHEN (SELECT provolatile = 's' AND NOT prosecdef
          AND array_to_string(proconfig, ', ') = 'search_path=public, pg_catalog'
     FROM pg_proc WHERE proname = '_crm_patients_json' AND pronamespace = 'public'::regnamespace)
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 116, 'B · MÍNIMO PRIVILEGIO: ni anon, ni authenticated, ni service_role', '0',
  (SELECT count(*)::text FROM fuente f, unnest(ARRAY['anon','authenticated','service_role']) AS r
    WHERE f.proname IN (SELECT p.f FROM privadas p)
      AND has_function_privilege(r, f.oid, 'EXECUTE')),
  CASE WHEN (SELECT count(*) FROM fuente f, unnest(ARRAY['anon','authenticated','service_role']) AS r
    WHERE f.proname IN (SELECT p.f FROM privadas p)
      AND has_function_privilege(r, f.oid, 'EXECUTE')) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 117, 'B · PUBLIC sin EXECUTE sobre los tres helpers', '0',
  (SELECT count(*)::text FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (SELECT f FROM privadas) AND a.grantee = 0),
  CASE WHEN (SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (SELECT f FROM privadas) AND a.grantee = 0) = 0
  THEN 'PASS' ELSE 'FAIL' END

-- ── C. Allowlist cerrada del filtro por estado ──────────────
UNION ALL SELECT 120, 'C · la allowlist tiene los SEIS estados y nada más', '6',
  -- `obtenido` = cuántos elementos tiene la lista `NOT IN (...)` del validador.
  (SELECT array_length(string_to_array(lista, ','), 1)::text FROM listaestados),
  -- PASS exige las dos cosas: que la lista tenga exactamente 6 elementos y que
  -- sean exactamente los seis estados aprobados, ni uno de más ni uno distinto.
  CASE WHEN (SELECT array_length(string_to_array(lista, ','), 1) FROM listaestados) = 6
        AND (SELECT count(*) FROM esperados s
              WHERE (SELECT lista FROM listaestados) LIKE '%''' || s.e || '''%') = 6
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 121, 'C · rechaza lo demás con P0147', 'true',
  (SELECT (src LIKE '%P0147%')::text FROM ejecutable WHERE proname = '_crm_status_norm'),
  CASE WHEN (SELECT src LIKE '%P0147%' FROM ejecutable WHERE proname = '_crm_status_norm')
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 122, 'C · el RAISE ejecutable: literal exacto / P0147 / sin interpolar p_status',
  'true/true/true',
  -- Se analiza el STATEMENT de error aislado, no texto suelto alrededor.
  -- «Sin interpolar» = no nombra el parámetro, no concatena y no usa el
  -- marcador `%` de RAISE: nada de lo que llegó puede acabar en el mensaje.
  (SELECT (stmt LIKE '%''Filtro de estado no válido''%')::text || '/' ||
          (stmt LIKE '%P0147%')::text || '/' ||
          (stmt NOT LIKE '%p_status%' AND stmt NOT LIKE '%||%' AND stmt NOT LIKE '%!%!%' ESCAPE '!')::text
     FROM raise_norm),
  CASE WHEN (SELECT stmt LIKE '%''Filtro de estado no válido''%'
          AND stmt LIKE '%P0147%'
          AND stmt NOT LIKE '%p_status%'
          AND stmt NOT LIKE '%||%'
          AND stmt NOT LIKE '%!%!%' ESCAPE '!'
     FROM raise_norm) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 123, 'C · normaliza espacios y mayúsculas', 'true',
  (SELECT (src LIKE '%btrim(lower(coalesce(p_status%')::text FROM ejecutable
    WHERE proname = '_crm_status_norm'),
  CASE WHEN (SELECT src LIKE '%btrim(lower(coalesce(p_status%' FROM ejecutable
    WHERE proname = '_crm_status_norm') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 124, 'C · las 3 rutas que reciben p_status lo validan', '3',
  (SELECT count(*)::text FROM ejecutable
    WHERE src LIKE '%_crm_status_norm(p_status)%'),
  CASE WHEN (SELECT count(*) FROM ejecutable
    WHERE src LIKE '%_crm_status_norm(p_status)%') = 3 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 125, 'C · el export valida ANTES de consultar y de auditar', 'true',
  (SELECT (position('_crm_status_norm' in src) > 0
           AND position('_crm_status_norm' in src) < position('_crm_patients_json' in src)
           AND position('_crm_status_norm' in src) < position('INSERT INTO public.audit_log' in src))::text
     FROM ejecutable WHERE proname = 'admin_export_patients_crm'),
  CASE WHEN (SELECT position('_crm_status_norm' in src) > 0
           AND position('_crm_status_norm' in src) < position('_crm_patients_json' in src)
           AND position('_crm_status_norm' in src) < position('INSERT INTO public.audit_log' in src)
     FROM ejecutable WHERE proname = 'admin_export_patients_crm') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 126, 'C · el audit guarda el estado NORMALIZADO, no lo recibido', 'true',
  (SELECT (src LIKE '%''filtro_estado'', v_status%'
           AND src NOT LIKE '%''filtro_estado'', nullif(btrim(coalesce(p_status%')::text
     FROM ejecutable WHERE proname = 'admin_export_patients_crm'),
  CASE WHEN (SELECT src LIKE '%''filtro_estado'', v_status%'
           AND src NOT LIKE '%''filtro_estado'', nullif(btrim(coalesce(p_status%'
     FROM ejecutable WHERE proname = 'admin_export_patients_crm') THEN 'PASS' ELSE 'FAIL' END

-- ── D. ORDEN: filtro → conteo → paginación ──────────────────
UNION ALL SELECT 130, 'D · existe la etapa de calificación (estado derivado)', 'true',
  (SELECT (src LIKE '%calificada AS (%')::text FROM nucleo),
  CASE WHEN (SELECT src LIKE '%calificada AS (%' FROM nucleo) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 131, 'D · existe una etapa de FILTRADO separada', 'true',
  (SELECT (src LIKE '%filtrada AS (%')::text FROM nucleo),
  CASE WHEN (SELECT src LIKE '%filtrada AS (%' FROM nucleo) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 132, 'D · el filtro va ANTES de la paginación', 'true',
  (SELECT (position('filtrada AS (' in src) < position('pagina AS (' in src))::text FROM nucleo),
  CASE WHEN (SELECT position('filtrada AS (' in src) > 0
          AND position('filtrada AS (' in src) < position('pagina AS (' in src) FROM nucleo)
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 133, 'D · el estado se calcula ANTES de filtrar', 'true',
  (SELECT (position('calificada AS (' in src) < position('filtrada AS (' in src))::text FROM nucleo),
  CASE WHEN (SELECT position('calificada AS (' in src) > 0
          AND position('calificada AS (' in src) < position('filtrada AS (' in src) FROM nucleo)
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 134, 'D · el TOTAL sale del conjunto FILTRADO cuando hay filtro', 'true',
  (SELECT (src LIKE '%ELSE (SELECT count(*) FROM filtrada) END%')::text FROM nucleo),
  CASE WHEN (SELECT src LIKE '%ELSE (SELECT count(*) FROM filtrada) END%' FROM nucleo)
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 135, 'D · YA NO se filtra el JSON después de paginar', 'true',
  (SELECT (src NOT LIKE '%jsonb_array_elements(v_rows)%')::text FROM nucleo),
  CASE WHEN (SELECT src NOT LIKE '%jsonb_array_elements(v_rows)%' FROM nucleo)
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 136, 'D · la ruta rápida y la lenta viven en la MISMA consulta', 'true',
  (SELECT (src LIKE '%CASE WHEN v_status IS NULL THEN v_limit%'
           AND src LIKE '%CASE WHEN v_status IS NULL THEN NULL ELSE v_limit%')::text FROM nucleo),
  CASE WHEN (SELECT src LIKE '%CASE WHEN v_status IS NULL THEN v_limit%'
           AND src LIKE '%CASE WHEN v_status IS NULL THEN NULL ELSE v_limit%' FROM nucleo)
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 137, 'D · el estado se calcula UNA sola vez por fila', '1',
  -- `obtenido` = cuántas veces se invoca el helper de estados en el núcleo.
  (SELECT (array_length(string_to_array(src, '_crm_estado('), 1) - 1)::text FROM nucleo),
  CASE WHEN (SELECT array_length(string_to_array(src, '_crm_estado('), 1) - 1 FROM nucleo) = 1
  THEN 'PASS' ELSE 'FAIL' END

-- ── E. RPCs públicas ────────────────────────────────────────
UNION ALL SELECT 140, 'E · las 4 RPCs existen con la firma exacta', '4',
  (SELECT count(*)::text FROM rpc
    WHERE to_regprocedure('public.' || f || '(' || args || ')') IS NOT NULL),
  CASE WHEN (SELECT count(*) FROM rpc
    WHERE to_regprocedure('public.' || f || '(' || args || ')') IS NOT NULL) = 4
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 141, 'E · ninguna RPC quedó sobrecargada', '4',
  (SELECT count(*)::text FROM fuente WHERE proname IN (SELECT f FROM rpc)),
  CASE WHEN (SELECT count(*) FROM fuente WHERE proname IN (SELECT f FROM rpc)) = 4
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 142, 'E · las 4 son SECURITY DEFINER', '4',
  (SELECT count(*)::text FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname IN (SELECT f FROM rpc) AND prosecdef),
  CASE WHEN (SELECT count(*) FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname IN (SELECT f FROM rpc) AND prosecdef) = 4
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 143, 'E · las 4 gatean con is_admin() y P0140', '4',
  (SELECT count(*)::text FROM ejecutable
    WHERE proname IN (SELECT f FROM rpc)
      AND src LIKE '%is_admin()%' AND src LIKE '%P0140%'),
  CASE WHEN (SELECT count(*) FROM ejecutable
    WHERE proname IN (SELECT f FROM rpc)
      AND src LIKE '%is_admin()%' AND src LIKE '%P0140%') = 4
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 144, 'E · las 3 de lectura son STABLE', '3',
  (SELECT count(*)::text FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (SELECT f FROM lectura) AND provolatile = 's'),
  CASE WHEN (SELECT count(*) FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN (SELECT f FROM lectura) AND provolatile = 's') = 3
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 145, 'E · SOLO la exportación es VOLATILE', 'v',
  (SELECT provolatile::text FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'admin_export_patients_crm'),
  CASE WHEN (SELECT provolatile FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'admin_export_patients_crm') = 'v'
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 146, 'E · las 4 con search_path fijo', '4',
  (SELECT count(*)::text FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname IN (SELECT f FROM rpc)
      AND array_to_string(proconfig, ', ') = 'search_path=public, pg_catalog'),
  CASE WHEN (SELECT count(*) FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname IN (SELECT f FROM rpc)
      AND array_to_string(proconfig, ', ') = 'search_path=public, pg_catalog') = 4
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 147, 'E · authenticated puede EJECUTAR las 4', '4',
  (SELECT count(*)::text FROM fuente
    WHERE proname IN (SELECT f FROM rpc)
      AND has_function_privilege('authenticated', oid, 'EXECUTE')),
  CASE WHEN (SELECT count(*) FROM fuente
    WHERE proname IN (SELECT f FROM rpc)
      AND has_function_privilege('authenticated', oid, 'EXECUTE')) = 4
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 148, 'E · anon NO puede ejecutar ninguna', '0',
  (SELECT count(*)::text FROM fuente
    WHERE proname IN (SELECT f FROM rpc)
      AND has_function_privilege('anon', oid, 'EXECUTE')),
  CASE WHEN (SELECT count(*) FROM fuente
    WHERE proname IN (SELECT f FROM rpc)
      AND has_function_privilege('anon', oid, 'EXECUTE')) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 149, 'E · PUBLIC sin EXECUTE sobre las 4', '0',
  (SELECT count(*)::text FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (SELECT f FROM rpc) AND a.grantee = 0),
  CASE WHEN (SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (SELECT f FROM rpc) AND a.grantee = 0) = 0 THEN 'PASS' ELSE 'FAIL' END

-- ── F. Allowlist y frontera clínica ─────────────────────────
-- TODO lo de esta sección lee `ejecutable`: los comentarios de la migración
-- nombran a propósito lo prohibido, y buscarlo ahí daría falsos positivos.
UNION ALL SELECT 150, 'F · listado y exportación comparten _crm_patients_json', '2',
  (SELECT count(*)::text FROM ejecutable
    WHERE proname IN ('admin_list_patients_crm','admin_export_patients_crm')
      AND src LIKE '%_crm_patients_json%'),
  CASE WHEN (SELECT count(*) FROM ejecutable
    WHERE proname IN ('admin_list_patients_crm','admin_export_patients_crm')
      AND src LIKE '%_crm_patients_json%') = 2 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 151, 'F · las métricas usan el MISMO predicado canónico', 'true',
  (SELECT (src LIKE '%crm_patient_identity%')::text FROM ejecutable
    WHERE proname = 'admin_patients_crm_stats'),
  CASE WHEN (SELECT src LIKE '%crm_patient_identity%' FROM ejecutable
    WHERE proname = 'admin_patients_crm_stats') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 152, 'F · ninguna función del CRM SELECCIONA una columna clínica prohibida', '0',
  (SELECT coalesce(string_agg(DISTINCT f.proname || ':' || p.c, ', '), '(ninguna)')
     FROM ejecutable f, prohibidas p WHERE f.src ILIKE '%' || p.c || '%'),
  CASE WHEN (SELECT count(*) FROM ejecutable f, prohibidas p
    WHERE f.src ILIKE '%' || p.c || '%') = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 153, 'F · sin SELECT * y sin row_to_json en código ejecutable', '0',
  (SELECT coalesce(string_agg(proname, ', '), '(ninguna)') FROM ejecutable
    WHERE src ~* 'SELECT\s+\*' OR src ILIKE '%row_to_json%'),
  CASE WHEN (SELECT count(*) FROM ejecutable
    WHERE src ~* 'SELECT\s+\*' OR src ILIKE '%row_to_json%') = 0
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 154, 'F · el formato: solo csv, y cualquier otro lanza P0142', 'true/true',
  -- Verificación POSITIVA sobre el bloque ejecutable que decide el formato.
  -- No se usa «la palabra xlsx no aparece»: puede estar en un comentario.
  (SELECT (blk LIKE '%<> ''csv''%')::text || '/' || (blk LIKE '%P0142%')::text FROM fmt),
  CASE WHEN (SELECT blk LIKE '%<> ''csv''%' AND blk LIKE '%P0142%' FROM fmt)
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 155, 'F · el tope de exportación sigue en 5000', 'true',
  (SELECT (src LIKE '%MAX_EXPORT constant int := 5000%')::text FROM ejecutable
    WHERE proname = 'admin_export_patients_crm'),
  CASE WHEN (SELECT src LIKE '%MAX_EXPORT constant int := 5000%' FROM ejecutable
    WHERE proname = 'admin_export_patients_crm') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 156, 'F · rechaza con P0146 al superar el tope', 'true',
  (SELECT (src LIKE '%P0146%')::text FROM ejecutable
    WHERE proname = 'admin_export_patients_crm'),
  CASE WHEN (SELECT src LIKE '%P0146%' FROM ejecutable
    WHERE proname = 'admin_export_patients_crm') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 157, 'F · la auditoría guarda con_busqueda BOOLEANO', 'true',
  (SELECT (src LIKE '%''con_busqueda''%')::text FROM ejecutable
    WHERE proname = 'admin_export_patients_crm'),
  CASE WHEN (SELECT src LIKE '%''con_busqueda''%' FROM ejecutable
    WHERE proname = 'admin_export_patients_crm') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 158, 'F · la auditoría NO guarda el término buscado ni PII', 'true',
  (SELECT (aud NOT ILIKE '%full_name%' AND aud NOT ILIKE '%phone%'
           AND aud NOT ILIKE '%email%' AND aud NOT ILIKE '%v_payload%'
           AND aud NOT ILIKE '%v_rows%' AND aud !~ '''[a-z_]*busqueda[a-z_]*'',\s*p_search')::text
     FROM (SELECT substring(src from 'INSERT INTO public\.audit_log[\s\S]*?RETURN ') AS aud
             FROM ejecutable WHERE proname = 'admin_export_patients_crm') x),
  CASE WHEN (SELECT aud NOT ILIKE '%full_name%' AND aud NOT ILIKE '%phone%'
           AND aud NOT ILIKE '%email%' AND aud NOT ILIKE '%v_payload%'
           AND aud NOT ILIKE '%v_rows%' AND aud !~ '''[a-z_]*busqueda[a-z_]*'',\s*p_search'
     FROM (SELECT substring(src from 'INSERT INTO public\.audit_log[\s\S]*?RETURN ') AS aud
             FROM ejecutable WHERE proname = 'admin_export_patients_crm') x)
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 159, 'F · un solo INSERT en audit_log, y es el del export', '1',
  (SELECT count(*)::text FROM ejecutable WHERE src ILIKE '%INSERT INTO public.audit_log%'),
  CASE WHEN (SELECT count(*) FROM ejecutable WHERE src ILIKE '%INSERT INTO public.audit_log%') = 1
   AND (SELECT bool_or(proname = 'admin_export_patients_crm') FROM ejecutable
         WHERE src ILIKE '%INSERT INTO public.audit_log%') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 160, 'F · la pantalla sigue topada en 50 por página', 'true',
  (SELECT (src LIKE '%least(greatest(coalesce(p_limit, 25), 1), 50)%')::text FROM ejecutable
    WHERE proname = 'admin_list_patients_crm'),
  CASE WHEN (SELECT src LIKE '%least(greatest(coalesce(p_limit, 25), 1), 50)%' FROM ejecutable
    WHERE proname = 'admin_list_patients_crm') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 161, 'F · las métricas NO suman los pendientes al total', 'true',
  (SELECT (src LIKE '%''pacientes_totales''%' AND src LIKE '%''pendientes_identificar''%'
           AND src NOT LIKE '%pacientes_totales%+%pendientes%')::text
     FROM ejecutable WHERE proname = 'admin_patients_crm_stats'),
  CASE WHEN (SELECT src LIKE '%''pacientes_totales''%' AND src LIKE '%''pendientes_identificar''%'
           AND src NOT LIKE '%pacientes_totales%+%pendientes%'
     FROM ejecutable WHERE proname = 'admin_patients_crm_stats') THEN 'PASS' ELSE 'FAIL' END

-- ── G. Seguridad ────────────────────────────────────────────
UNION ALL SELECT 170, 'G · is_admin() sigue siendo SOLO Owner Admin', 'false',
  -- También sobre fuente ejecutable: un comentario dentro de is_admin() que
  -- mencionara lucyadmin_access no debe hacer fallar el control.
  (SELECT coalesce(bool_or(
     regexp_replace(regexp_replace(prosrc, '/\*[\s\S]*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g')
       ILIKE '%lucyadmin_access%'), false)::text
     FROM pg_proc WHERE oid = to_regprocedure('public.is_admin()')),
  CASE WHEN (SELECT coalesce(bool_or(
     regexp_replace(regexp_replace(prosrc, '/\*[\s\S]*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g')
       ILIKE '%lucyadmin_access%'), false)
     FROM pg_proc WHERE oid = to_regprocedure('public.is_admin()')) = false
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 171, 'G · INFO · Owner Admins vs. niveles LucyAdmin (agregado, sin PII)',
  'owner_admin / lucyadmin_activos',
  (SELECT (SELECT count(*) FROM public.profiles WHERE role = 'admin')::text || ' / ' ||
          (SELECT count(*) FROM public.lucyadmin_access WHERE is_active)::text),
  'INFO'
UNION ALL SELECT 172, 'G · s7_77 NO creó tablas nuevas', '4',
  (SELECT count(*)::text FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
      AND relname LIKE 'patient_crm%'),
  CASE WHEN (SELECT count(*) FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
      AND relname LIKE 'patient_crm%') = 4 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 173, 'G · s7_77 NO agregó policies', '4',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public' AND tablename LIKE 'patient_crm%'),
  CASE WHEN (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename LIKE 'patient_crm%') = 4
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 174, 'G · ningún DML nuevo de cliente sobre las tablas del CRM', '0',
  (SELECT count(*)::text FROM
     (VALUES ('patient_crm'), ('patient_crm_tags'),
             ('patient_crm_followups'), ('patient_crm_notes')) AS c(t),
     unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) AS p,
     unnest(ARRAY['anon','authenticated']) AS r
    WHERE has_table_privilege(r, 'public.' || t, p)),
  CASE WHEN (SELECT count(*) FROM
     (VALUES ('patient_crm'), ('patient_crm_tags'),
             ('patient_crm_followups'), ('patient_crm_notes')) AS c(t),
     unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) AS p,
     unnest(ARRAY['anon','authenticated']) AS r
    WHERE has_table_privilege(r, 'public.' || t, p)) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 175, 'G · service_role SÍ conserva EXECUTE en las 4 RPCs públicas (no se tocó)',
  'informativo: el gate is_admin() sigue aplicando',
  (SELECT count(*)::text FROM fuente
    WHERE proname IN (SELECT f FROM rpc)
      AND has_function_privilege('service_role', oid, 'EXECUTE')),
  'INFO'
UNION ALL SELECT 176, 'G · INFO · s7_76 no fue tocada: privilegios de service_role sobre las tablas',
  'sin cambios respecto del apply de s7_76',
  (SELECT coalesce(string_agg(DISTINCT p, ','), '(ninguno)') FROM
     (VALUES ('patient_crm'), ('patient_crm_tags'),
             ('patient_crm_followups'), ('patient_crm_notes')) AS c(t),
     unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p
    WHERE has_table_privilege('service_role', 'public.' || t, p)),
  'INFO'
ORDER BY 1;
```

### Cómo leerlo

- **Todo `PASS` salvo las filas `INFO`** = `s7_77` quedó aplicada como se diseñó.
- **Cualquier `FAIL`**: detenerse, copiar la fila completa, reportarla. **No
  corregir a mano ni reaplicar.**
- Si el PASO 2 no hubiera creado la vista, el PASO 3 devuelve un **error de
  catálogo** en vez de filas `FAIL`: también es diagnóstico válido.

---

## PASO 4 — POST funcional (read-only, sin PII) · **consulta aparte**

Va **separada** del PASO 3 a propósito: acá sí se **invoca** el núcleo
`_crm_patients_json`, y una excepción abortaría la consulta entera y se
perderían los controles de catálogo.

**Es read-only:** `_crm_patients_json` es `STABLE` y solo hace `SELECT`; no tiene
gate, así que corre desde el SQL Editor. **La exportación NO se prueba acá**:
escribe la fila de auditoría, así que invocarla no sería read-only.

**Sin PII:** solo agregados, conteos y **nombres de clave**.

```sql
-- ══ s7_77 · PASO 4 — POST FUNCIONAL (read-only, sin PII) ══
WITH p1 AS (SELECT public._crm_patients_json(NULL, NULL, 25, 0) AS v),
     p2 AS (SELECT public._crm_patients_json(NULL, NULL, 50, 0) AS v),
     estados(e) AS (
       VALUES ('nuevo'), ('activo'), ('en_seguimiento'),
              ('recurrente'), ('inactivo'), ('bloqueado')
     ),
     porestado AS (
       SELECT e,
              (public._crm_patients_json(NULL, e, 25, 0)->>'total')::bigint AS total,
              jsonb_array_length(public._crm_patients_json(NULL, e, 25, 0)->'rows') AS filas
       FROM estados
     ),
     universo AS (SELECT count(*) AS n FROM public.crm_patient_identity),
     -- Recomputo INDEPENDIENTE del predicado, directo sobre `profiles`.
     recomputo AS (
       SELECT count(*) AS n FROM public.profiles p
       WHERE p.is_active = true
         AND p.role <> 'admin'
         AND NOT EXISTS (SELECT 1 FROM public.lucyadmin_access la
                          WHERE la.profile_id = p.id AND la.is_active = true)
         AND NOT EXISTS (SELECT 1 FROM public.admin_seed_operations so
                          WHERE so.seed_user_id = p.id)
         AND coalesce(p.email, '') NOT LIKE '%@doctor-seed.invalid'
         AND (EXISTS (SELECT 1 FROM public.patients pa WHERE pa.profile_id = p.id)
              OR (p.role = 'patient'
                  AND NOT EXISTS (SELECT 1 FROM public.doctors d WHERE d.profile_id = p.id)
                  AND NOT EXISTS (SELECT 1 FROM public.clinic_members cm WHERE cm.profile_id = p.id)
                  AND NOT EXISTS (SELECT 1 FROM public.clinics c WHERE c.owner_id = p.id)))
     ),
     walkins AS (
       SELECT count(*) AS n FROM public.patients
       WHERE profile_id IS NULL AND is_active = true AND merged_into_patient_id IS NULL
     ),
     allow(k) AS (
       VALUES ('profile_id'), ('full_name'), ('phone'), ('email'), ('created_at'),
              ('crm_status'), ('blocked'), ('canal_primera_cita'), ('fichas'),
              ('clinicas'), ('medicos'), ('citas_total'), ('atendidas'),
              ('ultima_actividad'), ('proxima_cita'), ('followups_abiertos'), ('tags')
     )
SELECT 200 AS n, 'H · el núcleo responde y trae total/limit/offset/rows' AS control,
       'true' AS esperado,
       (SELECT (v ? 'total' AND v ? 'limit' AND v ? 'offset' AND v ? 'rows')::text FROM p1) AS obtenido,
       CASE WHEN (SELECT v ? 'total' AND v ? 'limit' AND v ? 'offset' AND v ? 'rows' FROM p1)
            THEN 'PASS' ELSE 'FAIL' END AS resultado
UNION ALL SELECT 201, 'H · la página por defecto no supera 25', '<= 25',
  (SELECT jsonb_array_length(v->'rows')::text FROM p1),
  CASE WHEN (SELECT jsonb_array_length(v->'rows') FROM p1) <= 25 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 202, 'H · la página máxima no supera 50', '<= 50',
  (SELECT jsonb_array_length(v->'rows')::text FROM p2),
  CASE WHEN (SELECT jsonb_array_length(v->'rows') FROM p2) <= 50 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 203, 'H · el total sin filtro = el tamaño del universo canónico', 'iguales',
  (SELECT (v->>'total') || ' / ' || (SELECT n::text FROM universo) FROM p1),
  CASE WHEN (SELECT (v->>'total')::bigint FROM p1) = (SELECT n FROM universo)
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 204, 'H · toda fila trae crm_status derivado', '0 sin estado',
  (SELECT count(*)::text FROM p1, jsonb_array_elements(v->'rows') r
    WHERE r->>'crm_status' IS NULL),
  CASE WHEN (SELECT count(*) FROM p1, jsonb_array_elements(v->'rows') r
    WHERE r->>'crm_status' IS NULL) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 205, 'H · las claves de la fila son EXACTAMENTE la allowlist de 17', '0 fuera',
  (SELECT coalesce(string_agg(DISTINCT k, ','), '(ninguna fuera)')
     FROM p1, jsonb_array_elements(v->'rows') r, jsonb_object_keys(r) AS k
    WHERE k NOT IN (SELECT allow.k FROM allow)),
  CASE WHEN (SELECT count(*) FROM p1, jsonb_array_elements(v->'rows') r,
               jsonb_object_keys(r) AS k WHERE k NOT IN (SELECT allow.k FROM allow)) = 0
  THEN 'PASS' ELSE 'FAIL' END

-- ── I. FILTRO POR ESTADO: la corrección, medida ─────────────
UNION ALL SELECT 210, 'I · los seis estados PARTICIONAN el universo (suma de totales)', 'iguales',
  (SELECT sum(total)::text FROM porestado) || ' / ' || (SELECT n::text FROM universo),
  CASE WHEN (SELECT sum(total) FROM porestado) = (SELECT n FROM universo)
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 211, 'I · cada total filtrado es coherente con su página', '0 incoherentes',
  (SELECT count(*)::text FROM porestado WHERE filas <> least(total, 25)),
  CASE WHEN (SELECT count(*) FROM porestado WHERE filas <> least(total, 25)) = 0
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 212, 'I · ningún total filtrado supera al universo', '0',
  (SELECT count(*)::text FROM porestado, universo WHERE porestado.total > universo.n),
  CASE WHEN (SELECT count(*) FROM porestado, universo WHERE porestado.total > universo.n) = 0
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 213, 'I · toda fila devuelta por un filtro TIENE ese estado', '0 ajenas',
  (SELECT count(*)::text FROM estados e,
     jsonb_array_elements(public._crm_patients_json(NULL, e.e, 50, 0)->'rows') r
    WHERE r->>'crm_status' <> e.e),
  CASE WHEN (SELECT count(*) FROM estados e,
     jsonb_array_elements(public._crm_patients_json(NULL, e.e, 50, 0)->'rows') r
    WHERE r->>'crm_status' <> e.e) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 214, 'I · la página 2 de un filtro no repite filas de la página 1', '0 repetidas',
  (SELECT count(*)::text FROM estados e
     JOIN LATERAL (
       SELECT (SELECT count(*) FROM
                 jsonb_array_elements(public._crm_patients_json(NULL, e.e, 1, 0)->'rows') a,
                 jsonb_array_elements(public._crm_patients_json(NULL, e.e, 1, 1)->'rows') b
                WHERE a->>'profile_id' = b->>'profile_id') AS rep
     ) x ON true
    WHERE x.rep > 0),
  CASE WHEN (SELECT count(*) FROM estados e
     JOIN LATERAL (
       SELECT (SELECT count(*) FROM
                 jsonb_array_elements(public._crm_patients_json(NULL, e.e, 1, 0)->'rows') a,
                 jsonb_array_elements(public._crm_patients_json(NULL, e.e, 1, 1)->'rows') b
                WHERE a->>'profile_id' = b->>'profile_id') AS rep
     ) x ON true
    WHERE x.rep > 0) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 215, 'I · el total NO cambia al pasar de página', '0 discrepancias',
  (SELECT count(*)::text FROM estados e
    WHERE (public._crm_patients_json(NULL, e.e, 1, 0)->>'total')
       <> (public._crm_patients_json(NULL, e.e, 1, 1)->>'total')),
  CASE WHEN (SELECT count(*) FROM estados e
    WHERE (public._crm_patients_json(NULL, e.e, 1, 0)->>'total')
       <> (public._crm_patients_json(NULL, e.e, 1, 1)->>'total')) = 0
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 216, 'I · INFO · reparto por estado (agregado, sin PII)', 'conteos',
  (SELECT string_agg(e || '=' || total::text, ' · ' ORDER BY e) FROM porestado), 'INFO'
UNION ALL SELECT 217, 'I · un filtro recorre TODO el conjunto, no solo la primera página',
  '0 coincidencias perdidas',
  (SELECT count(*)::text FROM porestado
    WHERE total > 0
      AND jsonb_array_length(public._crm_patients_json(NULL, e, 5000, 0)->'rows') <> total),
  CASE WHEN (SELECT count(*) FROM porestado
    WHERE total > 0
      AND jsonb_array_length(public._crm_patients_json(NULL, e, 5000, 0)->'rows') <> total) = 0
  THEN 'PASS' ELSE 'FAIL' END

-- ── J. El universo canónico ─────────────────────────────────
UNION ALL SELECT 220, 'J · INFO · identidades en el universo del CRM', 'agregado',
  (SELECT n::text FROM universo), 'INFO'
UNION ALL SELECT 221, 'J · un paciente elegible con CERO fichas SÍ entra', '> 0',
  (SELECT count(*)::text FROM public.crm_patient_identity ci
    WHERE NOT EXISTS (SELECT 1 FROM public.patients pa WHERE pa.profile_id = ci.profile_id)),
  CASE WHEN (SELECT count(*) FROM public.crm_patient_identity ci
    WHERE NOT EXISTS (SELECT 1 FROM public.patients pa WHERE pa.profile_id = ci.profile_id)) > 0
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 222, 'J · ningún Owner Admin entra al universo', '0',
  (SELECT count(*)::text FROM public.crm_patient_identity ci
     JOIN public.profiles p ON p.id = ci.profile_id WHERE p.role = 'admin'),
  CASE WHEN (SELECT count(*) FROM public.crm_patient_identity ci
     JOIN public.profiles p ON p.id = ci.profile_id WHERE p.role = 'admin') = 0
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 223, 'J · ningún operations_admin ni directory_editor vigente entra', '0',
  (SELECT count(*)::text FROM public.crm_patient_identity ci
    WHERE EXISTS (SELECT 1 FROM public.lucyadmin_access la
                   WHERE la.profile_id = ci.profile_id AND la.is_active)),
  CASE WHEN (SELECT count(*) FROM public.crm_patient_identity ci
    WHERE EXISTS (SELECT 1 FROM public.lucyadmin_access la
                   WHERE la.profile_id = ci.profile_id AND la.is_active)) = 0
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 224, 'J · ninguna identidad técnica de seed entra', '0',
  (SELECT count(*)::text FROM public.crm_patient_identity ci
    WHERE EXISTS (SELECT 1 FROM public.admin_seed_operations so
                   WHERE so.seed_user_id = ci.profile_id)),
  CASE WHEN (SELECT count(*) FROM public.crm_patient_identity ci
    WHERE EXISTS (SELECT 1 FROM public.admin_seed_operations so
                   WHERE so.seed_user_id = ci.profile_id)) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 225, 'J · ninguna cuenta desactivada entra', '0',
  (SELECT count(*)::text FROM public.crm_patient_identity ci
     JOIN public.profiles p ON p.id = ci.profile_id WHERE p.is_active = false),
  CASE WHEN (SELECT count(*) FROM public.crm_patient_identity ci
     JOIN public.profiles p ON p.id = ci.profile_id WHERE p.is_active = false) = 0
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 226, 'J · ningún médico SIN ficha entra (exclusión blanda vigente)', '0',
  (SELECT count(*)::text FROM public.crm_patient_identity ci
    WHERE EXISTS (SELECT 1 FROM public.doctors d WHERE d.profile_id = ci.profile_id)
      AND NOT EXISTS (SELECT 1 FROM public.patients pa WHERE pa.profile_id = ci.profile_id)),
  CASE WHEN (SELECT count(*) FROM public.crm_patient_identity ci
    WHERE EXISTS (SELECT 1 FROM public.doctors d WHERE d.profile_id = ci.profile_id)
      AND NOT EXISTS (SELECT 1 FROM public.patients pa
                       WHERE pa.profile_id = ci.profile_id)) = 0
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 227, 'J · INFO · médicos que SÍ entran por tener ficha (asimetría P1.1)', 'agregado',
  (SELECT count(*)::text FROM public.crm_patient_identity ci
    WHERE EXISTS (SELECT 1 FROM public.doctors d WHERE d.profile_id = ci.profile_id)),
  'INFO'

-- ── K. Walk-ins: aparte, y sin sumarse ──────────────────────
UNION ALL SELECT 230, 'K · el universo coincide con el recomputo INDEPENDIENTE sobre profiles',
  'iguales',
  (SELECT n::text FROM universo) || ' / ' || (SELECT n::text FROM recomputo),
  CASE WHEN (SELECT n FROM universo) = (SELECT n FROM recomputo) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 231, 'K · INFO · fichas sin identidad (Pendientes de identificar)', 'agregado',
  (SELECT n::text FROM walkins), 'INFO'
UNION ALL SELECT 232, 'K · hay walk-ins que probar (si no, el control 233 no dice nada)', '> 0',
  (SELECT n::text FROM walkins),
  CASE WHEN (SELECT n FROM walkins) > 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 233, 'K · el total del listado NO suma los walk-ins', 'total <> universo + walkins',
  (SELECT (v->>'total') FROM p1) || ' <> ' ||
    ((SELECT n FROM universo) + (SELECT n FROM walkins))::text,
  CASE WHEN (SELECT (v->>'total')::bigint FROM p1)
          <> ((SELECT n FROM universo) + (SELECT n FROM walkins))
  THEN 'PASS' ELSE 'FAIL' END
ORDER BY 1;
```

---

## PASO 5 — Prueba NEGATIVA de la allowlist (read-only, debe FALLAR)

Una sola línea. **Se espera un error**, no filas. Es la demostración en vivo de
que un `p_status` arbitrario muere antes de tocar nada.

```sql
SELECT public._crm_status_norm('Juan 7123-4567');
```

**Resultado esperado:** `ERROR: Filtro de estado no válido` con `SQLSTATE
P0147`. Fijarse en dos cosas: que el mensaje **no repite el valor enviado**, y
que la fila que sigue confirma que la auditoría quedó intacta.

```sql
SELECT count(*) AS exportaciones_auditadas
FROM public.audit_log WHERE table_name = 'patient_crm_export';
```

**Esperado: `0`.** Rechazar un filtro inválido no escribe auditoría — y todavía
nadie exportó.

---

## Qué devolver al dev

1. La salida completa del **PASO 1**.
2. Si el PASO 2 falló: el mensaje de excepción íntegro.
3. Las salidas completas del **PASO 3** y del **PASO 4**.
4. Del **PASO 5**: el `SQLSTATE` del error y el conteo de exportaciones.
