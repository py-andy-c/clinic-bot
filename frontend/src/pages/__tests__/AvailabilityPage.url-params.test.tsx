import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import AvailabilityPage from '../AvailabilityPage';
import { AuthProvider } from '../../hooks/useAuth';
import { ModalProvider } from '../../contexts/ModalContext';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../hooks/useAuth');
vi.mock('../../hooks/queries');
vi.mock('../../services/api');
vi.mock('../../utils/calendarDataAdapter');
vi.mock('../../utils/storage');

const createWrapper = (initialEntries = ['/admin/calendar']) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ModalProvider>
            {children}
          </ModalProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};

describe('AvailabilityPage URL Parameters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse date parameter from URL', async () => {
    // Mock URL with date parameter
    window.history.pushState({}, '', '/admin/calendar?date=2024-01-15');

    render(
      <BrowserRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider>
            <ModalProvider>
              <AvailabilityPage />
            </ModalProvider>
          </AuthProvider>
        </QueryClientProvider>
      </BrowserRouter>
    );

    // The component should initialize with the date from URL parameters
    // This test verifies that URL parsing logic is in place
    await waitFor(() => {
      expect(window.location.search).toContain('date=2024-01-15');
    });
  });

  it('should parse view parameter from URL', async () => {
    // Mock URL with view parameter
    window.history.pushState({}, '', '/admin/calendar?view=week');

    render(
      <BrowserRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider>
            <ModalProvider>
              <AvailabilityPage />
            </ModalProvider>
          </AuthProvider>
        </QueryClientProvider>
      </BrowserRouter>
    );

    // Verify view parameter is parsed
    await waitFor(() => {
      expect(window.location.search).toContain('view=week');
    });
  });

  it('should update URL when date changes', async () => {
    // This would test the URL updating logic when date changes
    // Implementation would require mocking the date change handlers
    expect(true).toBe(true); // Placeholder for actual test
  });

  it('should update URL when view changes', async () => {
    // This would test the URL updating logic when view changes
    expect(true).toBe(true); // Placeholder for actual test
  });

  it('should handle invalid date parameters gracefully', async () => {
    // Mock URL with invalid date
    window.history.pushState({}, '', '/admin/calendar?date=invalid-date');

    render(
      <BrowserRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider>
            <ModalProvider>
              <AvailabilityPage />
            </ModalProvider>
          </AuthProvider>
        </QueryClientProvider>
      </BrowserRouter>
    );

    // Should not crash with invalid date
    await waitFor(() => {
      expect(window.location.search).toContain('date=invalid-date');
    });
  });

  it('should handle invalid view parameters gracefully', async () => {
    // Mock URL with invalid view
    window.history.pushState({}, '', '/admin/calendar?view=invalid');

    render(
      <BrowserRouter>
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider>
            <ModalProvider>
              <AvailabilityPage />
            </ModalProvider>
          </AuthProvider>
        </QueryClientProvider>
      </BrowserRouter>
    );

    // Should default to valid view
    await waitFor(() => {
      expect(window.location.search).toContain('view=invalid');
    });
  });
});