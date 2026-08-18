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
import { isAuthError, createClient } from '@supabase/supabase-js'
import { toAuthPhone, toAppPhone } from '../lib/authPhone'
import { probeSessionState } from '../lib/sessionState'
import { passwordErrorMessage } from '../lib/passwordErrors'
import { OTP_CONSENT_VERSION, OTP_CONSENT_TEXT_SHA256 } from '../lib/otpConsent'
import { getMyLucyAdminAccess } from './directoryEditor.service'

// ═══════════════════════════════════════════════════════════
// AUTH-P1A — teléfono como identidad, formato único y contexto de OTP
// ═══════════════════════════════════════════════════════════
// La normalización vive en `src/lib/authPhone.ts` (módulo PURO, sin copias
// locales acá): `toAuthPhone` = E.164 para Supabase Auth · `toAppPhone` =
// representación interna, validada con el mismo normalizador, derivada
// SIEMPRE de `data.user.phone`. El check local `check-auth-p1a-phone.mjs`
// prueba esas funciones reales.

/**
 * Cierre seguro cuando un login queda sin identidad utilizable (sin
 * teléfono autenticado canonicalizable).
 *
 * Usa `probeSessionState` (src/lib/sessionState.ts), que distingue SIN
 * ambigüedad: 'none' (consulta completada, sin sesión) · 'present'
 * (consulta completada, hay sesión) · 'timeout' · 'error'.
 *
 * Secuencia ACOTADA (sin loops ni reintentos indefinidos):
 *   1. espera `hardLocalSignOut()`;
 *   2. consulta el estado etiquetado;
 *   3. si NO es 'none' → SEGUNDA y última limpieza;
 *   4. consulta nuevamente;
 *   5. devuelve `true` ÚNICAMENTE si el resultado final es 'none';
 *   6. para 'present'/'timeout'/'error' devuelve `false` — el caller no
 *      ejecuta side-effects, no navega y responde con error genérico.
 *
 * La revisión de claves `sb-*` es solo diagnóstico SECUNDARIO. Jamás se
 * registran teléfono, tokens ni datos sensibles.
 */
async function safeAbortSession(logTag: string): Promise<boolean> {
  console.warn(`[${logTag}] sesión sin teléfono autenticado canonicalizable — cierre seguro`)

  await hardLocalSignOut()

  // Diagnóstico secundario: persistencia local.
  try {
    const leftover = Object.keys(localStorage).filter((k) => k.startsWith('sb-'))
    if (leftover.length > 0) {
      console.warn(`[${logTag}] persistencia local incompleta — limpiando claves restantes`)
      leftover.forEach((k) => localStorage.removeItem(k))
    }
  } catch {
    // localStorage inaccesible → nada más que limpiar.
  }

  // Prueba PRINCIPAL: estado etiquetado de la sesión real del cliente.
  let state = await probeSessionState(() => supabase.auth.getSession(), 3000)

  if (state !== 'none') {
    // Segunda y ÚLTIMA limpieza controlada.
    console.warn(`[${logTag}] estado de sesión '${state}' tras la limpieza — segunda y última limpieza`)
    await hardLocalSignOut()
    state = await probeSessionState(() => supabase.auth.getSession(), 3000)
  }

  if (state === 'none') return true

  // 'present' | 'timeout' | 'error': cierre NO confirmado. Constancia sin
  // datos sensibles; el caller aborta con error genérico, sin side-effects
  // ni navegación.
  console.warn(`[${logTag}] cierre no confirmado (estado '${state}') — abortado sin side-effects`)
  return false
}

/**
 * Contexto del envío de OTP (OBLIGATORIO en `sendOtp`).
 *
 * ⚠️ SEGURIDAD — leer antes de tocar este tipo:
 *   - El contexto lo envía el NAVEGADOR: es plumbing y clasificación
 *     funcional, NO una autorización server-side. Un cliente hostil puede
 *     mandar cualquier contexto (o llamar a /auth/v1/otp directo).
 *   - `shouldCreateUser` explícito en P1A CONSERVA transitoriamente el
 *     comportamiento actual (ver mapa abajo).
 *   - La elegibilidad REAL de creación de cuentas se aplicará en AUTH-P1B
 *     con controles server-side (Before User Created Hook + Send SMS Hook).
 */
