# OWNER — aplicación de `s7_76` (PATIENT-CRM-P0 · fundación de datos)

> ## ✅ EJECUTADO — `s7_76` = **APPLIED / PASS / CLOSED** (2026-08-24)
>
> **No volver a aplicarla.** Los tres pasos corrieron en orden:
>
> | Paso | Resultado |
> |---|---|
> | PASO 1 · PRE | `tablas_crm_ya_existentes = 0` — confirmó que el intento fallido (`42601`, JavaScript pegado por error) **no había aplicado nada** · `is_admin_existe = true` |
> | PASO 2 · migración | `Success. No rows returned` — sin excepción, `COMMIT` correcto |
> | PASO 3 · POST | **39 PASS · 0 FAIL · 8 INFO** |
>
> **Deltas contra el PRE: exactos.** `patients` 4 → 6 índices (+2) ·
> `appointments` 6 → 8 (+2) · `profiles` 3 → 3 (+0) · **0 columnas nuevas** ·
> **0 policies nuevas** (`4/7/9` idéntico) en las tres tablas preexistentes.
>
> **Dos datos que este paso resolvió:**
>
> - **`server_version_num = 170006`** → PostgreSQL **17.6**. Queda cerrada la
>   incógnita que venía de dos frentes: **`s7_77` SÍ aplicará
>   `security_invoker` a su vista.**
> - **`pg_trgm` NO está instalada** → los dos índices trigram **no se crearon**
>   (control 25 = 0, coherente con el diseño). El buscador cae en `ILIKE` con
>   scan. **Deuda registrada, no bloqueante** al volumen actual.
>
> **`s7_77` sigue NOT APPLIED** y requiere autorización propia.

> **El SQL de este documento lo corre el owner** en el SQL Editor de Supabase.
> El dev no ejecuta nada contra la base.

---

## Qué hace `s7_76`

Crea **solo metadata propia del CRM**. Es **puramente aditiva**.

| Crea | Detalle |
|---|---|
| 4 tablas | `patient_crm` (PK = FK a `profiles`) · `patient_crm_tags` · `patient_crm_followups` · `patient_crm_notes` |
| RLS + policies | RLS activa en las cuatro · **una** policy por tabla: `SELECT`, `TO authenticated`, `USING (public.is_admin())` |
| Grants | `SELECT` a `authenticated`. `REVOKE ALL` de `PUBLIC` y `anon`. **Sin DML de cliente** |
| 7 índices | 3 del CRM + **`idx_patients_profile_id`** (el JOIN central, que hoy no existe) + `idx_patients_sin_identidad` + 2 de `appointments` |
| 2 índices condicionales | trigram sobre `profiles.full_name` y `patients.full_name`, **solo si `pg_trgm` está instalada** |
| Auditoría | `public.audit_patient_crm()` (`SECURITY DEFINER`, `search_path` fijo) + un trigger `audit_<tabla>` por tabla |

**Qué NO toca:** `profiles`, `patients`, `appointments`, `doctors`, `clinics`,
`auth.users`, Auth, el Claim, el Booking, el panel del médico, el merge/unmerge
de fichas ni ninguna policy existente. Los únicos objetos que agrega sobre
tablas preexistentes son **índices**.

**Estado esperado tras aplicar:** las cuatro tablas **vacías**. `patient_crm` se
puebla bajo demanda, la primera vez que un admin bloquea a alguien.

---

## PASO 1 — SNAPSHOT PRE (read-only, no modifica nada)

Sirve para poder afirmar después que **ninguna tabla preexistente cambió más
allá de los índices previstos**. Ejecutar y **guardar la salida**: el PASO 3 la
compara.

```sql
-- ══ s7_76 · PASO 1 — SNAPSHOT PRE (read-only) ══
SELECT 'tablas_crm_ya_existentes' AS metrica,
       (SELECT count(*)::text FROM pg_class
         WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
           AND relname IN ('patient_crm','patient_crm_tags',
                           'patient_crm_followups','patient_crm_notes')) AS valor
UNION ALL SELECT 'indices_en_patients',
       (SELECT count(*)::text FROM pg_index WHERE indrelid = 'public.patients'::regclass)
UNION ALL SELECT 'indices_en_appointments',
       (SELECT count(*)::text FROM pg_index WHERE indrelid = 'public.appointments'::regclass)
UNION ALL SELECT 'indices_en_profiles',
       (SELECT count(*)::text FROM pg_index WHERE indrelid = 'public.profiles'::regclass)
UNION ALL SELECT 'columnas_en_patients',
       (SELECT count(*)::text FROM pg_attribute
         WHERE attrelid = 'public.patients'::regclass AND attnum > 0 AND NOT attisdropped)
UNION ALL SELECT 'columnas_en_appointments',
       (SELECT count(*)::text FROM pg_attribute
         WHERE attrelid = 'public.appointments'::regclass AND attnum > 0 AND NOT attisdropped)
UNION ALL SELECT 'columnas_en_profiles',
       (SELECT count(*)::text FROM pg_attribute
         WHERE attrelid = 'public.profiles'::regclass AND attnum > 0 AND NOT attisdropped)
UNION ALL SELECT 'policies_en_patients',
       (SELECT count(*)::text FROM pg_policies WHERE schemaname='public' AND tablename='patients')
UNION ALL SELECT 'policies_en_appointments',
       (SELECT count(*)::text FROM pg_policies WHERE schemaname='public' AND tablename='appointments')
UNION ALL SELECT 'policies_en_profiles',
       (SELECT count(*)::text FROM pg_policies WHERE schemaname='public' AND tablename='profiles')
UNION ALL SELECT 'pg_trgm_instalada',
       (SELECT (count(*) > 0)::text FROM pg_extension WHERE extname = 'pg_trgm')
UNION ALL SELECT 'version_del_motor',
       (SELECT current_setting('server_version_num'))
UNION ALL SELECT 'is_admin_existe',
       (SELECT (to_regprocedure('public.is_admin()') IS NOT NULL)::text);
```

