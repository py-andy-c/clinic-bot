import { useQuery } from '@tanstack/react-query';
import { AppointmentType } from '../../types';
import { liffApiService } from '../../services/liffApi';
import { useAppointmentStore } from '../../stores/appointmentStore';

interface AppointmentTypesResponse {
  appointment_types: Array<{
    id: number;
    name: string;
    duration_minutes: number;
    receipt_name?: string;
    allow_patient_booking?: boolean;
    allow_new_patient_booking?: boolean;
    allow_existing_patient_booking?: boolean;
    allow_patient_practitioner_selection?: boolean;
    description?: string;
    scheduling_buffer_minutes?: number;
  }>;
  appointment_type_instructions?: string;
}

/**
 * Hook for fetching appointment types with patient-based filtering using React Query
 * @param patientId - Optional patient ID for filtering (null for new patients, specific ID for existing patients)
 * @returns Object with appointment types data, loading state, and error state
 */
export const useAppointmentTypes = (patientId?: number | null) => {
  const { clinicId } = useAppointmentStore();

  return useQuery({
    queryKey: ['appointmentTypes', clinicId, patientId],
    queryFn: async () => {
      if (!clinicId) {
        throw new Error('Clinic ID is required');
      }

      const response: AppointmentTypesResponse = await liffApiService.getAppointmentTypes(clinicId, patientId || undefined);

      // Map API response to AppointmentType (API returns subset, we add clinic_id)
      const appointmentTypes: AppointmentType[] = response.appointment_types.map(type => ({
        ...type,
        clinic_id: clinicId,
        is_deleted: false,
      }));

      return {
        appointmentTypes,
        appointmentTypeInstructions: response.appointment_type_instructions || null,
      };
    },
    enabled: !!clinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
