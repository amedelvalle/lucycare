/**
 * Servicio de registro de médico — conecta el formulario de 5 pasos a Supabase.
 * 
 * Flujo:
 * 1. Registrar usuario con OTP (auth.service.ts)
 * 2. Actualizar profile con rol 'doctor' y datos personales
 * 3. Crear clínica
 * 4. Crear clinic_member (owner)
 * 5. Crear registro en doctors (perfil público)
 * 6. Crear servicios
 * 7. Crear reglas de disponibilidad
 */

import { supabase } from '../lib/supabase'

interface DoctorRegistrationData {
  // Paso 1: Personal
  fullName: string
  email: string
  phone: string        // Solo dígitos, sin código país
  countryCode: string  // Ej: +503
  photo: File | null

  // Paso 2: Profesional
  specialtyId: string
  licenseNumber: string
  experienceYears: number

  // Paso 3: Ubicación
  departmentId: string
  municipalityId: string
  addressLine: string
  clinicName: string

  // Paso 4: Servicios
  services: { name: string; price: number; durationMinutes: number }[]

  // Paso 5: Disponibilidad
  availability: {
    dayOfWeek: number  // 0=domingo, 1=lunes, etc.
    startTime: string  // HH:MM
    endTime: string    // HH:MM
    slotDuration: number // minutos
  }[]
}

interface RegistrationResult {
  success: boolean
  error?: string
  doctorId?: string
}

/**
 * Registra un médico completo: profile + clinic + doctor + services + availability.
 * El usuario ya debe estar autenticado (OTP verificado).
 */
export async function registerDoctor(data: DoctorRegistrationData): Promise<RegistrationResult> {
  // Verificar que hay sesión activa
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    return { success: false, error: 'Debes iniciar sesión primero' }
  }

  const userId = session.user.id

  try {
    // ─── 1. Actualizar profile ───
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        full_name: data.fullName,
        email: data.email,
        role: 'doctor',
      })
      .eq('id', userId)

    if (profileError) {
      console.error('Error actualizando profile:', profileError)
      return { success: false, error: 'Error al guardar datos personales' }
    }

    // ─── 2. Subir foto si existe ───
    let avatarUrl: string | null = null
    if (data.photo) {
      const fileExt = data.photo.name.split('.').pop()
      const fileName = `${userId}/avatar.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, data.photo, { upsert: true })

      if (!uploadError) {
        const { data: urlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(fileName)
        avatarUrl = urlData.publicUrl

        // Actualizar avatar en profile
        await supabase
          .from('profiles')
          .update({ avatar_url: avatarUrl })
          .eq('id', userId)
      }
    }

    // ─── 3. Crear clínica ───
    const { data: clinic, error: clinicError } = await supabase
      .from('clinics')
      .insert({
        owner_id: userId,
        name: data.clinicName || `Consultorio ${data.fullName}`,
        phone: `${data.countryCode}${data.phone}`,
        address_line: data.addressLine,
        department_id: data.departmentId || null,
        municipality_id: data.municipalityId || null,
      })
      .select('id')
      .single()

    if (clinicError || !clinic) {
      console.error('Error creando clínica:', clinicError)
      return { success: false, error: 'Error al crear el consultorio' }
    }

    // ─── 4. Crear clinic_member (owner) ───
    const { error: memberError } = await supabase
      .from('clinic_members')
      .insert({
        clinic_id: clinic.id,
        profile_id: userId,
        role: 'owner',
      })

    if (memberError) {
      console.error('Error creando clinic_member:', memberError)
      // No es crítico, seguimos
    }

    // ─── 5. Crear doctor (perfil público) ───
    const { data: doctor, error: doctorError } = await supabase
      .from('doctors')
      .insert({
        profile_id: userId,
        clinic_id: clinic.id,
        specialty_id: data.specialtyId || null,
        license_number: data.licenseNumber,
        experience_years: data.experienceYears,
        bio: '',
        consultation_fee: data.services.length > 0 ? Math.min(...data.services.map(s => s.price)) : null,
        is_published: false,  // No visible hasta verificación
        is_verified: false,
        lucy_status: 'claimed',
        booking_enabled: false,
      })
      .select('id')
      .single()

    if (doctorError || !doctor) {
      console.error('Error creando doctor:', doctorError)
      return { success: false, error: 'Error al crear el perfil médico' }
    }

    // ─── 6. Crear servicios ───
    if (data.services.length > 0) {
      const servicesData = data.services.map((s, index) => ({
        doctor_id: doctor.id,
        name: s.name,
        price: s.price,
        duration_minutes: s.durationMinutes || 30,
        sort_order: index,
        is_active: true,
      }))

      const { error: servicesError } = await supabase
        .from('services')
        .insert(servicesData)

      if (servicesError) {
        console.error('Error creando servicios:', servicesError)
        // No es crítico, seguimos
      }
    }

    // ─── 7. Crear reglas de disponibilidad ───
    if (data.availability.length > 0) {
      const availabilityData = data.availability.map(a => ({
        doctor_id: doctor.id,
        clinic_id: clinic.id,
        day_of_week: a.dayOfWeek,
        start_time: a.startTime,
        end_time: a.endTime,
        slot_duration_min: a.slotDuration || 30,
        is_active: true,
      }))

      const { error: availError } = await supabase
        .from('availability_rules')
        .insert(availabilityData)

      if (availError) {
        console.error('Error creando disponibilidad:', availError)
        // No es crítico, seguimos
      }
    }

    return { success: true, doctorId: doctor.id }

  } catch (err) {
    console.error('Error general en registro:', err)
    return { success: false, error: 'Error inesperado. Intenta de nuevo.' }
  }
}
