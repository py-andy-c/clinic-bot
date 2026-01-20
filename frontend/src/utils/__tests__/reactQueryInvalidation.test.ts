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
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      invalidateAvailabilitySlotsForDate(null as any, 123, 456, '2024-01-15');

      expect(consoleSpy).toHaveBeenCalledWith('QueryClient not provided to invalidateAvailabilitySlotsForDate');
      expect(mockInvalidateQueries).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle errors gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockInvalidateQueries.mockImplementation(() => {
        throw new Error('Test error');
      });

      invalidateAvailabilitySlotsForDate(mockQueryClient, 123, 456, '2024-01-15');

      expect(consoleSpy).toHaveBeenCalledWith('Failed to invalidate availability slots:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });

  describe('invalidateResourceAvailabilityForDate', () => {
    it('should delegate to invalidateAvailabilitySlotsForDate', () => {
      invalidateResourceAvailabilityForDate(mockQueryClient, 123, 456, '2024-01-15');

      expect(mockInvalidateQueries).toHaveBeenCalledTimes(1); // Only availability slots invalidation
    });

    it('should handle invalid queryClient gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      invalidateResourceAvailabilityForDate(null as any, 123, 456, '2024-01-15');

      expect(consoleSpy).toHaveBeenCalledWith('QueryClient not provided to invalidateResourceAvailabilityForDate');

      consoleSpy.mockRestore();
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
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      invalidatePatientAppointments(null as any, 111, 222);

      expect(consoleSpy).toHaveBeenCalledWith('QueryClient not provided to invalidatePatientAppointments');

      consoleSpy.mockRestore();
    });
  });

  describe('invalidateAvailabilityAfterAppointmentChange', () => {
    it('should invalidate availability for multiple dates with patient appointments', () => {
      invalidateAvailabilityAfterAppointmentChange(mockQueryClient, 123, 456, ['2024-01-15', '2024-01-16'], 111, 222);

      // Should call invalidateQueries multiple times:
      // 2 calls for availability slots (one per date)
      // 1 call for patient appointments
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(3);

      // Check that patient appointments invalidation was called
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['patient-appointments', 111, 222]
      });
    });

    it('should handle single date array', () => {
      invalidateAvailabilityAfterAppointmentChange(mockQueryClient, 123, 456, ['2024-01-15'], 111, 222);

      expect(mockInvalidateQueries).toHaveBeenCalledTimes(2); // 1 availability + 1 patient
    });

    it('should skip invalidation when required IDs are null', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      invalidateAvailabilityAfterAppointmentChange(mockQueryClient, null, 456, ['2024-01-15'], 111, 222);

      expect(consoleSpy).toHaveBeenCalledWith('Missing practitioner or appointment type ID for invalidation');
      expect(mockInvalidateQueries).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should skip patient appointments when clinic/patient IDs not provided', () => {
      invalidateAvailabilityAfterAppointmentChange(mockQueryClient, 123, 456, ['2024-01-15']);

      expect(mockInvalidateQueries).toHaveBeenCalledTimes(1); // Only availability slots
    });

    it('should handle invalid queryClient gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      invalidateAvailabilityAfterAppointmentChange(null as any, 123, 456, ['2024-01-15'], 111, 222);

      expect(consoleSpy).toHaveBeenCalledWith('QueryClient not provided to invalidateAvailabilityAfterAppointmentChange');

      consoleSpy.mockRestore();
    });

    it('should handle empty dates array', () => {
      invalidateAvailabilityAfterAppointmentChange(mockQueryClient, 123, 456, [], 111, 222);

      expect(mockInvalidateQueries).toHaveBeenCalledTimes(1); // Only patient appointments
    });
  });
});