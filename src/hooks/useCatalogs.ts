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
import {
  listAllFamilyHistory,
  updateFamilyHistory,
} from '@/services/familyHistoryCatalog.service';

export const catalogKeys = {
  diagnoses: (doctorId: string, search: string, includeInactive: boolean, page: number, pageSize: number) =>
    ['catalogs', 'diagnoses', doctorId, search, includeInactive, page, pageSize] as const,
  medications: (doctorId: string, search: string, includeInactive: boolean, page: number, pageSize: number) =>
    ['catalogs', 'medications', doctorId, search, includeInactive, page, pageSize] as const,
  familyHistory: (doctorId: string, search: string, includeInactive: boolean, page: number, pageSize: number) =>
    ['catalogs', 'family-history', doctorId, search, includeInactive, page, pageSize] as const,
};

export function useDiagnosesAll(
  doctorId: string | undefined,
  search: string,
  includeInactive: boolean,
  page = 1,
  pageSize = 50
) {
  return useQuery({
    queryKey: catalogKeys.diagnoses(doctorId ?? '', search, includeInactive, page, pageSize),
    queryFn: () => listAllDiagnoses(doctorId!, { search, includeInactive, page, pageSize }),
    enabled: !!doctorId,
    staleTime: 1000 * 30,
    placeholderData: (prev) => prev, // mantiene página anterior visible mientras carga la nueva
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
  includeInactive: boolean,
  page = 1,
  pageSize = 50
) {
  return useQuery({
    queryKey: catalogKeys.medications(doctorId ?? '', search, includeInactive, page, pageSize),
    queryFn: () => listAllMedications(doctorId!, { search, includeInactive, page, pageSize }),
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

// ─── Antecedentes familiares (admin) ──────────────────────────────────

export function useFamilyHistoryAll(
  doctorId: string | undefined,
  search: string,
  includeInactive: boolean,
  page = 1,
  pageSize = 50
) {
  return useQuery({
    queryKey: catalogKeys.familyHistory(doctorId ?? '', search, includeInactive, page, pageSize),
    queryFn: () => listAllFamilyHistory(doctorId!, { search, includeInactive, page, pageSize }),
    enabled: !!doctorId,
    staleTime: 1000 * 30,
    placeholderData: (prev) => prev,
  });
}

export function useUpdateFamilyHistory(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      description?: string | null;
      is_active?: boolean;
    }) => {
      const { id, ...updates } = input;
      return updateFamilyHistory(id, updates);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalogs', 'family-history', doctorId] });
      qc.invalidateQueries({ queryKey: ['family-history-catalog', doctorId] });
    },
  });
}
