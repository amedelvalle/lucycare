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

// ─── Persistencia del reloj de inactividad ─────────────────────────
// Clave que guarda SOLO el timestamp (epoch ms) de la última actividad —
// sin PII (ni nombre/email/teléfono/datos clínicos). Sirve para que el
// timeout por inactividad SOBREVIVA a reload / cierre-reapertura / kill de
// pestaña en móvil (antes el reloj vivía solo en memoria y se reiniciaba en
// cada montaje → el idle no atrapaba una sesión reabierta al día siguiente).
const ACTIVITY_KEY = 'lc_last_activity';
// El write a localStorage se throttlea (la actividad en memoria es exacta;
// solo se persiste como mucho cada N ms para no spamear en mousemove/scroll).
const PERSIST_THROTTLE_MS = 15_000;

function readPersistedActivity(): number | null {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Nunca en el futuro (clock skew / manipulación) → tratar como "ahora"
    // para no extender la sesión más allá de lo real.
    return Math.min(n, Date.now());
  } catch {
    return null;
  }
}

function persistActivity(ts: number): void {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(ts));
  } catch {
    /* best-effort: modo privado / storage lleno */
  }
}

function clearPersistedActivity(): void {
  try {
    localStorage.removeItem(ACTIVITY_KEY);
  } catch {
    /* best-effort */
  }
}

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
  const lastPersistRef = useRef<number>(0);
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

      // La actividad nunca puede ser ANTERIOR al login actual: un login nuevo
      // (loginAt = ahora) reinicia el idle; una restauración de sesión en frío
      // conserva la actividad persistida (> loginAt). Robusto e independiente
      // del nombre del evento de auth (no depende de SIGNED_IN vs
      // INITIAL_SESSION), porque se ancla a `last_sign_in_at` —que NO cambia al
      // restaurar ni al refrescar el token—.
      const anchor = loginAtRef.current;
      if (lastActivityRef.current < anchor) {
        lastActivityRef.current = anchor;
        persistActivity(anchor);
        lastPersistRef.current = anchor;
      }
    };

    // Arranque: el reloj de inactividad se HIDRATA del valor persistido (si
    // existe) → así el idle sobrevive a reload / reapertura / kill de pestaña.
    // Sin valor previo (primer uso) → ahora. El clamp `>= loginAt` vive en
    // refresh() (abajo) y reinicia el idle solo ante un login nuevo.
    const persisted = readPersistedActivity();
    lastActivityRef.current = persisted ?? Date.now();
    persistActivity(lastActivityRef.current);
    lastPersistRef.current = lastActivityRef.current;
    refresh();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setRole(null);
        loginAtRef.current = null;
        setWarning(false);
        clearPersistedActivity();
        return;
      }
      // Login NUEVO = actividad ahora, de forma SÍNCRONA. Es imprescindible:
      // refresh() es async (await getSession) y el tick (1 s) podría evaluar
      // ANTES con un `lastActivity` viejo (p.ej. el que escribió el mount) y
      // disparar un falso logout. En auth-js 2.71 `SIGNED_IN` es un login real
      // (la restauración en frío emite `INITIAL_SESSION`, no `SIGNED_IN`), así
      // que resetear acá NO afecta el caso "sobrevivir a la reapertura" — ese
      // lo preserva el clamp `actividad >= loginAt` de refresh().
      if (event === 'SIGNED_IN') {
        const now = Date.now();
        lastActivityRef.current = now;
        persistActivity(now);
        lastPersistRef.current = now;
      }
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
      clearPersistedActivity();
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('sb-')) localStorage.removeItem(k);
      });
    } catch {
      /* best-effort */
    }
    window.location.assign(import.meta.env.BASE_URL || '/');
  }, []);

  const keepAlive = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    persistActivity(now); // "Mantener sesión" es raro → persistir sin throttle.
    lastPersistRef.current = now;
    setWarning(false);
    // Refresca el token para no quedar con uno por expirar; no bloquea.
    supabase.auth.refreshSession().catch(() => {});
  }, []);

  // Cuánto falta (ms) para el deadline = min(inactividad, tope absoluto).
  // Helper puro: NO muta nada; se usa para evaluar Y para el guard de actividad.
  const remainingMs = useCallback((currentRole: string): number => {
    const policy = getSessionPolicy(currentRole); // leído en caliente → override de dev
    const now = Date.now();
    const idleDeadline = lastActivityRef.current + policy.idleMs;
    const absoluteDeadline = (loginAtRef.current ?? now) + policy.maxMs;
    return Math.min(idleDeadline, absoluteDeadline) - now;
  }, []);

  // Evalúa el estado: si venció → logout; si está por vencer → aviso; si no →
  // oculta el aviso. Compartido por el tick y por visibilitychange/focus.
  const evaluate = useCallback(
    (currentRole: string) => {
      if (loggingOutRef.current) return;
      const remaining = remainingMs(currentRole);
      if (remaining <= 0) {
        doLogout();
        return;
      }
      if (remaining <= getSessionPolicy(currentRole).warnMs) {
        setWarning(true);
        setSecondsLeft(Math.max(0, Math.ceil(remaining / 1000)));
      } else if (warningRef.current) {
        setWarning(false);
      }
    },
    [doLogout, remainingMs]
  );

  // ─── Listeners de actividad ─────────────────────────────────
  // Orden defensivo: PRIMERO se evalúa si la sesión ya venció; solo si NO venció
  // se registra actividad. Así un touch/scroll/focus al volver de background NO
  // puede revivir una sesión ya vencida por inactividad o por tope absoluto.
  // Durante el aviso tampoco extiende (solo el botón "Mantener sesión").
  useEffect(() => {
    if (!role) return;
    const onActivity = () => {
      if (warningRef.current) return;       // aviso visible → no extender
      if (remainingMs(role) <= 0) return;   // ya venció → NO renovar (el tick cierra)
      const now = Date.now();
      lastActivityRef.current = now;
      // Persistir throttled: la actividad en memoria es exacta; a localStorage
      // solo se escribe como mucho cada PERSIST_THROTTLE_MS (la leve latencia
      // erra hacia un cierre un poco ANTES → conservador/seguro).
      if (now - lastPersistRef.current >= PERSIST_THROTTLE_MS) {
        lastPersistRef.current = now;
        persistActivity(now);
      }
    };
    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true })
    );
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [role, remainingMs]);

  // ─── Tick (1 s) + re-evaluación inmediata al volver al primer plano ──
  // En móvil, al reabrir la app (visibilitychange/focus) se evalúa el
  // vencimiento ANTES de cualquier actividad → si ya venció, cierra/avisa.
  useEffect(() => {
    if (!role) {
      setWarning(false);
      return;
    }
    const id = setInterval(() => evaluate(role), 1000);
    // Re-evaluar el vencimiento al volver al primer plano.
    const onFocus = () => evaluate(role);
    // Flush del último activity a localStorage al ir a background / descargar
    // la página → el idle-on-reopen es preciso aunque el SO móvil mate la
    // pestaña sin previo aviso (reduce la latencia del throttle a ~0 al cerrar).
    const flush = () => {
      persistActivity(lastActivityRef.current);
      lastPersistRef.current = lastActivityRef.current;
    };
    const onVisChange = () => {
      if (document.visibilityState === 'visible') evaluate(role);
      else flush();
    };
    document.addEventListener('visibilitychange', onVisChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', flush);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', flush);
    };
  }, [role, evaluate]);

  return { warning, secondsLeft, keepAlive, logoutNow: doLogout };
}
