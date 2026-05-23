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

// ─── Detalle / edición (Fase B2-A) ───────────────────────────────────

export interface AdminDoctorDetail {
  doctorId: string;
  profileId: string;
  clinicId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  specialtyId: string | null;
  specialtyName: string | null;
  bio: string | null;
  clinicName: string;
  clinicAddress: string | null;
  clinicPhone: string | null;
  isPublished: boolean;
  isOperational: boolean;
  lucyStatus: LucyStatus;
}

export async function getDoctorAdminDetail(doctorId: string): Promise<AdminDoctorDetail | null> {
  const { data, error } = await supabase.rpc('admin_get_doctor_detail', { p_doctor_id: doctorId });
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    doctorId: row.doctor_id as string,
    profileId: row.profile_id as string,
    clinicId: row.clinic_id as string,
    fullName: (row.full_name as string) ?? '',
    email: (row.email as string) ?? null,
    phone: (row.phone as string) ?? null,
    specialtyId: (row.specialty_id as string) ?? null,
    specialtyName: (row.specialty_name as string) ?? null,
    bio: (row.bio as string) ?? null,
    clinicName: (row.clinic_name as string) ?? '',
    clinicAddress: (row.clinic_address as string) ?? null,
    clinicPhone: (row.clinic_phone as string) ?? null,
    isPublished: !!row.is_published,
    isOperational: !!row.is_operational,
    lucyStatus: row.lucy_status as LucyStatus,
  };
}

export interface SpecialtyOption { id: string; name: string }

export async function getSpecialtiesForAdmin(): Promise<SpecialtyOption[]> {
  const { data, error } = await supabase
    .from('specialties')
    .select('id, name')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as SpecialtyOption[];
}

export const updateDoctorProfile = (id: string, fullName: string, email: string | null, phone: string | null) =>
  rpc('admin_update_doctor_profile', {
    p_doctor_id: id,
    p_full_name: fullName,
    p_email: email,
    p_phone: phone,
  });

export const updateDoctorClinic = (id: string, name: string, address: string | null, phone: string | null) =>
  rpc('admin_update_doctor_clinic', {
    p_doctor_id: id,
    p_name: name,
    p_address: address,
    p_phone: phone,
  });

export const updateDoctorInfo = (id: string, specialtyId: string | null, bio: string | null) =>
  rpc('admin_update_doctor_info', {
    p_doctor_id: id,
    p_specialty_id: specialtyId,
    p_bio: bio,
  });

// is_verified ya no es editable manualmente — se deriva de lucy_status='verified'
// (ver migración s7_03). Para "verificar" un médico, usá setDoctorLucyStatus(id, 'verified').
export const setDoctorPublished = (id: string, value: boolean) =>
  rpc('admin_set_doctor_published', { p_doctor_id: id, p_value: value });
export const setDoctorOperational = (id: string, value: boolean) =>
  rpc('admin_set_doctor_operational', { p_doctor_id: id, p_value: value });
export const setDoctorLucyStatus = (id: string, value: LucyStatus) =>
  rpc('admin_set_lucy_status', { p_doctor_id: id, p_value: value });

// ─── Servicios del médico (Fase B3-admin) ────────────────────────────

export interface AdminServiceItem {
  id: string;
  doctorId: string;
  name: string;
  durationMinutes: number;
  price: number | null;
  isFirstVisit: boolean;
  isActive: boolean;
  sortOrder: number;
}

/** SQLSTATE de violación de foreign key — admin_delete_service lo re-lanza
 *  con mensaje en español cuando el servicio tiene citas asociadas. */
export const ADMIN_FK_VIOLATION = '23503';

export async function listAdminDoctorServices(doctorId: string): Promise<AdminServiceItem[]> {
  const { data, error } = await supabase.rpc('admin_list_doctor_services', { p_doctor_id: doctorId });
  if (error) throw error;
  const arr = (data ?? []) as Array<Record<string, unknown>>;
  return arr.map((r) => ({
    id: r.id as string,
    doctorId: r.doctor_id as string,
    name: r.name as string,
    durationMinutes: Number(r.duration_minutes),
    price: r.price == null ? null : Number(r.price),
    isFirstVisit: !!r.is_first_visit,
    isActive: !!r.is_active,
    sortOrder: Number(r.sort_order),
  }));
}

export async function createAdminService(input: {
  doctorId: string;
  name: string;
  durationMinutes: number;
  price: number | null;
  isFirstVisit: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc('admin_create_service', {
    p_doctor_id: input.doctorId,
    p_name: input.name,
    p_duration_minutes: input.durationMinutes,
    p_price: input.price,
    p_is_first_visit: input.isFirstVisit,
  });
  if (error) throw error;
  return data as string;
}

export async function updateAdminService(input: {
  serviceId: string;
  name: string;
  durationMinutes: number;
  price: number | null;
  isFirstVisit: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc('admin_update_service', {
    p_service_id: input.serviceId,
    p_name: input.name,
    p_duration_minutes: input.durationMinutes,
    p_price: input.price,
    p_is_first_visit: input.isFirstVisit,
  });
  if (error) throw error;
}

export async function setAdminServiceActive(serviceId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_service_active', {
    p_service_id: serviceId,
    p_is_active: isActive,
  });
  if (error) throw error;
}

export async function deleteAdminService(serviceId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_service', { p_service_id: serviceId });
  if (error) throw error;
}

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
