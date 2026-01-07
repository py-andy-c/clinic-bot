import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

/**
 * Hook for fetching LINE usage dashboard metrics using React Query
 * Used by LineUsagePage for analytics
 */
export const useLineUsage = () => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['lineUsage', activeClinicId],
    queryFn: () => apiService.getDashboardMetrics(),
    enabled: !!activeClinicId,
    staleTime: 15 * 60 * 1000, // 15 minutes (analytics data)
  });
};
