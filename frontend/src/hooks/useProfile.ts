import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useAuth } from './useAuth';

/**
 * Query key factory for profile queries
 */
export const profileKeys = {
  all: ['profile'] as const,
  detail: (userId?: number) => [...profileKeys.all, userId] as const,
};

/**
 * Hook to fetch user profile
 */
export function useProfile(enabled: boolean = true) {
  const { user } = useAuth();
  const userId = user?.user_id;

  return useQuery({
    queryKey: profileKeys.detail(userId),
    queryFn: () => apiService.getProfile(),
    enabled: enabled && !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to update user profile
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.user_id;

  return useMutation({
    mutationFn: (profileData: { full_name?: string; settings?: { compact_schedule_enabled?: boolean } }) =>
      apiService.updateProfile(profileData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.detail(userId) });
    },
  });
}

