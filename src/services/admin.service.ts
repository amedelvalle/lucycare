import { buildCsv } from '@/lib/csv';
import { supabase } from '@/lib/supabase';

export interface PlatformStats {
  doctorsTotal: number;
  doctorsPublished: number;
  doctorsVerified: number;
  patientsTotal: number;
  assistantsActive: number;
  appointmentsTotal: number;
  appointmentsAttended: number;
  consultationsSigned: number;
  reviewsTotal: number;
  reviewsAvgScore: number | null;
}

// ─── Gestión de médicos (Fase B) ─────────────────────────────────────

export type LucyStatus = 'listed_only' | 'claimed' | 'booking_enabled' | 'verified';

export interface AdminDoctorRow {
  id: string;
  fullName: string | null;
  phone: string | null;
  specialty: string | null;
  clinicName: string | null;
  isVerified: boolean;
  isPublished: boolean;
  bookingEnabled: boolean;
  isOperational: boolean;
  lucyStatus: LucyStatus;
  createdAt: string;
}

export interface AdminDoctorsFilters {
  search?: string;
  published?: boolean | null;
  operational?: boolean | null;
  lucyStatus?: LucyStatus | null;
  limit?: number;
  offset?: number;
}

export interface AdminDoctorsPage {
  rows: AdminDoctorRow[];
  total: number;
}

