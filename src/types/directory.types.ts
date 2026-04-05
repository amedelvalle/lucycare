/**
 * Tipos para el directorio público de médicos.
 * 
 * Estos tipos representan los datos que el frontend necesita para mostrar
 * el directorio y el detalle del doctor. Se construyen a partir de JOINs
 * entre las tablas: doctors, profiles, clinics, specialties, services,
 * doctor_images, departments, municipalities.
 * 
 * NO son los tipos raw de la DB (esos están en database.types.ts).
 * Son tipos "de vista" optimizados para el UI.
 */

// Tarjeta de doctor en el grid del directorio
export interface DoctorCard {
  id: string                    // doctors.id
  profileId: string             // doctors.profile_id
  fullName: string              // profiles.full_name
  avatarUrl: string | null      // profiles.avatar_url
  specialty: string | null      // specialties.name
  specialtyId: string | null    // doctors.specialty_id
  bio: string | null            // doctors.bio
  consultationFee: number | null // doctors.consultation_fee
  experienceYears: number | null // doctors.experience_years
  isVerified: boolean           // doctors.is_verified
  lucyStatus: string            // doctors.lucy_status
  bookingEnabled: boolean       // doctors.booking_enabled
  languages: string[]           // doctors.languages
  // Ubicación (de la clínica)
  clinicName: string            // clinics.name
  clinicId: string              // clinics.id
  department: string | null     // departments.name
  departmentId: string | null   // clinics.department_id
  municipality: string | null   // municipalities.name
  municipalityId: string | null // clinics.municipality_id
  addressLine: string | null    // clinics.address_line
  // Primer servicio (para mostrar precio en la tarjeta)
  startingPrice: number | null  // MIN(services.price)
}

// Detalle completo del doctor (página /doctor/:id)
export interface DoctorDetail extends DoctorCard {
  licenseNumber: string | null  // doctors.license_number
  education: Education[]        // doctors.education (JSONB)
  // Datos de la clínica
  clinicPhone: string | null    // clinics.phone
  clinicLatitude: number | null // clinics.latitude (si existe)
  clinicLongitude: number | null // clinics.longitude (si existe)
  // Servicios
  services: DoctorService[]
  // Galería de imágenes
  images: DoctorImage[]
}

export interface DoctorService {
  id: string
  name: string
  durationMinutes: number
  price: number | null
  isFirstVisit: boolean
  sortOrder: number
}

export interface DoctorImage {
  id: string
  imageUrl: string
  sortOrder: number
}

export interface Education {
  institution: string
  degree: string
  year: number
}

// Filtros del directorio
export interface DirectoryFilters {
  search: string           // Búsqueda por nombre
  specialtyId: string | null
  departmentId: string | null
  municipalityId: string | null
}

// Opciones para los filtros (dropdowns)
export interface Specialty {
  id: string
  name: string
}

export interface Department {
  id: string
  name: string
}

export interface Municipality {
  id: string
  name: string
  departmentId: string
  district: string | null
}
