// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/pages/panel/citas/AppointmentCard.tsx
// ACCIÓN: NUEVO — crear archivo en carpeta citas
// ═══════════════════════════════════════════════════════════

import type { AppointmentListItem, AppointmentStatus } from '@/services/appointments.service';

interface AppointmentCardProps {
  appointment: AppointmentListItem;
  statuses: AppointmentStatus[];
  onChangeStatus: (appointmentId: string, statusId: string) => void;
  isUpdating: boolean;
}

export default function AppointmentCard({
  appointment,
  statuses,
  onChangeStatus,
  isUpdating,
}: AppointmentCardProps) {
  const { patient, service, status } = appointment;

  const startTime = new Date(appointment.start_time);
  const endTime = new Date(appointment.end_time);

  const timeStr = startTime.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: true });
  const endTimeStr = endTime.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: true });

  const sourceLabel = getSourceLabel(appointment.source);
  const initials = getInitials(patient?.full_name ?? '?');

  return (
    <div className={`bg-white rounded-lg border transition-all hover:shadow-sm ${
      status?.is_final ? 'opacity-70' : 'border-gray-200'
    }`}
      style={{ borderLeftColor: status?.color ?? '#94a3b8', borderLeftWidth: '4px' }}
    >
      <div className="flex items-start gap-4 p-4">
        {/* Hora */}
        <div className="flex-shrink-0 text-center min-w-[60px]">
          <p className="text-sm font-bold text-gray-900">{timeStr}</p>
          <p className="text-[11px] text-gray-400">{endTimeStr}</p>
        </div>

        {/* Avatar paciente */}
        <div className="flex-shrink-0">
          {patient?.photo_url ? (
            <img
              src={patient.photo_url}
              alt={patient.full_name}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white"
              style={{ backgroundColor: status?.color ?? '#94a3b8' }}
            >
              {initials}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {patient?.full_name ?? 'Paciente desconocido'}
            </p>
            {/* Badge estado */}
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
              style={{ backgroundColor: status?.color ?? '#94a3b8' }}
            >
              {status?.display_name ?? 'Sin estado'}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            {service && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                </svg>
                {service.name}
              </span>
            )}
            {patient?.phone && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                </svg>
                {patient.phone}
              </span>
            )}
            <span className="flex items-center gap-1">
              {sourceLabel.icon}
              {sourceLabel.text}
            </span>
          </div>

          {appointment.notes && (
            <p className="text-xs text-gray-400 mt-1.5 italic truncate">
              {appointment.notes}
            </p>
          )}
        </div>

        {/* Selector de estado (solo si no es final) */}
        {!status?.is_final && (
          <div className="flex-shrink-0">
            <select
              value={status?.id ?? ''}
              onChange={(e) => onChangeStatus(appointment.id, e.target.value)}
              disabled={isUpdating}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700
                focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none
                disabled:opacity-50 cursor-pointer"
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function getSourceLabel(source: string): { text: string; icon: React.ReactNode } {
  switch (source) {
    case 'lucy_directorio':
      return {
        text: 'Lucy',
        icon: (
          <svg className="w-3.5 h-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
        ),
      };
    case 'lucy_seguimiento':
      return {
        text: 'Seguimiento',
        icon: (
          <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
        ),
      };
    default:
      return {
        text: 'Manual',
        icon: (
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
        ),
      };
  }
}
