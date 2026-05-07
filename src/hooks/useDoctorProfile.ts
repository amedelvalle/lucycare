import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMyDoctorProfile,
  updateDoctorPublic,
  updateProfileBasic,
  setDoctorPublished,
  setBookingEnabled,
  type DoctorPublicUpdate,
  type ProfileBasicUpdate,
} from '@/services/doctorProfile.service';

export const myDoctorProfileKey = ['my-doctor-profile'] as const;

export function useMyDoctorProfile() {
  return useQuery({
    queryKey: myDoctorProfileKey,
    queryFn: getMyDoctorProfile,
    staleTime: 1000 * 60,
  });
}

export function useUpdateDoctorPublic(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: DoctorPublicUpdate) => updateDoctorPublic(doctorId, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: myDoctorProfileKey }),
  });
}

export function useUpdateProfileBasic(profileId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: ProfileBasicUpdate) => updateProfileBasic(profileId, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: myDoctorProfileKey }),
  });
}

export function useSetDoctorPublished(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: boolean) => setDoctorPublished(doctorId, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: myDoctorProfileKey }),
  });
}

export function useSetBookingEnabled(doctorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: boolean) => setBookingEnabled(doctorId, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: myDoctorProfileKey }),
  });
}