**Lo que autoriza continuar:**

- `tablas_crm_ya_existentes = 0`
- `is_admin_existe = true`
- `version_del_motor` ≥ `150000` — **dato pendiente desde hace dos frentes**.
  No condiciona a `s7_76`; sí decide si `s7_77` podrá aplicar
  `security_invoker` a su vista. Anotarlo.
- `pg_trgm_instalada` — si es `false`, la migración **no falla**: emite un
  `NOTICE` y omite los dos índices trigram.

---

## PASO 2 — MODIFICA DB

> ### ⚠️ NO copiar ningún archivo del repositorio por su nombre.
>
> En el repositorio hay **dos** archivos con `s7_76` en el nombre:
>
> | Archivo | Qué es | Va al SQL Editor |
> |---|---|---|
> | `migrations/s7_76_patient_crm_foundation.sql` | la migración | **sí** |
> | `scripts/check-s7_76.mjs` | **JavaScript**, verificación estática que corre el dev con `node` | **NO** |
>
> Pegar el segundo produce `ERROR 42601: syntax error at or near "fs"`. **El
> SQL de abajo es la fuente única para este paso: copiar de acá, no del
> repositorio.**

Ejecutar el bloque completo, de una sola vez. Va entero dentro de **una
transacción explícita** (`BEGIN; … COMMIT;`) con guardas **PRE** y **POST**
propias. Si cualquiera lanza excepción, el rollback es **total**: no quedan
tablas a medias, ni policies, ni índices, ni triggers.

