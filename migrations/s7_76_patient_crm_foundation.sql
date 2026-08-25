-- ═══════════════════════════════════════════════════════════
-- Migración S7-76: PATIENT-CRM-P0 — fundación de datos
-- ═══════════════════════════════════════════════════════════
-- CRM operativo de pacientes dentro de LucyAdmin. Esta migración crea SOLO
-- metadata propia del CRM. No duplica identidad, contacto, citas, médicos ni
-- clínicas: todo eso ya tiene fuente de verdad y se lee por JOIN.
--
-- ── D1 · LA UNIDAD DEL CRM ES LA IDENTIDAD GLOBAL ──
-- Las cuatro tablas cuelgan de `profiles.id`, NUNCA de `patients.id`. Una
-- ficha `patients` es una RELACIÓN local de esa identidad, no el sujeto. Por
-- eso `patient_crm.profile_id` es PK **y** FK a la vez: es imposible tener dos
-- filas CRM para el mismo paciente, y una fusión de fichas no crea duplicados
-- porque no toca `profiles`.
--
-- ── D2 · LOS ESTADOS NO SE PERSISTEN ──
-- `nuevo`, `activo`, `recurrente`, `inactivo` y `en_seguimiento` se DERIVAN en
-- consulta desde `profiles`, `appointments` y los follow-ups. Persistirlos
-- exigiría un job de recálculo y quedarían desincronizados en cuanto alguien
-- cancele una cita. El ÚNICO estado persistido es `bloqueado`, porque es una
-- decisión humana que ningún dato puede inferir — y por eso lleva
-- trazabilidad completa: motivo, actor y fecha, tanto al bloquear como al
-- levantar.
--
-- ── D4 · FRONTERA CLÍNICA ──
-- Ninguna tabla de acá guarda información asistencial, y las RPCs de `s7_77`
-- no seleccionan columnas clínicas. La separación vive en el BACKEND, no solo
-- en la interfaz.
--
-- ── QUÉ CREA ──
--   1. patient_crm            — 1:1 con profiles. Solo lo NO derivable.
--   2. patient_crm_tags       — etiquetas comerciales.
--   3. patient_crm_followups  — seguimientos con estado (alimentan `en_seguimiento`).
--   4. patient_crm_notes      — notas administrativas, solo LucyAdmin (D4).
--   + RLS, grants, índices y auditoría.
--
-- ── QUÉ NO TOCA ──
-- `profiles`, `patients`, `appointments`, `doctors`, `clinics`, Auth, el
-- Claim, el Booking, el panel del médico, el merge/unmerge de fichas ni
-- ninguna policy existente. Es puramente aditiva.
--
-- ── ERRORES TIPADOS (para s7_77/s7_78) ──
--   P0140 no autorizado
--   P0141 el profile no existe
--   P0142 datos obligatorios faltantes
--   P0143 transición de bloqueo ilegal
--   P0144 la etiqueta ya existe para ese paciente
--   P0145 el follow-up no existe o no está abierto
-- ═══════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════
-- Rollback: docs/rollbacks/s7_76_rollback.sql
-- ═══════════════════════════════════════════════════════════
