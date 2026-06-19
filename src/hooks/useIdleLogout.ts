/**
 * Cierre de sesión por inactividad + tope absoluto, por rol (frontend-only).
 *
 * Modelo de deadline único:
 *   deadline = min(idleDeadline, absoluteDeadline)
 *   - idleDeadline     = última actividad + policy.idleMs
 *   - absoluteDeadline = login real (last_sign_in_at) + policy.maxMs
 *   remaining = deadline - now
 *     · remaining <= 0          → signOut + redirect
 *     · remaining <= warnMs     → mostrar aviso con cuenta regresiva
 *     · else                    → ocultar aviso
 *
 * "Mantener sesión" resetea SOLO la actividad (idle), nunca el tope absoluto.
 * Durante el aviso, la actividad del usuario NO extiende la sesión: solo el
 * clic explícito en "Mantener sesión".
 *
 * Sin sesión (anónimo) no corre ningún timer ni listener.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getCurrentAuthUser } from '@/services/auth.service';
import { getSessionPolicy } from '@/lib/sessionPolicy';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'wheel', 'scroll', 'touchstart'];

export interface IdleLogoutState {
  warning: boolean;
  secondsLeft: number;
  keepAlive: () => void;
  logoutNow: () => void;
}

export function useIdleLogout(): IdleLogoutState {
  const [role, setRole] = useState<string | null>(null);
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const lastActivityRef = useRef<number>(Date.now());
  const loginAtRef = useRef<number | null>(null);
  const warningRef = useRef(false);
  const loggingOutRef = useRef(false);

  useEffect(() => {
    warningRef.current = warning;
  }, [warning]);

  // ─── Identidad + ancla del tope absoluto ────────────────────
  useEffect(() => {
    let alive = true;

    const refresh = async () => {
      const u = await getCurrentAuthUser().catch(() => null);
      if (!alive) return;
      if (!u) {
        setRole(null);
        loginAtRef.current = null;
        return;
      }
      setRole(u.role);
      // Tope absoluto anclado al login REAL (estable entre reloads y refreshes).
      const { data } = await supabase.auth.getSession();
      const lsi = data.session?.user?.last_sign_in_at;
      loginAtRef.current = lsi ? new Date(lsi).getTime() : Date.now();
    };

    // Arranque: marcar actividad y resolver identidad.
    lastActivityRef.current = Date.now();
    refresh();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setRole(null);
        loginAtRef.current = null;
        setWarning(false);
        return;
      }
      // Un login nuevo reinicia la actividad; un TOKEN_REFRESHED NO (no es actividad del usuario).
      if (event === 'SIGNED_IN') lastActivityRef.current = Date.now();
      refresh();
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const doLogout = useCallback(() => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    setWarning(false);
    // Revocación server-side best-effort (no bloqueante): el cliente con lock
    // no-op puede colgar el signOut, así que NO dependemos de que resuelva.
    void supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    // Garantía dura de cierre local: limpiar los tokens de Supabase de
    // localStorage (mismo patrón defensivo que main.tsx) y recargar a la raíz.
    // El reload re-bootstrapea sin sesión → estado limpio, sin restos en
    // memoria ni en guards.
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('sb-')) localStorage.removeItem(k);
      });
    } catch {
      /* best-effort */
    }
    window.location.assign(import.meta.env.BASE_URL || '/');
  }, []);

  const keepAlive = useCallback(() => {
    lastActivityRef.current = Date.now();
    setWarning(false);
    // Refresca el token para no quedar con uno por expirar; no bloquea.
    supabase.auth.refreshSession().catch(() => {});
  }, []);

  // ─── Listeners de actividad (ignorados mientras el aviso está visible) ──
  useEffect(() => {
    if (!role) return;
    const onActivity = () => {
      if (!warningRef.current) lastActivityRef.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true })
    );
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [role]);

  // ─── Tick: evalúa el deadline una vez por segundo ───────────
  useEffect(() => {
    if (!role) {
      setWarning(false);
      return;
    }
    const id = setInterval(() => {
      if (loggingOutRef.current) return;
      const policy = getSessionPolicy(role); // leído cada tick → permite override de dev en caliente
      const now = Date.now();
      const idleDeadline = lastActivityRef.current + policy.idleMs;
      const absoluteDeadline = (loginAtRef.current ?? now) + policy.maxMs;
      const remaining = Math.min(idleDeadline, absoluteDeadline) - now;

      if (remaining <= 0) {
        void doLogout();
        return;
      }
      if (remaining <= policy.warnMs) {
        setWarning(true);
        setSecondsLeft(Math.max(0, Math.ceil(remaining / 1000)));
      } else if (warningRef.current) {
        setWarning(false);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [role, doLogout]);

  return { warning, secondsLeft, keepAlive, logoutNow: doLogout };
}
