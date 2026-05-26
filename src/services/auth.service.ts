/**
 * Servicio de autenticación — Supabase Auth con OTP por SMS.
 * 
 * Reemplaza completamente src/utils/auth.ts (localStorage mock).
 * 
 * Flujo:
 * 1. Usuario ingresa teléfono → signInWithOtp() envía SMS via Twilio
 * 2. Usuario ingresa código → verifyOtp() valida y crea sesión
 * 3. Si es nuevo usuario, se crea profile con rol 'patient'
 */

import { supabase } from '../lib/supabase'

export interface AuthUser {
  id: string
  phone: string
  name: string | null
  role: string | null
}

/**
 * Paso 1: Enviar OTP por SMS al teléfono del usuario.
 * Si el usuario no existe, Supabase lo crea automáticamente.
 */
export async function sendOtp(phone: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.auth.signInWithOtp({
    phone,
  })

  if (error) {
    console.error('Error enviando OTP:', error)
    
    // Mensajes de error amigables
    if (error.message.includes('rate limit')) {
      return { success: false, error: 'Demasiados intentos. Espera un momento antes de intentar de nuevo.' }
    }
    if (error.message.includes('invalid phone')) {
      return { success: false, error: 'Número de teléfono inválido. Verifica el formato.' }
    }
    
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * Paso 2: Verificar el código OTP ingresado por el usuario.
 * Si es correcto, crea la sesión JWT y el profile si no existe.
 */
export async function verifyOtp(
  phone: string, 
  token: string
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: 'sms',
  })

  if (error) {
    console.error('Error verificando OTP:', error)
    
    if (error.message.includes('expired')) {
      return { success: false, error: 'El código ha expirado. Solicita uno nuevo.' }
    }
    if (error.message.includes('invalid') || error.message.includes('Token')) {
      return { success: false, error: 'Código incorrecto. Verifica e intenta de nuevo.' }
    }
    
    return { success: false, error: error.message }
  }

  if (!data.user) {
    return { success: false, error: 'No se pudo crear la sesión.' }
  }

  // Verificar/crear profile en la tabla profiles
  const profile = await ensureProfile(data.user.id, phone)

  // Procesar invitaciones pendientes (si la asistente fue invitada por un doctor)
  // Esto puede cambiar el role del profile de 'patient' a 'assistant'
  let finalRole = profile?.role || 'patient'
  try {
    const { data: acceptedCount } = await supabase.rpc('accept_clinic_invitations', {
      user_phone: phone,
    })
    if ((acceptedCount as number) > 0) {
      // Re-leer profile para tener el role actualizado
      const { data: updated } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single()
      if (updated?.role) finalRole = updated.role
    }
  } catch (err) {
    console.warn('[verifyOtp] error procesando invitaciones (no crítico):', err)
  }

  // Paciente Global Fase 1 — vinculación retroactiva de patients legacy.
  // Si el usuario ya tenía filas en `patients` con su phone (creadas por
  // walk-in de algún médico antes de que él se logueara), las vincula a
  // su profile. Fail-safe: si la RPC falla NO rompemos el login.
  // Solo aplica para pacientes (no doctor/asistente/admin) por simplicidad.
  if (finalRole === 'patient') {
    try {
      const { error: claimErr } = await supabase.rpc('claim_patient_records')
      if (claimErr) {
        console.warn('[verifyOtp] claim_patient_records error (silenciado):', claimErr.message)
      }
    } catch (err) {
      console.warn('[verifyOtp] claim_patient_records exception (silenciado):', err)
    }
  }

  return {
    success: true,
    user: {
      id: data.user.id,
      phone: phone,
      name: profile?.full_name || null,
      role: finalRole,
    },
  }
}

/**
 * Asegura que existe un registro en profiles para el usuario.
 * Si no existe (usuario nuevo), lo crea con rol 'patient'.
 */
async function ensureProfile(userId: string, phone: string) {
  // Intentar obtener profile existente
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, full_name, role, phone')
    .eq('id', userId)
    .single()

  if (existing) {
    return existing
  }

  // Crear profile nuevo para paciente
  const { data: newProfile, error } = await supabase
    .from('profiles')
    .insert({
      id: userId,
      phone: phone,
      role: 'patient',
      full_name: '',
    })
    .select()
    .single()

  if (error) {
    console.error('Error creando profile:', error)
    return null
  }

  return newProfile
}

/**
 * Obtener el usuario actual de la sesión activa.
 * Reemplaza getCurrentUser() del mock.
 */