```sql
BEGIN;

-- ─── 0. Guardas PRE ─────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: is_admin() no existe (s7_01)';
  END IF;
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: profiles no existe';
  END IF;
  IF to_regclass('public.patients') IS NULL OR to_regclass('public.appointments') IS NULL THEN
    RAISE EXCEPTION 'PRE fallo: faltan patients/appointments';
  END IF;
  -- El CRM no se aplica dos veces por descuido.
  IF to_regclass('public.patient_crm') IS NOT NULL THEN
    RAISE NOTICE 's7_76 PRE: patient_crm ya existe — la migración es idempotente';
  END IF;
END $$;

-- ─── 1. patient_crm — 1:1 con la identidad global ───────────
-- PK = FK: un paciente, a lo sumo una fila. Se crea BAJO DEMANDA (la primera
-- vez que un admin bloquea); no se pre-puebla, porque la enorme mayoría de
-- pacientes nunca necesitará una.
CREATE TABLE IF NOT EXISTS public.patient_crm (
  profile_id       uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- ÚNICO estado persistido (D2/D3). NULL = no bloqueado.
  blocked_at       timestamptz,
  blocked_reason   text,
  blocked_by       uuid REFERENCES public.profiles(id),

  -- Trazabilidad del LEVANTAMIENTO: sin esto, un bloqueo revertido sería
  -- indistinguible de uno que nunca ocurrió.
  unblocked_at     timestamptz,
  unblocked_reason text,
  unblocked_by     uuid REFERENCES public.profiles(id),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- Un bloqueo vigente exige motivo y actor: no se admite "bloqueado porque sí".
  CONSTRAINT patient_crm_block_coherente CHECK (
    (blocked_at IS NULL AND blocked_reason IS NULL AND blocked_by IS NULL)
    OR (blocked_at IS NOT NULL AND btrim(coalesce(blocked_reason, '')) <> ''
        AND blocked_by IS NOT NULL)
  ),
  -- No se puede levantar lo que nunca se bloqueó, ni levantar sin motivo.
  CONSTRAINT patient_crm_unblock_coherente CHECK (
    (unblocked_at IS NULL AND unblocked_reason IS NULL AND unblocked_by IS NULL)
    OR (unblocked_at IS NOT NULL AND blocked_at IS NOT NULL
        AND unblocked_at >= blocked_at
        AND btrim(coalesce(unblocked_reason, '')) <> ''
        AND unblocked_by IS NOT NULL)
  )
);

COMMENT ON TABLE public.patient_crm IS
  'PATIENT-CRM-P0. Metadata CRM de la IDENTIDAD GLOBAL del paciente. Solo lo NO derivable: el bloqueo administrativo. Sin PII ni datos clínicos.';

-- ─── 2. patient_crm_tags — etiquetas comerciales ────────────
CREATE TABLE IF NOT EXISTS public.patient_crm_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tag        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  CONSTRAINT patient_crm_tags_no_vacia CHECK (btrim(tag) <> '' AND length(tag) <= 40)
);

-- Case-insensitive: "VIP" y "vip" son la misma etiqueta, no dos.
CREATE UNIQUE INDEX IF NOT EXISTS patient_crm_tags_uniq
  ON public.patient_crm_tags (profile_id, lower(btrim(tag)));

COMMENT ON TABLE public.patient_crm_tags IS
  'PATIENT-CRM-P0. Etiquetas COMERCIALES del paciente. Prohibido usarlas para contenido clínico.';

-- ─── 3. patient_crm_followups — seguimientos ────────────────
-- Un follow-up ABIERTO es lo que deriva el estado `en_seguimiento` (D2).
CREATE TABLE IF NOT EXISTS public.patient_crm_followups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title        text NOT NULL,
  detail       text,
  due_at       timestamptz,
  status       text NOT NULL DEFAULT 'abierto',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL REFERENCES public.profiles(id),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES public.profiles(id),
  resolution   text,
  CONSTRAINT patient_crm_followups_status_chk CHECK (status IN ('abierto', 'cerrado')),
  CONSTRAINT patient_crm_followups_titulo CHECK (btrim(title) <> '' AND length(title) <= 120),
  -- Cerrar exige constancia de quién y cuándo.
  CONSTRAINT patient_crm_followups_cierre CHECK (
    (status = 'abierto' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status = 'cerrado' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_patient_crm_followups_abiertos
  ON public.patient_crm_followups (profile_id)
  WHERE status = 'abierto';

COMMENT ON TABLE public.patient_crm_followups IS
  'PATIENT-CRM-P0. Seguimientos comerciales. Un follow-up abierto deriva el estado en_seguimiento.';

-- ─── 4. patient_crm_notes — notas administrativas ───────────
-- D4: SOLO LucyAdmin. El panel del médico no las lee, y no reutilizan ningún
-- campo clínico existente.
CREATE TABLE IF NOT EXISTS public.patient_crm_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  CONSTRAINT patient_crm_notes_body CHECK (btrim(body) <> '' AND length(body) <= 4000)
);

CREATE INDEX IF NOT EXISTS idx_patient_crm_notes_profile
  ON public.patient_crm_notes (profile_id, created_at DESC);

COMMENT ON TABLE public.patient_crm_notes IS
  'PATIENT-CRM-P0. Notas ADMINISTRATIVAS, exclusivas de LucyAdmin. NUNCA información clínica ni visibles para el médico.';

-- ─── 5. RLS y grants ────────────────────────────────────────
-- Mismo patrón que s7_73/s7_74: sin DML de cliente. Las cuatro tablas se
-- mutan SOLO por las RPCs de s7_78. `authenticated` recibe SELECT para que la
-- UI pueda leer, y la policy exige is_admin().
--
-- ⚠️ La cláusula `TO authenticated` es OBLIGATORIA: omitirla equivale a
-- `TO PUBLIC`. Es exactamente el defecto que s7_74 tuvo que corregir en
-- `seedops_select_admin`.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patient_crm', 'patient_crm_tags',
                           'patient_crm_followups', 'patient_crm_notes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_admin', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_admin())',
      t || '_select_admin', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ─── 6. Índices de soporte para el listado ──────────────────
-- El JOIN central del CRM es identidad → fichas locales, y HOY no existe
-- índice sobre esa columna: el único índice de `patients` es funcional, sobre
-- el teléfono (s7_65).
CREATE INDEX IF NOT EXISTS idx_patients_profile_id
  ON public.patients (profile_id)
  WHERE profile_id IS NOT NULL;

-- "Pendientes de identificar" (D5): el complemento del anterior.
CREATE INDEX IF NOT EXISTS idx_patients_sin_identidad
  ON public.patients (created_at DESC)
  WHERE profile_id IS NULL;

-- Última actividad y próxima cita, por ficha.
CREATE INDEX IF NOT EXISTS idx_appointments_patient_start
  ON public.appointments (patient_id, start_time DESC);

-- Conteo de atendidas (recurrencia) sin escanear todas las citas.
CREATE INDEX IF NOT EXISTS idx_appointments_patient_status
  ON public.appointments (patient_id, status_id);

-- Buscador por nombre. Trigram si la extensión está disponible; si no, se
-- omite y el ILIKE cae en scan — aceptable al volumen actual, y queda
-- registrado como deuda en lugar de fallar la migración entera.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm
      ON public.profiles USING gin (lower(full_name) gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_patients_full_name_trgm
      ON public.patients USING gin (lower(full_name) gin_trgm_ops);
  ELSE
    RAISE NOTICE 's7_76: pg_trgm no está instalada — se omiten los índices trigram del buscador';
  END IF;
END $$;

-- ─── 7. Auditoría ───────────────────────────────────────────
-- Reusa el patrón del repo: función SECURITY DEFINER con search_path fijo que
-- escribe en `audit_log`. `audit_log` es inmutable desde s7_71b, así que esto
-- es append-only por construcción.
CREATE OR REPLACE FUNCTION public.audit_patient_crm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_record_id uuid;
BEGIN
  v_record_id := CASE WHEN TG_TABLE_NAME = 'patient_crm'
                      THEN COALESCE(NEW.profile_id, OLD.profile_id)
                      ELSE COALESCE(NEW.id, OLD.id) END;

  INSERT INTO public.audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(),
    lower(TG_OP)::public.audit_action,
    TG_TABLE_NAME,
    v_record_id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL
         ELSE to_jsonb(NEW) || jsonb_build_object('edited_via', 'crm') END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.audit_patient_crm() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_patient_crm() FROM anon;
REVOKE ALL ON FUNCTION public.audit_patient_crm() FROM authenticated;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patient_crm', 'patient_crm_tags',
                           'patient_crm_followups', 'patient_crm_notes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'audit_' || t, t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.audit_patient_crm()',
      'audit_' || t, t);
  END LOOP;
END $$;

-- ─── 8. Guardas POST ────────────────────────────────────────
DO $$
DECLARE
  t text;
  v_n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['patient_crm', 'patient_crm_tags',
                           'patient_crm_followups', 'patient_crm_notes'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'POST fallo: no se creó %', t;
    END IF;
    -- RLS activa.
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'POST fallo: RLS no está activa en %', t;
    END IF;
    -- Exactamente una policy, de SELECT y TO authenticated (lección de s7_74).
    SELECT count(*) INTO v_n FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'POST fallo: % tiene % policies, se esperaba 1', t, v_n;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies
     WHERE schemaname = 'public' AND tablename = t
       AND cmd = 'SELECT' AND roles::text = '{authenticated}'
       AND coalesce(qual, '') LIKE '%is_admin()%' AND with_check IS NULL;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'POST fallo: la policy de % no es SELECT/{authenticated}/is_admin()', t;
    END IF;
    -- Sin DML de cliente.
    IF has_table_privilege('authenticated', 'public.' || t, 'INSERT')
    OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
    OR has_table_privilege('authenticated', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION 'POST fallo: authenticated tiene DML sobre %', t;
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'POST fallo: authenticated no puede leer %', t;
    END IF;
    -- anon sin nada.
    IF has_table_privilege('anon', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'POST fallo: anon puede leer %', t;
    END IF;
    -- Auditoría enganchada.
    IF NOT EXISTS (SELECT 1 FROM pg_trigger tg
                    JOIN pg_class c ON c.oid = tg.tgrelid
                   WHERE c.relname = t AND tg.tgname = 'audit_' || t) THEN
      RAISE EXCEPTION 'POST fallo: falta el trigger de auditoría en %', t;
    END IF;
  END LOOP;

  -- La unidad del CRM es la identidad global: la PK de patient_crm apunta a profiles.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.patient_crm'::regclass
       AND contype = 'f' AND confrelid = 'public.profiles'::regclass
  ) THEN
    RAISE EXCEPTION 'POST fallo: patient_crm no referencia profiles';
  END IF;

  -- Índices del listado.
  FOREACH t IN ARRAY ARRAY['idx_patients_profile_id', 'idx_patients_sin_identidad',
                           'idx_appointments_patient_start', 'idx_appointments_patient_status'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'POST fallo: falta el índice %', t;
    END IF;
  END LOOP;

  -- NADA de esto debe haber tocado las tablas existentes.
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename IN ('profiles', 'patients', 'appointments')
         AND policyname LIKE '%crm%') <> 0 THEN
    RAISE EXCEPTION 'POST fallo: se agregaron policies CRM a tablas existentes';
  END IF;
END $$;

COMMIT;
```

