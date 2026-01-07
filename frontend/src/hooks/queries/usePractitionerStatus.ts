import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';

export const usePractitionerStatus = (userId: number | undefined) => {
  return useQuery({
    queryKey: ['practitioner-status', userId],
    queryFn: () => apiService.getPractitionerStatus(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
