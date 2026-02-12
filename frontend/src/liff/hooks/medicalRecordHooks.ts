import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { liffApiService, UpdatePatientMedicalRecordRequest } from '../../services/liffApi';
import { logger } from '../../utils/logger';

/**
 * Query keys for LIFF medical record related queries.
 */
export const liffMedicalRecordKeys = {
    all: () => ['liff-medical-records'] as const,
    detail: (recordId: number) => ['liff-medical-records', recordId] as const,
    photos: (patientId: number, recordId?: number) => ['liff-patient-photos', patientId, recordId] as const,
};

/**
 * Hook to fetch a medical record for the patient in LIFF.
 * @param recordId - The ID of the medical record to fetch.
 */
export function useLiffMedicalRecord(recordId: number | null) {
    return useQuery({
        queryKey: liffMedicalRecordKeys.detail(recordId!),
        queryFn: () => {
            if (!recordId) throw new Error('Record ID required');
            return liffApiService.getMedicalRecord(recordId);
        },
        enabled: !!recordId,
    });
}

/**
 * Hook to update a medical record from LIFF.
 * Handles automatic cache invalidation on success.
 */
export function useLiffUpdateMedicalRecord() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ recordId, data }: { recordId: number; data: UpdatePatientMedicalRecordRequest }) =>
            liffApiService.updateMedicalRecord(recordId, data),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: liffMedicalRecordKeys.detail(data.id) });
        },
        onError: (error) => {
            logger.error('Failed to update medical record:', error);
        },
    });
}

/**
 * Hook to upload a photo for a patient from LIFF.
 * @param patientId - The ID of the patient uploading the photo.
 */
export function useLiffUploadPatientPhoto(patientId: number) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ file, medicalRecordId, description, onUploadProgress }: { file: File; medicalRecordId?: number; description?: string; onUploadProgress?: (event: any) => void }) => {
            const options: { description?: string; onUploadProgress?: (event: any) => void } = {};
            if (description) options.description = description;
            if (onUploadProgress) options.onUploadProgress = onUploadProgress;
            return liffApiService.uploadPatientPhoto(patientId, file, medicalRecordId, options);
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: liffMedicalRecordKeys.photos(patientId, variables.medicalRecordId) });
        },
    });
}

/**
 * Hook to update a patient photo description from LIFF.
 * @param patientId - The ID of the patient.
 * @param recordId - The ID of the medical record.
 */
export function useLiffUpdatePatientPhoto(patientId: number, recordId?: number) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ photoId, data }: { photoId: number; data: { description?: string; medical_record_id?: number } }) => {
            return liffApiService.updatePatientPhoto(photoId, data);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: liffMedicalRecordKeys.photos(patientId, recordId) });
        },
    });
}

/**
 * Hook to delete a patient photo from LIFF.
 * @param patientId - The ID of the patient who owns the photo.
 * @param recordId - Optional medical record ID to invalidate related photo queries.
 */
export function useLiffDeletePatientPhoto(patientId: number, recordId?: number) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (photoId: number) => liffApiService.deletePatientPhoto(photoId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: liffMedicalRecordKeys.photos(patientId, recordId) });
        },
    });
}
