-- ═══════════════════════════════════════════════════════════
-- Migración S7-50: aceptar invitación tolerante a formato de teléfono
-- ═══════════════════════════════════════════════════════════
-- BUG OPERATIVO ACTIVO de onboarding del asistente (confirmado por paso 0
-- read-only contra la DB, 2026-06-18):
--
--   • `clinic_invitations.phone` se guarda como `+503XXXXXXXX` (E.164 con `+`)
--     — lo produce `inviteMember` con su helper local `normalizePhone`.
--   • `profiles.phone` se guarda mayoritariamente como `503XXXXXXXX` (solo
--     dígitos, sin `+`) — 116/128 cuentas muestreadas, incluidas las 3 de prueba.
--   • `LoginModal`/`verifyOtp` pasan `user_phone = +503XXXXXXXX` (con `+`).
--   • `accept_clinic_invitations` (s7_36) comparaba LITERAL `phone = user_phone`
--     en el gate y en el loop.
--
-- Resultado: el GATE `profiles.phone (503X) = user_phone (+503X)` FALLA y la RPC
-- lanza "El teléfono no coincide…". En el login normal ese error queda
-- SILENCIADO (el frontend solo lee `data` e ignora `error`) → la invitación NO
-- se acepta y el asistente entra como `patient` sin membresía de clínica.
--
-- El smoke previo (s7_36) no lo detectó porque usaba `profiles.phone` VERBATIM
-- para insertar la invitación y para el `user_phone` del accept (mismo formato
-- en ambos lados) → esquivó el mismatch real.
--
-- FIX (mínimo, quirúrgico): normalizar AMBOS lados de las DOS comparaciones de
-- teléfono con `normalize_phone_sv` (helper IMMUTABLE de s7_40, espejo de
-- src/lib/phone.ts::normalizePhoneSV). Así `+503XXXXXXXX`, `503XXXXXXXX`,
-- `+503 7123-4567`, etc., colapsan al mismo valor canónico, sin importar cómo
-- esté guardada cada fila ni en qué formato llegue `user_phone`.
--
-- INVARIANTES (NO cambian respecto a s7_36):
--   • Firma idéntica: accept_clinic_invitations(user_phone text) → integer
--     → preserva GRANTs y NO cambia database.types.ts.
--   • Misma lógica de cupos (team_seat_limit / revalidación de asistente / CONTINUE).
--   • Mismo INSERT ... ON CONFLICT DO NOTHING en clinic_members.
--   • Mismo UPDATE profiles.role patient → assistant (sin tocar esa línea).
--   • Mismo manejo de accepted_at. Mismos errores existentes.
--
-- ALCANCE: solo se reemplazan las 2 comparaciones de teléfono. No toca
-- profiles/auth.users/identidad global, formato de almacenamiento (sin backfill),
-- triggers de cupo, resend_invitation, ni UI. Radio de impacto: 0 invitaciones
-- pendientes vigentes en prod hoy → solo afecta aceptaciones futuras.
-- ═══════════════════════════════════════════════════════════

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

  -- Gate: el teléfono debe coincidir con el del profile del usuario actual.
  -- s7_50: comparación normalizada (tolera +503… vs 503… vs separadores).
  IF NOT EXISTS (
    SELECT 1 FROM profiles
     WHERE id = current_user_id
       AND normalize_phone_sv(phone) = normalize_phone_sv(user_phone)
  ) THEN
    RAISE EXCEPTION 'El teléfono no coincide con la cuenta autenticada';
  END IF;

  FOR invitation IN
    SELECT * FROM clinic_invitations
    WHERE normalize_phone_sv(phone) = normalize_phone_sv(user_phone)  -- s7_50: normalizado
      AND accepted_at IS NULL
      AND cancelled_at IS NULL
      AND expires_at > now()          -- ← no aceptar vencidas (s7_36)
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

-- Firma idéntica → CREATE OR REPLACE preserva privilegios; reafirmamos por las dudas.
GRANT EXECUTE ON FUNCTION accept_clinic_invitations(text) TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_50.mjs + node scripts/_smoke-s7_50.mjs
-- ───────────────────────────────────────────────────────────
