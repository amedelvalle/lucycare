import { supabase } from '@/lib/supabase';
import { incrementFamilyHistoryUsage } from './familyHistoryCatalog.service';

export interface ConsultationFamilyHistory {
  id: string;
  consultation_id: string;
  family_history_id: string;
  notes: string | null;
  family_history: {
    id: string;
    name: string;
    description: string | null;
  };
}

/**
 * Bloquea modificaciones cuando la consulta padre está firmada.
 * Defensa cliente — el trigger DB cubre la consulta misma, no esta tabla.
 */
async function assertConsultationIsDraft(consultationId: string): Promise<void> {
  const { data, error } = await supabase
    .from('consultations')
    .select('status')
    .eq('id', consultationId)
    .single();
  if (error) throw error;
  if (data?.status === 'signed') {
    throw new Error('La consulta está firmada — no se pueden modificar antecedentes.');
  }
}

export async function getConsultationFamilyHistory(
  consultationId: string
): Promise<ConsultationFamilyHistory[]> {
  const { data, error } = await supabase
    .from('consultation_family_history')
    .select(`
      id,
      consultation_id,
      family_history_id,
      notes,
      family_history:family_history_catalog(id, name, description)
    `)
    .eq('consultation_id', consultationId)
    .order('id', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as ConsultationFamilyHistory[];
}

export async function addConsultationFamilyHistory(
  consultationId: string,
  familyHistoryId: string,
  notes?: string
): Promise<ConsultationFamilyHistory> {
  await assertConsultationIsDraft(consultationId);
  const { data, error } = await supabase
    .from('consultation_family_history')
    .insert({
      consultation_id: consultationId,
      family_history_id: familyHistoryId,
      notes: notes?.trim() || null,
    })
    .select(`
      id,
      consultation_id,
      family_history_id,
      notes,
      family_history:family_history_catalog(id, name, description)
    `)
    .single();
  if (error) throw error;

  incrementFamilyHistoryUsage(familyHistoryId).catch(() => {});

  return data as unknown as ConsultationFamilyHistory;
}

export async function updateConsultationFamilyHistory(
  id: string,
  updates: { notes?: string | null }
): Promise<void> {
  const { data: cfh } = await supabase
    .from('consultation_family_history')
    .select('consultation_id')
    .eq('id', id)
    .single();
  if (cfh) await assertConsultationIsDraft(cfh.consultation_id);

  const payload = {
    notes: updates.notes !== undefined ? (updates.notes?.trim() || null) : undefined,
  };
  const { error } = await supabase.from('consultation_family_history').update(payload).eq('id', id);
  if (error) throw error;
}

export async function removeConsultationFamilyHistory(id: string): Promise<void> {
  const { data: cfh } = await supabase
    .from('consultation_family_history')
    .select('consultation_id')
    .eq('id', id)
    .single();
  if (cfh) await assertConsultationIsDraft(cfh.consultation_id);

  const { error } = await supabase.from('consultation_family_history').delete().eq('id', id);
  if (error) throw error;
}
