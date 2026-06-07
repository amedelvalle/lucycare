import { supabase } from '@/lib/supabase';

export type CatalogItemType = 'diagnosis' | 'medication';

/**
 * Oculta un ítem GLOBAL (base Lucy) para un médico (Catálogos PR-2/PR-4).
 * Idempotente: si ya estaba oculto (UNIQUE), no falla.
 */
export async function hideGlobalCatalogItem(
  doctorId: string,
  itemType: CatalogItemType,
  itemId: string
): Promise<void> {
  const { error } = await supabase
    .from('doctor_catalog_hidden')
    .insert({ doctor_id: doctorId, item_type: itemType, item_id: itemId });
  if (error && error.code !== '23505') throw error;
}

/** Vuelve a mostrar un ítem global previamente oculto por el médico. */
export async function unhideGlobalCatalogItem(
  doctorId: string,
  itemType: CatalogItemType,
  itemId: string
): Promise<void> {
  const { error } = await supabase
    .from('doctor_catalog_hidden')
    .delete()
    .eq('doctor_id', doctorId)
    .eq('item_type', itemType)
    .eq('item_id', itemId);
  if (error) throw error;
}
