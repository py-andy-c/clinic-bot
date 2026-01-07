import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

export interface LineUsersResponse {
  line_users: any[]; // Using any[] since LineUserWithStatus type may not be available
  total: number;
  page: number;
  page_size: number;
}

export const useLineUsers = (page?: number, pageSize?: number, search?: string) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['line-users', activeClinicId, page, pageSize, search],
    queryFn: () => apiService.getLineUsers(page, pageSize, undefined, search),
    enabled: !!activeClinicId,
    staleTime: 10 * 60 * 1000, // 10 minutes (less frequent updates)
  });
};
