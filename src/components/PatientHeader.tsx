/**
 * Header reusable para páginas /paciente/*.
 *
 * Mantiene consistencia visual con el header del home: logo a la
 * izquierda + dropdown "Mi cuenta" a la derecha con las mismas
 * opciones (Mis atenciones · Cerrar sesión).
 *
 * Si el usuario no está logueado (no debería pasar en /paciente/*
 * porque PatientOnlyRoute redirige a /), el dropdown no se monta.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PatientAccountMenu from './PatientAccountMenu';
import { getCurrentAuthUser, type AuthUser } from '@/services/auth.service';

export default function PatientHeader() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    getCurrentAuthUser().then(setUser);
  }, []);

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 flex-shrink-0">
          <img
            src="https://static.readdy.ai/image/42f081ea4b3016097f36a509bda99759/03426c4ee595a238dadf371611f96cee.png"
            alt="Lucy Care"
            className="h-10"
          />
        </Link>

        {user === undefined ? (
          // Cargando — placeholder corto para no saltar el layout
          <div className="w-24 h-9 bg-gray-100 rounded-full animate-pulse" />
        ) : user && user.role === 'patient' ? (
          <PatientAccountMenu displayName={user.name || user.phone} />
        ) : null}
      </div>
    </header>
  );
}
