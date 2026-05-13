import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { computeCalendarHours } from '@/utils/calendar';

/**
 * Obtiene el rango de horas que debería mostrar el grid del calendario,
 * derivado de availability_rules del doctor.
 *
 * Ejemplo:
 *   - Doctor con rules Lun-Vie 8:00-16:00 → grid 7-17 (con buffer)
 *   - Doctor con rule Mié 7:00-14:00 + Sab 9:00-12:00 → grid 6-15
 *   - Sin rules → grid 8-17 (default)
 */
export function useDoctorCalendarHours(doctorId: string | undefined) {
  return useQuery({
    queryKey: ['doctor-calendar-hours', doctorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability_rules')
        .select('start_time, end_time, is_active')
        .eq('doctor_id', doctorId!)
        .eq('is_active', true);
      if (error) throw error;

      const rules = (data ?? []).map((r) => ({
        startTime: r.start_time,
        endTime: r.end_time,
        isActive: r.is_active,
      }));
      return computeCalendarHours(rules);
    },
    enabled: !!doctorId,
    staleTime: 1000 * 60 * 10, // Cambia poco
  });
}
