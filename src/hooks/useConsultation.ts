import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getOrCreateConsultationForAppointment,
  saveConsultationDraft,
  signConsultation,
  isDraftConsultationEmpty,
  discardEmptyConsultation,
  amendConsultation,
  getConsultationAmendments,
  type ConsultationUpdate,
  type ConsultationTextChanges,
  type PrescriptionOp,
  type DiagnosisOp,
  type FamilyHistoryOp,
  type VitalsChanges,
} from '@/services/consultations.service';
import {
  getVitalsByAppointment,
  upsertVitals,
  type VitalsInput,
} from '@/services/vitals.service';
import {
  searchDiagnoses,
  createDiagnosis,
} from '@/services/diagnosesCatalog.service';
import {
  searchFamilyHistory,
  createFamilyHistory,
} from '@/services/familyHistoryCatalog.service';
import {
  getConsultationFamilyHistory,
  addConsultationFamilyHistory,
  updateConsultationFamilyHistory,
  removeConsultationFamilyHistory,
} from '@/services/consultationFamilyHistory.service';
import {
  getConsultationDiagnoses,
  addConsultationDiagnosis,
  updateConsultationDiagnosis,
  removeConsultationDiagnosis,
  type DiagnosisType,
  type DiagnosisStatus,
} from '@/services/consultationDiagnoses.service';
import {
  searchMedications,
  createMedication,
  type MedicationPresentation,
} from '@/services/medicationsCatalog.service';
import {
  getPrescriptions,
  getPermanentPrescriptionsForPatient,
  addPrescription,
  updatePrescription,
  removePrescription,
  type PrescriptionInput,
} from '@/services/prescriptions.service';

// ─── Query keys ───────────────────────────────────────────────────────
export const consultationKeys = {
  all: ['consultation'] as const,
  byAppointment: (appointmentId: string) =>
    [...consultationKeys.all, 'apt', appointmentId] as const,
  vitals: (appointmentId: string) =>
    [...consultationKeys.all, 'vitals', appointmentId] as const,
  diagnosesCatalog: (doctorId: string, search: string) =>
    ['diagnoses-catalog', doctorId, search] as const,
  medicationsCatalog: (doctorId: string, search: string) =>
    ['medications-catalog', doctorId, search] as const,
  familyHistoryCatalog: (doctorId: string, search: string) =>
    ['family-history-catalog', doctorId, search] as const,
  consultationDiagnoses: (consultationId: string) =>
    [...consultationKeys.all, 'cd', consultationId] as const,
  consultationFamilyHistory: (consultationId: string) =>
    [...consultationKeys.all, 'cfh', consultationId] as const,
  prescriptions: (consultationId: string) =>
    [...consultationKeys.all, 'rx', consultationId] as const,
  permanentRx: (patientId: string, doctorId: string) =>
    [...consultationKeys.all, 'permanent-rx', patientId, doctorId] as const,
  amendments: (consultationId: string) =>
    [...consultationKeys.all, 'amendments', consultationId] as const,
};

// ─── Consulta ─────────────────────────────────────────────────────────

export function useConsultationByAppointment(appointmentId: string | undefined) {
  return useQuery({
    queryKey: consultationKeys.byAppointment(appointmentId ?? ''),
    queryFn: () => getOrCreateConsultationForAppointment(appointmentId!),
    enabled: !!appointmentId,
    staleTime: 1000 * 30,
  });
}

export function useSaveConsultationDraft(consultationId: string, appointmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: ConsultationUpdate) =>
      saveConsultationDraft(consultationId, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.byAppointment(appointmentId) });
    },
  });
}

export function useSignConsultation(consultationId: string, appointmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => signConsultation(consultationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.byAppointment(appointmentId) });
      // La firma también auto-transiciona la cita → invalidamos queries de citas
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['dashboard-today'] });
      qc.invalidateQueries({ queryKey: ['dashboard-upcoming'] });
    },
  });
}

/**
 * Indica si la consulta está vacía (sin contenido) — usado para mostrar
 * el botón "Descartar borrador" condicionalmente.
 */
export function useIsConsultationEmpty(consultationId: string | undefined) {
  return useQuery({
    queryKey: ['consultation-is-empty', consultationId],
    queryFn: () => isDraftConsultationEmpty(consultationId!),
    enabled: !!consultationId,
    staleTime: 1000 * 5,
  });
}

