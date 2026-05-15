import { supabase } from '@/lib/supabase';

// ─── Tipos ────────────────────────────────────────────────────────────

/** Criterios de calificación (1-5). Pesos en el promedio ponderado:
 *  Trato 20 · Claridad 20 · Confianza 20 · Escucha 15 · Satisfacción 15 · Puntualidad 10 */
export interface ReviewCriteria {
  punctuality: number;
  treatment: number;
  clarity: number;
  listening: number;
  confidence: number;
  satisfaction: number;
}

export interface SubmitReviewInput extends ReviewCriteria {
  nps?: number | null; // 0-10, uso interno
  comment?: string | null; // opcional
}

export interface DoctorRatingStats {
  doctorId: string;
  specialtyId: string | null;
  nReviews: number;
  scoreAdjusted: number | null; // null si no hay reseñas en ventana 12m
  avgPunctuality: number | null;
  avgTreatment: number | null;
  avgClarity: number | null;
  avgListening: number | null;
  avgConfidence: number | null;
  avgSatisfaction: number | null;
  isTopRated: boolean; // ≥4.7 y ≥20 reseñas
}

// Etiquetas públicas: criterio ≥4.5 y médico con ≥10 reseñas.
const TAG_MIN_AVG = 4.5;
const TAG_MIN_REVIEWS = 10;

const CRITERION_LABELS: Record<keyof ReviewCriteria, string> = {
  treatment: 'Excelente trato',
  clarity: 'Explica con claridad',
  listening: 'Resuelve tus dudas',
  confidence: 'Genera confianza',
  satisfaction: 'Muy recomendado',
  punctuality: 'Atención puntual',
};

// ─── Captura (público, sin login) ─────────────────────────────────────

/** Canjea el token y guarda la calificación. Lanza Error con mensaje claro
 *  si el token es inválido, ya usado, expirado, o la cita no está atendida. */
export async function submitReview(
  token: string,
  input: SubmitReviewInput
): Promise<void> {
  const { error } = await supabase.rpc('submit_review', {
    p_token: token,
    p_punctuality: input.punctuality,
    p_treatment: input.treatment,
    p_clarity: input.clarity,
    p_listening: input.listening,
    p_confidence: input.confidence,
    p_satisfaction: input.satisfaction,
    p_nps: input.nps ?? null,
    p_comment: input.comment ?? null,
  });
  if (error) throw new Error(error.message);
}

// ─── Link para el doctor (panel) ──────────────────────────────────────

/** Devuelve el token de la cita (o null si aún no está atendida).
 *  El doctor/asistente lo usa para armar el link y enviarlo por WhatsApp. */
export async function getReviewToken(appointmentId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_review_link', {
    p_appointment_id: appointmentId,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/** Construye la URL pública de calificación a partir del token. */
export function buildReviewUrl(token: string): string {
  return `${window.location.origin}/calificar/${token}`;
}

// ─── Agregado público ─────────────────────────────────────────────────

/** Stats agregadas de un médico (ventana 12 meses). */
export async function getDoctorRatingStats(
  doctorId: string
): Promise<DoctorRatingStats | null> {
  const { data, error } = await supabase
    .from('doctor_rating_stats')
    .select('*')
    .eq('doctor_id', doctorId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = data as any;
  return {
    doctorId: r.doctor_id,
    specialtyId: r.specialty_id ?? null,
    nReviews: r.n_reviews ?? 0,
    scoreAdjusted: r.score_adjusted ?? null,
    avgPunctuality: r.avg_punctuality ?? null,
    avgTreatment: r.avg_treatment ?? null,
    avgClarity: r.avg_clarity ?? null,
    avgListening: r.avg_listening ?? null,
    avgConfidence: r.avg_confidence ?? null,
    avgSatisfaction: r.avg_satisfaction ?? null,
    isTopRated: r.is_top_rated ?? false,
  };
}

/** Etiquetas públicas derivadas de los promedios por criterio.
 *  Solo si el médico tiene ≥10 reseñas y el criterio promedia ≥4.5. */
export function deriveReviewTags(stats: DoctorRatingStats): string[] {
  if (stats.nReviews < TAG_MIN_REVIEWS) return [];
  const byCriterion: Array<[keyof ReviewCriteria, number | null]> = [
    ['treatment', stats.avgTreatment],
    ['clarity', stats.avgClarity],
    ['listening', stats.avgListening],
    ['confidence', stats.avgConfidence],
    ['satisfaction', stats.avgSatisfaction],
    ['punctuality', stats.avgPunctuality],
  ];
  return byCriterion
    .filter(([, avg]) => avg != null && avg >= TAG_MIN_AVG)
    .map(([k]) => CRITERION_LABELS[k]);
}

/** "Lo que más valoran los pacientes": top 3 criterios por promedio. */
export function topValuedCriteria(stats: DoctorRatingStats, limit = 3): string[] {
  const byCriterion: Array<[keyof ReviewCriteria, number | null]> = [
    ['treatment', stats.avgTreatment],
    ['clarity', stats.avgClarity],
    ['listening', stats.avgListening],
    ['confidence', stats.avgConfidence],
    ['satisfaction', stats.avgSatisfaction],
    ['punctuality', stats.avgPunctuality],
  ];
  return byCriterion
    .filter(([, avg]) => avg != null)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, limit)
    .map(([k]) => CRITERION_LABELS[k]);
}
