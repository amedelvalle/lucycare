import { supabase } from '@/lib/supabase';

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Resuelve el JVPM efectivo desde el embed `doctor_credentials`, que es la
 * ÚNICA fuente (F1-c1 retiró el fallback a `doctors.license_number`).
 *
 * PostgREST devuelve la relación como ARREGLO (0..N credenciales); el índice
 * `one_per_type` garantiza ≤1 fila JVPM. Regla (F1-b, intacta):
 *   • fila JVPM 'pending' | 'verified' → utilizable, se usa su value;
 *   • fila JVPM 'rejected'             → NO utilizable (su estado manda);
 *   • NO existe fila JVPM              → sin licencia (null).
 */
export function resolveJvpm(
  rows: Array<{ value: string | null; type: string; status: string }> | null | undefined,
): string | null {
  const jvpm = (rows ?? []).find((c) => c.type === 'JVPM');
  if (jvpm) {
    return jvpm.status === 'rejected' ? null : (jvpm.value ?? null);
  }
  return null;
}

// ─── Tipos ────────────────────────────────────────────────────────────

export interface MyDoctorProfile {
  // doctors
  doctor_id: string;
  slug: string | null;
  clinic_id: string;
  bio: string | null;
  consultation_fee: number | null;
  experience_years: number | null;
  languages: string[] | null;
  license_number: string | null;
  specialty_id: string | null;
  specialty_name: string | null;
  is_published: boolean;
  is_verified: boolean;
  booking_enabled: boolean;
  lucy_status: string;

  // profile
  profile_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
}

export interface DoctorPublicUpdate {
  bio?: string | null;
  consultation_fee?: number | null;
  experience_years?: number | null;
  languages?: string[] | null;
  specialty_id?: string | null;
}

export interface ProfileBasicUpdate {
  full_name?: string;
  email?: string | null;
  avatar_url?: string | null;
}

// ─── Funciones ────────────────────────────────────────────────────────

/**
 * Obtiene el perfil del médico autenticado, combinando doctors + profiles + specialty.
 */
export async function getMyDoctorProfile(): Promise<MyDoctorProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('doctors')
    .select(`
      id,
      slug,
      clinic_id,
      bio,
      consultation_fee,
      experience_years,
      languages,
      specialty_id,
      is_published,
      is_verified,
      booking_enabled,
      lucy_status,
      profile_id,
      profiles!inner(full_name, email, phone, avatar_url),
      specialties(id, name),
      doctor_credentials(value, type, status)
    `)
    .eq('profile_id', user.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  // F1-c1: el JVPM se lee EXCLUSIVAMENTE de doctor_credentials (filtrando
  // 'rejected'); la columna doctors.license_number ya no se consulta.
  return {
    doctor_id: d.id,
    slug: d.slug ?? null,
    clinic_id: d.clinic_id,
    bio: d.bio,
    consultation_fee: d.consultation_fee != null ? Number(d.consultation_fee) : null,
    experience_years: d.experience_years,
    languages: d.languages,
    license_number: resolveJvpm(d.doctor_credentials),
    specialty_id: d.specialty_id,
    specialty_name: d.specialties?.name ?? null,
    is_published: d.is_published,
    is_verified: d.is_verified,
    booking_enabled: d.booking_enabled,
    lucy_status: d.lucy_status,
    profile_id: d.profile_id,
    full_name: d.profiles.full_name,
    email: d.profiles.email,
    phone: d.profiles.phone,
    avatar_url: d.profiles.avatar_url,
  };
}

/**
 * Actualiza campos públicos del médico (tabla doctors).
 */
export async function updateDoctorPublic(
  doctorId: string,
  updates: DoctorPublicUpdate
): Promise<void> {
  const { error } = await supabase
    .from('doctors')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', doctorId);
  if (error) throw error;
}

/**
 * Actualiza datos básicos del profile (full_name, email, avatar_url).
 */
export async function updateProfileBasic(
  profileId: string,
  updates: ProfileBasicUpdate
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', profileId);
  if (error) throw error;
}

/**
 * Cambia el flag is_published.
 */
export async function setDoctorPublished(
  doctorId: string,
  published: boolean
): Promise<void> {
  const { error } = await supabase
    .from('doctors')
    .update({ is_published: published, updated_at: new Date().toISOString() })
    .eq('id', doctorId);
  if (error) throw error;
}

/**
 * Cambia el flag booking_enabled.
 */
export async function setBookingEnabled(
  doctorId: string,
  enabled: boolean
): Promise<void> {
  const { error } = await supabase
    .from('doctors')
    .update({ booking_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('id', doctorId);
  if (error) throw error;
}
