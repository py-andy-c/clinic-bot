/**
 * Unit tests for LineUsagePage component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import LineUsagePage from '../LineUsagePage';
import { useLineUsage } from '../../../hooks/queries';

// Mock useLineUsage hook
vi.mock('../../../hooks/queries', () => ({
  useLineUsage: vi.fn(),
}));

// Mock useAuth hook
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { active_clinic_id: 1 },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// Mock shared components
vi.mock('../../../components/shared', () => ({
  LoadingSpinner: ({ size }: any) => <div data-testid="loading-spinner">Loading {size}</div>,
  ErrorMessage: ({ message }: any) => <div data-testid="error-message">{message}</div>,
  InfoButton: ({ onClick, ariaLabel }: any) => (
    <button data-testid="info-button" onClick={onClick} aria-label={ariaLabel}>
      ℹ️
    </button>
  ),
  InfoModal: ({ isOpen, onClose, title, children }: any) =>
    isOpen ? (
      <div data-testid="info-modal">
        <h2>{title}</h2>
        {children}
        <button onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

const mockUseLineUsage = vi.mocked(useLineUsage);

describe('LineUsagePage', () => {
  const mockDashboardMetrics = {
    months: [
      { year: 2023, month: 10, display_name: '2023年10月', is_current: false },
      { year: 2023, month: 11, display_name: '2023年11月', is_current: false },
      { year: 2023, month: 12, display_name: '2023年12月', is_current: false },
      { year: 2024, month: 1, display_name: '2024年1月', is_current: true },
    ],
    active_patients_by_month: [],
    new_patients_by_month: [],
    appointments_by_month: [],
    cancellation_rate_by_month: [],
    appointment_type_stats_by_month: [],
    practitioner_stats_by_month: [],
    paid_messages_by_month: [
      {
        month: { year: 2023, month: 10, display_name: '2023年10月', is_current: false },
        recipient_type: 'patient',
        event_type: 'appointment_confirmed',
        event_display_name: '預約確認',
        trigger_source: 'system_triggered',
        count: 45,
      },
      {
        month: { year: 2023, month: 10, display_name: '2023年10月', is_current: false },
        recipient_type: 'patient',
        event_type: 'appointment_canceled',
        event_display_name: '預約取消',
        trigger_source: 'system_triggered',
        count: 12,
      },
      {
        month: { year: 2024, month: 1, display_name: '2024年1月', is_current: true },
        recipient_type: 'patient',
        event_type: 'appointment_confirmed',
        event_display_name: '預約確認',
        trigger_source: 'system_triggered',
        count: 38,
      },
    ],
    ai_reply_messages_by_month: [
      {
        month: { year: 2023, month: 10, display_name: '2023年10月', is_current: false },
        count: 50,
      },
      {
        month: { year: 2024, month: 1, display_name: '2024年1月', is_current: true },
        count: 30,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseLineUsage.mockReturnValue({
      data: mockDashboardMetrics,
      isLoading: false,
      error: null,
    });
  });

  const renderWithRouter = (component: React.ReactElement) => {
    return render(<BrowserRouter>{component}</BrowserRouter>);
  };

  it('renders loading state correctly', () => {
    mockUseLineUsage.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    });

    renderWithRouter(<LineUsagePage />);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('renders error state correctly', () => {
    mockUseLineUsage.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('Failed to load data'),
    });

    renderWithRouter(<LineUsagePage />);
    expect(screen.getByTestId('error-message')).toBeInTheDocument();
  });

  it('renders LINE usage data correctly', async () => {
    renderWithRouter(<LineUsagePage />);

    await waitFor(() => {
      expect(screen.getByText('LINE 訊息統計')).toBeInTheDocument();
    });

    // Check section headers (use getAllByText for "AI 回覆訊息" since it appears multiple times)
    expect(screen.getByText('LINE 推播訊息')).toBeInTheDocument();
    expect(screen.getAllByText('AI 回覆訊息').length).toBeGreaterThan(0);

    // Check table headers (use getAllByText since "訊息類型" appears in both tables)
    expect(screen.getAllByText('訊息類型').length).toBeGreaterThan(0);
    // Check for month headers - they should be rendered from the months data
    const monthHeaders = screen.getAllByText(/202[34]年\d+月/);
    expect(monthHeaders.length).toBeGreaterThan(0);
  });

  it('highlights current month column', async () => {
    renderWithRouter(<LineUsagePage />);

    await waitFor(() => {
      // Find table headers with bg-blue-50 class (current month highlighting)
      const allHeaders = document.querySelectorAll('th.bg-blue-50');
      expect(allHeaders.length).toBeGreaterThan(0);
      
      // Verify at least one header contains a month name
      const hasMonthHeader = Array.from(allHeaders).some(header => 
        /202[34]年\d+月/.test(header.textContent || '')
      );
      expect(hasMonthHeader).toBe(true);
    });
  });

  it('displays data in count(percentage%) format', async () => {
    renderWithRouter(<LineUsagePage />);

    await waitFor(() => {
      // Look for the format pattern: number(percentage%)
      const dataCells = screen.getAllByText(/\d+\(\d+%\)/);
      expect(dataCells.length).toBeGreaterThan(0);
    });
  });

  it('groups paid messages by recipient type', async () => {
    renderWithRouter(<LineUsagePage />);

    await waitFor(() => {
      expect(screen.getByText('發送給病患')).toBeInTheDocument();
    });
  });

  it('displays data in count(percentage%) format', async () => {
    renderWithRouter(<LineUsagePage />);

    await waitFor(() => {
      // Look for the format pattern: number(percentage%)
      const dataCells = screen.getAllByText(/\d+\(\d+%\)/);
      expect(dataCells.length).toBeGreaterThan(0);
    });
  });

  it('handles missing data gracefully', async () => {
    const incompleteData = {
      ...mockDashboardMetrics,
      paid_messages_by_month: [],
      ai_reply_messages_by_month: [],
    };

    mockUseLineUsage.mockReturnValue({
      data: incompleteData,
      isLoading: false,
      error: null,
    });

    renderWithRouter(<LineUsagePage />);

    // Component should handle empty data without crashing
    await waitFor(() => {
      expect(screen.getByText('LINE 訊息統計')).toBeInTheDocument();
    });
  });
});
