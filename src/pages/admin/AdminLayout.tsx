import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { signOut } from '../../services/auth.service';

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: 'ri-dashboard-line', end: true },
  { to: '/admin/medicos', label: 'Médicos', icon: 'ri-stethoscope-line', end: false },
];

export default function AdminLayout() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

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
              {n.label}
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

      <main className="flex-1 min-w-0 p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
}