**Salida esperada:** `COMMIT` correcto, y **como mucho un `NOTICE`**:

```
NOTICE:  s7_76: pg_trgm no está instalada — se omiten los índices trigram del buscador
```

Ese `NOTICE` aparece **solo** si `pg_trgm_instalada = false` en el PASO 1. Si
`pg_trgm` está instalada, no debería haber ningún `NOTICE`.

Cualquier `RAISE EXCEPTION 'PRE fallo:` o `'POST fallo:` significa que **nada
quedó aplicado**. Reportar el mensaje completo y **no reintentar**.

> **La migración es idempotente** (`CREATE TABLE IF NOT EXISTS`,
> `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes de crear), pero
> **no hace falta ejecutarla dos veces**. Si el primer intento aborta, el
> mensaje dice exactamente qué falló.

---

## PASO 3 — POST-CHECK (100 % read-only)

**Solo `SELECT` y catálogo. Sin `DO`, sin DDL, sin DML.** Ejecutar
inmediatamente después del PASO 2, **de una sola vez**. Devuelve una fila por
control, con `resultado` = `PASS`, `FAIL` o `INFO`.

```sql
-- ══ s7_76 · PASO 3 — POST-CHECK (100% read-only) ══
WITH crm(t) AS (
  VALUES ('patient_crm'), ('patient_crm_tags'),
         ('patient_crm_followups'), ('patient_crm_notes')
),
cols AS (
  SELECT c.relname AS t,
         string_agg(a.attname, ',' ORDER BY a.attnum) AS lista
  FROM pg_class c
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relname IN (SELECT t FROM crm)
  GROUP BY c.relname
)
-- ── A. Existencia y estructura ──────────────────────────────
SELECT  1 AS n, 'A · las cuatro tablas existen' AS control, '4' AS esperado,
        (SELECT count(*)::text FROM pg_class
          WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
            AND relname IN (SELECT t FROM crm)) AS obtenido,
        CASE WHEN (SELECT count(*) FROM pg_class
                    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
                      AND relname IN (SELECT t FROM crm)) = 4
             THEN 'PASS' ELSE 'FAIL' END AS resultado
UNION ALL SELECT 2, 'A · columnas de patient_crm',
  'profile_id,blocked_at,blocked_reason,blocked_by,unblocked_at,unblocked_reason,unblocked_by,created_at,updated_at',
  (SELECT lista FROM cols WHERE t = 'patient_crm'),
  CASE WHEN (SELECT lista FROM cols WHERE t = 'patient_crm') =
    'profile_id,blocked_at,blocked_reason,blocked_by,unblocked_at,unblocked_reason,unblocked_by,created_at,updated_at'
    THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 3, 'A · columnas de patient_crm_tags',
  'id,profile_id,tag,created_at,created_by',
  (SELECT lista FROM cols WHERE t = 'patient_crm_tags'),
  CASE WHEN (SELECT lista FROM cols WHERE t = 'patient_crm_tags') =
    'id,profile_id,tag,created_at,created_by' THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 4, 'A · columnas de patient_crm_followups',
  'id,profile_id,title,detail,due_at,status,created_at,created_by,resolved_at,resolved_by,resolution',
  (SELECT lista FROM cols WHERE t = 'patient_crm_followups'),
  CASE WHEN (SELECT lista FROM cols WHERE t = 'patient_crm_followups') =
    'id,profile_id,title,detail,due_at,status,created_at,created_by,resolved_at,resolved_by,resolution'
    THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 5, 'A · columnas de patient_crm_notes',
  'id,profile_id,body,created_at,created_by',
  (SELECT lista FROM cols WHERE t = 'patient_crm_notes'),
  CASE WHEN (SELECT lista FROM cols WHERE t = 'patient_crm_notes') =
    'id,profile_id,body,created_at,created_by' THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 6, 'A · los 7 CHECK de coherencia', '7',
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

-- ── B. PK y FK hacia profiles (D1) ──────────────────────────
UNION ALL SELECT 10, 'B · PK de patient_crm es profile_id', 'profile_id',
  (SELECT string_agg(a.attname, ',' ORDER BY a.attname)
     FROM pg_constraint co
     JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = ANY(co.conkey)
    WHERE co.conrelid = 'public.patient_crm'::regclass AND co.contype = 'p'),
  CASE WHEN (SELECT string_agg(a.attname, ',' ORDER BY a.attname)
     FROM pg_constraint co
     JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = ANY(co.conkey)
    WHERE co.conrelid = 'public.patient_crm'::regclass AND co.contype = 'p') = 'profile_id'
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 11, 'B · esa PK es TAMBIÉN FK a profiles (PK = FK)', 'true',
  (SELECT EXISTS (SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.patient_crm'::regclass AND contype = 'f'
       AND confrelid = 'public.profiles'::regclass
       AND conkey = (SELECT conkey FROM pg_constraint
                      WHERE conrelid = 'public.patient_crm'::regclass AND contype = 'p'))::text),
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.patient_crm'::regclass AND contype = 'f'
       AND confrelid = 'public.profiles'::regclass
       AND conkey = (SELECT conkey FROM pg_constraint
                      WHERE conrelid = 'public.patient_crm'::regclass AND contype = 'p'))
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 12, 'B · las 4 tablas apuntan a profiles por profile_id, ON DELETE CASCADE', '4',
  (SELECT count(*)::text FROM pg_constraint co
     JOIN pg_class rc ON rc.oid = co.conrelid
     JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = co.conkey[1]
    WHERE co.contype = 'f' AND co.confrelid = 'public.profiles'::regclass
      AND co.confdeltype = 'c' AND a.attname = 'profile_id'
      AND rc.relnamespace = 'public'::regnamespace AND rc.relname IN (SELECT t FROM crm)),
  CASE WHEN (SELECT count(*) FROM pg_constraint co
     JOIN pg_class rc ON rc.oid = co.conrelid
     JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = co.conkey[1]
    WHERE co.contype = 'f' AND co.confrelid = 'public.profiles'::regclass
      AND co.confdeltype = 'c' AND a.attname = 'profile_id'
      AND rc.relnamespace = 'public'::regnamespace AND rc.relname IN (SELECT t FROM crm)) = 4
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 13, 'B · las 10 FK a profiles (actores incluidos)', '10',
  (SELECT count(*)::text FROM pg_constraint co JOIN pg_class rc ON rc.oid = co.conrelid
    WHERE co.contype = 'f' AND co.confrelid = 'public.profiles'::regclass
      AND rc.relnamespace = 'public'::regnamespace AND rc.relname IN (SELECT t FROM crm)),
  CASE WHEN (SELECT count(*) FROM pg_constraint co JOIN pg_class rc ON rc.oid = co.conrelid
    WHERE co.contype = 'f' AND co.confrelid = 'public.profiles'::regclass
      AND rc.relnamespace = 'public'::regnamespace AND rc.relname IN (SELECT t FROM crm)) = 10
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 14, 'B · NINGUNA tabla CRM cuelga de patients', '0',
  (SELECT count(*)::text FROM pg_constraint co JOIN pg_class rc ON rc.oid = co.conrelid
    WHERE co.contype = 'f' AND co.confrelid = 'public.patients'::regclass
      AND rc.relnamespace = 'public'::regnamespace AND rc.relname IN (SELECT t FROM crm)),
  CASE WHEN (SELECT count(*) FROM pg_constraint co JOIN pg_class rc ON rc.oid = co.conrelid
    WHERE co.contype = 'f' AND co.confrelid = 'public.patients'::regclass
      AND rc.relnamespace = 'public'::regnamespace AND rc.relname IN (SELECT t FROM crm)) = 0
  THEN 'PASS' ELSE 'FAIL' END

