import { supabase } from '@/lib/supabase';
import { incrementDiagnosisUsage } from './diagnosesCatalog.service';

/**
 * Verifica que la consulta padre esté en draft. Tira error si está firmada.
 * Defensa adicional cliente — el trigger DB `prevent_signed_consultation_edit`
 * cubre la consulta misma, pero NO los childs (consultation_diagnoses, prescriptions).
 */
async function assertConsultationIsDraft(consultationId: string): Promise<void> {
  const { data, error } = await supabase
    .from('consultations')
    .select('status')
    .eq('id', consultationId)
    .single();
  if (error) throw error;
  if (data?.status === 'signed') {
    throw new Error('La consulta está firmada — no se puede modificar.');
  }
}

export type DiagnosisType = 'presuntivo' | 'definitivo' | 'diferencial';
export type DiagnosisStatus =
  | 'activo'
  | 'en_estudio'
  | 'en_tratamiento'
  | 'controlado'
  | 'descontrolado'
  | 'cronico'
  | 'en_remision'
  | 'en_observacion'
  | 'resuelto';

export interface ConsultationDiagnosis {
  id: string;
  consultation_id: string;
  diagnosis_id: string;
  diagnosis_type: DiagnosisType;
  diagnosis_status: DiagnosisStatus;
  notes: string | null;
  // Datos del diagnóstico (join)
  diagnosis: {
    id: string;
    name: string;
    description: string | null;
  };
}

export const DIAGNOSIS_TYPES: { value: DiagnosisType; label: string }[] = [
  { value: 'presuntivo', label: 'Presuntivo' },
  { value: 'definitivo', label: 'Definitivo' },
  { value: 'diferencial', label: 'Diferencial' },
];

// Orden narrativo del flujo clínico:
// descubrimiento → estudio → tratamiento → control → crónico → remisión → observación → cierre
export const DIAGNOSIS_STATUSES: { value: DiagnosisStatus; label: string }[] = [
  { value: 'activo', label: 'Activo' },
  { value: 'en_estudio', label: 'En estudio' },
  { value: 'en_tratamiento', label: 'En tratamiento' },
  { value: 'controlado', label: 'Controlado' },
  { value: 'descontrolado', label: 'Descontrolado' },
  { value: 'cronico', label: 'Crónico' },
  { value: 'en_remision', label: 'En remisión' },
  { value: 'en_observacion', label: 'En observación' },
  { value: 'resuelto', label: 'Resuelto' },
];

// SELECT compartido: JOIN al catálogo vivo + snapshot histórico (s7_37).
// La lectura prefiere el snapshot (nombre congelado al diagnosticar); cae al
// catálogo vivo solo si el snapshot es NULL (pre-backfill).
const DIAGNOSIS_SELECT = `
  id,
  consultation_id,
  diagnosis_id,
  diagnosis_type,
  diagnosis_status,
  notes,
  diagnosis_name_snapshot,
  diagnosis:diagnoses(id, name, description)
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDiagnosis(row: any): ConsultationDiagnosis {
  const dx = row.diagnosis ?? null;
  return {
    id: row.id,
    consultation_id: row.consultation_id,
    diagnosis_id: row.diagnosis_id,
    diagnosis_type: row.diagnosis_type,
    diagnosis_status: row.diagnosis_status,
    notes: row.notes,
    diagnosis: {
      id: dx?.id ?? row.diagnosis_id,
      name: row.diagnosis_name_snapshot ?? dx?.name ?? '',
      description: dx?.description ?? null,
    },
  };
}

export async function getConsultationDiagnoses(
  consultationId: string
): Promise<ConsultationDiagnosis[]> {
  const { data, error } = await supabase
    .from('consultation_diagnoses')
    .select(DIAGNOSIS_SELECT)
    .eq('consultation_id', consultationId)
    .order('id', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(mapDiagnosis);
}

export async function addConsultationDiagnosis(
  consultationId: string,
  diagnosisId: string,
  type: DiagnosisType = 'presuntivo',
  status: DiagnosisStatus = 'activo',
  notes?: string
): Promise<ConsultationDiagnosis> {
  await assertConsultationIsDraft(consultationId);
  const { data, error } = await supabase
    .from('consultation_diagnoses')
    .insert({
      consultation_id: consultationId,
      diagnosis_id: diagnosisId,
      diagnosis_type: type,
      diagnosis_status: status,
      notes: notes?.trim() || null,
    })
    .select(DIAGNOSIS_SELECT)
    .single();

  if (error) throw error;

  // Incrementar usage_count en background — no bloquea
  incrementDiagnosisUsage(diagnosisId).catch(() => {});

  return mapDiagnosis(data);
}

export async function updateConsultationDiagnosis(
  id: string,
  updates: { diagnosis_type?: DiagnosisType; diagnosis_status?: DiagnosisStatus; notes?: string | null }
): Promise<void> {
  // Verificar consulta padre en draft
  const { data: cd } = await supabase
    .from('consultation_diagnoses')
    .select('consultation_id')
    .eq('id', id)
    .single();
  if (cd) await assertConsultationIsDraft(cd.consultation_id);

  const payload = {
    ...updates,
    notes: updates.notes !== undefined ? (updates.notes?.trim() || null) : undefined,
  };
  const { error } = await supabase
    .from('consultation_diagnoses')
    .update(payload)
    .eq('id', id);
  if (error) throw error;
}

export async function removeConsultationDiagnosis(id: string): Promise<void> {
  const { data: cd } = await supabase
    .from('consultation_diagnoses')
    .select('consultation_id')
    .eq('id', id)
    .single();
  if (cd) await assertConsultationIsDraft(cd.consultation_id);

  const { error } = await supabase.from('consultation_diagnoses').delete().eq('id', id);
  if (error) throw error;
}
