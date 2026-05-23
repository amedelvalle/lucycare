import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAdminDoctorServices,
  createAdminService,
  updateAdminService,
  setAdminServiceActive,
  deleteAdminService,
} from '@/services/admin.service';

/**
 * Hooks para que el admin plataforma administre los servicios de
 * cualquier médico (RPCs gateadas por is_admin() en s7_12).
 * Distintos de useDoctorServices, que es para el médico dueño.
 */
export const adminDoctorServicesKey = (doctorId: string) =>
  ['admin-doctor-services', doctorId] as const;

export function useAdminDoctorServices(doctorId: string | undefined) {
  return useQuery({
    queryKey: adminDoctorServicesKey(doctorId ?? ''),
    queryFn: () => listAdminDoctorServices(doctorId!),
    enabled: !!doctorId,
    staleTime: 1000 * 30,
  });
}

export function useAdminCreateService(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      durationMinutes: number;
      price: number | null;
      isFirstVisit: boolean;
    }) => createAdminService({ doctorId, ...input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminDoctorServicesKey(doctorId) }),
  });
}

export function useAdminUpdateService(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      serviceId: string;
      name: string;
      durationMinutes: number;
      price: number | null;
      isFirstVisit: boolean;
    }) => updateAdminService(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminDoctorServicesKey(doctorId) }),
  });
}

export function useAdminSetServiceActive(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { serviceId: string; isActive: boolean }) =>
      setAdminServiceActive(input.serviceId, input.isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminDoctorServicesKey(doctorId) }),
  });
}

export function useAdminDeleteService(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serviceId: string) => deleteAdminService(serviceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminDoctorServicesKey(doctorId) }),
  });
}
