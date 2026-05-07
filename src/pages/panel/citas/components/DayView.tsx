// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/pages/panel/citas/components/DayView.tsx
// ═══════════════════════════════════════════════════════════
// Vista de día: eje horario a la izquierda + columna de citas.

import type { AppointmentListItem } from '@/services/appointments.service';
import CalendarAppointmentBlock from './CalendarAppointmentBlock';
import {
  getHourLabels,
  formatHourLabel,
  SLOT_HEIGHT_PX,
  SLOT_MINUTES,
  toDateStr,
  getToday,
} from '@/utils/calendar';

interface DayViewProps {
  dateStr: string;
  appointments: AppointmentListItem[];
  onAppointmentClick: (appointment: AppointmentListItem) => void;
}

export default function DayView({
  dateStr,
  appointments,
  onAppointmentClick,
}: DayViewProps) {
  const hours = getHourLabels();
  const slotsPerHour = 60 / SLOT_MINUTES;

  // Filtrar solo citas de este día
  const dayAppointments = appointments.filter(
    (a) => toDateStr(new Date(a.start_time)) === dateStr
  );

  const isToday = dateStr === getToday();

  // Línea de hora actual (solo si es hoy)
  const currentTimeLine = isToday ? getCurrentTimePosition() : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex">
        {/* Columna de horas */}
        <div className="flex-shrink-0 w-16 border-r border-gray-100 bg-gray-50/50">
          <div className="h-8 border-b border-gray-100" />
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

        {/* Columna principal */}
        <div className="flex-1 relative">
          {/* Header */}
          <div
            className={`h-8 border-b border-gray-100 flex items-center justify-center text-xs font-medium ${
              isToday ? 'text-emerald-700 bg-emerald-50/50' : 'text-gray-500'
            }`}
          >
            {isToday ? 'Hoy' : 'Día seleccionado'}
          </div>

          {/* Grid de slots */}
          <div className="relative">
            {hours.slice(0, -1).map((hour) => (
              <div key={hour}>
                {Array.from({ length: slotsPerHour }).map((_, i) => (
                  <div
                    key={i}
                    className={`border-b ${i === slotsPerHour - 1 ? 'border-gray-100' : 'border-gray-50'}`}
                    style={{ height: `${SLOT_HEIGHT_PX}px` }}
                  />
                ))}
              </div>
            ))}

            {/* Línea de hora actual */}
            {currentTimeLine !== null && (
              <div
                className="absolute left-0 right-0 z-20 pointer-events-none"
                style={{ top: `${currentTimeLine}px` }}
              >
                <div className="relative">
                  <div className="absolute -left-1 -top-1.5 w-3 h-3 rounded-full bg-red-500" />
                  <div className="h-0.5 bg-red-500" />
                </div>
              </div>
            )}

            {/* Citas */}
            {dayAppointments.map((apt) => (
              <CalendarAppointmentBlock
                key={apt.id}
                appointment={apt}
                onClick={onAppointmentClick}
              />
            ))}

            {/* Estado vacío */}
            {dayAppointments.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <svg className="w-10 h-10 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                    d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                <p className="text-xs text-gray-400 mt-2">Sin citas para este día</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────

function getCurrentTimePosition(): number | null {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  if (hours < 6 || hours >= 22) return null;

  const minutesFromStart = (hours - 6) * 60 + minutes;
  const slotsFromStart = minutesFromStart / SLOT_MINUTES;
  return slotsFromStart * SLOT_HEIGHT_PX;
}