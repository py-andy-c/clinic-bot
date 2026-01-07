import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

interface BusinessInsightsParams {
  start_date: string;
  end_date: string;
  practitioner_id?: number | 'null' | null;
  service_item_id?: number | string | null;
  service_type_group_id?: number | string | null;
}

/**
 * Hook for fetching business insights data using React Query
 * Used by BusinessInsightsPage for analytics
 */
export const useBusinessInsights = (params: BusinessInsightsParams) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['businessInsights', activeClinicId, params],
    queryFn: () => apiService.getBusinessInsights(params),
    enabled: !!activeClinicId,
    staleTime: 15 * 60 * 1000, // 15 minutes (analytics data)
  });
};
