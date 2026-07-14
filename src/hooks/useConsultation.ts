import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  useIsMutating,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
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
  /**
   * Key COMPARTIDA por todas las mutaciones que escriben contenido clínico de
   * la consulta (receta, diagnósticos, antecedentes). No es una query key: la
   * usan las mutaciones para poder contarse con `useIsMutating` desde afuera.
   *
   * Sirve para el gate de firma: esos guardados salen por `onBlur` (autosave)
   * y, si la firma les gana la carrera, la consulta queda firmada y el UPDATE
   * posterior rebota contra la inmutabilidad (s7_28) → el dato se perdía en
   * silencio. ConsultaPage bloquea "Firmar" mientras haya alguno en vuelo.
   */
  clinicalWrite: (consultationId: string) =>
    [...consultationKeys.all, 'clinical-write', consultationId] as const,
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
 * Identifica la FILA que toca una mutación clínica. Sirve para limpiar el error
 * viejo de una fila cuando ESA fila vuelve a guardarse bien, sin borrar errores
 * de otras filas que siguen sin guardarse.
 */
function clinicalTargetId(variables: unknown): string {
  if (typeof variables === 'string') return variables; // remove(id)
  if (variables && typeof variables === 'object') {
    const v = variables as Record<string, unknown>;
    if (typeof v.id === 'string') return v.id; // update({ id, ... })
    if (typeof v.medication_id === 'string') return `med:${v.medication_id}`; // add receta
    if (typeof v.diagnosisId === 'string') return `dx:${v.diagnosisId}`; // add diagnóstico
    if (typeof v.familyHistoryId === 'string') return `fh:${v.familyHistoryId}`; // add antecedente
  }
  return 'desconocido';
}

/**
 * Al guardar bien una fila, saca del cache los errores ANTERIORES de esa misma
 * fila. Sin esto, un fallo ya corregido seguiría bloqueando la firma: las
 * mutaciones fallidas quedan en el cache hasta que las recoja el GC.
 */
function clearFailedClinicalWrite(
  qc: QueryClient,
  consultationId: string,
  variables: unknown
) {
  const target = clinicalTargetId(variables);
  const cache = qc.getMutationCache();
  cache
    .findAll({
      mutationKey: consultationKeys.clinicalWrite(consultationId),
      status: 'error',
    })
    .forEach((m) => {
      if (clinicalTargetId(m.state.variables) === target) cache.remove(m);
    });
}

/**
 * Gate de los guardados de contenido clínico (receta / diagnósticos /
 * antecedentes) de esta consulta. Esas secciones autoguardan en `onBlur` con
 * mutaciones propias, así que el gate vive acá y no en cada sección.
 *
 * La firma se bloquea en DOS casos, porque los dos dejarían la consulta firmada
 * sin el último cambio clínico:
 *   - hay un guardado EN VUELO (la firma le ganaría la carrera);
 *   - hay un guardado FALLIDO sin resolver (ese cambio no está en la DB).
 *
 * Y expone las dos formas de leerlo, porque la distinción importa:
 *  - `isPending` / `hasFailed`: estado de RENDER (deshabilitar el botón, mostrar
 *    el aviso). Llega un frame tarde: React recién re-renderiza tras el `mutate()`.
 *  - `isBlockedNow()`: lectura IMPERATIVA y síncrona del cache. Es la única
 *    confiable dentro de un handler de click: al editar un campo e ir directo a
 *    "Firmar", el `blur` (mousedown) dispara el guardado y el `click` (mouseup)
 *    corre ANTES de que React haya re-renderizado el botón como deshabilitado
 *    (medido: ~130 ms; en esa ventana el modal SÍ se abría).
 */
export function useClinicalWrites(consultationId: string | undefined) {
  const qc = useQueryClient();
  const mutationKey = consultationKeys.clinicalWrite(consultationId ?? '');

  const isPending = useIsMutating({ mutationKey }) > 0;

  const failed = useMutationState({
    filters: { mutationKey, status: 'error' },
    select: (m) => m.mutationId,
  });
  const hasFailed = failed.length > 0;

  const isBlockedNow = useCallback(() => {
    const key = consultationKeys.clinicalWrite(consultationId ?? '');
    const pending = qc.isMutating({ mutationKey: key }) > 0;
    const withError =
      qc.getMutationCache().findAll({ mutationKey: key, status: 'error' }).length > 0;
    return pending || withError;
  }, [qc, consultationId]);

  return { isPending, hasFailed, isBlockedNow };
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
    mutationKey: consultationKeys.clinicalWrite(consultationId),
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
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: consultationKeys.consultationDiagnoses(consultationId) });
      clearFailedClinicalWrite(qc, consultationId, variables);
    },
  });
}

export function useUpdateConsultationDiagnosis(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: consultationKeys.clinicalWrite(consultationId),
    mutationFn: (input: {
      id: string;
      diagnosis_type?: DiagnosisType;
      diagnosis_status?: DiagnosisStatus;
      notes?: string | null;
    }) => updateConsultationDiagnosis(input.id, input),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: consultationKeys.consultationDiagnoses(consultationId) });
      clearFailedClinicalWrite(qc, consultationId, variables);
    },
  });
}

export function useRemoveConsultationDiagnosis(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: consultationKeys.clinicalWrite(consultationId),
    mutationFn: (id: string) => removeConsultationDiagnosis(id),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: consultationKeys.consultationDiagnoses(consultationId) });
      clearFailedClinicalWrite(qc, consultationId, variables);
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
    mutationKey: consultationKeys.clinicalWrite(consultationId),
    mutationFn: (input: PrescriptionInput) => addPrescription(consultationId, input),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: consultationKeys.prescriptions(consultationId) });
      clearFailedClinicalWrite(qc, consultationId, variables);
    },
  });
}

export function useUpdatePrescription(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: consultationKeys.clinicalWrite(consultationId),
    mutationFn: (input: { id: string } & Omit<PrescriptionInput, 'medication_id'>) => {
      const { id, ...rest } = input;
      return updatePrescription(id, rest);
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: consultationKeys.prescriptions(consultationId) });
      clearFailedClinicalWrite(qc, consultationId, variables);
    },
  });
}

export function useRemovePrescription(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: consultationKeys.clinicalWrite(consultationId),
    mutationFn: (id: string) => removePrescription(id),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: consultationKeys.prescriptions(consultationId) });
      clearFailedClinicalWrite(qc, consultationId, variables);
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
    mutationKey: consultationKeys.clinicalWrite(consultationId),
    mutationFn: (input: { familyHistoryId: string; notes?: string }) =>
      addConsultationFamilyHistory(consultationId, input.familyHistoryId, input.notes),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: consultationKeys.consultationFamilyHistory(consultationId) });
      clearFailedClinicalWrite(qc, consultationId, variables);
    },
  });
}

export function useUpdateConsultationFamilyHistory(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: consultationKeys.clinicalWrite(consultationId),
    mutationFn: (input: { id: string; notes?: string | null }) => {
      const { id, ...updates } = input;
      return updateConsultationFamilyHistory(id, updates);
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: consultationKeys.consultationFamilyHistory(consultationId) });
      clearFailedClinicalWrite(qc, consultationId, variables);
    },
  });
}

export function useRemoveConsultationFamilyHistory(consultationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: consultationKeys.clinicalWrite(consultationId),
    mutationFn: (id: string) => removeConsultationFamilyHistory(id),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: consultationKeys.consultationFamilyHistory(consultationId) });
      clearFailedClinicalWrite(qc, consultationId, variables);
    },
  });
}
