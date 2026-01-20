import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppointmentModalProps } from '../useAppointmentModalProps';
import { CalendarEvent } from '../../utils/calendarDataAdapter';

describe('useAppointmentModalProps', () => {
  const mockEvent: CalendarEvent = {
    id: 1,
    title: 'Test Appointment',
    start: new Date('2024-01-15T10:00:00'),
    end: new Date('2024-01-15T11:00:00'),
    patientName: 'Test Patient',
    resource: {
      practitioner_id: 1,
      resource_id: null,
      type: 'appointment',
      appointment_type_id: 1,
      clinic_notes: 'Test clinic notes',
      patient_id: 1,
    },
    notes: 'Test notes',
    patient_id: 1,
    appointment_type_id: 1,
    clinic_notes: 'Test clinic notes',
  };

  const mockCanEditEvent = vi.fn();
  const mockCanDuplicateEvent = vi.fn();
  const mockHandleEditAppointment = vi.fn();
  const mockHandleDeleteAppointment = vi.fn();
  const mockHandleDuplicateAppointment = vi.fn();

  const defaultOptions = {
    selectedEvent: mockEvent,
    canEditEvent: mockCanEditEvent,
    canDuplicateEvent: mockCanDuplicateEvent,
    handleEditAppointment: mockHandleEditAppointment,
    handleDeleteAppointment: mockHandleDeleteAppointment,
    handleDuplicateAppointment: mockHandleDuplicateAppointment,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('eventModalProps', () => {
    it('should include all handlers when user has full permissions', () => {
      mockCanEditEvent.mockReturnValue(true);
      mockCanDuplicateEvent.mockReturnValue(true);

      const { result } = renderHook(() =>
        useAppointmentModalProps(defaultOptions)
      );

      expect(result.current.eventModalProps.onEditAppointment).toBe(mockHandleEditAppointment);
      expect(result.current.eventModalProps.onDeleteAppointment).toBe(mockHandleDeleteAppointment);
      expect(result.current.eventModalProps.onDuplicateAppointment).toBe(mockHandleDuplicateAppointment);
    });

    it('should exclude edit/delete handlers when user cannot edit', () => {
      mockCanEditEvent.mockReturnValue(false);
      mockCanDuplicateEvent.mockReturnValue(true);

      const { result } = renderHook(() =>
        useAppointmentModalProps(defaultOptions)
      );

      expect(result.current.eventModalProps.onEditAppointment).toBeUndefined();
      expect(result.current.eventModalProps.onDeleteAppointment).toBeUndefined();
      expect(result.current.eventModalProps.onDuplicateAppointment).toBe(mockHandleDuplicateAppointment);
    });

    it('should exclude duplicate handler when user cannot duplicate', () => {
      mockCanEditEvent.mockReturnValue(true);
      mockCanDuplicateEvent.mockReturnValue(false);

      const { result } = renderHook(() =>
        useAppointmentModalProps(defaultOptions)
      );

      expect(result.current.eventModalProps.onEditAppointment).toBe(mockHandleEditAppointment);
      expect(result.current.eventModalProps.onDeleteAppointment).toBe(mockHandleDeleteAppointment);
      expect(result.current.eventModalProps.onDuplicateAppointment).toBeUndefined();
    });

    it('should exclude all handlers when user has no permissions', () => {
      mockCanEditEvent.mockReturnValue(false);
      mockCanDuplicateEvent.mockReturnValue(false);

      const { result } = renderHook(() =>
        useAppointmentModalProps(defaultOptions)
      );

      expect(result.current.eventModalProps.onEditAppointment).toBeUndefined();
      expect(result.current.eventModalProps.onDeleteAppointment).toBeUndefined();
      expect(result.current.eventModalProps.onDuplicateAppointment).toBeUndefined();
    });

    it('should handle null selected event', () => {
      // When selectedEvent is null, permission checkers should still be called but return false
      mockCanEditEvent.mockReturnValue(false);
      mockCanDuplicateEvent.mockReturnValue(false);

      const { result } = renderHook(() =>
        useAppointmentModalProps({ ...defaultOptions, selectedEvent: null })
      );

      expect(result.current.eventModalProps.onEditAppointment).toBeUndefined();
      expect(result.current.eventModalProps.onDeleteAppointment).toBeUndefined();
      expect(result.current.eventModalProps.onDuplicateAppointment).toBeUndefined();

      expect(mockCanEditEvent).toHaveBeenCalledWith(null);
      expect(mockCanDuplicateEvent).toHaveBeenCalledWith(null);
    });

    it('should call permission checkers with selected event', () => {
      mockCanEditEvent.mockReturnValue(true);
      mockCanDuplicateEvent.mockReturnValue(true);

      renderHook(() =>
        useAppointmentModalProps(defaultOptions)
      );

      expect(mockCanEditEvent).toHaveBeenCalledWith(mockEvent);
      expect(mockCanDuplicateEvent).toHaveBeenCalledWith(mockEvent);
    });
  });
});