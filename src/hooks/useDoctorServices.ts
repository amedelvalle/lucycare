import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listDoctorServices,
  createService,
  updateService,
  deleteService,
  type ServiceInput,
} from '@/services/services.service';

export const doctorServicesKey = (doctorId: string) =>
  ['doctor-services', doctorId] as const;

/** Lista los servicios del médico (activos + inactivos). */
export function useDoctorServices(doctorId: string | undefined) {
  return useQuery({
    queryKey: doctorServicesKey(doctorId ?? ''),
    queryFn: () => listDoctorServices(doctorId!),
    enabled: !!doctorId,
    staleTime: 1000 * 30,
  });
}

export function useCreateService(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ServiceInput) => createService(doctorId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: doctorServicesKey(doctorId) }),
  });
}

export function useUpdateService(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      duration_minutes?: number;
      price?: number | null;
      is_first_visit?: boolean;
      is_active?: boolean;
    }) => {
      const { id, ...updates } = input;
      return updateService(id, updates);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: doctorServicesKey(doctorId) }),
  });
}

export function useDeleteService(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteService(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: doctorServicesKey(doctorId) }),
  });
}
