import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

export const usePatientDetail = (patientId: number | undefined) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['patient', activeClinicId, patientId],
    queryFn: () => apiService.getPatient(patientId!),
    enabled: !!activeClinicId && !!patientId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
