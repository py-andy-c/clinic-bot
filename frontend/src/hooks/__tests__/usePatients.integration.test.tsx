/**
 * Integration tests for usePatients hook with MSW
 * 
 * Tests the integration between React Query and MSW mocks
 * to ensure proper data fetching and caching behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { usePatients } from '../usePatients';
import { server } from '../../mocks/server';
import { http, HttpResponse } from 'msw';
import { Patient } from '../../types';
import * as useAuthModule from '../useAuth';

// Create a wrapper with QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('usePatients Integration Tests', () => {
  beforeEach(() => {
    // Reset MSW handlers before each test
    server.resetHandlers();
    
    // Mock useAuth to return a user with active_clinic_id
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      user: { active_clinic_id: 1, user_id: 1 },
      isAuthenticated: true,
      isLoading: false,
      isClinicAdmin: false,
      isClinicUser: true,
      hasRole: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
    } as any);
  });

  it('should fetch patients successfully', async () => {
    const mockPatients: Patient[] = [
      {
        id: 1,
        full_name: 'Test Patient',
        phone_number: '0912345678',
        birthday: '1990-01-01',
        gender: 'male',
        notes: null,
        created_at: '2024-01-01T00:00:00Z',
        profile_picture_url: null,
        assigned_practitioner_ids: [],
      },
    ];

    server.use(
      http.get('/api/clinic/patients', () => {
        return HttpResponse.json({
          patients: mockPatients,
          total: 1,
          page: 1,
          page_size: 10,
        });
      })
    );

    const { result } = renderHook(
      () => usePatients({ page: 1, pageSize: 10, enabled: true }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.patients).toEqual(mockPatients);
    expect(result.current.data?.total).toBe(1);
  });

  it('should handle search parameter', async () => {
    const mockPatients: Patient[] = [
      {
        id: 1,
        full_name: 'John Doe',
        phone_number: '0912345678',
        birthday: '1990-01-01',
        gender: 'male',
        user_id: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    server.use(
      http.get('/api/clinic/patients', ({ request }) => {
        const url = new URL(request.url);
        const search = url.searchParams.get('search');
        expect(search).toBe('John');
        return HttpResponse.json({
          patients: mockPatients,
          total: 1,
          page: 1,
          page_size: 10,
        });
      })
    );

    const { result } = renderHook(
      () => usePatients({ page: 1, pageSize: 10, search: 'John', enabled: true }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.patients).toEqual(mockPatients);
  });

  it('should handle errors gracefully', async () => {
    // Create a QueryClient with retries disabled for this test
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );

    server.use(
      http.get('/api/clinic/patients', () => {
        return HttpResponse.json({ detail: 'Not found' }, { status: 404 });
      })
    );

    const { result } = renderHook(
      () => usePatients({ page: 1, pageSize: 10, enabled: true }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expect(result.current.error).toBeDefined();
  });
});

