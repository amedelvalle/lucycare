import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTeamMembers,
  getPendingInvitations,
  inviteMember,
  cancelInvitation,
  setMemberActive,
} from '@/services/team.service';

export const teamKeys = {
  members: (clinicId: string) => ['team', 'members', clinicId] as const,
  pending: (clinicId: string) => ['team', 'pending', clinicId] as const,
};

export function useTeamMembers(clinicId: string | undefined) {
  return useQuery({
    queryKey: teamKeys.members(clinicId ?? ''),
    queryFn: () => getTeamMembers(clinicId!),
    enabled: !!clinicId,
    staleTime: 1000 * 30,
  });
}

export function usePendingInvitations(clinicId: string | undefined) {
  return useQuery({
    queryKey: teamKeys.pending(clinicId ?? ''),
    queryFn: () => getPendingInvitations(clinicId!),
    enabled: !!clinicId,
    staleTime: 1000 * 30,
  });
}

export function useInviteMember(clinicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { phone: string; displayName?: string }) =>
      inviteMember(clinicId, input.phone, input.displayName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: teamKeys.pending(clinicId) });
    },
  });
}

export function useCancelInvitation(clinicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) => cancelInvitation(invitationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: teamKeys.pending(clinicId) });
    },
  });
}

export function useSetMemberActive(clinicId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { memberId: string; isActive: boolean }) =>
      setMemberActive(input.memberId, input.isActive),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: teamKeys.members(clinicId) });
    },
  });
}