export type OtpContext = 'login' | 'booking' | 'claim' | 'activation' | 'recovery'

/**
 * Mapa contexto → shouldCreateUser (APROBADO en AUTH-P1B2A):
 *   booking    → true  (flujo permitido de creación de pacientes: el intent
 *                       emite el auth_creation_grant ANTES del OTP, s7_66)
 *   login      → false (DECISIÓN DE PRODUCTO CONGELADA: el login genérico
 *                       NUNCA origina una cuenta. Un teléfono sin cuenta
 *                       recibe NO_ACCOUNT_LOGIN_MESSAGE y se le guía a
 *                       reservar; JAMÁS se crea auth.user/profile/paciente)
 *   claim      → true  (seed/legacy sin auth.user crean el suyo al reclamar, s7_13)
 *   activation → true  (SIN caller aún; la elegibilidad server-side la decide
 *                       el Before User Created Hook, s7_65)
 *   recovery   → false (SIN caller aún; recuperación jamás crea usuarios)
 */
// Exportado SOLO para el check estructural (check-auth-p1a-phone.mjs /
// check-auth-p1b2a-login-gating.mjs verifican que cada contexto conserva el
// valor aprobado). No consumir desde la UI: el contexto se pasa a sendOtp, no
// se decide por fuera.
export const OTP_SHOULD_CREATE_USER: Readonly<Record<OtpContext, boolean>> = {
  login: false,
  booking: true,
  claim: true,
  activation: true,
  recovery: false,
}

/**
 * Mensaje visible cuando un login genérico (shouldCreateUser=false) apunta a
 * un teléfono SIN cuenta. Tuteo, claro y accionable: guía a reservar (único
 * camino de creación de pacientes) SIN confirmar de forma tajante si el número
 * tiene o no cuenta — el mismo texto sirve para "no existe" y "número mal
 * tipeado". No se crea ningún auth.user/profile/paciente.
 */
export const NO_ACCOUNT_LOGIN_MESSAGE =
  '¿Primera vez en LucyCare? Reserva una cita para crear tu acceso. Si ya tienes cuenta, verifica tu número e inténtalo de nuevo.'

export interface AuthUser {
  id: string
  phone: string
  name: string | null
  role: string | null
}

/**
 * Sesión no recuperable: refresh token vencido/rechazado, o error de Auth al
 * restaurar la sesión. Reintentar NO la recupera → el caller debe ofrecer
 * reingreso (limpieza dura + login), no un loop de "Reintentar".
 */
export class SessionExpiredError extends Error {
  constructor() {
    super('session-expired')
    this.name = 'SessionExpiredError'
  }
}

/**
 * Carga el usuario del panel distinguiendo el TIPO de fallo (para no mostrar
 * "revisá tu conexión" cuando en realidad la sesión venció):
 *   - devuelve AuthUser | null (null = sin sesión → el caller redirige);
 *   - lanza `SessionExpiredError` si `getSession()` reporta un error de Auth
 *     (refresh inválido/rechazado) → sesión no recuperable;
 *   - re-lanza cualquier otro error (red/timeout) → el caller lo trata como
 *     problema temporal de conexión (Reintentar sí puede servir).
 */
export async function loadPanelUser(): Promise<AuthUser | null> {
  let session
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      // getSession devolvió error SIN lanzar: típico de refresh token
      // inválido/rechazado → sesión no recuperable.
      if (isAuthError(error)) throw new SessionExpiredError()
      throw error
    }
    session = data.session
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err
    // getSession LANZÓ: si es error de Auth → sesión no recuperable; si no
    // (red/otro) → se propaga como recuperable.
    if (isAuthError(err)) throw new SessionExpiredError()
    throw err
  }

  if (!session?.user) return null

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
 * Cierre de sesión LOCAL robusto (mismo patrón que `useIdleLogout`): el
 * `signOut()` de supabase-js puede colgarse por el lock no-op, así que NO lo
 * esperamos; hacemos limpieza dura de las claves `sb-*` de localStorage para
 * garantizar un estado sin sesión aunque el signOut nunca resuelva. El caller
 * decide la navegación/recarga.
 */
