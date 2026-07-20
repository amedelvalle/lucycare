/**
 * sessionState — comprobación ETIQUETADA del estado de sesión (AUTH-P1A).
 *
 * `getSessionWithTimeout` devuelve `null` tanto para "sin sesión" como para
 * "no respondió a tiempo": sirve para leer una sesión, pero NO para
 * confirmar un cierre. Este módulo distingue los cuatro estados sin
 * ambigüedad:
 *
 *   - 'none'    → la consulta COMPLETÓ y no hay sesión;
 *   - 'present' → la consulta COMPLETÓ y hay sesión;
 *   - 'timeout' → la consulta no completó dentro del plazo;
 *   - 'error'   → la consulta completó con error (o lanzó).
 *
 * Módulo PURO: el probe se INYECTA (el caller pasa
 * `() => supabase.auth.getSession()`), así el check local puede provocar y
 * verificar los cuatro resultados con probes controlados, probando ESTE
 * código real.
 */

export type SessionState = 'none' | 'present' | 'timeout' | 'error'

export type SessionProbe = () => Promise<{
  data: { session: unknown | null }
  error?: unknown
}>

export async function probeSessionState(
  probe: SessionProbe,
  ms = 3000,
): Promise<SessionState> {
  const labeled: Promise<SessionState> = (async () => {
    try {
      const { data, error } = await probe()
      if (error) return 'error'
      return data?.session ? 'present' : 'none'
    } catch {
      return 'error'
    }
  })()
  const timeout = new Promise<SessionState>((resolve) =>
    setTimeout(() => resolve('timeout'), ms),
  )
  return Promise.race([labeled, timeout])
}
