/**
 * Tests for AppointmentModalOrchestrator component
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppointmentModalOrchestrator } from '../AppointmentModalOrchestrator';
import { ModalState } from '../../../types/modal';

// Mock the modal components
vi.mock('../../calendar/CreateAppointmentModal', () => ({
  CreateAppointmentModal: vi.fn(({ onClose, onConfirm }) => (
    <div data-testid="create-appointment-modal">
      <button onClick={onClose} data-testid="close-create">Close</button>
      <button onClick={() => onConfirm({ patient_id: 1, appointment_type_id: 1, practitioner_id: 1, start_time: '2024-01-01T10:00:00' })} data-testid="confirm-create">
        Confirm
      </button>
    </div>
  )),
}));

vi.mock('../../calendar/EditAppointmentModal', () => ({
  EditAppointmentModal: vi.fn(({ onClose, onComplete }) => (
    <div data-testid="edit-appointment-modal">
      <button onClick={onClose} data-testid="close-edit">Close</button>
      <button onClick={() => onComplete?.()} data-testid="complete-edit">
        Complete
      </button>
    </div>
  )),
}));

vi.mock('../../calendar/DeleteConfirmationModal', () => ({
  DeleteConfirmationModal: vi.fn(({ onCancel, onConfirm }) => (
    <div data-testid="delete-confirmation-modal">
      <button onClick={onCancel} data-testid="cancel-delete">Cancel</button>
      <button onClick={onConfirm} data-testid="confirm-delete">
        Confirm
      </button>
    </div>
  )),
}));

// Mock API service
vi.mock('../../../services/api', () => ({
  apiService: {
    createClinicAppointment: vi.fn(),
    editClinicAppointment: vi.fn(),
    cancelClinicAppointment: vi.fn(),
  },
}));

// Mock modal context
vi.mock('../../../contexts/ModalContext', () => ({
  useModal: vi.fn(),
}));

import { apiService } from '../../../services/api';
import { useModal } from '../../../contexts/ModalContext';

const mockApiService = vi.mocked(apiService);
const mockUseModal = vi.mocked(useModal);

describe('AppointmentModalOrchestrator', () => {
  let queryClient: QueryClient;
  let mockModalState: ModalState;
  let mockOnModalChange: vi.Mock;

  const mockPractitioners = [
    { id: 1, full_name: 'Dr. Smith' },
    { id: 2, full_name: 'Dr. Jones' },
  ];

  const mockAppointmentTypes = [
    { id: 1, name: 'Consultation', duration_minutes: 30, clinic_id: 1 },
    { id: 2, name: 'Follow-up', duration_minutes: 15, clinic_id: 1 },
  ];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    mockModalState = { type: null };
    mockOnModalChange = vi.fn();
    mockApiService.createClinicAppointment.mockResolvedValue({ success: true });
    mockApiService.editClinicAppointment.mockResolvedValue({ success: true });
    mockApiService.cancelClinicAppointment.mockResolvedValue({ success: true });
    mockUseModal.mockReturnValue({ alert: vi.fn() });
  });

  const renderOrchestrator = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <AppointmentModalOrchestrator
          modalState={mockModalState}
          onModalChange={mockOnModalChange}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onRefresh={vi.fn()}
        />
      </QueryClientProvider>
    );
  };

  it('renders nothing when modal type is null', () => {
    mockModalState = { type: null };
    const { container } = renderOrchestrator();
    expect(container.firstChild).toBeNull();
  });

  it('renders CreateAppointmentModal when type is create_appointment', () => {
    mockModalState = { type: 'create_appointment', data: { initialDate: '2024-01-01' } };
    renderOrchestrator();

    expect(screen.getByTestId('create-appointment-modal')).toBeInTheDocument();
  });

  it('renders EditAppointmentModal when type is edit_appointment', () => {
    mockModalState = {
      type: 'edit_appointment',
      data: { event: { id: 1, title: 'Test Event' } }
    };
    renderOrchestrator();

    expect(screen.getByTestId('edit-appointment-modal')).toBeInTheDocument();
  });

  it('renders DeleteConfirmationModal when type is delete_confirmation', () => {
    mockModalState = {
      type: 'delete_confirmation',
      data: { event: { id: 1, title: 'Test Event' } }
    };
    renderOrchestrator();

    expect(screen.getByTestId('delete-confirmation-modal')).toBeInTheDocument();
  });

  it('calls onModalChange with null when closing create modal', async () => {
    mockModalState = { type: 'create_appointment', data: {} };
    renderOrchestrator();

    fireEvent.click(screen.getByTestId('close-create'));

    await waitFor(() => {
      expect(mockOnModalChange).toHaveBeenCalledWith({ type: null });
    });
  });

  it('calls API and closes modal when confirming create appointment', async () => {
    mockModalState = { type: 'create_appointment', data: {} };
    renderOrchestrator();

    fireEvent.click(screen.getByTestId('confirm-create'));

    await waitFor(() => {
      expect(mockApiService.createClinicAppointment).toHaveBeenCalledWith({
        patient_id: 1,
        appointment_type_id: 1,
        practitioner_id: 1,
        start_time: '2024-01-01T10:00:00'
      });
      expect(mockOnModalChange).toHaveBeenCalledWith({ type: null });
    });
  });

  it('uses stable modal keys to prevent remounting', () => {
    mockModalState = { type: 'create_appointment', data: {} };
    const { rerender } = renderOrchestrator();

    // Get the initial modal element
    const initialModal = screen.getByTestId('create-appointment-modal');

    // Re-render with same state (simulating parent re-render)
    rerender(
      <QueryClientProvider client={queryClient}>
        <AppointmentModalOrchestrator
          modalState={mockModalState}
          onModalChange={mockOnModalChange}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onRefresh={vi.fn()}
        />
      </QueryClientProvider>
    );

    // Modal should still exist and be the same element (stable key)
    const rerenderedModal = screen.getByTestId('create-appointment-modal');
    expect(rerenderedModal).toBe(initialModal);
  });

  it('calls onModalChange with null when completing edit modal', async () => {
    mockModalState = {
      type: 'edit_appointment',
      data: { event: { id: 1, title: 'Test Event' } }
    };
    renderOrchestrator();

    fireEvent.click(screen.getByTestId('complete-edit'));

    await waitFor(() => {
      expect(mockOnModalChange).toHaveBeenCalledWith({ type: null });
    });
  });

  it('calls API and closes modal when confirming delete', async () => {
    mockModalState = {
      type: 'delete_confirmation',
      data: { event: { id: 1, title: 'Test Event' } }
    };
    renderOrchestrator();

    fireEvent.click(screen.getByTestId('confirm-delete'));

    await waitFor(() => {
      expect(mockApiService.cancelClinicAppointment).toHaveBeenCalledWith(1);
      expect(mockOnModalChange).toHaveBeenCalledWith({ type: null });
    });
  });
});