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

/**
 * Clasificación del fallo al cargar el contexto de panel. Permite que la UI
 * distinga errores **transitorios** (vale la pena Reintentar) de errores
 * **estructurales** (Reintentar no resuelve nada — el usuario debe contactar
 * soporte o cerrar sesión).
 *
 * - `auth`      → no hay sesión válida (transitorio en cold load).
 * - `unknown`   → error de red/DB inesperado (transitorio).
 * - `no_clinic` → el usuario no está asociado a una clínica activa (estructural).
 * - `no_doctor` → no hay un perfil/médico activo asociado (estructural).
 * - `role`      → el rol no tiene acceso al panel (estructural).
 */
export type ClinicContextErrorKind =
  | 'auth'
  | 'no_clinic'
  | 'no_doctor'
  | 'role'
  | 'unknown';

const STRUCTURAL_KINDS: ReadonlySet<ClinicContextErrorKind> = new Set([
  'no_clinic',
  'no_doctor',
  'role',
]);

export class ClinicContextError extends Error {
  readonly kind: ClinicContextErrorKind;
  constructor(kind: ClinicContextErrorKind, message: string) {
    super(message);
    this.name = 'ClinicContextError';
    this.kind = kind;
  }
}

/** True si el error es estructural (Reintentar no ayuda). */
export function isStructuralContextError(err: unknown): boolean {
  return err instanceof ClinicContextError && STRUCTURAL_KINDS.has(err.kind);
}

/** Devuelve el `kind` del error, o `'unknown'` si no es un ClinicContextError. */
export function contextErrorKind(err: unknown): ClinicContextErrorKind {
  return err instanceof ClinicContextError ? err.kind : 'unknown';
}

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
  // F1: leer la identidad desde la sesión local hidratada (getSession),
  // NO desde getUser() (validación de red). getUser corría en paralelo con
  // el refresh del token en cold load → fallaba transitoriamente y mandaba
  // a la tarjeta de error aunque la sesión fuera válida. getSession usa la
  // misma primitiva que getCurrentAuthUser, eliminando el race. La RLS
  // sigue siendo la defensa server-side real (los selects de abajo van
  // firmados con el access token de la sesión).
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new ClinicContextError('auth', 'No autenticado');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError) throw new ClinicContextError('unknown', profileError.message);
  if (!profile) throw new ClinicContextError('unknown', 'Profile no encontrado');

  // ─── Doctor ─────────────────────────────────────────────────────
  if (profile.role === 'doctor') {
    const { data: doctor, error } = await supabase
      .from('doctors')
      .select('id, clinic_id, is_operational, lucy_status, profiles!inner(full_name)')
      .eq('profile_id', user.id)
      .maybeSingle();

    if (error) throw new ClinicContextError('unknown', error.message);
    if (!doctor) throw new ClinicContextError('no_doctor', 'Doctor no encontrado');

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

    if (memberError) throw new ClinicContextError('unknown', memberError.message);
    if (!member) throw new ClinicContextError('no_clinic', 'No estás asociada a ninguna clínica');

    // Todos los doctores de la clínica, ordenados por antigüedad (estable)
    const { data: doctors, error: doctorsError } = await supabase
      .from('doctors')
      .select('id, profiles!inner(full_name)')
      .eq('clinic_id', member.clinic_id)
      .order('created_at', { ascending: true });

    if (doctorsError) throw new ClinicContextError('unknown', doctorsError.message);
    if (!doctors || doctors.length === 0) {
      throw new ClinicContextError('no_doctor', 'La clínica no tiene médicos asociados');
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

  throw new ClinicContextError('role', `Rol no autorizado para el panel: ${profile.role}`);
}

export function useClinicContext() {
  return useQuery({
    queryKey: clinicContextKey,
    queryFn: loadClinicContext,
    staleTime: 1000 * 60 * 10, // 10 min — cambia muy poco
    // F1/F3: reintentar solo errores transitorios (auth/unknown). Los
    // estructurales (no_clinic/no_doctor/role) no se resuelven reintentando,
    // así que cortamos para llegar rápido al fallback correcto.
    retry: (failureCount, error) =>
      !isStructuralContextError(error) && failureCount < 2,
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
