import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { 
  usePatientFormRequests, 
  useCreatePatientFormRequest,
  useLiffPatientForms,
  useLiffPatientForm,
  useSubmitLiffPatientForm,
  useUpdateLiffPatientForm
} from '../usePatientForms';
import { apiService } from '../../services/api';
import { liffApiService } from '../../services/liffApi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../services/api');
vi.mock('../../services/liffApi');

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = createQueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('usePatientForms hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('usePatientFormRequests', () => {
    it('fetches patient form requests successfully', async () => {
      const mockRequests = [
        { id: 1, template_name: 'Test Form', status: 'pending', sent_at: '2026-02-07T00:00:00Z' }
      ];
      (apiService.getPatientFormRequests as any).mockResolvedValue({ requests: mockRequests });

      const { result } = renderHook(() => usePatientFormRequests(1, 123), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockRequests);
      expect(apiService.getPatientFormRequests).toHaveBeenCalledWith(123);
    });
  });

  describe('useCreatePatientFormRequest', () => {
    it('creates a patient form request successfully', async () => {
      const mockRequest = { id: 1, template_id: 10, patient_id: 123 };
      (apiService.createPatientFormRequest as any).mockResolvedValue(mockRequest);

      const { result } = renderHook(() => useCreatePatientFormRequest(1, 123), { wrapper });

      await result.current.mutateAsync({
        template_id: 10,
        message_template: 'Test message',
      });

      expect(apiService.createPatientFormRequest).toHaveBeenCalledWith(123, expect.objectContaining({
        template_id: 10,
        message_template: 'Test message',
      }));
    });
  });

  describe('useLiffPatientForms', () => {
    it('fetches LIFF patient forms successfully', async () => {
      const mockForms = [{ id: 1, status: 'pending' }];
      (liffApiService.getPatientForms as any).mockResolvedValue({ forms: mockForms });

      const { result } = renderHook(() => useLiffPatientForms(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockForms);
      expect(liffApiService.getPatientForms).toHaveBeenCalled();
    });
  });

  describe('useLiffPatientForm', () => {
    it('fetches a single LIFF patient form successfully', async () => {
      const mockForm = { template: { name: 'Test' }, values: {} };
      (liffApiService.getPatientForm as any).mockResolvedValue(mockForm);

      const { result } = renderHook(() => useLiffPatientForm('token123'), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockForm);
      expect(liffApiService.getPatientForm).toHaveBeenCalledWith('token123');
    });

    it('does not fetch when token is null', () => {
      const { result } = renderHook(() => useLiffPatientForm(null), { wrapper });
      expect(result.current.isLoading).toBe(false);
      expect(liffApiService.getPatientForm).not.toHaveBeenCalled();
    });
  });

  describe('useSubmitLiffPatientForm', () => {
    it('submits a LIFF patient form successfully', async () => {
      const mockResponse = { success: true, medical_record_id: 1 };
      (liffApiService.submitPatientForm as any).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useSubmitLiffPatientForm('token123'), { wrapper });

      await result.current.mutateAsync({
        values: { field1: 'value1' },
        photo_ids: [1, 2],
      });

      expect(liffApiService.submitPatientForm).toHaveBeenCalledWith('token123', {
        values: { field1: 'value1' },
        photo_ids: [1, 2],
      });
    });
  });

  describe('useUpdateLiffPatientForm', () => {
    it('updates a LIFF patient form successfully', async () => {
      const mockResponse = { success: true, medical_record_id: 1 };
      (liffApiService.updatePatientForm as any).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useUpdateLiffPatientForm('token123'), { wrapper });

      await result.current.mutateAsync({
        values: { field1: 'updated' },
        photo_ids: [1],
        version: 2,
      });

      expect(liffApiService.updatePatientForm).toHaveBeenCalledWith('token123', {
        values: { field1: 'updated' },
        photo_ids: [1],
        version: 2,
      });
    });
  });
});
