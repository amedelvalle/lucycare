/**
 * Administración de LucyAdmins — Fase 1 (s7_44).
 *
 * Ciclo de vida de administradores de plataforma SIN SQL manual:
 * invitar → activar (al primer OTP login del invitado) → revocar, con
 * registro `platform_admin_invitations` + audit. `profiles.role='admin'`
 * sigue siendo el único bit de autorización (is_admin() intacto).
 *
 * Reglas vinculantes (docs/ANALISIS_ADMINISTRADORES_LUCY.md):
 *  - Admin = cuenta dedicada (teléfonos de paciente/médico/asistente → P0050).
 *  - La invitación pending no otorga ningún privilegio.
 *  - Revocar baja el rol y el backend bloquea de inmediato; guard de último
 *    admin activo (P0052).
 */

import { supabase } from '@/lib/supabase'

export interface PlatformAdmin {
  profileId: string
  fullName: string | null
  phone: string | null
  activatedAt: string | null      // null = admin bootstrap (creado por SQL)
  invitedByName: string | null
}

export type AdminInvitationStatus = 'pending' | 'active' | 'revoked'

export interface PlatformAdminInvitation {
  id: string
  phoneNormalized: string
  displayName: string
  email: string | null
  status: AdminInvitationStatus
  invitedAt: string
  expiresAt: string
  expired: boolean                // derivado server-side (pending vencida)
  activatedAt: string | null
  revokedAt: string | null
  invitedByName: string | null
  revokedByName: string | null
}

export interface PlatformAdminsList {
  admins: PlatformAdmin[]
  invitations: PlatformAdminInvitation[]
}

const ERROR_COPY: Record<string, string> = {
  P0050: 'Ese teléfono ya pertenece a una cuenta existente (paciente, médico o asistente). El administrador debe usar una cuenta dedicada.',
  P0051: 'Ese teléfono ya pertenece a un administrador activo.',
  P0052: 'No se puede revocar al último administrador activo de la plataforma.',
  P0053: 'Ya existe una invitación vigente para ese teléfono.',
  P0054: 'El usuario indicado no es un administrador activo.',
  P0055: 'Datos inválidos. Revisá el teléfono (8 dígitos SV), el nombre y el email.',
}

function mapError(err: { code?: string; message?: string } | null): Error {
  const friendly = err?.code ? ERROR_COPY[err.code] : undefined
  return new Error(friendly ?? 'No se pudo completar la operación. Intentá de nuevo.')
}

export async function listPlatformAdmins(): Promise<PlatformAdminsList> {
  const { data, error } = await supabase.rpc('admin_list_platform_admins')
  if (error) throw mapError(error)
  const r = (data ?? {}) as {
    admins?: Array<Record<string, unknown>>
    invitations?: Array<Record<string, unknown>>
  }
  return {
    admins: (r.admins ?? []).map((a) => ({
      profileId: a.profile_id as string,
      fullName: (a.full_name as string | null) ?? null,
      phone: (a.phone as string | null) ?? null,
      activatedAt: (a.activated_at as string | null) ?? null,
      invitedByName: (a.invited_by_name as string | null) ?? null,
    })),
    invitations: (r.invitations ?? []).map((i) => ({
      id: i.id as string,
      phoneNormalized: i.phone_normalized as string,
      displayName: i.display_name as string,
      email: (i.email as string | null) ?? null,
      status: i.status as AdminInvitationStatus,
      invitedAt: i.invited_at as string,
      expiresAt: i.expires_at as string,
      expired: !!i.expired,
      activatedAt: (i.activated_at as string | null) ?? null,
      revokedAt: (i.revoked_at as string | null) ?? null,
      invitedByName: (i.invited_by_name as string | null) ?? null,
      revokedByName: (i.revoked_by_name as string | null) ?? null,
    })),
  }
}

export async function invitePlatformAdmin(input: {
  phone: string
  displayName: string
  email?: string | null
}): Promise<{ invitationId: string; reinvited: boolean }> {
  const { data, error } = await supabase.rpc('admin_invite_platform_admin', {
    p_phone: input.phone,
    p_display_name: input.displayName,
    p_email: input.email?.trim() || undefined,
  })
  if (error) throw mapError(error)
  const r = data as { invitation_id: string; reinvited?: boolean }
  return { invitationId: r.invitation_id, reinvited: !!r.reinvited }
}

/**
 * Edita SOLO el nombre visible del PROPIO admin (self-update de
 * `profiles.full_name`). No toca teléfono/email/role/auth. Usa el camino ya
 * permitido por RLS (s7_32: cada usuario edita su propio full_name) y queda
 * auditado por el trigger de identidad de profiles con el uid del caller.
 * Pensado para el caso "admin bootstrap sin nombre" en /admin/administradores.
 */
export async function updateMyAdminName(fullName: string): Promise<void> {
  const name = fullName.trim()
  if (name.length < 2 || name.length > 200) {
    throw new Error('El nombre debe tener entre 2 y 200 caracteres.')
  }
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id
  if (!uid) throw new Error('Sesión no válida. Refrescá la página.')

  const { data, error } = await supabase
    .from('profiles')
    .update({ full_name: name })
    .eq('id', uid)
    .select('id')
  if (error || !data || data.length === 0) {
    throw new Error('No se pudo guardar el nombre. Intentá de nuevo.')
  }
}

export async function revokePlatformAdmin(profileId: string): Promise<void> {
  const { data, error } = await supabase.rpc('admin_revoke_platform_admin', {
    p_profile_id: profileId,
  })
  if (error) throw mapError(error)
  const r = data as { success?: boolean }
  if (!r?.success) throw new Error('No se pudo revocar. Intentá de nuevo.')
}
