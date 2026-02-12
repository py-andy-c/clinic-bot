import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SendPatientFormDialog } from '../SendPatientFormDialog';
import { BrowserRouter } from 'react-router-dom';
import { useMedicalRecordTemplates } from '../../hooks/useMedicalRecordTemplates';
import { usePatientDetail } from '../../hooks/queries/usePatientDetail';
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

vi.mock('../../hooks/queries/usePatientDetail', () => ({
    usePatientDetail: vi.fn(),
}));

vi.mock('../../hooks/queries/usePatientAppointments', () => ({
    usePatientAppointments: vi.fn(),
}));

const mockMutateAsync = vi.fn().mockResolvedValue({ id: 100 });
vi.mock('../../hooks/useMedicalRecords', () => ({
    useSendPatientForm: () => ({
        mutateAsync: mockMutateAsync,
        isPending: false,
    }),
}));

const mockAlert = vi.fn().mockResolvedValue(undefined);
const mockConfirm = vi.fn().mockResolvedValue(true);
vi.mock('../../contexts/ModalContext', () => ({
    useModal: () => ({
        alert: mockAlert,
        confirm: mockConfirm,
    }),
}));

// Mock BaseModal and related parts to render children directly
vi.mock('../shared/BaseModal', () => ({
    BaseModal: ({ children }: { children: React.ReactNode }) => <div data-testid="modal">{children}</div>,
}));

const TODAY_APPOINTMENT_ID = 99;

