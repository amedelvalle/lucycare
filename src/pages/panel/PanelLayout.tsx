import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getCurrentAuthUser, signOut } from '../../services/auth.service';
import type { AuthUser } from '../../services/auth.service';

const navItems = [
  { path: '/panel', label: 'Inicio', icon: 'ri-dashboard-line', end: true },
  { path: '/panel/disponibilidad', label: 'Disponibilidad', icon: 'ri-calendar-line' },
  { path: '/panel/bloqueos', label: 'Bloqueos', icon: 'ri-calendar-close-line' },
  { path: '/panel/citas', label: 'Citas', icon: 'ri-list-check-2' },
];

export default function PanelLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    getCurrentAuthUser().then(u => {
      if (!u || u.role !== 'doctor') {
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

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 bg-white border-r border-gray-200">
        {/* Logo */}
        <div className="p-6 border-b border-gray-200">
          <img
            src="https://static.readdy.ai/image/42f081ea4b3016097f36a509bda99759/03426c4ee595a238dadf371611f96cee.png"
            alt="Lucy Care"
            className="h-12 cursor-pointer"
            onClick={() => navigate('/')}
          />
          <p className="text-xs text-gray-500 mt-2">Panel médico</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`
              }
            >
              <i className={`${item.icon} text-lg`}></i>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
              <i className="ri-user-line text-emerald-700"></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{user.name || 'Doctor'}</p>
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

      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-40">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 rounded-lg cursor-pointer">
            <i className="ri-menu-line text-xl"></i>
          </button>
          <img src="https://static.readdy.ai/image/42f081ea4b3016097f36a509bda99759/03426c4ee595a238dadf371611f96cee.png" alt="Lucy Care" className="h-10" />
          <div className="w-10"></div>
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)}></div>
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <img src="https://static.readdy.ai/image/42f081ea4b3016097f36a509bda99759/03426c4ee595a238dadf371611f96cee.png" alt="Lucy Care" className="h-10" />
              <button onClick={() => setSidebarOpen(false)} className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full cursor-pointer">
                <i className="ri-close-line text-xl"></i>
              </button>
            </div>
            <nav className="p-4 space-y-1">
              {navItems.map(item => (
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
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 lg:p-8 p-4 pt-20 lg:pt-8">
        <Outlet />
      </main>
    </div>
  );
}
