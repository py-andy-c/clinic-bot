/**
 * Unit tests for useCalendarEvents hook
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCalendarEvents, invalidateCalendarEventsForAppointment } from '../useCalendarEvents';
import { useAuth } from '../../useAuth';

// Mock the auth hook
vi.mock('../../useAuth', () => ({
  useAuth: vi.fn(),
}));

// Mock the API service
vi.mock('../../../services/api', () => ({
  apiService: {
    getBatchCalendar: vi.fn(),
    getBatchResourceCalendar: vi.fn(),
  },
}));

import { apiService } from '../../../services/api';

describe('useCalendarEvents', () => {
  let queryClient: QueryClient;
  let mockUseAuth: any;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    mockUseAuth = vi.mocked(useAuth);
    mockUseAuth.mockReturnValue({
      user: {
        user_id: 1,
        active_clinic_id: 1,
        roles: ['practitioner'],
      },
    });

    // Clear all mocks
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  describe('query behavior', () => {
    it('should handle different parameter combinations', () => {
      // Test that hook can be called with different sorted inputs
      const params1 = {
        selectedPractitioners: [3, 1, 2], // unsorted
        selectedResources: [5, 4],       // unsorted
        currentDate: new Date('2024-01-15'),
        view: 'day' as const,
      };

      const params2 = {
        selectedPractitioners: [1, 2, 3], // already sorted
        selectedResources: [4, 5],       // already sorted
        currentDate: new Date('2024-01-15'),
        view: 'day' as const,
      };

      const { result: result1 } = renderHook(() => useCalendarEvents(params1), { wrapper });
      const { result: result2 } = renderHook(() => useCalendarEvents(params2), { wrapper });

      // Both should behave the same way (same query key internally)
      expect(result1.current.isPending).toBe(result2.current.isPending);
    });
  });

  describe('query execution', () => {
    it('should not be enabled when no clinic ID', () => {
      mockUseAuth.mockReturnValue({
        user: null, // No user, so no clinic_id
      });

      const params = {
        selectedPractitioners: [1],
        selectedResources: [],
        currentDate: new Date('2024-01-15'),
        view: 'day' as const,
      };

      const { result } = renderHook(() => useCalendarEvents(params), { wrapper });

      // Query should not execute when disabled
      expect(result.current.fetchStatus).toBe('idle');
      expect(result.current.data).toBeUndefined();
    });

    it('should not be enabled when no practitioners or resources selected', () => {
      const params = {
        selectedPractitioners: [],
        selectedResources: [],
        currentDate: new Date('2024-01-15'),
        view: 'day' as const,
      };

      const { result } = renderHook(() => useCalendarEvents(params), { wrapper });

      // Query should not execute when disabled
      expect(result.current.fetchStatus).toBe('idle');
      expect(result.current.data).toBeUndefined();
    });

    it('should fetch practitioner appointments', async () => {
      const mockApiResponse = {
        results: [{
          date: '2024-01-15',
          user_id: 1,
          events: [{
            id: 1,
            title: 'Test Appointment',
            start: '2024-01-15T10:00:00',
            end: '2024-01-15T11:00:00',
            calendar_event_id: 1,
            patient_id: 1,
            appointment_type_id: 1,
            status: 'confirmed',
          }],
        }],
      };

      vi.mocked(apiService.getBatchCalendar).mockResolvedValue(mockApiResponse);
      vi.mocked(apiService.getBatchResourceCalendar).mockResolvedValue({ results: [] });

      const params = {
        selectedPractitioners: [1],
        selectedResources: [],
        currentDate: new Date('2024-01-15'),
        view: 'day' as const,
      };

      const { result } = renderHook(() => useCalendarEvents(params), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(apiService.getBatchCalendar).toHaveBeenCalledWith({
        practitionerIds: [1],
        startDate: '2024-01-15',
        endDate: '2024-01-15',
      });

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data![0].title).toBe('Test Appointment');
    });

    it('should fetch resource appointments', async () => {
      const mockApiResponse = {
        results: [{
          date: '2024-01-15',
          events: [{
            id: 2,
            title: 'Test Resource Event',
            start: '2024-01-15T14:00:00',
            end: '2024-01-15T15:00:00',
            calendar_event_id: 2,
            resource_id: 1,
            practitioner_id: 1,
          }],
        }],
      };

      vi.mocked(apiService.getBatchCalendar).mockResolvedValue({ results: [] });
      vi.mocked(apiService.getBatchResourceCalendar).mockResolvedValue(mockApiResponse);

      const params = {
        selectedPractitioners: [],
        selectedResources: [1],
        currentDate: new Date('2024-01-15'),
        view: 'day' as const,
      };

      const { result } = renderHook(() => useCalendarEvents(params), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(apiService.getBatchResourceCalendar).toHaveBeenCalledWith({
        resourceIds: [1],
        startDate: '2024-01-15',
        endDate: '2024-01-15',
      });

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data![0].title).toBe('Test Resource Event');
    });

  });

  describe('cache invalidation', () => {
    it('should have invalidateCalendarEventsForAppointment function exported', () => {
      // Test that the invalidation function exists and is callable
      expect(typeof invalidateCalendarEventsForAppointment).toBe('function');

      // Test with null parameters (should not throw)
      invalidateCalendarEventsForAppointment(queryClient, null, null, '2024-01-15', 'day');
      invalidateCalendarEventsForAppointment(queryClient, undefined, undefined, '2024-01-15', 'day');
    });

    it('should invalidate day view queries for exact date matches', () => {
      const mockInvalidateQueries = vi.fn();
      queryClient.invalidateQueries = mockInvalidateQueries;

      // Mock query with day view exact date match
      mockInvalidateQueries.mockImplementation(() => {});

      invalidateCalendarEventsForAppointment(queryClient, 1, 1, '2024-01-15', 'day');

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['calendar-events', 1],
        predicate: expect.any(Function)
      });
    });

    it('should invalidate week view queries for dates within week range', () => {
      const mockInvalidateQueries = vi.fn();
      queryClient.invalidateQueries = mockInvalidateQueries;

      // Test date within week range
      invalidateCalendarEventsForAppointment(queryClient, 1, 1, '2024-01-15', 'week');

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['calendar-events', 1],
        predicate: expect.any(Function)
      });

      // The predicate function should handle week ranges correctly
      const predicate = mockInvalidateQueries.mock.calls[0][0].predicate;
      const mockWeekQuery = {
        queryKey: ['calendar-events', 1, {
          practitioners: '1',
          dateRangeKey: '2024-01-14_2024-01-20', // Week containing 2024-01-15
        }]
      };

      expect(predicate(mockWeekQuery)).toBe(true);
    });

    it('should invalidate month view queries for dates within month range', () => {
      const mockInvalidateQueries = vi.fn();
      queryClient.invalidateQueries = mockInvalidateQueries;

      invalidateCalendarEventsForAppointment(queryClient, 1, 1, '2024-01-15', 'month');

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['calendar-events', 1],
        predicate: expect.any(Function)
      });

      // Test month range containing the date
      const predicate = mockInvalidateQueries.mock.calls[0][0].predicate;
      const mockMonthQuery = {
        queryKey: ['calendar-events', 1, {
          practitioners: '1',
          dateRangeKey: '2024-01-01_2024-01-31', // Month containing 2024-01-15
        }]
      };

      expect(predicate(mockMonthQuery)).toBe(true);
    });

    it('should not invalidate queries for different practitioners', () => {
      const mockInvalidateQueries = vi.fn();
      queryClient.invalidateQueries = mockInvalidateQueries;

      invalidateCalendarEventsForAppointment(queryClient, 1, 1, '2024-01-15', 'day');

      const predicate = mockInvalidateQueries.mock.calls[0][0].predicate;
      const mockDifferentPractitionerQuery = {
        queryKey: ['calendar-events', 1, {
          practitioners: '2,3', // Different practitioners
          dateRangeKey: '2024-01-15',
        }]
      };

      expect(predicate(mockDifferentPractitionerQuery)).toBe(false);
    });

    it('should not invalidate queries outside date range', () => {
      const mockInvalidateQueries = vi.fn();
      queryClient.invalidateQueries = mockInvalidateQueries;

      invalidateCalendarEventsForAppointment(queryClient, 1, 1, '2024-01-15', 'week');

      const predicate = mockInvalidateQueries.mock.calls[0][0].predicate;
      const mockOutsideRangeQuery = {
        queryKey: ['calendar-events', 1, {
          practitioners: '1',
          dateRangeKey: '2024-01-21_2024-01-27', // Week not containing 2024-01-15
        }]
      };

      expect(predicate(mockOutsideRangeQuery)).toBe(false);
    });

    it('should handle boundary dates correctly', () => {
      const mockInvalidateQueries = vi.fn();
      queryClient.invalidateQueries = mockInvalidateQueries;

      // Test start boundary of week
      invalidateCalendarEventsForAppointment(queryClient, 1, 1, '2024-01-14', 'week');

      const predicate = mockInvalidateQueries.mock.calls[0][0].predicate;
      const mockBoundaryQuery = {
        queryKey: ['calendar-events', 1, {
          practitioners: '1',
          dateRangeKey: '2024-01-14_2024-01-20', // Week starting on boundary date
        }]
      };

      expect(predicate(mockBoundaryQuery)).toBe(true);
    });
  });
});