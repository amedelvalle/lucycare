import { supabase } from '@/lib/supabase';

// ─── Tipos ────────────────────────────────────────────────────────────

export interface TeamMember {
  member_id: string; // clinic_members.id
  profile_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: 'owner' | 'doctor' | 'assistant';
  is_active: boolean;
  joined_at: string;
}

export interface PendingInvitation {
  id: string;
  clinic_id: string;
  phone: string;
  display_name: string | null;
  role: 'owner' | 'doctor' | 'assistant';
  invited_at: string;
  expires_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Normaliza un teléfono al formato E.164 que usa Supabase Auth.
 * Quita espacios, guiones y paréntesis. Si no empieza con `+`, asume +503.
 */
export function normalizePhone(input: string): string {
  let phone = input.replace(/[\s\-()]/g, '');
  if (phone.length === 0) return '';
  if (!phone.startsWith('+')) {
    if (phone.startsWith('503')) phone = '+' + phone;
    else phone = '+503' + phone;
  }
  return phone;
}

export function isValidPhone(phone: string): boolean {
  return /^\+\d{10,15}$/.test(phone);
}

// ─── Funciones ────────────────────────────────────────────────────────

/**
 * Miembros del equipo (activos e inactivos) de una clínica.
 */
export async function getTeamMembers(clinicId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from('clinic_members')
    .select(`
      id,
      profile_id,
      role,
      is_active,
      joined_at,
      profile:profiles!inner(full_name, phone, email)
    `)
    .eq('clinic_id', clinicId)
    .order('is_active', { ascending: false })
    .order('joined_at', { ascending: true });

  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data as any[]) ?? []).map((m) => ({
    member_id: m.id,
    profile_id: m.profile_id,
    full_name: m.profile?.full_name ?? '—',
    phone: m.profile?.phone ?? null,
    email: m.profile?.email ?? null,
    role: m.role,
    is_active: m.is_active,
    joined_at: m.joined_at,
  }));
}

/**
 * Invitaciones pendientes (no aceptadas ni canceladas) de una clínica.
 */
export async function getPendingInvitations(clinicId: string): Promise<PendingInvitation[]> {
  const { data, error } = await supabase
    .from('clinic_invitations')
    .select('id, clinic_id, phone, display_name, role, invited_at, expires_at')
    .eq('clinic_id', clinicId)
    .is('accepted_at', null)
    .is('cancelled_at', null)
    .order('invited_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * Crea una invitación. Si ya existe una pendiente para mismo (clinic, phone),
 * lanza error.
 */
export async function inviteMember(
  clinicId: string,
  phone: string,
  displayName?: string,
  role: 'assistant' = 'assistant'
): Promise<PendingInvitation> {
  const normalized = normalizePhone(phone);
  if (!isValidPhone(normalized)) {
    throw new Error('Teléfono inválido. Formato esperado: +503XXXXXXXX');
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('clinic_invitations')
    .insert({
      clinic_id: clinicId,
      phone: normalized,
      display_name: displayName?.trim() || null,
      role,
      invited_by: user.id,
    })
    .select('id, clinic_id, phone, display_name, role, invited_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Ya existe una invitación pendiente para este teléfono');
    }
    // Límite de asientos alcanzado (trigger trg_enforce_team_seat_limit, s7_27)
    if (error.code === 'P0001') {
      throw new Error(error.message || 'Alcanzaste el máximo de asistentes de tu plan.');
    }
    throw error;
  }
  return data;
}

/**
 * Cancela una invitación pendiente (soft, marca cancelled_at).
 */
export async function cancelInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase
    .from('clinic_invitations')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', invitationId);
  if (error) throw error;
}

/**
 * Reenvía (extiende) una invitación pendiente vía RPC `resend_invitation`
 * (s7_36). Extiende `expires_at` 14 días sobre la MISMA fila. Si la invitación
 * estaba vencida, el backend revalida el cupo antes de revivirla (si no hay
 * cupo, lanza P0001). Devuelve el nuevo `expires_at`.
 */
export async function resendInvitation(invitationId: string): Promise<string> {
  const { data, error } = await supabase.rpc('resend_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) {
    if (error.code === 'P0001') {
      throw new Error(error.message || 'No se pudo reenviar la invitación.');
    }
    throw error;
  }
  return data as string;
}

/**
 * Toggle activo/inactivo de un miembro del equipo.
 * Soft-delete por trazabilidad — preserva el historial de quién atendió cuándo.
 */
export async function setMemberActive(memberId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('clinic_members')
    .update({ is_active: isActive })
    .eq('id', memberId);
  if (error) throw error;
}

/**
 * Llamado por el frontend tras verificar OTP — procesa cualquier invitación
 * pendiente que matchee el teléfono del usuario actual.
 *
 * Devuelve la cantidad de invitaciones aceptadas (puede ser 0 si no hay).
 */
export async function acceptPendingInvitations(phone: string): Promise<number> {
  const { data, error } = await supabase.rpc('accept_clinic_invitations', { user_phone: phone });
  if (error) throw error;
  return (data as number) ?? 0;
}
