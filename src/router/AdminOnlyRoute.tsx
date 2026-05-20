import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getCurrentAuthUser } from '../services/auth.service';

/**
 * Guard de rol admin PLATAFORMA (dueño de LucyCare). No es admin
 * clínica. Si el usuario no es admin → fuera de /admin.
 */
export default function AdminOnlyRoute({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'ok' | 'deny'>('loading');

  useEffect(() => {
    let alive = true;
    getCurrentAuthUser()
      .then((u) => {
        if (!alive) return;
        setState(u?.role === 'admin' ? 'ok' : 'deny');
      })
      .catch(() => alive && setState('deny'));
    return () => {
      alive = false;
    };
  }, []);

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-6 w-6 border-2 border-emerald-700 border-t-transparent rounded-full" />
      </div>
    );
  }
  if (state === 'deny') return <Navigate to="/" replace />;
  return <>{children}</>;
}
