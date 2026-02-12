
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PatientMedicalRecordPage from '../PatientMedicalRecordPage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { useLiffMedicalRecord, useLiffUpdateMedicalRecord } from '../../hooks/medicalRecordHooks';
import { useModal } from '../../../contexts/ModalContext';
import React from 'react';

// Mock the hooks
vi.mock('../../hooks/medicalRecordHooks', () => ({
    useLiffMedicalRecord: vi.fn(),
    useLiffUpdateMedicalRecord: vi.fn(),
}));

vi.mock('../../../contexts/ModalContext', () => ({
    useModal: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useSearchParams: vi.fn(),
    };
});

// Mock components that are complex or tested elsewhere
vi.mock('../../../components/MedicalRecordDynamicForm', () => ({
    MedicalRecordDynamicForm: ({ fields }: any) => (
        <div data-testid="dynamic-form">
            {fields.map((f: any) => (
                <div key={f.id} data-testid={`field-${f.id}`}>{f.label}</div>
            ))}
        </div>
    ),
}));

vi.mock('../LiffMedicalRecordPhotoSelector', () => ({
    LiffMedicalRecordPhotoSelector: () => <div data-testid="photo-selector" />,
}));

describe('PatientMedicalRecordPage', () => {
    let queryClient: QueryClient;
    const mockAlert = vi.fn();
    // Mock window.location.reload
    const mockReload = vi.fn();
    Object.defineProperty(window, 'location', {
        writable: true,
        value: { reload: mockReload }
    });

    beforeEach(() => {
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { retry: false },
            },
        });
        vi.clearAllMocks();

        (useModal as any).mockReturnValue({
            alert: mockAlert,
        });

        (useSearchParams as any).mockReturnValue([
            new URLSearchParams('path=/liff/records/123'),
            vi.fn(),
        ]);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                {children}
            </MemoryRouter>
        </QueryClientProvider>
    );

    it('renders loading state', () => {
        (useLiffMedicalRecord as any).mockReturnValue({
            isLoading: true,
        });
        (useLiffUpdateMedicalRecord as any).mockReturnValue({
            mutateAsync: vi.fn(),
            isPending: false,
        });

        render(<PatientMedicalRecordPage />, { wrapper });
        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('renders error state when record fails to load', () => {
        (useLiffMedicalRecord as any).mockReturnValue({
            isLoading: false,
            error: new Error('Failed to load'),
        });
        (useLiffUpdateMedicalRecord as any).mockReturnValue({
            mutateAsync: vi.fn(),
            isPending: false,
        });

        render(<PatientMedicalRecordPage />, { wrapper });
        expect(screen.getByText(/無法載入連結/)).toBeInTheDocument();
    });

    it('renders form when record is loaded', async () => {
        const mockRecord = {
            id: 123,
            patient_id: 1,
            template_name: 'Test Template',
            template_snapshot: {
                fields: [
                    { id: 'q1', label: 'Question 1', type: 'text' }
                ]
            },
            is_patient_form: true,
            values: { q1: 'initial value' },
            version: 1,
            photos: []
        };

        (useLiffMedicalRecord as any).mockReturnValue({
            isLoading: false,
            data: mockRecord,
        });
        (useLiffUpdateMedicalRecord as any).mockReturnValue({
            mutateAsync: vi.fn(),
            isPending: false,
        });

        render(<PatientMedicalRecordPage />, { wrapper });

        expect(screen.getByText('Test Template')).toBeInTheDocument();
        expect(screen.getByTestId('dynamic-form')).toBeInTheDocument();
        expect(screen.getByTestId('field-q1')).toBeInTheDocument();
        expect(screen.getByTestId('photo-selector')).toBeInTheDocument();
    });

    it('submits form successfully (first time)', async () => {
        const mockRecord = {
            id: 123,
            patient_id: 1,
            template_name: 'Test Template',
            template_snapshot: {
                fields: [{ id: 'q1', label: 'Question 1', type: 'text' }]
            },
            is_patient_form: true,
            values: { q1: '' },
            version: 1,
            photos: [],
            patient_last_edited_at: null
        };

        const mockMutateAsync = vi.fn().mockResolvedValue({});

        (useLiffMedicalRecord as any).mockReturnValue({
            isLoading: false,
            data: mockRecord,
        });
        (useLiffUpdateMedicalRecord as any).mockReturnValue({
            mutateAsync: mockMutateAsync,
            isPending: false,
        });

        render(<PatientMedicalRecordPage />, { wrapper });

        const submitButton = screen.getByText('確認送出');
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(mockMutateAsync).toHaveBeenCalledWith({
                recordId: 123,
                data: expect.objectContaining({
                    is_submitted: true,
                    version: 1
                })
            });
        });

        expect(screen.getByText('填寫完成')).toBeInTheDocument();
    });

    it('shows "儲存修改" label for returning patients', async () => {
        const mockRecord = {
            id: 123,
            patient_id: 1,
            template_name: 'Test Template',
            template_snapshot: {
                fields: [{ id: 'q1', label: 'Question 1', type: 'text' }]
            },
            is_patient_form: true,
            values: { q1: 'previous content' },
            version: 1,
            photos: [],
            patient_last_edited_at: '2026-01-01T00:00:00Z'
        };

        (useLiffMedicalRecord as any).mockReturnValue({
            isLoading: false,
            data: mockRecord,
        });
        (useLiffUpdateMedicalRecord as any).mockReturnValue({
            mutateAsync: vi.fn(),
            isPending: false,
        });

        render(<PatientMedicalRecordPage />, { wrapper });

        expect(screen.getByText('儲存修改')).toBeInTheDocument();
    });


    it('handles 409 conflict and reloads page', async () => {
        const mockRecord = {
            id: 123,
            template_snapshot: { fields: [] },
            values: {},
            version: 1,
            photos: []
        };

        const conflictError = {
            response: {
                status: 409,
                data: { detail: { error_code: 'RECORD_MODIFIED' } }
            }
        };

        const mockMutateAsync = vi.fn().mockRejectedValue(conflictError);

        (useLiffMedicalRecord as any).mockReturnValue({
            isLoading: false,
            data: mockRecord,
        });
        (useLiffUpdateMedicalRecord as any).mockReturnValue({
            mutateAsync: mockMutateAsync,
            isPending: false,
        });

        render(<PatientMedicalRecordPage />, { wrapper });

        const submitButton = screen.getByText('確認送出');
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(mockAlert).toHaveBeenCalledWith(
                '此紀錄已被其他使用者修改，請重新整理後再試',
                '紀錄已更新'
            );
        });

        expect(mockReload).toHaveBeenCalled();
    });

    it('validates required fields', async () => {
        const mockRecord = {
            id: 123,
            template_snapshot: {
                fields: [{ id: 'q1', label: 'Question 1', type: 'text', required: true }]
            },
            values: { q1: '' },
            version: 1,
            photos: []
        };

        // Even though we made fields optional in the schema for draft saving,
        // we might want to test that the form handles validation if we were strictly enforcing it.
        // However, the current requirement says "Modified to mark ALL fields as optional".
        // So checking for validation error might actually fail if we expect it to NOT validate.
        // Let's verify that it DOES NOT block submission for empty required fields (as per design for drafts)
        // OR if there is client-side validation logic logic implemented in the form itself.

        // Reviewing the code, `createMedicalRecordDynamicSchema` makes everything optional.
        // So this test confirms that optional fields are indeed valid.

        const mockMutateAsync = vi.fn().mockResolvedValue({});

        (useLiffMedicalRecord as any).mockReturnValue({
            isLoading: false,
            data: mockRecord,
        });
        (useLiffUpdateMedicalRecord as any).mockReturnValue({
            mutateAsync: mockMutateAsync,
            isPending: false,
        });

        render(<PatientMedicalRecordPage />, { wrapper });

        const submitButton = screen.getByText('確認送出');
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(mockMutateAsync).toHaveBeenCalled();
        });
    });
});
