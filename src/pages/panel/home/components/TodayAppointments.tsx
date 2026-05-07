/**
 * TodayAppointments — Lista de citas del día en el dashboard
 *
 * ACCIÓN: CREAR este archivo nuevo
 * RUTA:   src/pages/panel/home/components/TodayAppointments.tsx
 */

import type { AppointmentSummary } from '../../../../services/dashboard.service'

interface TodayAppointmentsProps {
  appointments: AppointmentSummary[]
  isLoading: boolean
}

export function TodayAppointments({ appointments, isLoading }: TodayAppointmentsProps) {
  // ── Skeleton de carga ──
  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Citas de hoy</h2>
        </div>
        <div className="p-5 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse flex items-center gap-3">
              <div className="w-16 h-4 bg-gray-200 rounded" />
              <div className="w-8 h-8 bg-gray-200 rounded-full" />
              <div className="flex-1">
                <div className="w-32 h-4 bg-gray-200 rounded" />
                <div className="w-20 h-3 bg-gray-100 rounded mt-1" />
              </div>
              <div className="w-20 h-6 bg-gray-200 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Contenido ──
  return (
    <div className="bg-white rounded-xl border border-gray-200">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">
          Citas de hoy
          {appointments.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-400">
              ({appointments.length})
            </span>
          )}
        </h2>
        <a
          href="/panel/citas"
          className="text-sm text-emerald-700 hover:text-emerald-800 font-medium flex items-center gap-1"
        >
          Ver agenda <i className="ri-arrow-right-s-line"></i>
        </a>
      </div>

      {/* Lista o vacío */}
      {appointments.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <i className="ri-calendar-check-line text-4xl text-gray-300 mb-2"></i>
          <p className="text-gray-500 text-sm">No hay citas programadas para hoy</p>
          <p className="text-gray-400 text-xs mt-1">Las nuevas reservas aparecerán aquí automáticamente</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {appointments.map((apt) => (
            <AppointmentRow key={apt.id} appointment={apt} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Fila individual ──

function AppointmentRow({ appointment }: { appointment: AppointmentSummary }) {
  const startTime = new Date(appointment.start_time)
  const endTime = new Date(appointment.end_time)
  const now = new Date()

  const timeStr = startTime.toLocaleTimeString('es-SV', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })

  const isCurrent = now >= startTime && now <= endTime
  const isPast = now > endTime

  // Iniciales del paciente
  const initials = appointment.patient.full_name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const statusColor = appointment.status?.color || '#6b7280'

  return (
    <div
      className={`
        px-5 py-3 flex items-center gap-3 hover:bg-gray-50/50 transition-colors
        ${isCurrent ? 'bg-emerald-50/30 border-l-2 border-l-emerald-600' : ''}
        ${isPast ? 'opacity-60' : ''}
      `}
    >
      {/* Hora */}
      <div className="w-16 flex-shrink-0">
        <span className={`text-sm font-mono font-medium ${isCurrent ? 'text-emerald-700' : 'text-gray-600'}`}>
          {timeStr}
        </span>
      </div>

      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {appointment.patient.photo_url ? (
          <img
            src={appointment.patient.photo_url}
            alt={appointment.patient.full_name}
            className="w-8 h-8 rounded-full object-cover"
          />
        ) : (
          <span className="text-xs font-medium text-gray-500">{initials}</span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {appointment.patient.full_name}
        </p>
        <p className="text-xs text-gray-400 truncate">
          {appointment.service?.name || 'Consulta'}
          {appointment.source === 'lucy_directorio' && (
            <span className="ml-1.5 text-emerald-600 font-medium" title="Paciente captado por Lucy">
              ✦ Lucy
            </span>
          )}
        </p>
      </div>

      {/* Badge de estado */}
      <span
        className="text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0"
        style={{
          backgroundColor: `${statusColor}15`,
          color: statusColor,
        }}
      >
        {appointment.status?.display_name || 'Programada'}
      </span>
    </div>
  )
}
