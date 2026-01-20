import { describe, it, expect } from 'vitest';
import { getPractitionerIdForDuplicate } from '../../utils/appointmentPermissions';
import { CalendarEvent } from '../../utils/calendarDataAdapter';

describe('AvailabilityPage Duplicate Appointment Logic', () => {
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

  describe('getPractitionerIdForDuplicate', () => {
    it('should return practitioner_id for admin users', () => {
      const result = getPractitionerIdForDuplicate(mockEvent, true);
      expect(result).toBe(1);
    });

    it('should return practitioner_id for non-admin users when not auto-assigned', () => {
      const nonAutoAssignedEvent = {
        ...mockEvent,
        resource: {
          ...mockEvent.resource,
          is_auto_assigned: false,
          originally_auto_assigned: false,
        },
      };
      const result = getPractitionerIdForDuplicate(nonAutoAssignedEvent, false);
      expect(result).toBe(1);
    });

    it('should return undefined for non-admin users when auto-assigned', () => {
      const autoAssignedEvent = {
        ...mockEvent,
        resource: {
          ...mockEvent.resource,
          is_auto_assigned: true,
          originally_auto_assigned: true,
        },
      };
      const result = getPractitionerIdForDuplicate(autoAssignedEvent, false);
      expect(result).toBeUndefined();
    });

    it('should handle events without practitioner_id', () => {
      const eventWithoutPractitioner = {
        ...mockEvent,
        resource: {
          ...mockEvent.resource,
          practitioner_id: null,
        },
      };
      const result = getPractitionerIdForDuplicate(eventWithoutPractitioner, true);
      expect(result).toBeUndefined();
    });
  });

  describe('Duplicate Data Preparation', () => {
    it('should extract appointment data correctly', () => {
      // Test data extraction logic (similar to what handleDuplicateAppointment does)
      const appointmentTypeId = mockEvent.resource.appointment_type_id;
      const practitionerId = getPractitionerIdForDuplicate(mockEvent, true);
      const clinicNotes = mockEvent.resource.clinic_notes;

      expect(appointmentTypeId).toBe(1);
      expect(practitionerId).toBe(1);
      expect(clinicNotes).toBe('Test clinic notes');
    });

    it('should extract date and time correctly', () => {
      const startMoment = mockEvent.start;
      const expectedDate = '2024-01-15';
      const expectedTime = '10:00';

      const actualDate = startMoment.toISOString().split('T')[0];
      const actualTime = startMoment.toTimeString().slice(0, 5);

      expect(actualDate).toBe(expectedDate);
      expect(actualTime).toBe(expectedTime);
    });

    it('should create duplicate data object correctly', () => {
      const appointmentTypeId = mockEvent.resource.appointment_type_id;
      const practitionerId = getPractitionerIdForDuplicate(mockEvent, true);
      const clinicNotes = mockEvent.resource.clinic_notes;
      const startMoment = mockEvent.start;
      const initialDate = startMoment.toISOString().split('T')[0];
      const initialTime = startMoment.toTimeString().slice(0, 5);

      const duplicateData = {
        initialDate,
        ...(appointmentTypeId !== undefined && { preSelectedAppointmentTypeId: appointmentTypeId }),
        ...(practitionerId !== undefined && { preSelectedPractitionerId: practitionerId }),
        ...(initialTime && { preSelectedTime: initialTime }),
        ...(clinicNotes !== undefined && clinicNotes !== null && { preSelectedClinicNotes: clinicNotes }),
        event: mockEvent,
      };

      expect(duplicateData.initialDate).toBe('2024-01-15');
      expect(duplicateData.preSelectedAppointmentTypeId).toBe(1);
      expect(duplicateData.preSelectedPractitionerId).toBe(1);
      expect(duplicateData.preSelectedTime).toBe('10:00');
      expect(duplicateData.preSelectedClinicNotes).toBe('Test clinic notes');
      expect(duplicateData.event).toBe(mockEvent);
    });
  });

  describe('Edge Cases', () => {
    it('should handle events without appointment_type_id', () => {
      const eventWithoutType = {
        ...mockEvent,
        resource: {
          ...mockEvent.resource,
          appointment_type_id: undefined,
        },
      };

      const appointmentTypeId = eventWithoutType.resource.appointment_type_id;
      const duplicateData = {
        ...(appointmentTypeId !== undefined && { preSelectedAppointmentTypeId: appointmentTypeId }),
      };

      expect(duplicateData.preSelectedAppointmentTypeId).toBeUndefined();
    });

    it('should handle events without clinic_notes', () => {
      const eventWithoutNotes = {
        ...mockEvent,
        resource: {
          ...mockEvent.resource,
          clinic_notes: null,
        },
      };

      const clinicNotes = eventWithoutNotes.resource.clinic_notes;
      const duplicateData = {
        ...(clinicNotes !== undefined && clinicNotes !== null && { preSelectedClinicNotes: clinicNotes }),
      };

      expect(duplicateData.preSelectedClinicNotes).toBeUndefined();
    });

    it('should handle empty clinic_notes', () => {
      const eventWithEmptyNotes = {
        ...mockEvent,
        resource: {
          ...mockEvent.resource,
          clinic_notes: '',
        },
      };

      const clinicNotes = eventWithEmptyNotes.resource.clinic_notes;
      const duplicateData = {
        ...(clinicNotes !== undefined && clinicNotes !== null && { preSelectedClinicNotes: clinicNotes }),
      };

      expect(duplicateData.preSelectedClinicNotes).toBe('');
    });
  });
});