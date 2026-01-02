import { useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useAuth } from './useAuth';

/**
 * Query key factory for patient appointments queries
 */
export const patientAppointmentsKeys = {
  all: ['patientAppointments'] as const,
  list: (patientId: number, clinicId?: number) => [...patientAppointmentsKeys.all, 'list', patientId, clinicId] as const,
};

/**
 * Hook to fetch appointments for a specific patient
 * Returns the raw API response type
 */
export function usePatientAppointments(patientId: number | undefined, enabled: boolean = true) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: patientAppointmentsKeys.list(patientId ?? 0, activeClinicId ?? undefined),
    queryFn: () => {
      if (!patientId) {
        throw new Error('Patient ID is required');
      }
      return apiService.getPatientAppointments(patientId);
    },
    enabled: enabled && !isLoading && isAuthenticated && !!patientId && !!activeClinicId,
    staleTime: 1 * 60 * 1000, // 1 minute (appointments change frequently)
    initialData: { appointments: [] },
  });
}

