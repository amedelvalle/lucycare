// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/pages/panel/citas/components/WeekView.tsx
// ═══════════════════════════════════════════════════════════
// Vista semanal: 7 columnas (Lun–Dom) × grid horario.

import type { AppointmentListItem } from '@/services/appointments.service';
import CalendarAppointmentBlock from './CalendarAppointmentBlock';
import {
  getHourLabels,
  formatHourLabel,
  getWeekDates,
  parseDateStr,
  toDateStr,
  getToday,
  DAY_NAMES_SHORT,
  SLOT_HEIGHT_PX,
  SLOT_MINUTES,
} from '@/utils/calendar';

interface WeekViewProps {
  dateStr: string;
  appointments: AppointmentListItem[];
  onAppointmentClick: (appointment: AppointmentListItem) => void;
  startHour?: number;
  endHour?: number;
}

export default function WeekView({
  dateStr,
  appointments,
  onAppointmentClick,
  startHour = 6,
  endHour = 22,
}: WeekViewProps) {
  const hours = getHourLabels(startHour, endHour);
  const slotsPerHour = 60 / SLOT_MINUTES;
  const weekDates = getWeekDates(dateStr);
  const today = getToday();

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
      <div className="flex">
        {/* Columna de horas */}
        <div className="flex-shrink-0 w-14 border-r border-gray-100 bg-gray-50/50">
          <div className="h-12 border-b border-gray-100" />
          {hours.slice(0, -1).map((hour) => (
            <div
              key={hour}
              className="border-b border-gray-100 flex items-start justify-end pr-2 pt-1"
              style={{ height: `${SLOT_HEIGHT_PX * slotsPerHour}px` }}
            >
              <span className="text-[10px] text-gray-400 font-medium">
                {formatHourLabel(hour)}
              </span>
            </div>
          ))}
        </div>

        {/* 7 columnas de días */}
        <div className="flex-1 grid grid-cols-7 min-w-0 overflow-x-auto">
          {weekDates.map((dayDate) => {
            const isToday = dayDate === today;
            const dayObj = parseDateStr(dayDate);
            const dayIndex = (dayObj.getDay() + 6) % 7;
            const dayApts = appointmentsByDate[dayDate] ?? [];

            return (
              <div
                key={dayDate}
                className="border-r border-gray-100 last:border-r-0 relative"
              >
                {/* Header día */}
                <div
                  className={`h-12 border-b border-gray-100 flex flex-col items-center justify-center ${
                    isToday ? 'bg-emerald-50/50' : ''
                  }`}
                >
                  <span className="text-[10px] text-gray-400 uppercase font-medium">
                    {DAY_NAMES_SHORT[dayIndex]}
                  </span>
                  <span
                    className={`text-sm font-semibold ${
                      isToday ? 'text-emerald-700' : 'text-gray-700'
                    }`}
                  >
                    {dayObj.getDate()}
                  </span>
                </div>

                {/* Grid de slots */}
                <div className="relative">
                  {hours.slice(0, -1).map((hour) => (
                    <div key={hour}>
                      {Array.from({ length: slotsPerHour }).map((_, i) => (
                        <div
                          key={i}
                          className={`border-b ${
                            i === slotsPerHour - 1 ? 'border-gray-100' : 'border-gray-50'
                          }`}
                          style={{ height: `${SLOT_HEIGHT_PX}px` }}
                        />
                      ))}
                    </div>
                  ))}

                  {/* Línea de hora actual solo en columna de hoy */}
                  {isToday && <CurrentTimeLine startHour={startHour} endHour={endHour} />}

                  {/* Citas */}
                  {dayApts.map((apt) => (
                    <CalendarAppointmentBlock
                      key={apt.id}
                      appointment={apt}
                      onClick={onAppointmentClick}
                      compact
                      gridStartHour={startHour}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────

function CurrentTimeLine({ startHour, endHour }: { startHour: number; endHour: number }) {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  if (hours < startHour || hours >= endHour) return null;

  const minutesFromStart = (hours - startHour) * 60 + minutes;
  const top = (minutesFromStart / SLOT_MINUTES) * SLOT_HEIGHT_PX;

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none"
      style={{ top: `${top}px` }}
    >
      <div className="relative">
        <div className="absolute -left-1 -top-1.5 w-2.5 h-2.5 rounded-full bg-red-500" />
        <div className="h-0.5 bg-red-500" />
      </div>
    </div>
  );
}