-- ═══════════════════════════════════════════════════════════
-- Migración S7-14: Foto de perfil del médico (Fase 3)
-- ═══════════════════════════════════════════════════════════
-- 1. Bucket `avatars` (público, max 5MB, tipos imagen).
-- 2. Storage RLS:
--    - SELECT: público (anon + authenticated).
--    - INSERT/UPDATE/DELETE: el dueño en su propia carpeta {auth.uid()}/
--      o un admin de plataforma en cualquier carpeta.
-- 3. RPC admin_update_doctor_avatar(doctor_id, avatar_url) que cambia
--    profiles.avatar_url del médico + audit_log. La RPC se usa cuando
--    el admin sube/quita foto desde /admin/medicos/:id. Para el caso
--    self-service (médico desde /panel/perfil) basta con update directo
--    a profiles + un INSERT audit_log desde el cliente (igual que el
--    resto de updates self-service del perfil).
-- 4. Trigger audit_profiles_avatar: cualquier cambio de avatar_url
--    (sea self-service o vía admin) deja entrada en audit_log. Esto
--    captura también casos donde olvidamos auditar desde el frontend.
--
-- IMPORTANTE: el bucket es público para que el directorio público
-- pueda mostrar el avatar sin requerir signed URLs (perf + simplicidad).
-- La URL es predecible ({userId}/avatar.<ext>) pero solo se sube
-- a través de las policies, así que no hay leakage.
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Bucket ──────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5 * 1024 * 1024,                                          -- 5 MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── 2. Storage RLS policies ────────────────────────────────
-- Drop primero para que la migración sea re-aplicable
DROP POLICY IF EXISTS "avatars_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_write"   ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_update"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_delete"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_admin_write"   ON storage.objects;
DROP POLICY IF EXISTS "avatars_admin_update"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_admin_delete"  ON storage.objects;

-- Lectura pública (cualquiera, sin auth)
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');

-- INSERT: el dueño en su propia carpeta {auth.uid()}/...
CREATE POLICY "avatars_owner_write" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE: el dueño en su propia carpeta
CREATE POLICY "avatars_owner_update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: el dueño en su propia carpeta
CREATE POLICY "avatars_owner_delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admin de plataforma puede escribir/actualizar/eliminar en cualquier carpeta
CREATE POLICY "avatars_admin_write" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND is_admin());

CREATE POLICY "avatars_admin_update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND is_admin())
  WITH CHECK (bucket_id = 'avatars' AND is_admin());

CREATE POLICY "avatars_admin_delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'avatars' AND is_admin());

-- ─── 3. RPC admin_update_doctor_avatar ──────────────────────
-- Actualiza profiles.avatar_url del médico (NULL para quitar foto)
-- + audit_log con edited_via='admin'.
CREATE OR REPLACE FUNCTION admin_update_doctor_avatar(
  p_doctor_id  uuid,
  p_avatar_url text                            -- pasar NULL para quitar
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_old        text;
  v_new        text := nullif(btrim(coalesce(p_avatar_url, '')), '');
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;

  SELECT d.profile_id INTO v_profile_id FROM doctors d WHERE d.id = p_doctor_id;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'Médico no encontrado'; END IF;

  SELECT avatar_url INTO v_old FROM profiles WHERE id = v_profile_id;

  UPDATE profiles
    SET avatar_url = v_new,
        updated_at = now()
  WHERE id = v_profile_id;

  INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(),
    'update'::audit_action,
    'profiles',
    v_profile_id,
    jsonb_build_object('avatar_url', v_old),
    jsonb_build_object('avatar_url', v_new, 'edited_via', 'admin', 'field', 'avatar_url')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_doctor_avatar(uuid, text) TO authenticated;

-- ─── 4. Trigger audit_profiles_avatar ───────────────────────
-- Captura cualquier cambio de avatar_url, sea self-service o vía
-- admin RPC. Si la RPC admin ya escribió un audit explícito, este
-- trigger agrega otra fila (redundante pero útil para detectar
-- updates directos que olvidaron auditar). Marcado con
-- edited_via='trigger' para distinguir.
CREATE OR REPLACE FUNCTION audit_profiles_avatar_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.avatar_url IS DISTINCT FROM NEW.avatar_url THEN
    INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      auth.uid(),
      'update'::audit_action,
      'profiles',
      NEW.id,
      jsonb_build_object('avatar_url', OLD.avatar_url),
      jsonb_build_object('avatar_url', NEW.avatar_url, 'field', 'avatar_url', 'edited_via', 'trigger')
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_profiles_avatar ON profiles;
CREATE TRIGGER audit_profiles_avatar
  AFTER UPDATE OF avatar_url ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION audit_profiles_avatar_fn();

-- ─── 5. Extender admin_get_doctor_detail para devolver avatar_url ─
-- Misma firma que en s7_05 + columna avatar_url. CREATE OR REPLACE
-- permite redefinirla agregando una columna al RETURNS TABLE.
DROP FUNCTION IF EXISTS admin_get_doctor_detail(uuid);
CREATE FUNCTION admin_get_doctor_detail(p_doctor_id uuid)
RETURNS TABLE (
  doctor_id        uuid,
  profile_id       uuid,
  clinic_id        uuid,
  full_name        text,
  email            text,
  phone            text,
  avatar_url       text,
  specialty_id     uuid,
  specialty_name   text,
  bio              text,
  clinic_name      text,
  clinic_address   text,
  clinic_phone     text,
  is_published     boolean,
  is_operational   boolean,
  lucy_status      lucy_status
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  RETURN QUERY
  SELECT
    d.id, d.profile_id, d.clinic_id,
    p.full_name, p.email, p.phone, p.avatar_url,
    d.specialty_id, s.name AS specialty_name,
    d.bio,
    c.name AS clinic_name, c.address_line AS clinic_address, c.phone AS clinic_phone,
    d.is_published, d.is_operational, d.lucy_status
  FROM doctors d
  LEFT JOIN profiles    p ON p.id = d.profile_id
  LEFT JOIN specialties s ON s.id = d.specialty_id
  LEFT JOIN clinics     c ON c.id = d.clinic_id
  WHERE d.id = p_doctor_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_doctor_detail(uuid) TO authenticated;