export async function hardLocalSignOut(): Promise<void> {
  // best-effort, NO bloqueante (el noopLock puede colgar signOut).
  void supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  try {
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith('sb-')) localStorage.removeItem(k)
    })
    localStorage.removeItem('lc_last_activity')
  } catch {
    // localStorage inaccesible (modo privado extremo) → nada que limpiar.
  }
}

/**
 * Paso 1: Enviar OTP por SMS al teléfono del usuario.
 *
 * AUTH-P1A: el CONTEXTO es obligatorio (ver `OtpContext` arriba: es
 * clasificación funcional, no autorización server-side) y el teléfono se
 * normaliza SIEMPRE con `toAuthPhone` — variantes de formato del mismo
 * número no pueden producir identidades distintas.
 */
/**
 * AUTH-P1D2 — registro OBLIGATORIO de la evidencia del consentimiento de OTP,
 * PRE-AUTH y ANTES de signInWithOtp.
 *
 * NO es best-effort: si la RPC `record_otp_consent` (s7_69) falla, el caller
 * NO debe enviar el OTP (sin evidencia, no hay SMS). Devuelve `true` solo con
 * éxito o idempotencia válida (mismo `request_id` reinsertado → la RPC hace
 * ON CONFLICT DO NOTHING y no devuelve error).
 *
 * `requestId`: se genera uno NUEVO por intento visible de envío/reenvío. El
 * parámetro existe únicamente para REINTENTOS TÉCNICOS de una misma operación
 * (conservar idempotencia); la UI no lo reutiliza entre intentos.
 *
 * Nunca se registran OTP, captcha token, IP ni datos sensibles. Los errores se
 * loguean sin detalle (código corto) y jamás se propagan al usuario: el caller
 * muestra un mensaje genérico.
 */
