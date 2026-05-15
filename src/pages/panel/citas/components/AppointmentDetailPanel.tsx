import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppointmentListItem, AppointmentStatus } from '@/services/appointments.service';
import { formatTime } from '@/utils/calendar';
import ReviewLinkBlock from './ReviewLinkBlock';
import QuickActions from './QuickActions';
import CancelAppointmentModal, { type CancelInfo } from './CancelAppointmentModal';

export interface ChangeStatusArgs {
  cancelReasonId?: string;
  internalNotes?: string;
}

interface AppointmentDetailPanelProps {
  appointment: AppointmentListItem | null;
  statuses: AppointmentStatus[];
  isOpen: boolean;
  onClose: () => void;
  onChangeStatus: (appointmentId: string, statusId: string, cancelInfo?: ChangeStatusArgs) => void;
  isUpdating: boolean;
}

export default function AppointmentDetailPanel({
  appointment,
  statuses,
  isOpen,
  onClose,
  onChangeStatus,
  isUpdating,
}: AppointmentDetailPanelProps) {
  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity"
        onClick={onClose}
      />

      <aside className="fixed top-0 right-0 bottom-0 w-full sm:w-[400px] bg-white z-50 shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Detalle de cita</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Cerrar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {appointment ? (
            <DetailContent
              appointment={appointment}
              statuses={statuses}
              onChangeStatus={onChangeStatus}
              isUpdating={isUpdating}
            />
          ) : (
            <div className="p-5 text-center text-sm text-gray-400">
              Selecciona una cita para ver su detalle.
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function DetailContent({
  appointment,
  statuses,
  onChangeStatus,
  isUpdating,
}: {
  appointment: AppointmentListItem;
  statuses: AppointmentStatus[];
  onChangeStatus: (appointmentId: string, statusId: string, cancelInfo?: ChangeStatusArgs) => void;
  isUpdating: boolean;
}) {
  const navigate = useNavigate();
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [pendingCancelStatusId, setPendingCancelStatusId] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const { patient, service, status } = appointment;
  const color = status?.color ?? '#94a3b8';
  const isFinal = status?.is_final ?? false;
  const initials = getInitials(patient?.full_name ?? '?');

  const startDate = new Date(appointment.start_time);
  const dayLabel = startDate.toLocaleDateString('es-SV', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const handleCallPhone = () => {
    if (patient?.phone) window.location.href = `tel:${patient.phone}`;
  };

  // Callback de QuickActions: intercepta cancelar para mostrar modal, ejecuta el resto directo
  const handleAction = (statusId: string, statusName: string) => {
    setTransitionError(null);

    if (statusName === 'cancelada') {
      setPendingCancelStatusId(statusId);
      setCancelModalOpen(true);
      return;
    }

    onChangeStatus(appointment.id, statusId, undefined);
  };

  const handleCancelConfirm = (info: CancelInfo) => {
    if (!pendingCancelStatusId) return;
    onChangeStatus(appointment.id, pendingCancelStatusId, {
      cancelReasonId: info.cancelReasonId,
      internalNotes: info.internalNotes || undefined,
    });
    setCancelModalOpen(false);
    setPendingCancelStatusId(null);
  };

  const handleCancelClose = () => {
    setCancelModalOpen(false);
    setPendingCancelStatusId(null);
  };

  return (
    <>
      <div className="p-5 space-y-5">
        {/* Badge de estado */}
        <div>
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: color }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white" />
            {status?.display_name ?? 'Sin estado'}
          </span>
        </div>

        {/* Paciente */}
        <div className="flex items-start gap-3">
          {patient?.photo_url ? (
            <img
              src={patient.photo_url}
              alt={patient.full_name}
              className="w-12 h-12 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold text-white flex-shrink-0"
              style={{ backgroundColor: color }}
            >
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-gray-900 truncate">
              {patient?.full_name ?? 'Paciente desconocido'}
            </p>
            {patient?.phone ? (
              <button
                type="button"
                onClick={handleCallPhone}
                className="text-sm text-emerald-700 hover:text-emerald-800 flex items-center gap-1 mt-0.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                </svg>
                {patient.phone}
              </button>
            ) : null}
          </div>
        </div>

        {/* Datos de la cita */}
        <div className="space-y-3 bg-gray-50 rounded-xl p-4">
          <DetailRow label="Fecha">
            <span className="capitalize">{dayLabel}</span>
          </DetailRow>
          <DetailRow label="Horario">
            {formatTime(appointment.start_time)} – {formatTime(appointment.end_time)}
          </DetailRow>
          {service ? (
            <>
              <DetailRow label="Servicio">{service.name}</DetailRow>
              <DetailRow label="Duración">{service.duration_minutes} min</DetailRow>
            </>
          ) : null}
          <DetailRow label="Origen">
            <SourceBadge source={appointment.source} />
          </DetailRow>
          {appointment.price !== null ? (
            <DetailRow label="Precio">
              ${appointment.price.toFixed(2)}{' '}
              <PaymentStatusBadge status={appointment.payment_status} />
            </DetailRow>
          ) : null}
        </div>

        {/* Notas */}
        {appointment.notes ? (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notas</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap bg-amber-50/50 border border-amber-100 rounded-lg p-3">
              {appointment.notes}
            </p>
          </div>
        ) : null}

        {/* Abrir consulta clínica — disponible salvo en cancelada/no_asistio */}
        {status?.name !== 'cancelada' && status?.name !== 'no_asistio' && (
          <button
            type="button"
            onClick={() => navigate(`/panel/consulta/${appointment.id}`)}
            className="w-full px-4 py-3 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center gap-2 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            {status?.name === 'atendida' ? 'Ver consulta clínica' : 'Abrir consulta clínica'}
          </button>
        )}

        {/* Encuesta de satisfacción — solo en citas atendidas */}
        {status?.name === 'atendida' && (
          <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3">
            <ReviewLinkBlock
              appointmentId={appointment.id}
              patientName={patient?.full_name ?? null}
              patientPhone={patient?.phone ?? null}
            />
          </div>
        )}

        {/* Acciones rápidas */}
        {!isFinal ? (
          <>
            {transitionError ? (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <p className="text-xs text-amber-700">{transitionError}</p>
              </div>
            ) : null}
            <QuickActions
              appointment={appointment}
              statuses={statuses}
              onAction={handleAction}
              isUpdating={isUpdating}
            />
          </>
        ) : (
          <div className="bg-gray-50 rounded-lg p-3 flex items-start gap-2">
            <svg className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <p className="text-xs text-gray-500">
              Esta cita está en un estado final ({status?.display_name?.toLowerCase()}). No se puede cambiar el estado.
            </p>
          </div>
        )}

      </div>

      {/* Modal de cancelación — fuera del scroll del panel */}
      <CancelAppointmentModal
        isOpen={cancelModalOpen}
        patientName={patient?.full_name ?? 'Paciente'}
        isSubmitting={isUpdating}
        onConfirm={handleCancelConfirm}
        onClose={handleCancelClose}
      />
    </>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs font-medium text-gray-500 w-20 flex-shrink-0">{label}</span>
      <span className="text-sm text-gray-800 flex-1">{children}</span>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { text: string; color: string }> = {
    lucy_directorio: { text: 'Lucy', color: 'bg-emerald-50 text-emerald-700' },
    lucy_seguimiento: { text: 'Seguimiento', color: 'bg-blue-50 text-blue-700' },
    manual: { text: 'Manual', color: 'bg-gray-100 text-gray-600' },
  };
  const config = map[source] ?? map.manual;
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${config.color}`}>
      {config.text}
    </span>
  );
}

function PaymentStatusBadge({ status }: { status: string }) {
  const map: Record<string, { text: string; color: string }> = {
    paid: { text: 'Pagado', color: 'bg-emerald-50 text-emerald-700' },
    pending: { text: 'Pendiente', color: 'bg-amber-50 text-amber-700' },
    refunded: { text: 'Reembolsado', color: 'bg-gray-100 text-gray-600' },
  };
  const config = map[status] ?? map.pending;
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ml-1 ${config.color}`}>
      {config.text}
    </span>
  );
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
