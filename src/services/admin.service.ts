import { supabase } from '@/lib/supabase';

export interface PlatformStats {
  doctorsTotal: number;
  doctorsPublished: number;
  doctorsVerified: number;
  patientsTotal: number;
  assistantsActive: number;
  appointmentsTotal: number;
  appointmentsAttended: number;
  consultationsSigned: number;
  reviewsTotal: number;
  reviewsAvgScore: number | null;
}

// ─── Gestión de médicos (Fase B) ─────────────────────────────────────

export type LucyStatus = 'listed_only' | 'claimed' | 'booking_enabled' | 'verified';

export interface AdminDoctorRow {
  id: string;
  fullName: string | null;
  phone: string | null;
  specialty: string | null;
  clinicName: string | null;
  isVerified: boolean;
  isPublished: boolean;
  bookingEnabled: boolean;
  isOperational: boolean;
  lucyStatus: LucyStatus;
  createdAt: string;
}

export interface AdminDoctorsFilters {
  search?: string;
  published?: boolean | null;
  operational?: boolean | null;
  lucyStatus?: LucyStatus | null;
  limit?: number;
  offset?: number;
}

export interface AdminDoctorsPage {
  rows: AdminDoctorRow[];
  total: number;
}

export async function getAdminDoctors(
  filters: AdminDoctorsFilters = {}
): Promise<AdminDoctorsPage> {
  const { data, error } = await supabase.rpc('admin_list_doctors', {
    p_search: filters.search?.trim() || null,
    p_published: filters.published ?? null,
    p_operational: filters.operational ?? null,
    p_lucy_status: filters.lucyStatus ?? null,
    p_limit: filters.limit ?? 25,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  const arr = (data ?? []) as Array<Record<string, unknown>>;
  const rows: AdminDoctorRow[] = arr.map((r) => ({
    id: r.id as string,
    fullName: (r.full_name as string) ?? null,
    phone: (r.phone as string) ?? null,
    specialty: (r.specialty as string) ?? null,
    clinicName: (r.clinic_name as string) ?? null,
    isVerified: !!r.is_verified,
    isPublished: !!r.is_published,
    bookingEnabled: !!r.booking_enabled,
    isOperational: !!r.is_operational,
    lucyStatus: r.lucy_status as LucyStatus,
    createdAt: r.created_at as string,
  }));
  const total = arr.length > 0 ? Number(arr[0].total_count ?? 0) : 0;
  return { rows, total };
}

async function rpc(fn: string, params: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc(fn, params);
  if (error) throw new Error(error.message);
}

// is_verified ya no es editable manualmente — se deriva de lucy_status='verified'
// (ver migración s7_03). Para "verificar" un médico, usá setDoctorLucyStatus(id, 'verified').
export const setDoctorPublished = (id: string, value: boolean) =>
  rpc('admin_set_doctor_published', { p_doctor_id: id, p_value: value });
export const setDoctorOperational = (id: string, value: boolean) =>
  rpc('admin_set_doctor_operational', { p_doctor_id: id, p_value: value });
export const setDoctorLucyStatus = (id: string, value: LucyStatus) =>
  rpc('admin_set_lucy_status', { p_doctor_id: id, p_value: value });

/** Métricas agregadas de plataforma (RPC gateada por is_admin()).
 *  Sin PII ni contenido clínico — solo conteos/volúmenes. */
export async function getPlatformStats(): Promise<PlatformStats> {
  const { data, error } = await supabase.rpc('get_platform_stats');
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    doctorsTotal: Number(r.doctors_total ?? 0),
    doctorsPublished: Number(r.doctors_published ?? 0),
    doctorsVerified: Number(r.doctors_verified ?? 0),
    patientsTotal: Number(r.patients_total ?? 0),
    assistantsActive: Number(r.assistants_active ?? 0),
    appointmentsTotal: Number(r.appointments_total ?? 0),
    appointmentsAttended: Number(r.appointments_attended ?? 0),
    consultationsSigned: Number(r.consultations_signed ?? 0),
    reviewsTotal: Number(r.reviews_total ?? 0),
    reviewsAvgScore:
      r.reviews_avg_score == null ? null : Number(r.reviews_avg_score),
  };
}