-- ── C. Índices ──────────────────────────────────────────────
UNION ALL SELECT 20, 'C · idx_patients_profile_id existe (el JOIN central)', 'true',
  (to_regclass('public.idx_patients_profile_id') IS NOT NULL)::text,
  CASE WHEN to_regclass('public.idx_patients_profile_id') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 21, 'C · … y es PARCIAL sobre patients(profile_id)', 'true',
  (SELECT coalesce(bool_or(i.indpred IS NOT NULL
           AND pg_get_indexdef(i.indexrelid) LIKE '%public.patients%profile_id%'), false)::text
     FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE ic.relnamespace = 'public'::regnamespace AND ic.relname = 'idx_patients_profile_id'),
  CASE WHEN (SELECT coalesce(bool_or(i.indpred IS NOT NULL
           AND pg_get_indexdef(i.indexrelid) LIKE '%public.patients%profile_id%'), false)
     FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE ic.relnamespace = 'public'::regnamespace AND ic.relname = 'idx_patients_profile_id')
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 22, 'C · los 6 índices restantes del diseño', '6',
  (SELECT count(*)::text FROM pg_class
    WHERE relkind = 'i' AND relnamespace = 'public'::regnamespace
      AND relname IN ('patient_crm_tags_uniq','idx_patient_crm_followups_abiertos',
                      'idx_patient_crm_notes_profile','idx_patients_sin_identidad',
                      'idx_appointments_patient_start','idx_appointments_patient_status')),
  CASE WHEN (SELECT count(*) FROM pg_class
    WHERE relkind = 'i' AND relnamespace = 'public'::regnamespace
      AND relname IN ('patient_crm_tags_uniq','idx_patient_crm_followups_abiertos',
                      'idx_patient_crm_notes_profile','idx_patients_sin_identidad',
                      'idx_appointments_patient_start','idx_appointments_patient_status')) = 6
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 23, 'C · patient_crm_tags_uniq es ÚNICO', 'true',
  (SELECT coalesce(bool_or(i.indisunique), false)::text
     FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE ic.relnamespace = 'public'::regnamespace AND ic.relname = 'patient_crm_tags_uniq'),
  CASE WHEN (SELECT coalesce(bool_or(i.indisunique), false)
     FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE ic.relnamespace = 'public'::regnamespace AND ic.relname = 'patient_crm_tags_uniq')
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 24, 'C · los 3 índices parciales lo son de verdad', '3',
  (SELECT count(*)::text FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE ic.relnamespace = 'public'::regnamespace
      AND ic.relname IN ('idx_patient_crm_followups_abiertos',
                         'idx_patients_sin_identidad','idx_patients_profile_id')
      AND i.indpred IS NOT NULL),
  CASE WHEN (SELECT count(*) FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE ic.relnamespace = 'public'::regnamespace
      AND ic.relname IN ('idx_patient_crm_followups_abiertos',
                         'idx_patients_sin_identidad','idx_patients_profile_id')
      AND i.indpred IS NOT NULL) = 3 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 25, 'C · INFO · índices trigram (solo con pg_trgm)',
  'los 2 si pg_trgm está instalada, 0 si no',
  (SELECT count(*)::text FROM pg_class
    WHERE relkind = 'i' AND relnamespace = 'public'::regnamespace
      AND relname IN ('idx_profiles_full_name_trgm','idx_patients_full_name_trgm')),
  'INFO'

