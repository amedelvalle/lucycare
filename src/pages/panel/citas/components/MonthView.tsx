// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/pages/panel/citas/components/MonthView.tsx
// ═══════════════════════════════════════════════════════════
// Vista mes: grid 6×7 con resumen de citas (max 3 por día visible).

import type { AppointmentListItem } from '@/services/appointments.service';
import {
  getMonthGrid,
  parseDateStr,
  toDateStr,
  DAY_NAMES_SHORT,
  formatTime,
} from '@/utils/calendar';

interface MonthViewProps {
  dateStr: string;
  appointments: AppointmentListItem[];
  onAppointmentClick: (appointment: AppointmentListItem) => void;
  onDateClick: (dateStr: string) => void;
}

export default function MonthView({
  dateStr,
  appointments,
  onAppointmentClick,
  onDateClick,
}: MonthViewProps) {
  const grid = getMonthGrid(dateStr);

  // Agrupar citas por fecha
  const appointmentsByDate = appointments.reduce<Record<string, AppointmentListItem[]>>(
    (acc, apt) => {
      const key = toDateStr(new Date(apt.start_time));
      if (!acc[key]) acc[key] = [];
      acc[key].push(apt);
      return acc;
    },
    {}
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header con días de la semana */}
      <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/50">
        {DAY_NAMES_SHORT.map((day) => (
          <div
            key={day}
            className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wide"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Grid de 6 filas × 7 columnas */}
      <div className="grid grid-cols-7 grid-rows-6">
        {grid.map((cell) => {
          const dayApts = appointmentsByDate[cell.dateStr] ?? [];
          const dayNum = parseDateStr(cell.dateStr).getDate();
          const visibleApts = dayApts.slice(0, 3);
          const remaining = dayApts.length - visibleApts.length;

          return (
            <div
              key={cell.dateStr}
              onClick={() => onDateClick(cell.dateStr)}
              className={`
                border-r border-b border-gray-100 last:border-r-0 p-1.5 min-h-[90px] cursor-pointer
                hover:bg-gray-50 transition-colors
                ${!cell.inCurrentMonth ? 'bg-gray-50/30' : ''}
                ${cell.isToday ? 'bg-emerald-50/40' : ''}
              `}
            >
              {/* Número del día */}
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`
                    text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full
                    ${cell.isToday
                      ? 'bg-emerald-600 text-white'
                      : cell.inCurrentMonth
                      ? 'text-gray-700'
                      : 'text-gray-300'}
                  `}
                >
                  {dayNum}
                </span>
                {dayApts.length > 0 && (
                  <span className="text-[9px] text-gray-400 font-medium">
                    {dayApts.length}
                  </span>
                )}
              </div>

              {/* Citas del día */}
              <div className="space-y-0.5">
                {visibleApts.map((apt) => {
                  const color = apt.status?.color ?? '#94a3b8';
                  return (
                    <button
                      key={apt.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAppointmentClick(apt);
                      }}
                      className="w-full text-left px-1 py-0.5 rounded text-[10px] truncate hover:ring-1 hover:ring-gray-200 transition-all"
                      style={{
                        backgroundColor: `${color}20`,
                        color,
                      }}
                    >
                      <span className="font-semibold">{formatTime(apt.start_time)}</span>{' '}
                      <span className="text-gray-700 font-normal">
                        {apt.patient?.full_name?.split(' ')[0] ?? '?'}
                      </span>
                    </button>
                  );
                })}

                {remaining > 0 && (
                  <div className="text-[9px] text-gray-400 font-medium px-1">
                    + {remaining} más
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}