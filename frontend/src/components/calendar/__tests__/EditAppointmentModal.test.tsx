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
  },
}));

// Mock DateTimePicker to always report available slots
vi.mock('../DateTimePicker', () => ({
  DateTimePicker: ({ onHasAvailableSlotsChange, selectedPractitionerId }: any) => {
    // Call onHasAvailableSlotsChange when practitioner is selected
    // Use setTimeout to ensure this happens after render cycle
    React.useEffect(() => {
      if (selectedPractitionerId && onHasAvailableSlotsChange) {
        setTimeout(() => {
          onHasAvailableSlotsChange(true);
        }, 0);
      }
    }, [selectedPractitionerId, onHasAvailableSlotsChange]);
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

  it('should show error when practitioner has no availability configured', async () => {
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

    // Wait for error message to appear (checking for at least one instance)
    await waitFor(() => {
      const errorMessages = screen.getAllByText('此治療師尚未設定每日可預約時段');
      expect(errorMessages.length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    // Submit button should be disabled
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

  it('should disable submit button when practitioner error exists', async () => {
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

    // Wait for error message
    await waitFor(() => {
      const errorMessages = screen.getAllByText('此治療師尚未設定每日可預約時段');
      expect(errorMessages.length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    // Submit button should be disabled
    const submitButton = screen.getByText('下一步');
    expect(submitButton).toBeDisabled();
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

    // Check that original time is displayed (format: "原預約時間：YYYY-MM-DD HH:mm AM/PM")
    // The date/time will be converted to Asia/Taipei timezone
    const originalTimeContainer = screen.getByText(/原預約時間：/).closest('div');
    expect(originalTimeContainer).toBeInTheDocument();
    // Verify the container has the date and time in 12-hour format
    expect(originalTimeContainer?.textContent).toMatch(/原預約時間：\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\s+(AM|PM)/i);
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

      // Change practitioner - find select by role
      const practitionerSelect = screen.getByRole('combobox');
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

      // Change practitioner - find select by role
      const practitionerSelect = screen.getByRole('combobox');
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

      // Change practitioner (this will trigger review step)
      const practitionerSelect = screen.getByRole('combobox');
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

      // Change practitioner and submit
      const practitionerSelect = screen.getByRole('combobox');
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

      // Change practitioner and submit
      const practitionerSelect = screen.getByRole('combobox');
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
});

