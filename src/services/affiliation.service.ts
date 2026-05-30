/**
 * Servicio de afiliación médica (Fase 1).
 *
 * Cubre:
 *  - `submitAffiliationRequest` (anon, vía RPC pública).
 *  - RPCs admin para listar/triage/rechazar/aprobar (sin crear doctor).
 *  - `adminCountAffiliationPending` para el badge en sidebar admin.
 *
 * Diseño defensivo (igual que claimProfile.service.ts):
 *   - Mantenemos uso de `supabase.rpc` para los wrappers admin
 *     (sesiones autenticadas, sin acumulación crítica).
 *   - Para el submit público usamos fetch directo a PostgREST: evita
 *     hangs del wrapper supabase-js si el navegador tiene
 *     `navigator.locks` tomado por otra cosa, y permite controlar
 *     timeout explícito.
 *
 * No expone tipos del DB directamente; mapea a interfaces TS limpias.
 */

import { supabase } from '@/lib/supabase'

export type AffiliationStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'expired'

export interface AffiliationRequestRow {
  id: string
  createdAt: string
  updatedAt: string
  fullName: string
  phone: string
  phoneNormalized: string
  email: string | null
  specialtyId: string | null
  specialtyName: string | null
  specialtyOther: string | null
  licenseNumber: string | null
  departmentId: string | null
  departmentName: string | null
  municipalityId: string | null
  municipalityName: string | null
  addressLine: string | null
  clinicName: string | null
  message: string | null
  status: AffiliationStatus
  incomplete: boolean
  adminNotes: string | null
  reviewedAt: string | null
  reviewedByName: string | null
  doctorId: string | null
  clinicId: string | null
}

export interface AffiliationRequestsPage {
  rows: AffiliationRequestRow[]
  total: number
}

export interface AffiliationFilters {
  status?: AffiliationStatus | null
  incomplete?: boolean | null
  search?: string | null
  limit?: number
  offset?: number
}

export interface SubmitAffiliationPayload {
  fullName: string
  phone: string
  consentVersion: string
  email?: string | null
  specialtyId?: string | null
  specialtyOther?: string | null
  licenseNumber?: string | null
  departmentId?: string | null
  municipalityId?: string | null
  addressLine?: string | null
  clinicName?: string | null
  message?: string | null
}

// ─── Submit público (fetch directo, mismo patrón que claimProfile) ───

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const SUBMIT_TIMEOUT_MS = 8_000

export type SubmitAffiliationErrorCode =
  | 'INVALID_NAME' // P0001
  | 'INVALID_PHONE' // P0002
  | 'INVALID_CONSENT' // P0003
  | 'RATE_LIMITED' // P0010
  | 'UNKNOWN'

const SQLSTATE_TO_CODE: Record<string, SubmitAffiliationErrorCode> = {
  P0001: 'INVALID_NAME',
  P0002: 'INVALID_PHONE',
  P0003: 'INVALID_CONSENT',
  P0010: 'RATE_LIMITED',
}

export interface SubmitAffiliationResult {
  success: boolean
  errorCode?: SubmitAffiliationErrorCode
  errorMessage?: string
}

export async function submitAffiliationRequest(
  payload: SubmitAffiliationPayload,
): Promise<SubmitAffiliationResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS)

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_affiliation_request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Accept: 'application/json',
        // sin Authorization → corre como anon
      },
      body: JSON.stringify({
        p_full_name: payload.fullName,
        p_phone: payload.phone,
        p_consent_version: payload.consentVersion,
        p_email: payload.email ?? null,
        p_specialty_id: payload.specialtyId ?? null,
        p_specialty_other: payload.specialtyOther ?? null,
        p_license_number: payload.licenseNumber ?? null,
        p_department_id: payload.departmentId ?? null,
        p_municipality_id: payload.municipalityId ?? null,
        p_address_line: payload.addressLine ?? null,
        p_clinic_name: payload.clinicName ?? null,
        p_message: payload.message ?? null,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const text = await resp.text()
    let body: unknown = null
    try { body = text ? JSON.parse(text) : null } catch { body = text }

    if (!resp.ok) {
      const errBody = (body || {}) as { code?: string; message?: string }
      const code = errBody.code ? SQLSTATE_TO_CODE[errBody.code] : undefined
      return {
        success: false,
        errorCode: code ?? 'UNKNOWN',
        errorMessage: errBody.message ?? `HTTP ${resp.status}`,
      }
    }

    const ok = !!(body && typeof body === 'object' && (body as { success?: boolean }).success)
    return ok ? { success: true } : { success: false, errorCode: 'UNKNOWN', errorMessage: 'Respuesta inesperada' }
  } catch (err) {
    clearTimeout(timeoutId)
    const isAbort = err instanceof DOMException && err.name === 'AbortError'
    return {
      success: false,
      errorCode: 'UNKNOWN',
      errorMessage: isAbort
        ? 'La solicitud tardó más de lo normal. Probá de nuevo.'
        : err instanceof Error ? err.message : 'Error de red',
    }
  }
}

// ─── Wrappers admin (usan supabase.rpc — sesión activa, sin riesgo de hang) ───

