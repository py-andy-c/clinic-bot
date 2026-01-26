/**
 * Unit tests for React Query invalidation utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  invalidateAvailabilitySlotsForDate,
  invalidateResourceAvailabilityForDate,
  invalidatePatientAppointments,
  invalidateAvailabilityAfterAppointmentChange
} from '../reactQueryInvalidation';

// Mock QueryClient
const mockInvalidateQueries = vi.fn();
const mockQueryClient = {
  invalidateQueries: mockInvalidateQueries
} as any as QueryClient;

describe('React Query Invalidation Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('invalidateAvailabilitySlotsForDate', () => {
    it('should invalidate availability-slots queries for specific practitioner, type, and date', () => {
      invalidateAvailabilitySlotsForDate(mockQueryClient, 123, 456, '2024-01-15');

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        predicate: expect.any(Function)
      });

      // Test the predicate function - New format (6-element key with clinicId)
      const predicateCall = mockInvalidateQueries.mock.calls[0][0].predicate;
      const mockQueryNew = {
        queryKey: ['availability-slots', 99, 123, 456, '2024-01-15', undefined]
      };
      // Note: Test setup didn't pass clinicId, so predicate acts loosely or expects specific pattern
      // Since we updated implementation to check length === 6, let's verify that.
      expect(predicateCall(mockQueryNew)).toBe(true);

      // Test Legacy format (5-element key)
      const mockQueryLegacy = {
        queryKey: ['availability-slots', 123, 456, '2024-01-15', 789]
      };

      // We need to re-invoke with legacy arguments to test legacy path if we want
      // But the single call above sets up one predicate. 
      // The current implementation checks length. 
      // Length 6 (new) -> looks at indices 2, 3, 4 (if hasClinicId=true logic was offset based)
      // Actually: 
      // If length === 6 (new), offset = 1. IDs at 2, 3, 4.
      // If length === 5 (legacy), offset = 0. IDs at 1, 2, 3.

      // Let's verify legacy support:
      expect(predicateCall(mockQueryLegacy)).toBe(true);

      // // Test non-matching query
      const nonMatchingQuery = {
        queryKey: ['availability-slots', 99, 999, 456, '2024-01-15', undefined]
      };
      expect(predicateCall(nonMatchingQuery)).toBe(false);
    });

    it('should handle null practitionerId', () => {
      invalidateAvailabilitySlotsForDate(mockQueryClient, null, 456, '2024-01-15');

      // Should still invalidate with predicate matching null practitioner
      const predicateCall = mockInvalidateQueries.mock.calls[0][0].predicate;
      const mockQuery = {
        queryKey: ['availability-slots', null, 456, '2024-01-15', undefined]
      };
      expect(predicateCall(mockQuery)).toBe(true);
    });

    it('should handle null appointmentTypeId', () => {
      invalidateAvailabilitySlotsForDate(mockQueryClient, 123, null, '2024-01-15');

      const predicateCall = mockInvalidateQueries.mock.calls[0][0].predicate;
      const mockQuery = {
        queryKey: ['availability-slots', 123, null, '2024-01-15', undefined]
      };
      expect(predicateCall(mockQuery)).toBe(true);
    });

    it('should handle invalid queryClient gracefully', () => {
      invalidateAvailabilitySlotsForDate(null as any, 123, 456, '2024-01-15');

      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });
  });

  describe('invalidateResourceAvailabilityForDate', () => {
    it('should invalidate resource-availability queries for specific practitioner, type, and date', () => {
      invalidateResourceAvailabilityForDate(mockQueryClient, 123, 456, '2024-01-15');

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        predicate: expect.any(Function)
      });

      // Test the predicate function
      const predicateCall = mockInvalidateQueries.mock.calls[0][0].predicate;

      // Correct new query key format: ['resource-availability', clinicId, appointmentTypeId, practitionerId, date, startTime, duration, excludeId]
      const mockQueryNew = {
        queryKey: ['resource-availability', 99, 456, 123, '2024-01-15', '10:00', 60, 789]
      };
      expect(predicateCall(mockQueryNew)).toBe(true);

      // Match legacy query: ['resource-availability', appointmentTypeId, practitionerId, date, startTime, duration, excludeId]
      const mockQueryLegacy = {
        queryKey: ['resource-availability', 456, 123, '2024-01-15', '10:00', 60, 789]
      };
      expect(predicateCall(mockQueryLegacy)).toBe(true);

      // Test non-matching query
      const nonMatchingQuery = {
        queryKey: ['resource-availability', 99, 999, 123, '2024-01-15', '10:00', 60, 789]
      };
      expect(predicateCall(nonMatchingQuery)).toBe(false);
    });

    it('should handle invalid queryClient gracefully', () => {
      invalidateResourceAvailabilityForDate(null as any, 123, 456, '2024-01-15');

      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });
  });

  describe('invalidatePatientAppointments', () => {
    it('should invalidate patient appointments for specific clinic and patient', () => {
      invalidatePatientAppointments(mockQueryClient, 111, 222);

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['patient-appointments', 111, 222]
      });
    });

    it('should handle invalid queryClient gracefully', () => {
      invalidatePatientAppointments(null as any, 111, 222);

      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });
  });

  describe('invalidateAvailabilityAfterAppointmentChange', () => {
    it('should invalidate availability for multiple dates with patient appointments', () => {
      invalidateAvailabilityAfterAppointmentChange(mockQueryClient, 123, 456, ['2024-01-15', '2024-01-16'], 111, 222);

      // Should call invalidateQueries multiple times:
      // 2 calls for availability slots (one per date)
      // 2 calls for resource availability (one per date)
      // 2 calls for practitioner conflicts (one per date, since clinicId is provided)
      // 1 call for batch availability
      // 1 call for patient appointments
      // Total: 2 + 2 + 2 + 1 + 1 = 8
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(8);

      // Check that patient appointments invalidation was called
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['patient-appointments', 111, 222]
      });
    });

    it('should handle single date array', () => {
      invalidateAvailabilityAfterAppointmentChange(mockQueryClient, 123, 456, ['2024-01-15'], 111, 222);

      expect(mockInvalidateQueries).toHaveBeenCalledTimes(5); // 1 avail + 1 resource + 1 conflicts + 1 batch + 1 patient
    });

    it('should skip invalidation when required IDs are null', () => {
      invalidateAvailabilityAfterAppointmentChange(mockQueryClient, null, 456, ['2024-01-15'], 111, 222);

      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });

    it('should skip patient appointments when clinic/patient IDs not provided', () => {
      invalidateAvailabilityAfterAppointmentChange(mockQueryClient, 123, 456, ['2024-01-15']);

      expect(mockInvalidateQueries).toHaveBeenCalledTimes(3); // availability slots + resource availability + batch availability
    });

    it('should handle invalid queryClient gracefully', () => {
      invalidateAvailabilityAfterAppointmentChange(null as any, 123, 456, ['2024-01-15'], 111, 222);

      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });

    it('should handle empty dates array', () => {
      invalidateAvailabilityAfterAppointmentChange(mockQueryClient, 123, 456, [], 111, 222);

      expect(mockInvalidateQueries).toHaveBeenCalledTimes(2); // Batch availability + Patient appointments
    });
  });
});