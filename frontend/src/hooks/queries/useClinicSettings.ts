import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

/**
 * Hook for fetching clinic settings using React Query
 * Used by CalendarView component for appointment types and other clinic settings
 */
export const useClinicSettings = (enabled: boolean = true) => {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['clinicSettings', activeClinicId],
    queryFn: () => apiService.getClinicSettings(),
    enabled: enabled && !authLoading && isAuthenticated && !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes (matches current cache TTL)
  });
};
