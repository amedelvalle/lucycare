import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getDoctorInfo,
  getNextAppointmentForPatient,
  getDayBusySlots,
  createWalkInAppointment,
  type CreateWalkInData,
} from '@/services/walkIn.service';

export const followUpKeys = {
  doctorInfo: (doctorId: string) => ['doctor-info', doctorId] as const,
  nextAppt: (patientId: string, doctorId: string, after: string) =>
    ['next-appointment', patientId, doctorId, after] as const,
  daySlots: (doctorId: string, date: string) => ['day-busy', doctorId, date] as const,
};

export function useDoctorInfo(doctorId: string | undefined) {
  return useQuery({
    queryKey: followUpKeys.doctorInfo(doctorId ?? ''),
    queryFn: () => getDoctorInfo(doctorId!),
    enabled: !!doctorId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useNextAppointment(
  patientId: string | undefined,
  doctorId: string | undefined,
  afterDatetime: string | undefined
) {
  return useQuery({
    queryKey: followUpKeys.nextAppt(patientId ?? '', doctorId ?? '', afterDatetime ?? ''),
    queryFn: () => getNextAppointmentForPatient(patientId!, doctorId!, afterDatetime!),
    enabled: !!patientId && !!doctorId && !!afterDatetime,
    staleTime: 1000 * 30,
  });
}

export function useDayBusySlots(doctorId: string | undefined, dateStr: string | undefined) {
  return useQuery({
    queryKey: followUpKeys.daySlots(doctorId ?? '', dateStr ?? ''),
    queryFn: () => getDayBusySlots(doctorId!, dateStr!),
    enabled: !!doctorId && !!dateStr,
    staleTime: 1000 * 30,
  });
}

export function useCreateFollowUp(patientId: string, doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWalkInData) => createWalkInAppointment(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['next-appointment', patientId, doctorId] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['day-busy', doctorId] });
    },
  });
}
