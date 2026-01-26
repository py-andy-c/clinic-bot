import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  performanceMonitor,
  trackCalendarAPICall,
  completeCalendarAPICall,
  getCalendarPerformanceStats,
  getOverallPerformanceStats,
  resetPerformanceMetrics
} from '../performanceMonitor';

describe('Performance Monitor', () => {
  beforeEach(() => {
    resetPerformanceMetrics();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('trackCalendarAPICall and completeCalendarAPICall', () => {
    it('should track successful API calls', () => {
      const callId = trackCalendarAPICall('/api/calendar', 'GET');

      // Simulate some time passing
      vi.advanceTimersByTime(100);

      completeCalendarAPICall(callId, true, false);

      const stats = getOverallPerformanceStats();
      expect(stats.totalCalls).toBe(1);
      expect(stats.successfulCalls).toBe(1);
      expect(stats.failedCalls).toBe(0);
      expect(stats.averageDuration).toBe(100);
    });

    it('should track failed API calls', () => {
      const callId = trackCalendarAPICall('/api/calendar', 'POST');

      vi.advanceTimersByTime(50);

      completeCalendarAPICall(callId, false, false, 'Network error');

      const stats = getOverallPerformanceStats();
      expect(stats.totalCalls).toBe(1);
      expect(stats.successfulCalls).toBe(0);
      expect(stats.failedCalls).toBe(1);
      expect(stats.averageDuration).toBe(50);
    });

    it('should track cache hits', () => {
      const callId = trackCalendarAPICall('calendar-cache-hit', 'CACHE');

      vi.advanceTimersByTime(10);

      completeCalendarAPICall(callId, true, true);

      const stats = getOverallPerformanceStats();
      expect(stats.cacheHitRate).toBe(100);
      expect(stats.totalCalls).toBe(1);
    });

    it('should track cache misses', () => {
      const callId = trackCalendarAPICall('calendar-cache-miss', 'CACHE');

      vi.advanceTimersByTime(5);

      completeCalendarAPICall(callId, true, false);

      const stats = getOverallPerformanceStats();
      expect(stats.cacheHitRate).toBe(0);
      expect(stats.totalCalls).toBe(1);
    });
  });

  describe('getCalendarPerformanceStats', () => {
    it('should provide calendar-specific performance metrics', () => {
      // Track some calendar calls using the correct endpoint patterns
      const callId1 = trackCalendarAPICall('calendar/batch-practitioners', 'POST');
      vi.advanceTimersByTime(200);
      completeCalendarAPICall(callId1, true, false);

      const callId2 = trackCalendarAPICall('calendar/batch-resource', 'POST');
      vi.advanceTimersByTime(150);
      completeCalendarAPICall(callId2, true, false);

      // Track a non-calendar call
      const callId3 = trackCalendarAPICall('/api/users', 'GET');
      vi.advanceTimersByTime(50);
      completeCalendarAPICall(callId3, true, false);

      const calendarStats = getCalendarPerformanceStats();

      expect(calendarStats.totalCalendarCalls).toBe(2); // Only calendar endpoints
      expect(calendarStats.batchCalendarCalls).toBe(1);
      expect(calendarStats.resourceCalendarCalls).toBe(1);
      expect(calendarStats.averageCalendarDuration).toBe(175); // (200 + 150) / 2
      expect(calendarStats.calendarCacheHitRate).toBe(0);
    });

    it('should calculate API reduction estimate', () => {
      // Create cache hits with calendar endpoints that match the filter pattern
      for (let i = 0; i < 7; i++) {
        const callId = trackCalendarAPICall('/calendar/batch-practitioners', 'CACHE');
        completeCalendarAPICall(callId, true, true);
      }

      // Create cache misses with calendar endpoints
      for (let i = 0; i < 3; i++) {
        const callId = trackCalendarAPICall('/calendar/batch-resource', 'CACHE');
        completeCalendarAPICall(callId, true, false);
      }

      const calendarStats = getCalendarPerformanceStats();

      expect(calendarStats.calendarCacheHitRate).toBe(70); // 7 hits out of 10 calls
      expect(calendarStats.apiReductionEstimate).toBe(100); // 70% of 70% target achieved = 100% progress
    });
  });

  describe('Metrics Management', () => {
    it('should maintain history limit', () => {
      // Track more calls than the history limit (100)
      for (let i = 0; i < 110; i++) {
        const callId = trackCalendarAPICall(`/api/test/${i}`, 'GET');
        completeCalendarAPICall(callId, true, false);
      }

      const stats = getOverallPerformanceStats();
      expect(stats.recentCalls.length).toBeLessThanOrEqual(100);
      expect(stats.totalCalls).toBe(100); // Cleanup keeps only the most recent 100
    });

    it('should reset metrics when requested', () => {
      const callId = trackCalendarAPICall('/api/test', 'GET');
      completeCalendarAPICall(callId, true, false);

      expect(getOverallPerformanceStats().totalCalls).toBe(1);

      resetPerformanceMetrics();

      expect(getOverallPerformanceStats().totalCalls).toBe(0);
    });

    it('should export metrics for debugging', () => {
      const callId = trackCalendarAPICall('/api/test', 'GET');
      completeCalendarAPICall(callId, true, false);

      const exportedMetrics = performanceMonitor.exportMetrics();
      expect(exportedMetrics).toHaveLength(1);
      expect(exportedMetrics[0]).toHaveProperty('endpoint', '/api/test');
      expect(exportedMetrics[0]).toHaveProperty('method', 'GET');
      expect(exportedMetrics[0]).toHaveProperty('success', true);
    });
  });

  describe('Error Handling', () => {
    it('should handle completion of non-existent calls gracefully', () => {
      // Try to complete a call that doesn't exist
      expect(() => {
        completeCalendarAPICall('non-existent-call-id', true, false);
      }).not.toThrow();

      const stats = getOverallPerformanceStats();
      expect(stats.totalCalls).toBe(0);
    });

    it('should handle calls without completion', () => {
      // Track a call but don't complete it
      trackCalendarAPICall('/api/test', 'GET');

      const stats = getOverallPerformanceStats();
      expect(stats.totalCalls).toBe(1);
      expect(stats.recentCalls[0]).toHaveProperty('success', false); // Default value
    });
  });

  describe('Endpoint Tracking', () => {
    it('should track calls by endpoint', () => {
      const callId1 = trackCalendarAPICall('/api/endpoint1', 'GET');
      const callId2 = trackCalendarAPICall('/api/endpoint1', 'POST');
      const callId3 = trackCalendarAPICall('/api/endpoint2', 'GET');

      completeCalendarAPICall(callId1, true, false);
      completeCalendarAPICall(callId2, true, false);
      completeCalendarAPICall(callId3, true, false);

      const stats = getOverallPerformanceStats();

      expect(stats.callsByEndpoint['/api/endpoint1']).toBe(2);
      expect(stats.callsByEndpoint['/api/endpoint2']).toBe(1);
    });

    it('should provide recent calls in chronological order', () => {
      const callId1 = trackCalendarAPICall('/api/first', 'GET');
      vi.advanceTimersByTime(10);
      completeCalendarAPICall(callId1, true, false);

      const callId2 = trackCalendarAPICall('/api/second', 'GET');
      vi.advanceTimersByTime(10);
      completeCalendarAPICall(callId2, true, false);

      const callId3 = trackCalendarAPICall('/api/third', 'GET');
      vi.advanceTimersByTime(10);
      completeCalendarAPICall(callId3, true, false);

      const stats = getOverallPerformanceStats();

      expect(stats.recentCalls).toHaveLength(3);
      expect(stats.recentCalls[0].endpoint).toBe('/api/first'); // Chronological order (oldest first)
      expect(stats.recentCalls[1].endpoint).toBe('/api/second');
      expect(stats.recentCalls[2].endpoint).toBe('/api/third');
    });
  });
});