-- ── D. RLS y policies ───────────────────────────────────────
UNION ALL SELECT 30, 'D · RLS activa en las cuatro', '4',
  (SELECT count(*)::text FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN (SELECT t FROM crm) AND relrowsecurity),
  CASE WHEN (SELECT count(*) FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relname IN (SELECT t FROM crm) AND relrowsecurity) = 4 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 31, 'D · exactamente 4 policies en total (una por tabla)', '4',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (SELECT t FROM crm)),
  CASE WHEN (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (SELECT t FROM crm)) = 4
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 32, 'D · las 4 son SELECT / TO authenticated / is_admin() / sin WITH CHECK', '4',
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
UNION ALL SELECT 33, 'D · ninguna policy quedó TO PUBLIC (lección de s7_74)', '0',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (SELECT t FROM crm)
      AND roles::text IN ('{public}', '{PUBLIC}', '{-}')),
  CASE WHEN (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (SELECT t FROM crm)
      AND roles::text IN ('{public}', '{PUBLIC}', '{-}')) = 0 THEN 'PASS' ELSE 'FAIL' END

-- ── E. Privilegios: PUBLIC, anon, authenticated ─────────────
UNION ALL SELECT 40, 'E · PUBLIC sin ningún privilegio sobre las cuatro', '0',
  (SELECT count(*)::text FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname IN (SELECT t FROM crm) AND a.grantee = 0),
  CASE WHEN (SELECT count(*) FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relname IN (SELECT t FROM crm) AND a.grantee = 0) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 41, 'E · anon sin SELECT/INSERT/UPDATE/DELETE', '0',
  (SELECT count(*)::text FROM crm, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p
    WHERE has_table_privilege('anon', 'public.' || t, p)),
  CASE WHEN (SELECT count(*) FROM crm, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p
    WHERE has_table_privilege('anon', 'public.' || t, p)) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 42, 'E · authenticated CON SELECT en las cuatro', '4',
  (SELECT count(*)::text FROM crm WHERE has_table_privilege('authenticated', 'public.' || t, 'SELECT')),
  CASE WHEN (SELECT count(*) FROM crm
    WHERE has_table_privilege('authenticated', 'public.' || t, 'SELECT')) = 4
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 43, 'E · authenticated SIN NINGÚN DML (ni TRUNCATE ni REFERENCES)', '0',
  (SELECT count(*)::text FROM crm,
     unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
    WHERE has_table_privilege('authenticated', 'public.' || t, p)),
  CASE WHEN (SELECT count(*) FROM crm,
     unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p
    WHERE has_table_privilege('authenticated', 'public.' || t, p)) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 44, 'E · INFO · privilegios de service_role (default de Supabase)',
  'ver observación al pie',
  (SELECT coalesce(string_agg(DISTINCT p, ','), '(ninguno)') FROM crm,
     unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p
    WHERE has_table_privilege('service_role', 'public.' || t, p)),
  'INFO'

