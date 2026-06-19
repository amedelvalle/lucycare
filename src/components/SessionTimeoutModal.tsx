/**
 * Aviso de cierre de sesión por inactividad.
 *
 * Patrón de modal de seguridad: NO cierra por click fuera ni por Escape — el
 * usuario debe elegir explícitamente "Mantener sesión" o "Cerrar sesión ahora".
 * El cierre automático lo dispara el contador en useIdleLogout (no este modal).
 */

interface SessionTimeoutModalProps {
  secondsLeft: number;
  onKeep: () => void;
  onLogout: () => void;
}

function formatCountdown(s: number): string {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  }
  return `${s} s`;
}

export default function SessionTimeoutModal({
  secondsLeft,
  onKeep,
  onLogout,
}: SessionTimeoutModalProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-timeout-title"
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M12 6v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h3 id="session-timeout-title" className="text-lg font-semibold text-gray-900">
              Tu sesión está por cerrarse por inactividad
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              Por seguridad, se cerrará automáticamente en{' '}
              <span className="font-semibold text-gray-900 tabular-nums">
                {formatCountdown(secondsLeft)}
              </span>
              .
            </p>
            <p className="mt-2 text-sm text-amber-700">
              Guardá tus cambios si estás trabajando en una consulta.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onLogout}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cerrar sesión ahora
          </button>
          <button
            type="button"
            onClick={onKeep}
            autoFocus
            className="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors"
          >
            Mantener sesión
          </button>
        </div>
      </div>
    </div>
  );
}
