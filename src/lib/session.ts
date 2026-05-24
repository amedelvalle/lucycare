/**
 * Helpers de sesión a prueba del lock interno de supabase-js.
 *
 * En algunos browsers (con navigator.locks tomado), `supabase.auth.getSession()`
 * puede colgarse sin disparar la request HTTP. Envolvemos en Promise.race
 * con un setTimeout duro para que ninguna parte de la UI quede bloqueada.
 */
import { supabase } from './supabase';

export interface SessionInfo {
  accessToken: string;
  userId: string;
}

/**
 * Devuelve la sesión actual o `null` si Supabase no responde en `ms`.
 * Nunca lanza excepciones.
 */
export async function getSessionWithTimeout(ms = 3000): Promise<SessionInfo | null> {
  const sessionPromise = supabase.auth
    .getSession()
    .then(({ data }) => {
      const s = data.session;
      if (s?.access_token && s.user?.id) {
        return { accessToken: s.access_token, userId: s.user.id };
      }
      return null;
    })
    .catch(() => null);
  const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
  return Promise.race([sessionPromise, timeoutPromise]);
}
