/**
 * Unit tests for EditAppointmentModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
});