export async function getAdminDoctors(
  filters: AdminDoctorsFilters = {}
): Promise<AdminDoctorsPage> {
  const { data, error } = await supabase.rpc('admin_list_doctors', {
    p_search: filters.search?.trim() || null,
    p_published: filters.published ?? null,
    p_operational: filters.operational ?? null,
    p_lucy_status: filters.lucyStatus ?? null,
    p_limit: filters.limit ?? 25,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  const arr = (data ?? []) as Array<Record<string, unknown>>;
  const rows: AdminDoctorRow[] = arr.map((r) => ({
    id: r.id as string,
    fullName: (r.full_name as string) ?? null,
    phone: (r.phone as string) ?? null,
    specialty: (r.specialty as string) ?? null,
    clinicName: (r.clinic_name as string) ?? null,
    isVerified: !!r.is_verified,
    isPublished: !!r.is_published,
    bookingEnabled: !!r.booking_enabled,
    isOperational: !!r.is_operational,
    lucyStatus: r.lucy_status as LucyStatus,
    createdAt: r.created_at as string,
  }));
  const total = arr.length > 0 ? Number(arr[0].total_count ?? 0) : 0;
  return { rows, total };
}

async function rpc(fn: string, params: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc(fn, params);
  if (error) throw new Error(error.message);
}

// ─── Detalle / edición (Fase B2-A) ───────────────────────────────────

export interface AdminDoctorDetail {
  doctorId: string;
  profileId: string;
  clinicId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  specialtyId: string | null;
  specialtyName: string | null;
  bio: string | null;
  clinicName: string;
  clinicAddress: string | null;
  clinicPhone: string | null;
  clinicDepartmentId: string | null;
  clinicMunicipalityId: string | null;
  isPublished: boolean;
  isOperational: boolean;
  lucyStatus: LucyStatus;
}

export async function getDoctorAdminDetail(doctorId: string): Promise<AdminDoctorDetail | null> {
  const { data, error } = await supabase.rpc('admin_get_doctor_detail', { p_doctor_id: doctorId });
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    doctorId: row.doctor_id as string,
    profileId: row.profile_id as string,
    clinicId: row.clinic_id as string,
    fullName: (row.full_name as string) ?? '',
    email: (row.email as string) ?? null,
    phone: (row.phone as string) ?? null,
    avatarUrl: (row.avatar_url as string) ?? null,
    specialtyId: (row.specialty_id as string) ?? null,
    specialtyName: (row.specialty_name as string) ?? null,
    bio: (row.bio as string) ?? null,
    clinicName: (row.clinic_name as string) ?? '',
    clinicAddress: (row.clinic_address as string) ?? null,
    clinicPhone: (row.clinic_phone as string) ?? null,
    clinicDepartmentId: (row.clinic_department_id as string) ?? null,
    clinicMunicipalityId: (row.clinic_municipality_id as string) ?? null,
    isPublished: !!row.is_published,
    isOperational: !!row.is_operational,
    lucyStatus: row.lucy_status as LucyStatus,
  };
}

export interface SpecialtyOption { id: string; name: string }

export async function getSpecialtiesForAdmin(): Promise<SpecialtyOption[]> {
  const { data, error } = await supabase
    .from('specialties')
    .select('id, name')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as SpecialtyOption[];
}

export const updateDoctorProfile = (id: string, fullName: string, email: string | null, phone: string | null) =>
  rpc('admin_update_doctor_profile', {
    p_doctor_id: id,
    p_full_name: fullName,
    p_email: email,
    p_phone: phone,
  });

export const updateDoctorClinic = (
  id: string,
  name: string,
  address: string | null,
  phone: string | null,
  departmentId: string | null,
  municipalityId: string | null,
) =>
  rpc('admin_update_doctor_clinic', {
    p_doctor_id: id,
    p_name: name,
    p_address: address,
    p_phone: phone,
    p_department_id: departmentId,
    p_municipality_id: municipalityId,
  });

export const updateDoctorInfo = (id: string, specialtyId: string | null, bio: string | null) =>
  rpc('admin_update_doctor_info', {
    p_doctor_id: id,
    p_specialty_id: specialtyId,
    p_bio: bio,
  });

// is_verified ya no es editable manualmente — se deriva de lucy_status='verified'
// (ver migración s7_03). Para "verificar" un médico, usá setDoctorLucyStatus(id, 'verified').
export const setDoctorPublished = (id: string, value: boolean) =>
  rpc('admin_set_doctor_published', { p_doctor_id: id, p_value: value });
export const setDoctorOperational = (id: string, value: boolean) =>
  rpc('admin_set_doctor_operational', { p_doctor_id: id, p_value: value });
export const setDoctorLucyStatus = (id: string, value: LucyStatus) =>
  rpc('admin_set_lucy_status', { p_doctor_id: id, p_value: value });

// ─── Servicios del médico (Fase B3-admin) ────────────────────────────

export interface AdminServiceItem {
  id: string;
  doctorId: string;
  name: string;
  durationMinutes: number;
  price: number | null;
  isFirstVisit: boolean;
  isActive: boolean;
  sortOrder: number;
}

/** SQLSTATE de violación de foreign key — admin_delete_service lo re-lanza
 *  con mensaje en español cuando el servicio tiene citas asociadas. */
export const ADMIN_FK_VIOLATION = '23503';

export async function listAdminDoctorServices(doctorId: string): Promise<AdminServiceItem[]> {
  const { data, error } = await supabase.rpc('admin_list_doctor_services', { p_doctor_id: doctorId });
  if (error) throw error;
  const arr = (data ?? []) as Array<Record<string, unknown>>;
  return arr.map((r) => ({
    id: r.id as string,
    doctorId: r.doctor_id as string,
    name: r.name as string,
    durationMinutes: Number(r.duration_minutes),
    price: r.price == null ? null : Number(r.price),
    isFirstVisit: !!r.is_first_visit,
    isActive: !!r.is_active,
    sortOrder: Number(r.sort_order),
  }));
}

export async function createAdminService(input: {
  doctorId: string;
  name: string;
  durationMinutes: number;
  price: number | null;
  isFirstVisit: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc('admin_create_service', {
    p_doctor_id: input.doctorId,
    p_name: input.name,
    p_duration_minutes: input.durationMinutes,
    p_price: input.price,
    p_is_first_visit: input.isFirstVisit,
  });
  if (error) throw error;
  return data as string;
}

export async function updateAdminService(input: {
  serviceId: string;
  name: string;
  durationMinutes: number;
  price: number | null;
  isFirstVisit: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc('admin_update_service', {
    p_service_id: input.serviceId,
    p_name: input.name,
    p_duration_minutes: input.durationMinutes,
    p_price: input.price,
    p_is_first_visit: input.isFirstVisit,
  });
  if (error) throw error;
}

export async function setAdminServiceActive(serviceId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_service_active', {
    p_service_id: serviceId,
    p_is_active: isActive,
  });
  if (error) throw error;
}

export async function deleteAdminService(serviceId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_service', { p_service_id: serviceId });
  if (error) throw error;
}

/** Métricas agregadas de plataforma (RPC gateada por is_admin()).
 *  Sin PII ni contenido clínico — solo conteos/volúmenes. */
export async function getPlatformStats(): Promise<PlatformStats> {
  const { data, error } = await supabase.rpc('get_platform_stats');
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    doctorsTotal: Number(r.doctors_total ?? 0),
    doctorsPublished: Number(r.doctors_published ?? 0),
    doctorsVerified: Number(r.doctors_verified ?? 0),
    patientsTotal: Number(r.patients_total ?? 0),
    assistantsActive: Number(r.assistants_active ?? 0),
    appointmentsTotal: Number(r.appointments_total ?? 0),
    appointmentsAttended: Number(r.appointments_attended ?? 0),
    consultationsSigned: Number(r.consultations_signed ?? 0),
    reviewsTotal: Number(r.reviews_total ?? 0),
    reviewsAvgScore:
      r.reviews_avg_score == null ? null : Number(r.reviews_avg_score),
  };
}

