import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../services/api';
import {
  MedicalRecordTemplateCreateRequest,
  MedicalRecordTemplateUpdateRequest,
} from '../types/medicalRecord';
import { logger } from '../utils/logger';

// Query keys
export const medicalRecordTemplateKeys = {
  all: (clinicId: number | null) => ['medical-record-templates', clinicId] as const,
  lists: (clinicId: number | null) => [...medicalRecordTemplateKeys.all(clinicId), 'list'] as const,
  list: (clinicId: number | null, filters?: Record<string, any>) => 
    [...medicalRecordTemplateKeys.lists(clinicId), filters] as const,
  details: (clinicId: number | null) => [...medicalRecordTemplateKeys.all(clinicId), 'detail'] as const,
  detail: (clinicId: number | null, id: number) => 
    [...medicalRecordTemplateKeys.details(clinicId), id] as const,
};

/**
 * Hook to fetch list of medical record templates
 */
export function useMedicalRecordTemplates(clinicId: number | null | undefined) {
  return useQuery({
    queryKey: medicalRecordTemplateKeys.list(clinicId ?? null),
    queryFn: async () => {
      const response = await apiService.listMedicalRecordTemplates();
      return response.templates;
    },
    enabled: !!clinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch a single medical record template
 */
export function useMedicalRecordTemplate(clinicId: number | null, templateId: number | null | undefined) {
  return useQuery({
    queryKey: medicalRecordTemplateKeys.detail(clinicId, templateId!),
    queryFn: async () => {
      return await apiService.getMedicalRecordTemplate(templateId!);
    },
    enabled: !!clinicId && templateId !== null && templateId !== undefined,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to create a medical record template
 */
export function useCreateMedicalRecordTemplate(clinicId: number | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: MedicalRecordTemplateCreateRequest) => {
      return await apiService.createMedicalRecordTemplate(data);
    },
    onSuccess: () => {
      // Invalidate templates list
      queryClient.invalidateQueries({ 
        queryKey: medicalRecordTemplateKeys.lists(clinicId ?? null) 
      });
      logger.info('Medical record template created successfully');
    },
    onError: (error) => {
      logger.error('Failed to create medical record template:', error);
    },
  });
}

/**
 * Hook to update a medical record template
 */
export function useUpdateMedicalRecordTemplate(clinicId: number | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      templateId, 
      data 
    }: { 
      templateId: number; 
      data: MedicalRecordTemplateUpdateRequest 
    }) => {
      return await apiService.updateMedicalRecordTemplate(templateId, data);
    },
    onSuccess: (updatedTemplate) => {
      // Invalidate both list and detail queries
      queryClient.invalidateQueries({ 
        queryKey: medicalRecordTemplateKeys.lists(clinicId ?? null) 
      });
      queryClient.invalidateQueries({ 
        queryKey: medicalRecordTemplateKeys.detail(clinicId ?? null, updatedTemplate.id) 
      });
      logger.info('Medical record template updated successfully');
    },
    onError: (error) => {
      logger.error('Failed to update medical record template:', error);
    },
  });
}

/**
 * Hook to delete a medical record template
 */
export function useDeleteMedicalRecordTemplate(clinicId: number | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateId: number) => {
      return await apiService.deleteMedicalRecordTemplate(templateId);
    },
    onSuccess: () => {
      // Invalidate templates list
      queryClient.invalidateQueries({ 
        queryKey: medicalRecordTemplateKeys.lists(clinicId ?? null) 
      });
      logger.info('Medical record template deleted successfully');
    },
    onError: (error) => {
      logger.error('Failed to delete medical record template:', error);
    },
  });
}
