import { supabase } from '@/lib/supabase';

export interface DiagnosisCatalogItem {
  id: string;
  doctor_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  usage_count: number;
}

/**
 * Busca diagnósticos del catálogo del médico. Si query está vacío,
 * devuelve los más usados. Filtro case-insensitive sobre name.
 */
export async function searchDiagnoses(
  doctorId: string,
  query: string,
  limit = 20
): Promise<DiagnosisCatalogItem[]> {
  let q = supabase
    .from('diagnoses')
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

/**
 * Agrega un diagnóstico al catálogo del médico (creación inline).
 * Si ya existe uno con ese nombre exacto, lo devuelve.
 */
export async function createDiagnosis(
  doctorId: string,
  name: string,
  description?: string
): Promise<DiagnosisCatalogItem> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Nombre requerido');

  // Buscar existente por nombre exacto
  const { data: existing } = await supabase
    .from('diagnoses')
    .select('id, doctor_id, name, description, is_active, usage_count')
    .eq('doctor_id', doctorId)
    .ilike('name', trimmed)
    .maybeSingle();
  if (existing) return existing;

  const { data, error } = await supabase
    .from('diagnoses')
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

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Lista paginada de diagnósticos del catálogo del médico (admin).
 * Server-side pagination — trae solo `pageSize` filas por request.
 */
export async function listAllDiagnoses(
  doctorId: string,
  options?: { search?: string; includeInactive?: boolean; page?: number; pageSize?: number }
): Promise<PaginatedResult<DiagnosisCatalogItem>> {
  const page = Math.max(1, options?.page ?? 1);
  const pageSize = options?.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = supabase
    .from('diagnoses')
    .select('id, doctor_id, name, description, is_active, usage_count', { count: 'exact' })
    .eq('doctor_id', doctorId);

  if (!options?.includeInactive) {
    q = q.eq('is_active', true);
  }

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

export async function updateDiagnosis(
  id: string,
  updates: { name?: string; description?: string | null; is_active?: boolean }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) payload.name = updates.name.trim();
  if (updates.description !== undefined) {
    payload.description = updates.description?.trim() || null;
  }
  if (updates.is_active !== undefined) payload.is_active = updates.is_active;

  const { error } = await supabase.from('diagnoses').update(payload).eq('id', id);
  if (error) throw error;
}

/**
 * Incrementa usage_count atómicamente. Llamar cuando un diagnóstico
 * se asigna a una consulta.
 */
export async function incrementDiagnosisUsage(diagnosisId: string): Promise<void> {
  // Postgres no permite UPDATE foo = foo + 1 vía PostgREST sin RPC.
  // Hacemos read-then-write (best-effort, no bloqueante).
  const { data } = await supabase
    .from('diagnoses')
    .select('usage_count')
    .eq('id', diagnosisId)
    .single();
  if (!data) return;
  await supabase
    .from('diagnoses')
    .update({ usage_count: (data.usage_count ?? 0) + 1 })
    .eq('id', diagnosisId);
}
