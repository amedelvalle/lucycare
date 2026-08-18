/**
 * /reset-password
 *
 * Landing del link que Supabase envía por email. Cuando el médico
 * abre el link, Supabase intercepta el `#access_token=...` (via el
 * `detectSessionInUrl: true` del cliente) y crea una sesión
 * temporal de tipo "recovery". Mientras esa sesión esté activa,
 * podemos llamar `updateUser({password})` para cambiar el password.
 *
 * Cuidados:
 *  - Esperamos a `onAuthStateChange` con event 'PASSWORD_RECOVERY'
 *    o 'SIGNED_IN' para confirmar que la sesión se cargó.
 *  - Si el link expiró o es inválido, no hay sesión → mostramos
 *    error y CTA "Solicitar nuevo link".
 *  - Tras éxito, redirigimos según rol.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LUCYCARE_LOGO_SRC } from '@/lib/brand';
import { supabase } from '@/lib/supabase';
import { destinationAfterLogin, setPasswordFromRecovery } from '@/services/auth.service';
import { MIN_PASSWORD_LENGTH } from '@/lib/password';
import { GENERIC_PASSWORD_MESSAGE } from '@/lib/passwordErrors';

type PageState = 'checking' | 'ready' | 'no_session' | 'success';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<PageState>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Verificar si hay sesión de recovery activa al montar
  useEffect(() => {
    let cancelled = false;

    // 1. Chequeo inicial directo (puede ya tener sesión)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.user) {
        setState('ready');
      } else {
        // 2. Aún no — esperamos al event PASSWORD_RECOVERY que dispara
        //    Supabase al procesar el hash del link.
        const t = setTimeout(() => {
          if (!cancelled) setState('no_session');
        }, 4000); // grace period

        const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
          if (cancelled) return;
          if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session?.user) {
            clearTimeout(t);
            setState('ready');
          }
        });

        return () => {
          subscription?.subscription?.unsubscribe?.();
          clearTimeout(t);
        };
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    try {
      const result = await setPasswordFromRecovery(password);
      if (!result.success) {
        setError(result.error || 'No pudimos actualizar tu contraseña.');
        return;
      }

      // Cargar el role del profile para redirigir según corresponda
      const {
        data: { session },
      } = await supabase.auth.getSession();
      let role: string | null = null;
      if (session?.user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .maybeSingle();
        role = profile?.role ?? null;
      }

      // Destino resuelto antes de la pausa: además del rol contempla el acceso
      // LucyAdmin por capacidad (un operations_admin tiene role='patient').
      const destination = await destinationAfterLogin(role);

      setState('success');
      // Pequeña pausa para que el usuario vea la confirmación
      setTimeout(() => {
        navigate(destination);
      }, 1500);
    } catch (err) {
      // PASSWORD-ERROR-COPY-P0: nunca mostrar el mensaje crudo del proveedor;
      // podía llegar en inglés desde Auth. El detalle queda solo en consola.
      console.warn('[ResetPasswordPage] error inesperado:', err);
      setError(GENERIC_PASSWORD_MESSAGE);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm max-w-md w-full p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-6">
          <img
            src={LUCYCARE_LOGO_SRC}
            alt="Lucy Care"
            className="h-12"
          />
        </div>

        {state === 'checking' && (
          <div className="text-center py-8">
            <div className="inline-block w-10 h-10 rounded-full border-4 border-gray-200 border-t-emerald-700 animate-spin" />
            <p className="text-sm text-gray-600 mt-4">Verificando enlace de recuperación…</p>
          </div>
        )}

        {state === 'no_session' && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 mb-3">Enlace no válido o expirado</h1>
            <p className="text-sm text-gray-600 mb-6">
              El enlace de recuperación ya fue usado o venció. Solicita uno nuevo desde "Iniciar sesión" →
              "Olvidaste tu contraseña".
            </p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full px-4 py-2.5 bg-emerald-700 text-white rounded-lg font-medium hover:bg-emerald-800 cursor-pointer"
            >
              Volver al inicio
            </button>
          </>
        )}

        {state === 'ready' && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Nueva contraseña</h1>
            <p className="text-sm text-gray-600 mb-6">
              Elige una contraseña de al menos {MIN_PASSWORD_LENGTH} caracteres. Después de guardarla, inicias sesión automáticamente.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">Nueva contraseña</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900"
                  placeholder={`Mín. ${MIN_PASSWORD_LENGTH} caracteres`}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">Confirma la contraseña</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-gray-900 text-gray-900"
                  placeholder="Repite la contraseña"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading || password.length < MIN_PASSWORD_LENGTH || password !== confirm}
                className={`w-full py-3 rounded-lg font-semibold whitespace-nowrap ${
                  loading || password.length < MIN_PASSWORD_LENGTH || password !== confirm
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-emerald-700 text-white hover:bg-emerald-800 cursor-pointer'
                }`}
              >
                {loading ? 'Guardando…' : 'Guardar y continuar'}
              </button>
            </form>
          </>
        )}

        {state === 'success' && (
          <div className="text-center py-6">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="ri-check-line text-3xl text-emerald-700"></i>
            </div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">¡Listo!</h1>
            <p className="text-sm text-gray-600">Tu contraseña fue actualizada. Te llevamos a tu panel…</p>
          </div>
        )}
      </div>
    </div>
  );
}
