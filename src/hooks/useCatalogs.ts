import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAllDiagnoses,
  listGlobalDiagnoses,
  cloneDiagnosisToOwn,
  updateDiagnosis,
} from '@/services/diagnosesCatalog.service';
import {
  listAllMedications,
  listGlobalMedications,
  cloneMedicationToOwn,
  updateMedication,
  type MedicationPresentation,
} from '@/services/medicationsCatalog.service';
import {
  listAllFamilyHistory,
  updateFamilyHistory,
} from '@/services/familyHistoryCatalog.service';
import {
  hideGlobalCatalogItem,
  unhideGlobalCatalogItem,
  type CatalogItemType,
} from '@/services/catalogShared.service';

export const catalogKeys = {
  diagnoses: (doctorId: string, search: string, includeInactive: boolean, page: number, pageSize: number) =>
    ['catalogs', 'diagnoses', doctorId, search, includeInactive, page, pageSize] as const,
  medications: (doctorId: string, search: string, includeInactive: boolean, page: number, pageSize: number) =>
    ['catalogs', 'medications', doctorId, search, includeInactive, page, pageSize] as const,
  familyHistory: (doctorId: string, search: string, includeInactive: boolean, page: number, pageSize: number) =>
    ['catalogs', 'family-history', doctorId, search, includeInactive, page, pageSize] as const,
  globalDiagnoses: (doctorId: string, search: string, page: number, pageSize: number) =>
    ['catalogs', 'diagnoses-global', doctorId, search, page, pageSize] as const,
  globalMedications: (doctorId: string, search: string, page: number, pageSize: number) =>
    ['catalogs', 'medications-global', doctorId, search, page, pageSize] as const,
};

/**
 * Invalida todas las cachés de catálogo afectadas por ocultar/mostrar/clonar:
 * listas propias + listas globales (admin) + búsqueda en consulta/receta.
 */
function invalidateCatalogCaches(qc: ReturnType<typeof useQueryClient>, doctorId: string) {
  qc.invalidateQueries({ queryKey: ['catalogs', 'diagnoses', doctorId] });
  qc.invalidateQueries({ queryKey: ['catalogs', 'medications', doctorId] });
  qc.invalidateQueries({ queryKey: ['catalogs', 'diagnoses-global', doctorId] });
  qc.invalidateQueries({ queryKey: ['catalogs', 'medications-global', doctorId] });
  qc.invalidateQueries({ queryKey: ['diagnoses-catalog', doctorId] });
  qc.invalidateQueries({ queryKey: ['medications-catalog', doctorId] });
}

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

// ─── Catálogo global (base Lucy) — admin del médico (PR-4) ────────────

export function useGlobalDiagnoses(
  doctorId: string | undefined,
  search: string,
  page = 1,
  pageSize = 50
) {
  return useQuery({
    queryKey: catalogKeys.globalDiagnoses(doctorId ?? '', search, page, pageSize),
    queryFn: () => listGlobalDiagnoses(doctorId!, { search, page, pageSize }),
    enabled: !!doctorId,
    staleTime: 1000 * 30,
    placeholderData: (prev) => prev,
  });
}

export function useGlobalMedications(
  doctorId: string | undefined,
  search: string,
  page = 1,
  pageSize = 50
) {
  return useQuery({
    queryKey: catalogKeys.globalMedications(doctorId ?? '', search, page, pageSize),
    queryFn: () => listGlobalMedications(doctorId!, { search, page, pageSize }),
    enabled: !!doctorId,
    staleTime: 1000 * 30,
    placeholderData: (prev) => prev,
  });
}

export function useHideCatalogItem(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { itemType: CatalogItemType; itemId: string }) =>
      hideGlobalCatalogItem(doctorId, input.itemType, input.itemId),
    onSuccess: () => invalidateCatalogCaches(qc, doctorId),
  });
}

export function useUnhideCatalogItem(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { itemType: CatalogItemType; itemId: string }) =>
      unhideGlobalCatalogItem(doctorId, input.itemType, input.itemId),
    onSuccess: () => invalidateCatalogCaches(qc, doctorId),
  });
}

export function useCloneDiagnosisToOwn(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (global: { id: string; name: string; description: string | null }) =>
      cloneDiagnosisToOwn(doctorId, global),
    onSuccess: () => invalidateCatalogCaches(qc, doctorId),
  });
}

export function useCloneMedicationToOwn(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (global: {
      id: string;
      commercial_name: string;
      active_ingredient: string | null;
      concentration: string | null;
      presentation: MedicationPresentation | null;
    }) => cloneMedicationToOwn(doctorId, global),
    onSuccess: () => invalidateCatalogCaches(qc, doctorId),
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
