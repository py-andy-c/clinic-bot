/**
 * Unit tests for usePractitionerAssignmentPrompt hook
 * 
 * Tests the shouldPromptForAssignment utility function which determines
 * whether to prompt the user to assign a practitioner to a patient.
 */

import { describe, it, expect } from 'vitest';
import { shouldPromptForAssignment } from '../usePractitionerAssignmentPrompt';
import { Patient } from '../../types';

describe('shouldPromptForAssignment', () => {
  describe('Null/undefined inputs', () => {
    it('should return false when patient is null', () => {
      expect(shouldPromptForAssignment(null, 1)).toBe(false);
    });

    it('should return false when patient is undefined', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(shouldPromptForAssignment(undefined as any, 1)).toBe(false);
    });

    it('should return false when practitionerId is null', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
      };
      expect(shouldPromptForAssignment(patient, null)).toBe(false);
    });

    it('should return false when practitionerId is undefined', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
      };
      expect(shouldPromptForAssignment(patient, undefined)).toBe(false);
    });

    it('should return false when both patient and practitionerId are null', () => {
      expect(shouldPromptForAssignment(null, null)).toBe(false);
    });
  });

  describe('Patient with no assigned practitioners', () => {
    it('should return true when patient has no assigned_practitioner_ids or assigned_practitioners', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
      };
      expect(shouldPromptForAssignment(patient, 1)).toBe(true);
    });

    it('should return true when assigned_practitioner_ids is undefined and assigned_practitioners is undefined', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioner_ids: undefined,
        assigned_practitioners: undefined,
      };
      expect(shouldPromptForAssignment(patient, 1)).toBe(true);
    });

    it('should return true when assigned_practitioner_ids is empty array', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioner_ids: [],
      };
      expect(shouldPromptForAssignment(patient, 1)).toBe(true);
    });

    it('should return true when assigned_practitioners is empty array (fallback)', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioners: [],
      };
      expect(shouldPromptForAssignment(patient, 1)).toBe(true);
    });
  });

  describe('Patient with only inactive assigned practitioners', () => {
    it('should return true when all assigned practitioners are inactive (is_active: false)', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioners: [
          { id: 2, full_name: 'Dr. Inactive', is_active: false },
          { id: 3, full_name: 'Dr. Also Inactive', is_active: false },
        ],
      };
      expect(shouldPromptForAssignment(patient, 1)).toBe(true);
    });

    it('should return true when all assigned practitioners have is_active explicitly false', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioners: [
          { id: 2, full_name: 'Dr. Inactive', is_active: false },
        ],
      };
      expect(shouldPromptForAssignment(patient, 1)).toBe(true);
    });
  });

  describe('Patient with active assigned practitioners - practitioner not in list', () => {
    it('should return true when practitioner is not in assigned_practitioner_ids', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioner_ids: [2, 3],
      };
      expect(shouldPromptForAssignment(patient, 1)).toBe(true);
    });

    it('should return true when practitioner is not in active assigned list (fallback to assigned_practitioners)', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioners: [
          { id: 2, full_name: 'Dr. Active', is_active: true },
          { id: 3, full_name: 'Dr. Also Active', is_active: true },
        ],
      };
      expect(shouldPromptForAssignment(patient, 1)).toBe(true);
    });

    it('should return true when practitioner is not in list with mixed active/inactive', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioners: [
          { id: 2, full_name: 'Dr. Active', is_active: true },
          { id: 3, full_name: 'Dr. Inactive', is_active: false },
        ],
      };
      expect(shouldPromptForAssignment(patient, 1)).toBe(true);
    });

    it('should return true when practitioner is not in list with is_active undefined (treated as active)', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioners: [
          { id: 2, full_name: 'Dr. Active', is_active: undefined },
        ],
      };
      expect(shouldPromptForAssignment(patient, 1)).toBe(true);
    });
  });

  describe('Patient with active assigned practitioners - practitioner already in list', () => {
    it('should return false when practitioner is in assigned_practitioner_ids', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioner_ids: [1, 2],
      };
      expect(shouldPromptForAssignment(patient, 1)).toBe(false);
    });

    it('should return false when practitioner is in active assigned list (fallback to assigned_practitioners)', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioners: [
          { id: 1, full_name: 'Dr. Selected', is_active: true },
          { id: 2, full_name: 'Dr. Other', is_active: true },
        ],
      };
      expect(shouldPromptForAssignment(patient, 1)).toBe(false);
    });

    it('should return false when practitioner is in list with is_active undefined (treated as active)', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioners: [
          { id: 1, full_name: 'Dr. Selected', is_active: undefined },
        ],
      };
      expect(shouldPromptForAssignment(patient, 1)).toBe(false);
    });

    it('should return false when practitioner is in list with multiple active practitioners', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioners: [
          { id: 2, full_name: 'Dr. Other', is_active: true },
          { id: 1, full_name: 'Dr. Selected', is_active: true },
          { id: 3, full_name: 'Dr. Another', is_active: true },
        ],
      };
      expect(shouldPromptForAssignment(patient, 1)).toBe(false);
    });
  });

  describe('Edge cases - filtering inactive practitioners', () => {
    it('should filter out inactive practitioners and check only active ones', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioners: [
          { id: 1, full_name: 'Dr. Inactive', is_active: false },
          { id: 2, full_name: 'Dr. Active', is_active: true },
        ],
      };
      // Practitioner 1 is in list but inactive, so should prompt (treat as not assigned)
      expect(shouldPromptForAssignment(patient, 1)).toBe(true);
      // Practitioner 2 is active and in list, so should not prompt
      expect(shouldPromptForAssignment(patient, 2)).toBe(false);
      // Practitioner 3 is not in list, so should prompt
      expect(shouldPromptForAssignment(patient, 3)).toBe(true);
    });

    it('should treat is_active: undefined as active', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioners: [
          { id: 1, full_name: 'Dr. No Status', is_active: undefined },
        ],
      };
      // is_active: undefined is treated as active (is_active !== false)
      expect(shouldPromptForAssignment(patient, 1)).toBe(false);
    });

    it('should handle multiple inactive practitioners correctly', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioners: [
          { id: 2, full_name: 'Dr. Inactive 1', is_active: false },
          { id: 3, full_name: 'Dr. Inactive 2', is_active: false },
          { id: 4, full_name: 'Dr. Inactive 3', is_active: false },
        ],
      };
      // All are inactive, so should prompt for any practitioner
      expect(shouldPromptForAssignment(patient, 1)).toBe(true);
      expect(shouldPromptForAssignment(patient, 2)).toBe(true);
      expect(shouldPromptForAssignment(patient, 5)).toBe(true);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle first assignment scenario correctly', () => {
      const newPatient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'New Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
      };
      // New patient with no assigned practitioners should prompt
      expect(shouldPromptForAssignment(newPatient, 1)).toBe(true);
    });

    it('should handle adding second practitioner scenario correctly (using assigned_practitioner_ids)', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Existing Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioner_ids: [1],
      };
      // Patient already has practitioner 1, adding practitioner 2 should prompt
      expect(shouldPromptForAssignment(patient, 2)).toBe(true);
      // But practitioner 1 is already assigned, so should not prompt
      expect(shouldPromptForAssignment(patient, 1)).toBe(false);
    });

    it('should handle adding second practitioner scenario correctly (fallback to assigned_practitioners)', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Existing Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioners: [
          { id: 1, full_name: 'Dr. First', is_active: true },
        ],
      };
      // Patient already has practitioner 1, adding practitioner 2 should prompt
      expect(shouldPromptForAssignment(patient, 2)).toBe(true);
      // But practitioner 1 is already assigned, so should not prompt
      expect(shouldPromptForAssignment(patient, 1)).toBe(false);
    });

    it('should handle practitioner reassignment after deletion scenario (using assigned_practitioner_ids)', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioner_ids: [], // All were removed/deleted
      };
      // No assigned practitioners, should prompt to assign new one
      expect(shouldPromptForAssignment(patient, 2)).toBe(true);
      expect(shouldPromptForAssignment(patient, 1)).toBe(true);
    });

    it('should handle practitioner reassignment after deletion scenario (fallback to assigned_practitioners)', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioners: [
          { id: 1, full_name: 'Dr. Deleted', is_active: false },
        ],
      };
      // All practitioners are inactive, should prompt to assign new one
      expect(shouldPromptForAssignment(patient, 2)).toBe(true);
      // Even the deleted practitioner should prompt (since it's inactive)
      expect(shouldPromptForAssignment(patient, 1)).toBe(true);
    });

    it('should prefer assigned_practitioner_ids over assigned_practitioners when both are present', () => {
      const patient: Patient = {
        id: 1,
        clinic_id: 1,
        full_name: 'Test Patient',
        phone_number: '1234567890',
        created_at: '2024-01-01T00:00:00Z',
        assigned_practitioner_ids: [1],
        assigned_practitioners: [
          { id: 2, full_name: 'Dr. Other', is_active: true },
        ],
      };
      // Should use assigned_practitioner_ids (primary source), so practitioner 1 is assigned, don't prompt
      expect(shouldPromptForAssignment(patient, 1)).toBe(false);
      // Practitioner 2 is in assigned_practitioners but not in assigned_practitioner_ids, should prompt
      expect(shouldPromptForAssignment(patient, 2)).toBe(true);
    });
  });
});