export async function getCurrentAuthUser(): Promise<AuthUser | null> {
  const { data: { session } } = await supabase.auth.getSession()

  if (!session?.user) {
    return null
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', session.user.id)
    .single()

  return {
    id: session.user.id,
    phone: session.user.phone || '',
    name: profile?.full_name || null,
    role: profile?.role || 'patient',
  }
}

/**
 * Cerrar sesión.
 * Reemplaza clearCurrentUser() del mock.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

// ═══════════════════════════════════════════════════════════
// Email + Password (Fase 4 PR-A)
// ═══════════════════════════════════════════════════════════
// Usado solo por médicos (y admin). El paciente sigue con OTP por
// teléfono como flujo principal. Los métodos viven aquí para
// compartir el mismo cliente y el mismo manejo de profile.
// ═══════════════════════════════════════════════════════════

/**
 * Login con email + password.
 *
 * Mensaje de error genérico (mismo texto para "email no existe" y
 * "password incorrecto") para no filtrar qué emails tienen cuenta.
 */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })

  if (error) {
    console.warn('[signInWithEmail] error:', error.message)
    // Mensaje genérico — no revelamos si el email existe.
    return {
      success: false,
      error: 'Email o contraseña incorrectos. Si olvidaste tu contraseña, podés solicitar restablecerla.',
    }
  }

  if (!data.user) {
    return { success: false, error: 'No se pudo crear la sesión.' }
  }

  // Cargar profile para devolver role/name (sin crear: si llegó por
  // password, el profile ya debería existir).
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', data.user.id)
    .maybeSingle()

  return {
    success: true,
    user: {
      id: data.user.id,
      phone: data.user.phone || '',
      name: profile?.full_name || null,
      role: profile?.role || 'patient',
    },
  }
}

/**
 * Solicitar el envío del email de recuperación.
 *
 * SIEMPRE responde success: true (incluso si el email no existe)
 * para no filtrar qué emails están registrados. El log interno
 * sí captura el error real para debugging.
 *
 * El link de recuperación apunta a /reset-password (config en
 * Supabase Dashboard → Auth → URL Configuration).
 */
export async function requestPasswordReset(
  email: string,
): Promise<{ success: boolean }> {
  const cleanEmail = email.trim().toLowerCase()
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { success: true } // mismo mensaje genérico
  }

  const redirectTo = `${window.location.origin}/reset-password`
  const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo,
  })

  if (error) {
    console.warn('[requestPasswordReset] error (silenciado):', error.message)
  }

  // No revelamos el resultado real.
  return { success: true }
}

/**
 * Helper interno: setea password en la sesión activa vía fetch directo
 * a `PUT /auth/v1/user`.
 *
 * NO usa `supabase.auth.updateUser({ password })` — en sesiones donde
 * el usuario hizo varias llamadas previas a `supabase.auth.*` (ej.
 * primero OTP, después `requestPasswordReset`, después update password
 * dentro del mismo modal), el wrapper se cuelga ANTES de mandar la
 * request HTTP y el spinner queda en "Guardando…" indefinidamente.
 * Mismo patrón defensivo que `claimProfile.service.ts` y
 * `getMyProfileEmail`.
 *
 * Timeout 8 s. Mapea errores comunes a copy amigable.
 */
const SET_PASSWORD_TIMEOUT_MS = 8_000

async function setPasswordWithFetch(
  newPassword: string,
  accessToken: string,
): Promise<{ success: boolean; error?: string }> {
  if (!accessToken) {
    return {
      success: false,
      error: 'No pudimos confirmar tu sesión. Refrescá la página y volvé a intentar.',
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SET_PASSWORD_TIMEOUT_MS)

  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      body: JSON.stringify({ password: newPassword }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (resp.ok) {
      return { success: true }
    }

    // Mapear errores comunes de GoTrue a copy amigable.
    let body: { code?: string; error_code?: string; msg?: string; message?: string } = {}
    try {
      body = await resp.json()
    } catch {
      // body queda vacío
    }
    const code = body.code ?? body.error_code ?? ''
    const msg = body.msg ?? body.message ?? ''
    if (resp.status === 401 || resp.status === 403) {
      return {
        success: false,
        error: 'Tu sesión expiró. Refrescá la página y volvé a entrar para crear la contraseña.',
      }
    }
    if (resp.status === 422 || /password/i.test(msg)) {
      return {
        success: false,
        error: 'La contraseña no cumple los requisitos mínimos. Probá una distinta de al menos 8 caracteres.',
      }
    }
    console.warn('[setPasswordWithFetch] HTTP', resp.status, code, msg)
    return {
      success: false,
      error: 'No pudimos guardar tu contraseña. Probá de nuevo en un momento.',
    }
  } catch (err) {
    clearTimeout(timeoutId)
    const isAbort = err instanceof DOMException && err.name === 'AbortError'
    if (isAbort) {
      return {
        success: false,
        error: 'La operación tardó más de lo normal. Probá de nuevo.',
      }
    }
    console.warn('[setPasswordWithFetch] error:', err)
    return {
      success: false,
      error: 'Error de conexión al guardar la contraseña.',
    }
  }
}

/**
 * Establecer una nueva contraseña usando la sesión de recuperación
 * activa (el usuario llegó vía el link del email y Supabase ya
 * inyectó la sesión temporal).
 *
 * Sigue usando el wrapper de supabase-js porque el flujo de recovery
 * arranca con una sesión fresca (sin acumulación de calls previas) y
 * el hang no se ha observado ahí. Si se reportara, migrar a fetch
 * directo con el patrón de `setPasswordFromClaim`.
 */
export async function setPasswordFromRecovery(
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.user) {
    return {
      success: false,
      error: 'Tu link de recuperación expiró o no es válido. Solicitá uno nuevo.',
    }
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) {
    return {
      success: false,
      error: error.message,
    }
  }

  return { success: true }
}

