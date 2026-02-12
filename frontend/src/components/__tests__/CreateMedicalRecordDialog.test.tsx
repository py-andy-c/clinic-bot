import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateMedicalRecordDialog } from '../CreateMedicalRecordDialog';
import { BrowserRouter } from 'react-router-dom';
import { useMedicalRecordTemplates } from '../../hooks/useMedicalRecordTemplates';
import { usePatientAppointments } from '../../hooks/queries/usePatientAppointments';

// Mock the hooks
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: { active_clinic_id: 1 },
        hasRole: () => true,
    }),
}));

vi.mock('../../hooks/useMedicalRecordTemplates', () => ({
    useMedicalRecordTemplates: vi.fn(),
}));

vi.mock('../../hooks/queries/usePatientAppointments', () => ({
    usePatientAppointments: vi.fn(),
}));

const mockMutateAsync = vi.fn().mockResolvedValue({ id: 100 });
vi.mock('../../hooks/useMedicalRecords', () => ({
    useCreateMedicalRecord: () => ({
        mutateAsync: mockMutateAsync,
        isPending: false,
    }),
}));

const mockAlert = vi.fn().mockResolvedValue(undefined);
vi.mock('../../contexts/ModalContext', () => ({
    useModal: () => ({
        alert: mockAlert,
    }),
}));

// Mock BaseModal and related parts
vi.mock('../shared/BaseModal', () => ({
    BaseModal: ({ children }: { children: React.ReactNode }) => <div data-testid="modal">{children}</div>,
}));

describe('CreateMedicalRecordDialog', () => {
    const defaultProps = {
        patientId: 1,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Default templates mock: one internal, one patient-facing
        vi.mocked(useMedicalRecordTemplates).mockReturnValue({
            data: [
                { id: 1, name: 'Patient Form', is_patient_form: true },
                { id: 2, name: 'Clinic Record', is_patient_form: false },
            ],
            isLoading: false,
        } as any);

        // Default appointments mock
        vi.mocked(usePatientAppointments).mockReturnValue({
            data: { appointments: [] },
            isLoading: false,
        } as any);
    });

    it('renders correctly and filters out patient forms', async () => {
        render(
            <BrowserRouter>
                <CreateMedicalRecordDialog {...defaultProps} />
            </BrowserRouter>
        );

        expect(screen.getByText('新增病歷記錄')).toBeInTheDocument();

        // Should ONLY show 'Clinic Record' which has is_patient_form: false
        const select = screen.getByLabelText(/病歷模板/i);
        expect(select).toBeInTheDocument();

        const templateOptions = Array.from(select.querySelectorAll('option'));
        // Length should be 2: '請選擇模板...' + 'Clinic Record'
        expect(templateOptions).toHaveLength(2);
        expect(templateOptions[1].textContent).toBe('Clinic Record');

        // 'Patient Form' should NOT be in the options
        expect(screen.queryByText('Patient Form')).not.toBeInTheDocument();
    });

    it('submits correctly with selected internal template', async () => {
        render(
            <BrowserRouter>
                <CreateMedicalRecordDialog {...defaultProps} />
            </BrowserRouter>
        );

        // Select the internal template (id: 2)
        const select = screen.getByLabelText(/病歷模板/i);
        fireEvent.change(select, { target: { value: '2' } });

        // Wait for the button to be enabled
        const submitButton = screen.getByRole('button', { name: '建立' });
        await waitFor(() => {
            expect(submitButton).not.toBeDisabled();
        });

        // Submit
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
                template_id: 2,
                values: {}
            }));
        });

        expect(defaultProps.onSuccess).toHaveBeenCalledWith(100);
    });
});
