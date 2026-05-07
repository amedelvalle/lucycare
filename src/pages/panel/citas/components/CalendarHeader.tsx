// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/pages/panel/citas/components/CalendarHeader.tsx
// ═══════════════════════════════════════════════════════════
// Header del calendario: navegación (anterior / hoy / siguiente) + selector de vista.

import {
  formatDayLabel,
  formatWeekLabel,
  formatMonthLabel,
  type CalendarViewMode,
} from '@/utils/calendar';

interface CalendarHeaderProps {
  currentDate: string;
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  isToday: boolean;
}

export default function CalendarHeader({
  currentDate,
  viewMode,
  onViewModeChange,
  onPrev,
  onNext,
  onToday,
  isToday,
}: CalendarHeaderProps) {
  const label =
    viewMode === 'day'
      ? formatDayLabel(currentDate)
      : viewMode === 'week'
      ? formatWeekLabel(currentDate)
      : formatMonthLabel(currentDate);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Navegación */}
        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Anterior"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <button
            onClick={onNext}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Siguiente"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
          {!isToday && (
            <button
              onClick={onToday}
              className="ml-1 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors"
            >
              Hoy
            </button>
          )}
        </div>

        {/* Título central */}
        <div className="flex-1 text-center min-w-0">
          <p className="text-base font-semibold text-gray-900 capitalize truncate">
            {label}
          </p>
        </div>

        {/* Selector de vista */}
        <div className="inline-flex bg-gray-100 rounded-lg p-1">
          {(['day', 'week', 'month'] as CalendarViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => onViewModeChange(mode)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                viewMode === mode
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {mode === 'day' ? 'Día' : mode === 'week' ? 'Semana' : 'Mes'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}