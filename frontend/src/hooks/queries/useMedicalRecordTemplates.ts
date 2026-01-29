import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';
import { MedicalRecordTemplate } from '../../types';

export const useMedicalRecordTemplates = (enabled: boolean = true, includeInactive: boolean = false) => {
    const { user, isAuthenticated, isLoading: authLoading } = useAuth();
    const activeClinicId = user?.active_clinic_id;

    return useQuery({
        queryKey: ['medical-record-templates', activeClinicId, includeInactive],
        queryFn: () => apiService.listMedicalRecordTemplates(includeInactive),
        enabled: enabled && !authLoading && isAuthenticated && !!activeClinicId,
    });
};

export const useMedicalRecordTemplateMutations = () => {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const activeClinicId = user?.active_clinic_id;

    const createMutation = useMutation({
        mutationFn: (data: Partial<MedicalRecordTemplate>) =>
            apiService.createMedicalRecordTemplate(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['medical-record-templates', activeClinicId] });
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: number; data: Partial<MedicalRecordTemplate> }) =>
            apiService.updateMedicalRecordTemplate(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['medical-record-templates', activeClinicId] });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => apiService.deleteMedicalRecordTemplate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['medical-record-templates', activeClinicId] });
        },
    });

    return {
        createMutation,
        updateMutation,
        deleteMutation,
    };
};
