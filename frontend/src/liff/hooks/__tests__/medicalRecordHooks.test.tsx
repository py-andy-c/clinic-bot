import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    useLiffMedicalRecord,
    useLiffUpdateMedicalRecord,
    useLiffUploadPatientPhoto,
    useLiffDeletePatientPhoto
} from '../medicalRecordHooks';
import { liffApiService } from '../../../services/liffApi';
import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock liffApiService
vi.mock('../../../services/liffApi', () => ({
    liffApiService: {
        getMedicalRecord: vi.fn(),
        updateMedicalRecord: vi.fn(),
        uploadPatientPhoto: vi.fn(),
        deletePatientPhoto: vi.fn(),
    }
}));

describe('medicalRecordHooks', () => {
    let queryClient: QueryClient;

    beforeEach(() => {
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
            },
        });
        vi.clearAllMocks();
    });

    afterEach(() => {
        queryClient.clear();
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );

    describe('useLiffMedicalRecord', () => {
        it('should fetch medical record successfully', async () => {
            const mockRecord = { id: 1, template_name: 'Test Record' };
            vi.mocked(liffApiService.getMedicalRecord).mockResolvedValue(mockRecord as any);

            const { result } = renderHook(() => useLiffMedicalRecord(1), { wrapper });

            await waitFor(() => {
                expect(result.current.isSuccess).toBe(true);
            });

            expect(result.current.data).toEqual(mockRecord);
            expect(liffApiService.getMedicalRecord).toHaveBeenCalledWith(1);
        });

        it('should not fetch when recordId is null', () => {
            const { result } = renderHook(() => useLiffMedicalRecord(null), { wrapper });

            expect(result.current.isPending).toBe(true);
            expect(result.current.fetchStatus).toBe('idle');
        });
    });

    describe('useLiffUpdateMedicalRecord', () => {
        it('should update medical record successfully', async () => {
            const mockUpdated = { id: 1, version: 2 };
            vi.mocked(liffApiService.updateMedicalRecord).mockResolvedValue(mockUpdated as any);

            const { result } = renderHook(() => useLiffUpdateMedicalRecord(), { wrapper });

            await result.current.mutateAsync({
                recordId: 1,
                data: { version: 1, values: { q1: 'test' }, is_submitted: true, photo_ids: [] }
            });

            expect(liffApiService.updateMedicalRecord).toHaveBeenCalled();
        });
    });

    describe('useLiffUploadPatientPhoto', () => {
        it('should upload photo successfully', async () => {
            const mockPhoto = { id: 101, filename: 'test.jpg' };
            vi.mocked(liffApiService.uploadPatientPhoto).mockResolvedValue(mockPhoto as any);

            const { result } = renderHook(() => useLiffUploadPatientPhoto(1), { wrapper });

            const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
            await result.current.mutateAsync({ file, medicalRecordId: 1 });

            expect(liffApiService.uploadPatientPhoto).toHaveBeenCalledWith(1, file, 1);
        });
    });

    describe('useLiffDeletePatientPhoto', () => {
        it('should delete photo successfully', async () => {
            vi.mocked(liffApiService.deletePatientPhoto).mockResolvedValue({ success: true });

            const { result } = renderHook(() => useLiffDeletePatientPhoto(1, 1), { wrapper });

            await result.current.mutateAsync(101);

            expect(liffApiService.deletePatientPhoto).toHaveBeenCalledWith(101);
        });
    });
});
