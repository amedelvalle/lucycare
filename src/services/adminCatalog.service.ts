import { supabase } from '@/lib/supabase';
import type {
  DiagnosisCatalogItem,
  PaginatedResult,
} from './diagnosesCatalog.service';
import type {
  MedicationCatalogItem,
  MedicationPresentation,
} from './medicationsCatalog.service';

/**
 * Servicio de administración de la **Base Lucy global** (catálogos con
 * `doctor_id IS NULL`) para LucyAdmin. Opera directo sobre las tablas
 * `diagnoses` / `medications` con la sesión admin: la RLS `s7_38`
 * (`*_insert_admin` / `*_update_admin`, `WITH CHECK (is_admin())`) es la
 * defensa real — médicos/asistentes no pueden tocar globales.
 *
 * No hay RPCs nuevas ni migración. La auditoría la cubre el trigger
 * `audit_catalog` (s7_38). El anti-duplicado lo respalda el UNIQUE parcial
 * `s7_39` sobre globales (`lower(name)` en diagnósticos; combo
 * `commercial_name + active_ingredient + concentration + presentation` en
 * medicamentos). Editar/inactivar un global NO altera históricos: el
 * snapshot `s7_37` los protege.
 *
 * Reglas de UI:
 * - Todo lo creado acá es GLOBAL (`doctor_id = null`).
 * - No hard-delete: solo inactivar/reactivar (`is_active`).
 * - `usage_count` se omite (es cross-médico, no operativo).
 */

const DIAGNOSIS_COLS = 'id, doctor_id, name, description, is_active, usage_count';
const MEDICATION_COLS =
  'id, doctor_id, commercial_name, active_ingredient, concentration, presentation, is_active, usage_count';

/**
 * Error de duplicado de catálogo global, con mensaje amable ya en español.
 * Lo lanza el chequeo proactivo o el mapeo del `23505` (UNIQUE de DB).
 */
export class DuplicateCatalogError extends Error {
  /** Si el ítem en conflicto está inactivo (sugerir reactivarlo). */
  readonly existingInactive: boolean;
  constructor(message: string, existingInactive = false) {
    super(message);
    this.name = 'DuplicateCatalogError';
    this.existingInactive = existingInactive;
  }
}

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === UNIQUE_VIOLATION;
}

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, '\\$&');
}

function paginate(options?: { page?: number; pageSize?: number }) {
  const page = Math.max(1, options?.page ?? 1);
  const pageSize = options?.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return { page, pageSize, from, to };
}

// ─── Diagnósticos globales ────────────────────────────────────────────

export async function listGlobalDiagnosesAdmin(options?: {
  search?: string;
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResult<DiagnosisCatalogItem>> {
  const { page, pageSize, from, to } = paginate(options);

  let q = supabase
    .from('diagnoses')
    .select(DIAGNOSIS_COLS, { count: 'exact' })
    .is('doctor_id', null);

  if (!options?.includeInactive) {
    q = q.eq('is_active', true);
  }

  const trimmed = options?.search?.trim() ?? '';
  if (trimmed.length >= 1) {
    q = q.ilike('name', `%${escapeLike(trimmed)}%`);
  }

  const { data, error, count } = await q.order('name').range(from, to);
  if (error) throw error;
  return { items: data ?? [], total: count ?? 0, page, pageSize };
}

/**
 * Crea un diagnóstico GLOBAL. Chequeo proactivo case-insensitive contra
 * cualquier global (activo o inactivo, porque el UNIQUE `s7_39` no filtra
 * por `is_active`). El UNIQUE de DB es la red final.
 */
export async function createGlobalDiagnosis(input: {
  name: string;
  description?: string | null;
}): Promise<DiagnosisCatalogItem> {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error('Nombre requerido');

  const { data: existing } = await supabase
    .from('diagnoses')
    .select(DIAGNOSIS_COLS)
    .is('doctor_id', null)
    .ilike('name', trimmed)
    .limit(1);
  const dup = existing?.[0];
  if (dup) {
    throw new DuplicateCatalogError(
      dup.is_active
        ? 'Ya existe un diagnóstico en la Base Lucy con ese nombre.'
        : 'Ya existe un diagnóstico inactivo en la Base Lucy con ese nombre. Reactivalo desde la lista de inactivos.',
      !dup.is_active
    );
  }

  const { data, error } = await supabase
    .from('diagnoses')
    .insert({
      doctor_id: null,
      name: trimmed,
      description: input.description?.trim() || null,
      is_active: true,
      usage_count: 0,
    })
    .select(DIAGNOSIS_COLS)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateCatalogError('Ya existe un diagnóstico en la Base Lucy con ese nombre.');
    }
    throw error;
  }
  return data;
}

