import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';
import { Patient } from '../../types';

export interface PatientsResponse {
  patients: Patient[];
  total: number;
  page: number;
  page_size: number;
}

export const usePatients = (page?: number, pageSize?: number, search?: string, practitionerId?: number) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['patients', activeClinicId, page, pageSize, search, practitionerId],
    queryFn: () => apiService.getPatients(page, pageSize, undefined, search, practitionerId),
    enabled: !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
