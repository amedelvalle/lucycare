/**
 * Montaje único y central del cierre de sesión por inactividad.
 *
 * Se renderiza una sola vez dentro de <BrowserRouter> (App.tsx) — no toca
 * PanelLayout / AdminLayout / área paciente. Sin sesión no hace nada (el hook
 * no corre timers para anónimo). Cuando corresponde, muestra el aviso.
 */
import { useIdleLogout } from '@/hooks/useIdleLogout';
import SessionTimeoutModal from './SessionTimeoutModal';

export default function SessionGuard() {
  const { warning, secondsLeft, keepAlive, logoutNow } = useIdleLogout();
  if (!warning) return null;
  return (
    <SessionTimeoutModal
      secondsLeft={secondsLeft}
      onKeep={keepAlive}
      onLogout={logoutNow}
    />
  );
}
