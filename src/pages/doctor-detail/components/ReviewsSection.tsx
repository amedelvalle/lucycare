import { useQuery } from '@tanstack/react-query';
import {
  getDoctorRatingStats,
  deriveReviewTags,
  topValuedCriteria,
  type DoctorRatingStats,
} from '@/services/reviews.service';

interface ReviewsSectionProps {
  doctorId: string;
}

const CRITERIA_BARS: Array<{
  label: string;
  key: keyof Pick<
    DoctorRatingStats,
    | 'avgTreatment'
    | 'avgClarity'
    | 'avgConfidence'
    | 'avgListening'
    | 'avgSatisfaction'
    | 'avgPunctuality'
  >;
}> = [
  { label: 'Trato del médico', key: 'avgTreatment' },
  { label: 'Claridad de la explicación', key: 'avgClarity' },
  { label: 'Confianza que generó', key: 'avgConfidence' },
  { label: 'Escucha y dudas', key: 'avgListening' },
  { label: 'Satisfacción general', key: 'avgSatisfaction' },
  { label: 'Puntualidad', key: 'avgPunctuality' },
];

export default function ReviewsSection({ doctorId }: ReviewsSectionProps) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['doctor-rating-stats', doctorId],
    queryFn: () => getDoctorRatingStats(doctorId),
    staleTime: 1000 * 60 * 5,
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-24 bg-gray-100 rounded" />
      </div>
    );
  }

  // Sin reseñas: no inventar nada
  if (!stats || stats.nReviews === 0 || stats.scoreAdjusted == null) {
    return (
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Calificaciones</h2>
        <p className="text-gray-600">
          Este médico aún no tiene calificaciones de pacientes.
        </p>
      </div>
    );
  }

  const score = stats.scoreAdjusted;
  const fullStars = Math.round(score);
  const tags = deriveReviewTags(stats);
  const topValued = topValuedCriteria(stats);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <div className="flex items-center gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <i
              key={i}
              className={`ri-star-${i < fullStars ? 'fill' : 'line'} text-yellow-500 text-xl`}
            />
          ))}
        </div>
        <h2 className="text-2xl font-semibold text-gray-900">
          {score.toFixed(2)} / 5
        </h2>
        {stats.isTopRated && (
          <span className="ml-1 inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-semibold">
            <i className="ri-award-fill" />
            Mejor valorado
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Basado en {stats.nReviews}{' '}
        {stats.nReviews === 1 ? 'valoración' : 'valoraciones'} de los últimos 12 meses
      </p>

      {/* Etiquetas públicas (criterio ≥4.5 y médico ≥10 reseñas) */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {tags.map((t) => (
            <span
              key={t}
              className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Promedio por criterio (real) */}
      <div className="space-y-3 mb-6 max-w-xl">
        {CRITERIA_BARS.map(({ label, key }) => {
          const v = stats[key];
          if (v == null) return null;
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="text-sm text-gray-700 w-44">{label}</span>
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#3C2285]"
                  style={{ width: `${(v / 5) * 100}%` }}
                />
              </div>
              <span className="text-sm font-semibold text-gray-900 w-12 text-right">
                {v.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>

      {topValued.length > 0 && (
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-sm font-medium text-gray-900 mb-1">
            Lo que más valoran los pacientes
          </p>
          <p className="text-sm text-gray-600">{topValued.join(' · ')}</p>
        </div>
      )}
    </div>
  );
}
