/**
 * Unit tests for clinic settings utility functions
 */

import { describe, it, expect } from 'vitest';
import { getClinicSectionChanges } from '../clinicSettings';
import { ClinicSettings, BookingRestrictionSettings } from '../../schemas/api';
import { AppointmentType } from '../../types';

describe('clinicSettings', () => {
  const createMockClinicSettings = (
    overrides: Partial<ClinicSettings> = {}
  ): ClinicSettings => ({
    clinic_id: 1,
    clinic_name: 'Test Clinic',
    business_hours: {},
    appointment_types: [],
    notification_settings: {
      reminder_hours_before: 24,
    },
    booking_restriction_settings: {
      booking_restriction_type: 'minimum_hours_required',
      minimum_booking_hours_ahead: 24,
    },
    clinic_info_settings: {
      display_name: null,
      address: null,
      phone_number: null,
      appointment_type_instructions: null,
      appointment_notes_instructions: null,
      require_birthday: false,
    },
    chat_settings: {
      chat_enabled: false,
    },
    ...overrides,
  });

  const createMockBookingRestrictionSettings = (
    overrides: Partial<BookingRestrictionSettings> = {}
  ): BookingRestrictionSettings => ({
    booking_restriction_type: 'minimum_hours_required',
    minimum_booking_hours_ahead: 24,
    ...overrides,
  });

  describe('getClinicSectionChanges', () => {
    describe('booking restriction settings - deadline fields', () => {
      it('should detect changes to deadline_time_day_before', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
            deadline_time_day_before: '08:00',
            deadline_on_same_day: false,
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
            deadline_time_day_before: '10:00', // Changed
            deadline_on_same_day: false,
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });

      it('should detect changes to deadline_on_same_day', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
            deadline_time_day_before: '08:00',
            deadline_on_same_day: false,
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
            deadline_time_day_before: '08:00',
            deadline_on_same_day: true, // Changed
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });

      it('should detect changes when both deadline fields change', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
            deadline_time_day_before: '08:00',
            deadline_on_same_day: false,
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
            deadline_time_day_before: '12:00', // Changed
            deadline_on_same_day: true, // Changed
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });

      it('should not detect changes when deadline fields are unchanged', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
            deadline_time_day_before: '08:00',
            deadline_on_same_day: false,
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
            deadline_time_day_before: '08:00', // Same
            deadline_on_same_day: false, // Same
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(false);
      });
    });

    describe('booking restriction settings - type normalization', () => {
      it('should handle string vs number type mismatches for numeric fields', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            minimum_booking_hours_ahead: 24, // number
            step_size_minutes: 30, // number
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            minimum_booking_hours_ahead: '24', // string (should be treated as same)
            step_size_minutes: '30', // string (should be treated as same)
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(false);
      });

      it('should detect actual changes even with type mismatches', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            minimum_booking_hours_ahead: 24, // number
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            minimum_booking_hours_ahead: '48', // string but different value
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });
    });

    describe('booking restriction settings - optional fields with defaults', () => {
      it('should handle undefined optional fields correctly', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            step_size_minutes: undefined,
            max_future_appointments: undefined,
            allow_patient_deletion: undefined,
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            step_size_minutes: 30, // Explicitly set to default
            max_future_appointments: 3, // Explicitly set to default
            allow_patient_deletion: true, // Explicitly set to default
          }),
        });

        // Should not detect change since values match defaults
        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(false);
      });

      it('should detect changes when optional fields differ from defaults', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            step_size_minutes: undefined, // Will normalize to 30
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            step_size_minutes: 15, // Different from default 30
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });
    });

    describe('booking restriction settings - all fields', () => {
      it('should detect changes to booking_restriction_type', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'minimum_hours_required',
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });

      it('should detect changes to minimum_booking_hours_ahead', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            minimum_booking_hours_ahead: 24,
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            minimum_booking_hours_ahead: 48,
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });

      it('should detect changes to step_size_minutes', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            step_size_minutes: 30,
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            step_size_minutes: 15,
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });

      it('should detect changes to max_future_appointments', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            max_future_appointments: 3,
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            max_future_appointments: 5,
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });

      it('should detect changes to max_booking_window_days', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            max_booking_window_days: 90,
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            max_booking_window_days: 180,
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });

      it('should detect changes to minimum_cancellation_hours_before', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            minimum_cancellation_hours_before: 24,
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            minimum_cancellation_hours_before: 48,
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });

      it('should detect changes to allow_patient_deletion', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            allow_patient_deletion: true,
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            allow_patient_deletion: false,
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });
    });

    describe('other appointment settings', () => {
      it('should detect changes to appointment_types', () => {
        const original = createMockClinicSettings({
          appointment_types: [
            { id: 1, clinic_id: 1, name: 'Type 1', duration_minutes: 30 },
          ],
        });

        const current = createMockClinicSettings({
          appointment_types: [
            { id: 1, clinic_id: 1, name: 'Type 1 Updated', duration_minutes: 30 },
          ],
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });

      it('should detect changes to appointment_type_instructions', () => {
        const original = createMockClinicSettings({
          clinic_info_settings: {
            appointment_type_instructions: 'Original instructions',
          },
        });

        const current = createMockClinicSettings({
          clinic_info_settings: {
            appointment_type_instructions: 'Updated instructions',
          },
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });

      it('should detect changes to appointment_notes_instructions', () => {
        const original = createMockClinicSettings({
          clinic_info_settings: {
            appointment_notes_instructions: 'Original notes',
          },
        });

        const current = createMockClinicSettings({
          clinic_info_settings: {
            appointment_notes_instructions: 'Updated notes',
          },
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });

      it('should detect changes to require_birthday', () => {
        const original = createMockClinicSettings({
          clinic_info_settings: {
            require_birthday: false,
          },
        });

        const current = createMockClinicSettings({
          clinic_info_settings: {
            require_birthday: true,
          },
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });
    });

    describe('other sections', () => {
      it('should detect changes to clinic info settings', () => {
        const original = createMockClinicSettings({
          clinic_info_settings: {
            display_name: 'Original Name',
            address: 'Original Address',
            phone_number: '1234567890',
          },
        });

        const current = createMockClinicSettings({
          clinic_info_settings: {
            display_name: 'Updated Name',
            address: 'Original Address',
            phone_number: '1234567890',
          },
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.clinicInfoSettings).toBe(true);
      });

      it('should detect changes to reminder settings', () => {
        const original = createMockClinicSettings({
          notification_settings: {
            reminder_hours_before: 24,
          },
        });

        const current = createMockClinicSettings({
          notification_settings: {
            reminder_hours_before: 48,
          },
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.reminderSettings).toBe(true);
      });

      it('should detect changes to chat settings', () => {
        const original = createMockClinicSettings({
          chat_settings: {
            chat_enabled: false,
          },
        });

        const current = createMockClinicSettings({
          chat_settings: {
            chat_enabled: true,
          },
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.chatSettings).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle null and undefined deadline_time_day_before', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
            deadline_time_day_before: undefined,
            deadline_on_same_day: false,
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
            deadline_time_day_before: '10:00', // Changed from undefined (normalized to '08:00')
            deadline_on_same_day: false,
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });

      it('should handle empty string for deadline_time_day_before', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
            deadline_time_day_before: '',
            deadline_on_same_day: false,
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
            deadline_time_day_before: '10:00',
            deadline_on_same_day: false,
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });

      it('should handle null for deadline_on_same_day', () => {
        const original = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
            deadline_time_day_before: '08:00',
            deadline_on_same_day: null as any,
          }),
        });

        const current = createMockClinicSettings({
          booking_restriction_settings: createMockBookingRestrictionSettings({
            booking_restriction_type: 'deadline_time_day_before',
            deadline_time_day_before: '08:00',
            deadline_on_same_day: true, // Changed from null (normalized to false)
          }),
        });

        const changes = getClinicSectionChanges(current, original);
        expect(changes.appointmentSettings).toBe(true);
      });
    });
  });
});
