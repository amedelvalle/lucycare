import { supabase } from '@/lib/supabase';
import { incrementMedicationUsage } from './medicationsCatalog.service';

/**
 * Defensa cliente: bloquea modificaciones a recetas cuando la consulta padre
 * ya está firmada. El trigger DB protege la consulta misma, pero no las
 * prescriptions individuales.
 */
async function assertConsultationIsDraft(consultationId: string): Promise<void> {
  const { data, error } = await supabase
    .from('consultations')
    .select('status')
    .eq('id', consultationId)
    .single();
  if (error) throw error;
  if (data?.status === 'signed') {
    throw new Error('La consulta está firmada — no se puede modificar la receta.');
  }
}

export type DurationUnit = 'dias' | 'semanas' | 'meses' | 'permanente';

export interface Prescription {
  id: string;
  consultation_id: string;
  medication_id: string;
  dosage: string | null;
  frequency: string | null;
  duration_value: number | null;
  duration_unit: DurationUnit | null;
  instructions: string | null;
  alternatives: string | null;
  // Datos del medicamento (join)
  medication: {
    id: string;
    commercial_name: string;
    active_ingredient: string | null;
    concentration: string | null;
    presentation: string | null;
  };
}

export interface PrescriptionInput {
  medication_id: string;
  dosage?: string;
  frequency?: string;
  duration_value?: number;
  duration_unit?: DurationUnit;
  instructions?: string;
  alternatives?: string;
}

export const DURATION_UNITS: { value: DurationUnit; label: string }[] = [
  { value: 'dias', label: 'días' },
  { value: 'semanas', label: 'semanas' },
  { value: 'meses', label: 'meses' },
  { value: 'permanente', label: 'permanente' },
];

export async function getPrescriptions(consultationId: string): Promise<Prescription[]> {
  const { data, error } = await supabase
    .from('prescriptions')
    .select(`
      id,
      consultation_id,
      medication_id,
      dosage,
      frequency,
      duration_value,
      duration_unit,
      instructions,
      alternatives,
      medication:medications(id, commercial_name, active_ingredient, concentration, presentation)
    `)
    .eq('consultation_id', consultationId)
    // Solo la receta VIGENTE: tras una corrección (amend_consultation), la
    // versión anterior queda is_current=false (histórica) y se conserva la v2.
    // Sin este filtro, display e impresión mostrarían v1 y v2 duplicadas.
    .eq('is_current', true)
    .order('id', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as Prescription[];
}

/**
 * Obtiene los medicamentos PERMANENTES del paciente desde consultas FIRMADAS
 * anteriores. Deduplica por medication_id quedándose con la prescripción más reciente.
 */
export async function getPermanentPrescriptionsForPatient(
  patientId: string,
  doctorId: string,
  excludeConsultationId?: string
): Promise<Prescription[]> {
  // 1. Obtener consultas firmadas del paciente con este médico
  let consultQ = supabase
    .from('consultations')
    .select('id, signed_at')
    .eq('patient_id', patientId)
    .eq('doctor_id', doctorId)
    .eq('status', 'signed')
    .not('signed_at', 'is', null)
    .order('signed_at', { ascending: false });
  if (excludeConsultationId) consultQ = consultQ.neq('id', excludeConsultationId);

  const { data: consults, error: cErr } = await consultQ;
  if (cErr) throw cErr;
  if (!consults || consults.length === 0) return [];

  const consultIds = consults.map((c) => c.id);

  // 2. Prescripciones permanentes de esas consultas
  const { data, error } = await supabase
    .from('prescriptions')
    .select(`
      id,
      consultation_id,
      medication_id,
      dosage,
      frequency,
      duration_value,
      duration_unit,
      instructions,
      alternatives,
      medication:medications(id, commercial_name, active_ingredient, concentration, presentation)
    `)
    .in('consultation_id', consultIds)
    .eq('duration_unit', 'permanente')
    // Solo recetas vigentes: si una permanente fue corregida, vale la v2.
    .eq('is_current', true);

  if (error) throw error;

  // 3. Dedupe por medication_id, quedando con la más reciente (consults ya viene desc)
  const order = new Map<string, number>();
  consultIds.forEach((id, idx) => order.set(id, idx));

  const byMed = new Map<string, Prescription>();
  for (const p of (data ?? []) as unknown as Prescription[]) {
    const existing = byMed.get(p.medication_id);
    if (!existing) {
      byMed.set(p.medication_id, p);
      continue;
    }
    const existingOrder = order.get(existing.consultation_id) ?? Infinity;
    const newOrder = order.get(p.consultation_id) ?? Infinity;
    if (newOrder < existingOrder) byMed.set(p.medication_id, p);
  }

  return Array.from(byMed.values());
}

export async function addPrescription(
  consultationId: string,
  input: PrescriptionInput
): Promise<Prescription> {
  await assertConsultationIsDraft(consultationId);
  const { data, error } = await supabase
    .from('prescriptions')
    .insert({
      consultation_id: consultationId,
      medication_id: input.medication_id,
      dosage: input.dosage?.trim() || null,
      frequency: input.frequency?.trim() || null,
      duration_value: input.duration_value ?? null,
      duration_unit: input.duration_unit ?? null,
      instructions: input.instructions?.trim() || null,
      alternatives: input.alternatives?.trim() || null,
    })
    .select(`
      id,
      consultation_id,
      medication_id,
      dosage,
      frequency,
      duration_value,
      duration_unit,
      instructions,
      alternatives,
      medication:medications(id, commercial_name, active_ingredient, concentration, presentation)
    `)
    .single();

  if (error) throw error;

  incrementMedicationUsage(input.medication_id).catch(() => {});

  return data as unknown as Prescription;
}

export async function updatePrescription(
  id: string,
  updates: Omit<PrescriptionInput, 'medication_id'>
): Promise<void> {
  const { data: rx } = await supabase
    .from('prescriptions')
    .select('consultation_id')
    .eq('id', id)
    .single();
  if (rx) await assertConsultationIsDraft(rx.consultation_id);

  const payload = {
    dosage: updates.dosage !== undefined ? (updates.dosage?.trim() || null) : undefined,
    frequency: updates.frequency !== undefined ? (updates.frequency?.trim() || null) : undefined,
    duration_value: updates.duration_value,
    duration_unit: updates.duration_unit,
    instructions: updates.instructions !== undefined ? (updates.instructions?.trim() || null) : undefined,
    alternatives: updates.alternatives !== undefined ? (updates.alternatives?.trim() || null) : undefined,
  };
  const { error } = await supabase.from('prescriptions').update(payload).eq('id', id);
  if (error) throw error;
}

export async function removePrescription(id: string): Promise<void> {
  const { data: rx } = await supabase
    .from('prescriptions')
    .select('consultation_id')
    .eq('id', id)
    .single();
  if (rx) await assertConsultationIsDraft(rx.consultation_id);

  const { error } = await supabase.from('prescriptions').delete().eq('id', id);
  if (error) throw error;
}
