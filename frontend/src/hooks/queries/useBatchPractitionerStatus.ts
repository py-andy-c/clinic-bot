import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';

export const useBatchPractitionerStatus = (practitionerIds: number[]) => {
  return useQuery({
    queryKey: ['batch-practitioner-status', practitionerIds.sort().join(',')],
    queryFn: () => apiService.getBatchPractitionerStatus(practitionerIds),
    enabled: practitionerIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
