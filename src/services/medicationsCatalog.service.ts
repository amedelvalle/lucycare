import { supabase } from '@/lib/supabase';

export type MedicationPresentation =
  | 'tableta'
  | 'capsula'
  | 'jarabe'
  | 'inyectable'
  | 'crema'
  | 'gotas'
  | 'suspension'
  | 'parche'
  | 'inhalador'
  | 'supositorio'
  | 'sobre'
  | 'gel'
  | 'otro';

export interface MedicationCatalogItem {
  id: string;
  /** null = ítem GLOBAL (catálogo base Lucy); seteado = personal del médico. */
  doctor_id: string | null;
  commercial_name: string;
  active_ingredient: string | null;
  concentration: string | null;
  presentation: MedicationPresentation | null;
  is_active: boolean;
  usage_count: number;
}

export const PRESENTATIONS: { value: MedicationPresentation; label: string }[] = [
  { value: 'tableta', label: 'Tableta' },
  { value: 'capsula', label: 'Cápsula' },
  { value: 'jarabe', label: 'Jarabe' },
  { value: 'suspension', label: 'Suspensión' },
  { value: 'gotas', label: 'Gotas' },
  { value: 'inyectable', label: 'Inyectable' },
  { value: 'crema', label: 'Crema' },
  { value: 'gel', label: 'Gel' },
  { value: 'parche', label: 'Parche' },
  { value: 'inhalador', label: 'Inhalador' },
  { value: 'sobre', label: 'Sobre' },
  { value: 'supositorio', label: 'Supositorio' },
  { value: 'otro', label: 'Otro' },
];

/** IDs de medicamentos globales que este médico ocultó (Catálogos PR-2). */
async function getHiddenGlobalMedIds(doctorId: string): Promise<string[]> {
  const { data } = await supabase
    .from('doctor_catalog_hidden')
    .select('item_id')
    .eq('doctor_id', doctorId)
    .eq('item_type', 'medication');
  return (data ?? []).map((r) => r.item_id);
}

/**
 * Busca medicamentos visibles para el médico: **globales (base Lucy) + propios**,
 * excluyendo los globales que el médico ocultó.
 */
export async function searchMedications(
  doctorId: string,
  query: string,
  limit = 20
): Promise<MedicationCatalogItem[]> {
  const hiddenIds = await getHiddenGlobalMedIds(doctorId);

  let q = supabase
    .from('medications')
    .select('id, doctor_id, commercial_name, active_ingredient, concentration, presentation, is_active, usage_count')
    // Propios ∪ globales (doctor_id IS NULL).
    .or(`doctor_id.eq.${doctorId},doctor_id.is.null`)
    .eq('is_active', true);

  const trimmed = query.trim();
  if (trimmed.length >= 1) {
    const escaped = trimmed.replace(/[%_]/g, '\\$&');
    q = q.or(
      `commercial_name.ilike.%${escaped}%,active_ingredient.ilike.%${escaped}%`
    );
  }
  if (hiddenIds.length > 0) {
    q = q.not('id', 'in', `(${hiddenIds.join(',')})`);
  }

  const { data, error } = await q
    .order('usage_count', { ascending: false })
    .order('commercial_name')
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function createMedication(
  doctorId: string,
  input: {
    commercial_name: string;
    active_ingredient?: string;
    concentration?: string;
    presentation?: MedicationPresentation;
  }
): Promise<MedicationCatalogItem> {
  const trimmed = input.commercial_name.trim();
  if (!trimmed) throw new Error('Nombre comercial requerido');

  const COLS = 'id, doctor_id, commercial_name, active_ingredient, concentration, presentation, is_active, usage_count';

  // Dedup (Catálogos PR-2): no duplicar contra el propio ni contra un GLOBAL
  // visible (activo y no oculto por este médico).
  // 1. ¿ya existe como propio?
  const { data: own } = await supabase
    .from('medications')
    .select(COLS)
    .eq('doctor_id', doctorId)
    .ilike('commercial_name', trimmed)
    .maybeSingle();
  if (own) return own;

  // 2. ¿existe como global visible? → reusarlo.
  const { data: globals } = await supabase
    .from('medications')
    .select(COLS)
    .is('doctor_id', null)
    .eq('is_active', true)
    .ilike('commercial_name', trimmed)
    .limit(1);
  const g = globals?.[0];
  if (g) {
    const { data: hidden } = await supabase
      .from('doctor_catalog_hidden')
      .select('id')
      .eq('doctor_id', doctorId)
      .eq('item_type', 'medication')
      .eq('item_id', g.id)
      .maybeSingle();
    if (!hidden) return g;
  }

  const { data, error } = await supabase
    .from('medications')
    .insert({
      doctor_id: doctorId,
      commercial_name: trimmed,
      active_ingredient: input.active_ingredient?.trim() || null,
      concentration: input.concentration?.trim() || null,
      presentation: input.presentation ?? null,
      is_active: true,
      usage_count: 0,
    })
    .select('id, doctor_id, commercial_name, active_ingredient, concentration, presentation, is_active, usage_count')
    .single();

  if (error) throw error;
  return data;
}

import type { PaginatedResult } from './diagnosesCatalog.service';

/**
 * Lista paginada de medicamentos del catálogo del médico (admin).
 */
export async function listAllMedications(
  doctorId: string,
  options?: { search?: string; includeInactive?: boolean; page?: number; pageSize?: number }
): Promise<PaginatedResult<MedicationCatalogItem>> {
  const page = Math.max(1, options?.page ?? 1);
  const pageSize = options?.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabase
    .from('medications')
    .select(
      'id, doctor_id, commercial_name, active_ingredient, concentration, presentation, is_active, usage_count',
      { count: 'exact' }
    )
    .eq('doctor_id', doctorId);

  if (!options?.includeInactive) {
    q = q.eq('is_active', true);
  }

  const trimmed = options?.search?.trim() ?? '';
  if (trimmed.length >= 1) {
    const escaped = trimmed.replace(/[%_]/g, '\\$&');
    q = q.or(`commercial_name.ilike.%${escaped}%,active_ingredient.ilike.%${escaped}%`);
  }

  const { data, error, count } = await q
    .order('usage_count', { ascending: false })
    .order('commercial_name')
    .range(from, to);

  if (error) throw error;
  return { items: data ?? [], total: count ?? 0, page, pageSize };
}

export async function updateMedication(
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
  if (updates.commercial_name !== undefined) payload.commercial_name = updates.commercial_name.trim();
  if (updates.active_ingredient !== undefined) {
    payload.active_ingredient = updates.active_ingredient?.trim() || null;
  }
  if (updates.concentration !== undefined) {
    payload.concentration = updates.concentration?.trim() || null;
  }
  if (updates.presentation !== undefined) payload.presentation = updates.presentation;
  if (updates.is_active !== undefined) payload.is_active = updates.is_active;

  const { error } = await supabase.from('medications').update(payload).eq('id', id);
  if (error) throw error;
}

export async function incrementMedicationUsage(medicationId: string): Promise<void> {
  const { data } = await supabase
    .from('medications')
    .select('usage_count')
    .eq('id', medicationId)
    .single();
  if (!data) return;
  await supabase
    .from('medications')
    .update({ usage_count: (data.usage_count ?? 0) + 1 })
    .eq('id', medicationId);
}
