/**
 * Servicio de merge admin de fichas (Paciente Global Fase 4).
 *
 * Descubre candidatos, corre el preflight (dry-run), ejecuta la fusión real y
 * lee el historial.
 *
 * Backend: `admin_list_patient_merge_candidates` / `admin_merge_patients_preflight`
 * / `admin_merge_patients` (s7_47 / s7_46, las tres `SECURITY DEFINER` admin-only)
 * + lectura directa de `patient_merge_log` (RLS admin-only SELECT).
 *
 * `admin_merge_patients` es destructivo (mueve expediente fuente→destino y
 * neutraliza la fuente) y revalida TODO server-side: los bloqueos viajan como
 * `RAISE EXCEPTION` con `ERRCODE = P006x`, que supabase-js expone en
 * `error.code` → mapear con `MERGE_BLOCK_COPY`/`mergeBlockMessage`.
 *
 * Las RPCs devuelven `jsonb`; acá se castea a interfaces TS limpias. La UI
 * nunca recibe contenido clínico (las RPCs solo exponen identidad + conteos).
 */

import { supabase } from '@/lib/supabase'

// ─── Tipos ───────────────────────────────────────────────────

export interface MergeWarning {
  code: string
  message: string
}

export interface MergeCandidatePatient {
  id: string
  fullName: string
  documentType: string
  documentNumber: string | null
  dateOfBirth: string | null
  gender: string | null
  phone: string | null
  isActive: boolean
  linkConfirmedAt: string | null
  createdAt: string
  counts: { appointments: number; consultations: number; vitals: number }
}

export interface MergeCandidateGroup {
  clinicId: string
  clinicName: string | null
  profileId: string
  profileFullName: string | null
  patientCount: number
  confirmedLinksCount: number
  unconfirmedLinksCount: number
  hasUnconfirmedLinks: boolean
  warnings: MergeWarning[]
  patients: MergeCandidatePatient[]
}

export interface PreflightSide {
  id: string
  fullName: string
  documentType: string
  documentNumber: string | null
  dateOfBirth: string | null
  gender: string | null
  phone: string | null
  isActive: boolean
  linked: boolean
  linkConfirmedAt: string | null
  mergedIntoPatientId: string | null
}

export interface MergePreflight {
  eligible: boolean
  blockCode: string | null
  blockReason: string | null
  sameClinic: boolean
  evidence: { type: string; sameDocument: boolean; sameProfile: boolean; antiEvidence: boolean }
  direction: string
  source: PreflightSide
  target: PreflightSide
  counts: { appointments: number; consultationsSigned: number; consultationsDraft: number; vitals: number }
  sourceOpenDrafts: number
  targetOpenDrafts: number
  warnings: MergeWarning[]
}

export interface MergeLogEntry {
  id: string
  createdAt: string
  sourceName: string | null
  targetName: string | null
  evidenceType: string | null
  movedCounts: { appointments: number; consultations: number; vitals: number }
  reason: string
  unmergedAt: string | null
  unmergeReason: string | null
}

export interface MergeResult {
  sourceId: string
  targetId: string
  mergeLogId: string
  movedCounts: { appointments: number; consultations: number; vitals: number }
}

// ─── Unmerge (reversa del merge, s7_48) ──────────────────────

export interface UnmergeSide {
  id: string
  fullName: string
  isActive: boolean
  profileId: string | null
  mergedIntoPatientId: string | null
  clinicId: string | null
}

export interface UnmergePreflight {
  eligible: boolean
  blockCode: string | null
  blockReason: string | null
  mergedAt: string | null
  mergeReason: string | null
  evidenceType: string | null
  source: UnmergeSide
  target: UnmergeSide
  movedExpected: { appointments: number; consultations: number; vitals: number }
  movedPresentOnTarget: { appointments: number; consultations: number; vitals: number }
  movedDrift: boolean
  targetNewHistory: number
  restore: { documentConflict: boolean; profileMissing: boolean }
  warnings: MergeWarning[]
}

export interface UnmergeResult {
  mergeLogId: string
  sourceId: string
  targetId: string
  movedBack: { appointments: number; consultations: number; vitals: number }
}

// Códigos de bloqueo del merge backend (s7_46) → copy en español.
export const MERGE_BLOCK_COPY: Record<string, string> = {
  P0001: 'Necesitás una sesión de administrador de plataforma.',
  P0060: 'Las fichas son de clínicas distintas (o alguna no existe). El merge es solo intra-clínica.',
  P0061: 'Una de las fichas ya fue fusionada.',
  P0062: 'La ficha fuente y la destino son la misma.',
  P0063: 'Evidencia insuficiente: en esta versión solo se fusionan fichas vinculadas al mismo perfil Lucy (o hay un conflicto de identidad).',
  P0064: 'Dirección inválida: la ficha vinculada al perfil debe ser el destino. Intercambiá fuente/destino.',
  P0065: 'Las fichas están vinculadas a personas (perfiles) distintas. No es un merge de fichas.',
  P0066: 'El motivo es obligatorio (mínimo 10 caracteres).',
  P0067: 'La ficha fuente tiene una consulta en borrador abierta.',
  P0068: 'Una de las fichas está inactiva.',
}

