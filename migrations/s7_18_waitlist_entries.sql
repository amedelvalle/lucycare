-- ═══════════════════════════════════════════════════════════
-- Migración S7-18: Lista de espera real (waitlist_entries)
-- ═══════════════════════════════════════════════════════════
-- Cierra PR-B del flujo de directorio informativo. Hoy el
-- componente WaitlistModal es placeholder (solo console.log).
-- Esta migración:
--
-- 1. Crea tabla waitlist_entries para registrar interés de
--    pacientes en médicos que aún no operan agenda en línea.
-- 2. RLS estricta: anon NO lee NI escribe la tabla directo.
--    Solo el RPC submit_waitlist_entry puede insertar (SECURITY
--    DEFINER). Admin lee/actualiza. Doctor lee solo las suyas.
-- 3. Dedup idempotente: UNIQUE(doctor_id, patient_phone_normalized).
-- 4. RPC público para enviar interés (anon callable).
-- 5. RPCs admin para listar y marcar como contactado.
--
-- Notificación es manual desde admin — sin Twilio, sin Edge
-- Functions, sin SMS automático. Decisión D4 documentada en
-- docs/ANALISIS_DIRECTORIO_INFORMATIVO.md.
--
-- NO crea pacientes ni citas. Solo registra interés.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Tabla ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id                   uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  patient_name                text NOT NULL,
  patient_phone               text NOT NULL,       -- formato display tal como vino
  patient_phone_normalized    text NOT NULL,       -- 503XXXXXXXX, base para dedup
  patient_message             text,                -- opcional, comentario/preferencia
  status                      text NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','contacted','cancelled')),
  contacted_at                timestamptz,
  contacted_by                uuid REFERENCES profiles(id),
  notes                       text,                -- notas del admin tras contactar
  source                      text NOT NULL DEFAULT 'public_directory',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT waitlist_name_length   CHECK (length(btrim(patient_name)) BETWEEN 2 AND 200),
  CONSTRAINT waitlist_phone_format  CHECK (patient_phone_normalized ~ '^503[0-9]{8}$')
);

-- Dedup idempotente por (médico, teléfono normalizado).
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_entries_doctor_phone_uniq
  ON waitlist_entries(doctor_id, patient_phone_normalized);

CREATE INDEX IF NOT EXISTS waitlist_entries_doctor_created
  ON waitlist_entries(doctor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS waitlist_entries_status
  ON waitlist_entries(status) WHERE status = 'pending';

-- ─── 2. RLS ─────────────────────────────────────────────────
ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;

-- Limpiar policies legacy si existen (idempotencia)
DROP POLICY IF EXISTS "waitlist_public_insert"     ON waitlist_entries;
DROP POLICY IF EXISTS "waitlist_admin_select"      ON waitlist_entries;
DROP POLICY IF EXISTS "waitlist_admin_update"      ON waitlist_entries;
DROP POLICY IF EXISTS "waitlist_doctor_self_select" ON waitlist_entries;

-- Anon/authenticated NO pueden leer directo. Solo via RPC (que es
-- SECURITY DEFINER y aplica is_admin() o is_doctor_owner).
-- Tampoco INSERT directo. Solo via submit_waitlist_entry RPC.
-- → NO creamos policies para anon. RLS bloquea por default.

-- Admin: SELECT y UPDATE (para marcar como contactado, agregar notas).
CREATE POLICY "waitlist_admin_select" ON waitlist_entries
  FOR SELECT TO authenticated
  USING (is_admin());

CREATE POLICY "waitlist_admin_update" ON waitlist_entries
  FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Doctor: SELECT solo sus propias entradas (los pacientes que quieren
-- agendar con él/ella). Útil cuando en una fase futura el médico
-- tenga vista propia de "interés acumulado".
CREATE POLICY "waitlist_doctor_self_select" ON waitlist_entries
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM doctors d
    WHERE d.id = waitlist_entries.doctor_id
      AND d.profile_id = auth.uid()
  ));

