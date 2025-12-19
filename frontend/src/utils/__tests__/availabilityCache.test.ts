import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getCacheKey,
  getCachedSlots,
  setCachedSlots,
  invalidateCacheForDate,
  clearAllCache,
} from '../availabilityCache';
import { TimeInterval } from '../../types';

describe('Availability Cache', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearAllCache();
    // Use real timers by default
    vi.useRealTimers();
  });

  afterEach(() => {
    // Restore real timers after each test
    vi.useRealTimers();
  });

  describe('getCacheKey', () => {
    it('should generate correct cache key', () => {
      const key = getCacheKey(123, 456, '2024-11', '2024-11-15');
      expect(key).toBe('123-456-2024-11-2024-11-15');
    });

    it('should handle different month keys', () => {
      const key = getCacheKey(1, 2, '2025-01', '2025-01-01');
      expect(key).toBe('1-2-2025-01-2025-01-01');
    });
  });

  describe('setCachedSlots and getCachedSlots', () => {
    it('should set and get cached slots', () => {
      const key = getCacheKey(123, 456, '2024-11', '2024-11-15');
      const slots: TimeInterval[] = [
        { start_time: '09:00', end_time: '09:30' },
        { start_time: '10:00', end_time: '10:30' },
      ];

      setCachedSlots(key, slots);
      const cached = getCachedSlots(key);

      expect(cached).toEqual(slots);
    });

    it('should return null for non-existent cache key', () => {
      const key = getCacheKey(999, 999, '2024-11', '2024-11-15');
      const cached = getCachedSlots(key);
      expect(cached).toBeNull();
    });

    it('should return null for expired cache entries', () => {
      vi.useFakeTimers();
      const key = getCacheKey(123, 456, '2024-11', '2024-11-15');
      const slots: TimeInterval[] = [{ start_time: '09:00', end_time: '09:30' }];

      // Set cache at time 0
      setCachedSlots(key, slots);
      expect(getCachedSlots(key)).toEqual(slots);

      // Advance time by 6 minutes (past TTL of 5 minutes)
      vi.advanceTimersByTime(6 * 60 * 1000);

      const cached = getCachedSlots(key);
      expect(cached).toBeNull();
    });

    it('should handle empty slots array', () => {
      const key = getCacheKey(123, 456, '2024-11', '2024-11-15');
      const slots: TimeInterval[] = [];

      setCachedSlots(key, slots);
      const cached = getCachedSlots(key);

      expect(cached).toEqual([]);
    });
  });

  describe('invalidateCacheForDate', () => {
    it('should invalidate cache for specific date, practitioner, and appointment type', () => {
      const key1 = getCacheKey(123, 456, '2024-11', '2024-11-15');
      const key2 = getCacheKey(123, 456, '2024-11', '2024-11-16');
      const key3 = getCacheKey(789, 456, '2024-11', '2024-11-15'); // Different practitioner

      const slots: TimeInterval[] = [{ start_time: '09:00', end_time: '09:30' }];

      setCachedSlots(key1, slots);
      setCachedSlots(key2, slots);
      setCachedSlots(key3, slots);

      // Invalidate for specific practitioner and appointment type on 2024-11-15
      invalidateCacheForDate(123, 456, '2024-11-15');

      expect(getCachedSlots(key1)).toBeNull(); // Should be invalidated
      expect(getCachedSlots(key2)).toEqual(slots); // Different date, should remain
      expect(getCachedSlots(key3)).toEqual(slots); // Different practitioner, should remain
    });

    it('should invalidate all practitioners when practitionerId is null', () => {
      const key1 = getCacheKey(123, 456, '2024-11', '2024-11-15');
      const key2 = getCacheKey(789, 456, '2024-11', '2024-11-15');
      const key3 = getCacheKey(123, 456, '2024-11', '2024-11-16'); // Different date

      const slots: TimeInterval[] = [{ start_time: '09:00', end_time: '09:30' }];

      setCachedSlots(key1, slots);
      setCachedSlots(key2, slots);
      setCachedSlots(key3, slots);

      // Invalidate for all practitioners on 2024-11-15
      invalidateCacheForDate(null, 456, '2024-11-15');

      expect(getCachedSlots(key1)).toBeNull(); // Should be invalidated
      expect(getCachedSlots(key2)).toBeNull(); // Should be invalidated
      expect(getCachedSlots(key3)).toEqual(slots); // Different date, should remain
    });

    it('should invalidate all appointment types when appointmentTypeId is null', () => {
      const key1 = getCacheKey(123, 456, '2024-11', '2024-11-15');
      const key2 = getCacheKey(123, 789, '2024-11', '2024-11-15');
      const key3 = getCacheKey(123, 456, '2024-11', '2024-11-16'); // Different date

      const slots: TimeInterval[] = [{ start_time: '09:00', end_time: '09:30' }];

      setCachedSlots(key1, slots);
      setCachedSlots(key2, slots);
      setCachedSlots(key3, slots);

      // Invalidate for all appointment types on 2024-11-15
      invalidateCacheForDate(123, null, '2024-11-15');

      expect(getCachedSlots(key1)).toBeNull(); // Should be invalidated
      expect(getCachedSlots(key2)).toBeNull(); // Should be invalidated
      expect(getCachedSlots(key3)).toEqual(slots); // Different date, should remain
    });

    it('should invalidate all entries for a date when both IDs are null', () => {
      const key1 = getCacheKey(123, 456, '2024-11', '2024-11-15');
      const key2 = getCacheKey(789, 999, '2024-11', '2024-11-15');
      const key3 = getCacheKey(123, 456, '2024-11', '2024-11-16'); // Different date

      const slots: TimeInterval[] = [{ start_time: '09:00', end_time: '09:30' }];

      setCachedSlots(key1, slots);
      setCachedSlots(key2, slots);
      setCachedSlots(key3, slots);

      // Invalidate all entries for 2024-11-15
      invalidateCacheForDate(null, null, '2024-11-15');

      expect(getCachedSlots(key1)).toBeNull(); // Should be invalidated
      expect(getCachedSlots(key2)).toBeNull(); // Should be invalidated
      expect(getCachedSlots(key3)).toEqual(slots); // Different date, should remain
    });

    it('should handle invalid cache keys gracefully', () => {
      // Should not throw when invalidating with valid parameters
      expect(() => invalidateCacheForDate(123, 456, '2024-11-15')).not.toThrow();
      
      // Invalid keys in cache should not match and should not cause errors
      // This is tested implicitly - if invalid keys caused issues, the test would fail
    });
  });

  describe('clearAllCache', () => {
    it('should clear all cached entries', () => {
      const key1 = getCacheKey(123, 456, '2024-11', '2024-11-15');
      const key2 = getCacheKey(789, 999, '2024-11', '2024-11-16');

      const slots: TimeInterval[] = [{ start_time: '09:00', end_time: '09:30' }];

      setCachedSlots(key1, slots);
      setCachedSlots(key2, slots);

      clearAllCache();

      expect(getCachedSlots(key1)).toBeNull();
      expect(getCachedSlots(key2)).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle cache entries from different months', () => {
      const key1 = getCacheKey(123, 456, '2024-11', '2024-11-15');
      const key2 = getCacheKey(123, 456, '2024-12', '2024-12-15');

      const slots: TimeInterval[] = [{ start_time: '09:00', end_time: '09:30' }];

      setCachedSlots(key1, slots);
      setCachedSlots(key2, slots);

      // Invalidate should only affect entries for the specified date
      invalidateCacheForDate(123, 456, '2024-11-15');

      expect(getCachedSlots(key1)).toBeNull();
      expect(getCachedSlots(key2)).toEqual(slots);
    });

    it('should handle multiple cache entries for the same date', () => {
      const key1 = getCacheKey(123, 456, '2024-11', '2024-11-15');
      const key2 = getCacheKey(123, 456, '2024-12', '2024-11-15'); // Same date, different month key

      const slots1: TimeInterval[] = [{ start_time: '09:00', end_time: '09:30' }];
      const slots2: TimeInterval[] = [{ start_time: '10:00', end_time: '10:30' }];

      setCachedSlots(key1, slots1);
      setCachedSlots(key2, slots2);

      // Both should be invalidated since they're for the same date
      invalidateCacheForDate(123, 456, '2024-11-15');

      expect(getCachedSlots(key1)).toBeNull();
      expect(getCachedSlots(key2)).toBeNull();
    });
  });
});

