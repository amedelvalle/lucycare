import { useQuery } from '@tanstack/react-query';
import { getMyLucyAdminAccess, type LucyAdminAccess } from '../services/directoryEditor.service';

/**
 * Nivel de acceso administrativo LucyAdmin del usuario actual (s7_57).
 * Fuente de verdad: RPC `my_lucyadmin_access()` (server-side). El frontend
 * la usa solo para UX (guard/nav/ficha); el borde real de seguridad es el
 * gate de cada RPC.
 *
 * `owner_admin` = profiles.role='admin'/is_admin() → ve todo LucyAdmin.
 * `directory_editor` = capacidad de directorio acotada.
 */
export function useLucyAdminAccess() {
  const q = useQuery<LucyAdminAccess>({
    queryKey: ['my-lucyadmin-access'],
    queryFn: getMyLucyAdminAccess,
    staleTime: 5 * 60_000,   // el nivel casi no cambia dentro de una sesión
    retry: 1,
  });

  const level = q.data?.level ?? null;
  return {
    ...q,
    access: q.data,
    level,
    isOwner: level === 'owner_admin',
    canAccessLucyadmin: !!q.data?.can_access_lucyadmin,
    canManageDirectory: !!q.data?.can_manage_directory,
  };
}
