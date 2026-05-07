// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/hooks/useCalendarAppointments.ts
// ACCIÓN: NUEVO — crear archivo
// ═══════════════════════════════════════════════════════════
// Hook para obtener citas del calendario según la vista activa.
// Día   → rango de 1 día
// Semana → rango de 7 días (Lunes a Domingo)
// Mes    → rango del grid de mes (42 días, incluye días adyacentes)

import { useQuery } from '@tanstack/react-query';
import { getCalendarAppointments } from '@/services/calendar.service';
import {
  getWeekStart,
  getWeekEnd,
  getMonthStart,
  getMonthEnd,
  parseDateStr,
  toDateStr,
  type CalendarViewMode,
} from '@/utils/calendar';

// ─── Query Keys ──────────────────────────────────────────────

export const calendarKeys = {
  all: ['calendar-appointments'] as const,
  range: (doctorId: string, from: string, to: string) =>
    [...calendarKeys.all, doctorId, from, to] as const,
};

// ─── Helper: calcular rango según modo de vista ──────────────

function getRangeForView(
  dateStr: string,
  viewMode: CalendarViewMode
): { from: string; to: string } {
  if (viewMode === 'day') {
    return { from: dateStr, to: dateStr };
  }

  if (viewMode === 'week') {
    return {
      from: getWeekStart(dateStr),
      to: getWeekEnd(dateStr),
    };
  }

  // mes: usa el grid completo de 6 semanas (42 días)
  const monthStart = getMonthStart(dateStr);
  const gridStart = getWeekStart(monthStart);
  const d = parseDateStr(gridStart);
  d.setDate(d.getDate() + 41);
  return {
    from: gridStart,
    to: toDateStr(d),
  };
}

// ─── Hook principal ──────────────────────────────────────────

export function useCalendarAppointments(
  doctorId: string | undefined,
  dateStr: string,
  viewMode: CalendarViewMode
) {
  const { from, to } = getRangeForView(dateStr, viewMode);

  return useQuery({
    queryKey: calendarKeys.range(doctorId ?? '', from, to),
    queryFn: () => getCalendarAppointments(doctorId!, from, to),
    enabled: !!doctorId,
    refetchInterval: 30000, // Refrescar cada 30s (alineado con appointments.hooks.ts)
  });
}
