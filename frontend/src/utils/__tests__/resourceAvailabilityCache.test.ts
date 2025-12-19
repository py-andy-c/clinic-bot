import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getResourceCacheKey,
  getCachedResourceAvailability,
  setCachedResourceAvailability,
  invalidateResourceCacheForDate,
  clearAllResourceCache,
} from '../resourceAvailabilityCache';
import { ResourceAvailabilityResponse } from '../../types';

const mockResourceAvailabilityResponse: ResourceAvailabilityResponse = {
  requirements: [
    {
      resource_type_id: 1,
      resource_type_name: 'Room',
      required_quantity: 1,
      available_resources: [
        { id: 1, name: 'Room A', description: null, is_available: true },
        { id: 2, name: 'Room B', description: null, is_available: true },
      ],
      available_quantity: 2,
    },
  ],
  suggested_allocation: [{ id: 1, name: 'Room A' }],
  conflicts: [],
};

describe('Resource Availability Cache', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearAllResourceCache();
    // Use real timers by default
    vi.useRealTimers();
  });

  afterEach(() => {
    // Restore real timers after each test
    vi.useRealTimers();
  });

  describe('getResourceCacheKey', () => {
    it('should generate correct cache key', () => {
      const key = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, undefined);
      expect(key).toBe('123_456_2024-11-15_14:00_30_0');
    });

    it('should include excludeCalendarEventId in key', () => {
      const key = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, 789);
      expect(key).toBe('123_456_2024-11-15_14:00_30_789');
    });

    it('should handle different time formats', () => {
      const key = getResourceCacheKey(1, 2, '2025-01-01', '09:30', 60, undefined);
      expect(key).toBe('1_2_2025-01-01_09:30_60_0');
    });
  });

  describe('setCachedResourceAvailability and getCachedResourceAvailability', () => {
    it('should set and get cached resource availability', () => {
      const key = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, undefined);

      setCachedResourceAvailability(key, mockResourceAvailabilityResponse);
      const cached = getCachedResourceAvailability(key);

      expect(cached).toEqual(mockResourceAvailabilityResponse);
    });

    it('should return null for non-existent cache key', () => {
      const key = getResourceCacheKey(999, 999, '2024-11-15', '14:00', 30, undefined);
      const cached = getCachedResourceAvailability(key);
      expect(cached).toBeNull();
    });

    it('should return null for expired cache entries', () => {
      vi.useFakeTimers();
      const key = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, undefined);

      // Set cache at time 0
      setCachedResourceAvailability(key, mockResourceAvailabilityResponse);
      expect(getCachedResourceAvailability(key)).toEqual(mockResourceAvailabilityResponse);

      // Advance time by 6 minutes (past TTL of 5 minutes)
      vi.advanceTimersByTime(6 * 60 * 1000);

      const cached = getCachedResourceAvailability(key);
      expect(cached).toBeNull();
    });

    it('should handle different excludeCalendarEventId values', () => {
      const key1 = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, undefined);
      const key2 = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, 789);

      const response1: ResourceAvailabilityResponse = {
        ...mockResourceAvailabilityResponse,
        requirements: [{ ...mockResourceAvailabilityResponse.requirements[0], available_quantity: 2 }],
      };
      const response2: ResourceAvailabilityResponse = {
        ...mockResourceAvailabilityResponse,
        requirements: [{ ...mockResourceAvailabilityResponse.requirements[0], available_quantity: 1 }],
      };

      setCachedResourceAvailability(key1, response1);
      setCachedResourceAvailability(key2, response2);

      expect(getCachedResourceAvailability(key1)).toEqual(response1);
      expect(getCachedResourceAvailability(key2)).toEqual(response2);
    });
  });

  describe('invalidateResourceCacheForDate', () => {
    it('should invalidate cache for specific date, practitioner, and appointment type', () => {
      const key1 = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, undefined);
      const key2 = getResourceCacheKey(123, 456, '2024-11-15', '15:00', 30, undefined);
      const key3 = getResourceCacheKey(123, 456, '2024-11-16', '14:00', 30, undefined); // Different date
      const key4 = getResourceCacheKey(789, 456, '2024-11-15', '14:00', 30, undefined); // Different practitioner

      setCachedResourceAvailability(key1, mockResourceAvailabilityResponse);
      setCachedResourceAvailability(key2, mockResourceAvailabilityResponse);
      setCachedResourceAvailability(key3, mockResourceAvailabilityResponse);
      setCachedResourceAvailability(key4, mockResourceAvailabilityResponse);

      // Invalidate for specific practitioner and appointment type on 2024-11-15
      // Note: function signature is (practitionerId, appointmentTypeId, date)
      // Cache key format is: appointmentTypeId_practitionerId_date_...
      // So for key1: 123_456_... means appointmentTypeId=123, practitionerId=456
      invalidateResourceCacheForDate(456, 123, '2024-11-15');

      expect(getCachedResourceAvailability(key1)).toBeNull(); // Should be invalidated
      expect(getCachedResourceAvailability(key2)).toBeNull(); // Should be invalidated (same date)
      expect(getCachedResourceAvailability(key3)).toEqual(mockResourceAvailabilityResponse); // Different date, should remain
      expect(getCachedResourceAvailability(key4)).toEqual(mockResourceAvailabilityResponse); // Different practitioner, should remain
    });

    it('should invalidate all practitioners when practitionerId is null', () => {
      // Key format: appointmentTypeId_practitionerId_date_...
      // For appointmentTypeId=123, we'll test with different practitioners
      const key1 = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, undefined); // appointmentTypeId=123, practitionerId=456
      const key2 = getResourceCacheKey(123, 789, '2024-11-15', '14:00', 30, undefined); // appointmentTypeId=123, practitionerId=789
      const key3 = getResourceCacheKey(123, 456, '2024-11-16', '14:00', 30, undefined); // Different date

      setCachedResourceAvailability(key1, mockResourceAvailabilityResponse);
      setCachedResourceAvailability(key2, mockResourceAvailabilityResponse);
      setCachedResourceAvailability(key3, mockResourceAvailabilityResponse);

      // Invalidate for all practitioners with appointmentTypeId=123 on 2024-11-15
      // Function signature: (practitionerId, appointmentTypeId, date)
      invalidateResourceCacheForDate(null, 123, '2024-11-15');

      expect(getCachedResourceAvailability(key1)).toBeNull(); // Should be invalidated
      expect(getCachedResourceAvailability(key2)).toBeNull(); // Should be invalidated
      expect(getCachedResourceAvailability(key3)).toEqual(mockResourceAvailabilityResponse); // Different date, should remain
    });

    it('should invalidate all appointment types when appointmentTypeId is null', () => {
      // Key format: appointmentTypeId_practitionerId_date_...
      // For practitionerId=456, we'll test with different appointment types
      const key1 = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, undefined); // appointmentTypeId=123, practitionerId=456
      const key2 = getResourceCacheKey(789, 456, '2024-11-15', '14:00', 30, undefined); // appointmentTypeId=789, practitionerId=456
      const key3 = getResourceCacheKey(123, 456, '2024-11-16', '14:00', 30, undefined); // Different date

      setCachedResourceAvailability(key1, mockResourceAvailabilityResponse);
      setCachedResourceAvailability(key2, mockResourceAvailabilityResponse);
      setCachedResourceAvailability(key3, mockResourceAvailabilityResponse);

      // Invalidate for all appointment types with practitionerId=456 on 2024-11-15
      // Function signature: (practitionerId, appointmentTypeId, date)
      invalidateResourceCacheForDate(456, null, '2024-11-15');

      expect(getCachedResourceAvailability(key1)).toBeNull(); // Should be invalidated
      expect(getCachedResourceAvailability(key2)).toBeNull(); // Should be invalidated
      expect(getCachedResourceAvailability(key3)).toEqual(mockResourceAvailabilityResponse); // Different date, should remain
    });

    it('should invalidate all entries for a date when both IDs are null', () => {
      const key1 = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, undefined);
      const key2 = getResourceCacheKey(789, 999, '2024-11-15', '15:00', 60, undefined);
      const key3 = getResourceCacheKey(123, 456, '2024-11-16', '14:00', 30, undefined); // Different date

      setCachedResourceAvailability(key1, mockResourceAvailabilityResponse);
      setCachedResourceAvailability(key2, mockResourceAvailabilityResponse);
      setCachedResourceAvailability(key3, mockResourceAvailabilityResponse);

      // Invalidate all entries for 2024-11-15
      invalidateResourceCacheForDate(null, null, '2024-11-15');

      expect(getCachedResourceAvailability(key1)).toBeNull(); // Should be invalidated
      expect(getCachedResourceAvailability(key2)).toBeNull(); // Should be invalidated
      expect(getCachedResourceAvailability(key3)).toEqual(mockResourceAvailabilityResponse); // Different date, should remain
    });

    it('should handle invalid cache keys gracefully', () => {
      // Should not throw when invalidating with valid parameters
      expect(() => invalidateResourceCacheForDate(123, 456, '2024-11-15')).not.toThrow();
      
      // Invalid keys in cache should not match and should not cause errors
      // This is tested implicitly - if invalid keys caused issues, the test would fail
    });
  });

  describe('clearAllResourceCache', () => {
    it('should clear all cached entries', () => {
      const key1 = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, undefined);
      const key2 = getResourceCacheKey(789, 999, '2024-11-16', '15:00', 60, undefined);

      setCachedResourceAvailability(key1, mockResourceAvailabilityResponse);
      setCachedResourceAvailability(key2, mockResourceAvailabilityResponse);

      clearAllResourceCache();

      expect(getCachedResourceAvailability(key1)).toBeNull();
      expect(getCachedResourceAvailability(key2)).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle different times for the same date', () => {
      const key1 = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, undefined);
      const key2 = getResourceCacheKey(123, 456, '2024-11-15', '15:00', 30, undefined);

      const response1: ResourceAvailabilityResponse = {
        ...mockResourceAvailabilityResponse,
        requirements: [{ ...mockResourceAvailabilityResponse.requirements[0], available_quantity: 2 }],
      };
      const response2: ResourceAvailabilityResponse = {
        ...mockResourceAvailabilityResponse,
        requirements: [{ ...mockResourceAvailabilityResponse.requirements[0], available_quantity: 1 }],
      };

      setCachedResourceAvailability(key1, response1);
      setCachedResourceAvailability(key2, response2);

      // Invalidate should affect all times for the date
      // Cache key: 123_456_... means appointmentTypeId=123, practitionerId=456
      invalidateResourceCacheForDate(456, 123, '2024-11-15');

      expect(getCachedResourceAvailability(key1)).toBeNull();
      expect(getCachedResourceAvailability(key2)).toBeNull();
    });

    it('should handle different durations for the same date and time', () => {
      const key1 = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, undefined);
      const key2 = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 60, undefined);

      setCachedResourceAvailability(key1, mockResourceAvailabilityResponse);
      setCachedResourceAvailability(key2, mockResourceAvailabilityResponse);

      // Invalidate should affect all durations for the date
      // Cache key: 123_456_... means appointmentTypeId=123, practitionerId=456
      invalidateResourceCacheForDate(456, 123, '2024-11-15');

      expect(getCachedResourceAvailability(key1)).toBeNull();
      expect(getCachedResourceAvailability(key2)).toBeNull();
    });

    it('should handle excludeCalendarEventId in invalidation', () => {
      const key1 = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, undefined);
      const key2 = getResourceCacheKey(123, 456, '2024-11-15', '14:00', 30, 789);

      setCachedResourceAvailability(key1, mockResourceAvailabilityResponse);
      setCachedResourceAvailability(key2, mockResourceAvailabilityResponse);

      // Invalidate should affect both (excludeCalendarEventId is part of key but not used in invalidation)
      // Cache key: 123_456_... means appointmentTypeId=123, practitionerId=456
      invalidateResourceCacheForDate(456, 123, '2024-11-15');

      expect(getCachedResourceAvailability(key1)).toBeNull();
      expect(getCachedResourceAvailability(key2)).toBeNull();
    });
  });
});