describe('SendPatientFormDialog', () => {
    const defaultProps = {
        patientId: 1,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Default templates mock
        vi.mocked(useMedicalRecordTemplates).mockReturnValue({
            data: [
                { id: 1, name: 'Form 1', is_patient_form: true },
                { id: 2, name: 'Note 1', is_patient_form: false },
            ],
            isLoading: false,
        } as any);

        // Default patient mock (linked)
        vi.mocked(usePatientDetail).mockReturnValue({
            data: { id: 1, line_user_id: 'user123' },
            isLoading: false,
        } as any);

        // Default appointments mock
        vi.mocked(usePatientAppointments).mockReturnValue({
            data: {
                appointments: [
                    { id: 1, status: 'confirmed', start_time: '2026-01-01T10:00:00', end_time: '2026-01-01T11:00:00', appointment_type_name: 'Service 1' },
                ],
            },
            isLoading: false,
        } as any);
    });

    it('renders correctly and filters templates', async () => {
        render(
            <BrowserRouter>
                <SendPatientFormDialog {...defaultProps} />
            </BrowserRouter>
        );

        expect(screen.getByText('發送病患表單')).toBeInTheDocument();

        // Should only show 'Form 1' which has is_patient_form: true
        const select = screen.getByLabelText(/選擇表單模板/i);
        expect(select).toBeInTheDocument();

        const templateOptions = Array.from(screen.getByLabelText(/選擇表單模板/i).querySelectorAll('option'));
        expect(templateOptions).toHaveLength(2); // Default + Form 1
        expect(templateOptions[1].textContent).toBe('Form 1');
    });

    it('submits correctly after confirmation with all fields', async () => {
        render(
            <BrowserRouter>
                <SendPatientFormDialog {...defaultProps} />
            </BrowserRouter>
        );

        // Select template
        fireEvent.change(screen.getByLabelText(/選擇表單模板/i), { target: { value: '1' } });

        // Select appointment
        fireEvent.change(screen.getByLabelText(/關聯預約/i), { target: { value: '1' } });

        // Add message override
        fireEvent.change(screen.getByLabelText(/自訂訊息/i), { target: { value: 'Please fill this.' } });

        // Submit
        fireEvent.click(screen.getByRole('button', { name: '確認發送' }));

        await waitFor(() => {
            expect(mockConfirm).toHaveBeenCalled();
            expect(mockMutateAsync).toHaveBeenCalledWith({
                template_id: 1,
                appointment_id: 1,
                message_override: 'Please fill this.'
            });
            expect(mockAlert).toHaveBeenCalledWith(expect.stringContaining('成功'), '發送成功');
        });

        expect(defaultProps.onSuccess).toHaveBeenCalledWith(100);
    });

    it('selects smart default appointment automatically', async () => {
        // Mock appointments so one is today
        const today = new Date().toISOString().split('T')[0];
        vi.mocked(usePatientAppointments).mockReturnValue({
            data: {
                appointments: [
                    { id: TODAY_APPOINTMENT_ID, status: 'confirmed', start_time: `${today}T10:00:00`, end_time: `${today}T11:00:00` },
                ],
            },
            isLoading: false,
        } as any);

        render(
            <BrowserRouter>
                <SendPatientFormDialog {...defaultProps} />
            </BrowserRouter>
        );

        const aptSelect = screen.getByLabelText(/關聯預約/i) as HTMLSelectElement;
        // Wait for effect to run
        await waitFor(() => {
            expect(aptSelect.value).toBe(TODAY_APPOINTMENT_ID.toString());
        });
    });

    it('prevents smart default from overriding manual user selection', async () => {
        vi.mocked(usePatientAppointments).mockReturnValue({
            data: { appointments: [{ id: TODAY_APPOINTMENT_ID, status: 'confirmed', start_time: new Date().toISOString() }] },
            isLoading: false
        } as any);

        render(
            <BrowserRouter>
                <SendPatientFormDialog {...defaultProps} />
            </BrowserRouter>
        );

        // Wait for potential auto-setting
        await waitFor(() => {
            const aptSelect = screen.getByLabelText(/關聯預約/i) as HTMLSelectElement;
            expect(aptSelect.value).toBe(TODAY_APPOINTMENT_ID.toString());
        });

        // User manually changes it to "None"
        fireEvent.change(screen.getByLabelText(/關聯預約/i), { target: { value: '' } });

        // Wait and check it stays empty even if something rerenders
        const aptSelect = screen.getByLabelText(/關聯預約/i) as HTMLSelectElement;
        expect(aptSelect.value).toBe('');
    });

    it('shows warning if patient is not linked to Line', () => {
        vi.mocked(usePatientDetail).mockReturnValue({
            data: { id: 1, line_user_id: null },
            isLoading: false,
        } as any);

        render(
            <BrowserRouter>
                <SendPatientFormDialog {...defaultProps} />
            </BrowserRouter>
        );

        expect(screen.getByText('病患尚未連結 Line 帳號')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '確認發送' })).not.toBeInTheDocument();
    });

    it('handles structured backend errors correctly', async () => {
        // Mock a structured error response with new code
        const structuredError = {
            response: {
                data: {
                    detail: {
                        error_code: 'PATIENT_NOT_LINKED',
                        message: 'Custom backend message'
                    }
                }
            }
        };
        mockMutateAsync.mockRejectedValueOnce(structuredError);

        render(
            <BrowserRouter>
                <SendPatientFormDialog {...defaultProps} />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/選擇表單模板/i), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: '確認發送' }));

        await waitFor(() => {
            expect(mockAlert).toHaveBeenCalledWith(
                expect.stringContaining('尚未連結 Line'),
                '發送失敗'
            );
        });
    });

    it('handles LIFF_NOT_CONFIGURED error', async () => {
        mockMutateAsync.mockRejectedValueOnce({
            response: {
                data: {
                    detail: { error_code: 'LIFF_NOT_CONFIGURED' }
                }
            }
        });

        render(
            <BrowserRouter>
                <SendPatientFormDialog {...defaultProps} />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/選擇表單模板/i), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: '確認發送' }));

        await waitFor(() => {
            expect(mockAlert).toHaveBeenCalledWith(
                expect.stringContaining('尚未完成 LIFF 設定'),
                '系統錯誤'
            );
        });
    });

    it('handles LINE_SEND_FAILED error', async () => {
        mockMutateAsync.mockRejectedValueOnce({
            response: {
                data: {
                    detail: { error_code: 'LINE_SEND_FAILED' }
                }
            }
        });

        render(
            <BrowserRouter>
                <SendPatientFormDialog {...defaultProps} />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/選擇表單模板/i), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: '確認發送' }));

        await waitFor(() => {
            expect(mockAlert).toHaveBeenCalledWith(
                expect.stringContaining('Line 訊息發送失敗'),
                '發送失敗'
            );
        });
    });

    it('handles RESOURCE_NOT_FOUND errors like PATIENT_NOT_FOUND', async () => {
        mockMutateAsync.mockRejectedValueOnce({
            response: {
                data: {
                    detail: { error_code: 'PATIENT_NOT_FOUND' }
                }
            }
        });

        render(
            <BrowserRouter>
                <SendPatientFormDialog {...defaultProps} />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/選擇表單模板/i), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: '確認發送' }));

        await waitFor(() => {
            expect(mockAlert).toHaveBeenCalledWith(
                expect.stringContaining('找不到此病患'),
                '發送失敗'
            );
        });
    });

    it('handles CLINIC_NOT_FOUND error', async () => {
        mockMutateAsync.mockRejectedValueOnce({
            response: {
                data: {
                    detail: { error_code: 'CLINIC_NOT_FOUND' }
                }
            }
        });

        render(
            <BrowserRouter>
                <SendPatientFormDialog {...defaultProps} />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/選擇表單模板/i), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: '確認發送' }));

        await waitFor(() => {
            expect(mockAlert).toHaveBeenCalledWith(
                expect.stringContaining('診所資料異常'),
                '系統錯誤'
            );
        });
    });

    it('handles LINE_USER_NOT_FOUND error', async () => {
        mockMutateAsync.mockRejectedValueOnce({
            response: {
                data: {
                    detail: { error_code: 'LINE_USER_NOT_FOUND' }
                }
            }
        });

        render(
            <BrowserRouter>
                <SendPatientFormDialog {...defaultProps} />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/選擇表單模板/i), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: '確認發送' }));

        await waitFor(() => {
            expect(mockAlert).toHaveBeenCalledWith(
                expect.stringContaining('Line 用戶資料異常'),
                '發送失敗'
            );
        });
    });

    it('handles incorrect template type error (TEMPLATE_NOT_PATIENT_FORM)', async () => {
        mockMutateAsync.mockRejectedValueOnce({
            response: {
                data: {
                    detail: { error_code: 'TEMPLATE_NOT_PATIENT_FORM' }
                }
            }
        });

        render(
            <BrowserRouter>
                <SendPatientFormDialog {...defaultProps} />
            </BrowserRouter>
        );

        fireEvent.change(screen.getByLabelText(/選擇表單模板/i), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: '確認發送' }));

        await waitFor(() => {
            expect(mockAlert).toHaveBeenCalledWith(
                expect.stringContaining('所選模板不符合'),
                '發送失敗'
            );
        });
    });
});
