import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  usePanelNotifications,
  useIsUnread,
} from '@/hooks/usePanelNotifications';
import type { PanelNotification } from '@/services/panelNotifications.service';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  /**
   * Id POR INSTANCIA, no constante de módulo: `PanelLayout` monta este
   * componente DOS veces (header móvil + barra desktop) y un id fijo podría
   * duplicarse en el DOM, dejando `aria-controls` apuntando a un panel ajeno.
   * `useId` es estable entre renders y consistente con el SSR.
   */
  const panelId = `notification-bell-panel-${useId()}`;
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { notifications, unreadCount, isLoading, markAllAsRead } =
    usePanelNotifications();
  const isUnread = useIsUnread();

  /**
   * Devuelve el foco a la campana. Se usa solo cuando el foco estaba DENTRO
   * del panel: si el usuario cerró haciendo click en otro lado, moverle el
   * foco sería peor que no hacer nada.
   */
  const focusBell = () => buttonRef.current?.focus();
  const focoDentroDelPanel = () =>
    !!panelRef.current && panelRef.current.contains(document.activeElement);

  // Cerrar al click fuera y con Escape. El listener de click sigue siendo
  // `mousedown`, así que el teclado no lo dispara y no interfiere con Escape.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        // Sin esto el panel se desmonta con el foco adentro y el foco cae a
        // <body>: el usuario de teclado pierde su posición en el documento.
        const devolverFoco = focoDentroDelPanel();
        setOpen(false);
        if (devolverFoco) focusBell();
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      focusBell();
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) {
      // Marcar leídas con un pequeño delay para que el usuario vea el badge inicialmente
      setTimeout(markAllAsRead, 800);
    }
  };

  const handleSelect = (notif: PanelNotification) => {
    setOpen(false);
    navigate(`/panel/pacientes/${notif.patientId}`);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        // Patrón "disclosure": el botón revela una región. NO se usa
        // `aria-haspopup`/`role="menu"` a propósito — eso comprometería
        // navegación por flechas, Home/End y roving tabindex, que este
        // componente no implementa. Con Tab alcanza: el panel se renderiza
        // justo después del botón en el orden del DOM.
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        // El contador era información solo visual: acá entra al nombre
        // accesible para que el lector de pantalla lo anuncie.
        aria-label={
          unreadCount > 0
            ? `Notificaciones (${unreadCount} sin leer)`
            : 'Notificaciones'
        }
        className="relative w-10 h-10 flex items-center justify-center rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className="absolute right-0 top-full mt-2 w-[min(360px,calc(100vw-2rem))] max-h-[70vh] bg-white rounded-xl shadow-xl border border-gray-200 z-50 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Notificaciones</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="text-xs text-emerald-700 hover:text-emerald-800 font-medium"
              >
                Marcar todas leídas
              </button>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-200" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-gray-200 rounded w-3/4" />
                      <div className="h-2 bg-gray-100 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <EmptyState />
            ) : (
              <ul>
                {notifications.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notif={n}
                    isUnread={isUnread(n)}
                    onClick={() => handleSelect(n)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50/50">
            <p className="text-[10px] text-gray-400 text-center">
              Mostrando últimas 24 horas
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────

function NotificationItem({
  notif,
  isUnread,
  onClick,
}: {
  notif: PanelNotification;
  isUnread: boolean;
  onClick: () => void;
}) {
  const isCancellation = notif.type === 'cancellation';
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-b-0 ${
          isUnread ? 'bg-emerald-50/40' : ''
        }`}
      >
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
            isCancellation ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'
          }`}
        >
          {isCancellation ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-900">
            <span className="font-semibold">{notif.patientName}</span>
            <span className="text-gray-600">
              {isCancellation ? ' canceló su cita' : ' reservó una cita'}
            </span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatAppointmentLabel(notif.appointmentStartTime)}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {formatRelativeTime(notif.eventAt)}
          </p>
        </div>

        {isUnread && (
          <span className="w-2 h-2 bg-emerald-500 rounded-full flex-shrink-0 mt-1.5" />
        )}
      </button>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4">
      <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1}
          d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0"
        />
      </svg>
      <p className="text-sm text-gray-500 mt-3">Sin notificaciones recientes</p>
      <p className="text-xs text-gray-400 mt-1 text-center max-w-[220px]">
        Aquí verás nuevas reservas y cancelaciones de las últimas 24 horas.
      </p>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatAppointmentLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const time = date.toLocaleTimeString('es-SV', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (isSameDay(date, today)) return `Hoy · ${time}`;
  if (isSameDay(date, tomorrow)) return `Mañana · ${time}`;

  const dateStr = date.toLocaleDateString('es-SV', {
    day: 'numeric',
    month: 'short',
  });
  return `${dateStr} · ${time}`;
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'hace unos segundos';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}