-- ─── 3. RPC público — submit_waitlist_entry ─────────────────
-- Llamable por anon Y authenticated. SECURITY DEFINER para
-- bypass de RLS al insertar (la policy de INSERT directo está
-- ausente a propósito).
--
-- Validaciones:
--   - doctor existe Y is_published=true (no aceptamos lista de
--     espera para médicos no publicados).
--   - patient_name: trim, length 2-200.
--   - patient_phone: normaliza a 503XXXXXXXX. Debe ser 11 dígitos
--     comenzando en 503.
--   - patient_message: opcional, max 500 chars.
--
-- Retorno: jsonb { success: true, already_in_list: bool }.
--   already_in_list=true significa que el phone ya estaba registrado
--   para este médico (ON CONFLICT DO NOTHING). El frontend muestra
--   el mismo mensaje genérico de éxito.
CREATE OR REPLACE FUNCTION submit_waitlist_entry(
  p_doctor_id        uuid,
  p_patient_name     text,
  p_patient_phone    text,
  p_patient_message  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name             text;
  v_phone_clean      text;
  v_phone_norm       text;
  v_message          text;
  v_doctor_exists    boolean;
  v_inserted_id      uuid;
BEGIN
  -- Sanitización inputs
  v_name := btrim(coalesce(p_patient_name, ''));
  v_phone_clean := regexp_replace(coalesce(p_patient_phone, ''), '\D', '', 'g');
  v_message := nullif(btrim(coalesce(p_patient_message, '')), '');

  -- Validaciones server-side
  IF v_name = '' OR length(v_name) < 2 OR length(v_name) > 200 THEN
    RAISE EXCEPTION 'Nombre inválido. Debe tener entre 2 y 200 caracteres.'
      USING ERRCODE = 'P0101';
  END IF;

  -- Normalizar teléfono SV. Si vino sin código de país, prefijar 503.
  IF length(v_phone_clean) = 8 THEN
    v_phone_norm := '503' || v_phone_clean;
  ELSIF length(v_phone_clean) = 11 AND v_phone_clean LIKE '503%' THEN
    v_phone_norm := v_phone_clean;
  ELSE
    RAISE EXCEPTION 'Teléfono inválido. Esperamos 8 dígitos (SV) o formato 503XXXXXXXX.'
      USING ERRCODE = 'P0102';
  END IF;

  IF v_message IS NOT NULL AND length(v_message) > 500 THEN
    RAISE EXCEPTION 'El comentario no puede superar 500 caracteres.'
      USING ERRCODE = 'P0103';
  END IF;

  -- Doctor existe y publicado
  SELECT EXISTS(
    SELECT 1 FROM doctors WHERE id = p_doctor_id AND is_published = true
  ) INTO v_doctor_exists;
  IF NOT v_doctor_exists THEN
    RAISE EXCEPTION 'Médico no disponible para lista de espera.'
      USING ERRCODE = 'P0104';
  END IF;

  -- Upsert idempotente
  INSERT INTO waitlist_entries (
    doctor_id, patient_name, patient_phone, patient_phone_normalized, patient_message
  ) VALUES (
    p_doctor_id, v_name, p_patient_phone, v_phone_norm, v_message
  )
  ON CONFLICT (doctor_id, patient_phone_normalized) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    -- Ya estaba en la lista
    RETURN jsonb_build_object(
      'success', true,
      'already_in_list', true
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_in_list', false,
    'entry_id', v_inserted_id
  );
END;
$$;

-- Permitir invocación pública (anon) y autenticada
GRANT EXECUTE ON FUNCTION submit_waitlist_entry(uuid, text, text, text) TO anon, authenticated;

-- ─── 4. RPCs admin ──────────────────────────────────────────

-- Lista de espera de un médico (paginada, ordenada por más reciente).
CREATE OR REPLACE FUNCTION admin_list_waitlist_for_doctor(
  p_doctor_id   uuid,
  p_status      text DEFAULT NULL,
  p_limit       int  DEFAULT 50,
  p_offset      int  DEFAULT 0
)
RETURNS TABLE (
  id                uuid,
  patient_name      text,
  patient_phone     text,
  patient_message   text,
  status            text,
  contacted_at      timestamptz,
  notes             text,
  created_at        timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;

  RETURN QUERY
  SELECT w.id, w.patient_name, w.patient_phone, w.patient_message,
         w.status, w.contacted_at, w.notes, w.created_at
  FROM waitlist_entries w
  WHERE w.doctor_id = p_doctor_id
    AND (p_status IS NULL OR w.status = p_status)
  ORDER BY w.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200))
  OFFSET GREATEST(0, p_offset);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_list_waitlist_for_doctor(uuid, text, int, int) TO authenticated;

