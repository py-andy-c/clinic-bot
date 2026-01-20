/**
 * Unit tests for event permissions utility functions
 */

import { describe, it, expect } from 'vitest';
import { CalendarEvent } from '../calendarDataAdapter';
import { canEditEvent } from '../eventPermissions';

describe('eventPermissions', () => {
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

  const createMockResourceEvent = (
    overrides: Partial<CalendarEvent['resource']> = {}
  ): CalendarEvent => ({
    id: 2,
    title: 'Test Resource Event',
    start: new Date('2024-01-15T10:00:00'),
    end: new Date('2024-01-15T11:00:00'),
    resource: {
      type: 'resource',
      calendar_event_id: 2,
      resource_id: 1,
      practitioner_id: 1,
      ...overrides,
    },
  });

  describe('canEditEvent', () => {
    it('should return false for null event', () => {
      expect(canEditEvent(null, true, { userId: 1, isAdmin: false })).toBe(false);
    });

    it('should return false when canEdit is false', () => {
      const event = createMockAppointment();
      expect(canEditEvent(event, false, { userId: 1, isAdmin: false })).toBe(false);
    });

    it('should return false when userId is undefined', () => {
      const event = createMockAppointment();
      expect(canEditEvent(event, true, { userId: undefined, isAdmin: false })).toBe(false);
    });

    describe('appointment events', () => {
      it('should delegate to canEditAppointment for appointment events', () => {
        // Admin can edit any appointment
        const event = createMockAppointment({ practitioner_id: 999 });
        expect(canEditEvent(event, true, { userId: 1, isAdmin: true })).toBe(true);
      });

      it('should allow practitioner to edit their own non-auto-assigned appointment', () => {
        const event = createMockAppointment({
          practitioner_id: 1,
          is_auto_assigned: false
        });
        expect(canEditEvent(event, true, { userId: 1, isAdmin: false })).toBe(true);
      });

      it('should deny practitioner from editing auto-assigned appointment', () => {
        const event = createMockAppointment({
          practitioner_id: 1,
          is_auto_assigned: true
        });
        expect(canEditEvent(event, true, { userId: 1, isAdmin: false })).toBe(false);
      });

      it('should deny practitioner from editing others appointment', () => {
        const event = createMockAppointment({
          practitioner_id: 999,
          is_auto_assigned: false
        });
        expect(canEditEvent(event, true, { userId: 1, isAdmin: false })).toBe(false);
      });
    });

    describe('resource events', () => {
      it('should allow practitioner to edit their own resource event', () => {
        const event = createMockResourceEvent({ practitioner_id: 1 });
        expect(canEditEvent(event, true, { userId: 1, isAdmin: false })).toBe(true);
      });

      it('should deny practitioner from editing others resource event', () => {
        const event = createMockResourceEvent({ practitioner_id: 999 });
        expect(canEditEvent(event, true, { userId: 1, isAdmin: false })).toBe(false);
      });

      it('should fallback to userId when practitioner_id is null', () => {
        const event = createMockResourceEvent({ practitioner_id: null });
        expect(canEditEvent(event, true, { userId: 1, isAdmin: false })).toBe(true);
      });

      it('should fallback to userId when practitioner_id is undefined', () => {
        const event = createMockResourceEvent({ practitioner_id: undefined });
        expect(canEditEvent(event, true, { userId: 1, isAdmin: false })).toBe(true);
      });
    });
  });
});