function mapRow(r: Record<string, unknown>): AffiliationRequestRow {
  return {
    id: r.id as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    fullName: r.full_name as string,
    phone: r.phone as string,
    phoneNormalized: r.phone_normalized as string,
    email: (r.email as string) ?? null,
    specialtyId: (r.specialty_id as string) ?? null,
    specialtyName: (r.specialty_name as string) ?? null,
    specialtyOther: (r.specialty_other as string) ?? null,
    licenseNumber: (r.license_number as string) ?? null,
    departmentId: (r.department_id as string) ?? null,
    departmentName: (r.department_name as string) ?? null,
    municipalityId: (r.municipality_id as string) ?? null,
    municipalityName: (r.municipality_name as string) ?? null,
    addressLine: (r.address_line as string) ?? null,
    clinicName: (r.clinic_name as string) ?? null,
    message: (r.message as string) ?? null,
    status: r.status as AffiliationStatus,
    incomplete: !!r.incomplete,
    adminNotes: (r.admin_notes as string) ?? null,
    reviewedAt: (r.reviewed_at as string) ?? null,
    reviewedByName: (r.reviewed_by_name as string) ?? null,
    doctorId: (r.doctor_id as string) ?? null,
    clinicId: (r.clinic_id as string) ?? null,
  }
}

export async function adminListAffiliationRequests(
  filters: AffiliationFilters = {},
): Promise<AffiliationRequestsPage> {
  const { data, error } = await supabase.rpc('admin_list_affiliation_requests', {
    p_status: filters.status ?? null,
    p_incomplete: filters.incomplete ?? null,
    p_search: filters.search?.trim() || null,
    p_limit: filters.limit ?? 25,
    p_offset: filters.offset ?? 0,
  })
  if (error) throw new Error(error.message)
  const arr = (data ?? []) as Array<Record<string, unknown>>
  const rows = arr.map(mapRow)
  const total = arr.length > 0 ? Number(arr[0].total_count ?? 0) : 0
  return { rows, total }
}

export async function adminMarkInReview(id: string, notes?: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_in_review', { p_id: id, p_notes: notes ?? null })
  if (error) throw new Error(error.message)
}

export async function adminRejectAffiliationRequest(id: string, notes: string): Promise<void> {
  const { error } = await supabase.rpc('admin_reject_affiliation_request', { p_id: id, p_notes: notes })
  if (error) throw new Error(error.message)
}

export async function adminMarkApprovedPendingCreation(id: string, notes?: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_mark_approved_pending_creation', {
    p_id: id,
    p_notes: notes ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function adminCountAffiliationPending(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_count_affiliation_pending')
  if (error) return 0
  return Number(data ?? 0)
}

// ─── Fase 2: aprobar y crear médico ───

/**
 * Overrides aceptados por `admin_approve_and_create_doctor`.
 * Phone NUNCA se sobreescribe (identidad del lead, ya validada via OTP
 * cuando el médico reclame). Email solo se acepta como override si el
 * lead NO trajo email (regla server-side en s7_23) — si el lead sí
 * tenía email, el RPC lo ignora silenciosamente.
 */
export interface ApproveAndCreateOverrides {
  fullName?: string | null
  email?: string | null
  specialtyId?: string | null
  clinicName?: string | null
  addressLine?: string | null
  departmentId?: string | null
  municipalityId?: string | null
}

export interface ApproveAndCreateResult {
  doctorId: string
  clinicId: string
  profileId: string
  /** True si el RPC aceptó el email del override (porque lead no tenía). */
  emailViaOverride?: boolean
}

export async function adminApproveAndCreateDoctor(
  requestId: string,
  overrides: ApproveAndCreateOverrides = {},
): Promise<ApproveAndCreateResult> {
  // Construir el payload de overrides en snake_case que espera el RPC.
  // Solo incluimos las claves no vacías para que el plpgsql aplique
  // COALESCE(override > lead).
  const payload: Record<string, string> = {}
  if (overrides.fullName && overrides.fullName.trim()) payload.full_name = overrides.fullName.trim()
  if (overrides.email && overrides.email.trim()) payload.email = overrides.email.trim()
  if (overrides.specialtyId) payload.specialty_id = overrides.specialtyId
  if (overrides.clinicName && overrides.clinicName.trim()) payload.clinic_name = overrides.clinicName.trim()
  if (overrides.addressLine && overrides.addressLine.trim()) payload.address_line = overrides.addressLine.trim()
  if (overrides.departmentId) payload.department_id = overrides.departmentId
  if (overrides.municipalityId) payload.municipality_id = overrides.municipalityId

  const { data, error } = await supabase.rpc('admin_approve_and_create_doctor', {
    p_request_id: requestId,
    p_overrides: payload,
  })
  if (error) throw new Error(error.message)
  const row = data as {
    doctor_id: string
    clinic_id: string
    profile_id: string
    email_via_override?: boolean
  }
  return {
    doctorId: row.doctor_id,
    clinicId: row.clinic_id,
    profileId: row.profile_id,
    emailViaOverride: !!row.email_via_override,
  }
}