export function useDiscardConsultation(consultationId: string, appointmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => discardEmptyConsultation(consultationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.byAppointment(appointmentId) });
      qc.invalidateQueries({ queryKey: ['consultation-is-empty'] });
    },
  });
}

// ─── Corrección controlada de consulta firmada (B2.1) ─────────────────

/** Historial de adendas de una consulta (más reciente primero). */
export function useConsultationAmendments(consultationId: string | undefined) {
  return useQuery({
    queryKey: consultationKeys.amendments(consultationId ?? ''),
    queryFn: () => getConsultationAmendments(consultationId!),
    enabled: !!consultationId,
    staleTime: 1000 * 30,
  });
}

/** Corrige una consulta firmada (texto + receta + diagnósticos + antecedentes
 * + vitales) vía amend_consultation. */
export function useAmendConsultation(consultationId: string, appointmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      reason: string;
      changes: ConsultationTextChanges;
      prescriptionOps: PrescriptionOp[];
      diagnosisOps: DiagnosisOp[];
      familyHistoryOps: FamilyHistoryOp[];
      vitalsChanges: VitalsChanges;
    }) =>
      amendConsultation(
        consultationId,
        input.reason,
        input.changes,
        input.prescriptionOps,
        input.diagnosisOps,
        input.familyHistoryOps,
        input.vitalsChanges
      ),
    onSuccess: () => {
      // Refrescar todo lo que la corrección pudo tocar.
      qc.invalidateQueries({ queryKey: consultationKeys.byAppointment(appointmentId) });
      qc.invalidateQueries({ queryKey: consultationKeys.amendments(consultationId) });
      qc.invalidateQueries({ queryKey: consultationKeys.prescriptions(consultationId) });
      qc.invalidateQueries({ queryKey: consultationKeys.consultationDiagnoses(consultationId) });
      qc.invalidateQueries({ queryKey: consultationKeys.consultationFamilyHistory(consultationId) });
      qc.invalidateQueries({ queryKey: consultationKeys.vitals(appointmentId) });
    },
  });
}

// ─── Signos vitales ───────────────────────────────────────────────────

export function useVitals(appointmentId: string | undefined) {
  return useQuery({
    queryKey: consultationKeys.vitals(appointmentId ?? ''),
    queryFn: () => getVitalsByAppointment(appointmentId!),
    enabled: !!appointmentId,
    staleTime: 1000 * 30,
  });
}

export function useUpsertVitals(appointmentId: string, patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VitalsInput) => upsertVitals(appointmentId, patientId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.vitals(appointmentId) });
    },
  });
}

// ─── Diagnósticos: catálogo ───────────────────────────────────────────

export function useDiagnosesSearch(doctorId: string | undefined, search: string) {
  // Solo dispara cuando hay al menos 1 carácter — evita queries innecesarias
  // al abrir la consulta. El Combobox muestra "Empezá a escribir para buscar".
  const trimmed = search.trim();
  return useQuery({
    queryKey: consultationKeys.diagnosesCatalog(doctorId ?? '', trimmed),
    queryFn: () => searchDiagnoses(doctorId!, trimmed),
    enabled: !!doctorId && trimmed.length >= 1,
    staleTime: 1000 * 60,
    placeholderData: (prev) => prev,
  });
}

export function useCreateDiagnosis(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      createDiagnosis(doctorId, input.name, input.description),
    onSuccess: () => {
      // Invalida tanto el cache del autocomplete (consulta) como el admin (catálogos)
      qc.invalidateQueries({ queryKey: ['diagnoses-catalog', doctorId] });
      qc.invalidateQueries({ queryKey: ['catalogs', 'diagnoses', doctorId] });
    },
  });
}

// ─── Diagnósticos: asignación a la consulta ───────────────────────────

export function useConsultationDiagnoses(consultationId: string | undefined) {
  return useQuery({
    queryKey: consultationKeys.consultationDiagnoses(consultationId ?? ''),
    queryFn: () => getConsultationDiagnoses(consultationId!),
    enabled: !!consultationId,
    staleTime: 1000 * 30,
  });
}

export function useAddConsultationDiagnosis(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      diagnosisId: string;
      type?: DiagnosisType;
      status?: DiagnosisStatus;
      notes?: string;
    }) =>
      addConsultationDiagnosis(
        consultationId,
        input.diagnosisId,
        input.type,
        input.status,
        input.notes
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.consultationDiagnoses(consultationId) });
    },
  });
}

