import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useAuth } from './useAuth';
import { Patient } from '../types';

/**
 * Query key factory for patients queries
 */
export const patientsKeys = {
  all: ['patients'] as const,
  lists: () => [...patientsKeys.all, 'list'] as const,
  list: (params: {
    page?: number;
    pageSize?: number;
    search?: string;
    practitionerId?: number;
    clinicId?: number;
  }) => [...patientsKeys.lists(), params] as const,
  details: () => [...patientsKeys.all, 'detail'] as const,
  detail: (id: number, clinicId?: number) => 
    [...patientsKeys.details(), id, clinicId] as const,
};

interface UsePatientsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  practitionerId?: number;
  enabled?: boolean;
}

/**
 * Hook to fetch patients list with pagination and filtering
 * 
 * Automatically includes clinic ID in query key for proper cache separation
 * when users switch between clinics.
 * 
 * @param params - Query parameters (page, pageSize, search, practitionerId)
 * @param enabled - Whether the query should run (default: true)
 */
export function usePatients(params: UsePatientsParams = {}) {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { page, pageSize, search, practitionerId, enabled = true } = params;

  return useQuery({
    queryKey: patientsKeys.list({
      ...(page !== undefined && { page }),
      ...(pageSize !== undefined && { pageSize }),
      ...(search !== undefined && { search }),
      ...(practitionerId !== undefined && { practitionerId }),
      ...(activeClinicId !== undefined && activeClinicId !== null && { clinicId: activeClinicId }),
    }),
    queryFn: () => apiService.getPatients(page, pageSize, undefined, search, practitionerId),
    enabled: enabled && !!activeClinicId, // Only fetch if clinic is selected
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch a single patient by ID
 * 
 * @param patientId - Patient ID to fetch
 * @param enabled - Whether the query should run (default: true)
 */
export function usePatient(patientId: number | undefined, enabled: boolean = true) {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery<Patient>({
    queryKey: patientsKeys.detail(patientId ?? 0, activeClinicId ?? undefined),
    queryFn: () => apiService.getPatient(patientId!),
    enabled: enabled && !!patientId && !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to update a patient
 */
export function useUpdatePatient() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useMutation({
    mutationFn: ({ patientId, data }: {
      patientId: number;
      data: {
        full_name?: string;
        phone_number?: string | null;
        birthday?: string;
        gender?: string;
        notes?: string | null;
        assigned_practitioner_ids?: number[];
      };
    }) => apiService.updatePatient(patientId, data),
    onSuccess: (_updatedPatient, variables) => {
      // Invalidate both detail and list queries
      queryClient.invalidateQueries({ queryKey: patientsKeys.detail(variables.patientId, activeClinicId ?? undefined) });
      queryClient.invalidateQueries({ queryKey: patientsKeys.lists() });
    },
  });
}

