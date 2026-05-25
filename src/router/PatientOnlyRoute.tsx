import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getCurrentAuthUser, type AuthUser } from '../services/auth.service';

/**
 * Guard para rutas /paciente/*. Permite acceso solo a usuarios
 * con role='patient'. Cualquier otro rol (doctor, asistente, admin)
 * o sin sesión → redirige a /.
 */
export default function PatientOnlyRoute({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    getCurrentAuthUser().then(setUser);
  }, []);

  if (user === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-6 w-6 border-2 border-emerald-700 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user || user.role !== 'patient') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
