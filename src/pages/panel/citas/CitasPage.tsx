// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/pages/panel/citas/CitasPage.tsx
// ACCIÓN: NUEVO — crear archivo en carpeta citas
// ═══════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import {
  useAppointmentsByDate,
  useAppointmentStatuses,
  useUpdateAppointmentStatus,
} from '@/hooks/appointments.hooks';
import AppointmentCard from './AppointmentCard';
import { supabase } from '@/lib/supabase';

// ─── Iconos ──────────────────────────────────────────────────────────
const ChevronLeftIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
);

const CalendarIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
  </svg>
);

export default function CitasPage() {
  // ─── Doctor actual ─────────────────────────────────────────────
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [loadingDoctor, setLoadingDoctor] = useState(true);

  useEffect(() => {
    async function loadDoctor() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: doctor } = await supabase
          .from('doctors')
          .select('id')
          .eq('profile_id', user.id)
          .single();
        if (doctor) setDoctorId(doctor.id);
      } catch (err) {
        console.error('Error loading doctor:', err);
      } finally {
        setLoadingDoctor(false);
      }
    }
    loadDoctor();
  }, []);

  // ─── Fecha seleccionada ────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState(() => getToday());

  const isToday = selectedDate === getToday();

  // ─── Queries ───────────────────────────────────────────────────
  const {
    data: appointments = [],
    isLoading: loadingAppointments,
    isFetching,
  } = useAppointmentsByDate(doctorId ?? undefined, selectedDate);

  const { data: statuses = [] } = useAppointmentStatuses();

  const updateStatusMutation = useUpdateAppointmentStatus(
    doctorId ?? '',
    selectedDate
  );

  // ─── Handlers ──────────────────────────────────────────────────
  const goToday = useCallback(() => setSelectedDate(getToday()), []);

  const goPrev = useCallback(() => {
    setSelectedDate((prev) => {
      const d = new Date(prev + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      return toDateStr(d);
    });
  }, []);

  const goNext = useCallback(() => {
    setSelectedDate((prev) => {
      const d = new Date(prev + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      return toDateStr(d);
    });
  }, []);

  const handleChangeStatus = useCallback(
    (appointmentId: string, statusId: string) => {
      updateStatusMutation.mutate({ appointmentId, statusId });
    },
    [updateStatusMutation]
  );

  // ─── Stats rápidas ────────────────────────────────────────────
  const totalCitas = appointments.length;
  const pendientes = appointments.filter((a) => !a.status?.is_final).length;
  const atendidas = appointments.filter((a) => a.status?.name === 'atendida').length;
  const canceladas = appointments.filter(
    (a) => a.status?.name === 'cancelada' || a.status?.name === 'no_asistio'
  ).length;

  // ─── Loading ───────────────────────────────────────────────────
  if (loadingDoctor) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-24 bg-gray-100 rounded" />
          <div className="h-16 bg-gray-100 rounded" />
          <div className="h-16 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (!doctorId) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">No se encontró perfil de médico asociado a tu cuenta.</p>
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Citas</h1>
        <p className="text-sm text-gray-500 mt-1">
          Gestiona tus citas del día. Cambia el estado de cada cita según corresponda.
        </p>
      </div>

      {/* Navegación de fecha */}
      <div className="flex items-center justify-between mb-6 bg-white rounded-xl border border-gray-200 p-3">
        <button
          onClick={goPrev}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ChevronLeftIcon />
        </button>

        <div className="flex items-center gap-3">
          <CalendarIcon />
          <div className="text-center">
            <p className="text-base font-semibold text-gray-900">
              {formatDateDisplay(selectedDate)}
            </p>
            {isToday && (
              <span className="text-xs text-emerald-600 font-medium">Hoy</span>
            )}
          </div>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1 text-gray-600
              focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
          />
        </div>

        <div className="flex items-center gap-1">
          {!isToday && (
            <button
              onClick={goToday}
              className="px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors"
            >
              Hoy
            </button>
          )}
          <button
            onClick={goNext}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      {/* Stats rápidas */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <StatCard label="Total" value={totalCitas} color="text-gray-900" bg="bg-gray-50" />
        <StatCard label="Pendientes" value={pendientes} color="text-blue-700" bg="bg-blue-50" />
        <StatCard label="Atendidas" value={atendidas} color="text-emerald-700" bg="bg-emerald-50" />
        <StatCard label="Cancel/NS" value={canceladas} color="text-red-700" bg="bg-red-50" />
      </div>

      {/* Indicador de refresco */}
      {isFetching && !loadingAppointments && (
        <div className="mb-3 flex items-center gap-2 text-xs text-gray-400">
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Actualizando...
        </div>
      )}

      {/* Lista de citas */}
      {loadingAppointments ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-14 h-8 bg-gray-200 rounded" />
                <div className="w-10 h-10 bg-gray-200 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/3" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : appointments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <h3 className="mt-4 text-base font-medium text-gray-900">Sin citas para este día</h3>
          <p className="mt-1.5 text-sm text-gray-500 text-center max-w-sm">
            No hay citas agendadas para {formatDateDisplay(selectedDate)}.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {appointments.map((appointment) => (
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              statuses={statuses}
              onChangeStatus={handleChangeStatus}
              isUpdating={updateStatusMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-componente ──────────────────────────────────────────────────

function StatCard({ label, value, color, bg }: {
  label: string; value: number; color: string; bg: string;
}) {
  return (
    <div className={`${bg} rounded-lg p-3 text-center`}>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function formatDateDisplay(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('es-SV', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
