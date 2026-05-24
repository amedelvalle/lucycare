import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan variables de entorno: VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY deben estar definidas en .env'
  )
}

/**
 * Lock no-op para deshabilitar la sincronización entre tabs vía
 * Navigator.locks (que usa supabase-js por default).
 *
 * Motivación: en algunos browsers el lock global queda huérfano
 * (verificado en smoke del PR #32: queries y RPCs colgaban antes
 * de disparar el fetch HTTP — DevTools → Network mostraba 0
 * requests a *.supabase.co). El cliente nunca recibía respuesta
 * porque ni siquiera salía.
 *
 * Trade-off:
 * - PERDEMOS sincronización automática del estado de auth entre
 *   múltiples tabs del mismo usuario. Si el usuario tiene dos
 *   tabs abiertas y se desloguea en una, la otra no se entera al
 *   instante; recién en el próximo refresh / token refresh.
 * - GANAMOS robustez frente a locks huérfanos y previsibilidad
 *   total del comportamiento de cualquier query.
 *
 * Para LucyCare (single-tenant, flujos cortos por usuario) el
 * trade-off es claramente favorable: el caso multi-tab simultáneo
 * es marginal y la pantalla blanca es catastrófica.
 */
const noopLock = async <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => fn()

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    lock: noopLock,
  },
})
