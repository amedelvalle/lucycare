import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { signOut } from '../../services/auth.service';
import { getSessionWithTimeout } from '../../lib/session';
import { adminCountAffiliationPending } from '../../services/affiliation.service';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  /**
   * Si está definido, se renderiza el contador como badge a la derecha.
   * El badge solo aparece si el valor es > 0.
   */
  badgeQueryKey?: string;
}

const NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: 'ri-dashboard-line', end: true },
  { to: '/admin/medicos', label: 'Médicos', icon: 'ri-stethoscope-line' },
  {
    to: '/admin/afiliaciones',
    label: 'Afiliaciones',
    icon: 'ri-mail-add-line',
    badgeQueryKey: 'admin-affiliation-pending-count',
  },
  { to: '/admin/catalogos', label: 'Catálogos', icon: 'ri-book-2-line' },
  { to: '/admin/lista-espera', label: 'Lista de espera', icon: 'ri-time-line' },
  { to: '/admin/pacientes', label: 'Pacientes', icon: 'ri-user-shared-line' },
  { to: '/admin/administradores', label: 'Administradores', icon: 'ri-shield-user-line' },
  { to: '/admin/analytics', label: 'Analítica', icon: 'ri-bar-chart-2-line' },
];

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-semibold bg-red-600 text-white rounded-full">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  // Drawer móvil (patrón de PanelLayout): debajo de `md` la sidebar está
  // oculta y la navegación vive en un header fijo + drawer.
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleLogout = async () => {
    setDrawerOpen(false);
    await signOut();
    navigate('/');
  };

  // Gate de auth-ready: misma razón que AdminAffiliationsPage. El
  // RPC admin_count_affiliation_pending retorna 0 silencioso para no-
  // admin, así que el fallo no rompe nada visible, pero igual evitamos
  // el call inútil y aseguramos que el primer fetch sea con sesión.
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tok = await getSessionWithTimeout(3000);
      if (cancelled) return;
      if (tok) setAuthReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Conteo de afiliaciones pendientes para el badge. Refresca cada 60s.
  const affiliationPendingQ = useQuery({
    queryKey: ['admin-affiliation-pending-count'],
    queryFn: adminCountAffiliationPending,
    enabled: authReady,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const affiliationPending = affiliationPendingQ.data ?? 0;

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="hidden md:flex md:flex-col md:w-60 bg-white border-r border-gray-200 sticky top-0 h-screen self-start">
        <div className="p-5 border-b border-gray-200">
          <p className="text-sm font-bold text-gray-900">LucyCare</p>
          <p className="text-[11px] text-gray-500 mt-0.5">Admin de plataforma</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                  isActive ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700 hover:bg-gray-50'
                }`
              }
            >
              <i className={`${n.icon} text-lg`} />
              <span>{n.label}</span>
              {n.badgeQueryKey === 'admin-affiliation-pending-count' && (
                <NavBadge count={affiliationPending} />
              )}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-200">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
          >
            <i className="ri-logout-box-line" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Header móvil fijo (solo debajo de md) — sin esto, en móvil no había
          NINGUNA navegación: la sidebar es hidden y el admin quedaba preso
          del Dashboard. Mismo patrón que PanelLayout. */}
      <div className="md:hidden fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-40">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => setDrawerOpen(true)}
            className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 rounded-lg cursor-pointer"
            aria-label="Abrir menú"
          >
            <i className="ri-menu-line text-xl" />
          </button>
          <div>
            <p className="text-sm font-bold text-gray-900 leading-tight">LucyCare</p>
            <p className="text-[11px] text-gray-500 leading-tight">Admin de plataforma</p>
          </div>
        </div>
      </div>

      {/* Drawer móvil */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl flex flex-col">
            <div className="p-5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">LucyCare</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Admin de plataforma</p>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full cursor-pointer"
                aria-label="Cerrar menú"
              >
                <i className="ri-close-line text-xl" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  onClick={() => setDrawerOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium ${
                      isActive ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700 hover:bg-gray-50'
                    }`
                  }
                >
                  <i className={`${n.icon} text-lg`} />
                  <span>{n.label}</span>
                  {n.badgeQueryKey === 'admin-affiliation-pending-count' && (
                    <NavBadge count={affiliationPending} />
                  )}
                </NavLink>
              ))}
            </nav>
            <div className="p-3 border-t border-gray-200">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
              >
                <i className="ri-logout-box-line" />
                Cerrar sesión
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* pt-20 compensa el header fijo SOLO en móvil; desktop intacto. */}
      <main className="flex-1 min-w-0 p-4 pt-20 md:p-8 md:pt-8">
        <Outlet />
      </main>
    </div>
  );
}
