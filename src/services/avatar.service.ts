/**
 * Servicio de foto de perfil del médico.
 *
 * Reglas:
 * - Storage path: `avatars/{userId}/avatar.{ext}` (overwrite vía upsert).
 * - Self-service (médico): sube a su propio path, update profiles.avatar_url.
 * - Admin: llama RPC admin_update_doctor_avatar que valida is_admin() y audita.
 * - El bucket es público; usamos public URL (sin signed URL).
 * - Validamos tipo (jpeg/png/webp) y tamaño (≤5MB) en el cliente. La
 *   policy de storage también lo enforcea server-side.
 */

import { supabase } from '../lib/supabase';

export const AVATAR_BUCKET = 'avatars';
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AvatarUploadError =
  | 'NO_SESSION'
  | 'INVALID_TYPE'
  | 'TOO_LARGE'
  | 'UPLOAD_FAILED'
  | 'UPDATE_FAILED'
  | 'UNKNOWN';

export interface AvatarUploadResult {
  success: boolean;
  avatarUrl?: string | null;
  errorCode?: AvatarUploadError;
  errorMessage?: string;
}

function extFromType(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

function validateFile(file: File): AvatarUploadError | null {
  if (!AVATAR_ALLOWED_MIME.includes(file.type as (typeof AVATAR_ALLOWED_MIME)[number])) {
    return 'INVALID_TYPE';
  }
  if (file.size > AVATAR_MAX_BYTES) return 'TOO_LARGE';
  return null;
}

/**
 * Self-service: el médico sube/cambia su propia foto.
 * El path es `{auth.uid()}/avatar.<ext>`; la RLS lo enforcea.
 */
export async function uploadMyAvatar(file: File): Promise<AvatarUploadResult> {
  const invalid = validateFile(file);
  if (invalid) {
    return {
      success: false,
      errorCode: invalid,
      errorMessage:
        invalid === 'INVALID_TYPE'
          ? 'Formato no permitido. Usá JPG, PNG o WEBP.'
          : 'La imagen supera los 5 MB. Reducila e intentá de nuevo.',
    };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return { success: false, errorCode: 'NO_SESSION', errorMessage: 'Sesión no encontrada' };
  }
  const userId = session.user.id;
  const ext = extFromType(file.type);
  const path = `${userId}/avatar.${ext}`;

  try {
    const { error: upErr } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: true,
      cacheControl: '60',
    });
    if (upErr) {
      return { success: false, errorCode: 'UPLOAD_FAILED', errorMessage: upErr.message };
    }

    // Si existían avatares con OTRA extensión, los borramos para no dejar huérfanos.
    const others = (['jpg', 'png', 'webp'] as const).filter((e) => e !== ext);
    await Promise.all(
      others.map((e) =>
        supabase.storage
          .from(AVATAR_BUCKET)
          .remove([`${userId}/avatar.${e}`])
          .catch(() => undefined),
      ),
    );

    const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    // Cache-buster para que el browser no muestre la versión anterior.
    const url = `${pub.publicUrl}?v=${Date.now()}`;

    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ avatar_url: url, updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (profileErr) {
      return { success: false, errorCode: 'UPDATE_FAILED', errorMessage: profileErr.message };
    }

    return { success: true, avatarUrl: url };
  } catch (err) {
    return {
      success: false,
      errorCode: 'UNKNOWN',
      errorMessage: err instanceof Error ? err.message : 'Error inesperado',
    };
  }
}

/**
 * Self-service: el médico quita su propia foto.
 */
export async function removeMyAvatar(): Promise<AvatarUploadResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return { success: false, errorCode: 'NO_SESSION', errorMessage: 'Sesión no encontrada' };
  }
  const userId = session.user.id;

  // Borra los 3 posibles paths
  await Promise.all(
    (['jpg', 'png', 'webp'] as const).map((e) =>
      supabase.storage
        .from(AVATAR_BUCKET)
        .remove([`${userId}/avatar.${e}`])
        .catch(() => undefined),
    ),
  );

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: null, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) {
    return { success: false, errorCode: 'UPDATE_FAILED', errorMessage: error.message };
  }
  return { success: true, avatarUrl: null };
}

/**
 * Admin: sube/cambia la foto de un médico cualquiera.
 * Storage policy permite a admins escribir en cualquier carpeta.
 * El update de profiles.avatar_url se hace vía RPC admin para audit.
 */
export async function uploadDoctorAvatarAsAdmin(
  doctorId: string,
  doctorProfileId: string,
  file: File,
): Promise<AvatarUploadResult> {
  const invalid = validateFile(file);
  if (invalid) {
    return {
      success: false,
      errorCode: invalid,
      errorMessage:
        invalid === 'INVALID_TYPE'
          ? 'Formato no permitido. Usá JPG, PNG o WEBP.'
          : 'La imagen supera los 5 MB. Reducila e intentá de nuevo.',
    };
  }

  const ext = extFromType(file.type);
  const path = `${doctorProfileId}/avatar.${ext}`;

  try {
    const { error: upErr } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: true,
      cacheControl: '60',
    });
    if (upErr) {
      return { success: false, errorCode: 'UPLOAD_FAILED', errorMessage: upErr.message };
    }

    const others = (['jpg', 'png', 'webp'] as const).filter((e) => e !== ext);
    await Promise.all(
      others.map((e) =>
        supabase.storage
          .from(AVATAR_BUCKET)
          .remove([`${doctorProfileId}/avatar.${e}`])
          .catch(() => undefined),
      ),
    );

    const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    const url = `${pub.publicUrl}?v=${Date.now()}`;

    const { error: rpcErr } = await supabase.rpc('admin_update_doctor_avatar', {
      p_doctor_id: doctorId,
      p_avatar_url: url,
    });
    if (rpcErr) {
      return { success: false, errorCode: 'UPDATE_FAILED', errorMessage: rpcErr.message };
    }
    return { success: true, avatarUrl: url };
  } catch (err) {
    return {
      success: false,
      errorCode: 'UNKNOWN',
      errorMessage: err instanceof Error ? err.message : 'Error inesperado',
    };
  }
}

export async function removeDoctorAvatarAsAdmin(
  doctorId: string,
  doctorProfileId: string,
): Promise<AvatarUploadResult> {
  await Promise.all(
    (['jpg', 'png', 'webp'] as const).map((e) =>
      supabase.storage
        .from(AVATAR_BUCKET)
        .remove([`${doctorProfileId}/avatar.${e}`])
        .catch(() => undefined),
    ),
  );

  const { error } = await supabase.rpc('admin_update_doctor_avatar', {
    p_doctor_id: doctorId,
    p_avatar_url: null,
  });
  if (error) {
    return { success: false, errorCode: 'UPDATE_FAILED', errorMessage: error.message };
  }
  return { success: true, avatarUrl: null };
}
