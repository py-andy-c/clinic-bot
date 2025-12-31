/**
 * Unit tests for EditAppointmentModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { EditAppointmentModal } from '../EditAppointmentModal';
import { CalendarEvent } from '../../../utils/calendarDataAdapter';
import { apiService } from '../../../services/api';
import { ModalProvider } from '../../../contexts/ModalContext';
import { ModalQueueProvider } from '../../../contexts/ModalQueueContext';

// Mock createPortal to render directly
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock react-router-dom's useLocation
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/test' }),
}));

// Mock apiService
vi.mock('../../../services/api', () => ({
  apiService: {
    getPractitionerStatus: vi.fn(),
    previewEditNotification: vi.fn(),
    getPractitioners: vi.fn(),
    getAppointmentResources: vi.fn().mockResolvedValue({ resources: [] }),
    getPatient: vi.fn(),
    getResourceAvailability: vi.fn().mockResolvedValue({
      suggested_allocation: [],
      available_resources: [],
    }),
  },
}));

// Mock DateTimePicker to report available slots and conditionally set date/time
vi.mock('../DateTimePicker', () => ({
  DateTimePicker: ({ onHasAvailableSlotsChange, onDateSelect, onTimeSelect, selectedPractitionerId }: { onHasAvailableSlotsChange?: (hasSlots: boolean) => void; onDateSelect?: (date: string) => void; onTimeSelect?: (time: string) => void; selectedPractitionerId?: number | null }) => {
    // Call onHasAvailableSlotsChange when practitioner is selected
    React.useEffect(() => {
      let isMounted = true;
      if (selectedPractitionerId) {
        // Use a small delay to simulate async behavior but stay predictable
        const timer = setTimeout(() => {
          if (!isMounted) return;
          if (onHasAvailableSlotsChange) onHasAvailableSlotsChange(true);
          if (onDateSelect) onDateSelect('2024-01-15');
          if (onTimeSelect) onTimeSelect('09:00');
        }, 0);
        return () => {
          isMounted = false;
          clearTimeout(timer);
        };
      }
    }, [selectedPractitionerId, onHasAvailableSlotsChange, onDateSelect, onTimeSelect]);
    return <div data-testid="datetime-picker">DateTimePicker</div>;
  },
}));

const mockFormatAppointmentTime = vi.fn((start: Date, end: Date) => 
  `${start.toLocaleDateString()} ${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}`
);

const mockOnConfirm = vi.fn();
const mockOnClose = vi.fn();

// Helper to wrap component with ModalProvider and ModalQueueProvider
const renderWithModal = (component: React.ReactElement) => {
  return render(
    <ModalProvider>
      <ModalQueueProvider>
        {component}
      </ModalQueueProvider>
    </ModalProvider>
  );
};

describe('EditAppointmentModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock getPractitioners to return all practitioners by default
    vi.mocked(apiService.getPractitioners).mockResolvedValue([
      { id: 1, full_name: 'Dr. Test' },
      { id: 2, full_name: 'Dr. No Availability' },
      { id: 3, full_name: 'Dr. No Appointment Type' },
    ]);
    // Mock getPatient to return a patient by default
    vi.mocked(apiService.getPatient).mockResolvedValue({
      id: 1,
      full_name: 'Test Patient',
      phone_number: '1234567890',
      created_at: '2024-01-01T00:00:00Z',
    });
    // Mock getResourceAvailability to return proper structure
    vi.mocked(apiService.getResourceAvailability).mockResolvedValue({
      suggested_allocation: [],
      available_resources: [],
      requirements: [],
    });
  });

  const mockAppointmentEvent: CalendarEvent = {
    title: 'Test Appointment',
    start: new Date('2024-01-15T09:00:00'),
    end: new Date('2024-01-15T10:00:00'),
    resource: {
      type: 'appointment',
      appointment_id: 1,
      calendar_event_id: 1,
      appointment_type_id: 1,
      appointment_type_name: 'Test Type',
      practitioner_id: 1,
      practitioner_name: 'Dr. Test',
      patient_id: 1,
      patient_name: 'Patient Test',
      line_display_name: 'LINE User',
      notes: 'Test notes',
    },
  };

  const mockPractitioners = [
    { id: 1, full_name: 'Dr. Test' },
    { id: 2, full_name: 'Dr. No Availability' },
    { id: 3, full_name: 'Dr. No Appointment Type' },
  ];

  const mockAppointmentTypes = [
    { id: 1, name: 'Test Type', duration_minutes: 30 },
  ];

  it('should accept edit props without crashing', () => {
    renderWithModal(
      <EditAppointmentModal
        event={mockAppointmentEvent}
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        formatAppointmentTime={mockFormatAppointmentTime}
      />
    );

    expect(screen.getByText('調整預約')).toBeInTheDocument();
  });

  it('should display original appointment time', async () => {
    renderWithModal(
      <EditAppointmentModal
        event={mockAppointmentEvent}
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        formatAppointmentTime={mockFormatAppointmentTime}
      />
    );

    // Wait for the component to render
    await waitFor(() => {
      expect(screen.getByText(/原預約時間：/)).toBeInTheDocument();
    });

    const originalTimeContainer = screen.getByText(/原預約時間：/).closest('div');
    expect(originalTimeContainer).toBeInTheDocument();
    expect(originalTimeContainer?.textContent).toMatch(/原預約時間：\d{4}\/\d{1,2}\/\d{1,2}\([日一二三四五六]\)\s+\d{2}:\d{2}/i);
  });

  describe('Review Step', () => {
    it('should show review step when form is submitted with changes', async () => {
      renderWithModal(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      // Change practitioner - wait for loading to complete, then find select
    await waitFor(() => {
      const selects = screen.getAllByRole('combobox');
      expect(selects.length).toBeGreaterThanOrEqual(2);
      expect(selects[1]).not.toBeDisabled();
    });
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: '2' } });

      // Wait for submit button to be enabled
      const submitButton = screen.getByText('下一步');
      await waitFor(() => {
        expect(submitButton).not.toBeDisabled();
      });

      // Submit form
      fireEvent.click(submitButton);

      // Should show review step
      await waitFor(() => {
        expect(screen.getByText('確認變更')).toBeInTheDocument();
      });
    });

    it('should display original and new appointment values in review step', async () => {
      renderWithModal(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      // Change practitioner
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects[1]).not.toBeDisabled();
      });
      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[1], { target: { value: '2' } });

      // Wait for submit button to be enabled
      const submitButton = screen.getByText('下一步');
      await waitFor(() => {
        expect(submitButton).not.toBeDisabled();
      });

      // Submit form
      fireEvent.click(submitButton);

      // Check review step content
      await waitFor(() => {
        expect(screen.getByText('原預約')).toBeInTheDocument();
        expect(screen.getByText('新預約')).toBeInTheDocument();
        expect(screen.getByText('Dr. Test')).toBeInTheDocument(); // Original practitioner
      });
    });

    it('should allow going back to form from review step', async () => {
      renderWithModal(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      // Change practitioner and submit
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects[1]).not.toBeDisabled();
      });
      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[1], { target: { value: '2' } });

      const submitButton = screen.getByText('下一步');
      await waitFor(() => {
        expect(submitButton).not.toBeDisabled();
      });

      fireEvent.click(submitButton);

      // Wait for review step
      await waitFor(() => {
        expect(screen.getByText('確認變更')).toBeInTheDocument();
      });

      // Click back button
      const backButton = screen.getByText('返回修改');
      fireEvent.click(backButton);

      // Should be back to form step
      await waitFor(() => {
        expect(screen.getByText('調整預約')).toBeInTheDocument();
      });
    });

    it('should show auto-assigned indicator for originally auto-assigned appointments', async () => {
      const autoAssignedEvent: CalendarEvent = {
        ...mockAppointmentEvent,
        resource: {
          ...mockAppointmentEvent.resource,
          originally_auto_assigned: true,
        },
      };

      renderWithModal(
        <EditAppointmentModal
          event={autoAssignedEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      // Change practitioner and submit
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects[1]).not.toBeDisabled();
      });
      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[1], { target: { value: '2' } });

      const submitButton = screen.getByText('下一步');
      await waitFor(() => {
        expect(submitButton).not.toBeDisabled();
      });

      fireEvent.click(submitButton);

      // Check that review step shows auto-assigned indicator
      await waitFor(() => {
        expect(screen.getByText(/自動指派/)).toBeInTheDocument();
      });
    });
  });

  describe('Appointment Type Editing', () => {
    const mockAppointmentTypesWithMultiple = [
      { id: 1, name: 'Test Type', duration_minutes: 30 },
      { id: 2, name: 'Another Type', duration_minutes: 60 },
    ];

    it('should allow changing appointment type', async () => {
      // Mock practitioners for type 2
      vi.mocked(apiService.getPractitioners).mockResolvedValue([
        { id: 1, full_name: 'Dr. Test' },
        { id: 2, full_name: 'Dr. Another' },
      ]);

      renderWithModal(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypesWithMultiple}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      // Wait for form to load (comboboxes should be present and enabled)
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects.length).toBeGreaterThanOrEqual(2);
        expect(selects[0]).not.toBeDisabled();
      });

      // Change appointment type
      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[0], { target: { value: '2' } });

      // Wait for practitioners to be fetched
      await waitFor(() => {
        expect(apiService.getPractitioners).toHaveBeenCalledWith(2, expect.any(AbortSignal));
      });

      // Verify practitioner dropdown is enabled and has options
      await waitFor(() => {
        expect(screen.getAllByRole('combobox')[1]).not.toBeDisabled();
      });
    });

    it('should clear practitioner and time when appointment type changes', async () => {
      // Mock practitioners for type 2
      vi.mocked(apiService.getPractitioners).mockResolvedValue([{ id: 2, full_name: 'Dr. Another' }]);

      renderWithModal(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypesWithMultiple}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      // Wait for form to load (comboboxes should be present and enabled)
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects.length).toBeGreaterThanOrEqual(2);
        expect(selects[0]).not.toBeDisabled();
      });

      // Change appointment type
      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[0], { target: { value: '2' } });

      // Wait for practitioners to be fetched
      await waitFor(() => {
        expect(apiService.getPractitioners).toHaveBeenCalledWith(2, expect.any(AbortSignal));
      });

      // Verify practitioner dropdown is cleared
      await waitFor(() => {
        expect(screen.getAllByRole('combobox')[1]).toHaveValue('');
      });
    });

    it('should track appointment type change', async () => {
      vi.mocked(apiService.getPractitioners).mockResolvedValue([
        { id: 1, full_name: 'Dr. Test' },
      ]);

      renderWithModal(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypesWithMultiple}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      // Wait for form to load (comboboxes should be present and enabled)
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects.length).toBeGreaterThanOrEqual(2);
        expect(selects[0]).not.toBeDisabled();
      });

      // Change appointment type to 2
      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[0], { target: { value: '2' } });

      // Verify change is tracked
      await waitFor(() => {
        expect(screen.getAllByRole('combobox')[0]).toHaveValue('2');
      });
    });

    it('should show error when practitioner fetch fails', async () => {
      // Clear mock and set up failure for type 2
      vi.mocked(apiService.getPractitioners).mockResolvedValueOnce(mockPractitioners); // For initial load
      
      renderWithModal(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypesWithMultiple}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      // Wait for form to load (comboboxes should be present and enabled)
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects.length).toBeGreaterThanOrEqual(2);
        expect(selects[0]).not.toBeDisabled();
      });

      // Set failure for next call
      vi.mocked(apiService.getPractitioners).mockRejectedValue(new Error('Network error'));

      // Change appointment type to trigger fetch
      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[0], { target: { value: '2' } });

      // Wait for error to appear
      await waitFor(() => {
        expect(screen.getByText('無法載入治療師列表，請稍後再試')).toBeInTheDocument();
      });
    });
  });

  describe('Auto-select assigned practitioner', () => {
    beforeEach(() => {
      vi.mocked(apiService.getPatient).mockResolvedValue({
        id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioner_ids: [2], // Patient has practitioner 2 assigned (different from original practitioner 1)
      });
    });

    it('should auto-select assigned practitioner when appointment type changes', async () => {
      const mockEvent: CalendarEvent = {
        ...mockAppointmentEvent,
        resource: {
          ...mockAppointmentEvent.resource,
          appointment_type_id: 1, // Original appointment type
          practitioner_id: 1, // Original practitioner (not assigned)
        },
      };

      vi.mocked(apiService.getPractitioners)
        .mockResolvedValueOnce([{ id: 1, full_name: 'Dr. Test' }]) // Type 1 - original practitioner
        .mockResolvedValueOnce([{ id: 2, full_name: 'Dr. Assigned' }, { id: 1, full_name: 'Dr. Test' }]); // Type 2 - has assigned practitioner

      renderWithModal(
        <EditAppointmentModal
          event={mockEvent}
          practitioners={mockPractitioners}
          appointmentTypes={[
            { id: 1, name: 'Type 1', duration_minutes: 30 },
            { id: 2, name: 'Type 2', duration_minutes: 60 },
          ]}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for form to load and patient to be fetched
      await waitFor(() => {
        expect(apiService.getPatient).toHaveBeenCalledWith(1);
      });

      // Wait for form to load (comboboxes should be present and enabled)
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects.length).toBeGreaterThanOrEqual(2);
        expect(selects[0]).not.toBeDisabled();
      });

      // Change appointment type to type 2
      const selects = screen.getAllByRole('combobox');
      const appointmentTypeSelect = selects[0];
      fireEvent.change(appointmentTypeSelect, { target: { value: '2' } });

      await waitFor(() => {
        expect(apiService.getPractitioners).toHaveBeenCalledWith(2, expect.any(AbortSignal));
      });

      // Verify practitioner 2 (assigned) is auto-selected
      await waitFor(() => {
        const practitionerSelect = screen.getAllByRole('combobox')[1];
        expect(practitionerSelect).toHaveValue('2');
      });
    });

    it('should not auto-select if user has manually selected a different practitioner', async () => {
      const mockEvent: CalendarEvent = {
        ...mockAppointmentEvent,
        resource: {
          ...mockAppointmentEvent.resource,
          appointment_type_id: 1,
          practitioner_id: 1,
        },
      };

      vi.mocked(apiService.getPractitioners).mockResolvedValue([
        { id: 1, full_name: 'Dr. Test' },
        { id: 2, full_name: 'Dr. Assigned' },
        { id: 3, full_name: 'Dr. Another' },
      ]);

      renderWithModal(
        <EditAppointmentModal
          event={mockEvent}
          practitioners={mockPractitioners}
          appointmentTypes={[
            { id: 1, name: 'Type 1', duration_minutes: 30 },
            { id: 2, name: 'Type 2', duration_minutes: 60 },
          ]}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for form to load
      await waitFor(() => {
        expect(apiService.getPatient).toHaveBeenCalledWith(1);
      });

      // Wait for form to load (comboboxes should be present and enabled)
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects.length).toBeGreaterThanOrEqual(2);
        expect(selects[0]).not.toBeDisabled();
      });

      // User manually selects practitioner 3
      const selects = screen.getAllByRole('combobox');
      const practitionerSelect = selects[1];
      fireEvent.change(practitionerSelect, { target: { value: '3' } });

      // Change appointment type (should not override user's selection)
      const appointmentTypeSelect = selects[0];
      fireEvent.change(appointmentTypeSelect, { target: { value: '2' } });

      await waitFor(() => {
        expect(apiService.getPractitioners).toHaveBeenCalledWith(2, expect.any(AbortSignal));
      });

      // Verify practitioner 3 (user's selection) is still selected, not auto-selected practitioner 2
      await waitFor(() => {
        expect(practitionerSelect).toHaveValue('3');
      });
    });

    it('should not auto-select on initial load (when original practitioner is set)', async () => {
      const mockEvent: CalendarEvent = {
        ...mockAppointmentEvent,
        resource: {
          ...mockAppointmentEvent.resource,
          appointment_type_id: 1,
          practitioner_id: 1, // Original practitioner (not assigned)
        },
      };

      vi.mocked(apiService.getPractitioners).mockResolvedValue([
        { id: 1, full_name: 'Dr. Test' },
        { id: 2, full_name: 'Dr. Assigned' },
      ]);

      renderWithModal(
        <EditAppointmentModal
          event={mockEvent}
          practitioners={mockPractitioners}
          appointmentTypes={[
            { id: 1, name: 'Type 1', duration_minutes: 30 },
          ]}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for form to load
      await waitFor(() => {
        expect(apiService.getPatient).toHaveBeenCalledWith(1);
      });

      // Wait for form to load (comboboxes should be present and enabled)
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects.length).toBeGreaterThanOrEqual(2);
        expect(selects[0]).not.toBeDisabled();
      });

      // Verify original practitioner 1 is still selected (not auto-selected to practitioner 2)
      const selects = screen.getAllByRole('combobox');
      const practitionerSelect = selects[1];
      expect(practitionerSelect).toHaveValue('1');
    });

    it('should not auto-select if assigned practitioner is not available for appointment type', async () => {
      const mockEvent: CalendarEvent = {
        ...mockAppointmentEvent,
        resource: {
          ...mockAppointmentEvent.resource,
          appointment_type_id: 1,
          practitioner_id: 1,
        },
      };

      // Appointment type 2 only offers practitioner 3, not the assigned practitioner 2
      vi.mocked(apiService.getPractitioners)
        .mockResolvedValueOnce([{ id: 1, full_name: 'Dr. Test' }]) // Type 1
        .mockResolvedValueOnce([{ id: 3, full_name: 'Dr. Another' }]); // Type 2 - no assigned practitioner

      renderWithModal(
        <EditAppointmentModal
          event={mockEvent}
          practitioners={mockPractitioners}
          appointmentTypes={[
            { id: 1, name: 'Type 1', duration_minutes: 30 },
            { id: 2, name: 'Type 2', duration_minutes: 60 },
          ]}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
        />
      );

      // Wait for form to load
      await waitFor(() => {
        expect(apiService.getPatient).toHaveBeenCalledWith(1);
      });

      // Wait for form to load (comboboxes should be present and enabled)
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects.length).toBeGreaterThanOrEqual(2);
        expect(selects[0]).not.toBeDisabled();
      });

      // Change appointment type to type 2
      const selects = screen.getAllByRole('combobox');
      const appointmentTypeSelect = selects[0];
      fireEvent.change(appointmentTypeSelect, { target: { value: '2' } });

      await waitFor(() => {
        expect(apiService.getPractitioners).toHaveBeenCalledWith(2, expect.any(AbortSignal));
      });

      // Verify no practitioner is auto-selected (assigned practitioner not available)
      // Note: Original practitioner 1 is also cleared because it's not available for type 2
      await waitFor(() => {
        const practitionerSelect = screen.getAllByRole('combobox')[1];
        expect(practitionerSelect).toHaveValue(''); // Cleared because original practitioner not available for new type
      });
    });
  });
});

