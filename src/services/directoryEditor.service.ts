/**
 * Frontend del Editor de directorio (LucyAdmin nivel `directory_editor`).
 * Consume EXCLUSIVAMENTE las RPCs acotadas de s7_57 (gate can_manage_directory()):
 *   - my_lucyadmin_access        → nivel de acceso del caller (owner/editor/…)
 *   - directory_list_doctors     → listado SIN teléfono/email de login
 *   - directory_get_doctor_detail→ detalle SIN email/phone de login
 *   - directory_update_doctor_name→ solo profiles.full_name (jamás auth.users)
 *
 * Las ediciones de clínica/info/servicios/publicación reusan las RPCs
 * re-gateadas del PR-A vía `admin.service` (mismas firmas; el backend gatea
 * por capacidad, no por rol).
 */
import { supabase } from '../lib/supabase';
import type { LucyStatus } from './admin.service';

export type LucyAdminLevel = 'owner_admin' | 'operations_admin' | 'directory_editor' | null;

export interface LucyAdminAccess {
  level: LucyAdminLevel;
  can_access_lucyadmin: boolean;
  can_manage_directory: boolean;
  can_manage_operations: boolean;
  can_manage_users: boolean;
}

/** Nivel de acceso administrativo del usuario actual. Vía `my_lucyadmin_access()`. */
export async function getMyLucyAdminAccess(): Promise<LucyAdminAccess> {
  const { data, error } = await supabase.rpc('my_lucyadmin_access');
  if (error) throw new Error(error.message);
  const a = (data ?? {}) as Partial<LucyAdminAccess>;
  return {
    level: (a.level as LucyAdminLevel) ?? null,
    can_access_lucyadmin: !!a.can_access_lucyadmin,
    can_manage_directory: !!a.can_manage_directory,
    can_manage_operations: !!a.can_manage_operations,
    can_manage_users: !!a.can_manage_users,
  };
}

export interface DirectoryDoctorRow {
  id: string;
  fullName: string | null;
  specialty: string | null;
  clinicName: string | null;
  isVerified: boolean;
  isPublished: boolean;
  lucyStatus: LucyStatus;
  createdAt: string;
}

export interface DirectoryDoctorsPage {
  rows: DirectoryDoctorRow[];
  total: number;
}

/** Listado acotado (sin login creds). Vía `directory_list_doctors`. */
export async function getDirectoryDoctors(filters: {
  search?: string;
  published?: boolean | null;
  limit?: number;
  offset?: number;
} = {}): Promise<DirectoryDoctorsPage> {
  const { data, error } = await supabase.rpc('directory_list_doctors', {
    p_search: filters.search?.trim() || undefined,
    p_published: filters.published ?? undefined,
    p_limit: filters.limit ?? 25,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  const arr = (data ?? []) as Array<Record<string, unknown>>;
  const rows: DirectoryDoctorRow[] = arr.map((r) => ({
    id: r.id as string,
    fullName: (r.full_name as string | null) ?? null,
    specialty: (r.specialty as string | null) ?? null,
    clinicName: (r.clinic_name as string | null) ?? null,
    isVerified: !!r.is_verified,
    isPublished: !!r.is_published,
    lucyStatus: r.lucy_status as LucyStatus,
    createdAt: r.created_at as string,
  }));
  const total = arr.length > 0 ? Number(arr[0].total_count ?? 0) : 0;
  return { rows, total };
}

export interface DirectoryDoctorDetail {
  doctorId: string;
  profileId: string;
  clinicId: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  specialtyId: string | null;
  specialtyName: string | null;
  bio: string | null;
  clinicName: string | null;
  clinicAddress: string | null;
  clinicPhone: string | null;
  clinicDepartmentId: string | null;
  clinicMunicipalityId: string | null;
  isPublished: boolean;
  isVerified: boolean;
  lucyStatus: LucyStatus;
}

/** Detalle acotado (sin email/phone de login). Vía `directory_get_doctor_detail`. */
export async function getDirectoryDoctorDetail(doctorId: string): Promise<DirectoryDoctorDetail | null> {
  const { data, error } = await supabase.rpc('directory_get_doctor_detail', { p_doctor_id: doctorId });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    doctorId: row.doctor_id as string,
    profileId: row.profile_id as string,
    clinicId: (row.clinic_id as string | null) ?? null,
    fullName: (row.full_name as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    specialtyId: (row.specialty_id as string | null) ?? null,
    specialtyName: (row.specialty_name as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    clinicName: (row.clinic_name as string | null) ?? null,
    clinicAddress: (row.clinic_address as string | null) ?? null,
    clinicPhone: (row.clinic_phone as string | null) ?? null,
    clinicDepartmentId: (row.clinic_department_id as string | null) ?? null,
    clinicMunicipalityId: (row.clinic_municipality_id as string | null) ?? null,
    isPublished: !!row.is_published,
    isVerified: !!row.is_verified,
    lucyStatus: row.lucy_status as LucyStatus,
  };
}

/** Actualiza SOLO el nombre visible (`profiles.full_name`). Vía `directory_update_doctor_name`. */
export async function updateDirectoryDoctorName(doctorId: string, fullName: string): Promise<void> {
  const { error } = await supabase.rpc('directory_update_doctor_name', {
    p_doctor_id: doctorId,
    p_full_name: fullName,
  });
  if (error) throw new Error(error.message);
}
