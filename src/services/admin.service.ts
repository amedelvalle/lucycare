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
