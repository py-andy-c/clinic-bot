/**
 * Unit tests for appointment permission utility functions
 */

import { describe, it, expect } from 'vitest';
import { CalendarEvent } from '../calendarDataAdapter';
import {
  canEditAppointment,
  canDuplicateAppointment,
  getPractitionerIdForDuplicate,
} from '../appointmentPermissions';

describe('appointmentPermissions', () => {
  const createMockAppointment = (
    overrides: Partial<CalendarEvent['resource']> = {}
  ): CalendarEvent => ({
    id: 1,
    title: 'Test Appointment',
    start: new Date('2024-01-15T10:00:00'),
    end: new Date('2024-01-15T11:00:00'),
    resource: {
      type: 'appointment',
      calendar_event_id: 1,
      patient_id: 1,
      appointment_type_id: 1,
      status: 'confirmed',
      ...overrides,
    },
  });

  describe('canEditAppointment', () => {
    it('should return false for null event', () => {
      expect(canEditAppointment(null, 1, false)).toBe(false);
    });

    it('should return false for non-appointment events', () => {
      const event: CalendarEvent = {
        id: 1,
        title: 'Test',
        start: new Date(),
        end: new Date(),
        resource: {
          type: 'availability_exception',
          exception_id: 1,
        },
      };
      expect(canEditAppointment(event, 1, false)).toBe(false);
    });

    it('should return true for admin with any appointment', () => {
      const event = createMockAppointment({
        practitioner_id: 999, // Different practitioner
        is_auto_assigned: true,
      });
      expect(canEditAppointment(event, 1, true)).toBe(true);
    });

    it('should return false for practitioner with auto-assigned appointment (even if assigned to them)', () => {
      const event = createMockAppointment({
        practitioner_id: 1, // Same as userId
        is_auto_assigned: true,
      });
      expect(canEditAppointment(event, 1, false)).toBe(false);
    });

    it('should return true for practitioner with own non-auto-assigned appointment', () => {
      const event = createMockAppointment({
        practitioner_id: 1, // Same as userId
        is_auto_assigned: false,
      });
      expect(canEditAppointment(event, 1, false)).toBe(true);
    });

    it('should return false for practitioner with others appointment', () => {
      const event = createMockAppointment({
        practitioner_id: 999, // Different practitioner
        is_auto_assigned: false,
      });
      expect(canEditAppointment(event, 1, false)).toBe(false);
    });

    it('should return true for practitioner with own appointment when practitioner_id is undefined but matches userId', () => {
      const event = createMockAppointment({
        practitioner_id: undefined,
        is_auto_assigned: false,
      });
      // When practitioner_id is undefined, it falls back to userId
      expect(canEditAppointment(event, 1, false)).toBe(true);
    });

    it('should return false for practitioner with auto-assigned appointment when practitioner_id is null', () => {
      const event = createMockAppointment({
        practitioner_id: null,
        is_auto_assigned: true,
      });
      expect(canEditAppointment(event, 1, false)).toBe(false);
    });
  });

  describe('canDuplicateAppointment', () => {
    it('should return false for null event', () => {
      expect(canDuplicateAppointment(null)).toBe(false);
    });

    it('should return false for non-appointment events', () => {
      const event: CalendarEvent = {
        id: 1,
        title: 'Test',
        start: new Date(),
        end: new Date(),
        resource: {
          type: 'availability_exception',
          exception_id: 1,
        },
      };
      expect(canDuplicateAppointment(event)).toBe(false);
    });

    it('should return true for any appointment (no ownership check)', () => {
      const event = createMockAppointment({
        practitioner_id: 999, // Different practitioner
        is_auto_assigned: true,
      });
      expect(canDuplicateAppointment(event)).toBe(true);
    });

    it('should return true for own appointment', () => {
      const event = createMockAppointment({
        practitioner_id: 1,
        is_auto_assigned: false,
      });
      expect(canDuplicateAppointment(event)).toBe(true);
    });

    it('should return true for auto-assigned appointment', () => {
      const event = createMockAppointment({
        practitioner_id: null,
        is_auto_assigned: true,
      });
      expect(canDuplicateAppointment(event)).toBe(true);
    });
  });

  describe('getPractitionerIdForDuplicate', () => {
    it('should return undefined for null event', () => {
      expect(getPractitionerIdForDuplicate(null, false)).toBeUndefined();
    });

    it('should return undefined for non-appointment events', () => {
      const event: CalendarEvent = {
        id: 1,
        title: 'Test',
        start: new Date(),
        end: new Date(),
        resource: {
          type: 'availability_exception',
          exception_id: 1,
        },
      };
      expect(getPractitionerIdForDuplicate(event, false)).toBeUndefined();
    });

    it('should return practitioner_id for admin with auto-assigned appointment', () => {
      const event = createMockAppointment({
        practitioner_id: 999,
        is_auto_assigned: true,
      });
      expect(getPractitionerIdForDuplicate(event, true)).toBe(999);
    });

    it('should return undefined for practitioner with auto-assigned appointment', () => {
      const event = createMockAppointment({
        practitioner_id: 999,
        is_auto_assigned: true,
      });
      expect(getPractitionerIdForDuplicate(event, false)).toBeUndefined();
    });

    it('should return practitioner_id for practitioner with non-auto-assigned appointment', () => {
      const event = createMockAppointment({
        practitioner_id: 999,
        is_auto_assigned: false,
      });
      expect(getPractitionerIdForDuplicate(event, false)).toBe(999);
    });

    it('should return undefined when practitioner_id is null for non-auto-assigned', () => {
      const event = createMockAppointment({
        practitioner_id: null,
        is_auto_assigned: false,
      });
      expect(getPractitionerIdForDuplicate(event, false)).toBeUndefined();
    });

    it('should return undefined when practitioner_id is undefined', () => {
      const event = createMockAppointment({
        practitioner_id: undefined,
        is_auto_assigned: false,
      });
      expect(getPractitionerIdForDuplicate(event, false)).toBeUndefined();
    });

    it('should return practitioner_id for admin with non-auto-assigned appointment', () => {
      const event = createMockAppointment({
        practitioner_id: 999,
        is_auto_assigned: false,
      });
      expect(getPractitionerIdForDuplicate(event, true)).toBe(999);
    });
  });
});