/* ═══════════════════════════════════════════════════════════
 * ADMIN-DOCTOR-EXPORT-P0 · exportación de la base de médicos
 * ═══════════════════════════════════════════════════════════ */

/** Tope técnico, espejo del que aplica la RPC. Por encima, se pide acotar. */
export const DOCTOR_EXPORT_MAX = 10000;

/** Fila del export. Espejo EXACTO de la allowlist de `admin_export_doctors`. */
export interface AdminDoctorExportRow {
  full_name: string | null;
  specialty: string | null;
  phone: string | null;
  email: string | null;
  clinic_name: string | null;
  clinic_address: string | null;
  department: string | null;
  municipality: string | null;
  lucy_status: LucyStatus;
  reclamado: boolean;
  verificado: boolean;
  publicado: boolean;
  agenda: boolean;
  operativo: boolean;
  created_at: string;
  /** Valor canónico de `doctors.slug`. NULL mientras el médico nunca se publicó. */
  slug: string | null;
}

const EXPORT_ERRORES: Record<string, string> = {
  P0140: 'No tenés permiso para exportar la base de médicos.',
  P0142: 'Ese formato de exportación no está disponible.',
  P0146:
    'La exportación es demasiado grande. Afina la búsqueda o el filtro e inténtalo de nuevo.',
};

function traducirExport(error: { code?: string; message?: string }): Error {
  const code = error.code ?? '';
  return new Error(EXPORT_ERRORES[code] ?? error.message ?? 'No se pudo exportar.');
}

/**
 * Trae el conjunto FILTRADO COMPLETO, no la página visible.
 *
 * La RPC reutiliza `admin_list_doctors` para resolver el universo, así que
 * hereda su búsqueda y sus filtros: es imposible que el archivo y la pantalla
 * discrepen. El archivo se genera EN EL NAVEGADOR a partir de esta respuesta;
 * no se sube nada a Supabase ni se crea ningún bucket.
 */
export async function fetchDoctorsForExport(
  filters: AdminDoctorsFilters = {}
): Promise<AdminDoctorExportRow[]> {
  const { data, error } = await supabase.rpc('admin_export_doctors', {
    p_search: filters.search?.trim() || null,
    p_published: filters.published ?? null,
    p_operational: filters.operational ?? null,
    p_lucy_status: filters.lucyStatus ?? null,
    p_formato: 'csv',
  });
  if (error) throw traducirExport(error);
  const payload = (data ?? {}) as { rows?: AdminDoctorExportRow[] };
  return payload.rows ?? [];
}

/** Estado LucyCare en español. El CSV no debe exponer el enum crudo. */
const LUCY_STATUS_LABEL: Record<LucyStatus, string> = {
  listed_only: 'Solo listado',
  claimed: 'Reclamado',
  booking_enabled: 'Con agenda',
  verified: 'Verificado',
};

/**
 * Zona horaria de El Salvador, fijada EXPLÍCITAMENTE.
 *
 * Sin `timeZone`, `Intl` usa el reloj del navegador: un admin conectado desde
 * otro huso vería el mismo registro con otra fecha de alta. El Salvador no
 * aplica horario de verano, así que la conversión es estable todo el año.
 */
const CSV_TIMEZONE = 'America/El_Salvador';

/**
 * `DD/MM/YYYY HH:mm` — solo para el CSV.
 *
 * Se ensambla con `formatToParts` y no con `toLocaleString` por dos motivos que
 * no se ven hasta que se prueba: `es-SV` es un locale de 12 horas (devolvería
 * `01:49 p. m.`) y `toLocaleString` intercala una COMA entre fecha y hora.
 * `hourCycle: 'h23'` y no `hour12: false`: este último puede rendir `24:15`
 * para la medianoche.
 *
 * Duplicado a propósito del formateador de `patientCrm.service.ts`: ese export
 * acaba de cerrarse y validarse en producción, y no se toca para compartir
 * quince líneas.
 */
