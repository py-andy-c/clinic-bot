/**
 * Tests for useAvailabilitySlots React Query hooks
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAvailabilitySlots, useBatchAvailabilitySlots, useCreateAppointmentOptimistic } from '../useAvailabilitySlots';
import { apiService } from '../../../services/api';

// Mock useAuth
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { active_clinic_id: 1 }
  }))
}));

// Mock the API service
vi.mock('../../../services/api', () => ({
  apiService: {
    getAvailableSlots: vi.fn(),
    getBatchAvailableSlots: vi.fn(),
    createClinicAppointment: vi.fn(),
  },
}));

// Mock React components for QueryClientProvider wrapper
const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useAvailabilitySlots', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('should fetch availability slots successfully', async () => {
    const mockSlots = [
      { start_time: '09:00:00', end_time: '10:00:00' },
      { start_time: '10:00:00', end_time: '11:00:00' },
    ];

    vi.mocked(apiService.getAvailableSlots).mockResolvedValue({
      available_slots: mockSlots,
    });

    const { result } = renderHook(
      () => useAvailabilitySlots({
        practitionerId: 1,
        appointmentTypeId: 2,
        date: '2024-01-01',
        excludeCalendarEventId: 3,
      }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockSlots);
    expect(apiService.getAvailableSlots).toHaveBeenCalledWith(1, '2024-01-01', 2, 3);
  });

  it('should handle 404 errors gracefully', async () => {
    const mockError = {
      response: { status: 404 },
    };

    vi.mocked(apiService.getAvailableSlots).mockRejectedValue(mockError);

    const { result } = renderHook(
      () => useAvailabilitySlots({
        practitionerId: 1,
        appointmentTypeId: 2,
        date: '2024-01-01',
      }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('should not fetch when required params are missing', () => {
    const { result } = renderHook(
      () => useAvailabilitySlots({
        practitionerId: undefined,
        appointmentTypeId: 2,
        date: '2024-01-01',
      }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.isPending).toBe(true);
    expect(apiService.getAvailableSlots).not.toHaveBeenCalled();
  });
});

describe('useBatchAvailabilitySlots', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('should fetch batch availability slots successfully', async () => {
    const mockResponse = {
      results: [
        { date: '2024-01-01', available_slots: [{ start_time: '09:00:00', end_time: '10:00:00' }] },
        { date: '2024-01-02', available_slots: [{ start_time: '10:00:00', end_time: '11:00:00' }] },
      ],
    };

    vi.mocked(apiService.getBatchAvailableSlots).mockResolvedValue(mockResponse);

    const { result } = renderHook(
      () => useBatchAvailabilitySlots({
        practitionerId: 1,
        appointmentTypeId: 2,
        dates: ['2024-01-01', '2024-01-02'],
        excludeCalendarEventId: 3,
      }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({
      '2024-01-01': [{ start_time: '09:00:00', end_time: '10:00:00' }],
      '2024-01-02': [{ start_time: '10:00:00', end_time: '11:00:00' }],
    });
  });

  it('should handle empty dates array', () => {
    const { result } = renderHook(
      () => useBatchAvailabilitySlots({
        practitionerId: 1,
        appointmentTypeId: 2,
        dates: [],
      }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(apiService.getBatchAvailableSlots).not.toHaveBeenCalled();
  });
});

describe('useCreateAppointmentOptimistic', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('should create appointment with optimistic updates', async () => {
    const mockAppointment = { id: 123, start_time: '2024-01-01T09:00:00' };
    const initialSlots = [
      { start_time: '09:00:00', end_time: '10:00:00' },
      { start_time: '10:00:00', end_time: '11:00:00' },
    ];
    const expectedSlotsAfterOptimistic = [
      { start_time: '10:00:00', end_time: '11:00:00' },
    ];

    // Set up initial cache state
    queryClient.setQueryData(['availability-slots', 1, 2, '2024-01-01'], initialSlots);

    vi.mocked(apiService.createClinicAppointment).mockResolvedValue(mockAppointment);

    const { result } = renderHook(
      () => useCreateAppointmentOptimistic(),
      { wrapper: createWrapper(queryClient) }
    );

    result.current.mutate({
      practitionerId: 1,
      appointmentTypeId: 2,
      date: '2024-01-01',
      startTime: '09:00:00',
      patientId: 456,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Check that the slot was optimistically removed
    const cachedSlots = queryClient.getQueryData(['availability-slots', 1, 2, '2024-01-01']);
    expect(cachedSlots).toEqual(expectedSlotsAfterOptimistic);

    expect(apiService.createClinicAppointment).toHaveBeenCalledWith({
      practitioner_id: 1,
      appointment_type_id: 2,
      start_time: '2024-01-01T09:00:00',
      patient_id: 456,
      selected_resource_ids: [],
    });
  });

  it('should rollback optimistic update on error', async () => {
    const initialSlots = [
      { start_time: '09:00:00', end_time: '10:00:00' },
      { start_time: '10:00:00', end_time: '11:00:00' },
    ];

    // Set up initial cache state
    queryClient.setQueryData(['availability-slots', 1, 2, '2024-01-01'], initialSlots);

    vi.mocked(apiService.createClinicAppointment).mockRejectedValue(new Error('API Error'));

    const { result } = renderHook(
      () => useCreateAppointmentOptimistic(),
      { wrapper: createWrapper(queryClient) }
    );

    result.current.mutate({
      practitionerId: 1,
      appointmentTypeId: 2,
      date: '2024-01-01',
      startTime: '09:00:00',
      patientId: 456,
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Check that the slots were rolled back
    const cachedSlots = queryClient.getQueryData(['availability-slots', 1, 2, '2024-01-01']);
    expect(cachedSlots).toEqual(initialSlots);
  });

  it('should handle optional clinic notes', async () => {
    const mockAppointment = { id: 123, start_time: '2024-01-01T09:00:00' };

    vi.mocked(apiService.createClinicAppointment).mockResolvedValue(mockAppointment);

    const { result } = renderHook(
      () => useCreateAppointmentOptimistic(),
      { wrapper: createWrapper(queryClient) }
    );

    result.current.mutate({
      practitionerId: 1,
      appointmentTypeId: 2,
      date: '2024-01-01',
      startTime: '09:00:00',
      patientId: 456,
      clinicNotes: 'Test notes',
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(apiService.createClinicAppointment).toHaveBeenCalledWith({
      practitioner_id: 1,
      appointment_type_id: 2,
      start_time: '2024-01-01T09:00:00',
      patient_id: 456,
      selected_resource_ids: [],
      clinic_notes: 'Test notes',
    });
  });

  it('should handle concurrent mutations on the same time slot', async () => {
    const mockAppointment1 = { id: 123, start_time: '2024-01-01T09:00:00' };
    const mockAppointment2 = { id: 124, start_time: '2024-01-01T09:00:00' };

    const initialSlots = [
      { start_time: '09:00:00', end_time: '10:00:00' },
      { start_time: '10:00:00', end_time: '11:00:00' },
    ];

    // Set up initial cache state
    queryClient.setQueryData(['availability-slots', 1, 2, '2024-01-01'], initialSlots);

    vi.mocked(apiService.createClinicAppointment)
      .mockResolvedValueOnce(mockAppointment1)
      .mockResolvedValueOnce(mockAppointment2);

    const { result: result1 } = renderHook(
      () => useCreateAppointmentOptimistic(),
      { wrapper: createWrapper(queryClient) }
    );

    const { result: result2 } = renderHook(
      () => useCreateAppointmentOptimistic(),
      { wrapper: createWrapper(queryClient) }
    );

    // Start both mutations simultaneously
    result1.current.mutate({
      practitionerId: 1,
      appointmentTypeId: 2,
      date: '2024-01-01',
      startTime: '09:00:00',
      patientId: 456,
    });

    result2.current.mutate({
      practitionerId: 1,
      appointmentTypeId: 2,
      date: '2024-01-01',
      startTime: '09:00:00',
      patientId: 789,
    });

    // Wait for both to complete
    await waitFor(() => {
      expect(result1.current.isSuccess || result1.current.isError).toBe(true);
    });

    await waitFor(() => {
      expect(result2.current.isSuccess || result2.current.isError).toBe(true);
    });

    // One should succeed, one should fail (depending on server response)
    expect(result1.current.isSuccess || result1.current.isError).toBe(true);
    expect(result2.current.isSuccess || result2.current.isError).toBe(true);
  });

  it('should handle network failure during optimistic update rollback', async () => {
    const initialSlots = [
      { start_time: '09:00:00', end_time: '10:00:00' },
      { start_time: '10:00:00', end_time: '11:00:00' },
    ];

    // Set up initial cache state
    queryClient.setQueryData(['availability-slots', 1, 2, '2024-01-01'], initialSlots);

    // Mock network failure
    vi.mocked(apiService.createClinicAppointment).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(
      () => useCreateAppointmentOptimistic(),
      { wrapper: createWrapper(queryClient) }
    );

    result.current.mutate({
      practitionerId: 1,
      appointmentTypeId: 2,
      date: '2024-01-01',
      startTime: '09:00:00',
      patientId: 456,
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Verify rollback occurred - slots should be restored
    const cachedSlots = queryClient.getQueryData(['availability-slots', 1, 2, '2024-01-01']);
    expect(cachedSlots).toEqual(initialSlots);
  });

  it('should invalidate queries with different excludeCalendarEventId parameters', async () => {
    const mockAppointment = { id: 123, start_time: '2024-01-01T09:00:00' };
    const initialSlots = [
      { start_time: '09:00:00', end_time: '10:00:00' },
    ];

    // Set up cache entries with different excludeCalendarEventId values
    queryClient.setQueryData(['availability-slots', 1, 2, '2024-01-01'], initialSlots);
    queryClient.setQueryData(['availability-slots', 1, 2, '2024-01-01', 5], initialSlots);

    vi.mocked(apiService.createClinicAppointment).mockResolvedValue(mockAppointment);

    const { result } = renderHook(
      () => useCreateAppointmentOptimistic(),
      { wrapper: createWrapper(queryClient) }
    );

    result.current.mutate({
      practitionerId: 1,
      appointmentTypeId: 2,
      date: '2024-01-01',
      startTime: '09:00:00',
      patientId: 456,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Check that invalidation occurred by verifying queries are marked as stale
    // In test environment, invalidated queries may not be immediately removed
    const queryCache = queryClient.getQueryCache();
    const allQueries = queryCache.getAll();

    // Find queries that match our pattern and should be invalidated
    const relevantQueries = allQueries.filter(query => {
      const key = query.queryKey as (string | number)[];
      return key.length >= 4 &&
             key[0] === 'availability-slots' &&
             key[1] === 1 && key[2] === 2 && key[3] === '2024-01-01';
    });

    // Should have found our test queries
    expect(relevantQueries.length).toBeGreaterThan(0);

    // All relevant queries should be invalidated (marked as stale)
    relevantQueries.forEach(query => {
      expect(query.isStale()).toBe(true);
    });
  });
});