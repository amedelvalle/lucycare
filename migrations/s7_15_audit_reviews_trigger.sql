-- ═══════════════════════════════════════════════════════════
-- Migración S7-15: Audit log para `reviews`
-- ═══════════════════════════════════════════════════════════
-- Cierra hallazgo #3 de docs/SECURITY_GATE_PILOTO.md.
--
-- Las reseñas se enviaban via RPC `submit_review` que NO escribía
-- audit_log. Las reseñas SÍ tienen `submitted_at` en su propia
-- tabla, pero faltaba consistencia con el resto de acciones
-- críticas (claim, avatar, admin edits, etc).
--
-- Trigger AFTER INSERT/UPDATE en `reviews`.
--
-- Particularidad: `submit_review` se invoca via token público
-- (sin auth.uid()). Como `audit_log.user_id` es NOT NULL, usamos
-- el `patient_profile_id` de la review como fallback razonable —
-- refleja quién fue el sujeto de la acción.
--
-- No cambia el comportamiento de `submit_review`. Solo agrega
-- registro en audit_log.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION audit_reviews_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action   audit_action;
  v_old      jsonb;
  v_new      jsonb;
  v_user_id  uuid;
BEGIN
  -- auth.uid() puede ser NULL si vino por token público.
  -- Caemos al patient_profile_id para reflejar al actor real.
  v_user_id := COALESCE(auth.uid(), NEW.patient_profile_id);
  IF v_user_id IS NULL THEN
    -- Sin actor identificable. Saltamos el audit en este caso raro;
    -- preferimos no romper el INSERT/UPDATE de la review.
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'insert'::audit_action;
    v_old    := NULL;
    v_new    := jsonb_build_object(
      'doctor_id',          NEW.doctor_id,
      'appointment_id',     NEW.appointment_id,
      'rating',             NEW.rating,
      'nps',                NEW.nps,
      'has_comment',        NEW.comment IS NOT NULL AND length(btrim(NEW.comment)) > 0,
      'submitted_via_token', auth.uid() IS NULL,
      'edited_via',         'review_submission'
    );
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update'::audit_action;
    v_old    := jsonb_build_object(
      'rating',     OLD.rating,
      'nps',        OLD.nps,
      'is_visible', OLD.is_visible
    );
    v_new    := jsonb_build_object(
      'rating',     NEW.rating,
      'nps',        NEW.nps,
      'is_visible', NEW.is_visible,
      'edited_via', 'review_update'
    );
  ELSE
    RETURN NULL;
  END IF;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_user_id,
    v_action,
    'reviews',
    NEW.id,
    v_old,
    v_new
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_reviews ON reviews;
CREATE TRIGGER audit_reviews
  AFTER INSERT OR UPDATE ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION audit_reviews_fn();
