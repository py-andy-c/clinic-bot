import { useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useAuth } from './useAuth';

/**
 * Query key factory for appointments queries
 */
export const appointmentsKeys = {
  all: ['appointments'] as const,
  autoAssigned: (clinicId?: number) => [...appointmentsKeys.all, 'autoAssigned', clinicId] as const,
};

/**
 * Hook to fetch auto-assigned appointments
 */
export function useAutoAssignedAppointments(enabled: boolean = true) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: appointmentsKeys.autoAssigned(activeClinicId ?? undefined),
    queryFn: () => apiService.getAutoAssignedAppointments(),
    enabled: enabled && !isLoading && isAuthenticated && !!activeClinicId,
    staleTime: 1 * 60 * 1000, // 1 minute (more frequent updates for pending appointments)
  });
}