const CSV_FECHA_FMT = new Intl.DateTimeFormat('es-SV', {
  timeZone: CSV_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function fechaCsv(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const parte of CSV_FECHA_FMT.formatToParts(d)) p[parte.type] = parte.value;
  if (!p.day || !p.month || !p.year || !p.hour || !p.minute) return iso;
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

const siNo = (v: boolean | null | undefined): string => (v ? 'Sí' : 'No');

/**
 * Dominio público de LucyCare, literal a propósito.
 *
 * NO se usa `window.location.origin`: exportar desde un Preview produciría
 * enlaces `…vercel.app` que fallan en cuanto el archivo sale del navegador que
 * lo generó, y el error sería invisible hasta que alguien hiciera clic. El
 * archivo describe producción, así que el dominio es el de producción.
 *
 * No hay una constante canónica en `src/` que reutilizar —solo scripts la
 * definen localmente— y abrir ese refactor excede este cambio.
 */
const LUCYCARE_PUBLIC_ORIGIN = 'https://lucycare.app';

/**
 * URL pública del perfil, o cadena vacía.
 *
 * Se llena SOLO si hay slug **y** el perfil está publicado. `fetchDoctorDetail`
 * filtra por `is_published = true`, así que la URL de un médico no publicado
 * renderiza «Médico no encontrado»: una columna llamada «URL pública» no debe
 * contener enlaces muertos.
 *
 * El caso existe de verdad: el trigger `trg_set_doctor_slug` asigna el slug al
 * publicar y **nunca lo reescribe**, así que un médico despublicado conserva su
 * slug. Ese slug SÍ se exporta —es el valor canónico— pero su URL queda vacía.
 *
 * La ruta `/doctor/<slug>` es la canónica: el resolver de `directory.service`
 * acepta UUID o slug, y la página reescribe la barra al slug cuando existe.
 */
function urlPublica(row: AdminDoctorExportRow): string {
  const slug = row.slug?.trim();
  if (!slug || !row.publicado) return '';
  return `${LUCYCARE_PUBLIC_ORIGIN}/doctor/${slug}`;
}

/**
 * Las 15 columnas del archivo, en orden. Es un SUBCONJUNTO de la allowlist del
 * backend: el export no puede inventar campos, solo elegir cuáles de los que ya
 * vienen escribe.
 */
const DOCTOR_EXPORT_COLUMNS: {
  header: string;
  value: (r: AdminDoctorExportRow) => string;
}[] = [
  { header: 'Nombre', value: (r) => r.full_name ?? '' },
  { header: 'Especialidad', value: (r) => r.specialty ?? '' },
  { header: 'Teléfono', value: (r) => r.phone ?? '' },
  { header: 'Correo', value: (r) => r.email ?? '' },
  { header: 'Clínica', value: (r) => r.clinic_name ?? '' },
  { header: 'Dirección de clínica', value: (r) => r.clinic_address ?? '' },
  { header: 'Departamento de clínica', value: (r) => r.department ?? '' },
  { header: 'Municipio de clínica', value: (r) => r.municipality ?? '' },
  { header: 'Estado LucyCare', value: (r) => LUCY_STATUS_LABEL[r.lucy_status] ?? String(r.lucy_status ?? '') },
  // Encabezados explícitos: «Reclamado» a secas es ambiguo en una hoja de
  // cálculo —¿reclamado por quién, de qué?— y «Verificado» se confunde con la
  // verificación de la credencial JVPM, que es OTRO eje y hoy está en `pending`
  // para los 115. Ambos se derivan solo de `lucy_status`; el backend no cambia.
  { header: 'Perfil reclamado', value: (r) => siNo(r.reclamado) },
  { header: 'Verificado en LucyCare', value: (r) => siNo(r.verificado) },
  { header: 'Publicado', value: (r) => siNo(r.publicado) },
  { header: 'Agenda habilitada', value: (r) => siNo(r.agenda) },
  { header: 'Operativo', value: (r) => siNo(r.operativo) },
  { header: 'Fecha de alta en LucyCare', value: (r) => (r.created_at ? fechaCsv(r.created_at) : '') },
  // ADMIN-DOCTOR-EXPORT-URL-P0. El slug se escribe TAL CUAL: nunca se
  // reconstruye desde el nombre — quien los asigna es el trigger de `s7_52`.
  { header: 'Slug', value: (r) => r.slug ?? '' },
  { header: 'URL pública', value: urlPublica },
];

/**
 * CSV UTF-8 **con BOM**, generado con el serializador único de `lib/csv`.
 *
 * Ese serializador hace dos cosas que este archivo NO debe reimplementar:
 * neutraliza las celdas que Excel leería como fórmula (`=`, `+`, `-`, `@`,
 * tabulador, retorno de carro) y escapa según RFC 4180. Encabezados y datos
 * pasan por la misma función: una sola ruta, sin excepciones.
 */
export function buildDoctorsCsv(rows: AdminDoctorExportRow[]): Blob {
  const cabecera = DOCTOR_EXPORT_COLUMNS.map((c) => c.header);
  const cuerpo = rows.map((r) => DOCTOR_EXPORT_COLUMNS.map((c) => c.value(r)));
  return new Blob([buildCsv(cabecera, cuerpo)], { type: 'text/csv;charset=utf-8;' });
}

export function doctorsExportFileName(ext: 'csv'): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `lucycare-medicos-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.${ext}`;
}
