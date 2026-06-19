/**
 * Política de sesión por rol (seguridad / cierre por inactividad).
 *
 * - idleMs: inactividad permitida antes de cerrar sesión.
 * - warnMs: cuánto ANTES del cierre se muestra el aviso (cuenta regresiva).
 * - maxMs : duración máxima ABSOLUTA de la sesión (desde el login real),
 *           independiente de la actividad. "Mantener sesión" resetea el idle
 *           pero NO extiende este tope.
 *
 * Frontend-only. No depende de configuración de Supabase (que se evaluará
 * después como backstop server-side). Valores aprobados por el owner.
 */

const MIN = 60_000;
const HOUR = 3_600_000;

export interface SessionPolicy {
  idleMs: number;
  warnMs: number;
  maxMs: number;
}

const WARN_MS = 90_000; // 90 s de aviso para todos los roles

const POLICY_BY_ROLE: Record<string, SessionPolicy> = {
  admin:     { idleMs: 15 * MIN, warnMs: WARN_MS, maxMs: 8 * HOUR },
  doctor:    { idleMs: 30 * MIN, warnMs: WARN_MS, maxMs: 12 * HOUR },
  assistant: { idleMs: 30 * MIN, warnMs: WARN_MS, maxMs: 12 * HOUR },
  patient:   { idleMs: 60 * MIN, warnMs: WARN_MS, maxMs: 24 * HOUR },
};

/**
 * Override SOLO en dev/test (import.meta.env.DEV) para validar el flujo sin
 * esperar 15/30/60 min. Se setea desde la consola del preview, p.ej.:
 *   localStorage.setItem('lc_session_test', JSON.stringify({idleMs:8000,warnMs:5000,maxMs:600000}))
 * En el build de producción se ignora por completo.
 */
function devOverride(base: SessionPolicy): SessionPolicy {
  if (!import.meta.env.DEV) return base;
  try {
    const raw = localStorage.getItem('lc_session_test');
    if (!raw) return base;
    const o = JSON.parse(raw) as Partial<SessionPolicy>;
    return {
      idleMs: typeof o.idleMs === 'number' ? o.idleMs : base.idleMs,
      warnMs: typeof o.warnMs === 'number' ? o.warnMs : base.warnMs,
      maxMs: typeof o.maxMs === 'number' ? o.maxMs : base.maxMs,
    };
  } catch {
    return base;
  }
}

export function getSessionPolicy(role: string | null | undefined): SessionPolicy {
  const base = (role && POLICY_BY_ROLE[role]) || POLICY_BY_ROLE.patient;
  return devOverride(base);
}
