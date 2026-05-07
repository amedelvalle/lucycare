/**
 * UpcomingAppointments — Citas de las próximas 48 horas
 *
 * ACCIÓN: CREAR este archivo nuevo
 * RUTA:   src/pages/panel/home/components/UpcomingAppointments.tsx
 */

import type { AppointmentSummary } from '../../../../services/dashboard.service'

interface UpcomingAppointmentsProps {
  appointments: AppointmentSummary[]
  isLoading: boolean
}

export function UpcomingAppointments({ appointments, isLoading }: UpcomingAppointmentsProps) {
  // ── Skeleton de carga ──
  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Próximas 48 horas</h2>
        </div>
        <div className="p-5 space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="w-24 h-3 bg-gray-200 rounded mb-2" />
              <div className="w-full h-10 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Agrupar por fecha
  const grouped = appointments.reduce<Record<string, AppointmentSummary[]>>((acc, apt) => {
    const dateKey = new Date(apt.start_time).toLocaleDateString('es-SV', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey].push(apt)
    return acc
  }, {})

  // ── Contenido ──
  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">
          Próximas 48 horas
          {appointments.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-400">
              ({appointments.length})
            </span>
          )}
        </h2>
      </div>

      {appointments.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <i className="ri-time-line text-3xl text-gray-300 mb-1"></i>
          <p className="text-gray-400 text-sm">Sin citas próximas</p>
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {Object.entries(grouped).map(([date, apts]) => (
            <div key={date}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
                {date}
              </p>
              <div className="space-y-1.5">
                {apts.map((apt) => {
                  const time = new Date(apt.start_time).toLocaleTimeString('es-SV', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  })
                  return (
                    <div
                      key={apt.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <span className="text-sm font-mono text-gray-500 w-16 flex-shrink-0">{time}</span>
                      <span className="text-sm text-gray-800 truncate flex-1">{apt.patient.full_name}</span>
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: apt.status?.color || '#6b7280' }}
                        title={apt.status?.display_name}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
