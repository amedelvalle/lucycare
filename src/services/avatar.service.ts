/**
 * Servicio de foto de perfil del médico.
 *
 * Reglas:
 * - Storage path: `avatars/{userId}/avatar-{timestamp}.{ext}`.
 *   Cada subida genera un filename NUEVO; así la URL pública es
 *   literal y completamente nueva y ningún CDN/browser puede
 *   servir la versión anterior cacheada. Es más robusto que el
 *   cache-buster por query string (`?v=`), que algunos CDNs y
 *   proxies corporativos ignoran.
 *   Después de subir el nuevo, borramos el anterior para mantener
 *   un solo archivo por usuario y no acumular basura.
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

/** Lista todos los archivos de avatar del usuario en su carpeta. */
async function listExistingAvatars(profileId: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).list(profileId, { limit: 50 });
  if (error || !data) return [];
  return data.filter((f) => !!f.name).map((f) => `${profileId}/${f.name}`);
}

/** Borra los paths indicados (best-effort, no propaga errores). */
async function removeFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await supabase.storage
    .from(AVATAR_BUCKET)
    .remove(paths)
    .catch(() => undefined);
}

function buildAvatarPath(profileId: string, ext: string): string {
  return `${profileId}/avatar-${Date.now()}.${ext}`;
}

/**
 * Self-service: el médico sube/cambia su propia foto.
 * El path es `{auth.uid()}/avatar-{timestamp}.<ext>`; la RLS lo enforcea.
 * Tras subir el nuevo, borra los archivos anteriores del mismo dueño.
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
  const newPath = buildAvatarPath(userId, ext);

  try {
    // Listamos archivos existentes ANTES de subir el nuevo, para no borrar
    // el flamante en la limpieza posterior.
    const previous = await listExistingAvatars(userId);

    const { error: upErr } = await supabase.storage.from(AVATAR_BUCKET).upload(newPath, file, {
      contentType: file.type,
      upsert: false,            // path único por timestamp; no debería existir
      cacheControl: '3600',     // un archivo nuevo cada vez = podemos cachear
    });
    if (upErr) {
      return { success: false, errorCode: 'UPLOAD_FAILED', errorMessage: upErr.message };
    }

    const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(newPath);
    const url = pub.publicUrl;

    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ avatar_url: url, updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (profileErr) {
      // Si falla el update del profile, intentamos limpiar el archivo nuevo
      // para no dejar storage huérfano apuntando a un avatar nunca expuesto.
      await removeFiles([newPath]);
      return { success: false, errorCode: 'UPDATE_FAILED', errorMessage: profileErr.message };
    }

    // Limpieza: borrar los archivos anteriores del usuario
    // (todo lo que listamos antes; el nuevo no estaba en esa lista).
    await removeFiles(previous);

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

  const existing = await listExistingAvatars(userId);
  await removeFiles(existing);

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
  const newPath = buildAvatarPath(doctorProfileId, ext);

  try {
    const previous = await listExistingAvatars(doctorProfileId);

    const { error: upErr } = await supabase.storage.from(AVATAR_BUCKET).upload(newPath, file, {
      contentType: file.type,
      upsert: false,
      cacheControl: '3600',
    });
    if (upErr) {
      return { success: false, errorCode: 'UPLOAD_FAILED', errorMessage: upErr.message };
    }

    const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(newPath);
    const url = pub.publicUrl;

    const { error: rpcErr } = await supabase.rpc('admin_update_doctor_avatar', {
      p_doctor_id: doctorId,
      p_avatar_url: url,
    });
    if (rpcErr) {
      await removeFiles([newPath]);
      return { success: false, errorCode: 'UPDATE_FAILED', errorMessage: rpcErr.message };
    }

    await removeFiles(previous);

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
  const existing = await listExistingAvatars(doctorProfileId);
  await removeFiles(existing);

  const { error } = await supabase.rpc('admin_update_doctor_avatar', {
    p_doctor_id: doctorId,
    p_avatar_url: null,
  });
  if (error) {
    return { success: false, errorCode: 'UPDATE_FAILED', errorMessage: error.message };
  }
  return { success: true, avatarUrl: null };
}
