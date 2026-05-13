import { supabase } from '@/lib/supabase';

export interface FamilyHistoryCatalogItem {
  id: string;
  doctor_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  usage_count: number;
}

/**
 * Búsqueda usada por el autocomplete de la consulta.
 * Si query vacío devuelve los más usados.
 */
export async function searchFamilyHistory(
  doctorId: string,
  query: string,
  limit = 20
): Promise<FamilyHistoryCatalogItem[]> {
  let q = supabase
    .from('family_history_catalog')
    .select('id, doctor_id, name, description, is_active, usage_count')
    .eq('doctor_id', doctorId)
    .eq('is_active', true);

  const trimmed = query.trim();
  if (trimmed.length >= 1) {
    const escaped = trimmed.replace(/[%_]/g, '\\$&');
    q = q.ilike('name', `%${escaped}%`);
  }

  const { data, error } = await q
    .order('usage_count', { ascending: false })
    .order('name')
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

import type { PaginatedResult } from './diagnosesCatalog.service';

/**
 * Lista paginada admin (incluye inactivos opcional). Para `/panel/catalogos`.
 */
export async function listAllFamilyHistory(
  doctorId: string,
  options?: { search?: string; includeInactive?: boolean; page?: number; pageSize?: number }
): Promise<PaginatedResult<FamilyHistoryCatalogItem>> {
  const page = Math.max(1, options?.page ?? 1);
  const pageSize = options?.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabase
    .from('family_history_catalog')
    .select('id, doctor_id, name, description, is_active, usage_count', { count: 'exact' })
    .eq('doctor_id', doctorId);

  if (!options?.includeInactive) q = q.eq('is_active', true);

  const trimmed = options?.search?.trim() ?? '';
  if (trimmed.length >= 1) {
    const escaped = trimmed.replace(/[%_]/g, '\\$&');
    q = q.ilike('name', `%${escaped}%`);
  }

  const { data, error, count } = await q
    .order('usage_count', { ascending: false })
    .order('name')
    .range(from, to);

  if (error) throw error;
  return { items: data ?? [], total: count ?? 0, page, pageSize };
}

/**
 * Create-inline: si ya existe por nombre exacto lo devuelve, sino lo crea.
 */
export async function createFamilyHistory(
  doctorId: string,
  name: string,
  description?: string
): Promise<FamilyHistoryCatalogItem> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Nombre requerido');

  const { data: existing } = await supabase
    .from('family_history_catalog')
    .select('id, doctor_id, name, description, is_active, usage_count')
    .eq('doctor_id', doctorId)
    .ilike('name', trimmed)
    .maybeSingle();
  if (existing) return existing;

  const { data, error } = await supabase
    .from('family_history_catalog')
    .insert({
      doctor_id: doctorId,
      name: trimmed,
      description: description?.trim() || null,
      is_active: true,
      usage_count: 0,
    })
    .select('id, doctor_id, name, description, is_active, usage_count')
    .single();
  if (error) throw error;
  return data;
}

export async function updateFamilyHistory(
  id: string,
  updates: { name?: string; description?: string | null; is_active?: boolean }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.description !== undefined) {
    payload.description = updates.description?.trim() || null;
  }
  if (updates.is_active !== undefined) payload.is_active = updates.is_active;

  const { error } = await supabase.from('family_history_catalog').update(payload).eq('id', id);
  if (error) throw error;
}

export async function incrementFamilyHistoryUsage(id: string): Promise<void> {
  const { data } = await supabase
    .from('family_history_catalog')
    .select('usage_count')
    .eq('id', id)
    .single();
  if (!data) return;
  await supabase
    .from('family_history_catalog')
    .update({ usage_count: (data.usage_count ?? 0) + 1 })
    .eq('id', id);
}
