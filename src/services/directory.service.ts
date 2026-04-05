/**
 * Servicio de directorio — queries a Supabase para el listado y detalle de médicos.
 * 
 * Reemplaza completamente src/mocks/doctors.ts
 * 
 * Tablas involucradas:
 * - doctors (perfil público)
 * - profiles (nombre, avatar)
 * - clinics (ubicación)
 * - specialties (nombre de especialidad)
 * - services (servicios y precios)
 * - doctor_images (galería)
 * - departments (departamento)
 * - municipalities (municipio)
 */

import { supabase } from '../lib/supabase'
import type {
  DoctorCard,
  DoctorDetail,
  DoctorService,
  DoctorImage,
  DirectoryFilters,
  Specialty,
  Department,
  Municipality,
} from '../types/directory.types'

// ─────────────────────────────────────────────
// LISTADO DEL DIRECTORIO
// ─────────────────────────────────────────────

/**
 * Obtiene los médicos publicados para el directorio público.
 * Solo muestra médicos con is_published = true.
 * Soporta filtros por nombre, especialidad, departamento y municipio.
 */
export async function fetchDoctors(
  filters: DirectoryFilters
): Promise<DoctorCard[]> {
  // Query base: doctors publicados con JOINs
  let query = supabase
    .from('doctors')
    .select(`
      id,
      profile_id,
      specialty_id,
      bio,
      consultation_fee,
      experience_years,
      is_verified,
      lucy_status,
      booking_enabled,
      languages,
      profiles!inner (
        full_name,
        avatar_url
      ),
      clinics!inner (
        id,
        name,
        department_id,
        municipality_id,
        address_line,
        departments (
          id,
          name
        ),
        municipalities (
          id,
          name
        )
      ),
      specialties (
        id,
        name
      ),
      services (
        price
      )
    `)
    .eq('is_published', true)
    .order('is_verified', { ascending: false }) // Verificados primero
    .order('created_at', { ascending: false })

  // Filtro por especialidad
  if (filters.specialtyId) {
    query = query.eq('specialty_id', filters.specialtyId)
  }

  // Filtro por departamento (a través de clinics)
  if (filters.departmentId) {
    query = query.eq('clinics.department_id', filters.departmentId)
  }

  // Filtro por municipio (a través de clinics)
  if (filters.municipalityId) {
    query = query.eq('clinics.municipality_id', filters.municipalityId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching doctors:', error)
    throw new Error(`Error al cargar médicos: ${error.message}`)
  }

  if (!data) return []

  // Mapear datos de Supabase a nuestro tipo DoctorCard
  let doctors: DoctorCard[] = data.map((doc: any) => {
    // Calcular precio mínimo de servicios
    const prices = (doc.services || [])
      .map((s: any) => s.price)
      .filter((p: any) => p != null)
    const startingPrice = prices.length > 0 ? Math.min(...prices) : null

    return {
      id: doc.id,
      profileId: doc.profile_id,
      fullName: doc.profiles?.full_name || 'Sin nombre',
      avatarUrl: doc.profiles?.avatar_url || null,
      specialty: doc.specialties?.name || null,
      specialtyId: doc.specialty_id,
      bio: doc.bio,
      consultationFee: doc.consultation_fee ? Number(doc.consultation_fee) : null,
      experienceYears: doc.experience_years,
      isVerified: doc.is_verified,
      lucyStatus: doc.lucy_status,
      bookingEnabled: doc.booking_enabled,
      languages: doc.languages || ['Español'],
      clinicName: doc.clinics?.name || '',
      clinicId: doc.clinics?.id || '',
      department: doc.clinics?.departments?.name || null,
      departmentId: doc.clinics?.department_id || null,
      municipality: doc.clinics?.municipalities?.name || null,
      municipalityId: doc.clinics?.municipality_id || null,
      addressLine: doc.clinics?.address_line || null,
      startingPrice,
    }
  })

  // Filtro por nombre (client-side para soportar búsqueda sin tildes)
  if (filters.search && filters.search.trim() !== '') {
    const searchNormalized = normalizeText(filters.search)
    doctors = doctors.filter((doc) =>
      normalizeText(doc.fullName).includes(searchNormalized)
    )
  }

  return doctors
}

// ─────────────────────────────────────────────
// DETALLE DEL DOCTOR
// ─────────────────────────────────────────────

/**
 * Obtiene el detalle completo de un doctor por su ID.
 * Incluye servicios, imágenes y datos de la clínica.
 */
export async function fetchDoctorDetail(
  doctorId: string
): Promise<DoctorDetail | null> {
  const { data, error } = await supabase
    .from('doctors')
    .select(`
      id,
      profile_id,
      specialty_id,
      license_number,
      bio,
      consultation_fee,
      experience_years,
      is_verified,
      lucy_status,
      booking_enabled,
      languages,
      education,
      profiles!inner (
        full_name,
        avatar_url
      ),
      clinics!inner (
        id,
        name,
        phone,
        department_id,
        municipality_id,
        address_line,
        departments (
          id,
          name
        ),
        municipalities (
          id,
          name
        )
      ),
      specialties (
        id,
        name
      ),
      services (
        id,
        name,
        duration_minutes,
        price,
        is_first_visit,
        sort_order
      ),
      doctor_images (
        id,
        image_url,
        sort_order
      )
    `)
    .eq('id', doctorId)
    .eq('is_published', true)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      // No encontrado
      return null
    }
    console.error('Error fetching doctor detail:', error)
    throw new Error(`Error al cargar doctor: ${error.message}`)
  }

  if (!data) return null

  const doc = data as any

  // Calcular precio mínimo
  const prices = (doc.services || [])
    .map((s: any) => s.price)
    .filter((p: any) => p != null)
  const startingPrice = prices.length > 0 ? Math.min(...prices) : null

  // Mapear servicios
  const services: DoctorService[] = (doc.services || [])
    .filter((s: any) => s.is_active !== false)
    .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((s: any) => ({
      id: s.id,
      name: s.name,
      durationMinutes: s.duration_minutes,
      price: s.price ? Number(s.price) : null,
      isFirstVisit: s.is_first_visit,
      sortOrder: s.sort_order,
    }))

  // Mapear imágenes
  const images: DoctorImage[] = (doc.doctor_images || [])
    .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((img: any) => ({
      id: img.id,
      imageUrl: img.image_url,
      sortOrder: img.sort_order,
    }))

  // Parsear education (JSONB)
  let education = []
  try {
    education = Array.isArray(doc.education) ? doc.education : []
  } catch {
    education = []
  }

  return {
    id: doc.id,
    profileId: doc.profile_id,
    fullName: doc.profiles?.full_name || 'Sin nombre',
    avatarUrl: doc.profiles?.avatar_url || null,
    specialty: doc.specialties?.name || null,
    specialtyId: doc.specialty_id,
    bio: doc.bio,
    consultationFee: doc.consultation_fee ? Number(doc.consultation_fee) : null,
    experienceYears: doc.experience_years,
    isVerified: doc.is_verified,
    lucyStatus: doc.lucy_status,
    bookingEnabled: doc.booking_enabled,
    languages: doc.languages || ['Español'],
    clinicName: doc.clinics?.name || '',
    clinicId: doc.clinics?.id || '',
    department: doc.clinics?.departments?.name || null,
    departmentId: doc.clinics?.department_id || null,
    municipality: doc.clinics?.municipalities?.name || null,
    municipalityId: doc.clinics?.municipality_id || null,
    addressLine: doc.clinics?.address_line || null,
    startingPrice,
    licenseNumber: doc.license_number,
    education,
    clinicPhone: doc.clinics?.phone || null,
    clinicLatitude: null,  // TODO: Agregar cuando se añada lat/lng a clinics
    clinicLongitude: null,
    services,
    images,
  }
}

