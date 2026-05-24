/**
 * Dashboard Home — Panel Médico (S3-07)
 * Página principal: saludo, métricas, citas de hoy, próximas 48h.
 *
 * ACCIÓN: REEMPLAZAR el archivo existente
 * RUTA:   src/pages/panel/home/page.tsx
 */

import { Link } from 'react-router-dom'
import { useDashboard } from '../../../hooks/useDashboard'
import { useMyDoctorProfile } from '../../../hooks/useDoctorProfile'
import { useClinicContext } from '../../../hooks/useClinicContext'
import { StatCard } from './components/StatCard'
import { TodayAppointments } from './components/TodayAppointments'
import { UpcomingAppointments } from './components/UpcomingAppointments'

export default function PanelHomePage() {
  const {
    todayAppointments,
    upcomingAppointments,
    stats,
    isLoading,
    isDoctorLoading,
    error,
  } = useDashboard()

  // Banner "Completá con foto" cuando el médico logueado todavía no subió foto.
  // Solo aplica al rol doctor; asistentes no ven su propio perfil público.
  const { data: ctx } = useClinicContext()
  const { data: myProfile } = useMyDoctorProfile()
  const showAvatarBanner = ctx?.role === 'doctor' && !!myProfile && !myProfile.avatar_url

  // ── Error ──
  if (error) {
    return (
      <div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <h3 className="text-red-800 font-medium">Error al cargar el dashboard</h3>
          <p className="text-red-600 text-sm mt-1">
            No se pudo obtener la información del médico.
            Verifica que tu cuenta esté vinculada correctamente.
          </p>
          <p className="text-red-400 text-xs mt-2 font-mono">
            {error instanceof Error ? error.message : 'Error desconocido'}
          </p>
        </div>
      </div>
    )
  }

  // ── Saludo dinámico ──
  const hour = new Date().getHours()
  let greeting = 'Buenos días'
  if (hour >= 12 && hour < 18) greeting = 'Buenas tardes'
  else if (hour >= 18) greeting = 'Buenas noches'

  const today = new Date().toLocaleDateString('es-SV', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div>
        {isDoctorLoading ? (
          <div className="animate-pulse">
            <div className="w-48 h-7 bg-gray-200 rounded" />
            <div className="w-64 h-4 bg-gray-100 rounded mt-2" />
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-gray-900">{greeting} 👋</h1>
            <p className="text-gray-500 text-sm mt-1 capitalize">{today}</p>
          </>
        )}
      </div>

      {/* ── Banner: completá con foto ── */}
      {showAvatarBanner && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center flex-shrink-0 border border-amber-200">
            <i className="ri-camera-line text-xl text-amber-700"></i>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-900">Completá tu perfil con una foto</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Los pacientes confían más en perfiles con foto. Tarda menos de un minuto.
            </p>
          </div>
          <Link
            to="/panel/perfil"
            className="px-4 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition-colors text-sm whitespace-nowrap"
          >
            Subir foto
          </Link>
        </div>
      )}

      {/* ── 4 Métricas ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label="Citas hoy"
          value={isLoading ? '—' : stats.citasHoy}
          icon="ri-calendar-check-line"
          accentColor="text-blue-600 bg-blue-50"
        />
        <StatCard
          label="Esta semana"
          value={isLoading ? '—' : stats.citasSemana}
          icon="ri-bar-chart-line"
          accentColor="text-indigo-600 bg-indigo-50"
        />
        <StatCard
          label="Pacientes nuevos"
          value={isLoading ? '—' : stats.pacientesNuevos}
          subtitle="esta semana"
          icon="ri-user-add-line"
          accentColor="text-emerald-700 bg-emerald-50"
        />
        <StatCard
          label="Asistencia"
          value={isLoading ? '—' : `${stats.tasaAsistencia}%`}
          subtitle="últimas 4 semanas"
          icon="ri-check-double-line"
          accentColor="text-amber-600 bg-amber-50"
        />
      </div>

      {/* ── Citas hoy + Próximas 48h ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2">
          <TodayAppointments
            appointments={todayAppointments}
            isLoading={isLoading}
          />
        </div>
        <div>
          <UpcomingAppointments
            appointments={upcomingAppointments}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  )
}
