-- ═══════════════════════════════════════════════════════════
-- Migración S7-44: Administración de LucyAdmins — Fase 1
-- ═══════════════════════════════════════════════════════════
-- Diseño aprobado en docs/ANALISIS_ADMINISTRADORES_LUCY.md (Opción B,
-- D1–D6 + reglas vinculantes, owner 2026-06-11). Hoy el alta de un admin de
-- plataforma es SQL manual (s7_01). Esta migración agrega el ciclo de vida
-- operativo SIN tocar el modelo de autorización:
--
--   • `profiles.role='admin'` sigue siendo el ÚNICO bit de autorización.
--     is_admin() y las ~22 superficies RLS/RPC que lo consumen quedan
--     INTACTAS.
--   • Tabla `platform_admin_invitations` = registro de ciclo de vida
--     (pending → active → revoked) con trazabilidad completa.
--   • La invitación pending NO otorga ningún privilegio.
--   • La activación ocurre al PRIMER login/OTP del invitado (prueba de
--     posesión del teléfono). Sin admins dormant.
--   • Admin = CUENTA DEDICADA: se bloquea invitar teléfonos que ya
--     pertenezcan a paciente/médico/asistente (P0050). Excepción: cuentas
--     con historial en este registro (ex-admins revocados) son re-invitables
--     — sin esto la revocación sería irreversible sin SQL.
--   • Revocar baja el rol (→'patient') y bloquea el backend DE INMEDIATO
--     (is_admin() lee el rol). Guard server-side: imposible revocar al
--     ÚLTIMO admin activo (P0052). No se toca auth.users.
--   • TTL 14 días; re-invitar una vencida refresca la MISMA fila.
--   • Audit en cada transición (invite / reinvite / activate / revoke).
--
-- P-codes: P0050 cuenta existente no elegible (admin = cuenta dedicada) ·
--          P0051 ya es admin · P0052 último admin activo · P0053 ya hay
--          invitación vigente · P0054 objetivo no es admin · P0055 teléfono
--          inválido.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Registro de ciclo de vida ────────────────────────────
CREATE TABLE IF NOT EXISTS platform_admin_invitations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_normalized      text NOT NULL,
  display_name          text NOT NULL,
  email                 text,
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'active', 'revoked')),
  -- invited_by nullable: las filas creadas al revocar un admin BOOTSTRAP
  -- (creado por SQL en s7_01, sin invitación) no tienen invitador.
  invited_by            uuid REFERENCES profiles(id) ON DELETE SET NULL,
  invited_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL DEFAULT now() + interval '14 days',
  activated_at          timestamptz,
  activated_profile_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  revoked_by            uuid REFERENCES profiles(id) ON DELETE SET NULL,
  revoked_at            timestamptz
);

-- Una sola invitación pending por teléfono (vigente o vencida: la vencida se
-- refresca in-place al re-invitar, no se duplica).
CREATE UNIQUE INDEX IF NOT EXISTS platform_admin_invitations_pending_uniq
  ON platform_admin_invitations(phone_normalized) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS platform_admin_invitations_phone
  ON platform_admin_invitations(phone_normalized);

ALTER TABLE platform_admin_invitations ENABLE ROW LEVEL SECURITY;

-- Solo LucyAdmin lee el registro. Escritura SOLO vía RPCs definer (sin
-- policies de INSERT/UPDATE/DELETE).
DROP POLICY IF EXISTS "platform_admin_inv_admin_select" ON platform_admin_invitations;
CREATE POLICY "platform_admin_inv_admin_select" ON platform_admin_invitations
  FOR SELECT TO authenticated
  USING (is_admin());

