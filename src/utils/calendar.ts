// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/utils/calendar.ts
// ACCIÓN: NUEVO — crear archivo
// ═══════════════════════════════════════════════════════════
// Helpers de fecha para el calendario del panel médico.
// Todas las fechas se manejan en 'YYYY-MM-DD' (local) para consistencia
// con los filtros de Supabase en appointments.service.ts.

export type CalendarViewMode = 'day' | 'week' | 'month';

// ─── Constantes ──────────────────────────────────────────────

/** Hora de inicio del grid de día/semana */
export const DAY_START_HOUR = 6;
/** Hora de fin del grid de día/semana */
export const DAY_END_HOUR = 22;
/** Minutos por slot en el grid (coincide con slot_duration_min default) */
export const SLOT_MINUTES = 30;
/** Alto de cada slot en pixels */
export const SLOT_HEIGHT_PX = 32;

/** Nombres de días de la semana (L a D) */
export const DAY_NAMES_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const DAY_NAMES_LONG = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// ─── Helpers de conversión ───────────────────────────────────

/** Hoy en formato YYYY-MM-DD */
export function getToday(): string {
  return toDateStr(new Date());
}

/** Convierte Date a YYYY-MM-DD (respeta zona local, no UTC) */
export function toDateStr(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Convierte YYYY-MM-DD a Date (mediodía local para evitar bugs de timezone) */
export function parseDateStr(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00');
}

// ─── Helpers de rango ────────────────────────────────────────

/** Primer día de la semana que contiene la fecha (Lunes) */
export function getWeekStart(dateStr: string): string {
  const d = parseDateStr(dateStr);
  const day = d.getDay(); // 0=dom...6=sab
  const diff = day === 0 ? -6 : 1 - day; // retroceder al lunes
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

/** Último día de la semana (Domingo) */
export function getWeekEnd(dateStr: string): string {
  const start = getWeekStart(dateStr);
  const d = parseDateStr(start);
  d.setDate(d.getDate() + 6);
  return toDateStr(d);
}

/** Array de 7 fechas de la semana que contiene dateStr (Lun a Dom) */
export function getWeekDates(dateStr: string): string[] {
  const start = getWeekStart(dateStr);
  const result: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = parseDateStr(start);
    d.setDate(d.getDate() + i);
    result.push(toDateStr(d));
  }
  return result;
}

/** Primer día del mes */
export function getMonthStart(dateStr: string): string {
  const d = parseDateStr(dateStr);
  d.setDate(1);
  return toDateStr(d);
}

/** Último día del mes */
export function getMonthEnd(dateStr: string): string {
  const d = parseDateStr(dateStr);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return toDateStr(d);
}

/**
 * Matriz de días para un grid de mes (6 semanas × 7 días = 42 celdas).
 * Incluye días del mes anterior y siguiente para completar el grid.
 */
export function getMonthGrid(dateStr: string): Array<{
  dateStr: string;
  inCurrentMonth: boolean;
  isToday: boolean;
}> {
  const monthStart = getMonthStart(dateStr);
  const gridStart = getWeekStart(monthStart);
  const today = getToday();
  const currentMonth = parseDateStr(dateStr).getMonth();

  const result = [];
  for (let i = 0; i < 42; i++) {
    const d = parseDateStr(gridStart);
    d.setDate(d.getDate() + i);
    const cellDateStr = toDateStr(d);
    result.push({
      dateStr: cellDateStr,
      inCurrentMonth: d.getMonth() === currentMonth,
      isToday: cellDateStr === today,
    });
  }
  return result;
}

// ─── Helpers de navegación ───────────────────────────────────

/** Navegar día, semana o mes adelante/atrás */
export function shiftDate(
  dateStr: string,
  viewMode: CalendarViewMode,
  direction: 'prev' | 'next'
): string {
  const d = parseDateStr(dateStr);
  const delta = direction === 'next' ? 1 : -1;

  if (viewMode === 'day') {
    d.setDate(d.getDate() + delta);
  } else if (viewMode === 'week') {
    d.setDate(d.getDate() + delta * 7);
  } else if (viewMode === 'month') {
    d.setMonth(d.getMonth() + delta);
  }

  return toDateStr(d);
}

// ─── Helpers del grid horario ────────────────────────────────

/**
 * Array de horas visibles en el grid (ej: [6, 7, 8, ..., 22]).
 * Acepta rango custom — útil para adaptar al horario del doctor.
 */
export function getHourLabels(
  startHour: number = DAY_START_HOUR,
  endHour: number = DAY_END_HOUR
): number[] {
  const result: number[] = [];
  for (let h = startHour; h <= endHour; h++) {
    result.push(h);
  }
  return result;
}

/**
 * Array de todos los slots del día en formato HH:MM (ej: ['06:00', '06:30', ...])
 */
export function getSlotLabels(
  startHour: number = DAY_START_HOUR,
  endHour: number = DAY_END_HOUR
): string[] {
  const result: string[] = [];
  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += SLOT_MINUTES) {
      result.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return result;
}

/**
 * Calcula la posición Y (en pixels) y altura (en pixels) de una cita en el grid.
 */
export function getAppointmentPosition(
  startTime: string,
  endTime: string,
  gridStartHour: number = DAY_START_HOUR
): { top: number; height: number } {
  const start = new Date(startTime);
  const end = new Date(endTime);

  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const gridStartMinutes = gridStartHour * 60;

  const slotsFromStart = (startMinutes - gridStartMinutes) / SLOT_MINUTES;
  const durationSlots = (endMinutes - startMinutes) / SLOT_MINUTES;

  return {
    top: slotsFromStart * SLOT_HEIGHT_PX,
    height: Math.max(durationSlots * SLOT_HEIGHT_PX, SLOT_HEIGHT_PX / 2),
  };
}

/**
 * Calcula el rango horario apropiado para mostrar el grid del calendario
 * basado en las reglas de availability del doctor.
 *
 * - Si no hay reglas: 8am-5pm (default)
 * - Con reglas: min/max ± 1h de buffer (suelo 6am, techo 22h)
 */
export function computeCalendarHours(
  rules: Array<{ startTime: string; endTime: string; isActive?: boolean }>
): { startHour: number; endHour: number } {
  const active = rules.filter((r) => r.isActive !== false);
  if (active.length === 0) return { startHour: 8, endHour: 17 };

  let minHour = 24;
  let maxHour = 0;
  for (const r of active) {
    const startH = parseInt(r.startTime.split(':')[0], 10);
    const endH = parseInt(r.endTime.split(':')[0], 10);
    const endM = parseInt(r.endTime.split(':')[1] ?? '0', 10);
    // Si termina exactamente en HH:00, end hour es HH; sino redondea hacia arriba
    const endHourCeil = endM > 0 ? endH + 1 : endH;
    if (startH < minHour) minHour = startH;
    if (endHourCeil > maxHour) maxHour = endHourCeil;
  }

  // Buffer de 1h a cada lado, dentro de límites razonables
  return {
    startHour: Math.max(6, minHour - 1),
    endHour: Math.min(22, maxHour + 1),
  };
}

// ─── Formateo ────────────────────────────────────────────────

/** "Viernes, 17 de abril" */
export function formatDayLabel(dateStr: string): string {
  const d = parseDateStr(dateStr);
  return d.toLocaleDateString('es-SV', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** "Abril 2026" */
export function formatMonthLabel(dateStr: string): string {
  const d = parseDateStr(dateStr);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** "14 – 20 de Abril 2026" para vista semanal */
export function formatWeekLabel(dateStr: string): string {
  const start = parseDateStr(getWeekStart(dateStr));
  const end = parseDateStr(getWeekEnd(dateStr));
  const sameMonth = start.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${start.getDate()} – ${end.getDate()} de ${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`;
  }
  return `${start.getDate()} ${MONTH_NAMES[start.getMonth()]} – ${end.getDate()} ${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`;
}

/** "2:30 PM" */
export function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('es-SV', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** "14h" o "2 PM" para el eje horario */
export function formatHourLabel(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display} ${period}`;
}
