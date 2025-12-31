/**
 * Tests for API schema validation.
 * 
 * These tests ensure that schema validation correctly handles all fields
 * and prevents silent data loss.
 */

import { describe, it, expect } from 'vitest';
import { validateClinicSettings, AppointmentTypeSchema } from '../api';
import type { ClinicSettings } from '../api';

describe('ClinicSettings Schema Validation', () => {
  describe('Regression: require_notes and notes_instructions fields', () => {
    it('should preserve require_notes field', () => {
      const mockData: ClinicSettings = {
        clinic_id: 1,
        clinic_name: 'Test Clinic',
        business_hours: {},
        appointment_types: [
          {
            id: 1,
            clinic_id: 1,
            name: 'Test Service',
            duration_minutes: 30,
            require_notes: true,
            notes_instructions: 'Please provide details',
          },
        ],
        notification_settings: {
          reminder_hours_before: 24,
        },
        booking_restriction_settings: {
          booking_restriction_type: 'minimum_hours_required',
          minimum_booking_hours_ahead: 1,
        },
        clinic_info_settings: {},
        chat_settings: {
          chat_enabled: false,
        },
      };

      const result = validateClinicSettings(mockData);
      
      expect(result.appointment_types[0]?.require_notes).toBe(true);
      expect(result.appointment_types[0]?.notes_instructions).toBe('Please provide details');
    });

    it('should preserve notes_instructions when null', () => {
      const mockData: ClinicSettings = {
        clinic_id: 1,
        clinic_name: 'Test Clinic',
        business_hours: {},
        appointment_types: [
          {
            id: 1,
            clinic_id: 1,
            name: 'Test Service',
            duration_minutes: 30,
            require_notes: false,
            notes_instructions: null,
          },
        ],
        notification_settings: {
          reminder_hours_before: 24,
        },
        booking_restriction_settings: {
          booking_restriction_type: 'minimum_hours_required',
          minimum_booking_hours_ahead: 1,
        },
        clinic_info_settings: {},
        chat_settings: {
          chat_enabled: false,
        },
      };

      const result = validateClinicSettings(mockData);
      
      expect(result.appointment_types[0]?.require_notes).toBe(false);
      expect(result.appointment_types[0]?.notes_instructions).toBeNull();
    });

    it('should preserve unknown fields due to passthrough', () => {
      const mockData = {
        clinic_id: 1,
        clinic_name: 'Test Clinic',
        business_hours: {},
        appointment_types: [
          {
            id: 1,
            clinic_id: 1,
            name: 'Test Service',
            duration_minutes: 30,
            // Unknown field that should be preserved
            future_field: 'test value',
          },
        ],
        notification_settings: {
          reminder_hours_before: 24,
        },
        booking_restriction_settings: {
          booking_restriction_type: 'minimum_hours_required',
          minimum_booking_hours_ahead: 1,
        },
        clinic_info_settings: {},
        chat_settings: {
          chat_enabled: false,
        },
      };

      const result = validateClinicSettings(mockData);
      
      // Passthrough should preserve unknown fields
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.appointment_types[0] as any).future_field).toBe('test value');
    });
  });

  describe('AppointmentTypeSchema', () => {
    it('should validate appointment type with all fields', () => {
      const appointmentType = {
        id: 1,
        clinic_id: 1,
        name: 'Test Service',
        duration_minutes: 30,
        receipt_name: 'Receipt Name',
        allow_patient_booking: true,
        allow_patient_practitioner_selection: true,
        description: 'Test description',
        scheduling_buffer_minutes: 5,
        service_type_group_id: 1,
        display_order: 0,
        send_patient_confirmation: true,
        send_clinic_confirmation: true,
        send_reminder: true,
        patient_confirmation_message: 'Patient message',
        clinic_confirmation_message: 'Clinic message',
        reminder_message: 'Reminder message',
        require_notes: true,
        notes_instructions: 'Notes instructions',
      };

      const result = AppointmentTypeSchema.safeParse(appointmentType);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.require_notes).toBe(true);
        expect(result.data.notes_instructions).toBe('Notes instructions');
      }
    });
  });
});

