import { useQuery } from '@tanstack/react-query';
import { useClinicContext } from '@/hooks/useClinicContext';
import {
  getDoctorRatingStats,
  getMyReviewComments,
  relativeAgeLabel,
} from '@/services/reviews.service';

const CRITERIA = [
  { label: 'Trato del médico', key: 'avgTreatment' },
  { label: 'Claridad de la explicación', key: 'avgClarity' },
  { label: 'Confianza que generó', key: 'avgConfidence' },
  { label: 'Escucha y dudas', key: 'avgListening' },
  { label: 'Satisfacción general', key: 'avgSatisfaction' },
  { label: 'Puntualidad', key: 'avgPunctuality' },
] as const;

export default function ReputacionPage() {
  const { data: ctx } = useClinicContext();
  const doctorId = ctx?.doctorId;

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ['my-rating-stats', doctorId],
    queryFn: () => getDoctorRatingStats(doctorId as string),
    enabled: !!doctorId,
    staleTime: 1000 * 60 * 5,
  });

  const { data: comments = [], isLoading: loadingComments } = useQuery({
    queryKey: ['my-review-comments'],
    queryFn: getMyReviewComments,
    staleTime: 1000 * 60 * 5,
  });

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Mi reputación</h1>
        <p className="text-sm text-gray-500 mt-1">
          Calificaciones de tus pacientes. Los comentarios son anónimos: no
          ves nombre, teléfono ni fecha exacta.
        </p>
      </header>

      {/* Resumen */}
      {loadingStats ? (
        <div className="animate-pulse h-28 bg-gray-100 rounded-2xl mb-6" />
      ) : !stats || stats.nReviews === 0 || stats.scoreAdjusted == null ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
          <p className="text-gray-600">
            Todavía no tenés calificaciones de pacientes. Cuando atiendas
            citas y envíes la encuesta, vas a verlas acá.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
          <div className="flex items-end gap-3 flex-wrap">
            <span className="text-4xl font-bold text-gray-900">
              {stats.scoreAdjusted.toFixed(2)}
            </span>
            <span className="text-gray-500 mb-1">/ 5</span>
            <div className="flex items-center gap-1 mb-1.5 ml-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <i
                  key={i}
                  className={`ri-star-${
                    i < Math.round(stats.scoreAdjusted as number) ? 'fill' : 'line'
                  } text-yellow-500`}
                />
              ))}
            </div>
            {stats.isTopRated && (
              <span className="mb-1.5 ml-1 inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-semibold">
                <i className="ri-award-fill" />
                Mejor valorado
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1 mb-5">
            Basado en {stats.nReviews}{' '}
            {stats.nReviews === 1 ? 'valoración' : 'valoraciones'} (últimos 12 meses)
          </p>

          <div className="space-y-2.5 max-w-xl">
            {CRITERIA.map(({ label, key }) => {
              const v = stats[key];
              if (v == null) return null;
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 w-44">{label}</span>
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-600"
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
        </div>
      )}

      {/* Comentarios anónimos */}
      <h2 className="text-base font-semibold text-gray-900 mb-3">
        Comentarios de pacientes
      </h2>
      {loadingComments ? (
        <div className="animate-pulse space-y-3">
          <div className="h-20 bg-gray-100 rounded-xl" />
          <div className="h-20 bg-gray-100 rounded-xl" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-gray-500">
          Todavía no hay comentarios escritos por pacientes.
        </p>
      ) : (
        <div className="space-y-3">
          {comments.map((c, i) => (
            <div
              key={i}
              className="bg-white border border-gray-200 rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, s) => (
                    <i
                      key={s}
                      className={`ri-star-${
                        s < Math.round(c.rating) ? 'fill' : 'line'
                      } text-yellow-500 text-sm`}
                    />
                  ))}
                  <span className="text-sm font-medium text-gray-700 ml-1">
                    {c.rating.toFixed(2)}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {relativeAgeLabel(c.monthsAgo)}
                </span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">
                {c.comment}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