export function mergeBlockMessage(code: string | null, fallback?: string | null): string {
  if (!code) return fallback || 'No se puede fusionar este par.'
  return MERGE_BLOCK_COPY[code] || fallback || `No elegible (${code}).`
}

// Códigos de bloqueo del unmerge backend (s7_48) → copy en español.
export const UNMERGE_BLOCK_COPY: Record<string, string> = {
  P0001: 'Necesitás una sesión de administrador de plataforma.',
  P0070: 'El registro de fusión no existe, o la ficha fuente/destino ya no existe.',
  P0071: 'Esta fusión ya fue revertida.',
  P0072: 'La ficha fuente cambió de estado desde el merge (ya no está fusionada hacia este destino).',
  P0073: 'El destino fue fusionado de nuevo (cadena) o ya no está en la clínica original.',
  P0074: 'El documento de la ficha fuente ya está en uso por otra ficha de la clínica.',
  P0075: 'Parte del expediente movido ya no está en el destino; no se puede revertir de forma íntegra.',
  P0076: 'El motivo es obligatorio (mínimo 10 caracteres).',
  P0077: 'El perfil original de la ficha fuente ya no existe; no se puede restaurar el vínculo.',
}

export function unmergeBlockMessage(code: string | null, fallback?: string | null): string {
  if (!code) return fallback || 'No se puede revertir esta fusión.'
  return UNMERGE_BLOCK_COPY[code] || fallback || `No reversible (${code}).`
}

// ─── Mapeo jsonb → TS ────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapWarnings(raw: any): MergeWarning[] {
  if (!Array.isArray(raw)) return []
  return raw.map((w) => ({ code: String(w?.code ?? ''), message: String(w?.message ?? '') }))
}

function mapCandidatePatient(p: any): MergeCandidatePatient {
  return {
    id: p.id,
    fullName: p.full_name ?? '',
    documentType: p.document_type ?? '',
    documentNumber: p.document_number ?? null,
    dateOfBirth: p.date_of_birth ?? null,
    gender: p.gender ?? null,
    phone: p.phone ?? null,
    isActive: !!p.is_active,
    linkConfirmedAt: p.link_confirmed_at ?? null,
    createdAt: p.created_at,
    counts: {
      appointments: p.counts?.appointments ?? 0,
      consultations: p.counts?.consultations ?? 0,
      vitals: p.counts?.vitals ?? 0,
    },
  }
}

function mapPreflightSide(s: any): PreflightSide {
  return {
    id: s.id,
    fullName: s.full_name ?? '',
    documentType: s.document_type ?? '',
    documentNumber: s.document_number ?? null,
    dateOfBirth: s.date_of_birth ?? null,
    gender: s.gender ?? null,
    phone: s.phone ?? null,
    isActive: !!s.is_active,
    linked: !!s.linked,
    linkConfirmedAt: s.link_confirmed_at ?? null,
    mergedIntoPatientId: s.merged_into_patient_id ?? null,
  }
}

// ─── API ─────────────────────────────────────────────────────

/** Lista grupos candidatos a merge (V1 same_profile). Admin-only (RPC gateada). */
export async function listMergeCandidates(): Promise<MergeCandidateGroup[]> {
  const { data, error } = await supabase.rpc('admin_list_patient_merge_candidates')
  if (error) throw error
  const groups = (data as any[]) ?? []
  return groups.map((g) => ({
    clinicId: g.clinic_id,
    clinicName: g.clinic_name ?? null,
    profileId: g.profile_id,
    profileFullName: g.profile_full_name ?? null,
    patientCount: g.patient_count ?? 0,
    confirmedLinksCount: g.confirmed_links_count ?? 0,
    unconfirmedLinksCount: g.unconfirmed_links_count ?? 0,
    hasUnconfirmedLinks: !!g.has_unconfirmed_links,
    warnings: mapWarnings(g.warnings),
    patients: Array.isArray(g.patients) ? g.patients.map(mapCandidatePatient) : [],
  }))
}

/** Dry-run de un par. READ-ONLY: no modifica la DB. */
export async function mergePatientsPreflight(
  sourceId: string,
  targetId: string,
): Promise<MergePreflight> {
  const { data, error } = await supabase.rpc('admin_merge_patients_preflight', {
    p_source_id: sourceId,
    p_target_id: targetId,
  })
  if (error) throw error
  const v = data as any
  return {
    eligible: !!v.eligible,
    blockCode: v.block_code ?? null,
    blockReason: v.block_reason ?? null,
    sameClinic: !!v.same_clinic,
    evidence: {
      type: v.evidence?.type ?? 'none',
      sameDocument: !!v.evidence?.same_document,
      sameProfile: !!v.evidence?.same_profile,
      antiEvidence: !!v.evidence?.anti_evidence,
    },
    direction: v.direction ?? 'free',
    source: mapPreflightSide(v.source ?? {}),
    target: mapPreflightSide(v.target ?? {}),
    counts: {
      appointments: v.counts?.appointments ?? 0,
      consultationsSigned: v.counts?.consultations_signed ?? 0,
      consultationsDraft: v.counts?.consultations_draft ?? 0,
      vitals: v.counts?.vitals ?? 0,
    },
    sourceOpenDrafts: v.source_open_drafts ?? 0,
    targetOpenDrafts: v.target_open_drafts ?? 0,
    warnings: mapWarnings(v.warnings),
  }
}

