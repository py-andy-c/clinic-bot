import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { PatientPhotoUpdateRequest } from '../types/medicalRecord';
import { logger } from '../utils/logger';

// Query key factory
export const patientPhotoKeys = {
  all: (clinicId: number | null) => ['patient-photos', clinicId] as const,
  patient: (clinicId: number | null, patientId: number, options?: any) =>
    ['patient-photos', clinicId, 'patient', patientId, options || {}] as const,
  record: (clinicId: number | null, recordId: number) =>
    ['patient-photos', clinicId, 'record', recordId] as const,
};

// List patient's photos
export function usePatientPhotos(
  clinicId: number | null,
  patientId: number | null,
  options?: {
    medical_record_id?: number;
    unlinked_only?: boolean;
  }
) {
  return useQuery({
    queryKey: patientPhotoKeys.patient(clinicId, patientId!, options),
    queryFn: async () => {
      if (!patientId) throw new Error('Patient ID required');
      return apiService.listPatientPhotos(patientId, options);
    },
    enabled: !!clinicId && !!patientId,
    staleTime: 1 * 60 * 1000, // 1 minute
  });
}

// Upload patient photo
export function useUploadPatientPhoto(clinicId: number | null, patientId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      file: File;
      description?: string;
      medical_record_id?: number;
      is_pending?: boolean;
      onUploadProgress?: (progressEvent: any) => void;
    }) => {
      const options: {
        description?: string;
        medical_record_id?: number;
        is_pending?: boolean;
        onUploadProgress?: (progressEvent: any) => void;
      } = {};

      if (params.description !== undefined) options.description = params.description;
      if (params.medical_record_id !== undefined) options.medical_record_id = params.medical_record_id;
      if (params.is_pending !== undefined) options.is_pending = params.is_pending;
      if (params.onUploadProgress !== undefined) options.onUploadProgress = params.onUploadProgress;

      return apiService.uploadPatientPhoto(patientId, params.file, options);
    },
    onSuccess: () => {
      // Invalidate patient's photos list
      queryClient.invalidateQueries({
        queryKey: patientPhotoKeys.patient(clinicId, patientId),
      });
      logger.info('Photo uploaded successfully');
    },
    onError: (error) => {
      logger.error('Failed to upload photo:', error);
    },
  });
}

// Update patient photo
export function useUpdatePatientPhoto(clinicId: number | null, patientId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ photoId, data }: { photoId: number; data: PatientPhotoUpdateRequest }) => {
      return apiService.updatePatientPhoto(photoId, data);
    },
    onSuccess: () => {
      // Invalidate patient's photos list
      queryClient.invalidateQueries({
        queryKey: patientPhotoKeys.patient(clinicId, patientId),
      });
      logger.info('Photo updated successfully');
    },
    onError: (error) => {
      logger.error('Failed to update photo:', error);
    },
  });
}

// Delete patient photo
export function useDeletePatientPhoto(clinicId: number | null, patientId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (photoId: number) => {
      return apiService.deletePatientPhoto(photoId);
    },
    onSuccess: () => {
      // Invalidate patient's photos list
      queryClient.invalidateQueries({
        queryKey: patientPhotoKeys.patient(clinicId, patientId),
      });
      logger.info('Photo deleted successfully');
    },
    onError: (error) => {
      logger.error('Failed to delete photo:', error);
    },
  });
}

// Attach photos to record
export function useAttachPhotosToRecord(clinicId: number | null, patientId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ recordId, photoIds }: { recordId: number; photoIds: number[] }) => {
      return apiService.attachPhotosToRecord(recordId, photoIds);
    },
    onSuccess: () => {
      // Invalidate patient's photos list
      queryClient.invalidateQueries({
        queryKey: patientPhotoKeys.patient(clinicId, patientId),
      });
      logger.info('Photos attached to record successfully');
    },
    onError: (error) => {
      logger.error('Failed to attach photos to record:', error);
    },
  });
}
