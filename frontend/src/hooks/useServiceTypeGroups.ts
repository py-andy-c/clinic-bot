import { useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useAuth } from './useAuth';

/**
 * Query key factory for service type groups queries
 */
export const serviceTypeGroupsKeys = {
  all: ['serviceTypeGroups'] as const,
  list: (clinicId?: number) => [...serviceTypeGroupsKeys.all, 'list', clinicId] as const,
};

/**
 * Hook to fetch service type groups
 * 
 * Automatically includes clinic ID in query key for proper cache separation
 * when users switch between clinics.
 */
export function useServiceTypeGroups(enabled: boolean = true) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: serviceTypeGroupsKeys.list(activeClinicId ?? undefined),
    queryFn: () => apiService.getServiceTypeGroups(),
    enabled: enabled && !isLoading && isAuthenticated && !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

