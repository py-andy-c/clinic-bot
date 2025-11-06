/**
 * Unit tests for EventModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventModal } from '../EventModal';
import { CalendarEvent } from '../../../utils/calendarDataAdapter';

// Mock createPortal to render directly
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

const mockFormatAppointmentTime = vi.fn((start: Date, end: Date) => 
  `${start.toLocaleDateString()} ${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}`
);

describe('EventModal', () => {
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
      appointment_type_name: 'Test Type',
      practitioner_name: 'Dr. Test',
      patient_name: 'Patient Test',
      patient_phone: '0912345678',
      line_display_name: 'LINE User',
      notes: 'Test notes',
    },
  };

  const mockExceptionEvent: CalendarEvent = {
    title: '休診',
    start: new Date('2024-01-15T09:00:00'),
    end: new Date('2024-01-15T10:00:00'),
    resource: {
      type: 'availability_exception',
      exception_id: 1,
    },
  };

  it('should render appointment event details', () => {
    const onClose = vi.fn();
    render(
      <EventModal
        event={mockAppointmentEvent}
        onClose={onClose}
        formatAppointmentTime={mockFormatAppointmentTime}
      />
    );

    expect(screen.getByText('Test Appointment')).toBeInTheDocument();
    expect(screen.getByText(/時間:/)).toBeInTheDocument();
    expect(screen.getByText('Test notes')).toBeInTheDocument();
    expect(screen.getByText('0912345678')).toBeInTheDocument();
    expect(screen.getByText('LINE User')).toBeInTheDocument();
  });

  it('should render exception event details', () => {
    const onClose = vi.fn();
    render(
      <EventModal
        event={mockExceptionEvent}
        onClose={onClose}
        formatAppointmentTime={mockFormatAppointmentTime}
      />
    );

    expect(screen.getByText('休診')).toBeInTheDocument();
    expect(screen.getByText(/時間:/)).toBeInTheDocument();
  });

  it('should call formatAppointmentTime with correct dates', () => {
    const onClose = vi.fn();
    render(
      <EventModal
        event={mockAppointmentEvent}
        onClose={onClose}
        formatAppointmentTime={mockFormatAppointmentTime}
      />
    );

    expect(mockFormatAppointmentTime).toHaveBeenCalledWith(
      mockAppointmentEvent.start,
      mockAppointmentEvent.end
    );
  });

  it('should show delete button for appointments when onDeleteAppointment is provided', () => {
    const onClose = vi.fn();
    const onDeleteAppointment = vi.fn();
    
    render(
      <EventModal
        event={mockAppointmentEvent}
        onClose={onClose}
        onDeleteAppointment={onDeleteAppointment}
        formatAppointmentTime={mockFormatAppointmentTime}
      />
    );

    const deleteButton = screen.getByText('刪除預約');
    expect(deleteButton).toBeInTheDocument();
    
    deleteButton.click();
    expect(onDeleteAppointment).toHaveBeenCalledTimes(1);
  });

  it('should show delete button for exceptions when onDeleteException is provided', () => {
    const onClose = vi.fn();
    const onDeleteException = vi.fn();
    
    render(
      <EventModal
        event={mockExceptionEvent}
        onClose={onClose}
        onDeleteException={onDeleteException}
        formatAppointmentTime={mockFormatAppointmentTime}
      />
    );

    const deleteButton = screen.getByText('刪除');
    expect(deleteButton).toBeInTheDocument();
    
    deleteButton.click();
    expect(onDeleteException).toHaveBeenCalledTimes(1);
  });

  it('should call onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <EventModal
        event={mockAppointmentEvent}
        onClose={onClose}
        formatAppointmentTime={mockFormatAppointmentTime}
      />
    );

    const closeButton = screen.getByText('關閉');
    closeButton.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should not show optional fields when they are missing', () => {
    const eventWithoutOptional: CalendarEvent = {
      ...mockAppointmentEvent,
      resource: {
        ...mockAppointmentEvent.resource,
        notes: undefined,
        patient_phone: undefined,
        line_display_name: undefined,
      },
    };

    const onClose = vi.fn();
    render(
      <EventModal
        event={eventWithoutOptional}
        onClose={onClose}
        formatAppointmentTime={mockFormatAppointmentTime}
      />
    );

    expect(screen.queryByText(/備註:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/電話:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/LINE:/)).not.toBeInTheDocument();
  });
});

