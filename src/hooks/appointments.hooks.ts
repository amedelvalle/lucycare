// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/hooks/appointments.hooks.ts
// ACCIÓN: NUEVO — crear archivo en carpeta hooks
// ═══════════════════════════════════════════════════════════

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAppointmentsByDate,
  getAppointmentStatuses,
  updateAppointmentStatus,
} from '@/services/appointments.service';

// ─── Query Keys ──────────────────────────────────────────────────────
export const appointmentKeys = {
  all: ['appointments'] as const,
  byDate: (doctorId: string, date: string) =>
    [...appointmentKeys.all, 'by-date', doctorId, date] as const,
  statuses: ['appointment-statuses'] as const,
};

// ─── Hooks ───────────────────────────────────────────────────────────

/**
 * Citas de un doctor para una fecha
 */
export function useAppointmentsByDate(
  doctorId: string | undefined,
  date: string
) {
  return useQuery({
    queryKey: appointmentKeys.byDate(doctorId ?? '', date),
    queryFn: () => getAppointmentsByDate(doctorId!, date),
    enabled: !!doctorId && !!date,
    refetchInterval: 30000, // Refrescar cada 30s (simula realtime básico)
  });
}

/**
 * Catálogo de estados de cita
 */
export function useAppointmentStatuses() {
  return useQuery({
    queryKey: appointmentKeys.statuses,
    queryFn: getAppointmentStatuses,
    staleTime: 1000 * 60 * 30, // Catálogo, cambia poco
  });
}

/**
 * Cambiar estado de una cita
 */
export function useUpdateAppointmentStatus(doctorId: string, date: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      appointmentId,
      statusId,
      cancellationReason,
      oldStatusName,
      newStatusName,
    }: {
      appointmentId: string;
      statusId: string;
      cancellationReason?: string;
      oldStatusName?: string;
      newStatusName?: string;
    }) =>
      updateAppointmentStatus(appointmentId, statusId, {
        cancellationReason,
        oldStatusName,
        newStatusName,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.byDate(doctorId, date),
      });
    },
  });
}
