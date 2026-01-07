import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';

export const useUserProfile = () => {
  return useQuery({
    queryKey: ['user-profile'],
    queryFn: () => apiService.getProfile(),
    staleTime: 30 * 60 * 1000, // 30 minutes (user profile changes rarely)
  });
};
