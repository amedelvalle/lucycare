/**
 * Dropdown "Mi cuenta" para usuarios con role='patient'.
 *
 * Hoy expone 2 opciones:
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

interface PatientAccountMenuProps {
  displayName: string;
}

export default function PatientAccountMenu({ displayName }: PatientAccountMenuProps) {
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
              <p className="text-xs text-gray-500">Sesión activa</p>
              <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
            </div>
          )}
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
