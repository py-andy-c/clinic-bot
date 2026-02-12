import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSendPatientForm, medicalRecordKeys } from '../useMedicalRecords';
import { apiService } from '../../services/api';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import React from 'react';

// Mock apiService
vi.mock('../../services/api', () => ({
    apiService: {
        sendPatientForm: vi.fn(),
    },
}));

// Create a wrapper for QueryClientProvider
const createWrapper = () => {
    const testQueryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
            mutations: {
                retry: false,
            }
        },
    });
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
    );
};

describe('useSendPatientForm', () => {
    const clinicId = 1;
    const patientId = 10;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('invalidates both patient and appointment queries on success with appointment_id', async () => {
        const testQueryClient = new QueryClient();
        const invalidateSpy = vi.spyOn(testQueryClient, 'invalidateQueries');

        const SpiedWrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
        );

        const mockRecord = { id: 100, appointment_id: 50 };
        vi.mocked(apiService.sendPatientForm).mockResolvedValue(mockRecord as any);

        const { result } = renderHook(() => useSendPatientForm(clinicId, patientId), { wrapper: SpiedWrapper });

        await act(async () => {
            await result.current.mutateAsync({
                template_id: 1,
                appointment_id: 50
            });
        });

        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: medicalRecordKeys.patient(clinicId, patientId),
        });

        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: [...medicalRecordKeys.patient(clinicId, patientId), 'appointment', 50],
        });
    });

    it('only invalidates patient query when appointment_id is null', async () => {
        const testQueryClient = new QueryClient();
        const invalidateSpy = vi.spyOn(testQueryClient, 'invalidateQueries');

        const SpiedWrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
        );

        const mockRecord = { id: 100, appointment_id: null };
        vi.mocked(apiService.sendPatientForm).mockResolvedValue(mockRecord as any);

        const { result } = renderHook(() => useSendPatientForm(clinicId, patientId), { wrapper: SpiedWrapper });

        await act(async () => {
            await result.current.mutateAsync({
                template_id: 1,
                appointment_id: null
            });
        });

        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: medicalRecordKeys.patient(clinicId, patientId),
        });

        const appointmentCalls = invalidateSpy.mock.calls.filter(call =>
            (call[0] as any).queryKey.includes('appointment')
        );
        expect(appointmentCalls.length).toBe(0);
    });

    it('tracks loading and error states correctly', async () => {
        const wrapper = createWrapper();
        let resolveMutation: (value: any) => void;
        const promise = new Promise((resolve) => {
            resolveMutation = resolve!;
        });

        vi.mocked(apiService.sendPatientForm).mockReturnValue(promise);

        const { result } = renderHook(() => useSendPatientForm(clinicId, patientId), { wrapper });

        // Start mutation
        let mutatePromise: Promise<any>;
        act(() => {
            mutatePromise = result.current.mutateAsync({ template_id: 1 });
        });

        // Wait for pending state
        await waitFor(() => expect(result.current.isPending).toBe(true));

        // Resolve mutation
        await act(async () => {
            resolveMutation!({ id: 100 });
        });
        await mutatePromise!;

        // Wait for success status updates
        await waitFor(() => {
            expect(result.current.isPending).toBe(false);
            expect(result.current.isSuccess).toBe(true);
        });
    });

    it('handles errors correctly', async () => {
        const wrapper = createWrapper();
        const error = new Error('API Error');
        vi.mocked(apiService.sendPatientForm).mockRejectedValue(error);

        const { result } = renderHook(() => useSendPatientForm(clinicId, patientId), { wrapper });

        await act(async () => {
            try {
                await result.current.mutateAsync({
                    template_id: 1,
                });
            } catch (e) {
                // Ignore error
            }
        });

        await waitFor(() => expect(result.current.isError).toBe(true));
    });
});
