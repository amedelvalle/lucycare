// ═══════════════════════════════════════════════════════════
// RUTA DESTINO: src/pages/panel/citas/CalendarView.tsx
// ACCIÓN: NUEVO — crear archivo
// ═══════════════════════════════════════════════════════════
// Orquestador del calendario: maneja la vista activa, navegación,
// selección de cita y apertura del panel lateral.

import { useState, useCallback } from 'react';
import type { AppointmentListItem, AppointmentStatus } from '@/services/appointments.service';
import { useCalendarAppointments } from '@/hooks/useCalendarAppointments';
import {
  getToday,
  shiftDate,
  type CalendarViewMode,
} from '@/utils/calendar';
import CalendarHeader from './components/CalendarHeader';
import DayView from './components/DayView';
import WeekView from './components/WeekView';
import MonthView from './components/MonthView';
import AppointmentDetailPanel from './components/AppointmentDetailPanel';
import CreateWalkInModal from './components/CreateWalkInModal';

interface CalendarViewProps {
  doctorId: string;
  statuses: AppointmentStatus[];
  onChangeStatus: (appointmentId: string, statusId: string, cancellationReason?: string) => void;
  isUpdatingStatus: boolean;
}

export default function CalendarView({
  doctorId,
  statuses,
  onChangeStatus,
  isUpdatingStatus,
}: CalendarViewProps) {
  // ─── Estado ──────────────────────────────────────────────
  const [currentDate, setCurrentDate] = useState(() => getToday());
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week');
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentListItem | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isWalkInOpen, setIsWalkInOpen] = useState(false);

  // ─── Query ───────────────────────────────────────────────
  const {
    data: appointments = [],
    isLoading,
    isFetching,
  } = useCalendarAppointments(doctorId, currentDate, viewMode);

  const isToday = currentDate === getToday();

  // ─── Handlers ────────────────────────────────────────────
  const handlePrev = useCallback(() => {
    setCurrentDate((prev) => shiftDate(prev, viewMode, 'prev'));
  }, [viewMode]);

  const handleNext = useCallback(() => {
    setCurrentDate((prev) => shiftDate(prev, viewMode, 'next'));
  }, [viewMode]);

  const handleToday = useCallback(() => {
    setCurrentDate(getToday());
  }, []);

  const handleAppointmentClick = useCallback((apt: AppointmentListItem) => {
    setSelectedAppointment(apt);
    setIsPanelOpen(true);
  }, []);

  const handleClosePanel = useCallback(() => {
    setIsPanelOpen(false);
    // Retardo para que la animación de cierre se vea antes de limpiar
    setTimeout(() => setSelectedAppointment(null), 200);
  }, []);

  // Cuando se cambia el estado, actualizar la cita seleccionada con el nuevo status
  const handleStatusChange = useCallback(
    (appointmentId: string, statusId: string, cancellationReason?: string) => {
      onChangeStatus(appointmentId, statusId, cancellationReason);

      // Actualizar el snapshot local del panel con el nuevo status
      const newStatus = statuses.find((s) => s.id === statusId);
      if (newStatus && selectedAppointment?.id === appointmentId) {
        setSelectedAppointment({
          ...selectedAppointment,
          status: newStatus,
        });
      }
    },
    [onChangeStatus, statuses, selectedAppointment]
  );

  // En vista mes, click en un día → cambia a día
  const handleDateClick = useCallback((dateStr: string) => {
    setCurrentDate(dateStr);
    setViewMode('day');
  }, []);

  // ─── Render ──────────────────────────────────────────────
  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1">
          <CalendarHeader
            currentDate={currentDate}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onPrev={handlePrev}
            onNext={handleNext}
            onToday={handleToday}
            isToday={isToday}
          />
        </div>
        <button
          type="button"
          onClick={() => setIsWalkInOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white
            bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Nueva cita
        </button>
      </div>

      {/* Indicador de refresco en segundo plano */}
      {isFetching && !isLoading && (
        <div className="mb-2 flex items-center gap-2 text-xs text-gray-400">
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Actualizando...
        </div>
      )}

      {/* Skeleton de carga inicial */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-8 bg-gray-100 rounded" />
            <div className="h-8 bg-gray-100 rounded" />
            <div className="h-8 bg-gray-100 rounded" />
            <div className="h-8 bg-gray-100 rounded" />
          </div>
        </div>
      ) : (
        <>
          {viewMode === 'day' && (
            <DayView
              dateStr={currentDate}
              appointments={appointments}
              onAppointmentClick={handleAppointmentClick}
            />
          )}
          {viewMode === 'week' && (
            <WeekView
              dateStr={currentDate}
              appointments={appointments}
              onAppointmentClick={handleAppointmentClick}
            />
          )}
          {viewMode === 'month' && (
            <MonthView
              dateStr={currentDate}
              appointments={appointments}
              onAppointmentClick={handleAppointmentClick}
              onDateClick={handleDateClick}
            />
          )}
        </>
      )}

      {/* Leyenda de estados */}
      {statuses.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-gray-400 font-medium">Estados:</span>
          {statuses.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5 text-gray-600">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.display_name}
            </span>
          ))}
        </div>
      )}

      {/* Panel lateral de detalle */}
      <AppointmentDetailPanel
        appointment={selectedAppointment}
        statuses={statuses}
        isOpen={isPanelOpen}
        onClose={handleClosePanel}
        onChangeStatus={handleStatusChange}
        isUpdating={isUpdatingStatus}
      />

      {/* Modal de nueva cita walk-in */}
      <CreateWalkInModal
        isOpen={isWalkInOpen}
        doctorId={doctorId}
        defaultDate={currentDate}
        onClose={() => setIsWalkInOpen(false)}
        onSuccess={() => setIsWalkInOpen(false)}
      />
    </>
  );
}
