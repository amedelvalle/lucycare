import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPatientsList,
  getPatientById,
  getPatientAppointments,
  updatePatient,
  setPatientActive,
  createBasicPatient,
  type PatientUpdateInput,
  type CreateBasicPatientInput,
} from '@/services/patients.service';

export const patientKeys = {
  all: ['patients'] as const,
  list: (clinicId: string, search: string, includeInactive: boolean) =>
    [...patientKeys.all, 'list', clinicId, search, includeInactive] as const,
  detail: (patientId: string) =>
    [...patientKeys.all, 'detail', patientId] as const,
  appointments: (patientId: string) =>
    [...patientKeys.all, 'appointments', patientId] as const,
};

export function usePatientsList(
  clinicId: string | undefined,
  search: string,
  includeInactive = false
) {
  return useQuery({
    queryKey: patientKeys.list(clinicId ?? '', search, includeInactive),
    queryFn: () => getPatientsList(clinicId!, search, includeInactive),
    enabled: !!clinicId,
    staleTime: 1000 * 30,
    placeholderData: (prev) => prev,
  });
}

export function usePatient(patientId: string | undefined) {
  return useQuery({
    queryKey: patientKeys.detail(patientId ?? ''),
    queryFn: () => getPatientById(patientId!),
    enabled: !!patientId,
    staleTime: 1000 * 60,
  });
}

export function usePatientAppointments(patientId: string | undefined) {
  return useQuery({
    queryKey: patientKeys.appointments(patientId ?? ''),
    queryFn: () => getPatientAppointments(patientId!),
    enabled: !!patientId,
    staleTime: 1000 * 30,
  });
}

export function useUpdatePatient(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (updates: PatientUpdateInput) => updatePatient(patientId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) });
      queryClient.invalidateQueries({ queryKey: patientKeys.all });
    },
  });
}

/**
 * Crea un paciente con dedup por teléfono. Si ya existe → lanza
 * DuplicatePhoneError (el caller decide si reusarlo o navegar).
 * Invalida la lista de pacientes al éxito.
 */
export function useCreatePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBasicPatientInput) => createBasicPatient(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientKeys.all });
    },
  });
}

export function useSetPatientActive(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (isActive: boolean) => setPatientActive(patientId, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) });
      queryClient.invalidateQueries({ queryKey: patientKeys.all });
    },
  });
}
