/**
 * Hooks para el motor de agenda y booking.
 */

import { useQuery } from '@tanstack/react-query'
import { getAvailableSlots, getAvailableDays } from '../services/slots.service'

/**
 * Hook para obtener slots disponibles de un doctor en una fecha.
 */
export function useAvailableSlots(doctorId: string | undefined, date: string | null) {
  return useQuery({
    queryKey: ['slots', doctorId, date],
    queryFn: () => getAvailableSlots(doctorId!, date!),
    enabled: !!doctorId && !!date,
    staleTime: 1000 * 30, // 30 seg — los slots cambian frecuentemente
  })
}

/**
 * Hook para obtener los próximos días con disponibilidad.
 */
export function useAvailableDays(doctorId: string | undefined, daysAhead?: number) {
  return useQuery({
    queryKey: ['availableDays', doctorId, daysAhead],
    queryFn: () => getAvailableDays(doctorId!, daysAhead),
    enabled: !!doctorId,
    staleTime: 1000 * 60 * 5, // 5 min
  })
}
