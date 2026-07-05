/**
 * Dashboard interno de conversiones (LucyAdmin) — consumo READ-ONLY de las RPCs
 * de s7_53 (SECURITY DEFINER, gate is_admin()). Solo agregados; el payload NO
 * trae PII ni datos clínicos (garantía server-side).
 *
 *  - admin_conversion_summary            → KPIs agregados (jsonb)
 *  - admin_doctor_conversion_ranking     → ranking por médico
 */
import { supabase } from '../lib/supabase';

export interface ConversionFilters {
  dateFrom?: string; // 'YYYY-MM-DD' inclusivo
  dateTo?: string;   // 'YYYY-MM-DD' inclusivo (UX) — el RPC aplica < date_to + 1 día
}

export interface ConversionSummary {
  range: { from: string | null; to: string | null };
  bookings: {
    total: number;
    by_source: { manual: number; lucy_directorio: number; lucy_seguimiento: number };
    by_status: { completadas: number; canceladas: number; no_show: number; pendientes: number };
  };
  waitlist: { total: number; by_status: { pending: number; contacted: number; cancelled: number } };
  affiliations: {
    total: number;
    by_status: { pending: number; in_review: number; approved: number; rejected: number; expired: number };
  };
  claims: { total: number };
  supply: {
    total_doctors: number;
    by_lucy_status: { listed_only: number; claimed: number; booking_enabled: number; verified: number };
    published: number;
    with_agenda: number;
    verified: number;
  };
  reviews: { total: number; visibles: number; avg_rating: number | null };
}

export interface DoctorConversionRow {
  doctorId: string;
  doctorSlug: string | null;
  doctorName: string | null;
  specialtyName: string | null;
  bookingsTotal: number;
  bookingsDirectorio: number;
  waitlistTotal: number;
  reviewsTotal: number;
  avgRating: number | null;
}

/** KPIs agregados de conversión. Vía RPC `admin_conversion_summary` (s7_53). */
export async function getConversionSummary(filters: ConversionFilters = {}): Promise<ConversionSummary> {
  const { data, error } = await supabase.rpc('admin_conversion_summary', {
    p_date_from: filters.dateFrom ?? undefined,
    p_date_to: filters.dateTo ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as unknown as ConversionSummary;
}

/** Ranking de médicos por conversión. Vía RPC `admin_doctor_conversion_ranking` (s7_53). */
export async function getDoctorConversionRanking(
  filters: ConversionFilters & { limit?: number } = {},
): Promise<DoctorConversionRow[]> {
  const { data, error } = await supabase.rpc('admin_doctor_conversion_ranking', {
    p_date_from: filters.dateFrom ?? undefined,
    p_date_to: filters.dateTo ?? undefined,
    p_limit: filters.limit ?? 20,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    doctorId: r.doctor_id as string,
    doctorSlug: (r.doctor_slug as string | null) ?? null,
    doctorName: (r.doctor_name as string | null) ?? null,
    specialtyName: (r.specialty_name as string | null) ?? null,
    bookingsTotal: Number(r.bookings_total ?? 0),
    bookingsDirectorio: Number(r.bookings_directorio ?? 0),
    waitlistTotal: Number(r.waitlist_total ?? 0),
    reviewsTotal: Number(r.reviews_total ?? 0),
    avgRating: r.avg_rating == null ? null : Number(r.avg_rating),
  }));
}