-- Conteo (separado para no traer todas las filas solo para el count).
CREATE OR REPLACE FUNCTION admin_count_waitlist_for_doctor(
  p_doctor_id   uuid,
  p_status      text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;

  SELECT count(*)::int INTO v_count
  FROM waitlist_entries w
  WHERE w.doctor_id = p_doctor_id
    AND (p_status IS NULL OR w.status = p_status);

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_count_waitlist_for_doctor(uuid, text) TO authenticated;

-- Marcar como contactado / actualizar nota.
CREATE OR REPLACE FUNCTION admin_update_waitlist_entry(
  p_entry_id    uuid,
  p_status      text,
  p_notes       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old record;
  v_clean_notes text := nullif(btrim(coalesce(p_notes, '')), '');
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_status NOT IN ('pending','contacted','cancelled') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status USING ERRCODE = 'P0105';
  END IF;

  SELECT status, contacted_at, notes INTO v_old
  FROM waitlist_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrada no encontrada' USING ERRCODE = 'P0106';
  END IF;

  UPDATE waitlist_entries
    SET status = p_status,
        contacted_at = CASE
          WHEN p_status = 'contacted' AND v_old.contacted_at IS NULL THEN now()
          WHEN p_status = 'pending'                                  THEN NULL
          ELSE contacted_at
        END,
        contacted_by = CASE WHEN p_status = 'contacted' THEN auth.uid() ELSE contacted_by END,
        notes = v_clean_notes,
        updated_at = now()
  WHERE id = p_entry_id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'waitlist_entries', p_entry_id,
    jsonb_build_object('status', v_old.status, 'notes', v_old.notes),
    jsonb_build_object('status', p_status, 'notes', v_clean_notes, 'edited_via', 'admin')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_waitlist_entry(uuid, text, text) TO authenticated;

-- ─── 5. Trigger de audit en INSERT (para trazabilidad de altas) ─
CREATE OR REPLACE FUNCTION audit_waitlist_entries_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      -- auth.uid() puede ser NULL si vino vía anon → fallback al doctor_id
      -- como actor (para no romper NOT NULL).
      COALESCE(auth.uid(), NEW.doctor_id),
      'insert'::audit_action,
      'waitlist_entries',
      NEW.id,
      NULL,
      jsonb_build_object(
        'doctor_id', NEW.doctor_id,
        'phone_norm', NEW.patient_phone_normalized,
        'source', NEW.source,
        'submitted_via_anon', auth.uid() IS NULL,
        'edited_via', 'waitlist_submission'
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_waitlist_entries ON waitlist_entries;
CREATE TRIGGER audit_waitlist_entries
  AFTER INSERT ON waitlist_entries
  FOR EACH ROW
  EXECUTE FUNCTION audit_waitlist_entries_fn();

-- ─── 6. Touch updated_at en UPDATE ──────────────────────────
CREATE OR REPLACE FUNCTION waitlist_entries_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS waitlist_entries_touch ON waitlist_entries;
CREATE TRIGGER waitlist_entries_touch
  BEFORE UPDATE ON waitlist_entries
  FOR EACH ROW
  EXECUTE FUNCTION waitlist_entries_touch_updated_at();