-- ── F. Auditoría: función y triggers ────────────────────────
UNION ALL SELECT 50, 'F · audit_patient_crm() existe y es SECURITY DEFINER', 'true',
  (SELECT (p.prosecdef)::text FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.audit_patient_crm()')),
  CASE WHEN (SELECT p.prosecdef FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.audit_patient_crm()')) THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 51, 'F · search_path fijo en la función de auditoría',
  'search_path=public, pg_catalog',
  (SELECT array_to_string(proconfig, ', ') FROM pg_proc
    WHERE oid = to_regprocedure('public.audit_patient_crm()')),
  CASE WHEN (SELECT array_to_string(proconfig, ', ') FROM pg_proc
    WHERE oid = to_regprocedure('public.audit_patient_crm()')) = 'search_path=public, pg_catalog'
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 52, 'F · ningún cliente puede EJECUTAR la función de auditoría', 'false/false',
  (SELECT has_function_privilege('anon', to_regprocedure('public.audit_patient_crm()'), 'EXECUTE')::text
       || '/' ||
          has_function_privilege('authenticated', to_regprocedure('public.audit_patient_crm()'), 'EXECUTE')::text),
  CASE WHEN NOT has_function_privilege('anon', to_regprocedure('public.audit_patient_crm()'), 'EXECUTE')
        AND NOT has_function_privilege('authenticated', to_regprocedure('public.audit_patient_crm()'), 'EXECUTE')
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 53, 'F · PUBLIC sin EXECUTE sobre la función de auditoría', '0',
  (SELECT count(*)::text FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.oid = to_regprocedure('public.audit_patient_crm()') AND a.grantee = 0),
  CASE WHEN (SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.oid = to_regprocedure('public.audit_patient_crm()') AND a.grantee = 0) = 0
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 54, 'F · 4 triggers audit_<tabla>, AFTER I/U/D FOR EACH ROW, habilitados', '4',
  (SELECT count(*)::text FROM pg_trigger tg
     JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE c.relname IN (SELECT t FROM crm) AND tg.tgname = 'audit_' || c.relname
      AND NOT tg.tgisinternal AND tg.tgtype = 29 AND tg.tgenabled = 'O'
      AND tg.tgfoid = to_regprocedure('public.audit_patient_crm()')),
  CASE WHEN (SELECT count(*) FROM pg_trigger tg
     JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE c.relname IN (SELECT t FROM crm) AND tg.tgname = 'audit_' || c.relname
      AND NOT tg.tgisinternal AND tg.tgtype = 29 AND tg.tgenabled = 'O'
      AND tg.tgfoid = to_regprocedure('public.audit_patient_crm()')) = 4
  THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 55, 'F · ningún trigger CRM se enganchó a una tabla preexistente', '0',
  (SELECT count(*)::text FROM pg_trigger tg
     JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE NOT tg.tgisinternal
      AND tg.tgfoid = to_regprocedure('public.audit_patient_crm()')
      AND c.relname NOT IN (SELECT t FROM crm)),
  CASE WHEN (SELECT count(*) FROM pg_trigger tg
     JOIN pg_class c ON c.oid = tg.tgrelid
    WHERE NOT tg.tgisinternal
      AND tg.tgfoid = to_regprocedure('public.audit_patient_crm()')
      AND c.relname NOT IN (SELECT t FROM crm)) = 0 THEN 'PASS' ELSE 'FAIL' END

-- ── G. Owners ───────────────────────────────────────────────
UNION ALL SELECT 60, 'G · owner de las cuatro tablas', 'postgres (una sola identidad)',
  (SELECT coalesce(string_agg(DISTINCT pg_get_userbyid(relowner), ','), '(ninguna)')
     FROM pg_class WHERE relnamespace = 'public'::regnamespace
       AND relname IN (SELECT t FROM crm)),
  CASE WHEN (SELECT count(DISTINCT relowner) FROM pg_class
              WHERE relnamespace = 'public'::regnamespace
                AND relname IN (SELECT t FROM crm)) = 1 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 61, 'G · owner de la función de auditoría = owner de las tablas', 'true',
  (SELECT pg_get_userbyid(proowner) FROM pg_proc
    WHERE oid = to_regprocedure('public.audit_patient_crm()')),
  CASE WHEN (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.audit_patient_crm()'))
          = (SELECT relowner FROM pg_class WHERE oid = 'public.patient_crm'::regclass)
  THEN 'PASS' ELSE 'FAIL' END

-- ── H. Baseline de datos ────────────────────────────────────
UNION ALL SELECT 70, 'H · patient_crm vacía', '0',
  (SELECT count(*)::text FROM public.patient_crm),
  CASE WHEN (SELECT count(*) FROM public.patient_crm) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 71, 'H · patient_crm_tags vacía', '0',
  (SELECT count(*)::text FROM public.patient_crm_tags),
  CASE WHEN (SELECT count(*) FROM public.patient_crm_tags) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 72, 'H · patient_crm_followups vacía', '0',
  (SELECT count(*)::text FROM public.patient_crm_followups),
  CASE WHEN (SELECT count(*) FROM public.patient_crm_followups) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 73, 'H · patient_crm_notes vacía', '0',
  (SELECT count(*)::text FROM public.patient_crm_notes),
  CASE WHEN (SELECT count(*) FROM public.patient_crm_notes) = 0 THEN 'PASS' ELSE 'FAIL' END

-- ── I. Nada preexistente cambió fuera de lo previsto ────────
UNION ALL SELECT 80, 'I · 0 policies CRM sobre profiles/patients/appointments', '0',
  (SELECT count(*)::text FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles','patients','appointments')
      AND policyname ILIKE '%crm%'),
  CASE WHEN (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles','patients','appointments')
      AND policyname ILIKE '%crm%') = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 81, 'I · 0 columnas nuevas con nombre CRM en tablas preexistentes', '0',
  (SELECT count(*)::text FROM pg_attribute
    WHERE attrelid IN ('public.profiles'::regclass, 'public.patients'::regclass,
                       'public.appointments'::regclass)
      AND attnum > 0 AND NOT attisdropped AND attname ILIKE '%crm%'),
  CASE WHEN (SELECT count(*) FROM pg_attribute
    WHERE attrelid IN ('public.profiles'::regclass, 'public.patients'::regclass,
                       'public.appointments'::regclass)
      AND attnum > 0 AND NOT attisdropped AND attname ILIKE '%crm%') = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 82, 'I · comparar con PASO 1 · columnas en patients',
  'idéntico al PASO 1',
  (SELECT count(*)::text FROM pg_attribute
    WHERE attrelid = 'public.patients'::regclass AND attnum > 0 AND NOT attisdropped), 'INFO'
UNION ALL SELECT 83, 'I · comparar con PASO 1 · columnas en appointments',
  'idéntico al PASO 1',
  (SELECT count(*)::text FROM pg_attribute
    WHERE attrelid = 'public.appointments'::regclass AND attnum > 0 AND NOT attisdropped), 'INFO'
UNION ALL SELECT 84, 'I · comparar con PASO 1 · columnas en profiles',
  'idéntico al PASO 1',
  (SELECT count(*)::text FROM pg_attribute
    WHERE attrelid = 'public.profiles'::regclass AND attnum > 0 AND NOT attisdropped), 'INFO'
UNION ALL SELECT 85, 'I · comparar con PASO 1 · índices en patients',
  'PASO 1 + 2, o + 3 con pg_trgm',
  (SELECT count(*)::text FROM pg_index WHERE indrelid = 'public.patients'::regclass), 'INFO'
UNION ALL SELECT 86, 'I · comparar con PASO 1 · índices en appointments',
  'PASO 1 + 2',
  (SELECT count(*)::text FROM pg_index WHERE indrelid = 'public.appointments'::regclass), 'INFO'
UNION ALL SELECT 87, 'I · comparar con PASO 1 · índices en profiles',
  'PASO 1, o + 1 con pg_trgm',
  (SELECT count(*)::text FROM pg_index WHERE indrelid = 'public.profiles'::regclass), 'INFO'
UNION ALL SELECT 88, 'I · comparar con PASO 1 · policies en patients/appointments/profiles',
  'idéntico al PASO 1',
  (SELECT string_agg(x.n::text, '/' ORDER BY x.tabla) FROM (
      SELECT tablename AS tabla, count(*) AS n FROM pg_policies
       WHERE schemaname = 'public' AND tablename IN ('appointments','patients','profiles')
       GROUP BY tablename) x), 'INFO'
ORDER BY 1;
```

### Cómo leerlo

- **Todo `PASS` salvo las filas `INFO`** = `s7_76` quedó aplicada tal como se
  diseñó.
- **Cualquier `FAIL`** = detenerse, copiar la fila completa y reportarla. **No
  intentar corregirla a mano ni reaplicar.**
- Las filas `INFO` **25**, **44** y **82–88** no tienen veredicto automático: se
  leen contra el PASO 1 o contra la observación de abajo.

### Deltas esperados contra el PASO 1

| Métrica | Delta |
|---|---|
| columnas en `patients`, `appointments`, `profiles` | **0** |
| policies en `patients`, `appointments`, `profiles` | **0** |
| índices en `patients` | **+2**, o **+3** si `pg_trgm` está instalada |
| índices en `appointments` | **+2** |
| índices en `profiles` | **0**, o **+1** si `pg_trgm` está instalada |

Cualquier otro delta merece explicación antes de seguir.

---

## Observación abierta — control **44**, `service_role` · **medido: `DELETE,INSERT,SELECT,UPDATE`**

Supabase concede privilegios por defecto en el esquema `public` a `anon`,
`authenticated` **y `service_role`**. La migración revoca explícitamente
`PUBLIC`, `anon` y `authenticated`, **pero no menciona `service_role`**: es de
esperar que ese rol conserve DML sobre las cuatro tablas.

**Es el mismo comportamiento que tiene el resto del proyecto** —la excepción
deliberada es `audit_log`, endurecida en `s7_71b`— y **no es una vía de acceso
para el navegador**: la secret key vive solo dentro de la Edge Function y las
legacy API keys están deshabilitadas.

**No se cambió nada.** Si tras ver el valor real querés endurecerlo al nivel de
`audit_log`, es un `REVOKE` de una línea por tabla y **entra por una migración
nueva**, no editando `s7_76`.

---

## Qué devolver al dev

1. La salida completa del **PASO 1**.
2. Si el PASO 2 falló: el mensaje de excepción íntegro.
3. La salida completa del **PASO 3**, con el veredicto de cada fila.
4. El valor de `version_del_motor` — decide `security_invoker` en `s7_77`.

**Nada de esto habilita `s7_77`.** Su aplicación se prepara por separado, con
autorización propia.