export function useUpdateConsultationDiagnosis(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      diagnosis_type?: DiagnosisType;
      diagnosis_status?: DiagnosisStatus;
      notes?: string | null;
    }) => updateConsultationDiagnosis(input.id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.consultationDiagnoses(consultationId) });
    },
  });
}

export function useRemoveConsultationDiagnosis(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeConsultationDiagnosis(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.consultationDiagnoses(consultationId) });
    },
  });
}

// ─── Medicamentos: catálogo ───────────────────────────────────────────

export function useMedicationsSearch(doctorId: string | undefined, search: string) {
  const trimmed = search.trim();
  return useQuery({
    queryKey: consultationKeys.medicationsCatalog(doctorId ?? '', trimmed),
    queryFn: () => searchMedications(doctorId!, trimmed),
    enabled: !!doctorId && trimmed.length >= 1,
    staleTime: 1000 * 60,
    placeholderData: (prev) => prev,
  });
}

export function useCreateMedication(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      commercial_name: string;
      active_ingredient?: string;
      concentration?: string;
      presentation?: MedicationPresentation;
    }) => createMedication(doctorId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['medications-catalog', doctorId] });
      qc.invalidateQueries({ queryKey: ['catalogs', 'medications', doctorId] });
    },
  });
}

// ─── Recetas (prescriptions) ──────────────────────────────────────────

export function usePrescriptions(consultationId: string | undefined) {
  return useQuery({
    queryKey: consultationKeys.prescriptions(consultationId ?? ''),
    queryFn: () => getPrescriptions(consultationId!),
    enabled: !!consultationId,
    staleTime: 1000 * 30,
  });
}

export function usePermanentPrescriptions(
  patientId: string | undefined,
  doctorId: string | undefined,
  excludeConsultationId?: string
) {
  return useQuery({
    queryKey: consultationKeys.permanentRx(patientId ?? '', doctorId ?? ''),
    queryFn: () =>
      getPermanentPrescriptionsForPatient(patientId!, doctorId!, excludeConsultationId),
    enabled: !!patientId && !!doctorId,
    staleTime: 1000 * 60,
  });
}

export function useAddPrescription(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PrescriptionInput) => addPrescription(consultationId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.prescriptions(consultationId) });
    },
  });
}

export function useUpdatePrescription(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string } & Omit<PrescriptionInput, 'medication_id'>) => {
      const { id, ...rest } = input;
      return updatePrescription(id, rest);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.prescriptions(consultationId) });
    },
  });
}

export function useRemovePrescription(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removePrescription(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.prescriptions(consultationId) });
    },
  });
}

// ─── Antecedentes familiares: catálogo ────────────────────────────────

export function useFamilyHistorySearch(doctorId: string | undefined, search: string) {
  const trimmed = search.trim();
  return useQuery({
    queryKey: consultationKeys.familyHistoryCatalog(doctorId ?? '', trimmed),
    queryFn: () => searchFamilyHistory(doctorId!, trimmed),
    enabled: !!doctorId && trimmed.length >= 1,
    staleTime: 1000 * 60,
    placeholderData: (prev) => prev,
  });
}

export function useCreateFamilyHistory(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      createFamilyHistory(doctorId, input.name, input.description),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['family-history-catalog', doctorId] });
      qc.invalidateQueries({ queryKey: ['catalogs', 'family-history', doctorId] });
    },
  });
}

// ─── Antecedentes familiares: asignados a la consulta ────────────────

export function useConsultationFamilyHistory(consultationId: string | undefined) {
  return useQuery({
    queryKey: consultationKeys.consultationFamilyHistory(consultationId ?? ''),
    queryFn: () => getConsultationFamilyHistory(consultationId!),
    enabled: !!consultationId,
    staleTime: 1000 * 30,
  });
}

export function useAddConsultationFamilyHistory(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { familyHistoryId: string; notes?: string }) =>
      addConsultationFamilyHistory(consultationId, input.familyHistoryId, input.notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.consultationFamilyHistory(consultationId) });
    },
  });
}

export function useUpdateConsultationFamilyHistory(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; notes?: string | null }) => {
      const { id, ...updates } = input;
      return updateConsultationFamilyHistory(id, updates);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.consultationFamilyHistory(consultationId) });
    },
  });
}

export function useRemoveConsultationFamilyHistory(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeConsultationFamilyHistory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: consultationKeys.consultationFamilyHistory(consultationId) });
    },
  });
}
