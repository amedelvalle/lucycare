import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMyProfile,
  getLocalSuggestions,
  updateMyProfile,
  type PatientProfileUpdate,
} from '@/services/patientProfile.service';

export const patientProfileKeys = {
  profile: ['patient-profile'] as const,
  suggestions: ['patient-profile-suggestions'] as const,
};

export function useMyProfile() {
  return useQuery({
    queryKey: patientProfileKeys.profile,
    queryFn: getMyProfile,
    staleTime: 1000 * 30,
  });
}

export function useLocalSuggestions() {
  return useQuery({
    queryKey: patientProfileKeys.suggestions,
    queryFn: getLocalSuggestions,
    staleTime: 1000 * 60,
  });
}

export function useUpdateMyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: PatientProfileUpdate) => updateMyProfile(updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: patientProfileKeys.profile });
    },
  });
}
