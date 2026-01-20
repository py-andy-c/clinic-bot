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

      // Test the predicate function
      const predicateCall = mockInvalidateQueries.mock.calls[0][0].predicate;
      const mockQuery = {
        queryKey: ['availability-slots', 123, 456, '2024-01-15']
      };
      expect(predicateCall(mockQuery)).toBe(true);

      // Test with excludeCalendarEventId (5-element key)
      const mockQueryWithExclude = {
        queryKey: ['availability-slots', 123, 456, '2024-01-15', 789]
      };
      expect(predicateCall(mockQueryWithExclude)).toBe(true);

      // Test non-matching query
      const nonMatchingQuery = {
        queryKey: ['availability-slots', 999, 456, '2024-01-15']
      };
      expect(predicateCall(nonMatchingQuery)).toBe(false);
    });

    it('should handle null practitionerId', () => {
      invalidateAvailabilitySlotsForDate(mockQueryClient, null, 456, '2024-01-15');

      // Should still invalidate with predicate matching null practitioner
      const predicateCall = mockInvalidateQueries.mock.calls[0][0].predicate;
      const mockQuery = {
        queryKey: ['availability-slots', null, 456, '2024-01-15']
      };
      expect(predicateCall(mockQuery)).toBe(true);
    });

    it('should handle null appointmentTypeId', () => {
      invalidateAvailabilitySlotsForDate(mockQueryClient, 123, null, '2024-01-15');

      const predicateCall = mockInvalidateQueries.mock.calls[0][0].predicate;
      const mockQuery = {
        queryKey: ['availability-slots', 123, null, '2024-01-15']
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
      const mockQuery = {
        queryKey: ['resource-availability', 456, 123, '2024-01-15', '10:00', 60, 789]
      };
      expect(predicateCall(mockQuery)).toBe(true);

      // Test non-matching query
      const nonMatchingQuery = {
        queryKey: ['resource-availability', 999, 123, '2024-01-15', '10:00', 60, 789]
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
      // 1 call for patient appointments
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(5);

      // Check that patient appointments invalidation was called
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['patient-appointments', 111, 222]
      });
    });

    it('should handle single date array', () => {
      invalidateAvailabilityAfterAppointmentChange(mockQueryClient, 123, 456, ['2024-01-15'], 111, 222);

      expect(mockInvalidateQueries).toHaveBeenCalledTimes(3); // 1 availability + 1 resource + 1 patient
    });

    it('should skip invalidation when required IDs are null', () => {
      invalidateAvailabilityAfterAppointmentChange(mockQueryClient, null, 456, ['2024-01-15'], 111, 222);

      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });

    it('should skip patient appointments when clinic/patient IDs not provided', () => {
      invalidateAvailabilityAfterAppointmentChange(mockQueryClient, 123, 456, ['2024-01-15']);

      expect(mockInvalidateQueries).toHaveBeenCalledTimes(2); // availability slots + resource availability
    });

    it('should handle invalid queryClient gracefully', () => {
      invalidateAvailabilityAfterAppointmentChange(null as any, 123, 456, ['2024-01-15'], 111, 222);

      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });

    it('should handle empty dates array', () => {
      invalidateAvailabilityAfterAppointmentChange(mockQueryClient, 123, 456, [], 111, 222);

      expect(mockInvalidateQueries).toHaveBeenCalledTimes(1); // Only patient appointments
    });
  });
});