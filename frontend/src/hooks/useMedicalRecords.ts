import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../services/api';
import {
  MedicalRecordCreateRequest,
  MedicalRecordUpdateRequest,
} from '../types/medicalRecord';
import { logger } from '../utils/logger';

// Query key factory
export const medicalRecordKeys = {
  all: (clinicId: number | null) => ['medical-records', clinicId] as const,
  patient: (clinicId: number | null, patientId: number) =>
    ['medical-records', clinicId, 'patient', patientId] as const,
  detail: (clinicId: number | null, recordId: number) =>
    ['medical-record', clinicId, recordId] as const,
};

// List patient's medical records
export function usePatientMedicalRecords(
  clinicId: number | null,
  patientId: number | null,
  options?: {
    /** @deprecated Use status: 'all' instead */
    include_deleted?: boolean;
    appointment_id?: number;
    status?: 'active' | 'deleted' | 'all'
  },
  queryOptions?: { enabled?: boolean }
) {
  // Determine cache key suffix based on status (deprecated include_deleted mapping)
  let statusKey = options?.status;
  if (!statusKey && options?.include_deleted !== undefined) {
    statusKey = options.include_deleted ? 'all' : 'active';
  }
  statusKey = statusKey || 'active';

  return useQuery({
    queryKey: options?.appointment_id
      ? [...medicalRecordKeys.patient(clinicId, patientId!), 'appointment', options.appointment_id, statusKey] as const
      : [...medicalRecordKeys.patient(clinicId, patientId!), statusKey] as const,
    queryFn: async () => {
      if (!patientId) throw new Error('Patient ID required');
      return apiService.listPatientMedicalRecords(patientId, options);
    },
    enabled: (queryOptions?.enabled ?? true) && !!clinicId && !!patientId,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// Get single medical record
export function useMedicalRecord(clinicId: number | null, recordId: number | null) {
  return useQuery({
    queryKey: medicalRecordKeys.detail(clinicId, recordId!),
    queryFn: async () => {
      if (!recordId) throw new Error('Record ID required');
      return apiService.getMedicalRecord(recordId);
    },
    enabled: !!clinicId && !!recordId,
    staleTime: 1 * 60 * 1000,
  });
}

// Create medical record
export function useCreateMedicalRecord(clinicId: number | null, patientId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: MedicalRecordCreateRequest) => {
      return apiService.createMedicalRecord(patientId, data);
    },
    onSuccess: () => {
      // Invalidate patient's records list
      queryClient.invalidateQueries({
        queryKey: medicalRecordKeys.patient(clinicId, patientId),
      });
      logger.info('Medical record created successfully');
    },
    onError: (error) => {
      logger.error('Failed to create medical record:', error);
    },
  });
}

// Update medical record
export function useUpdateMedicalRecord(clinicId: number | null, patientId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ recordId, data }: { recordId: number; data: MedicalRecordUpdateRequest }) => {
      return apiService.updateMedicalRecord(recordId, data);
    },
    onSuccess: (updatedRecord) => {
      // Invalidate both the detail and list queries
      queryClient.invalidateQueries({
        queryKey: medicalRecordKeys.detail(clinicId, updatedRecord.id),
      });
      queryClient.invalidateQueries({
        queryKey: medicalRecordKeys.patient(clinicId, patientId),
      });
      logger.info('Medical record updated successfully');
    },
    onError: (error) => {
      logger.error('Failed to update medical record:', error);
    },
  });
}

// Delete medical record (soft delete)
export function useDeleteMedicalRecord(clinicId: number | null, patientId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordId: number) => {
      return apiService.deleteMedicalRecord(recordId);
    },
    onSuccess: () => {
      // Invalidate all queries for this patient's medical records
      queryClient.invalidateQueries({
        queryKey: medicalRecordKeys.patient(clinicId, patientId),
      });
    },
    onError: (error) => {
      logger.error('Failed to delete medical record:', error);
    },
  });
}

// Restore medical record
export function useRestoreMedicalRecord(clinicId: number | null, patientId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordId: number) => {
      return apiService.restoreMedicalRecord(recordId);
    },
    onSuccess: () => {
      // Invalidate patient's records list
      queryClient.invalidateQueries({
        queryKey: medicalRecordKeys.patient(clinicId, patientId),
      });
      logger.info('Medical record restored successfully');
    },
    onError: (error) => {
      logger.error('Failed to restore medical record:', error);
    },
  });
}

// Hard delete medical record
export function useHardDeleteMedicalRecord(clinicId: number | null, patientId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recordId: number) => {
      return apiService.hardDeleteMedicalRecord(recordId);
    },
    onSuccess: () => {
      // Invalidate patient's records list
      queryClient.invalidateQueries({
        queryKey: medicalRecordKeys.patient(clinicId, patientId),
      });
      logger.info('Medical record permanently deleted');
    },
    onError: (error) => {
      logger.error('Failed to permanently delete medical record:', error);
    },
  });
}

// Send patient form
export function useSendPatientForm(clinicId: number | null, patientId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: import('../types/medicalRecord').SendPatientFormRequest) => {
      return apiService.sendPatientForm(patientId, data);
    },
    onSuccess: (newRecord) => {
      // Invalidate the main patient records list (active, with-deleted, etc.)
      // React Query's invalidateQueries with queryKey automatically invalidates all queries 
      // that start with that key prefix.
      queryClient.invalidateQueries({
        queryKey: medicalRecordKeys.patient(clinicId, patientId),
      });

      // If associated with an appointment, specifically invalidate that list too
      if (newRecord.appointment_id) {
        queryClient.invalidateQueries({
          queryKey: [...medicalRecordKeys.patient(clinicId, patientId), 'appointment', newRecord.appointment_id],
        });
      }

      logger.info('Patient form sent successfully');
    },
    onError: (error) => {
      logger.error('Failed to send patient form:', error);
    },
  });
}
