// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/services/calendar.service.ts
// ACCIÓN: NUEVO — crear archivo
// ═══════════════════════════════════════════════════════════
// Este servicio reutiliza getAppointmentsByRange de appointments.service.ts
// y agrega helpers específicos de calendario. No duplica la query.

import { getAppointmentsByRange } from '@/services/appointments.service';
import type { AppointmentListItem } from '@/services/appointments.service';

/**
 * Citas dentro de un rango de fechas (día, semana o mes).
 * Wrapper sobre getAppointmentsByRange para claridad semántica en el calendario.
 */
export async function getCalendarAppointments(
  doctorId: string,
  dateFrom: string, // 'YYYY-MM-DD'
  dateTo: string    // 'YYYY-MM-DD'
): Promise<AppointmentListItem[]> {
  return getAppointmentsByRange(doctorId, dateFrom, dateTo);
}

// Re-export del tipo para no acoplar el calendario al service original
export type { AppointmentListItem } from '@/services/appointments.service';
