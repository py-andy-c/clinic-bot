import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { Clinic, ClinicHealth, PractitionerWithDetails, ClinicCreateData } from '../types';

/**
 * Query key factory for clinics queries
 */
export const clinicsKeys = {
  all: ['clinics'] as const,
  lists: () => [...clinicsKeys.all, 'list'] as const,
  list: () => [...clinicsKeys.lists()] as const,
  details: () => [...clinicsKeys.all, 'detail'] as const,
  detail: (id: number) => [...clinicsKeys.details(), id] as const,
  health: (id: number) => [...clinicsKeys.detail(id), 'health'] as const,
  practitioners: (id: number) => [...clinicsKeys.detail(id), 'practitioners'] as const,
};

export interface ClinicDetailsData {
  clinic: Clinic;
  health: ClinicHealth;
  practitioners?: PractitionerWithDetails[];
}

/**
 * Hook to fetch all clinics (system admin only)
 */
export function useClinics(enabled: boolean = true) {
  return useQuery<Clinic[]>({
    queryKey: clinicsKeys.list(),
    queryFn: () => apiService.getClinics(),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    initialData: [],
  });
}

/**
 * Hook to fetch clinic details (clinic, health, practitioners)
 */
export function useClinicDetails(clinicId: number | undefined, enabled: boolean = true) {
  return useQuery<ClinicDetailsData>({
    queryKey: clinicsKeys.detail(clinicId ?? 0),
    queryFn: async () => {
      if (!clinicId) {
        throw new Error('Clinic ID is required');
      }
      const [clinicData, healthData, practitionersData] = await Promise.all([
        apiService.getClinicDetails(clinicId),
        apiService.getClinicHealth(clinicId),
        apiService.getClinicPractitioners(clinicId).catch(() => ({ practitioners: [] })),
      ]);
      return {
        clinic: clinicData,
        health: healthData,
        practitioners: practitionersData.practitioners || [],
      };
    },
    enabled: enabled && !!clinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to create a new clinic
 */
export function useCreateClinic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (clinicData: ClinicCreateData) => apiService.createClinic(clinicData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clinicsKeys.list() });
    },
  });
}

/**
 * Hook to update a clinic
 */
export function useUpdateClinic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clinicId, data }: { clinicId: number; data: Partial<ClinicCreateData> }) =>
      apiService.updateClinic(clinicId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: clinicsKeys.list() });
      queryClient.invalidateQueries({ queryKey: clinicsKeys.detail(variables.clinicId) });
    },
  });
}

