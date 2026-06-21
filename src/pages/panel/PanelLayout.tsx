import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import { getCurrentAuthUser, signOut } from '../../services/auth.service';
import type { AuthUser } from '../../services/auth.service';
import {
  useClinicContext,
  useSwitchActiveDoctor,
  contextErrorKind,
  type ClinicContextErrorKind,
} from '../../hooks/useClinicContext';
import NotificationBell from '../../components/NotificationBell';

/** Timeout duro para la carga del usuario (F2): si getCurrentAuthUser se
 *  cuelga (select sin timeout / red), no dejamos el spinner infinito. */
const AUTH_LOAD_TIMEOUT_MS = 8_000;

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
  { path: '/panel/lista-espera', label: 'Lista de espera', icon: 'ri-time-line' },
  { path: '/panel/catalogos', label: 'Catálogos', icon: 'ri-book-2-line', doctorOnly: true },
  { path: '/panel/equipo', label: 'Mi equipo', icon: 'ri-team-line', doctorOnly: true },
  { path: '/panel/servicios', label: 'Mis servicios', icon: 'ri-price-tag-3-line', doctorOnly: true },
  { path: '/panel/perfil', label: 'Mi perfil público', icon: 'ri-id-card-line', doctorOnly: true },
  { path: '/panel/reputacion', label: 'Mi reputación', icon: 'ri-star-smile-line', doctorOnly: true },
];

