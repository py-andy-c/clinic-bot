import { useQueries } from '@tanstack/react-query';
import { apiService } from '../../services/api';

export interface ClinicDetailsData {
  clinic: any; // Clinic type
  health: any; // ClinicHealth type
  practitioners: any[]; // PractitionerWithDetails[]
}

export const useClinicDetails = (clinicId: number | undefined) => {
  const queries = useQueries({
    queries: [
      {
        queryKey: ['clinic-details', clinicId],
        queryFn: () => apiService.getClinicDetails(clinicId!),
        enabled: !!clinicId,
        staleTime: 5 * 60 * 1000, // 5 minutes
      },
      {
        queryKey: ['clinic-health', clinicId],
        queryFn: () => apiService.getClinicHealth(clinicId!),
        enabled: !!clinicId,
        staleTime: 5 * 60 * 1000, // 5 minutes
      },
      {
        queryKey: ['clinic-practitioners', clinicId],
        queryFn: () => apiService.getClinicPractitioners(clinicId!),
        enabled: !!clinicId,
        staleTime: 5 * 60 * 1000, // 5 minutes
      },
    ],
  });

  const [clinicQuery, healthQuery, practitionersQuery] = queries;

  const isLoading = clinicQuery.isLoading || healthQuery.isLoading || practitionersQuery.isLoading;
  const error = clinicQuery.error || healthQuery.error || practitionersQuery.error;

  // Combine the data when all queries succeed
  const data: ClinicDetailsData | undefined =
    clinicQuery.data && healthQuery.data && practitionersQuery.data !== undefined
      ? {
          clinic: clinicQuery.data,
          health: healthQuery.data,
          practitioners: practitionersQuery.data?.practitioners || [],
        }
      : undefined;

  const refetch = () => {
    clinicQuery.refetch();
    healthQuery.refetch();
    practitionersQuery.refetch();
  };

  return {
    data,
    isLoading,
    error,
    refetch,
  };
};
