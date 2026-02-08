import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { liffApiService } from '../services/liffApi';

export const patientFormKeys = {
  all: (clinicId: number | null) => ['patient-forms', clinicId] as const,
  requests: (clinicId: number | null, patientId: number) => [...patientFormKeys.all(clinicId), 'requests', patientId] as const,
  liff: () => ['liff', 'patient-forms'] as const,
  liffDetail: (accessToken: string) => ['liff', 'patient-form', accessToken] as const,
};

export function usePatientFormRequests(clinicId: number | null, patientId: number) {
  return useQuery({
    queryKey: patientFormKeys.requests(clinicId, patientId),
    queryFn: async () => {
      const response = await apiService.getPatientFormRequests(patientId);
      return response.requests;
    },
    enabled: !!clinicId && !!patientId,
  });
}

export function useCreatePatientFormRequest(clinicId: number | null, patientId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      template_id: number;
      appointment_id?: number | null;
      message_template: string;
      flex_button_text?: string;
      notify_admin?: boolean;
      notify_appointment_practitioner?: boolean;
      notify_assigned_practitioner?: boolean;
    }) => apiService.createPatientFormRequest(patientId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientFormKeys.requests(clinicId, patientId) });
    },
  });
}

export function useLiffPatientForms() {
  return useQuery({
    queryKey: patientFormKeys.liff(),
    queryFn: () => liffApiService.getPatientForms().then(res => res.forms),
  });
}

export function useLiffPatientForm(accessToken: string | null) {
  return useQuery({
    queryKey: patientFormKeys.liffDetail(accessToken || ''),
    queryFn: () => liffApiService.getPatientForm(accessToken!),
    enabled: !!accessToken,
  });
}

export function useSubmitLiffPatientForm(accessToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { values: Record<string, any>; photo_ids?: number[] }) =>
      liffApiService.submitPatientForm(accessToken, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientFormKeys.liff() });
      queryClient.invalidateQueries({ queryKey: patientFormKeys.liffDetail(accessToken) });
    },
  });
}

export function useUpdateLiffPatientForm(accessToken: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { values: Record<string, any>; photo_ids?: number[]; version: number }) =>
      liffApiService.updatePatientForm(accessToken, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientFormKeys.liff() });
      queryClient.invalidateQueries({ queryKey: patientFormKeys.liffDetail(accessToken) });
    },
  });
}

export function usePatientFormSettings(appointmentTypeId: number | null) {
  return useQuery({
    queryKey: ['patient-form-settings', appointmentTypeId],
    queryFn: () => apiService.getPatientFormSettings(appointmentTypeId!).then(res => res.patient_form_settings),
    enabled: !!appointmentTypeId,
  });
}