export default function PanelLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // F2: estado explícito de la carga del usuario. 'error' cubre tanto el
  // rechazo de getCurrentAuthUser como el timeout → evita el spinner infinito.
  const [authState, setAuthState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [authReloadKey, setAuthReloadKey] = useState(0);
  const {
    data: ctx,
    isError: ctxIsError,
    error: ctxError,
    refetch: refetchCtx,
  } = useClinicContext();

  useEffect(() => {
    let cancelled = false;
    setAuthState('loading');

    // Race contra un timeout duro para no depender de que el select de
    // profiles (sin timeout interno) resuelva siempre.
    const withTimeout = Promise.race([
      getCurrentAuthUser(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('auth-timeout')), AUTH_LOAD_TIMEOUT_MS),
      ),
    ]);

    withTimeout
      .then((u) => {
        if (cancelled) return;
        if (!u || (u.role !== 'doctor' && u.role !== 'assistant')) {
          navigate('/');
        } else {
          setUser(u);
          setAuthState('ready');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[PanelLayout] no se pudo cargar el usuario:', err);
        setAuthState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, authReloadKey]);

  const retryAuth = useCallback(() => setAuthReloadKey((k) => k + 1), []);

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  // Guard combinado: esperar TANTO al user (auth.user) como al
  // ctx (lucy_status, is_operational, role).
  //
  // Sin esperar `ctx`, el panel completo se renderizaba por un frame
  // antes de la transición a "Perfil reclamado" / "Cuenta suspendida"
  // cuando is_operational=false (flash visible al hacer login post-claim).

  // F2: la carga del usuario falló (rechazo o timeout). Antes esto dejaba
  // el spinner colgado para siempre (el `!user` no distinguía cargando de
  // fallido). Ahora es recuperable: Reintentar re-dispara el efecto.
  if (authState === 'error') {
    return (
      <PanelStateScreen
        icon="ri-wifi-off-line"
        tone="neutral"
        title="No pudimos cargar tu cuenta"
        message="Hubo un problema al cargar tu sesión. Revisá tu conexión e intentá de nuevo."
      >
        <PrimaryButton onClick={retryAuth}>Reintentar</PrimaryButton>
        <SecondaryButton onClick={handleLogout}>Cerrar sesión</SecondaryButton>
      </PanelStateScreen>
    );
  }

  // Auth aún cargando → spinner.
  if (!user) {
    return <PanelSpinner />;
  }

  // Contexto de clínica no disponible. F3: distinguimos
  //   - error estructural (no_clinic/no_doctor/role) → copy específico,
  //     SIN prometer que "Reintentar" lo resuelve (solo Cerrar sesión);
  //   - error transitorio (auth/unknown) → tarjeta recuperable (Reintentar);
  //   - carga en curso → spinner.
  if (!ctx) {
    if (ctxIsError) {
      const kind = contextErrorKind(ctxError);
      const copy = CONTEXT_ERROR_COPY[kind];
      const structural = kind === 'no_clinic' || kind === 'no_doctor' || kind === 'role';
      return (
        <PanelStateScreen
          icon={structural ? 'ri-error-warning-line' : 'ri-wifi-off-line'}
          tone={structural ? 'warning' : 'neutral'}
          title={copy.title}
          message={copy.message}
        >
          {!structural && (
            <PrimaryButton onClick={() => refetchCtx()}>Reintentar</PrimaryButton>
          )}
          <SecondaryButton onClick={handleLogout}>Cerrar sesión</SecondaryButton>
        </PanelStateScreen>
      );
    }
    return <PanelSpinner />;
  }

  // Médico no operativo → no puede operar el panel.
  // Distinguimos dos casos por `lucy_status` para no confundir al
  // médico recién reclamado con un "suspendido por admin":
  //   - listed_only / claimed + !is_operational → recién reclamado,
  //     esperando habilitación por LucyAdmin. Copy informativo.
  //   - booking_enabled / verified + !is_operational → admin lo
  //     suspendió. Copy original ("cuenta suspendida").
  if (ctx?.role === 'doctor' && ctx.doctorIsOperational === false) {
    // Tres estados visibles cuando el médico no es operativo:
    //   - listed_only → todavía NO reclamó. Tras s7_24 esto no debería
    //     ocurrir (el profile queda role='patient' pre-claim y no entra
    //     al panel), pero el copy es honesto si llegara igual.
    //   - claimed     → reclamó, esperando habilitación de LucyAdmin.
    //   - booking_enabled / verified → admin lo suspendió.
    const variant =
      ctx.doctorLucyStatus === 'listed_only'
        ? 'pending_claim'
        : ctx.doctorLucyStatus === 'claimed'
          ? 'claimed_waiting'
          : 'suspended';
    const title =
      variant === 'pending_claim'
        ? 'Perfil pendiente de reclamo'
        : variant === 'claimed_waiting'
          ? 'Perfil reclamado'
          : 'Cuenta suspendida';
    const description =
      variant === 'pending_claim'
        ? 'Tu perfil todavía no fue reclamado. Reclamalo desde tu perfil público para activar tu cuenta.'
        : variant === 'claimed_waiting'
          ? 'Tu perfil ya fue reclamado. Estamos revisando tu habilitación para activar el panel completo. Te avisamos en cuanto esté listo.'
          : 'Tu cuenta está pausada temporalmente por el administrador. No podés atender citas ni firmar consultas hasta que se reactive. Tu data histórica se conserva.';
    const isPositive = variant !== 'suspended';
    const iconClass = isPositive
      ? 'ri-time-line text-2xl text-emerald-700'
      : 'ri-pause-circle-line text-2xl text-amber-600';
    const iconBg = isPositive ? 'bg-emerald-100' : 'bg-amber-100';
    const borderClass = isPositive ? 'border-emerald-200' : 'border-amber-200';
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
        <div className={`bg-white border ${borderClass} rounded-2xl p-6 max-w-md text-center shadow-sm`}>
          <div className={`w-12 h-12 mx-auto rounded-full ${iconBg} flex items-center justify-center mb-3`}>
            <i className={iconClass} />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-600 mt-2">{description}</p>
          <button
            onClick={handleLogout}
            className="mt-5 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl"
          >
            Cerrar sesión
          </button>
        </div>
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
        {ctx && ctx.availableDoctors.length > 1 ? (
          <DoctorSwitcher
            activeId={ctx.doctorId}
            activeName={ctx.doctorName}
            doctors={ctx.availableDoctors}
          />
        ) : (
          ctx?.doctorName && (
            <p className="text-xs text-blue-800 mt-0.5 truncate">de {ctx.doctorName}</p>
          )
        )}
      </div>
    ) : null;

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar persistente (md y lg, con dos niveles de detalle).
          sticky top-0 h-screen self-start: el sidebar queda anclado al viewport
          mientras el main scrollea independientemente. */}
      <aside className="hidden md:flex md:flex-col md:w-16 lg:w-64 bg-white border-r border-gray-200 sticky top-0 h-screen self-start">
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
            onClick={() => navigate('/')}
            title="Buscar médico"
            className="w-full flex items-center gap-2 px-2 lg:px-4 py-2 mb-1 text-sm text-gray-600 hover:bg-gray-50 rounded-lg cursor-pointer justify-center lg:justify-start"
          >
            <i className="ri-search-line"></i>
            <span className="hidden lg:inline">Buscar médico</span>
          </button>

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
                onClick={() => { setSidebarOpen(false); navigate('/'); }}
                className="w-full flex items-center gap-2 px-4 py-2 mb-1 text-sm text-gray-600 hover:bg-gray-50 rounded-lg cursor-pointer"
              >
                <i className="ri-search-line"></i>
                Buscar médico
              </button>
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

// ─── Pantallas de estado (spinner / error) ───────────────────────────

const CONTEXT_ERROR_COPY: Record<ClinicContextErrorKind, { title: string; message: string }> = {
  auth: {
    title: 'No pudimos cargar tu panel',
    message: 'Hubo un problema al validar tu sesión. Revisá tu conexión e intentá de nuevo.',
  },
  unknown: {
    title: 'No pudimos cargar tu panel',
    message: 'Revisá tu conexión e intentá de nuevo.',
  },
  no_clinic: {
    title: 'Sin clínica activa',
    message:
      'Tu usuario no está asociado a una clínica activa. Contactá a soporte para que te vinculen.',
  },
  no_doctor: {
    title: 'Sin perfil médico activo',
    message:
      'No encontramos un perfil médico activo asociado a esta cuenta. Contactá a soporte.',
  },
  role: {
    title: 'Sin acceso al panel',
    message: 'Tu rol no tiene acceso a este panel.',
  },
};

function PanelSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-2 border-emerald-700 border-t-transparent rounded-full" />
    </div>
  );
}

