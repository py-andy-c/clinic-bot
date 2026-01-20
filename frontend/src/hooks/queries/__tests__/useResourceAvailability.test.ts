/**
 * Unit tests for useResourceAvailability hook
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useResourceAvailability } from '../useResourceAvailability';
import { apiService } from '../../../services/api';

// Mock the API service
vi.mock('../../../services/api', () => ({
  apiService: {
    getResourceAvailability: vi.fn(),
  },
}));

// Create a test wrapper with QueryClient
const createTestWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useResourceAvailability', () => {
  const mockResourceAvailability = {
    available_resources: [
      {
        id: 1,
        name: 'Room A',
        type: 'room' as const,
        is_available: true,
      },
      {
        id: 2,
        name: 'Equipment B',
        type: 'equipment' as const,
        is_available: false,
      },
    ],
    total_count: 2,
    available_count: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiService.getResourceAvailability).mockResolvedValue(mockResourceAvailability);
  });

  it('should fetch resource availability successfully', async () => {
    const params = {
      appointmentTypeId: 123,
      practitionerId: 456,
      date: '2024-01-15',
      startTime: '10:00',
      durationMinutes: 60,
      excludeCalendarEventId: 789,
    };

    const { result } = renderHook(() => useResourceAvailability(params), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockResourceAvailability);
    expect(apiService.getResourceAvailability).toHaveBeenCalledWith({
      appointment_type_id: 123,
      practitioner_id: 456,
      date: '2024-01-15',
      start_time: '10:00',
      end_time: '11:00',
      exclude_calendar_event_id: 789,
    });
  });

  it('should use correct query key', async () => {
    const params = {
      appointmentTypeId: 123,
      practitionerId: 456,
      date: '2024-01-15',
      startTime: '10:00',
      durationMinutes: 60,
    };

    const { result } = renderHook(() => useResourceAvailability(params), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // The query should have been called with the correct key
    expect(apiService.getResourceAvailability).toHaveBeenCalledWith({
      appointment_type_id: 123,
      practitioner_id: 456,
      date: '2024-01-15',
      start_time: '10:00',
      end_time: '11:00',
      exclude_calendar_event_id: undefined,
    });
  });

  it('should not fetch when required parameters are missing', () => {
    const params = {
      appointmentTypeId: 0, // Invalid
      practitionerId: 456,
      date: '2024-01-15',
      startTime: '10:00',
      durationMinutes: 60,
    };

    const { result } = renderHook(() => useResourceAvailability(params), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
    expect(apiService.getResourceAvailability).not.toHaveBeenCalled();
  });


  it('should handle 4xx errors without retry', async () => {
    const error = { status: 404, message: 'Not Found' };
    vi.mocked(apiService.getResourceAvailability).mockRejectedValue(error);

    const params = {
      appointmentTypeId: 123,
      practitionerId: 456,
      date: '2024-01-15',
      startTime: '10:00',
      durationMinutes: 60,
    };

    const { result } = renderHook(() => useResourceAvailability(params), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Should not retry on 4xx errors
    expect(apiService.getResourceAvailability).toHaveBeenCalledTimes(1);
  });
});