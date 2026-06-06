-- ═══════════════════════════════════════════════════════════
-- Migración S7-36: Mi equipo Fase 2 — ciclo de vida de invitación
-- ═══════════════════════════════════════════════════════════
-- Agrega expiración (TTL) y reenvío a las invitaciones de equipo, sin cron
-- ni Edge Functions: "vencida" es un estado DERIVADO (expires_at < now()).
--
-- DECISIONES (firmadas por el owner, ver docs/ANALISIS_MI_EQUIPO_INVITADOS.md):
--   • TTL = 14 días.
--   • Una invitación VENCIDA no se puede aceptar → primero hay que reenviarla.
--   • Reenviar EXTIENDE la misma fila (no crea otra; respeta el UNIQUE parcial).
--   • Si la invitación estaba vencida, reenviar REVALIDA cupo antes de revivirla;
--     sin cupo, no permite reenviar.
--   • Las vencidas NO consumen cupo; las pendientes vigentes y los asistentes
--     activos SÍ.
--   • El UNIQUE parcial (1 pendiente por clinic+phone) no puede filtrar por
--     tiempo (now() no es inmutable) → una vencida sigue ocupando el slot del
--     teléfono; el camino correcto es REENVIAR, no "invitar de nuevo".
--
-- Auditoría: reenviar y cancelar son UPDATE → ya los cubre
-- trg_audit_clinic_invitations (s5_07). La expiración es estado derivado
-- (no hay evento) → no requiere audit.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. TTL como fuente única ───────────────────────────────
CREATE OR REPLACE FUNCTION invitation_ttl()
RETURNS interval
LANGUAGE sql IMMUTABLE
AS $$ SELECT interval '14 days'; $$;

-- ─── 2. Columna expires_at (backfill + default + NOT NULL) ──
ALTER TABLE clinic_invitations ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE clinic_invitations
   SET expires_at = invited_at + invitation_ttl()
 WHERE expires_at IS NULL;

ALTER TABLE clinic_invitations
  ALTER COLUMN expires_at SET DEFAULT (now() + invitation_ttl());
ALTER TABLE clinic_invitations
  ALTER COLUMN expires_at SET NOT NULL;

-- Índice para los chequeos por tiempo (accept / conteo / UI).
CREATE INDEX IF NOT EXISTS idx_clinic_invitations_expires
  ON clinic_invitations(expires_at)
  WHERE accepted_at IS NULL AND cancelled_at IS NULL;

-- ─── 3. Conteo de cupo: las VENCIDAS no consumen ────────────
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
         AND ci.cancelled_at IS NULL
         AND ci.expires_at > now());   -- ← excluye vencidas (liberan cupo)
$$;

-- ─── 4. Aceptar: ignorar las VENCIDAS ───────────────────────
-- CREATE OR REPLACE de s7_27 + filtro `expires_at > now()` en el loop: una
-- invitación vencida no se acepta (hay que reenviarla). Resto idéntico
-- (revalidación de cupo de asistente ante carrera).
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
      AND expires_at > now()          -- ← no aceptar vencidas
  LOOP
    -- Revalidar cupo para invitaciones de asistente (defensa ante carrera).
    IF invitation.role = 'assistant' THEN
      SELECT count(*) INTO v_active_assistants
        FROM clinic_members
       WHERE clinic_id = invitation.clinic_id
         AND role = 'assistant'
         AND is_active = true;
      IF v_active_assistants >= team_seat_limit(invitation.clinic_id) THEN
        CONTINUE;  -- Cupo lleno: no activar; dejar pendiente.
      END IF;
    END IF;

    INSERT INTO clinic_members (clinic_id, profile_id, role, is_active)
    VALUES (invitation.clinic_id, current_user_id, invitation.role, true)
    ON CONFLICT DO NOTHING;

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

-- ─── 5. RPC resend_invitation ───────────────────────────────
-- Reenvía (extiende) una invitación pendiente. Solo el titular de la clínica
-- (igual gate que la policy UPDATE de s5_07: existe en `doctors`). Si la
-- invitación estaba vencida, revalida cupo antes de revivirla. Extiende
-- expires_at y resetea invited_at (es un reenvío). El UPDATE queda auditado
-- por trg_audit_clinic_invitations. Devuelve el nuevo expires_at.
CREATE OR REPLACE FUNCTION resend_invitation(p_invitation_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  inv RECORD;
  v_new_expires timestamptz;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO inv FROM clinic_invitations WHERE id = p_invitation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitación no encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Autorización: solo el titular de la clínica (mismo criterio que la RLS).
  IF NOT EXISTS (
    SELECT 1 FROM doctors d
     WHERE d.clinic_id = inv.clinic_id
       AND d.profile_id = current_user_id
  ) THEN
    RAISE EXCEPTION 'No autorizado para reenviar invitaciones de esta clínica.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Debe estar pendiente (ni aceptada ni cancelada).
  IF inv.accepted_at IS NOT NULL OR inv.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'La invitación ya fue aceptada o cancelada; no se puede reenviar.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Si está VENCIDA, revivirla vuelve a consumir cupo → revalidar (solo asistente).
  IF inv.expires_at <= now() AND inv.role = 'assistant' THEN
    IF team_seats_used(inv.clinic_id) >= team_seat_limit(inv.clinic_id) THEN
      RAISE EXCEPTION 'Tu plan incluye hasta % asistentes. Liberá un cupo antes de reenviar.',
        team_seat_limit(inv.clinic_id) USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_new_expires := now() + invitation_ttl();

  UPDATE clinic_invitations
     SET expires_at = v_new_expires,
         invited_at = now()
   WHERE id = p_invitation_id;

  RETURN v_new_expires;
END;
$$;

REVOKE ALL ON FUNCTION resend_invitation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION resend_invitation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION resend_invitation(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_36.mjs + node scripts/_smoke-s7_36.mjs
-- ───────────────────────────────────────────────────────────
