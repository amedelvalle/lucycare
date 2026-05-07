/**
 * Hook del Dashboard — S3-07
 * Carga datos del panel: doctor, citas de hoy, próximas 48h, métricas.
 *
 * ACCIÓN: CREAR este archivo nuevo
 * RUTA:   src/hooks/useDashboard.ts
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import {
  getDoctorByProfile,
  getTodayAppointments,
  getUpcomingAppointments,
  getWeeklyStats,
} from '../services/dashboard.service'

export function useDashboard() {
  // ─── 1. Obtener doctor_id del usuario autenticado ───
  const {
    data: doctor,
    isLoading: isDoctorLoading,
    error: doctorError,
  } = useQuery({
    queryKey: ['doctor-profile'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) throw new Error('No autenticado')
      return getDoctorByProfile(session.user.id)
    },
    staleTime: 1000 * 60 * 10,
    retry: 1,
  })

  const doctorId = doctor?.id
  const clinicId = doctor?.clinic_id

  // ─── 2. Citas de hoy ───
  const { data: todayAppointments = [], isLoading: isTodayLoading } = useQuery({
    queryKey: ['dashboard-today', doctorId],
    queryFn: () => getTodayAppointments(doctorId!),
    enabled: !!doctorId,
    refetchInterval: 1000 * 60,
  })

  // ─── 3. Citas próximas 48h ───
  const { data: upcomingAppointments = [], isLoading: isUpcomingLoading } = useQuery({
    queryKey: ['dashboard-upcoming', doctorId],
    queryFn: () => getUpcomingAppointments(doctorId!),
    enabled: !!doctorId,
    refetchInterval: 1000 * 60 * 5,
  })

  // ─── 4. Métricas semanales ───
  const { data: stats, isLoading: isStatsLoading } = useQuery({
    queryKey: ['dashboard-stats', doctorId, clinicId],
    queryFn: () => getWeeklyStats(doctorId!, clinicId!),
    enabled: !!doctorId && !!clinicId,
    refetchInterval: 1000 * 60 * 5,
  })

  return {
    doctor,
    todayAppointments,
    upcomingAppointments,
    stats: stats ?? {
      citasHoy: 0,
      citasSemana: 0,
      pacientesNuevos: 0,
      tasaAsistencia: 0,
    },
    isLoading: isDoctorLoading || isTodayLoading || isUpcomingLoading || isStatsLoading,
    isDoctorLoading,
    error: doctorError,
  }
}
