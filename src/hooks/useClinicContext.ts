/**
 * Hook unificado de contexto de panel para doctor y assistant.
 *
 * Devuelve clinic_id, doctor_id y rol independientemente de si el usuario es
 * un médico o una asistente. Permite que las páginas del panel funcionen
 * para ambos roles sin lógica duplicada.
 *
 * NOTA SOBRE CREACIÓN DE ASISTENTES:
 * Por ahora, agregar una asistente requiere SQL manual:
 *   1. La asistente se registra como paciente normal (OTP)
 *   2. UPDATE profiles SET role='assistant' WHERE phone='...';
 *   3. INSERT INTO clinic_members (clinic_id, profile_id, role, is_active)
 *      VALUES ('<clinic-uuid>', '<profile-uuid>', 'assistant', true);
 * El UI para invitaciones queda para Sprint 4.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ClinicContext {
  profileId: string;
  role: 'doctor' | 'assistant';
  clinicId: string;
  doctorId: string;
  doctorName: string | null;
}

export const clinicContextKey = ['clinic-context'] as const;

async function loadClinicContext(): Promise<ClinicContext> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('No autenticado');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError) throw profileError;
  if (!profile) throw new Error('Profile no encontrado');

  // ─── Doctor ─────────────────────────────────────────────────────
  if (profile.role === 'doctor') {
    const { data: doctor, error } = await supabase
      .from('doctors')
      .select('id, clinic_id, profiles!inner(full_name)')
      .eq('profile_id', user.id)
      .single();

    if (error) throw error;
    if (!doctor) throw new Error('Doctor no encontrado');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doctorAny = doctor as any;
    return {
      profileId: user.id,
      role: 'doctor',
      clinicId: doctor.clinic_id,
      doctorId: doctor.id,
      doctorName: doctorAny.profiles?.full_name ?? null,
    };
  }

  // ─── Asistente ──────────────────────────────────────────────────
  if (profile.role === 'assistant') {
    const { data: member, error: memberError } = await supabase
      .from('clinic_members')
      .select('clinic_id')
      .eq('profile_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (memberError) throw memberError;
    if (!member) throw new Error('No estás asociada a ninguna clínica');

    // Doctor primario de la clínica (MVP: el primero — selector multi-doctor en Sprint 4)
    const { data: doctor, error: doctorError } = await supabase
      .from('doctors')
      .select('id, profiles!inner(full_name)')
      .eq('clinic_id', member.clinic_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (doctorError) throw doctorError;
    if (!doctor) throw new Error('La clínica no tiene médicos asociados');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doctorAny = doctor as any;
    return {
      profileId: user.id,
      role: 'assistant',
      clinicId: member.clinic_id,
      doctorId: doctor.id,
      doctorName: doctorAny.profiles?.full_name ?? null,
    };
  }

  throw new Error(`Rol no autorizado para el panel: ${profile.role}`);
}

export function useClinicContext() {
  return useQuery({
    queryKey: clinicContextKey,
    queryFn: loadClinicContext,
    staleTime: 1000 * 60 * 10, // 10 min — cambia muy poco
    retry: 1,
  });
}
