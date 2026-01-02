import { useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useAuth } from './useAuth';

/**
 * Query key factory for dashboard queries
 */
export const dashboardKeys = {
  all: ['dashboard'] as const,
  metrics: (clinicId?: number) => [...dashboardKeys.all, 'metrics', clinicId] as const,
  businessInsights: (params: {
    startDate: string;
    endDate: string;
    practitionerId?: number | string | null;
    serviceItemId?: number | string | null;
    serviceTypeGroupId?: number | string | null;
    clinicId?: number;
  }) => [...dashboardKeys.all, 'businessInsights', params] as const,
  revenueDistribution: (params: {
    startDate: string;
    endDate: string;
    practitionerId?: number | string | null;
    serviceItemId?: number | string | null;
    serviceTypeGroupId?: number | string | null;
    showOverwrittenOnly?: boolean;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    clinicId?: number;
  }) => [...dashboardKeys.all, 'revenueDistribution', params] as const,
};

/**
 * Hook to fetch dashboard metrics
 */
export function useDashboardMetrics(enabled: boolean = true) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: dashboardKeys.metrics(activeClinicId ?? undefined),
    queryFn: () => apiService.getDashboardMetrics(),
    enabled: enabled && !isLoading && isAuthenticated && !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch business insights
 */
export function useBusinessInsights(params: {
  startDate: string;
  endDate: string;
  practitionerId?: number | string | null;
  serviceItemId?: number | string | null;
  serviceTypeGroupId?: number | string | null;
  enabled?: boolean;
}) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { startDate, endDate, practitionerId, serviceItemId, serviceTypeGroupId, enabled = true } = params;

  return useQuery({
    queryKey: dashboardKeys.businessInsights({
      startDate,
      endDate,
      practitionerId: practitionerId ?? null,
      serviceItemId: serviceItemId ?? null,
      serviceTypeGroupId: serviceTypeGroupId ?? null,
      ...(activeClinicId !== undefined && activeClinicId !== null && { clinicId: activeClinicId }),
    }),
    queryFn: () => apiService.getBusinessInsights({
      start_date: startDate,
      end_date: endDate,
      ...(practitionerId !== undefined && practitionerId !== null && { practitioner_id: practitionerId }),
      ...(serviceItemId !== undefined && serviceItemId !== null && { service_item_id: serviceItemId }),
      ...(serviceTypeGroupId !== undefined && serviceTypeGroupId !== null && { service_type_group_id: serviceTypeGroupId }),
    }),
    enabled: enabled && !isLoading && isAuthenticated && !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch revenue distribution
 */
export function useRevenueDistribution(params: {
  startDate: string;
  endDate: string;
  practitionerId?: number | string | null;
  serviceItemId?: number | string | null;
  serviceTypeGroupId?: number | string | null;
  showOverwrittenOnly?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  enabled?: boolean;
}) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const {
    startDate,
    endDate,
    practitionerId,
    serviceItemId,
    serviceTypeGroupId,
    showOverwrittenOnly,
    page,
    pageSize,
    sortBy,
    sortOrder,
    enabled = true,
  } = params;

  return useQuery({
    queryKey: dashboardKeys.revenueDistribution({
      startDate,
      endDate,
      practitionerId: practitionerId ?? null,
      serviceItemId: serviceItemId ?? null,
      serviceTypeGroupId: serviceTypeGroupId ?? null,
      ...(showOverwrittenOnly !== undefined && { showOverwrittenOnly }),
      ...(page !== undefined && { page }),
      ...(pageSize !== undefined && { pageSize }),
      ...(sortBy !== undefined && { sortBy }),
      ...(sortOrder !== undefined && { sortOrder }),
      ...(activeClinicId !== undefined && activeClinicId !== null && { clinicId: activeClinicId }),
    }),
    queryFn: () => apiService.getRevenueDistribution({
      start_date: startDate,
      end_date: endDate,
      ...(practitionerId !== undefined && practitionerId !== null && { practitioner_id: practitionerId }),
      ...(serviceItemId !== undefined && serviceItemId !== null && { service_item_id: serviceItemId }),
      ...(serviceTypeGroupId !== undefined && serviceTypeGroupId !== null && { service_type_group_id: serviceTypeGroupId }),
      ...(showOverwrittenOnly !== undefined && { show_overwritten_only: showOverwrittenOnly }),
      ...(page !== undefined && { page }),
      ...(pageSize !== undefined && { page_size: pageSize }),
      ...(sortBy !== undefined && { sort_by: sortBy }),
      ...(sortOrder !== undefined && { sort_order: sortOrder }),
    }),
    enabled: enabled && !isLoading && isAuthenticated && !!activeClinicId,
    staleTime: 2 * 60 * 1000, // 2 minutes (more frequent for revenue data)
  });
}


