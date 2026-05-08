-- ═══════════════════════════════════════════════════════════
-- Migración S4-02: fix audit triggers (TG_OP case mismatch)
-- ═══════════════════════════════════════════════════════════
-- Problema detectado al intentar insertar en consultations:
--   ERROR: invalid input value for enum audit_action: "INSERT"
--
-- Causa: las funciones audit_consultations / audit_patients /
-- audit_prescriptions hacen `TG_OP::audit_action`. TG_OP retorna
-- mayúsculas ('INSERT', 'UPDATE', 'DELETE') pero el enum
-- audit_action está definido en minúsculas.
--
-- Fix: castear con LOWER(TG_OP).
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.audit_consultations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'),
    LOWER(TG_OP)::audit_action,
    'consultations',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('DELETE','UPDATE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_patients()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'),
    LOWER(TG_OP)::audit_action,
    'patients',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('DELETE','UPDATE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_prescriptions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'),
    LOWER(TG_OP)::audit_action,
    'prescriptions',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('DELETE','UPDATE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;
