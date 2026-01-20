import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppointmentPermissions } from '../useAppointmentPermissions';
import { CalendarEvent } from '../../utils/calendarDataAdapter';

// Mock the appointment permissions utilities
vi.mock('../../utils/appointmentPermissions', () => ({
  canEditAppointment: vi.fn(),
  canDuplicateAppointment: vi.fn(),
  getPractitionerIdForDuplicate: vi.fn(),
}));

import { canEditAppointment, canDuplicateAppointment, getPractitionerIdForDuplicate } from '../../utils/appointmentPermissions';

describe('useAppointmentPermissions', () => {
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

  const defaultPermissions = {
    canEdit: true,
    isAdmin: false,
    userId: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('canEditEvent', () => {
    it('should return false when user cannot edit', () => {
      const { result } = renderHook(() =>
        useAppointmentPermissions({ ...defaultPermissions, canEdit: false })
      );

      const canEdit = result.current.canEditEvent(mockEvent);
      expect(canEdit).toBe(false);
    });

    it('should delegate to canEditAppointment for appointment events', () => {
      const mockCanEditAppointment = vi.mocked(canEditAppointment);
      mockCanEditAppointment.mockReturnValue(true);

      const { result } = renderHook(() =>
        useAppointmentPermissions(defaultPermissions)
      );

      const canEdit = result.current.canEditEvent(mockEvent);

      expect(mockCanEditAppointment).toHaveBeenCalledWith(mockEvent, 1, false);
      expect(canEdit).toBe(true);
    });

    it('should check ownership for non-appointment events', () => {
      const nonAppointmentEvent = {
        ...mockEvent,
        resource: { ...mockEvent.resource, type: 'availability_exception' },
      };

      const { result } = renderHook(() =>
        useAppointmentPermissions(defaultPermissions)
      );

      const canEdit = result.current.canEditEvent(nonAppointmentEvent);
      expect(canEdit).toBe(true); // userId (1) matches practitioner_id (1)
    });

    it('should return false for non-appointment events when user does not own them', () => {
      const nonAppointmentEvent = {
        ...mockEvent,
        resource: {
          ...mockEvent.resource,
          type: 'availability_exception',
          practitioner_id: 2 // Different practitioner
        },
      };

      const { result } = renderHook(() =>
        useAppointmentPermissions(defaultPermissions)
      );

      const canEdit = result.current.canEditEvent(nonAppointmentEvent);
      expect(canEdit).toBe(false);
    });

    it('should return false for null event', () => {
      const { result } = renderHook(() =>
        useAppointmentPermissions(defaultPermissions)
      );

      const canEdit = result.current.canEditEvent(null);
      expect(canEdit).toBe(false);
    });
  });

  describe('canDuplicateEvent', () => {
    it('should delegate to canDuplicateAppointment utility', () => {
      const mockCanDuplicateAppointment = vi.mocked(canDuplicateAppointment);
      mockCanDuplicateAppointment.mockReturnValue(true);

      const { result } = renderHook(() =>
        useAppointmentPermissions(defaultPermissions)
      );

      const canDuplicate = result.current.canDuplicateEvent(mockEvent);

      expect(mockCanDuplicateAppointment).toHaveBeenCalledWith(mockEvent);
      expect(canDuplicate).toBe(true);
    });
  });

  describe('getPractitionerIdForDuplicateEvent', () => {
    it('should delegate to getPractitionerIdForDuplicate utility', () => {
      const mockGetPractitionerIdForDuplicate = vi.mocked(getPractitionerIdForDuplicate);
      mockGetPractitionerIdForDuplicate.mockReturnValue(2);

      const { result } = renderHook(() =>
        useAppointmentPermissions(defaultPermissions)
      );

      const practitionerId = result.current.getPractitionerIdForDuplicateEvent(mockEvent);

      expect(mockGetPractitionerIdForDuplicate).toHaveBeenCalledWith(mockEvent, false);
      expect(practitionerId).toBe(2);
    });
  });
});