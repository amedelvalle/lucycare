
// Utilidades de fecha/hora para El Salvador
const SV_TIMEZONE = 'America/El_Salvador';
const SV_LOCALE = 'es-SV';

/**
 * Genera un slot futuro a partir de días adelante y hora específica
 * @param daysAhead - Días desde hoy
 * @param hour - Hora (0-23)
 * @param minute - Minuto (0-59)
 * @returns ISO string en timezone de El Salvador
 */
export function makeFutureSlot(daysAhead: number, hour: number, minute: number): string {
  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + daysAhead);
  future.setHours(hour, minute, 0, 0);
  
  // Asegurar que sea futuro
  if (future <= now) {
    future.setDate(future.getDate() + 1);
  }
  
  return future.toISOString();
}

/**
 * Formatea una fecha para mostrar "Próximo disponible" o fecha completa
 * DEVUELVE UN STRING COMPLETO - NO UN OBJETO
 * @param dateString - ISO string o Date
 * @returns String formateado (ej: "Hoy, 10:00 a. m." o "sábado 25 de enero, 10:00 a. m.")
 */
export function formatNextSlot(dateString?: string | Date): string {
  if (!dateString) return '';
  
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const slotDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  
  const isToday = slotDate.getTime() === today.getTime();
  const isTomorrow = slotDate.getTime() === tomorrow.getTime();
  const isDifferentYear = date.getFullYear() !== now.getFullYear();
  
  // Formatear hora
  const timeStr = date.toLocaleTimeString(SV_LOCALE, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: SV_TIMEZONE
  });
  
  if (isToday) {
    return `Hoy, ${timeStr}`;
  }
  
  if (isTomorrow) {
    return `Mañana, ${timeStr}`;
  }
  
  // Formatear fecha
  const dateOptions: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: SV_TIMEZONE
  };
  
  // Incluir año si es diferente al actual
  if (isDifferentYear) {
    dateOptions.year = 'numeric';
  }
  
  const dateStr = date.toLocaleDateString(SV_LOCALE, dateOptions);
  
  return `${dateStr}, ${timeStr}`;
}

/**
 * Formatea una fecha y devuelve las partes separadas
 * USAR SOLO SI NECESITAS LABEL Y TIME POR SEPARADO
 * @param dateString - ISO string o Date
 * @returns Objeto con label, time y full
 */
export function formatNextSlotParts(dateString?: string | Date): { label: string; time: string; full: string } | null {
  if (!dateString) return null;
  
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const slotDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  
  const isToday = slotDate.getTime() === today.getTime();
  const isTomorrow = slotDate.getTime() === tomorrow.getTime();
  const isDifferentYear = date.getFullYear() !== now.getFullYear();
  
  // Formatear hora
  const timeStr = date.toLocaleTimeString(SV_LOCALE, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: SV_TIMEZONE
  });
  
  // Formatear fecha
  const dateOptions: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: SV_TIMEZONE
  };
  
  // Incluir año si es diferente al actual
  if (isDifferentYear) {
    dateOptions.year = 'numeric';
  }
  
  const dateStr = date.toLocaleDateString(SV_LOCALE, dateOptions);
  
  if (isToday) {
    return {
      label: 'Hoy',
      time: timeStr,
      full: `Hoy, ${timeStr}`
    };
  }
  
  if (isTomorrow) {
    return {
      label: 'Mañana',
      time: timeStr,
      full: `Mañana, ${timeStr}`
    };
  }
  
  return {
    label: dateStr,
    time: timeStr,
    full: `${dateStr}, ${timeStr}`
  };
}

/**
 * Formatea una fecha completa con hora para El Salvador
 * @param dateString - ISO string o Date
 * @returns String formateado
 */
export function formatFullDateTime(dateString: string | Date): string {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
  const now = new Date();
  const isDifferentYear = date.getFullYear() !== now.getFullYear();
  
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: SV_TIMEZONE
  };
  
  if (isDifferentYear) {
    options.year = 'numeric';
  }
  
  return date.toLocaleDateString(SV_LOCALE, options);
}

/**
 * Extrae solo la fecha (YYYY-MM-DD) de un ISO string
 * @param dateString - ISO string
 * @returns Fecha en formato YYYY-MM-DD
 */
export function extractDateOnly(dateString: string): string {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Obtiene la fecha mínima para el datepicker (hoy)
 * @returns Fecha en formato YYYY-MM-DD
 */
export function getMinDate(): string {
  return new Date().toISOString().split('T')[0];
}
