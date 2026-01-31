import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';

export const medicalRecordKeys = {
    all: ['medical-records'] as const,
    lists: () => [...medicalRecordKeys.all, 'list'] as const,
    list: (patientId: number) => [...medicalRecordKeys.lists(), { patientId }] as const,
    details: () => [...medicalRecordKeys.all, 'detail'] as const,
    detail: (recordId: number) => [...medicalRecordKeys.details(), recordId] as const,
};

export const usePatientMedicalRecords = (patientId?: number) => {
    return useQuery({
        queryKey: medicalRecordKeys.list(patientId!),
        queryFn: () => apiService.listPatientMedicalRecords(patientId!),
        enabled: !!patientId,
    });
};

export const useMedicalRecord = (recordId?: number) => {
    return useQuery({
        queryKey: medicalRecordKeys.detail(recordId!),
        queryFn: () => apiService.getMedicalRecord(recordId!),
        enabled: !!recordId,
    });
};

export const useCreateMedicalRecord = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ patientId, templateId }: { patientId: number; templateId: number }) =>
            apiService.createMedicalRecord(patientId, templateId),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: medicalRecordKeys.list(data.patient_id) });
        },
    });
};

export const useUpdateMedicalRecord = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ recordId, data }: { recordId: number; data: Parameters<typeof apiService.updateMedicalRecord>[1] }) =>
            apiService.updateMedicalRecord(recordId, data),
        onSuccess: (data) => {
            // Update the detail cache immediately to avoid flickers and redundant refetches
            queryClient.setQueryData(medicalRecordKeys.detail(data.id), data);
            
            // Still invalidate lists to ensure they are updated in the background
            queryClient.invalidateQueries({ queryKey: medicalRecordKeys.list(data.patient_id) });
        },
    });
};

export const useDeleteMedicalRecord = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ recordId }: { recordId: number; patientId: number }) =>
            apiService.deleteMedicalRecord(recordId),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: medicalRecordKeys.list(variables.patientId) });
        },
    });
};