function PanelStateScreen({
  icon,
  tone,
  title,
  message,
  children,
}: {
  icon: string;
  tone: 'neutral' | 'warning';
  title: string;
  message: string;
  children: React.ReactNode;
}) {
  const iconColor = tone === 'warning' ? 'text-amber-600' : 'text-gray-400';
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="bg-white border border-gray-200 rounded-2xl p-6 max-w-md w-full text-center shadow-sm">
        <i className={`${icon} text-3xl ${iconColor}`} />
        <h2 className="text-lg font-semibold text-gray-900 mt-3">{title}</h2>
        <p className="text-sm text-gray-600 mt-2">{message}</p>
        <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-center">{children}</div>
      </div>
    </div>
  );
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 text-sm font-medium text-white bg-emerald-700 rounded-xl hover:bg-emerald-800"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200"
    >
      {children}
    </button>
  );
}

function DoctorSwitcher({
  activeId,
  activeName,
  doctors,
}: {
  activeId: string;
  activeName: string | null;
  doctors: Array<{ id: string; full_name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const switchDoctor = useSwitchActiveDoctor();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const handlePick = (id: string) => {
    if (id !== activeId) {
      switchDoctor.mutate(id);
    }
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-xs text-blue-800 hover:text-blue-900 group"
        title="Cambiar doctor activo"
      >
        <span className="truncate">
          <span className="text-blue-600">de </span>
          <span className="font-medium">{activeName ?? '—'}</span>
        </span>
        <i
          className={`ri-arrow-down-s-line text-sm text-blue-600 group-hover:text-blue-800 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-64 overflow-y-auto">
          {doctors.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => handlePick(d.id)}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between gap-2 ${
                d.id === activeId ? 'text-emerald-700 font-medium' : 'text-gray-700'
              }`}
            >
              <span className="truncate">{d.full_name}</span>
              {d.id === activeId && <i className="ri-check-line text-sm flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
