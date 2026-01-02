import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useAuth } from './useAuth';
import { Member, UserRole, MemberInviteData } from '../types';

/**
 * Query key factory for members queries
 */
export const membersKeys = {
  all: ['members'] as const,
  lists: () => [...membersKeys.all, 'list'] as const,
  list: (clinicId?: number) => [...membersKeys.lists(), clinicId] as const,
};

/**
 * Hook to fetch members list
 * 
 * Automatically includes clinic ID in query key for proper cache separation
 * when users switch between clinics.
 * 
 * @param enabled - Whether the query should run (default: true)
 */
export function useMembers(enabled: boolean = true) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery<Member[]>({
    queryKey: membersKeys.list(activeClinicId ?? undefined),
    queryFn: () => apiService.getMembers(),
    enabled: enabled && !isLoading && isAuthenticated && !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    initialData: [],
  });
}

/**
 * Hook to invite a new member
 */
export function useInviteMember() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useMutation({
    mutationFn: (inviteData: MemberInviteData) => apiService.inviteMember(inviteData),
    onSuccess: () => {
      // Invalidate members list to refetch after invite
      queryClient.invalidateQueries({ queryKey: membersKeys.list(activeClinicId ?? undefined) });
    },
  });
}

/**
 * Hook to update member roles
 */
export function useUpdateMemberRoles() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useMutation({
    mutationFn: ({ userId, roles }: { userId: number; roles: UserRole[] }) =>
      apiService.updateMemberRoles(userId, roles),
    onSuccess: () => {
      // Invalidate members list to refetch after update
      queryClient.invalidateQueries({ queryKey: membersKeys.list(activeClinicId ?? undefined) });
    },
  });
}

/**
 * Hook to remove (deactivate) a member
 */
export function useRemoveMember() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useMutation({
    mutationFn: (userId: number) => apiService.removeMember(userId),
    onSuccess: () => {
      // Invalidate members list to refetch after removal
      queryClient.invalidateQueries({ queryKey: membersKeys.list(activeClinicId ?? undefined) });
    },
  });
}

/**
 * Hook to reactivate a member
 */
export function useReactivateMember() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useMutation({
    mutationFn: (userId: number) => apiService.reactivateMember(userId),
    onSuccess: () => {
      // Invalidate members list to refetch after reactivation
      queryClient.invalidateQueries({ queryKey: membersKeys.list(activeClinicId ?? undefined) });
    },
  });
}
