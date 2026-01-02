import { useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useAuth } from './useAuth';

/**
 * Query key factory for practitioner status queries
 */
export const practitionerStatusKeys = {
  all: ['practitionerStatus'] as const,
  detail: (userId: number, clinicId?: number) => [...practitionerStatusKeys.all, userId, clinicId] as const,
  batch: (practitionerIds: number[], clinicId?: number) => [...practitionerStatusKeys.all, 'batch', practitionerIds, clinicId] as const,
};

/**
 * Hook to fetch practitioner status for current user
 */
export function usePractitionerStatus(enabled: boolean = true) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const userId = user?.user_id;
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: practitionerStatusKeys.detail(userId ?? 0, activeClinicId ?? undefined),
    queryFn: () => {
      if (!userId) {
        throw new Error('No user ID');
      }
      return apiService.getPractitionerStatus(userId);
    },
    enabled: enabled && !isLoading && isAuthenticated && !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch batch practitioner status for multiple practitioners
 */
export function useBatchPractitionerStatus(practitionerIds: number[], enabled: boolean = true) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: practitionerStatusKeys.batch(practitionerIds, activeClinicId ?? undefined),
    queryFn: () => {
      if (practitionerIds.length === 0) {
        return Promise.resolve({ results: [] });
      }
      return apiService.getBatchPractitionerStatus(practitionerIds);
    },
    enabled: enabled && !isLoading && isAuthenticated && practitionerIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

