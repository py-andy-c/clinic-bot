import { useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useAuth } from './useAuth';

/**
 * Query key factory for practitioners queries
 */
export const practitionersKeys = {
  all: ['practitioners'] as const,
  lists: () => [...practitionersKeys.all, 'list'] as const,
  list: (appointmentTypeId?: number, clinicId?: number) => 
    [...practitionersKeys.lists(), appointmentTypeId, clinicId] as const,
};

/**
 * Hook to fetch practitioners list
 * 
 * Automatically includes clinic ID in query key for proper cache separation
 * when users switch between clinics.
 * 
 * @param appointmentTypeId - Optional appointment type ID to filter practitioners
 * @param enabled - Whether the query should run (default: true)
 */
export function usePractitioners(appointmentTypeId?: number, enabled: boolean = true) {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: practitionersKeys.list(appointmentTypeId, activeClinicId ?? undefined),
    queryFn: () => apiService.getPractitioners(appointmentTypeId),
    enabled: enabled && !!activeClinicId, // Only fetch if clinic is selected
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

