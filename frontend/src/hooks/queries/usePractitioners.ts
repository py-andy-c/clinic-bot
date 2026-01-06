import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

export const usePractitioners = () => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['practitioners', activeClinicId],
    queryFn: () => apiService.getPractitioners(),
    enabled: !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
