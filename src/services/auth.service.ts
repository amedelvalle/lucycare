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

  return {
    success: true,
    user: {
      id: data.user.id,
      phone: phone,
      name: profile?.full_name || null,
      role: profile?.role || 'patient',
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
