/**
 * Dropdown "Mi cuenta" del área de paciente. Lo usan personas con rol
 * patient/doctor/assistant (identidad múltiple, Fase 1). Para doctor/assistant
 * agrega "Ir al panel" (copy neutro: el asistente no es médico).
 *
 * Opciones:
 *   - Ir al panel → /panel  (solo doctor/assistant)
 *   - Ir a LucyAdmin → /admin  (solo con acceso LucyAdmin por capacidad)
 *   - Mi perfil → /paciente/perfil
 *   - Mis atenciones → /paciente/mis-atenciones
 *   - Cerrar sesión
 *
 * Diseñado para extenderse fácilmente: si en fases siguientes
 * agregamos Mi perfil, Preferencias, etc., solo se suman items
 * sin tocar el header.
 *
 * Mobile-friendly: el dropdown abre por click (no hover) y se
 * cierra al click fuera o al seleccionar opción.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from '@/services/auth.service';
import { useLucyAdminAccess } from '@/hooks/useLucyAdminAccess';

interface PatientAccountMenuProps {
  displayName: string;
  /**
   * Rol del usuario en sesión. Si es doctor/assistant, el menú agrega
   * "Ir al panel" (identidad múltiple, Fase 1) — la persona está en su
   * cuenta personal de paciente y su panel de trabajo es aparte.
   */
  role?: string | null;
}

export default function PatientAccountMenu({ displayName, role }: PatientAccountMenuProps) {
  const hasPanel = role === 'doctor' || role === 'assistant';
  // Acceso LucyAdmin por CAPACIDAD (`lucyadmin_access`, s7_57), no por rol: un
  // `operations_admin` tiene `profiles.role='patient'` y sin esto no tendría
  // ninguna entrada visible a /admin. La RPC solo corre para sesiones
  // autenticadas: este menú únicamente se monta cuando hay usuario en sesión
  // (home y PatientHeader), nunca para visitantes anónimos.
  const { canAccessLucyadmin } = useLucyAdminAccess();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cerrar al click fuera
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const handleNavigate = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const handleLogout = async () => {
    setOpen(false);
    await signOut();
    navigate('/');
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 text-sm sm:text-base bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-full transition-colors cursor-pointer whitespace-nowrap font-medium"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <i className="ri-user-3-line" aria-hidden="true"></i>
        <span className="hidden sm:inline">Mi cuenta</span>
        <i className={`ri-arrow-down-s-line transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true"></i>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden"
        >
          {displayName && (
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs text-gray-500">Cuenta personal</p>
              <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
            </div>
          )}
          {hasPanel && (
            <>
              <button
                type="button"
                onClick={() => handleNavigate('/panel')}
                role="menuitem"
                className="w-full text-left px-4 py-2.5 text-sm text-emerald-700 hover:bg-emerald-50 flex items-center gap-2"
              >
                <i className="ri-layout-grid-line text-emerald-600" aria-hidden="true"></i>
                Ir al panel
              </button>
              <div className="border-t border-gray-100" />
            </>
          )}
          {canAccessLucyadmin && (
            <>
              <button
                type="button"
                onClick={() => handleNavigate('/admin')}
                role="menuitem"
                className="w-full text-left px-4 py-2.5 text-sm text-emerald-700 hover:bg-emerald-50 flex items-center gap-2"
              >
                <i className="ri-shield-user-line text-emerald-600" aria-hidden="true"></i>
                Ir a LucyAdmin
              </button>
              <div className="border-t border-gray-100" />
            </>
          )}
          <button
            type="button"
            onClick={() => handleNavigate('/paciente/perfil')}
            role="menuitem"
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <i className="ri-user-line text-gray-500" aria-hidden="true"></i>
            Mi perfil
          </button>
          <button
            type="button"
            onClick={() => handleNavigate('/paciente/mis-atenciones')}
            role="menuitem"
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <i className="ri-calendar-line text-gray-500" aria-hidden="true"></i>
            Mis atenciones
          </button>
          <div className="border-t border-gray-100" />
          <button
            type="button"
            onClick={handleLogout}
            role="menuitem"
            className="w-full text-left px-4 py-2.5 text-sm text-red-700 hover:bg-red-50 flex items-center gap-2"
          >
            <i className="ri-logout-circle-line" aria-hidden="true"></i>
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
