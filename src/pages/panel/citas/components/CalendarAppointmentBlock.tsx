// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/pages/panel/citas/components/CalendarAppointmentBlock.tsx
// ═══════════════════════════════════════════════════════════
// Bloque visual de una cita en el grid de Día o Semana.

import type { AppointmentListItem } from '@/services/appointments.service';
import { getAppointmentPosition, formatTime } from '@/utils/calendar';

interface CalendarAppointmentBlockProps {
  appointment: AppointmentListItem;
  onClick: (appointment: AppointmentListItem) => void;
  compact?: boolean;
}

export default function CalendarAppointmentBlock({
  appointment,
  onClick,
  compact = false,
}: CalendarAppointmentBlockProps) {
  const { top, height } = getAppointmentPosition(
    appointment.start_time,
    appointment.end_time
  );

  const color = appointment.status?.color ?? '#94a3b8';
  const isFinal = appointment.status?.is_final ?? false;

  return (
    <button
      onClick={() => onClick(appointment)}
      className={`absolute left-1 right-1 rounded-md px-2 py-1 text-left overflow-hidden transition-all hover:shadow-md hover:z-10 ${
        isFinal ? 'opacity-70' : ''
      }`}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        backgroundColor: `${color}20`,
        borderLeft: `3px solid ${color}`,
        minHeight: '20px',
      }}
    >
      <div className={`flex ${compact ? 'flex-col' : 'flex-col'} gap-0.5 text-[11px] leading-tight`}>
        <p className="font-semibold text-gray-900 truncate" style={{ color }}>
          {formatTime(appointment.start_time)}
        </p>
        <p className="font-medium text-gray-800 truncate">
          {appointment.patient?.full_name ?? 'Sin paciente'}
        </p>
        {!compact && height > 40 && appointment.service && (
          <p className="text-gray-500 truncate">{appointment.service.name}</p>
        )}
      </div>
    </button>
  );
}