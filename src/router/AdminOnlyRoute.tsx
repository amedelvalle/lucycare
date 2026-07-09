import { Navigate } from 'react-router-dom';
import { useLucyAdminAccess } from '../hooks/useLucyAdminAccess';

/**
 * Gate de entrada a LucyAdmin (`/admin`). Permite el acceso a:
 *   - Owner Admin (`profiles.role='admin'` / `is_admin()`), y
 *   - cualquier nivel con capacidad (`lucyadmin_access` activo, ej. directory_editor).
 *
 * La autoridad real es server-side (`my_lucyadmin_access()` + el gate de cada
 * RPC). Este guard es solo la puerta de la SPA; la restricción POR SECCIÓN
 * (owner-only) la aplica `RequireOwnerAdmin` en las rutas internas.
 */
export default function AdminOnlyRoute({ children }: { children: React.ReactNode }) {
  const { isLoading, isError, canAccessLucyadmin } = useLucyAdminAccess();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-6 w-6 border-2 border-emerald-700 border-t-transparent rounded-full" />
      </div>
    );
  }
  if (isError || !canAccessLucyadmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
