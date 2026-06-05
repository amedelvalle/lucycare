-- ═══════════════════════════════════════════════════════════
-- Migración S7-34: Cambio de teléfono por OTP — sync server-side (F-B)
-- ═══════════════════════════════════════════════════════════
-- El cambio de teléfono lo maneja Supabase Auth desde el cliente:
--   updateUser({phone}) → OTP al NUEVO número → verifyOtp(type:'phone_change')
--   → auth.users.phone = nuevo (sesión activa requerida; Secure phone change
--   debe estar OFF en el dashboard → no se exige OTP al número anterior).
--
-- Esta migración sincroniza el resto de la identidad cuando auth.users.phone
-- cambia, vía TRIGGER (no RPC del cliente) para que no haya ventana de
-- inconsistencia si el cliente confirma el OTP pero luego falla/cierra.
--
-- auth.users.phone = canónico. Al cambiar:
--   • profiles.phone se sincroniza (el paciente no puede tocar phone: está
--     fuera del grant column-restricted de s7_32 → lo hace el definer).
--   • patients.phone de fichas vinculadas se sincroniza, con bypass del guard
--     de s7_33 (GUC app.syncing_patient_identity).
--   • audit_log registra el cambio (edited_via='phone_change').
--
-- DEFENSIVO (trigger sobre auth.users):
--   • SECURITY DEFINER + search_path explícito.
--   • user_id de audit = NEW.id (en contexto GoTrue auth.uid() es NULL; NEW.id
--     es el sujeto = actor del self-change).
--   • teléfono normalizado a canónico 503XXXXXXXX (igual que normalizePhoneSV
--     y el claim).
--   • la auditoría NO bloquea el cambio (sub-bloque con EXCEPTION).
--   • no hay loop: actualiza profiles/patients, nunca auth.users; y phone no es
--     vigilado por los triggers de s7_32/s7_33.
--   • dispara solo en UPDATE OF phone y solo si el valor canónico cambió (no en
--     el alta del usuario ni en la confirmación inicial del OTP de signup).
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sync_phone_to_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text := regexp_replace(coalesce(OLD.phone, ''), '\D', '', 'g');
  v_new text := regexp_replace(coalesce(NEW.phone, ''), '\D', '', 'g');
BEGIN
  -- Nada que sincronizar si no hay phone nuevo o no cambió el canónico.
  IF v_new = '' OR v_new = v_old THEN
    RETURN NEW;
  END IF;

  -- profiles.phone (definer; el paciente no puede tocar phone vía grant).
  UPDATE profiles SET phone = v_new, updated_at = now() WHERE id = NEW.id;

  -- patients.phone de fichas vinculadas, con bypass del guard de s7_33.
  PERFORM set_config('app.syncing_patient_identity', 'on', true);
  UPDATE patients SET phone = v_new, updated_at = now() WHERE profile_id = NEW.id;
  PERFORM set_config('app.syncing_patient_identity', 'off', true);

  -- Auditoría best-effort: NUNCA bloquea el cambio de teléfono.
  BEGIN
    INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      NEW.id, 'update'::audit_action, 'profiles', NEW.id,
      jsonb_build_object('phone', v_old),
      jsonb_build_object('phone', v_new, 'edited_via', 'phone_change')
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_phone_to_identity_trg ON auth.users;
CREATE TRIGGER sync_phone_to_identity_trg
  AFTER UPDATE OF phone ON auth.users
  FOR EACH ROW EXECUTE FUNCTION sync_phone_to_identity();
