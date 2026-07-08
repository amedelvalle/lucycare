/**
 * Analytics Farma (LucyAdmin) — consumo READ-ONLY de las RPCs de s7_54
 * (SECURITY DEFINER, gate is_admin()). Solo agregados; el payload NO trae PII ni
 * datos clínicos individuales (garantía server-side).
 *
 *  - admin_pharma_summary            → KPIs agregados (jsonb)
 *  - admin_pharma_medication_ranking → ranking por medicamento
 *  - admin_pharma_doctor_ranking     → ranking por médico
 *
 * Capa estratégica INTERNA: no divulgable, admin-only.
 */
import { supabase } from '../lib/supabase';

export interface PharmaFilters {
  dateFrom?: string; // 'YYYY-MM-DD' inclusivo
  dateTo?: string;   // 'YYYY-MM-DD' inclusivo (el RPC aplica < date_to + 1 día)
  minCount?: number; // umbral de celda mínima para rankings (default 3)
}

export interface PharmaSummary {
  range: { from: string | null; to: string | null };
  total_prescriptions: number;
  unique_medications: number;
  prescribing_doctors: number;
  signed_consultations_with_meds: number;
  by_source: { global: number; personal: number };
  permanent: number;
}

export interface PharmaMedicationRow {
  medicationId: string;
  medicationName: string | null;
  activeIngredient: string | null;
  concentration: string | null;
  presentation: string | null;
  isGlobal: boolean;
  timesPrescribed: number;
  consultationsCount: number;
  distinctDoctors: number;
}

export interface PharmaDoctorRow {
  doctorId: string;
  doctorName: string | null;
  specialtyName: string | null;
  totalPrescriptions: number;
  uniqueMedications: number;
  globalCount: number;
  personalCount: number;
  permanentCount: number;
}

/** KPIs agregados de prescripción. Vía RPC `admin_pharma_summary` (s7_54). */
export async function getPharmaSummary(filters: PharmaFilters = {}): Promise<PharmaSummary> {
  const { data, error } = await supabase.rpc('admin_pharma_summary', {
    p_date_from: filters.dateFrom ?? undefined,
    p_date_to: filters.dateTo ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as unknown as PharmaSummary;
}

/** Ranking de medicamentos. Vía RPC `admin_pharma_medication_ranking` (s7_54). */
export async function getPharmaMedicationRanking(
  filters: PharmaFilters & { limit?: number } = {},
): Promise<PharmaMedicationRow[]> {
  const { data, error } = await supabase.rpc('admin_pharma_medication_ranking', {
    p_date_from: filters.dateFrom ?? undefined,
    p_date_to: filters.dateTo ?? undefined,
    p_limit: filters.limit ?? 20,
    p_min_count: filters.minCount ?? 3,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    medicationId: r.medication_id as string,
    medicationName: (r.medication_name as string | null) ?? null,
    activeIngredient: (r.active_ingredient as string | null) ?? null,
    concentration: (r.concentration as string | null) ?? null,
    presentation: (r.presentation as string | null) ?? null,
    isGlobal: Boolean(r.is_global),
    timesPrescribed: Number(r.times_prescribed ?? 0),
    consultationsCount: Number(r.consultations_count ?? 0),
    distinctDoctors: Number(r.distinct_doctors ?? 0),
  }));
}

/** Ranking de médicos por volumen de prescripción. Vía RPC `admin_pharma_doctor_ranking` (s7_54). */
export async function getPharmaDoctorRanking(
  filters: PharmaFilters & { limit?: number } = {},
): Promise<PharmaDoctorRow[]> {
  const { data, error } = await supabase.rpc('admin_pharma_doctor_ranking', {
    p_date_from: filters.dateFrom ?? undefined,
    p_date_to: filters.dateTo ?? undefined,
    p_limit: filters.limit ?? 20,
    p_min_count: filters.minCount ?? 3,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    doctorId: r.doctor_id as string,
    doctorName: (r.doctor_name as string | null) ?? null,
    specialtyName: (r.specialty_name as string | null) ?? null,
    totalPrescriptions: Number(r.total_prescriptions ?? 0),
    uniqueMedications: Number(r.unique_medications ?? 0),
    globalCount: Number(r.global_count ?? 0),
    personalCount: Number(r.personal_count ?? 0),
    permanentCount: Number(r.permanent_count ?? 0),
  }));
}
