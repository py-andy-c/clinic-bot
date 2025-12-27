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
    getAppointmentResources: vi.fn().mockResolvedValue({ resources: [] }),
  },
}));

// Mock DateTimePicker to report available slots and conditionally set date/time
vi.mock('../DateTimePicker', () => ({
  DateTimePicker: ({ onHasAvailableSlotsChange, onDateSelect, onTimeSelect, selectedPractitionerId }: any) => {
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

  it('should accept edit props without crashing', () => {
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

    expect(screen.getByText('調整預約')).toBeInTheDocument();
  });

  it('should display original appointment time', async () => {
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
      expect(screen.getByText(/原預約時間：/)).toBeInTheDocument();
    });

    const originalTimeContainer = screen.getByText(/原預約時間：/).closest('div');
    expect(originalTimeContainer).toBeInTheDocument();
    expect(originalTimeContainer?.textContent).toMatch(/原預約時間：\d{4}\/\d{1,2}\/\d{1,2}\([日一二三四五六]\)\s+\d{2}:\d{2}/i);
  });

  describe('Review Step', () => {
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

      // Wait for loading to finish
      await waitFor(() => {
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
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

      // Wait for loading to finish
      await waitFor(() => {
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
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

      // Wait for loading to finish
      await waitFor(() => {
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
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

      // Wait for loading to finish
      await waitFor(() => {
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
});

