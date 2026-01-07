import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';

export const useSystemClinics = () => {
  return useQuery({
    queryKey: ['system-clinics'],
    queryFn: () => apiService.getClinics(),
    staleTime: 15 * 60 * 1000, // 15 minutes (system admin data)
  });
};
