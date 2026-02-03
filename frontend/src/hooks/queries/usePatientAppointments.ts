import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

export const usePatientAppointments = (
  patientId: number | undefined,
  options: { enabled?: boolean } = {}
) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['patient-appointments', activeClinicId, patientId],
    queryFn: () => apiService.getPatientAppointments(patientId!),
    enabled: (options.enabled ?? true) && !!activeClinicId && !!patientId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
