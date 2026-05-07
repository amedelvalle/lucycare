import type { AppointmentListItem, AppointmentStatus } from '@/services/appointments.service';
import { canTransitionTo } from '@/services/appointments.service';

interface QuickActionsProps {
  appointment: AppointmentListItem;
  statuses: AppointmentStatus[];
  onAction: (statusId: string, statusName: string) => void;
  isUpdating: boolean;
}

// Transiciones válidas por nombre de estado (espejo del service, solo para render)
const VALID_TRANSITIONS: Record<string, string[]> = {
  programada: ['confirmada', 'cancelada'],
  confirmada:  ['en_sala', 'cancelada'],
  en_sala:     ['atendida', 'no_asistio', 'cancelada'],
};

// Estilo visual por nombre de estado destino
const ACTION_STYLE: Record<string, { label: string; classes: string }> = {
  confirmada:  { label: 'Confirmar cita',      classes: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
  en_sala:     { label: 'Pasar a sala',         classes: 'bg-blue-600 hover:bg-blue-700 text-white' },
  atendida:    { label: 'Marcar como atendida', classes: 'bg-green-600 hover:bg-green-700 text-white' },
  no_asistio:  { label: 'No asistió',           classes: 'bg-amber-500 hover:bg-amber-600 text-white' },
  cancelada:   { label: 'Cancelar cita',        classes: 'bg-white hover:bg-red-50 text-red-600 border border-red-300' },
};

export default function QuickActions({
  appointment,
  statuses,
  onAction,
  isUpdating,
}: QuickActionsProps) {
  const currentName = appointment.status?.name ?? '';
  const nextNames = VALID_TRANSITIONS[currentName] ?? [];

  if (nextNames.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Acciones
      </p>
      <div className="flex flex-col gap-2">
        {nextNames.map((targetName) => {
          const targetStatus = statuses.find((s) => s.name === targetName);
          if (!targetStatus) return null;

          const style = ACTION_STYLE[targetName] ?? {
            label: targetStatus.display_name,
            classes: 'bg-gray-100 hover:bg-gray-200 text-gray-700',
          };

          const validation = canTransitionTo(
            currentName,
            targetName,
            appointment.start_time
          );

          return (
            <button
              key={targetStatus.id}
              type="button"
              disabled={isUpdating || !validation.allowed}
              onClick={() => onAction(targetStatus.id, targetName)}
              title={!validation.allowed ? validation.reason : undefined}
              className={`
                w-full px-4 py-2.5 rounded-lg text-sm font-medium
                transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                ${style.classes}
              `}
            >
              {isUpdating ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Guardando...
                </span>
              ) : (
                style.label
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
