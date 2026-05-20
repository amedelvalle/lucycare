import { useQuery } from '@tanstack/react-query';
import { getPlatformStats } from '../../services/admin.service';

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-platform-stats'],
    queryFn: getPlatformStats,
    staleTime: 1000 * 60 * 2,
  });

  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          Métricas de plataforma (agregadas, sin datos clínicos).
        </p>
      </header>

      {isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {error instanceof Error ? error.message : 'No se pudieron cargar las métricas.'}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Médicos" value={data.doctorsTotal} />
          <StatCard label="Publicados" value={data.doctorsPublished} />
          <StatCard label="Verificados" value={data.doctorsVerified} />
          <StatCard label="Pacientes" value={data.patientsTotal} />
          <StatCard label="Asistentes activos" value={data.assistantsActive} />
          <StatCard label="Citas totales" value={data.appointmentsTotal} />
          <StatCard label="Citas atendidas" value={data.appointmentsAttended} />
          <StatCard label="Consultas firmadas" value={data.consultationsSigned} />
          <StatCard label="Reseñas" value={data.reviewsTotal} />
          <StatCard
            label="Score promedio"
            value={data.reviewsAvgScore != null ? data.reviewsAvgScore.toFixed(2) : '—'}
          />
        </div>
      )}
    </div>
  );
}
