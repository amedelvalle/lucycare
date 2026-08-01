/**
 * Hook del Dashboard — S3-07
 * Carga datos del panel: doctor, citas de hoy, próximas 48h, métricas.
 *
 * El doctor se resuelve vía useClinicContext (convención del panel): para un
 * médico es su propio doctor; para un asistente es el doctor ACTIVO de su
 * clínica (multi-doctor S5-07). Antes hacía un lookup inline de `doctors` por
 * profile_id del logueado, que NUNCA existía para un asistente → el home del
 * panel reventaba con "No se encontró perfil de doctor" (bug pre-existente,
 * destapado por Identidad múltiple Fase 1).
 */

import { useQuery } from '@tanstack/react-query'
import {
  getTodayAppointments,
  getUpcomingAppointments,
  getWeeklyStats,
  getRecentPatientCancellations,
} from '../services/dashboard.service'
import { useClinicContext } from './useClinicContext'

export function useDashboard() {
  // ─── 1. Doctor activo desde el contexto del panel (doctor o asistente) ───
  const {
    data: ctx,
    isLoading: isDoctorLoading,
    error: doctorError,
  } = useClinicContext()

  const doctor = ctx
    ? { id: ctx.doctorId, clinic_id: ctx.clinicId, profile_id: ctx.profileId }
    : undefined
  const doctorId = ctx?.doctorId
  const clinicId = ctx?.clinicId

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

  // ─── 5. Cancelaciones recientes hechas por pacientes (s7_70) ───
  // La RPC NO recibe doctorId: lo deriva de auth.uid() server-side. El
  // `enabled` solo evita una llamada inútil antes de resolver el contexto.
  const {
    data: recentCancellations = [],
    isLoading: isCancellationsLoading,
  } = useQuery({
    queryKey: ['dashboard-recent-cancellations', doctorId],
    queryFn: getRecentPatientCancellations,
    enabled: !!doctorId,
    refetchInterval: 1000 * 60 * 5,
  })

  return {
    doctor,
    todayAppointments,
    upcomingAppointments,
    recentCancellations,
    isCancellationsLoading,
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