export async function updateGlobalDiagnosis(
  id: string,
  updates: { name?: string; description?: string | null; is_active?: boolean }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.description !== undefined) {
    payload.description = updates.description?.trim() || null;
  }
  if (updates.is_active !== undefined) payload.is_active = updates.is_active;

  const { error } = await supabase
    .from('diagnoses')
    .update(payload)
    .eq('id', id)
    .is('doctor_id', null); // candado extra: solo globales
  if (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateCatalogError('Ya existe un diagnóstico en la Base Lucy con ese nombre.');
    }
    throw error;
  }
}

// ─── Medicamentos globales ────────────────────────────────────────────

export async function listGlobalMedicationsAdmin(options?: {
  search?: string;
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResult<MedicationCatalogItem>> {
  const { page, pageSize, from, to } = paginate(options);

  let q = supabase
    .from('medications')
    .select(MEDICATION_COLS, { count: 'exact' })
    .is('doctor_id', null);

  if (!options?.includeInactive) {
    q = q.eq('is_active', true);
  }

  const trimmed = options?.search?.trim() ?? '';
  if (trimmed.length >= 1) {
    const escaped = escapeLike(trimmed);
    q = q.or(`commercial_name.ilike.%${escaped}%,active_ingredient.ilike.%${escaped}%`);
  }

  const { data, error, count } = await q.order('commercial_name').range(from, to);
  if (error) throw error;
  return { items: data ?? [], total: count ?? 0, page, pageSize };
}

interface MedicationInput {
  commercial_name: string;
  active_ingredient?: string | null;
  concentration?: string | null;
  presentation?: MedicationPresentation | null;
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

/**
 * Crea un medicamento GLOBAL. El UNIQUE `s7_39` es sobre el combo
 * `lower(commercial_name) + lower(coalesce(active_ingredient,'')) +
 * lower(coalesce(concentration,'')) + coalesce(presentation,'otro')`, así
 * que el chequeo proactivo compara ese combo completo (no solo el nombre).
 */
export async function createGlobalMedication(
  input: MedicationInput
): Promise<MedicationCatalogItem> {
  const trimmed = input.commercial_name.trim();
  if (!trimmed) throw new Error('Nombre comercial requerido');

  // Candidatos por nombre comercial (case-insensitive); el combo se compara en JS.
  const { data: candidates } = await supabase
    .from('medications')
    .select(MEDICATION_COLS)
    .is('doctor_id', null)
    .ilike('commercial_name', trimmed);

  const targetCombo = [
    norm(trimmed),
    norm(input.active_ingredient),
    norm(input.concentration),
    input.presentation ?? 'otro',
  ].join('|');

  const dup = (candidates ?? []).find(
    (c) =>
      [
        norm(c.commercial_name),
        norm(c.active_ingredient),
        norm(c.concentration),
        c.presentation ?? 'otro',
      ].join('|') === targetCombo
  );
  if (dup) {
    throw new DuplicateCatalogError(
      dup.is_active
        ? 'Ya existe un medicamento en la Base Lucy con esos mismos datos.'
        : 'Ya existe un medicamento inactivo en la Base Lucy con esos mismos datos. Reactivalo desde la lista de inactivos.',
      !dup.is_active
    );
  }

  const { data, error } = await supabase
    .from('medications')
    .insert({
      doctor_id: null,
      commercial_name: trimmed,
      active_ingredient: input.active_ingredient?.trim() || null,
      concentration: input.concentration?.trim() || null,
      presentation: input.presentation ?? null,
      is_active: true,
      usage_count: 0,
    })
    .select(MEDICATION_COLS)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateCatalogError('Ya existe un medicamento en la Base Lucy con esos mismos datos.');
    }
    throw error;
  }
  return data;
}

export async function updateGlobalMedication(
  id: string,
  updates: {
    commercial_name?: string;
    active_ingredient?: string | null;
    concentration?: string | null;
    presentation?: MedicationPresentation | null;
    is_active?: boolean;
  }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.commercial_name !== undefined) {
    payload.commercial_name = updates.commercial_name.trim();
  }
  if (updates.active_ingredient !== undefined) {
    payload.active_ingredient = updates.active_ingredient?.trim() || null;
  }
  if (updates.concentration !== undefined) {
    payload.concentration = updates.concentration?.trim() || null;
  }
  if (updates.presentation !== undefined) payload.presentation = updates.presentation;
  if (updates.is_active !== undefined) payload.is_active = updates.is_active;

  const { error } = await supabase
    .from('medications')
    .update(payload)
    .eq('id', id)
    .is('doctor_id', null); // candado extra: solo globales
  if (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateCatalogError('Ya existe un medicamento en la Base Lucy con esos mismos datos.');
    }
    throw error;
  }
}
