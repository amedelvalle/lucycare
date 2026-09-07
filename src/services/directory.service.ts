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
      slug,
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
        price,
        is_active
      )
    `)
    // Directorio = solo is_published. is_operational pasa a controlar
    // SOLO el panel del médico (no la visibilidad pública). Esto permite
    // mostrar médicos "informativos" — reales pero que aún no operan
    // agenda en línea con Lucy. Decisión documentada en
    // docs/ANALISIS_DIRECTORIO_INFORMATIVO.md.
    .eq('is_published', true)
    // Orden: primero los que aceptan reserva en línea (booking_enabled),
    // después verificados, después por fecha.
    .order('booking_enabled', { ascending: false })
    .order('is_verified', { ascending: false })
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
    // Calcular precio mínimo de servicios (solo activos)
    const prices = (doc.services || [])
      .filter((s: any) => s.is_active !== false)
      .map((s: any) => s.price)
      .filter((p: any) => p != null)
    const startingPrice = prices.length > 0 ? Math.min(...prices) : null

    return {
      id: doc.id,
      slug: doc.slug || null,
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

  // Filtro de completitud mínima (D1):
  // El médico debe tener full_name, specialty, clinic.name y clinic.address.
  // No exigimos foto, bio ni servicios — el placeholder de iniciales y
  // los CTAs alternativos cubren el caso informativo.
  doctors = doctors.filter(
    (doc) =>
      !!doc.fullName?.trim() &&
      doc.fullName !== 'Sin nombre' &&
      !!doc.specialty &&
      !!doc.clinicName?.trim() &&
      !!doc.addressLine?.trim(),
  )

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

// Detecta si el parámetro de la URL es un UUID (doctors.id) o un slug.
// Los slugs son [a-z0-9-] y nunca matchean este patrón, así que la
// distinción es inequívoca.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Obtiene el detalle completo de un doctor por su UUID (doctors.id) o su slug.
 * Resolver dual: si el parámetro parece UUID busca por `id`, si no por `slug`.
 * Siempre gate `is_published = true`. Incluye servicios, imágenes y clínica.
 */
export async function fetchDoctorDetail(
  idOrSlug: string
): Promise<DoctorDetail | null> {
  const byColumn = UUID_RE.test(idOrSlug) ? 'id' : 'slug'
  const { data, error } = await supabase
    .from('doctors')
    .select(`
      id,
      slug,
      profile_id,
      specialty_id,
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
        is_active,
        sort_order
      ),
      doctor_images (
        id,
        image_url,
        sort_order
      )
    `)
    .eq(byColumn, idOrSlug)
    // El detalle se abre con solo is_published=true. is_operational
    // controla únicamente el panel del médico (operar agenda interna),
    // no la visibilidad pública. Esto permite que médicos informativos
    // (publicados, sin agenda en línea todavía) sigan teniendo perfil
    // alcanzable por link directo. La RPC claim_doctor_profile mantiene
    // sus propias validaciones server-side.
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

  // Calcular precio mínimo (solo servicios activos)
  const prices = (doc.services || [])
    .filter((s: any) => s.is_active !== false)
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
    slug: doc.slug || null,
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

/**
 * Reservabilidad canónica del médico (DOCTOR-ONBOARDING-READINESS-P0).
 *
 * El perfil público NO puede decidir con `booking_enabled` solo: el backend
 * exige además `is_operational`, un servicio activo y una regla de
 * disponibilidad (`validate_booking_slot`, s7_66). Y `is_operational` no está
 * en la allowlist de columnas de `anon` (s7_60), así que el frontend no puede
 * leerlo ni debe.
 *
 * `doctor_booking_ready` devuelve SOLO el booleano derivado: ni flags internos,
 * ni servicios, ni horarios.
 *
 * ⚠️ NO sustituye a `validate_booking_slot`, que sigue siendo la autoridad del
 * horario concreto. Esto responde «¿ofrezco reserva?»; aquello, «¿este slot es
 * válido?».
 *
 * FAIL CLOSED: si la RPC falla, LANZA. El llamador debe tratar el error como
 * «no reservable» y jamás caer de vuelta a `booking_enabled`, que es
 * precisamente el gate insuficiente que este frente reemplaza.
 */
export async function fetchDoctorBookingReady(doctorId: string): Promise<boolean> {
  // `src/types/database.types.ts` está desactualizado (deuda
  // TYPES-RECONCILIATION-P0) y no incluye esta RPC, así que el cliente tipado
  // rechaza su nombre. Se declara la firma REAL en el punto de llamada en vez
  // de usar `any`: los argumentos siguen comprobados y el error también.
  // El resultado se declara `unknown` a propósito y se compara con `=== true`,
  // de modo que cualquier otra cosa —incluido `null`— cae en fail closed.
  const rpc = supabase.rpc as unknown as (
    fn: 'doctor_booking_ready',
    args: { p_doctor_id: string },
  ) => Promise<{ data: unknown; error: { message: string } | null }>

  const { data, error } = await rpc('doctor_booking_ready', { p_doctor_id: doctorId })
  if (error) throw new Error(error.message)
  return data === true
}
