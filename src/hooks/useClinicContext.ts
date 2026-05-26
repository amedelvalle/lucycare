/**
 * Hook unificado de contexto de panel para doctor y assistant.
 *
 * Devuelve clinic_id, doctor_id y rol independientemente de si el usuario es
 * un médico o una asistente. Permite que las páginas del panel funcionen
 * para ambos roles sin lógica duplicada.
 *
 * Multi-doctor (S5-07):
 *   - Una clínica puede tener varios doctores. Una asistente ve y opera sobre
 *     uno por vez ("doctor activo"). La selección persiste en localStorage.
 *   - `availableDoctors` lista todos los doctores de la clínica (solo asistente).
 *   - `useSwitchActiveDoctor()` cambia el doctor activo + invalida caches por-doctor.
 *
 * Creación de asistentes (S5-06): desde /panel/equipo → invitar por teléfono.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface DoctorOption {
  id: string;
  full_name: string;
}

export interface ClinicContext {
  profileId: string;
  role: 'doctor' | 'assistant';
  clinicId: string;
  doctorId: string;
  doctorName: string | null;
  doctorIsOperational: boolean;
  /**
   * `lucy_status` del doctor activo. Usado por `PanelLayout` para
   * distinguir "recién reclamado, esperando habilitación" (claimed +
   * !is_operational) de "suspendido por admin" (booking_enabled o
   * verified + !is_operational). `null` para asistente.
   */
  doctorLucyStatus: string | null;
  availableDoctors: DoctorOption[];
}

export const clinicContextKey = ['clinic-context'] as const;
const SELECTED_DOCTOR_KEY = 'lucycare_assistant_selected_doctor';

function getStoredDoctorId(): string | null {
  try {
    return localStorage.getItem(SELECTED_DOCTOR_KEY);
  } catch {
    return null;
  }
}

function setStoredDoctorId(doctorId: string): void {
  try {
    localStorage.setItem(SELECTED_DOCTOR_KEY, doctorId);
  } catch {
    // localStorage no disponible — la selección no persiste pero el flujo sigue
  }
}

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
      .select('id, clinic_id, is_operational, lucy_status, profiles!inner(full_name)')
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
      doctorIsOperational: doctorAny.is_operational !== false,
      doctorLucyStatus: doctorAny.lucy_status ?? null,
      availableDoctors: [],
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

    // Todos los doctores de la clínica, ordenados por antigüedad (estable)
    const { data: doctors, error: doctorsError } = await supabase
      .from('doctors')
      .select('id, profiles!inner(full_name)')
      .eq('clinic_id', member.clinic_id)
      .order('created_at', { ascending: true });

    if (doctorsError) throw doctorsError;
    if (!doctors || doctors.length === 0) {
      throw new Error('La clínica no tiene médicos asociados');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const availableDoctors: DoctorOption[] = (doctors as any[]).map((d) => ({
      id: d.id,
      full_name: d.profiles?.full_name ?? '—',
    }));

    // Doctor activo: el almacenado en localStorage si todavía existe en la clínica,
    // si no, el primero por created_at (fallback estable).
    const stored = getStoredDoctorId();
    const active =
      (stored && availableDoctors.find((d) => d.id === stored)) ?? availableDoctors[0];

    return {
      profileId: user.id,
      role: 'assistant',
      clinicId: member.clinic_id,
      doctorId: active.id,
      doctorName: active.full_name,
      doctorIsOperational: true, // asistente no se ve afectada en el panel
      doctorLucyStatus: null,
      availableDoctors,
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

/**
 * Cambia el doctor activo de una asistente. Persiste en localStorage e
 * invalida las queries dependientes del doctor activo (citas, calendario,
 * pacientes, dashboard) para que la UI refresque sin recargar la página.
 */
export function useSwitchActiveDoctor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (doctorId: string) => {
      setStoredDoctorId(doctorId);
      return doctorId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clinicContextKey });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['dashboard-today'] });
      qc.invalidateQueries({ queryKey: ['dashboard-upcoming'] });
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['availability'] });
      qc.invalidateQueries({ queryKey: ['doctor-calendar-hours'] });
    },
  });
}