/**
 * Ejecuta la fusión real (DESTRUCTIVA). Mueve appointments/consultations/vitals
 * de la fuente al destino y neutraliza la fuente. La RPC revalida elegibilidad y
 * el motivo (≥10) server-side; un bloqueo llega como `error` con `error.code`
 * (P006x) — el caller lo mapea con `mergeBlockMessage`. No hay unmerge: la reversa
 * vive en `patient_merge_log` para una herramienta futura.
 */
export async function mergePatients(
  sourceId: string,
  targetId: string,
  reason: string,
): Promise<MergeResult> {
  const { data, error } = await supabase.rpc('admin_merge_patients', {
    p_source_id: sourceId,
    p_target_id: targetId,
    p_reason: reason,
  })
  if (error) throw error
  const v = data as any
  return {
    sourceId: v.source_id ?? sourceId,
    targetId: v.target_id ?? targetId,
    mergeLogId: v.merge_log_id,
    movedCounts: {
      appointments: v.moved_counts?.appointments ?? 0,
      consultations: v.moved_counts?.consultations ?? 0,
      vitals: v.moved_counts?.vitals ?? 0,
    },
  }
}

/** Dry-run de la reversa de una fusión. READ-ONLY: no modifica la DB. */
export async function unmergePatientsPreflight(mergeLogId: string): Promise<UnmergePreflight> {
  const { data, error } = await supabase.rpc('admin_unmerge_patients_preflight', { p_merge_log_id: mergeLogId })
  if (error) throw error
  const v = data as any
  const side = (s: any): UnmergeSide => ({
    id: s?.id,
    fullName: s?.full_name ?? '',
    isActive: !!s?.is_active,
    profileId: s?.profile_id ?? null,
    mergedIntoPatientId: s?.merged_into_patient_id ?? null,
    clinicId: s?.clinic_id ?? null,
  })
  const counts = (c: any) => ({
    appointments: c?.appointments ?? 0,
    consultations: c?.consultations ?? 0,
    vitals: c?.vitals ?? 0,
  })
  return {
    eligible: !!v.eligible,
    blockCode: v.block_code ?? null,
    blockReason: v.block_reason ?? null,
    mergedAt: v.merged_at ?? null,
    mergeReason: v.merge_reason ?? null,
    evidenceType: v.evidence?.type ?? null,
    source: side(v.source ?? {}),
    target: side(v.target ?? {}),
    movedExpected: counts(v.moved_expected),
    movedPresentOnTarget: counts(v.moved_present_on_target),
    movedDrift: !!v.moved_drift,
    targetNewHistory: v.target_new_history ?? 0,
    restore: { documentConflict: !!v.restore?.document_conflict, profileMissing: !!v.restore?.profile_missing },
    warnings: mapWarnings(v.warnings),
  }
}

/**
 * Ejecuta la reversa (DESTRUCTIVA). Devuelve `moved_ids` destino→fuente y restaura
 * la fuente. La RPC revalida todo server-side; un bloqueo llega como `error` con
 * `error.code` (P0070–P0077) — el caller lo mapea con `unmergeBlockMessage`.
 */
export async function unmergePatients(mergeLogId: string, reason: string): Promise<UnmergeResult> {
  const { data, error } = await supabase.rpc('admin_unmerge_patients', {
    p_merge_log_id: mergeLogId,
    p_reason: reason,
  })
  if (error) throw error
  const v = data as any
  return {
    mergeLogId: v.merge_log_id ?? mergeLogId,
    sourceId: v.source_id,
    targetId: v.target_id,
    movedBack: {
      appointments: v.moved_back?.appointments ?? 0,
      consultations: v.moved_back?.consultations ?? 0,
      vitals: v.moved_back?.vitals ?? 0,
    },
  }
}

/** Historial de merges (lectura directa de patient_merge_log, RLS admin-only). */
export async function listPatientMerges(): Promise<MergeLogEntry[]> {
  const { data, error } = await supabase
    .from('patient_merge_log')
    .select('id, created_at, reason, evidence, moved_counts, source_snapshot, target_snapshot, unmerged_at, unmerge_reason')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return ((data as any[]) ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    sourceName: r.source_snapshot?.full_name ?? null,
    targetName: r.target_snapshot?.full_name ?? null,
    evidenceType: r.evidence?.type ?? null,
    movedCounts: {
      appointments: r.moved_counts?.appointments ?? 0,
      consultations: r.moved_counts?.consultations ?? 0,
      vitals: r.moved_counts?.vitals ?? 0,
    },
    reason: r.reason ?? '',
    unmergedAt: r.unmerged_at ?? null,
    unmergeReason: r.unmerge_reason ?? null,
  }))
}
/* eslint-enable @typescript-eslint/no-explicit-any */
