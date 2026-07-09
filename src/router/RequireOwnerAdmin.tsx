import { Navigate } from 'react-router-dom';
import { useLucyAdminAccess } from '../hooks/useLucyAdminAccess';

/**
 * Restricción POR SECCIÓN dentro de LucyAdmin: solo el Owner Admin
 * (`profiles.role='admin'`) ve estas rutas. Un nivel acotado (ej.
 * `directory_editor`) se redirige a `/admin/medicos` (su única sección).
 *
 * Se usa DENTRO de `AdminOnlyRoute` (que ya garantizó acceso a `/admin`),
 * así que aquí solo distinguimos owner vs. no-owner. El borde real sigue
 * siendo el gate server-side de cada RPC.
 */
export default function RequireOwnerAdmin({ children }: { children: React.ReactNode }) {
  const { isLoading, isOwner } = useLucyAdminAccess();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin h-6 w-6 border-2 border-emerald-700 border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!isOwner) return <Navigate to="/admin/medicos" replace />;
  return <>{children}</>;
}
