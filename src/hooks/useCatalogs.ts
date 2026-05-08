import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAllDiagnoses,
  updateDiagnosis,
} from '@/services/diagnosesCatalog.service';
import {
  listAllMedications,
  updateMedication,
  type MedicationPresentation,
} from '@/services/medicationsCatalog.service';

export const catalogKeys = {
  diagnoses: (doctorId: string, search: string, includeInactive: boolean) =>
    ['catalogs', 'diagnoses', doctorId, search, includeInactive] as const,
  medications: (doctorId: string, search: string, includeInactive: boolean) =>
    ['catalogs', 'medications', doctorId, search, includeInactive] as const,
};

export function useDiagnosesAll(
  doctorId: string | undefined,
  search: string,
  includeInactive: boolean
) {
  return useQuery({
    queryKey: catalogKeys.diagnoses(doctorId ?? '', search, includeInactive),
    queryFn: () => listAllDiagnoses(doctorId!, { search, includeInactive }),
    enabled: !!doctorId,
    staleTime: 1000 * 30,
    placeholderData: (prev) => prev,
  });
}

export function useUpdateDiagnosis(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      description?: string | null;
      is_active?: boolean;
    }) => {
      const { id, ...updates } = input;
      return updateDiagnosis(id, updates);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalogs', 'diagnoses', doctorId] });
      qc.invalidateQueries({ queryKey: ['diagnoses-catalog', doctorId] });
    },
  });
}

export function useMedicationsAll(
  doctorId: string | undefined,
  search: string,
  includeInactive: boolean
) {
  return useQuery({
    queryKey: catalogKeys.medications(doctorId ?? '', search, includeInactive),
    queryFn: () => listAllMedications(doctorId!, { search, includeInactive }),
    enabled: !!doctorId,
    staleTime: 1000 * 30,
    placeholderData: (prev) => prev,
  });
}

export function useUpdateMedication(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      commercial_name?: string;
      active_ingredient?: string | null;
      concentration?: string | null;
      presentation?: MedicationPresentation | null;
      is_active?: boolean;
    }) => {
      const { id, ...updates } = input;
      return updateMedication(id, updates);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalogs', 'medications', doctorId] });
      qc.invalidateQueries({ queryKey: ['medications-catalog', doctorId] });
    },
  });
}
