/**
 * Unit tests for type definitions.
 * 
 * Tests to ensure type consistency and prevent duplicate definitions.
 * These tests verify that types can be imported and used correctly.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type {
  AppointmentType,
  Patient,
  Practitioner,
  PractitionerAvailability,
  ClinicSettings,
} from '../index';

describe('Type Definitions', () => {
  describe('Practitioner', () => {
    it('should have required fields', () => {
      const practitioner: Practitioner = {
        id: 1,
        full_name: 'Dr. Smith',
        offered_types: [1, 2, 3],
      };

      expect(practitioner.id).toBe(1);
      expect(practitioner.full_name).toBe('Dr. Smith');
      expect(practitioner.offered_types).toEqual([1, 2, 3]);
    });

    it('should support optional picture_url field', () => {
      const practitioner: Practitioner = {
        id: 1,
        full_name: 'Dr. Smith',
        picture_url: 'https://example.com/photo.jpg',
        offered_types: [1, 2, 3],
      };

      expect(practitioner.picture_url).toBe('https://example.com/photo.jpg');
    });

    it('should work without picture_url field', () => {
      const practitioner: Practitioner = {
        id: 1,
        full_name: 'Dr. Smith',
        offered_types: [1, 2, 3],
      };

      expect(practitioner.picture_url).toBeUndefined();
    });
  });

  describe('AppointmentType', () => {
    it('should have required fields', () => {
      const appointmentType: AppointmentType = {
        id: 1,
        clinic_id: 1,
        name: 'Test Appointment',
        duration_minutes: 60,
      };

      expect(appointmentType.id).toBe(1);
      expect(appointmentType.clinic_id).toBe(1);
      expect(appointmentType.name).toBe('Test Appointment');
      expect(appointmentType.duration_minutes).toBe(60);
    });

    it('should support optional is_deleted field', () => {
      const appointmentType: AppointmentType = {
        id: 1,
        clinic_id: 1,
        name: 'Test Appointment',
        duration_minutes: 60,
        is_deleted: false,
      };

      expect(appointmentType.is_deleted).toBe(false);
    });

    it('should work without is_deleted field', () => {
      const appointmentType: AppointmentType = {
        id: 1,
        clinic_id: 1,
        name: 'Test Appointment',
        duration_minutes: 60,
      };

      expect(appointmentType.is_deleted).toBeUndefined();
    });
  });

  describe('Patient', () => {
    it('should have required fields', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '0912345678',
        created_at: '2025-01-01T00:00:00Z',
      };

      expect(patient.id).toBe(1);
      expect(patient.clinic_id).toBe(1);
      expect(patient.full_name).toBe('Test Patient');
      expect(patient.phone_number).toBe('0912345678');
      expect(patient.created_at).toBe('2025-01-01T00:00:00Z');
    });

    it('should support optional line_user fields', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '0912345678',
        created_at: '2025-01-01T00:00:00Z',
        line_user_id: 'line123',
        line_user_display_name: 'LINE User',
      };

      expect(patient.line_user_id).toBe('line123');
      expect(patient.line_user_display_name).toBe('LINE User');
    });
  });

  describe('ClinicSettings', () => {
    it('should have required fields', () => {
      const settings: ClinicSettings = {
        clinic_id: 1,
        clinic_name: 'Test Clinic',
        business_hours: {
          monday: { start: '09:00', end: '17:00', enabled: true },
        },
        appointment_types: [
          {
            id: 1,
            clinic_id: 1,
            name: 'Test Appointment',
            duration_minutes: 60,
          },
        ],
        notification_settings: {
          reminder_hours_before: 24,
        },
      };

      expect(settings.clinic_id).toBe(1);
      expect(settings.clinic_name).toBe('Test Clinic');
      expect(settings.appointment_types).toHaveLength(1);
      expect(settings.appointment_types[0]?.name).toBe('Test Appointment');
    });
  });

  describe('Type Consistency', () => {
    it('should ensure AppointmentType is not duplicated', () => {
      // This test verifies that AppointmentType is properly defined
      // If there were duplicate definitions, TypeScript would error
      const type1: AppointmentType = {
        id: 1,
        clinic_id: 1,
        name: 'Type 1',
        duration_minutes: 30,
      };

      const type2: AppointmentType = {
        id: 2,
        clinic_id: 1,
        name: 'Type 2',
        duration_minutes: 60,
      };

      // Both should be valid AppointmentType instances
      expect(type1).toBeDefined();
      expect(type2).toBeDefined();
      expect(type1.id).not.toBe(type2.id);
    });

    it('should ensure types can be used in arrays', () => {
      const appointmentTypes: AppointmentType[] = [
        {
          id: 1,
          clinic_id: 1,
          name: 'Type 1',
          duration_minutes: 30,
        },
        {
          id: 2,
          clinic_id: 1,
          name: 'Type 2',
          duration_minutes: 60,
        },
      ];

      expect(appointmentTypes).toHaveLength(2);
      expect(appointmentTypes[0]?.name).toBe('Type 1');
      expect(appointmentTypes[1]?.name).toBe('Type 2');
    });
  });
});

describe('Code Quality Checks', () => {
  describe('No Console Statements', () => {
    it('should not have console statements in src directory (except logger.ts, errorTracking.ts)', () => {
      const srcDir = path.join(__dirname, '../..');

      function checkDirectory(dir: string): string[] {
        const files = fs.readdirSync(dir);
        const violations: string[] = [];

        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);

          if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
            violations.push(...checkDirectory(filePath));
          } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
            // Skip logger.ts as it legitimately uses console
            if (file === 'logger.ts') continue;
            
            // Skip errorTracking.ts as it legitimately uses console for development logging
            if (file === 'errorTracking.ts') continue;
            
            // Skip test files
            if (filePath.includes('__tests__') || filePath.includes('.test.')) continue;
            
            // Skip storage.ts as it uses console.warn for error handling (legitimate)
            if (file === 'storage.ts') continue;

            // Skip schema-validation.ts as it provides development-time warnings
            if (file === 'schema-validation.ts') continue;

            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              // Skip comments and test code
              if (line.includes('console.') && !line.trim().startsWith('//')) {
                const relativePath = path.relative(srcDir, filePath);
                violations.push(`${relativePath}:${i + 1}: ${line.trim()}`);
              }
            }
          }
        }

        return violations;
      }

      const violations = checkDirectory(srcDir);
      expect(violations).toHaveLength(0,
        `Found console statements in the following files:\n${violations.join('\n')}`
      );
    });
  });
});

