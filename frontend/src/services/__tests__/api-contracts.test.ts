/**
 * Contract tests for API responses.
 * 
 * These tests verify that API responses match the expected schemas,
 * preventing schema mismatches that could cause data loss.
 */

import { describe, it, expect, vi } from 'vitest';
import { validateClinicSettings, ClinicSettingsSchema } from '../../schemas/api';
import type { ClinicSettings } from '../../schemas/api';

// Mock axios
vi.mock('axios', () => {
  return {
    default: {
      create: vi.fn(() => ({
        get: vi.fn(),
        put: vi.fn(),
        post: vi.fn(),
        delete: vi.fn(),
        interceptors: {
          request: { use: vi.fn(), eject: vi.fn() },
          response: { use: vi.fn(), eject: vi.fn() },
        },
      })),
    },
  };
});

describe('API Contract Tests', () => {
  describe('GET /api/clinic/settings', () => {
    it('should return data that matches ClinicSettingsSchema', async () => {
      const mockResponse: ClinicSettings = {
        clinic_id: 1,
        clinic_name: 'Test Clinic',
        business_hours: {
          monday: { start: '09:00', end: '17:00', enabled: true },
        },
        appointment_types: [
          {
            id: 1,
            clinic_id: 1,
            name: 'Test Service',
            duration_minutes: 30,
            require_notes: true,
            notes_instructions: 'Test instructions',
          },
        ],
        notification_settings: {
          reminder_hours_before: 24,
        },
        booking_restriction_settings: {
          booking_restriction_type: 'minimum_hours_required',
          minimum_booking_hours_ahead: 1,
        },
        clinic_info_settings: {
          display_name: 'Test Clinic',
        },
        chat_settings: {
          chat_enabled: false,
        },
      };

      // Validate that the mock response matches the schema
      const validationResult = ClinicSettingsSchema.safeParse(mockResponse);
      
      expect(validationResult.success).toBe(true);
      if (validationResult.success) {
        // Verify critical fields are preserved
        expect(validationResult.data.appointment_types[0]?.require_notes).toBe(true);
        expect(validationResult.data.appointment_types[0]?.notes_instructions).toBe('Test instructions');
      }
    });

    it('should preserve all appointment type fields including notes customization', () => {
      const mockAppointmentType = {
        id: 1,
        clinic_id: 1,
        name: 'Test Service',
        duration_minutes: 30,
        require_notes: false,
        notes_instructions: null,
        send_patient_confirmation: true,
        send_clinic_confirmation: true,
        send_reminder: true,
        patient_confirmation_message: 'Message',
        clinic_confirmation_message: 'Message',
        reminder_message: 'Message',
      };

      const mockSettings: ClinicSettings = {
        clinic_id: 1,
        clinic_name: 'Test',
        business_hours: {},
        appointment_types: [mockAppointmentType],
        notification_settings: { reminder_hours_before: 24 },
        booking_restriction_settings: {
          booking_restriction_type: 'minimum_hours_required',
          minimum_booking_hours_ahead: 1,
        },
        clinic_info_settings: {},
        chat_settings: { chat_enabled: false },
      };

      const result = validateClinicSettings(mockSettings);
      
      // All fields should be preserved
      expect(result.appointment_types[0]?.require_notes).toBe(false);
      expect(result.appointment_types[0]?.notes_instructions).toBeNull();
      expect(result.appointment_types[0]?.send_patient_confirmation).toBe(true);
    });
  });
});

