import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getCurrentAuthUser, signOut } from '../../services/auth.service';
import type { AuthUser } from '../../services/auth.service';
import { useClinicContext } from '../../hooks/useClinicContext';
import NotificationBell from '../../components/NotificationBell';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  end?: boolean;
  doctorOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/panel', label: 'Inicio', icon: 'ri-dashboard-line', end: true },
  { path: '/panel/disponibilidad', label: 'Disponibilidad', icon: 'ri-calendar-line' },
  { path: '/panel/bloqueos', label: 'Bloqueos', icon: 'ri-calendar-close-line' },
  { path: '/panel/citas', label: 'Citas', icon: 'ri-list-check-2' },
  { path: '/panel/pacientes', label: 'Pacientes', icon: 'ri-user-3-line' },
  { path: '/panel/perfil', label: 'Mi perfil público', icon: 'ri-id-card-line', doctorOnly: true },
];

export default function PanelLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: ctx } = useClinicContext();

  useEffect(() => {
    getCurrentAuthUser().then((u) => {
      if (!u || (u.role !== 'doctor' && u.role !== 'assistant')) {
        navigate('/');
      } else {
        setUser(u);
      }
    });
  }, [navigate]);

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-emerald-700 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  const isAssistant = user.role === 'assistant';
  const visibleNavItems = NAV_ITEMS.filter((it) => !it.doctorOnly || !isAssistant);

  // Sidebar persistente:
  //   - oculta en mobile (drawer hamburguesa)
  //   - en tablet (md): solo iconos, w-16
  //   - en desktop (lg): completa con etiquetas, w-64
  const renderPersistentNav = () =>
    visibleNavItems.map((item) => (
      <NavLink
        key={item.path}
        to={item.path}
        end={item.end}
        title={item.label}
        className={({ isActive }) =>
          `flex items-center gap-3 px-3 lg:px-4 py-3 rounded-lg text-sm font-medium transition-colors justify-center lg:justify-start ${
            isActive ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700 hover:bg-gray-50'
          }`
        }
      >
        <i className={`${item.icon} text-lg`}></i>
        <span className="hidden lg:inline">{item.label}</span>
      </NavLink>
    ));

  // Drawer mobile (igual que antes pero con tap-targets más cómodos)
  const renderDrawerNav = () =>
    visibleNavItems.map((item) => (
      <NavLink
        key={item.path}
        to={item.path}
        end={item.end}
        onClick={() => setSidebarOpen(false)}
        className={({ isActive }) =>
          `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
            isActive ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700 hover:bg-gray-50'
          }`
        }
      >
        <i className={`${item.icon} text-lg`}></i>
        {item.label}
      </NavLink>
    ));

  const renderRoleBadge = () =>
    isAssistant ? (
      <div className="mb-3 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
        <p className="text-[10px] font-semibold uppercase text-blue-600 tracking-wide">
          Asistente
        </p>
        {ctx?.doctorName && (
          <p className="text-xs text-blue-800 mt-0.5 truncate">de {ctx.doctorName}</p>
        )}
      </div>
    ) : null;

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar persistente (md y lg, con dos niveles de detalle) */}
      <aside className="hidden md:flex md:flex-col md:w-16 lg:w-64 bg-white border-r border-gray-200">
        {/* Logo */}
        <div className="p-3 lg:p-6 border-b border-gray-200 flex flex-col items-center lg:items-start">
          <img
            src="https://static.readdy.ai/image/42f081ea4b3016097f36a509bda99759/03426c4ee595a238dadf371611f96cee.png"
            alt="Lucy Care"
            className="h-10 lg:h-12 cursor-pointer"
            onClick={() => navigate('/')}
          />
          <p className="hidden lg:block text-xs text-gray-500 mt-2">
            {isAssistant ? 'Panel asistente' : 'Panel médico'}
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 lg:p-4 space-y-1">
          {renderPersistentNav()}
        </nav>

        {/* Footer (badge + user + logout) */}
        <div className="p-2 lg:p-4 border-t border-gray-200">
          <div className="hidden lg:block">{renderRoleBadge()}</div>

          <div
            className="flex items-center gap-3 mb-3 justify-center lg:justify-start"
            title={user.name || (isAssistant ? 'Asistente' : 'Doctor')}
          >
            <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
              <i className="ri-user-line text-emerald-700"></i>
            </div>
            <div className="hidden lg:block flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user.name || (isAssistant ? 'Asistente' : 'Doctor')}
              </p>
              <p className="text-xs text-gray-500 truncate">{user.phone}</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            title="Cerrar sesión"
            className="w-full flex items-center gap-2 px-2 lg:px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg cursor-pointer justify-center lg:justify-start"
          >
            <i className="ri-logout-box-line"></i>
            <span className="hidden lg:inline">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* Mobile header (solo debajo de md) */}
      <div className="md:hidden fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-40">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 rounded-lg cursor-pointer"
            aria-label="Abrir menú"
          >
            <i className="ri-menu-line text-xl"></i>
          </button>
          <img
            src="https://static.readdy.ai/image/42f081ea4b3016097f36a509bda99759/03426c4ee595a238dadf371611f96cee.png"
            alt="Lucy Care"
            className="h-10"
          />
          <NotificationBell />
        </div>
      </div>

      {/* Drawer mobile */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl flex flex-col">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <img
                src="https://static.readdy.ai/image/42f081ea4b3016097f36a509bda99759/03426c4ee595a238dadf371611f96cee.png"
                alt="Lucy Care"
                className="h-10"
              />
              <button
                onClick={() => setSidebarOpen(false)}
                className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full cursor-pointer"
                aria-label="Cerrar menú"
              >
                <i className="ri-close-line text-xl"></i>
              </button>
            </div>
            <nav className="p-4 space-y-1 flex-1 overflow-y-auto">{renderDrawerNav()}</nav>
            <div className="p-4 border-t border-gray-200">
              {renderRoleBadge()}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                  <i className="ri-user-line text-emerald-700"></i>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {user.name || (isAssistant ? 'Asistente' : 'Doctor')}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{user.phone}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg cursor-pointer"
              >
                <i className="ri-logout-box-line"></i>
                Cerrar sesión
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main content
          - mobile: pt-20 (compensar header fijo) + p-4
          - tablet (md): sin header fijo, p-6
          - desktop (lg): p-8 */}
      <main className="flex-1 min-w-0 p-4 pt-20 md:pt-6 md:p-6 lg:p-8">
        {/* Barra superior persistente para tablet/desktop con la campana */}
        <div className="hidden md:flex justify-end mb-4 lg:mb-6">
          <NotificationBell />
        </div>
        <Outlet />
      </main>
    </div>
  );
}