/**
 * Establecer una contraseña usando la sesión OTP activa, dentro del
 * flujo de Reclamar perfil (Fase 4 PR-B). El médico ya validó
 * identidad (phone + license) en el reclamo previo; acá solo agregamos
 * password al `auth.users` que ya existe.
 *
 * Recibe el `accessToken` que el modal ya capturó (mismo patrón que
 * `claimDoctorProfile` y `getMyProfileEmail`) para no depender de
 * `supabase.auth.getSession()` ni del wrapper de `updateUser()`,
 * que se cuelgan en sesiones con varias llamadas previas.
 */
export async function setPasswordFromClaim(
  newPassword: string,
  accessToken: string,
): Promise<{ success: boolean; error?: string }> {
  return setPasswordWithFetch(newPassword, accessToken)
}

/**
 * Devuelve el email registrado en `profiles.email` del usuario
 * actual (self-select). Útil para mostrar el destino del link de
 * reset en el step "Crear contraseña" del Reclamar perfil.
 *
 * IMPORTANTE: usa fetch directo a PostgREST en vez de
 * `supabase.from(...)`. Igual que `claimProfile.service.ts`: en
 * algunos browsers con `navigator.locks` tomado por otra cosa, el
 * wrapper de supabase-js se cuelga ANTES de hacer la request HTTP
 * y la llamada nunca sale. El modal del Reclamar perfil pasa el
 * `accessToken` + `userId` que ya capturó al verificar OTP, así
 * no necesitamos `getSession()` acá tampoco.
 *
 * Timeout de 5 s. Si vence o falla la red, devuelve `null` → el
 * step "Recibir link por email" muestra el fallback amber ("No
 * encontramos un correo registrado").
 *
 * El acceso a `profiles.email` está habilitado por la policy
 * `profiles_self_select` (`auth.uid() = id`) — sin filtrado de
 * columnas.
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const PROFILE_EMAIL_TIMEOUT_MS = 5_000

export async function getMyProfileEmail(
  accessToken: string,
  userId: string,
): Promise<string | null> {
  if (!accessToken || !userId) return null
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PROFILE_EMAIL_TIMEOUT_MS)
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=email`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      },
    )
    clearTimeout(timeoutId)
    if (!resp.ok) {
      console.warn('[getMyProfileEmail] HTTP', resp.status)
      return null
    }
    const rows = (await resp.json()) as Array<{ email: string | null }>
    return rows?.[0]?.email ?? null
  } catch (err) {
    clearTimeout(timeoutId)
    console.warn('[getMyProfileEmail] error (silenciado):', err)
    return null
  }
}

/**
 * Determinar a dónde redirigir tras un login exitoso, según el rol
 * del usuario. Usado por la UI post-login y post-reset-password.
 *
 *  - admin     → /admin
 *  - doctor    → /panel (el panel ya muestra "Cuenta suspendida" si no es operativo)
 *  - assistant → /panel
 *  - patient o desconocido → /
 */
export function destinationForRole(role: string | null | undefined): string {
  switch (role) {
    case 'admin':
      return '/admin'
    case 'doctor':
    case 'assistant':
      return '/panel'
    default:
      return '/'
  }
}

/**
 * Escuchar cambios de sesión (login, logout, token refresh).
 * Útil para actualizar el estado global de autenticación.
 */
export function onAuthStateChange(callback: (user: AuthUser | null) => void) {
  return supabase.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', session.user.id)
        .single()

      callback({
        id: session.user.id,
        phone: session.user.phone || '',
        name: profile?.full_name || null,
        role: profile?.role || 'patient',
      })
    } else {
      callback(null)
    }
  })
}