// ─────────────────────────────────────────────
// CATÁLOGOS PARA FILTROS
// ─────────────────────────────────────────────

/** Obtiene todas las especialidades activas */
export async function fetchSpecialties(): Promise<Specialty[]> {
  const { data, error } = await supabase
    .from('specialties')
    .select('id, name')
    .order('name')

  if (error) {
    console.error('Error fetching specialties:', error)
    return []
  }

  return data || []
}

/** Obtiene todos los departamentos */
export async function fetchDepartments(): Promise<Department[]> {
  const { data, error } = await supabase
    .from('departments')
    .select('id, name')
    .order('name')

  if (error) {
    console.error('Error fetching departments:', error)
    return []
  }

  return data || []
}

/** Obtiene municipios, opcionalmente filtrados por departamento */
export async function fetchMunicipalities(
  departmentId?: string | null
): Promise<Municipality[]> {
  let query = supabase
    .from('municipalities')
    .select('id, name, department_id, district')
    .order('name')

  if (departmentId) {
    query = query.eq('department_id', departmentId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching municipalities:', error)
    return []
  }

  return (data || []).map((m: any) => ({
    id: m.id,
    name: m.name,
    departmentId: m.department_id,
    district: m.district,
  }))
}

// ─────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────

/**
 * Normaliza texto para búsqueda sin tildes ni mayúsculas.
 * Reutiliza la misma lógica que ya tenía el frontend mock.
 */
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}
