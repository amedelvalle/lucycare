import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppointmentListItem, AppointmentStatus } from '@/services/appointments.service';
import { formatTime } from '@/utils/calendar';
import { getReviewToken, buildReviewUrl } from '@/services/reviews.service';
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
          <ReviewLinkBlock
            appointmentId={appointment.id}
            patientName={patient?.full_name ?? null}
            patientPhone={patient?.phone ?? null}
          />
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

/**
 * Bloque de encuesta de satisfacción. Visible solo en citas atendidas.
 * Trae el token (RPC get_review_link), arma el link y permite copiarlo
 * o enviarlo por WhatsApp. El envío es manual (Sprint 6, decisión de producto).
 */
function ReviewLinkBlock({
  appointmentId,
  patientName,
  patientPhone,
}: {
  appointmentId: string;
  patientName: string | null;
  patientPhone: string | null;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setState('loading');
    getReviewToken(appointmentId)
      .then((token) => {
        if (!alive) return;
        if (!token) {
          setState('none');
          return;
        }
        setUrl(buildReviewUrl(token));
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [appointmentId]);

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // navegador sin clipboard API — el usuario puede copiar manual del input
    }
  };

  const whatsappHref = (() => {
    if (!url) return null;
    const digits = (patientPhone ?? '').replace(/\D/g, '');
    const firstName = (patientName ?? '').split(' ')[0] || '';
    const msg = `Hola ${firstName}, gracias por tu visita. Cuéntanos cómo te fue calificando tu atención (toma 1 minuto): ${url}`;
    const base = digits ? `https://wa.me/${digits}` : 'https://wa.me/';
    return `${base}?text=${encodeURIComponent(msg)}`;
  })();

  if (state === 'loading') {
    return (
      <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-400">
        Cargando encuesta de satisfacción…
      </div>
    );
  }

  if (state === 'none') {
    return (
      <div className="bg-gray-50 rounded-lg p-3 flex items-start gap-2">
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
        <p className="text-xs text-gray-500">
          Esta cita no tiene encuesta (fue atendida antes de activar el sistema de calificación).
        </p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">No se pudo obtener el link de encuesta.</p>
      </div>
    );
  }

  return (
    <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3 space-y-2.5">
      <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
        Encuesta de satisfacción
      </p>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url ?? ''}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 text-[11px] bg-white border border-emerald-200 rounded-lg px-2 py-1.5 text-gray-600"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
        >
          {copied ? 'Copiado ✓' : 'Copiar'}
        </button>
      </div>
      {whatsappHref && (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-[#25D366] hover:bg-[#1ebe5b] text-white"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.523 5.26l-.999 3.648 3.965-1.607zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.078 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
          </svg>
          Enviar por WhatsApp
        </a>
      )}
      <p className="text-[10px] text-gray-400 leading-tight">
        El link vence en 7 días y solo puede usarse una vez.
      </p>
    </div>
  );
}
