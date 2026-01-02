import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useAuth } from './useAuth';

/**
 * Query key factory for line users queries
 */
export const lineUsersKeys = {
  all: ['lineUsers'] as const,
  lists: () => [...lineUsersKeys.all, 'list'] as const,
  list: (params: {
    page?: number;
    pageSize?: number;
    search?: string;
    clinicId?: number;
  }) => [...lineUsersKeys.lists(), params] as const,
};

interface UseLineUsersParams {
  page?: number;
  pageSize?: number;
  search?: string;
  enabled?: boolean;
}

/**
 * Hook to fetch line users list with pagination and filtering
 * 
 * Automatically includes clinic ID in query key for proper cache separation
 * when users switch between clinics.
 */
export function useLineUsers(params: UseLineUsersParams = {}) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { page, pageSize, search, enabled = true } = params;

  return useQuery({
    queryKey: lineUsersKeys.list({
      ...(page !== undefined && { page }),
      ...(pageSize !== undefined && { pageSize }),
      ...(search !== undefined && { search }),
      ...(activeClinicId !== undefined && activeClinicId !== null && { clinicId: activeClinicId }),
    }),
    queryFn: () => apiService.getLineUsers(page, pageSize, undefined, search),
    enabled: enabled && !isLoading && isAuthenticated && !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to update LINE user display name
 */
export function useUpdateLineUserDisplayName() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ lineUserId, displayName }: { lineUserId: string; displayName: string | null }) =>
      apiService.updateLineUserDisplayName(lineUserId, displayName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: lineUsersKeys.all });
    },
  });
}

/**
 * Hook to disable AI for a LINE user
 */
export function useDisableAiForLineUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ lineUserId, reason }: { lineUserId: string; reason?: string }) =>
      apiService.disableAiForLineUser(lineUserId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: lineUsersKeys.all });
    },
  });
}

/**
 * Hook to enable AI for a LINE user
 */
export function useEnableAiForLineUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (lineUserId: string) => apiService.enableAiForLineUser(lineUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: lineUsersKeys.all });
    },
  });
}

