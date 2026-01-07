import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

interface RevenueDistributionParams {
  start_date: string;
  end_date: string;
  show_overwritten_only?: boolean;
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  practitioner_id?: number | 'null' | null;
  service_item_id?: number | string | null;
  service_type_group_id?: number | string | null;
}

/**
 * Hook for fetching revenue distribution data using React Query
 * Used by RevenueDistributionPage for analytics
 */
export const useRevenueDistribution = (params: RevenueDistributionParams) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['revenueDistribution', activeClinicId, params],
    queryFn: () => apiService.getRevenueDistribution(params),
    enabled: !!activeClinicId,
    staleTime: 15 * 60 * 1000, // 15 minutes (analytics data)
  });
};