async function recordOtpConsent(
  authPhoneE164: string,
  context: OtpContext,
  requestId?: string,
): Promise<boolean> {
  try {
    const rid =
      requestId ||
      (globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const { error } = await supabase.rpc('record_otp_consent', {
      p_phone: authPhoneE164,
      p_context: context,
      p_consent_version: OTP_CONSENT_VERSION,
      p_consent_text_hash: OTP_CONSENT_TEXT_SHA256,
      p_request_id: rid,
    })
    if (error) {
      // Sin detalle: no se revelan límites internos, existencia del teléfono
      // ni errores SQL.
      console.warn('[recordOtpConsent] fallo del registro:', error.code ?? 'error')
      return false
    }
    return true
  } catch {
    console.warn('[recordOtpConsent] excepción en el registro')
    return false
  }
}

/** Mensaje genérico cuando no se pudo registrar el consentimiento. */
const CONSENT_RECORD_FAILED_MESSAGE =
  'No pudimos procesar la solicitud. Inténtalo de nuevo en un momento.'

export async function sendOtp(
  phone: string,
  context: OtpContext,
  opts: { captchaToken?: string; requestId?: string } = {},
): Promise<{ success: boolean; error?: string }> {
  const authPhone = toAuthPhone(phone)
  if (!authPhone) {
    return { success: false, error: 'Número de teléfono inválido. Verifica el formato.' }
  }

  // AUTH-P1D2 (orden VINCULANTE): consentimiento visible (UI) → Turnstile válido
  // (UI) → record_otp_consent (aquí, OBLIGATORIO) → signInWithOtp (aquí) →
  // reset del captcha (UI, en finally).
  // Si el registro falla NO se llama a signInWithOtp y NO se envía OTP.
  const consentRecorded = await recordOtpConsent(authPhone, context, opts.requestId)
  if (!consentRecorded) {
    return { success: false, error: CONSENT_RECORD_FAILED_MESSAGE }
  }

  const { error } = await supabase.auth.signInWithOtp({
    phone: authPhone,
    options: {
      shouldCreateUser: OTP_SHOULD_CREATE_USER[context],
      captchaToken: opts.captchaToken,
    },
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
    // Login genérico (shouldCreateUser=false) sobre un teléfono SIN cuenta:
    // GoTrue responde "Signups not allowed for otp" (code 'otp_disabled') y NO
    // crea nada. Se traduce a un mensaje que guía a reservar sin revelar de
    // más la existencia de la cuenta.
    if (
      (error as { code?: string }).code === 'otp_disabled' ||
      /signups?\s+not\s+allowed/i.test(error.message) ||
      /otp_disabled|signup_disabled/i.test(error.message)
    ) {
      return { success: false, error: NO_ACCOUNT_LOGIN_MESSAGE }
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
  // Mismo formato único que sendOtp: la verificación debe apuntar al MISMO
  // número al que se envió el código, sin depender del formato tipeado.
  const authPhone = toAuthPhone(phone)
  if (!authPhone) {
    return { success: false, error: 'Número de teléfono inválido. Verifica el formato.' }
  }

  const { data, error } = await supabase.auth.verifyOtp({
    phone: authPhone,
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

  // AUTH-P1A: la IDENTIDAD post-login proviene SIEMPRE de data.user.phone
  // (lo autenticado según Supabase), nunca del texto tipeado. Sin teléfono
  // autenticado no hay identidad utilizable → cierre seguro, sin
  // side-effects, error genérico, sin datos sensibles en logs.
  const appPhone = toAppPhone(data.user.phone)
  if (!appPhone) {
    await safeAbortSession('verifyOtp')
    return { success: false, error: 'No se pudo crear la sesión.' }
  }

  const effects = await runPostLoginSideEffects(data.user.id, appPhone, {
    // s7_44 (regla vinculante): la activación de una invitación de admin
    // SOLO ocurre tras un OTP (prueba de posesión del teléfono).
    includeAdminActivation: true,
  })

  return {
    success: true,
    user: {
      id: data.user.id,
      phone: appPhone,
      name: effects.name,
      role: effects.role,
    },
  }
}

/**
 * Side-effects post-login COMPARTIDOS (AUTH-P1A).
 *
 * Se ejecutan después de CUALQUIER login del flujo teléfono (OTP y
 * teléfono+contraseña) para que una invitación o vinculación posterior a la
 * activación no quede huérfana cuando el usuario ya no vuelve a usar OTP.
 * Todas las operaciones son idempotentes y self-gated SERVER-SIDE
 * (ensureProfile: select-then-insert; las 3 RPCs solo actúan sobre
 * pendientes propios) y fail-safe: jamás rompen el login.
 *
 * `includeAdminActivation`: `accept_platform_admin_invitation` corre
 * ÚNICAMENTE tras OTP (regla vinculante de s7_44 — prueba de posesión del
 * teléfono); NUNCA tras un login por contraseña.
 *
 * NOTA DE ALCANCE (AUTH-P1A): el "login con contraseña" de este frente es el
 * flujo NUEVO teléfono+contraseña. El login legado por EMAIL
 * (`signInWithEmail`) queda INTACTO en este PR: hoy no corre side-effects y
 * sigue sin correrlos (decisión consciente, se revisará fuera de P1A).
 */
async function runPostLoginSideEffects(
  userId: string,
  phone: string,
  opts: { includeAdminActivation: boolean },
): Promise<{ role: string; name: string | null }> {
  // Verificar/crear profile en la tabla profiles
  const profile = await ensureProfile(userId, phone)

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
        .eq('id', userId)
        .single()
      if (updated?.role) finalRole = updated.role
    }
  } catch (err) {
    console.warn('[runPostLoginSideEffects] error procesando invitaciones (no crítico):', err)
  }

  // Administración de LucyAdmins Fase 1 (s7_44): activar una invitación de
  // admin pendiente al primer login/OTP (prueba de posesión del teléfono).
  // Fail-safe: si la RPC falla o no hay invitación, el login sigue normal.
  // La invitación pending NO otorga privilegios; recién acá se promueve.
  if (opts.includeAdminActivation) {
    try {
      const { data: adminAct } = await supabase.rpc('accept_platform_admin_invitation')
      if ((adminAct as { activated?: boolean } | null)?.activated) {
        const { data: updated } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .single()
        if (updated?.role) finalRole = updated.role
      }
    } catch (err) {
      console.warn('[runPostLoginSideEffects] accept_platform_admin_invitation (silenciado):', err)
    }
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
        console.warn('[runPostLoginSideEffects] claim_patient_records error (silenciado):', claimErr.message)
      }
    } catch (err) {
      console.warn('[runPostLoginSideEffects] claim_patient_records exception (silenciado):', err)
    }
  }

  return { role: finalRole, name: profile?.full_name || null }
}

/**
 * AUTH-P1A: login habitual con TELÉFONO + CONTRASEÑA.
 *
 * - Normaliza la entrada con `toAuthPhone` (mismo formato único que sendOtp).
 * - Mensaje de error ÚNICO y genérico: no distingue "teléfono inexistente"
 *   de "contraseña incorrecta" (no se filtra qué números tienen cuenta).
 * - El error técnico se conserva solo para logging interno seguro (sin
 *   teléfono, sin contraseña, sin tokens).
 * - Ejecuta los side-effects compartidos SIN activación de admin (s7_44:
 *   esa activación exige OTP).
 */
export async function signInWithPhonePassword(
  phoneRaw: string,
  password: string,
  captchaToken?: string,
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  const GENERIC_ERROR = 'El teléfono o la contraseña no son correctos.'

  const authPhone = toAuthPhone(phoneRaw)
  if (!authPhone) {
    // Entrada no interpretable como teléfono → mismo mensaje genérico.
    return { success: false, error: GENERIC_ERROR }
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    phone: authPhone,
    password,
    options: { captchaToken },
  })

  if (error) {
    // Logging interno SIN datos sensibles (ni teléfono ni contraseña).
    console.warn('[signInWithPhonePassword] auth error:', error.name, error.status ?? '')
    return { success: false, error: GENERIC_ERROR }
  }

  if (!data.user) {
    return { success: false, error: 'No se pudo crear la sesión.' }
  }

  // PROTECCIÓN (AUTH-P1A): la identidad post-login proviene SIEMPRE de
  // data.user.phone. Si el usuario autenticado no tiene teléfono, NO se
  // ejecutan side-effects: cierre seguro de la sesión (mecanismo existente),
  // error genérico, y ningún dato sensible en logs.
  const appPhone = toAppPhone(data.user.phone)
  if (!appPhone) {
    await safeAbortSession('signInWithPhonePassword')
    return { success: false, error: 'No se pudo crear la sesión.' }
  }

  const effects = await runPostLoginSideEffects(data.user.id, appPhone, {
    includeAdminActivation: false,
  })

  return {
    success: true,
    user: {
      id: data.user.id,
      phone: appPhone,
      name: effects.name,
      role: effects.role,
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
  captchaToken?: string,
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
    options: { captchaToken },
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
  captchaToken?: string,
): Promise<{ success: boolean }> {
  const cleanEmail = email.trim().toLowerCase()
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { success: true } // mismo mensaje genérico
  }

  const redirectTo = `${window.location.origin}/reset-password`
  const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo,
    captchaToken,
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
      error: 'No pudimos confirmar tu sesión. Refresca la página y vuelve a intentar.',
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
    // PASSWORD-ERROR-COPY-P0: una sola fuente de copy. Antes TODO 422 caía en
    // "no cumple los requisitos mínimos", así que un `same_password` se
    // reportaba como contraseña débil. `msg` solo clasifica: nunca se muestra.
    console.warn('[setPasswordWithFetch] HTTP', resp.status, code)
    return {
      success: false,
      error: passwordErrorMessage({ code, status: resp.status, message: msg }),
    }
  } catch (err) {
    clearTimeout(timeoutId)
    const isAbort = err instanceof DOMException && err.name === 'AbortError'
    if (isAbort) {
      return {
        success: false,
        error: 'La operación tardó más de lo normal. Prueba de nuevo.',
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
      error: 'Tu link de recuperación expiró o no es válido. Solicita uno nuevo.',
    }
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) {
    // PASSWORD-ERROR-COPY-P0: antes se devolvía `error.message` crudo y el
    // usuario veía inglés de GoTrue (p. ej. "New password should be different
    // from the old password."). El mensaje del proveedor solo clasifica.
    const status = (error as { status?: number }).status ?? null
    const code = (error as { code?: string }).code ?? null
    console.warn('[setPasswordFromRecovery] error de Auth:', code ?? status ?? 'desconocido')
    return {
      success: false,
      error: passwordErrorMessage({ code, status, message: error.message }),
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

// Lock no-op (mismo patrón que src/lib/supabase.ts): evita el cuelgue por
// navigator.locks. El cliente transitorio no persiste ni refresca, así que en
// la práctica no toma el lock; se pasa por consistencia y previsibilidad.
const noopLock = async <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => fn()

/**
 * AUTH-P1C1 — Verificación de OTP para el SETUP de contraseña por teléfono, con
 * un cliente Supabase TRANSITORIO. Deliberadamente SEPARADA de `verifyOtp` (que
 * NO se toca: sigue sirviendo a claim médico, cambio de teléfono y demás
 * callers, estableciendo la sesión principal + side-effects).
 *
 * El cliente transitorio usa `persistSession:false`, `autoRefreshToken:false`,
 * `detectSessionInUrl:false`:
 *   - NO toca la sesión del cliente PRINCIPAL (`supabase`);
 *   - NO ejecuta side-effects post-login;
 *   - conserva el token SOLO en memoria (lo devuelve al caller).
 *
 * El caller usa ese token para setear la contraseña y RECIÉN DESPUÉS inicia
 * sesión real con `signInWithPhonePassword` (ahí corren los side-effects). Si el
 * usuario recarga/cierra la página o el guardado falla ANTES de ese login, el
 * cliente principal NUNCA quedó con una sesión persistente y no se completa el
 * acceso ni la reserva.
 */
export async function verifyOtpForPasswordSetup(
  phoneRaw: string,
  token: string,
): Promise<{ success: boolean; accessToken?: string; userId?: string; error?: string }> {
  const authPhone = toAuthPhone(phoneRaw)
  if (!authPhone) {
    return { success: false, error: 'Número de teléfono inválido. Verifica el formato.' }
  }

  const transient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      lock: noopLock,
    },
  })

  const { data, error } = await transient.auth.verifyOtp({
    phone: authPhone,
    token,
    type: 'sms',
  })

  if (error) {
    console.warn('[verifyOtpForPasswordSetup] error:', error.name, error.status ?? '')
    if (error.message.includes('expired')) {
      return { success: false, error: 'El código ha expirado. Solicita uno nuevo.' }
    }
    // Genérico: no exponemos el mensaje crudo de GoTrue.
    return { success: false, error: 'Código incorrecto. Verifica e intenta de nuevo.' }
  }

  const accessToken = data.session?.access_token
  const userId = data.user?.id
  if (!accessToken || !userId) {
    return { success: false, error: 'No se pudo confirmar tu sesión. Intenta de nuevo.' }
  }

  // A PROPÓSITO: aquí NO se corren side-effects. El caller setea la contraseña
  // con este token y luego hace login real en el cliente principal.
  return { success: true, accessToken, userId }
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
 * Destino post-login considerando TAMBIÉN el acceso LucyAdmin por capacidad
 * (`lucyadmin_access`, s7_57) y no solo `profiles.role`.
 *
 * Un `operations_admin` / `directory_editor` tiene `profiles.role='patient'`:
 * `destinationForRole` lo mandaría al home. Acá consultamos la MISMA RPC que
 * usa el guard (`my_lucyadmin_access`) y lo mandamos a `/admin`. Qué sección
 * ve después NO se decide aquí: lo resuelven `AdminOnlyRoute` y
 * `RequireOwnerAdmin` (un nivel acotado aterriza en `/admin/medicos`).
 *
 * La RPC solo se consulta cuando el destino por rol es el home: admin, doctor
 * y assistant ya tienen destino propio y no gastan una llamada. Si la RPC
 * falla, cae al destino por rol — nunca bloquea el login.
 */
export async function destinationAfterLogin(role: string | null | undefined): Promise<string> {
  const byRole = destinationForRole(role)
  if (byRole !== '/') return byRole
  try {
    const access = await getMyLucyAdminAccess()
    return access.can_access_lucyadmin ? '/admin' : byRole
  } catch {
    return byRole
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