-- ─── 2. RPC: invitar (o re-invitar una vencida) ──────────────
CREATE OR REPLACE FUNCTION admin_invite_platform_admin(
  p_phone        text,
  p_display_name text,
  p_email        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_phone      text := normalize_phone_sv(p_phone);
  v_name       text := btrim(coalesce(p_display_name, ''));
  v_email      text := nullif(btrim(lower(coalesce(p_email, ''))), '');
  v_user_id    uuid;
  v_role       text;
  v_has_history boolean;
  v_pending    platform_admin_invitations%ROWTYPE;
  v_id         uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  IF v_phone IS NULL OR v_phone !~ '^503[0-9]{8}$' THEN
    RAISE EXCEPTION 'Teléfono inválido. Esperamos 8 dígitos (SV) o formato 503XXXXXXXX.'
      USING ERRCODE = 'P0055';
  END IF;
  IF v_name = '' OR length(v_name) < 2 OR length(v_name) > 200 THEN
    RAISE EXCEPTION 'Nombre inválido. Debe tener entre 2 y 200 caracteres.'
      USING ERRCODE = 'P0055';
  END IF;
  IF v_email IS NOT NULL AND (position('@' IN v_email) < 2 OR position('.' IN v_email) = 0) THEN
    RAISE EXCEPTION 'El email no tiene formato válido.' USING ERRCODE = 'P0055';
  END IF;

  -- ── Admin = cuenta dedicada (regla vinculante Fase 1) ──
  SELECT u.id INTO v_user_id
  FROM auth.users u
  WHERE normalize_phone_sv(u.phone) = v_phone
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    SELECT p.role::text INTO v_role FROM profiles p WHERE p.id = v_user_id;

    -- auth.user sin profile = anomalía → revisión manual fuera del flujo.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Este teléfono pertenece a una cuenta existente. El administrador debe usar una cuenta dedicada (revisión manual).'
        USING ERRCODE = 'P0050';
    END IF;

    IF v_role = 'admin' THEN
      RAISE EXCEPTION 'Este teléfono ya pertenece a un administrador activo.'
        USING ERRCODE = 'P0051';
    END IF;

    -- Facetas clínicas → nunca elegible (médico/asistente/titular).
    IF EXISTS (SELECT 1 FROM doctors d WHERE d.profile_id = v_user_id)
       OR EXISTS (SELECT 1 FROM clinic_members cm WHERE cm.profile_id = v_user_id AND cm.is_active = true)
    THEN
      RAISE EXCEPTION 'Este teléfono pertenece a una cuenta de médico/asistente. El administrador debe usar una cuenta dedicada.'
        USING ERRCODE = 'P0050';
    END IF;

    -- Paciente REAL (con fichas clínicas vinculadas) → nunca elegible,
    -- tenga o no historial. "Cuenta dedicada" = sin vida de paciente.
    IF EXISTS (SELECT 1 FROM patients pa WHERE pa.profile_id = v_user_id) THEN
      RAISE EXCEPTION 'Este teléfono ya pertenece a una cuenta de paciente. El administrador debe usar una cuenta dedicada.'
        USING ERRCODE = 'P0050';
    END IF;

    -- Cuenta existente SIN historial en el registro = cuenta orgánica de
    -- paciente → bloquear (no se convierten cuentas en MVP). CON historial
    -- (incluye 'pending': una pending solo existe si un admin invitó ese
    -- teléfono a propósito — p. ej. el invitado entró con OTP con la
    -- invitación ya vencida y el login le creó la cuenta-cáscara; sin esto,
    -- ese teléfono quedaría bloqueado para siempre) → re-invitable.
    SELECT EXISTS (
      SELECT 1 FROM platform_admin_invitations r
      WHERE r.phone_normalized = v_phone
        AND r.status IN ('pending', 'active', 'revoked')
    ) INTO v_has_history;

    IF NOT v_has_history THEN
      RAISE EXCEPTION 'Este teléfono ya pertenece a una cuenta de paciente. El administrador debe usar una cuenta dedicada.'
        USING ERRCODE = 'P0050';
    END IF;
  END IF;

  -- ── Pending existente: vigente → error; vencida → refrescar la fila ──
  SELECT * INTO v_pending
  FROM platform_admin_invitations
  WHERE phone_normalized = v_phone AND status = 'pending'
  FOR UPDATE;

  IF FOUND THEN
    IF v_pending.expires_at > now() THEN
      RAISE EXCEPTION 'Ya existe una invitación vigente para este teléfono.'
        USING ERRCODE = 'P0053';
    END IF;

    UPDATE platform_admin_invitations
       SET display_name = v_name,
           email        = v_email,
           invited_by   = auth.uid(),
           invited_at   = now(),
           expires_at   = now() + interval '14 days'
     WHERE id = v_pending.id;

    INSERT INTO audit_log (user_id, action, table_name, record_id, new_data)
    VALUES (
      auth.uid(), 'update'::audit_action, 'platform_admin_invitations', v_pending.id,
      jsonb_build_object(
        'phone_norm', v_phone, 'display_name', v_name, 'email', v_email,
        'status', 'pending', 'edited_via', 'platform_admin_reinvite'
      )
    );

    RETURN jsonb_build_object('success', true, 'invitation_id', v_pending.id, 'reinvited', true);
  END IF;

  INSERT INTO platform_admin_invitations (phone_normalized, display_name, email, invited_by)
  VALUES (v_phone, v_name, v_email, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, new_data)
  VALUES (
    auth.uid(), 'insert'::audit_action, 'platform_admin_invitations', v_id,
    jsonb_build_object(
      'phone_norm', v_phone, 'display_name', v_name, 'email', v_email,
      'status', 'pending', 'edited_via', 'platform_admin_invite'
    )
  );

  RETURN jsonb_build_object('success', true, 'invitation_id', v_id, 'reinvited', false);
END;
$$;

REVOKE ALL ON FUNCTION admin_invite_platform_admin(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_invite_platform_admin(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION admin_invite_platform_admin(text, text, text) TO authenticated;

-- ─── 3. RPC: activar al primer login/OTP del invitado ───────
-- La llama el FRONTEND post-OTP (mismo enganche que accept_clinic_invitations),
-- fail-safe: si no hay invitación, devuelve activated=false sin error.
CREATE OR REPLACE FUNCTION accept_platform_admin_invitation()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_phone   text;
  v_role    text;
  v_inv     platform_admin_invitations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión primero' USING ERRCODE = '28000';
  END IF;

  -- Teléfono CONFIRMADO del caller (prueba de posesión vía OTP).
  SELECT normalize_phone_sv(u.phone) INTO v_phone
  FROM auth.users u
  WHERE u.id = v_user_id AND u.phone_confirmed_at IS NOT NULL;

  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('activated', false, 'reason', 'no_phone_confirmed');
  END IF;

  SELECT * INTO v_inv
  FROM platform_admin_invitations
  WHERE phone_normalized = v_phone
    AND status = 'pending'
    AND expires_at > now()          -- vencida = no activa (TTL)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('activated', false);
  END IF;

  SELECT p.role::text INTO v_role FROM profiles p WHERE p.id = v_user_id;
  IF NOT FOUND THEN
    -- Anomalía (auth sin profile): no activar; queda pending para revisión.
    RETURN jsonb_build_object('activated', false, 'reason', 'no_profile');
  END IF;

  IF v_role = 'admin' THEN
    -- Idempotente/heal: ya es admin → sellar la invitación como activa.
    UPDATE platform_admin_invitations
       SET status = 'active', activated_at = coalesce(activated_at, now()),
           activated_profile_id = v_user_id
     WHERE id = v_inv.id;
    RETURN jsonb_build_object('activated', true, 'already_admin', true);
  END IF;

  -- Defensa TOCTOU (regla "cuenta dedicada"): si entre la invitación y el
  -- login la cuenta adquirió faceta clínica O vida de paciente real (fichas
  -- vinculadas), NO se activa; queda pending para revisión manual.
  IF v_role <> 'patient'
     OR EXISTS (SELECT 1 FROM doctors d WHERE d.profile_id = v_user_id)
     OR EXISTS (SELECT 1 FROM clinic_members cm WHERE cm.profile_id = v_user_id AND cm.is_active = true)
     OR EXISTS (SELECT 1 FROM patients pa WHERE pa.profile_id = v_user_id)
  THEN
    RETURN jsonb_build_object('activated', false, 'reason', 'blocked_role');
  END IF;

  -- Promover + llenar el nombre visible desde la invitación SOLO si está
  -- vacío (handle_new_user crea profiles con full_name='' → sin esto, todo
  -- admin invitado nacería "Sin nombre" en /admin/administradores). No pisa
  -- un nombre real ya cargado.
  UPDATE profiles
     SET role = 'admin'::user_role,
         full_name = CASE WHEN coalesce(btrim(full_name), '') = ''
                          THEN v_inv.display_name ELSE full_name END,
         updated_at = now()
   WHERE id = v_user_id;

  UPDATE platform_admin_invitations
     SET status = 'active', activated_at = now(), activated_profile_id = v_user_id
   WHERE id = v_inv.id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_user_id, 'update'::audit_action, 'profiles', v_user_id,
    jsonb_build_object('role', v_role),
    jsonb_build_object(
      'role', 'admin', 'invitation_id', v_inv.id, 'invited_by', v_inv.invited_by,
      'display_name', v_inv.display_name,
      'edited_via', 'platform_admin_activate'
    )
  );

  RETURN jsonb_build_object('activated', true);
END;
$$;

REVOKE ALL ON FUNCTION accept_platform_admin_invitation() FROM PUBLIC;
REVOKE ALL ON FUNCTION accept_platform_admin_invitation() FROM anon;
GRANT EXECUTE ON FUNCTION accept_platform_admin_invitation() TO authenticated;

-- ─── 4. RPC: revocar admin ───────────────────────────────────
CREATE OR REPLACE FUNCTION admin_revoke_platform_admin(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role         text;
  v_admin_count  int;
  v_updated      int;
  v_phone        text;
  v_name         text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT p.role::text, normalize_phone_sv(p.phone), p.full_name
    INTO v_role, v_phone, v_name
  FROM profiles p
  WHERE p.id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'El usuario indicado no es un administrador activo.'
      USING ERRCODE = 'P0054';
  END IF;

  -- Guard del último admin activo: la plataforma nunca queda sin admin.
  SELECT count(*) INTO v_admin_count FROM profiles WHERE role = 'admin';
  IF v_admin_count <= 1 THEN
    RAISE EXCEPTION 'No se puede revocar al último administrador activo de la plataforma.'
      USING ERRCODE = 'P0052';
  END IF;

  -- Baja del rol → is_admin() bloquea el backend de inmediato. No se toca
  -- auth.users (Fase 1): la cuenta queda como usuario normal sin poderes.
  UPDATE profiles SET role = 'patient'::user_role, updated_at = now()
   WHERE id = p_profile_id;

  -- Trazar en el registro. Bootstrap admins (creados por SQL, sin fila) →
  -- se inserta una fila 'revoked' para que el historial quede completo.
  UPDATE platform_admin_invitations
     SET status = 'revoked', revoked_by = auth.uid(), revoked_at = now()
   WHERE activated_profile_id = p_profile_id AND status = 'active';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    INSERT INTO platform_admin_invitations (
      phone_normalized, display_name, status,
      invited_by, activated_at, activated_profile_id, revoked_by, revoked_at
    ) VALUES (
      coalesce(v_phone, ''), coalesce(nullif(v_name, ''), 'Admin (bootstrap)'), 'revoked',
      NULL, NULL, p_profile_id, auth.uid(), now()
    );
  END IF;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'update'::audit_action, 'profiles', p_profile_id,
    jsonb_build_object('role', 'admin'),
    jsonb_build_object('role', 'patient', 'edited_via', 'platform_admin_revoke')
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION admin_revoke_platform_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_revoke_platform_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION admin_revoke_platform_admin(uuid) TO authenticated;

-- ─── 5. RPC: listar admins + ciclo de vida ───────────────────
CREATE OR REPLACE FUNCTION admin_list_platform_admins()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admins jsonb;
  v_invitations jsonb;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  -- Admins ACTIVOS = fuente de verdad profiles.role='admin' (incluye
  -- bootstrap sin fila de registro), enriquecidos con el registro si existe.
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.full_name), '[]'::jsonb)
    INTO v_admins
  FROM (
    SELECT
      p.id          AS profile_id,
      p.full_name,
      p.phone,
      r.activated_at,
      ib.full_name  AS invited_by_name
    FROM profiles p
    LEFT JOIN platform_admin_invitations r
           ON r.activated_profile_id = p.id AND r.status = 'active'
    LEFT JOIN profiles ib ON ib.id = r.invited_by
    WHERE p.role = 'admin'
  ) t;

  -- Historial completo del registro (pendientes vigentes/vencidas, activas,
  -- revocadas). La UI deriva el agrupado.
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.invited_at DESC), '[]'::jsonb)
    INTO v_invitations
  FROM (
    SELECT
      r.id, r.phone_normalized, r.display_name, r.email, r.status,
      r.invited_at, r.expires_at,
      (r.status = 'pending' AND r.expires_at <= now()) AS expired,
      r.activated_at, r.revoked_at,
      ib.full_name AS invited_by_name,
      rb.full_name AS revoked_by_name
    FROM platform_admin_invitations r
    LEFT JOIN profiles ib ON ib.id = r.invited_by
    LEFT JOIN profiles rb ON rb.id = r.revoked_by
  ) t;

  RETURN jsonb_build_object('admins', v_admins, 'invitations', v_invitations);
END;
$$;

REVOKE ALL ON FUNCTION admin_list_platform_admins() FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_platform_admins() FROM anon;
GRANT EXECUTE ON FUNCTION admin_list_platform_admins() TO authenticated;

-- ───────────────────────────────────────────────────────────
-- Verificación: node scripts/check-s7_44.mjs + node scripts/_smoke-s7_44.mjs
-- ───────────────────────────────────────────────────────────
