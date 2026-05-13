-- ═══════════════════════════════════════════════════════════
-- Migración S5-07: Invitaciones de equipo (asistentes)
-- ═══════════════════════════════════════════════════════════
-- Permite al doctor invitar asistentes desde /panel/equipo sin tener
-- que pre-crear el profile (que requiere auth.uid del usuario).
--
-- Flujo:
--   1. Doctor inserta clinic_invitations (clinic_id, phone, display_name)
--   2. Asistente se loguea con OTP usando ese teléfono
--   3. Tras verificar OTP, frontend llama RPC accept_clinic_invitations(phone)
--      que (con SECURITY DEFINER):
--        - Busca invitaciones pendientes que matchean el teléfono
--        - Crea clinic_members rows
--        - Cambia profile.role a 'assistant'
--        - Marca invitación como aceptada
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Tabla ───────────────────────────────────────────────
CREATE TABLE clinic_invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  phone         text NOT NULL,
  display_name  text,                            -- opcional, para mostrar mientras está pendiente
  role          clinic_member_role NOT NULL DEFAULT 'assistant',
  invited_by    uuid NOT NULL REFERENCES profiles(id),
  invited_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz,
  cancelled_at  timestamptz
);

CREATE INDEX idx_clinic_invitations_clinic ON clinic_invitations(clinic_id);
CREATE INDEX idx_clinic_invitations_phone ON clinic_invitations(phone) WHERE accepted_at IS NULL AND cancelled_at IS NULL;

-- Solo una invitación pendiente por (clínica, teléfono) — evita duplicados
CREATE UNIQUE INDEX idx_clinic_invitations_pending
  ON clinic_invitations(clinic_id, phone)
  WHERE accepted_at IS NULL AND cancelled_at IS NULL;

-- ─── 2. RLS ─────────────────────────────────────────────────
ALTER TABLE clinic_invitations ENABLE ROW LEVEL SECURITY;

-- Doctor ve y administra invitaciones de SU clínica
CREATE POLICY clinic_invitations_select_doctor ON clinic_invitations
  FOR SELECT USING (
    clinic_id IN (
      SELECT clinic_id FROM doctors WHERE profile_id = auth.uid()
    )
    OR is_clinic_member(clinic_id)
  );

CREATE POLICY clinic_invitations_insert_doctor ON clinic_invitations
  FOR INSERT WITH CHECK (
    clinic_id IN (
      SELECT clinic_id FROM doctors WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY clinic_invitations_update_doctor ON clinic_invitations
  FOR UPDATE USING (
    clinic_id IN (
      SELECT clinic_id FROM doctors WHERE profile_id = auth.uid()
    )
  );

-- ─── 3. Audit trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION audit_clinic_invitations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'),
    LOWER(TG_OP)::audit_action,
    'clinic_invitations',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('DELETE','UPDATE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_clinic_invitations
  AFTER INSERT OR UPDATE OR DELETE ON clinic_invitations
  FOR EACH ROW EXECUTE FUNCTION audit_clinic_invitations();

-- ─── 4. RPC accept_clinic_invitations ───────────────────────
-- Llamada desde frontend tras OTP verify. Procesa invitaciones pendientes
-- matching el teléfono del usuario actual.
--
-- Retorna: cantidad de invitaciones aceptadas.
CREATE OR REPLACE FUNCTION accept_clinic_invitations(user_phone text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  invitation RECORD;
  accepted_count integer := 0;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Defensa: el teléfono debe coincidir con el del profile del usuario actual
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = current_user_id AND phone = user_phone
  ) THEN
    RAISE EXCEPTION 'El teléfono no coincide con la cuenta autenticada';
  END IF;

  FOR invitation IN
    SELECT * FROM clinic_invitations
    WHERE phone = user_phone
      AND accepted_at IS NULL
      AND cancelled_at IS NULL
  LOOP
    -- Crear clinic_members (idempotente: si ya existe, no falla)
    INSERT INTO clinic_members (clinic_id, profile_id, role, is_active)
    VALUES (invitation.clinic_id, current_user_id, invitation.role, true)
    ON CONFLICT DO NOTHING;

    -- Actualizar profile.role si es 'patient' (no degradamos doctor → assistant)
    UPDATE profiles
    SET role = invitation.role::user_role,
        updated_at = now()
    WHERE id = current_user_id
      AND role = 'patient';

    -- Marcar invitación como aceptada
    UPDATE clinic_invitations
    SET accepted_at = now()
    WHERE id = invitation.id;

    accepted_count := accepted_count + 1;
  END LOOP;

  RETURN accepted_count;
END;
$$;

-- Permitir que cualquier usuario autenticado llame esta RPC
GRANT EXECUTE ON FUNCTION accept_clinic_invitations(text) TO authenticated;
