-- ═══════════════════════════════════════════════════════════
-- Migración S7-27: límite de asistentes (Mi equipo Fase 1)
-- ═══════════════════════════════════════════════════════════
-- Cierra el riesgo de "asistentes ilimitados" antes del piloto.
--
-- Regla comercial (cerrada por el owner):
--   • 1 médico titular + máximo 2 asistentes incluidos.
--   • Usuarios adicionales = add-on pagado → DIFERIDO a la fase de pagos.
--   • En Fase 1 el límite es FIJO en 2.
--
-- Conteo (D2): cuenta asistentes ACTIVOS en clinic_members +
-- invitaciones PENDIENTES en clinic_invitations (anti-bypass).
--
-- Enforcement SERVER-SIDE (D4): hoy invitar es un INSERT directo a
-- clinic_invitations (gobernado por RLS), así que un check de cliente no
-- alcanza → trigger BEFORE INSERT en la tabla + revalidación en
-- accept_clinic_invitations.
--
-- NO toca: gate clínico (s7_26), pagos, suscripciones, add-ons.
--
-- Funciones SECURITY DEFINER para que el conteo sea exacto sin depender
-- del RLS del que invoca.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Límite de asientos de asistente por clínica ─────────
-- Fase 1: FIJO en 2. Toma p_clinic_id para que en la fase de pagos pueda
-- leer included_assistants + additional_assistants de `subscriptions`
-- sin cambiar la firma ni los triggers (punto de enganche).
CREATE OR REPLACE FUNCTION team_seat_limit(p_clinic_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- TODO(pagos): reemplazar el 2 fijo por
  --   included_assistants + additional_assistants de subscriptions(p_clinic_id).
  SELECT 2;
$$;

-- ─── 2. Asientos usados (activos + pendientes) ──────────────
CREATE OR REPLACE FUNCTION team_seats_used(p_clinic_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM clinic_members cm
       WHERE cm.clinic_id = p_clinic_id
         AND cm.role = 'assistant'
         AND cm.is_active = true)
  + (SELECT count(*) FROM clinic_invitations ci
       WHERE ci.clinic_id = p_clinic_id
         AND ci.role = 'assistant'
         AND ci.accepted_at IS NULL
         AND ci.cancelled_at IS NULL);
$$;

GRANT EXECUTE ON FUNCTION team_seat_limit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION team_seats_used(uuid) TO authenticated;

-- ─── 3. Trigger: bloquear nueva invitación si se llenó el cupo ──
CREATE OR REPLACE FUNCTION enforce_team_seat_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_used  integer;
BEGIN
  -- Solo aplica a invitaciones de asistente (no owner/doctor).
  IF NEW.role <> 'assistant' THEN
    RETURN NEW;
  END IF;

  v_limit := team_seat_limit(NEW.clinic_id);
  v_used  := team_seats_used(NEW.clinic_id);  -- activos + pendientes existentes

  -- La fila nueva todavía no está contada → si ya estamos en el límite,
  -- esta invitación lo excedería.
  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'Tu plan incluye hasta % asistentes. Alcanzaste el límite.', v_limit
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_team_seat_limit ON clinic_invitations;
CREATE TRIGGER trg_enforce_team_seat_limit
  BEFORE INSERT ON clinic_invitations
  FOR EACH ROW EXECUTE FUNCTION enforce_team_seat_limit();

-- ─── 4. Revalidación al aceptar (defensa ante carrera) ──────
-- CREATE OR REPLACE de accept_clinic_invitations (s5_07) + chequeo de
-- cupo antes de activar cada membresía de asistente. Si el cupo de
-- asistentes ACTIVOS ya está lleno, no activa esa invitación (queda
-- pendiente) — evita exceder por dos aceptaciones simultáneas.
CREATE OR REPLACE FUNCTION accept_clinic_invitations(user_phone text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
  invitation RECORD;
  accepted_count integer := 0;
  v_active_assistants integer;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

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
    -- Revalidar cupo para invitaciones de asistente (defensa ante carrera).
    IF invitation.role = 'assistant' THEN
      SELECT count(*) INTO v_active_assistants
        FROM clinic_members
       WHERE clinic_id = invitation.clinic_id
         AND role = 'assistant'
         AND is_active = true;
      IF v_active_assistants >= team_seat_limit(invitation.clinic_id) THEN
        -- Cupo lleno: no activar; dejar la invitación pendiente.
        CONTINUE;
      END IF;
    END IF;

    INSERT INTO clinic_members (clinic_id, profile_id, role, is_active)
    VALUES (invitation.clinic_id, current_user_id, invitation.role, true)
    ON CONFLICT DO NOTHING;

    -- Cast vía text: clinic_member_role y user_role son enums DISTINTOS;
    -- Postgres no castea enum→enum directo. (Bug heredado de s5_07 que
    -- nunca se ejecutó porque no había asistentes; corregido acá.)
    UPDATE profiles
    SET role = invitation.role::text::user_role,
        updated_at = now()
    WHERE id = current_user_id
      AND role = 'patient';

    UPDATE clinic_invitations
    SET accepted_at = now()
    WHERE id = invitation.id;

    accepted_count := accepted_count + 1;
  END LOOP;

  RETURN accepted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION accept_clinic_invitations(text) TO authenticated;
