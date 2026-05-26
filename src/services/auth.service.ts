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
 * Helper interno: setea password en la sesión activa.
 *
 * Es la misma operación tanto para "vine de un link de recovery" como
 * para "estoy logueado por OTP y quiero crear mi password ahora dentro
 * del flujo de Reclamar perfil". La única diferencia es el copy del
 * error cuando no hay sesión, que cada wrapper aporta.
 */
async function setPasswordOnActiveSession(
  newPassword: string,
  noSessionError: string,
): Promise<{ success: boolean; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.user) {
    return { success: false, error: noSessionError }
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
 * Establecer una nueva contraseña usando la sesión de recuperación
 * activa (el usuario llegó vía el link del email y Supabase ya
 * inyectó la sesión temporal).
 */
export async function setPasswordFromRecovery(
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  return setPasswordOnActiveSession(
    newPassword,
    'Tu link de recuperación expiró o no es válido. Solicitá uno nuevo.',
  )
}

/**
 * Establecer una contraseña usando la sesión OTP activa, dentro del
 * flujo de Reclamar perfil (Fase 4 PR-B). El médico ya validó
 * identidad (phone + license) en el reclamo previo; acá solo agregamos
 * password al `auth.users` que ya existe.
 */
export async function setPasswordFromClaim(
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  return setPasswordOnActiveSession(
    newPassword,
    'No pudimos confirmar tu sesión. Cerrá el modal, refrescá la página y volvé a intentar.',
  )
}

/**
 * Devuelve el email registrado en `profiles.email` del usuario
 * actual (self-select). Útil para mostrar el destino del link de
 * reset en el step "Crear contraseña" del Reclamar perfil.
 *
 * Devuelve `null` si no hay sesión o si el profile no tiene email.
 * El acceso está habilitado por la policy `profiles_self_select`
 * (`auth.uid() = id`) — sin filtrado de columnas.
 */
export async function getMyProfileEmail(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', session.user.id)
    .maybeSingle()

  if (error) {
    console.warn('[getMyProfileEmail] error (silenciado):', error.message)
    return null
  }
  return data?.email ?? null
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
