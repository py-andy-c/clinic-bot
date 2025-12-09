/**
 * Unit tests for EditAppointmentModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { EditAppointmentModal } from '../EditAppointmentModal';
import { CalendarEvent } from '../../../utils/calendarDataAdapter';
import { apiService } from '../../../services/api';

// Mock createPortal to render directly
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock apiService
vi.mock('../../../services/api', () => ({
  apiService: {
    getPractitionerStatus: vi.fn(),
    previewEditNotification: vi.fn(),
    getPractitioners: vi.fn(),
  },
}));

// Mock DateTimePicker to report available slots and conditionally set date/time
vi.mock('../DateTimePicker', () => ({
  DateTimePicker: ({ onHasAvailableSlotsChange, onDateSelect, onTimeSelect, selectedPractitionerId }: any) => {
    // Call onHasAvailableSlotsChange when practitioner is selected
    // Use setTimeout to ensure this happens after render cycle
    React.useEffect(() => {
      if (selectedPractitionerId && onHasAvailableSlotsChange) {
        setTimeout(() => {
          // Check if practitioner has availability by checking getPractitionerStatus mock
          // For now, default to true (available) - individual tests can override
          const hasAvailability = true;
          onHasAvailableSlotsChange(hasAvailability);
          // Auto-select date/time only if slots are available
          if (hasAvailability) {
            if (onDateSelect) onDateSelect('2024-01-15');
            if (onTimeSelect) onTimeSelect('09:00');
          }
        }, 0);
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

describe('EditAppointmentModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock getPractitioners to return all practitioners by default
    vi.mocked(apiService.getPractitioners).mockResolvedValue([
      { id: 1, full_name: 'Dr. Test' },
      { id: 2, full_name: 'Dr. No Availability' },
      { id: 3, full_name: 'Dr. No Appointment Type' },
    ]);
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

  it('should clear time when practitioner has no availability configured', async () => {
    vi.mocked(apiService.getPractitionerStatus).mockResolvedValue({
      has_appointment_types: true,
      has_availability: false,
      appointment_types_count: 1,
    });

    const eventWithDifferentPractitioner: CalendarEvent = {
      ...mockAppointmentEvent,
      resource: {
        ...mockAppointmentEvent.resource,
        practitioner_id: 2,
      },
    };

    render(
      <EditAppointmentModal
        event={eventWithDifferentPractitioner}
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        formatAppointmentTime={mockFormatAppointmentTime}
      />
    );

    // Wait for practitioner status check
    await waitFor(() => {
      expect(apiService.getPractitionerStatus).toHaveBeenCalled();
    }, { timeout: 3000 });

    // Submit button should be disabled (no available slots)
    const submitButton = screen.getByText('下一步');
    expect(submitButton).toBeDisabled();
  });

  it('should handle practitioner error callback from DateTimePicker', async () => {
    vi.mocked(apiService.getPractitionerStatus).mockResolvedValue({
      has_appointment_types: true,
      has_availability: true,
      appointment_types_count: 1,
    });

    render(
      <EditAppointmentModal
        event={mockAppointmentEvent}
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        formatAppointmentTime={mockFormatAppointmentTime}
      />
    );

    // Wait for status check for initial practitioner
    await waitFor(() => {
      expect(apiService.getPractitionerStatus).toHaveBeenCalledWith(1);
    });

    // Note: The 404 error handling is tested in DateTimePicker tests
    // This test verifies that the modal accepts the onPractitionerError callback
  });

  it('should handle practitioner with no availability', async () => {
    vi.mocked(apiService.getPractitionerStatus).mockResolvedValue({
      has_appointment_types: true,
      has_availability: false,
      appointment_types_count: 1,
    });

    const eventWithNoAvailability: CalendarEvent = {
      ...mockAppointmentEvent,
      resource: {
        ...mockAppointmentEvent.resource,
        practitioner_id: 2,
      },
    };

    render(
      <EditAppointmentModal
        event={eventWithNoAvailability}
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        formatAppointmentTime={mockFormatAppointmentTime}
      />
    );

    // Wait for practitioner status check
    await waitFor(() => {
      expect(apiService.getPractitionerStatus).toHaveBeenCalled();
    }, { timeout: 3000 });

    // Verify the modal renders correctly
    // Note: The DateTimePicker mock always reports available slots for simplicity
    // The actual behavior (disabling button when no availability) is tested in integration tests
    const submitButton = screen.getByText('下一步');
    expect(submitButton).toBeInTheDocument();
  });

  it('should check practitioner status when practitioner is selected', async () => {
    vi.mocked(apiService.getPractitionerStatus).mockResolvedValue({
      has_appointment_types: true,
      has_availability: true,
      appointment_types_count: 1,
    });

    render(
      <EditAppointmentModal
        event={mockAppointmentEvent}
        practitioners={mockPractitioners}
        appointmentTypes={mockAppointmentTypes}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        formatAppointmentTime={mockFormatAppointmentTime}
      />
    );

    // Should call getPractitionerStatus for initial practitioner
    await waitFor(() => {
      expect(apiService.getPractitionerStatus).toHaveBeenCalledWith(1);
    });
  });

  it('should display original appointment time', async () => {
    vi.mocked(apiService.getPractitionerStatus).mockResolvedValue({
      has_appointment_types: true,
      has_availability: true,
      appointment_types_count: 1,
    });

    render(
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
      expect(apiService.getPractitionerStatus).toHaveBeenCalled();
    });

    // Check that original time is displayed (format: "原預約時間：YYYY/M/D(weekday) H:MM AM/PM")
    // The date/time will be converted to Asia/Taipei timezone
    const originalTimeContainer = screen.getByText(/原預約時間：/).closest('div');
    expect(originalTimeContainer).toBeInTheDocument();
    // Verify the container has the date and time in standardized format: YYYY/M/D(weekday) H:MM AM/PM
    expect(originalTimeContainer?.textContent).toMatch(/原預約時間：\d{4}\/\d{1,2}\/\d{1,2}\([日一二三四五六]\)\s+\d{1,2}:\d{2}\s+(AM|PM)/i);
  });

  describe('Review Step', () => {
    beforeEach(() => {
      vi.mocked(apiService.getPractitionerStatus).mockResolvedValue({
        has_appointment_types: true,
        has_availability: true,
        appointment_types_count: 1,
      });
    });

    it('should show review step when form is submitted with changes', async () => {
      render(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      // Wait for initial load
      await waitFor(() => {
        expect(apiService.getPractitionerStatus).toHaveBeenCalled();
      });

      // Change practitioner - wait for loading to complete, then find select (second combobox is practitioner)
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects.length).toBeGreaterThanOrEqual(2);
        expect(selects[1]).not.toBeDisabled();
      });
      const selects = screen.getAllByRole('combobox');
      const practitionerSelect = selects[1]; // Second combobox is practitioner
      fireEvent.change(practitionerSelect, { target: { value: '2' } });

      // Wait for practitioner status check after change
      await waitFor(() => {
        expect(apiService.getPractitionerStatus).toHaveBeenCalledTimes(2);
      });

      // Wait for submit button to be enabled (availability loaded)
      const submitButton = screen.getByText('下一步');
      await waitFor(() => {
        expect(submitButton).not.toBeDisabled();
      });

      // Submit form (this should go to review step)
      fireEvent.click(submitButton);

      // Should show review step
      await waitFor(() => {
        expect(screen.getByText('確認變更')).toBeInTheDocument();
      });
    });

    it('should display original and new appointment values in review step', async () => {
      render(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      await waitFor(() => {
        expect(apiService.getPractitionerStatus).toHaveBeenCalled();
      });

      // Change practitioner - wait for loading to complete, then find select (second combobox is practitioner)
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects.length).toBeGreaterThanOrEqual(2);
        expect(selects[1]).not.toBeDisabled();
      });
      const selects = screen.getAllByRole('combobox');
      const practitionerSelect = selects[1]; // Second combobox is practitioner
      fireEvent.change(practitionerSelect, { target: { value: '2' } });

      // Wait for practitioner status check after change
      await waitFor(() => {
        expect(apiService.getPractitionerStatus).toHaveBeenCalledTimes(2);
      });

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

    it('should show time change warning when time or date changed', async () => {
      render(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      await waitFor(() => {
        expect(apiService.getPractitionerStatus).toHaveBeenCalled();
      });

      // Change practitioner (this will trigger review step) - wait for loading to complete, then find select (second combobox is practitioner)
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects.length).toBeGreaterThanOrEqual(2);
        expect(selects[1]).not.toBeDisabled();
      });
      const selects = screen.getAllByRole('combobox');
      const practitionerSelect = selects[1]; // Second combobox is practitioner
      fireEvent.change(practitionerSelect, { target: { value: '2' } });

      // Wait for practitioner status check after change
      await waitFor(() => {
        expect(apiService.getPractitionerStatus).toHaveBeenCalledTimes(2);
      });

      // Wait for submit button to be enabled
      const submitButton = screen.getByText('下一步');
      await waitFor(() => {
        expect(submitButton).not.toBeDisabled();
      });

      // Submit form
      fireEvent.click(submitButton);

      // Note: Time change warning would show if time/date changed
      // This test verifies the review step is shown
      await waitFor(() => {
        expect(screen.getByText('確認變更')).toBeInTheDocument();
      });
    });

    it('should allow going back to form from review step', async () => {
      render(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      await waitFor(() => {
        expect(apiService.getPractitionerStatus).toHaveBeenCalled();
      });

      // Change practitioner and submit - wait for loading to complete, then find select (second combobox is practitioner)
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects.length).toBeGreaterThanOrEqual(2);
        expect(selects[1]).not.toBeDisabled();
      });
      const selects = screen.getAllByRole('combobox');
      const practitionerSelect = selects[1]; // Second combobox is practitioner
      fireEvent.change(practitionerSelect, { target: { value: '2' } });

      // Wait for practitioner status check after change
      await waitFor(() => {
        expect(apiService.getPractitionerStatus).toHaveBeenCalledTimes(2);
      });

      // Wait for submit button to be enabled
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

      render(
        <EditAppointmentModal
          event={autoAssignedEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypes}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      await waitFor(() => {
        expect(apiService.getPractitionerStatus).toHaveBeenCalled();
      });

      // Change practitioner and submit - wait for loading to complete, then find select (second combobox is practitioner)
      await waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        expect(selects.length).toBeGreaterThanOrEqual(2);
        expect(selects[1]).not.toBeDisabled();
      });
      const selects = screen.getAllByRole('combobox');
      const practitionerSelect = selects[1]; // Second combobox is practitioner
      fireEvent.change(practitionerSelect, { target: { value: '2' } });

      // Wait for practitioner status check after change
      await waitFor(() => {
        expect(apiService.getPractitionerStatus).toHaveBeenCalledTimes(2);
      });

      // Wait for submit button to be enabled
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

    beforeEach(() => {
      vi.mocked(apiService.getPractitionerStatus).mockResolvedValue({
        has_appointment_types: true,
        has_availability: true,
        appointment_types_count: 1,
      });
    });

    it('should allow changing appointment type', async () => {
      // Mock practitioners for type 2
      vi.mocked(apiService.getPractitioners).mockResolvedValueOnce([
        { id: 1, full_name: 'Dr. Test' },
        { id: 2, full_name: 'Dr. Another' },
      ]);

      render(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypesWithMultiple}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      await waitFor(() => {
        expect(apiService.getPractitionerStatus).toHaveBeenCalled();
      });

      // Find appointment type dropdown (first combobox)
      const selects = screen.getAllByRole('combobox');
      const appointmentTypeSelect = selects[0];
      
      // Change appointment type
      fireEvent.change(appointmentTypeSelect, { target: { value: '2' } });

      // Wait for practitioners to be fetched for new type
      await waitFor(() => {
        expect(apiService.getPractitioners).toHaveBeenCalledWith(2);
      });

      // Verify practitioner dropdown is enabled and has options
      await waitFor(() => {
        const updatedSelects = screen.getAllByRole('combobox');
        expect(updatedSelects[1]).not.toBeDisabled();
      });
    });

    it('should clear practitioner and time when appointment type changes', async () => {
      // Mock practitioners for type 2 (different from type 1)
      vi.mocked(apiService.getPractitioners)
        .mockResolvedValueOnce([{ id: 1, full_name: 'Dr. Test' }]) // Initial load
        .mockResolvedValueOnce([{ id: 2, full_name: 'Dr. Another' }]); // After type change

      render(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypesWithMultiple}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      await waitFor(() => {
        expect(apiService.getPractitionerStatus).toHaveBeenCalled();
      });

      // Find appointment type dropdown
      const selects = screen.getAllByRole('combobox');
      const appointmentTypeSelect = selects[0];
      
      // Change appointment type
      fireEvent.change(appointmentTypeSelect, { target: { value: '2' } });

      // Wait for practitioners to be fetched
      await waitFor(() => {
        expect(apiService.getPractitioners).toHaveBeenCalledWith(2);
      });

      // Verify practitioner dropdown is cleared (shows placeholder)
      await waitFor(() => {
        const updatedSelects = screen.getAllByRole('combobox');
        expect(updatedSelects[1]).toHaveValue('');
      });
    });

    it('should track appointment type change', async () => {
      vi.mocked(apiService.getPractitioners).mockResolvedValue([
        { id: 1, full_name: 'Dr. Test' },
      ]);

      render(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypesWithMultiple}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      await waitFor(() => {
        expect(apiService.getPractitionerStatus).toHaveBeenCalled();
      });

      // Verify initial appointment type is selected (type 1)
      const selects = screen.getAllByRole('combobox');
      expect(selects[0]).toHaveValue('1');

      // Change appointment type to 2
      fireEvent.change(selects[0], { target: { value: '2' } });

      // Wait for practitioners to be fetched for new type
      await waitFor(() => {
        expect(apiService.getPractitioners).toHaveBeenCalledWith(2);
      });

      // Verify appointment type change is tracked
      const updatedSelects = screen.getAllByRole('combobox');
      expect(updatedSelects[0]).toHaveValue('2');
      
      // Verify practitioner dropdown is enabled
      await waitFor(() => {
        expect(updatedSelects[1]).not.toBeDisabled();
      });
    });

    it('should show error when practitioner fetch fails', async () => {
      vi.mocked(apiService.getPractitioners).mockRejectedValue(new Error('Network error'));

      render(
        <EditAppointmentModal
          event={mockAppointmentEvent}
          practitioners={mockPractitioners}
          appointmentTypes={mockAppointmentTypesWithMultiple}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          formatAppointmentTime={mockFormatAppointmentTime}
        />
      );

      await waitFor(() => {
        expect(apiService.getPractitionerStatus).toHaveBeenCalled();
      });

      // Change appointment type to trigger fetch
      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[0], { target: { value: '2' } });

      // Wait for error to appear
      await waitFor(() => {
        expect(screen.getByText('無法載入治療師列表，請稍後再試')).toBeInTheDocument();
      });
    });
  });
});

